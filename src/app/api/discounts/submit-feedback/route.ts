/**
 * POST /api/discounts/submit-feedback
 *
 * The new entry point for applying for the 30% discount.
 *
 * Difference from /api/discounts/request:
 *   - That endpoint creates the discount_requests row on its own; it's
 *     called as a bare Apply click.
 *   - This endpoint creates the row AND the 6 feedback responses atomically
 *     via the submit_discount_with_feedback Postgres function (v29).
 *
 * Body:
 *   {
 *     studentId: string,
 *     answers: [
 *       { question_id, answer_scale?, answer_choice?, answer_text? },
 *       ...
 *     ]
 *   }
 *
 * Returns: { request_id } on success.
 *
 * The legacy /api/discounts/request route is still wired and works
 * (the W2.6 hook + admin queue still depend on a pending row landing
 * in discount_requests) — but the dashboard widget now points here.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { DISCOUNT_WINDOW_DAYS } from "@/lib/constants";
import { onDiscountRequested } from "@/lib/csm-events";

interface IncomingAnswer {
  question_id?: unknown;
  answer_scale?: unknown;
  answer_choice?: unknown;
  answer_text?: unknown;
}

export async function POST(request: NextRequest) {
  // v75.31: student-self auth. Previously this route was anonymous
  // and trusted body.studentId. Now we derive studentId from the JWT.
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

  const { data: authedStudent } = await supabase
    .from("students")
    .select("id")
    .eq("supabase_user_id", user.id)
    .single();
  if (!authedStudent) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }
  const studentId = authedStudent.id;

  const body = await request.json().catch(() => null);
  const rawAnswers = Array.isArray(body?.answers) ? body.answers : null;
  if (!rawAnswers) {
    return NextResponse.json({ error: "Missing answers" }, { status: 400 });
  }

  // Coerce answers to the RPC shape — values must be strings or null in
  // the jsonb so the function can cast them server-side cleanly.
  const answers = (rawAnswers as IncomingAnswer[]).map((a) => ({
    question_id: typeof a.question_id === "string" ? a.question_id : null,
    answer_scale:
      typeof a.answer_scale === "number" ? String(a.answer_scale) : "",
    answer_choice:
      typeof a.answer_choice === "string" ? a.answer_choice : "",
    answer_text: typeof a.answer_text === "string" ? a.answer_text : "",
  }));
  if (answers.some((a) => !a.question_id)) {
    return NextResponse.json(
      { error: "Every answer must include question_id" },
      { status: 400 },
    );
  }

  // Re-validate the eligibility window (server-side defense — same
  // rule as /api/discounts/request).
  const { data: student } = await supabase
    .from("students")
    .select("joined_at, first_paid_at")
    .eq("id", studentId)
    .single();
  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  // v75.18: discount window anchored on first_paid_at (original
  // signup), not joined_at (current cycle start).
  // v75.26: NULL first_paid_at → ineligible (no joined_at fallback).
  if (!student.first_paid_at) {
    return NextResponse.json(
      {
        error:
          "We can't verify your signup date right now — please contact support and we'll sort it out within 24h.",
      },
      { status: 400 },
    );
  }
  const joinedAt = new Date(student.first_paid_at);
  const deadline = new Date(
    joinedAt.getTime() + DISCOUNT_WINDOW_DAYS * 86_400_000,
  );
  if (new Date() > deadline) {
    return NextResponse.json(
      {
        error: `The ${DISCOUNT_WINDOW_DAYS}-day discount window has closed.`,
      },
      { status: 400 },
    );
  }

  // Atomic insert via the v29 RPC function.
  //
  // The RPC has an internal authorization guard (auth.uid() must match
  // the student or be a team member). The service-role client above has
  // no user identity — auth.uid() is null there — so calling the RPC
  // through it makes the guard raise "Not authorized" and nothing is
  // written. Call it through a client carrying the student's own JWT so
  // auth.uid() resolves to them and the guard passes. The inserts still
  // run with the function's security-definer privileges (RLS-exempt).
  const userClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    },
  );
  const { data, error } = await userClient.rpc(
    "submit_discount_with_feedback",
    {
      p_student_id: studentId,
      p_answers: answers,
    },
  );

  if (error) {
    return NextResponse.json(
      { error: error.message ?? "Submit failed" },
      { status: 400 },
    );
  }

  const requestId = typeof data === "string" ? data : null;

  // CSM W2.6 admin task (best-effort).
  if (requestId) await onDiscountRequested(supabase, studentId);

  return NextResponse.json({ request_id: requestId });
}
