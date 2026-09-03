/**
 * GET  /api/admin/stats/views   — list the founder's saved tile layouts
 * PUT  /api/admin/stats/views   — create or update one { id?, name, layout }
 * DELETE /api/admin/stats/views?id=… — archive one (never hard-deleted)
 *
 * Founder-only by id via requireStatsOwner(). Reads and writes
 * `stats_saved_views`, whose RLS predicate is
 * public.current_user_is_stats_owner() — deliberately NOT
 * current_user_is_team(), which every other policy in this schema uses
 * and which is role-blind.
 *
 * `auth.supabase` from requireStatsOwner is a SERVICE-ROLE client and so
 * bypasses RLS entirely. The RLS policy is defence in depth for anything
 * that ever reaches this table with an anon key; the gate that actually
 * protects these routes is requireStatsOwner.
 *
 * Layouts hold only which metrics are on screen and how they are arranged.
 * No revenue figure is stored here or anywhere else.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireStatsOwner, isAuthFailure } from "@/lib/admin-auth";
import { WHOP_METRICS } from "@/lib/whop-stats-catalog";
import { isStatsRange, resolveCustomRange } from "@/lib/whop-stats";

export const dynamic = "force-dynamic";

const MAX_METRICS_PER_VIEW = 12;
const MAX_VIEWS = 40;

export type SavedLayout = {
  metrics: { key: string; product: string | null }[];
  granularity: "day" | "week" | "month";
  range: string;
  /** Present only when range === "custom". Calendar dates, UTC. */
  from?: string;
  to?: string;
};

function noStore(res: NextResponse): NextResponse {
  res.headers.set("Cache-Control", "no-store, private, max-age=0");
  res.headers.set("Vary", "Authorization");
  return res;
}

/**
 * Validate a layout coming from the client. Returns the sanitised layout or
 * a reason string. Unknown metric keys are REJECTED rather than dropped:
 * silently discarding a tile would make a saved view quietly lose a metric
 * and the founder would have no way to tell.
 */
function parseLayout(raw: unknown): { layout: SavedLayout } | { reason: string } {
  if (!raw || typeof raw !== "object") return { reason: "layout must be an object" };
  const o = raw as Record<string, unknown>;

  if (!Array.isArray(o.metrics)) return { reason: "layout.metrics must be an array" };
  if (o.metrics.length === 0) return { reason: "layout.metrics is empty" };
  if (o.metrics.length > MAX_METRICS_PER_VIEW) {
    return { reason: `at most ${MAX_METRICS_PER_VIEW} metrics per view` };
  }

  const metrics: SavedLayout["metrics"] = [];
  for (const m of o.metrics) {
    if (!m || typeof m !== "object") return { reason: "malformed metric entry" };
    const key = (m as Record<string, unknown>).key;
    const product = (m as Record<string, unknown>).product ?? null;
    if (typeof key !== "string" || !WHOP_METRICS[key]) {
      return { reason: `unknown metric "${String(key)}"` };
    }
    if (WHOP_METRICS[key].usable === "no") {
      return { reason: `metric "${key}" is not renderable` };
    }
    if (product !== null && (typeof product !== "string" || !/^prod_[A-Za-z0-9]+$/.test(product))) {
      return { reason: `malformed product on "${key}"` };
    }
    metrics.push({ key, product: product as string | null });
  }

  const g = o.granularity;
  if (g !== "day" && g !== "week" && g !== "month") {
    return { reason: "layout.granularity must be day|week|month" };
  }
  // A custom range is a legitimate thing to save — it is the whole point of
  // being able to reconcile an arbitrary window against Whop's dashboard. It
  // carries its own from/to, validated by the SAME resolver the route uses so
  // a stored window can never be one the route would reject.
  if (o.range === "custom") {
    const from = typeof o.from === "string" ? o.from : "";
    const to = typeof o.to === "string" ? o.to : "";
    const resolved = resolveCustomRange(from, to);
    if (!resolved.ok) return { reason: `layout.range: ${resolved.reason}` };
    return { layout: { metrics, granularity: g, range: "custom", from, to } };
  }

  if (!isStatsRange(o.range)) return { reason: "layout.range is not a known preset" };

  return { layout: { metrics, granularity: g, range: o.range } };
}

export async function GET(request: NextRequest) {
  const auth = await requireStatsOwner(request);
  if (isAuthFailure(auth)) return noStore(auth.error);

  const { data, error } = await auth.supabase
    .from("stats_saved_views")
    .select("id, name, layout, status, created_at, updated_at")
    .eq("owner_id", auth.teamMember.id)
    .eq("status", "active")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[admin/stats/views] select failed", error.message);
    return noStore(
      NextResponse.json({ error: "Could not load views" }, { status: 500 }),
    );
  }

  // A stored layout that no longer validates (a metric Whop retired, a hand
  // edit) is returned flagged rather than silently repaired, so the UI can
  // say so instead of quietly showing a different set of tiles.
  const views = (data ?? []).map((v) => {
    const parsed = parseLayout(v.layout);
    return "layout" in parsed
      ? { ...v, layout: parsed.layout, invalid: null }
      : { ...v, layout: null, invalid: parsed.reason };
  });

  return noStore(NextResponse.json({ views }));
}

export async function PUT(request: NextRequest) {
  const auth = await requireStatsOwner(request);
  if (isAuthFailure(auth)) return noStore(auth.error);

  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const id = typeof body?.id === "string" ? body.id : null;

  if (!name) {
    return noStore(NextResponse.json({ error: "Missing name" }, { status: 400 }));
  }
  if (name.length > 80) {
    return noStore(NextResponse.json({ error: "Name too long" }, { status: 400 }));
  }

  const parsed = parseLayout(body?.layout);
  if ("reason" in parsed) {
    return noStore(NextResponse.json({ error: parsed.reason }, { status: 400 }));
  }

  const now = new Date().toISOString();

  if (id) {
    const { data, error } = await auth.supabase
      .from("stats_saved_views")
      .update({ name, layout: parsed.layout, updated_at: now })
      .eq("id", id)
      .eq("owner_id", auth.teamMember.id)
      .select("id, name, layout, status, created_at, updated_at")
      .maybeSingle();

    if (error) {
      console.error("[admin/stats/views] update failed", error.message);
      return noStore(
        NextResponse.json({ error: "Could not save view" }, { status: 500 }),
      );
    }
    if (!data) {
      return noStore(NextResponse.json({ error: "View not found" }, { status: 404 }));
    }
    return noStore(NextResponse.json({ view: data }));
  }

  const { count } = await auth.supabase
    .from("stats_saved_views")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", auth.teamMember.id)
    .eq("status", "active");

  if ((count ?? 0) >= MAX_VIEWS) {
    return noStore(
      NextResponse.json(
        { error: `At most ${MAX_VIEWS} saved views — archive one first` },
        { status: 400 },
      ),
    );
  }

  const { data, error } = await auth.supabase
    .from("stats_saved_views")
    .insert({
      owner_id: auth.teamMember.id,
      name,
      layout: parsed.layout,
    })
    .select("id, name, layout, status, created_at, updated_at")
    .single();

  if (error) {
    console.error("[admin/stats/views] insert failed", error.message);
    return noStore(
      NextResponse.json({ error: "Could not create view" }, { status: 500 }),
    );
  }

  return noStore(NextResponse.json({ view: data }));
}

export async function DELETE(request: NextRequest) {
  const auth = await requireStatsOwner(request);
  if (isAuthFailure(auth)) return noStore(auth.error);

  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return noStore(NextResponse.json({ error: "Missing id" }, { status: 400 }));
  }

  // Archive, never delete — a layout that broke the page should stay
  // inspectable.
  const { data, error } = await auth.supabase
    .from("stats_saved_views")
    .update({ status: "archived", archived_at: new Date().toISOString() })
    .eq("id", id)
    .eq("owner_id", auth.teamMember.id)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[admin/stats/views] archive failed", error.message);
    return noStore(
      NextResponse.json({ error: "Could not archive view" }, { status: 500 }),
    );
  }
  if (!data) {
    return noStore(NextResponse.json({ error: "View not found" }, { status: 404 }));
  }

  return noStore(NextResponse.json({ archived: data.id }));
}
