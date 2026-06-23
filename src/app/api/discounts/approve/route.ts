import { NextRequest, NextResponse } from "next/server";
import { requireTeam, isAuthFailure } from "@/lib/admin-auth";
import { DISCOUNT_WINDOW_DAYS } from "@/lib/constants";
import { createWhopPromoCode } from "@/lib/whop";

/**
 * Approve a pending discount request.
 *
 * Flow (one click for Astrid):
 *   1. Validate eligibility (R1+R2 done within window, ad submissions verified)
 *   2. Call Whop API to generate a 30%-off, 1-month, single-use promo code
 *   3. Store promo_code + whop_promo_id + status='approved' on our row
 *   4. Return the code so the admin UI can show it for copy-paste
 *
 * If Whop API generation fails, we DO NOT mark the row approved —
 * Astrid retries. Better than approving without a code.
 *
 * After this returns, Astrid manually attaches the code to the
 * student's Whop subscription in the Whop dashboard, then calls
 * POST /api/discounts/mark-applied to close the loop.
 *
 * The student never sees the code.
 *
 * Body:
 *   requestId  — id of the discount_requests row (required)
 *   reviewerId — id of the team_member approving (optional, audit only)
 */
export async function POST(request: NextRequest) {
  // v75.31: TEAM-only. Previously this route was anonymous — anyone
  // who knew a requestId could trigger Whop promo code minting.
  // Now requires a founder/admin/csm team member JWT.
  const auth = await requireTeam(request, ["founder", "admin", "csm"]);
  if (isAuthFailure(auth)) return auth.error;
  const supabase = auth.supabase;

  const body = await request.json();
  const { requestId, reviewerId, override } = body as {
    requestId?: string;
    reviewerId?: string;
    // v77: team can force-approve past the eligibility gates
    // (ad-verification, missing first_paid_at, R1+R2 completion, window).
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
    .select("id, joined_at, first_paid_at, ad_submissions_verified")
    .eq("id", discountReq.student_id)
    .single();

  if (!studentRow) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  if (!override && !studentRow.ad_submissions_verified) {
    return NextResponse.json(
      {
        error:
          "Ad submissions not verified yet — tick the verification flag on the student's detail page first",
      },
      { status: 400 }
    );
  }

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

  if (override) {
    console.warn(
      `[discount approve] OVERRIDE by team member ${reviewerId ?? "unknown"} — request ${requestId}, student ${discountReq.student_id}. Eligibility gates skipped.`,
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

  const { error: updateError } = await supabase
    .from("discount_requests")
    .update({
      status: "approved",
      promo_code: code,
      whop_promo_id: whopPromoId,
      reviewed_at: new Date().toISOString(),
      reviewed_by: reviewerId ?? null,
    })
    .eq("id", requestId);

  if (updateError) {
    console.error("Failed to update discount request:", updateError);
    return NextResponse.json(
      { error: "Code was created on Whop but the DB update failed. Check the discount_requests row and reconcile manually." },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, promoCode: code, whopPromoId });
}
