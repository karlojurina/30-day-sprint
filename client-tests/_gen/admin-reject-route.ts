import { NextRequest, NextResponse } from "./stub-server.ts";
import { requireTeam, isAuthFailure } from "./stub-admin.ts";

/**
 * Reject a pending discount request. Team-only.
 *
 * v75.31: was anonymous — anyone with a requestId could mark a row
 * rejected. Now requires founder/admin/csm.
 *
 * A request that is no longer pending is left alone: 409 "This request
 * was already decided." (fix lane G1, admin-4).
 */
export async function POST(request: NextRequest) {
  const auth = await requireTeam(request, ["founder", "admin", "csm"]);
  if (isAuthFailure(auth)) return auth.error;
  const supabase = auth.supabase;

  const { requestId, reason } = await request.json();

  if (!requestId) {
    return NextResponse.json({ error: "Missing requestId" }, { status: 400 });
  }

  // Only a request still pending can be rejected. One another team member
  // (or another tab) already approved, marked applied or rejected stays as
  // it is: an approved one has a live Whop code.
  const { data: rejected, error } = await supabase
    .from("discount_requests")
    .update({
      status: "rejected",
      rejection_reason: reason || null,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", requestId)
    .eq("status", "pending")
    .select("id");

  if (error) {
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
  if (!rejected || rejected.length === 0) {
    return NextResponse.json(
      { error: "This request was already decided." },
      { status: 409 },
    );
  }

  return NextResponse.json({ success: true });
}
