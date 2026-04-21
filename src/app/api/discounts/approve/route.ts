import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { createWhopPromoCode } from "@/lib/whop";
import { DISCOUNT_WINDOW_DAYS } from "@/lib/constants";

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

  // V4 eligibility: all R1 + R2 lessons complete within DISCOUNT_WINDOW_DAYS
  // of the student's Whop join date.
  const { data: studentRow } = await supabase
    .from("students")
    .select("joined_at")
    .eq("id", discountReq.student_id)
    .single();

  if (!studentRow) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
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
