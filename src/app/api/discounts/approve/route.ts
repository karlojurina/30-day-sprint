import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
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
  const body = await request.json();
  const { requestId, reviewerId } = body as {
    requestId?: string;
    reviewerId?: string;
  };

  if (!requestId) {
    return NextResponse.json({ error: "Missing requestId" }, { status: 400 });
  }

  const supabase = createServiceClient();

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
    .select("id, joined_at, ad_submissions_verified")
    .eq("id", discountReq.student_id)
    .single();

  if (!studentRow) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  if (!studentRow.ad_submissions_verified) {
    return NextResponse.json(
      {
        error:
          "Ad submissions not verified yet — tick the verification flag on the student's detail page first",
      },
      { status: 400 }
    );
  }

  const joinedAt = new Date(studentRow.joined_at);
  const deadline = new Date(
    joinedAt.getTime() + DISCOUNT_WINDOW_DAYS * 86_400_000
  );

  const [{ data: requiredLessons }, { data: completions }] = await Promise.all([
    supabase.from("lessons").select("id").in("region_id", ["r1", "r2"]),
    supabase
      .from("student_lesson_completions")
      .select("lesson_id, completed_at")
      .eq("student_id", discountReq.student_id),
  ]);

  const requiredIds = new Set((requiredLessons ?? []).map((l) => l.id));
  const completionMap = new Map<string, string>();
  for (const c of completions ?? []) {
    if (c.completed_at) completionMap.set(c.lesson_id, c.completed_at);
  }

  let latestCompletion = joinedAt;
  for (const id of requiredIds) {
    const at = completionMap.get(id);
    if (!at) {
      return NextResponse.json(
        { error: "Student has not completed all required R1 + R2 lessons" },
        { status: 400 }
      );
    }
    const d = new Date(at);
    if (d > latestCompletion) latestCompletion = d;
  }

  if (latestCompletion > deadline) {
    return NextResponse.json(
      { error: "Student finished R1 + R2 after the discount window closed" },
      { status: 400 }
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
