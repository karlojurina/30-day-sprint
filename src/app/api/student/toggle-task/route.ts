import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const token = authHeader.slice(7);
  const { taskId } = await request.json();

  if (!taskId) {
    return NextResponse.json({ error: "Missing taskId" }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  // Verify user and get student
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

  // Check if task is already completed
  const { data: existing } = await supabase
    .from("student_task_completions")
    .select("id")
    .eq("student_id", student.id)
    .eq("task_id", taskId)
    .single();

  if (existing) {
    // Uncheck: delete completion
    await supabase
      .from("student_task_completions")
      .delete()
      .eq("id", existing.id);

    // Update last_active_at
    await supabase
      .from("students")
      .update({ last_active_at: new Date().toISOString() })
      .eq("id", student.id);

    return NextResponse.json({ action: "unchecked" });
  } else {
    // Check: insert completion
    const { data, error } = await supabase
      .from("student_task_completions")
      .insert({ student_id: student.id, task_id: taskId })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Update last_active_at
    await supabase
      .from("students")
      .update({ last_active_at: new Date().toISOString() })
      .eq("id", student.id);

    return NextResponse.json({ action: "checked", completion: data });
  }
}
