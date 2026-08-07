/**
 * Canonical predicates for admin metrics.
 *
 * Every admin surface that asks "is this student active?" or "is this
 * student in the launch cohort?" goes through these helpers. Lifts
 * the definitions out of inline `.eq()` / `.filter()` calls scattered
 * across the dashboard, students list, insights, and snapshot cron.
 *
 * Background: before v75.13 each surface had its own inline filter
 *   - Snapshot cron: `membership_status = 'active'`
 *   - Dashboard students fetch: `IN ('active', 'past_due', 'canceled')`
 *   - Dashboard activeStudents.filter: `=== 'active'`
 *   - /admin/students fetch: `IN ('active', 'past_due', 'canceled')`
 * which silently produced three different "active" counts. v75.12 had
 * already split `past_due` out of `canceled` at the Whop layer; this
 * file finishes the job by making the consumer-side definition equally
 * canonical.
 */

import {
  ADMIN_STUDENT_JOIN_CUTOFF,
  PAYING_WHOP_PLAN_IDS,
} from "@/lib/constants";

/**
 * The set of membership_status values that mean "this user currently
 * has access to the platform." Past-due is included because Whop
 * still serves content to past-due users during the payment-retry
 * grace window — they are functionally active members.
 */
export const ACTIVE_STATUSES = ["active", "past_due"] as const;
export type ActiveStatus = (typeof ACTIVE_STATUSES)[number];

/**
 * Statuses we surface in the admin /admin/students list. Includes
 * canceled because the team needs to see canceled students for
 * follow-up / re-engagement decisions. Excludes 'expired' which is
 * a hard end-of-life state.
 */
export const VISIBLE_STATUSES = ["active", "past_due", "canceled"] as const;
export type VisibleStatus = (typeof VISIBLE_STATUSES)[number];

interface StudentLike {
  membership_status?: string | null;
  joined_at?: string | null;
  /** v75.18: original Whop signup date, never moves on renewal.
   *  Used for cohort filtering instead of joined_at (which is
   *  current cycle start and moves on each renewal). */
  first_paid_at?: string | null;
  /** v75.38: needed for isMonth2Converted (NULL = never canceled,
   *  set = transition timestamp). */
  canceled_at?: string | null;
  /** v75.47: Whop "Canceling" state — student clicked cancel but
   *  still has access until end of cycle. Set by the sync runner
   *  from WhopMembershipRow.cancel_at_period_end. */
  cancel_scheduled_at?: string | null;
  whop_plan_id?: string | null;
}

/** True iff the student currently has platform access. */
export function isActiveMember(s: StudentLike): boolean {
  return (ACTIVE_STATUSES as readonly string[]).includes(
    s.membership_status ?? "",
  );
}

/**
 * True iff the student is an active paying customer (active or
 * past_due AND on a plan in the PAYING_WHOP_PLAN_IDS allowlist).
 *
 * Used by every operational surface — CSM crons, dashboard counts,
 * students list, snapshot cron. Free-plan members are isActiveMember
 * but NOT isPayingMember; they keep platform access but stay invisible
 * to admin / outreach.
 *
 * v79 added the plan_id check. Before v79, the operational surfaces
 * used isActiveMember and free-plan users were leaking into
 * everything (CSM tasks were getting generated for them, etc).
 */
export function isPayingMember(s: StudentLike): boolean {
  if (!isActiveMember(s)) return false;
  return PAYING_WHOP_PLAN_IDS.has(s.whop_plan_id ?? "");
}

/**
 * Array form of the paying-plan allowlist for Supabase `.in()`
 * filters (which can't accept a Set directly). Cached once at module
 * load so we don't re-allocate per query.
 */
export const PAYING_WHOP_PLAN_IDS_ARRAY: readonly string[] = Array.from(
  PAYING_WHOP_PLAN_IDS,
);

/**
 * True iff the student's ORIGINAL Whop signup was on/after launch.
 * v75.18 — was joined_at-based, now first_paid_at-based. Returning
 * customers whose current cycle started after launch but whose first
 * Whop membership was months earlier are correctly excluded.
 *
 * v75.28 — NO joined_at fallback. NULL first_paid_at returns FALSE
 * (out of cohort). This keeps the cron, the rebuild RPC, and the
 * admin .gte("first_paid_at", cutoff) raw filter in lockstep — all
 * three now agree that NULL is excluded. v75.26 ensures every new
 * INSERT path populates first_paid_at; the nightly Whop sync backfills
 * any legacy NULLs within 24h. The fallback only mattered during the
 * v75.18 transition window and now actively causes cron-vs-RPC drift.
 */
export function isInLaunchCohort(s: StudentLike): boolean {
  if (!s.first_paid_at) return false;
  return s.first_paid_at >= ADMIN_STUDENT_JOIN_CUTOFF;
}

/**
 * v75.47: Whop "Canceling" predicate — student clicked cancel but
 * still has access through end of billing cycle. The earliest churn
 * signal Whop emits.
 *
 * True iff cancel_scheduled_at is stamped AND membership is still
 * active/past_due. Once access actually ends, canceled_at takes over
 * and cancel_scheduled_at gets cleared by the sync runner.
 *
 * Used by the journey kanban "Canceling" badge + the M2 helper to
 * count these students as non-converted (they've signaled intent to
 * leave even though they're still technically paying).
 */
export function isCanceling(s: StudentLike): boolean {
  if (!s.cancel_scheduled_at) return false;
  return s.membership_status === "active" || s.membership_status === "past_due";
}

/**
 * v85.8: grace window past the end of the first billing cycle, in ms.
 *
 * WHY THIS EXISTS — the bug it closes.
 *
 * `canceled_at` does NOT record when a student decided to quit. Every
 * writer in this repo stamps when ACCESS ENDED, or when we happened to
 * observe it: the sync's terminal transition stamps now()
 * (whop-sync-runner.ts:231), the membership.deactivated webhook stamps
 * now(), and the historical backfill uses Whop's renewal_period_end —
 * documented at whop-members.ts:85-88 as "approximately when access
 * ended (the end of the last paid billing cycle)". The sync runner
 * concedes it in its own comment at :200-202: "off by up to 30 days
 * from actual decision but it's all we have."
 *
 * On a monthly plan a student who cancels on day 2 still keeps the
 * cycle she already paid for, so her access ends on the calendar
 * anniversary of first_paid_at — never earlier. The old test was
 * `canceled_at > first_paid_at + 30d`, which is therefore TRUE for
 * every ordinary non-renewal. The KPI was a tautology: it asked "did
 * your first paid month finish?" and printed ~98% while real month-2
 * retention was ~50%. (The same predicate produced 98.5% on the legacy
 * population; v75.42 responded by changing WHICH students were
 * measured and left this comparison alone, so it came straight back
 * once the launch cohort matured.)
 *
 * The renewal charge fires at cycle end. Access still alive AFTER
 * cycle end + grace can only have been bought by a SECOND payment.
 * The grace absorbs the 30-vs-31-day calendar difference, up to 2h of
 * sync observation lag (vercel.json: 0 * / 2 * * *), and Whop's
 * dunning retries on a failed renewal.
 *
 * CALIBRATED, NOT GUESSED. 2026-08-07 histogram of
 * (canceled_at - first_paid_at) over the launch cohort, n=144:
 *
 *     day  0-27  →  11   (mid-cycle refunds / revocations)
 *     day    30  → 106   ← non-renewers: access ends at cycle end
 *     day 31-34  →   6
 *     day 35-37  →   0   ← the valley. Threshold lives here.
 *     day 38-53  →   5   (failed-renewal dunning tail, ambiguous)
 *     day    60  →  11   ← renewed, then churned in month 2
 *     day 62-68  →   5
 *
 * Textbook bimodal, and days 35/36/37 are literally empty — the
 * 7-day grace lands in a zero-density gap, so small changes to it do
 * not move the number. RE-RUN THE HISTOGRAM before changing this;
 * the constant belongs in the valley, wherever the valley has moved.
 *
 * KNOWN SOFT EDGE: the 5 students at days 38-53 are counted as
 * converted. If Whop's dunning window runs that long they may be
 * failed month-2 charges that never actually paid. Worth at most
 * ~2 points; revisit if the dunning window is ever confirmed.
 */
const RENEWAL_GRACE_MS = 7 * 86_400_000;

/** End of the first paid cycle — the moment the renewal charge fires.
 *  Real cycles end on the calendar anniversary (30 or 31 days); this
 *  flat 30 is the floor, which is exactly why the grace is needed. */
function cycleEndMs(firstPaidAt: string): number {
  return new Date(firstPaidAt).getTime() + 30 * 86_400_000;
}

/** cycleEnd + grace: the point past which surviving access can only be
 *  explained by a second payment. Numerator and denominator BOTH key
 *  off this — they must never diverge. */
function renewalResolvedMs(firstPaidAt: string): number {
  return cycleEndMs(firstPaidAt) + RENEWAL_GRACE_MS;
}

/**
 * Month-2 conversion — the platform's north-star retention KPI.
 *
 * WHAT THIS MEASURES: of launch-cohort paying students whose renewal
 * moment has come and gone, what share still had access after it. It
 * is an access-survival PROXY for "was a second payment charged" —
 * nothing in this system records payments (no payments / invoices /
 * transactions table in schema.sql), so a second charge can only be
 * inferred from access outliving the cycle boundary. See the
 * RENEWAL_GRACE_MS note above for why the naive version was broken.
 *
 * A student is "Month-2 converted as of `asOfMs`" iff:
 *   1. They are in the resolved cohort (isInMonth2Cohort — launch
 *      cohort, paying plan, past cycle-end + grace)
 *   2. They did not schedule cancellation on or before cycle end
 *   3. EITHER they still have access (canceled_at IS NULL — only a
 *      second payment can explain that this far out)
 *      OR their access ended after cycle end + grace (they renewed,
 *      then churned later — day-60 cluster in the histogram).
 *
 * 2026-06-11: zero launch-cohort students had hit day 30 yet (earliest
 * was 2026-06-24), so the metric correctly read 0/0 → "—". That note
 * then masked a real bug for two months — the dashboard kept showing
 * "—" well into month 3 because the denominator was calling
 * isInMonth2Cohort bare inside .filter() (index landed in `asOfMs`).
 * If this reads "—" again, check the CALL SITE before assuming the
 * cohort is genuinely empty.
 *
 * NOTE ON ARITY: both helpers take an optional second arg. Never pass
 * them directly to .filter()/.map()/.some() — always wrap in an arrow.
 *
 * Pair with isInMonth2Cohort() for the denominator. The conversion
 * rate is: |students filter isMonth2Converted| / |students filter
 * isInMonth2Cohort|.
 */
export function isMonth2Converted(
  s: StudentLike,
  asOfMs: number = Date.now(),
): boolean {
  if (!s.first_paid_at) return false;
  // v85.8: the numerator is a strict subset of the denominator, so it
  // reuses the same gate. Launch cohort, paying plan, and "the renewal
  // moment has resolved" are now defined exactly once — numerator ⊆
  // denominator holds by construction instead of by two copies of the
  // same four checks drifting apart.
  if (!isInMonth2Cohort(s, asOfMs)) return false;

  // Cancellation scheduled on or before the renewal charge → Whop
  // never charged a second time. Belt-and-braces: the sync CLEARS this
  // column at the terminal transition (whop-sync-runner.ts:345), so it
  // only survives the <=2h between the webhook and the next sync tick.
  if (s.cancel_scheduled_at) {
    const scheduledMs = new Date(s.cancel_scheduled_at).getTime();
    if (scheduledMs <= cycleEndMs(s.first_paid_at)) return false;
  }

  // Still has access this far past the renewal point → a second
  // payment landed.
  if (!s.canceled_at) return true;

  // v85.8: compare against cycleEnd + GRACE, not a flat day 30.
  // canceled_at is an access-END stamp and an ordinary non-renewal
  // always ends AT the cycle boundary, so the old `> day30Ms` test
  // passed for all 106 day-30 churners and pinned this KPI at 98%.
  return (
    new Date(s.canceled_at).getTime() > renewalResolvedMs(s.first_paid_at)
  );
}

/**
 * Denominator companion to isMonth2Converted. A student is "in the
 * Month-2 cohort as of `asOfMs`" iff they're in the LAUNCH cohort
 * (first_paid_at >= ADMIN_STUDENT_JOIN_CUTOFF), on a paying plan, and
 * their renewal moment has RESOLVED (cycle end + grace has passed).
 *
 * v75.42: launch-cohort restriction matches isMonth2Converted —
 * keeps the denominator and numerator pulling from the same pool.
 */
export function isInMonth2Cohort(
  s: StudentLike,
  asOfMs: number = Date.now(),
): boolean {
  if (!s.first_paid_at) return false;
  if (s.first_paid_at < ADMIN_STUDENT_JOIN_CUTOFF) return false;
  if (
    !s.whop_plan_id ||
    !PAYING_WHOP_PLAN_IDS.has(s.whop_plan_id)
  ) {
    return false;
  }
  // v85.8: was `first_paid_at + 30d <= asOfMs`. A student one day past
  // day 30 has NOT resolved — a canceler and a renewer are
  // indistinguishable until the cycle boundary passes AND the terminal
  // transition is observed. Including them scored them as converted
  // before the renewal charge had even been attempted. Waiting for the
  // grace window costs ~1 week of the newest signups and is what makes
  // the numerator answerable at all.
  return renewalResolvedMs(s.first_paid_at) <= asOfMs;
}

// v75.51: Scope type, DEFAULT_SCOPE, isInScope, parseScope, and
// cohortCutoffOrNull deleted. Every admin surface now uses the
// launch-cohort filter unconditionally via isInLaunchCohort or a
// hardcoded .gte("first_paid_at", ADMIN_STUDENT_JOIN_CUTOFF). No
// toggle, no branching, no scope-aware variants.
