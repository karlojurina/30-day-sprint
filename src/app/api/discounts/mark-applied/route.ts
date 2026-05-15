import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";

/**
 * Mark an approved discount request as "applied".
 *
 * Astrid calls this after she has manually attached the generated
 * promo code to the student's Whop subscription in the Whop dashboard.
 * It's the audit step that closes the loop — gives us a clean view
 * of which approved discounts are still pending action vs. fully done.
 *
 * Body:
 *   requestId — id of the discount_requests row (required)
 *   appliedBy — id of the team_member doing the marking (optional, audit only)
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { requestId, appliedBy } = body as {
    requestId?: string;
    appliedBy?: string;
  };

  if (!requestId) {
    return NextResponse.json({ error: "Missing requestId" }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { data: discountReq, error: fetchError } = await supabase
    .from("discount_requests")
    .select("status")
    .eq("id", requestId)
    .single();

  if (fetchError || !discountReq) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }

  if (discountReq.status !== "approved") {
    return NextResponse.json(
      { error: `Can't mark applied — current status is "${discountReq.status}". Only approved requests can be marked applied.` },
      { status: 400 }
    );
  }

  const { error: updateError } = await supabase
    .from("discount_requests")
    .update({
      status: "applied",
      applied_at: new Date().toISOString(),
      applied_by: appliedBy ?? null,
    })
    .eq("id", requestId);

  if (updateError) {
    console.error("Failed to mark discount applied:", updateError);
    return NextResponse.json(
      { error: "Failed to mark applied" },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
