/**
 * Daily CSM tasks cron — runs at 09:15 UTC, 15 minutes after the
 * existing engagement cron at 09:00.
 *
 * Two sources of tasks:
 *
 *   1. Existing-alert mapping (P0)
 *      Reads today's open disengagement_alerts and maps them to the 4
 *      cancel-path scenarios:
 *          no_login_5d   + day  ≤ 7         → W1.4
 *          no_login_5d   + day  8–14        → W2.7
 *          no_lessons_7d + day  8–14        → W2.7
 *          no_lessons_7d + day 15–23        → W3.3
 *          no_login_5d   + day 24–30        → W4.3
 *      (W4.4 fires from the Whop membership.deactivated webhook, not here.)
 *
 *   2. State-derived triggers (P1)
 *      Builds a per-student snapshot from bulk-fetched lesson completions
 *      and runs every trigger in src/lib/csm-triggers.ts. Covers W1.1, W1.2,
 *      W1.3, W2.1, W2.3, W2.4, W2.5, W3.1, W3.2, W4.1, W4.2.
 *
 *   3. Event-driven scenarios (P1)
 *      W2.2, W2.6, X.1 fire inline from the lesson-completion / discount /
 *      reactivation hooks — NOT in this cron.
 *
 * Dedupe: insert relies on the partial unique index
 *   idx_tasks_unique_open ON tasks(student_id, scenario_id) WHERE status = 'open'
 * so re-running the cron is a no-op for open tasks. Errors with code
 * 23505 are swallowed.
 *
 * Notify: posts a single summary embed to the team Discord webhook at the end.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { fetchAllRowsPaginated } from "@/lib/supabase-pagination";
import { postTeamAlert } from "@/lib/discord";
import {
  verifyCronAuth,
  cronUnauthorizedResponse,
  logCronStart,
  logCronFinish,
} from "@/lib/cron-auth";
import { isDmEnabled } from "@/lib/dm-toggles";
import {
  buildStudentSnapshot,
  triggers,
  evaluateCustomTrigger,
  snapshotIsCanceling,
  SCENARIO_BUCKET,
} from "@/lib/csm-triggers";
import {
  TASKS_STUDENT_JOIN_CUTOFF,
  csmSprintWindowCutoffIso,
  sprintDayNumber,
} from "@/lib/constants";
import { PAYING_WHOP_PLAN_IDS_ARRAY } from "@/lib/admin/metrics-definitions";
import type { Student, TriggerConfig } from "@/types/database";

// v75.32: raised from Vercel's 60s default. The per-student
// completions fetch + 3 dismissal loops can take 60+s at 2000 members.
export const maxDuration = 300;

/** Plain-English label for each disengagement_alerts.alert_type. */
const ALERT_LABEL: Record<string, string> = {
  no_login_5d: "no platform login in 5 days",
  no_lessons_7d: "no lessons completed in 7 days",
};

interface AlertRow {
  id: string;
  student_id: string;
  alert_type: string;
  message: string;
  created_at: string;
}

// v75.57: local dayNumber() replaced by the shared sprintDayNumber in
// src/lib/constants.ts so creation (check-na-tasks) and dismissal (3c
// below) can never disagree on what "Day N" means.

/**
 * Bucket → priority for the one-open-negative-task-per-student cap.
 * Lower number = fires first / wins the slot. Cancel-path beats
 * at-risk; everything else doesn't go through the slot.
 */
function priorityFor(bucket: string): number {
  if (bucket === "cancel_path") return 1;
  if (bucket === "at_risk") return 2;
  return 99;
}

/**
 * v58 - map disengagement_alerts rows (created by check-engagement)
 * to the closest brief-v3 scenario.
 *
 *   no_lessons_3d  → `nolessons.day{N}` based on the day tier
 *   no_login_5d    → `pace.day{N}` (student hasn't been around)
 *   no_tasks_7d    → `pace.day{N}` (student isn't completing
 *                    things)
 *
 * Day-tier matching is loose: the trigger functions themselves
 * also gate by day, so this just picks the right scenario when
 * the engagement cron noticed a problem on a day-N tier.
 */
function pickExistingAlertScenario(
  alertType: string,
  day: number,
): string | null {
  if (alertType === "no_lessons_3d") {
    if (day <= 5)  return "nolessons.day3";
    if (day <= 10) return "nolessons.day7";
    if (day <= 17) return "nolessons.day14";
    return null;
  }
  if (alertType === "no_tasks_7d" || alertType === "no_login_5d") {
    if (day <= 9)  return "pace.day7";
    if (day <= 17) return "pace.day14";
    if (day <= 24) return "pace.day21";
    return null;
  }
  return null;
}

const ROUTE_NAME = "check-csm-tasks";

export async function GET(request: NextRequest) {
  // v75.37: shared cron auth + audit.
  const auth = verifyCronAuth(request);
  if (!auth.ok) {
    await logCronStart(ROUTE_NAME, auth.reason);
    return cronUnauthorizedResponse(auth.reason);
  }
  const runId = await logCronStart(ROUTE_NAME, "ok");

  const supabase = createServiceClient();

  // ─── Bulk pulls ─────────────────────────────────────────────

  const [
    studentsRes,
    lessonsRes,
    tasksRes,
    templatesRes,
    alertsRes,
    milestonesRes,
  ] = await Promise.all([
    // Limit to actual paying students who joined on/after the
    // tasks cutoff. csm_exempt = test accounts we never DM.
    // v79: also filter by whop_plan_id IN paying plans.
    // v75.15: also filter to students currently in their 30-day
    // sprint window — past day 30 they're graduates / lapsed and
    // pace/stalled tasks no longer make sense (Karlo reported a
    // stalled-task generated for a 5-month-old student).
    supabase
      .from("students")
      .select(
        "id, name, joined_at, first_paid_at, membership_status, last_active_at, discord_username, cancel_scheduled_at",
      )
      .eq("membership_status", "active")
      .eq("csm_exempt", false)
      .in("whop_plan_id", PAYING_WHOP_PLAN_IDS_ARRAY as string[])
      // v75.18: first_paid_at filters — pre-launch legacy customers
      // who recently renewed are excluded (their joined_at is recent
      // but their first_paid_at is months ago).
      .gte("first_paid_at", TASKS_STUDENT_JOIN_CUTOFF)
      .gte("first_paid_at", csmSprintWindowCutoffIso()),
    // v75.25: completions fetch MOVED OUT of Promise.all — see below
    // after the students fetch settles. We now batch by student_id
    // because Supabase's project-level max-rows cap (~1000) silently
    // truncates bulk fetches even with .limit(100000). Empirically
    // verified: the completions table has 8340+ rows but the cron
    // could only see ~1000, so students whose completions fell
    // outside that slice appeared as "0 lessons watched" and got
    // bogus nolessons.day3 tasks they couldn't escape.
    supabase.from("lessons").select("id, region_id, requires_action"),
    // v75.56: tasks + milestones are UNBOUNDED tables (one row per
    // task / per student forever) and a raw .limit(50000) does NOT
    // bypass PostgREST's server-side ~1000-row cap — the limit only
    // lowers the client ask, the server still truncates silently.
    // Truncated tasks lose supersession/dedup context; truncated
    // milestones make students past row 1000 look like they never
    // logged in. fetchAllRowsPaginated pages past the cap.
    fetchAllRowsPaginated<{
      student_id: string;
      scenario_id: string;
      status: string;
    }>(() =>
      supabase
        .from("tasks")
        .select("student_id, scenario_id, status")
        .in("status", ["open", "completed"])
        // Stable order is REQUIRED for .range() pagination — without
        // ORDER BY, Postgres gives no row-order guarantee and rows can
        // be skipped/duplicated across page boundaries under
        // concurrent writes.
        .order("id"),
    ),
    supabase
      .from("templates")
      .select("id, scenario_id, bucket, is_custom, is_active, trigger_config")
      .limit(1000),
    supabase
      .from("disengagement_alerts")
      .select("id, student_id, alert_type, message, created_at")
      .eq("is_dismissed", false)
      .gte(
        "created_at",
        new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      )
      .limit(10000),
    // v46 — first_sprint_login_at lives on student_milestones now,
    // pulled separately and joined per-student before snapshot build.
    // v75.56: paginated (see tasks note above).
    fetchAllRowsPaginated<{
      student_id: string;
      first_sprint_login_at: string | null;
    }>(() =>
      supabase
        .from("student_milestones")
        .select("student_id, first_sprint_login_at")
        // Stable order required for .range() pagination — a skipped
        // milestones row would make that student look never-logged-in
        // and 3c would wrongly dismiss their valid tasks.
        .order("student_id"),
    ),
  ]);

  // v75.56: tasks + milestones errors now short-circuit too. The
  // pagination helper returns EMPTY data on error (v75.32 contract);
  // running on an empty milestones set would make every student look
  // never-logged-in and 3c would mass-dismiss valid tasks for the
  // wrong reason.
  const studentsErr =
    studentsRes.error ??
    lessonsRes.error ??
    templatesRes.error ??
    tasksRes.error ??
    milestonesRes.error;
  if (studentsErr) {
    await logCronFinish(runId, "failed", { error: studentsErr.message });
    return NextResponse.json({ error: studentsErr.message }, { status: 500 });
  }

  const students = (studentsRes.data ?? []) as Student[];
  const lessons = lessonsRes.data ?? [];
  const existingTasks = tasksRes.data ?? [];
  const templates = templatesRes.data ?? [];
  const alerts = (alertsRes.data ?? []) as AlertRow[];

  if (students.length === 0) {
    await logCronFinish(runId, "success", { rowsAffected: 0 });
    return NextResponse.json({ checked: 0, tasks_created: 0 });
  }

  // ─── v75.25: per-student completions fetch ────────────────
  //
  // Supabase has a project-level max-rows cap (~1000) that silently
  // truncates bulk fetches even when the client passes .limit(100000).
  // The completions table has 8000+ rows; a bulk fetch sees the first
  // 1000 only. Students whose rows fall outside that slice show as
  // "0 lessons watched" in the snapshot, the nolessons.day3 trigger
  // fires against them, and the auto-dismiss re-evaluation reaches
  // the same wrong conclusion every run.
  //
  // Fix: scope the fetch to the eligible student pool, and break it
  // into small per-student queries run with concurrency. Each query
  // returns ≤64 rows (TOTAL_LESSONS upper bound), well below any
  // server cap. 20-way parallelism keeps wall-clock under 1s for a
  // ~75-student pool.
  type CompletionRow = {
    student_id: string;
    lesson_id: string;
    completed_at: string | null;
    action_completed_at: string | null;
    skipped_at: string | null;
  };
  const completionsByStudent = new Map<string, CompletionRow[]>();
  const COMPLETION_FETCH_CONCURRENCY = 20;
  for (let i = 0; i < students.length; i += COMPLETION_FETCH_CONCURRENCY) {
    const wave = students.slice(i, i + COMPLETION_FETCH_CONCURRENCY);
    await Promise.all(
      wave.map(async (s) => {
        const { data } = await supabase
          .from("student_lesson_completions")
          .select(
            "student_id, lesson_id, completed_at, action_completed_at, skipped_at",
          )
          .eq("student_id", s.id);
        if (data && data.length > 0) {
          completionsByStudent.set(s.id, data as CompletionRow[]);
        }
      }),
    );
  }

  // ─── Pre-compute lookups ───────────────────────────────────

  const regionTotals: Record<string, number> = { r1: 0, r2: 0, r3: 0, r4: 0 };
  for (const l of lessons) {
    regionTotals[l.region_id] = (regionTotals[l.region_id] ?? 0) + 1;
  }

  type TemplateRow = {
    id: string;
    scenario_id: string;
    bucket: string;
    is_custom: boolean;
    is_active: boolean;
    trigger_config: TriggerConfig | null;
  };
  const templateBy = new Map<string, string>(
    (templates as TemplateRow[]).map((t) => [t.scenario_id, t.id]),
  );
  /** Templates the cron evaluates via trigger_config. Includes
   *  custom templates (always) and built-in templates that have
   *  been given an explicit trigger_config in /admin/templates
   *  (treated as an override of the hardcoded scenario).
   *
   *  A built-in with NO trigger_config (or an empty all[]) still
   *  fires through its hardcoded scenario in step 2a. Once Karlo
   *  configures conditions on a built-in, the hardcoded scenario is
   *  bypassed for that template and the trigger_config becomes the
   *  source of truth — so "edit the conditions" actually does what
   *  the UI suggests. */
  const triggerConfigTemplates = (templates as TemplateRow[]).filter(
    (t) =>
      t.is_active &&
      t.trigger_config != null &&
      t.trigger_config.all.length > 0,
  );
  /** Scenarios whose built-in (hardcoded) trigger should be skipped
   *  because the matching template has an explicit trigger_config
   *  override in place. */
  const overriddenScenarios = new Set<string>(
    triggerConfigTemplates
      .filter((t) => !t.is_custom)
      .map((t) => t.scenario_id),
  );

  // Allow scenarios to fire even if a recently-COMPLETED task exists, but
  // dedupe against OPEN tasks (handled by the partial unique index). The
  // "recentTaskScenarios" set passed into snapshots lets a trigger be more
  // conservative when it doesn't want to spam celebrations (it ignores
  // both open and completed). Build that set per-student inline.
  const existingByStudent = new Map<string, typeof existingTasks>();
  for (const t of existingTasks) {
    const arr = existingByStudent.get(t.student_id) ?? [];
    arr.push(t);
    existingByStudent.set(t.student_id, arr);
  }

  // v46 — milestones rows joined by student_id so the snapshot can
  // include first_sprint_login_at (no longer on students).
  const milestonesByStudent = new Map<
    string,
    { first_sprint_login_at: string | null }
  >();
  for (const m of (milestonesRes.data ?? []) as Array<{
    student_id: string;
    first_sprint_login_at: string | null;
  }>) {
    milestonesByStudent.set(m.student_id, {
      first_sprint_login_at: m.first_sprint_login_at,
    });
  }

  // Build all snapshots up front so the alert mapping can apply the
  // progress gate too (cancel_path alerts only fire if the student is
  // actually behind).
  const snapByStudent = new Map<string, ReturnType<typeof buildStudentSnapshot>>();
  for (const student of students) {
    snapByStudent.set(
      student.id,
      buildStudentSnapshot(
        student,
        completionsByStudent.get(student.id) ?? [],
        lessons,
        regionTotals,
        existingByStudent.get(student.id) ?? [],
        milestonesByStudent.get(student.id) ?? null,
      ),
    );
  }

  // Resolve any scenario_id to a bucket — combines the built-in
  // SCENARIO_BUCKET map with custom templates' bucket column.
  const bucketByScenario = new Map<string, string>(
    Object.entries(SCENARIO_BUCKET),
  );
  for (const t of templates as TemplateRow[]) {
    if (!bucketByScenario.has(t.scenario_id)) {
      bucketByScenario.set(t.scenario_id, t.bucket);
    }
  }

  // ─── 1. Existing-alert → task mapping ─────────────────────

  const toInsert: Array<{
    student_id: string;
    scenario_id: string;
    template_id: string;
    behavior_summary: string;
  }> = [];

  /** Cancel-path alerts only fire if the student is genuinely
   *  behind. Skips when progressRatio >= 0.6 — a Day-7 student who
   *  watched 8 lessons in one weekend is fine even if they haven't
   *  logged in for five days. */
  const CANCEL_PATH_PROGRESS_GATE = 0.6;

  for (const alert of alerts) {
    const student = students.find((s) => s.id === alert.student_id);
    if (!student) continue;
    const snap = snapByStudent.get(student.id);
    // Same login gate the built-in triggers use. A student with an
    // alert but no first_sprint_login_at hasn't opened the app yet -
    // they belong to the NA (stalled.*) pipeline, not nolessons/pace.
    if (snap && !snap.student.first_sprint_login_at) continue;
    // v75.18: day count from first_paid_at (true Day 1), fallback to
    // joined_at for safety during the backfill window.
    const day = sprintDayNumber(student.first_paid_at ?? student.joined_at);
    const scenarioId = pickExistingAlertScenario(alert.alert_type, day);
    if (!scenarioId) continue;
    const templateId = templateBy.get(scenarioId);
    if (!templateId) continue;

    // Progress gate — all four mapped scenarios are cancel_path.
    if (snap && snap.progressRatio >= CANCEL_PATH_PROGRESS_GATE) continue;

    const label = ALERT_LABEL[alert.alert_type] ?? alert.message;
    toInsert.push({
      student_id: student.id,
      scenario_id: scenarioId,
      template_id: templateId,
      behavior_summary: `Day ${day} · ${label} · pace ${snap?.progressRatio.toFixed(2) ?? "?"}.`,
    });
  }

  // ─── 2. State-derived triggers ────────────────────────────

  for (const student of students) {
    const snap = snapByStudent.get(student.id);
    if (!snap) continue;

    // 2a. Built-in scenarios. Skip any scenario whose template has
    //     an explicit trigger_config override - that one gets
    //     evaluated via the trigger_config path in 2b instead.
    //
    // v58: triggers fire in insertion order (welcome -> stalled ->
    // nolessons -> noship -> pace). After a match we add the
    // scenarioId to snap.recentTaskScenarios so SUBSEQUENT triggers
    // can check it for supersession (e.g. pace.day7 skips when
    // noship.r1.day7 just fired on the same student).
    for (const [scenarioId, check] of Object.entries(triggers)) {
      if (overriddenScenarios.has(scenarioId)) continue;
      const result = check(snap);
      if (!result) continue;
      const templateId = templateBy.get(scenarioId);
      if (!templateId) continue;
      toInsert.push({
        student_id: student.id,
        scenario_id: scenarioId,
        template_id: templateId,
        behavior_summary: result,
      });
      snap.recentTaskScenarios.add(scenarioId);
    }

    // 2b. trigger_config-driven evaluations. Includes:
    //   - custom templates (Karlo created them in /admin/templates)
    //   - built-in templates that Karlo gave a trigger_config override
    //     for (treated as a full replacement of the hardcoded check)
    for (const tpl of triggerConfigTemplates) {
      if (snap.recentTaskScenarios.has(tpl.scenario_id)) continue;
      const result = evaluateCustomTrigger(snap, tpl.trigger_config!);
      if (!result.match) continue;
      toInsert.push({
        student_id: student.id,
        scenario_id: tpl.scenario_id,
        template_id: tpl.id,
        behavior_summary: result.summary,
      });
    }
  }

  // ─── 3. Per-student priority cap ──────────────────────────
  //
  // One open negative task per student. cancel_path beats at_risk;
  // celebrations (crushing / event) and admin tasks fire freely.
  // Existing open negative tasks held by the student count against
  // the slot; if a higher-priority new task comes in, the existing
  // one gets dismissed with a note and the new one takes its place.

  // Fetch open tasks with their bucket to know who currently holds
  // each student's negative slot.
  // v75.29: paginated to bypass PostgREST's ~1000-row server cap.
  // This fetch drives bucket-cap supersession, family-level
  // supersession, AND v75.19's auto-dismiss section 3c — every
  // open-task housekeeping decision happens off this list. If a
  // task is silently dropped from the result, its student's
  // supersession state becomes wrong AND auto-dismiss can never
  // reach it (orphans accumulate forever). Currently 54 open tasks
  // = well under cap, but once cumulative open tasks grow past
  // 1000 this would silently corrupt the queue.
  type OpenTaskRow = {
    id: string;
    student_id: string;
    scenario_id: string;
    template_id: string | null;
    template: { bucket: string } | { bucket: string }[] | null;
  };
  const { data: openTasksWithBucket, error: openTasksErr } =
    await fetchAllRowsPaginated<OpenTaskRow>(() =>
      supabase
        .from("tasks")
        .select(
          "id, student_id, scenario_id, template_id, template:templates(bucket)",
        )
        .eq("status", "open"),
    );
  if (openTasksErr) {
    // v75.32: short-circuit. Section 3/3b/3c housekeeping all read
    // from openTasksWithBucket; running them against a partial fetch
    // would corrupt the supersession + auto-dismiss state.
    await logCronFinish(runId, "failed", {
      error: `Open tasks fetch failed: ${openTasksErr.message}`,
    });
    return NextResponse.json(
      { error: `Open tasks fetch failed: ${openTasksErr.message}` },
      { status: 500 },
    );
  }

  type OpenSlot = { id: string; bucket: string };
  const negativeSlot = new Map<string, OpenSlot>();
  for (const t of (openTasksWithBucket ?? []) as unknown as OpenTaskRow[]) {
    const tpl = Array.isArray(t.template) ? t.template[0] : t.template;
    const bucket = tpl?.bucket ?? bucketByScenario.get(t.scenario_id) ?? "";
    if (bucket === "cancel_path" || bucket === "at_risk") {
      // If a student somehow has more than one negative open (shouldn't
      // happen post-cap but safe), keep the higher-priority one in the
      // slot so we don't accidentally let two coexist.
      const existing = negativeSlot.get(t.student_id);
      if (!existing || priorityFor(bucket) < priorityFor(existing.bucket)) {
        negativeSlot.set(t.student_id, { id: t.id, bucket });
      }
    }
  }

  // Sort candidates so highest priority is processed first per student.
  // Within the same priority, keep insertion order.
  toInsert.sort((a, b) => {
    const pa = priorityFor(bucketByScenario.get(a.scenario_id) ?? "");
    const pb = priorityFor(bucketByScenario.get(b.scenario_id) ?? "");
    return pa - pb;
  });

  const finalToInsert: typeof toInsert = [];
  const toDismiss: string[] = [];

  for (const c of toInsert) {
    const bucket = bucketByScenario.get(c.scenario_id) ?? "";
    if (bucket !== "cancel_path" && bucket !== "at_risk") {
      // Celebrations / events / admin always pass.
      finalToInsert.push(c);
      continue;
    }
    const slot = negativeSlot.get(c.student_id);
    if (!slot) {
      finalToInsert.push(c);
      negativeSlot.set(c.student_id, { id: "(pending)", bucket });
      continue;
    }
    if (priorityFor(bucket) < priorityFor(slot.bucket)) {
      // Higher priority — supersede the slot's current task.
      if (slot.id !== "(pending)") toDismiss.push(slot.id);
      finalToInsert.push(c);
      negativeSlot.set(c.student_id, { id: "(pending)", bucket });
    }
    // else: slot taken by equal or higher priority — drop this candidate.
  }

  // Dismiss superseded tasks.
  for (const id of toDismiss) {
    await supabase
      .from("tasks")
      .update({
        status: "dismissed",
        dismissed_at: new Date().toISOString(),
        notes: "Superseded by a higher-priority CSM task.",
      })
      .eq("id", id);
  }

  // ─── 3b. Family-level supersession (v75.17) ──────────────
  // When a later-stage task fires (e.g. stalled.discord.day5) while
  // an earlier-stage task in the SAME family is still open
  // (stalled.discord.day3), dismiss the earlier one and let the later
  // one take its place. Prevents the CSM queue from accumulating
  // multiple open tasks per student per family.
  //
  // Family = scenario_id with the trailing .dayN suffix stripped.
  // Scenarios without a .dayN suffix (e.g. month2.entry, welcome.day1
  // doesn't have a stage progression) are no-ops here.
  //
  // Only OPEN tasks get dismissed. If the earlier-stage task was
  // already completed (CSM sent the message), it stays as an audit
  // trail and the later stage fires fresh — which is the correct
  // escalation behavior.

  const familyOf = (s: string): string | null => {
    const m = s.match(/^(.+)\.day\d+$/);
    return m ? m[1] : null;
  };

  // Index every existing open task by (student_id, family).
  const openByFamilyKey = new Map<string, OpenTaskRow[]>();
  for (const t of (openTasksWithBucket ?? []) as unknown as OpenTaskRow[]) {
    const family = familyOf(t.scenario_id);
    if (!family) continue;
    const key = `${t.student_id}|${family}`;
    const arr = openByFamilyKey.get(key) ?? [];
    arr.push(t);
    openByFamilyKey.set(key, arr);
  }

  // For each task we're about to insert, find any open tasks in the
  // same family for the same student and queue them for dismissal.
  const familySupersedeNotes = new Map<string, string>();
  for (const row of finalToInsert) {
    const family = familyOf(row.scenario_id);
    if (!family) continue;
    const existing = openByFamilyKey.get(`${row.student_id}|${family}`) ?? [];
    for (const t of existing) {
      // Skip the exact same scenario (the unique-index handles that).
      if (t.scenario_id === row.scenario_id) continue;
      // Don't dismiss something we already dismissed in section 3.
      if (toDismiss.includes(t.id)) continue;
      // Don't queue twice if multiple new family-tasks supersede this
      // same existing one (shouldn't happen but defensive).
      if (familySupersedeNotes.has(t.id)) continue;
      familySupersedeNotes.set(
        t.id,
        `Superseded by ${row.scenario_id} (later stage in same family).`,
      );
    }
  }

  for (const [id, note] of familySupersedeNotes) {
    await supabase
      .from("tasks")
      .update({
        status: "dismissed",
        dismissed_at: new Date().toISOString(),
        notes: note,
      })
      .eq("id", id);
  }

  // ─── 3c. Auto-dismiss orphan tasks (v75.19) ───────────────
  //
  // For each remaining open task, re-evaluate whether its trigger
  // condition still applies to the student's CURRENT state. If not,
  // dismiss with a clear note.
  //
  // Catches:
  //   * Day-N tasks that lingered when student moved past the stage
  //     and no later-stage task fired (e.g. day-3 stalled task still
  //     open when student is on day 11)
  //   * Tasks whose underlying condition stopped applying (e.g.
  //     stalled task on a student who has since watched many lessons)
  //   * Tasks for students no longer in the eligible pool (out of
  //     cohort, past day 30, on free plan, etc.)
  //
  // Three evaluation paths, in order:
  //   1. Built-in trigger function in `triggers` map → re-run with
  //      a clean recentTaskScenarios set (so the dedup gate inside
  //      the trigger doesn't false-skip itself)
  //   2. Custom trigger_config on template → evaluateCustomTrigger
  //   3. Day-tolerance fallback for *.dayN scenarios (catches
  //      stalled.*.dayN which is alert-based, not in triggers map):
  //      if current day > scenario_day + STALE_DAYS, dismiss.

  const STALE_DAYS = 3;
  const studentById = new Map(students.map((s) => [s.id, s]));
  const templateByScenario = new Map(templates.map((t) => [t.scenario_id, t]));
  const autoDismissals = new Map<string, string>();

  for (const t of (openTasksWithBucket ?? []) as unknown as OpenTaskRow[]) {
    // Skip anything already queued for dismissal by sections 3 or 3b.
    if (toDismiss.includes(t.id)) continue;
    if (familySupersedeNotes.has(t.id)) continue;

    const student = studentById.get(t.student_id);
    if (!student) {
      autoDismissals.set(
        t.id,
        "Auto-dismissed: student no longer in eligible pool.",
      );
      continue;
    }

    const snap = snapByStudent.get(student.id);
    if (!snap) continue;

    // v85.1 — canceling students are owned by the save-the-sale flow.
    // Any open task whose template isn't canceling-aware (no
    // is_canceling condition in trigger_config) gets dismissed
    // outright. Paths 1/2 below already return false for these via
    // the csm-triggers suppression, but stalled.*.dayN tasks have no
    // trigger function or config — path 3's day tolerance would keep
    // them up to 3 extra days, telling the CSM to send an activation
    // nudge to someone who already clicked cancel.
    if (snapshotIsCanceling(snap)) {
      const cancelingTpl = templateByScenario.get(t.scenario_id);
      const cancelingAware = Boolean(
        cancelingTpl?.trigger_config?.all?.some(
          (c: { metric?: string }) => c.metric === "is_canceling",
        ),
      );
      if (!cancelingAware) {
        autoDismissals.set(
          t.id,
          "Auto-dismissed: student is canceling, save-the-sale flow owns this student.",
        );
        continue;
      }
    }

    // Re-evaluate with a fresh recentTaskScenarios so a trigger's
    // dedup gate doesn't incorrectly skip itself when checking the
    // CURRENT state of the world.
    const cleanSnap = {
      ...snap,
      recentTaskScenarios: new Set<string>(),
    };

    let stillMatches: boolean | null = null;

    // Path 1: built-in trigger function.
    const triggerFn = triggers[t.scenario_id];
    if (triggerFn) {
      stillMatches = !!triggerFn(cleanSnap);
    }

    // Path 2: custom trigger_config on template.
    if (stillMatches === null) {
      const tpl = templateByScenario.get(t.scenario_id);
      if (tpl?.trigger_config) {
        stillMatches = evaluateCustomTrigger(
          cleanSnap,
          tpl.trigger_config,
        ).match;
      }
    }

    // Path 3: day-tolerance fallback for *.dayN scenarios.
    if (stillMatches === null) {
      const m = t.scenario_id.match(/\.day(\d+)$/);
      if (m) {
        const scenarioDay = parseInt(m[1], 10);
        // v75.57: same sprintDayNumber the NA cron now uses to CREATE
        // stalled.*.dayN tasks — creation and stale-dismissal can no
        // longer disagree about the student's day.
        const currentDay = sprintDayNumber(
          student.first_paid_at ?? student.joined_at,
        );
        if (currentDay > scenarioDay + STALE_DAYS) {
          autoDismissals.set(
            t.id,
            `Auto-dismissed: ${t.scenario_id} stage stale (current day ${currentDay}).`,
          );
          continue;
        }
      }
      // Anything else (manual welcome.day1, etc.) we don't auto-dismiss.
      continue;
    }

    if (stillMatches === false) {
      autoDismissals.set(
        t.id,
        `Auto-dismissed: ${t.scenario_id} trigger condition no longer met.`,
      );
    }
  }

  for (const [id, note] of autoDismissals) {
    await supabase
      .from("tasks")
      .update({
        status: "dismissed",
        dismissed_at: new Date().toISOString(),
        notes: note,
      })
      .eq("id", id);
  }

  // ─── 4. Insert (idempotent via partial unique index) ──────

  let createdCount = 0;
  const perBucket: Record<string, number> = {};

  for (const row of finalToInsert) {
    const { error } = await supabase.from("tasks").insert({
      ...row,
      status: "open",
    });
    if (error) {
      // 23505 = unique_violation; open task already exists for this
      // (student, scenario) — silent skip.
      if ((error as { code?: string }).code !== "23505") {
        console.error(
          `[csm-tasks-cron] insert failed for ${row.student_id} ${row.scenario_id}:`,
          error,
        );
      }
      continue;
    }
    createdCount++;
    const bucket = bucketByScenario.get(row.scenario_id) ?? "event";
    perBucket[bucket] = (perBucket[bucket] ?? 0) + 1;
  }

  // ─── 4. Team Discord summary ──────────────────────────────
  // Task generation above always runs (writes to DB only). Only the
  // public summary post is gated — controlled from /admin/discord.

  let discordPosted: boolean | null = null;
  if (createdCount > 0) {
    if (await isDmEnabled(supabase, "csm_task_summary_enabled")) {
      const baseUrl =
        process.env.NEXT_PUBLIC_APP_URL ??
        "https://30-day-sprint-smkv.vercel.app";
      const lines = Object.entries(perBucket)
        .sort()
        .map(([bucket, count]) => `• ${count} ${bucket.replace("_", " ")}`);
      const result = await postTeamAlert([
        {
          title: "📋 Astrid Task Queue update",
          description:
            `**${createdCount}** new task${createdCount === 1 ? "" : "s"} today:\n` +
            `${lines.join("\n")}\n\n→ ${baseUrl}/admin/tasks`,
        },
      ]);
      discordPosted = result.ok;
    } else {
      discordPosted = false;
    }
  }

  await logCronFinish(runId, "success", { rowsAffected: createdCount });
  return NextResponse.json({
    checked: students.length,
    candidates: toInsert.length,
    tasks_created: createdCount,
    // v75.25: surface auto-dismiss counts so a manual cron run shows
    // whether section 3 (bucket-cap), 3b (family-supersede), and
    // 3c (auto-dismiss orphans) actually fired and how many tasks
    // each path swept.
    bucket_dismissed: toDismiss.length,
    family_dismissed: familySupersedeNotes.size,
    auto_dismissed: autoDismissals.size,
    by_bucket: perBucket,
    discord_posted: discordPosted,
  });
}
