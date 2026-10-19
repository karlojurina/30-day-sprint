import { NextRequest, NextResponse } from "./stub-server.ts";
import { requireTeam, isAuthFailure } from "./stub-admin.ts";

/**
 * Mark an approved discount request as "applied".
 *
 * Astrid calls this after she has manually attached the generated
 * promo code to the student's Whop subscription in the Whop dashboard.
 * It's the audit step that closes the loop — gives us a clean view
 * of which approved discounts are still pending action vs. fully done.
 *
 * v75.31: was anonymous — anyone with a requestId could mark a row
 * applied. Now requires founder/admin/csm.
 *
 * Body:
 *   requestId — id of the discount_requests row (required)
 *   appliedBy — ignored. applied_by is the logged-in team member, never
 *               what the browser sends (admin PRD review, 2026-10-19).
 */
export async function POST(request: NextRequest) {
  const auth = await requireTeam(request, ["founder", "admin", "csm"]);
  if (isAuthFailure(auth)) return auth.error;
  const supabase = auth.supabase;

  const body = await request.json();
  const { requestId } = body as {
    requestId?: string;
  };

  if (!requestId) {
    return NextResponse.json({ error: "Missing requestId" }, { status: 400 });
  }

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
      { error: `Only an approved request can be marked applied. This one is "${discountReq.status}".` },
      { status: 400 }
    );
  }

  const { error: updateError } = await supabase
    .from("discount_requests")
    .update({
      status: "applied",
      applied_at: new Date().toISOString(),
      applied_by: auth.teamMember.id,
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
