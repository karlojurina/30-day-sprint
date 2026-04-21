import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { updateStudentStreak } from "../_lib/update-streak";

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

  const { data: { user }, error: userError } = await supabase.auth.getUser(token);
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

  // Check if lesson is already completed
  const { data: existing } = await supabase
    .from("student_lesson_completions")
    .select("id")
    .eq("student_id", student.id)
    .eq("lesson_id", lessonId)
    .single();

  if (existing) {
    await supabase
      .from("student_lesson_completions")
      .delete()
      .eq("id", existing.id);

    await updateStudentStreak(supabase, student.id);

    return NextResponse.json({ action: "unchecked" });
  } else {
    const { data, error } = await supabase
      .from("student_lesson_completions")
      .insert({ student_id: student.id, lesson_id: lessonId })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await updateStudentStreak(supabase, student.id);

    return NextResponse.json({ action: "checked", completion: data });
  }
}
