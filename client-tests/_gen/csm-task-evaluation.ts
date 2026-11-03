
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildStudentSnapshot,
  evaluateCustomTrigger,
  triggers,
} from "./csm-triggers.ts";
import { getCurriculumResetAt } from "./curriculum-reset.ts";
import { STOPPED_AFTER, STOPPED_WATCHING } from "./dm-queue.ts";
import { lastLessonAt } from "./dm-moments.ts";
import type { Student, TriggerConfig } from "./types-erased.ts";

export async function reEvaluateStudentOpenTasks(
  supabase: SupabaseClient,
  studentId: string,
): Promise<{ checked: number; dismissed: number } | { error: string }> {
  try {
    const { data: openTasks } = await supabase
      .from("tasks")
      .select("id, scenario_id, template_id, created_at")
      .eq("student_id", studentId)
      .eq("status", "open");

    if (!openTasks || openTasks.length === 0) {
      return { checked: 0, dismissed: 0 };
    }

    const [
      studentRes,
      completionsRes,
      lessonsRes,
      milestonesRes,
      templatesRes,
      regionsRes,
      resetAt,
    ] = await Promise.all([
      supabase
        .from("students")
        .select(
          "id, name, joined_at, first_paid_at, membership_status, last_active_at, cancel_scheduled_at",
        )
        .eq("id", studentId)
        .maybeSingle(),
      supabase
        .from("student_lesson_completions")
        .select("student_id, lesson_id, completed_at, action_completed_at, skipped_at")
        .eq("student_id", studentId),
      supabase
        .from("lessons")
        .select("id, region_id, requires_action, counts_toward_progress"),
      supabase
        .from("student_milestones")
        .select("first_sprint_login_at")
        .eq("student_id", studentId)
        .maybeSingle(),
      supabase
        .from("templates")
        .select("id, scenario_id, trigger_config")
        .eq("is_active", true),
      supabase.from("regions").select("id, order_num").order("order_num"),
      getCurriculumResetAt(supabase),
    ]);

    if (!studentRes.data) {
      return { checked: openTasks.length, dismissed: 0 };
    }

    const regionOrder = ((regionsRes.data ?? []) as Array<{ id: string }>).map(
      (r) => r.id,
    );
    if (regionsRes.error || regionOrder.length === 0) {
      const msg = `regions could not be read: ${regionsRes.error?.message ?? "no rows"}`;
      console.error("[reEvaluateStudentOpenTasks] failed:", msg);
      return { error: msg };
    }

    const student = studentRes.data as unknown as Pick<
      Student,
      | "id"
      | "name"
      | "joined_at"
      | "first_paid_at"
      | "membership_status"
      | "last_active_at"
      | "cancel_scheduled_at"
    >;
    const completions = completionsRes.data ?? [];
    const lessons = (lessonsRes.data ?? []) as Array<{
      id: string;
      region_id: string;
      requires_action: boolean;
      counts_toward_progress: boolean;
    }>;
    const milestones = milestonesRes.data as
      | { first_sprint_login_at: string | null }
      | null;
    const templates = (templatesRes.data ?? []) as Array<{
      id: string;
      scenario_id: string;
      trigger_config: TriggerConfig | null;
    }>;

    const regionTotals: Record<string, number> = {};
    for (const l of lessons) {
      regionTotals[l.region_id] = (regionTotals[l.region_id] ?? 0) + 1;
    }

    const snap = buildStudentSnapshot(
      student as unknown as Student,
      completions,
      lessons,
      regionTotals,
      [], // existing — leave empty for fresh re-eval
      milestones,
      { regionOrder, resetAt },
    );

    const templateByScenario = new Map(
      templates.map((t) => [t.scenario_id, t]),
    );

    const STALE_DAYS = 3;
    const toDismiss: { id: string; reason: string }[] = [];

    for (const task of openTasks) {
      let stillMatches: boolean | null = null;

      const triggerFn = triggers[task.scenario_id];
      if (triggerFn) {
        stillMatches = !!triggerFn(snap);
      }

      if (stillMatches === null) {
        const tpl = templateByScenario.get(task.scenario_id);
        if (tpl?.trigger_config) {
          stillMatches = evaluateCustomTrigger(snap, tpl.trigger_config).match;
        }
      }

      if (stillMatches === null && (STOPPED_WATCHING.includes(task.scenario_id) || STOPPED_AFTER.includes(task.scenario_id))) {
        const last = Date.parse(lastLessonAt(snap) ?? "");
        if (Number.isFinite(last) && last > Date.parse(task.created_at)) {
          toDismiss.push({
            id: task.id,
            reason: `${task.scenario_id}, the student finished a lesson since.`,
          });
        }
        continue;
      }

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
        continue;
      }

      if (stillMatches === false) {
        toDismiss.push({
          id: task.id,
          reason: `${task.scenario_id} trigger no longer met.`,
        });
      }
    }

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
