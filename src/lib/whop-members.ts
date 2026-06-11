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

/**
 * Fetch wrapper with Cloudflare-1015-aware retry. Whop's API sits
 * behind Cloudflare and returns 429 with an HTML/JSON body when
 * sustained request rates exceed (roughly) ~10/sec from one origin.
 * Sync runs paginate through hundreds of pages, so we MUST handle
 * 429 or the whole sync aborts mid-run.
 *
 * Strategy: honor Retry-After if present, else exponential backoff
 * with jitter. Caps total wait at ~60s per attempt. Returns the
 * final Response (which may still be 429 if the last attempt failed).
 */
async function whopFetchWithRetry(
  url: string,
  headers: HeadersInit,
  maxRetries = 5,
): Promise<Response> {
  let lastRes: Response | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, { headers });
    if (res.status !== 429) return res;
    lastRes = res;
    if (attempt === maxRetries) break;
    // Retry-After is in seconds when present; otherwise exponential
    // backoff (1s, 2s, 4s, 8s, 16s) capped at 30s.
    const retryAfterHeader = res.headers.get("retry-after");
    const retryAfterSec = retryAfterHeader
      ? parseInt(retryAfterHeader, 10)
      : NaN;
    let waitMs = !isNaN(retryAfterSec)
      ? retryAfterSec * 1000
      : Math.min(30_000, 1_000 * Math.pow(2, attempt));
    // Small jitter so multiple in-flight requests don't all retry at once.
    waitMs += Math.floor(Math.random() * 250);
    console.warn(
      `[whop-api] 429 rate-limited; waiting ${waitMs}ms before retry ${attempt + 1}/${maxRetries}`,
    );
    await new Promise((r) => setTimeout(r, waitMs));
  }
  return lastRes!;
}

/**
 * Whop v2 /memberships response row. Field names match Whop's actual
 * response shape, NOT the names we'd ideally pick (which would all
 * end in `_id` for clarity). Verified empirically v75.14.3 — the
 * earlier interface used `user_id` / `plan_id` / `product_id` and
 * every read returned undefined, silently breaking sync.
 *
 * IDs are flat strings at the top level, not nested objects:
 *   user:    'user_xxxxx'
 *   plan:    'plan_xxxxx'
 *   product: 'prod_xxxxx'
 *
 * The webhook payload shape is DIFFERENT — those use nested objects
 * (`user.id`, `product.id`) and live in src/types/whop.ts.
 */
export interface WhopMembershipRow {
  id: string;
  user: string | null;
  email: string | null;
  status: string | null;
  valid: boolean | null;
  created_at: number | string | null;
  expires_at: number | string | null;
  /** For canceled / expired memberships this is approximately when
   *  access ended (the end of the last paid billing cycle). For
   *  active memberships it's a future date — only use it as a
   *  cancellation proxy when status is terminal. */
  renewal_period_end?: number | string | null;
  /** v75.46: Whop's "Canceling" state. When true AND status is still
   *  active/past_due, the student clicked cancel but has access
   *  through end of billing cycle. This is the earliest churn signal
   *  the platform exposes — sync runner uses it to stamp
   *  students.cancel_scheduled_at. Previously we were silently
   *  dropping this field from every read because it wasn't declared
   *  on the interface (TypeScript erases unknown JSON fields). The
   *  webhook payload at types/whop.ts:29 has carried it all along. */
  cancel_at_period_end?: boolean | null;
  discord?: { id?: string; username?: string } | null;
  /** Some endpoints surface discord_user_id at the top level instead. */
  discord_user_id?: string | null;
  /** Product + plan IDs for filtering / paying-plan classification. */
  product?: string | null;
  plan?: string | null;
}

/**
 * Map a Whop membership status / valid flag to our students.membership_status
 * enum: 'active' | 'past_due' | 'canceled' | 'expired'.
 *
 * Trust order: row.valid first, then status string. `valid` is Whop's
 * canonical "does this user have access right now" boolean — status is
 * the lifecycle label downstream of it.
 *
 * v75.12 — was status-first, which mapped `completed` → "canceled".
 * That blocked free / lifetime / one-time plans (status=completed,
 * valid=true means "user has permanent entitlement"). Borna +
 * Alessandro (free plan under prod_eE7r6SXa3H0MX) hit this on login.
 */
export function mapStatus(
  row: Pick<WhopMembershipRow, "status" | "valid">,
): "active" | "past_due" | "canceled" | "expired" {
  const s = (row.status ?? "").toLowerCase();

  // valid=true → user has access right now. Default to "active" but
  // surface past_due so we can flag billing trouble downstream.
  if (row.valid === true) {
    return s === "past_due" ? "past_due" : "active";
  }
  // valid=false → user does not have access. Default to "canceled"
  // but preserve "expired" for accurate categorization in the UI.
  if (row.valid === false) {
    return s === "expired" ? "expired" : "canceled";
  }

  // valid missing — fall back to status string. "completed" without a
  // valid flag is treated as active for the lifetime / one-time /
  // free-claim case; a recurring plan that genuinely ended would have
  // valid=false caught above.
  if (s === "active" || s === "trialing" || s === "completed") return "active";
  if (s === "past_due") return "past_due";
  if (s === "expired") return "expired";
  if (s === "canceled" || s === "suspended") return "canceled";
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
  // Whop's actual per_page response was 10 even when we asked for 1
  // — they have a 10-min cap. Push to 50 to halve the request count.
  // (Lowering still further would help rate-limit but takes longer.)
  const perPage = opts.perPage ?? 50;
  const maxPages = opts.maxPages ?? 500;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
  };

  let page = 1;
  while (page <= maxPages) {
    // Throttle: 200ms between pages → max ~5 req/sec from this loop.
    // Whop's Cloudflare layer rate-limits at ~10 req/sec so this
    // stays well under. Adds ~10s to a 56-page sync (acceptable).
    if (page > 1) await new Promise((r) => setTimeout(r, 200));
    const url = `${WHOP_MEMBERSHIPS_BASE}/memberships?product_id=${encodeURIComponent(
      productId,
    )}&page=${page}&per_page=${perPage}`;
    const res = await whopFetchWithRetry(url, headers);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Whop API ${res.status} on memberships?product_id=${productId}: ${body.slice(0, 200)}`,
      );
    }
    const json = (await res.json()) as {
      data?: WhopMembershipRow[];
      pagination?: {
        current_page?: number;
        total_page?: number;
        total_count?: number;
      };
    };
    const items = Array.isArray(json.data) ? json.data : [];
    for (const item of items) {
      yield item;
    }
    // Whop v2 uses {current_page, total_page} pagination, not the
    // {next_page} shape my earlier code assumed. Loop while there are
    // more pages; break when we've consumed the last one.
    const currentPage = json.pagination?.current_page ?? page;
    const totalPage = json.pagination?.total_page ?? currentPage;
    if (currentPage >= totalPage) break;
    page = currentPage + 1;
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
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
  };
  try {
    const url = `${WHOP_MEMBERSHIPS_BASE}/memberships?user_id=${encodeURIComponent(whopUserId)}&per_page=50`;
    const res = await whopFetchWithRetry(url, headers);
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
            user: r.user,
            product: r.product,
            plan: r.plan,
            status: r.status,
            valid: r.valid,
          })),
        )}`,
      );
      // If we see memberships for OTHER users in this response, the
      // user_id filter is silently ignored and strategy 1 isn't safe
      // to use — fall through to per-product iteration.
      const allMatchUser = rows.every(
        (r) => !r.user || r.user === whopUserId,
      );
      if (!allMatchUser) {
        console.warn(
          `[self-heal] strategy1 user_id filter appears ignored (got memberships for other users); falling through`,
        );
      } else {
        const myActive = rows.find((m) => {
          const matchesProduct =
            !m.product || productIds.includes(m.product);
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
      const res = await whopFetchWithRetry(url, headers);
      console.info(
        `[self-heal] strategy2 product=${pid}: HTTP ${res.status} for ${whopUserId}`,
      );
      if (!res.ok) continue;
      const json = (await res.json()) as { data?: WhopMembershipRow[] };
      const rows = (json.data ?? []).filter(
        (r) => !r.user || r.user === whopUserId,
      );
      console.info(
        `[self-heal] strategy2 product=${pid} returned ${rows.length} (post-filter) memberships: ${JSON.stringify(
          rows.map((r) => ({
            id: r.id,
            user: r.user,
            product: r.product,
            plan: r.plan,
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
    const res = await whopFetchWithRetry(url, headers);
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
            product: r.product,
            plan: r.plan,
            status: r.status,
            valid: r.valid,
          })),
        )}`,
      );
      const active = rows.find((m) => {
        const matchesProduct =
          !m.product || productIds.includes(m.product);
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

/**
 * Fetch ALL memberships for a single whop_user_id — across EVERY
 * product, not just those in WHOP_PRODUCT_ID — and return the earliest
 * created_at as ISO 8601 (the user's TRUE "first paid" date, stable
 * across renewals).
 *
 * This is the cross-product lookup the per-product company sync
 * (fetchAllMemberships) structurally can't do: a student whose paying
 * membership sits under a product NOT in WHOP_PRODUCT_ID gets
 * _firstPaidAt=null from the sync, so first_paid_at would stay NULL
 * forever — invisible to every cohort surface and uncovered by the CSM
 * crons. Both the one-time backfill (/api/admin/backfill-first-paid-at)
 * and the sync runner's null-recovery pass call this to recover the
 * real date.
 *
 * Returns { firstPaidIso, foundCount }. firstPaidIso is null only when
 * Whop has no membership record for the user (or all dates were
 * unparseable). Throws if Whop ignores the user_id filter, so we never
 * attribute another user's date to this one.
 *
 * v75.53 — extracted from the backfill route so the sync can reuse it
 * (and so it inherits whopFetchWithRetry's 429 handling).
 */
export async function fetchEarliestMembershipDateForUser(
  whopUserId: string,
): Promise<{ firstPaidIso: string | null; foundCount: number }> {
  const apiKey = process.env.WHOP_API_KEY;
  if (!apiKey) throw new Error("WHOP_API_KEY not set");
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
  };

  let earliest: string | null = null;
  let foundCount = 0;
  let page = 1;
  const PER_PAGE = 50;
  // Hard cap — a single user should never have >500 memberships; if
  // Whop returns more, something is wrong and we stop.
  for (let i = 0; i < 10; i++) {
    const url = `${WHOP_MEMBERSHIPS_BASE}/memberships?user_id=${encodeURIComponent(
      whopUserId,
    )}&per_page=${PER_PAGE}&page=${page}`;
    const res = await whopFetchWithRetry(url, headers);
    if (!res.ok) {
      throw new Error(`Whop API HTTP ${res.status} for user ${whopUserId}`);
    }
    const json = (await res.json()) as {
      data?: Array<{ user: string | null; created_at: number | string | null }>;
      pagination?: { current_page?: number; total_page?: number };
    };
    const rows = json.data ?? [];

    // Sanity: if Whop ignored our user_id filter, abort rather than
    // attribute other users' dates to this one.
    const allMatchUser = rows.every((r) => !r.user || r.user === whopUserId);
    if (!allMatchUser) {
      throw new Error(
        `Whop user_id filter ignored for ${whopUserId} — refusing to write`,
      );
    }

    for (const r of rows) {
      const iso = toIso(r.created_at);
      if (!iso) continue;
      foundCount += 1;
      if (!earliest || iso < earliest) earliest = iso;
    }

    const totalPages = json.pagination?.total_page ?? 1;
    if (page >= totalPages) break;
    page += 1;
  }

  return { firstPaidIso: earliest, foundCount };
}

/**
 * Sync entry per user: the latest membership row (for current
 * status / plan / canceled state) AND the earliest created_at
 * across ALL of this user's memberships (their true "first paid"
 * date, never moves on renewal).
 */
export type SyncEntry = WhopMembershipRow & {
  /** ISO timestamp of the earliest membership created_at we saw
   *  for this user across all paginated rows. Null only if we
   *  couldn't parse any of the dates. */
  _firstPaidAt: string | null;
};

/** Convenience: collect every membership across every product id in
 *  WHOP_PRODUCT_ID. Per-user dedupe: keeps the LATEST membership row
 *  (for current state) and computes the EARLIEST created_at for
 *  first_paid_at. */
export async function fetchAllMemberships(): Promise<SyncEntry[]> {
  const raw = process.env.WHOP_PRODUCT_ID ?? "";
  const productIds = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (productIds.length === 0) {
    throw new Error("WHOP_PRODUCT_ID not set");
  }
  type Acc = { latest: WhopMembershipRow; firstPaidAt: string | null };
  const byUser = new Map<string, Acc>();
  for (const pid of productIds) {
    for await (const row of listMembershipsForProduct(pid)) {
      if (!row.user) continue;
      const createdIso = toIso(row.created_at);
      const existing = byUser.get(row.user);
      if (!existing) {
        byUser.set(row.user, { latest: row, firstPaidAt: createdIso });
        continue;
      }
      // Track earliest created_at as first_paid_at.
      if (
        createdIso &&
        (!existing.firstPaidAt || createdIso < existing.firstPaidAt)
      ) {
        existing.firstPaidAt = createdIso;
      }
      // Track latest membership row as the "current state."
      const latestIso = toIso(existing.latest.created_at);
      if (createdIso && latestIso && createdIso > latestIso) {
        existing.latest = row;
      }
    }
  }
  return Array.from(byUser.values()).map(({ latest, firstPaidAt }) => ({
    ...latest,
    _firstPaidAt: firstPaidAt,
  }));
}
