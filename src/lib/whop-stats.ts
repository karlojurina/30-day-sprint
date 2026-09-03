/**
 * Whop Stats API client for the founder-only /admin/stats surface.
 *
 * Read-only. Nothing here writes to Whop or to our database, and no
 * revenue figure is ever persisted.
 *
 * ─────────────────────────────────────────────────────────────────────
 * THE ONE RULE: we only ever ask Whop for interval=day.
 *
 * Every coarser interval in this API has a verified bucket-semantics
 * bug, and each one fails into a plausible number rather than an error:
 *
 *   1. A PARTIAL bucket is stamped with the WHOLE period's timestamp.
 *      from=2026-08-10&to=2026-08-20&interval=month returns one point
 *      stamped 2026-08-01 worth $49,447.27. Real August: $136,964.49.
 *   2. MRR/ARR month buckets carry the value on the FIRST day of the
 *      period. Aug bucket = 112,455.11 (the Aug-1 value); Aug-31 is
 *      120,168.58. A monthly MRR tile is ~4 weeks stale, and looks fine.
 *   3. paid_active_members does the OPPOSITE — its month bucket is the
 *      LAST day. Two different level semantics in one API.
 *   4. churn_rate / paid_active_members / users_growth accept
 *      interval=hour with HTTP 200 and silently return DAY buckets.
 *   5. sales_tax_withheld's month bucket disagrees with the sum of its
 *      own daily points in 4 of 19 months (up to -153.42).
 *
 * Daily points are the only shape verified self-consistent: gross_revenue
 * month == sum(daily) exactly in all 19 months, and per-product daily
 * sums reconcile to the account total to $0.00. So we take days and do
 * the rollup ourselves in rollupPoints().
 * ─────────────────────────────────────────────────────────────────────
 */

import { whopFetchWithRetry } from "@/lib/whop-members";
import {
  WHOP_METRICS,
  aggregate,
  percentOutOfBand,
  type MetricPoint,
  type WhopTotals,
} from "@/lib/whop-stats-catalog";

const WHOP_STATS_BASE = "https://api.whop.com/api/v1/stats";

/** Concurrency ceiling. Measured: 120 concurrent never 429'd, but Whop's
 *  documented Cloudflare ceiling is ~10 req/sec from one origin and a
 *  wedged pool is worse than a slow one. 8 gave 40 calls in ~1.0-1.6s. */
const POOL_SIZE = 8;

export type TileErrorReason =
  | "auth"
  | "scope"
  | "unknown_metric"
  | "rate_limited"
  | "upstream_html"
  | "upstream_error"
  | "unsupported"
  | "timeout"
  | "not_renderable";

export type TileResult =
  | {
      status: "ok";
      unit: "currency" | "count" | "percent";
      value: number | null;
      previousValue: number | null;
      points: MetricPoint[];
      /** Set when Whop's earliest returned bucket is later than requested. */
      historyTruncated?: { requestedFrom: string; actualFrom: string };
      /** Set when the final bucket covers an incomplete period. */
      trailingPartial?: boolean;
    }
  | { status: "no_data" }
  | { status: "error"; reason: TileErrorReason };

/**
 * Classify a failed call WITHOUT letting any upstream text escape.
 * `reason` is a closed union, never an interpolated message — an
 * upstream body could contain data, and error strings end up in logs
 * and on screen.
 */
function classify(status: number, parsedErrorType?: string): TileErrorReason {
  if (status === 401) return "auth";
  if (status === 403) return "scope";
  if (status === 404) return "unknown_metric";
  if (status === 429) return "rate_limited";
  if (status === 400) return "unsupported";
  if (parsedErrorType === "forbidden") return "scope";
  return "upstream_error";
}

type RawSeries = { points: MetricPoint[]; totals: WhopTotals };

/**
 * One Whop call. Returns raw daily points, or a classified failure.
 *
 * Every guard here exists because of an observed behaviour:
 *  - whopFetchWithRetry RETURNS a failed Response (it does not throw),
 *    so status must be checked before anything else.
 *  - The envelope is not always JSON: an intermittent HTML 500 page was
 *    observed 1 time in 6 identical calls. JSON.parse must be guarded.
 *  - A non-200 must never become an empty series, because `points: []`
 *    is a LEGITIMATE response on this account and is indistinguishable
 *    from a dead API key once it reaches the renderer.
 */
async function fetchOne(
  key: string,
  from: string,
  to: string,
  product?: string | null,
): Promise<RawSeries | { error: TileErrorReason }> {
  const accountId = process.env.WHOP_COMPANY_ID;
  if (!accountId) return { error: "upstream_error" };

  const params = new URLSearchParams({
    account_id: accountId,
    from,
    to,
    interval: "day", // see THE ONE RULE above
  });
  if (product) params.set("product", product);

  const spec = WHOP_METRICS[key];
  if (spec?.requires) {
    for (const [k, v] of Object.entries(spec.requires)) params.set(k, v);
  }

  const url = `${WHOP_STATS_BASE}/${encodeURIComponent(key)}?${params.toString()}`;

  let res: Response;
  try {
    res = await whopFetchWithRetry(url, {
      Authorization: `Bearer ${process.env.WHOP_API_KEY}`,
      Accept: "application/json",
    });
  } catch {
    return { error: "timeout" };
  }

  const text = await res.text();

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    // Non-JSON body. Observed as an intermittent Rails HTML 500 page.
    return { error: res.ok ? "upstream_html" : classify(res.status) };
  }

  const errType = (json as { error?: { type?: string } })?.error?.type;

  if (!res.ok) return { error: classify(res.status, errType) };
  if (errType) return { error: classify(200, errType) };

  const data = (json as { data?: { points?: unknown; totals?: unknown } })?.data;
  if (!data || !Array.isArray(data.points)) return { error: "upstream_error" };

  const points: MetricPoint[] = (data.points as { timestamp: number; value: number | null }[])
    .map((p) => ({ t: p.timestamp, v: p.value }))
    // Point order was ascending in every response inspected, but that was
    // never guaranteed by the docs, and LEVEL metrics read the last element.
    .sort((a, b) => a.t - b.t);

  return {
    points,
    totals: Array.isArray(data.totals) ? (data.totals as WhopTotals) : undefined,
  };
}

/**
 * Fetch one metric for the current window and the comparison window,
 * and collapse both through aggregate().
 */
export async function fetchMetricSeries(args: {
  key: string;
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
  product?: string | null;
  /** True when `to` is inside an incomplete period (e.g. today). */
  trailingPartial?: boolean;
}): Promise<TileResult> {
  const spec = WHOP_METRICS[args.key];
  if (!spec) return { status: "error", reason: "unknown_metric" };
  if (spec.usable === "no") return { status: "error", reason: "not_renderable" };
  if (args.product && !spec.product) {
    return { status: "error", reason: "unsupported" };
  }

  const [cur, prev] = await Promise.all([
    fetchOne(args.key, args.from, args.to, args.product),
    fetchOne(args.key, args.previousFrom, args.previousTo, args.product),
  ]);

  if ("error" in cur) return { status: "error", reason: cur.error };

  if (cur.points.length === 0 && !cur.totals) return { status: "no_data" };

  const value = aggregate(args.key, cur.points, cur.totals);
  const previousValue =
    "error" in prev ? null : aggregate(args.key, prev.points, prev.totals);

  // A percent outside 0-100 means something scaled a pre-scaled value.
  // Fail loudly rather than render a believable wrong percentage.
  if (percentOutOfBand(args.key, value)) {
    return { status: "error", reason: "upstream_error" };
  }

  const result: TileResult = {
    status: "ok",
    unit: spec.unit,
    value,
    previousValue,
    points: cur.points,
  };

  // Whop's history window moves forward over time. A saved view asking
  // for an absolute `from` will silently start later and show a smaller,
  // entirely believable total unless the shortfall is surfaced.
  const earliest = cur.points[0]?.t;
  if (earliest) {
    const actualFrom = new Date(earliest * 1000).toISOString().slice(0, 10);
    if (actualFrom > args.from) {
      result.historyTruncated = { requestedFrom: args.from, actualFrom };
    }
  }

  if (args.trailingPartial) result.trailingPartial = true;

  return result;
}

/** Run tasks with a bounded concurrency pool, preserving input order. */
export async function pooled<T>(
  tasks: (() => Promise<T>)[],
  size = POOL_SIZE,
): Promise<T[]> {
  const out = new Array<T>(tasks.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(size, tasks.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= tasks.length) return;
      out[i] = await tasks[i]();
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Fold daily points into the requested granularity, in OUR code.
 *
 * Bucketing is by UTC calendar period. Weeks start MONDAY, matching
 * Whop's own week boundary so a weekly view here lines up with theirs.
 *
 * `agg` decides how a bucket collapses, and it is the same taxonomy
 * aggregate() uses — FLOW sums, levels take the last observed value in
 * the bucket. Ratios and unique counts are NOT foldable from daily
 * points (a ratio has a denominator; a unique count deduplicates), so
 * for those the daily series is returned unfolded and the tile shows the
 * whole-window figure from data.totals instead.
 */
export function rollupPoints(
  key: string,
  points: MetricPoint[],
  granularity: "day" | "week" | "month",
): MetricPoint[] {
  if (granularity === "day") return points;

  const spec = WHOP_METRICS[key];
  if (!spec) throw new Error(`rollupPoints: unknown Whop metric "${key}".`);
  if (spec.agg === "RATIO" || spec.agg === "UNIQUE" || spec.agg === "TOTALS_ONLY") {
    return points;
  }

  const bucketStart = (ts: number): number => {
    const d = new Date(ts * 1000);
    if (granularity === "month") {
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000;
    }
    // Monday-start week.
    const dow = (d.getUTCDay() + 6) % 7;
    return (
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow) / 1000
    );
  };

  const buckets = new Map<number, MetricPoint[]>();
  for (const p of points) {
    const b = bucketStart(p.t);
    const arr = buckets.get(b);
    if (arr) arr.push(p);
    else buckets.set(b, [p]);
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, ps]) => {
      const nonNull = ps.filter((p) => p.v != null) as { t: number; v: number }[];
      if (nonNull.length === 0) return { t, v: null }; // gap, never 0
      const v =
        spec.agg === "FLOW" || spec.agg === "FLOW_INFERRED"
          ? nonNull.reduce((s, p) => s + p.v, 0)
          : nonNull[nonNull.length - 1].v;
      return { t, v };
    });
}

// ============================================================================
// RANGE RESOLUTION — server-side, UTC only.
//
// The client sends a NAMED PRESET, never a raw from/to. Two reasons:
//  1. Every date helper on the existing admin pages evaluates in the
//     BROWSER (insights/progress/page.tsx:114 `new Date().toISOString()`).
//     In UTC+2 that returns yesterday between 00:00 and 02:00 local, so a
//     window built client-side is silently a day off for Karlo in Zagreb.
//  2. A malformed window does not error — a future range returns a clean
//     200 with `points: []`, which is indistinguishable from "no revenue".
//
// Every boundary below is Date.UTC(...). `new Date(y, m, d)` is local-time
// and must never appear in this file.
//
// Whop's from/to are INCLUSIVE on both ends (proven to the cent: a 30-day
// range equals the sum of its 30 individual day calls), so a 7-day window
// is `to - 6`, not `to - 7`.
// ============================================================================

export const STATS_RANGES = [
  "last_7d",
  "last_28d",
  "last_30d",
  "last_90d",
  "this_month",
  "last_month",
  "last_12m",
  "all_time",
] as const;

export type StatsRange = (typeof STATS_RANGES)[number];

/** Earliest bucket Whop has ever returned for this account. */
export const WHOP_HISTORY_START = "2025-02-01";

export type ResolvedRange = {
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
  /** True when `to` falls inside an incomplete period (today, or this month). */
  trailingPartial: boolean;
};

const DAY_MS = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const utcMidnight = (d: Date) =>
  Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

export function isStatsRange(v: unknown): v is StatsRange {
  return typeof v === "string" && (STATS_RANGES as readonly string[]).includes(v);
}

/**
 * Resolve a preset to an explicit UTC window plus the comparison window.
 * The comparison window is always the same number of days immediately
 * before `from`, so a delta compares like with like.
 *
 * @param now Injectable for tests. Defaults to the server clock.
 */
export function resolveRange(range: StatsRange, now = new Date()): ResolvedRange {
  const today = utcMidnight(now);
  const y = new Date(today).getUTCFullYear();
  const m = new Date(today).getUTCMonth();

  let fromMs: number;
  let toMs: number;
  let trailingPartial = true;

  switch (range) {
    case "last_7d":
      toMs = today;
      fromMs = today - 6 * DAY_MS;
      break;
    case "last_28d":
      toMs = today;
      fromMs = today - 27 * DAY_MS;
      break;
    case "last_30d":
      toMs = today;
      fromMs = today - 29 * DAY_MS;
      break;
    case "last_90d":
      toMs = today;
      fromMs = today - 89 * DAY_MS;
      break;
    case "this_month":
      fromMs = Date.UTC(y, m, 1);
      toMs = today;
      break;
    case "last_month":
      fromMs = Date.UTC(y, m - 1, 1);
      toMs = Date.UTC(y, m, 0); // day 0 of this month == last day of last month
      trailingPartial = false;
      break;
    case "last_12m":
      fromMs = Date.UTC(y, m - 11, 1);
      toMs = today;
      break;
    case "all_time":
      fromMs = Date.parse(`${WHOP_HISTORY_START}T00:00:00Z`);
      toMs = today;
      break;
  }

  const spanDays = Math.round((toMs - fromMs) / DAY_MS) + 1; // inclusive
  const previousTo = fromMs - DAY_MS;
  const previousFrom = previousTo - (spanDays - 1) * DAY_MS;

  return {
    from: iso(fromMs),
    to: iso(toMs),
    previousFrom: iso(previousFrom),
    previousTo: iso(previousTo),
    trailingPartial,
  };
}

/**
 * Coerce granularity by window size so the browser is never handed more
 * points than it can paint. A 20-month daily range across 12 tiles is
 * ~7,000 points per tile; the response says which granularity was
 * actually used so each tile can label itself honestly.
 */
export function coerceGranularity(
  requested: "day" | "week" | "month",
  from: string,
  to: string,
): { granularity: "day" | "week" | "month"; coerced: boolean } {
  const days =
    Math.round(
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS,
    ) + 1;
  if (requested === "day" && days > 92) {
    return { granularity: days > 400 ? "month" : "week", coerced: true };
  }
  if (requested === "week" && days > 800) {
    return { granularity: "month", coerced: true };
  }
  return { granularity: requested, coerced: false };
}

// ============================================================================
// SELF-CHECK — the only automated defence against a wrong number.
//
// This whole surface rests on one property verified 2026-09-03: the sum of
// gross_revenue across the account's revenue-bearing products equals the
// unfiltered account figure, EXACTLY ($0.00 over August 2026).
//
// That property is not guaranteed to keep holding, and the two ways it can
// break are both silent:
//
//   1. Karlo adds a NEW product in Whop. Our product list goes stale, the
//      per-product view omits it, and the account total stays correct — so
//      the per-product tiles quietly under-report while looking fine. This is
//      not hypothetical: two revenue-bearing products (prod_8xXRH0itamZoI at
//      $1,500 and prod_HvtwbgSituEJi at $500) were already absent from this
//      codebase before 2026-09-03 and nobody knew.
//   2. Whop changes per-product attribution. They removed per-product
//      reporting from their own dashboard once already.
//
// Neither produces an error. The difference between the two figures IS the
// error, so we compute it and put it on screen. There is no test suite in
// this repo (no jest/vitest/playwright, no test script), so this runtime
// invariant is the substitute — and it is arguably better, because it checks
// production data rather than a fixture.
// ============================================================================

export type Reconciliation = {
  ok: boolean;
  account: number | null;
  productSum: number | null;
  difference: number | null;
  productCount: number;
};

/** Tolerance in dollars. Whop returns 2dp; anything above a cent is real. */
const RECONCILE_TOLERANCE = 0.01;

/**
 * Compare account-level gross revenue against the sum of its parts.
 * Runs only when no product filter is active — with a filter applied the
 * comparison is meaningless.
 *
 * Costs one call per known product plus one for the account. Deliberately
 * only ever run for gross_revenue: it is the metric with the cleanest
 * verified additivity (month == sum(daily) exact in all 19 months), so a
 * divergence here means the product set or the attribution changed, not
 * that the metric is inherently non-additive.
 */
export async function reconcileProducts(
  productIds: string[],
  from: string,
  to: string,
): Promise<Reconciliation> {
  const sum = (r: RawSeries | { error: TileErrorReason }) =>
    "error" in r
      ? null
      : r.points.reduce((s, p) => s + (p.v ?? 0), 0);

  const [acct, ...parts] = await pooled([
    () => fetchOne("gross_revenue", from, to, null),
    ...productIds.map((p) => () => fetchOne("gross_revenue", from, to, p)),
  ]);

  const account = sum(acct);
  // If ANY part failed we cannot claim the invariant holds or fails — an
  // unknown is not a pass. Report it as not-ok with nulls rather than
  // comparing against a short sum, which would fabricate a difference.
  const partValues = parts.map(sum);
  if (account == null || partValues.some((v) => v == null)) {
    return {
      ok: false,
      account,
      productSum: null,
      difference: null,
      productCount: productIds.length,
    };
  }

  const productSum = (partValues as number[]).reduce((s, v) => s + v, 0);
  const difference = account - productSum;

  return {
    ok: Math.abs(difference) < RECONCILE_TOLERANCE,
    account,
    productSum,
    difference,
    productCount: productIds.length,
  };
}

// ============================================================================
// CUSTOM RANGE (v86.1)
//
// The route originally accepted NAMED PRESETS ONLY, on purpose: every existing
// admin date helper evaluates in the browser (insights/progress/page.tsx:114
// `new Date().toISOString()`), which returns yesterday in UTC+2 between 00:00
// and 02:00 local — and a malformed window does not error, it returns a clean
// 200 with `points: []`, indistinguishable from "no revenue".
//
// Custom ranges are now allowed because they are the only way to reconcile
// this page against Whop's own dashboard for an arbitrary window. The safety
// property is preserved by two rules:
//
//   1. The client sends CALENDAR DATE STRINGS, never Date objects. An
//      <input type="date"> yields "YYYY-MM-DD" with no timezone applied, and
//      those strings are passed through verbatim. No Date is constructed in
//      the browser at any point, so there is no local-midnight to be wrong
//      about.
//   2. Validation here is strict and REJECTS rather than clamping. A window
//      that is malformed, reversed, in the future, or outside Whop's history
//      returns an error the UI shows — it never silently becomes a different
//      window that returns plausible numbers for dates nobody asked for.
// ============================================================================

/** Longest custom window. Matches coerceGranularity's month threshold. */
const MAX_CUSTOM_SPAN_DAYS = 800;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type CustomRangeResult =
  | { ok: true; range: ResolvedRange }
  | { ok: false; reason: string };

/**
 * Validate and resolve an explicit from/to pair.
 *
 * @param now Injectable for tests. Defaults to the server clock.
 */
export function resolveCustomRange(
  from: string,
  to: string,
  now = new Date(),
): CustomRangeResult {
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) {
    return { ok: false, reason: "Dates must be YYYY-MM-DD." };
  }

  const fromMs = Date.parse(`${from}T00:00:00Z`);
  const toMs = Date.parse(`${to}T00:00:00Z`);

  // Catches real calendar nonsense that matches the regex, e.g. 2026-02-31.
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
    return { ok: false, reason: "That is not a real date." };
  }
  if (new Date(fromMs).toISOString().slice(0, 10) !== from) {
    return { ok: false, reason: `${from} is not a real date.` };
  }
  if (new Date(toMs).toISOString().slice(0, 10) !== to) {
    return { ok: false, reason: `${to} is not a real date.` };
  }

  if (fromMs > toMs) {
    return { ok: false, reason: "Start date is after the end date." };
  }

  const todayMs = utcMidnight(now);
  if (toMs > todayMs) {
    return {
      ok: false,
      reason: `End date is in the future. Whop has no data past ${iso(todayMs)}.`,
    };
  }

  const historyMs = Date.parse(`${WHOP_HISTORY_START}T00:00:00Z`);
  if (fromMs < historyMs) {
    return {
      ok: false,
      reason: `Whop's history starts ${WHOP_HISTORY_START}; nothing exists before that.`,
    };
  }

  const spanDays = Math.round((toMs - fromMs) / DAY_MS) + 1; // inclusive
  if (spanDays > MAX_CUSTOM_SPAN_DAYS) {
    return {
      ok: false,
      reason: `That window is ${spanDays} days. Maximum is ${MAX_CUSTOM_SPAN_DAYS}.`,
    };
  }

  const previousTo = fromMs - DAY_MS;
  const previousFrom = previousTo - (spanDays - 1) * DAY_MS;

  return {
    ok: true,
    range: {
      from,
      to,
      previousFrom: iso(previousFrom),
      previousTo: iso(previousTo),
      // A custom window ending today is still partially complete. Ending on
      // any earlier date, it is not — which is what makes this usable for
      // reconciling against a figure Whop already finalised.
      trailingPartial: toMs === todayMs,
    },
  };
}
