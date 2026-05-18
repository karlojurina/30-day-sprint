/**
 * GET  /api/admin/dm-toggles — return every toggle's current value.
 * POST /api/admin/dm-toggles — body: { key, value } where key is a
 *                              DmToggleKey and value is boolean. Writes
 *                              the new value to admin_config.
 *
 * UI: /admin/discord — DM settings section.
 * Auth: founder + admin only.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTeam, isAuthFailure } from "@/lib/admin-auth";
import {
  readAllDmToggles,
  writeDmToggle,
  type DmToggleKey,
} from "@/lib/dm-toggles";

const ALLOWED_KEYS = new Set<DmToggleKey>([
  "dms_master_enabled",
  "day28_dm_enabled",
  "engagement_alerts_enabled",
  "csm_task_summary_enabled",
]);

export async function GET(request: NextRequest) {
  const auth = await requireTeam(request, ["founder", "admin"]);
  if (isAuthFailure(auth)) return auth.error;
  const toggles = await readAllDmToggles(auth.supabase);
  return NextResponse.json({ toggles });
}

export async function POST(request: NextRequest) {
  const auth = await requireTeam(request, ["founder", "admin"]);
  if (isAuthFailure(auth)) return auth.error;
  const body = (await request.json().catch(() => ({}))) as {
    key?: string;
    value?: boolean;
  };
  if (!body.key || typeof body.value !== "boolean") {
    return NextResponse.json(
      { error: "key + boolean value required" },
      { status: 400 },
    );
  }
  if (!ALLOWED_KEYS.has(body.key as DmToggleKey)) {
    return NextResponse.json({ error: "unknown toggle key" }, { status: 400 });
  }
  const result = await writeDmToggle(
    auth.supabase,
    body.key as DmToggleKey,
    body.value,
  );
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  // Return the fresh full state so the UI can re-render without a
  // second roundtrip.
  const toggles = await readAllDmToggles(auth.supabase);
  return NextResponse.json({ ok: true, toggles });
}
