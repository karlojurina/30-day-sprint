import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/student/increment-region-quiz-attempts
 *
 * Increments student_region_quiz.quiz_attempts for the (student,
 * region) pair. Fires every time the student opens the region quiz
 * modal - whether they finish or bail. Tracks engagement, not
 * passes (passes use mark-region-quiz-passed).
 *
 * Body: { regionId: "r1" | "r2" | "r3" | "r4" }
 *
 * Idempotent semantics: each successful call adds 1. Callers
 * should fire it ONCE per modal-open, not per render. The client
 * code de-dupes via a ref so React StrictMode double-renders don't
 * double-increment.
 *
 * v54 - new endpoint for the brief-region-quiz gate.
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

  // Read-then-write to avoid Postgres needing a sequence. Race
  // window is small (single user, single tab); on collision the
  // worst case is one missed increment, which is acceptable for
  // engagement telemetry.
  const { data: existing } = await supabase
    .from("student_region_quiz")
    .select("quiz_attempts")
    .eq("student_id", student.id)
    .eq("region_id", regionId)
    .maybeSingle();

  const nextAttempts = (existing?.quiz_attempts ?? 0) + 1;

  const { error } = await supabase.from("student_region_quiz").upsert(
    {
      student_id: student.id,
      region_id: regionId,
      quiz_attempts: nextAttempts,
      updated_at: now,
    },
    { onConflict: "student_id,region_id" },
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, quiz_attempts: nextAttempts });
}
