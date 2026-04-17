import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getTitleForCheckpoints } from "@/lib/titles";

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

  // Check if review already exists
  const { data: existing } = await supabase
    .from("month_reviews")
    .select("id")
    .eq("student_id", student.id)
    .single();

  if (existing) {
    return NextResponse.json({ error: "Review already exists" }, { status: 409 });
  }

  // Gather all stats
  const [completionsRes, checkpointsRes, notesRes, attemptsRes, rewardsRes] =
    await Promise.all([
      supabase
        .from("student_task_completions")
        .select("task_id")
        .eq("student_id", student.id),
      supabase.from("checkpoints").select("id"),
      supabase
        .from("lesson_notes")
        .select("id")
        .eq("student_id", student.id),
      supabase
        .from("student_quiz_attempts")
        .select("passed")
        .eq("student_id", student.id),
      supabase
        .from("student_rewards")
        .select("id")
        .eq("student_id", student.id),
    ]);

  const tasksCompleted = completionsRes.data?.length ?? 0;
  const totalCheckpoints = checkpointsRes.data?.length ?? 7;

  // Count completed checkpoints by checking task completions per checkpoint
  const { data: tasksData } = await supabase.from("tasks").select("id, checkpoint_id");
  const tasksByCheckpoint: Record<string, string[]> = {};
  for (const t of tasksData ?? []) {
    if (!tasksByCheckpoint[t.checkpoint_id]) tasksByCheckpoint[t.checkpoint_id] = [];
    tasksByCheckpoint[t.checkpoint_id].push(t.id);
  }
  const completedTaskIds = new Set(
    (completionsRes.data ?? []).map((c: { task_id: string }) => c.task_id)
  );
  let checkpointsCompleted = 0;
  for (const [, taskIds] of Object.entries(tasksByCheckpoint)) {
    if (taskIds.length > 0 && taskIds.every((id) => completedTaskIds.has(id))) {
      checkpointsCompleted++;
    }
  }

  const quizzesPassed = (attemptsRes.data ?? []).filter(
    (a: { passed: boolean }) => a.passed
  ).length;

  // Count bounties (w4_t2 through w4_t4)
  const bountyIds = ["w4_t2", "w4_t3", "w4_t4"];
  const bountiesSubmitted = bountyIds.filter((id) =>
    completedTaskIds.has(id)
  ).length;

  const titleDef = getTitleForCheckpoints(checkpointsCompleted);

  const snapshot = {
    tasks_completed: tasksCompleted,
    tasks_total: tasksData?.length ?? 23,
    current_title: titleDef.key,
    longest_streak: student.longest_streak,
    current_streak: student.current_streak,
    notes_written: notesRes.data?.length ?? 0,
    quizzes_passed: quizzesPassed,
    quizzes_total: 5,
    rewards_unlocked: rewardsRes.data?.length ?? 0,
    checkpoints_completed: checkpointsCompleted,
    checkpoints_total: totalCheckpoints,
    bounties_submitted: bountiesSubmitted,
  };

  const { data: review, error: insertError } = await supabase
    .from("month_reviews")
    .insert({
      student_id: student.id,
      snapshot_data: snapshot,
    })
    .select()
    .single();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ review });
}
