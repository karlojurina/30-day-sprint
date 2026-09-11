/**
 * POST /api/admin/etfb/links/:planId/owner
 *
 * Assign or confirm the brand owner of an existing link.
 * Body: { ownerWhopUserId: string | null, confirm?: boolean }
 *
 * Two jobs:
 *   - assign an owner to a link imported as status='needs_owner'
 *   - confirm one of the 22 links attributed by exact name match, which are
 *     seeded with attribution_confidence='confirm' and stay flagged in the UI
 *     until a human agrees. A name is not proof, and a wrong owner here takes
 *     access away from a paying customer's staff.
 *
 * Confirming does NOT change the recorded method — how a link was matched stays
 * on the record permanently, so the provenance of every attribution is auditable.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTeam, isAuthFailure } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

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

  let ownerWhopUserId: string | null;
  let confirm = false;
  try {
    const body = (await request.json()) as {
      ownerWhopUserId?: unknown;
      confirm?: unknown;
    };
    confirm = body.confirm === true;
    if (body.ownerWhopUserId === null) {
      ownerWhopUserId = null;
    } else if (
      typeof body.ownerWhopUserId === "string" &&
      body.ownerWhopUserId.startsWith("user_")
    ) {
      ownerWhopUserId = body.ownerWhopUserId;
    } else {
      return NextResponse.json(
        { error: "ownerWhopUserId must be a user_… id or null" },
        { status: 400 },
      );
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {
    owner_whop_user_id: ownerWhopUserId,
    status: ownerWhopUserId ? "active" : "needs_owner",
    confirmed_at: new Date().toISOString(),
    confirmed_by: auth.teamMember.id,
  };
  // Only a human decision promotes confidence. attribution_method is left
  // alone on purpose — provenance is permanent.
  if (confirm && ownerWhopUserId) patch.attribution_confidence = "manual";

  // .select() is load-bearing: PostgREST returns 204 with error:null when zero
  // rows match, so without it a plan id that is not in the table reports
  // success and the caller believes an attribution was recorded that was not.
  const { data, error } = await auth.supabase
    .from("etfb_team_links")
    .update(patch)
    .eq("plan_id", planId)
    .select("plan_id");

  if (!error && (!data || data.length === 0)) {
    return NextResponse.json(
      {
        error:
          `No link ${planId} is recorded here, so there was nothing to update. ` +
          `If this plan exists in Whop it needs to be imported first.`,
      },
      { status: 404 },
    );
  }
  if (error) {
    // 23505 = the one-active-link-per-owner index. Surface it as a real
    // conflict rather than a 500, because it means this owner already has a
    // link and assigning a second would split their team.
    const status = error.code === "23505" ? 409 : 500;
    const message =
      status === 409
        ? "That owner already has an active link. Archive it first, or assign this link to someone else."
        : error.message;
    return NextResponse.json({ error: message }, { status });
  }
  return NextResponse.json({ ok: true, planId, ownerWhopUserId });
}
