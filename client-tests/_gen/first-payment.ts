/**
 * A student's first payment (the first-paid fix, 2026-10-20).
 *
 * THE RULE. A student's first payment is the earliest Whop payment by that
 * user that moved money:
 *   - status "paid", with paid_at set;
 *   - a total above 0. A $1 plan counts. A 100% promo code and a free trial
 *     leave payments with a total of 0 (or none at all), so they count from
 *     their first real charge. A total that does not read is left out too,
 *     and counted apart (bad_total);
 *   - not fully refunded: substatus "refunded" or "auto_refunded", or a
 *     refunded_amount at or above the total, leaves a payment out. A partial
 *     refund still counts;
 *   - not lost in a dispute: substatus "dispute_lost" (a chargeback the buyer
 *     won, so the money went back) leaves a payment out like a full refund,
 *     counted apart (dispute_lost). A reading taken on 2026-10-20 while Lovro
 *     could not be asked; the repair's dry run says how many there are;
 *   - for any product of the company.
 * A user with no such payment has no first payment (null): a free member, a
 * seat given away, a comp. Membership dates never decide it. A membership's
 * created_at is when access started, paid or not, and Whop's joined_at is when
 * the user first joined the company, so a free member who bought later carried
 * the free date: a student who bought on 14 October was told his first payment
 * was before 1 October (reported 2026-10-20).
 *
 * THE READ. GET /api/v1/payments with Api-Version-Date pinned: the payments
 * list changed shape on 2026-09-02-1, and the key's own pin is older. In the
 * pinned shape an amount is a money object ({ amount: "97.00", currency, ... })
 * and the buyer is `user: { id, ... }`; a bare number (the older shape) reads
 * too. At most 4 requests a second, start to start, shared by every lane of a
 * walk. A 429 is waited out (the seconds Whop names, or 15, at most 30) and
 * retried twice; a third ends the read. The facts behind all of it:
 * _admin/prds/first-paid-fix/ in the workspace (outside this repository).
 *
 * A PAGE IN ANOTHER SHAPE. In the pinned shape every payment carries its
 * buyer and its total. A page with rows of which not one carries a buyer, or
 * not one carries a total that reads, was answered in a shape this code does
 * not read (the buyer no longer nested, the total under another name). Judged
 * row by row it would say "no payment" for every buyer on it, which reads
 * exactly like a free member, so both reads treat it as a failed read
 * (bad_page): the caller writes nothing and logs the kind. One odd row on a
 * page is judged as usual (no_user, bad_total).
 *
 *   fetchFirstPaymentForUser: one user's payments (the login, the sync's
 *     recovery pass, the backfill route). Every row's user is checked: a row
 *     for anyone else means Whop ignored the filter, and the read answers an
 *     error and no date, so the caller writes nothing.
 *   walkFirstPayments: every paid payment of the account once, grouped by user
 *     (POST /api/admin/first-paid-repair), in one lane, or in 4 lanes that
 *     split the account's history by created_at and read side by side.
 *   fetchLatestRealPayment: one user's newest real payment for the course,
 *     for the coupon check when no renewal price can be read
 *     (membership-discount.ts, T-122), on that check's key, pace and limits.
 *
 * None of them writes anything. A failure comes back as a kind, never as
 * Whop's message, so no caller can pass a Whop id on by accident.
 */

import { toIso } from "./whop-members.ts";

export const WHOP_PAYMENTS_URL = "https://api.whop.com/api/v1/payments";
/** The payments shape these reads are written for. Any version from 2026-09-02-1 has it. */
export const WHOP_PAYMENTS_VERSION = "2026-10-15-1";
/** Whop's largest page. */
const PAGE_SIZE = 100;
/** 4 Whop requests a second, start to start, as the catch-up: the logins share the key. */
const WHOP_GAP_MS = 250;
const RETRIES_AFTER_429 = 2;
const WAIT_429_DEFAULT_S = 15;
const WAIT_429_MAX_S = 30;
/** More pages than this for one user means the user filter was not applied. */
const USER_MAX_PAGES = 10;
/** The account held about 160 pages of payments on 2026-09-03; a walk past this many is stuck. */
const WALK_MAX_PAGES = 2_000;
/**
 * Where a walk in 4 lanes splits the account's payments by created_at. Sales
 * begin in February 2025 and grow month on month
 * (system-docs/plan_2026-09-03_revenue-stats-page.md), so the later stretches
 * are shorter, each meant to hold about a quarter of the pages. A guess, not a
 * count: an uneven split only reads slower.
 */
export const WALK_LANE_SPLITS = [
  "2025-12-01T00:00:00.000Z",
  "2026-04-01T00:00:00.000Z",
  "2026-07-15T00:00:00.000Z",
] as const;
/**
 * Each lane asks for a second more on either side of its splits, so a payment
 * at a split is read whether Whop's created_after and created_before take in
 * their own moment or not. A payment two lanes read is counted once, by its id.
 */
const LANE_OVERLAP_MS = 1_000;

/** A money field in either shape: { amount: "97.00", ... } from 2026-09-02-1, or a bare number before it. */
type WhopMoney = { amount?: string | number | null } | number | string | null;

/** The fields of a Whop payment the rule and the walk read, in either shape. */
export interface WhopPayment {
  id?: string;
  status?: string | null;
  substatus?: string | null;
  paid_at?: string | number | null;
  created_at?: string | number | null;
  total?: WhopMoney;
  refunded_amount?: WhopMoney;
  user?: { id?: string | null } | null;
  /**
   * What the payment was for, read by fetchLatestRealPayment alone: an id in
   * the pinned shape (`product_id`), an object in the older one (`product:
   * { id }`); the promo code's name only in the older one (`promo_code:
   * { id, code }`).
   */
  product_id?: string | null;
  product?: { id?: string | null } | string | null;
  membership_id?: string | null;
  membership?: { id?: string | null } | string | null;
  promo_code_id?: string | null;
  promo_code?: { id?: string | null; code?: string | null } | string | null;
}

/** Why a payment read does not count. */
export type PaymentSkip =
  | "not_paid"
  | "no_paid_at"
  | "zero_total"
  | "bad_total"
  | "refunded"
  | "dispute_lost"
  | "no_user";

/** Why a read ended without an answer. The caller writes nothing then. */
export type PaymentReadFail =
  | "no_api_key"
  | "filter_ignored"
  | "rate_limited"
  | "time_budget"
  | "http_401_403"
  | "http_other"
  | "network"
  | "bad_page"
  | "too_many_pages";

export interface PaymentCounts {
  /** Payments read. */
  seen: number;
  /** Payments that count under the rule. */
  kept: number;
  skipped: Record<PaymentSkip, number>;
}

export function noPaymentCounts(): PaymentCounts {
  return {
    seen: 0,
    kept: 0,
    skipped: { not_paid: 0, no_paid_at: 0, zero_total: 0, bad_total: 0, refunded: 0, dispute_lost: 0, no_user: 0 },
  };
}

/** The number in a money field, in either shape. NaN when there is none or it does not read. */
export function moneyAmount(value: unknown): number {
  const raw = value !== null && typeof value === "object" ? (value as { amount?: unknown }).amount : value;
  if (typeof raw === "number") return raw;
  if (typeof raw === "string" && raw.trim() !== "") return Number(raw);
  return NaN;
}

/** Whether one payment is a real payment under the rule, and when it was paid. Its user is checked by the caller. */
export function judgePayment(
  p: WhopPayment,
): { keep: true; paidAt: string } | { keep: false; skip: Exclude<PaymentSkip, "no_user"> } {
  if (p.status !== "paid") return { keep: false, skip: "not_paid" };
  const paidAt = toIso(p.paid_at ?? null);
  if (!paidAt) return { keep: false, skip: "no_paid_at" };
  const total = moneyAmount(p.total);
  if (!Number.isFinite(total)) return { keep: false, skip: "bad_total" };
  if (!(total > 0)) return { keep: false, skip: "zero_total" };
  if (p.substatus === "refunded" || p.substatus === "auto_refunded") return { keep: false, skip: "refunded" };
  if (p.substatus === "dispute_lost") return { keep: false, skip: "dispute_lost" };
  // A refund of the whole total, whatever the substatus says. NaN (none) compares false.
  if (moneyAmount(p.refunded_amount) >= total) return { keep: false, skip: "refunded" };
  return { keep: true, paidAt };
}

/**
 * Whether a page of payments is in the shape this code reads: empty, or with
 * a buyer on at least one row and a total that reads on at least one row
 * (A PAGE IN ANOTHER SHAPE, above). A row that is not an object fails it.
 */
export function pageInShape(rows: readonly unknown[]): boolean {
  if (rows.length === 0) return true;
  if (!rows.every((p) => p !== null && typeof p === "object")) return false;
  const payments = rows as readonly WhopPayment[];
  return payments.some((p) => !!p.user?.id) && payments.some((p) => Number.isFinite(moneyAmount(p.total)));
}

/**
 * Adds a page of payments to the earliest real payment of each user, and to
 * the counts. Changes only the map and the counts it is handed.
 */
export function addFirstPayments(
  rows: readonly WhopPayment[],
  firstByUser: Map<string, string>,
  counts: PaymentCounts,
): void {
  for (const p of rows) {
    counts.seen += 1;
    const user = p.user?.id;
    if (!user) {
      counts.skipped.no_user += 1;
      continue;
    }
    const judged = judgePayment(p);
    if (!judged.keep) {
      counts.skipped[judged.skip] += 1;
      continue;
    }
    counts.kept += 1;
    const had = firstByUser.get(user);
    if (!had || Date.parse(judged.paidAt) < Date.parse(had)) firstByUser.set(user, judged.paidAt);
  }
}

/** True when a row names a buyer other than `whopUserId`: Whop ignored the user filter. */
export function hasOtherUser(rows: readonly WhopPayment[], whopUserId: string): boolean {
  return rows.some((p) => !!p.user?.id && p.user.id !== whopUserId);
}

/** The wait a 429 asks for: Whop's "Try again in N seconds", else Retry-After, else 15 s; at least 1 s, at most 30 s. */
export function waitAfter429Ms(body: string, retryAfter: string | null): number {
  const named = /try again in (\d+(?:\.\d+)?)\s*s/i.exec(body);
  const header = retryAfter !== null && retryAfter.trim() !== "" ? Number(retryAfter) : NaN;
  const seconds = named ? Number(named[1]) : Number.isFinite(header) ? header : WAIT_429_DEFAULT_S;
  return Math.min(WAIT_429_MAX_S, Math.max(1, seconds)) * 1000;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const TIMED_OUT = Symbol("no Whop answer by the limit");

/** fetch, or TIMED_OUT when Whop has not answered by `answerBy`. The timer is cleared either way. */
async function fetchBefore(url: string, init: RequestInit, answerBy: number): Promise<Response | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), Math.max(0, answerBy - Date.now()));
  });
  try {
    return await Promise.race([fetch(url, init), limit]);
  } finally {
    clearTimeout(timer);
  }
}

/** The requests one read has made, and when the next may start. A walk's lanes share one, and so does a run of coupon checks. */
export interface Pace {
  nextAt: number;
  requests: number;
  retried429: number;
}

type PageRead =
  | { ok: true; rows: WhopPayment[]; next: string | null; answerMs: number }
  | { ok: false; fail: PaymentReadFail };

/**
 * One page: paced, a 429 waited out and retried twice. `startBy`: no request
 * starts after it and no 429 wait that would end after it begins.
 * `answerBy`: an answer still missing then is given up. null for no limit.
 * `answerMs` is how long Whop took to answer the page.
 */
async function readPage(
  url: string,
  apiKey: string,
  pace: Pace,
  startBy: number | null,
  answerBy: number | null,
): Promise<PageRead> {
  const init: RequestInit = {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Api-Version-Date": WHOP_PAYMENTS_VERSION,
      Accept: "application/json",
    },
  };
  for (let attempt = 0; ; attempt++) {
    // The next free moment of the pace, taken before waiting for it, so
    // lanes that wait at once each get their own.
    const at = Math.max(Date.now(), pace.nextAt);
    if (startBy !== null && at > startBy) return { ok: false, fail: "time_budget" };
    pace.nextAt = at + WHOP_GAP_MS;
    if (at > Date.now()) await sleep(at - Date.now());
    pace.requests += 1;
    const sentAt = Date.now();
    let res: Response | typeof TIMED_OUT;
    try {
      res = answerBy === null ? await fetch(url, init) : await fetchBefore(url, init, answerBy);
    } catch {
      return { ok: false, fail: "network" };
    }
    if (res === TIMED_OUT) return { ok: false, fail: "time_budget" };
    if (res.status === 429) {
      const body = await res.text().catch(() => "");
      if (attempt >= RETRIES_AFTER_429) return { ok: false, fail: "rate_limited" };
      const waitMs = waitAfter429Ms(body, res.headers.get("retry-after"));
      if (startBy !== null && Date.now() + waitMs > startBy) return { ok: false, fail: "time_budget" };
      pace.retried429 += 1;
      // The limit is the key's, so every lane waits it out.
      pace.nextAt = Math.max(pace.nextAt, Date.now() + waitMs);
      continue;
    }
    if (res.status === 401 || res.status === 403) return { ok: false, fail: "http_401_403" };
    if (!res.ok) return { ok: false, fail: "http_other" };
    let page: { data?: unknown; page_info?: { has_next_page?: unknown; end_cursor?: unknown } | null } | null;
    try {
      page = await res.json();
    } catch {
      return { ok: false, fail: "bad_page" };
    }
    if (!page || !Array.isArray(page.data)) return { ok: false, fail: "bad_page" };
    if (!pageInShape(page.data)) return { ok: false, fail: "bad_page" };
    const more = page.page_info?.has_next_page === true;
    const cursor = typeof page.page_info?.end_cursor === "string" && page.page_info.end_cursor !== ""
      ? page.page_info.end_cursor
      : null;
    if (more && !cursor) return { ok: false, fail: "bad_page" };
    return { ok: true, rows: page.data as WhopPayment[], next: more ? cursor : null, answerMs: Date.now() - sentAt };
  }
}

export interface FirstPaymentResult {
  /** The first real payment, ISO. null when there is none, or when the read failed. */
  firstPaidIso: string | null;
  /** This user's payments that count under the rule. */
  kept: number;
  /** Payments read. */
  seen: number;
  /** Why the read failed (write nothing then), or null. */
  error: PaymentReadFail | null;
}

/**
 * One user's first real payment: GET /api/v1/payments?user_id=<id>&status=paid
 * &first=100, every page. `deadlineAtMs`: no request starts, no 429 wait ends
 * and no answer is waited on past it (the login's short wait, the sync's and
 * the backfill's time budgets); none by default.
 */
export async function fetchFirstPaymentForUser(
  whopUserId: string,
  opts: { deadlineAtMs?: number } = {},
): Promise<FirstPaymentResult> {
  const counts = noPaymentCounts();
  const failed = (error: PaymentReadFail): FirstPaymentResult => ({
    firstPaidIso: null,
    kept: counts.kept,
    seen: counts.seen,
    error,
  });
  const apiKey = process.env.WHOP_API_KEY;
  if (!apiKey) return failed("no_api_key");
  const deadline = opts.deadlineAtMs ?? null;
  const pace: Pace = { nextAt: 0, requests: 0, retried429: 0 };
  const firstByUser = new Map<string, string>();
  let after: string | null = null;
  for (let page = 0; page < USER_MAX_PAGES; page++) {
    const params = new URLSearchParams({ user_id: whopUserId, status: "paid", first: String(PAGE_SIZE) });
    if (after) params.set("after", after);
    const got = await readPage(`${WHOP_PAYMENTS_URL}?${params}`, apiKey, pace, deadline, deadline);
    if (!got.ok) return failed(got.fail);
    if (hasOtherUser(got.rows, whopUserId)) return failed("filter_ignored");
    addFirstPayments(got.rows, firstByUser, counts);
    if (!got.next) {
      return { firstPaidIso: firstByUser.get(whopUserId) ?? null, kept: counts.kept, seen: counts.seen, error: null };
    }
    after = got.next;
  }
  return failed("too_many_pages");
}

/** An id in either shape a payment carries one: "prod_..." or { id: "prod_..." }. */
function refId(value: unknown): string | null {
  const id = value !== null && typeof value === "object" ? (value as { id?: unknown }).id : value;
  return typeof id === "string" && id.trim() !== "" ? id : null;
}

/** One user's newest real payment, as the coupon check reads it (fetchLatestRealPayment). */
export interface LatestRealPayment {
  paidAt: string;
  /** What the payment charged: `total` under THE RULE, above 0. */
  total: number;
  productId: string | null;
  membershipId: string | null;
  promoCodeId: string | null;
  /** The code's name when the payment carries it (the older shape); null otherwise. */
  promoCode: string | null;
}

export type LatestRealPaymentRead =
  | { ok: true; latest: LatestRealPayment | null; seen: number; kept: number }
  | { ok: false; fail: PaymentReadFail };

/**
 * One user's newest real payment (THE RULE above), newest by paid_at, among
 * the payments for `productIds`: a payment naming another product is left
 * out, one naming none is kept. `latest` is null when there is none. The
 * coupon check's fallback when no renewal price can be read
 * (membership-discount.ts, T-122). The same pinned read as
 * fetchFirstPaymentForUser, GET /api/v1/payments?user_id=<id>&status=paid
 * &first=100, every page, every row's user checked; on the caller's key, its
 * pace (shared with its other Whop reads) and its limits: no request starts
 * after `startBy` and no answer is waited on past `answerBy`.
 */
export async function fetchLatestRealPayment(
  whopUserId: string,
  opts: { apiKey: string; pace: Pace; startBy: number | null; answerBy: number | null; productIds: ReadonlySet<string> },
): Promise<LatestRealPaymentRead> {
  if (!opts.apiKey) return { ok: false, fail: "no_api_key" };
  let latest: LatestRealPayment | null = null;
  let seen = 0;
  let kept = 0;
  let after: string | null = null;
  for (let page = 0; page < USER_MAX_PAGES; page++) {
    const params = new URLSearchParams({ user_id: whopUserId, status: "paid", first: String(PAGE_SIZE) });
    if (after) params.set("after", after);
    const got = await readPage(`${WHOP_PAYMENTS_URL}?${params}`, opts.apiKey, opts.pace, opts.startBy, opts.answerBy);
    if (!got.ok) return { ok: false, fail: got.fail };
    if (hasOtherUser(got.rows, whopUserId)) return { ok: false, fail: "filter_ignored" };
    for (const p of got.rows) {
      seen += 1;
      // A row naming no buyer is nobody's, as in addFirstPayments.
      if (!p.user?.id) continue;
      const judged = judgePayment(p);
      if (!judged.keep) continue;
      const productId = refId(p.product_id) ?? refId(p.product);
      if (productId !== null && !opts.productIds.has(productId)) continue;
      kept += 1;
      if (latest && Date.parse(judged.paidAt) <= Date.parse(latest.paidAt)) continue;
      const code = p.promo_code !== null && typeof p.promo_code === "object" ? p.promo_code.code : null;
      latest = {
        paidAt: judged.paidAt,
        total: moneyAmount(p.total),
        productId,
        membershipId: refId(p.membership_id) ?? refId(p.membership),
        promoCodeId: refId(p.promo_code_id) ?? refId(p.promo_code),
        promoCode: typeof code === "string" && code.trim() !== "" ? code.trim() : null,
      };
    }
    if (!got.next) return { ok: true, latest, seen, kept };
    after = got.next;
  }
  return { ok: false, fail: "too_many_pages" };
}

/** The created_after and created_before a lane of a walk sends; null sends none. */
export interface WalkLane {
  after: string | null;
  before: string | null;
}

/**
 * The lanes of a walk. 1: one lane over the whole history. 4: the history cut
 * at WALK_LANE_SPLITS, each stretch widened by LANE_OVERLAP_MS on either side,
 * oldest first.
 */
export function walkLanes(lanes: 1 | 4): WalkLane[] {
  if (lanes === 1) return [{ after: null, before: null }];
  const edges: Array<number | null> = [null, ...WALK_LANE_SPLITS.map((s) => Date.parse(s)), null];
  return edges.slice(1).map((to, i) => {
    const from = edges[i];
    return {
      after: from === null ? null : new Date(from - LANE_OVERLAP_MS).toISOString(),
      before: to === null ? null : new Date(to + LANE_OVERLAP_MS).toISOString(),
    };
  });
}

/** Whether a payment was created inside its lane, both ends counted. A created_at that does not read is not. */
function createdInLane(p: WhopPayment, lane: WalkLane): boolean {
  const iso = toIso(p.created_at ?? null);
  if (!iso) return false;
  const t = Date.parse(iso);
  return (lane.after === null || t >= Date.parse(lane.after)) && (lane.before === null || t <= Date.parse(lane.before));
}

export interface FirstPaymentWalk {
  /** True when the last page of every lane was read. A walk that is not complete must not be written from. */
  complete: boolean;
  stoppedBecause: "done" | PaymentReadFail;
  /** How many lanes read the history side by side: 1 or 4. */
  lanes: number;
  /** Whop user id to the first real payment, ISO. Its keys are Whop ids: never put it in an answer. */
  firstByUser: Map<string, string>;
  /** Pages read. */
  pages: number;
  /** Requests made, retries included. */
  requests: number;
  retried429: number;
  /** How long Whop took to answer the pages read, summed. */
  answerMs: number;
  counts: PaymentCounts;
}

/**
 * Every paid payment of the account, once: GET /api/v1/payments?status=paid
 * &first=100, page after page, grouped by user under the rule. `startBy`: no
 * page starts after it. `answerBy`: a page still unanswered then is given up.
 * Either ends the walk incomplete. `lanes`: 1 (the default), or 4, which
 * reads the stretches of walkLanes(4) side by side, each with its
 * created_after and created_before, inside the same 4 requests a second. A
 * lane given a payment created outside its stretch ends the walk as
 * filter_ignored: Whop did not apply the dates, and the lanes would not add
 * up to the account.
 */
export async function walkFirstPayments(
  opts: { startBy?: number; answerBy?: number; lanes?: 1 | 4 } = {},
): Promise<FirstPaymentWalk> {
  const counts = noPaymentCounts();
  const firstByUser = new Map<string, string>();
  const pace: Pace = { nextAt: 0, requests: 0, retried429: 0 };
  const lanes = walkLanes(opts.lanes ?? 1);
  // Shared by the lanes: an object, so each lane reads what another wrote.
  const walk = { pages: 0, answerMs: 0, stopped: null as PaymentReadFail | null };
  const end = (stoppedBecause: "done" | PaymentReadFail): FirstPaymentWalk => ({
    complete: stoppedBecause === "done",
    stoppedBecause,
    lanes: lanes.length,
    firstByUser,
    pages: walk.pages,
    requests: pace.requests,
    retried429: pace.retried429,
    answerMs: walk.answerMs,
    counts,
  });
  const apiKey = process.env.WHOP_API_KEY;
  if (!apiKey) return end("no_api_key");
  /** Payment ids already counted: one at a split is read by two lanes. */
  const counted = new Set<string>();

  const walkLane = async (lane: WalkLane): Promise<void> => {
    const cursorsSeen = new Set<string>();
    let after: string | null = null;
    for (;;) {
      // Another lane failed: the walk is incomplete whatever this one reads.
      if (walk.stopped) return;
      if (walk.pages >= WALK_MAX_PAGES) {
        walk.stopped = "too_many_pages";
        return;
      }
      const params = new URLSearchParams({ status: "paid", first: String(PAGE_SIZE) });
      if (lane.after) params.set("created_after", lane.after);
      if (lane.before) params.set("created_before", lane.before);
      if (after) params.set("after", after);
      const got = await readPage(`${WHOP_PAYMENTS_URL}?${params}`, apiKey, pace, opts.startBy ?? null, opts.answerBy ?? null);
      if (walk.stopped) return;
      if (!got.ok) {
        walk.stopped = got.fail;
        return;
      }
      if (lanes.length > 1 && !got.rows.every((p) => createdInLane(p, lane))) {
        walk.stopped = "filter_ignored";
        return;
      }
      walk.pages += 1;
      walk.answerMs += got.answerMs;
      const fresh = got.rows.filter((p) => !p.id || !counted.has(p.id));
      for (const p of fresh) if (p.id) counted.add(p.id);
      addFirstPayments(fresh, firstByUser, counts);
      if (!got.next) return;
      // A cursor Whop already gave would read the same pages again, for ever.
      if (cursorsSeen.has(got.next)) {
        walk.stopped = "bad_page";
        return;
      }
      cursorsSeen.add(got.next);
      after = got.next;
    }
  };
  await Promise.all(lanes.map(walkLane));
  return end(walk.stopped ?? "done");
}
