/**
 * GET /api/admin/thirty: everything the 30% page (/admin/discounts) shows, in
 * one answer (admin rebuild PRD, section 8, "Admin 30% view").
 *
 * Every request the page lists, each with the student's facts, and for a
 * pending one the approve route's own verdict (approvalVerdict, then
 * explainOldCourseRequest; no ads check since 2026-10-20), its action items
 * (no page shows them since then) and its survey answers; and everyone who
 * can still earn the 30% before their deadline. loadThirtyData (src/lib/admin/thirty-data.ts) reads it all at
 * once, paged; buildThirtyView (thirty-view.ts) runs the student app's own
 * rule over it. Neither changes the rule.
 *
 * Why a route: lesson_videos is readable by the service role alone, and the
 * rule needs it. A browser page reading it would see no videos and no error,
 * and the rule would then close the offer for everyone. requireTeam hands
 * this route the service-role client.
 *
 * Auth: any team role (founder, admin, csm), as the three discount routes
 * the page calls. Writes nothing.
 *
 * A read that fails answers 500 with a plain sentence, never a list with
 * people missing: the course switch's date (it decides which videos a request
 * made before the switch is judged by), or any read loadThirtyData cannot do
 * without. A failed read of one student's progress is not a failure of the
 * page: that student's verdict says so, and Can still earn counts them in
 * `unchecked`.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTeam, isAuthFailure } from "@/lib/admin-auth";
import { getCurriculumResetAt } from "@/lib/curriculum-reset";
import { loadThirtyData } from "@/lib/admin/thirty-data";
import { buildThirtyView } from "@/lib/admin/thirty-view";

export const dynamic = "force-dynamic";
// About 300 students in the offer, read in pages of 1000 and batches of 100.
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

  return NextResponse.json(buildThirtyView(load.data, new Date(), resetAt));
}
