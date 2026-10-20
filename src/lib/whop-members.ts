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
export async function whopFetchWithRetry(
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
    // stays well under. ~16s on a 78-page sync (acceptable).
    if (page > 1) await new Promise((r) => setTimeout(r, 200));
    // v89: `per=`, NOT `per_page=`. Whop v2 silently ignores `per_page`
    // and serves 10 rows/page regardless; `per` is honoured up to 50.
    // Measured 2026-09-17 against prod_eE7r6SXa3H0MX: per_page=50 gives
    // total_page 389, per=50 gives total_page 78. Identical data, a
    // fifth of the requests, and it moves the 500-page cap from ~1,100
    // memberships away to ~21,000 away.
    const url = `${WHOP_MEMBERSHIPS_BASE}/memberships?product_id=${encodeURIComponent(
      productId,
    )}&page=${page}&per=${perPage}`;
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
    // v89: Whop silently ignores an INVALID product_id — HTTP 200 and the
    // entire account comes back (verified live 2026-09-17: a plan_ id in
    // this slot returns all 8,291 rows instead of the product's 3,881).
    // This loop yields whatever it is handed and applies no product check
    // of its own, so a bad id would quietly turn `students` into an
    // account-wide mirror. Fail instead.
    const foreign = items.filter((m) => m.product && m.product !== productId);
    if (foreign.length > 0) {
      const others = Array.from(new Set(foreign.map((m) => m.product)));
      throw new Error(
        `Whop product_id filter not honoured for ${productId}: page ${page} ` +
          `returned ${foreign.length}/${items.length} rows for other products ` +
          `(${others.slice(0, 3).join(", ")}). Refusing to sync an unfiltered list.`,
      );
    }
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
    // v89: refuse to return a truncated list, same rule as etfb.ts. Exiting
    // silently at the cap is precisely how a partial sync becomes
    // indistinguishable from a complete one — the runner would upsert the
    // rows it saw and log status='success'.
    if (page > maxPages) {
      throw new Error(
        `Whop memberships walk for ${productId} exceeded maxPages (${maxPages}); ` +
          `Whop reported ${totalPage} pages. Refusing to return a truncated list.`,
      );
    }
  }
}

/**
 * Look up the active (or past_due) membership for a single user, by
 * whop_user_id. Used by the OAuth callback to self-heal student rows
 * for legacy customers who joined before our webhook was wired up
 * (Karlo's bug 2026-05-30 — one legacy customer). Falls back across
 * every product configured in WHOP_PRODUCT_ID.
 *
 * Returns null if no active membership exists for any of our
 * products. Tolerates per-product fetch failures so a single bad
 * response doesn't kill the whole check.
 *
 * 2026-10-20: each strategy collects the memberships it finds that grant
 * access on a listed product and returns the one the sync's order puts first
 * (bestThatGrants, outranks): active over past_due, then the course's over an
 * ETfB or Apex one, then the newest. It used to return the first one Whop
 * listed, so the login's self-heal, the webhook's re-point after a membership
 * ends and its writes for an event with no product could land on an Apex seat
 * beside a valid course membership.
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
        const myActive = bestThatGrants(
          rows.map((row) => ({ row, listedUnder: null })),
          productIds,
        );
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
  // 2026-10-20: every listed product is asked before one is picked, so the
  // order decides (bestThatGrants), whatever the order of WHOP_PRODUCT_ID.
  const perProduct: Array<{ row: WhopMembershipRow; listedUnder: string }> = [];
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
      for (const row of rows) perProduct.push({ row, listedUnder: pid });
    } catch (err) {
      console.warn(
        `[self-heal] strategy2 product=${pid} threw: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }
  }
  const fromProducts = bestThatGrants(perProduct, productIds);
  if (fromProducts) {
    console.info(
      `[self-heal] strategy2 MATCH product=${fromProducts.product ?? "none named"} id=${fromProducts.id} status=${fromProducts.status}`,
    );
    return fromProducts;
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
      const active = bestThatGrants(
        rows.map((row) => ({ row, listedUnder: null })),
        productIds,
      );
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

/** Does this membership currently grant access? v85.6 — the tiebreak
 *  the per-user dedupe below sorts on. */
function grantsAccess(row: WhopMembershipRow): boolean {
  const s = mapStatus(row);
  return s === "active" || s === "past_due";
}

/**
 * A membership status's place in the first two steps of the order (outranks,
 * below): 2 active, 1 past_due, 0 anything else (canceled, expired, none).
 * past_due grants access on Whop, but the app locks the person out
 * (MembershipBlockOverlay, the lesson-video route), so active comes first.
 * The webhook ranks a stored students.membership_status with it before an
 * ETfB or Apex write (etfbOrApexMayWrite, src/app/api/webhooks/whop/route.ts).
 */
export function accessRank(status: string | null | undefined): number {
  if (status === "active") return 2;
  if (status === "past_due") return 1;
  return 0;
}

/**
 * ETfB for brands and Apex team seats, the two products production's
 * WHOP_PRODUCT_ID names beside the course since 2026-10-20 (the owner's call
 * that their members keep the app). The same ids as ETFB_PRODUCT_ID and
 * TEAM_SEAT_PRODUCT_ID in src/lib/etfb.ts, written out here because etfb.ts
 * and this module import nothing from each other (etfb.ts says why);
 * whop-product-setting.test.mjs checks that the two agree.
 */
const ETFB_OR_APEX_PRODUCT_IDS: ReadonlySet<string> = new Set([
  "prod_bGNf1u02RruKC",
  "prod_vCHZUO8dU4ts2",
]);

/**
 * Is this product ETfB for brands or Apex team seats? A membership of any
 * other product WHOP_PRODUCT_ID names is the course's. Between two of a user's
 * memberships with the same access (both active, or both past_due), the
 * course's wins over an ETfB or Apex one (outranks, step c): in the sync's
 * dedupe (fetchAllMemberships), in the lookup (fetchActiveMembershipForUser)
 * and in the webhook's activations and payments
 * (src/app/api/webhooks/whop/route.ts). So a course student who also holds an
 * Apex seat or an ETfB membership keeps the course membership and its plan,
 * and stays on PAYING_WHOP_PLAN_IDS, the pool the CSM crons read, while the
 * course membership is active; a past_due one gives way to an active seat or
 * ETfB membership (step b).
 */
export function isEtfbOrApexProduct(
  productId: string | null | undefined,
): boolean {
  return productId != null && ETFB_OR_APEX_PRODUCT_IDS.has(productId);
}

/** One of a user's memberships, and whether it is the course's (not ETfB's or Apex's). */
type Ranked = { row: WhopMembershipRow; course: boolean };

/**
 * Does `a` stand for its user over `b`? The one order (2026-10-20) for every
 * reader that picks one of a user's memberships: the sync's dedupe
 * (fetchAllMemberships), the lookup behind the login's self-heal, the
 * webhook's re-point after a membership ends and its writes for an event that
 * names no product (fetchActiveMembershipForUser), and, as far as a stored row
 * can tell, the webhook's check before an ETfB or Apex write
 * (etfbOrApexMayWrite):
 *   (a) one that grants access (active or past_due) over one that does not;
 *   (b) active over past_due (accessRank): past_due locks the person out of
 *       the app, so an active Apex seat beats a past_due course membership;
 *   (c) the course's over an ETfB or Apex one;
 *   (d) the newer created_at. A tie, or a date missing, keeps `b`, the one
 *       seen first.
 * Between two that grant no access only (d) decides, as before 2026-10-20.
 */
function outranks(a: Ranked, b: Ranked): boolean {
  const aRank = accessRank(mapStatus(a.row));
  const bRank = accessRank(mapStatus(b.row));
  if (aRank !== bRank) return aRank > bRank;
  if (aRank > 0 && a.course !== b.course) return a.course;
  const aIso = toIso(a.row.created_at);
  const bIso = toIso(b.row.created_at);
  return Boolean(aIso && bIso && aIso > bIso);
}

/**
 * fetchActiveMembershipForUser's pick among the rows one strategy found: of
 * those that grant access on a product WHOP_PRODUCT_ID names (a row that names
 * no product counts, as before), the one the order puts first (outranks); null
 * when there is none. `listedUnder` is the product a per-product read asked
 * for, which says whether a row naming no product is the course's.
 */
function bestThatGrants(
  found: Array<{ row: WhopMembershipRow; listedUnder: string | null }>,
  productIds: string[],
): WhopMembershipRow | null {
  let best: Ranked | null = null;
  for (const { row, listedUnder } of found) {
    if (row.product && !productIds.includes(row.product)) continue;
    if (!grantsAccess(row)) continue;
    const candidate = {
      row,
      course: !isEtfbOrApexProduct(row.product ?? listedUnder),
    };
    if (!best || outranks(candidate, best)) best = candidate;
  }
  return best ? best.row : null;
}

/** Convenience: collect every membership across every product id in
 *  WHOP_PRODUCT_ID. Per-user dedupe: keeps the membership that best
 *  represents current access (for current state), by the order in
 *  outranks: one that grants access over one that does not; active over
 *  past_due; the course's over an ETfB or Apex one (isEtfbOrApexProduct);
 *  then the newest created_at. It computes no first-paid date: a
 *  membership's created_at is when access started, paid or not, so
 *  first_paid_at comes from the student's first real payment
 *  (src/lib/first-payment.ts, the first-paid fix, 2026-10-20). */
export async function fetchAllMemberships(): Promise<WhopMembershipRow[]> {
  const raw = process.env.WHOP_PRODUCT_ID ?? "";
  const productIds = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (productIds.length === 0) {
    throw new Error("WHOP_PRODUCT_ID not set");
  }
  const byUser = new Map<string, Ranked>();
  for (const pid of productIds) {
    // A row is the course's, or ETfB's or Apex's, by the product it was
    // listed under: listMembershipsForProduct refuses a page holding any
    // other product.
    const course = !isEtfbOrApexProduct(pid);
    for await (const row of listMembershipsForProduct(pid)) {
      if (!row.user) continue;
      const existing = byUser.get(row.user);
      if (!existing) {
        byUser.set(row.user, { row, course });
        continue;
      }
      // Track the row that represents "current state."
      //
      // v85.6 — was NEWEST-created wins, unconditionally. A user can
      // hold several memberships at once (re-subscribe, refund + rebuy,
      // free-plan claim, or a duplicate created by clicking Renew on
      // the block overlay). When the newest one was the DEAD one, the
      // sync stamped membership_status='canceled' on a fully paid-up
      // student and the dashboard hard-blocked them — every run, forever,
      // because a dead membership's created_at never stops being the
      // newest. That's what locked a paying student out on
      // 2026-07-29: his live membership lost to his canceled
      // duplicate.
      //
      // Access wins over recency. Recency only breaks ties WITHIN the
      // same access class, which preserves the old behavior for the
      // normal single-membership case and for genuinely churned users.
      //
      // 2026-10-20: and between two that grant access, active before
      // past_due, then the course's before an ETfB or Apex one, whichever
      // is newer (outranks). Newest-wins would point a paying course
      // student who takes a newer Apex seat at the seat and its free plan,
      // outside PAYING_WHOP_PLAN_IDS: the CSM cron would drop them from its
      // pool and dismiss their open tasks. Active comes before the course
      // because past_due locks the person out of the app: a course
      // membership whose renewal failed gives way to an active seat until
      // it is paid. Recency still decides within the same status and kind.
      if (outranks({ row, course }, existing)) {
        byUser.set(row.user, { row, course });
      }
    }
  }
  return Array.from(byUser.values()).map(({ row }) => row);
}
