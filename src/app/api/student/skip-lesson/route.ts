import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * Skip / un-skip a lesson. Only meaningful for grouped/optional
 * lessons (the editing breakdowns). Skipped lessons count toward
 * path progression so the student keeps moving — the skipped_at
 * timestamp lets the journal/workshop differentiate them later.
 *
 * Toggle semantics:
 *   - Existing row + skipped_at set → un-skip (delete row, free state)
 *   - Existing row + completed_at set → no-op (don't trample a watched row)
 *   - No row → insert with skipped_at = now()
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const token = authHeader.slice(7);
  const { lessonId } = await request.json();

  if (!lessonId) {
    return NextResponse.json({ error: "Missing lessonId" }, { status: 400 });
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

  const { data: existing } = await supabase
    .from("student_lesson_completions")
    .select("id, completed_at, skipped_at")
    .eq("student_id", student.id)
    .eq("lesson_id", lessonId)
    .maybeSingle();

  if (existing) {
    if (existing.completed_at) {
      // Lesson is watched — don't trample. Returning the existing row
      // is the safest behavior: caller should never call skip on a
      // watched lesson.
      return NextResponse.json({ action: "noop", completion: existing });
    }
    if (existing.skipped_at) {
      // Already skipped — toggle off
      await supabase
        .from("student_lesson_completions")
        .delete()
        .eq("id", existing.id);
      return NextResponse.json({ action: "unskipped" });
    }
  }

  const { data, error } = await supabase
    .from("student_lesson_completions")
    .insert({
      student_id: student.id,
      lesson_id: lessonId,
      completed_at: null,
      skipped_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ action: "skipped", completion: data });
}
