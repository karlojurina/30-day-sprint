
import { NextRequest, NextResponse } from "./stub-cron.ts";
import { createServiceClient } from "./supabase-server.ts";
import { postTeamAlert } from "./discord.ts";
import { isDmEnabled } from "./dm-toggles.ts";
import { PAYING_WHOP_PLAN_IDS_ARRAY } from "./metrics-definitions.ts";
import { csmSprintWindowCutoffIso, sprintDayNumber } from "./constants.ts";
import { fetchAllRowsPaginated } from "./supabase-pagination.ts";
import { discountWindowOpen } from "./discount.ts";
import {
  MEMBERSHIP_DISCOUNTS_TABLE,
  rowShowsUnpaid,
  storedRowApplies,
} from "./membership-discount.ts";
import {
  THIRTY_APPLIED_STATUSES,
  WHOP_WATCHER,
  messagesHad,
  sameMessage,
  type QueueTask,
} from "./dm-queue.ts";
import {
  verifyCronAuth,
  cronUnauthorizedResponse,
  logCronStart,
  logCronFinish,
} from "./cron-auth.ts";

export const maxDuration = 300;

const ROUTE_NAME = "check-na-tasks";

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
  const channel = cohort === "A" ? "discord" : "whop";
  return `stalled.${channel}.day${tier}`;
}

function suggestedChannel(cohort: "A" | "B"): string {
  return cohort === "A" ? "Discord DM" : "Whop DM";
}

export async function GET(request: NextRequest) {
  const auth = verifyCronAuth(request);
  if (!auth.ok) {
    await logCronStart(ROUTE_NAME, auth.reason);
    return cronUnauthorizedResponse(auth.reason);
  }
  const runId = await logCronStart(ROUTE_NAME, "ok");

  const supabase = createServiceClient();
  const started = Date.now();

  const { data: studentsRaw, error: studentsErr } = await supabase
    .from("students")
    .select(
      "id, name, email, discord_username, created_at, first_paid_at, joined_at, high_churn_risk, cancel_scheduled_at, whop_membership_id",
    )
    .eq("membership_status", "active")
    .eq("high_churn_risk", false)
    .eq("csm_exempt", false)
    .in("whop_plan_id", PAYING_WHOP_PLAN_IDS_ARRAY as string[])
    .gte("first_paid_at", csmSprintWindowCutoffIso());

  if (studentsErr) {
    console.error("[check-na-tasks] students query failed:", studentsErr);
    await logCronFinish(runId, "failed", { error: studentsErr.message });
    return NextResponse.json(
      { error: studentsErr.message },
      { status: 500 },
    );
  }

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

  const watcherTemplateId = templateIdByScenario.get(WHOP_WATCHER) ?? null;
  const watcherMayGet = pool.filter(
    (s) =>
      watcherTemplateId !== null &&
      !s.cancel_scheduled_at &&
      (lessonsWatched.get(s.id) ?? 0) > 0 &&
      dayOf(s) >= 3 &&
      discountWindowOpen(s.first_paid_at, nowMs) &&
      !(tasksByStudent.get(s.id) ?? []).some((t) => t.scenario_id === WHOP_WATCHER),
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
    if (
      insertErr.code === "23505" ||
      insertErr.message?.includes("duplicate key")
    ) {
      return false;
    }
    return insertErr.message;
  };

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
    if (s.cancel_scheduled_at) continue;
    const rawDays = dayOf(s);

    const watched = lessonsWatched.get(s.id) ?? 0;
    if (watched > 0) {
      for (const t of tasksByStudent.get(s.id) ?? []) {
        if (t.status !== "open" || !allNaIds.includes(t.scenario_id)) continue;
        const { error: dismissErr } = await supabase
          .from("tasks")
          .update({
            status: "dismissed",
            dismissed_at: new Date().toISOString(),
            dismissed_by: null,
            notes:
              "Auto-dismissed: the student has watched lessons on Whop, so no stalled message goes to them.",
          })
          .eq("id", t.id)
          .eq("status", "open");
        if (dismissErr) errors.push(`${s.id}/${t.scenario_id}: ${dismissErr.message}`);
        else stalledDismissed++;
      }
      if (
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

    const days = (rawDays >= 10 && rawDays <= 13 ? 10 : rawDays) as
      | Tier
      | number;
    if (!TIER_DAYS.includes(days as Tier)) continue;

    const tier = days as Tier;
    const cohort: "A" | "B" = s.discord_username ? "A" : "B";
    const scenarioId = templateIdFor(cohort, tier);
    const templateId = templateIdByScenario.get(scenarioId);

    if (!templateId) {
      if (offScenarios.has(scenarioId)) continue;
      errors.push(`${s.id}: template ${scenarioId} not found`);
      continue;
    }
    if (had.has(s.id, scenarioId)) continue;

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
