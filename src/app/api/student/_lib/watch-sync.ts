import { createClient } from "@supabase/supabase-js";
import { fetchCompletedLessons } from "@/lib/whop";

/**
 * Pull the student's completed Whop course lessons and upsert matching
 * student_task_completions rows. Used by:
 *   - the OAuth callback (right after login)
 *   - the /api/student/refresh-watch-sync route (manual trigger)
 *   - future scheduled sweeps
 *
 * Tasks are matched by tasks.whop_lesson_id → Whop lesson id. Tasks
 * without a whop_lesson_id are silently ignored. The unique constraint
 * on (student_id, task_id) + ignoreDuplicates ensures this is idempotent
 * and race-safe with the lesson.completed webhook.
 *
 * On error: persists the message to students.whop_last_sync_error so
 * we can surface it in the UI and debug silent 403s/etc.
 */
export async function syncWatchProgress({
  studentId,
  whopUserId,
  accessToken,
}: {
  studentId: string;
  whopUserId: string;
  accessToken: string;
}): Promise<{
  syncedCount: number;
  skippedCount: number;
  fetchedCount: number;
}> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  try {
    // 1. Fetch all completed lessons from Whop
    const interactions = await fetchCompletedLessons(accessToken, whopUserId);

    if (interactions.length === 0) {
      await supabase
        .from("students")
        .update({
          last_watch_sync_at: new Date().toISOString(),
          whop_last_sync_error: null,
          whop_last_sync_error_at: null,
        })
        .eq("id", studentId);
      return { syncedCount: 0, skippedCount: 0, fetchedCount: 0 };
    }

    const completedLessonIds = interactions
      .map((i) => i.lesson?.id)
      .filter((id): id is string => typeof id === "string");

    // 2. Find our lessons that match those Whop lesson IDs
    const { data: matchedLessons } = await supabase
      .from("lessons")
      .select("id, whop_lesson_id")
      .in("whop_lesson_id", completedLessonIds);

    const matched = matchedLessons ?? [];
    if (matched.length === 0) {
      await supabase
        .from("students")
        .update({
          last_watch_sync_at: new Date().toISOString(),
          whop_last_sync_error: null,
          whop_last_sync_error_at: null,
        })
        .eq("id", studentId);
      return {
        syncedCount: 0,
        skippedCount: interactions.length,
        fetchedCount: interactions.length,
      };
    }

    // 3. Upsert completions (idempotent)
    const rows = matched.map((l) => ({
      student_id: studentId,
      lesson_id: l.id,
    }));

    const { error: upsertError } = await supabase
      .from("student_lesson_completions")
      .upsert(rows, {
        onConflict: "student_id,lesson_id",
        ignoreDuplicates: true,
      });

    if (upsertError) {
      throw new Error(`Upsert failed: ${upsertError.message}`);
    }

    await supabase
      .from("students")
      .update({
        last_watch_sync_at: new Date().toISOString(),
        whop_last_sync_error: null,
        whop_last_sync_error_at: null,
      })
      .eq("id", studentId);

    return {
      syncedCount: matched.length,
      skippedCount: interactions.length - matched.length,
      fetchedCount: interactions.length,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Persist the error so the UI can surface it and we can debug
    await supabase
      .from("students")
      .update({
        whop_last_sync_error: message.slice(0, 1000),
        whop_last_sync_error_at: new Date().toISOString(),
      })
      .eq("id", studentId);
    console.error("[watch-sync] failed:", message);
    throw err;
  }
}
