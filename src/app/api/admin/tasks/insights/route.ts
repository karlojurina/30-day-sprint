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
 *
 * The tasks reset (admin rebuild 2, D7): once admin_config.tasks_reset_at
 * exists, only the tasks created on or after it count, whatever the range,
 * as the queue lists them. A failed read of it is a 500, never every task.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTeam, isAuthFailure } from "@/lib/admin-auth";
import { computeOutreachInsights } from "@/lib/outreach-insights";
import { getTasksResetAt } from "@/lib/admin/tasks-reset";

export async function GET(request: NextRequest) {
  const auth = await requireTeam(request);
  if (isAuthFailure(auth)) return auth.error;

  const sinceRaw = new URL(request.url).searchParams.get("since");
  if (sinceRaw && Number.isNaN(new Date(sinceRaw).getTime())) {
    // Loud 400 — silently degrading to all-time would present
    // unfiltered numbers as filtered ones.
    return NextResponse.json(
      { error: "Invalid since — must be an ISO timestamp" },
      { status: 400 },
    );
  }
  const sinceIso = sinceRaw ? new Date(sinceRaw).toISOString() : null;

  try {
    const tasksFloorIso = await getTasksResetAt(auth.supabase);
    const insights = await computeOutreachInsights(auth.supabase, {
      sinceIso,
      tasksFloorIso,
    });
    return NextResponse.json(insights);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
