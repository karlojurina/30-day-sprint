import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/student/mark-intro-video-threshold
 *
 * Stamps `student_milestones.intro_video_threshold_met = true`. Fired
 * the moment the student's watch progress crosses ~65% during their
 * first dashboard load (or any subsequent load while the flag is
 * still false). Sticky once set - re-watches never flip it back.
 *
 * Idempotent: if the flag is already true, this is a no-op write
 * (Postgres updates the same true value, no error).
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
  const { error } = await supabase
    .from("student_milestones")
    .upsert(
      {
        student_id: student.id,
        intro_video_threshold_met: true,
        updated_at: now,
      },
      { onConflict: "student_id" },
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
