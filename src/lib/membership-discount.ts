/**
 * A discount already on a student's next Whop renewal (admin rebuild 2, D5).
 *
 * THE RULE. A student whose current Whop membership has a promo code that
 * still applies to the next renewal cannot get the 30%. Whop says so on the
 * membership itself, read from v1 with Api-Version-Date pinned to
 * 2026-10-15-1: `renewal_price` is "what the next renewal charges, after any
 * promo code that still applies", so the membership is discounted when it
 * carries a promo code (`promo_code_id`) and its `renewal_price` is below its
 * plan's renewal price. The promo id alone is not enough: a membership keeps
 * the id after a one-month code is used up and then renews at full price
 * (the live probe of 2026-10-20: 165 live memberships on the forever 10%
 * "evolve10" renew at 87.30 on the 97.00 plan; a used ECOM30 and a used
 * one-month 50% code both renew at 97.00). The lower price alone is not
 * enough either: a member kept on an older, lower price after the plan's
 * price went up has no code on the membership, and is not "a discount
 * applied to your account". Prices are compared in cents.
 *
 * THE READS, all pinned, paced at 4 requests a second start to start, a 429
 * waited out (Whop's "Try again in N seconds", or 15 s, at most 30) and
 * retried twice, as first-payment.ts reads payments:
 *   GET /api/v1/memberships/{id}   promo_code_id, renewal_price, plan_id
 *   GET /api/v1/plans/{id}         the plan's renewal_price, once per plan
 *                                  per run (the cache)
 *   GET /api/v1/promo_codes/{id}   the code's name (`code`), once per code
 *                                  per run; a failed name read leaves the
 *                                  name out and nothing else
 * Every field is read in either shape Whop has used: a price as "87.30", a
 * number or { amount }, an id as a string or { id }.
 *
 * WHERE IT IS STORED. student_membership_discounts (migration v111), one row
 * per student, written by the service role only:
 *   - the cron route /api/cron/refresh-membership-discounts every 2 hours
 *     (refreshMembershipDiscounts below), for the students whose 30% window
 *     is still open (discountWindowOpen: a first payment from
 *     DISCOUNT_ELIGIBLE_FROM and a deadline not past), active or past_due,
 *     and every student holding a pending request whatever their window or
 *     membership, all with no approved or applied request. The window since
 *     the render review's fix round (until then every student who first paid
 *     from 1 October, a list that grew with each new student while their
 *     windows closed); the pending requests since its second round (the
 *     first left them out once their window closed, and a stale answer then
 *     held the 30% page's row to Reject);
 *   - the request routes and the approve route, after a live read
 *     (checkMembershipDiscount below), so the map and the admin page catch
 *     up at their next read;
 *   - "Check Whop again" on the 30% page (POST
 *     /api/admin/thirty/check-coupon), the same live read for one student
 *     whose pending request the stored row refuses.
 * A stored row counts only for the membership it was read from: a student
 * who moved to another membership since has no stored answer.
 *
 * WHO READS IT. The request routes and the approve route check live, then
 * fall back to the stored row, then let the request through
 * (checkMembershipDiscount). The map reads the stored flag through
 * /api/student/data. The admin's 30% page reads the stored rows.
 *
 * No answer names a student, an email or a Whop id: student ids only. A
 * failure comes back as a kind, never as Whop's words.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { discountWindowOpen, earliestOpenFirstPayment } from "@/lib/world/discount";
import { fetchAllRowsPaginated } from "@/lib/supabase-pagination";
import { waitAfter429Ms } from "@/lib/first-payment";

export const WHOP_API_V1 = "https://api.whop.com/api/v1";
/** The membership shape with promo_code_id and renewal_price. Plans and promo codes are read with the same pin. */
export const WHOP_DISCOUNT_VERSION = "2026-10-15-1";
export const MEMBERSHIP_DISCOUNTS_TABLE = "student_membership_discounts";
export const MEMBERSHIP_DISCOUNT_COLUMNS =
  "student_id, whop_membership_id, promo_code_id, promo_code, renewal_price, plan_renewal_price, discounted, checked_at";

/** 4 Whop requests a second, start to start, as the payment reads: the logins share the key. */
const WHOP_GAP_MS = 250;
const RETRIES_AFTER_429 = 2;
/** A request route waits this long for Whop at most before it uses the stored row. */
const ROUTE_START_BUDGET_MS = 6_000;
const ROUTE_ANSWER_BUDGET_MS = 8_000;
/** The cron: no Whop request starts after 240 s, none is waited on past 285 s (maxDuration is 300). */
export const REFRESH_START_BUDGET_MS = 240_000;
export const REFRESH_ANSWER_BUDGET_MS = 285_000;
/** The cron writes its rows this many at a time, so a run that stops early keeps what it read. */
const WRITE_CHUNK = 25;
const BATCH = 100;

/** One row of student_membership_discounts. Prices in dollars, as Whop gives them. */
export interface MembershipDiscountRow {
  student_id: string;
  whop_membership_id: string | null;
  promo_code_id: string | null;
  /** The code's name ("evolve10"); null when there is no code or its name could not be read. */
  promo_code: string | null;
  renewal_price: number | null;
  plan_renewal_price: number | null;
  discounted: boolean;
  checked_at: string;
}

/** Why a membership read gave no answer. The caller writes nothing for that student then. */
export type MembershipReadFail =
  | "no_api_key"
  | "not_a_membership"
  | "not_found"
  | "rate_limited"
  | "time_budget"
  | "http_401_403"
  | "http_other"
  | "network"
  | "bad_shape"
  | "no_plan_price";

export interface MembershipDiscount {
  whopMembershipId: string;
  promoCodeId: string | null;
  promoCode: string | null;
  renewalPrice: number;
  planRenewalPrice: number;
  discounted: boolean;
}

export type MembershipRead = { ok: true; membership: MembershipDiscount } | { ok: false; fail: MembershipReadFail };

/** The requests one run has made and when the next may start, shared by every read of the run. */
export interface WhopPace {
  nextAt: number;
  requests: number;
  retried429: number;
}

type PlanAnswer = { ok: true; price: number } | { ok: false; fail: MembershipReadFail };

/**
 * What one run of reads shares: the key, the pace, the plans' prices and the
 * codes' names already read, and the time limits. `startBy`: no request
 * starts after it. `answerBy`: an answer still missing then is given up.
 * null for no limit.
 */
export interface WhopReadContext {
  apiKey: string;
  pace: WhopPace;
  plans: Map<string, PlanAnswer>;
  promoNames: Map<string, string | null>;
  startBy: number | null;
  answerBy: number | null;
}

export function newReadContext(apiKey: string, startBy: number | null = null, answerBy: number | null = null): WhopReadContext {
  return {
    apiKey,
    pace: { nextAt: 0, requests: 0, retried429: 0 },
    plans: new Map(),
    promoNames: new Map(),
    startBy,
    answerBy,
  };
}

/** A price in either shape ("87.30", 87.3, { amount: "87.30" }), or null when it does not read. */
export function priceOf(value: unknown): number | null {
  const raw = value !== null && typeof value === "object" ? (value as { amount?: unknown }).amount : value;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** An id in either shape ("promo_..." or { id: "promo_..." }), or null. */
export function idOf(value: unknown): string | null {
  if (typeof value === "string") return value.trim() !== "" ? value : null;
  if (value !== null && typeof value === "object") {
    const id = (value as { id?: unknown }).id;
    return typeof id === "string" && id.trim() !== "" ? id : null;
  }
  return null;
}

const cents = (dollars: number) => Math.round(dollars * 100);

/** THE RULE (the header): a code on the membership, and a next renewal below the plan's renewal price. */
export function isDiscounted(promoCodeId: string | null, renewalPrice: number, planRenewalPrice: number): boolean {
  return promoCodeId !== null && cents(renewalPrice) < cents(planRenewalPrice);
}

/** A stored row counts only for the membership it was read from (the header). */
export function storedRowApplies(
  row: Pick<MembershipDiscountRow, "whop_membership_id"> | null | undefined,
  currentMembershipId: string | null | undefined,
): boolean {
  return !!row && !!row.whop_membership_id && row.whop_membership_id === currentMembershipId;
}

/** A Whop membership id the v1 read takes. The webhook has been seen to store a payment's id here. */
export function isMembershipId(id: string | null | undefined): id is string {
  return typeof id === "string" && /^mem_\w+$/.test(id);
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

type GetAnswer = { ok: true; body: Record<string, unknown> } | { ok: false; fail: MembershipReadFail };

/** One pinned GET of one object: paced, a 429 waited out and retried twice, inside the context's limits. */
async function whopGet(path: string, ctx: WhopReadContext): Promise<GetAnswer> {
  const url = `${WHOP_API_V1}${path}`;
  const init: RequestInit = {
    headers: {
      Authorization: `Bearer ${ctx.apiKey}`,
      "Api-Version-Date": WHOP_DISCOUNT_VERSION,
      Accept: "application/json",
    },
  };
  for (let attempt = 0; ; attempt++) {
    const at = Math.max(Date.now(), ctx.pace.nextAt);
    if (ctx.startBy !== null && at > ctx.startBy) return { ok: false, fail: "time_budget" };
    ctx.pace.nextAt = at + WHOP_GAP_MS;
    if (at > Date.now()) await sleep(at - Date.now());
    ctx.pace.requests += 1;
    let res: Response | typeof TIMED_OUT;
    try {
      res = ctx.answerBy === null ? await fetch(url, init) : await fetchBefore(url, init, ctx.answerBy);
    } catch {
      return { ok: false, fail: "network" };
    }
    if (res === TIMED_OUT) return { ok: false, fail: "time_budget" };
    if (res.status === 429) {
      const body = await res.text().catch(() => "");
      if (attempt >= RETRIES_AFTER_429) return { ok: false, fail: "rate_limited" };
      const waitMs = waitAfter429Ms(body, res.headers.get("retry-after"));
      if (ctx.startBy !== null && Date.now() + waitMs > ctx.startBy) return { ok: false, fail: "time_budget" };
      ctx.pace.retried429 += 1;
      // The limit is the key's, so every read of the run waits it out.
      ctx.pace.nextAt = Math.max(ctx.pace.nextAt, Date.now() + waitMs);
      continue;
    }
    if (res.status === 404) return { ok: false, fail: "not_found" };
    if (res.status === 401 || res.status === 403) return { ok: false, fail: "http_401_403" };
    if (!res.ok) return { ok: false, fail: "http_other" };
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { ok: false, fail: "bad_shape" };
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, fail: "bad_shape" };
    return { ok: true, body: body as Record<string, unknown> };
  }
}

/** The plan's renewal price, read once per plan per run. Only an answer is kept: a failed read is tried again for the next member. */
async function planRenewalPrice(planId: string, ctx: WhopReadContext): Promise<PlanAnswer> {
  const had = ctx.plans.get(planId);
  if (had) return had;
  const r = await whopGet(`/plans/${encodeURIComponent(planId)}`, ctx);
  let answer: PlanAnswer;
  if (r.ok) {
    const price = priceOf(r.body.renewal_price);
    answer = price === null ? { ok: false, fail: "no_plan_price" } : { ok: true, price };
  } else {
    answer = { ok: false, fail: r.fail === "not_found" ? "no_plan_price" : r.fail };
  }
  if (answer.ok || answer.fail === "no_plan_price") ctx.plans.set(planId, answer);
  return answer;
}

/** The code's name, read once per code per run; null when it cannot be read (it is shown, never judged). */
async function promoCodeName(promoCodeId: string, ctx: WhopReadContext): Promise<string | null> {
  if (ctx.promoNames.has(promoCodeId)) return ctx.promoNames.get(promoCodeId) ?? null;
  const r = await whopGet(`/promo_codes/${encodeURIComponent(promoCodeId)}`, ctx);
  if (!r.ok) {
    if (r.fail === "not_found") ctx.promoNames.set(promoCodeId, null);
    return null;
  }
  const name = typeof r.body.code === "string" && r.body.code.trim() !== "" ? r.body.code.trim() : null;
  ctx.promoNames.set(promoCodeId, name);
  return name;
}

/** One membership, as THE RULE reads it (the header). */
export async function readMembershipDiscount(membershipId: string, ctx: WhopReadContext): Promise<MembershipRead> {
  if (!ctx.apiKey) return { ok: false, fail: "no_api_key" };
  if (!isMembershipId(membershipId)) return { ok: false, fail: "not_a_membership" };
  const m = await whopGet(`/memberships/${encodeURIComponent(membershipId)}`, ctx);
  if (!m.ok) return m;
  // The pinned shape names the code promo_code_id; the key's own older shape, promo_code: { id }.
  const promoCodeId = idOf(m.body.promo_code_id) ?? idOf(m.body.promo_code);
  const planId = idOf(m.body.plan_id) ?? idOf(m.body.plan);
  const renewalPrice = priceOf(m.body.renewal_price);
  if (!planId || renewalPrice === null) return { ok: false, fail: "bad_shape" };
  const plan = await planRenewalPrice(planId, ctx);
  if (!plan.ok) return plan;
  const promoCode = promoCodeId ? await promoCodeName(promoCodeId, ctx) : null;
  return {
    ok: true,
    membership: {
      whopMembershipId: membershipId,
      promoCodeId,
      promoCode,
      renewalPrice,
      planRenewalPrice: plan.price,
      discounted: isDiscounted(promoCodeId, renewalPrice, plan.price),
    },
  };
}

/** The stored row for a student's membership as read now. */
export function rowOf(studentId: string, m: MembershipDiscount, checkedAt: string): MembershipDiscountRow {
  return {
    student_id: studentId,
    whop_membership_id: m.whopMembershipId,
    promo_code_id: m.promoCodeId,
    promo_code: m.promoCode,
    renewal_price: m.renewalPrice,
    plan_renewal_price: m.planRenewalPrice,
    discounted: m.discounted,
    checked_at: checkedAt,
  };
}

/** The code as a sentence names it: its name, or its Whop promo id when the name could not be read. */
export function codeOf(row: { promo_code?: string | null; promo_code_id?: string | null } | null | undefined): string | null {
  return row?.promo_code ?? row?.promo_code_id ?? null;
}

export interface CouponCheck {
  /** A discount is on the next renewal: no 30%. */
  discounted: boolean;
  /** The code (codeOf), when there is one. */
  code: string | null;
  /** live: Whop answered now. stored: the stored row for this membership. none: neither, so nothing blocks. */
  source: "live" | "stored" | "none";
  /** Why Whop gave no answer now, for the route's log line; null when it did. */
  liveFail: MembershipReadFail | "no_membership" | "student_unread" | null;
  /**
   * Whop's answer now was written to student_membership_discounts. False
   * whenever `source` is not live, and for a live answer whose write failed
   * (logged): "Check Whop again" says so, since its list would still show
   * the old row (the render review's second round).
   */
  saved: boolean;
}

/**
 * The request routes, the approve route (D5) and "Check Whop again": Whop
 * now, then the stored row for this membership, then nothing (the request
 * goes through). A live answer is stored, best effort, so the map and the
 * admin page catch up. Never throws. `apiKey` defaults to WHOP_API_KEY;
 * without one there is no live read.
 */
export async function checkMembershipDiscount(
  db: SupabaseClient,
  studentId: string,
  opts: { apiKey?: string | null } = {},
): Promise<CouponCheck> {
  const apiKey = opts.apiKey === undefined ? (process.env.WHOP_API_KEY ?? null) : opts.apiKey;
  let membershipId: string | null | undefined;
  try {
    const { data, error } = await db.from("students").select("whop_membership_id").eq("id", studentId).maybeSingle();
    membershipId = error ? undefined : ((data as { whop_membership_id?: string | null } | null)?.whop_membership_id ?? null);
  } catch {
    membershipId = undefined;
  }

  let liveFail: CouponCheck["liveFail"] = null;
  if (membershipId === undefined) liveFail = "student_unread";
  else if (!membershipId) liveFail = "no_membership";
  else if (!apiKey) liveFail = "no_api_key";
  else {
    const started = Date.now();
    const ctx = newReadContext(apiKey, started + ROUTE_START_BUDGET_MS, started + ROUTE_ANSWER_BUDGET_MS);
    const live = await readMembershipDiscount(membershipId, ctx);
    if (live.ok) {
      let saved = false;
      try {
        const { error } = await db
          .from(MEMBERSHIP_DISCOUNTS_TABLE)
          .upsert(rowOf(studentId, live.membership, new Date().toISOString()), { onConflict: "student_id" });
        if (error) console.error(`[membership discount] student ${studentId}: the live answer was not stored: ${error.message}`);
        else saved = true;
      } catch (e) {
        console.error(`[membership discount] student ${studentId}: the live answer was not stored: ${e instanceof Error ? e.message : String(e)}`);
      }
      return {
        discounted: live.membership.discounted,
        code: live.membership.promoCode ?? live.membership.promoCodeId,
        source: "live",
        liveFail: null,
        saved,
      };
    }
    liveFail = live.fail;
  }

  // The stored row, when it was read from the membership the student has now (or when that could not be read).
  let answer: CouponCheck = { discounted: false, code: null, source: "none", liveFail, saved: false };
  try {
    const { data, error } = await db
      .from(MEMBERSHIP_DISCOUNTS_TABLE)
      .select("whop_membership_id, promo_code_id, promo_code, discounted")
      .eq("student_id", studentId)
      .maybeSingle();
    const row = error ? null : (data as Pick<MembershipDiscountRow, "whop_membership_id" | "promo_code_id" | "promo_code" | "discounted"> | null);
    if (row && (membershipId === undefined || storedRowApplies(row, membershipId))) {
      answer = { discounted: row.discounted === true, code: codeOf(row), source: "stored", liveFail, saved: false };
    }
  } catch {
    // No stored answer: nothing blocks (the PRD's fallback).
  }
  // A Whop read that was tried and gave no answer is worth a line, and so is a
  // stored Whop id that is not a membership's (the webhook has stored a
  // payment's id there): Whop is never asked then, nothing is stored for it,
  // and nothing blocks, so without this line the request goes through
  // unseen. With no key or no membership there was nothing to try.
  if (liveFail === "not_a_membership") {
    console.warn(
      `[membership discount] student ${studentId}: the stored Whop id is not a membership id, so Whop was not asked and ${answer.source === "stored" ? "the stored row decides" : "nothing blocks"}`,
    );
  } else if (liveFail !== null && liveFail !== "no_membership" && liveFail !== "no_api_key" && liveFail !== "student_unread") {
    console.warn(
      `[membership discount] student ${studentId}: Whop gave no answer (${liveFail}), so ${answer.source === "stored" ? "the stored row decides" : "nothing blocks"}`,
    );
  }
  return answer;
}

export type RefreshMode = "write" | "dry";

export interface RefreshAnswer {
  ok: boolean;
  mode: RefreshMode;
  run_started_at: string;
  /** Students whose 30% window is still open (discountWindowOpen at the run's start), active or past_due. */
  in_window: number;
  /**
   * Students holding a pending request, read whatever their window or
   * membership (some are in `in_window` too): the 30% page's Applied rows,
   * so a stale stored answer heals by itself.
   */
  pending_requests: number;
  /** Left out: an approved or applied request. */
  have_the_30: number;
  /** The students this run had to check. */
  candidates: number;
  /** Read from Whop this run. */
  checked: number;
  discounted: number;
  /** Rows written (0 on a dry run). */
  written: number;
  /** No membership id, or one that is not a membership's. */
  skipped: { no_membership: number; not_a_membership: number };
  /** Reads that gave no answer, by kind. The stored row stays as it was. */
  failed: Partial<Record<MembershipReadFail, number>>;
  /** Not reached before the time ran out: the next run starts with them. */
  left: number;
  whop_requests: number;
  retried_429: number;
  ms: number;
  /** When the run could not start or could not write: what failed. */
  error?: string;
}

/**
 * The cron's run (GET /api/cron/refresh-membership-discounts): every student
 * whose 30% window is still open at the run's start (discountWindowOpen),
 * active or past_due, and every student holding a pending request, whatever
 * their window or membership; of those, the ones with no approved or applied
 * request; those never checked first, then the longest unchecked; each read
 * live and stored, 25 rows at a time. A student whose window has closed can
 * make no request, so is read again only while a request of theirs waits:
 * the 30% page judges that row by the stored answer, and a row whose answer
 * says a discount is on the renewal offers only Reject, so the approve
 * route's own live read never runs for it (the render review's second
 * round). "dry" reads and writes nothing. A run that cannot read who is in
 * the window or who holds a pending request, or whose every read failed,
 * answers ok: false.
 */
export async function refreshMembershipDiscounts(
  db: SupabaseClient,
  opts: { mode: RefreshMode; startedAtMs: number; apiKey: string },
): Promise<RefreshAnswer> {
  const { mode, startedAtMs, apiKey } = opts;
  const answer: RefreshAnswer = {
    ok: false,
    mode,
    run_started_at: new Date(startedAtMs).toISOString(),
    in_window: 0,
    pending_requests: 0,
    have_the_30: 0,
    candidates: 0,
    checked: 0,
    discounted: 0,
    written: 0,
    skipped: { no_membership: 0, not_a_membership: 0 },
    failed: {},
    left: 0,
    whop_requests: 0,
    retried_429: 0,
    ms: 0,
  };
  const done = (more: Partial<RefreshAnswer> = {}): RefreshAnswer => ({ ...answer, ...more, ms: Date.now() - startedAtMs });

  type Member = { id: string; whop_membership_id: string | null; first_paid_at: string | null };
  // The read starts at the earliest first payment whose window can still be open, so it stays as short as the
  // window; the window's own rule (discount.ts) then decides each student it holds.
  const inWindow = await fetchAllRowsPaginated<Member>(() =>
    db
      .from("students")
      .select("id, whop_membership_id, first_paid_at")
      .gte("first_paid_at", earliestOpenFirstPayment(startedAtMs))
      .in("membership_status", ["active", "past_due"])
      .order("id"),
  );
  if (inWindow.error) return done({ error: `students: ${inWindow.error.message}` });
  const byId = new Map(
    inWindow.data.filter((s) => discountWindowOpen(s.first_paid_at, startedAtMs)).map((s) => [s.id, s] as const),
  );
  answer.in_window = byId.size;

  // Every student holding a pending request, whatever their window or membership: the 30% page judges their
  // row by the stored answer, so a stale one (a code taken off the membership in Whop since) heals here
  // instead of holding the row to Reject. They are few.
  const pendingRead = await fetchAllRowsPaginated<{ student_id: string }>(() =>
    db.from("discount_requests").select("student_id").eq("status", "pending").order("id"),
  );
  if (pendingRead.error) return done({ error: `discount_requests (pending): ${pendingRead.error.message}` });
  const pendingIds = [...new Set(pendingRead.data.map((r) => r.student_id))];
  const outside = pendingIds.filter((id) => !byId.has(id)).sort();
  for (let i = 0; i < outside.length; i += BATCH) {
    const batch = outside.slice(i, i + BATCH);
    const r = await fetchAllRowsPaginated<Member>(() =>
      db.from("students").select("id, whop_membership_id, first_paid_at").in("id", batch).order("id"),
    );
    if (r.error) return done({ error: `students (holding a pending request): ${r.error.message}` });
    for (const s of r.data) byId.set(s.id, s);
  }
  answer.pending_requests = pendingIds.filter((id) => byId.has(id)).length;
  const members = [...byId.values()];

  const ids = members.map((m) => m.id);
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += BATCH) batches.push(ids.slice(i, i + BATCH));

  // Who has the 30% already: their membership carries the team's code, so the rule has nothing to say.
  const held = new Set<string>();
  for (const batch of batches) {
    const r = await fetchAllRowsPaginated<{ student_id: string }>(() =>
      db.from("discount_requests").select("student_id").in("student_id", batch).in("status", ["approved", "applied"]).order("id"),
    );
    if (r.error) return done({ error: `discount_requests: ${r.error.message}` });
    for (const row of r.data) held.add(row.student_id);
  }
  answer.have_the_30 = members.filter((m) => held.has(m.id)).length;

  // When each was last checked: never first, then the oldest. A failed read only loses the order.
  const lastChecked = new Map<string, string>();
  for (const batch of batches) {
    const r = await fetchAllRowsPaginated<{ student_id: string; checked_at: string }>(() =>
      db.from(MEMBERSHIP_DISCOUNTS_TABLE).select("student_id, checked_at").in("student_id", batch).order("student_id"),
    );
    if (r.error) {
      console.error(`[membership discounts] the stored rows could not be read, so the order is by id: ${r.error.message}`);
      break;
    }
    for (const row of r.data) lastChecked.set(row.student_id, row.checked_at);
  }
  const at = (id: string) => {
    const t = Date.parse(lastChecked.get(id) ?? "");
    return Number.isFinite(t) ? t : -Infinity;
  };
  const candidates = members
    .filter((m) => !held.has(m.id))
    .sort((a, b) => at(a.id) - at(b.id) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  answer.candidates = candidates.length;

  const ctx = newReadContext(apiKey, startedAtMs + REFRESH_START_BUDGET_MS, startedAtMs + REFRESH_ANSWER_BUDGET_MS);
  let pending: MembershipDiscountRow[] = [];
  let writeError: string | null = null;
  const flush = async () => {
    if (pending.length === 0 || mode === "dry" || writeError) {
      pending = [];
      return;
    }
    const rows = pending;
    pending = [];
    const { error } = await db.from(MEMBERSHIP_DISCOUNTS_TABLE).upsert(rows, { onConflict: "student_id" });
    if (error) writeError = `${MEMBERSHIP_DISCOUNTS_TABLE}: ${error.message}`;
    else answer.written += rows.length;
  };

  for (let i = 0; i < candidates.length; i++) {
    const m = candidates[i];
    if (!m.whop_membership_id) {
      answer.skipped.no_membership++;
      continue;
    }
    if (!isMembershipId(m.whop_membership_id)) {
      answer.skipped.not_a_membership++;
      continue;
    }
    const r = await readMembershipDiscount(m.whop_membership_id, ctx);
    if (!r.ok) {
      if (r.fail === "time_budget") {
        answer.left = candidates.length - i;
        break;
      }
      answer.failed[r.fail] = (answer.failed[r.fail] ?? 0) + 1;
      continue;
    }
    answer.checked++;
    if (r.membership.discounted) answer.discounted++;
    pending.push(rowOf(m.id, r.membership, new Date().toISOString()));
    if (pending.length >= WRITE_CHUNK) await flush();
    if (writeError) break;
  }
  await flush();

  answer.whop_requests = ctx.pace.requests;
  answer.retried_429 = ctx.pace.retried429;
  const failedReads = Object.values(answer.failed).reduce((s, n) => s + (n ?? 0), 0);
  if (writeError) return done({ error: writeError });
  // Every read failed: the shape or the key is wrong, and a run that wrote nothing must say so out loud.
  const allFailed = answer.checked === 0 && failedReads > 0;
  // Whop answered nothing before the time ran out (it hangs): no read failed, none was checked, every candidate is left.
  // That run read nothing either, so it says so too (the review's fix round: it answered ok).
  const stalled = answer.checked === 0 && answer.left > 0;
  if (stalled && !allFailed) return done({ ok: false, error: "Whop answered no membership read before the time ran out, so nothing was checked. The next run tries again." });
  return done({ ok: !allFailed });
}
