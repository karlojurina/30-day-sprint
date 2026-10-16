/**
 * When the map marks the two moments the old dashboard celebrates
 * (src/app/dashboard/page.tsx): the streak going up and the discount
 * approved. Read by src/components/world/WorldCelebrations.tsx. On the map
 * the discount's is the dashboard's full-screen celebration, and since
 * 2026-10-15 the streak's is a short moment on the number in the header
 * (Lovro: a daily tick is routine, the full-screen moment is for milestones).
 * The dashboard still shows its full-screen streak celebration.
 *
 * The rules and the browser keys are the dashboard's, copied as they stand
 * (client-tests/celebrations.test.mjs checks the keys against that file).
 * Sharing the keys is the dedupe across both: a streak or an approval already
 * celebrated on the dashboard in this browser is not celebrated again on the
 * map, and the other way round. The dashboard page keeps its own copy until
 * WI-12 deletes it. Neither calls /api/student/celebration-seen: that route
 * serves /dashboard-mockup's region and milestone moments, not these two.
 */

/** The last approved request celebrated in this browser (its id). One key for every account, as on the dashboard. */
export const DISCOUNT_APPROVED_LAST_SEEN_KEY = "et.discountApproved.lastSeen";

/** The last streak celebrated in this browser, per student (v72.8: a shared key carried one account's count into the next). */
export const streakLastSeenKey = (studentId: string) => `et.streak.lastSeen.${studentId}`;

/**
 * The streak to mark, or null (on the map, the header's moment). A streak
 * above the one last celebrated here: one finished lesson on a new day, a
 * streak earned on another device the first time this browser sees it.
 * Never 0, never twice for one count, and nothing when the stored value is
 * not a number.
 */
export function streakToCelebrate(current: number, lastSeenRaw: string | null): number | null {
  if (!(current > 0)) return null;
  const lastSeen = lastSeenRaw ? parseInt(lastSeenRaw, 10) : 0;
  if (Number.isNaN(lastSeen)) return null;
  return current > lastSeen ? current : null;
}

/** True when this approved request has not been celebrated in this browser. */
export function approvalToCelebrate(approvedRequestId: string | null, lastSeen: string | null): boolean {
  return !!approvedRequestId && lastSeen !== approvedRequestId;
}
