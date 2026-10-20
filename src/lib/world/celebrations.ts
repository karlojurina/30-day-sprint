/**
 * When the map marks the two moments the old dashboard celebrates
 * (src/app/dashboard/page.tsx): the streak going up and the discount
 * approved (on the map also once applied, within 5 days of the application:
 * approvalOnMap). Read by
 * src/components/world/WorldCelebrations.tsx and WorldMap.tsx, and the
 * checkpoint's panel reads renewalStillAhead. On the map
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

const DAY_MS = 86_400_000;

/**
 * How long after an application its 30% is sure to be still ahead of the
 * student, days (the 2026-10-20 review of streak-2). The team puts it on the
 * next renewal of the monthly plan. The shortest time the offer's dates
 * (discount.ts) leave from an application to that renewal is just under 7
 * days: a first payment at the start of 1 October in Croatia is 30 September
 * 22:00 UTC and can renew on 30 October 22:00 UTC (a month, or 30 days, on
 * the UTC calendar), and the last application is at the end of 23 October in
 * Croatia, 21:59 UTC, plus the request route's 5 minutes (REQUEST_GRACE_MS).
 * A first payment from the launch on applies within its 14 days and renews at
 * least 28 days after it. 5 keeps about 2 days spare for a wrong clock on the
 * student's device or a charge taken early.
 * client-tests/discount-next-renewal.test.mjs works the gap out from
 * discount.ts's dates, so a date moved closer fails it.
 */
export const RENEWAL_AHEAD_DAYS = 5;

/**
 * True while the renewal the 30% goes on is sure to be still ahead, for an
 * application made at `at` (ISO): within RENEWAL_AHEAD_DAYS of it. After that
 * the renewal may have used it already, and "on your next payment" or "on
 * your next renewal" may be false. A date that does not parse: false. Read by
 * approvalOnMap and the checkpoint's panel (WorldV6.tsx CheckpointBody).
 */
export function renewalStillAhead(at: string, now: number): boolean {
  const t = Date.parse(at);
  return Number.isFinite(t) && now - t < RENEWAL_AHEAD_DAYS * DAY_MS;
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
 *
 * An applied one plays only while the renewal is sure to be still ahead
 * (renewalStillAhead, `now` in ms; the 2026-10-20 review): the applied state
 * lasts for good, and the browser key is the only other guard, so a second
 * device, Safari's 7-day storage wipe or blocked storage would play "Your 30%
 * is on your next payment." months after that payment used it. An approved
 * one has no limit, as before: the team marks it applied in the same sitting.
 * A moment already due when the limit passes keeps its place
 * (WorldCelebrations.tsx) and takes the approved line, which still holds
 * then: the renewal is still about 2 days away at the least.
 */
export function approvalOnMap(
  state: {
    kind: string;
    requestId?: string;
    at?: string;
    madeBeforeLaunch?: boolean;
  },
  now: number,
): { requestId: string; applied: boolean } | null {
  if (state.kind !== "approved" && state.kind !== "applied") return null;
  if (!state.requestId || state.madeBeforeLaunch) return null;
  if (state.kind === "applied" && !renewalStillAhead(state.at ?? "", now)) return null;
  return { requestId: state.requestId, applied: state.kind === "applied" };
}
