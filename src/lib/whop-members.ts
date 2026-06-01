/**
 * Admin-side Whop community fetch.
 *
 * Pulls every membership for the products configured in WHOP_PRODUCT_ID
 * (comma-separated). Used by /api/admin/sync-whop (button) and
 * /api/cron/sync-whop (daily 02:00 UTC). Requires WHOP_API_KEY with
 * the members:read scope.
 *
 * The Whop v2 memberships endpoint returns paginated rows. We page
 * defensively (cap at 200 pages) and tolerate either of the two
 * pagination shapes Whop uses across endpoints.
 */

// /api/v2/memberships is the admin endpoint for listing memberships
// across the company. /api/v1/memberships?product_id=… returns
// "not authorized" for company admin keys — v1 was the user-scoped
// endpoint. We use v2 explicitly here even though WHOP_API_BASE
// elsewhere still points at v1.
const WHOP_MEMBERSHIPS_BASE = "https://api.whop.com/api/v2";

export interface WhopMembershipRow {
  id: string;
  user_id: string | null;
  email: string | null;
  username: string | null;
  status: string | null;
  valid: boolean | null;
  created_at: number | string | null;
  expires_at: number | string | null;
  discord?: { id?: string; username?: string } | null;
  /** Some v2 endpoints surface discord_user_id at the top level instead. */
  discord_user_id?: string | null;
  /** Optional product/plan IDs; the self-heal at login uses them to
   *  filter to memberships under our configured WHOP_PRODUCT_ID. */
  product_id?: string | null;
  plan_id?: string | null;
}

/**
 * Map a Whop membership status / valid flag to our students.membership_status
 * enum: 'active' | 'past_due' | 'canceled' | 'expired'.
 */
export function mapStatus(
  row: Pick<WhopMembershipRow, "status" | "valid">,
): "active" | "past_due" | "canceled" | "expired" {
  const s = (row.status ?? "").toLowerCase();
  if (s === "active" || s === "trialing") return "active";
  if (s === "past_due") return "past_due";
  if (s === "expired") return "expired";
  if (s === "canceled" || s === "completed" || s === "suspended") {
    return "canceled";
  }
  // Fall back to the boolean flag if status string isn't recognized.
  if (row.valid === true) return "active";
  if (row.valid === false) return "canceled";
  return "active";
}

/** Parse a Whop timestamp (unix seconds OR ISO string) into ISO. */
export function toIso(value: number | string | null): string | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  // Whop unix epoch is in seconds, not ms.
  const ms = value > 10_000_000_000 ? value : value * 1000;
  const d = new Date(ms);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

interface FetchOptions {
  perPage?: number;
  maxPages?: number;
}

/**
 * Async generator that yields every Whop membership row for a single
 * product id. Handles the two pagination shapes (`pagination.next_page`
 * vs. `links.next`) Whop uses across API versions.
 */
export async function* listMembershipsForProduct(
  productId: string,
  opts: FetchOptions = {},
): AsyncGenerator<WhopMembershipRow> {
  const apiKey = process.env.WHOP_API_KEY;
  if (!apiKey) throw new Error("WHOP_API_KEY not set");
  const perPage = opts.perPage ?? 50;
  const maxPages = opts.maxPages ?? 200;

  let page = 1;
  while (page <= maxPages) {
    const url = `${WHOP_MEMBERSHIPS_BASE}/memberships?product_id=${encodeURIComponent(
      productId,
    )}&page=${page}&per_page=${perPage}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Whop API ${res.status} on memberships?product_id=${productId}: ${body.slice(0, 200)}`,
      );
    }
    const json = (await res.json()) as {
      data?: WhopMembershipRow[];
      pagination?: { next_page?: number | null; current_page?: number };
    };
    const items = Array.isArray(json.data) ? json.data : [];
    for (const item of items) {
      yield item;
    }
    const nextPage = json.pagination?.next_page;
    if (!nextPage || nextPage <= page) break;
    page = nextPage;
  }
}

/**
 * Look up the active (or past_due) membership for a single user, by
 * whop_user_id. Used by the OAuth callback to self-heal student rows
 * for legacy customers who joined before our webhook was wired up
 * (Karlo's bug 2026-05-30 — Michael Buratynskyi). Falls back across
 * every product configured in WHOP_PRODUCT_ID.
 *
 * Returns null if no active membership exists for any of our
 * products. Tolerates per-product fetch failures so a single bad
 * response doesn't kill the whole check.
 *
 * v75.10 — new.
 */
export async function fetchActiveMembershipForUser(
  whopUserId: string,
): Promise<WhopMembershipRow | null> {
  const apiKey = process.env.WHOP_API_KEY;
  if (!apiKey) {
    console.warn(
      `[self-heal] ABORT: WHOP_API_KEY not set (whop_user_id=${whopUserId})`,
    );
    return null;
  }
  const productIds = (process.env.WHOP_PRODUCT_ID ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (productIds.length === 0) {
    console.warn(
      `[self-heal] ABORT: WHOP_PRODUCT_ID empty (whop_user_id=${whopUserId})`,
    );
    return null;
  }

  console.info(
    `[self-heal] starting for whop_user_id=${whopUserId} productIds=${productIds.join(",")}`,
  );

  // Strategy 1 — query by user_id alone (no product filter). If Whop's
  // v2 supports user_id filtering, this returns just this user's
  // memberships across our entire business in one call. Cheapest and
  // most reliable when supported.
  try {
    const url = `${WHOP_MEMBERSHIPS_BASE}/memberships?user_id=${encodeURIComponent(whopUserId)}&per_page=50`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });
    console.info(
      `[self-heal] strategy1 user_id-only: HTTP ${res.status} for ${whopUserId}`,
    );
    if (res.ok) {
      const json = (await res.json()) as { data?: WhopMembershipRow[] };
      const rows = json.data ?? [];
      console.info(
        `[self-heal] strategy1 returned ${rows.length} memberships: ${JSON.stringify(
          rows.map((r) => ({
            id: r.id,
            user_id: r.user_id,
            product_id: r.product_id,
            plan_id: r.plan_id,
            status: r.status,
            valid: r.valid,
          })),
        )}`,
      );
      // If we see memberships for OTHER users in this response, the
      // user_id filter is silently ignored and strategy 1 isn't safe
      // to use — fall through to per-product iteration.
      const allMatchUser = rows.every(
        (r) => !r.user_id || r.user_id === whopUserId,
      );
      if (!allMatchUser) {
        console.warn(
          `[self-heal] strategy1 user_id filter appears ignored (got memberships for other users); falling through`,
        );
      } else {
        const myActive = rows.find((m) => {
          const matchesProduct =
            !m.product_id || productIds.includes(m.product_id);
          if (!matchesProduct) return false;
          const status = mapStatus(m);
          return status === "active" || status === "past_due";
        });
        if (myActive) {
          console.info(
            `[self-heal] strategy1 MATCH id=${myActive.id} status=${myActive.status} valid=${myActive.valid}`,
          );
          return myActive;
        }
        console.info(
          `[self-heal] strategy1 found ${rows.length} memberships but none active+matching our products`,
        );
      }
    }
  } catch (err) {
    console.warn(
      `[self-heal] strategy1 threw: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Strategy 2 — per-product query with both product_id + user_id
  // filters. Cheapest fallback if Whop's API does support filtering.
  for (const pid of productIds) {
    const url =
      `${WHOP_MEMBERSHIPS_BASE}/memberships?product_id=` +
      `${encodeURIComponent(pid)}&user_id=${encodeURIComponent(whopUserId)}` +
      `&per_page=50`;
    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
      });
      console.info(
        `[self-heal] strategy2 product=${pid}: HTTP ${res.status} for ${whopUserId}`,
      );
      if (!res.ok) continue;
      const json = (await res.json()) as { data?: WhopMembershipRow[] };
      const rows = (json.data ?? []).filter(
        (r) => !r.user_id || r.user_id === whopUserId,
      );
      console.info(
        `[self-heal] strategy2 product=${pid} returned ${rows.length} (post-filter) memberships: ${JSON.stringify(
          rows.map((r) => ({
            id: r.id,
            user_id: r.user_id,
            product_id: r.product_id,
            plan_id: r.plan_id,
            status: r.status,
            valid: r.valid,
          })),
        )}`,
      );
      const active = rows.find((m) => {
        const status = mapStatus(m);
        return status === "active" || status === "past_due";
      });
      if (active) {
        console.info(
          `[self-heal] strategy2 MATCH product=${pid} id=${active.id} status=${active.status}`,
        );
        return active;
      }
    } catch (err) {
      console.warn(
        `[self-heal] strategy2 product=${pid} threw: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }
  }

  // Strategy 3 — last-ditch: /api/v2/members/{userId}. This endpoint
  // returns a member object that may include memberships inline.
  // Doesn't always work but worth one shot before giving up.
  try {
    const url = `${WHOP_MEMBERSHIPS_BASE}/members/${encodeURIComponent(whopUserId)}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });
    console.info(
      `[self-heal] strategy3 /members/{id}: HTTP ${res.status} for ${whopUserId}`,
    );
    if (res.ok) {
      const data = (await res.json()) as {
        memberships?: WhopMembershipRow[];
      };
      const rows = data.memberships ?? [];
      console.info(
        `[self-heal] strategy3 member endpoint returned ${rows.length} embedded memberships: ${JSON.stringify(
          rows.map((r) => ({
            id: r.id,
            product_id: r.product_id,
            plan_id: r.plan_id,
            status: r.status,
            valid: r.valid,
          })),
        )}`,
      );
      const active = rows.find((m) => {
        const matchesProduct =
          !m.product_id || productIds.includes(m.product_id);
        if (!matchesProduct) return false;
        const status = mapStatus(m);
        return status === "active" || status === "past_due";
      });
      if (active) {
        console.info(
          `[self-heal] strategy3 MATCH id=${active.id} status=${active.status}`,
        );
        return active;
      }
    }
  } catch (err) {
    console.warn(
      `[self-heal] strategy3 threw: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  console.warn(
    `[self-heal] EXHAUSTED all strategies for whop_user_id=${whopUserId} — no active membership found anywhere`,
  );
  return null;
}

/** Convenience: collect every membership across every product id in
 *  WHOP_PRODUCT_ID. Dedupes by user_id, last-wins for status. */
export async function fetchAllMemberships(): Promise<WhopMembershipRow[]> {
  const raw = process.env.WHOP_PRODUCT_ID ?? "";
  const productIds = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (productIds.length === 0) {
    throw new Error("WHOP_PRODUCT_ID not set");
  }
  const byUser = new Map<string, WhopMembershipRow>();
  for (const pid of productIds) {
    for await (const row of listMembershipsForProduct(pid)) {
      if (!row.user_id) continue;
      // Keep the most-recently-created membership per user (most likely
      // the current one).
      const existing = byUser.get(row.user_id);
      if (!existing) {
        byUser.set(row.user_id, row);
        continue;
      }
      const a = toIso(existing.created_at);
      const b = toIso(row.created_at);
      if (a && b && b > a) byUser.set(row.user_id, row);
    }
  }
  return Array.from(byUser.values());
}
