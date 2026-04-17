/**
 * Streak computation — pure function, used server-side in API routes.
 *
 * A "streak day" counts when the student does at least ONE qualifying
 * activity in a calendar day (UTC): task completion, watch sync, or note save.
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
