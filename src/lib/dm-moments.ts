/**
 * The DMs the owner added to the team's queue on 2026-10-30 (stopped
 * watching, the 30% closing) and 2026-11-03 (stopped watching after Video
 * Ads II), as check-csm-tasks step 2d decides them. Pure: the route reads,
 * this judges.
 *
 * STOPPED WATCHING ("Alright nice, that's good - code it and make the
 * message"): a student who signed in to the app (one who never did gets only
 * the Whop note: "I don't want to spam them"), has started (a finished lesson,
 * counted as the nolessons.* rules count one) and watched at least 1 of the
 * counted videos (the owner, 2026-11-03: a student with only a skip or a
 * lesson with no video gets no "You made a nice start"), has not got past
 * Video Ads II (pastVideoAdsII; the owner, 2026-11-03: "#1 is for before
 * that", so a student at 49 to 60 of the 61 gets it too), and has finished no lesson
 * for 3 days on course days 1 to 14, or for 5 days on days 15 to 30 (the
 * snapshot's dayOnCourse, as nolessons.* read it). The days are counted from
 * course day 1 at the earliest: lessons watched before it (on a free
 * membership, before the first payment) do not make a break on day 1. Two
 * versions, one message (src/lib/dm-queue.ts): lapse.30 while the 30% is
 * still open and in reach and they have not applied and no coupon closes it
 * (thirtyReach), lapse.plain otherwise. Once per break and at most twice, by
 * dm-queue.ts's rule. Not to a canceling student.
 *
 * THE 30% CLOSING ("Yes"): a student who signed in, whose 2 weeks for the 30%
 * end in 2 days or less (the window still open), who is under the share, can
 * still make it, has not applied and has no coupon on file (thirtyReach). Once
 * ever. When it is made, the stopped-watching DM is not made in the same run
 * (the owner: "If #7 is due for the student in the same run, only #7 goes").
 * Nor in the day before it (closingAhead): a stopped-watching DM due a run or a
 * day before the closing would send the student two DMs about the 30% hours
 * apart, so it waits for the closing.
 *
 * STOPPED WATCHING AFTER VIDEO ADS II (the owner, 2026-11-03: "I think we
 * need 1 more after the video ads 2"): a student who signed in, is past Video
 * Ads II ("finished the last lesson in Video Ads II and is about to watch
 * Static ads": a lesson at or after the gate, a4l17 today, watched, skipped
 * or shipped) and has finished no lesson for 4 days, any day of month 1, only
 * while the break is new (STOPPED_NEW_DAYS). Two versions, one message
 * (dm-queue.ts): lapse.after.again when the first stopped-watching DM went
 * out in the last RECENT_FIRST_MS ("I know I sent this a few days ago"),
 * lapse.after otherwise ("this is where the real sauce begins"). Not while
 * the first went out less than HOLD_AFTER_FIRST_MS ago ("we don't send it
 * YET"); a student who had it watched a lesson since and then went 4 days
 * without one, so that can only happen when the team marked it sent late.
 * Once per break, at most twice. Not to a canceling student.
 *
 * IN REACH (the owner's definition): they can still get to the share by
 * watching about 2 hours a day until their deadline, counted from the lengths
 * of the videos they have not watched: the shortest of the counted videos not
 * watched that would take them there (the map's own "if you pick the
 * shortest") last at most 120 minutes for each day left, the days left counted
 * to the millisecond. A video with no known length is ranked last
 * (knownShortestSeconds): the time is unknown, and so not in reach, only when
 * too few of the videos left have a length to make up the share. One missing
 * length would otherwise take both 30% DMs from every student at once.
 *
 * "A lesson finished" is the latest of the last video the student finished
 * (the snapshot's lastWatchedAt: any lesson of the live course, its action
 * item shipped or not), lastCountedCompletionAt (which also moves when they
 * ship an action item) and the last lesson they skipped (lastSkippedAt: a skip
 * counts as a finished lesson for nolessons.*, and so for "has started", and a
 * student who only skipped would otherwise never have a break).
 * lastCountedCompletionAt alone skips a watched action lesson whose link is not
 * in yet, and would tell a student who watched yesterday that they had not
 * been on the videos.
 */

import {
  discountEndsAt,
  discountState,
  requiredLessons,
  videosNeeded,
  type DiscountLesson,
  type DiscountRequestRow,
} from "@/lib/world/discount";
import { LAPSE_AFTER, LAPSE_AFTER_AGAIN, LAPSE_PLAIN, LAPSE_THIRTY } from "@/lib/dm-queue";

const DAY_MS = 86_400_000;

/** Days without a lesson that make a break on course days 1 to EARLY_LAST_DAY. */
export const STOPPED_DAYS_EARLY = 3;
/** Days without a lesson that make a break on course days after EARLY_LAST_DAY, to MONTH_ONE_LAST_DAY. */
export const STOPPED_DAYS_LATE = 5;
export const EARLY_LAST_DAY = 14;
/**
 * How many days past the break's first day the stopped-watching DM can still
 * go: only a NEW break gets it (the owner, 2026-10-30: "Only new ones from 3
 * days ago"). A student quiet longer than that gets nothing, so the first run
 * after go-live sends nothing to the backlog, and "the last few days" stays
 * true. A day of slack covers a missed cron run and the hold before the 30%
 * closing (closingAhead).
 */
export const STOPPED_NEW_DAYS = 1;
/** The stopped-watching DM goes on course days 1 to 30 only, month 1. */
export const MONTH_ONE_LAST_DAY = 30;
/** The 30% closing DM goes this close to the end of the student's 2 weeks, or closer. */
export const CLOSING_WITHIN_MS = 2 * DAY_MS;
/** How long before the closing DM is due the stopped-watching DM waits for it instead (closingAhead). */
export const CLOSING_HOLD_MS = DAY_MS;
/** "About 2 hours a day": what a student can still watch each day left. */
export const WATCH_MINUTES_A_DAY = 120;
/** Days without a lesson that make a break past Video Ads II (the owner: "if they're inactive for 4 days"). */
export const AFTER_DAYS = 4;
/** The first stopped-watching DM sent less than this ago holds the one after Video Ads II back ("we don't send it YET"). */
export const HOLD_AFTER_FIRST_MS = 4 * DAY_MS;
/** The first stopped-watching DM sent this recently makes the one after Video Ads II say so ("a few days ago"). */
export const RECENT_FIRST_MS = 7 * DAY_MS;

/** When the student last finished a lesson: the latest of the three moments (above). Null when they finished none. */
export function lastLessonAt(snap: {
  lastWatchedAt: string | null;
  lastCountedCompletionAt: string | null;
  lastSkippedAt?: string | null;
}): string | null {
  let latest: string | null = null;
  let latestMs = -Infinity;
  for (const at of [snap.lastWatchedAt, snap.lastCountedCompletionAt, snap.lastSkippedAt ?? null]) {
    const ms = Date.parse(at ?? "");
    if (Number.isFinite(ms) && ms > latestMs) {
      latest = at;
      latestMs = ms;
    }
  }
  return latest;
}

/**
 * How long the `count` shortest of `videos` take, in seconds, the videos with
 * no known length ranked last: discount.ts shortestSeconds, which answers 0
 * (no time known) as soon as one of them has no length. Null when fewer than
 * `count` have one. A time found this way is never under the true least time
 * (a video with no length could only be shorter), so "in reach" read from it
 * is true.
 */
export function knownShortestSeconds(
  videos: readonly DiscountLesson[],
  count: number,
): number | null {
  if (count <= 0) return 0;
  const lengths = videos
    .map((v) => v.duration_seconds)
    .filter((s): s is number => s != null && Number.isFinite(s))
    .sort((a, b) => a - b);
  if (lengths.length < count) return null;
  return lengths.slice(0, count).reduce((sum, s) => sum + s, 0);
}

/** The 30%'s counted videos (requiredLessons), how many the student finished (a video done, as the map counts it) and the share asked of them (videosNeeded). */
export interface ThirtyVideos {
  total: number;
  done: number;
  needed: number;
}

export function thirtyVideos(
  lessons: readonly DiscountLesson[],
  videoDone: ReadonlySet<string>,
): ThirtyVideos {
  const counted = requiredLessons(lessons);
  return {
    total: counted.length,
    done: counted.filter((l) => videoDone.has(l.id)).length,
    needed: videosNeeded(counted.length),
  };
}

/**
 * Whether the student is past Video Ads II: a lesson at or after the gate
 * (the last lesson of Video Ads II), in course order, watched, skipped or
 * shipped. False when the catalog has no gate.
 */
export function pastVideoAdsII(
  lessons: readonly DiscountLesson[],
  completions: ReadonlyArray<{
    lesson_id: string;
    completed_at: string | null;
    skipped_at?: string | null;
    action_completed_at?: string | null;
  }>,
): boolean {
  const gate = lessons.findIndex((l) => l.is_gate);
  if (gate < 0) return false;
  const after = new Set(lessons.slice(gate).map((l) => l.id));
  return completions.some(
    (c) => after.has(c.lesson_id) && Boolean(c.completed_at || c.skipped_at || c.action_completed_at),
  );
}

/** What the two DMs read of a student, from the snapshot and the counted videos. */
export interface MomentStudent {
  signedIn: boolean;
  canceling: boolean;
  dayOnCourse: number;
  /** Whole days since course day 1 began (the snapshot's daysSinceCourseStart). */
  daysSinceCourseStart: number;
  /** Lessons finished, as the nolessons.* rules count them (totalCompletedAcrossRegions). */
  lessonsFinished: number;
  /** lastLessonAt of the snapshot. */
  lastLessonAt: string | null;
  firstPaidAt: string | null;
  videos: ThirtyVideos;
  /** pastVideoAdsII of the student's lessons. */
  pastVideoAdsII: boolean;
}

/** Whole days without a lesson, when they make a stopped-watching break today; else null. */
export function stoppedWatchingBreak(m: MomentStudent, nowMs: number): number | null {
  if (!m.signedIn || m.canceling) return null;
  if (m.lessonsFinished <= 0) return null;
  // At least 1 counted video (above): a skip alone is no start for this DM.
  // With no counted videos (no gate) none is ever done, so nothing is judged.
  if (m.videos.done < 1) return null;
  // Past Video Ads II: the one after it (stoppedAfterVideoAdsII) instead.
  if (m.pastVideoAdsII) return null;
  if (m.dayOnCourse < 1 || m.dayOnCourse > MONTH_ONE_LAST_DAY) return null;
  const last = Date.parse(m.lastLessonAt ?? "");
  if (!Number.isFinite(last)) return null;
  // Counted from course day 1 at the earliest (above).
  const quietDays = Math.min(Math.floor((nowMs - last) / DAY_MS), m.daysSinceCourseStart);
  const breakDays = m.dayOnCourse <= EARLY_LAST_DAY ? STOPPED_DAYS_EARLY : STOPPED_DAYS_LATE;
  return quietDays >= breakDays && quietDays <= breakDays + STOPPED_NEW_DAYS ? quietDays : null;
}

/**
 * Whether either DM could be due once the student's 30% is read: the route
 * reads discount requests and coupon answers for these students alone. A
 * student whose window has closed gets lapse.plain whatever those say.
 */
export function mayNeedThirty(m: MomentStudent, nowMs: number): boolean {
  if (!m.signedIn || m.canceling) return false;
  const ends = discountEndsAt(m.firstPaidAt);
  if (!ends || nowMs > ends.getTime()) return false;
  if (m.videos.done >= m.videos.needed) return false;
  return ends.getTime() - nowMs <= CLOSING_WITHIN_MS || stoppedWatchingBreak(m, nowMs) !== null;
}

/** The student's 30% as the two DMs read it. */
export interface ThirtyFacts {
  now: Date;
  firstPaidAt: string | null;
  lessons: readonly DiscountLesson[];
  videoDone: ReadonlySet<string>;
  /** The student's discount requests, any status: one that counts decides, as on the map (discountState). */
  requests: readonly DiscountRequestRow[];
  /** A request pending, approved or applied (dm-queue.ts THIRTY_APPLIED_STATUSES): applied. */
  applied: boolean;
  /** The stored coupon answer closes the 30% (a discount on the next renewal, or the unpaid answer, on the membership on file). */
  couponCloses: boolean;
}

export type ThirtyReach =
  | { inReach: true; endsAt: Date; left: number; secondsLeft: number }
  | { inReach: false; why: string };

/** Whether the 30% is still open to the student and in reach (above), and if not, why, in a few words for the task's line. */
export function thirtyReach(f: ThirtyFacts): ThirtyReach {
  if (f.applied) return { inReach: false, why: "applied for 30%" };
  if (f.couponCloses) return { inReach: false, why: "30% closed" };
  const state = discountState({
    now: f.now,
    firstPaidAt: f.firstPaidAt,
    lessons: f.lessons,
    videoDoneIds: f.videoDone,
    requests: f.requests,
  });
  if (state.kind === "pending" || state.kind === "approved" || state.kind === "applied") {
    return { inReach: false, why: "applied for 30%" };
  }
  if (state.kind === "rejected") return { inReach: false, why: "30% turned down" };
  if (state.kind === "ready") return { inReach: false, why: "reached the 30%" };
  if (state.kind !== "locked") return { inReach: false, why: "30% closed" };
  const left = requiredLessons(f.lessons).filter((l) => !f.videoDone.has(l.id));
  const secondsLeft = knownShortestSeconds(left, state.lessonsLeft);
  if (secondsLeft === null) {
    return { inReach: false, why: "video lengths unknown" };
  }
  const daysLeft = (Date.parse(state.endsAt) - f.now.getTime()) / DAY_MS;
  if (secondsLeft > WATCH_MINUTES_A_DAY * 60 * daysLeft) {
    return { inReach: false, why: "30% out of reach" };
  }
  return { inReach: true, endsAt: new Date(state.endsAt), left: state.lessonsLeft, secondsLeft };
}

/**
 * Whether the 30% closing DM is due within CLOSING_HOLD_MS (not yet) and the
 * student would still be in reach when it is, the videos left fitting the 2
 * days' 2 hours a day: the stopped-watching DM then waits for it. The caller
 * also checks that the closing's template is on and that the student has not
 * had the closing (it goes once ever).
 */
export function closingAhead(reach: ThirtyReach, nowMs: number): boolean {
  if (!reach.inReach) return false;
  const msLeft = reach.endsAt.getTime() - nowMs;
  return (
    msLeft > CLOSING_WITHIN_MS &&
    msLeft <= CLOSING_WITHIN_MS + CLOSING_HOLD_MS &&
    reach.secondsLeft <= WATCH_MINUTES_A_DAY * 60 * (CLOSING_WITHIN_MS / DAY_MS)
  );
}

/** The 30% closing DM's summary when it is due for the student, else null. */
export function thirtyClosing(m: MomentStudent, reach: ThirtyReach, nowMs: number): string | null {
  if (!m.signedIn || m.canceling) return null;
  if (!reach.inReach) return null;
  const msLeft = reach.endsAt.getTime() - nowMs;
  if (msLeft < 0 || msLeft > CLOSING_WITHIN_MS) return null;
  const hours = Math.max(1, Math.round(msLeft / 3_600_000));
  return `Day ${m.dayOnCourse} · 30% closes in ${hours} ${hours === 1 ? "hour" : "hours"} · ${m.videos.done} of ${m.videos.needed}`;
}

/** The stopped-watching DM due for the student, the version and its summary, else null. */
export function stoppedWatching(
  m: MomentStudent,
  reach: ThirtyReach,
  nowMs: number,
): { scenarioId: string; summary: string } | null {
  const quietDays = stoppedWatchingBreak(m, nowMs);
  if (quietDays === null) return null;
  // The owner's line, 2026-11-03: "Day 14 · stopped watching 3 days ago · 6 of 49, 30% out of reach".
  // Past the 30%'s share (49 to 60 of the 61): out of all of them, as "55 of 49" reads wrong.
  const of = m.videos.done >= m.videos.needed ? m.videos.total : m.videos.needed;
  const head = `Day ${m.dayOnCourse} · stopped watching ${quietDays} days ago · ${m.videos.done} of ${of}`;
  if (reach.inReach) return { scenarioId: LAPSE_THIRTY, summary: `${head}, 30% still possible` };
  return { scenarioId: LAPSE_PLAIN, summary: `${head}, ${reach.why}` };
}

/**
 * Stopped watching after Video Ads II (above), the version and its line, else
 * null. `firstSentAt`: when the student was last sent the first
 * stopped-watching DM (dm-queue.ts lastSentAt over lapse.30 and lapse.plain),
 * or null.
 */
export function stoppedAfterVideoAdsII(
  m: MomentStudent,
  nowMs: number,
  firstSentAt: number | null,
): { scenarioId: string; summary: string } | null {
  if (!m.signedIn || m.canceling || !m.pastVideoAdsII) return null;
  if (m.dayOnCourse < 1 || m.dayOnCourse > MONTH_ONE_LAST_DAY) return null;
  const last = Date.parse(m.lastLessonAt ?? "");
  if (!Number.isFinite(last)) return null;
  const quietDays = Math.min(Math.floor((nowMs - last) / DAY_MS), m.daysSinceCourseStart);
  if (quietDays < AFTER_DAYS || quietDays > AFTER_DAYS + STOPPED_NEW_DAYS) return null;
  const sinceFirst = firstSentAt === null ? null : nowMs - firstSentAt;
  if (sinceFirst !== null && sinceFirst < HOLD_AFTER_FIRST_MS) return null;
  const head = `Day ${m.dayOnCourse} · stopped watching ${quietDays} days ago · past Video Ads II`;
  if (sinceFirst !== null && sinceFirst <= RECENT_FIRST_MS) {
    return { scenarioId: LAPSE_AFTER_AGAIN, summary: `${head}, first one sent ${Math.floor(sinceFirst / DAY_MS)} days ago` };
  }
  return { scenarioId: LAPSE_AFTER, summary: head };
}
