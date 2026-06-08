/**
 * Real-time CSM task re-evaluation.
 *
 * Run AFTER a student state change (lesson watched, action shipped,
 * skip toggled, milestone reached) to dismiss any open tasks whose
 * trigger condition is no longer met by the student's CURRENT state.
 *
 * Without this, tasks created by the daily/4-hour cron stay open
 * until the NEXT cron run, even if the student has already
 * progressed past the trigger condition. Example Karlo flagged:
 * student gets `nolessons.day3` task at the morning cron run, then
 * watches a bunch of lessons mid-day, but the task lingers in the
 * VA queue until the evening cron.
 *
 * This is the EVENT-DRIVEN companion to the BATCH auto-dismiss in
 * /api/cron/check-csm-tasks (section 3c). Same evaluation logic,
 * scoped to a single student. Cron catches anything missed.
 *
 * The cron stays as the safety net — handles students who didn't
 * trigger a state-change endpoint (e.g. progressed via Whop direct,
 * or aged past a day-tolerance threshold).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildStudentSnapshot,
  evaluateCustomTrigger,
  triggers,
} from "@/lib/csm-triggers";
import type { Student, TriggerConfig } from "@/types/database";

/**
 * Re-evaluate every open task for a single student and dismiss any
 * whose trigger condition is no longer met. Safe to call from API
 * routes; failures are caught and logged so the calling action
 * never breaks because of a task-eval problem.
 */
export async function reEvaluateStudentOpenTasks(
  supabase: SupabaseClient,
  studentId: string,
): Promise<{ checked: number; dismissed: number } | { error: string }> {
  try {
    // 1. Pull the student's open tasks. Early-exit if none.
    const { data: openTasks } = await supabase
      .from("tasks")
      .select("id, scenario_id, template_id")
      .eq("student_id", studentId)
      .eq("status", "open");

    if (!openTasks || openTasks.length === 0) {
      return { checked: 0, dismissed: 0 };
    }

    // 2. Pull just the data we need to build a snapshot for THIS student.
    const [
      studentRes,
      completionsRes,
      lessonsRes,
      milestonesRes,
      templatesRes,
    ] = await Promise.all([
      supabase
        .from("students")
        .select(
          "id, name, joined_at, first_paid_at, membership_status, last_active_at",
        )
        .eq("id", studentId)
        .maybeSingle(),
      supabase
        .from("student_lesson_completions")
        .select("student_id, lesson_id, completed_at, action_completed_at, skipped_at")
        .eq("student_id", studentId),
      supabase.from("lessons").select("id, region_id, requires_action"),
      supabase
        .from("student_milestones")
        .select("first_sprint_login_at")
        .eq("student_id", studentId)
        .maybeSingle(),
      supabase
        .from("templates")
        .select("id, scenario_id, trigger_config")
        .eq("is_active", true),
    ]);

    if (!studentRes.data) {
      return { checked: openTasks.length, dismissed: 0 };
    }

    const student = studentRes.data as unknown as Pick<
      Student,
      | "id"
      | "name"
      | "joined_at"
      | "first_paid_at"
      | "membership_status"
      | "last_active_at"
    >;
    const completions = completionsRes.data ?? [];
    const lessons = (lessonsRes.data ?? []) as Array<{
      id: string;
      region_id: string;
      requires_action: boolean;
    }>;
    const milestones = milestonesRes.data as
      | { first_sprint_login_at: string | null }
      | null;
    const templates = (templatesRes.data ?? []) as Array<{
      id: string;
      scenario_id: string;
      trigger_config: TriggerConfig | null;
    }>;

    // Region totals — count of lessons per region. buildStudentSnapshot
    // uses this for region_completion_pct / R-completion gates.
    const regionTotals: Record<string, number> = {};
    for (const l of lessons) {
      regionTotals[l.region_id] = (regionTotals[l.region_id] ?? 0) + 1;
    }

    // Build the snapshot. Pass an empty `existing` array — we WANT
    // to re-evaluate as if the task didn't exist yet, so the
    // recentTaskScenarios dedup gate inside triggers doesn't block.
    // buildStudentSnapshot only reads the fields above; cast is safe.
    const snap = buildStudentSnapshot(
      student as unknown as Student,
      completions,
      lessons,
      regionTotals,
      [], // existing — leave empty for fresh re-eval
      milestones,
    );

    // Build a scenario → template lookup for trigger_config evaluation.
    const templateByScenario = new Map(
      templates.map((t) => [t.scenario_id, t]),
    );

    // 3. For each open task, decide whether it still applies.
    const STALE_DAYS = 3;
    const toDismiss: { id: string; reason: string }[] = [];

    for (const task of openTasks) {
      let stillMatches: boolean | null = null;

      // Path 1: built-in trigger function.
      const triggerFn = triggers[task.scenario_id];
      if (triggerFn) {
        stillMatches = !!triggerFn(snap);
      }

      // Path 2: trigger_config on template.
      if (stillMatches === null) {
        const tpl = templateByScenario.get(task.scenario_id);
        if (tpl?.trigger_config) {
          stillMatches = evaluateCustomTrigger(snap, tpl.trigger_config).match;
        }
      }

      // Path 3: day-tolerance fallback for *.dayN scenarios.
      if (stillMatches === null) {
        const m = task.scenario_id.match(/\.day(\d+)$/);
        if (m) {
          const scenarioDay = parseInt(m[1], 10);
          if (snap.day > scenarioDay + STALE_DAYS) {
            toDismiss.push({
              id: task.id,
              reason: `${task.scenario_id} stage stale (current day ${snap.day}).`,
            });
          }
        }
        // Not evaluable → leave alone.
        continue;
      }

      if (stillMatches === false) {
        toDismiss.push({
          id: task.id,
          reason: `${task.scenario_id} trigger no longer met.`,
        });
      }
    }

    // 4. Dismiss the ones that flunked.
    for (const { id, reason } of toDismiss) {
      await supabase
        .from("tasks")
        .update({
          status: "dismissed",
          dismissed_at: new Date().toISOString(),
          notes: `Auto-dismissed (real-time): ${reason}`,
        })
        .eq("id", id);
    }

    return { checked: openTasks.length, dismissed: toDismiss.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[reEvaluateStudentOpenTasks] failed:", msg);
    return { error: msg };
  }
}
