/**
 * GET /api/admin/templates — list all templates (team read).
 *
 * Query params (optional):
 *   ?week=W1|W2|W3|W4|D1|X       filter by week
 *   ?bucket=at_risk|crushing|... filter by bucket
 *   ?include_inactive=1          include is_active = false rows (default: active only)
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTeam, isAuthFailure } from "@/lib/admin-auth";

export async function GET(request: NextRequest) {
  const auth = await requireTeam(request);
  if (isAuthFailure(auth)) return auth.error;

  const url = new URL(request.url);
  const week = url.searchParams.get("week");
  const bucket = url.searchParams.get("bucket");
  const includeInactive = url.searchParams.get("include_inactive") === "1";

  let q = auth.supabase
    .from("templates")
    .select("*")
    .order("week", { ascending: true })
    .order("scenario_id", { ascending: true });

  if (week) q = q.eq("week", week);
  if (bucket) q = q.eq("bucket", bucket);
  if (!includeInactive) q = q.eq("is_active", true);

  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ templates: data ?? [] });
}
