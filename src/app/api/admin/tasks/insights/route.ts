/**
 * GET /api/admin/tasks/insights?since=<ISO>
 *
 * Full outreach-effectiveness payload for the /admin/tasks/insights
 * page: overall totals + per-template rows (sends, revival rate,
 * re-engagement, reply outcomes, dismissal split, median time-to-send).
 *
 * `since` is optional — omit for all-time. Range semantics live in
 * src/lib/outreach-insights.ts (each metric filters on its own
 * timestamp).
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTeam, isAuthFailure } from "@/lib/admin-auth";
import { computeOutreachInsights } from "@/lib/outreach-insights";

export async function GET(request: NextRequest) {
  const auth = await requireTeam(request);
  if (isAuthFailure(auth)) return auth.error;

  const sinceRaw = new URL(request.url).searchParams.get("since");
  const sinceIso =
    sinceRaw && !Number.isNaN(new Date(sinceRaw).getTime())
      ? new Date(sinceRaw).toISOString()
      : null;

  try {
    const insights = await computeOutreachInsights(auth.supabase, {
      sinceIso,
    });
    return NextResponse.json(insights);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
