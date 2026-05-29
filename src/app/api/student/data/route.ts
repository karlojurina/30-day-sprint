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
    // v46 — per-function sibling tables (split from students)
    milestonesRes,
    streaksRes,
    whopSyncRes,
    celebrationsRes,
    dmLogRes,
    regionQuizRes,
    lessonRatingsRes,
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
    supabase
      .from("student_milestones")
      .select("*")
      .eq("student_id", student.id)
      .maybeSingle(),
    supabase
      .from("student_streaks")
      .select("*")
      .eq("student_id", student.id)
      .maybeSingle(),
    supabase
      .from("student_whop_sync")
      .select("*")
      .eq("student_id", student.id)
      .maybeSingle(),
    supabase
      .from("student_celebrations")
      .select("*")
      .eq("student_id", student.id)
      .maybeSingle(),
    supabase
      .from("student_dm_log")
      .select("*")
      .eq("student_id", student.id)
      .maybeSingle(),
    // v54 - region-end quiz gate (lovro-brief-region-quiz). One row
    // per (student, region) tracking quiz_passed_at + quiz_attempts.
    // Returned as an array (may be empty); the client folds into a
    // Map keyed by region_id.
    supabase
      .from("student_region_quiz")
      .select(
        "region_id, quiz_passed_at, quiz_attempts, best_score_pct, last_score_pct, last_attempt_at",
      )
      .eq("student_id", student.id),
    // v75 - per-lesson rating + optional comment. One row per
    // (student, lesson). Client folds into a Map for O(1) lookup.
    supabase
      .from("student_lesson_ratings")
      .select("lesson_id, stars, comment, created_at, updated_at")
      .eq("student_id", student.id),
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
    milestones: milestonesRes.data ?? null,
    streaks: streaksRes.data ?? null,
    whopSync: whopSyncRes.data ?? null,
    celebrations: celebrationsRes.data ?? null,
    dmLog: dmLogRes.data ?? null,
    regionQuiz: regionQuizRes.data ?? [],
    lessonRatings: lessonRatingsRes.data ?? [],
    whopCourseIdMasked: courseIdMasked,
  });
}
