/**
 * GET /api/admin/stats
 *
 * Revenue metrics for the founder-only /admin/stats page. Proxies Whop's
 * Stats API server-side so the API key never reaches a browser.
 *
 * FOUNDER-ONLY BY ID, NOT BY ROLE. requireStatsOwner() checks
 * STATS_ALLOWED_USER_IDS (src/lib/admin-auth.ts). `role` is mutable —
 * any founder can grant role='founder' via PATCH /api/admin/team-members/[id] —
 * so a role check would silently widen access to gross revenue and MRR.
 *
 * Query params:
 *   range       one of STATS_RANGES (default "last_28d"). A NAMED preset
 *               only; raw from/to is deliberately not accepted, because
 *               every existing admin date helper evaluates in the browser
 *               and is a day off in UTC+2, and a malformed window returns
 *               a clean 200 with points:[] rather than an error.
 *   granularity day | week | month (default "day"). Coerced by window size.
 *   metrics     comma-separated metric keys, max 12.
 *   product     optional prod_… id. Applies only to product-aware metrics;
 *               a non-product metric returns reason:"unsupported" per tile.
 *
 * Response: see StatsResponse below. Every tile is a discriminated union —
 * there is no path by which a failure becomes the number 0.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireStatsOwner, isAuthFailure } from "@/lib/admin-auth";
import {
  fetchMetricSeries,
  pooled,
  rollupPoints,
  resolveRange,
  coerceGranularity,
  isStatsRange,
  resolveCustomRange,
  reconcileProducts,
  type TileResult,
  type Reconciliation,
} from "@/lib/whop-stats";
import {
  WHOP_METRICS,
  WHOP_PICKABLE_METRICS,
  WHOP_PRODUCTS,
} from "@/lib/whop-stats-catalog";

// This response is one person's revenue. It must never be reachable from a
// shared cache, and must never be statically optimised.
export const dynamic = "force-dynamic";

// Deliberately 30, NOT the house 300. Every existing maxDuration=300 in this
// repo is on a cron or a batch button. This is an interactive page load: a
// 300s ceiling means a wedged upstream holds a browser tab for five minutes
// and bills fluid compute for the whole wait.
export const maxDuration = 30;

/** Hard cap on tiles per request — the browser, not the server, is the limit. */
const MAX_METRICS = 12;

const DEFAULT_METRICS = [
  "gross_revenue",
  "net_revenue",
  "monthly_recurring_revenue",
  "annual_recurring_revenue",
  "paid_active_members",
  "product_new_users",
];

function noStore(res: NextResponse): NextResponse {
  res.headers.set("Cache-Control", "no-store, private, max-age=0");
  // Belt and braces: no-store already forbids storage, but an intermediary
  // that ignores it would otherwise key on URL alone and could serve one
  // person's revenue to the next caller.
  res.headers.set("Vary", "Authorization");
  return res;
}

export async function GET(request: NextRequest) {
  const auth = await requireStatsOwner(request);
  if (isAuthFailure(auth)) return noStore(auth.error);

  if (!process.env.WHOP_COMPANY_ID) {
    return noStore(
      NextResponse.json(
        { error: "WHOP_COMPANY_ID not set" },
        { status: 500 },
      ),
    );
  }

  const sp = request.nextUrl.searchParams;

  // range=custom takes explicit from/to. Everything else is a named preset.
  // Custom dates are validated strictly and REJECTED on any problem — never
  // clamped into a different window that would return plausible numbers for
  // dates nobody asked for.
  const rangeParam = sp.get("range") ?? "last_28d";
  let window;
  if (rangeParam === "custom") {
    const resolved = resolveCustomRange(
      sp.get("from") ?? "",
      sp.get("to") ?? "",
    );
    if (!resolved.ok) {
      return noStore(
        NextResponse.json({ error: resolved.reason }, { status: 400 }),
      );
    }
    window = resolved.range;
  } else if (!isStatsRange(rangeParam)) {
    return noStore(
      NextResponse.json({ error: "Unknown range" }, { status: 400 }),
    );
  } else {
    window = resolveRange(rangeParam);
  }

  const gParam = sp.get("granularity") ?? "day";
  if (gParam !== "day" && gParam !== "week" && gParam !== "month") {
    return noStore(
      NextResponse.json({ error: "Unknown granularity" }, { status: 400 }),
    );
  }

  const product = sp.get("product");
  if (product && !/^prod_[A-Za-z0-9]+$/.test(product)) {
    return noStore(
      NextResponse.json({ error: "Malformed product id" }, { status: 400 }),
    );
  }

  const requested = (sp.get("metrics") ?? DEFAULT_METRICS.join(","))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const metrics = [...new Set(requested)];
  if (metrics.length === 0) {
    return noStore(
      NextResponse.json({ error: "No metrics requested" }, { status: 400 }),
    );
  }
  if (metrics.length > MAX_METRICS) {
    return noStore(
      NextResponse.json(
        { error: `At most ${MAX_METRICS} metrics per request` },
        { status: 400 },
      ),
    );
  }

  const unknown = metrics.filter((k) => !WHOP_METRICS[k]);
  if (unknown.length > 0) {
    return noStore(
      NextResponse.json(
        { error: `Unknown metric(s): ${unknown.join(", ")}` },
        { status: 400 },
      ),
    );
  }

  const { granularity, coerced } = coerceGranularity(
    gParam,
    window.from,
    window.to,
  );

  try {
    const results = await pooled(
      metrics.map((key) => async () => {
        const spec = WHOP_METRICS[key];
        // Only pass the product filter to metrics that accept it. Passing it
        // to one that does not is a 400 from Whop, so this saves a round trip
        // and lets the tile explain itself instead.
        const scoped = product && spec.product ? product : null;
        const tile = await fetchMetricSeries({
          key,
          ...window,
          product: scoped,
        });
        if (tile.status === "ok") {
          return {
            key,
            tile: {
              ...tile,
              points: rollupPoints(key, tile.points, granularity),
              // Rolled up identically so the dashed reference line shares
              // the current line's bucketing and the two are comparable.
              previousPoints: rollupPoints(key, tile.previousPoints, granularity),
            } satisfies TileResult,
          };
        }
        return { key, tile };
      }),
    );

    const tiles: Record<string, TileResult> = {};
    for (const r of results) tiles[r.key] = r.tile;

    // SELF-CHECK. Only meaningful unfiltered, and only worth the extra calls
    // when the founder is actually looking at gross revenue. If the account
    // total stops equalling the sum of its products, either a product was
    // added in Whop that this code does not know about, or Whop changed
    // per-product attribution — both silent, both make the per-product view
    // under-report while looking entirely normal.
    let reconciliation: Reconciliation | null = null;
    if (!product && metrics.includes("gross_revenue")) {
      reconciliation = await reconcileProducts(
        Object.values(WHOP_PRODUCTS),
        window.from,
        window.to,
      );
    }

    // If EVERY tile failed for the same credential reason, the problem is the
    // key or its scopes, not the metrics. Surface that once at the top rather
    // than as twelve identical "unavailable" tiles nobody can act on.
    const reasons = Object.values(tiles)
      .filter((t): t is Extract<TileResult, { status: "error" }> => t.status === "error")
      .map((t) => t.reason);
    const credentialFailure =
      reasons.length === metrics.length &&
      reasons.every((r) => r === "auth" || r === "scope")
        ? reasons[0]
        : null;

    return noStore(
      NextResponse.json({
        range: {
          key: rangeParam,
          from: window.from,
          to: window.to,
          previous: { from: window.previousFrom, to: window.previousTo },
          trailingPartial: window.trailingPartial,
        },
        granularity,
        granularityCoerced: coerced,
        product: product ?? null,
        tiles,
        reconciliation,
        credentialFailure,
        available: WHOP_PICKABLE_METRICS,
        computed_at: new Date().toISOString(),
      }),
    );
  } catch (e) {
    // Never let an upstream body reach the client. fetchMetricSeries already
    // classifies per-tile failures into a closed union; anything thrown here
    // is our own bug, so log it server-side and return a bare 500.
    console.error("[admin/stats] unhandled", e);
    return noStore(
      NextResponse.json({ error: "Stats unavailable" }, { status: 500 }),
    );
  }
}
