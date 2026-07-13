/**
 * GET /api/admin/templates/stats
 *
 * Per-template effectiveness for the inline strip on /admin/templates.
 * v85.2: thin projection over src/lib/outreach-insights.ts — the SAME
 * computation the /admin/tasks/insights page uses, so the strip and
 * the page can never disagree. All-time range.
 *
 * Response shape kept from v85:
 *   { stats: { [templateId]: { created, open, sent, dismissed,
 *     replied, no_reply, re_engaged_72h } }, computed_at }
 *
 * Correlation, not causation — see the methodology box on
 * /admin/tasks/insights for the full definitions.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTeam, isAuthFailure } from "@/lib/admin-auth";
import { computeOutreachInsights } from "@/lib/outreach-insights";

export async function GET(request: NextRequest) {
  const auth = await requireTeam(request);
  if (isAuthFailure(auth)) return auth.error;

  try {
    const insights = await computeOutreachInsights(auth.supabase, {});
    const stats: Record<
      string,
      {
        created: number;
        open: number;
        sent: number;
        dismissed: number;
        replied: number;
        no_reply: number;
        re_engaged_72h: number;
      }
    > = {};
    for (const row of insights.templates) {
      stats[row.template_id] = {
        created: row.created,
        open: row.open,
        sent: row.sent,
        dismissed: row.dismissed,
        replied: row.replied,
        no_reply: row.no_reply,
        re_engaged_72h: row.re_engaged_72h,
      };
    }
    return NextResponse.json({
      stats,
      computed_at: insights.computed_at,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
