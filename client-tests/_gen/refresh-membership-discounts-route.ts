/**
 * GET /api/cron/refresh-membership-discounts (admin rebuild 2, D5)
 *
 * Every 2 hours (vercel.json, at minute 40): reads from Whop whether each
 * student in the 30%'s window already has a discount on their next renewal,
 * and stores it in student_membership_discounts. The window: a 30% window
 * still open at the run's start (discountWindowOpen in discount.ts: a first
 * payment from 1 October and a deadline not past), membership active or
 * past_due; with them every student holding a pending 30% request, whatever
 * their window or membership (the render review's second round: a stale
 * answer on the 30% page's row heals by itself); and of all those, none with
 * an approved or applied 30% request. The run and the rule are
 * src/lib/membership-discount.ts refreshMembershipDiscounts; this file is
 * its door.
 *
 * The map reads the stored flag (/api/student/data), and so does the admin's
 * 30% page. The request routes and the approve route ask Whop again
 * themselves and fall back to the stored row, and the 30% page's "Check Whop
 * again" asks for one student (POST /api/admin/thirty/check-coupon).
 *
 * Since T-122 every student ends in a yes or a no unless Whop does not
 * answer, and since its third fix round by the owner's rule as he put it: a
 * promo code other than the student's own 30% on the membership on file, on
 * any course membership found through their Whop user (read whatever the one
 * on file said; since its fourth, those that no longer grant access too) or
 * on any course payment, the $0 ones too, is a coupon; with no code
 * anywhere, the student's first real course payment in dollars under 97.00
 * that is no plan change is one (every real payment until the fourth).
 * `by_source` counts the answers by the step that answered, and `failed`
 * holds only the students Whop gave no answer for (no connection, a 5xx, a
 * 429 after its retries, no answer in time, a refused key, payments or a
 * list of memberships it could not judge, a membership read it could not
 * read, or a deployment that cannot ask). Since the fourth fix round
 * `user_list_unusable` counts the students whose Whop user's list answered a
 * 404 or another 4xx (judged without it), and `refused_by_price` lists the
 * students the price alone refused, by student id, with that payment's price
 * and billing_reason. The first dry run on production (2026-10-21, before T-122)
 * could not read 46 of 290: 22 payment ids where the membership's belongs, 24
 * memberships with no plan or no renewal price.
 *
 * ?mode=dry reads Whop and writes nothing, for the first look after a deploy:
 * it passes when `checked` is above 0 and `failed` is empty, and
 * `discounted` is about the number of students in the window who came in on
 * a code, a used one included (evolve10, welcome50, a 100% first month);
 * `refused_by_price` is for the owner to rule on. After the deploy of T-122's
 * fourth fix round, and with v113 pasted only once no older build can write
 * to the database, the run in write mode is repeated until `left` is 0,
 * before anyone approves, so every stored row is one this rule wrote (its
 * source set): until then a stored "no coupon" holds no source, and the
 * request routes and the normal Approve refuse for it when Whop does not
 * answer.
 *
 * Auth: CRON_SECRET as a bearer, like every cron (src/lib/cron-auth.ts), with
 * a cron_runs row. Answers 500, ok: false, when who is in the window or who
 * holds a pending request cannot be read, when a write fails, when every
 * Whop read failed, or when Whop
 * answered no read before the time ran out, so nothing was checked (the
 * review's fix round; that run answered 200, ok); 500 without WHOP_API_KEY. No request starts after 240 s; a student not reached is read
 * first by the next run. No answer names a student, an email or a Whop id:
 * student ids only.
 */

import { NextRequest, NextResponse } from "./stub-server.ts";
import { createServiceClient } from "./stub-server.ts";
import { verifyCronAuth, cronUnauthorizedResponse, logCronStart, logCronFinish } from "./cron-auth.stub-server.ts";
import { refreshMembershipDiscounts } from "./membership-discount.ts";

export const maxDuration = 300;
export const dynamic = "force-dynamic";
// Pinned to iad1, next to Whop, by this file's entry under `functions` in
// vercel.json, while the project's functions run in dub1 next to the
// database: a run is one Whop read per student in a row, against a handful
// of database reads and one write per 25 students. Vercel takes a Node
// route's region only from vercel.json, and a moved file loses the pin.

const ROUTE_NAME = "refresh-membership-discounts";

export async function GET(request: NextRequest) {
  const startedAtMs = Date.now();
  const auth = verifyCronAuth(request);
  if (!auth.ok) {
    await logCronStart(ROUTE_NAME, auth.reason);
    return cronUnauthorizedResponse(auth.reason);
  }
  const runId = await logCronStart(ROUTE_NAME, "ok");

  const asked = new URL(request.url).searchParams.get("mode");
  if (asked !== null && asked !== "dry" && asked !== "write") {
    await logCronFinish(runId, "failed", { error: "bad mode" });
    return NextResponse.json({ ok: false, error: 'mode must be "dry" or "write" (left out, it is "write"). Nothing ran.' }, { status: 400 });
  }
  const mode = asked === "dry" ? "dry" : "write";

  const apiKey = process.env.WHOP_API_KEY;
  if (!apiKey) {
    await logCronFinish(runId, "failed", { error: "WHOP_API_KEY is not set" });
    return NextResponse.json({ ok: false, error: "WHOP_API_KEY is not set on this deployment. Nothing ran." }, { status: 500 });
  }

  const answer = await refreshMembershipDiscounts(createServiceClient(), { mode, startedAtMs, apiKey });
  if (answer.ok) {
    await logCronFinish(runId, "success", { rowsAffected: answer.written });
  } else {
    const failedKinds = Object.entries(answer.failed).map(([k, n]) => `${k} ${n}`).join(", ");
    await logCronFinish(runId, "failed", { error: answer.error ?? `every Whop read failed: ${failedKinds}`, rowsAffected: answer.written });
    console.error(`[${ROUTE_NAME}] ${answer.error ?? `every Whop read failed: ${failedKinds}`}`);
  }
  return NextResponse.json(answer, { status: answer.ok ? 200 : 500 });
}
