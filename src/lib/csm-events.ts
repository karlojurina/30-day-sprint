/**
 * Event-driven CSM scenario triggers — called inline from the
 * endpoints that mutate the relevant state.
 *
 * Three event-driven scenarios live here:
 *   W2.2 — both R2 compound action items shipped (l022 + l024)
 *   W2.6 — discount applied (discount_requests insert)
 *   X.1  — reactivation (lesson completion when student had a recent
 *          cancel-path task open)
 *
 * Everything else is in /api/cron/check-csm-tasks (state-derived) or
 * the Whop webhook (W4.4 churn).
 *
 * All handlers are best-effort: they swallow errors and log them.
 * A failure here never blocks the underlying student action.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

async function getTemplateId(
  supabase: SupabaseClient,
  scenarioId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("templates")
    .select("id")
    .eq("scenario_id", scenarioId)
    .single();
  return (data as { id: string } | null)?.id ?? null;
}

async function insertTask(
  supabase: SupabaseClient,
  studentId: string,
  scenarioId: string,
  behaviorSummary: string,
): Promise<void> {
  const templateId = await getTemplateId(supabase, scenarioId);
  if (!templateId) {
    console.warn(`[csm-events] template ${scenarioId} not found — skipping task`);
    return;
  }
  const { error } = await supabase.from("tasks").insert({
    student_id: studentId,
    scenario_id: scenarioId,
    template_id: templateId,
    status: "open",
    behavior_summary: behaviorSummary,
  });
  if (error && (error as { code?: string }).code !== "23505") {
    console.error(
      `[csm-events] insert ${scenarioId} for ${studentId} failed:`,
      error,
    );
  }
}

const R2_COMPOUND_LESSONS = ["l022", "l024"];

/**
 * W2.2 — fires when BOTH l022 and l024 have action_completed_at set.
 * Called from mark-action-shipped after a successful update.
 *
 * Safe to invoke for any lesson; the function self-filters.
 */
export async function checkR2CompoundsShipped(
  supabase: SupabaseClient,
  studentId: string,
  lessonId: string,
): Promise<void> {
  if (!R2_COMPOUND_LESSONS.includes(lessonId)) return;
  try {
    const { data } = await supabase
      .from("student_lesson_completions")
      .select("lesson_id, action_completed_at")
      .eq("student_id", studentId)
      .in("lesson_id", R2_COMPOUND_LESSONS);
    const shipped = new Set(
      (data ?? [])
        .filter((r) => r.action_completed_at != null)
        .map((r) => r.lesson_id),
    );
    if (shipped.size < R2_COMPOUND_LESSONS.length) return;
    await insertTask(
      supabase,
      studentId,
      "W2.2",
      `Both R2 compounds shipped (l022 VSL + l024 High-Production). 4 ad formats now in portfolio.`,
    );
  } catch (e) {
    console.error("[csm-events.checkR2CompoundsShipped] failed:", e);
  }
}

/**
 * W2.6 — fires the moment a discount_requests row is created with
 * status = 'pending'. Admin-only task (no DM body).
 *
 * Called from /api/discounts/request after a successful insert.
 */
export async function onDiscountRequested(
  supabase: SupabaseClient,
  studentId: string,
): Promise<void> {
  try {
    const { data: s } = await supabase
      .from("students")
      .select("name")
      .eq("id", studentId)
      .single();
    const firstName = (s?.name?.split(/\s+/)[0] ?? "Student").trim();
    await insertTask(
      supabase,
      studentId,
      "W2.6",
      `${firstName} just applied for the 30% off. Verify R1+R2 lesson completion + ad submissions, then approve in the discount queue.`,
    );
  } catch (e) {
    console.error("[csm-events.onDiscountRequested] failed:", e);
  }
}

const REACTIVATION_TRIGGERED_SCENARIOS = ["W1.4", "W2.7", "W3.3", "W4.3"];

/**
 * X.1 — fires when a student completes a lesson AFTER they had an
 * open cancel-path task (W1.4 / W2.7 / W3.3 / W4.3) OR an active
 * disengagement_alerts row (no_lessons_7d / no_login_5d).
 *
 * Side effect: dismisses the prior cancel-path tasks with a note so
 * Astrid sees the trail.
 *
 * Called from toggle-lesson, mark-action-shipped, and watch-sync after
 * a row is inserted/updated in student_lesson_completions.
 */
export async function onLessonCompleted(
  supabase: SupabaseClient,
  studentId: string,
): Promise<void> {
  try {
    // 1. Find open cancel-path tasks for this student.
    const { data: openCancel } = await supabase
      .from("tasks")
      .select("id, scenario_id")
      .eq("student_id", studentId)
      .eq("status", "open")
      .in("scenario_id", REACTIVATION_TRIGGERED_SCENARIOS);

    // 2. Or active disengagement_alerts (no_lessons_7d / no_login_5d).
    let hasActiveAlert = false;
    if (!openCancel || openCancel.length === 0) {
      const { data: alerts } = await supabase
        .from("disengagement_alerts")
        .select("id")
        .eq("student_id", studentId)
        .eq("is_dismissed", false)
        .in("alert_type", ["no_lessons_7d", "no_login_5d"])
        .limit(1);
      hasActiveAlert = (alerts?.length ?? 0) > 0;
    }

    if ((!openCancel || openCancel.length === 0) && !hasActiveAlert) return;

    // 3. Dedupe: skip if there's already an open or recent X.1 task.
    const sinceIso = new Date(Date.now() - 14 * 86_400_000).toISOString();
    const { data: priorX1 } = await supabase
      .from("tasks")
      .select("id")
      .eq("student_id", studentId)
      .eq("scenario_id", "X.1")
      .gte("created_at", sinceIso)
      .limit(1);
    if (priorX1 && priorX1.length > 0) return;

    // 4. Fire X.1.
    await insertTask(
      supabase,
      studentId,
      "X.1",
      `Came back after an inactive stretch. Prior cancel-path tasks: ${
        openCancel?.map((t) => t.scenario_id).join(", ") || "(alert-only)"
      }.`,
    );

    // 5. Auto-dismiss the prior cancel-path tasks with a note.
    if (openCancel && openCancel.length > 0) {
      await supabase
        .from("tasks")
        .update({
          status: "dismissed",
          dismissed_at: new Date().toISOString(),
          notes: "Auto-dismissed — student reactivated (X.1 fired).",
        })
        .in(
          "id",
          openCancel.map((t) => t.id),
        );
    }
  } catch (e) {
    console.error("[csm-events.onLessonCompleted] failed:", e);
  }
}
