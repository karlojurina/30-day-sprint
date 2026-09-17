/**
 * POST /api/admin/rebuild-snapshots
 *
 * Wipes daily_progress_snapshots from 2026-01-01 forward and recomputes
 * every day's row from the current students + completions data. Use
 * this after the first Whop sync so the historical trend reflects the
 * full community, not just the slice we tracked at the time.
 *
 * Same formulas as the v33 backfill migration. Founder + admin only.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTeam, isAuthFailure } from "@/lib/admin-auth";

export async function POST(request: NextRequest) {
  const auth = await requireTeam(request, ["founder", "admin"]);
  if (isAuthFailure(auth)) return auth.error;

  const t0 = Date.now();
  // Run the rebuild as one Postgres call so it's atomic + fast.
  // v89: BOUNDED to the last 2 days. This used to pass '2026-01-01',
  // which made rebuild_daily_snapshots() delete and re-derive the entire
  // series from each student's CURRENT membership_status — a survivorship
  // curve that can never fall. Measured 2026-09-17: 194 days (2026-01-01
  // to 2026-07-13) still carry that back-projection, while 66 days from
  // 2026-07-14 onward are genuine point-in-time rows the nightly cron
  // collected one at a time. Those 66 days survived ONLY because this
  // call has not succeeded since 2026-07-13. Never widen this range
  // without passing an explicit p_end_date that stops short of collected
  // history. Repairing the old range is a deliberate, backed-up one-off.
  const rebuildFrom = new Date(Date.now() - 2 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const { error } = await auth.supabase.rpc("rebuild_daily_snapshots", {
    p_start_date: rebuildFrom,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  // Count what we ended up with so the UI can report it.
  const { count } = await auth.supabase
    .from("daily_progress_snapshots")
    .select("snapshot_date", { count: "exact", head: true })
    .gte("snapshot_date", "2026-01-01");
  return NextResponse.json({
    rows: count ?? 0,
    duration_ms: Date.now() - t0,
  });
}
