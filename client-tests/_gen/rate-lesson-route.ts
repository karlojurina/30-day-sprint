import { NextRequest, NextResponse } from "./stub-server.ts";
import { createClient } from "./stub-server.ts";
import { refuseWhileClosed } from "./student-app-gate.ts";
import { isLessonComplete } from "./progress.ts";
import {
  RATING_REFUSAL_CODE,
  RATING_WORDS,
  checkRatingInput,
  ratingRefusal,
} from "./lesson-rating.ts";

/**
 * POST /api/student/rate-lesson: a student's rating of one lesson, saved
 * (admin rebuild 2, D10). The only way a rating is written: since v110 a
 * student's own database session reads their ratings and writes none.
 *
 * Body: { lessonId, stars, comment? }. Stars are whole, 1 to 5; the comment
 * is at most 1000 characters once trimmed, and empty means none.
 *
 * The rules, in src/lib/world/lesson-rating.ts, which the lesson page shows
 * its rating block by:
 *   - a signed-in student (the token), and the app open to them (T-078);
 *   - the lesson is in the live catalog, `lessons`, the table the ratings'
 *     foreign key points at;
 *   - it is a video lesson, and not the Ad Bounty lesson;
 *   - the student has finished it as the map counts it: the video watched
 *     (completed_at) and the lesson done (isLessonComplete, src/lib/progress.ts),
 *     so on an action item the hand-in is in too.
 * Then one row per student and lesson, upserted: saving again changes the
 * stars and the comment, and the table's trigger moves updated_at.
 *
 * Answers: 200 { rating: { lesson_id, stars, comment, created_at,
 * updated_at } }. Otherwise { error } (and a `code` for the three rules), in
 * a sentence the lesson page shows as it is: 400 for a body that does not
 * fit or a lesson that can't be rated, 403 for one not finished yet, 404 for
 * a lesson not in the course, 500 when a read or the save failed. A read
 * that fails is never taken for "not found" or "not finished".
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const token = authHeader.slice(7);

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

  // T-078: closed to students until the new course (lib/student-app-gate.ts).
  const closed = await refuseWhileClosed(supabase, user.id);
  if (closed) return closed;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: RATING_WORDS.unreadable }, { status: 400 });
  }
  const input = checkRatingInput(body);
  if (!input.ok) {
    return NextResponse.json({ error: input.error }, { status: 400 });
  }

  const { data: student, error: studentError } = await supabase
    .from("students")
    .select("id")
    .eq("supabase_user_id", user.id)
    .maybeSingle();
  if (studentError) {
    console.error(`[rate-lesson] the student could not be read: ${studentError.message}`);
    return NextResponse.json({ error: RATING_WORDS.readFailed }, { status: 500 });
  }
  if (!student) {
    return NextResponse.json({ error: RATING_WORDS.studentNotFound }, { status: 404 });
  }

  // The live catalog, always `lessons`: the ratings' foreign key points there.
  const [lessonRes, completionRes] = await Promise.all([
    supabase
      .from("lessons")
      .select("id, type, requires_action, feature_key")
      .eq("id", input.lessonId)
      .maybeSingle(),
    supabase
      .from("student_lesson_completions")
      .select("lesson_id, completed_at, action_completed_at, skipped_at")
      .eq("student_id", student.id)
      .eq("lesson_id", input.lessonId)
      .maybeSingle(),
  ]);
  if (lessonRes.error || completionRes.error) {
    console.error(
      `[rate-lesson] reads failed for lesson ${input.lessonId}: ${[lessonRes.error?.message, completionRes.error?.message].filter(Boolean).join("; ")}`,
    );
    return NextResponse.json({ error: RATING_WORDS.readFailed }, { status: 500 });
  }
  const lesson = lessonRes.data as
    | { id: string; type: string; requires_action: boolean; feature_key: string | null }
    | null;
  if (!lesson) {
    return NextResponse.json({ error: RATING_WORDS.lessonNotFound }, { status: 404 });
  }
  const completion = completionRes.data as
    | { lesson_id: string; completed_at: string | null; action_completed_at: string | null; skipped_at: string | null }
    | null;

  const refusal = ratingRefusal(lesson, {
    watched: Boolean(completion?.completed_at),
    done: completion !== null && isLessonComplete(completion, lesson),
  });
  if (refusal) {
    return NextResponse.json(
      { error: RATING_WORDS[refusal], code: RATING_REFUSAL_CODE[refusal] },
      { status: refusal === "not_finished" ? 403 : 400 },
    );
  }

  const { data: rating, error: upsertError } = await supabase
    .from("student_lesson_ratings")
    .upsert(
      { student_id: student.id, lesson_id: lesson.id, stars: input.stars, comment: input.comment },
      { onConflict: "student_id,lesson_id" },
    )
    .select("lesson_id, stars, comment, created_at, updated_at")
    .single();
  if (upsertError || !rating) {
    console.error(`[rate-lesson] the rating could not be saved for lesson ${lesson.id}: ${upsertError?.message ?? "no row came back"}`);
    return NextResponse.json({ error: RATING_WORDS.saveFailed }, { status: 500 });
  }

  return NextResponse.json({ rating });
}
