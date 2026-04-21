import { createClient } from "@supabase/supabase-js";
import { fetchCompletedLessons } from "@/lib/whop";

/**
 * Pull the student's completed Whop course lessons and upsert matching
 * student_lesson_completions rows. Used by:
 *   - the OAuth callback (right after login)
 *   - the /api/student/refresh-watch-sync route
 *   - the client-side visibilitychange listener (tab refocus)
 *
 * Lessons are matched by lessons.whop_lesson_id → Whop lesson id. Lessons
 * without a whop_lesson_id are silently ignored. The unique constraint on
 * (student_id, lesson_id) + ignoreDuplicates ensures this is idempotent.
 *
 * Diagnostic: the list of Whop lesson IDs we FETCHED but couldn't match to
 * any of our lessons is saved onto students.whop_last_sync_unmatched so
 * Karlo can see exactly which Whop lessons still need a mapping.
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
  matchedCount: number;
  unmatchedLessonIds: string[];
}> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  try {
    // 1. Fetch completed lessons from Whop
    const interactions = await fetchCompletedLessons(accessToken, whopUserId);

    const completedLessonIds = interactions
      .map((i) => i.lesson?.id)
      .filter((id): id is string => typeof id === "string");

    // Empty result — still write the diagnostic row so stale data clears
    if (interactions.length === 0) {
      await supabase
        .from("students")
        .update({
          last_watch_sync_at: new Date().toISOString(),
          whop_last_sync_error: null,
          whop_last_sync_error_at: null,
          whop_last_sync_fetched_count: 0,
          whop_last_sync_matched_count: 0,
          whop_last_sync_unmatched: [],
        })
        .eq("id", studentId);
      return {
        syncedCount: 0,
        skippedCount: 0,
        fetchedCount: 0,
        matchedCount: 0,
        unmatchedLessonIds: [],
      };
    }

    // 2. Find our lessons that match those Whop lesson IDs
    const { data: matchedLessons } = await supabase
      .from("lessons")
      .select("id, whop_lesson_id")
      .in("whop_lesson_id", completedLessonIds);

    const matched = matchedLessons ?? [];
    const matchedWhopIds = new Set(
      matched.map((l) => l.whop_lesson_id).filter(Boolean)
    );
    const unmatchedLessonIds = completedLessonIds.filter(
      (id) => !matchedWhopIds.has(id)
    );

    // 3. Upsert completions (idempotent). Skip if nothing to insert.
    if (matched.length > 0) {
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
    }

    await supabase
      .from("students")
      .update({
        last_watch_sync_at: new Date().toISOString(),
        whop_last_sync_error: null,
        whop_last_sync_error_at: null,
        whop_last_sync_fetched_count: interactions.length,
        whop_last_sync_matched_count: matched.length,
        whop_last_sync_unmatched: unmatchedLessonIds,
      })
      .eq("id", studentId);

    return {
      syncedCount: matched.length,
      skippedCount: interactions.length - matched.length,
      fetchedCount: interactions.length,
      matchedCount: matched.length,
      unmatchedLessonIds,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
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
