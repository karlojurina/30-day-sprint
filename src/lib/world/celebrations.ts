/**
 * When the map marks the two moments the old dashboard celebrates
 * (src/app/dashboard/page.tsx): the streak going up and the discount
 * approved (on the map also once applied: approvalOnMap). Read by
 * src/components/world/WorldCelebrations.tsx and WorldMap.tsx. On the map
 * the discount's is the dashboard's full-screen celebration, and since
 * 2026-10-15 the streak's is a short moment on the number in the header
 * (Lovro: a daily tick is routine, the full-screen moment is for milestones).
 * The dashboard still shows its full-screen streak celebration.
 *
 * The rules and the browser keys are the dashboard's, copied as they stand
 * (client-tests/celebrations.test.mjs checks the keys against that file),
 * but for a streak after a break, which since 2026-10-17 the map marks and the
 * dashboard does not (streakToCelebrate). Sharing the keys is the dedupe
 * across both: a streak or an approval already celebrated on the dashboard in
 * this browser is not celebrated again on the map, and the other way round.
 * The key stays a whole number, so the dashboard still reads what the map
 * writes. The dashboard page keeps its own copy until WI-12 deletes it.
 * Neither calls /api/student/celebration-seen: that route serves
 * /dashboard-mockup's region and milestone moments, not these two.
 */

/** The last approved request celebrated in this browser (its id). One key for every account, as on the dashboard. */
export const DISCOUNT_APPROVED_LAST_SEEN_KEY = "et.discountApproved.lastSeen";

/** The last streak celebrated in this browser, per student (v72.8: a shared key carried one account's count into the next). */
export const streakLastSeenKey = (studentId: string) => `et.streak.lastSeen.${studentId}`;

/**
 * The streak to mark, or null (on the map, the header's moment). A streak
 * that differs from the one last marked here. Above it: one finished lesson
 * on a new day, a streak earned on another device the first time this browser
 * sees it. Below it: a new streak after a break this browser did not see,
 * since a streak only goes up until it breaks (2026-10-17; it used to wait
 * until the new streak passed the old number, and the dashboard still does).
 * The map writes the key's 0 when it shows a broken streak
 * (WorldCelebrations.tsx), so a new streak that stops where the old one did
 * is marked too. Never 0, never twice for one count, and nothing when the
 * stored value is not a number.
 */
export function streakToCelebrate(current: number, lastSeenRaw: string | null): number | null {
  if (!(current > 0)) return null;
  const lastSeen = lastSeenRaw ? parseInt(lastSeenRaw, 10) : 0;
  if (Number.isNaN(lastSeen)) return null;
  return current !== lastSeen ? current : null;
}

/** True when this approved request has not been celebrated in this browser. */
export function approvalToCelebrate(approvedRequestId: string | null, lastSeen: string | null): boolean {
  return !!approvedRequestId && lastSeen !== approvedRequestId;
}

/**
 * The application the map's full-screen moment is for (WorldMap.tsx), or null:
 * the student's discount state (discount.ts discountState) approved, or
 * applied since. The team often presses Approve and Mark applied in one
 * sitting, so most students are next on the map once it is applied, and the
 * moment kept for an approved discount (Lovro, decision 11 B) only matched
 * the approved state (bug hunt 2026-10-19, streak-2). Its key is still the
 * request id, so one celebrated while approved is not shown again once
 * applied. An application made on the old dashboard before the launch
 * (madeBeforeLaunch) gets none: its 30% may already be on a past payment.
 * `applied`: the 30% is on the subscription, which the moment's line says.
 */
export function approvalOnMap(state: {
  kind: string;
  requestId?: string;
  madeBeforeLaunch?: boolean;
}): { requestId: string; applied: boolean } | null {
  if (state.kind !== "approved" && state.kind !== "applied") return null;
  if (!state.requestId || state.madeBeforeLaunch) return null;
  return { requestId: state.requestId, applied: state.kind === "applied" };
}
