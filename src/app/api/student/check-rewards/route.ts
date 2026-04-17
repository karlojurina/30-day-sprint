import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const token = authHeader.slice(7);
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);
  if (userError || !user) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const { data: student } = await supabase
    .from("students")
    .select("id, current_streak, longest_streak")
    .eq("supabase_user_id", user.id)
    .single();

  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  // Gather state for evaluation
  const [rewardsRes, unlockedRes, completionsRes, notesRes, attemptsRes] =
    await Promise.all([
      supabase.from("hidden_rewards").select("*"),
      supabase
        .from("student_rewards")
        .select("reward_id")
        .eq("student_id", student.id),
      supabase
        .from("student_task_completions")
        .select("task_id")
        .eq("student_id", student.id),
      supabase
        .from("lesson_notes")
        .select("id")
        .eq("student_id", student.id),
      supabase
        .from("student_quiz_attempts")
        .select("score, total, passed")
        .eq("student_id", student.id),
    ]);

  const allRewards = rewardsRes.data ?? [];
  const existingIds = new Set(
    (unlockedRes.data ?? []).map((r: { reward_id: string }) => r.reward_id)
  );
  const completedTaskIds = new Set(
    (completionsRes.data ?? []).map((c: { task_id: string }) => c.task_id)
  );

  // Compute best quiz score as percent
  let bestQuizScore = 0;
  for (const a of attemptsRes.data ?? []) {
    if (a.total > 0) {
      const pct = (a.score / a.total) * 100;
      if (pct > bestQuizScore) bestQuizScore = pct;
    }
  }

  const state = {
    completedTaskCount: completedTaskIds.size,
    currentStreak: student.current_streak,
    longestStreak: student.longest_streak,
    completedTaskIds,
    notesWrittenCount: notesRes.data?.length ?? 0,
    quizzesPassed: (attemptsRes.data ?? []).filter(
      (a: { passed: boolean }) => a.passed
    ).length,
    bestQuizScore,
  };

  // Evaluate triggers
  const newlyUnlocked = [];
  for (const reward of allRewards) {
    if (existingIds.has(reward.id)) continue;

    let triggered = false;
    const val = reward.trigger_value as Record<string, unknown>;

    switch (reward.trigger_type) {
      case "task_count":
        triggered = state.completedTaskCount >= (val.count as number);
        break;
      case "streak_length":
        triggered = state.currentStreak >= (val.streak as number);
        break;
      case "specific_task":
        triggered = state.completedTaskIds.has(val.task_id as string);
        break;
      case "quiz_perfect":
        triggered = state.bestQuizScore >= 100;
        break;
      case "notes_count":
        triggered = state.notesWrittenCount >= (val.count as number);
        break;
    }

    if (triggered) {
      // Insert unlock
      const { data: unlock } = await supabase
        .from("student_rewards")
        .insert({ student_id: student.id, reward_id: reward.id })
        .select()
        .single();
      if (unlock) {
        newlyUnlocked.push({ ...reward, unlock });
      }
    }
  }

  return NextResponse.json({ newlyUnlocked });
}
