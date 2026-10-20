/**
 * GET  /api/admin/config         — list all admin_config rows (team read)
 * PUT  /api/admin/config         — update a single row by key (founder/admin only)
 *
 * Body for PUT: { key: string, value: string }
 *
 * PUT writes only the 6 keys of src/lib/admin/config-keys.ts (admin rebuild
 * 2, D6): the 2 message links and the 4 Discord switches, a switch only as
 * "true" or "false". Every other key is refused with a 400 and nothing is
 * written.
 */

import { NextRequest, NextResponse } from "./stub-server.ts";
import { requireTeam, isAuthFailure } from "./admin-auth.ts";
import { CURRICULUM_RESET_KEY } from "./curriculum-reset.ts";
import { configWriteError } from "./config-keys.ts";

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
  const value: unknown = body?.value;

  if (!key) {
    return NextResponse.json({ error: "Missing key" }, { status: 400 });
  }
  // The course switch writes this once (cutover PRD, C6). Moving it would
  // move every course day, CSM window and snapshot floor counted from it.
  if (key === CURRICULUM_RESET_KEY) {
    return NextResponse.json(
      { error: "The course switch date is set by the switch and cannot be changed here." },
      { status: 400 },
    );
  }
  const refused = configWriteError(key, value);
  if (refused) {
    return NextResponse.json({ error: refused }, { status: 400 });
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
    .maybeSingle();

  if (error) {
    console.error("[admin/config] update failed", key, error.message);
    return NextResponse.json({ error: "Couldn't save the setting. Try again." }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json(
      { error: "This setting has no row in the database, so nothing was saved." },
      { status: 404 },
    );
  }

  return NextResponse.json({ row: data });
}
