/**
 * Canonical "is this lesson done?" logic.
 *
 * The student platform tracks per-lesson state in
 * student_lesson_completions, which can carry up to three timestamps:
 *
 *   completed_at         — the watch half (auto-synced from Whop)
 *   action_completed_at  — the manual "I shipped the ad" half (only
 *                          relevant for compound lessons,
 *                          lessons.requires_action = true)
 *   skipped_at           — the student explicitly skipped this lesson
 *                          (optional content like long editing
 *                          breakdowns; counts as path progress)
 *
 * The DB view `student_progress_counts` must agree with this function
 * exactly. The Supabase migration that defines that view encodes the
 * same formula in SQL (see 2026_v48_student_progress_view_fix.sql).
 *
 * Why this exists: progress was previously computed three different
 * ways — the `student_progress_counts` view counted every row in
 * completions (overcounted), the kanban only counted `completed_at`
 * (undercounted), and the student-facing context did the right thing.
 * Centralizing it here ensures every surface in the app agrees.
 */

export interface CompletionRow {
  lesson_id: string;
  completed_at: string | null;
  action_completed_at: string | null;
  skipped_at: string | null;
}

export interface LessonShape {
  id: string;
  requires_action: boolean;
}

/**
 * True when this completion row represents a "done" lesson per the
 * canonical formula.
 */
export function isLessonComplete(
  completion: CompletionRow,
  lesson: LessonShape | undefined,
): boolean {
  if (!lesson) return false;
  // Skipped lessons count toward path progression.
  if (completion.skipped_at) return true;
  if (lesson.requires_action) {
    // Compound lessons need BOTH halves.
    return Boolean(completion.completed_at && completion.action_completed_at);
  }
  // Plain watch lesson — just needs the watch half.
  return Boolean(completion.completed_at);
}

/**
 * Set of lesson IDs that count as fully complete for a student, given
 * their completion rows + the lesson catalog. Used by both the
 * student-facing context (`completedLessonIds`) and admin surfaces.
 */
export function completedLessonIdsFor(
  completions: CompletionRow[],
  lessons: LessonShape[],
): Set<string> {
  const lessonsById = new Map(lessons.map((l) => [l.id, l]));
  const done = new Set<string>();
  for (const c of completions) {
    if (isLessonComplete(c, lessonsById.get(c.lesson_id))) {
      done.add(c.lesson_id);
    }
  }
  return done;
}

/**
 * Plain count of complete lessons for a student. The denominator
 * (total lessons) lives on whatever surface is rendering — pair this
 * with `lessons.length` (or whatever filtered total the surface uses)
 * to compute a percentage.
 */
export function countCompletedLessons(
  completions: CompletionRow[],
  lessons: LessonShape[],
): number {
  return completedLessonIdsFor(completions, lessons).size;
}

/**
 * Thresholds for the legacy auto-unlock branch of the Playbook gate.
 * A student qualifies for auto-unlock if they've been on the platform
 * at least PLAYBOOK_AUTO_UNLOCK_DAYS days AND completed at least
 * PLAYBOOK_AUTO_UNLOCK_RATIO of all lessons. Both must be true.
 *
 * Why: older / legacy customers (joined long before launch, signed up
 * via Whop's older flow) often went past the action-item phase into
 * creative strategy without checking off action items here, so they
 * never trigger the standard l078-completion unlock. Karlo doesn't
 * want to force-march them through the sprint just to access the
 * Playbook content. v75.16 — Karlo's call, 2026-06-02.
 */
export const PLAYBOOK_AUTO_UNLOCK_DAYS = 30;
export const PLAYBOOK_AUTO_UNLOCK_RATIO = 0.8;

/** What the Playbook gate reads of a lesson: a lesson row of either course. */
export interface PlaybookLesson {
  id: string;
  sort_order: number;
  /** False: outside the progress count (l057 on the old course, a7l19 on the new). Missing counts. */
  counts_toward_progress?: boolean;
  feature_key?: string | null;
}

/**
 * The Playbook unlock gate (cutover PRD, call C8 and Work Item 8). The
 * course comes from the lessons handed in, so the same rule reads the old
 * course and the new one. Three ways in, OR'd together:
 *
 *   1. The stamp: `unlockedAt` (student_milestones.playbook_unlocked_at).
 *      The course switch (v104) sets it for every graduate of the old course,
 *      whose done lessons it then archives. The app never writes it.
 *   2. The unlock lesson is done: the lesson holding feature_key
 *      "playbook_unlock" (l078 on the old course, set by v92), or, on a
 *      course where none holds it, the last counting lesson by sort_order.
 *      The old course's canonical "you finished the watch curriculum"
 *      milestone (v72.7), unchanged there.
 *   3. Legacy auto-unlock: PLAYBOOK_AUTO_UNLOCK_DAYS since the first payment
 *      (else joined_at; v75.18: a renewal does not reset the count), and
 *      done lessons numbering at least PLAYBOOK_AUTO_UNLOCK_RATIO of the
 *      counting lessons. Every done lesson is counted, a non-counting one
 *      too, as the page always did (v104's stamp counts the same way).
 *
 * The old course's verdicts are the old gate's (client-tests/playbook.test.mjs
 * runs both). Karlo's explicit ask stands: "don't make any mistakes in terms
 * of changing how the new students part works."
 *
 * `now` is the clock (ms), so a render can pass a ticking state and stay pure.
 */
export function isPlaybookUnlocked(args: {
  student: { joined_at: string; first_paid_at?: string | null };
  completedLessonIds: ReadonlySet<string>;
  lessons: readonly PlaybookLesson[];
  unlockedAt: string | null | undefined;
  now?: number;
}): boolean {
  const { student, completedLessonIds, lessons, unlockedAt } = args;

  // 1. The stamp.
  if (unlockedAt) return true;

  // 2. The unlock lesson.
  const counting = lessons.filter((l) => l.counts_toward_progress !== false);
  const unlockLesson =
    lessons.find((l) => l.feature_key === "playbook_unlock") ??
    counting.reduce<PlaybookLesson | null>(
      (last, l) => (last === null || l.sort_order > last.sort_order ? l : last),
      null,
    );
  if (unlockLesson && completedLessonIds.has(unlockLesson.id)) return true;

  // 3. Legacy auto-unlock. No lessons yet (still loading): closed.
  if (counting.length === 0) return false;
  const since = student.first_paid_at ?? student.joined_at;
  const days = ((args.now ?? Date.now()) - new Date(since).getTime()) / 86_400_000;
  const ratio = completedLessonIds.size / counting.length;
  return days >= PLAYBOOK_AUTO_UNLOCK_DAYS && ratio >= PLAYBOOK_AUTO_UNLOCK_RATIO;
}
