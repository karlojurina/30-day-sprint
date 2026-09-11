/**
 * ETfB Brand Owners — live Whop reads + team-link minting.
 *
 * Nothing here is cached in our database. Whop owns owners, plans, seats and
 * money; the only fact we store is `etfb_team_links.owner_whop_user_id`,
 * because that relationship exists nowhere else. Everything on the Brand Owners
 * tab is derived at request time from three live reads.
 *
 * DELIBERATELY SELF-CONTAINED. This module does not import from, and must not
 * be imported by, whop-members.ts / whop-sync-runner.ts. Those own the student
 * sync and carry a known pagination defect (`per_page`, truncating at ~5,000 of
 * 8,188 memberships). Sharing code with them would couple this surface to that
 * bug. The single exception is `whopFetchWithRetry`, a pure 429-backoff helper
 * with no pagination logic in it.
 *
 * THREE VERIFIED WHOP TRAPS THIS FILE DEFENDS AGAINST — each fails SILENTLY
 * with HTTP 200, which is why every one has an explicit assertion:
 *
 *   1. `per_page=` is silently ignored and yields 10 rows/page. The correct
 *      parameter is `per=`, capped at 50. Asking for 100 quietly gives 50.
 *   2. An invalid, stale, typo'd or whitespace-suffixed `product_id` /
 *      `plan_id` filter is IGNORED — Whop returns the entire account with a
 *      perfectly plausible pagination block. A stale product id would render a
 *      believable and catastrophically wrong kick list.
 *   3. Pagination can silently repeat page 1, so a partial count looks whole.
 *
 * On any of those, this module THROWS. A brand-owner page that shows nothing is
 * recoverable; one that shows a confidently wrong list gets a paying customer's
 * team cut off.
 */

import { whopFetchWithRetry } from "@/lib/whop-members";

// ─────────────────────────── constants ───────────────────────────

/** "ecomtalent for brands" — where the $997/mo owner subscriptions live. */
export const ETFB_PRODUCT_ID = "prod_bGNf1u02RruKC";

/**
 * "ecomtalent Apex" — where the free team-seat links live.
 *
 * This product holds TWO unrelated things: the per-owner team links, and the
 * Evolve partner link below. Never treat the whole product as team seats.
 */
export const TEAM_SEAT_PRODUCT_ID = "prod_vCHZUO8dU4ts2";

/**
 * The Evolve partnership link. 383 seats, unlimited stock, still live.
 *
 * NOT a leak and NOT a team link: Evolve's yearly members get EcomTalent free
 * as part of that deal. It is excluded from every seat calculation here and
 * seeded as status='out_of_scope' so nobody rediscovers it and panics.
 */
export const EVOLVE_PARTNER_PLAN_ID = "plan_t4VXohAMYT669";

/** Seats per minted link. Matches the hand-minted convention (110/117 links). */
export const TEAM_LINK_SEATS = 10;

/** Whop caps `per` at 50 regardless of what you ask for. */
const PAGE_SIZE = 50;

/** Hard stop so a pagination bug can never become an unbounded loop. */
const MAX_PAGES = 60;

const API = "https://api.whop.com";

// ─────────────────────────── types ───────────────────────────

export interface WhopPlan {
  id: string;
  product: string;
  plan_type: string;
  release_method: string;
  visibility: string;
  internal_notes: string | null;
  initial_price: string | number | null;
  renewal_price: string | number | null;
  stock: number | null;
  unlimited_stock: boolean | null;
  created_at: number | null;
  direct_link?: string | null;
}

export interface WhopMembership {
  id: string;
  product: string;
  plan: string;
  user: string;
  email: string | null;
  status: string;
  valid: boolean;
  cancel_at_period_end: boolean | null;
  renewal_period_end: number | null;
  created_at: number | null;
  discord: { id?: string; username?: string } | null;
}

function authHeaders(): HeadersInit {
  const key = process.env.WHOP_API_KEY;
  if (!key) throw new Error("[etfb] WHOP_API_KEY is not set");
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

// ─────────────────────────── paginated reads ───────────────────────────

interface PageEnvelope<T> {
  data: T[];
  pagination?: { total_count?: number; total_page?: number };
}

/**
 * Fetch every page of a Whop v2 list endpoint.
 *
 * @param filterField  If the request carries a filter, the field each returned
 *                     row must equal. This is the PRIMARY inertness check and
 *                     is self-sufficient: when Whop ignores a filter it returns
 *                     rows from other products, which this catches directly.
 * @param filterValue  The expected value of that field.
 * @param unfilteredTotal  Optional second check — the account-wide membership
 *                     count, read live rather than hardcoded so it keeps
 *                     working as the account grows. If a filtered response
 *                     reports exactly this many rows, the filter did nothing.
 */
async function fetchAllPages<T extends Record<string, unknown>>(
  path: string,
  params: Record<string, string>,
  opts: {
    filterField?: keyof T & string;
    filterValue?: string;
    unfilteredTotal?: number;
  } = {},
): Promise<T[]> {
  const rows: T[] = [];
  const seenFirstIds = new Set<string>();
  // Whop's own count of what this query matches. Reconciled against what we
  // actually collected before returning — see the completeness check below.
  let expectedTotal: number | undefined;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const qs = new URLSearchParams({
      ...params,
      per: String(PAGE_SIZE),
      page: String(page),
    });
    // maxRetries=2, NOT the default 5. The shared helper sleeps up to 30s per
    // retry and honours an uncapped Retry-After; against maxDuration=30 the
    // backoff alone can outlive the function. Two retries fails fast and
    // visibly instead of being killed mid-flight with no error to show.
    const res = await whopFetchWithRetry(`${API}${path}?${qs}`, authHeaders(), 2);
    if (!res.ok) {
      throw new Error(
        `[etfb] ${path} page ${page} failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`,
      );
    }

    // Whop's envelope is intermittently non-JSON HTML on 5xx-ish conditions,
    // so parse defensively rather than letting a raw SyntaxError escape.
    let body: PageEnvelope<T>;
    const raw = await res.text();
    try {
      body = JSON.parse(raw) as PageEnvelope<T>;
    } catch {
      throw new Error(
        `[etfb] ${path} page ${page} returned non-JSON: ${raw.slice(0, 160)}`,
      );
    }

    const total = body.pagination?.total_count;

    // TRAP 2 — filter silently ignored (whole-account response).
    if (
      page === 1 &&
      opts.unfilteredTotal !== undefined &&
      total === opts.unfilteredTotal
    ) {
      throw new Error(
        `[etfb] FILTER IGNORED on ${path}: total_count ${total} equals the ` +
          `unfiltered account total. Whop silently drops an invalid filter and ` +
          `returns everything. Refusing to build a list from this.`,
      );
    }

    const data = body.data ?? [];
    if (data.length === 0) break;

    // TRAP 3 — pagination not advancing.
    const firstId = String(data[0]?.id ?? "");
    if (seenFirstIds.has(firstId)) {
      throw new Error(
        `[etfb] pagination stalled on ${path} at page ${page}: first id ` +
          `${firstId} already seen. Refusing to return a partial list as whole.`,
      );
    }
    seenFirstIds.add(firstId);

    // TRAP 2 (row-level) — the check that works with no baseline at all.
    if (opts.filterField && opts.filterValue !== undefined) {
      const bad = data.find(
        (r) => String(r[opts.filterField as keyof T]) !== opts.filterValue,
      );
      if (bad) {
        throw new Error(
          `[etfb] FILTER IGNORED on ${path}: row ${String(bad.id)} has ` +
            `${opts.filterField}=${String(bad[opts.filterField as keyof T])}, ` +
            `expected ${opts.filterValue}.`,
        );
      }
    }

    rows.push(...data);
    if (page === 1 && typeof total === "number") expectedTotal = total;

    const totalPage = body.pagination?.total_page;
    if (totalPage && page >= totalPage) break;
    if (data.length < PAGE_SIZE) break;

    if (page === MAX_PAGES) {
      throw new Error(
        `[etfb] ${path} exceeded MAX_PAGES (${MAX_PAGES}). Refusing to return ` +
          `a truncated list — this is the failure mode that silently capped the ` +
          `student sync at 5,000 of 8,188 rows.`,
      );
    }
  }

  // Duplicate ids mean the pages overlapped; counts derived from this would lie.
  const unique = new Set(rows.map((r) => String(r.id)));
  if (unique.size !== rows.length) {
    throw new Error(
      `[etfb] ${path} returned ${rows.length - unique.size} duplicate ids.`,
    );
  }

  // COMPLETENESS. Whop told us how many rows match; we must have that many.
  // Without this, any short page silently ends the walk and we return a
  // partial list as if it were whole. That is not a cosmetic undercount here:
  // a missing ETfB membership makes a PAYING owner look churned, which puts
  // their staff on the removal list. Fail loudly instead.
  if (typeof expectedTotal === "number" && rows.length !== expectedTotal) {
    throw new Error(
      `[etfb] INCOMPLETE READ of ${path}: collected ${rows.length} rows but ` +
        `Whop reports ${expectedTotal} match. Refusing to return a partial ` +
        `list — a short read here makes paying owners look churned.`,
    );
  }
  return rows;
}

/**
 * The account-wide membership count, read live.
 *
 * Deliberately not a constant. Hardcoding today's 8,188 would quietly disarm
 * the filter-inertness tripwire the moment the account grows.
 */
export async function fetchUnfilteredMembershipTotal(): Promise<number> {
  const res = await whopFetchWithRetry(
    `${API}/api/v2/memberships?per=1&page=1`,
    authHeaders(),
  );
  if (!res.ok) throw new Error(`[etfb] baseline read failed: ${res.status}`);
  const body = (await res.json()) as PageEnvelope<WhopMembership>;
  const total = body.pagination?.total_count;
  if (typeof total !== "number") {
    throw new Error("[etfb] baseline read returned no total_count");
  }
  return total;
}

export async function fetchPlansForProduct(
  productId: string,
): Promise<WhopPlan[]> {
  return fetchAllPages<WhopPlan & Record<string, unknown>>(
    "/api/v2/plans",
    {},
    {},
  ).then((all) => all.filter((p) => p.product === productId));
}

export async function fetchMembershipsForProduct(
  productId: string,
  unfilteredTotal: number,
): Promise<WhopMembership[]> {
  return fetchAllPages<WhopMembership & Record<string, unknown>>(
    "/api/v2/memberships",
    { product_id: productId },
    { filterField: "product", filterValue: productId, unfilteredTotal },
  );
}

// ─────────────────────────── internal_notes ───────────────────────────

/** Marks a note as written by this app, so imports stay distinguishable. */
export const NOTE_PREFIX = "ETFB";

/**
 * The label written onto a minted plan, carrying exactly what Lovro asked for:
 * which user, which name, which subscription.
 *
 *   ETFB | Acme Ltd | acmeowner | user_abc123 | plan_xyz789
 *
 * This is a MIRROR, never the source of truth. Attribution lives in
 * etfb_team_links.owner_whop_user_id as a real column. The note exists so a
 * human looking at Whop's own UI can see who a link belongs to — which is the
 * job the old free-text convention was doing, badly.
 */
export function buildInternalNote(input: {
  ownerName: string | null;
  ownerUsername: string | null;
  ownerWhopUserId: string;
  ownerPlanId: string | null;
}): string {
  const parts = [
    NOTE_PREFIX,
    (input.ownerName || "").replace(/[|\n\r]/g, " ").trim() || "?",
    (input.ownerUsername || "").replace(/[|\n\r]/g, " ").trim() || "?",
    input.ownerWhopUserId,
    input.ownerPlanId || "?",
  ];
  return parts.join(" | ");
}

/** Inverse of buildInternalNote. Returns null for any note we did not write. */
export function parseInternalNote(
  note: string | null,
): { ownerWhopUserId: string; ownerPlanId: string | null } | null {
  if (!note?.startsWith(`${NOTE_PREFIX} |`)) return null;
  const parts = note.split("|").map((s) => s.trim());
  if (parts.length < 5) return null;
  const ownerWhopUserId = parts[3];
  if (!ownerWhopUserId.startsWith("user_")) return null;
  return {
    ownerWhopUserId,
    ownerPlanId: parts[4]?.startsWith("plan_") ? parts[4] : null,
  };
}

// ─────────────────────────── minting ───────────────────────────

export interface MintedLink {
  planId: string;
  checkoutUrl: string;
  internalNote: string;
}

/**
 * Create one free 10-seat team link in Whop.
 *
 * WRITES TO PRODUCTION WHOP. The caller is responsible for the idempotency
 * check — see POST /api/admin/etfb/links, which returns the owner's existing
 * active link rather than calling this a second time. The partial unique index
 * etfb_team_links_one_active_per_owner is the backstop if that check is ever
 * bypassed.
 *
 * Field set is copied verbatim from the 118 links minted by hand, which are
 * uniform across all nine distinguishing fields.
 */
export async function mintTeamLink(input: {
  ownerName: string | null;
  ownerUsername: string | null;
  ownerWhopUserId: string;
  ownerPlanId: string | null;
}): Promise<MintedLink> {
  const internalNote = buildInternalNote(input);

  // Deliberately a bare fetch, NOT whopFetchWithRetry. That helper retries on
  // 429, and a retried CREATE can mint a second plan if the first actually
  // succeeded behind the rate-limit response. A failed mint is safe to retry
  // by hand; a duplicate link splits an owner's team across two links and is
  // exactly the failure the unique index exists to prevent.
  const created = await fetch(`${API}/api/v2/plans`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      product_id: TEAM_SEAT_PRODUCT_ID,
      plan_type: "one_time",
      release_method: "buy_now",
      visibility: "hidden",
      initial_price: 0,
      renewal_price: 0,
      base_currency: "usd",
      stock: TEAM_LINK_SEATS,
      unlimited_stock: false,
      internal_notes: internalNote,
    }),
  });

  const raw = await created.text();
  if (!created.ok) {
    throw new Error(
      `[etfb] mint failed: HTTP ${created.status} ${raw.slice(0, 300)}`,
    );
  }
  let plan: WhopPlan;
  try {
    plan = JSON.parse(raw) as WhopPlan;
  } catch {
    throw new Error(`[etfb] mint returned non-JSON: ${raw.slice(0, 160)}`);
  }
  if (!plan.id?.startsWith("plan_")) {
    throw new Error(`[etfb] mint returned no plan id: ${raw.slice(0, 200)}`);
  }
  if (plan.product !== TEAM_SEAT_PRODUCT_ID) {
    throw new Error(
      `[etfb] mint created a plan on the WRONG product (${plan.product}).`,
    );
  }
  return {
    planId: plan.id,
    checkoutUrl: `https://whop.com/checkout/${plan.id}`,
    internalNote,
  };
}

/** Archive a link in Whop (POST to the id — PATCH/PUT are not routed). */
export async function archiveTeamLink(planId: string): Promise<void> {
  const res = await fetch(`${API}/api/v2/plans/${planId}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ visibility: "archived" }),
  });
  if (!res.ok) {
    throw new Error(
      `[etfb] archive ${planId} failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`,
    );
  }
}

// ─────────────────────────── derivation ───────────────────────────
//
// Pure functions over (live Whop data + our link rows). No database access, no
// network — so the rules that decide whether a person loses access can be read
// in one place and reasoned about without a running system.

export interface TeamLinkRow {
  plan_id: string;
  owner_whop_user_id: string | null;
  owner_name: string | null;
  owner_email: string | null;
  status: string;
  attribution_method: string;
  attribution_confidence: string;
  note: string | null;
}

export interface SeatDecisionRow {
  membership_id: string;
  decision: string;
  reason: string | null;
  snooze_until: string | null;
}

export interface OwnerView {
  whopUserId: string;
  name: string | null;
  email: string | null;
  discordUsername: string | null;
  planId: string;
  status: string;
  isPaying: boolean;
  cancelScheduled: boolean;
  cycleEndIso: string | null;
  link: {
    planId: string;
    checkoutUrl: string;
    seatsUsed: number;
    attributionMethod: string;
    attributionConfidence: string;
    needsConfirm: boolean;
    linkStatus: string;
  } | null;
}

export interface ReviewSeat {
  membershipId: string;
  email: string | null;
  discordUsername: string | null;
  joinedIso: string | null;
  linkPlanId: string;
  ownerWhopUserId: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  ownerCycleEndIso: string | null;
  attributionConfidence: string;
  attributionMethod: string;
  heldBy: "unknown_person" | "self_paying_owner" | "unknown_link";
}

const iso = (epoch: number | null | undefined) =>
  epoch ? new Date(epoch * 1000).toISOString() : null;

const priceOf = (p: WhopPlan) =>
  Number(p.renewal_price ?? 0) + Number(p.initial_price ?? 0);

/** Whop user ids that currently hold a VALID PAID ETfB membership. */
export function derivePayingOwnerIds(
  etfbMemberships: WhopMembership[],
  plansById: Map<string, WhopPlan>,
): { payingOwnerIds: Set<string>; unresolvedPlans: string[] } {
  const out = new Set<string>();
  const unresolvedPlans = new Set<string>();
  for (const m of etfbMemberships) {
    if (!m.valid) continue;
    const plan = plansById.get(m.plan);
    // "I could not resolve this plan" and "this plan is free" are completely
    // different answers and must not collapse into the same one. Treating an
    // unresolvable plan as free silently demotes a PAYING owner, which puts
    // their staff on the removal list with no marker distinguishing them.
    if (!plan) {
      unresolvedPlans.add(m.plan);
      continue;
    }
    if (priceOf(plan) > 0) out.add(m.user);
  }
  return { payingOwnerIds: out, unresolvedPlans: [...unresolvedPlans] };
}

/**
 * One row per brand owner who currently pays, with their link if they have one.
 *
 * Paid-plan membership is read LIVE — never from a hardcoded allowlist.
 * `PAYING_WHOP_PLAN_IDS` in constants.ts holds 2 of the account's 46 paid
 * plans, and 6 owners sit on one-off "Waitlist <user>" plans that will never
 * appear in any static list.
 */
export function deriveOwners(
  etfbMemberships: WhopMembership[],
  plansById: Map<string, WhopPlan>,
  links: TeamLinkRow[],
  apexMemberships: WhopMembership[],
): OwnerView[] {
  const linkByOwner = new Map<string, TeamLinkRow>();
  for (const l of links) {
    if (!l.owner_whop_user_id) continue;
    // An archived link can still hold live seats, so prefer an active link but
    // never discard an archived one that is an owner's only record.
    const cur = linkByOwner.get(l.owner_whop_user_id);
    if (!cur || (cur.status !== "active" && l.status === "active")) {
      linkByOwner.set(l.owner_whop_user_id, l);
    }
  }
  const seatsByPlan = new Map<string, number>();
  for (const m of apexMemberships) {
    if (!m.valid) continue;
    seatsByPlan.set(m.plan, (seatsByPlan.get(m.plan) ?? 0) + 1);
  }

  const byUser = new Map<string, OwnerView>();
  for (const m of etfbMemberships) {
    const plan = plansById.get(m.plan);
    if (!plan || priceOf(plan) <= 0 || !m.valid) continue;
    const link = linkByOwner.get(m.user) ?? null;
    const existing = byUser.get(m.user);
    const view: OwnerView = {
      whopUserId: m.user,
      name: link?.owner_name ?? null,
      email: m.email ?? link?.owner_email ?? null,
      discordUsername: m.discord?.username ?? null,
      planId: m.plan,
      status: m.status,
      isPaying: true,
      cancelScheduled: Boolean(m.cancel_at_period_end),
      cycleEndIso: iso(m.renewal_period_end),
      link: link
        ? {
            planId: link.plan_id,
            checkoutUrl: `https://whop.com/checkout/${link.plan_id}`,
            seatsUsed: seatsByPlan.get(link.plan_id) ?? 0,
            attributionMethod: link.attribution_method,
            attributionConfidence: link.attribution_confidence,
            needsConfirm: link.attribution_confidence === "confirm",
            linkStatus: link.status,
          }
        : null,
    };
    // A user can hold more than one ETfB membership. Keep the one whose cycle
    // runs longest — that is the one that actually governs their access.
    if (
      !existing ||
      (view.cycleEndIso ?? "") > (existing.cycleEndIso ?? "")
    ) {
      byUser.set(m.user, view);
    }
  }
  return [...byUser.values()].sort((a, b) =>
    (a.cycleEndIso ?? "").localeCompare(b.cycleEndIso ?? ""),
  );
}

/**
 * Seats whose owner no longer pays — the list Astrid works.
 *
 * Four exclusions, each one a real case observed in production:
 *   1. The Evolve partner link. A different deal entirely.
 *   2. A seat holder who is themselves a paying ETfB owner. plan_P9yx1m1HdHfMt
 *      holds 29 seats on a 10-seat plan and one belongs to a currently-paying
 *      owner. Checked PER SEAT, never per link.
 *   3. A seat a human marked `keep`, or `snoozed` and not yet due.
 *   4. Seats on links whose owner still pays.
 *
 * Seats on ARCHIVED links are deliberately INCLUDED — archiving a link does not
 * revoke the people already on it, and excluding them would make them invisible.
 */
export function deriveReviewSeats(
  apexMemberships: WhopMembership[],
  links: TeamLinkRow[],
  payingOwnerIds: Set<string>,
  decisions: SeatDecisionRow[],
  nowIso: string,
): ReviewSeat[] {
  const linkByPlan = new Map(links.map((l) => [l.plan_id, l]));
  const decisionBySeat = new Map(decisions.map((d) => [d.membership_id, d]));
  const out: ReviewSeat[] = [];

  for (const m of apexMemberships) {
    if (!m.valid) continue;
    if (m.plan === EVOLVE_PARTNER_PLAN_ID) continue; // exclusion 1

    const link = linkByPlan.get(m.plan);
    if (link?.status === "out_of_scope") continue; // exclusion 1
    if (link?.owner_whop_user_id && payingOwnerIds.has(link.owner_whop_user_id))
      continue; // exclusion 4

    if (payingOwnerIds.has(m.user)) continue; // exclusion 2

    const d = decisionBySeat.get(m.id); // exclusion 3
    if (d?.decision === "keep") continue;
    if (d?.decision === "snoozed" && (d.snooze_until ?? "") > nowIso) continue;
    if (d?.decision === "revoked") continue;

    // A seat whose link we have no row for is NOT dropped. It is a real person
    // holding real free access; dropping it produced a smaller number and a
    // "Nobody to remove" all-clear while they kept the course. It appears
    // flagged instead, so the uncertainty is visible rather than invisible.
    out.push({
      membershipId: m.id,
      email: m.email,
      discordUsername: m.discord?.username ?? null,
      joinedIso: iso(m.created_at),
      linkPlanId: m.plan,
      ownerWhopUserId: link?.owner_whop_user_id ?? null,
      ownerName: link?.owner_name ?? null,
      ownerEmail: link?.owner_email ?? null,
      ownerCycleEndIso: null,
      attributionConfidence: link?.attribution_confidence ?? "manual",
      attributionMethod: link?.attribution_method ?? "unrecorded_link",
      heldBy: link ? "unknown_person" : "unknown_link",
    });
  }
  return out.sort((a, b) => (a.ownerName ?? "").localeCompare(b.ownerName ?? ""));
}

/**
 * Links that exist in Whop but not in our table.
 *
 * Permanent drift detector, not a one-off import check. If a mint ever crashes
 * between creating the plan in Whop and writing our row, the orphan shows up
 * here instead of becoming an invisible unattributed link — which is the exact
 * condition this whole project exists to eliminate.
 */
export function deriveUnrecordedLinks(
  apexPlans: WhopPlan[],
  links: TeamLinkRow[],
): WhopPlan[] {
  const known = new Set(links.map((l) => l.plan_id));
  return apexPlans.filter(
    (p) => p.id !== EVOLVE_PARTNER_PLAN_ID && !known.has(p.id),
  );
}

/**
 * Links that should be closed: the owner no longer pays, but the link is still
 * live in Whop and can still be redeemed.
 *
 * This is the hole that would otherwise rebuild the leak after go-live. An owner
 * churns, nobody retires their link, and it keeps handing out free course access
 * to anyone who still has the URL. Every new redemption then arrives as another
 * row in "Needs review", which reads as the tool working rather than as the door
 * standing open.
 *
 * `out_of_scope` (Evolve) is never included. Already-archived links are not
 * included — but note that archiving does NOT revoke anyone already on them,
 * which is why their seats still appear in the review list.
 */
export function deriveLinksToClose(
  links: TeamLinkRow[],
  payingOwnerIds: Set<string>,
  apexPlans: WhopPlan[],
  apexMemberships: WhopMembership[],
): {
  planId: string;
  ownerName: string | null;
  ownerEmail: string | null;
  seatsUsed: number;
  attributionConfidence: string;
}[] {
  const planById = new Map(apexPlans.map((p) => [p.id, p]));
  const seats = new Map<string, number>();
  for (const m of apexMemberships) {
    if (m.valid) seats.set(m.plan, (seats.get(m.plan) ?? 0) + 1);
  }
  return links
    .filter((l) => {
      if (l.status !== "active") return false;
      if (!l.owner_whop_user_id) return false;
      if (payingOwnerIds.has(l.owner_whop_user_id)) return false;
      const plan = planById.get(l.plan_id);
      // Already archived in Whop — nothing left to close.
      if (!plan || plan.visibility === "archived") return false;
      return true;
    })
    .map((l) => ({
      planId: l.plan_id,
      ownerName: l.owner_name,
      ownerEmail: l.owner_email,
      seatsUsed: seats.get(l.plan_id) ?? 0,
      attributionConfidence: l.attribution_confidence,
    }))
    .sort((a, b) => b.seatsUsed - a.seatsUsed);
}

// ─────────────────────── owner-first view (v87.3) ───────────────────────
//
// The page was originally seat-first: one flat list of 104 people. That mirrors
// how the data is stored and not how the job is done. Astrid does not think
// "here are 104 individuals", she thinks "this brand left, remove their team".
// So the unit here is the OWNER, and every seat hangs off one.
//
// Three states, because each implies exactly one action and no other:
//   canceled  — act now: close the link, remove their people
//   canceling — nothing yet; a date to watch
//   active    — nothing, unless they have no link, in which case: create one

export type OwnerState = "active" | "canceling" | "canceled";

export interface OwnerSeat {
  membershipId: string;
  email: string | null;
  discordUsername: string | null;
  joinedIso: string | null;
  decision: string | null;
}

export interface OwnerRow {
  whopUserId: string;
  name: string | null;
  email: string | null;
  state: OwnerState;
  cycleEndIso: string | null;
  link: {
    planId: string;
    label: string | null;
    checkoutUrl: string;
    attributionMethod: string;
    attributionConfidence: string;
    linkStatus: string;
    /** false once the link is archived in Whop — nothing left to close. */
    canClose: boolean;
  } | null;
  /** People to remove. Already filtered by every exclusion rule. */
  seats: OwnerSeat[];
  /** People on the link who are deliberately NOT actionable, and why. */
  protectedSeats: { membershipId: string; email: string | null; why: string }[];
}

/**
 * One row per brand owner, carrying their state, their link and their people.
 *
 * Reuses deriveReviewSeats for the actionable set, so every exclusion rule
 * (Evolve, self-paying seat holders, keep/snooze, owner still paying) applies
 * exactly as before — this changes presentation, never who is safe to remove.
 */
export function deriveOwnerRows(input: {
  etfbMemberships: WhopMembership[];
  apexMemberships: WhopMembership[];
  apexPlans: WhopPlan[];
  plansById: Map<string, WhopPlan>;
  links: TeamLinkRow[];
  payingOwnerIds: Set<string>;
  decisions: SeatDecisionRow[];
  nowIso: string;
}): OwnerRow[] {
  const {
    etfbMemberships, apexMemberships, apexPlans, plansById,
    links, payingOwnerIds, decisions, nowIso,
  } = input;

  const labelByPlan = new Map(apexPlans.map((p) => [p.id, p.internal_notes ?? null]));
  const visByPlan = new Map(apexPlans.map((p) => [p.id, p.visibility]));
  const decisionBySeat = new Map(decisions.map((d) => [d.membership_id, d]));

  // Best ETfB membership per user: a live one wins, then the longest cycle.
  const bestMembership = new Map<string, WhopMembership>();
  for (const m of etfbMemberships) {
    const plan = plansById.get(m.plan);
    if (!plan || priceOf(plan) <= 0) continue;
    const cur = bestMembership.get(m.user);
    if (
      !cur ||
      (m.valid && !cur.valid) ||
      (m.valid === cur.valid &&
        (m.renewal_period_end ?? 0) > (cur.renewal_period_end ?? 0))
    ) {
      bestMembership.set(m.user, m);
    }
  }

  const actionable = deriveReviewSeats(
    apexMemberships, links, payingOwnerIds, decisions, nowIso,
  );
  const actionableByPlan = new Map<string, ReviewSeat[]>();
  for (const s of actionable) {
    const arr = actionableByPlan.get(s.linkPlanId) ?? [];
    arr.push(s);
    actionableByPlan.set(s.linkPlanId, arr);
  }

  // Every owner we know of: anyone paying, plus anyone who owns a link.
  const ownerIds = new Set<string>(payingOwnerIds);
  for (const l of links) {
    if (l.owner_whop_user_id && l.status !== "out_of_scope") {
      ownerIds.add(l.owner_whop_user_id);
    }
  }

  const linkByOwner = new Map<string, TeamLinkRow>();
  for (const l of links) {
    if (!l.owner_whop_user_id || l.status === "out_of_scope") continue;
    const cur = linkByOwner.get(l.owner_whop_user_id);
    if (!cur || (cur.status !== "active" && l.status === "active")) {
      linkByOwner.set(l.owner_whop_user_id, l);
    }
  }

  const rows: OwnerRow[] = [];
  for (const uid of ownerIds) {
    const m = bestMembership.get(uid);
    const link = linkByOwner.get(uid) ?? null;

    const state: OwnerState = !payingOwnerIds.has(uid)
      ? "canceled"
      : m?.cancel_at_period_end
        ? "canceling"
        : "active";

    const seats = link ? (actionableByPlan.get(link.plan_id) ?? []) : [];

    // Anyone on the link we deliberately are NOT offering up, with the reason.
    // Shown so a suppressed person is visible rather than simply absent.
    const protectedSeats: OwnerRow["protectedSeats"] = [];
    if (link) {
      const actionableIds = new Set(seats.map((s) => s.membershipId));
      for (const seat of apexMemberships) {
        if (seat.plan !== link.plan_id || !seat.valid) continue;
        if (actionableIds.has(seat.id)) continue;
        const d = decisionBySeat.get(seat.id);
        protectedSeats.push({
          membershipId: seat.id,
          email: seat.email,
          why: payingOwnerIds.has(seat.user)
            ? "pays for EcomTalent for Brands themselves"
            : d?.decision === "keep"
              ? "marked keep"
              : d?.decision === "snoozed"
                ? "snoozed"
                : "owner still paying",
        });
      }
    }

    rows.push({
      whopUserId: uid,
      name: link?.owner_name || null,
      email: m?.email || link?.owner_email || null,
      state,
      cycleEndIso: m?.renewal_period_end
        ? new Date(m.renewal_period_end * 1000).toISOString()
        : null,
      link: link
        ? {
            planId: link.plan_id,
            label: labelByPlan.get(link.plan_id) ?? null,
            checkoutUrl: `https://whop.com/checkout/${link.plan_id}`,
            attributionMethod: link.attribution_method,
            attributionConfidence: link.attribution_confidence,
            linkStatus: link.status,
            canClose:
              link.status === "active" &&
              visByPlan.get(link.plan_id) !== "archived",
          }
        : null,
      seats: seats.map((s) => ({
        membershipId: s.membershipId,
        email: s.email,
        discordUsername: s.discordUsername,
        joinedIso: s.joinedIso,
        decision: null,
      })),
      protectedSeats,
    });
  }

  // Canceled first (the work), then canceling (coming), then active (reference).
  // Within each, most people first — biggest impact at the top.
  const order: Record<OwnerState, number> = { canceled: 0, canceling: 1, active: 2 };
  return rows.sort(
    (a, b) =>
      order[a.state] - order[b.state] ||
      b.seats.length - a.seats.length ||
      (a.name || a.email || "").localeCompare(b.name || b.email || ""),
  );
}
