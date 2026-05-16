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
  const { error } = await auth.supabase.rpc("rebuild_daily_snapshots", {
    p_start_date: "2026-01-01",
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
