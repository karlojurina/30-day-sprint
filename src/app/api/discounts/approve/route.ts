import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { DISCOUNT_WINDOW_DAYS } from "@/lib/constants";

/**
 * Approve a pending discount request.
 *
 * As of the manual-application workflow change, this route NO LONGER
 * auto-generates a Whop promo code. The admin applies a pre-created
 * coupon directly to the student's Whop subscription via the Whop
 * dashboard, then calls this endpoint to mark our row done.
 *
 * Body:
 *   requestId      — id of the discount_requests row (required)
 *   appliedCode    — optional text reference for the code the admin
 *                    applied. Stored in promo_code for our audit
 *                    trail; student never sees it.
 *   notes          — optional internal note
 *
 * Eligibility guards remain (R1+R2 complete within window, ad
 * submissions verified) so a misclick can't approve someone who
 * doesn't actually qualify.
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { requestId, appliedCode, notes } = body as {
    requestId?: string;
    appliedCode?: string;
    notes?: string;
  };

  if (!requestId) {
    return NextResponse.json({ error: "Missing requestId" }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Fetch the discount request
  const { data: discountReq, error: fetchError } = await supabase
    .from("discount_requests")
    .select("*, student:students(*)")
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

  // Eligibility checks — same as before.
  const { data: studentRow } = await supabase
    .from("students")
    .select("joined_at, ad_submissions_verified")
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

  const [{ data: requiredLessons }, { data: completions }] = await Promise.all(
    [
      supabase.from("lessons").select("id").in("region_id", ["r1", "r2"]),
      supabase
        .from("student_lesson_completions")
        .select("lesson_id, completed_at")
        .eq("student_id", discountReq.student_id),
    ]
  );

  const requiredIds = new Set((requiredLessons ?? []).map((l) => l.id));
  const completionMap = new Map<string, string>();
  for (const c of completions ?? []) completionMap.set(c.lesson_id, c.completed_at);

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

  // Mark approved. Store the applied code for our audit trail but
  // the student never sees it — the celebration just confirms the
  // discount was applied to their Whop account.
  const update: Record<string, unknown> = {
    status: "approved",
    reviewed_at: new Date().toISOString(),
  };
  if (appliedCode && appliedCode.trim().length > 0) {
    update.promo_code = appliedCode.trim();
  }
  if (notes && notes.trim().length > 0) {
    update.rejection_reason = notes.trim(); // reusing column for any admin note
  }

  const { error: updateError } = await supabase
    .from("discount_requests")
    .update(update)
    .eq("id", requestId);

  if (updateError) {
    console.error("Failed to update discount request:", updateError);
    return NextResponse.json(
      { error: "Failed to update request" },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
