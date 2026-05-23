/**
 * Phase 5 (brief v3 + 23-05-2026 list) - achievement evaluator.
 *
 * Server-side helper called from the same write paths that update
 * the streak (toggle-lesson, mark-action-shipped, submit-quiz,
 * refresh-watch-sync). Pulls the student's current state, evaluates
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
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface AchievementSnapshot {
  /** Lesson IDs the student has completed (skipped or watched OR
   *  watched+action shipped). The same set the dashboard uses for
   *  region completion. */
  completedLessonIds: Set<string>;
  /** Lesson IDs where action_completed_at is set. */
  shippedActionLessonIds: Set<string>;
  /** Lesson IDs where skipped_at is set. Used by perfect_run. */
  skippedLessonIds: Set<string>;
  /** Region → ordered lesson IDs. Region complete = every lesson
   *  in this list is in completedLessonIds. */
  lessonsByRegion: Record<string, string[]>;
  currentStreak: number;
  longestStreak: number;
  bountyAccessClaimedAt: string | null;
  discountEarnedAt: string | null;
  /** Day number computed from students.joined_at, 1-indexed. */
  dayNumber: number;
  /** Number of distinct calendar days (in UTC) the student
   *  completed at least one lesson on. Used for streak-since-day-1
   *  detection (unbroken). */
  uniqueActiveDaysSinceJoin: number;
  /** Max distinct lessons completed on the same calendar day. */
  maxLessonsInOneDay: number;
  /** Max distinct lessons completed in one region on the same
   *  calendar day. */
  maxRegionLessonsInOneDay: number;
}

interface AchievementRule {
  id: string;
  evaluate: (snap: AchievementSnapshot) => boolean;
}

const REGION_IDS = ["r1", "r2", "r3", "r4"] as const;

function regionComplete(
  snap: AchievementSnapshot,
  regionId: (typeof REGION_IDS)[number],
): boolean {
  const lessons = snap.lessonsByRegion[regionId] ?? [];
  if (lessons.length === 0) return false;
  return lessons.every((id) => snap.completedLessonIds.has(id));
}

export const ACHIEVEMENT_RULES: AchievementRule[] = [
  // Common
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
    evaluate: (s) => s.currentStreak >= 7 || s.longestStreak >= 7,
  },
  {
    id: "r1_clear",
    evaluate: (s) => regionComplete(s, "r1"),
  },

  // Uncommon
  {
    id: "r2_clear",
    evaluate: (s) => regionComplete(s, "r2"),
  },
  {
    id: "discount_earned",
    evaluate: (s) => s.discountEarnedAt != null,
  },
  {
    id: "streak_14",
    evaluate: (s) => s.currentStreak >= 14 || s.longestStreak >= 14,
  },
  {
    id: "r3_clear",
    evaluate: (s) => regionComplete(s, "r3"),
  },

  // Rare
  {
    id: "r4_clear",
    evaluate: (s) => regionComplete(s, "r4"),
  },
  // v56 - streak_30 (Rare) removed - it overlapped with the
  // `unbroken` legendary and didn't earn its own tier slot.
  {
    id: "bounty_access_claimed",
    evaluate: (s) => s.bountyAccessClaimedAt != null,
  },
  {
    id: "triple_play",
    evaluate: (s) => s.maxLessonsInOneDay >= 3,
  },
  {
    id: "region_sweep",
    // Cleared an entire region in one day. For tiny regions
    // (< 3 lessons) this would be too easy, so we also require the
    // total to be >= 5 lessons on that day.
    evaluate: (s) =>
      s.maxRegionLessonsInOneDay >= 5 ||
      (s.maxRegionLessonsInOneDay >= 3 && s.maxLessonsInOneDay >= 5),
  },

  // Legendary
  {
    id: "early_finisher",
    // R4 cleared before day 21. dayNumber is the CURRENT day; we
    // approximate by requiring R4 done AND dayNumber < 21 at the
    // first observation. Sticky once awarded.
    evaluate: (s) => regionComplete(s, "r4") && s.dayNumber < 21,
  },
  {
    id: "speedrun",
    evaluate: (s) => regionComplete(s, "r4") && s.dayNumber < 14,
  },
  {
    id: "unbroken",
    // 30-day streak with no break since Day 1. We approximate "since
    // Day 1" by requiring uniqueActiveDaysSinceJoin >= dayNumber AND
    // currentStreak >= 30 (the streak hasn't been broken since the
    // beginning).
    evaluate: (s) =>
      s.currentStreak >= 30 &&
      s.uniqueActiveDaysSinceJoin >= Math.min(s.dayNumber, 30),
  },
  {
    id: "perfect_run",
    // Sprint complete (all 4 regions) with zero skipped lessons.
    evaluate: (s) =>
      REGION_IDS.every((r) => regionComplete(s, r)) &&
      s.skippedLessonIds.size === 0,
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
  const [studentRes, completionsRes, lessonsRes, streaksRes, milestonesRes, discountRes] =
    await Promise.all([
      supabase
        .from("students")
        .select("id, joined_at")
        .eq("id", studentId)
        .maybeSingle(),
      supabase
        .from("student_lesson_completions")
        .select(
          "lesson_id, completed_at, action_completed_at, skipped_at",
        )
        .eq("student_id", studentId),
      supabase
        .from("lessons")
        .select("id, region_id, day, sort_order, requires_action"),
      supabase
        .from("student_streaks")
        .select("current_streak, longest_streak")
        .eq("student_id", studentId)
        .maybeSingle(),
      supabase
        .from("student_milestones")
        .select("bounty_access_claimed_at")
        .eq("student_id", studentId)
        .maybeSingle(),
      supabase
        .from("discount_requests")
        .select("id, status, created_at")
        .eq("student_id", studentId)
        .in("status", ["approved", "applied"])
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);

  const student = studentRes.data as { joined_at: string } | null;
  if (!student?.joined_at) return null;

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
    }> | null) ?? [];
  const streaks =
    (streaksRes.data as {
      current_streak: number;
      longest_streak: number;
    } | null) ?? { current_streak: 0, longest_streak: 0 };
  const milestones =
    (milestonesRes.data as {
      bounty_access_claimed_at: string | null;
    } | null) ?? { bounty_access_claimed_at: null };
  const discount = discountRes.data as { created_at: string } | null;

  const lessonsById = new Map<
    string,
    {
      region_id: string;
      requires_action: boolean;
    }
  >();
  for (const l of lessons) {
    lessonsById.set(l.id, {
      region_id: l.region_id,
      requires_action: l.requires_action,
    });
  }
  const lessonsByRegion: Record<string, string[]> = {
    r1: [],
    r2: [],
    r3: [],
    r4: [],
  };
  for (const l of lessons) {
    if (lessonsByRegion[l.region_id]) lessonsByRegion[l.region_id].push(l.id);
  }

  // Canonical "complete" predicate - matches src/lib/progress.ts:
  // skipped OR (no action AND completed_at) OR (action AND
  // completed_at AND action_completed_at).
  const completedLessonIds = new Set<string>();
  const shippedActionLessonIds = new Set<string>();
  const skippedLessonIds = new Set<string>();
  // Day buckets keyed by UTC date string for triple_play +
  // region_sweep + uniqueActiveDaysSinceJoin.
  const lessonsByDay = new Map<string, Set<string>>();
  const lessonsByDayAndRegion = new Map<string, Map<string, Set<string>>>();

  for (const c of completions) {
    const meta = lessonsById.get(c.lesson_id);
    if (!meta) continue;
    const isSkipped = c.skipped_at != null;
    const hasWatch = c.completed_at != null;
    const hasAction = c.action_completed_at != null;
    const complete = isSkipped
      ? true
      : meta.requires_action
        ? hasWatch && hasAction
        : hasWatch;
    if (complete) completedLessonIds.add(c.lesson_id);
    if (hasAction) shippedActionLessonIds.add(c.lesson_id);
    if (isSkipped) skippedLessonIds.add(c.lesson_id);

    const dayStamp =
      c.completed_at?.slice(0, 10) ??
      c.action_completed_at?.slice(0, 10) ??
      c.skipped_at?.slice(0, 10);
    if (complete && dayStamp) {
      if (!lessonsByDay.has(dayStamp)) lessonsByDay.set(dayStamp, new Set());
      lessonsByDay.get(dayStamp)!.add(c.lesson_id);
      if (!lessonsByDayAndRegion.has(dayStamp))
        lessonsByDayAndRegion.set(dayStamp, new Map());
      const byRegion = lessonsByDayAndRegion.get(dayStamp)!;
      if (!byRegion.has(meta.region_id))
        byRegion.set(meta.region_id, new Set());
      byRegion.get(meta.region_id)!.add(c.lesson_id);
    }
  }

  const maxLessonsInOneDay = Array.from(lessonsByDay.values()).reduce(
    (m, set) => Math.max(m, set.size),
    0,
  );
  let maxRegionLessonsInOneDay = 0;
  for (const byRegion of lessonsByDayAndRegion.values()) {
    for (const set of byRegion.values()) {
      if (set.size > maxRegionLessonsInOneDay)
        maxRegionLessonsInOneDay = set.size;
    }
  }
  const uniqueActiveDaysSinceJoin = lessonsByDay.size;

  const dayNumber = Math.max(
    1,
    Math.ceil(
      (Date.now() - new Date(student.joined_at).getTime()) / 86_400_000,
    ),
  );

  return {
    completedLessonIds,
    shippedActionLessonIds,
    skippedLessonIds,
    lessonsByRegion,
    currentStreak: streaks.current_streak,
    longestStreak: streaks.longest_streak,
    bountyAccessClaimedAt: milestones.bounty_access_claimed_at,
    discountEarnedAt: discount?.created_at ?? null,
    dayNumber,
    uniqueActiveDaysSinceJoin,
    maxLessonsInOneDay,
    maxRegionLessonsInOneDay,
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
