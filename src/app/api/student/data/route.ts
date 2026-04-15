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

  // Verify user
  const { data: { user }, error: userError } = await supabase.auth.getUser(token);
  if (userError || !user) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  // Get student record
  const { data: student } = await supabase
    .from("students")
    .select("*")
    .eq("supabase_user_id", user.id)
    .single();

  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  const today = new Date().toISOString().split("T")[0];

  // Fetch all student data in parallel
  const [tasksRes, completionsRes, noteRes, discountRes] = await Promise.all([
    supabase.from("tasks").select("*").order("week").order("sort_order"),
    supabase
      .from("student_task_completions")
      .select("*")
      .eq("student_id", student.id),
    supabase
      .from("daily_notes")
      .select("*")
      .eq("student_id", student.id)
      .eq("note_date", today)
      .single(),
    supabase
      .from("discount_requests")
      .select("*")
      .eq("student_id", student.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single(),
  ]);

  return NextResponse.json({
    student,
    tasks: tasksRes.data ?? [],
    completions: completionsRes.data ?? [],
    todayNote: noteRes.data ?? null,
    discountRequest: discountRes.data ?? null,
  });
}
