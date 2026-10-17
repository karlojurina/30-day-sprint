/**
 * Streak computation — pure functions, used server-side in API routes and by
 * the pages that show a streak.
 *
 * A "streak day" is a calendar day (UTC) with at least one piece of counted
 * work (Lovro, 2026-10-16, T-079): a lesson finished by watching it
 * (lesson-watched's rule), a lesson finished on Whop newly arriving (the
 * webhook, or the backfill adding a row it did not have), or a task newly
 * done (an action item's button, mark-action-shipped; on the old course also
 * a task ticked in toggle-lesson). Logging in, opening the app, a quiz, a
 * skip, undoing and partial watching never count. The writer is
 * src/app/api/student/_lib/update-streak.ts.
 */

interface StreakState {
  current_streak: number;
  longest_streak: number;
  last_streak_date: string | null; // ISO date string "YYYY-MM-DD"
}

interface StreakUpdate {
  current_streak: number;
  longest_streak: number;
  last_streak_date: string;
}

/**
 * Compute the new streak values given the student's current streak state
 * and today's date (UTC).
 *
 * Returns null if no update is needed (already active today).
 */
export function computeStreakUpdate(
  state: StreakState,
  todayUtc: string // "YYYY-MM-DD"
): StreakUpdate | null {
  const { current_streak, longest_streak, last_streak_date } = state;

  // Already active today — no update needed
  if (last_streak_date === todayUtc) return null;

  // Check if last activity was yesterday
  const yesterday = getYesterday(todayUtc);
  const isConsecutive = last_streak_date === yesterday;

  const newStreak = isConsecutive ? current_streak + 1 : 1;
  const newLongest = Math.max(longest_streak, newStreak);

  return {
    current_streak: newStreak,
    longest_streak: newLongest,
    last_streak_date: todayUtc,
  };
}

/**
 * The streak as it stands on `todayUtc`: the stored count while its last
 * counted day is today or yesterday, 0 once that day is older, because the
 * streak broke. The stored row is only rewritten on the next counted day
 * (computeStreakUpdate starts it again at 1), so every page that shows a
 * streak reads it through this. The best (longest_streak) never breaks.
 */
export function currentStreakAsOf(
  state:
    | { current_streak: number | null; last_streak_date: string | null }
    | null
    | undefined,
  todayUtc: string // "YYYY-MM-DD"
): number {
  if (!state?.current_streak || !state.last_streak_date) return 0;
  // "YYYY-MM-DD" strings compare as dates. A day after today (a browser
  // whose clock runs behind the server's) still counts as running.
  return state.last_streak_date >= getYesterday(todayUtc)
    ? state.current_streak
    : 0;
}

function getYesterday(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().split("T")[0];
}

/**
 * Get today's date in UTC as "YYYY-MM-DD".
 */
export function getTodayUtc(): string {
  return new Date().toISOString().split("T")[0];
}
