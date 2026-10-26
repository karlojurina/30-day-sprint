import { NextRequest, NextResponse } from "./stub-server.ts";
import { randomUUID } from "crypto";
import { requireTeam, isAuthFailure } from "./stub-server.ts";
import { putThirtyOn, thirtyApprovalChecks, type ThirtyResult } from "./thirty-apply.ts";

/**
 * Approve a pending discount request, or Try again on an approved one.
 *
 * APPROVE (a pending request; founder, admin or csm):
 *   0. The checks (thirtyApprovalChecks, src/lib/thirty-apply.ts, moved there
 *      from this file by the 30% that applies itself, T-137, so the job runs
 *      the same ones before it makes a new code; every refusal's status and
 *      body as this route gave them):
 *      - the coupon (admin rebuild 2, D5): a student who already has a coupon
 *        gets no 30%, whatever the rule says and with `override` too. Whop is
 *        asked now (checkMembershipDiscount, the owner's rule since T-122's
 *        third fix round), then the stored row this rule wrote. The refusal is
 *        a 400 with code "has-discount" naming the code. With neither an
 *        answer from Whop nor a stored row that answers, the normal Approve is
 *        refused once the rule has had its say (503, code "rule"). Since
 *        2026-10-26 a no coupon for which Whop does not show both a paid
 *        course plan and a course payment that went through refuses the
 *        normal Approve too (400, code "rule", UNPAID_APPROVAL).
 *      - the course's 30% rule (approvalVerdict at the request's own date,
 *        the course switch read): a refusal carries code "rule".
 *   1. Approve anyway (`override`, `overrideCoupon`) is recorded as an
 *      `override` event (discount_request_events, v116: actor team, the member,
 *      detail {rule, coupon}).
 *   2. The 30% goes on (putThirtyOn, the team as the actor): the request is
 *      claimed, its code made on Whop under a random name (ECOM30- and 6
 *      characters), approved, attached to the student's course membership,
 *      and marked applied once Whop names the code there. A trial and a code
 *      with the old per-student name, which the app leaves alone, go on for
 *      the team.
 *
 * TRY AGAIN (an approved request; every team role): no checks; putThirtyOn
 * asks Whop where the code is, attaches it (the old per-student name too) and
 * marks it applied when it is on the student's own membership. It replaced
 * Mark code applied (POST /api/discounts/mark-applied, deleted).
 *
 * APPROVE ANYWAY (the owner's review, 2026-10-21: a founder or an admin can
 * approve past any check). `override` skips the 30% rule; `overrideCoupon`
 * skips the coupon check. Each is a founder's or an admin's: a csm sending
 * either is refused with a 403 before anything is read. Anything else than a
 * pending or an approved request: 400 "Request already processed".
 *
 * Every 200 answers { success, status, promoCode, whopPromoId, reason, step,
 * membershipStatus, message }: success when the request ended approved or
 * applied, and with the reason (and Whop's words) when the code is not on the
 * membership yet. The other answers (PRD §9.4's table): the create refused
 * (Whop's 4xx) 502 with Whop's words, the request still pending; the app
 * claiming the request right now 409; the request decided while Whop made the
 * code 409 (the code must be deleted in Whop); Whop attaching the code after
 * the request was rejected 409; the code made but its saving failed 500;
 * v116 not pasted 503; the request decided already 400. A database failure
 * the step has no answer for is a 500 asking for a refresh.
 *
 * The app never shows the student the code, and /api/student/data doesn't
 * send it. It is no secret from them all the same: a logged-in student can
 * read their own row straight from the database (the policy "Students can
 * read own discount requests"), so what the code can take off is set by
 * WHOP_DISCOUNT_PLAN_IDS (thirty-apply.ts).
 *
 * Body:
 *   requestId      — id of the discount_requests row (required)
 *   override       — Approve anyway: skips the 30% rule (founder or admin)
 *   overrideCoupon — Approve anyway on a row the coupon refuses: skips the
 *                    coupon check (founder or admin)
 *   reviewerId     — ignored. The reviewer recorded (reviewed_by, applied_by,
 *                    the events and the Approve anyway log line) is the
 *                    logged-in team member, never what the browser sends
 *                    (admin PRD review, 2026-10-19).
 */

// The 30% that applies itself (T-137): the code is made and attached in this request, inside its own time limit.
export const maxDuration = 30;

/** The request's answer once the step ran, as PRD §9.4's table has it. */
function answerFor(r: ThirtyResult): NextResponse {
  const code = r.promoCode ?? "the code";
  const body = (success: boolean) => ({
    success,
    status: r.status,
    promoCode: r.promoCode,
    whopPromoId: r.whopPromoId,
    reason: r.reason,
    step: r.step,
    membershipStatus: r.membershipStatus,
    message: r.message,
  });
  switch (r.outcome) {
    case "applied":
      return NextResponse.json(body(true));
    case "waiting":
      if (r.status === "approved") return NextResponse.json(body(true));
      // Whop refused to make the code (a 4xx): the claim was given back, nothing was made.
      if (r.reason === "code_not_made") {
        return NextResponse.json(
          { error: `Couldn't create the promo code on Whop. The request is still pending. Details: ${r.message ?? "Whop gave no reason."}` },
          { status: 502 },
        );
      }
      return NextResponse.json(body(false));
    case "claimed_elsewhere":
      return NextResponse.json({ error: "The app is making this code right now. Refresh in a few minutes." }, { status: 409 });
    case "decided_meanwhile":
      return NextResponse.json(
        { error: `The Whop code ${code} was created, but this request had already been decided, so the code must be deleted in Whop.` },
        { status: 409 },
      );
    case "ended_rejected":
      return NextResponse.json(
        {
          error:
            r.confirmed === false
              ? `Whop may have attached ${code} after the request was rejected. Check their membership in Whop.`
              : `Whop attached ${code} after the request was rejected. It can only come off in Whop.`,
        },
        { status: 409 },
      );
    case "write_error":
      return NextResponse.json(
        { error: `Whop made ${code}, but saving it failed. The app picks it up on its next try; leave it in Whop.` },
        { status: 500 },
      );
    case "not_ready":
      return NextResponse.json({ error: "The 30% update isn't finished on the database (v116). Nothing was made." }, { status: 503 });
    case "unchanged":
    case "planned":
      return NextResponse.json({ error: "Request already processed" }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  const startedAtMs = Date.now();
  // v75.31: TEAM-only. Previously this route was anonymous — anyone
  // who knew a requestId could trigger Whop promo code minting.
  // Now requires a founder/admin/csm team member JWT.
  const auth = await requireTeam(request, ["founder", "admin", "csm"]);
  if (isAuthFailure(auth)) return auth.error;
  const supabase = auth.supabase;

  const body = await request.json();
  const { requestId, override, overrideCoupon } = body as {
    requestId?: string;
    // v77: team can force-approve past the eligibility gates.
    // The admin reviews every application manually and is the control,
    // surfaced as Approve anyway on the 30% page.
    override?: boolean;
    // The owner's review (2026-10-21): past the coupon check too.
    overrideCoupon?: boolean;
  };

  if (!requestId) {
    return NextResponse.json({ error: "Missing requestId" }, { status: 400 });
  }

  // Approve anyway is a founder's or an admin's (the owner's review,
  // 2026-10-21): the page shows it to them alone, and a csm's override is
  // refused here before anything is read or made.
  if ((override || overrideCoupon) && auth.teamMember.role !== "founder" && auth.teamMember.role !== "admin") {
    return NextResponse.json({ error: "Only a founder or an admin can approve past a check." }, { status: 403 });
  }

  const { data: discountReq, error: fetchError } = await supabase
    .from("discount_requests")
    .select("id, student_id, status, created_at")
    .eq("id", requestId)
    .single();

  if (fetchError || !discountReq) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

  const teamMemberId = auth.teamMember.id;
  const actor = { kind: "team" as const, teamMemberId };
  // One action: one correlation id on its event and on every write the step makes.
  const correlationId = randomUUID();
  const deadlineMs = Math.min(Date.now() + 20_000, startedAtMs + 26_000);

  let result: ThirtyResult;
  try {
    if (discountReq.status === "pending") {
      const checks = await thirtyApprovalChecks(supabase, discountReq, { override, overrideCoupon, teamMemberId });
      if (!checks.ok) return NextResponse.json(checks.body, { status: checks.status });

      if (override || overrideCoupon) {
        // Approve anyway, in the request's history. A write that fails is logged and stops nothing.
        const { error: eventError } = await supabase.from("discount_request_events").insert({
          request_id: discountReq.id,
          student_id: discountReq.student_id,
          event: "override",
          actor: "team",
          team_member_id: teamMemberId,
          correlation_id: correlationId,
          detail: { rule: override === true, coupon: overrideCoupon === true },
        });
        if (eventError) {
          console.error(`[discount approve] request ${requestId}: the Approve anyway event was not written: ${eventError.message}`);
        }
      }

      result = await putThirtyOn(supabase, requestId, {
        actor,
        correlationId,
        membershipId: checks.coupon?.membershipId ?? null,
        deadlineMs,
      });
    } else if (discountReq.status === "approved") {
      // Try again: no checks; the code with the old per-student name is attached too.
      result = await putThirtyOn(supabase, requestId, { actor, correlationId, deadlineMs, allowOldName: true });
    } else {
      return NextResponse.json({ error: "Request already processed" }, { status: 400 });
    }
  } catch (e) {
    console.error(
      `[discount approve] request ${requestId}: putting the 30% on failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return NextResponse.json(
      { error: "Something failed while putting the 30% on. Refresh the list to see where the request stands." },
      { status: 500 },
    );
  }

  return answerFor(result);
}
