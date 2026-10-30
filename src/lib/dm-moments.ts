/**
 * The two DMs the owner added to the team's queue on 2026-10-30, as
 * check-csm-tasks step 2d decides them. Pure: the route reads, this judges.
 *
 * STOPPED WATCHING ("Alright nice, that's good - code it and make the
 * message"): a student who signed in to the app (one who never did gets only
 * the Whop note: "I don't want to spam them"), has started (a finished lesson,
 * counted as the nolessons.* rules count one), is under the 30%'s share of the
 * counted videos (videosNeeded: 49 of 61 today), and has finished no lesson
 * for 3 days on course days 1 to 14, or for 5 days on days 15 to 30 (the
 * snapshot's dayOnCourse, as nolessons.* read it). Two versions, one message
 * (src/lib/dm-queue.ts): lapse.30 while the 30% is still open and in reach and
 * they have not applied and no coupon closes it (thirtyReach), lapse.plain
 * otherwise. Once per break and at most twice, by dm-queue.ts's rule. Not to a
 * canceling student.
 *
 * THE 30% CLOSING ("Yes"): a student who signed in, whose 2 weeks for the 30%
 * end in 2 days or less (the window still open), who is under the share, can
 * still make it, has not applied and has no coupon on file (thirtyReach). Once
 * ever. When it is made, the stopped-watching DM is not made in the same run
 * (the owner: "If #7 is due for the student in the same run, only #7 goes").
 *
 * IN REACH (the owner's definition): they can still get to the share by
 * watching about 2 hours a day until their deadline, counted from the lengths
 * of the videos they have not watched: the shortest of the counted videos not
 * watched that would take them there (discount.ts shortestSeconds, the map's
 * own "if you pick the shortest") last at most 120 minutes for each day left,
 * the days left counted to the millisecond. A counted video with no known
 * length makes that time unknown (shortestSeconds answers 0), and an unknown
 * time is not in reach.
 *
 * "A lesson finished" is the later of the last video the student finished
 * (the snapshot's lastWatchedAt: any lesson of the live course, its action
 * item shipped or not) and lastCountedCompletionAt (which also moves when they
 * ship an action item). lastCountedCompletionAt alone skips a watched action
 * lesson whose link is not in yet, and would tell a student who watched
 * yesterday that they had not been on the videos.
 */

import {
  discountEndsAt,
  discountState,
  requiredLessons,
  videosNeeded,
  type DiscountLesson,
  type DiscountRequestRow,
} from "@/lib/world/discount";
import { LAPSE_PLAIN, LAPSE_THIRTY } from "@/lib/dm-queue";

const DAY_MS = 86_400_000;

/** Days without a lesson that make a break on course days 1 to EARLY_LAST_DAY. */
export const STOPPED_DAYS_EARLY = 3;
/** Days without a lesson that make a break on course days after EARLY_LAST_DAY, to MONTH_ONE_LAST_DAY. */
export const STOPPED_DAYS_LATE = 5;
export const EARLY_LAST_DAY = 14;
/** The stopped-watching DM goes on course days 1 to 30 only, month 1. */
export const MONTH_ONE_LAST_DAY = 30;
/** The 30% closing DM goes this close to the end of the student's 2 weeks, or closer. */
export const CLOSING_WITHIN_MS = 2 * DAY_MS;
/** "About 2 hours a day": what a student can still watch each day left. */
export const WATCH_MINUTES_A_DAY = 120;

/** When the student last finished a lesson: the later of the two moments (above). Null when they finished none. */
export function lastLessonAt(snap: {
  lastWatchedAt: string | null;
  lastCountedCompletionAt: string | null;
}): string | null {
  const watched = Date.parse(snap.lastWatchedAt ?? "");
  const counted = Date.parse(snap.lastCountedCompletionAt ?? "");
  if (!Number.isFinite(watched) && !Number.isFinite(counted)) return null;
  if (!Number.isFinite(counted)) return snap.lastWatchedAt;
  if (!Number.isFinite(watched)) return snap.lastCountedCompletionAt;
  return watched >= counted ? snap.lastWatchedAt : snap.lastCountedCompletionAt;
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

/** What the two DMs read of a student, from the snapshot and the counted videos. */
export interface MomentStudent {
  signedIn: boolean;
  canceling: boolean;
  dayOnCourse: number;
  /** Lessons finished, as the nolessons.* rules count them (totalCompletedAcrossRegions). */
  lessonsFinished: number;
  /** lastLessonAt of the snapshot. */
  lastLessonAt: string | null;
  firstPaidAt: string | null;
  videos: ThirtyVideos;
}

/** Whole days without a lesson, when they make a stopped-watching break today; else null. */
export function stoppedWatchingBreak(m: MomentStudent, nowMs: number): number | null {
  if (!m.signedIn || m.canceling) return null;
  if (m.lessonsFinished <= 0) return null;
  // No counted videos (needed 0) is never under the share: nothing is judged.
  if (m.videos.done >= m.videos.needed) return null;
  if (m.dayOnCourse < 1 || m.dayOnCourse > MONTH_ONE_LAST_DAY) return null;
  const last = Date.parse(m.lastLessonAt ?? "");
  if (!Number.isFinite(last)) return null;
  const quietDays = Math.floor((nowMs - last) / DAY_MS);
  const breakDays = m.dayOnCourse <= EARLY_LAST_DAY ? STOPPED_DAYS_EARLY : STOPPED_DAYS_LATE;
  return quietDays >= breakDays ? quietDays : null;
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

/** Whether the 30% is still open to the student and in reach (above), and if not, why, in words for the task's summary. */
export function thirtyReach(f: ThirtyFacts): ThirtyReach {
  if (f.applied) return { inReach: false, why: "applied for the 30%" };
  if (f.couponCloses) return { inReach: false, why: "a coupon or no paid plan on file" };
  const state = discountState({
    now: f.now,
    firstPaidAt: f.firstPaidAt,
    lessons: f.lessons,
    videoDoneIds: f.videoDone,
    requests: f.requests,
  });
  if (state.kind === "pending" || state.kind === "approved" || state.kind === "applied") {
    return { inReach: false, why: "applied for the 30%" };
  }
  if (state.kind === "rejected") return { inReach: false, why: "their 30% request was turned down" };
  if (state.kind === "ready") return { inReach: false, why: "reached the 30%'s videos" };
  if (state.kind !== "locked") return { inReach: false, why: "the 30% is closed to them" };
  if (state.secondsLeft <= 0) return { inReach: false, why: "a counted video has no known length" };
  const daysLeft = (Date.parse(state.endsAt) - f.now.getTime()) / DAY_MS;
  if (state.secondsLeft > WATCH_MINUTES_A_DAY * 60 * daysLeft) {
    return { inReach: false, why: "out of reach at about 2 hours a day" };
  }
  return { inReach: true, endsAt: new Date(state.endsAt), left: state.lessonsLeft, secondsLeft: state.secondsLeft };
}

/** "about 50 minutes", "about 7.5 hours". */
function videoTime(seconds: number): string {
  if (seconds < 3600) {
    const minutes = Math.max(1, Math.round(seconds / 60));
    return `about ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  }
  const hours = Math.round(seconds / 360) / 10;
  return `about ${hours} ${hours === 1 ? "hour" : "hours"}`;
}

/** The 30% closing DM's summary when it is due for the student, else null. */
export function thirtyClosing(m: MomentStudent, reach: ThirtyReach, nowMs: number): string | null {
  if (!m.signedIn || m.canceling) return null;
  if (!reach.inReach) return null;
  const msLeft = reach.endsAt.getTime() - nowMs;
  if (msLeft < 0 || msLeft > CLOSING_WITHIN_MS) return null;
  const hours = Math.max(1, Math.round(msLeft / 3_600_000));
  return (
    `Day ${m.dayOnCourse} · the 30% closes in ${hours} ${hours === 1 ? "hour" : "hours"} · ` +
    `${m.videos.done} of ${m.videos.needed} videos, the ${reach.left} shortest left take ${videoTime(reach.secondsLeft)}.`
  );
}

/** The stopped-watching DM due for the student, the version and its summary, else null. */
export function stoppedWatching(
  m: MomentStudent,
  reach: ThirtyReach,
  nowMs: number,
): { scenarioId: string; summary: string } | null {
  const quietDays = stoppedWatchingBreak(m, nowMs);
  if (quietDays === null) return null;
  const head = `Day ${m.dayOnCourse} · no lesson finished in ${quietDays} days · ${m.videos.done} of ${m.videos.needed} videos for the 30%`;
  if (reach.inReach) {
    const daysLeft = Math.round(((reach.endsAt.getTime() - nowMs) / DAY_MS) * 10) / 10;
    return {
      scenarioId: LAPSE_THIRTY,
      summary: `${head}, the ${reach.left} shortest left take ${videoTime(reach.secondsLeft)}, ${daysLeft} days to go.`,
    };
  }
  return { scenarioId: LAPSE_PLAIN, summary: `${head} (${reach.why}).` };
}
