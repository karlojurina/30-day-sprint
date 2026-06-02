/**
 * POST /api/admin/sync-whop
 *
 * Manual-button counterpart to the daily /api/cron/sync-whop cron.
 * Both share runWhopCommunitySync(). Founder + admin only.
 *
 * Whop members:read scope on WHOP_API_KEY is required.
 *
 * Response shape:
 *   {
 *     fetched: number,
 *     inserted: number,
 *     updated: number,
 *     skipped: number,
 *     status_breakdown: { active: N, canceled: M, ... },
 *     errors: number,
 *     duration_ms: number
 *   }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTeam, isAuthFailure } from "@/lib/admin-auth";
import { runWhopCommunitySync } from "@/lib/whop-sync-runner";

export async function POST(request: NextRequest) {
  const auth = await requireTeam(request, ["founder", "admin"]);
  if (isAuthFailure(auth)) return auth.error;

  const t0 = Date.now();
  try {
    const result = await runWhopCommunitySync(auth.supabase, "admin-button");

    // v75.14.2 DIAGNOSTIC — pull the first raw membership row from Whop
    // separately so the response includes the field shape. Vercel logs
    // weren't showing the console.info diagnostic; this puts it in the
    // response body where it can be inspected in DevTools → Network →
    // Response. Temporary; remove once plan_id population is verified.
    const debugRow = await fetchOneRawMembership().catch((e) => ({
      error: e instanceof Error ? e.message : String(e),
    }));

    return NextResponse.json({
      ...result,
      duration_ms: Date.now() - t0,
      _debug_raw_first_membership: debugRow,
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : String(e),
        duration_ms: Date.now() - t0,
      },
      { status: 500 },
    );
  }
}

/**
 * Direct fetch of the first membership Whop returns for our product,
 * with all fields. Bypasses the typed wrapper so the response shape
 * is visible verbatim — including any field name surprises.
 */
async function fetchOneRawMembership(): Promise<unknown> {
  const apiKey = process.env.WHOP_API_KEY;
  const productIds = (process.env.WHOP_PRODUCT_ID ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!apiKey || productIds.length === 0) {
    return { error: "WHOP_API_KEY or WHOP_PRODUCT_ID missing" };
  }
  const url = `https://api.whop.com/api/v2/memberships?product_id=${encodeURIComponent(productIds[0])}&per_page=1`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // keep raw text if not JSON
  }
  return {
    http_status: res.status,
    url_called: url.replace(apiKey, "***"),
    response: parsed,
  };
}
