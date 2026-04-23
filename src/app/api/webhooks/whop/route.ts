import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import type {
  WhopWebhookPayload,
  WhopMembership,
  WhopLessonInteractionWebhookData,
} from "@/types/whop";
import { createHmac } from "crypto";

/**
 * Verify a Whop webhook using the Standard Webhooks / Svix signature
 * scheme (https://www.standardwebhooks.com/).
 *
 * Required headers on the request:
 *   webhook-id         — unique message id (e.g. msg_xxx)
 *   webhook-timestamp  — UNIX seconds when Whop sent it
 *   webhook-signature  — one or more space-separated values of the form
 *                        "v1,<base64-of-hmac-sha256>"
 *
 * Content that gets signed:
 *   `${webhook-id}.${webhook-timestamp}.${raw-request-body}`
 *
 * Secret handling: Whop's dashboard shows secrets like "ws_xxxxxxxx";
 * the underlying Standard Webhooks secret is base64-encoded random
 * bytes. We try both interpretations (decoded bytes + raw string) so
 * that whichever format the user pasted into WHOP_WEBHOOK_SECRET
 * works without more config.
 */
function verifyWebhookSignature(
  body: string,
  webhookId: string | null,
  webhookTimestamp: string | null,
  webhookSignature: string | null
): boolean {
  const secret = process.env.WHOP_WEBHOOK_SECRET;
  if (!secret || !webhookId || !webhookTimestamp || !webhookSignature) {
    return false;
  }

  const signedContent = `${webhookId}.${webhookTimestamp}.${body}`;

  // Whop's secret on the dashboard starts with "ws_". Some providers use
  // "whsec_" instead. Either way, the part after the prefix is the
  // base64-encoded raw key bytes. We also try the whole string as a
  // plain utf-8 HMAC key in case Whop's format differs from Svix's.
  const withoutPrefix = secret.replace(/^ws_/, "").replace(/^whsec_/, "");

  let decodedBytes: Buffer | null = null;
  try {
    decodedBytes = Buffer.from(withoutPrefix, "base64");
  } catch {
    decodedBytes = null;
  }

  const candidateKeys: Buffer[] = [];
  if (decodedBytes && decodedBytes.length > 0) {
    candidateKeys.push(decodedBytes);
  }
  candidateKeys.push(Buffer.from(withoutPrefix, "utf8"));
  candidateKeys.push(Buffer.from(secret, "utf8"));

  // Signature header may contain multiple signatures separated by spaces
  // (Standard Webhooks allows key rotation by emitting v1,<old> v1,<new>).
  const incoming = webhookSignature
    .split(" ")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const key of candidateKeys) {
    const expected =
      "v1," + createHmac("sha256", key).update(signedContent).digest("base64");
    if (incoming.includes(expected)) return true;
  }
  return false;
}

export async function POST(request: NextRequest) {
  const body = await request.text();

  const webhookId = request.headers.get("webhook-id");
  const webhookTimestamp = request.headers.get("webhook-timestamp");
  const webhookSignature = request.headers.get("webhook-signature");

  console.info(
    `[whop-webhook] received body=${body.length}B id=${webhookId ?? "missing"} ts=${webhookTimestamp ?? "missing"} sig=${webhookSignature ? "present" : "missing"}`
  );

  const signatureOk = verifyWebhookSignature(
    body,
    webhookId,
    webhookTimestamp,
    webhookSignature
  );
  if (!signatureOk) {
    console.warn(
      `[whop-webhook] signature check FAILED. secret_set=${!!process.env.WHOP_WEBHOOK_SECRET} id=${webhookId} ts=${webhookTimestamp}`
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

  // Whop's actual payloads use the field `type` (not `event`) to name
  // the event, and the value uses dots (e.g. `course_lesson_interaction.completed`).
  // Read both fields so we're robust to either format.
  const eventName =
    (payload as { type?: string }).type ??
    (payload as { event?: string }).event ??
    "";

  console.info(
    `[whop-webhook] eventName=${eventName} data_keys=${Object.keys(
      (payload as { data?: Record<string, unknown> }).data ?? {}
    ).join(",")}`
  );

  const supabase = createServiceClient();

  switch (eventName) {
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

      // .maybeSingle() returns null + no error for 0 rows, instead of
      // .single() which returns a 406 error. Easier to diagnose: error
      // object will only be non-null on real DB problems.
      const studentResult = await supabase
        .from("students")
        .select("id, whop_user_id, email")
        .eq("whop_user_id", whopUserId)
        .maybeSingle();
      if (studentResult.error) {
        console.error(
          `[whop-webhook] students lookup errored for whop_user_id=${whopUserId}: ${JSON.stringify(studentResult.error)}`
        );
        break;
      }
      if (!studentResult.data) {
        console.warn(
          `[whop-webhook] student not found for whop_user_id=${whopUserId}. ` +
            `They need to log into the EcomTalent dashboard at least once ` +
            `with this Whop account so a row gets created in students.`
        );
        break;
      }
      const student = studentResult.data;
      console.info(
        `[whop-webhook] matched student id=${student.id} email=${student.email} ` +
          `for whop_user_id=${whopUserId}`
      );

      // Look up our lesson matching this Whop lesson
      const lessonResult = await supabase
        .from("lessons")
        .select("id")
        .eq("whop_lesson_id", whopLessonId)
        .maybeSingle();
      if (lessonResult.error) {
        console.error(
          `[whop-webhook] lessons lookup errored for whop_lesson_id=${whopLessonId}: ${JSON.stringify(lessonResult.error)}`
        );
        break;
      }
      if (!lessonResult.data) {
        console.warn(
          `[whop-webhook] no lesson mapped to whop_lesson_id=${whopLessonId} ` +
            `(not in seed or mismatched)`
        );
        break;
      }
      const lesson = lessonResult.data;

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
      // event types without us updating this switch.
      console.info(`[whop-webhook] unhandled event: ${eventName}`);
      break;
  }

  return NextResponse.json({ received: true });
}
