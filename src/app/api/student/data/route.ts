import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(request: NextRequest) {
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

  const { data: { user }, error: userError } = await supabase.auth.getUser(token);
  if (userError || !user) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const { data: student } = await supabase
    .from("students")
    .select("*")
    .eq("supabase_user_id", user.id)
    .single();

  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  const today = new Date().toISOString().split("T")[0];

  const [
    regionsRes,
    lessonsRes,
    completionsRes,
    noteRes,
    discountRes,
    lessonNotesRes,
    quizzesRes,
    quizQuestionsRes,
    quizAttemptsRes,
    monthReviewRes,
  ] = await Promise.all([
    supabase.from("regions").select("*").order("order_num"),
    supabase.from("lessons").select("*").order("day").order("sort_order"),
    supabase
      .from("student_lesson_completions")
      .select("*")
      .eq("student_id", student.id),
    supabase
      .from("daily_notes")
      .select("*")
      .eq("student_id", student.id)
      .eq("note_date", today)
      .single(),
    supabase
      .from("discount_requests")
      .select("*")
      .eq("student_id", student.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single(),
    supabase
      .from("lesson_notes")
      .select("*")
      .eq("student_id", student.id),
    supabase.from("quizzes").select("*").order("sort_order"),
    supabase.from("quiz_questions").select("*").order("sort_order"),
    supabase
      .from("student_quiz_attempts")
      .select("*")
      .eq("student_id", student.id)
      .order("completed_at", { ascending: false }),
    supabase
      .from("month_reviews")
      .select("*")
      .eq("student_id", student.id)
      .single(),
  ]);

  return NextResponse.json({
    student,
    regions: regionsRes.data ?? [],
    lessons: lessonsRes.data ?? [],
    completions: completionsRes.data ?? [],
    todayNote: noteRes.data ?? null,
    discountRequest: discountRes.data ?? null,
    lessonNotes: lessonNotesRes.data ?? [],
    quizzes: quizzesRes.data ?? [],
    quizQuestions: quizQuestionsRes.data ?? [],
    quizAttempts: quizAttemptsRes.data ?? [],
    monthReview: monthReviewRes.data ?? null,
  });
}
