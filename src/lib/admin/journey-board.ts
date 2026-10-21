/**
 * The Student journey, /admin/journey (admin rebuild 2, D8): what the board
 * reads and the columns it shows.
 *
 * WHO IS ON IT. The new program's students: course members on a $97 monthly
 * plan (students.whop_plan_id is one of MONTHLY_97_PLAN_IDS, the visible
 * plan and the hidden one, src/lib/constants.ts) with a first real payment
 * on or after the launch, DISCOUNT_LAUNCH_DATE (2026-10-08T22:00Z, midnight
 * starting 9 October in Croatia), and a Whop membership that is active, past
 * due or canceled. The plans are All students' (students-list.ts), the
 * owner's answer of 2026-10-21, so the two pages agree: a yearly plan, an
 * ETfB owner, an Apex seat or a free seat is on neither, nor is a student
 * with no plan on file. Free seats hold no first payment either. All
 * students lists the first payments from 1 October since the owner's review
 * of the same day, so every student on the board is on that list too.
 *
 * Before admin rebuild 2 it held the visible $97 plan only, from 25 May; the
 * rebuild opened it to every plan from the launch; the owner's answer brings
 * the $97 plans back, both of them, from the launch as before.
 *
 * THE COLUMNS, as before: Week 1 (days 1 to 7), Week 2 (8 to 14), Week 3
 * (15 to 21), Week 4 (22 to 30), Churned (canceled, any day) and Month 2+
 * (past day 30 and active). A day is counted from the first payment. A
 * past-due student past day 30 stays in Week 4.
 *
 * A CARD (the owner's review, 2026-10-21) holds the name, the day, the
 * activity word, the progress as a percentage and the last activity, and
 * nothing else: the area chip, the username, Canceling and Payment failed
 * went, and with the area the reads of where each student is and of the
 * course's areas. The drawer still shows the student's whole detail.
 *
 * A FAILED READ SAYS SO. The students read failing is the page's error, never
 * an empty board. A failed progress read, lesson count or course read leaves
 * that part of every card unknown, with a sentence in `problems`, never 0%.
 *
 *   readJourney    the reads, each one's result kept apart: the students
 *                  and the lesson count, then the progress of the students
 *                  on the board alone (readForStudents)
 *   buildJourney   the columns and the header's counts
 *   columnFor      a student's column
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRowsByKey } from "@/lib/supabase-pagination";
import { MONTHLY_97_PLAN_IDS, progressPercent } from "@/lib/constants";
import { DISCOUNT_LAUNCH_DATE } from "@/lib/world/discount";
import { activityLabel, type ActivityLabel } from "@/lib/curriculum-reset";
import type { CourseActivity } from "@/lib/useJourneyPaceCounts";
import { agoText, dayNumber, failed, ok, readCountingLessons, readForStudents, type Read, type Problem } from "./people-common";

/** The columns a card needs. Never `*`, and never a plan: the plan is the read's filter, never a column. */
export const JOURNEY_COLUMNS = "id, name, email, membership_status, first_paid_at, last_active_at";

/** The memberships the board shows: on the program, or churned from it. */
export const JOURNEY_STATUSES = ["active", "past_due", "canceled"] as const;

export interface JourneyStudent {
  id: string;
  name: string | null;
  email: string | null;
  membership_status: string;
  first_paid_at: string;
  last_active_at: string | null;
}

export interface JourneyReads {
  students: Read<JourneyStudent[]>;
  progress: Read<Array<{ student_id: string; completed_count: number }>>;
  countingLessons: Read<number>;
}

export async function readJourney(supabase: SupabaseClient): Promise<JourneyReads> {
  const [students, countingLessons] = await Promise.all([
    fetchAllRowsByKey<JourneyStudent>(
      () =>
        supabase
          .from("students")
          .select(JOURNEY_COLUMNS)
          .not("whop_membership_id", "is", null)
          .in("membership_status", [...JOURNEY_STATUSES])
          .in("whop_plan_id", MONTHLY_97_PLAN_IDS)
          .gte("first_paid_at", DISCOUNT_LAUNCH_DATE)
          .order("id"),
      "id",
    ),
    readCountingLessons(supabase),
  ]);
  if (students.error) {
    return { students: failed(students.error), progress: failed("not read: the students could not be read"), countingLessons };
  }
  const progress = await readForStudents<{ student_id: string; completed_count: number }>(
    supabase,
    "student_progress_counts",
    "student_id, completed_count",
    students.data.map((s) => s.id),
  );
  return { students: ok(students.data), progress, countingLessons };
}

export type ColumnId = "week-1" | "week-2" | "week-3" | "week-4" | "churned" | "month-2";

export const JOURNEY_COLUMNS_SHOWN: Array<{ id: ColumnId; label: string; description: string }> = [
  { id: "week-1", label: "Week 1", description: "Days 1 to 7" },
  { id: "week-2", label: "Week 2", description: "Days 8 to 14" },
  { id: "week-3", label: "Week 3", description: "Days 15 to 21" },
  { id: "week-4", label: "Week 4", description: "Days 22 to 30" },
  { id: "churned", label: "Churned", description: "Canceled" },
  { id: "month-2", label: "Month 2+", description: "Stayed past day 30" },
];

/** The column of a student on day `day` since their first payment. */
export function columnFor(status: string, day: number): ColumnId {
  if (status === "canceled") return "churned";
  if (day > 30 && status === "active") return "month-2";
  if (day <= 7) return "week-1";
  if (day <= 14) return "week-2";
  if (day <= 21) return "week-3";
  return "week-4";
}

/** A card: what the owner's review (2026-10-21) keeps on it, and nothing else. */
export interface JourneyCard {
  id: string;
  name: string;
  /** Day N since the first payment. */
  day: number;
  /** Moving, Not started, Stalled or Slipping; null before the switch, or when it cannot be known. */
  activity: ActivityLabel | null;
  /** Lessons done, as a share of the lessons that count. Null when it cannot be known. */
  progress: number | null;
  /** "2 h ago", or "Never". */
  lastActive: string;
}

export interface Journey {
  columns: Array<{ id: ColumnId; label: string; description: string; cards: JourneyCard[] }>;
  /** After the switch, every student who has not churned, by activity. Null before it, or when it is unknown. */
  activity: Record<ActivityLabel, number> | null;
  /** How many students the board holds. */
  total: number;
  launchedAt: string;
  generatedAt: string;
  /** Each read that failed: a sentence for the top of the board, and the read's own words. */
  problems: Problem[];
}

/** The board, from the reads. Hand it reads whose `students` worked. `nowIso` is the moment of the read. */
export function buildJourney(
  reads: JourneyReads & { students: { ok: true; data: JourneyStudent[] } },
  course: CourseActivity,
  nowIso: string,
): Journey {
  const nowMs = Date.parse(nowIso);
  const problems: Problem[] = [];
  const again = "Press Refresh to try again.";
  if (!reads.progress.ok) problems.push({ text: `Couldn't load the students' progress, so no card shows it. ${again}`, error: reads.progress.error });
  else if (!reads.countingLessons.ok) problems.push({ text: `Couldn't count the course's lessons, so no card shows progress. ${again}`, error: reads.countingLessons.error });
  if (!course.ok) problems.push({ text: `Couldn't read which course is live, so no activity is shown. ${again}`, error: course.error });

  const progressKnown = reads.progress.ok && reads.countingLessons.ok;
  const done = new Map(reads.progress.ok ? reads.progress.data.map((r) => [r.student_id, r.completed_count]) : []);
  const total = reads.countingLessons.ok ? reads.countingLessons.data : 0;
  const courseIsNew = course.ok && course.resetAt != null;

  const byColumn = new Map<ColumnId, JourneyCard[]>(JOURNEY_COLUMNS_SHOWN.map((c) => [c.id, []]));
  const activity: Record<ActivityLabel, number> = { not_started: 0, moving: 0, slipping: 0, stalled: 0 };
  for (const s of reads.students.data) {
    const day = dayNumber(s.first_paid_at, nowMs) ?? 1;
    const label = courseIsNew && course.ok ? activityLabel(course.lastByStudent.get(s.id) ?? null, nowMs) : null;
    byColumn.get(columnFor(s.membership_status, day))?.push({
      id: s.id,
      name: s.name?.trim() || s.email?.trim() || "No name on file",
      day,
      activity: label,
      progress: progressKnown ? progressPercent(done.get(s.id) ?? 0, total) : null,
      lastActive: agoText(s.last_active_at, nowMs),
    });
    if (label && s.membership_status !== "canceled") activity[label]++;
  }
  // Newest first payment first in each column: day 1 at the top.
  for (const cards of byColumn.values()) cards.sort((a, b) => a.day - b.day || a.name.localeCompare(b.name));

  return {
    columns: JOURNEY_COLUMNS_SHOWN.map((c) => ({ ...c, cards: byColumn.get(c.id) ?? [] })),
    activity: courseIsNew ? activity : null,
    total: reads.students.data.length,
    launchedAt: DISCOUNT_LAUNCH_DATE,
    generatedAt: nowIso,
    problems,
  };
}
