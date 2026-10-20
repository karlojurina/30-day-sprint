import { NextRequest, NextResponse } from "./stub-server.ts";
import { createServiceClient } from "./stub-server.ts";
import {
  accessRank,
  fetchActiveMembershipForUser,
  isEtfbOrApexProduct,
  mapStatus,
} from "./whop-members.ts";
import type {
  WhopWebhookPayload,
  WhopMembership,
  WhopLessonInteractionWebhookData,
} from "./types-erased.ts";
import { createHmac } from "crypto";
import { afterCompletionWrite } from "./complete-lesson.ts";

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

/**
 * The course's Whop products (login-1, 2026-10-20), read as the sync and the
 * login's Whop check read them: WHOP_PRODUCT_ID, comma separated. The
 * company's webhook sends the events of every product it sells, and only a
 * membership of the course opens the course (system-docs/whop_login_handoff.md:
 * "Apply the same product + plan filter to webhook payloads").
 */
function courseProductIds(): string[] {
  return (process.env.WHOP_PRODUCT_ID ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * The product a membership or payment event is about: `product.id` in Whop's
 * payloads, `product_id` or a bare `product` id in older shapes. Null when
 * the payload names none.
 */
function eventProductId(data: unknown): string | null {
  const d = (data ?? {}) as { product?: unknown; product_id?: unknown };
  if (typeof d.product === "string") return d.product || null;
  if (d.product && typeof d.product === "object") {
    const id = (d.product as { id?: unknown }).id;
    if (typeof id === "string" && id) return id;
  }
  return typeof d.product_id === "string" && d.product_id ? d.product_id : null;
}

/** What courseAccess lets an activation or a payment write. */
type CourseWrite = {
  membershipId: string;
  planId: string | null;
  status: string;
  product: string | null;
  /** True when the payload names the product; false when Whop's lookup found the membership. */
  named: boolean;
};

/**
 * What an activation or a payment may write on the student's row (login-1).
 * A course product: the event's membership (`membershipId`: a membership
 * event's own id, a payment's membership), active, as before. Another
 * product: nothing (the caller answers 200). No product in the payload: only
 * a course membership Whop lists for this user, with its own id, plan and
 * status, so a real course member is never left out and nobody else gets in.
 * `product` is the product of the membership written (null when Whop's row
 * names none), and `named` says which of the two it came from, for
 * etfbOrApexMayWrite.
 */
async function courseAccess(
  data: WhopMembership,
  membershipId: string,
  eventName: string,
): Promise<CourseWrite | null> {
  const courseIds = courseProductIds();
  const product = eventProductId(data);
  if (product) {
    if (courseIds.includes(product)) {
      return { membershipId, planId: data.plan_id ?? null, status: "active", product, named: true };
    }
    const message =
      `[whop-webhook] ${eventName} for product ${product}, not the course ` +
      `(${courseIds.join(",") || "WHOP_PRODUCT_ID is empty"}): nothing written`;
    // An empty WHOP_PRODUCT_ID turns every membership away: say it loudly.
    if (courseIds.length) console.info(message);
    else console.error(message);
    return null;
  }
  const row = await fetchActiveMembershipForUser(data.user.id);
  if (!row) {
    console.info(
      `[whop-webhook] ${eventName} names no product and Whop lists no course ` +
        `membership for ${data.user.id}: nothing written`,
    );
    return null;
  }
  return { membershipId: row.id, planId: row.plan ?? null, status: mapStatus(row), product: row.product ?? null, named: false };
}

/**
 * The membership a payment is for, which its write puts on the row:
 * `membership.id`, else `membership_id`, else `membership` as a bare id. The
 * payment's own id (`pay_...`) only when the payload names none of these, as
 * a last resort. Until 2026-10-20 every payment wrote its own `pay_` id there
 * (main did too, before login-1), and no membership event names one.
 */
function paymentMembershipId(data: WhopMembership): string {
  const d = data as unknown as { membership?: unknown; membership_id?: unknown };
  const nested =
    d.membership && typeof d.membership === "object"
      ? (d.membership as { id?: unknown }).id
      : undefined;
  for (const id of [nested, d.membership_id, d.membership]) {
    if (typeof id === "string" && id) return id;
  }
  return data.id;
}

/**
 * The memberships an event names: its own id (a membership's, or a payment's
 * `pay_...`) and a payment's membership (`membership.id`, `membership` as a
 * bare id, or `membership_id`).
 */
function eventMembershipIds(data: unknown): string[] {
  const d = (data ?? {}) as { id?: unknown; membership?: unknown; membership_id?: unknown };
  const ids: unknown[] = [d.id, d.membership_id];
  if (d.membership && typeof d.membership === "object") {
    ids.push((d.membership as { id?: unknown }).id);
  } else {
    ids.push(d.membership);
  }
  return ids.filter((id): id is string => typeof id === "string" && id !== "");
}

/**
 * May an activation or a payment of an ETfB or Apex membership write the
 * student's row? It follows the sync's order (outranks in whop-members.ts,
 * 2026-10-20) as far as a stored row can tell: the row holds a status and a
 * membership id, not that membership's product or created_at.
 *   - No row, or a row already on the membership this write puts there:
 *     written. When the payload names the product, a row on a membership the
 *     event names counts too (eventMembershipIds). With no product in the
 *     payload the write is the membership Whop's lookup found, and only that
 *     one is compared: the event's own id may be a course membership the row
 *     is on, and matching it would move the row off the course onto the seat.
 *   - Steps (a) and (b) (accessRank): a row that grants no access (canceled,
 *     expired), and a past_due row when the write is active, are written
 *     over. So an active seat beats a past_due course membership, which locks
 *     the person out of the app.
 *   - Otherwise the row is left as it is: active on another membership, or
 *     past_due beside a past_due write (only a write found by the lookup can
 *     be past_due). Steps (c) and (d) need the row's product and created_at,
 *     and a course membership wins at (c), so a course student who also holds
 *     an Apex seat or an ETfB membership keeps the course membership and its
 *     plan, and stays in the CSM crons' pool (PAYING_WHOP_PLAN_IDS). The sync,
 *     every 2 hours, points the row at the membership that wins.
 * The read here and the caller's upsert are two separate calls: a write that
 * lands between them (the sync, another event for this user) is overwritten
 * by this one, and the next sync puts back the membership that wins.
 * Null when the row could not be read: the caller answers 500, so Whop sends
 * the event again.
 */
async function etfbOrApexMayWrite(
  supabase: ReturnType<typeof createServiceClient>,
  data: WhopMembership,
  write: CourseWrite,
  eventName: string,
): Promise<boolean | null> {
  const { data: row, error } = await supabase
    .from("students")
    .select("whop_membership_id, membership_status")
    .eq("whop_user_id", data.user.id)
    .maybeSingle();
  if (error) {
    console.error("Webhook: student read failed:", error);
    return null;
  }
  if (!row) return true;
  const same = write.named
    ? [...eventMembershipIds(data), write.membershipId]
    : [write.membershipId];
  if (row.whop_membership_id && same.includes(row.whop_membership_id)) {
    return true;
  }
  if (accessRank(row.membership_status) < accessRank(write.status)) {
    return true;
  }
  console.info(
    `[whop-webhook] ${eventName} for an ETfB or Apex membership (${write.membershipId}, ${write.status}): ` +
      `the row is already ${row.membership_status} on ${row.whop_membership_id ?? "no membership id"}, ` +
      `left as it is for the sync; nothing written`,
  );
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
      // login-1: another product's membership writes nothing (courseAccess).
      const access = await courseAccess(membership, membership.id, eventName);
      if (!access) break;
      // An ETfB or Apex membership takes a row that is on another
      // membership only where the sync's order says it wins
      // (etfbOrApexMayWrite).
      if (isEtfbOrApexProduct(access.product)) {
        const mayWrite = await etfbOrApexMayWrite(
          supabase,
          membership,
          access,
          eventName,
        );
        if (mayWrite === null) {
          return NextResponse.json(
            { error: "Database error" },
            { status: 500 },
          );
        }
        if (!mayWrite) break;
      }
      // first_paid_at is never sent (the first-paid fix, 2026-10-20): a
      // new row starts without one, and the login or the 2-hour sync
      // fills it from the student's first real payment
      // (src/lib/first-payment.ts). Whop's joined_at is when the user
      // first joined the company, a free membership's date for a member
      // who bought later, so it never goes there; and a key left out of
      // this single-row upsert leaves a stored value as it is.
      const upsertPayload: Record<string, unknown> = {
        whop_user_id: membership.user.id,
        whop_membership_id: access.membershipId,
        email: membership.user.email,
        name: membership.user.name,
        discord_username: membership.user.username,
        membership_status: access.status,
        joined_at: membership.joined_at || new Date().toISOString(),
        // Clear canceled_at on re-activation so the snapshot cron's
        // churned_count doesn't double-count a re-enrolled student.
        canceled_at: null,
        // v79: classify paying / free at the source event.
        whop_plan_id: access.planId,
      };

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
      const product = eventProductId(membership);
      const ofCourse = product !== null && courseProductIds().includes(product);

      // login-1 review: the row a membership made. Until login-1 the webhook
      // wrote a membership of any product as active, and the sync, which
      // walks only the course's memberships, never closes such a row. So a
      // membership that is not the course's (or that the payload does not
      // name) still settles the row when the row points at it, as before
      // login-1: re-pointed at a course membership Whop lists, else
      // canceled. A course member's row points at a course membership after
      // every sync (every 2 hours).
      let rowPointsAtIt = false;
      if (!ofCourse) {
        const { data: madeByIt, error: readError } = await supabase
          .from("students")
          .select("id")
          .eq("whop_user_id", membership.user.id)
          .eq("whop_membership_id", membership.id)
          .maybeSingle();
        if (readError) {
          // 500 so Whop retries: this event may be the only one that closes the row.
          console.error("Webhook: student read failed:", readError);
          return NextResponse.json(
            { error: "Database error" },
            { status: 500 },
          );
        }
        rowPointsAtIt = madeByIt !== null;
      }

      // login-1: another product's membership ending says nothing about the
      // course when the row points elsewhere. Answer 200, ask Whop nothing,
      // leave the row as it is.
      if (product && !ofCourse && !rowPointsAtIt) {
        console.info(
          `[whop-webhook] ${eventName} for product ${product}, not the course: nothing written`,
        );
        break;
      }
      if (rowPointsAtIt) {
        console.info(
          `[whop-webhook] ${eventName} for ${product ? `product ${product}` : "no named product"}: ` +
            `the row points at ${membership.id}, settled as before login-1`,
        );
      }

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
        // pointing at the thing that actually grants access. Since
        // 2026-10-20 it is the one the sync's order puts first (active,
        // then the course's, then the newest); it was the first one Whop
        // listed.
        let repoint = supabase
          .from("students")
          .update({
            whop_membership_id: surviving.id,
            whop_plan_id: surviving.plan ?? null,
            membership_status: mapStatus(surviving),
            canceled_at: null,
          })
          .eq("whop_user_id", membership.user.id);
        // login-1 review: a write made because the row points at this
        // membership lands only while it still does (the sync or a course
        // activation may re-point the row while Whop is asked).
        if (rowPointsAtIt) {
          repoint = repoint.eq("whop_membership_id", membership.id);
        }
        const { error: repointError } = await repoint;
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

      // login-1: with no product in the payload this may be another
      // product's membership, and Whop answering nothing may be a failed
      // read. A row that points elsewhere is not canceled on that: the sync
      // (every 2 hours) settles it from the course's own memberships. A row
      // that points at this membership is canceled below, since the sync may
      // never see it (login-1 review, above).
      if (!product && !rowPointsAtIt) {
        console.info(
          `[whop-webhook] ${eventName} names no product and Whop lists no course ` +
            `membership for ${membership.user.id}: nothing written, the sync settles it`,
        );
        break;
      }

      let cancel = supabase
        .from("students")
        .update({
          membership_status: "canceled",
          // Stamp the transition time so the snapshot cron can count
          // "churned today" off real events instead of updated_at.
          canceled_at: new Date().toISOString(),
        })
        .eq("whop_user_id", membership.user.id);
      // As for the re-point above: only while the row still points at it.
      if (rowPointsAtIt) {
        cancel = cancel.eq("whop_membership_id", membership.id);
      }
      const { error } = await cancel;

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
      // webhook was wired up (legacy customers, like one who joined
      // in Dec 2025), their original
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
      // login-1: a payment for another product writes nothing (courseAccess).
      // It used to mark the row active: a lapsed student got back in until
      // the next sync, and someone with no course membership got in. The
      // row is pointed at the payment's membership (paymentMembershipId).
      const paymentAccess = await courseAccess(
        membership,
        paymentMembershipId(membership),
        eventName,
      );
      if (!paymentAccess) break;
      // As for membership.activated above: an ETfB or Apex payment takes a
      // row on another membership only where the order says it wins.
      if (isEtfbOrApexProduct(paymentAccess.product)) {
        const mayWrite = await etfbOrApexMayWrite(
          supabase,
          membership,
          paymentAccess,
          eventName,
        );
        if (mayWrite === null) {
          return NextResponse.json(
            { error: "Database error" },
            { status: 500 },
          );
        }
        if (!mayWrite) break;
      }
      // first_paid_at is never sent, as for membership.activated above:
      // the login or the sync fills an empty one from the first real
      // payment, and this fires on every renewal.
      const paymentUpsertPayload: Record<string, unknown> = {
        whop_user_id: membership.user.id,
        whop_membership_id: paymentAccess.membershipId,
        email: membership.user.email,
        name: membership.user.name,
        discord_username: membership.user.username,
        membership_status: paymentAccess.status,
        joined_at: membership.joined_at || new Date().toISOString(),
        canceled_at: null,
        whop_plan_id: paymentAccess.planId,
      };

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

      // Writes the row when there is none; the database stamps completed_at
      // with the moment it arrives. `.select` returns only a row it added.
      const { data: inserted, error } = await supabase
        .from("student_lesson_completions")
        .upsert(
          { student_id: student.id, lesson_id: lesson.id },
          {
            onConflict: "student_id,lesson_id",
            ignoreDuplicates: true,
          }
        )
        .select("id");

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

      // A row was there already (a skip, a saved Discord link, an action done
      // before its video): finish its watch half the way the backfill does
      // (watch-sync.ts, 3b). It used to be dropped. A row already watched
      // keeps its time.
      let finished = (inserted?.length ?? 0) > 0;
      if (!finished) {
        const { data: promoted, error: promoteError } = await supabase
          .from("student_lesson_completions")
          .update({ completed_at: new Date().toISOString(), skipped_at: null })
          .eq("student_id", student.id)
          .eq("lesson_id", lesson.id)
          .is("completed_at", null)
          .select("id");
        if (promoteError) {
          // 500 so Whop retries, as for the insert above.
          console.error(
            `[whop-webhook] finishing the existing row failed for student=${student.id} lesson=${lesson.id}: ${promoteError.message}`
          );
          return NextResponse.json(
            { error: "Database error" },
            { status: 500 },
          );
        }
        finished = (promoted?.length ?? 0) > 0;
      }
      console.info(
        `[whop-webhook] completion upserted: student=${student.id} lesson=${lesson.id} (whop_user=${whopUserId}, whop_lesson=${whopLessonId}) finished_now=${finished}`
      );

      // The steps the app runs after a lesson (lesson-watched): the streak,
      // the "came back" check, the badges, the CSM tasks. Once, on the
      // delivery that finished the lesson, never on a retry. Each step is
      // best-effort and none can throw past it.
      if (finished) {
        await afterCompletionWrite(supabase, student.id);
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
