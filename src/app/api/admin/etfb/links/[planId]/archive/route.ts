/**
 * POST /api/admin/etfb/links/:planId/archive
 *
 * Close a team link: archive it in Whop so it can no longer be redeemed, then
 * mark it archived here.
 *
 * WHY THIS EXISTS: without it, a churned owner's link stays live forever and
 * keeps handing out free course access to anyone holding the URL. Every new
 * redemption then shows up as another row in "Needs review", which looks like
 * the tool working rather than the door standing open — and the leak this
 * project exists to close quietly rebuilds itself after go-live.
 *
 * ARCHIVING IS NOT REVOCATION. It stops NEW redemptions. Everyone already on
 * the link keeps their access and keeps appearing in the review list until a
 * human cancels them in Whop. The response says so explicitly so nobody reads
 * "closed" as "everyone removed".
 *
 * ORDER: Whop first, then our row — same reasoning as minting. If the DB write
 * fails after Whop succeeded, the link is already safely shut and the row stays
 * 'active', so the worst case is that it appears in "Links to close" again and
 * a second attempt is a harmless no-op. Archiving is idempotent.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTeam, isAuthFailure } from "@/lib/admin-auth";
import { archiveTeamLink } from "@/lib/etfb";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface RouteContext {
  params: Promise<{ planId: string }>;
}

export async function POST(request: NextRequest, ctx: RouteContext) {
  const auth = await requireTeam(request);
  if (isAuthFailure(auth)) return auth.error;

  const { planId } = await ctx.params;
  if (!planId.startsWith("plan_")) {
    return NextResponse.json({ error: "Invalid plan id" }, { status: 400 });
  }

  // Refuse to touch the Evolve partner link, whatever the caller sends.
  const { data: row, error: readErr } = await auth.supabase
    .from("etfb_team_links")
    .select("plan_id,status")
    .eq("plan_id", planId)
    .maybeSingle();
  if (readErr) {
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json(
      { error: `No link ${planId} is recorded here.` },
      { status: 404 },
    );
  }
  if (row.status === "out_of_scope") {
    return NextResponse.json(
      {
        error:
          "That link is marked out of scope (the Evolve partnership link). It " +
          "is not a team-seat link and must not be closed here.",
      },
      { status: 409 },
    );
  }

  try {
    await archiveTeamLink(planId);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }

  const { error: updErr } = await auth.supabase
    .from("etfb_team_links")
    .update({ status: "archived", archived_at: new Date().toISOString() })
    .eq("plan_id", planId);
  if (updErr) {
    return NextResponse.json(
      {
        error:
          `The link was archived in Whop but recording it here failed: ` +
          `${updErr.message}. It is safely closed; it will simply reappear in ` +
          `"Links to close" until this is retried.`,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    planId,
    note:
      "Link closed — it can no longer be redeemed. Anyone already on it keeps " +
      "access and still appears in Needs review until they are cancelled in Whop.",
  });
}
