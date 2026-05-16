/**
 * GET  /api/admin/templates/:id   — single template (team read)
 * PUT  /api/admin/templates/:id   — update body / title / metadata
 *                                   (founder + admin only)
 *
 * PUT body — partial; only provided keys are touched:
 *   { body?, title?, intent?, tone?, trigger_description?, is_active?, word_count? }
 *
 * scenario_id, bucket, week, is_admin_only are intentionally NOT editable
 * via this endpoint — they're structural and locked at seed time.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTeam, isAuthFailure } from "@/lib/admin-auth";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, ctx: RouteContext) {
  const auth = await requireTeam(request);
  if (isAuthFailure(auth)) return auth.error;
  const { id } = await ctx.params;

  const { data, error } = await auth.supabase
    .from("templates")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }
  return NextResponse.json({ template: data });
}

export async function PUT(request: NextRequest, ctx: RouteContext) {
  const auth = await requireTeam(request, ["founder", "admin"]);
  if (isAuthFailure(auth)) return auth.error;
  const { id } = await ctx.params;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (typeof body.body === "string") update.body = body.body;
  if (typeof body.title === "string") update.title = body.title.trim();
  if (typeof body.intent === "string") update.intent = body.intent;
  if (typeof body.tone === "string") update.tone = body.tone;
  if (typeof body.trigger_description === "string") {
    update.trigger_description = body.trigger_description;
  }
  if (typeof body.is_active === "boolean") update.is_active = body.is_active;
  if (typeof body.word_count === "number") update.word_count = body.word_count;
  if (typeof body.bucket === "string") update.bucket = body.bucket;
  if (body.trigger_config !== undefined) {
    // null clears, object replaces.
    update.trigger_config = body.trigger_config;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No editable fields provided" }, { status: 400 });
  }

  const { data, error } = await auth.supabase
    .from("templates")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Template not found" },
      { status: 404 },
    );
  }

  return NextResponse.json({ template: data });
}

/**
 * DELETE /api/admin/templates/:id — delete any template.
 *
 * Built-ins used to be protected, but Karlo wants full control over
 * which scenarios fire. Deleting a built-in is non-destructive:
 *   - tasks.template_id has ON DELETE SET NULL, so historical tasks
 *     keep their row + behavior_summary but lose the link.
 *   - The CSM cron `if (!templateId) continue;` guard means built-in
 *     scenarios whose template is missing just stop creating new tasks.
 *
 * Re-seeding the deleted template = re-running v27's seed insert (with
 * the matching scenario_id and ON CONFLICT DO NOTHING removed).
 */
export async function DELETE(request: NextRequest, ctx: RouteContext) {
  const auth = await requireTeam(request, ["founder", "admin"]);
  if (isAuthFailure(auth)) return auth.error;
  const { id } = await ctx.params;

  const { error } = await auth.supabase
    .from("templates")
    .delete()
    .eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
