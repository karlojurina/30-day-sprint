import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/student/submit-region-quiz
 *
 * Submits a single completed attempt of a region quiz. Replaces
 * the v54 split of mark-region-quiz-passed + increment-region-quiz-
 * attempts which were two round-trips for what is conceptually one
 * event ("the student finished an attempt").
 *
 * Body: { regionId, scorePct }   scorePct is 0-100 int
 *
 * Semantics (v65 - per Karlo's overhaul):
 *   - attempts increments by 1
 *   - last_score_pct + last_attempt_at always update
 *   - best_score_pct climbs but never falls
 *   - quiz_passed_at stamps on the first attempt at >= 50%, sticky
 *     thereafter (a later worse score doesn't un-pass them)
 *
 * Read-then-upsert is safe here - the only writer is the student's
 * own modal, which is single-threaded. Same pattern as the old
 * mark-region-quiz-passed route.
 *
 * Returns:
 *   { ok, passed: bool, best_score_pct, last_score_pct,
 *     quiz_attempts, quiz_passed_at }
 *   passed reflects the OVERALL pass state (best ever >= 50%), not
 *   just this attempt. UI uses it to decide whether to unlock the
 *   Onward gate.
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

  let body: { regionId?: string; scorePct?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const regionId = body.regionId;
  if (!regionId || !["r1", "r2", "r3", "r4"].includes(regionId)) {
    return NextResponse.json({ error: "Invalid regionId" }, { status: 400 });
  }

  const scorePct = body.scorePct;
  if (
    typeof scorePct !== "number" ||
    !Number.isFinite(scorePct) ||
    scorePct < 0 ||
    scorePct > 100
  ) {
    return NextResponse.json(
      { error: "scorePct must be a number 0-100" },
      { status: 400 },
    );
  }
  const scorePctInt = Math.round(scorePct);

  const { data: student } = await supabase
    .from("students")
    .select("id")
    .eq("supabase_user_id", user.id)
    .single();
  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  const { data: existing } = await supabase
    .from("student_region_quiz")
    .select("quiz_passed_at, quiz_attempts, best_score_pct")
    .eq("student_id", student.id)
    .eq("region_id", regionId)
    .maybeSingle();

  const now = new Date().toISOString();
  const newBest = Math.max(scorePctInt, existing?.best_score_pct ?? 0);
  const newAttempts = (existing?.quiz_attempts ?? 0) + 1;
  const stampPassed =
    !existing?.quiz_passed_at && scorePctInt >= 50 ? now : null;

  const { error } = await supabase.from("student_region_quiz").upsert(
    {
      student_id: student.id,
      region_id: regionId,
      quiz_attempts: newAttempts,
      best_score_pct: newBest,
      last_score_pct: scorePctInt,
      last_attempt_at: now,
      quiz_passed_at: existing?.quiz_passed_at ?? stampPassed,
      updated_at: now,
    },
    { onConflict: "student_id,region_id" },
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    passed: newBest >= 50,
    best_score_pct: newBest,
    last_score_pct: scorePctInt,
    quiz_attempts: newAttempts,
    quiz_passed_at: existing?.quiz_passed_at ?? stampPassed,
  });
}
