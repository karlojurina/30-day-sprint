import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/student/toggle-manual-todo
 *
 * Flips completed_at on a (student, todo_key) row in
 * student_manual_todos. Symmetric: null → now, now → null. Lets
 * the student undo if they tapped Mark done by accident.
 *
 * Body: { todoKey: string }
 *
 * Caller is responsible for registering which todo_keys are
 * valid - the route only validates that it's a non-empty string
 * to prevent denial-of-service via huge payloads. The widget
 * owns the registry.
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

  let body: { todoKey?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const todoKey = body.todoKey?.trim();
  if (!todoKey || todoKey.length > 64) {
    return NextResponse.json(
      { error: "todoKey must be a non-empty string up to 64 chars" },
      { status: 400 },
    );
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
    .from("student_manual_todos")
    .select("completed_at")
    .eq("student_id", student.id)
    .eq("todo_key", todoKey)
    .maybeSingle();

  const now = new Date().toISOString();
  const nextCompletedAt = existing?.completed_at ? null : now;

  const { error } = await supabase.from("student_manual_todos").upsert(
    {
      student_id: student.id,
      todo_key: todoKey,
      completed_at: nextCompletedAt,
      updated_at: now,
    },
    { onConflict: "student_id,todo_key" },
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    todo_key: todoKey,
    completed_at: nextCompletedAt,
  });
}
