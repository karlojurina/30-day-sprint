/**
 * The course switch, as every part of the app that judges a student's history
 * sees it.
 *
 * Migration 2026_v104 writes `admin_config['curriculum_reset_at']` in the same
 * transaction that archives the old course's progress and copies the new
 * course into `lessons` / `regions`; its undo deletes the row. So the row and
 * the data can never disagree: no row means the old course is live, a row
 * means the new one is, and it holds the moment of the switch.
 *
 *   getCurriculumResetAt  reads that row; throws on a read error
 *   courseAnchorIso       where a student's course days start counting
 *   daysOnCourse          Day N on the course, sprintDayNumber's rounding
 *   activityLabel         moving / slipping / stalled, from the last lesson
 *   resetDateUtc          the switch's date, for the snapshot floor
 *   clampStartToReset     keeps a snapshot rebuild from reaching before it
 *   cutoverProblems       what /admin/cutover lists as wrong
 *
 * Code that reads the ACTIVE catalog (the world, its routes) branches on
 * CATALOG_IS_V2 instead, and never on this. The two signals are never mixed.
 *
 * No React, no Next, no environment. Only getCurriculumResetAt touches the
 * database, through the client it is handed, so admin client pages can use
 * this file as well as the crons.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export const CURRICULUM_RESET_KEY = "curriculum_reset_at";

const DAY_MS = 86_400_000;

/**
 * An ISO date and time with its zone written out, as v104 writes it
 * (`2026-10-20T18:30:00.000Z`). A time with no zone is refused: a server
 * would read it as UTC and an admin's browser as local time, and the two
 * would then count from different moments.
 */
const RESET_FORMAT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** A plain date, as `daily_progress_snapshots.snapshot_date` and the snapshot RPC take it. */
const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The reset moment in milliseconds, or a throw. A value that is there but
 * does not read as a date is a broken row, and guessing "no switch" from it
 * would judge every student on the old 30-day clock again.
 */
function resetMs(resetAt: string): number {
  const ms = Date.parse(resetAt);
  if (!RESET_FORMAT.test(resetAt) || !Number.isFinite(ms)) {
    throw new Error(
      `admin_config.${CURRICULUM_RESET_KEY} holds ${JSON.stringify(resetAt)}, which is not a date and time ` +
        `with its zone (like 2026-10-20T18:30:00.000Z). Fix the row; nothing can count course days until then.`,
    );
  }
  return ms;
}

/**
 * The moment of the course switch, or null while the old course is live.
 *
 * Throws on a read error, never returns null for one: a null here tells the
 * caller the old course is live, and a failed read that said so would flood
 * the CSM queue with tasks on the old clock. A cron that throws shows up in
 * `cron_runs`; a believable wrong answer shows up nowhere.
 *
 * `admin_config` is readable by team members only (RLS). Hand this a
 * service-role client or a team member's client. A student's client reads no
 * row and no error, so it would get null whatever the database holds.
 */
export async function getCurriculumResetAt(supabase: SupabaseClient): Promise<string | null> {
  const { data, error } = await supabase
    .from("admin_config")
    .select("value")
    .eq("key", CURRICULUM_RESET_KEY)
    .maybeSingle();
  if (error) {
    throw new Error(`admin_config.${CURRICULUM_RESET_KEY} could not be read: ${error.message}`);
  }
  if (!data) return null;
  const value = (data as { value: string }).value;
  resetMs(value);
  return value;
}

/**
 * Where a student's course days start: the later of their first payment
 * (joined_at when there is none, as sprintDayNumber's callers do) and the
 * switch. Returns whichever string is later, untouched, so with no switch the
 * anchor is exactly the one the old course used.
 */
export function courseAnchorIso(
  firstPaidAt: string | null,
  joinedAt: string,
  resetAt: string | null,
): string {
  const start = firstPaidAt ?? joinedAt;
  if (resetAt == null) return start;
  return resetMs(resetAt) > new Date(start).getTime() ? resetAt : start;
}

/**
 * Day N on the course, 1-indexed: Day 1 starts at the anchor. The same
 * rounding as sprintDayNumber in constants.ts, written out again because that
 * one reads the clock itself and cannot be handed `nowMs`. The client test
 * holds the two equal.
 */
export function daysOnCourse(anchorIso: string, nowMs: number = Date.now()): number {
  return Math.max(1, Math.ceil((nowMs - new Date(anchorIso).getTime()) / DAY_MS));
}

export type ActivityLabel = "not_started" | "moving" | "slipping" | "stalled";

/**
 * The new course's pace pill. There is no 30-day plan to be ahead of or
 * behind any more, so the pill says how long ago the student last finished a
 * counted lesson, in whole days: under 3 moving, 3 to 7 slipping, over 7
 * stalled. No lesson at all is not started; so is a date that does not parse.
 *
 * Hand it `student_last_counted_completion.last_completed_at`. After the
 * switch that view only holds lessons finished since the switch.
 */
export function activityLabel(
  lastCompletedAtIso: string | null,
  nowMs: number = Date.now(),
): ActivityLabel {
  if (lastCompletedAtIso == null) return "not_started";
  const t = Date.parse(lastCompletedAtIso);
  if (!Number.isFinite(t)) return "not_started";
  const days = Math.floor((nowMs - t) / DAY_MS);
  if (days < 3) return "moving";
  if (days <= 7) return "slipping";
  return "stalled";
}

/**
 * The switch's date in UTC (`YYYY-MM-DD`), or null with no switch. The same
 * date the database trigger `trg_daily_snapshots_reset_floor` takes from the
 * row: snapshots before it are frozen, the switch's own day is not.
 */
export function resetDateUtc(resetAt: string | null): string | null {
  if (resetAt == null) return null;
  return new Date(resetMs(resetAt)).toISOString().slice(0, 10);
}

/**
 * A snapshot rebuild's start date (`YYYY-MM-DD`), moved up to the switch's
 * date when it reaches before it. Rows before the switch were computed from
 * progress that is now archived; rebuilding them would write near 0%, and the
 * trigger refuses it anyway.
 *
 * With no switch the start comes back untouched and unchecked, as callers
 * passed it before this existed.
 */
export function clampStartToReset(startDate: string, resetAt: string | null): string {
  const floor = resetDateUtc(resetAt);
  if (floor == null) return startDate;
  if (!DATE_FORMAT.test(startDate)) {
    throw new Error(`clampStartToReset takes a date like 2026-10-20, got ${JSON.stringify(startDate)}.`);
  }
  return startDate < floor ? floor : startDate;
}

/** What /admin/cutover knows: the running build's values and the database's. */
export interface CutoverFacts {
  /** From getCurriculumResetAt. */
  resetAt: string | null;
  /** LESSONS_TABLE of the running build: "lessons", or "lessons_next" while CATALOG_TABLE_SUFFIX is set. */
  catalogTable: string;
  /** CATALOG_IS_V2 of the running build. */
  catalogIsV2: boolean;
  /** STUDENT_HOME of the running build. */
  studentHome: string;
  /** WORLD_IS_LIVE of the running build. Shown, never judged: a home of /world opens the world on its own. */
  worldLive: boolean;
  whopCourseIdSet: boolean;
  /** Every id in `regions`. */
  regionIds: string[];
  /** Rows in `lessons`: all of them, the counting ones, the ones with a Whop id. */
  lessons: number;
  countingLessons: number;
  lessonsWithWhopId: number;
  /** The `lessons` row marked `is_gate`, or null when none is (gateLessonId in discount.ts). */
  discountGateId: string | null;
  /** The lessons the discount asks for: counting watch lessons up to the gate with a row in `lesson_videos` (requiredLessons in discount.ts). */
  discountLessons: number;
}

const NEW_AREAS = ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"];

/**
 * The plain lines /admin/cutover shows, empty when all is well.
 *
 * Before the switch the build is expected to hold the old values, so the only
 * problem is a pair that cannot be right: students sent home to /world while
 * the old course is still in the tables. After it, each value the evening
 * needs is named on its own line, the catalog shape first, since that one
 * decides whether the old discount rule runs on the new data.
 */
export function cutoverProblems(f: CutoverFacts): string[] {
  const problems: string[] = [];
  if (f.resetAt == null) {
    if (f.studentHome === "/world") {
      problems.push("NEXT_PUBLIC_STUDENT_HOME is /world, but the course switch has not run");
    }
    return problems;
  }
  if (!f.catalogIsV2) problems.push("CATALOG_SHAPE=v2 is missing");
  if (f.catalogTable !== "lessons") problems.push("CATALOG_TABLE_SUFFIX must be empty");
  if (f.studentHome !== "/world") problems.push("NEXT_PUBLIC_STUDENT_HOME is not /world");
  if (!f.whopCourseIdSet) problems.push("WHOP_COURSE_ID is not set");
  if ([...f.regionIds].sort().join(",") !== NEW_AREAS.join(",")) {
    problems.push("the live areas are not a1..a8");
  }
  const noWhop = f.lessons - f.lessonsWithWhopId;
  if (noWhop > 0) {
    problems.push(noWhop === 1 ? "1 lesson has no Whop id" : `${noWhop} lessons have no Whop id`);
  }
  // Either one closes the discount for every student (discount.ts, "no-gate").
  if (f.discountGateId == null) {
    problems.push("No lesson is the discount gate");
  } else if (f.discountLessons === 0) {
    problems.push("No lesson up to the discount gate has a video, so the offer is closed for everyone");
  }
  return problems;
}
