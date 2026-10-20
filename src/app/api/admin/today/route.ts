/**
 * GET /api/admin/today: Today's list, in one answer (admin rebuild PRD,
 * section 8, "Admin support list").
 *
 * Every member who needs a message, one row per student: the reasons in
 * plain words (the most urgent is the headline), the course facts, the last
 * message the team sent, how to reach them and the message to copy; and
 * Handled, what was done in the last 7 days, with Undo on the caller's own
 * entries for 15 minutes. loadTodayData (src/lib/admin/today-data.ts) reads
 * it all at once; buildSupportRows (support-list.ts) decides who is on it.
 *
 * Why a route: the 30% reasons need lesson_videos, which the service role
 * alone can read, and one round trip from the browser beats fifteen.
 * requireTeam hands this route the service-role client.
 *
 * Auth: any team role (founder, admin, csm). Writes nothing.
 *
 * A read that fails answers 500 with a plain sentence, never a list with
 * people missing or one without its 30% reasons: the course switch's date
 * (course days count from it), or any read the list needs, named in
 * `failed` for whoever looks into it.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTeam, isAuthFailure } from "@/lib/admin-auth";
import { loadTodayData } from "@/lib/admin/today-data";
import { buildSupportRows } from "@/lib/admin/support-list";
import type { TodayView } from "@/lib/admin/support-list";

export const dynamic = "force-dynamic";
// About 1,000 members and a dozen reads, in pages of 1000 and batches of 100.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const auth = await requireTeam(request);
  if (isAuthFailure(auth)) return auth.error;
  const { supabase, teamMember } = auth;

  const now = new Date();
  const load = await loadTodayData(supabase, now);
  if (!load.ok) {
    console.error(`[admin today] reads failed: ${load.failed.join("; ")}`);
    if (load.reason === "reset") {
      return NextResponse.json(
        { error: "Couldn't read the date of the course switch, so the list was not made. Try again." },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: "Couldn't read everything Today needs, so nothing is shown. Try again.", failed: load.failed },
      { status: 500 },
    );
  }

  const { rows, handled } = buildSupportRows({ ...load.data, callerId: teamMember.id }, now);
  const answer: TodayView = {
    generatedAt: now.toISOString(),
    resetAt: load.data.resetAt,
    lessonsTotal: load.data.lessonsTotal,
    rows,
    handled,
  };
  return NextResponse.json(answer);
}
