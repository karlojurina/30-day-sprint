/**
 * The early-finish discount: where a student stands, in one pure function.
 *
 * The offer (the owner, 2026-10-14): 30% off when the student has watched the
 * videos up to the discount checkpoint, which sits between Video Ads II (the
 * Trail Hut) and Static Ads (the Boathouse), in time. Since 2026-10-26 (the
 * owner: "They have to watch 80% of the 61 videos, or whatever amount of
 * videos we have, until the end of video ads 2.") that is 80% of them,
 * rounded up (videosNeeded: 49 of 61); until then it was every one, and a
 * window that closed before then keeps that rule (videosNeededFor, the
 * owner's call of the same day, DISCOUNT_EIGHTY_FROM below). Who can
 * earn it, and by when (the owner, 2026-10-16, T-080; the first date moved from
 * 9 September to 1 October by the owner on 2026-10-19; every date from midnight
 * in Croatia):
 *   - a first payment on or after the launch (9 October 2026): 14 days from
 *     that payment;
 *   - a first payment from 1 October 2026 until the launch: until the end
 *     of 23 October 2026, one deadline they all share (they watch on Whop
 *     while the app is closed and apply once it is back);
 *   - a first payment before 1 October 2026: never.
 * It is one 30% per student: a request already made decides the state, and
 * one made on the old dashboard still does, unless it was rejected, for a
 * student who first paid from 1 October until the launch (requestCounts).
 * A student whose Whop membership already has a discount on its next renewal
 * cannot earn it (admin rebuild 2, D5: membershipDiscounted, "has-discount").
 *
 * "The videos up to the checkpoint" are the counting watch lessons, in course
 * order, up to and including the gate lesson (`is_gate`), that have a video.
 * A lesson with no video yet cannot be watched, so it is not asked for, and
 * the 80% is of the videos there are (the count follows the catalog). An
 * action item with a video counts once its video is done; its link half is
 * not asked for here. Which 80% does not matter: any of them count.
 *
 * Shared by the map (what the student sees), both request routes and the
 * approval (what the server allows, discount-server.ts), so they can never
 * disagree about who is ready.
 */

import { DISCOUNT_WINDOW_DAYS } from "./constants.ts";

export const DISCOUNT_PERCENT = 30;

/**
 * The share of the videos up to the checkpoint the 30% asks for, in percent
 * (the owner, 2026-10-26). The words students read say it from here
 * (checkpointView.ts discountRule), and so does the 30% page.
 */
export const DISCOUNT_VIDEO_SHARE = 80;

/**
 * How many of `total` videos meet the 30%: DISCOUNT_VIDEO_SHARE of them,
 * rounded up, so never less than 80% (61 videos: 49; 3: 3; 10: 8). The one
 * place the number is worked out: videosNeededFor reads it for every window
 * that ends from the 80% rule on, and through it discountState (the map, POST
 * /api/discounts/request, POST /api/discounts/submit-feedback and the
 * approval, discount-server.ts) and the 30% page's count (thirty-view.ts).
 * 0 for no videos, or a count that is not a whole number.
 */
export function videosNeeded(total: number): number {
  if (!Number.isInteger(total) || total <= 0) return 0;
  // ceil(total * 80 / 100) in whole numbers, so no rounding of 0.8 can move the edge.
  return Math.floor((total * DISCOUNT_VIDEO_SHARE + 99) / 100);
}

/**
 * When the 80% took over from every video: the start of the owner's day, 26
 * October 2026 in Croatia, 00:00 CET (UTC+1, the clocks went back on 25
 * October), which is 25 October 23:00 UTC.
 *
 * THE OWNER'S CALL (2026-10-26), asked whether a window that closed before
 * this moment could still apply, judged at its deadline by the 80% (A), or
 * whether the 80% counts from this moment, those windows staying closed and
 * the map never telling them a rule their window did not have (B): "B and 80%
 * of the first 61 videos, not all videos." So a window that ended before it
 * keeps the rule it had, every video (videosNeededFor): the approval and the
 * 30% page judge any request of such a window by every video (the branch
 * before the review of the same day judged it by the 80%, which reached back
 * to them), its closed line says that rule in the past (checkpointView.ts
 * expiredRuleLine), and a first payment before 1 October reads no rule at all
 * (discountRule's beforeLaunch). Nobody whose window closed before it gets a
 * new path.
 *
 * The 80% build goes live after this moment, so a window that closes between
 * the two had the 80% by the owner's call while production still asked that
 * student for every video, and it shows the 80% line once closed.
 * supabase/diagnostics/eighty-closed-windows.sql lists those students (its
 * lines d and e, each with its deadline); what they get is the owner's call.
 */
export const DISCOUNT_EIGHTY_FROM = "2026-10-25T23:00:00.000Z";

/** A window that ended before the 80% rule (DISCOUNT_EIGHTY_FROM): it asked for every video. False for a date that does not parse. */
export function closedBeforeEighty(endsAt: string): boolean {
  const t = Date.parse(endsAt);
  return Number.isFinite(t) && t < Date.parse(DISCOUNT_EIGHTY_FROM);
}

/**
 * How many of `total` videos a window ending at `endsAt` asks for: the one
 * place the rule a window has is worked out. Every one of them for a window
 * that ended before the 80% rule (closedBeforeEighty: the owner's B of
 * 2026-10-26, DISCOUNT_EIGHTY_FROM above), else videosNeeded. 0 for no
 * videos, or a count that is not a whole number. discountState reads it, so
 * the map, both request routes and the approval give one answer; so does the
 * 30% page's count (thirty-view.ts). A window open today ends after the 80%
 * rule began, so the map and the request routes ask what they asked: the
 * answer moves only for a window that has closed, which the approval judges
 * at its end.
 */
export function videosNeededFor(total: number, endsAt: Date): number {
  if (!Number.isInteger(total) || total <= 0) return 0;
  const t = endsAt.getTime();
  return Number.isFinite(t) && t < Date.parse(DISCOUNT_EIGHTY_FROM) ? total : videosNeeded(total);
}

/**
 * How long the `count` shortest of `videos` take, in seconds: the least a
 * student still has to watch to reach the 80%, since any video up to the
 * checkpoint counts toward it (the review of 2026-10-26; it was the next ones
 * in course order, which could be hours where the shortest take minutes). 0
 * when `count` is 0, or when any of `videos` has no known length: the
 * shortest could then be that one, so no time is known.
 */
export function shortestSeconds(videos: readonly DiscountLesson[], count: number): number {
  if (count <= 0) return 0;
  const lengths: number[] = [];
  for (const v of videos) {
    if (v.duration_seconds == null || !Number.isFinite(v.duration_seconds)) return 0;
    lengths.push(v.duration_seconds);
  }
  return lengths
    .sort((a, b) => a - b)
    .slice(0, count)
    .reduce((sum, s) => sum + s, 0);
}
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
 * The earliest first payment that can earn it: 1 October 2026 at midnight in
 * Croatia, 00:00 CEST (UTC+2), which is 30 September 22:00 UTC. Shown to
 * students as a date in Europe/Zagreb, never UTC, or it would read
 * "30 September". Until 2026-10-19 it was 9 September; Lovro moved it to
 * keep the rule simple.
 */
export const DISCOUNT_ELIGIBLE_FROM = "2026-09-30T22:00:00.000Z";
/**
 * The deadline shared by every first payment from DISCOUNT_ELIGIBLE_FROM until
 * the launch: the end of 23 October 2026 in Croatia, still summer time (CEST,
 * UTC+2; the clocks go back on 25 October). 24 October begins at 22:00 UTC on
 * the 23rd. The window's end counts as inside it (discountState here, the
 * approval's videoDoneIds), so the deadline is the millisecond before, and in
 * Croatia it reads as 23 October.
 */
export const DISCOUNT_SHARED_DEADLINE = "2026-10-23T21:59:59.999Z";

/**
 * What a student reads when their Whop membership already has a discount on
 * its next renewal (admin rebuild 2, D5; the owner's words with one grammar fix):
 * the map's panel says it with no Apply, and both request routes refuse with
 * it (discount-server.ts discountRefusalMessage). Whop's side of it:
 * src/lib/membership-discount.ts.
 */
export const MEMBERSHIP_DISCOUNT_LINE =
  "You can't apply for this discount because you already have a discount applied to your account.";

const DAY_MS = 86_400_000;

/**
 * Which deadline a student has. "own": 14 days from their own first payment,
 * made on or after the launch. "shared": DISCOUNT_SHARED_DEADLINE, the end of
 * 23 October, for a first payment from 1 October until the launch.
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
   * (1 October); the name is from when the launch was the cutoff.
   * "has-discount": the student's Whop membership already has a discount on
   * its next renewal (DiscountInput.membershipDiscounted, D5).
   *
   * The counts (since the 80% rule, 2026-10-26): `lessonsTotal` is the videos
   * up to the checkpoint, `lessonsNeeded` what the window asks of them
   * (videosNeededFor: 80%, or every one for a window that ended before
   * DISCOUNT_EIGHTY_FROM), `lessonsDone` how many of them are watched, and
   * `lessonsLeft` how many more it still needs (lessonsNeeded less
   * lessonsDone, never below 0). Until then `lessonsLeft` was every video not
   * watched.
   */
  | { kind: "not-eligible"; reason: "no-payment" | "before-launch" | "no-gate" | "has-discount" }
  | { kind: "expired"; endsAt: string; window: DiscountWindow; lessonsLeft: number }
  | {
      kind: "locked";
      endsAt: string;
      window: DiscountWindow;
      lessonsLeft: number;
      lessonsDone: number;
      lessonsNeeded: number;
      lessonsTotal: number;
      /**
       * The length of the `lessonsLeft` shortest videos not watched
       * (shortestSeconds), the least the 80% still takes; 0 when one of them
       * has no known length. The next ones in course order until 2026-10-26.
       */
      secondsLeft: number;
      /** The first video not watched, in course order. */
      nextLessonId: string | null;
    }
  | {
      kind: "ready";
      endsAt: string;
      window: DiscountWindow;
      lessonsDone: number;
      lessonsNeeded: number;
      lessonsTotal: number;
    }
  | {
      kind: "pending" | "approved" | "applied" | "rejected";
      requestId: string;
      at: string;
      promoCode: string | null;
      rejectionReason: string | null;
      /**
       * The request was made before the launch, on the old dashboard, by a
       * student who first paid from 1 October (requestCounts). Its 30% is
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
  /**
   * The student's Whop membership has a discount on its next renewal, as
   * stored in student_membership_discounts (D5; /api/student/data carries
   * it to the map). Left out or false: none known. It closes the offer to a
   * student it is open to, after the requests and the dates: a request
   * already made still decides, and a closed window keeps its own words.
   */
  membershipDiscounted?: boolean;
}

/** The gate lesson's id, or null when the catalog has none (the offer is then closed). */
export function gateLessonId(lessons: readonly DiscountLesson[]): string | null {
  return lessons.find((l) => l.is_gate)?.id ?? null;
}

/** The lessons the offer counts, in course order: the 80% is of these (videosNeeded). Empty when there is no gate. */
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
 * Is the offer still open to this first payment at `nowMs`: open to it
 * (discountWindow) and its deadline not past. The deadline's own millisecond
 * is inside, as discountState counts it. The coupon cron reads only these
 * students (admin rebuild 2, the render review's fix round: it read every
 * student since 1 October, a list that only grew).
 */
export function discountWindowOpen(firstPaidAt: string | null, nowMs: number): boolean {
  const w = discountWindow(firstPaidAt);
  return !("closed" in w) && nowMs <= w.endsAt.getTime();
}

/**
 * The earliest first payment whose offer can still be open at `nowMs`, as an
 * ISO moment: DISCOUNT_ELIGIBLE_FROM until the shared deadline has passed,
 * then the launch or 14 days before `nowMs`, whichever is later. A read from
 * here on holds every student discountWindowOpen keeps (and a few it does
 * not, on the boundary's day), so the cron's read stays as short as the
 * window.
 */
export function earliestOpenFirstPayment(nowMs: number): string {
  if (nowMs <= Date.parse(DISCOUNT_SHARED_DEADLINE)) return DISCOUNT_ELIGIBLE_FROM;
  return new Date(Math.max(Date.parse(DISCOUNT_LAUNCH_DATE), nowMs - DISCOUNT_WINDOW_DAYS * DAY_MS)).toISOString();
}

/**
 * Whether a discount request decides where the student stands: the one place
 * that says which requests count, read by discountState (the map, the request
 * routes) and by Discount Earned (achievements.ts).
 *
 *   - Made from the launch on: on the new course, so it counts.
 *   - Made before the launch, on the old dashboard, by a student who first
 *     paid from 1 October until the launch (the shared window, T-080): it
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
 *     the live writers only fill an empty first_paid_at. The exception is the
 *     one-off repair (POST /api/admin/first-paid-repair, 2026-10-20), which
 *     moves a free membership's date later to the first real payment: a
 *     request made under the old date can then stop counting, or be left
 *     uncounted beside a 30% the new date opens, and the repair's answer
 *     counts both (thirty.requests_change, thirty.open_with_old_request).
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
  // A discount already on the next renewal: no 30% on top, however many videos are done (D5).
  if (input.membershipDiscounted === true) return { kind: "not-eligible", reason: "has-discount" };
  if (!gateLessonId(lessons)) return { kind: "not-eligible", reason: "no-gate" };

  const required = requiredLessons(lessons);
  // A gate with not one video up to it (the videos not loaded yet, or a
  // failed lesson_videos read upstream) would otherwise make every student
  // "ready" on day one. Nothing to reach is the same as no checkpoint.
  if (required.length === 0) return { kind: "not-eligible", reason: "no-gate" };
  const left = required.filter((l) => !videoDoneIds.has(l.id));
  const done = required.length - left.length;
  // What the window asks (videosNeededFor: the 80%, or every video for one that ended before the 80% rule), and how
  // many more the student still has to watch.
  const needed = videosNeededFor(required.length, open.endsAt);
  const short = Math.max(0, needed - done);

  const endsAt = open.endsAt.toISOString();
  if (now.getTime() > open.endsAt.getTime()) {
    return { kind: "expired", endsAt, window: open.window, lessonsLeft: short };
  }
  if (short === 0) {
    return { kind: "ready", endsAt, window: open.window, lessonsDone: done, lessonsNeeded: needed, lessonsTotal: required.length };
  }
  return {
    kind: "locked",
    endsAt,
    window: open.window,
    lessonsLeft: short,
    lessonsDone: done,
    lessonsNeeded: needed,
    lessonsTotal: required.length,
    // The shortest of the videos not watched: any of them counts toward the 80% (every one is needed otherwise).
    secondsLeft: shortestSeconds(left, short),
    nextLessonId: left[0]?.id ?? null,
  };
}
