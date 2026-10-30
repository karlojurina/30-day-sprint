/**
 * Phase 3 (brief v3 §03) - Not Activated cohort cron.
 *
 * Schedule lives in vercel.json (every 4h at :20, 5 minutes after
 * check-csm-tasks so the team Discord post order reads: engagement
 * alerts → CSM tasks → NA tasks). Generates Astrid tasks for paying
 * members who never signed in to the dashboard.
 *
 * Trigger logic (per the 23-05-2026 simplification - no form
 * webhook):
 *
 *   activated = students.joined_at IS NOT NULL
 *   in_pool  = members where membership_status='active'
 *              AND joined_at IS NULL
 *              AND high_churn_risk = false
 *              AND csm_exempt = false
 *
 *   days_since_signup = sprintDayNumber(first_paid_at) — the canonical
 *     Day-N counter shared with check-csm-tasks (v75.57; was
 *     floor(days since students.created_at), which diverged from the
 *     dismissal side and made tasks flicker)
 *
 *   tier (Day 3/5/7/10) maps to template index 1/2/3/4
 *
 *   cohort = 'A' (has discord_username) → stalled.discord.day{N}, Discord DM
 *   cohort = 'B' (no  discord_username) → stalled.whop.day{N}, Whop DM
 *
 *   At tier 4 (Day 10), after creating the task, set
 *   high_churn_risk = true so subsequent passes skip the student.
 *
 * Cohort is re-evaluated every pass - if a Cohort B student joins
 * Discord between triggers, the next tier fires stalled.discord.x.
 *
 * A tier whose template is switched off on /admin/templates (days 5 and 10
 * as of 2026-10-30) is skipped quietly; only a scenario with no template at
 * all is an entry in the run's errors.
 *
 * Whop watchers (the owner, 29 Oct 2026: "if they never signed in but they
 * watched some lessons in whop we can send them only 1 message to remind
 * them that there's 30% off in the sprint. That's it."). A student here who
 * has finished any lesson, counted as the nolessons.* rules count one, gets
 * no stalled.* task, and their open stalled.* tasks are dismissed. Instead
 * they get ONE whop.watcher task, from day 3, while their 30% window is open
 * (discountWindowOpen), when they have not applied (a pending, approved or
 * applied discount request), when the stored coupon answer does not close
 * the 30% to them (as the map reads it: a discount already on their renewal,
 * or no paid plan and payment; no stored answer queues it), while the
 * template is on, and only if they never had a whop.watcher task in any
 * status. check-csm-tasks 3c dismisses an open one once the window closes
 * or they apply.
 *
 * Dedupe: a student never gets a task for a message they already had (open,
 * sent, or dismissed by a team member), the rule of src/lib/dm-queue.ts that
 * check-csm-tasks obeys too. The partial unique index
 *   idx_tasks_unique_open ON tasks(student_id, scenario_id) WHERE status='open'
 * still refuses a second open task (23505, skipped).
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { postTeamAlert } from "@/lib/discord";
import { isDmEnabled } from "@/lib/dm-toggles";
import { PAYING_WHOP_PLAN_IDS_ARRAY } from "@/lib/admin/metrics-definitions";
import { csmSprintWindowCutoffIso, sprintDayNumber } from "@/lib/constants";
import { fetchAllRowsPaginated } from "@/lib/supabase-pagination";
import { discountWindowOpen } from "@/lib/world/discount";
import {
  MEMBERSHIP_DISCOUNTS_TABLE,
  rowShowsUnpaid,
  storedRowApplies,
} from "@/lib/membership-discount";
import {
  THIRTY_APPLIED_STATUSES,
  WHOP_WATCHER,
  messagesHad,
  sameMessage,
  type QueueTask,
} from "@/lib/dm-queue";
import {
  verifyCronAuth,
  cronUnauthorizedResponse,
  logCronStart,
  logCronFinish,
} from "@/lib/cron-auth";

// v75.32: raised from Vercel's 60s default.
export const maxDuration = 300;

const ROUTE_NAME = "check-na-tasks";

// Ids per .in() read, as outreach-insights.ts reads them (ID_BATCH = 100).
const ID_BATCH = 100;

interface NotActivatedRow {
  id: string;
  name: string | null;
  email: string | null;
  discord_username: string | null;
  created_at: string;
  first_paid_at: string | null;
  joined_at: string | null;
  high_churn_risk: boolean;
  cancel_scheduled_at: string | null;
  whop_membership_id: string | null;
}

const TIER_DAYS = [3, 5, 7, 10] as const;
type Tier = (typeof TIER_DAYS)[number];

function templateIdFor(cohort: "A" | "B", tier: Tier): string {
  // v57 - scenario ids renamed to descriptive slugs. Cohort A
  // (has Discord) -> stalled.discord.day{N}, Cohort B (no
  // Discord) -> stalled.whop.day{N}.
  const channel = cohort === "A" ? "discord" : "whop";
  return `stalled.${channel}.day${tier}`;
}

function suggestedChannel(cohort: "A" | "B"): string {
  return cohort === "A" ? "Discord DM" : "Whop DM";
}

export async function GET(request: NextRequest) {
  // v55 - hardened to match check-csm-tasks. Previously the
  // CRON_SECRET check was conditional on the env var being set,
  // which meant a missing env var silently disabled the auth gate.
  // Now the check is unconditional - if CRON_SECRET isn't set the
  // header can never match, so the route stays locked.
  // v75.37: shared cron auth + audit.
  const auth = verifyCronAuth(request);
  if (!auth.ok) {
    await logCronStart(ROUTE_NAME, auth.reason);
    return cronUnauthorizedResponse(auth.reason);
  }
  const runId = await logCronStart(ROUTE_NAME, "ok");

  const supabase = createServiceClient();
  const started = Date.now();

  // v59 - "not activated" = paid but never OAuth'd into our app.
  // students.joined_at is set by the Whop sync at insert time, so
  // it's not a reliable signal. The real "logged in" stamp is
  // student_milestones.first_sprint_login_at - written by
  // /auth/whop/callback on first successful OAuth.
  //
  // Strategy: pull the active-paid pool from students, then drop
  // anyone whose milestones row has first_sprint_login_at set.
  const { data: studentsRaw, error: studentsErr } = await supabase
    .from("students")
    .select(
      "id, name, email, discord_username, created_at, first_paid_at, joined_at, high_churn_risk, cancel_scheduled_at, whop_membership_id",
    )
    .eq("membership_status", "active")
    .eq("high_churn_risk", false)
    .eq("csm_exempt", false)
    // v79: paying-plan filter — free-plan users don't need a CSM
    // "not activated" nudge.
    .in("whop_plan_id", PAYING_WHOP_PLAN_IDS_ARRAY as string[])
    // v75.18: filter on first_paid_at (true original signup date)
    // instead of joined_at (current cycle start). Stops a 6-month
    // legacy customer who renewed yesterday from showing up as a
    // "not activated" lead. NA nudges target first-time joiners only.
    .gte("first_paid_at", csmSprintWindowCutoffIso());

  if (studentsErr) {
    console.error("[check-na-tasks] students query failed:", studentsErr);
    await logCronFinish(runId, "failed", { error: studentsErr.message });
    return NextResponse.json(
      { error: studentsErr.message },
      { status: 500 },
    );
  }

  // Read in batches of ID_BATCH ids: one .in() list for the whole pool
  // makes a request URL past a gateway's limit at about 200 students. A
  // failed read stops the run and shows in cron_runs: read as "nobody
  // logged in", it would give logged-in students "No dashboard login since
  // signup" tasks and flag the day-10 ones high_churn_risk for good.
  const allIds = (studentsRaw ?? []).map((s) => s.id as string);
  const activatedIds = new Set<string>();
  for (let i = 0; i < allIds.length; i += ID_BATCH) {
    const { data: activated, error: activatedErr } = await supabase
      .from("student_milestones")
      .select("student_id")
      .in("student_id", allIds.slice(i, i + ID_BATCH))
      .not("first_sprint_login_at", "is", null);
    if (activatedErr) {
      console.error("[check-na-tasks] milestones query failed:", activatedErr);
      await logCronFinish(runId, "failed", { error: activatedErr.message });
      return NextResponse.json(
        { error: activatedErr.message },
        { status: 500 },
      );
    }
    for (const r of activated ?? []) activatedIds.add(r.student_id as string);
  }

  const pool = (studentsRaw ?? []).filter(
    (s) => !activatedIds.has(s.id as string),
  ) as NotActivatedRow[];

  // Resolve template ids for all 8 NA scenarios and whop.watcher in one
  // query, on or off: a tier that is off is skipped quietly, and only a
  // scenario with no template is an error. A failed read stops the run: read
  // as "no templates", every tier would look missing and nothing would be
  // made.
  // v57 - new scenario id slugs (was NA-A.1 / NA-B.1 etc.)
  const allNaIds = TIER_DAYS.flatMap((t) => [
    `stalled.discord.day${t}`,
    `stalled.whop.day${t}`,
  ]);
  const { data: templates, error: templatesErr } = await supabase
    .from("templates")
    .select("id, scenario_id, is_active")
    .in("scenario_id", [...allNaIds, WHOP_WATCHER]);
  if (templatesErr) {
    console.error("[check-na-tasks] templates query failed:", templatesErr);
    await logCronFinish(runId, "failed", { error: templatesErr.message });
    return NextResponse.json({ error: templatesErr.message }, { status: 500 });
  }

  const templateIdByScenario = new Map<string, string>();
  const offScenarios = new Set<string>();
  for (const t of (templates ?? []) as Array<{
    id: string;
    scenario_id: string;
    is_active: boolean;
  }>) {
    if (t.is_active) templateIdByScenario.set(t.scenario_id, t.id);
    else offScenarios.add(t.scenario_id);
  }

  // The pool's tasks of every message this cron sends, in any status, and
  // their finished lessons, 100 ids at a time as the milestones, each in
  // pages past PostgREST's 1000-row cap. A failed read stops the run before
  // anything is written: read as "no tasks", a message already sent would go
  // again; read as "no lessons", a student watching on Whop would get the
  // stalled DM again.
  //
  // A finished lesson counts as the nolessons.* rules count one
  // (buildStudentSnapshot's watchedComplete, read by their "0 lessons"):
  // completed_at or skipped_at set. The snapshot also looks the lesson and
  // its area up in the live course; the database's foreign keys (v104:
  // completions to lessons, lessons to regions) make every row's lesson and
  // area part of it, so those lookups always find them. Each row is one
  // lesson (unique student_id, lesson_id).
  const queueScenarios = [
    ...new Set([...allNaIds, WHOP_WATCHER].flatMap(sameMessage)),
  ];
  type PoolTask = QueueTask & { id: string };
  const tasksByStudent = new Map<string, PoolTask[]>();
  const lessonsWatched = new Map<string, number>();
  const poolIds = pool.map((s) => s.id);
  for (let i = 0; i < poolIds.length; i += ID_BATCH) {
    const ids = poolIds.slice(i, i + ID_BATCH);
    const [tasksRes, completionsRes] = await Promise.all([
      fetchAllRowsPaginated<PoolTask>(() =>
        supabase
          .from("tasks")
          .select("id, student_id, scenario_id, status, dismissed_by")
          .in("student_id", ids)
          .in("scenario_id", queueScenarios)
          .order("id"),
      ),
      fetchAllRowsPaginated<{ student_id: string }>(() =>
        supabase
          .from("student_lesson_completions")
          .select("student_id")
          .in("student_id", ids)
          .or("completed_at.not.is.null,skipped_at.not.is.null")
          .order("student_id")
          .order("lesson_id"),
      ),
    ]);
    const readErr = tasksRes.error ?? completionsRes.error;
    if (readErr) {
      console.error("[check-na-tasks] tasks or completions query failed:", readErr);
      await logCronFinish(runId, "failed", { error: readErr.message });
      return NextResponse.json({ error: readErr.message }, { status: 500 });
    }
    for (const t of tasksRes.data) {
      const arr = tasksByStudent.get(t.student_id) ?? [];
      arr.push(t);
      tasksByStudent.set(t.student_id, arr);
    }
    for (const c of completionsRes.data) {
      lessonsWatched.set(c.student_id, (lessonsWatched.get(c.student_id) ?? 0) + 1);
    }
  }
  const had = messagesHad([...tasksByStudent.values()].flat());

  const dayOf = (s: NotActivatedRow) =>
    sprintDayNumber(s.first_paid_at ?? s.joined_at ?? s.created_at);
  const nowMs = Date.now();

  // The Whop watchers whose one note may be due, then whether they applied
  // for the 30% or their stored coupon answer closes it, read for them alone
  // (100 ids at a time). The coupon answer is read as the map reads it
  // (/api/student/data): a row counts only for the membership on file
  // (storedRowApplies), and it closes the 30% when it holds a discount on
  // the next renewal or is the unpaid answer (rowShowsUnpaid). No row, or one
  // that does not apply, closes nothing. A failed read stops the run.
  const watcherTemplateId = templateIdByScenario.get(WHOP_WATCHER) ?? null;
  const watcherMayGet = pool.filter(
    (s) =>
      watcherTemplateId !== null &&
      !s.cancel_scheduled_at &&
      (lessonsWatched.get(s.id) ?? 0) > 0 &&
      dayOf(s) >= 3 &&
      discountWindowOpen(s.first_paid_at, nowMs) &&
      !(tasksByStudent.get(s.id) ?? []).some((t) => t.scenario_id === WHOP_WATCHER) &&
      // The owner, 2026-10-30: a student who already had the day 3 message
      // (any of its 3 templates, sent or dismissed by a team member) gets no
      // note, since that message already told them about the 30%. An open
      // stalled day 3 task does not count here: it is dismissed below, unsent.
      !(tasksByStudent.get(s.id) ?? []).some(
        (t) =>
          sameMessage("nolessons.day3").includes(t.scenario_id) &&
          (t.status === "completed" || (t.status === "dismissed" && t.dismissed_by != null)),
      ),
  );
  const thirtyClosed = new Set<string>();
  for (let i = 0; i < watcherMayGet.length; i += ID_BATCH) {
    const batch = watcherMayGet.slice(i, i + ID_BATCH);
    const ids = batch.map((s) => s.id);
    const [requestsRes, couponsRes] = await Promise.all([
      supabase
        .from("discount_requests")
        .select("student_id")
        .in("student_id", ids)
        .in("status", [...THIRTY_APPLIED_STATUSES]),
      supabase
        .from(MEMBERSHIP_DISCOUNTS_TABLE)
        .select("student_id, whop_membership_id, discounted, promo_code_id, renewal_price")
        .in("student_id", ids),
    ]);
    const readErr = requestsRes.error ?? couponsRes.error;
    if (readErr) {
      console.error("[check-na-tasks] 30% read failed:", readErr);
      await logCronFinish(runId, "failed", { error: readErr.message });
      return NextResponse.json({ error: readErr.message }, { status: 500 });
    }
    for (const r of (requestsRes.data ?? []) as Array<{ student_id: string }>) {
      thirtyClosed.add(r.student_id);
    }
    const membershipOf = new Map(batch.map((s) => [s.id, s.whop_membership_id]));
    for (const row of (couponsRes.data ?? []) as Array<{
      student_id: string;
      whop_membership_id: string | null;
      discounted: boolean;
      promo_code_id: string | null;
      renewal_price: number | string | null;
    }>) {
      if (
        storedRowApplies(row, membershipOf.get(row.student_id)) &&
        (row.discounted === true || rowShowsUnpaid(row))
      ) {
        thirtyClosed.add(row.student_id);
      }
    }
  }
  const watcherNoteDue = new Set(
    watcherMayGet.filter((s) => !thirtyClosed.has(s.id)).map((s) => s.id),
  );

  /** Inserts one open task: true when made, false when an open one already exists (23505), else the error's message. */
  const insertTask = async (row: {
    student_id: string;
    scenario_id: string;
    template_id: string;
    behavior_summary: string;
  }): Promise<boolean | string> => {
    const { error: insertErr } = await supabase.from("tasks").insert({
      ...row,
      status: "open",
    });
    if (!insertErr) {
      had.add(row.student_id, row.scenario_id);
      return true;
    }
    // 23505 = unique violation on the partial open-task index -
    // means we already have an open task of this scenario for this
    // student. Safe to skip.
    if (
      insertErr.code === "23505" ||
      insertErr.message?.includes("duplicate key")
    ) {
      return false;
    }
    return insertErr.message;
  };

  // Every task made, both kinds: a whop.watcher note has no tier or cohort.
  const created: Array<{
    student_id: string;
    scenario_id: string;
    tier: Tier | null;
    cohort: "A" | "B" | null;
  }> = [];
  const errors: string[] = [];
  let watcherNotes = 0;
  let stalledDismissed = 0;

  for (const s of pool) {
    // v85.1 — canceling students get the save-the-sale flow, not an
    // activation nudge. (Pool is already membership_status='active',
    // so cancel_scheduled_at alone means Whop "Canceling".)
    if (s.cancel_scheduled_at) continue;
    // v75.57: tier day comes from the canonical sprintDayNumber on
    // first_paid_at (joined_at/created_at fallback for safety) — the
    // SAME anchor + rounding check-csm-tasks section 3c uses for its
    // stale-dismissal check. Anchoring creation on created_at while
    // dismissal ran on first_paid_at made stalled tasks for backfilled
    // students appear and auto-dismiss within one cron window.
    const rawDays = dayOf(s);

    // A Whop watcher: no stalled DM, their open ones dismissed, and the one
    // note when it is due (above).
    const watched = lessonsWatched.get(s.id) ?? 0;
    if (watched > 0) {
      // A dismissal that fails leaves the stalled task on To do, so no note
      // goes beside it this run: the team would have both to send. The next
      // run tries both again. The update returns the row it dismissed, so a
      // task the team marked sent since the read counts as nothing.
      let stalledLeftOpen = false;
      for (const t of tasksByStudent.get(s.id) ?? []) {
        if (t.status !== "open" || !allNaIds.includes(t.scenario_id)) continue;
        const { data: dismissed, error: dismissErr } = await supabase
          .from("tasks")
          .update({
            status: "dismissed",
            dismissed_at: new Date().toISOString(),
            dismissed_by: null,
            notes:
              "Auto-dismissed: the student has watched lessons on Whop, so no stalled message goes to them.",
          })
          .eq("id", t.id)
          .eq("status", "open")
          .select("id");
        if (dismissErr) {
          errors.push(`${s.id}/${t.scenario_id}: ${dismissErr.message}`);
          stalledLeftOpen = true;
        } else if ((dismissed ?? []).length > 0) {
          stalledDismissed++;
        }
      }
      if (
        !stalledLeftOpen &&
        watcherTemplateId !== null &&
        watcherNoteDue.has(s.id) &&
        !had.has(s.id, WHOP_WATCHER)
      ) {
        const made = await insertTask({
          student_id: s.id,
          scenario_id: WHOP_WATCHER,
          template_id: watcherTemplateId,
          behavior_summary: `Day ${rawDays}. Never signed in to the app, ${watched} ${watched === 1 ? "lesson" : "lessons"} watched on Whop.`,
        });
        if (made === true) {
          watcherNotes++;
          created.push({ student_id: s.id, scenario_id: WHOP_WATCHER, tier: null, cohort: null });
        } else if (made !== false) {
          errors.push(`${s.id}/${WHOP_WATCHER}: ${made}`);
        }
      }
      continue;
    }

    // Terminal-tier catch-up: a student whose first_paid_at fills LATE
    // (sync recovery / backfill) can enter the pool past day 10 and
    // would otherwise skip every tier — never getting the day-10 touch
    // or the high_churn_risk flag. Clamp days 10-13 to tier 10. The
    // window stops at 13 because check-csm-tasks 3c stale-dismisses
    // .day10 tasks once day > 13 (STALE_DAYS=3) — creating one past
    // that would flicker. Day >= 14 entrants get no NA task (open
    // question, see CHANGELOG "not yet done").
    const days = (rawDays >= 10 && rawDays <= 13 ? 10 : rawDays) as
      | Tier
      | number;
    if (!TIER_DAYS.includes(days as Tier)) continue;

    const tier = days as Tier;
    const cohort: "A" | "B" = s.discord_username ? "A" : "B";
    const scenarioId = templateIdFor(cohort, tier);
    const templateId = templateIdByScenario.get(scenarioId);

    if (!templateId) {
      // Switched off on /admin/templates: a quiet skip.
      if (offScenarios.has(scenarioId)) continue;
      errors.push(`${s.id}: template ${scenarioId} not found`);
      continue;
    }
    // A message this student already had (src/lib/dm-queue.ts).
    if (had.has(s.id, scenarioId)) continue;

    // The channel is derivable from scenario_id (NA-A.* = Discord,
    // NA-B.* = Whop) so we don't add a tasks column for it. Encode
    // a hint in the summary instead so it surfaces in the existing
    // task views without a schema change.
    const summary = `Day ${tier} - Cohort ${cohort} (${suggestedChannel(cohort)}). No dashboard login since signup.`;

    const made = await insertTask({
      student_id: s.id,
      scenario_id: scenarioId,
      template_id: templateId,
      behavior_summary: summary,
    });
    if (made === false) continue;
    if (made !== true) {
      errors.push(`${s.id}/${scenarioId}: ${made}`);
      continue;
    }

    created.push({
      student_id: s.id,
      scenario_id: scenarioId,
      tier,
      cohort,
    });

    // Day-10 tier flips high_churn_risk and exits the queue.
    if (tier === 10) {
      const { error: flagErr } = await supabase
        .from("students")
        .update({
          high_churn_risk: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", s.id);
      if (flagErr) {
        errors.push(
          `${s.id}: failed to set high_churn_risk=true: ${flagErr.message}`,
        );
      }
    }
  }

  // Discord summary (best-effort).
  if (created.length > 0) {
    const byTier = new Map<Tier, number>();
    for (const c of created) {
      if (c.tier !== null) byTier.set(c.tier, (byTier.get(c.tier) ?? 0) + 1);
    }
    const summary = [
      ...TIER_DAYS.map((t) =>
        byTier.has(t) ? `Day ${t}: ${byTier.get(t)}` : null,
      ),
      watcherNotes > 0 ? `Watching on Whop: ${watcherNotes}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    // v75.32: gate on the same Discord pause toggle every other cron
    // respects. Before this, flipping the Discord master switch off
    // (then on /admin/discord) silenced check-csm-tasks + check-engagement +
    // day28-dm but check-na-tasks still posted — making the kill
    // switch effectively non-master.
    if (await isDmEnabled(supabase, "csm_task_summary_enabled")) {
      try {
        await postTeamAlert([
          {
            title: "NA tasks created",
            description: `${created.length} NA task${created.length === 1 ? "" : "s"} for Astrid. ${summary}`,
            color: 0x9aa0a6,
          },
        ]);
      } catch (e) {
        console.warn("[check-na-tasks] discord notify failed:", e);
      }
    }
  }

  await logCronFinish(runId, "success", { rowsAffected: created.length });
  return NextResponse.json({
    ok: true,
    pool_size: pool.length,
    created: created.length,
    whop_watcher: watcherNotes,
    stalled_dismissed: stalledDismissed,
    errors: errors.length > 0 ? errors : undefined,
    duration_ms: Date.now() - started,
  });
}
