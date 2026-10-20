import { NextRequest, NextResponse } from "./stub-server.ts";
import { requireTeam, isAuthFailure } from "./stub-admin.ts";
import { DISCOUNT_WINDOW_DAYS } from "./constants.ts";
import { createWhopPromoCode } from "./stub-admin.ts";
import { CATALOG_IS_V2, LESSONS_TABLE } from "./stub-server.ts";
import { getCurriculumResetAt } from "./curriculum-reset.ts";
import {
  approvalVerdict,
  explainOldCourseRequest,
  loadDiscountReads,
} from "./discount-server.ts";

/**
 * Approve a pending discount request.
 *
 * Flow (one click for Astrid):
 *   1. Validate eligibility: the course's 30% rule, below. Since 2026-10-20
 *      the ads are not checked (Lovro's decision: the 30% already asks for
 *      61 videos), so students.ad_submissions_verified decides nothing here.
 *   2. Call Whop API to generate a 30%-off, 1-month, single-use promo code
 *   3. Store promo_code + whop_promo_id + status='approved' on our row
 *   4. Return the code so the admin UI can show it for copy-paste
 *
 * If Whop API generation fails, we DO NOT mark the row approved —
 * Astrid retries. Better than approving without a code.
 *
 * Step 3 writes only while the row is still pending. If someone else
 * decided the request while Whop made the code, nothing is approved: 409,
 * and the code that was made has to be deleted in Whop (fix lane G1,
 * admin-4).
 *
 * After this returns, Astrid manually attaches the code to the
 * student's Whop subscription in the Whop dashboard, then calls
 * POST /api/discounts/mark-applied to close the loop.
 *
 * The app never shows the student the code, and since 2026-10-17
 * /api/student/data doesn't send it. It is no secret from them all the
 * same: a logged-in student can read their own row straight from the
 * database (the policy "Students can read own discount requests"), so what
 * the code can take off is set here, by WHOP_DISCOUNT_PLAN_IDS below.
 *
 * Body:
 *   requestId  — id of the discount_requests row (required)
 *   reviewerId — ignored. The reviewer recorded (reviewed_by, and the
 *                "Generate anyway" log line) is the logged-in team member,
 *                never what the browser sends (admin PRD review, 2026-10-19).
 */
export async function POST(request: NextRequest) {
  // v75.31: TEAM-only. Previously this route was anonymous — anyone
  // who knew a requestId could trigger Whop promo code minting.
  // Now requires a founder/admin/csm team member JWT.
  const auth = await requireTeam(request, ["founder", "admin", "csm"]);
  if (isAuthFailure(auth)) return auth.error;
  const supabase = auth.supabase;

  const body = await request.json();
  const { requestId, override } = body as {
    requestId?: string;
    // v77: team can force-approve past the eligibility gates
    // (missing first_paid_at, R1+R2 completion, window).
    // The admin reviews every application manually and is the control —
    // surfaced as the "Generate anyway" button in the admin UI.
    override?: boolean;
  };

  if (!requestId) {
    return NextResponse.json({ error: "Missing requestId" }, { status: 400 });
  }

  const { data: discountReq, error: fetchError } = await supabase
    .from("discount_requests")
    .select("*")
    .eq("id", requestId)
    .single();

  if (fetchError || !discountReq) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

  if (discountReq.status !== "pending") {
    return NextResponse.json(
      { error: "Request already processed" },
      { status: 400 }
    );
  }

  const { data: studentRow } = await supabase
    .from("students")
    .select("id, joined_at, first_paid_at")
    .eq("id", discountReq.student_id)
    .single();

  if (!studentRow) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  if (CATALOG_IS_V2) {
    // The new course: the request route's rule (src/lib/world/discount.ts),
    // judged at the end of the student's window (their 14 days, or 23
    // October for a first payment before the launch). `override` skips it,
    // as it skips every gate of the old rule below.
    if (!override) {
      const reads = await loadDiscountReads(supabase, discountReq.student_id, LESSONS_TABLE);
      // The course switch: a request made before it is judged by the videos
      // the new course had at the switch, and a refusal of it over the videos
      // says it was made on the old course. The date can change the verdict,
      // so a failed read of it approves nothing.
      let resetAt: string | null;
      try {
        resetAt = await getCurriculumResetAt(supabase);
      } catch (e) {
        console.error(
          `[discount approve] request ${requestId}: nothing approved, the course switch could not be read: ${e instanceof Error ? e.message : String(e)}`,
        );
        return NextResponse.json(
          { error: "Couldn't read the course switch date, so nothing was approved. Try again." },
          { status: 500 },
        );
      }
      // The request's id too: approvalVerdict also refuses a request the
      // app's Apply could not have made (late, or after another counted one).
      let verdict = approvalVerdict(reads, new Date(), discountReq.created_at, discountReq.id, resetAt);
      if (!verdict.ok && verdict.status === 400) {
        // A request made before the switch, refused over its videos, gets a
        // refusal that says so; one refused over the first payment keeps its
        // words.
        verdict = explainOldCourseRequest(verdict, discountReq.created_at, resetAt);
      }
      if (!verdict.ok) {
        if (verdict.log) console.error(`[discount approve] request ${requestId}: ${verdict.log}`);
        return NextResponse.json({ error: verdict.error }, { status: verdict.status });
      }
    }
  } else {
    // v75.20: anchor on first_paid_at (original signup), not joined_at
    // (current cycle start). Returning customers can't get a fresh
    // 14-day discount window from a renewal.
    // v75.26: NULL first_paid_at → block at the FINAL approval gate.
    // This is the last line of defense if the request/feedback gates
    // were somehow bypassed. The admin must manually verify the
    // student's signup history and backfill first_paid_at before
    // approving.
    if (!override && !studentRow.first_paid_at) {
      return NextResponse.json(
        {
          error:
            "Cannot approve: student has no first_paid_at on file. Run the Whop sync (Refresh on /admin) to backfill, then retry. If still NULL, this student's Whop membership history needs manual review.",
        },
        { status: 400 },
      );
    }
    // `?? 0` only matters under override (first_paid_at can be null then);
    // the resulting deadline is unused because the window check below is
    // also override-gated.
    const joinedAt = new Date(studentRow.first_paid_at ?? 0);
    const deadline = new Date(
      joinedAt.getTime() + DISCOUNT_WINDOW_DAYS * 86_400_000
    );

    // Eligibility re-check (server-side, same rule as /api/discounts/request):
    //   - Compound action items (requires_action=true): need BOTH
    //     completed_at AND action_completed_at.
    //   - Other lessons: completed_at OR skipped_at counts as done.
    const [{ data: requiredLessons }, { data: completions }] = await Promise.all([
      supabase
        .from("lessons")
        .select("id, requires_action")
        .in("region_id", ["r1", "r2"]),
      supabase
        .from("student_lesson_completions")
        .select("lesson_id, completed_at, action_completed_at, skipped_at")
        .eq("student_id", discountReq.student_id),
    ]);

    const required = requiredLessons ?? [];
    // Fails closed (cutover PRD, C22, WI-9), as the request route does: an
    // empty r1 + r2 list means the new course's data met a build without
    // CATALOG_SHAPE=v2, or the read failed, and every check below would pass.
    // "Generate anyway" skips the checks, as it does today.
    if (!override && required.length === 0) {
      return NextResponse.json(
        { error: "The course changed and this check cannot run. Nothing was approved." },
        { status: 409 },
      );
    }
    const completionMap = new Map<
      string,
      {
        completed_at: string | null;
        action_completed_at: string | null;
        skipped_at: string | null;
      }
    >();
    for (const c of completions ?? []) {
      completionMap.set(c.lesson_id, {
        completed_at: c.completed_at,
        action_completed_at: c.action_completed_at,
        skipped_at: c.skipped_at,
      });
    }

    let latestCompletion = joinedAt;
    for (const lesson of required) {
      const c = completionMap.get(lesson.id);
      const watchDone = c?.completed_at != null;
      const actionDone = c?.action_completed_at != null;
      const skipped = c?.skipped_at != null;
      const fullyDone = lesson.requires_action
        ? watchDone && actionDone
        : watchDone || skipped;
      if (!override && !fullyDone) {
        return NextResponse.json(
          { error: "Student has not completed all required R1 + R2 lessons" },
          { status: 400 }
        );
      }
      for (const ts of [c?.completed_at, c?.action_completed_at, c?.skipped_at]) {
        if (ts) {
          const d = new Date(ts);
          if (d > latestCompletion) latestCompletion = d;
        }
      }
    }

    if (!override && latestCompletion > deadline) {
      return NextResponse.json(
        { error: "Student finished R1 + R2 after the discount window closed" },
        { status: 400 }
      );
    }
  }

  if (override) {
    console.warn(
      `[discount approve] OVERRIDE by team member ${auth.teamMember.id}, request ${requestId}, student ${discountReq.student_id}. Eligibility gates skipped.`,
    );
  }

  // Generate the code via Whop API.
  // Format: ECOM30-{first 6 chars of student id, uppercased}. Stable
  // per-student so a re-run would collide on Whop's side rather than
  // silently mint a duplicate.
  const code = `ECOM30-${studentRow.id.slice(0, 6).toUpperCase()}`;

  // Optional plan scoping. If WHOP_DISCOUNT_PLAN_IDS is set, the code
  // only works on those specific plans (comma-separated plan IDs).
  // If unset, Whop's default is "all plans on the company" — which
  // covers the real student plan + Karlo's $1 test plan automatically.
  const planIds = process.env.WHOP_DISCOUNT_PLAN_IDS
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  let whopPromoId: string | null = null;
  try {
    const whopRes = await createWhopPromoCode({
      code,
      amount_off: 30,
      promo_type: "percentage",
      base_currency: "usd",
      new_users_only: false,
      one_per_customer: true,
      stock: 1,
      promo_duration_months: 1,
      ...(planIds && planIds.length > 0 ? { plan_ids: planIds } : {}),
    });
    whopPromoId = whopRes.id;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Whop promo code creation failed:", message);
    return NextResponse.json(
      {
        error: `Couldn't create the promo code on Whop. The request is still pending. Details: ${message}`,
      },
      { status: 502 }
    );
  }

  // Still pending: another team member (or another tab) may have rejected
  // the request while Whop made the code, and their decision stands.
  const { data: approvedRows, error: updateError } = await supabase
    .from("discount_requests")
    .update({
      status: "approved",
      promo_code: code,
      whop_promo_id: whopPromoId,
      reviewed_at: new Date().toISOString(),
      reviewed_by: auth.teamMember.id,
    })
    .eq("id", requestId)
    .eq("status", "pending")
    .select("id");

  if (updateError) {
    console.error("Failed to update discount request:", updateError);
    return NextResponse.json(
      { error: "Code was created on Whop but the DB update failed. Check the discount_requests row and reconcile manually." },
      { status: 500 }
    );
  }
  if (!approvedRows || approvedRows.length === 0) {
    console.error(
      `[discount approve] request ${requestId}: the Whop code ${code} (${whopPromoId}) was created, but the request had already been decided, so nothing was approved. Delete the code in Whop.`,
    );
    return NextResponse.json(
      {
        error: `The Whop code ${code} was created, but this request had already been decided, so the code must be deleted in Whop.`,
      },
      { status: 409 },
    );
  }

  return NextResponse.json({ success: true, promoCode: code, whopPromoId });
}
