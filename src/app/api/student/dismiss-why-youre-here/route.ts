import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/student/dismiss-why-youre-here
 *
 * Stamps `student_milestones.why_youre_here_panel_dismissed = true`
 * when the student clicks "Let's go" on the final WYH card. Sticky -
 * panel never auto-fires again. Re-watches via the persistent
 * re-access button don't hit this endpoint (rewatchMode in the
 * component skips the persistence call).
 *
 * v51 - new field on student_milestones for the brief v3 WYH panel.
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
  const { error } = await supabase
    .from("student_milestones")
    .upsert(
      {
        student_id: student.id,
        why_youre_here_panel_dismissed: true,
        updated_at: now,
      },
      { onConflict: "student_id" },
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
