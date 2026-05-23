import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/student/mark-dashboard-login
 *
 * Stamps `student_milestones.first_dashboard_login_at = now()` the
 * first time the student loads /dashboard post-OAuth. Distinct from
 * `students.joined_at` which fires at OAuth success - this fires
 * when they actually land on the dashboard, which is the moment we
 * want to fire the intro video gate.
 *
 * Idempotent via the `.is("first_dashboard_login_at", null)` guard -
 * subsequent loads find the timestamp already set and the update
 * matches 0 rows.
 *
 * v51 - new field on student_milestones for the brief v3 intro-
 * video gate.
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

  const { data: student } = await supabase
    .from("students")
    .select("id")
    .eq("supabase_user_id", user.id)
    .single();
  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  const now = new Date().toISOString();

  // First check if a milestones row exists. If not, insert with
  // first_dashboard_login_at set. If yes, update only when the
  // existing value is null (idempotent guard).
  const { data: existing } = await supabase
    .from("student_milestones")
    .select("first_dashboard_login_at")
    .eq("student_id", student.id)
    .maybeSingle();

  if (!existing) {
    const { error } = await supabase.from("student_milestones").insert({
      student_id: student.id,
      first_dashboard_login_at: now,
      updated_at: now,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, was_first: true });
  }

  if (existing.first_dashboard_login_at) {
    return NextResponse.json({ ok: true, was_first: false });
  }

  const { error } = await supabase
    .from("student_milestones")
    .update({
      first_dashboard_login_at: now,
      updated_at: now,
    })
    .eq("student_id", student.id)
    .is("first_dashboard_login_at", null);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, was_first: true });
}
