import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { scoreQuiz } from "@/lib/quiz";
import { updateStudentStreak } from "../_lib/update-streak";

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const token = authHeader.slice(7);
  const { quizId, selections } = await request.json();

  if (!quizId || !selections) {
    return NextResponse.json(
      { error: "Missing quizId or selections" },
      { status: 400 }
    );
  }

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
    .select("id")
    .eq("supabase_user_id", user.id)
    .single();

  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  // Fetch quiz and questions
  const [quizRes, questionsRes] = await Promise.all([
    supabase.from("quizzes").select("*").eq("id", quizId).single(),
    supabase
      .from("quiz_questions")
      .select("*")
      .eq("quiz_id", quizId)
      .order("sort_order"),
  ]);

  if (!quizRes.data) {
    return NextResponse.json({ error: "Quiz not found" }, { status: 404 });
  }

  const quiz = quizRes.data;
  const questions = questionsRes.data ?? [];

  // Score the quiz server-side
  const result = scoreQuiz(questions, selections, quiz.passing_percent);

  // Insert attempt
  const { data: attempt, error: insertError } = await supabase
    .from("student_quiz_attempts")
    .insert({
      student_id: student.id,
      quiz_id: quizId,
      score: result.score,
      total: result.total,
      passed: result.passed,
      answers: result.answers,
    })
    .select()
    .single();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  await updateStudentStreak(supabase, student.id);

  return NextResponse.json({
    attempt,
    score: result.score,
    total: result.total,
    passed: result.passed,
    answers: result.answers,
  });
}
