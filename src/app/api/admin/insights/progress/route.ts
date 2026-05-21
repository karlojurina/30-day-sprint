/**
 * GET /api/admin/insights/progress
 *
 * Returns the daily_progress_snapshots series for a requested window,
 * oldest first. Team-only.
 *
 * Query params (one of):
 *   ?range=7|30|90|365|all   → preset windows (days from today)
 *   ?from=YYYY-MM-DD&to=YYYY-MM-DD  → custom date range, inclusive
 *
 * If both forms are passed, the custom from/to wins. Missing params
 * fall back to range=30.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTeam, isAuthFailure } from "@/lib/admin-auth";

export async function GET(request: NextRequest) {
  const auth = await requireTeam(request);
  if (isAuthFailure(auth)) return auth.error;

  const url = new URL(request.url);
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const rangeParam = url.searchParams.get("range") ?? "30";

  // Resolve the date window.
  let sinceISO: string | null = null;
  let untilISO: string | null = null;

  if (fromParam && toParam) {
    // Custom range — validate YYYY-MM-DD shape with a permissive regex.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromParam)) {
      return NextResponse.json({ error: "Invalid 'from' date" }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(toParam)) {
      return NextResponse.json({ error: "Invalid 'to' date" }, { status: 400 });
    }
    sinceISO = fromParam;
    untilISO = toParam;
  } else if (rangeParam === "all") {
    sinceISO = "2020-01-01"; // far past
  } else {
    const rangeNum = Math.min(Math.max(parseInt(rangeParam, 10) || 30, 1), 730);
    sinceISO = new Date(Date.now() - rangeNum * 86_400_000)
      .toISOString()
      .slice(0, 10);
  }

  let query = auth.supabase
    .from("daily_progress_snapshots")
    .select("*")
    .gte("snapshot_date", sinceISO)
    .order("snapshot_date", { ascending: true });

  if (untilISO) {
    query = query.lte("snapshot_date", untilISO);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    from: sinceISO,
    to: untilISO,
    points: data ?? [],
  });
}
