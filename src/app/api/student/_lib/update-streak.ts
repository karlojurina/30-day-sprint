import type { SupabaseClient } from "@supabase/supabase-js";
import { computeStreakUpdate, getTodayUtc } from "@/lib/streak";

/**
 * Update a student's streak (student_streaks table) and bump
 * students.last_active_at in one call. Safe to call multiple times
 * per day — no-ops if already active today.
 *
 * v46 — streak fields live on student_streaks, not students.
 */
export async function updateStudentStreak(
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

  const nowIso = new Date().toISOString();

  if (streakUpdate) {
    // Write streak update to its own table, then bump last_active_at
    // on students separately.
    await supabase
      .from("student_streaks")
      .upsert(
        {
          student_id: studentId,
          ...streakUpdate,
          updated_at: nowIso,
        },
        { onConflict: "student_id" },
      );
  }

  // Either way, bump last_active_at on students.
  await supabase
    .from("students")
    .update({ last_active_at: nowIso })
    .eq("id", studentId);
}
