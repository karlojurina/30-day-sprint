import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import type { WhopWebhookPayload } from "@/types/whop";
import { createHmac } from "crypto";

function verifyWebhookSignature(
  body: string,
  signature: string | null
): boolean {
  if (!signature || !process.env.WHOP_WEBHOOK_SECRET) return false;

  const expected = createHmac("sha256", process.env.WHOP_WEBHOOK_SECRET)
    .update(body)
    .digest("hex");

  return signature === expected;
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get("x-whop-signature");

  // Verify webhook signature
  if (!verifyWebhookSignature(body, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: WhopWebhookPayload;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const supabase = createServiceClient();
  const membership = payload.data;

  switch (payload.event) {
    case "membership.activated":
    case "membership.went_valid": {
      // Create or update student record
      const { error } = await supabase.from("students").upsert(
        {
          whop_user_id: membership.user.id,
          whop_membership_id: membership.id,
          email: membership.user.email,
          name: membership.user.name,
          discord_username: membership.user.username,
          membership_status: "active",
          joined_at: membership.joined_at || new Date().toISOString(),
        },
        { onConflict: "whop_user_id" }
      );

      if (error) {
        console.error("Webhook: student upsert failed:", error);
        return NextResponse.json(
          { error: "Database error" },
          { status: 500 }
        );
      }
      break;
    }

    case "membership.deactivated":
    case "membership.went_invalid": {
      const { error } = await supabase
        .from("students")
        .update({ membership_status: "canceled" })
        .eq("whop_user_id", membership.user.id);

      if (error) {
        console.error("Webhook: student update failed:", error);
      }
      break;
    }

    case "payment.succeeded": {
      const { error } = await supabase
        .from("students")
        .update({ membership_status: "active" })
        .eq("whop_user_id", membership.user.id);

      if (error) {
        console.error("Webhook: payment update failed:", error);
      }
      break;
    }

    default:
      // Unknown event, acknowledge anyway
      break;
  }

  return NextResponse.json({ received: true });
}
