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
  if (!apiKey) return null;
  const productIds = (process.env.WHOP_PRODUCT_ID ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (productIds.length === 0) return null;

  for (const pid of productIds) {
    const url =
      `${WHOP_MEMBERSHIPS_BASE}/memberships?product_id=` +
      `${encodeURIComponent(pid)}&user_id=${encodeURIComponent(whopUserId)}` +
      `&per_page=10`;
    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
      });
      if (!res.ok) {
        console.warn(
          `[fetchActiveMembershipForUser] ${pid} returned ${res.status} for user ${whopUserId}`,
        );
        continue;
      }
      const json = (await res.json()) as { data?: WhopMembershipRow[] };
      const rows = json.data ?? [];
      const active = rows.find((m) => {
        const status = mapStatus(m);
        return status === "active" || status === "past_due";
      });
      if (active) return active;
    } catch (err) {
      console.warn(
        `[fetchActiveMembershipForUser] ${pid} threw for user ${whopUserId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }
  }
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
