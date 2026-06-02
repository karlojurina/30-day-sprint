/**
 * Daily Whop community sync — runs at 02:00 UTC.
 *
 * Same body as the admin /api/admin/sync-whop button. Auth gate is
 * the cron secret instead of a user session.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { runWhopCommunitySync } from "@/lib/whop-sync-runner";

// v75.14.5: full sync iterates ~56 pages with 200ms throttle +
// batched upserts. Default 60s isn't enough on first run with
// thousands of members. 300s is Vercel Pro's max for fluid functions.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const supabase = createServiceClient();
  const t0 = Date.now();
  try {
    const result = await runWhopCommunitySync(supabase, "cron");
    return NextResponse.json({ ...result, duration_ms: Date.now() - t0 });
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
