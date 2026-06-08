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
import { createServiceClient } from "@/lib/supabase-server";
import { DISCOUNT_WINDOW_DAYS } from "@/lib/constants";
import { onDiscountRequested } from "@/lib/csm-events";

interface IncomingAnswer {
  question_id?: unknown;
  answer_scale?: unknown;
  answer_choice?: unknown;
  answer_text?: unknown;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const studentId =
    typeof body?.studentId === "string" ? body.studentId : null;
  const rawAnswers = Array.isArray(body?.answers) ? body.answers : null;

  if (!studentId) {
    return NextResponse.json({ error: "Missing studentId" }, { status: 400 });
  }
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

  const supabase = createServiceClient();

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
  const joinedAt = new Date(student.first_paid_at ?? student.joined_at);
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
  const { data, error } = await supabase.rpc(
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
