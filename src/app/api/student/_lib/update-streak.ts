import type { SupabaseClient } from "@supabase/supabase-js";
import { computeStreakUpdate, getTodayUtc } from "@/lib/streak";

/**
 * Update a student's streak and last_active_at in one call.
 * Safe to call multiple times per day — no-ops if already active today.
 */
export async function updateStudentStreak(
  supabase: SupabaseClient,
  studentId: string
) {
  // Fetch current streak state
  const { data: student } = await supabase
    .from("students")
    .select("current_streak, longest_streak, last_streak_date")
    .eq("id", studentId)
    .single();

  if (!student) return;

  const today = getTodayUtc();
  const streakUpdate = computeStreakUpdate(student, today);

  if (streakUpdate) {
    await supabase
      .from("students")
      .update({
        ...streakUpdate,
        last_active_at: new Date().toISOString(),
      })
      .eq("id", studentId);
  } else {
    // Already active today — just bump last_active_at
    await supabase
      .from("students")
      .update({ last_active_at: new Date().toISOString() })
      .eq("id", studentId);
  }
}
