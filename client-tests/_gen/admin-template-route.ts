/**
 * GET    /api/admin/templates/:id   single template (team read)
 * PUT    /api/admin/templates/:id   update body / title / metadata
 *                                   (founder + admin only)
 * DELETE /api/admin/templates/:id   delete a custom template (below)
 *
 * PUT body, partial; only provided keys are touched:
 *   { body?, title?, intent?, tone?, trigger_description?, is_active?,
 *     word_count?, bucket?, trigger_config? }
 * trigger_config: null clears, an object replaces. The Templates page sends
 * only the fields that changed (changedFields, src/lib/admin/templates-data.ts).
 *
 * scenario_id, week and is_admin_only are not editable here.
 */

import { NextRequest, NextResponse } from "./stub-server.ts";
import { requireTeam, isAuthFailure } from "./stub-admin.ts";

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
 * DELETE /api/admin/templates/:id: delete a CUSTOM template (founder +
 * admin only).
 *
 * A built-in is refused with a 400 since admin rebuild 2 (WI-8): no route
 * can make a built-in scenario again, so a deleted one was gone for good,
 * and the crons that look for it went quiet (`if (!templateId) continue;`).
 * Where a built-in's switch works, Turn off on the Templates page stops it
 * instead (src/lib/template-on-off.ts). Deleting a custom template is
 * non-destructive for history: tasks.template_id has ON DELETE SET NULL, so
 * its tasks keep their row and behavior_summary but lose the link.
 *
 * The delete itself is limited to custom rows (`is_custom = true`), so a
 * built-in is never deleted, whatever else happens in between; a template
 * that was not deleted is then read to answer 400 (a built-in) or 404.
 */
export async function DELETE(request: NextRequest, ctx: RouteContext) {
  const auth = await requireTeam(request, ["founder", "admin"]);
  if (isAuthFailure(auth)) return auth.error;
  const { id } = await ctx.params;

  const { data: deleted, error } = await auth.supabase
    .from("templates")
    .delete()
    .eq("id", id)
    .eq("is_custom", true)
    .select("id");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (deleted && deleted.length > 0) {
    return NextResponse.json({ ok: true });
  }

  const { data: found, error: readError } = await auth.supabase
    .from("templates")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (readError) {
    return NextResponse.json({ error: readError.message }, { status: 500 });
  }
  if (found) {
    return NextResponse.json(
      { error: "A built-in template can't be deleted. Only a custom one can." },
      { status: 400 },
    );
  }
  return NextResponse.json({ error: "Template not found" }, { status: 404 });
}
