/**
 * POST /api/admin/thirty/check-coupon: "Check Whop again" on the 30% page
 * (admin rebuild 2, the render review's second round).
 *
 * An Applied row whose stored coupon says a discount is on the student's next
 * renewal offers only Reject (D5: the approve route refuses it with no
 * override). When that answer went stale, a code taken off the membership in
 * Whop since it was read, the team asks Whop again for that one student here.
 * The read is the one the request routes and the approve route make
 * (checkMembershipDiscount in src/lib/membership-discount.ts: Whop now, no
 * request started after 6 s and none waited on past 8 s; since T-122's third
 * fix round the owner's rule as he put it: a code other than the student's
 * own 30% on the membership on file, on any course membership found through
 * their Whop user or on any course payment, then with no code anywhere a
 * price under 97.00), and Whop's answer
 * is written to student_membership_discounts, so the list read after it
 * shows the row as Whop has it now: with the coupon gone, the 30% rule
 * decides the row again and Approve is back. No Whop code is made and the
 * request is not changed. The coupon cron reads the students holding a
 * pending request too, so a stale answer also heals by itself within 2 hours.
 *
 * Body: { requestId }. Auth: any team role (founder, admin, csm), as the
 * discount routes the page calls.
 *
 *   200 { discounted, code }   Whop answered now, and its answer is stored
 *   400   no requestId
 *   404   no such request
 *   409   the request is no longer pending (the page reads its list again)
 *   422   the student has no Whop user on file, so Whop can't be asked (the
 *         column is NOT NULL, so this should never be seen): nothing changed
 *   500   the request or the student could not be read, no Whop key or no
 *         course product (WHOP_PRODUCT_ID) on this deployment, or Whop
 *         answered and its answer could not be stored
 *   502   Whop gave no answer in time: nothing changed
 * Until T-122 a Whop id on file that was missing, a payment's, or one Whop
 * did not know was a 422: Whop is now asked through the student's Whop user.
 *
 * Every error is a sentence the page shows as it is. No answer names a Whop
 * id or Whop's own words.
 */

import { NextRequest, NextResponse } from "./stub-server.ts";
import { requireTeam, isAuthFailure } from "./admin-auth.ts";
import { checkMembershipDiscount } from "./membership-discount.ts";

const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

export async function POST(request: NextRequest) {
  const auth = await requireTeam(request, ["founder", "admin", "csm"]);
  if (isAuthFailure(auth)) return auth.error;
  const supabase = auth.supabase;

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const requestId = body && typeof body === "object" ? (body as { requestId?: unknown }).requestId : undefined;
  if (typeof requestId !== "string" || !requestId.trim()) return fail("Missing requestId", 400);

  const { data: row, error } = await supabase
    .from("discount_requests")
    .select("id, student_id, status")
    .eq("id", requestId)
    .maybeSingle();
  if (error) {
    console.error(`[admin check-coupon] request ${requestId}: the request could not be read: ${error.message}`);
    return fail("Couldn't read this request, so Whop was not asked. Try again.", 500);
  }
  if (!row) return fail("This request no longer exists.", 404);
  if (row.status !== "pending") return fail("This request was already decided.", 409);

  const coupon = await checkMembershipDiscount(supabase, row.student_id);
  if (coupon.source === "live") {
    if (!coupon.saved) {
      return fail("Whop answered, but its answer couldn't be saved, so the list still shows the old one. Try again.", 500);
    }
    return NextResponse.json({ discounted: coupon.discounted, code: coupon.code });
  }

  // Whop gave no answer now: the stored row stays as it was. checkMembershipDiscount has logged a failed Whop read.
  switch (coupon.liveFail) {
    case "no_whop_user":
      return fail("The student's Whop account is not on file, so Whop can't be asked. Check the coupon in Whop.", 422);
    case "no_api_key":
      return fail("This deployment has no Whop key, so Whop can't be asked.", 500);
    case "no_course_product":
      return fail("This deployment doesn't name the course's Whop product, so Whop can't be asked.", 500);
    case "student_unread":
      return fail("Couldn't read the student's Whop membership, so Whop was not asked. Try again.", 500);
    default:
      return fail("Whop gave no answer, so nothing changed. Try again in a minute.", 502);
  }
}
