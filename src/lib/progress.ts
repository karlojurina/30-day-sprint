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
 * Days since this student joined the platform.
 */
function daysSinceJoined(joinedAtIso: string): number {
  return (Date.now() - new Date(joinedAtIso).getTime()) / 86_400_000;
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

/**
 * The Playbook unlock gate.
 *
 * Two paths to unlocked, OR'd together:
 *   1. Standard sprint path — student completed PLAYBOOK_UNLOCK_LESSON_ID
 *      (l078, "How I Approach Research / Coming Up With Ad Ideas"). This
 *      is the canonical "you finished the watch curriculum" milestone.
 *   2. Legacy auto-unlock — joined_at >= PLAYBOOK_AUTO_UNLOCK_DAYS ago
 *      AND completed >= PLAYBOOK_AUTO_UNLOCK_RATIO of all lessons. For
 *      students who've been around long enough and done most of the
 *      course but skipped the action-item gate.
 *
 * The new-student path (path 1) is unchanged from v72.7. Karlo's
 * explicit ask: "don't make any mistakes in terms of changing how the
 * new students part works."
 */
export function isPlaybookUnlocked(args: {
  student: { joined_at: string };
  completedLessonIds: Set<string>;
  playbookUnlockLessonId: string;
  totalLessons: number;
}): boolean {
  // Path 1: standard sprint completion.
  if (args.completedLessonIds.has(args.playbookUnlockLessonId)) return true;

  // Path 2: legacy auto-unlock.
  if (args.totalLessons <= 0) return false;
  const days = daysSinceJoined(args.student.joined_at);
  const ratio = args.completedLessonIds.size / args.totalLessons;
  return (
    days >= PLAYBOOK_AUTO_UNLOCK_DAYS &&
    ratio >= PLAYBOOK_AUTO_UNLOCK_RATIO
  );
}
