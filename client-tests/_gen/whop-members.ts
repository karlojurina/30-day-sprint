
const WHOP_MEMBERSHIPS_BASE = "https://api.whop.com/api/v2";

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
    const retryAfterHeader = res.headers.get("retry-after");
    const retryAfterSec = retryAfterHeader
      ? parseInt(retryAfterHeader, 10)
      : NaN;
    let waitMs = !isNaN(retryAfterSec)
      ? retryAfterSec * 1000
      : Math.min(30_000, 1_000 * Math.pow(2, attempt));
    waitMs += Math.floor(Math.random() * 250);
    console.warn(
      `[whop-api] 429 rate-limited; waiting ${waitMs}ms before retry ${attempt + 1}/${maxRetries}`,
    );
    await new Promise((r) => setTimeout(r, waitMs));
  }
  return lastRes!;
}

export interface WhopMembershipRow {
  id: string;
  user: string | null;
  email: string | null;
  status: string | null;
  valid: boolean | null;
  created_at: number | string | null;
  expires_at: number | string | null;
  renewal_period_end?: number | string | null;
  cancel_at_period_end?: boolean | null;
  discord?: { id?: string; username?: string } | null;
  discord_user_id?: string | null;
  product?: string | null;
  plan?: string | null;
}

export function mapStatus(
  row: Pick<WhopMembershipRow, "status" | "valid">,
): "active" | "past_due" | "canceled" | "expired" {
  const s = (row.status ?? "").toLowerCase();

  if (row.valid === true) {
    return s === "past_due" ? "past_due" : "active";
  }
  if (row.valid === false) {
    return s === "expired" ? "expired" : "canceled";
  }

  if (s === "active" || s === "trialing" || s === "completed") return "active";
  if (s === "past_due") return "past_due";
  if (s === "expired") return "expired";
  if (s === "canceled" || s === "suspended") return "canceled";
  return "active";
}

export function toIso(value: number | string | null): string | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  const ms = value > 10_000_000_000 ? value : value * 1000;
  const d = new Date(ms);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

interface FetchOptions {
  perPage?: number;
  maxPages?: number;
}

export async function* listMembershipsForProduct(
  productId: string,
  opts: FetchOptions = {},
): AsyncGenerator<WhopMembershipRow> {
  const apiKey = process.env.WHOP_API_KEY;
  if (!apiKey) throw new Error("WHOP_API_KEY not set");
  const perPage = opts.perPage ?? 50;
  const maxPages = opts.maxPages ?? 500;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
  };

  let page = 1;
  while (page <= maxPages) {
    if (page > 1) await new Promise((r) => setTimeout(r, 200));
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
    const currentPage = json.pagination?.current_page ?? page;
    const totalPage = json.pagination?.total_page ?? currentPage;
    if (currentPage >= totalPage) break;
    page = currentPage + 1;
    if (page > maxPages) {
      throw new Error(
        `Whop memberships walk for ${productId} exceeded maxPages (${maxPages}); ` +
          `Whop reported ${totalPage} pages. Refusing to return a truncated list.`,
      );
    }
  }
}

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

function grantsAccess(row: WhopMembershipRow): boolean {
  const s = mapStatus(row);
  return s === "active" || s === "past_due";
}

export function accessRank(status: string | null | undefined): number {
  if (status === "active") return 2;
  if (status === "past_due") return 1;
  return 0;
}

const ETFB_OR_APEX_PRODUCT_IDS: ReadonlySet<string> = new Set([
  "prod_bGNf1u02RruKC",
  "prod_vCHZUO8dU4ts2",
]);

export function isEtfbOrApexProduct(
  productId: string | null | undefined,
): boolean {
  return productId != null && ETFB_OR_APEX_PRODUCT_IDS.has(productId);
}

type Ranked = { row: WhopMembershipRow; course: boolean };

function outranks(a: Ranked, b: Ranked): boolean {
  const aRank = accessRank(mapStatus(a.row));
  const bRank = accessRank(mapStatus(b.row));
  if (aRank !== bRank) return aRank > bRank;
  if (aRank > 0 && a.course !== b.course) return a.course;
  const aIso = toIso(a.row.created_at);
  const bIso = toIso(b.row.created_at);
  return Boolean(aIso && bIso && aIso > bIso);
}

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
    const course = !isEtfbOrApexProduct(pid);
    for await (const row of listMembershipsForProduct(pid)) {
      if (!row.user) continue;
      const existing = byUser.get(row.user);
      if (!existing) {
        byUser.set(row.user, { row, course });
        continue;
      }
      if (outranks({ row, course }, existing)) {
        byUser.set(row.user, { row, course });
      }
    }
  }
  return Array.from(byUser.values()).map(({ row }) => row);
}
