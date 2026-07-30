import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import {
  fetchActiveMembershipForUser,
  mapStatus,
} from "@/lib/whop-members";
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

  console.info("[whop-webhook] signature verified");

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
      // v75.26: pre-fetch to detect INSERT vs UPDATE. We only set
      // first_paid_at on INSERT — never on UPDATE — to preserve the
      // original signup date for returning customers. Without this,
      // a renewal webhook would overwrite a returning customer's
      // months-old first_paid_at with today's date, re-opening the
      // discount window they shouldn't have access to.
      const { data: existingStudent } = await supabase
        .from("students")
        .select("first_paid_at")
        .eq("whop_user_id", membership.user.id)
        .maybeSingle();

      const upsertPayload: Record<string, unknown> = {
        whop_user_id: membership.user.id,
        whop_membership_id: membership.id,
        email: membership.user.email,
        name: membership.user.name,
        discord_username: membership.user.username,
        membership_status: "active",
        joined_at: membership.joined_at || new Date().toISOString(),
        // Clear canceled_at on re-activation so the snapshot cron's
        // churned_count doesn't double-count a re-enrolled student.
        canceled_at: null,
        // v79: classify paying / free at the source event.
        whop_plan_id: membership.plan_id ?? null,
      };

      // INSERT path: stamp first_paid_at so the new student isn't
      // invisible to every cohort-scoped admin surface until the
      // nightly Whop sync runs.
      if (!existingStudent) {
        upsertPayload.first_paid_at =
          membership.joined_at || new Date().toISOString();
      }

      const { error } = await supabase
        .from("students")
        .upsert(upsertPayload, { onConflict: "whop_user_id" });

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

      // v85.6 — a user can hold several memberships at once (re-subscribe,
      // refund + rebuy, free-plan claim, or a duplicate created by
      // clicking Renew on the block overlay). This update keys on
      // whop_user_id alone, so ONE membership deactivating revoked
      // dashboard access even while another was live and paid.
      // Ask Whop whether anything valid survives before downgrading.
      const surviving = await fetchActiveMembershipForUser(membership.user.id);
      if (surviving) {
        // Still entitled — re-point the row at the surviving membership
        // instead of revoking. Keeps whop_membership_id / whop_plan_id
        // pointing at the thing that actually grants access.
        const { error: repointError } = await supabase
          .from("students")
          .update({
            whop_membership_id: surviving.id,
            whop_plan_id: surviving.plan ?? null,
            membership_status: mapStatus(surviving),
            canceled_at: null,
          })
          .eq("whop_user_id", membership.user.id);
        if (repointError) {
          console.error("Webhook: student re-point failed:", repointError);
          return NextResponse.json(
            { error: "Database error" },
            { status: 500 },
          );
        }
        console.info(
          `[whop-webhook] ${membership.id} deactivated for ${membership.user.id} ` +
            `but ${surviving.id} still grants access — kept active, re-pointed.`,
        );
        break;
      }

      const { error } = await supabase
        .from("students")
        .update({
          membership_status: "canceled",
          // Stamp the transition time so the snapshot cron can count
          // "churned today" off real events instead of updated_at.
          canceled_at: new Date().toISOString(),
        })
        .eq("whop_user_id", membership.user.id);

      if (error) {
        // v75.30: return 500 so Whop retries. membership.deactivated
        // failing means we don't stamp canceled_at → churn metrics
        // under-report → student stays in active counts indefinitely.
        console.error("Webhook: student update failed:", error);
        return NextResponse.json(
          { error: "Database error" },
          { status: 500 },
        );
      }

      // v57 - the legacy W4.4 "churned" task creation was removed
      // when the W-series templates were deleted. Brief v3 doesn't
      // include a dedicated cancellation-touch-back template
      // (W4.4 was dropped on purpose). If we want one again, add
      // a `cancelled.farewell` template + insert the task here.
      // For now: cancellation just updates membership_status and
      // returns; high_churn_risk + the NA crons handle the lead-up.
      break;
    }

    case "payment.succeeded":
    case "payment_succeeded": {
      // v75.10 — was an UPDATE only. If a student paid before our
      // webhook was wired up (legacy customers like Michael
      // Buratynskyi who joined Dec 2025), their original
      // membership.activated event was never received, so no row
      // existed — and every subsequent renewal `payment.succeeded`
      // silent-no-op'd against a missing row. UPSERT now so any
      // renewal also self-heals a missing row.
      const membership = payload.data as WhopMembership;
      if (!membership?.user?.id) {
        console.warn(
          "[whop-webhook] payment.succeeded missing user.id - skipping",
        );
        break;
      }
      // v75.26: same INSERT-only first_paid_at pattern as
      // membership.activated above. payment.succeeded fires on EVERY
      // recurring renewal, so blindly setting first_paid_at here
      // would overwrite a returning customer's true original signup
      // date on every billing cycle — closing the discount window
      // they shouldn't have access to.
      const { data: existingPaymentStudent } = await supabase
        .from("students")
        .select("first_paid_at")
        .eq("whop_user_id", membership.user.id)
        .maybeSingle();

      const paymentUpsertPayload: Record<string, unknown> = {
        whop_user_id: membership.user.id,
        whop_membership_id: membership.id,
        email: membership.user.email,
        name: membership.user.name,
        discord_username: membership.user.username,
        membership_status: "active",
        joined_at: membership.joined_at || new Date().toISOString(),
        canceled_at: null,
        whop_plan_id: membership.plan_id ?? null,
      };

      if (!existingPaymentStudent) {
        paymentUpsertPayload.first_paid_at =
          membership.joined_at || new Date().toISOString();
      }

      const { error } = await supabase
        .from("students")
        .upsert(paymentUpsertPayload, { onConflict: "whop_user_id" });

      if (error) {
        // v75.30: return 500 so Whop retries on backoff. Previously
        // returned 200 (via fallthrough), so a transient Supabase
        // outage during a payment.succeeded burst permanently lost
        // the renewal — membership_status not refreshed, canceled_at
        // not cleared, plan_id not updated. Whop's Standard Webhooks
        // contract uses HTTP status to drive retries.
        console.error("Webhook: payment upsert failed:", error);
        return NextResponse.json(
          { error: "Database error" },
          { status: 500 },
        );
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
        // v75.30: return 500 on real DB error so Whop retries.
        // The previous fallthrough returned 200 → completion lost.
        console.error(
          `[whop-webhook] students lookup errored for whop_user_id=${whopUserId}: ${JSON.stringify(studentResult.error)}`
        );
        return NextResponse.json(
          { error: "DB lookup error" },
          { status: 500 },
        );
      }
      if (!studentResult.data) {
        // 404-equivalent — student hasn't logged in yet. Return 200
        // because retrying won't help (Whop can't conjure our row);
        // they'll get future events properly once they log in once.
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
        // v75.30: return 500 on DB error so Whop retries.
        console.error(
          `[whop-webhook] lessons lookup errored for whop_lesson_id=${whopLessonId}: ${JSON.stringify(lessonResult.error)}`
        );
        return NextResponse.json(
          { error: "DB lookup error" },
          { status: 500 },
        );
      }
      if (!lessonResult.data) {
        // No mapping for this Whop lesson — return 200, retry won't
        // help. Lesson catalog needs to be seeded with the missing
        // whop_lesson_id mapping.
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
        // v75.30: return 500 so Whop retries. Was returning 200
        // (via fallthrough) → during a transient Supabase outage we'd
        // silently lose lesson completions across all students.
        console.error(
          `[whop-webhook] completion upsert failed for student=${student.id} lesson=${lesson.id}: ${error.message}`
        );
        return NextResponse.json(
          { error: "Database error" },
          { status: 500 },
        );
      }
      console.info(
        `[whop-webhook] completion upserted: student=${student.id} lesson=${lesson.id} (whop_user=${whopUserId}, whop_lesson=${whopLessonId})`
      );
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
