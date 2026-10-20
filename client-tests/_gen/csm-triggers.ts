/**
 * CSM scenario trigger logic.
 *
 * Each scenario lives in [lovro-brief/context/scenarios.md] and has a
 * trigger spec in [lovro-brief/02-triggers.md]. This module:
 *
 *   1. Defines a per-student `StudentSnapshot` — everything a trigger
 *      needs to decide whether to fire (region progress, specific
 *      lesson ship state, recency).
 *
 *   2. Builds the snapshot from bulk-fetched data so the cron does
 *      one round-trip to the DB instead of N (for N students).
 *
 *   3. Exposes pure trigger functions: `(snapshot) → null | { reason }`.
 *      The cron loops scenarios over snapshots and inserts tasks for
 *      every non-null result.
 *
 * Day windows in the trigger conditions are kept because they're how
 * the cron filters internally. The user-facing templates already speak
 * region/task language, never "Day N" (see lovro-brief/context/templates.md).
 */

import type {
  Student,
  Condition,
  ConditionOp,
  RegionId,
  TriggerConfig,
} from "./types-erased.ts";
import { sprintDayNumber } from "./constants.ts";
import {
  activityLabel,
  courseAnchorIso,
  daysOnCourse,
} from "./curriculum-reset.ts";
import type { ActivityLabel } from "./curriculum-reset.ts";

// Re-export RegionId for callers that already import from this module —
// keeps existing import paths working without adding new modules.
export type { RegionId };

// ───────── Inputs ─────────

interface CompletionRow {
  student_id: string;
  lesson_id: string;
  completed_at: string | null;
  action_completed_at: string | null;
  /** v75.24: required for canonical isLessonComplete parity.
   *  Skipped lessons count toward path progression (the canonical
   *  rule in src/lib/progress.ts). Without this field, the cron
   *  silently undercounted progress for any student who skipped
   *  optional content (e.g. R4 editing breakdowns), then fired
   *  "no lessons watched" tasks against them. */
  skipped_at: string | null;
}

interface LessonRow {
  id: string;
  region_id: string;
  requires_action: boolean;
  /** Cutover WI-3: false for a lesson outside the count (l057, the
   *  pond row a7l19). Undefined counts, so a caller that never
   *  selected the column gets today's behaviour. Read only for
   *  lastCountedCompletionAt; every other count is as before. */
  counts_toward_progress?: boolean;
}

/**
 * Cutover WI-3: the live course as the CSM sees it. `regionOrder` is
 * every id in `regions`, by `order_num`; `resetAt` is
 * `admin_config.curriculum_reset_at` (getCurriculumResetAt), null while
 * the old course is live.
 */
export interface SnapshotCourse {
  regionOrder: string[];
  resetAt: string | null;
}

/** The old course with no switch: what a caller that passes no course gets. */
const OLD_COURSE: SnapshotCourse = {
  regionOrder: ["r1", "r2", "r3", "r4"],
  resetAt: null,
};

interface ExistingTask {
  student_id: string;
  scenario_id: string;
  status: string;
}

// ───────── Snapshot ─────────

export type PaceLabel = "behind" | "on_pace" | "ahead";

export interface StudentSnapshot {
  student: Pick<
    Student,
    | "id"
    | "name"
    | "joined_at"
    | "first_paid_at"
    | "membership_status"
    | "last_active_at"
    // v76 — drives the is_canceling custom-trigger condition.
    | "cancel_scheduled_at"
  > & {
    /** v46 — sourced from student_milestones, joined into the snapshot
     *  so condition evaluators can stay simple. */
    first_sprint_login_at: string | null;
  };
  /** Day counter, 1-indexed. v75.20: computed from first_paid_at
   *  (original Whop signup) with joined_at fallback. Returning
   *  customers don't get a day-counter reset on renewal. */
  day: number;

  /**
   * Region progress map. For each region:
   *   total              — number of lessons in the region
   *   watchedComplete    — lessons with completed_at NOT NULL
   *   fullyComplete      — lessons that count as "done" (watched, plus action_completed if requires_action)
   */
  regions: Record<string, { total: number; watchedComplete: number; fullyComplete: number }>;

  /** Per-action-lesson ship state, keyed by lesson_id. */
  shipped: Record<string, boolean>;

  /** Watched state for every lesson (true if completed_at is set),
   *  keyed by lesson_id. Used by the custom-trigger lesson_watched
   *  condition. */
  watched: Record<string, boolean>;

  /** Days since last completion (rounded down). null if no completion exists. */
  daysSinceLastCompletion: number | null;
  /** Days since last_active_at. */
  daysSinceLastActive: number;
  /** Set of scenarios with an OPEN or recently-COMPLETED task — used by X.1 reactivation. */
  recentTaskScenarios: Set<string>;

  // ───── Pace (added 2026-05-17) ─────
  //
  // Linear pacing model: expected = day × (totalLessons / 30). The
  // ratio tells us how a student is doing relative to a uniform 30-day
  // glide path. Below 0.5 = behind, 0.5–1.5 = on pace, above 1.5 = ahead.
  // Region pace is a second axis — "where they are vs where Day N
  // students should be in the curriculum" — because progressRatio
  // alone can't tell us if a Day-14 student is in R2 (good) or R4
  // (way ahead).

  /** Total lessons across all regions (the curriculum denominator). */
  totalLessonsInCurriculum: number;
  /** Total fully-complete lessons by this student (sum across regions). */
  completedLessons: number;
  /** Expected completions by day N under the linear model. */
  expectedLessons: number;
  /** completedLessons / expectedLessons. Capped at 0 minimum. */
  progressRatio: number;
  /** Quantized version of progressRatio for UI pills + filters. */
  progressLabel: PaceLabel;

  /** Highest region the student has any progress in. The first region
   *  of the course (r1, or a1 on the new course) if nothing. */
  currentRegion: string;
  /** Region the student should be in by Day N under the linear model.
   *  Always r1..r4: it means nothing on the new course, where the DSL
   *  never reads it (region_pace is no match there). */
  expectedRegion: string;
  /** Compares currentRegion vs expectedRegion. */
  regionPace: PaceLabel;

  // ───── The course switch (cutover WI-3) ─────
  //
  // Before the switch every field below equals what the old course
  // already had (dayOnCourse = day). After it, a student who paid
  // before the switch counts course days from the switch.

  /** True once admin_config.curriculum_reset_at exists. */
  courseIsNew: boolean;
  /** Day N on the course, from the later of first payment and the
   *  switch (courseAnchorIso + daysOnCourse). nolessons.* read this. */
  dayOnCourse: number;
  /** Whole days since that same anchor. */
  daysSinceCourseStart: number;
  /** Latest completed_at among complete rows on counting lessons: the
   *  rule of the view student_last_counted_completion. */
  lastCountedCompletionAt: string | null;
  /** activityLabel(lastCountedCompletionAt): the new course's pace pill. */
  activity: ActivityLabel;
}

/** Day N → expected region under the linear model. */
function expectedRegionForDay(day: number): RegionId {
  if (day <= 7) return "r1";
  if (day <= 14) return "r2";
  if (day <= 21) return "r3";
  return "r4";
}

/** Map ratio to label using the 0.5 / 1.5 breakpoints. */
function paceLabelFromRatio(ratio: number): PaceLabel {
  if (ratio < 0.5) return "behind";
  if (ratio > 1.5) return "ahead";
  return "on_pace";
}

/** Compare two region ids by order. r1 < r2 < r3 < r4. */
const REGION_ORDER: string[] = ["r1", "r2", "r3", "r4"];
function regionPaceLabel(current: string, expected: string): PaceLabel {
  const c = REGION_ORDER.indexOf(current);
  const e = REGION_ORDER.indexOf(expected);
  if (c < e) return "behind";
  if (c > e) return "ahead";
  return "on_pace";
}

export function buildStudentSnapshot(
  student: Student,
  completions: CompletionRow[],
  lessons: LessonRow[],
  regionTotals: Record<string, number>,
  existingTasks: ExistingTask[],
  /** v46 — pulled from student_milestones at the call site and passed
   *  in so the snapshot can carry first_sprint_login_at without the
   *  evaluator needing to know about the new table layout. */
  milestones: { first_sprint_login_at: string | null } | null,
  /** Cutover WI-3: the live course (regions read + reset read).
   *  Omitted = r1..r4 with no switch, so an unchanged caller behaves
   *  as before. */
  course: SnapshotCourse = OLD_COURSE,
): StudentSnapshot {
  const now = Date.now();
  // v75.20: anchor day count on first_paid_at (original Whop signup)
  // instead of joined_at (current subscription cycle start). Returning
  // customers don't get their day-counter reset on renewal.
  // v75.57: via the shared sprintDayNumber so snapshot day, NA-task
  // creation, and 3c stale-dismissal all share one definition.
  const anchorIso = student.first_paid_at ?? student.joined_at;
  const day = sprintDayNumber(anchorIso);

  // Cutover WI-3: course days start at the later of first payment and
  // the switch. With no switch the anchor is the one above, unchanged.
  const courseIsNew = course.resetAt != null;
  const courseAnchor = courseAnchorIso(
    student.first_paid_at ?? null,
    student.joined_at,
    course.resetAt,
  );
  const dayOnCourse = daysOnCourse(courseAnchor, now);
  const daysSinceCourseStart = Math.floor(
    (now - new Date(courseAnchor).getTime()) / 86_400_000,
  );

  const lessonsById = new Map(lessons.map((l) => [l.id, l]));

  // Aggregate per-region progress, one entry per region of the live
  // course (r1..r4 before the switch, a1..a8 after it).
  const regions: StudentSnapshot["regions"] = {};
  for (const rid of course.regionOrder) {
    regions[rid] = { total: regionTotals[rid] ?? 0, watchedComplete: 0, fullyComplete: 0 };
  }

  const shipped: Record<string, boolean> = {};
  const watched: Record<string, boolean> = {};
  let latestCompletionAt: number | null = null;
  let latestCountedAt: number | null = null;
  let lastCountedCompletionAt: string | null = null;

  for (const c of completions) {
    const lesson = lessonsById.get(c.lesson_id);
    if (!lesson) continue;
    const region = regions[lesson.region_id];
    if (!region) continue;

    // v75.24: skipped_at counts as "path progression" per the
    // canonical formula in src/lib/progress.ts. Without this branch,
    // a student who skipped optional R4 lessons would appear to the
    // cron as "0 lessons watched" while the student profile correctly
    // counted them as done — exactly the milicevic divergence.
    const watchedOrSkipped = Boolean(c.completed_at) || Boolean(c.skipped_at);
    if (watchedOrSkipped) {
      region.watchedComplete += 1;
      watched[c.lesson_id] = true;
      if (c.completed_at) {
        const t = new Date(c.completed_at).getTime();
        if (latestCompletionAt === null || t > latestCompletionAt) {
          latestCompletionAt = t;
        }
      }
    }

    // Canonical isLessonComplete formula (must stay in lockstep with
    // src/lib/progress.ts and the student_progress_counts view):
    //   - skipped_at IS NOT NULL                       → complete
    //   - requires_action=false AND completed_at       → complete
    //   - requires_action=true AND completed_at AND
    //     action_completed_at                          → complete
    const fullyDone = c.skipped_at
      ? true
      : lesson.requires_action
        ? Boolean(c.completed_at && c.action_completed_at)
        : Boolean(c.completed_at);
    if (fullyDone) region.fullyComplete += 1;

    // Cutover WI-3: the view student_last_counted_completion's rule —
    // complete, on a counting lesson with completed_at, at the later of
    // completed_at and action_completed_at (v103 after the database review,
    // F5: shipping an action item days after the video is activity too).
    if (fullyDone && c.completed_at && lesson.counts_toward_progress !== false) {
      const moment =
        c.action_completed_at &&
        new Date(c.action_completed_at).getTime() > new Date(c.completed_at).getTime()
          ? c.action_completed_at
          : c.completed_at;
      const t = new Date(moment).getTime();
      if (latestCountedAt === null || t > latestCountedAt) {
        latestCountedAt = t;
        lastCountedCompletionAt = moment;
      }
    }

    if (lesson.requires_action) {
      shipped[c.lesson_id] = Boolean(c.action_completed_at);
    }
  }

  const daysSinceLastCompletion =
    latestCompletionAt === null
      ? null
      : Math.floor((now - latestCompletionAt) / 86_400_000);
  const daysSinceLastActive = Math.floor(
    (now - new Date(student.last_active_at).getTime()) / 86_400_000,
  );

  const recentTaskScenarios = new Set(
    existingTasks
      .filter((t) => t.student_id === student.id)
      .map((t) => t.scenario_id),
  );

  // ───── Pace calculation ─────
  const totalLessonsInCurriculum = Object.values(regions).reduce(
    (sum, r) => sum + r.total,
    0,
  );
  const completedLessons = Object.values(regions).reduce(
    (sum, r) => sum + r.fullyComplete,
    0,
  );
  const lessonsPerDay =
    totalLessonsInCurriculum > 0 ? totalLessonsInCurriculum / 30 : 0;
  const expectedLessons = Math.max(0, day * lessonsPerDay);
  const progressRatio =
    expectedLessons > 0 ? completedLessons / expectedLessons : 0;
  const progressLabel = paceLabelFromRatio(progressRatio);

  // Highest region with any fully-completed lesson. If none, the
  // course's first region (they haven't started anything).
  let currentRegion: string = course.regionOrder[0] ?? "r1";
  for (const rid of course.regionOrder) {
    if ((regions[rid]?.fullyComplete ?? 0) > 0) currentRegion = rid;
  }
  const expectedRegion = expectedRegionForDay(day);
  const regionPace = regionPaceLabel(currentRegion, expectedRegion);

  return {
    student: {
      id: student.id,
      name: student.name,
      joined_at: student.joined_at,
      first_paid_at: student.first_paid_at ?? null,
      membership_status: student.membership_status,
      last_active_at: student.last_active_at,
      cancel_scheduled_at: student.cancel_scheduled_at ?? null,
      first_sprint_login_at: milestones?.first_sprint_login_at ?? null,
    },
    day,
    regions,
    shipped,
    watched,
    daysSinceLastCompletion,
    daysSinceLastActive,
    recentTaskScenarios,
    totalLessonsInCurriculum,
    completedLessons,
    expectedLessons,
    progressRatio,
    progressLabel,
    currentRegion,
    expectedRegion,
    regionPace,
    courseIsNew,
    dayOnCourse,
    daysSinceCourseStart,
    lastCountedCompletionAt,
    activity: activityLabel(lastCountedCompletionAt, now),
  };
}

/**
 * Lightweight per-student snapshot for UI surfaces (students list,
 * student detail header, task cards). Same math as the cron's
 * StudentSnapshot but without the existing-tasks join — UIs don't
 * need recentTaskScenarios.
 */
export interface PaceSummary {
  day: number;
  completedLessons: number;
  expectedLessons: number;
  progressRatio: number;
  progressLabel: PaceLabel;
  currentRegion: RegionId;
  expectedRegion: RegionId;
  regionPace: PaceLabel;
}

export function buildPaceSummary(
  joinedAt: string,
  completedLessons: number,
  totalLessons: number,
  currentRegion: RegionId,
): PaceSummary {
  const day = sprintDayNumber(joinedAt);
  const lessonsPerDay = totalLessons > 0 ? totalLessons / 30 : 0;
  const expectedLessons = Math.max(0, day * lessonsPerDay);
  const progressRatio =
    expectedLessons > 0 ? completedLessons / expectedLessons : 0;
  const expectedRegion = expectedRegionForDay(day);
  return {
    day,
    completedLessons,
    expectedLessons,
    progressRatio,
    progressLabel: paceLabelFromRatio(progressRatio),
    currentRegion,
    expectedRegion,
    regionPace: regionPaceLabel(currentRegion, expectedRegion),
  };
}

// ───────── Trigger helpers ─────────

function regionComplete(snap: StudentSnapshot, rid: string): boolean {
  const r = snap.regions[rid];
  if (!r || r.total === 0) return false;
  return r.fullyComplete >= r.total;
}

function regionIncomplete(snap: StudentSnapshot, rid: string): boolean {
  const r = snap.regions[rid];
  if (!r || r.total === 0) return false;
  return r.fullyComplete < r.total;
}

/**
 * True when the region's fullyComplete ratio is below `threshold`.
 * Replaces the binary regionIncomplete for triggers that should fire
 * only when a student is meaningfully behind, not when they're one
 * lesson away from finishing.
 */
function regionBelow(
  snap: StudentSnapshot,
  rid: string,
  threshold: number,
): boolean {
  const r = snap.regions[rid];
  if (!r || r.total === 0) return false;
  return r.fullyComplete / r.total < threshold;
}

function totalCompletedAcrossRegions(snap: StudentSnapshot): number {
  return Object.values(snap.regions).reduce(
    (sum, r) => sum + r.watchedComplete,
    0,
  );
}

// ───────── Triggers (P1) ─────────
//
// Each returns a behavior summary string (concrete state at fire time)
// when the trigger condition is met, or null otherwise. The cron uses
// these results verbatim as tasks.behavior_summary.

export type TriggerCheck = (snap: StudentSnapshot) => string | null;

// v58 - brief v3 situation-based triggers. Evaluation order matters
// because of supersession: on a given day, ZL > WNS > B. We use
// `recentTaskScenarios` to detect supersession (a higher-priority
// scenario already fired today suppresses the lower one).
//
// `welcome.day1` is NOT here - Astrid sends it manually from
// /admin/templates as the Day 1 SOP. `stalled.*` scenarios live in
// /api/cron/check-na-tasks (separate cron because they target
// students with joined_at IS NULL). `month2.entry` will need a
// Whop renewal webhook handler (not in this round).
const rawTriggers: Record<string, TriggerCheck> = {
  // nolessons.day3 / .day7 / .day14 - student LOGGED IN but hasn't
  // started any lessons. Highest-priority intervention in the v3
  // ladder (ZL = "zero lessons").
  //
  // The first_sprint_login_at gate is critical: Whop's
  // membership.activated webhook stamps joined_at on insert, so a
  // student who paid but never opened our app would otherwise
  // satisfy "Day N, 0 lessons" and double-fire alongside the NA
  // (stalled.*) pipeline. These triggers only fire AFTER the
  // student has actually opened the dashboard.
  //
  // Cutover WI-3: counted in course days (s.dayOnCourse), so a student
  // who paid before the switch starts again at Day 1 on the switch and
  // is not judged on lessons the switch archived. Before the switch
  // dayOnCourse equals day.
  "nolessons.day3": (s) => {
    if (!s.student.first_sprint_login_at) return null;
    if (s.dayOnCourse !== 3 && s.dayOnCourse !== 4) return null; // Day 3, +1 grace
    if (totalCompletedAcrossRegions(s) > 0) return null;
    if (s.recentTaskScenarios.has("nolessons.day3")) return null;
    return `Day ${s.dayOnCourse} · 0 lessons watched, 0 actions shipped.`;
  },
  "nolessons.day7": (s) => {
    if (!s.student.first_sprint_login_at) return null;
    if (s.dayOnCourse < 7 || s.dayOnCourse > 9) return null;
    if (totalCompletedAcrossRegions(s) > 0) return null;
    if (s.recentTaskScenarios.has("nolessons.day7")) return null;
    return `Day ${s.dayOnCourse} · full week in, still 0 lessons watched.`;
  },
  "nolessons.day14": (s) => {
    if (!s.student.first_sprint_login_at) return null;
    if (s.dayOnCourse < 14 || s.dayOnCourse > 17) return null;
    if (totalCompletedAcrossRegions(s) > 0) return null;
    if (s.recentTaskScenarios.has("nolessons.day14")) return null;
    return `Day ${s.dayOnCourse} · halfway through sprint, still 0 lessons.`;
  },

  // noship.r1.day7 - watched most of R1 but didn't ship the two
  // R1 action items (l018 + l020). Mid-priority. ZL wins if it
  // also matches (which it shouldn't here since they DID watch).
  //
  // Cutover WI-3 (C5): noship.* and pace.* judge the old course's
  // regions and its 30-day clock, so they stop on the new course with
  // no replacement. `r1?.` because the new course has no r1.
  "noship.r1.day7": (s) => {
    if (s.courseIsNew) return null;
    if (!s.student.first_sprint_login_at) return null;
    if (s.day < 7 || s.day > 10) return null;
    if ((s.regions.r1?.watchedComplete ?? 0) < 10) return null;
    if (s.shipped["l018"] || s.shipped["l020"]) return null;
    if (s.recentTaskScenarios.has("noship.r1.day7")) return null;
    return `Day ${s.day} · ${s.regions.r1?.watchedComplete ?? 0} R1 lessons watched, neither l018 (Organic) nor l020 (UGC) shipped.`;
  },
  // noship.r2.day14 - same pattern for R2 actions (l022 + l024).
  "noship.r2.day14": (s) => {
    if (s.courseIsNew) return null;
    if (!s.student.first_sprint_login_at) return null;
    if (s.day < 14 || s.day > 17) return null;
    if ((s.regions.r2?.watchedComplete ?? 0) < 5) return null;
    if (s.shipped["l022"] || s.shipped["l024"]) return null;
    if (s.recentTaskScenarios.has("noship.r2.day14")) return null;
    return `Day ${s.day} · ${s.regions.r2?.watchedComplete ?? 0} R2 lessons watched, neither l022 (VSL) nor l024 (High-Prod) shipped.`;
  },

  // pace.day7 / .day14 / .day21 - LOWEST priority. Behind on pace
  // without the more-specific ZL or noship state. Supersession
  // suppresses pace if a higher-priority scenario already fired
  // today for this student.
  //
  // Threshold: progressRatio < 0.85 (per the brief's "5+ lessons
  // behind expected" guidance, generalized to a ratio).
  "pace.day7": (s) => {
    if (s.courseIsNew) return null;
    if (!s.student.first_sprint_login_at) return null;
    if (s.day < 7 || s.day > 9) return null;
    if (s.progressRatio >= 0.85) return null;
    if (totalCompletedAcrossRegions(s) === 0) return null; // ZL wins
    if (s.recentTaskScenarios.has("nolessons.day7")) return null;
    if (s.recentTaskScenarios.has("noship.r1.day7")) return null;
    if (s.recentTaskScenarios.has("pace.day7")) return null;
    return `Day ${s.day} · behind pace (${(s.progressRatio * 100).toFixed(0)}% of expected). Discount window still open.`;
  },
  "pace.day14": (s) => {
    if (s.courseIsNew) return null;
    if (!s.student.first_sprint_login_at) return null;
    if (s.day < 14 || s.day > 17) return null;
    if (s.progressRatio >= 0.85) return null;
    if (totalCompletedAcrossRegions(s) === 0) return null;
    if (s.recentTaskScenarios.has("nolessons.day14")) return null;
    if (s.recentTaskScenarios.has("noship.r2.day14")) return null;
    if (s.recentTaskScenarios.has("pace.day14")) return null;
    return `Day ${s.day} · behind pace (${(s.progressRatio * 100).toFixed(0)}% of expected). Halfway, discount likely slipped.`;
  },
  "pace.day21": (s) => {
    if (s.courseIsNew) return null;
    if (!s.student.first_sprint_login_at) return null;
    if (s.day < 21 || s.day > 24) return null;
    if (s.progressRatio >= 0.85) return null;
    if (totalCompletedAcrossRegions(s) === 0) return null;
    if (s.recentTaskScenarios.has("pace.day21")) return null;
    return `Day ${s.day} · behind pace (${(s.progressRatio * 100).toFixed(0)}% of expected). 9 days left, R4 imminent.`;
  },
};

/**
 * v85.1 — canceling suppression. A student who clicked cancel (Whop
 * "Canceling": cancel_scheduled_at set, access still active) is owned
 * by the save-the-sale flow. Every OTHER trigger goes quiet for them,
 * otherwise the queue tells the CSM to send "you're behind pace" to
 * someone who already decided to leave (the 2026-07-13 screenshot).
 */
export function snapshotIsCanceling(s: StudentSnapshot): boolean {
  return (
    Boolean(s.student.cancel_scheduled_at) &&
    (s.student.membership_status === "active" ||
      s.student.membership_status === "past_due")
  );
}

// v85.1 — single wrap point: creation (section 2), 3c auto-dismiss,
// and the real-time evaluator all call these same functions, so
// built-in triggers returning null for canceling students both stops
// NEW wrong tasks and auto-dismisses EXISTING ones on the next pass.
export const triggers: Record<string, TriggerCheck> = Object.fromEntries(
  Object.entries(rawTriggers).map(([id, fn]) => [
    id,
    ((s) => (snapshotIsCanceling(s) ? null : fn(s))) as TriggerCheck,
  ]),
);

/**
 * v58 - map disengagement_alerts rows (created by check-engagement)
 * to the closest brief-v3 scenario.
 *
 *   no_lessons_3d  → `nolessons.day{N}` based on the day tier
 *   no_login_5d    → `pace.day{N}` (student hasn't been around)
 *   no_tasks_7d    → `pace.day{N}` (student isn't completing
 *                    things)
 *
 * Day-tier matching is loose: the trigger functions themselves
 * also gate by day, so this just picks the right scenario when
 * the engagement cron noticed a problem on a day-N tier.
 *
 * Cutover WI-3: moved here from check-csm-tasks/route.ts so the client
 * test can reach it, and handed the snapshot. The day is dayOnCourse
 * (equal to the old sprint day before the switch). On the new course
 * there is no pace.* to map to, so no_tasks_7d and no_login_5d map to
 * nothing (C5), and no_lessons_3d maps only for a student with 0
 * counted lessons.
 */
export function pickExistingAlertScenario(
  alertType: string,
  snap: StudentSnapshot,
): string | null {
  const day = snap.dayOnCourse;
  if (alertType === "no_lessons_3d") {
    if (snap.courseIsNew && snap.completedLessons !== 0) return null;
    if (day <= 5)  return "nolessons.day3";
    if (day <= 10) return "nolessons.day7";
    if (day <= 17) return "nolessons.day14";
    return null;
  }
  if (alertType === "no_tasks_7d" || alertType === "no_login_5d") {
    if (snap.courseIsNew) return null;
    if (day <= 9)  return "pace.day7";
    if (day <= 17) return "pace.day14";
    if (day <= 24) return "pace.day21";
    return null;
  }
  return null;
}

/** Cancel-path alerts only fire if the student is genuinely
 *  behind. Skips when progressRatio >= 0.6 — a Day-7 student who
 *  watched 8 lessons in one weekend is fine even if they haven't
 *  logged in for five days. */
const CANCEL_PATH_PROGRESS_GATE = 0.6;

/**
 * The scenario and behavior summary an alert becomes, or null. The
 * check-csm-tasks alert loop calls this after its canceling and login
 * gates and before its template lookup.
 *
 * Old course: the progress gate, and a summary ending in the pace
 * ratio, as before. New course: the gate is the 0-counted-lessons rule
 * inside pickExistingAlertScenario, and the summary carries no pace
 * (there is no 30-day plan to be behind).
 */
export function alertTask(
  alertType: string,
  label: string,
  snap: StudentSnapshot,
): { scenarioId: string; summary: string } | null {
  const scenarioId = pickExistingAlertScenario(alertType, snap);
  if (!scenarioId) return null;
  if (snap.courseIsNew) {
    return { scenarioId, summary: `Day ${snap.dayOnCourse} · ${label}.` };
  }
  // Progress gate — all four mapped scenarios are cancel_path.
  if (snap.progressRatio >= CANCEL_PATH_PROGRESS_GATE) return null;
  return {
    scenarioId,
    summary: `Day ${snap.dayOnCourse} · ${label} · pace ${snap.progressRatio.toFixed(2)}.`,
  };
}

/* ─────────────────────────────────────────────────────────────────
 * Custom triggers (v34) — built from the JSON DSL Karlo edits via
 * /admin/templates. The metric registry below is the single source
 * of truth for which metrics exist + what their labels look like.
 * Frontend imports it for the dropdown options; backend imports it
 * to evaluate conditions.
 * ──────────────────────────────────────────────────────────────── */

export type MetricInputType = "number" | "boolean" | "enum" | "param-number" | "param-boolean";

export interface MetricDef {
  /** Stable internal id — what lands in the trigger_config JSON. */
  id: import("./types-erased.ts").ConditionMetric;
  /** What the user sees in the metric dropdown. */
  label: string;
  /** "number" → numeric input + the six numeric ops.
   *  "param-number" → also has a sub-param (region/lesson).
   *  "boolean" → only "is" / "is not", value implied (true/false).
   *  "param-boolean" → boolean + a sub-param (region/lesson).
   *  "enum" → "is" / "is not" + a value dropdown. */
  input: "number" | "boolean" | "enum";
  /** When the metric has a sub-param like region or lesson_id. */
  param?: "region" | "lesson";
  /** For enum metrics — list of allowed values. */
  enumValues?: ReadonlyArray<string>;
  /** Suffix shown next to numeric inputs (e.g. "%"). */
  unit?: string;
  /** Compact natural-language renderer used in behavior summaries +
   *  the live preview line on the template editor. */
  describe: (cond: Condition) => string;
}

/** Friendly labels for region ids — keep in sync with the v20 region names. */
export const REGION_LABEL: Record<string, string> = {
  r1: "Region 1 (Foundation)",
  r2: "Region 2 (Production)",
  r3: "Region 3 (Strategy)",
  r4: "Region 4 (Gate of Possibilities)",
};

/**
 * Cutover WI-3: a region's label for summaries and the editor preview.
 * The old label for r1..r4, `Area N` for an area aN of the new course,
 * else the id itself (as `REGION_LABEL[id] ?? id` did).
 */
export function regionLabel(id: string): string {
  const area = /^a(\d+)$/.exec(id);
  return REGION_LABEL[id] ?? (area ? `Area ${area[1]}` : id);
}

/** Lessons that students explicitly ship an ad for. Used by the
 *  lesson_shipped dropdown in the condition builder. */
export const ACTION_LESSONS: Array<{ id: string; label: string }> = [
  { id: "l018", label: "Organic Ad (l018)" },
  { id: "l020", label: "UGC Ad (l020)" },
  { id: "l022", label: "VSL Ad (l022)" },
  { id: "l024", label: "High-Production Ad (l024)" },
  { id: "l049", label: "Static Ads (l049)" },
];

const opPhrase: Record<ConditionOp, string> = {
  is: "is",
  is_not: "is not",
  at_least: "is at least",
  more_than: "is more than",
  at_most: "is at most",
  less_than: "is less than",
};

function describeNumeric(label: string, c: Condition, unit = ""): string {
  if ("value" in c && typeof c.value === "number") {
    return `${label} ${opPhrase[c.op]} ${c.value}${unit}`;
  }
  return label;
}

function describeBoolean(label: string, c: Condition, posVerb = "is"): string {
  return `${label} ${c.op === "is" ? posVerb : `is not ${posVerb.replace(/^is\s+/, "")}`}`.trim();
}

export const METRICS: Record<import("./types-erased.ts").ConditionMetric, MetricDef> = {
  day_number: {
    id: "day_number",
    label: "Day in the program",
    input: "number",
    describe: (c) => describeNumeric("Day in the program", c),
  },
  total_lessons_watched: {
    id: "total_lessons_watched",
    label: "Total lessons watched",
    input: "number",
    describe: (c) => describeNumeric("Total lessons watched", c),
  },
  region_lessons_watched: {
    id: "region_lessons_watched",
    label: "Lessons watched in a region",
    input: "number",
    param: "region",
    describe: (c) => {
      if ("region" in c) {
        return describeNumeric(
          `Lessons watched in ${regionLabel(c.region)}`,
          c,
        );
      }
      return "Lessons watched in a region";
    },
  },
  region_completion_pct: {
    id: "region_completion_pct",
    label: "Region completion %",
    input: "number",
    param: "region",
    unit: "%",
    describe: (c) => {
      if ("region" in c) {
        return describeNumeric(
          `${regionLabel(c.region)} completion`,
          c,
          "%",
        );
      }
      return "Region completion %";
    },
  },
  region_complete: {
    id: "region_complete",
    label: "Region is fully complete",
    input: "boolean",
    param: "region",
    describe: (c) => {
      if ("region" in c) {
        return c.op === "is"
          ? `${regionLabel(c.region)} is complete`
          : `${regionLabel(c.region)} is not complete`;
      }
      return "Region completion";
    },
  },
  lesson_shipped: {
    id: "lesson_shipped",
    label: "Shipped action item",
    input: "boolean",
    param: "lesson",
    describe: (c) => {
      if ("lesson_id" in c) {
        const lesson =
          ACTION_LESSONS.find((l) => l.id === c.lesson_id)?.label ?? c.lesson_id;
        return c.op === "is"
          ? `Shipped: ${lesson}`
          : `Not shipped: ${lesson}`;
      }
      return "Action item shipped";
    },
  },
  lesson_watched: {
    id: "lesson_watched",
    label: "Watched a specific lesson",
    input: "boolean",
    param: "lesson",
    describe: (c) => {
      if ("lesson_id" in c) {
        const lesson =
          ACTION_LESSONS.find((l) => l.id === c.lesson_id)?.label ?? c.lesson_id;
        return c.op === "is"
          ? `Watched lesson ${lesson}`
          : `Did not watch lesson ${lesson}`;
      }
      return "Lesson watched";
    },
  },
  days_since_last_completion: {
    id: "days_since_last_completion",
    label: "Days since last lesson",
    input: "number",
    describe: (c) => describeNumeric("Days since last lesson", c),
  },
  days_since_last_login: {
    id: "days_since_last_login",
    label: "Days since last login",
    input: "number",
    describe: (c) => describeNumeric("Days since last login", c),
  },
  membership_status: {
    id: "membership_status",
    label: "Membership status",
    input: "enum",
    enumValues: ["active", "canceled", "past_due", "expired"] as const,
    describe: (c) => {
      if ("value" in c && typeof c.value === "string") {
        return `Membership status ${c.op === "is" ? "is" : "is not"} ${c.value}`;
      }
      return "Membership status";
    },
  },
  // ─── Pace metrics ───
  // progress_ratio: numeric, 1.0 = on the linear glide path.
  // progress_label / region_pace: enum, three states.
  progress_ratio: {
    id: "progress_ratio",
    label: "Progress vs expected (ratio)",
    input: "number",
    describe: (c) => describeNumeric("Progress vs expected", c),
  },
  progress_label: {
    id: "progress_label",
    label: "Progress pace",
    input: "enum",
    enumValues: ["behind", "on_pace", "ahead"] as const,
    describe: (c) => {
      if ("value" in c && typeof c.value === "string") {
        return `Progress pace ${c.op === "is" ? "is" : "is not"} ${c.value.replace("_", " ")}`;
      }
      return "Progress pace";
    },
  },
  region_pace: {
    id: "region_pace",
    label: "Region pace (where they are vs where Day N expects)",
    input: "enum",
    enumValues: ["behind", "on_pace", "ahead"] as const,
    describe: (c) => {
      if ("value" in c && typeof c.value === "string") {
        return `Region pace ${c.op === "is" ? "is" : "is not"} ${c.value.replace("_", " ")}`;
      }
      return "Region pace";
    },
  },
  has_logged_into_app: {
    id: "has_logged_into_app",
    label: "Has logged into the sprint app",
    input: "boolean",
    describe: (c) =>
      c.op === "is"
        ? "Has logged into the sprint app"
        : "Has NOT logged into the sprint app",
  },
  // v76 — Whop "Canceling" state: clicked cancel, still has access
  // through end of billing cycle. THE save-the-sale window. True only
  // while membership is still active/past_due (terminal students are
  // churned, not canceling).
  is_canceling: {
    id: "is_canceling",
    label: "Is canceling (clicked cancel, still has access)",
    input: "boolean",
    describe: (c) =>
      c.op === "is"
        ? "Is canceling (cancel scheduled)"
        : "Is NOT canceling",
  },
};

/* ─────────────────────────────────────────────────────────────────
 * Condition evaluation. Pulls the value out of the snapshot, then
 * compares against the user-set value using the user-chosen op.
 * ──────────────────────────────────────────────────────────────── */

function compareNumber(actual: number, op: ConditionOp, target: number): boolean {
  switch (op) {
    case "is":
      return actual === target;
    case "is_not":
      return actual !== target;
    case "at_least":
      return actual >= target;
    case "more_than":
      return actual > target;
    case "at_most":
      return actual <= target;
    case "less_than":
      return actual < target;
    default:
      return false;
  }
}

function getNumericValue(snap: StudentSnapshot, c: Condition): number | null {
  switch (c.metric) {
    case "day_number":
      // After the switch: course days, as nolessons.* count them. On
      // payment days a template pairing this with a lesson count would
      // fire on the evening for every student, whose counts all start
      // again at 0. Before the switch dayOnCourse is not read.
      return snap.courseIsNew ? snap.dayOnCourse : snap.day;
    case "total_lessons_watched":
      return Object.values(snap.regions).reduce(
        (sum, r) => sum + r.watchedComplete,
        0,
      );
    case "region_lessons_watched":
      return "region" in c
        ? snap.regions[c.region]?.watchedComplete ?? 0
        : null;
    case "region_completion_pct":
      if ("region" in c) {
        const r = snap.regions[c.region];
        if (!r || r.total === 0) return 0;
        return Math.round((r.fullyComplete / r.total) * 100);
      }
      return null;
    case "days_since_last_completion":
      // Cutover WI-3: on the new course, a student with no lesson since
      // the switch has gone this many days since their course start.
      return (
        snap.daysSinceLastCompletion ??
        (snap.courseIsNew ? snap.daysSinceCourseStart : 999)
      );
    case "days_since_last_login":
      return snap.daysSinceLastActive;
    case "progress_ratio":
      // Cutover WI-3 (C4): a ratio against the 30-day plan; the new
      // course has none, so the condition is no match there.
      if (snap.courseIsNew) return null;
      return Math.round(snap.progressRatio * 100) / 100;
    default:
      return null;
  }
}

function evalCondition(snap: StudentSnapshot, c: Condition): boolean {
  switch (c.metric) {
    case "region_complete":
      if (!("region" in c)) return false;
      {
        const r = snap.regions[c.region];
        const complete = r ? r.fullyComplete >= r.total && r.total > 0 : false;
        return c.op === "is" ? complete : !complete;
      }
    case "lesson_shipped":
      if (!("lesson_id" in c)) return false;
      {
        const shipped = Boolean(snap.shipped[c.lesson_id]);
        return c.op === "is" ? shipped : !shipped;
      }
    case "lesson_watched":
      if (!("lesson_id" in c)) return false;
      {
        const watched = Boolean(snap.watched[c.lesson_id]);
        return c.op === "is" ? watched : !watched;
      }
    case "membership_status":
      if (!("value" in c) || typeof c.value !== "string") return false;
      return c.op === "is"
        ? snap.student.membership_status === c.value
        : snap.student.membership_status !== c.value;
    // Cutover WI-3 (C4): both pace metrics judge the 30-day plan; on the
    // new course they are no match whatever the op.
    case "progress_label":
      if (snap.courseIsNew) return false;
      if (!("value" in c) || typeof c.value !== "string") return false;
      return c.op === "is"
        ? snap.progressLabel === c.value
        : snap.progressLabel !== c.value;
    case "region_pace":
      if (snap.courseIsNew) return false;
      if (!("value" in c) || typeof c.value !== "string") return false;
      return c.op === "is"
        ? snap.regionPace === c.value
        : snap.regionPace !== c.value;
    case "has_logged_into_app": {
      // True when first_sprint_login_at is stamped (non-null).
      const loggedIn = Boolean(snap.student.first_sprint_login_at);
      return c.op === "is" ? loggedIn : !loggedIn;
    }
    case "is_canceling": {
      // v76 — mirrors isCanceling in admin/metrics-definitions.ts:
      // cancel_scheduled_at stamped AND membership still active/past_due
      // (a terminal student is churned, not canceling — the trigger
      // auto-dismisses via 3c/real-time re-eval once they churn or
      // re-activate, closing the save-the-sale window either way).
      const canceling =
        Boolean(snap.student.cancel_scheduled_at) &&
        (snap.student.membership_status === "active" ||
          snap.student.membership_status === "past_due");
      return c.op === "is" ? canceling : !canceling;
    }
    default: {
      const actual = getNumericValue(snap, c);
      if (actual == null) return false;
      const target =
        "value" in c && typeof c.value === "number" ? c.value : 0;
      return compareNumber(actual, c.op, target);
    }
  }
}

/**
 * Evaluate a TriggerConfig against a student snapshot.
 *
 * Returns:
 *   match   — true when EVERY condition in `config.all` passes
 *   summary — concrete behavior summary for tasks.behavior_summary,
 *             e.g. "Day 7 · 12 R1 lessons watched · l018 not shipped"
 */
export function evaluateCustomTrigger(
  snap: StudentSnapshot,
  config: TriggerConfig,
): { match: boolean; summary: string } {
  if (!Array.isArray(config?.all) || config.all.length === 0) {
    return { match: false, summary: "" };
  }
  // v85.1 — canceling students only match canceling-aware templates
  // (configs that reference the is_canceling metric). Everything else
  // goes quiet for them; the save-the-sale flow owns this student.
  if (
    snapshotIsCanceling(snap) &&
    !config.all.some((c) => c.metric === "is_canceling")
  ) {
    return { match: false, summary: "" };
  }
  for (const c of config.all) {
    if (!evalCondition(snap, c)) return { match: false, summary: "" };
  }
  const pieces = config.all.map((c) => METRICS[c.metric].describe(c));
  return { match: true, summary: pieces.join(" · ") };
}

/**
 * Bucket label used in the cron's Discord summary + the admin
 * task UI. v57 - replaced the old W-series + X.1 entries with the
 * descriptive brief v3 slugs. Bucket values still drive the
 * task-priority slot (cancel_path beats at_risk).
 */
export const SCENARIO_BUCKET: Record<string, string> = {
  // Welcome event (manual send from /admin/templates)
  "welcome.day1": "event",
  // Stalled student (paid, no dashboard login) - cancel_path
  // because they're trending toward churn
  "stalled.discord.day3": "cancel_path",
  "stalled.discord.day5": "cancel_path",
  "stalled.discord.day7": "cancel_path",
  "stalled.discord.day10": "cancel_path",
  "stalled.whop.day3": "cancel_path",
  "stalled.whop.day5": "cancel_path",
  "stalled.whop.day7": "cancel_path",
  "stalled.whop.day10": "cancel_path",
  // Activated but stuck (at_risk)
  "nolessons.day3": "at_risk",
  "nolessons.day7": "at_risk",
  "nolessons.day14": "at_risk",
  "noship.r1.day7": "at_risk",
  "noship.r2.day14": "at_risk",
  "pace.day7": "at_risk",
  "pace.day14": "at_risk",
  "pace.day21": "at_risk",
  // Month 2 entry (event)
  "month2.entry": "event",
};
