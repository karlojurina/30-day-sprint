import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/student/rate-lesson
 *
 * Upserts the student's rating for a single lesson. Stars are 1-5
 * (validated); comment is optional. RLS on the table enforces
 * student-only writes, but the route uses the service role + does
 * its own ownership check so the student_id never has to be sent
 * from the client.
 *
 * Body: { lessonId: string, stars: number, comment?: string | null }
 *
 * v75 - introduced with student_lesson_ratings table.
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const token = authHeader.slice(7);

  const body = (await request.json()) as {
    lessonId?: string;
    stars?: number;
    comment?: string | null;
  };
  const lessonId = body.lessonId;
  const stars = body.stars;
  const comment =
    typeof body.comment === "string" && body.comment.trim().length > 0
      ? body.comment.trim().slice(0, 2000)
      : null;

  if (!lessonId || typeof lessonId !== "string") {
    return NextResponse.json({ error: "Missing lessonId" }, { status: 400 });
  }
  if (typeof stars !== "number" || stars < 1 || stars > 5) {
    return NextResponse.json(
      { error: "stars must be an integer 1-5" },
      { status: 400 },
    );
  }
  const starsInt = Math.round(stars);

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
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

  // Confirm the lesson exists before upserting (FK would catch this
  // too, but a tidy 404 is nicer than a Postgres error).
  const { data: lessonRow } = await supabase
    .from("lessons")
    .select("id")
    .eq("id", lessonId)
    .maybeSingle();
  if (!lessonRow) {
    return NextResponse.json({ error: "Lesson not found" }, { status: 404 });
  }

  const { data: rating, error: upsertError } = await supabase
    .from("student_lesson_ratings")
    .upsert(
      {
        student_id: student.id,
        lesson_id: lessonId,
        stars: starsInt,
        comment,
      },
      { onConflict: "student_id,lesson_id" },
    )
    .select("id, student_id, lesson_id, stars, comment, created_at, updated_at")
    .single();

  if (upsertError || !rating) {
    return NextResponse.json(
      { error: upsertError?.message ?? "Failed to save rating" },
      { status: 500 },
    );
  }

  return NextResponse.json({ rating });
}
