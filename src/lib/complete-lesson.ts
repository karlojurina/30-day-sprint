import type { SupabaseClient } from "@supabase/supabase-js";
import { updateStudentStreak } from "@/app/api/student/_lib/update-streak";
import { onLessonCompleted } from "@/lib/csm-events";
import { evaluateAchievements } from "@/lib/achievements";
import { reEvaluateStudentOpenTasks } from "@/lib/csm-task-evaluation";

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
 * Stamp the WATCH half of a lesson as complete, idempotently.
 *
 * Three cases, and the third is the one a naive insert gets wrong:
 *   1. No row        -> insert with completed_at.
 *   2. Row, no stamp -> a COMPOUND lesson whose action half shipped first.
 *                       Stamp completed_at on the existing row; inserting a
 *                       second would violate (student_id, lesson_id).
 *   3. Row, stamped  -> already done. Do nothing and say so.
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
    // and that is all the caller wanted.
    if (error && !/duplicate key/i.test(error.message)) {
      return { alreadyComplete: false, error: error.message };
    }
    return { alreadyComplete: false };
  }

  if (existing.completed_at) return { alreadyComplete: true };

  const { error } = await supabase
    .from("student_lesson_completions")
    .update({ completed_at: new Date().toISOString() })
    .eq("id", existing.id);
  if (error) return { alreadyComplete: false, error: error.message };
  return { alreadyComplete: false };
}
