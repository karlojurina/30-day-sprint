/**
 * GET /api/admin/insights/progress?range=7|30|90|365
 *
 * Returns the daily_progress_snapshots series for the requested window
 * (in days from today), oldest first. Team-only.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTeam, isAuthFailure } from "@/lib/admin-auth";

export async function GET(request: NextRequest) {
  const auth = await requireTeam(request);
  if (isAuthFailure(auth)) return auth.error;

  const url = new URL(request.url);
  const rangeParam = parseInt(url.searchParams.get("range") ?? "30", 10);
  const range = Math.min(Math.max(rangeParam || 30, 1), 730);

  const since = new Date(Date.now() - range * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const { data, error } = await auth.supabase
    .from("daily_progress_snapshots")
    .select("*")
    .gte("snapshot_date", since)
    .order("snapshot_date", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ range, points: data ?? [] });
}
