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

import { ADMIN_STUDENT_JOIN_CUTOFF } from "@/lib/constants";

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
}

/** True iff the student currently has platform access. */
export function isActiveMember(s: StudentLike): boolean {
  return (ACTIVE_STATUSES as readonly string[]).includes(
    s.membership_status ?? "",
  );
}

/**
 * True iff the student joined on/after the launch cutoff. Used to
 * separate the launch cohort (post-2026-05-25) from legacy / test
 * accounts in admin views.
 */
export function isInLaunchCohort(s: StudentLike): boolean {
  if (!s.joined_at) return false;
  return s.joined_at >= ADMIN_STUDENT_JOIN_CUTOFF;
}

/**
 * Scope toggle for admin views. "cohort" = launch cohort only;
 * "all" = every paying member regardless of join date. Lives in the
 * URL search params (?scope=cohort|all) and defaults to "cohort" so
 * launch-week ergonomics don't change unless the user opts in.
 */
export type Scope = "cohort" | "all";
export const DEFAULT_SCOPE: Scope = "cohort";

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
