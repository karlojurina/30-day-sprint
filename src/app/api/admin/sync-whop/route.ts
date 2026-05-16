/**
 * POST /api/admin/sync-whop
 *
 * Manual-button counterpart to the daily /api/cron/sync-whop cron.
 * Both share runWhopCommunitySync(). Founder + admin only.
 *
 * Whop members:read scope on WHOP_API_KEY is required.
 *
 * Response shape:
 *   {
 *     fetched: number,
 *     inserted: number,
 *     updated: number,
 *     skipped: number,
 *     status_breakdown: { active: N, canceled: M, ... },
 *     errors: number,
 *     duration_ms: number
 *   }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTeam, isAuthFailure } from "@/lib/admin-auth";
import { runWhopCommunitySync } from "@/lib/whop-sync-runner";

export async function POST(request: NextRequest) {
  const auth = await requireTeam(request, ["founder", "admin"]);
  if (isAuthFailure(auth)) return auth.error;

  const t0 = Date.now();
  try {
    const result = await runWhopCommunitySync(auth.supabase);
    return NextResponse.json({
      ...result,
      duration_ms: Date.now() - t0,
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : String(e),
        duration_ms: Date.now() - t0,
      },
      { status: 500 },
    );
  }
}
