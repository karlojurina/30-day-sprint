import { createClient } from "@supabase/supabase-js";
import { fetchCompletedLessonsAsAdmin } from "@/lib/whop";

/**
 * Pull the student's completed Whop course lessons and upsert matching
 * student_lesson_completions rows. Used by:
 *   - the OAuth callback (right after login — backfills historical
 *     completions that pre-date our webhook integration)
 *   - the /api/student/refresh-watch-sync route
 *   - the client-side visibilitychange listener (tab refocus)
 *
 * Auth model: this calls Whop's course_lesson_interactions endpoint
 * using the app's admin API key (WHOP_API_KEY) plus the student's
 * whop_user_id as a filter. Student OAuth tokens are rejected by Whop
 * for this endpoint — admin key with course_analytics:read scope is
 * the only path that works. The webhook path covers go-forward sync;
 * this covers historical backfill + on-demand reconciliation.
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
}: {
  studentId: string;
  whopUserId: string;
}): Promise<{
  syncedCount: number;
  skippedCount: number;
  fetchedCount: number;
  matchedCount: number;
  unmatchedLessonIds: string[];
  /** Local lesson IDs (l001…l063) that matched a Whop completion */
  matchedLessonIds: string[];
  /** Full list of Whop lesson IDs returned by the API this run */
  fetchedWhopIds: string[];
}> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  try {
    // Fetch completed lessons from Whop using the app's admin API key.
    // Returns BOTH the raw count (all interactions, complete or not) and
    // the post-filter count (just completed). We persist both so we can
    // tell whether Whop returned anything at all vs. returned data but
    // the filter dropped everything.
    const { interactions, rawCount, completedCount } =
      await fetchCompletedLessonsAsAdmin(whopUserId);

    const completedLessonIds = interactions
      .map((i) => i.lesson?.id)
      .filter((id): id is string => typeof id === "string");

    // Empty completed result — still write the diagnostic row so stale data clears
    if (interactions.length === 0) {
      await supabase
        .from("students")
        .update({
          last_watch_sync_at: new Date().toISOString(),
          whop_last_sync_error:
            rawCount === 0
              ? "Whop returned 0 total interactions for this user — admin key may not have visibility into this user's progress"
              : `Whop returned ${rawCount} interactions but 0 marked completed`,
          whop_last_sync_error_at: new Date().toISOString(),
          whop_last_sync_fetched_count: rawCount,
          whop_last_sync_matched_count: 0,
          whop_last_sync_unmatched: [],
        })
        .eq("id", studentId);
      return {
        syncedCount: 0,
        skippedCount: 0,
        fetchedCount: rawCount,
        matchedCount: 0,
        unmatchedLessonIds: [],
        matchedLessonIds: [],
        fetchedWhopIds: [],
      };
    }
    void completedCount; // surfaced via interactions.length

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

    // 3. Insert NEW completions (idempotent — existing rows are left
    //    untouched so we don't reset old completed_at timestamps).
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

      // 3b. Promote any prior SKIP to a WATCH for the lessons the
      //     student now has on Whop. Doesn't touch already-watched
      //     rows (completed_at IS NULL filter).
      const lessonIds = matched.map((l) => l.id);
      const { error: promoteError } = await supabase
        .from("student_lesson_completions")
        .update({
          completed_at: new Date().toISOString(),
          skipped_at: null,
        })
        .eq("student_id", studentId)
        .in("lesson_id", lessonIds)
        .is("completed_at", null);

      if (promoteError) {
        throw new Error(`Skip→watch promotion failed: ${promoteError.message}`);
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
      matchedLessonIds: matched.map((l) => l.id).sort(),
      fetchedWhopIds: completedLessonIds,
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
