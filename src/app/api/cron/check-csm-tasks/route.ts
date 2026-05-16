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
import {
  buildStudentSnapshot,
  triggers,
  evaluateCustomTrigger,
  SCENARIO_BUCKET,
} from "@/lib/csm-triggers";
import type { Student, TriggerConfig } from "@/types/database";

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
  ] = await Promise.all([
    supabase
      .from("students")
      .select(
        "id, name, joined_at, membership_status, last_active_at, discord_username",
      )
      .eq("membership_status", "active"),
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
  /** Custom templates the cron should evaluate. */
  const customTemplates = (templates as TemplateRow[]).filter(
    (t) => t.is_custom && t.is_active && t.trigger_config != null,
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

  // ─── 1. Existing-alert → task mapping ─────────────────────

  const toInsert: Array<{
    student_id: string;
    scenario_id: string;
    template_id: string;
    behavior_summary: string;
  }> = [];
  const studentNamesById = new Map<string, string>();
  for (const s of students) {
    studentNamesById.set(s.id, s.name ?? "Student");
  }

  for (const alert of alerts) {
    const student = students.find((s) => s.id === alert.student_id);
    if (!student) continue;
    const day = dayNumber(student.joined_at);
    const scenarioId = pickExistingAlertScenario(alert.alert_type, day);
    if (!scenarioId) continue;
    const templateId = templateBy.get(scenarioId);
    if (!templateId) continue;
    toInsert.push({
      student_id: student.id,
      scenario_id: scenarioId,
      template_id: templateId,
      behavior_summary: `Day ${day} · alert "${alert.alert_type}" · ${alert.message}`,
    });
  }

  // ─── 2. State-derived triggers ────────────────────────────

  for (const student of students) {
    const snap = buildStudentSnapshot(
      student,
      completionsByStudent.get(student.id) ?? [],
      lessons,
      regionTotals,
      existingByStudent.get(student.id) ?? [],
    );

    // 2a. Built-in scenarios (W1.1, W1.2, …).
    for (const [scenarioId, check] of Object.entries(triggers)) {
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

    // 2b. Custom triggers created via /admin/templates (v34).
    //     Same dedupe logic — skip if a task for this scenario already
    //     exists for the student (open or completed).
    for (const tpl of customTemplates) {
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

  // ─── 3. Insert (idempotent via partial unique index) ──────

  let createdCount = 0;
  const perBucket: Record<string, number> = {};

  for (const row of toInsert) {
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
    const bucket = SCENARIO_BUCKET[row.scenario_id] ?? "event";
    perBucket[bucket] = (perBucket[bucket] ?? 0) + 1;
  }

  // ─── 4. Team Discord summary ──────────────────────────────

  let discordPosted: boolean | null = null;
  if (createdCount > 0) {
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
  }

  return NextResponse.json({
    checked: students.length,
    candidates: toInsert.length,
    tasks_created: createdCount,
    by_bucket: perBucket,
    discord_posted: discordPosted,
  });
}
