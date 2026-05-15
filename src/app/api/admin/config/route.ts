/**
 * GET  /api/admin/config         — list all admin_config rows (team read)
 * PUT  /api/admin/config         — update a single row by key (founder/admin only)
 *
 * Body for PUT: { key: string, value: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTeam, isAuthFailure } from "@/lib/admin-auth";

export async function GET(request: NextRequest) {
  const auth = await requireTeam(request);
  if (isAuthFailure(auth)) return auth.error;

  const { data, error } = await auth.supabase
    .from("admin_config")
    .select("*")
    .order("key");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ config: data ?? [] });
}

export async function PUT(request: NextRequest) {
  const auth = await requireTeam(request, ["founder", "admin"]);
  if (isAuthFailure(auth)) return auth.error;

  const body = await request.json().catch(() => null);
  const key = typeof body?.key === "string" ? body.key.trim() : "";
  const value = typeof body?.value === "string" ? body.value : "";

  if (!key) {
    return NextResponse.json({ error: "Missing key" }, { status: 400 });
  }

  const { data, error } = await auth.supabase
    .from("admin_config")
    .update({
      value,
      updated_at: new Date().toISOString(),
      updated_by: auth.teamMember.id,
    })
    .eq("key", key)
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Config key not found" },
      { status: 404 },
    );
  }

  return NextResponse.json({ row: data });
}
