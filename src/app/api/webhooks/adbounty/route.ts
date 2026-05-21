/**
 * POST /api/webhooks/adbounty
 *
 * Incoming webhook from Zak's Ad Bounty system. Fires when a student
 * enrolls in the bounty program on his side. We stamp
 * `student_milestones.bounty_access_claimed_at` so the Playbook
 * unlocks on our side.
 *
 * Per v50, bounty_access_claimed_at is the single signal that unlocks
 * the Playbook — and per the integration agreement with Zak, this
 * webhook is the SOLE source of that timestamp. Nothing else stamps
 * it.
 *
 * Auth: HMAC-SHA256 of the raw body, signed with
 * ADBOUNTY_WEBHOOK_SECRET. Sent in the `X-Webhook-Signature` header
 * as a lowercase hex string (no prefix).
 *
 * Expected payload:
 *   {
 *     "event": "enrollment.created",          // optional, for forward-compat
 *     "whop_user_id": "user_xxxxx",           // required — student match key
 *     "enrolled_at": "2026-05-21T12:34:56Z",  // optional — ISO8601, defaults to now
 *     "idempotency_key": "..."                // optional
 *   }
 *
 * Behavior:
 *   - 401 if signature is missing or wrong
 *   - 400 if body is invalid JSON or whop_user_id is missing
 *   - 404 if no student matches the whop_user_id
 *   - 200 { already_claimed: true }  if the timestamp is already set
 *   - 200 { already_claimed: false } on successful stamp
 *
 * Idempotency: re-sending the same payload is safe — the second call
 * returns already_claimed: true without overwriting the timestamp.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { createHmac, timingSafeEqual } from "crypto";

function verifySignature(body: string, signatureHeader: string | null): boolean {
  const secret = process.env.ADBOUNTY_WEBHOOK_SECRET;
  if (!secret || !signatureHeader) return false;

  const expected = createHmac("sha256", secret).update(body).digest("hex");

  // Accept either "sha256=<hex>" or bare "<hex>" so Zak can use whichever
  // convention his framework defaults to.
  const incoming = signatureHeader.replace(/^sha256=/, "").trim();

  if (expected.length !== incoming.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(incoming, "hex"));
  } catch {
    return false;
  }
}

interface AdBountyEnrollmentPayload {
  event?: string;
  whop_user_id?: string;
  enrolled_at?: string;
  idempotency_key?: string;
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get("x-webhook-signature");

  console.info(
    `[adbounty-webhook] received body=${body.length}B sig=${signature ? "present" : "missing"}`,
  );

  if (!verifySignature(body, signature)) {
    console.warn(
      `[adbounty-webhook] signature check FAILED. secret_set=${!!process.env.ADBOUNTY_WEBHOOK_SECRET}`,
    );
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: AdBountyEnrollmentPayload;
  try {
    payload = JSON.parse(body);
  } catch {
    console.warn("[adbounty-webhook] invalid JSON body");
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const whopUserId = payload.whop_user_id;
  if (!whopUserId) {
    console.warn("[adbounty-webhook] missing whop_user_id");
    return NextResponse.json({ error: "Missing whop_user_id" }, { status: 400 });
  }

  const enrolledAt = payload.enrolled_at ?? new Date().toISOString();

  const supabase = createServiceClient();

  const studentResult = await supabase
    .from("students")
    .select("id, name, email")
    .eq("whop_user_id", whopUserId)
    .maybeSingle();

  if (studentResult.error) {
    console.error(
      `[adbounty-webhook] students lookup errored for whop_user_id=${whopUserId}: ${JSON.stringify(studentResult.error)}`,
    );
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }

  if (!studentResult.data) {
    console.warn(
      `[adbounty-webhook] student not found for whop_user_id=${whopUserId}. ` +
        `They need to have logged into the EcomTalent dashboard at least once.`,
    );
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  const student = studentResult.data;

  // Idempotency — if already stamped, do nothing and report it back.
  const existing = await supabase
    .from("student_milestones")
    .select("bounty_access_claimed_at")
    .eq("student_id", student.id)
    .maybeSingle();

  if (existing.data?.bounty_access_claimed_at) {
    console.info(
      `[adbounty-webhook] already claimed for student=${student.id} (whop_user=${whopUserId}) at ${existing.data.bounty_access_claimed_at}`,
    );
    return NextResponse.json({
      ok: true,
      already_claimed: true,
      bounty_access_claimed_at: existing.data.bounty_access_claimed_at,
    });
  }

  // Upsert — insert milestone row if missing, otherwise update it.
  // Conditional .is(null) protects against a race between two parallel
  // webhook deliveries.
  if (!existing.data) {
    const { error } = await supabase.from("student_milestones").insert({
      student_id: student.id,
      bounty_access_claimed_at: enrolledAt,
      updated_at: enrolledAt,
    });
    if (error) {
      console.error(
        `[adbounty-webhook] milestone insert failed for student=${student.id}: ${error.message}`,
      );
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }
  } else {
    const { error } = await supabase
      .from("student_milestones")
      .update({
        bounty_access_claimed_at: enrolledAt,
        updated_at: enrolledAt,
      })
      .eq("student_id", student.id)
      .is("bounty_access_claimed_at", null);
    if (error) {
      console.error(
        `[adbounty-webhook] milestone update failed for student=${student.id}: ${error.message}`,
      );
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }
  }

  console.info(
    `[adbounty-webhook] stamped bounty_access_claimed_at=${enrolledAt} for student=${student.id} (whop_user=${whopUserId}, email=${student.email})`,
  );

  return NextResponse.json({
    ok: true,
    already_claimed: false,
    bounty_access_claimed_at: enrolledAt,
  });
}
