import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/student/mark-region-quiz-passed
 *
 * Stamps student_region_quiz.quiz_passed_at for the (student, region)
 * pair. Sticky once set - the brief explicitly says the quiz is a
 * one-time gate and on next visit Onward jumps straight to the next
 * region (no re-quiz on revisits).
 *
 * Body: { regionId: "r1" | "r2" | "r3" | "r4" }
 *
 * Idempotent via upsert + .is("quiz_passed_at", null) guard so a
 * second call doesn't overwrite the original timestamp.
 *
 * v54 - new field on student_region_quiz for the brief-region-quiz
 * gate.
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

  let body: { regionId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const regionId = body.regionId;
  if (!regionId || !["r1", "r2", "r3", "r4"].includes(regionId)) {
    return NextResponse.json({ error: "Invalid regionId" }, { status: 400 });
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

  // Check existing row first so we can preserve quiz_passed_at on
  // re-pass.
  const { data: existing } = await supabase
    .from("student_region_quiz")
    .select("quiz_passed_at")
    .eq("student_id", student.id)
    .eq("region_id", regionId)
    .maybeSingle();

  if (existing?.quiz_passed_at) {
    return NextResponse.json({
      ok: true,
      already_passed: true,
      quiz_passed_at: existing.quiz_passed_at,
    });
  }

  const { error } = await supabase.from("student_region_quiz").upsert(
    {
      student_id: student.id,
      region_id: regionId,
      quiz_passed_at: now,
      updated_at: now,
    },
    { onConflict: "student_id,region_id" },
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    already_passed: false,
    quiz_passed_at: now,
  });
}
