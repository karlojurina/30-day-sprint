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

  const [
    regionsRes,
    lessonsRes,
    completionsRes,
    discountRes,
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
      .from("discount_requests")
      .select("*")
      .eq("student_id", student.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single(),
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

  // Masked course ID for the sync debug panel — enough to verify in the
  // UI that the right env var is wired without leaking the full ID.
  const rawCourseId = process.env.WHOP_COURSE_ID ?? "";
  const courseIdMasked = rawCourseId
    ? rawCourseId.length > 12
      ? `${rawCourseId.slice(0, 8)}…${rawCourseId.slice(-4)}`
      : rawCourseId
    : null;

  return NextResponse.json({
    student,
    regions: regionsRes.data ?? [],
    lessons: lessonsRes.data ?? [],
    completions: completionsRes.data ?? [],
    discountRequest: discountRes.data ?? null,
    quizzes: quizzesRes.data ?? [],
    quizQuestions: quizQuestionsRes.data ?? [],
    quizAttempts: quizAttemptsRes.data ?? [],
    monthReview: monthReviewRes.data ?? null,
    whopCourseIdMasked: courseIdMasked,
  });
}
