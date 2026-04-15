import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { createWhopPromoCode } from "@/lib/whop";

export async function POST(request: NextRequest) {
  const { requestId } = await request.json();

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

  // Verify eligibility: check 13/13 discount tasks are completed
  const { count } = await supabase
    .from("student_task_completions")
    .select("id", { count: "exact", head: true })
    .eq("student_id", discountReq.student_id)
    .in(
      "task_id",
      await supabase
        .from("tasks")
        .select("id")
        .eq("is_discount_required", true)
        .then((r) => (r.data || []).map((t) => t.id))
    );

  if ((count || 0) < 13) {
    return NextResponse.json(
      { error: "Student has not completed all required tasks" },
      { status: 400 }
    );
  }

  // Generate a unique promo code
  const code = `ECOM30-${discountReq.student_id.slice(0, 6).toUpperCase()}`;

  try {
    // Create promo code on Whop
    const promoResult = await createWhopPromoCode({
      code,
      amount_off: 30,
      promo_type: "percentage",
      base_currency: "usd",
      new_users_only: false,
      one_per_customer: true,
      stock: 1,
      promo_duration_months: 1,
    });

    // Update the discount request
    const { error: updateError } = await supabase
      .from("discount_requests")
      .update({
        status: "approved",
        promo_code: code,
        whop_promo_id: promoResult.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", requestId);

    if (updateError) {
      console.error("Failed to update discount request:", updateError);
      return NextResponse.json(
        { error: "Failed to update request" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, code });
  } catch (err) {
    console.error("Whop promo code creation failed:", err);

    // Still approve with manual code entry
    await supabase
      .from("discount_requests")
      .update({
        status: "approved",
        promo_code: `MANUAL-${code}`,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", requestId);

    return NextResponse.json({
      success: true,
      code: `MANUAL-${code}`,
      warning: "Whop API failed — code needs to be created manually in Whop",
    });
  }
}
