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
 * with no plan on file. Free seats hold no first payment either.
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
 * A FAILED READ SAYS SO. The students read failing is the page's error, never
 * an empty board. A failed progress read, lesson count, area read or course
 * read leaves that part of every card unknown, with a sentence in
 * `problems`, never 0% or the first area.
 *
 *   readJourney    the reads, each one's result kept apart
 *   buildJourney   the columns and the header's counts
 *   columnFor      a student's column
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRowsByKey } from "./supabase-pagination.ts";
import { MONTHLY_97_PLAN_IDS, progressPercent } from "./constants.ts";
import { DISCOUNT_LAUNCH_DATE } from "./discount.ts";
import { activityLabel, type ActivityLabel } from "./curriculum-reset.ts";
import { isCanceling } from "./metrics-definitions.ts";
import type { CourseActivity } from "./types-erased.ts";
import { agoText, bareUsername, dayNumber, failed, ok, readCountingLessons, readOf, type Read, type Problem } from "./people-common.ts";

/** The columns a card needs. Never `*`, and never a plan: the plan is the read's filter, never a column. */
export const JOURNEY_COLUMNS = "id, name, email, discord_username, membership_status, first_paid_at, last_active_at, cancel_scheduled_at";

/** The memberships the board shows: on the program, or churned from it. */
export const JOURNEY_STATUSES = ["active", "past_due", "canceled"] as const;

export interface JourneyStudent {
  id: string;
  name: string | null;
  email: string | null;
  /** A Whop or a Discord username: the card shows it after the name, as every admin page does. */
  discord_username?: string | null;
  membership_status: string;
  first_paid_at: string;
  last_active_at: string | null;
  cancel_scheduled_at: string | null;
}

export interface JourneyReads {
  students: Read<JourneyStudent[]>;
  progress: Read<Array<{ student_id: string; completed_count: number }>>;
  currentArea: Read<Array<{ student_id: string; current_region: string }>>;
  areas: Read<Array<{ id: string; name: string; order_num: number }>>;
  countingLessons: Read<number>;
}

export async function readJourney(supabase: SupabaseClient): Promise<JourneyReads> {
  const [students, progress, currentArea, areas, countingLessons] = await Promise.all([
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
    fetchAllRowsByKey<{ student_id: string; completed_count: number }>(
      () => supabase.from("student_progress_counts").select("student_id, completed_count").order("student_id"),
      "student_id",
    ),
    fetchAllRowsByKey<{ student_id: string; current_region: string }>(
      () => supabase.from("student_current_region").select("student_id, current_region").order("student_id"),
      "student_id",
    ),
    supabase.from("regions").select("id, name, order_num").order("order_num"),
    readCountingLessons(supabase),
  ]);
  return {
    students: students.error ? failed(students.error) : ok(students.data),
    progress: progress.error ? failed(progress.error) : ok(progress.data),
    currentArea: currentArea.error ? failed(currentArea.error) : ok(currentArea.data),
    areas: readOf(areas, []),
    countingLessons,
  };
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

const NUMERALS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

export interface JourneyCard {
  id: string;
  name: string;
  /** students.discord_username without its "@", or null. */
  username: string | null;
  day: number;
  status: string;
  canceling: boolean;
  /** The furthest area with a counted lesson ("III", "Ad Creative"), the first area when none. Null when unknown. */
  area: { numeral: string; name: string } | null;
  activity: ActivityLabel | null;
  /** Null when it cannot be known. */
  progress: number | null;
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
  if (!reads.areas.ok) problems.push({ text: `Couldn't load the course's areas, so no card shows its area. ${again}`, error: reads.areas.error });
  else if (!reads.currentArea.ok) problems.push({ text: `Couldn't load where each student is, so no card shows its area. ${again}`, error: reads.currentArea.error });
  if (!course.ok) problems.push({ text: `Couldn't read which course is live, so no activity is shown. ${again}`, error: course.error });

  const progressKnown = reads.progress.ok && reads.countingLessons.ok;
  const done = new Map(reads.progress.ok ? reads.progress.data.map((r) => [r.student_id, r.completed_count]) : []);
  const total = reads.countingLessons.ok ? reads.countingLessons.data : 0;
  const areas = reads.areas.ok ? reads.areas.data : [];
  const areaById = new Map(areas.map((a) => [a.id, a]));
  const areaKnown = reads.areas.ok && reads.currentArea.ok && areas.length > 0;
  const where = new Map(reads.currentArea.ok ? reads.currentArea.data.map((r) => [r.student_id, r.current_region]) : []);
  const courseIsNew = course.ok && course.resetAt != null;

  const byColumn = new Map<ColumnId, JourneyCard[]>(JOURNEY_COLUMNS_SHOWN.map((c) => [c.id, []]));
  const activity: Record<ActivityLabel, number> = { not_started: 0, moving: 0, slipping: 0, stalled: 0 };
  for (const s of reads.students.data) {
    const day = dayNumber(s.first_paid_at, nowMs) ?? 1;
    const label = courseIsNew && course.ok ? activityLabel(course.lastByStudent.get(s.id) ?? null, nowMs) : null;
    // A student with no row in the view has finished no counted lesson: the first area, as the view itself does.
    const area = areaKnown ? (areaById.get(where.get(s.id) ?? "") ?? areas[0]) : null;
    byColumn.get(columnFor(s.membership_status, day))?.push({
      id: s.id,
      name: s.name?.trim() || s.email?.trim() || "No name on file",
      username: bareUsername(s.discord_username),
      day,
      status: s.membership_status,
      canceling: isCanceling(s),
      area: area ? { numeral: NUMERALS[area.order_num - 1] ?? String(area.order_num), name: area.name } : null,
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
