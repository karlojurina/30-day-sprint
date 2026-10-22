import { createClient } from "./stub-server.ts";
import { fetchCompletedLessonsAsAdmin } from "./stub-server.ts";
import { onLessonCompleted } from "./stub-server.ts";
import { whopNoneFinishedNote } from "./constants.ts";
import { isDoneOnly, whopActionTime } from "./action-items.ts";

/**
 * The earliest time Whop gives for one of its lessons among these
 * interactions (created_at, when the student opened it there), or null when
 * none reads as a time. Whop lists a lesson once; should it list one twice,
 * the earlier time is taken, as the catch-up takes it.
 */
function earliestWhopTime(
  interactions: ReadonlyArray<{ lesson?: { id?: string } | null; created_at?: string | null }>,
  whopLessonId: string | null | undefined,
): string | null {
  let earliest: number | null = null;
  for (const i of interactions) {
    if (!whopLessonId || i.lesson?.id !== whopLessonId) continue;
    const t = typeof i.created_at === "string" ? Date.parse(i.created_at) : NaN;
    if (Number.isFinite(t) && (earliest === null || t < earliest)) earliest = t;
  }
  return earliest === null ? null : new Date(earliest).toISOString();
}

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
 * What it says is true (backend_readiness.md, section 5, items 3, 4, 6, 7):
 * `syncedCount` is the rows this run actually added (new lessons, and skips
 * turned into watches), so the streak, "last active" and the "came back"
 * check move only on new work; a failed read of the lessons is an error;
 * Whop returning nothing is a plain zero.
 *
 * An action item finished with Done alone (isDoneOnly in action-items.ts)
 * that Whop lists as finished gets its action half as well (3c), so it is
 * done in the app; a row of one that holds the watch half alone is filled at
 * the next login or visit. An action half already there (Done pressed before
 * the video was watched) is kept, and the watch half of every lesson comes
 * only from Whop's list, as before.
 *
 * Diagnostic: the list of Whop lesson IDs we FETCHED but couldn't match to
 * any of our lessons is saved onto student_whop_sync.last_sync_unmatched so
 * Karlo can see exactly which Whop lessons still need a mapping.
 *
 * v46 — all Whop sync diagnostics live on student_whop_sync, not students.
 */
export async function syncWatchProgress({
  studentId,
  whopUserId,
}: {
  studentId: string;
  whopUserId: string;
}): Promise<{
  /** Rows this run added: new lessons, and skips turned into watches. */
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
      const nowIso = new Date().toISOString();
      await supabase
        .from("student_whop_sync")
        .upsert(
          {
            student_id: studentId,
            last_sync_at: nowIso,
            // Nothing on Whop is a plain zero: after the switch it is most
            // students' normal state, and written as an error it showed in
            // red as "Last error" beside real failures. Lessons opened and
            // none finished keeps its note, which the admin student page
            // shows as a note (isWhopNoneFinishedNote).
            last_sync_error:
              rawCount === 0
                ? null
                : whopNoneFinishedNote(rawCount),
            last_sync_error_at: rawCount === 0 ? null : nowIso,
            last_sync_fetched: rawCount,
            last_sync_matched: 0,
            last_sync_unmatched: [],
            updated_at: nowIso,
          },
          { onConflict: "student_id" },
        );
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
    const { data: matchedLessons, error: lessonsError } = await supabase
      .from("lessons")
      .select("id, whop_lesson_id")
      .in("whop_lesson_id", completedLessonIds);
    // A failed read is an error, never "nothing matched": the catch below
    // writes it on the sync row and the caller answers it as a failure.
    if (lessonsError) {
      throw new Error(`Lessons read failed: ${lessonsError.message}`);
    }

    const matched = matchedLessons ?? [];
    const matchedWhopIds = new Set(
      matched.map((l) => l.whop_lesson_id).filter(Boolean)
    );
    const unmatchedLessonIds = completedLessonIds.filter(
      (id) => !matchedWhopIds.has(id)
    );

    // 3. Insert NEW completions (idempotent — existing rows are left
    //    untouched so we don't reset old completed_at timestamps).
    //    `added` is what this run actually wrote: the rows the insert
    //    returns (only those it added) and the rows the promotion returns.
    const added = new Set<string>();
    if (matched.length > 0) {
      const rows = matched.map((l) => ({
        student_id: studentId,
        lesson_id: l.id,
      }));

      const { data: inserted, error: upsertError } = await supabase
        .from("student_lesson_completions")
        .upsert(rows, {
          onConflict: "student_id,lesson_id",
          ignoreDuplicates: true,
        })
        .select("lesson_id");

      if (upsertError) {
        throw new Error(`Upsert failed: ${upsertError.message}`);
      }
      for (const r of inserted ?? []) added.add(r.lesson_id);

      // 3b. Promote any prior SKIP to a WATCH for the lessons the
      //     student now has on Whop. Doesn't touch already-watched
      //     rows (completed_at IS NULL filter).
      const lessonIds = matched.map((l) => l.id);
      const { data: promoted, error: promoteError } = await supabase
        .from("student_lesson_completions")
        .update({
          completed_at: new Date().toISOString(),
          skipped_at: null,
        })
        .eq("student_id", studentId)
        .in("lesson_id", lessonIds)
        .is("completed_at", null)
        .select("lesson_id");

      if (promoteError) {
        throw new Error(`Skip→watch promotion failed: ${promoteError.message}`);
      }
      for (const r of promoted ?? []) added.add(r.lesson_id);

      // 3c. An action item finished with Done alone (isDoneOnly, the list in
      //     action-items.ts) has nothing to hand in, so finished on Whop it
      //     is done in the app (action-items.ts, FINISHED ON WHOP). Its row
      //     gets the action half where it has none: a row this run added or
      //     finished, and a row a Whop writer left with the watch half alone
      //     before the item was on the list. A row whose action half is in
      //     (Done pressed before the video was watched, then finished by 3b)
      //     keeps it. Dated at Whop's own time for the lesson
      //     (whopActionTime says why). Nothing here counts in `added`: a row
      //     this run wrote is in it already, and an older row's watch half
      //     was counted when it arrived.
      const doneOnlyIds = lessonIds.filter(isDoneOnly);
      if (doneOnlyIds.length > 0) {
        const whopIdOf = new Map(matched.map((l) => [l.id, l.whop_lesson_id]));
        const { data: halves, error: halvesError } = await supabase
          .from("student_lesson_completions")
          .select("lesson_id, completed_at, action_completed_at")
          .eq("student_id", studentId)
          .in("lesson_id", doneOnlyIds);
        if (halvesError) {
          throw new Error(`Done-only rows read failed: ${halvesError.message}`);
        }
        const nowMs = Date.now();
        for (const h of halves ?? []) {
          if (!h.completed_at || h.action_completed_at) continue;
          const actionAt = whopActionTime(
            earliestWhopTime(interactions, whopIdOf.get(h.lesson_id)),
            h.completed_at,
            nowMs,
          );
          const { error: actionError } = await supabase
            .from("student_lesson_completions")
            .update({ action_completed_at: actionAt })
            .eq("student_id", studentId)
            .eq("lesson_id", h.lesson_id)
            .is("action_completed_at", null);
          if (actionError) {
            throw new Error(`Done-only action half failed: ${actionError.message}`);
          }
        }
      }
    }

    const nowIso = new Date().toISOString();
    await supabase
      .from("student_whop_sync")
      .upsert(
        {
          student_id: studentId,
          last_sync_at: nowIso,
          last_sync_error: null,
          last_sync_error_at: null,
          last_sync_fetched: interactions.length,
          last_sync_matched: matched.length,
          last_sync_unmatched: unmatchedLessonIds,
          updated_at: nowIso,
        },
        { onConflict: "student_id" },
      );

    // X.1 reactivation check — only when we actually newly-completed
    // something. Best-effort; failures never break the sync. (It used to
    // test every matched lesson, so it ran on every sync.)
    if (added.size > 0) {
      await onLessonCompleted(supabase, studentId);
    }

    return {
      syncedCount: added.size,
      skippedCount: interactions.length - matched.length,
      fetchedCount: interactions.length,
      matchedCount: matched.length,
      unmatchedLessonIds,
      matchedLessonIds: matched.map((l) => l.id).sort(),
      fetchedWhopIds: completedLessonIds,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const nowIso = new Date().toISOString();
    await supabase
      .from("student_whop_sync")
      .upsert(
        {
          student_id: studentId,
          last_sync_error: message.slice(0, 1000),
          last_sync_error_at: nowIso,
          updated_at: nowIso,
        },
        { onConflict: "student_id" },
      );
    console.error("[watch-sync] failed:", message);
    throw err;
  }
}
