import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { updateStudentStreak } from "../_lib/update-streak";

/**
 * POST /api/student/mark-action-shipped
 *
 * Toggles the action_completed_at column on a compound lesson's
 * completion row. Used when the student manually clicks "I shipped
 * the ad" (or undoes it) on a compound lesson in the LessonSheet.
 *
 * Safe to call on a row that doesn't yet exist (creates it with only
 * action_completed_at set, completed_at=null) or that already has the
 * watch part stored.
 *
 * Body: { lessonId: string, shipped: boolean }
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const token = authHeader.slice(7);
  const { lessonId, shipped } = await request.json();
  if (!lessonId || typeof shipped !== "boolean") {
    return NextResponse.json(
      { error: "Missing lessonId or shipped" },
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

  // Verify the lesson is actually compound — refuse to set action state
  // on a non-compound lesson so we don't end up with weird half-rows.
  const { data: lesson } = await supabase
    .from("lessons")
    .select("id, requires_action")
    .eq("id", lessonId)
    .single();
  if (!lesson || !lesson.requires_action) {
    return NextResponse.json(
      { error: "Not a compound lesson" },
      { status: 400 }
    );
  }

  const newActionTimestamp = shipped ? new Date().toISOString() : null;

  // Check existing row
  const { data: existing } = await supabase
    .from("student_lesson_completions")
    .select("id, completed_at, action_completed_at")
    .eq("student_id", student.id)
    .eq("lesson_id", lessonId)
    .single();

  let result;
  if (existing) {
    // If unsetting AND completed_at is also null, drop the row entirely
    if (!shipped && !existing.completed_at) {
      await supabase
        .from("student_lesson_completions")
        .delete()
        .eq("id", existing.id);
      result = null;
    } else {
      const { data, error } = await supabase
        .from("student_lesson_completions")
        .update({ action_completed_at: newActionTimestamp })
        .eq("id", existing.id)
        .select()
        .single();
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      result = data;
    }
  } else {
    // No existing row — create one with only the action half if shipping;
    // do nothing if unshipping (nothing to unship).
    if (!shipped) {
      return NextResponse.json({ completion: null });
    }
    const { data, error } = await supabase
      .from("student_lesson_completions")
      .insert({
        student_id: student.id,
        lesson_id: lessonId,
        completed_at: null,
        action_completed_at: newActionTimestamp,
      })
      .select()
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    result = data;
  }

  // Update streak only if we just newly fully-completed (both halves)
  if (
    shipped &&
    result &&
    result.completed_at &&
    result.action_completed_at
  ) {
    await updateStudentStreak(supabase, student.id);
  }

  return NextResponse.json({ completion: result });
}
