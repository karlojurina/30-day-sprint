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
 * too. At most 4 requests a second, start to start. A 429 is waited out (the
 * seconds Whop names, or 15, at most 30) and retried twice; a third ends the
 * read. The facts behind all of it: _admin/prds/first-paid-fix/ in the
 * workspace (outside this repository).
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
 *     (POST /api/admin/first-paid-repair).
 *
 * Neither writes anything. A failure comes back as a kind, never as Whop's
 * message, so no caller can pass a Whop id on by accident.
 */

import { toIso } from "@/lib/whop-members";

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

/** A money field in either shape: { amount: "97.00", ... } from 2026-09-02-1, or a bare number before it. */
type WhopMoney = { amount?: string | number | null } | number | string | null;

/** The fields of a Whop payment the rule reads, in either shape. */
export interface WhopPayment {
  id?: string;
  status?: string | null;
  substatus?: string | null;
  paid_at?: string | number | null;
  total?: WhopMoney;
  refunded_amount?: WhopMoney;
  user?: { id?: string | null } | null;
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

/** The requests one read has made, and when the next may start. */
interface Pace {
  nextAt: number;
  requests: number;
  retried429: number;
}

type PageRead =
  | { ok: true; rows: WhopPayment[]; next: string | null }
  | { ok: false; fail: PaymentReadFail };

/**
 * One page: paced, a 429 waited out and retried twice. `startBy`: no request
 * starts after it and no 429 wait that would end after it begins.
 * `answerBy`: an answer still missing then is given up. null for no limit.
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
    const wait = Math.max(0, pace.nextAt - Date.now());
    if (startBy !== null && Date.now() + wait > startBy) return { ok: false, fail: "time_budget" };
    if (wait > 0) await sleep(wait);
    pace.nextAt = Date.now() + WHOP_GAP_MS;
    pace.requests += 1;
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
      await sleep(waitMs);
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
    return { ok: true, rows: page.data as WhopPayment[], next: more ? cursor : null };
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

export interface FirstPaymentWalk {
  /** True when the last page was read. A walk that is not complete must not be written from. */
  complete: boolean;
  stoppedBecause: "done" | PaymentReadFail;
  /** Whop user id to the first real payment, ISO. Its keys are Whop ids: never put it in an answer. */
  firstByUser: Map<string, string>;
  /** Pages read. */
  pages: number;
  /** Requests made, retries included. */
  requests: number;
  retried429: number;
  counts: PaymentCounts;
}

/**
 * Every paid payment of the account, once: GET /api/v1/payments?status=paid
 * &first=100, page after page, grouped by user under the rule. `startBy`: no
 * page starts after it. `answerBy`: a page still unanswered then is given up.
 * Either ends the walk incomplete.
 */
export async function walkFirstPayments(
  opts: { startBy?: number; answerBy?: number } = {},
): Promise<FirstPaymentWalk> {
  const counts = noPaymentCounts();
  const firstByUser = new Map<string, string>();
  const pace: Pace = { nextAt: 0, requests: 0, retried429: 0 };
  let pages = 0;
  const end = (stoppedBecause: "done" | PaymentReadFail): FirstPaymentWalk => ({
    complete: stoppedBecause === "done",
    stoppedBecause,
    firstByUser,
    pages,
    requests: pace.requests,
    retried429: pace.retried429,
    counts,
  });
  const apiKey = process.env.WHOP_API_KEY;
  if (!apiKey) return end("no_api_key");
  const cursorsSeen = new Set<string>();
  let after: string | null = null;
  for (let page = 0; page < WALK_MAX_PAGES; page++) {
    const params = new URLSearchParams({ status: "paid", first: String(PAGE_SIZE) });
    if (after) params.set("after", after);
    const got = await readPage(`${WHOP_PAYMENTS_URL}?${params}`, apiKey, pace, opts.startBy ?? null, opts.answerBy ?? null);
    if (!got.ok) return end(got.fail);
    pages += 1;
    addFirstPayments(got.rows, firstByUser, counts);
    if (!got.next) return end("done");
    // A cursor Whop already gave would read the same pages again, for ever.
    if (cursorsSeen.has(got.next)) return end("bad_page");
    cursorsSeen.add(got.next);
    after = got.next;
  }
  return end("too_many_pages");
}
