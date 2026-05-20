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
import { postTeamAlert } from "@/lib/discord";
import { isDmEnabled } from "@/lib/dm-toggles";
import {
  buildStudentSnapshot,
  triggers,
  evaluateCustomTrigger,
  SCENARIO_BUCKET,
} from "@/lib/csm-triggers";
import { TASKS_STUDENT_JOIN_CUTOFF } from "@/lib/constants";
import type { Student, TriggerConfig } from "@/types/database";

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

function dayNumber(joinedAt: string): number {
  return Math.max(
    1,
    Math.ceil((Date.now() - new Date(joinedAt).getTime()) / 86_400_000),
  );
}

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

function pickExistingAlertScenario(
  alertType: string,
  day: number,
): string | null {
  if (alertType === "no_login_5d") {
    if (day <= 7) return "W1.4";
    if (day <= 14) return "W2.7";
    if (day <= 23) return null;
    if (day <= 30) return "W4.3";
    return null;
  }
  if (alertType === "no_lessons_7d") {
    if (day >= 8 && day <= 14) return "W2.7";
    if (day >= 15 && day <= 23) return "W3.3";
    return null;
  }
  return null;
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  // ─── Bulk pulls ─────────────────────────────────────────────

  const [
    studentsRes,
    completionsRes,
    lessonsRes,
    tasksRes,
    templatesRes,
    alertsRes,
    milestonesRes,
  ] = await Promise.all([
    // Limit to actual paying students who joined on/after the
    // tasks cutoff. csm_exempt = test accounts we never DM.
    supabase
      .from("students")
      .select(
        "id, name, joined_at, membership_status, last_active_at, discord_username",
      )
      .eq("membership_status", "active")
      .eq("csm_exempt", false)
      .gte("joined_at", TASKS_STUDENT_JOIN_CUTOFF),
    supabase
      .from("student_lesson_completions")
      .select("student_id, lesson_id, completed_at, action_completed_at"),
    supabase.from("lessons").select("id, region_id, requires_action"),
    supabase
      .from("tasks")
      .select("student_id, scenario_id, status")
      .in("status", ["open", "completed"]),
    supabase
      .from("templates")
      .select("id, scenario_id, bucket, is_custom, is_active, trigger_config"),
    supabase
      .from("disengagement_alerts")
      .select("id, student_id, alert_type, message, created_at")
      .eq("is_dismissed", false)
      .gte(
        "created_at",
        new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      ),
    // v46 — first_sprint_login_at lives on student_milestones now,
    // pulled separately and joined per-student before snapshot build.
    supabase
      .from("student_milestones")
      .select("student_id, first_sprint_login_at"),
  ]);

  const studentsErr = studentsRes.error ?? lessonsRes.error ?? templatesRes.error;
  if (studentsErr) {
    return NextResponse.json({ error: studentsErr.message }, { status: 500 });
  }

  const students = (studentsRes.data ?? []) as Student[];
  const completions = completionsRes.data ?? [];
  const lessons = lessonsRes.data ?? [];
  const existingTasks = tasksRes.data ?? [];
  const templates = templatesRes.data ?? [];
  const alerts = (alertsRes.data ?? []) as AlertRow[];

  if (students.length === 0) {
    return NextResponse.json({ checked: 0, tasks_created: 0 });
  }

  // ─── Pre-compute lookups ───────────────────────────────────

  const regionTotals: Record<string, number> = { r1: 0, r2: 0, r3: 0, r4: 0 };
  for (const l of lessons) {
    regionTotals[l.region_id] = (regionTotals[l.region_id] ?? 0) + 1;
  }

  const completionsByStudent = new Map<string, typeof completions>();
  for (const c of completions) {
    const arr = completionsByStudent.get(c.student_id) ?? [];
    arr.push(c);
    completionsByStudent.set(c.student_id, arr);
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
    const day = dayNumber(student.joined_at);
    const scenarioId = pickExistingAlertScenario(alert.alert_type, day);
    if (!scenarioId) continue;
    const templateId = templateBy.get(scenarioId);
    if (!templateId) continue;

    // Progress gate — all four mapped scenarios are cancel_path.
    const snap = snapByStudent.get(student.id);
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

    // 2a. Built-in scenarios (W1.1, W1.2, …). Skip any scenario whose
    //     template has an explicit trigger_config override — that one
    //     gets evaluated via the trigger_config path in 2b instead.
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
  const { data: openTasksWithBucket } = await supabase
    .from("tasks")
    .select("id, student_id, scenario_id, template:templates(bucket)")
    .eq("status", "open");

  type OpenSlot = { id: string; bucket: string };
  const negativeSlot = new Map<string, OpenSlot>();
  // Supabase's relational select can return the joined row as either a
  // single object or an array, depending on inferred shape — normalize.
  type OpenTaskRow = {
    id: string;
    student_id: string;
    scenario_id: string;
    template: { bucket: string } | { bucket: string }[] | null;
  };
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

  return NextResponse.json({
    checked: students.length,
    candidates: toInsert.length,
    tasks_created: createdCount,
    by_bucket: perBucket,
    discord_posted: discordPosted,
  });
}
