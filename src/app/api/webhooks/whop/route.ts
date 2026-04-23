import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import type {
  WhopWebhookPayload,
  WhopMembership,
  WhopLessonInteractionWebhookData,
} from "@/types/whop";
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

  // Prefix everything from this handler so Vercel logs are easy to filter.
  console.info(
    `[whop-webhook] received body=${body.length}B sig=${signature ? "present" : "MISSING"}`
  );

  // Verify webhook signature
  if (!verifyWebhookSignature(body, signature)) {
    console.warn(
      `[whop-webhook] signature mismatch — rejecting. ` +
        `secret_set=${!!process.env.WHOP_WEBHOOK_SECRET}`
    );
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: WhopWebhookPayload;
  try {
    payload = JSON.parse(body);
  } catch {
    console.warn("[whop-webhook] invalid JSON body");
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  console.info(
    `[whop-webhook] event=${(payload as { event?: unknown }).event} data_keys=${Object.keys(
      (payload as { data?: Record<string, unknown> }).data ?? {}
    ).join(",")}`
  );

  const supabase = createServiceClient();

  // Whop's dashboard displays event names with underscores
  // (e.g. `membership_activated`, `course_lesson_interaction_completed`)
  // and that's also what they put in the payload's `event` field. The
  // dot-separated form seen in older docs is not what's delivered. Match
  // both forms to be safe against future changes.
  switch (payload.event) {
    case "membership.activated":
    case "membership_activated":
    case "membership.went_valid":
    case "membership_went_valid": {
      const membership = payload.data as WhopMembership;
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
    case "membership_deactivated":
    case "membership.went_invalid":
    case "membership_went_invalid": {
      const membership = payload.data as WhopMembership;
      const { error } = await supabase
        .from("students")
        .update({ membership_status: "canceled" })
        .eq("whop_user_id", membership.user.id);

      if (error) {
        console.error("Webhook: student update failed:", error);
      }
      break;
    }

    case "payment.succeeded":
    case "payment_succeeded": {
      const membership = payload.data as WhopMembership;
      const { error } = await supabase
        .from("students")
        .update({ membership_status: "active" })
        .eq("whop_user_id", membership.user.id);

      if (error) {
        console.error("Webhook: payment update failed:", error);
      }
      break;
    }

    case "course_lesson_interaction.completed":
    case "course_lesson_interaction_completed": {
      // Student finished a Whop course lesson — mark the matching lesson
      // complete in our DB. Idempotent via unique(student_id, lesson_id).
      const data = payload.data as WhopLessonInteractionWebhookData;
      // Whop's payload shape for this event has drifted across versions;
      // dump the whole thing once so we can see what fields actually
      // arrive without leaking too much unrelated data.
      console.info(
        `[whop-webhook] lesson-complete payload: ${JSON.stringify(data).slice(0, 500)}`
      );

      const whopUserId = data.user?.id;
      const whopLessonId = data.lesson?.id ?? data.lesson_id;

      if (!whopUserId || !whopLessonId) {
        console.warn(
          `[whop-webhook] lesson-complete missing ids: user=${whopUserId ?? "null"} lesson=${whopLessonId ?? "null"}`
        );
        break;
      }

      const { data: student } = await supabase
        .from("students")
        .select("id")
        .eq("whop_user_id", whopUserId)
        .single();
      if (!student) {
        console.warn(
          `[whop-webhook] student not found for whop_user_id=${whopUserId} ` +
            `(they may not have logged into the app yet)`
        );
        break;
      }

      // Look up our lesson matching this Whop lesson
      const { data: lesson } = await supabase
        .from("lessons")
        .select("id")
        .eq("whop_lesson_id", whopLessonId)
        .single();
      if (!lesson) {
        console.warn(
          `[whop-webhook] no lesson mapped to whop_lesson_id=${whopLessonId} ` +
            `(not in seed or mismatched)`
        );
        break;
      }

      const { error } = await supabase
        .from("student_lesson_completions")
        .upsert(
          { student_id: student.id, lesson_id: lesson.id },
          {
            onConflict: "student_id,lesson_id",
            ignoreDuplicates: true,
          }
        );

      if (error) {
        console.error(
          `[whop-webhook] completion upsert failed for student=${student.id} lesson=${lesson.id}: ${error.message}`
        );
      } else {
        console.info(
          `[whop-webhook] completion upserted: student=${student.id} lesson=${lesson.id} (whop_user=${whopUserId}, whop_lesson=${whopLessonId})`
        );
      }
      break;
    }

    default:
      // Unknown event name — log it so we notice if Whop adds or renames
      // event types without us updating this switch. Event names have
      // already bitten us once (dot-vs-underscore format).
      console.info(
        `[whop-webhook] unhandled event: ${(payload as { event?: unknown }).event}`
      );
      break;
  }

  return NextResponse.json({ received: true });
}
