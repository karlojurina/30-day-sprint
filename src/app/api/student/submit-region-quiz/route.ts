import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { REGION_QUIZ_REGISTRY } from "@/lib/region-quizzes";
import type { RegionId } from "@/types/database";

/**
 * POST /api/student/submit-region-quiz
 *
 * Submits a single completed attempt of a region quiz.
 *
 * v75.31: SERVER-SIDE SCORING. Previously the route trusted body.scorePct
 * verbatim, letting any student pop DevTools and POST {scorePct: 100} to
 * pass any quiz instantly. Now the route accepts a `selections` array
 * (per-question {questionId, choice}) and computes scorePct server-side
 * against REGION_QUIZ_REGISTRY's correct_answer values.
 *
 * Backward-compat: during the transition window (until all live clients
 * are running the v75.31 bundle), body.scorePct is still accepted as a
 * fallback so in-flight quiz attempts on the old client don't 400 mid-
 * submit. We log a [region-quiz LEGACY] warning whenever scorePct is
 * used so we can monitor when it's safe to drop the fallback.
 *
 * Body: {
 *   regionId: "r1" | "r2" | "r3" | "r4",
 *   selections?: Array<{questionId: string, choice: string}>,
 *   scorePct?: number  // LEGACY — only used if selections is absent
 * }
 *
 * Semantics (v65 - per Karlo's overhaul):
 *   - attempts increments by 1
 *   - last_score_pct + last_attempt_at always update
 *   - best_score_pct climbs but never falls
 *   - quiz_passed_at stamps on the first attempt at >= 50%, sticky
 *
 * Read-then-upsert is safe here - the only writer is the student's
 * own modal, which is single-threaded.
 *
 * Returns:
 *   { ok, passed, best_score_pct, last_score_pct,
 *     quiz_attempts, quiz_passed_at }
 */

interface IncomingSelection {
  questionId?: unknown;
  choice?: unknown;
}

/**
 * Score selections against the region's quiz registry. Returns the
 * computed scorePct (0-100 int) or null if the selections shape is
 * invalid for the region.
 */
function scoreServerSide(
  regionId: RegionId,
  selections: IncomingSelection[],
): number | null {
  const quiz = REGION_QUIZ_REGISTRY[regionId];
  if (!quiz) return null;
  const cards = quiz.cards;
  if (cards.length === 0) return null;

  // Build lookup of question_id → correct_answer (lowercased letter
  // or "true"/"false") so case sensitivity in the body doesn't bite.
  const correctById = new Map(
    cards.map((c) => [c.id, String(c.correct_answer).toLowerCase()]),
  );

  let correct = 0;
  // Only count one selection per question (de-dupe by questionId,
  // last selection wins to be safe in case the client double-submits).
  const seen = new Set<string>();
  for (const sel of selections) {
    const qid = typeof sel.questionId === "string" ? sel.questionId : null;
    const choice =
      typeof sel.choice === "string" ? sel.choice.toLowerCase() : null;
    if (!qid || !choice) continue;
    if (seen.has(qid)) continue;
    seen.add(qid);
    const expected = correctById.get(qid);
    if (!expected) continue; // unknown question — silently skip
    if (expected === choice) correct += 1;
  }

  return Math.round((correct / cards.length) * 100);
}
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

  let body: {
    regionId?: string;
    scorePct?: number;
    selections?: IncomingSelection[];
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const regionId = body.regionId;
  if (!regionId || !["r1", "r2", "r3", "r4"].includes(regionId)) {
    return NextResponse.json({ error: "Invalid regionId" }, { status: 400 });
  }

  // v75.31: prefer server-side scoring from selections. Fall back to
  // client-supplied scorePct only if selections is absent (transition
  // window — once we know all live clients send selections, the
  // fallback gets removed).
  let scorePctInt: number;
  if (Array.isArray(body.selections)) {
    const serverScore = scoreServerSide(regionId as RegionId, body.selections);
    if (serverScore === null) {
      return NextResponse.json(
        { error: "Could not score selections — invalid shape" },
        { status: 400 },
      );
    }
    scorePctInt = serverScore;
  } else {
    // LEGACY: client-supplied scorePct. Log every time this branch
    // hits so we can monitor when it's safe to drop the fallback.
    const scorePct = body.scorePct;
    if (
      typeof scorePct !== "number" ||
      !Number.isFinite(scorePct) ||
      scorePct < 0 ||
      scorePct > 100
    ) {
      return NextResponse.json(
        { error: "Missing selections (or legacy scorePct)" },
        { status: 400 },
      );
    }
    scorePctInt = Math.round(scorePct);
    console.warn(
      `[region-quiz LEGACY] client used scorePct fallback for region=${regionId}, user=${user.id}, score=${scorePctInt}. Update client to send selections array.`,
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
