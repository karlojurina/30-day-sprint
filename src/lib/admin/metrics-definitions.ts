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
 * Scope toggle for admin views. Internal values stay "cohort" / "all"
 * (no UI text relies on these strings; the toggle UI relabels them
 * "New students" and "All members" in v75.15).
 *
 * - "cohort" = students who joined on/after ADMIN_STUDENT_JOIN_CUTOFF
 *              (launch date) — surfaces this as "New students" in UI
 * - "all"    = every paying member regardless of join date — UI label
 *              "All members"
 *
 * v75.15 flipped the default from "cohort" to "all" so churn and
 * legacy customer activity are visible without an explicit toggle —
 * the cohort-only view became misleading once we started counting
 * legacy paying customers in the dataset.
 */
export type Scope = "cohort" | "all";
export const DEFAULT_SCOPE: Scope = "all";

/** True iff the student is in the requested scope. */
export function isInScope(s: StudentLike, scope: Scope): boolean {
  if (scope === "all") return true;
  return isInLaunchCohort(s);
}

/**
 * Parse the scope from URL search params. Anything other than "all"
 * resolves to the default ("cohort") so an unrecognized value
 * doesn't silently widen the dataset.
 */
export function parseScope(value: string | null | undefined): Scope {
  return value === "all" ? "all" : "cohort";
}

/**
 * The ISO cutoff string Supabase queries should use to filter by
 * cohort, or null for "no filter" (all-scope). Returning null lets
 * callers conditionally apply `.gte()` without branching on the
 * scope value in every query site.
 */
export function cohortCutoffOrNull(scope: Scope): string | null {
  return scope === "cohort" ? ADMIN_STUDENT_JOIN_CUTOFF : null;
}
