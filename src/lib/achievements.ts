/**
 * Phase 5 (brief v3 + 23-05-2026 list) - achievement evaluator.
 *
 * Server-side helper called from the same write paths that update
 * the streak (lesson-watched and the Whop webhook through
 * complete-lesson.ts, mark-action-shipped, toggle-lesson, submit-quiz,
 * refresh-watch-sync, the login) and from the admin's
 * backfill-achievements. Pulls the student's current state, evaluates
 * each achievement rule, and inserts any newly-earned unlocks into
 * student_achievements. Idempotent via the PK (student_id,
 * achievement_id) - duplicate inserts are silently rejected.
 *
 * Rules are intentionally simple, derived from data the routes
 * already have on hand (or one cheap join). New achievements land
 * by adding to ACHIEVEMENT_RULES + the v53 catalog migration. The
 * rule fn returns true when the student should have the
 * achievement, false otherwise. We never *remove* unlocks, even if
 * state regresses (e.g. streak drops back below 7) - achievements
 * are sticky once earned.
 *
 * v53 - 17 achievements seeded (4 common, 4 uncommon, 5 rare,
 * 4 legendary). See the catalog migration for the list.
 *
 * Cutover (PRD cutover, WI-4): the course is read from the `lessons`
 * rows, so the same rules run on the old course (r1..r4) and the new
 * one (a1..a8). `unbroken` and `perfect_run` want every area that has
 * a counting lesson done; `dayNumber` counts from the course switch
 * for a student who paid before it.
 *
 * v112 (the owner's decisions of 2026-10-21): eight badges. Region Sweep
 * and Two Weeks Strong are gone, rules and holders (kept in the schema
 * archive_v112), and so are the six old-course rules (r1_clear..r4_clear,
 * early_finisher, speedrun) whose catalog rows the switch deleted. Habit
 * Builder counts only the streak's days on the new course, and Triple
 * Threat only lessons really finished on one day (achievement-rules.ts has
 * both). The migration also took the badges away from the holders who did
 * not meet these rules; this evaluator itself still never takes one away.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { mostFinishedInOneDay, streakDaysSinceSwitch } from "./achievement-rules";
import {
  courseAnchorIso,
  daysOnCourse,
  getCurriculumResetAt,
  resetDateUtc,
} from "./curriculum-reset";
import { requestCounts } from "./world/discount";

export interface AchievementSnapshot {
  /** Lesson IDs the student has completed (skipped or watched OR
   *  watched+action shipped). The same set the dashboard uses for
   *  region completion. */
  completedLessonIds: Set<string>;
  /** Lesson IDs where action_completed_at is set. */
  shippedActionLessonIds: Set<string>;
  /** Lesson IDs where skipped_at is set. Used by perfect_run. */
  skippedLessonIds: Set<string>;
  /** Region → ordered lesson IDs, one key per region (area) that
   *  holds a counting lesson (`counts_toward_progress`). Region
   *  complete = every lesson in this list is in completedLessonIds. */
  lessonsByRegion: Record<string, string[]>;
  currentStreak: number;
  longestStreak: number;
  /** v112: the days of the current streak on or after the course
   *  switch's date (achievement-rules.ts, streakDaysSinceSwitch); null
   *  while the old course is live. Habit Builder reads it. */
  streakDaysSinceSwitch: number | null;
  bountyAccessClaimedAt: string | null;
  discountEarnedAt: string | null;
  /** Day N on the course, 1-indexed, from first_paid_at (joined_at
   *  when null), or from the course switch when that is later. */
  dayNumber: number;
  /** v112: the most lessons really finished on one calendar day in UTC
   *  (achievement-rules.ts, mostFinishedInOneDay). A row a login or
   *  visit sync stamped with its own time is no finish on any day. */
  maxLessonsInOneDay: number;
}

interface AchievementRule {
  id: string;
  evaluate: (snap: AchievementSnapshot) => boolean;
}

function regionComplete(snap: AchievementSnapshot, regionId: string): boolean {
  const lessons = snap.lessonsByRegion[regionId] ?? [];
  if (lessons.length === 0) return false;
  return lessons.every((id) => snap.completedLessonIds.has(id));
}

/** Every region (area) of the live course done: r1..r4 before the
 *  switch, a1..a8 after it. No regions at all (a failed lessons read)
 *  is not done. */
function courseComplete(snap: AchievementSnapshot): boolean {
  const regionIds = Object.keys(snap.lessonsByRegion);
  return (
    regionIds.length > 0 && regionIds.every((r) => regionComplete(snap, r))
  );
}

/**
 * The eight badges (v112), in the order v53 listed them. Their names, words
 * and tiers are the `achievements` rows; v112 holds them.
 */
export const ACHIEVEMENT_RULES: AchievementRule[] = [
  {
    id: "first_lesson",
    evaluate: (s) => s.completedLessonIds.size >= 1,
  },
  {
    id: "first_action_shipped",
    evaluate: (s) => s.shippedActionLessonIds.size >= 1,
  },
  {
    id: "streak_7",
    // v112: a 7-day streak on the new course. The streak the flame shows is
    // kept across the switch, so a student whose streak (or best streak)
    // reached 7 on the old course was handed Habit Builder at their first
    // visit after it, as if just earned. Now only the streak's days from the
    // switch's date count, and the best streak, which holds old days, is not
    // read. While the old course is live there is no switch to count from,
    // and the rule is the old one.
    evaluate: (s) =>
      s.streakDaysSinceSwitch === null
        ? s.currentStreak >= 7 || s.longestStreak >= 7
        : s.streakDaysSinceSwitch >= 7,
  },
  {
    id: "discount_earned",
    evaluate: (s) => s.discountEarnedAt != null,
  },
  {
    // Unchanged by v112 (the owner: it has nothing to do with the course), so
    // a Bounty Access approval from before the switch still earns it.
    id: "bounty_access_claimed",
    evaluate: (s) => s.bountyAccessClaimedAt != null,
  },
  {
    id: "triple_play",
    // v112: 3 lessons really finished on one day (maxLessonsInOneDay).
    evaluate: (s) => s.maxLessonsInOneDay >= 3,
  },
  {
    id: "unbroken",
    // v90 — REDEFINED. Was "30-day streak with no break since Day 1", which
    // rewarded slowness: a student who finished the sprint in 6 days could
    // never earn it, and one who logged in daily for a month without
    // finishing could. Backwards for a sprint whose whole point is to get
    // people to lock in and finish fast. 0 students ever held the old
    // version.
    //
    // Now: finish the entire sprint without ever breaking your streak.
    // currentStreak >= dayNumber means every single day since their first
    // payment has been an active day, so the streak has never been broken.
    // Evaluated at the moment they finish, and sticky afterwards, so the
    // streak lapsing later does not take it away.
    //
    // Known false negative, accepted: a student whose progress arrives in
    // one bulk watch-sync has all their completions stamped at sync time,
    // collapsing many days of real work into one active day. They will not
    // earn this. Under-awarding a prestige badge is the right way to be
    // wrong.
    //
    // Cutover: every live area, and dayNumber counts from the switch for a
    // student who paid before it, so the streak has to be unbroken since
    // the switch (streaks are kept across it, C2).
    evaluate: (s) => courseComplete(s) && s.currentStreak >= s.dayNumber,
  },
  {
    id: "perfect_run",
    // Course complete (every live region or area) with zero skipped lessons.
    evaluate: (s) => courseComplete(s) && s.skippedLessonIds.size === 0,
  },
];

/**
 * Build the achievement snapshot from the database for a single
 * student. One round-trip per table - cheap enough to run on every
 * lesson toggle without batching.
 */
export async function buildAchievementSnapshot(
  supabase: SupabaseClient,
  studentId: string,
): Promise<AchievementSnapshot | null> {
  const [studentRes, completionsRes, realRes, lessonsRes, streaksRes, milestonesRes, discountRes, resetRes] =
    await Promise.all([
      supabase
        .from("students")
        .select("id, joined_at, first_paid_at")
        .eq("id", studentId)
        .maybeSingle(),
      supabase
        .from("student_lesson_completions")
        .select(
          "lesson_id, completed_at, action_completed_at, skipped_at",
        )
        .eq("student_id", studentId),
      // v112: the rows whose completed_at is the moment the lesson was really
      // finished (completed_at_real). A read of its own, so on a database
      // without the column (before v112 is pasted) every other badge is
      // still judged: this read fails and no lesson counts toward Triple
      // Threat until the column is there.
      supabase
        .from("student_lesson_completions")
        .select("lesson_id")
        .eq("student_id", studentId)
        .eq("completed_at_real", true),
      supabase
        .from("lessons")
        .select(
          "id, region_id, day, sort_order, requires_action, counts_toward_progress",
        ),
      supabase
        .from("student_streaks")
        .select("current_streak, longest_streak, last_streak_date")
        .eq("student_id", studentId)
        .maybeSingle(),
      supabase
        .from("student_milestones")
        .select("bounty_access_claimed_at")
        .eq("student_id", studentId)
        .maybeSingle(),
      // Every approval, oldest first: which ones count depends on the switch,
      // read beside this (below, at discountEarnedAt).
      supabase
        .from("discount_requests")
        .select("id, status, created_at")
        .eq("student_id", studentId)
        .in("status", ["approved", "applied"])
        .order("created_at", { ascending: true }),
      // getCurriculumResetAt throws on a failed read; caught here so the
      // other reads still settle, and handled below.
      getCurriculumResetAt(supabase).then(
        (resetAt) => ({ resetAt, error: null }),
        (err: unknown) => ({
          resetAt: null,
          error: err instanceof Error ? err.message : String(err),
        }),
      ),
    ]);

  const student = studentRes.data as {
    joined_at: string;
    first_paid_at: string | null;
  } | null;
  if (!student?.joined_at) return null;

  // Without the switch's moment there is no telling which course the
  // student's days count on, and guessing "no switch" after it would put
  // them back on the 30-day clock. Evaluate nothing this time: every
  // caller treats achievements as best-effort, they are sticky, and the
  // next lesson write evaluates again. Same direction as the reads below:
  // a bad read under-awards, never over-awards.
  if (resetRes.error) {
    console.error(
      `[achievements] course switch read failed for student=${studentId}, nothing evaluated: ${resetRes.error}`,
    );
    return null;
  }

  const completions =
    (completionsRes.data as Array<{
      lesson_id: string;
      completed_at: string | null;
      action_completed_at: string | null;
      skipped_at: string | null;
    }> | null) ?? [];
  const lessons =
    (lessonsRes.data as Array<{
      id: string;
      region_id: string;
      day: number;
      sort_order: number;
      requires_action: boolean;
      counts_toward_progress: boolean;
    }> | null) ?? [];
  const streaks =
    (streaksRes.data as {
      current_streak: number;
      longest_streak: number;
      last_streak_date: string | null;
    } | null) ?? { current_streak: 0, longest_streak: 0, last_streak_date: null };
  const milestones =
    (milestonesRes.data as {
      bounty_access_claimed_at: string | null;
    } | null) ?? { bounty_access_claimed_at: null };
  // Discount Earned, as the map shows the offer (discount.ts, requestCounts):
  // once the new course is live, an approval counts when the map shows it. One
  // made on or after the day the course launched does; one made before it
  // does only for a student who first paid from 1 October until the launch,
  // whose old-course 30% the map shows as theirs (T-080). A June student's
  // June approval does not: it was re-awarded after the switch while the map
  // told them the offer was not for them (backend_readiness.md, section 5,
  // item 21). Before the switch any approval counts, as it always did.
  const approvals =
    (discountRes.data as Array<{ status: string; created_at: string }> | null) ?? [];
  const discount =
    approvals.find(
      (r) => resetRes.resetAt === null || requestCounts(r, student.first_paid_at),
    ) ?? null;

  // v90: these reads had no error check at all, so a failed query was
  // indistinguishable from a student with no data. Behaviour is deliberately
  // unchanged — regionComplete() already returns false for an empty region,
  // so a bad read under-awards rather than over-awards, and the next write
  // path retries. This only makes the failure visible.
  if (lessonsRes.error) {
    console.error(
      `[achievements] lessons read failed for student=${studentId}: ${lessonsRes.error.message}`,
    );
  }
  if (completionsRes.error) {
    console.error(
      `[achievements] completions read failed for student=${studentId}: ${completionsRes.error.message}`,
    );
  }
  // Same direction: with no answer, no lesson counts toward Triple Threat.
  if (realRes.error) {
    console.error(
      `[achievements] completed_at_real read failed for student=${studentId}, no lesson counts toward Triple Threat this time: ${realRes.error.message}`,
    );
  }
  const realLessonIds = new Set(
    ((realRes.data as Array<{ lesson_id: string }> | null) ?? []).map((r) => r.lesson_id),
  );

  // Lesson id to requires_action, for the "complete" predicate below and for
  // Triple Threat's finish times. Every lesson, counting or not.
  const requiresActionById = new Map<string, boolean>();
  for (const l of lessons) requiresActionById.set(l.id, l.requires_action === true);
  // Cutover: one key per region (area) found in the lessons rows, so
  // r1..r4 on the old course and a1..a8 on the new one.
  const lessonsByRegion: Record<string, string[]> = {};
  for (const l of lessons) {
    // v74.3 - leave out the lessons that do not count toward progress
    // (l057 bounty onboarding on the old course, the a7l19 pond row on
    // the new one) so unbroken and perfect_run fire on the curriculum
    // being done, not gated on the student also having applied to Bounty
    // Access. On the old course v92 sets the flag false on l057 alone, the
    // one id SPRINT_EXCLUDED_LESSON_IDS held.
    if (l.counts_toward_progress === false) continue;
    (lessonsByRegion[l.region_id] ??= []).push(l.id);
  }

  // Canonical "complete" predicate - matches src/lib/progress.ts:
  // skipped OR (no action AND completed_at) OR (action AND
  // completed_at AND action_completed_at).
  const completedLessonIds = new Set<string>();
  const shippedActionLessonIds = new Set<string>();
  const skippedLessonIds = new Set<string>();

  for (const c of completions) {
    const requiresAction = requiresActionById.get(c.lesson_id);
    if (requiresAction === undefined) continue;
    const isSkipped = c.skipped_at != null;
    const hasWatch = c.completed_at != null;
    const hasAction = c.action_completed_at != null;
    const complete = isSkipped
      ? true
      : requiresAction
        ? hasWatch && hasAction
        : hasWatch;
    if (complete) completedLessonIds.add(c.lesson_id);
    if (hasAction) shippedActionLessonIds.add(c.lesson_id);
    if (isSkipped) skippedLessonIds.add(c.lesson_id);
  }

  // v112: Triple Threat counts a lesson on the day it was really finished.
  // The day used to be taken from completed_at, which a login or visit sync
  // stamps with the sync's own time on every lesson it brings in from Whop,
  // so lessons finished over several days counted as one day.
  const maxLessonsInOneDay = mostFinishedInOneDay(
    completions.map((c) => ({ ...c, completed_at_real: realLessonIds.has(c.lesson_id) })),
    requiresActionById,
  );

  // v112: Habit Builder reads the streak's days from the switch's date (UTC),
  // the first day the snapshots count too.
  const switchDate = resetDateUtc(resetRes.resetAt);
  const streakSinceSwitch =
    switchDate === null ? null : streakDaysSinceSwitch(streaks, switchDate);

  // v75.20: anchor day on first_paid_at (original signup), not
  // joined_at (current cycle start). Affects achievement evaluation
  // for any "by Day N" criteria. Cutover: or on the course switch,
  // when that is later. With no switch this is the old formula.
  const dayNumber = daysOnCourse(
    courseAnchorIso(student.first_paid_at, student.joined_at, resetRes.resetAt),
  );

  return {
    completedLessonIds,
    shippedActionLessonIds,
    skippedLessonIds,
    lessonsByRegion,
    currentStreak: streaks.current_streak,
    longestStreak: streaks.longest_streak,
    streakDaysSinceSwitch: streakSinceSwitch,
    bountyAccessClaimedAt: milestones.bounty_access_claimed_at,
    discountEarnedAt: discount?.created_at ?? null,
    dayNumber,
    maxLessonsInOneDay,
  };
}

/**
 * Evaluate every rule and insert any newly-earned unlocks. Safe to
 * call from any write path - duplicates are rejected by the PK.
 * Returns the list of achievement_ids that were newly inserted
 * (empty if none) so callers can fire a celebration toast.
 */
export async function evaluateAchievements(
  supabase: SupabaseClient,
  studentId: string,
): Promise<string[]> {
  const snap = await buildAchievementSnapshot(supabase, studentId);
  if (!snap) return [];

  const earnedIds = ACHIEVEMENT_RULES.filter((r) => r.evaluate(snap)).map(
    (r) => r.id,
  );
  if (earnedIds.length === 0) return [];

  // Check which ones we already have to avoid pointless writes.
  const { data: existing } = await supabase
    .from("student_achievements")
    .select("achievement_id")
    .eq("student_id", studentId)
    .in("achievement_id", earnedIds);

  const existingSet = new Set(
    (existing ?? []).map((r) => r.achievement_id as string),
  );
  const toInsert = earnedIds.filter((id) => !existingSet.has(id));
  if (toInsert.length === 0) return [];

  const rows = toInsert.map((id) => ({
    student_id: studentId,
    achievement_id: id,
    unlocked_at: new Date().toISOString(),
  }));

  const { error } = await supabase.from("student_achievements").insert(rows);
  if (error) {
    // 23505 = duplicate PK (race with a parallel call). Safe to
    // ignore - the row exists already.
    if (
      error.code === "23505" ||
      error.message?.includes("duplicate key")
    ) {
      return [];
    }
    console.error(
      `[evaluateAchievements] insert failed for student=${studentId}:`,
      error,
    );
    return [];
  }

  return toInsert;
}
