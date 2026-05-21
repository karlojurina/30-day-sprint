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
