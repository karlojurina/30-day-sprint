import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  CATALOG_TABLE_SUFFIX,
  IS_STAGING_CATALOG,
  LESSONS_TABLE,
  REGIONS_TABLE,
} from "@/lib/catalog-tables";

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
    // v93 — per-lesson video watch telemetry. At most one row per lesson the
    // student has opened (<=146), comfortably under Supabase's 1000-row cap.
    watchProgressRes,
  ] = await Promise.all([
    supabase.from(REGIONS_TABLE).select("*").order("order_num"),
    // The v2 catalog has no `day` column — the new course has no clock — and
    // its sort_order is GLOBAL rather than per-day, so it needs no secondary
    // key. Ordering the v1 catalog by sort_order alone would reshuffle the
    // live map, so the two genuinely differ.
    IS_STAGING_CATALOG
      ? supabase.from(LESSONS_TABLE).select("*").order("sort_order")
      : supabase.from(LESSONS_TABLE).select("*").order("day").order("sort_order"),
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
    // v75.55: explicit column list — NEVER select * here. The row also
    // carries access_token/refresh_token (the student's Whop OAuth
    // credentials); select("*") shipped them to the browser in the
    // dashboard payload. The client only reads the sync diagnostics.
    supabase
      .from("student_whop_sync")
      .select(
        "student_id, last_sync_at, last_sync_error, last_sync_error_at, last_sync_unmatched, last_sync_fetched, last_sync_matched, updated_at",
      )
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
    // v93 — explicit column list, not select(*): the row also carries
    // heartbeat_count and first_played_at, which the client has no use for.
    // The client reads max/last position to resume playback and draw the
    // in-progress state; it never decides completion from these numbers
    // (api/student/lesson-watched re-reads them server-side for that).
    supabase
      .from("student_lesson_watch")
      .select(
        "lesson_id, max_position_seconds, last_position_seconds, watched_seconds, reported_duration_seconds, threshold_met_at, last_heartbeat_at",
      )
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
    watchProgress: watchProgressRes.data ?? [],
    // Which catalog produced the rows above. The world renders a "not
    // recorded yet" slot for lessons with no video, and this tells the client
    // whether it is looking at the real course or the staging placeholders.
    catalogSuffix: CATALOG_TABLE_SUFFIX,
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
