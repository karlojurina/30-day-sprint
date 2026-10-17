import type { SupabaseClient } from "@supabase/supabase-js";
import { computeStreakUpdate, getTodayUtc } from "./streak.ts";

/**
 * The streak and "last active", two signals written here.
 * v46 — streak fields live on student_streaks, not students.
 *
 * THE STREAK ticks only on counted work (Lovro, 2026-10-16, T-079): a lesson
 * finished by watching it, a lesson finished on Whop newly arriving, a task
 * newly done (src/lib/streak.ts lists the routes). A login, an app visit, a
 * quiz, a skip, undoing and partial watching never tick it.
 *
 * "LAST ACTIVE" (students.last_active_at) moves where it always moved: on
 * every login (the callback writes it itself) and in every route that ticked
 * the streak before T-079, quizzes and undoing included. The engagement
 * cron's "hasn't been active" alert and the team templates'
 * days_since_last_login read it; Lovro decides it apart from the streak.
 */

/**
 * Tick the streak for today: the only writer of student_streaks. Safe to call
 * several times a day; a day already counted is left alone.
 */
export async function tickStudentStreak(
  supabase: SupabaseClient,
  studentId: string,
) {
  // Fetch current streak state from the sibling table. If no row
  // exists yet, treat as fresh (zeroes) so a first-activity day
  // bootstraps the streak.
  const { data: streaks } = await supabase
    .from("student_streaks")
    .select("current_streak, longest_streak, last_streak_date")
    .eq("student_id", studentId)
    .maybeSingle();

  const today = getTodayUtc();
  const streakUpdate = computeStreakUpdate(
    {
      current_streak: streaks?.current_streak ?? 0,
      longest_streak: streaks?.longest_streak ?? 0,
      last_streak_date: streaks?.last_streak_date ?? null,
    },
    today,
  );

  if (streakUpdate) {
    await supabase
      .from("student_streaks")
      .upsert(
        {
          student_id: studentId,
          ...streakUpdate,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "student_id" },
      );
  }
}

/** Move students.last_active_at to now. Ticks no streak. */
export async function markStudentActive(
  supabase: SupabaseClient,
  studentId: string,
) {
  await supabase
    .from("students")
    .update({ last_active_at: new Date().toISOString() })
    .eq("id", studentId);
}

/**
 * Counted work where "last active" has always moved with the streak (a lesson
 * finished by watching it or on Whop, a task ticked on the old course): a
 * streak day, then "last active".
 */
export async function updateStudentStreak(
  supabase: SupabaseClient,
  studentId: string,
) {
  await tickStudentStreak(supabase, studentId);
  await markStudentActive(supabase, studentId);
}
