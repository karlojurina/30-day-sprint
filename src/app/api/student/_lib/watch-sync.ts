import { createClient } from "@supabase/supabase-js";
import { fetchCompletedLessons } from "@/lib/whop";

/**
 * Pull the student's completed Whop course lessons and upsert matching
 * student_task_completions rows. Used by:
 *   - the OAuth callback (fire-and-forget right after login)
 *   - the /api/student/refresh-watch-sync route (manual trigger)
 *   - future scheduled sweeps
 *
 * Tasks are matched by tasks.whop_lesson_id → Whop lesson id. Tasks
 * without a whop_lesson_id are silently ignored. The unique constraint
 * on (student_id, task_id) + ignoreDuplicates ensures this is idempotent
 * and race-safe with the lesson.completed webhook.
 */
export async function syncWatchProgress({
  studentId,
  whopUserId,
  accessToken,
}: {
  studentId: string;
  whopUserId: string;
  accessToken: string;
}): Promise<{ syncedCount: number; skippedCount: number }> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  // 1. Fetch all completed lessons from Whop
  const interactions = await fetchCompletedLessons(accessToken, whopUserId);
  if (interactions.length === 0) {
    await supabase
      .from("students")
      .update({ last_watch_sync_at: new Date().toISOString() })
      .eq("id", studentId);
    return { syncedCount: 0, skippedCount: 0 };
  }

  const completedLessonIds = interactions
    .map((i) => i.lesson?.id)
    .filter((id): id is string => typeof id === "string");

  // 2. Find our tasks that match those lesson IDs
  const { data: matchedTasks } = await supabase
    .from("tasks")
    .select("id, whop_lesson_id")
    .in("whop_lesson_id", completedLessonIds);

  const matched = matchedTasks ?? [];
  if (matched.length === 0) {
    await supabase
      .from("students")
      .update({ last_watch_sync_at: new Date().toISOString() })
      .eq("id", studentId);
    return { syncedCount: 0, skippedCount: interactions.length };
  }

  // 3. Upsert completions. Unique constraint (student_id, task_id) means
  // re-running is safe.
  const rows = matched.map((t) => ({
    student_id: studentId,
    task_id: t.id,
  }));

  const { error: upsertError } = await supabase
    .from("student_task_completions")
    .upsert(rows, {
      onConflict: "student_id,task_id",
      ignoreDuplicates: true,
    });

  if (upsertError) {
    console.error("Watch sync upsert failed:", upsertError);
    throw upsertError;
  }

  await supabase
    .from("students")
    .update({ last_watch_sync_at: new Date().toISOString() })
    .eq("id", studentId);

  return {
    syncedCount: matched.length,
    skippedCount: interactions.length - matched.length,
  };
}
