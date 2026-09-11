/**
 * POST /api/admin/etfb/links
 *
 * Mint one free 10-seat team link for a brand owner and record the owner in the
 * same request. Body: { ownerWhopUserId: string }
 *
 * IDEMPOTENT BY DESIGN. If the owner already has an active link this returns
 * that link and calls Whop ZERO times. Minting a second link splits an owner's
 * team across two links, and a later revocation then silently misses half of
 * them — a failure that has already happened by hand twice in production
 * (liaoant18888, michael51ce). The partial unique index
 * etfb_team_links_one_active_per_owner is the database-level backstop.
 *
 * ORDER OF OPERATIONS. Whop first, then our row. A crash between the two leaves
 * an orphan plan in Whop rather than a row pointing at a plan that does not
 * exist — and the orphan is caught permanently by the `unrecordedLinks` section
 * of GET /api/admin/etfb, which reconciles Whop against our table on every load.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTeam, isAuthFailure } from "@/lib/admin-auth";
import { postTeamAlert } from "@/lib/discord";
import {
  ETFB_PRODUCT_ID,
  fetchMembershipsForProduct,
  fetchPlansForProduct,
  fetchUnfilteredMembershipTotal,
  derivePayingOwnerIds,
  mintTeamLink,
} from "@/lib/etfb";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const auth = await requireTeam(request);
  if (isAuthFailure(auth)) return auth.error;

  let ownerWhopUserId: string;
  try {
    const body = (await request.json()) as { ownerWhopUserId?: unknown };
    if (
      typeof body.ownerWhopUserId !== "string" ||
      !body.ownerWhopUserId.startsWith("user_")
    ) {
      return NextResponse.json(
        { error: "ownerWhopUserId must be a Whop user id (user_…)" },
        { status: 400 },
      );
    }
    ownerWhopUserId = body.ownerWhopUserId;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // 1. Idempotency check BEFORE touching Whop.
  const { data: existing, error: readErr } = await auth.supabase
    .from("etfb_team_links")
    .select("plan_id")
    .eq("owner_whop_user_id", ownerWhopUserId)
    .eq("status", "active")
    .maybeSingle();
  if (readErr) {
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }
  if (existing) {
    return NextResponse.json({
      created: false,
      planId: existing.plan_id,
      checkoutUrl: `https://whop.com/checkout/${existing.plan_id}`,
    });
  }

  try {
    // 2. Confirm this person actually is a paying brand owner. Minting a free
    //    course link for someone who never paid is the leak this tool exists
    //    to close, so it must not be possible through the tool itself.
    const unfilteredTotal = await fetchUnfilteredMembershipTotal();
    const [etfbPlans, etfbMemberships] = await Promise.all([
      fetchPlansForProduct(ETFB_PRODUCT_ID),
      fetchMembershipsForProduct(ETFB_PRODUCT_ID, unfilteredTotal),
    ]);
    const plansById = new Map(etfbPlans.map((p) => [p.id, p]));
    const { payingOwnerIds: paying } = derivePayingOwnerIds(
      etfbMemberships,
      plansById,
    );
    if (!paying.has(ownerWhopUserId)) {
      return NextResponse.json(
        {
          error:
            "That Whop user does not currently hold a valid paid EcomTalent " +
            "for Brands membership, so a team link cannot be minted for them.",
        },
        { status: 409 },
      );
    }
    const ownerMembership = etfbMemberships.find(
      (m) => m.user === ownerWhopUserId && m.valid,
    );

    // 3. Create in Whop.
    const minted = await mintTeamLink({
      ownerName: null,
      ownerUsername: null,
      ownerWhopUserId,
      ownerPlanId: ownerMembership?.plan ?? null,
    });

    // 4. Record ownership. Whop is already written at this point; a failure
    //    here surfaces as an unrecorded link on the snapshot, never silently.
    const { error: insErr } = await auth.supabase
      .from("etfb_team_links")
      .insert({
        plan_id: minted.planId,
        owner_whop_user_id: ownerWhopUserId,
        owner_email: ownerMembership?.email ?? null,
        status: "active",
        attribution_method: "minted_by_app",
        attribution_confidence: "certain",
        note: minted.internalNote,
        minted_by: auth.teamMember.id,
      });
    if (insErr) {
      console.error(
        `[etfb] link ${minted.planId} created in Whop but NOT recorded:`,
        insErr.message,
      );
      // The worst state this system can reach: a live free-access link in Whop
      // that no list here knows about. It MUST reach a human, because the tab
      // that saw it is about to be closed.
      void postTeamAlert(
        [
          {
            title: "ETfB link created in Whop but NOT recorded",
            description:
              `Plan: ${minted.planId}\nOwner: ${ownerWhopUserId}\n` +
              `Error: ${insErr.message}\n\nThis is a LIVE 10-seat free-access ` +
              `link that no list knows about. Either assign it an owner or ` +
              `archive it in Whop.`,
            color: 0xdc2626,
          },
        ],
        "ETfB: orphaned team link",
      );
      return NextResponse.json(
        {
          error:
            `The link was created in Whop (${minted.planId}) but recording ` +
            `the owner failed: ${insErr.message}. It will appear under ` +
            `"links not recorded here" until it is assigned.`,
          planId: minted.planId,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      created: true,
      planId: minted.planId,
      checkoutUrl: minted.checkoutUrl,
      internalNote: minted.internalNote,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[etfb] mint failed:", message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
