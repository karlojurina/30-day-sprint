/**
 * Daily Whop community sync — runs at 02:00 UTC.
 *
 * Same body as the admin /api/admin/sync-whop button. Auth gate is
 * the cron secret instead of a user session.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { runWhopCommunitySync } from "@/lib/whop-sync-runner";
import {
  verifyCronAuth,
  cronUnauthorizedResponse,
  logCronStart,
  logCronFinish,
} from "@/lib/cron-auth";

// v75.14.5: full sync iterates ~56 pages with 200ms throttle +
// batched upserts. Default 60s isn't enough on first run with
// thousands of members. 300s is Vercel Pro's max for fluid functions.
export const maxDuration = 300;

const ROUTE_NAME = "sync-whop";

export async function GET(request: NextRequest) {
  // v75.37: shared verifyCronAuth + cron_runs audit. See
  // src/lib/cron-auth.ts. Whitespace-trim defends against
  // CRON_SECRET drift; cron_runs row separates "did Vercel fire?"
  // from "did the work succeed?".
  const auth = verifyCronAuth(request);
  if (!auth.ok) {
    await logCronStart(ROUTE_NAME, auth.reason);
    return cronUnauthorizedResponse(auth.reason);
  }
  const runId = await logCronStart(ROUTE_NAME, "ok");

  const supabase = createServiceClient();
  const t0 = Date.now();
  try {
    const result = await runWhopCommunitySync(supabase, "cron");
    await logCronFinish(runId, "success", {
      rowsAffected: result.updated ?? 0,
    });
    return NextResponse.json({ ...result, duration_ms: Date.now() - t0 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logCronFinish(runId, "failed", { error: msg });
    return NextResponse.json(
      {
        error: msg,
        duration_ms: Date.now() - t0,
      },
      { status: 500 },
    );
  }
}
