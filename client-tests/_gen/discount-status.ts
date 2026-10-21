/**
 * A 30% request's status as every admin page names and colours it (admin
 * rebuild 2, D4; one map since the review's fix round): the 30% page's tabs,
 * the Survey's cards and counts, a student's page and the journey's drawer.
 * They used to name the same request "Code applied" on one page and "Code
 * Applied" on another, and colour "Applied" amber on one and blue on another.
 *
 *   pending   Applied        waiting for a yes or no
 *   approved  Approved       the Whop code is made
 *   rejected  Rejected
 *   applied   Code Applied   the code is on the student's membership in Whop
 *
 * DISCOUNT_STATUS_ORDER is the 30% page's tab order, and every list of the
 * statuses follows it. No imports: client-tests/admin-review.test.mjs runs it
 * as it is.
 */

export type DiscountStatus = "pending" | "approved" | "rejected" | "applied";

/** The admin's Pill tones (ui.tsx's PillTone). */
export type DiscountTone = "success" | "warning" | "danger" | "accent" | "neutral";

export const DISCOUNT_STATUS_ORDER: readonly DiscountStatus[] = ["pending", "approved", "rejected", "applied"];

export const DISCOUNT_STATUS: Record<DiscountStatus, { label: string; tone: DiscountTone }> = {
  pending: { label: "Applied", tone: "accent" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  applied: { label: "Code Applied", tone: "neutral" },
};

/** A status's words and tone; a status this map does not know says so instead of passing for one it does. */
export function discountStatusWords(status: string | null | undefined): { label: string; tone: DiscountTone } {
  return (
    (DISCOUNT_STATUS as Record<string, { label: string; tone: DiscountTone }>)[status ?? ""] ?? {
      label: status ? `Unknown status (${status})` : "No status",
      tone: "neutral",
    }
  );
}
