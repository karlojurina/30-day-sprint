/**
 * Which Whop plan a member is on, in the words the admin shows: "Monthly",
 * "Yearly" or "Other plan".
 *
 * PAYING_WHOP_PLAN_IDS (constants.ts) is the $97 monthly plan alone, on
 * purpose: it defines who the dashboard's charts count (the 16 September
 * decision), so it is not widened here. The admin's new pages list members on
 * every plan and label each row instead (admin rebuild PRD, C3).
 */

import { PAYING_WHOP_PLAN_IDS } from "@/lib/constants";

/**
 * The two yearly plans: plan_fMMqxAljrzu75 ($970 a year) and
 * plan_VFDntXQf9cYMo ($700 a year), as constants.ts names them beside
 * PAYING_WHOP_PLAN_IDS.
 */
export const YEARLY_WHOP_PLAN_IDS: ReadonlySet<string> = new Set<string>([
  "plan_fMMqxAljrzu75",
  "plan_VFDntXQf9cYMo",
]);

export type PlanLabel = "Monthly" | "Yearly" | "Other plan";

/** "Monthly" for the paying monthly plan, "Yearly" for the two yearly ones, "Other plan" for anything else or none. */
export function planLabel(whopPlanId: string | null | undefined): PlanLabel {
  if (!whopPlanId) return "Other plan";
  if (PAYING_WHOP_PLAN_IDS.has(whopPlanId)) return "Monthly";
  if (YEARLY_WHOP_PLAN_IDS.has(whopPlanId)) return "Yearly";
  return "Other plan";
}
