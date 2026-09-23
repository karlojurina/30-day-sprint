import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { LESSONS_TABLE } from "@/lib/catalog-tables";
import { judgeWatch, WATCH_PLAYED_FLOOR } from "@/lib/world/watch-rules";
import {
  afterCompletionWrite,
  stampWatchCompletion,
} from "@/lib/complete-lesson";

/**
 * "I finished watching this." The server decides whether that is true.
 *
 * THE CLIENT IS NOT ASKED FOR EVIDENCE. This route takes a lesson id and
 * nothing else. It re-reads `student_lesson_watch` server-side — the table the
 * browser cannot write, because v93 gave it SELECT policies and no others —
 * and applies the rules itself. A student calling this by hand from devtools
 * gets exactly the same answer as the player does, which is the point.
 *
 * NO MEMBERSHIP CHECK HERE, deliberately, and it is not an oversight. The
 * paywall sits on PLAYBACK: /api/student/video-token refuses to mint a URL for
 * anyone whose membership is not active, so a lapsed student generates no
 * heartbeats. This route only ratifies watching that already happened. Gating
 * it too would mean a student whose card fails in the last minute of a lesson
 * loses the lesson they just watched, which is punishing the wrong person.
 *
 * Idempotent: calling it repeatedly on a finished lesson returns the same
 * answer and writes nothing new.
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const token = authHeader.slice(7);

  let lessonId: unknown;
  try {
    ({ lessonId } = await request.json());
  } catch {
    return NextResponse.json({ error: "Malformed body" }, { status: 400 });
  }
  if (typeof lessonId !== "string" || !lessonId) {
    return NextResponse.json({ error: "Missing lessonId" }, { status: 400 });
  }

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

  const { data: lesson } = await supabase
    .from(LESSONS_TABLE)
    .select("id, type, duration_seconds")
    .eq("id", lessonId)
    .single();
  if (!lesson) {
    return NextResponse.json({ error: "Lesson not found" }, { status: 404 });
  }
  if (lesson.type !== "watch") {
    return NextResponse.json(
      { error: "Not a watch lesson" },
      { status: 400 },
    );
  }

  const { data: watch } = await supabase
    .from("student_lesson_watch")
    .select(
      "max_position_seconds, watched_seconds, reported_duration_seconds, threshold_met_at",
    )
    .eq("student_id", student.id)
    .eq("lesson_id", lessonId)
    .maybeSingle();

  const verdict = judgeWatch(watch ?? null, lesson.duration_seconds ?? null);

  if (!verdict.complete) {
    return NextResponse.json({
      completed: false,
      reason: verdict.reason,
      // Returned so a support conversation can be about numbers rather than
      // about whether the student is lying.
      positionRatio: Number(verdict.positionRatio.toFixed(4)),
      playedRatio: Number(verdict.playedRatio.toFixed(4)),
      playedFloor: WATCH_PLAYED_FLOOR,
    });
  }

  const stamped = await stampWatchCompletion(supabase, student.id, lessonId);
  if (stamped.error) {
    return NextResponse.json({ error: stamped.error }, { status: 500 });
  }

  // Already done on an earlier call: return success without re-running the
  // chain, so a retry cannot double-count a streak or re-fire a celebration.
  if (stamped.alreadyComplete) {
    return NextResponse.json({ completed: true, newAchievements: [] });
  }

  const { newAchievements } = await afterCompletionWrite(supabase, student.id);

  return NextResponse.json({ completed: true, newAchievements });
}
