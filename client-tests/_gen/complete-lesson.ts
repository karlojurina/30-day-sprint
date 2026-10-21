import type { SupabaseClient } from "@supabase/supabase-js";
import { updateStudentStreak } from "./stub-server.ts";
import { onLessonCompleted } from "./stub-server.ts";
import { evaluateAchievements } from "./stub-server.ts";
import { reEvaluateStudentOpenTasks } from "./stub-server.ts";

/**
 * Everything that has to happen after a lesson completion row is written.
 *
 * THIS IS THE FOUR-CALL CHAIN, and the order is load-bearing. It is copied
 * verbatim from toggle-lesson/route.ts:70-86, which is the one write path that
 * has always run all four.
 *
 * The chain existed only inside that route, and the result is an asymmetry
 * that is a live bug today: `watch-sync` ran ONLY the CSM hook, and
 * `skip-lesson` runs NONE of it — so a student who skips their tenth lesson
 * does not get the badge until some unrelated action re-evaluates them.
 *
 * Pulling it into one function is the precondition for fixing that. The live
 * routes are NOT retrofitted in this commit: doing so would retroactively
 * award achievements to students who skipped lessons, which is a
 * student-visible change to 845 people and deserves its own verification
 * rather than riding along with the video work.
 *
 * Every step is best-effort by design — a CSM or achievement failure must
 * never un-complete a lesson the student actually finished. That is why each
 * is awaited but none can throw past this function.
 */
export async function afterCompletionWrite(
  supabase: SupabaseClient,
  studentId: string,
): Promise<{ newAchievements: string[] }> {
  let newAchievements: string[] = [];
  try {
    await updateStudentStreak(supabase, studentId);
  } catch (e) {
    console.error("[complete-lesson] streak failed", e);
  }
  try {
    // X.1 reactivation check.
    await onLessonCompleted(supabase, studentId);
  } catch (e) {
    console.error("[complete-lesson] csm reactivation failed", e);
  }
  try {
    newAchievements = await evaluateAchievements(supabase, studentId);
  } catch (e) {
    console.error("[complete-lesson] achievements failed", e);
  }
  try {
    // Watching a lesson invalidates nolessons.*/pace.* tasks; dismiss them in
    // the same request so the CSM queue never shows a stale item.
    await reEvaluateStudentOpenTasks(supabase, studentId);
  } catch (e) {
    console.error("[complete-lesson] task re-evaluation failed", e);
  }
  return { newAchievements };
}

/**
 * v112: say that these rows' completed_at is the moment the lessons were
 * really finished (student_lesson_completions.completed_at_real), so Triple
 * Threat counts them on that day (src/lib/achievement-rules.ts). Called by
 * the writers that stamp a real moment: the lesson page's player
 * (stampWatchCompletion below) and Whop's event (the webhook). The Whop
 * catch-up says the same for the rows it gives Whop's own time. A login or
 * visit sync, which stamps its own time, never says it.
 *
 * Its own write, after the row's, and best-effort: the lesson is finished
 * whether or not this lands, and a failure is logged. A database without the
 * column (before v112 is pasted) refuses it, and those lessons then count
 * toward no day.
 */
export async function markCompletedAtReal(
  supabase: SupabaseClient,
  studentId: string,
  lessonIds: readonly string[],
): Promise<void> {
  if (lessonIds.length === 0) return;
  try {
    const { error } = await supabase
      .from("student_lesson_completions")
      .update({ completed_at_real: true })
      .eq("student_id", studentId)
      .in("lesson_id", [...lessonIds]);
    if (error) {
      console.error(
        `[complete-lesson] completed_at_real not written for student=${studentId}: ${error.message}`,
      );
    }
  } catch (e) {
    console.error("[complete-lesson] completed_at_real not written", e);
  }
}

/**
 * Stamp the WATCH half of a lesson as complete, idempotently.
 *
 * Three cases, and the third is the one a naive insert gets wrong:
 *   1. No row        -> insert with completed_at.
 *   2. Row, no stamp -> a COMPOUND lesson whose action half shipped first.
 *                       Stamp completed_at on the existing row; inserting a
 *                       second would violate (student_id, lesson_id).
 *   3. Row, stamped  -> already done. Do nothing and say so.
 *
 * In cases 1 and 2 the time is the moment the student finished watching, so
 * the row is marked as such (markCompletedAtReal, v112).
 */
export async function stampWatchCompletion(
  supabase: SupabaseClient,
  studentId: string,
  lessonId: string,
): Promise<{ alreadyComplete: boolean; error?: string }> {
  const { data: existing, error: readErr } = await supabase
    .from("student_lesson_completions")
    .select("id, completed_at")
    .eq("student_id", studentId)
    .eq("lesson_id", lessonId)
    .maybeSingle();

  if (readErr) return { alreadyComplete: false, error: readErr.message };

  if (!existing) {
    const { error } = await supabase
      .from("student_lesson_completions")
      .insert({ student_id: studentId, lesson_id: lessonId });
    // A racing duplicate request is a success, not a failure: the row exists
    // and that is all the caller wanted. The request that wrote it marks it.
    if (error && !/duplicate key/i.test(error.message)) {
      return { alreadyComplete: false, error: error.message };
    }
    if (!error) await markCompletedAtReal(supabase, studentId, [lessonId]);
    return { alreadyComplete: false };
  }

  if (existing.completed_at) return { alreadyComplete: true };

  const { error } = await supabase
    .from("student_lesson_completions")
    .update({ completed_at: new Date().toISOString() })
    .eq("id", existing.id);
  if (error) return { alreadyComplete: false, error: error.message };
  await markCompletedAtReal(supabase, studentId, [lessonId]);
  return { alreadyComplete: false };
}
