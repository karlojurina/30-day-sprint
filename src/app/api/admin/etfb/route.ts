/**
 * GET /api/admin/etfb
 *
 * The Brand Owners snapshot. Every figure is read LIVE from Whop at request
 * time — nothing about owners, seats or subscription state is cached in our
 * database. The only thing read from Postgres is which owner each link belongs
 * to, because that fact exists nowhere else.
 *
 * TEAM-WIDE, NOT FOUNDER-ONLY. requireTeam() with no role whitelist, matching
 * /admin/tasks. The founder/admin pattern used by templates and admin_config
 * would lock out the CSM whose job this tool is, and the /admin/stats
 * immutable-id allowlist would lock out everyone but Lovro.
 *
 * Every section is a discriminated union — ok / error. There is no path by
 * which a failed Whop read becomes an empty list, because an empty list here
 * reads as "nothing to do" and would quietly hide people who should lose access.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTeam, isAuthFailure } from "@/lib/admin-auth";
import { postTeamAlert } from "@/lib/discord";
import {
  ETFB_PRODUCT_ID,
  TEAM_SEAT_PRODUCT_ID,
  fetchUnfilteredMembershipTotal,
  fetchMembershipsForProduct,
  fetchPlansForProduct,
  derivePayingOwnerIds,
  deriveOwners,
  deriveReviewSeats,
  deriveUnrecordedLinks,
  deriveLinksToClose,
  deriveOwnerRows,
  deriveLinkRows,
  fetchMemberIdForMembership,
  type WhopPlan,
  type TeamLinkRow,
  type SeatDecisionRow,
} from "@/lib/etfb";

export const dynamic = "force-dynamic";
// Interactive page load, not a cron. The house 300 would hold a browser tab
// for five minutes against a wedged upstream.
export const maxDuration = 30;

function noStore(res: NextResponse) {
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Vary", "Authorization");
  return res;
}

export async function GET(request: NextRequest) {
  const auth = await requireTeam(request);
  if (isAuthFailure(auth)) return noStore(auth.error);

  try {
    const [linksRes, decisionsRes] = await Promise.all([
      auth.supabase.from("etfb_team_links").select("*"),
      auth.supabase.from("etfb_seat_decisions").select("*"),
    ]);
    if (linksRes.error) throw new Error(`links read: ${linksRes.error.message}`);
    if (decisionsRes.error)
      throw new Error(`decisions read: ${decisionsRes.error.message}`);

    const links = (linksRes.data ?? []) as TeamLinkRow[];
    const decisions = (decisionsRes.data ?? []) as SeatDecisionRow[];

    // Baseline first — every filtered read is checked against it, so a
    // silently-ignored filter throws instead of returning the whole account.
    const unfilteredTotal = await fetchUnfilteredMembershipTotal();

    const [etfbPlans, apexPlans, etfbMemberships, apexMemberships] =
      await Promise.all([
        fetchPlansForProduct(ETFB_PRODUCT_ID),
        fetchPlansForProduct(TEAM_SEAT_PRODUCT_ID),
        fetchMembershipsForProduct(ETFB_PRODUCT_ID, unfilteredTotal),
        fetchMembershipsForProduct(TEAM_SEAT_PRODUCT_ID, unfilteredTotal),
      ]);

    const plansById = new Map<string, WhopPlan>(
      [...etfbPlans, ...apexPlans].map((p) => [p.id, p]),
    );
    const { payingOwnerIds, unresolvedPlans } = derivePayingOwnerIds(
      etfbMemberships,
      plansById,
    );

    // NO_DATA is a distinct state from OK-with-nothing-to-do. If our link table
    // is empty (migration not applied, seed missing, RLS blocking the read) then
    // every seat is unattributable and the page would otherwise render a
    // confident "Nobody to remove" — a false all-clear on exactly the leak this
    // tool exists to close.
    if (links.length === 0) {
      return noStore(
        NextResponse.json({
          state: "no_data" as const,
          reason:
            "No team links are recorded. Either migration v87 has not been " +
            "applied, its seed did not land, or this account cannot read " +
            "etfb_team_links. Until that is fixed, nothing on this page can " +
            "be trusted — it is NOT a sign that there is nobody to remove.",
        }),
      );
    }
    const owners = deriveOwners(
      etfbMemberships,
      plansById,
      links,
      apexMemberships,
    );
    const reviewSeatsRaw = deriveReviewSeats(
      apexMemberships,
      links,
      payingOwnerIds,
      decisions,
      new Date().toISOString(),
    );
    const unrecorded = deriveUnrecordedLinks(apexPlans, links);

    // The label as it stands in Whop RIGHT NOW, not what we recorded at import.
    // This is the evidence the attribution was derived from, so showing it lets
    // a human check our answer instead of taking it on trust.
    const labelByPlan = new Map(
      apexPlans.map((p) => [p.id, p.internal_notes ?? null]),
    );
    const reviewSeats = reviewSeatsRaw.map((r) => ({
      ...r,
      linkLabel: labelByPlan.get(r.linkPlanId) ?? null,
    }));

    const linksToCloseRaw = deriveLinksToClose(
      links,
      payingOwnerIds,
      apexPlans,
      apexMemberships,
    );
    const linksToClose = linksToCloseRaw.map((l) => ({
      ...l,
      linkLabel: labelByPlan.get(l.planId) ?? null,
    }));

    // Seats a human has exempted. Returned so the decision is VISIBLE and
    // reversible — an invisible permanent exemption on a tool whose whole job
    // is finding people who should not have free access is its own quiet leak.
    const keptIds = new Set(
      decisions.filter((d) => d.decision === "keep").map((d) => d.membership_id),
    );
    // v87.3 — the owner-first view. One row per brand owner carrying their
    // state, their link and their people, replacing four separate flat lists.
    const ownerRows = deriveOwnerRows({
      etfbMemberships,
      apexMemberships,
      apexPlans,
      plansById,
      links,
      payingOwnerIds,
      decisions,
      nowIso: new Date().toISOString(),
    });

    // SELF-HEAL the owner member id (v88). Links minted by the app resolve it
    // at mint time, but a failed lookup there — or a link created by hand in
    // Whop — leaves it null with nothing to fix it. Only v1 exposes member ids
    // and every v1 list filter is silently ignored, so a full walk is 82+ pages
    // and cannot happen on a page load. A single-membership lookup is one
    // request, so heal a bounded few per load and they fill in over a session.
    // Same shape as the first_paid_at recovery in the Whop sync.
    const HEAL_CAP = 8;
    const needsMemberId = links
      .filter((l) => l.owner_whop_user_id && !l.owner_member_id)
      .slice(0, HEAL_CAP);
    if (needsMemberId.length > 0) {
      await Promise.all(
        needsMemberId.map(async (l) => {
          const om = etfbMemberships.find(
            (m) => m.user === l.owner_whop_user_id && m.valid,
          ) ?? etfbMemberships.find((m) => m.user === l.owner_whop_user_id);
          if (!om) return;
          const memberId = await fetchMemberIdForMembership(om.id);
          if (!memberId) return;
          l.owner_member_id = memberId; // reflected in this response too
          await auth.supabase
            .from("etfb_team_links")
            .update({ owner_member_id: memberId })
            .eq("plan_id", l.plan_id)
            .is("owner_member_id", null); // never overwrite a set value
        }),
      );
    }

    // v87.6 — link-first. One row per team link, which is the object Lovro
    // actually works from (his Whop checkout-links screen). ownerRows is kept
    // because the "new" filter needs owners who have NO link at all.
    const linkRows = deriveLinkRows({
      etfbMemberships,
      apexMemberships,
      apexPlans,
      plansById,
      links,
      payingOwnerIds,
      decisions,
      nowIso: new Date().toISOString(),
    });

    const keptSeats = apexMemberships
      .filter((m) => m.valid && keptIds.has(m.id))
      .map((m) => ({
        membershipId: m.id,
        email: m.email,
        linkPlanId: m.plan,
        reason:
          decisions.find((d) => d.membership_id === m.id)?.reason ?? null,
      }));

    return noStore(
      NextResponse.json({
        state: "ok" as const,
        generatedAt: new Date().toISOString(),
        owners,
        reviewSeats,
        needsOwner: links
          .filter((l) => l.status === "needs_owner")
          .map((l) => ({ planId: l.plan_id, note: l.note })),
        ownerRows,
        linkRows,
        linksToClose,
        keptSeats,
        needsConfirm: links.filter(
          (l) => l.attribution_confidence === "confirm" && l.status === "active",
        ).length,
        unrecordedLinks: unrecorded.map((p) => ({
          planId: p.id,
          internalNotes: p.internal_notes,
        })),
        // Surfaced, never swallowed. A plan we could not resolve means an
        // owner may have been wrongly classified as not-paying.
        unresolvedPlans,
        counts: {
          payingOwners: payingOwnerIds.size,
          ownersWithoutLink: owners.filter((o) => !o.link).length,
          seatsToReview: reviewSeats.length,
          seatsOnUnrecordedLinks: reviewSeats.filter(
            (s) => s.heldBy === "unknown_link",
          ).length,
          linksToClose: linksToClose.length,
          keptSeats: keptSeats.length,
          canceledOwners: ownerRows.filter((o) => o.state === "canceled").length,
          cancelingOwners: ownerRows.filter((o) => o.state === "canceling").length,
          activeOwners: ownerRows.filter((o) => o.state === "active").length,
          needsRemoval: linkRows.filter((l) => l.state === "needs_removal").length,
          peopleToRemove: linkRows
            .filter((l) => l.state === "needs_removal")
            .reduce((n, l) => n + l.seats.length, 0),
        },
      }),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[etfb] snapshot failed:", message);
    // Someone has to find out. console.error is only seen by whoever is
    // already looking at Vercel logs, which is nobody at the moment it breaks.
    void postTeamAlert(
      [
        {
          title: "Brand Owners page failed to load",
          description:
            `${message}\n\nAstrid cannot work the removal queue until this ` +
            `is fixed. Check the Whop API key and its scopes first.`,
          color: 0xdc2626,
        },
      ],
      "ETfB Brand Owners: snapshot read failed",
    );
    // Explicit error state. Never an empty list — see the file header.
    return noStore(
      NextResponse.json({ state: "error" as const, message }, { status: 502 }),
    );
  }
}
