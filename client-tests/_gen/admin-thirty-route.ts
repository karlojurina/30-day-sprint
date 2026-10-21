/**
 * GET /api/admin/thirty: everything the 30% page (/admin/discounts) shows, in
 * one answer (admin rebuild PRD, section 8; admin rebuild 2, D4 and D5).
 *
 * Every request made from 1 October, oldest first, each with the student
 * (name, @username, membership), who decided it and when, the 30% code, the
 * coupon stored for the student's membership, and for a pending one the
 * approve route's own verdict: the coupon first (a discount already on the
 * next renewal, no override), then the rule (approvalVerdict, then
 * explainOldCourseRequest). loadThirtyData (src/lib/admin/thirty-data.ts)
 * reads it all at once, paged; buildThirtyView (thirty-view.ts) runs the
 * student app's own rule over it. Neither changes the rule.
 *
 * Why a route: lesson_videos is readable by the service role alone, and the
 * rule needs it. A browser page reading it would see no videos and no error,
 * and the rule would then close the offer for everyone. requireTeam hands
 * this route the service-role client.
 *
 * The Approved rows' coupon is read from Whop now (readApprovedCoupons, a
 * handful of reads within the request routes' 6 and 8 second limits): the
 * cron leaves students with an approved request out, so the stored row of
 * a request approved before the coupon rule never existed, and the warning
 * to check Whop before adding the 30% code could never show for it (the
 * review's fix round). A Whop read that fails is logged, by kind, and the
 * row then says the coupon could not be checked.
 *
 * Auth: any team role (founder, admin, csm), as the three discount routes
 * the page calls. Writes nothing.
 *
 * A read that fails answers 500 with a plain sentence, never a list with
 * people missing: the course switch's date (it decides which videos a request
 * made before the switch is judged by), or any read loadThirtyData cannot do
 * without. A failed read of one student's progress is not a failure of the
 * page: that student's verdict says so. Nor is a failed read of the stored
 * coupons: the answer says `couponsUnread`, and the approve route asks Whop
 * itself.
 */

import { NextRequest, NextResponse } from "./stub-server.ts";
import { requireTeam, isAuthFailure } from "./admin-auth.ts";
import { getCurriculumResetAt } from "./curriculum-reset.ts";
import { loadThirtyData, readApprovedCoupons } from "./thirty-data.ts";
import { buildThirtyView } from "./thirty-view.ts";

export const dynamic = "force-dynamic";
// The students holding a request from 1 October, read in pages of 1000 and batches of 100.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const auth = await requireTeam(request);
  if (isAuthFailure(auth)) return auth.error;
  const { supabase } = auth;

  let resetAt: string | null;
  try {
    resetAt = await getCurriculumResetAt(supabase);
  } catch (e) {
    console.error(`[admin thirty] the course switch could not be read: ${e instanceof Error ? e.message : String(e)}`);
    return NextResponse.json(
      { error: "Couldn't read the date of the course switch, so the 30% list was not made. Try again." },
      { status: 500 },
    );
  }

  const load = await loadThirtyData(supabase);
  if (!load.ok) {
    console.error(`[admin thirty] reads failed: ${load.failed.join("; ")}`);
    return NextResponse.json(
      {
        error: "Couldn't read everything the 30% list needs, so nothing is shown. Try again.",
        failed: load.failed,
      },
      { status: 500 },
    );
  }

  const live = await readApprovedCoupons(load.data, process.env.WHOP_API_KEY ?? null);
  // With no key or no membership there was nothing to ask: no line, as the request routes do.
  const fails = [...live.values()].flatMap((c) => (c.ok || c.fail === "no_membership" || c.fail === "no_api_key" ? [] : [c.fail]));
  if (fails.length > 0) {
    console.warn(`[admin thirty] Whop gave no answer for ${fails.length} approved student(s)' coupon (${[...new Set(fails)].join(", ")})`);
  }

  return NextResponse.json(buildThirtyView(load.data, new Date(), resetAt, live));
}
