/**
 * The early-finish discount: where a student stands, in one pure function.
 *
 * The offer (Lovro, 2026-10-14): 30% off when the student has watched every
 * video up to the discount checkpoint, which sits between Video Ads II (the
 * Trail Hut) and Static Ads (the Boathouse), in time. Who can earn it, and by
 * when (Lovro, 2026-10-16, T-080; every date from midnight in Croatia):
 *   - a first payment on or after the launch (9 October 2026): 14 days from
 *     that payment;
 *   - a first payment from 9 September 2026 until the launch: until the end
 *     of 23 October 2026, one deadline they all share (they watch on Whop
 *     while the app is closed and apply once it is back);
 *   - a first payment before 9 September 2026: never.
 * It is one 30% per student: a request already made decides the state, and
 * one made on the old dashboard still does, unless it was rejected, for a
 * student who first paid from 9 September until the launch (requestCounts).
 *
 * "The videos up to the checkpoint" are the counting watch lessons, in course
 * order, up to and including the gate lesson (`is_gate`), that have a video.
 * A lesson with no video yet cannot be watched, so it is not asked for. An
 * action item with a video counts once its video is done; its link half is
 * not asked for here.
 *
 * Shared by the map (what the student sees) and the request route (what the
 * server allows), so the two can never disagree about who is ready.
 */

import { DISCOUNT_WINDOW_DAYS } from "@/lib/constants";

export const DISCOUNT_PERCENT = 30;
/** The 14 days. One source: constants.ts, re-exported here for the map. */
export { DISCOUNT_WINDOW_DAYS };
/**
 * The new course launched on Whop on 9 October 2026; earlier buyers bought the
 * old course. The cutoff is midnight that day in Croatia: 9 October 00:00 CEST
 * (UTC+2) is 8 October 22:00 UTC. Shown to students as a date in
 * Europe/Zagreb, never UTC, or it would read "October 8". A first payment from
 * here on has its own 14 days, and a request made before it was made on the
 * old course (requestCounts says when one still counts).
 */
export const DISCOUNT_LAUNCH_DATE = "2026-10-08T22:00:00.000Z";
/**
 * The earliest first payment that can earn it: 9 September 2026 at midnight
 * in Croatia, 00:00 CEST (UTC+2), which is 8 September 22:00 UTC.
 */
export const DISCOUNT_ELIGIBLE_FROM = "2026-09-08T22:00:00.000Z";
/**
 * The deadline shared by every first payment from DISCOUNT_ELIGIBLE_FROM until
 * the launch: the end of 23 October 2026 in Croatia, still summer time (CEST,
 * UTC+2; the clocks go back on 25 October). 24 October begins at 22:00 UTC on
 * the 23rd. The window's end counts as inside it (discountState here, the
 * approval's videoDoneIds), so the deadline is the millisecond before, and in
 * Croatia it reads as 23 October.
 */
export const DISCOUNT_SHARED_DEADLINE = "2026-10-23T21:59:59.999Z";

const DAY_MS = 86_400_000;

/**
 * Which deadline a student has. "own": 14 days from their own first payment,
 * made on or after the launch. "shared": DISCOUNT_SHARED_DEADLINE, the end of
 * 23 October, for a first payment from 9 September until the launch.
 */
export type DiscountWindow = "own" | "shared";

export interface DiscountLesson {
  id: string;
  type: string;
  counts_toward_progress: boolean;
  is_gate: boolean;
  has_video: boolean;
  duration_seconds: number | null;
}

export interface DiscountRequestRow {
  id: string;
  status: "pending" | "approved" | "rejected" | "applied";
  created_at: string;
  promo_code?: string | null;
  rejection_reason?: string | null;
}

export type DiscountState =
  /**
   * "no-gate" also covers a gate with no video up to it: there is nothing to
   * reach. "before-launch" is a first payment before DISCOUNT_ELIGIBLE_FROM
   * (9 September); the name is from when the launch was the cutoff.
   */
  | { kind: "not-eligible"; reason: "no-payment" | "before-launch" | "no-gate" }
  | { kind: "expired"; endsAt: string; window: DiscountWindow; lessonsLeft: number }
  | {
      kind: "locked";
      endsAt: string;
      window: DiscountWindow;
      lessonsLeft: number;
      lessonsTotal: number;
      secondsLeft: number;
      nextLessonId: string | null;
    }
  | { kind: "ready"; endsAt: string; window: DiscountWindow; lessonsTotal: number }
  | {
      kind: "pending" | "approved" | "applied" | "rejected";
      requestId: string;
      at: string;
      promoCode: string | null;
      rejectionReason: string | null;
      /**
       * The request was made before the launch, on the old dashboard, by a
       * student who first paid from 9 September (requestCounts). Its 30% is
       * from the old course, so "the team confirms within 48 hours" and "on
       * your next renewal" may no longer hold. Never true for "rejected".
       */
      madeBeforeLaunch: boolean;
    };

export interface DiscountInput {
  now: Date;
  firstPaidAt: string | null;
  /** The catalog's lessons in course order (all areas, `sort_order` ascending). */
  lessons: readonly DiscountLesson[];
  /** Lessons whose video is done (`completed_at` set), action half or not. */
  videoDoneIds: ReadonlySet<string>;
  /** The student's discount requests, any order. Those requestCounts leaves out are ignored. */
  requests: readonly DiscountRequestRow[];
}

/** The gate lesson's id, or null when the catalog has none (the offer is then closed). */
export function gateLessonId(lessons: readonly DiscountLesson[]): string | null {
  return lessons.find((l) => l.is_gate)?.id ?? null;
}

/** The lessons the offer asks for, in course order. Empty when there is no gate. */
export function requiredLessons(lessons: readonly DiscountLesson[]): DiscountLesson[] {
  const gate = lessons.findIndex((l) => l.is_gate);
  if (gate < 0) return [];
  return lessons
    .slice(0, gate + 1)
    .filter((l) => l.type === "watch" && l.counts_toward_progress && l.has_video);
}

/**
 * Whether the offer is open to this first payment, and if so until when: the
 * one place the dates of the rule are read. Closed with no first payment, one
 * that does not parse, or one before DISCOUNT_ELIGIBLE_FROM.
 */
export function discountWindow(
  firstPaidAt: string | null,
): { endsAt: Date; window: DiscountWindow } | { closed: "no-payment" | "before-launch" } {
  if (!firstPaidAt) return { closed: "no-payment" };
  const t = Date.parse(firstPaidAt);
  if (!Number.isFinite(t)) return { closed: "no-payment" };
  if (t < Date.parse(DISCOUNT_ELIGIBLE_FROM)) return { closed: "before-launch" };
  if (t < Date.parse(DISCOUNT_LAUNCH_DATE)) return { endsAt: new Date(DISCOUNT_SHARED_DEADLINE), window: "shared" };
  return { endsAt: new Date(t + DISCOUNT_WINDOW_DAYS * DAY_MS), window: "own" };
}

/** When the offer ends for this student, or null when it is not open to them (discountWindow). */
export function discountEndsAt(firstPaidAt: string | null): Date | null {
  const w = discountWindow(firstPaidAt);
  return "closed" in w ? null : w.endsAt;
}

/**
 * Whether a discount request decides where the student stands: the one place
 * that says which requests count, read by discountState (the map, the request
 * routes) and by Discount Earned (achievements.ts).
 *
 *   - Made from the launch on: on the new course, so it counts.
 *   - Made before the launch, on the old dashboard, by a student who first
 *     paid from 9 September until the launch (the shared window, T-080): it
 *     counts while it is pending, approved or applied. The 30% is one per
 *     student, and the database refuses another request while one of those
 *     exists, whatever its date (v29's submit_discount_with_feedback; v106
 *     allows one pending), so the map shows that request and never an Apply
 *     the database would refuse. A rejected one does not count: a student
 *     turned down on the old course's rule can earn it on the new one.
 *   - Made before the launch by anyone else: it does not count. That is the
 *     June student's approved June request, for a student the offer is
 *     closed to. A student who first paid from the launch on should not have
 *     one: the routes refuse a request with no first payment on record, and
 *     first_paid_at never moves later (whop-sync-runner.ts).
 *   - A date that does not parse: it does not count.
 */
export function requestCounts(
  request: { status: string; created_at: string },
  firstPaidAt: string | null,
): boolean {
  const t = Date.parse(request.created_at);
  if (!Number.isFinite(t)) return false;
  if (t >= Date.parse(DISCOUNT_LAUNCH_DATE)) return true;
  if (request.status === "rejected") return false;
  const w = discountWindow(firstPaidAt);
  return !("closed" in w) && w.window === "shared";
}

export function discountState(input: DiscountInput): DiscountState {
  const { now, firstPaidAt, lessons, videoDoneIds, requests } = input;

  // A request already made decides the state, whatever the clock says now:
  // the newest of those that count (requestCounts).
  const latest = requests
    .filter((r) => requestCounts(r, firstPaidAt))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  if (latest) {
    return {
      kind: latest.status,
      requestId: latest.id,
      at: latest.created_at,
      promoCode: latest.promo_code ?? null,
      rejectionReason: latest.rejection_reason ?? null,
      madeBeforeLaunch: Date.parse(latest.created_at) < Date.parse(DISCOUNT_LAUNCH_DATE),
    };
  }

  const open = discountWindow(firstPaidAt);
  if ("closed" in open) return { kind: "not-eligible", reason: open.closed };
  if (!gateLessonId(lessons)) return { kind: "not-eligible", reason: "no-gate" };

  const required = requiredLessons(lessons);
  // A gate with not one video up to it (the videos not loaded yet, or a
  // failed lesson_videos read upstream) would otherwise make every student
  // "ready" on day one. Nothing to reach is the same as no checkpoint.
  if (required.length === 0) return { kind: "not-eligible", reason: "no-gate" };
  const left = required.filter((l) => !videoDoneIds.has(l.id));

  const endsAt = open.endsAt.toISOString();
  if (now.getTime() > open.endsAt.getTime()) {
    return { kind: "expired", endsAt, window: open.window, lessonsLeft: left.length };
  }
  if (left.length === 0) {
    return { kind: "ready", endsAt, window: open.window, lessonsTotal: required.length };
  }
  return {
    kind: "locked",
    endsAt,
    window: open.window,
    lessonsLeft: left.length,
    lessonsTotal: required.length,
    secondsLeft: left.reduce((sum, l) => sum + (l.duration_seconds ?? 0), 0),
    nextLessonId: left[0]?.id ?? null,
  };
}
