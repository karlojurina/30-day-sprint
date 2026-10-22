/**
 * POST /api/discounts/submit-feedback
 *
 * The new entry point for applying for the 30% discount.
 *
 * Difference from /api/discounts/request:
 *   - That endpoint creates the discount_requests row on its own; it's
 *     called as a bare Apply click.
 *   - This endpoint creates the row AND the 6 feedback responses atomically
 *     via the submit_discount_with_feedback Postgres function (v29), which
 *     only the service role may call since v107.
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
 *
 * The owner's review (2026-10-21), before anything is written: every active
 * question marked is_required must have an answer (requiredAnswersRefusal,
 * src/lib/discount-feedback.ts: the forms' own rule, a 400 in plain words,
 * and a 503 when the questions cannot be read), and on the new course the
 * coupon check must have run (membershipUncheckedRefusal: Whop gave no
 * answer and nothing stored answers is a 503 asking the student to try
 * again, where the request used to go through).
 *
 * The coupon check is the one /api/discounts/request makes
 * (checkMembershipDiscount, its comment names the owner's rule). Its stored
 * fallback answers "no coupon" only for a row that rule wrote, its source
 * set (v113), naming no code but the student's own (since T-122's fourth fix
 * round): a row with no source, one naming another code, and every stored
 * "no coupon" on a database without v113, give the 503 when Whop does not
 * answer.
 */

import { NextRequest, NextResponse } from "./stub-server.ts";
import { createClient } from "./stub-server.ts";
import { refuseWhileClosed } from "./student-app-gate.ts";
import { DISCOUNT_WINDOW_DAYS } from "./constants.ts";
import { onDiscountRequested } from "./stub-server.ts";
import { CATALOG_IS_V2, LESSONS_TABLE } from "./stub-server.ts";
import { checkMembershipDiscount } from "./membership-discount.ts";
import { requiredAnswersRefusal } from "./discount-feedback.ts";
import {
  SAVE_FAILED,
  decideDiscountRequest,
  loadDiscountReads,
  membershipDiscountRefusal,
  membershipUncheckedRefusal,
  secondPendingRequest,
} from "./discount-server.ts";

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

  // T-078: closed to students until the new course (lib/student-app-gate.ts).
  const closed = await refuseWhileClosed(supabase, user.id);
  if (closed) return closed;

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

  // The survey (the owner's review, 2026-10-21): every required question
  // answered, as the form asks, or nothing is written.
  const unanswered = await requiredAnswersRefusal(supabase, rawAnswers as IncomingAnswer[]);
  if (unanswered) {
    console.error(`[discounts/submit-feedback] student ${studentId}: ${unanswered.log}`);
    return NextResponse.json({ error: unanswered.error }, { status: unanswered.status });
  }

  if (CATALOG_IS_V2) {
    // The new course: the same rule and the same refusals as
    // /api/discounts/request (src/lib/world/discount.ts), decided before
    // anything is written. Any read that fails sends nothing.
    const reads = await loadDiscountReads(supabase, studentId, LESSONS_TABLE);
    const decision = decideDiscountRequest(reads, new Date());
    if (!decision.grant) {
      if (decision.log) console.error(`[discounts/submit-feedback] student ${studentId}: ${decision.log}`);
      return NextResponse.json(
        { error: decision.error, state: decision.state },
        { status: decision.status },
      );
    }
    // The coupon (admin rebuild 2, D5), as /api/discounts/request checks it:
    // the map's Apply sends here whenever the team has questions. A check
    // that could not run refuses too (the owner's review, 2026-10-21), and
    // so does one whose stored row says no coupon without a source, or
    // naming a code that is not the student's own.
    const coupon = await checkMembershipDiscount(supabase, studentId);
    if (coupon.discounted) {
      const refusal = membershipDiscountRefusal();
      return NextResponse.json({ error: refusal.error, state: refusal.state }, { status: refusal.status });
    }
    if (coupon.source === "none") {
      console.error(
        `[discounts/submit-feedback] student ${studentId}: nothing written, the coupon check could not run (${coupon.liveFail ?? "no answer"}) and nothing is stored`,
      );
      const refusal = membershipUncheckedRefusal();
      return NextResponse.json({ error: refusal.error, state: refusal.state }, { status: refusal.status });
    }
  } else {
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
  }

  // Atomic insert via the database function (v29, made the server's only by
  // v107). It is called with the service-role client above and the student
  // id taken from the token, never with the student's own session: since
  // v107 the function refuses every caller but the service role, so a
  // student can't call it straight and skip the checks above (and the
  // closed doors). Until v107 is pasted, v29's own check refuses this call
  // ("Not authorized to submit feedback for this student", in the log below)
  // and the student reads SAVE_FAILED: v107 goes in with this code.
  const { data, error } = await supabase.rpc(
    "submit_discount_with_feedback",
    {
      p_student_id: studentId,
      p_answers: answers,
    },
  );

  if (error) {
    // Two submits at the same moment both pass the function's own duplicate
    // check, and v106 refuses the second one's insert (23505). The first
    // stands, so this one is answered as a request already in review.
    const twice = secondPendingRequest(error);
    if (twice) return NextResponse.json(twice, { status: 400 });
    // Anything else (a foreign key, a bad uuid, the function's own refusal):
    // one plain sentence for the student, the real error for the server log.
    console.error(`[discounts/submit-feedback] student ${studentId}: saving the request failed`, error);
    return NextResponse.json({ error: SAVE_FAILED }, { status: 400 });
  }

  const requestId = typeof data === "string" ? data : null;

  // CSM W2.6 admin task (best-effort).
  if (requestId) await onDiscountRequested(supabase, studentId);

  return NextResponse.json({ request_id: requestId });
}
