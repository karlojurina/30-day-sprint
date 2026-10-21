/**
 * All students, /admin/students (admin rebuild 2, D9): what the page reads
 * and the list it shows.
 *
 * WHO IS ON IT. The course's members on a $97 monthly plan whose first real
 * payment is on or after 1 October 2026 in Croatia: students.whop_plan_id is
 * one of MONTHLY_97_PLAN_IDS (the visible plan and the hidden one,
 * src/lib/constants.ts) and students.first_paid_at is on or after
 * DISCOUNT_ELIGIBLE_FROM (2026-09-30T22:00Z, the 30%'s first day), whatever
 * their membership status. The owner's answers of 2026-10-21: course members
 * only, and only the $97 ones, so a yearly plan, an ETfB owner who paid, an
 * Apex seat or a free plan is never on it, nor is a student with no plan on
 * file; and only the students from 1 October (the list held every $97
 * member who ever paid). Since the
 * first-paid fix (2026-10-20) first_paid_at is the first real Whop payment,
 * so a member who never paid, who holds null, is left out too. Both lines are
 * drawn in the database; the plan is never read as a column or shown on a
 * row, and the page's header says who is listed.
 *
 * Before admin rebuild 2 the list held the visible $97 plan only, from 25
 * May, without saying so; the rebuild opened it to every plan; the owner's
 * answers bring the $97 plans back, both of them, from 1 October. The
 * Student journey (journey-board.ts) reads the same two plans from the
 * launch, 9 October, so every student on the board is on the list.
 *
 * THE FILTERS (the owner's review, 2026-10-21). Active, Payment failed
 * (past_due) and Ended (canceled and expired together), each with its
 * count, Active first and open when the page opens (statusFilterOf).
 *
 * THE ORDER. By first payment, newest first; the page can sort by name,
 * progress or last activity instead.
 *
 * A FAILED READ SAYS SO. The students read failing is the page's error, with
 * Retry, never "no students". A failed progress read, lesson count or
 * course read leaves that column unknown (null), with a sentence in
 * `problems`, never 0%.
 *
 *   readStudentsList   the reads, each one's result kept apart (people-common.ts's
 *                      Read): the students and the lesson count, then the
 *                      progress of those students alone (readForStudents)
 *   buildStudentsList  the rows, from those reads, the course and the clock
 *
 * The course (which one is live, and each listed student's last counted
 * lesson) comes from loadCourseActivity (src/lib/useJourneyPaceCounts.ts),
 * which the transport reads for the listed students once they are known. No
 * React, no Next.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRowsByKey } from "./supabase-pagination.ts";
import { MONTHLY_97_PLAN_IDS, progressPercent } from "./constants.ts";
import { DISCOUNT_ELIGIBLE_FROM } from "./discount.ts";
import { activityLabel, type ActivityLabel } from "./curriculum-reset.ts";
import type { CourseActivity } from "./types-erased.ts";
import { bareUsername, dayNumber, failed, ok, readCountingLessons, readForStudents, type Problem, type Read } from "./people-common.ts";

/** The columns the list needs, and no more: `*` would carry every column of every student to the browser. No plan: the plan is the read's filter, never a column. */
export const LIST_COLUMNS = "id, name, email, discord_username, membership_status, first_paid_at, last_active_at";

export interface ListStudent {
  id: string;
  name: string | null;
  email: string | null;
  discord_username: string | null;
  membership_status: string | null;
  first_paid_at: string;
  last_active_at: string | null;
}

export interface StudentsListReads {
  students: Read<ListStudent[]>;
  progress: Read<Array<{ student_id: string; completed_count: number }>>;
  countingLessons: Read<number>;
}

/**
 * Every student on a $97 monthly plan with a first payment from 1 October,
 * and the two things their progress needs: the lesson count beside the
 * students read, then the progress of the students it listed, and nobody
 * else's. With the students read failed, their progress is not read.
 */
export async function readStudentsList(supabase: SupabaseClient): Promise<StudentsListReads> {
  const [students, countingLessons] = await Promise.all([
    // By key, not by offset: a student whose row changes while the pages
    // are read never makes another one drop off (supabase-pagination.ts).
    fetchAllRowsByKey<ListStudent>(
      () =>
        supabase
          .from("students")
          .select(LIST_COLUMNS)
          .gte("first_paid_at", DISCOUNT_ELIGIBLE_FROM)
          .in("whop_plan_id", MONTHLY_97_PLAN_IDS)
          .order("id"),
      "id",
    ),
    readCountingLessons(supabase),
  ]);
  if (students.error) {
    return {
      students: failed(students.error),
      progress: failed("not read: the students could not be read"),
      countingLessons,
    };
  }
  const progress = await readForStudents<{ student_id: string; completed_count: number }>(
    supabase,
    "student_progress_counts",
    "student_id, completed_count",
    students.data.map((s) => s.id),
  );
  return { students: ok(students.data), progress, countingLessons };
}

export interface StudentListRow {
  id: string;
  /** The name, or the email, or "No name on file". */
  name: string;
  email: string | null;
  /** students.discord_username without its "@": a Whop or a Discord username (its writers differ), so the page calls it Username. */
  username: string | null;
  /** membership_status as stored ("active", "past_due", "canceled", "expired"). */
  status: string;
  firstPaidAt: string;
  /** Day N since the first payment. */
  day: number;
  lastActiveAt: string | null;
  /** Lessons done, as a share of the lessons that count. Null when it cannot be known. */
  progress: number | null;
  /** How recently the student finished a counted lesson, on the new course. Null before the switch, or when it cannot be known. */
  activity: ActivityLabel | null;
}

export interface StudentsList {
  rows: StudentListRow[];
  /** The moment the list was read: every day and "ago" is counted from it. */
  generatedAt: string;
  /** False when a read the Progress column needs failed: the column says so. */
  progressKnown: boolean;
  /** True after the course switch, false before it, null when it could not be read: the Activity column says so. */
  courseIsNew: boolean | null;
  /** Each read that failed: a sentence for the top of the list, and the read's own words. */
  problems: Problem[];
}

export type StudentSort = "paid" | "name" | "progress" | "active";

function studentName(s: Pick<ListStudent, "name" | "email">): string {
  return s.name?.trim() || s.email?.trim() || "No name on file";
}

/** By first payment, newest first; the same moment by name, then id, so the order never changes between reads. */
function byFirstPayment(a: StudentListRow, b: StudentListRow): number {
  const d = Date.parse(b.firstPaidAt) - Date.parse(a.firstPaidAt);
  if (d !== 0) return d;
  const n = a.name.localeCompare(b.name);
  return n !== 0 ? n : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The list, from the reads. Hand it reads whose `students` worked (the
 * transport turns a failed one into the page's error). `nowIso` is the
 * moment of the read.
 */
export function buildStudentsList(
  reads: StudentsListReads & { students: { ok: true; data: ListStudent[] } },
  course: CourseActivity,
  nowIso: string,
): StudentsList {
  const nowMs = Date.parse(nowIso);
  const problems: Problem[] = [];
  if (!reads.progress.ok) {
    problems.push({ text: "Couldn't load the students' progress, so Progress says so on every row. Press Refresh to try again.", error: reads.progress.error });
  } else if (!reads.countingLessons.ok) {
    problems.push({ text: "Couldn't count the course's lessons, so no progress is shown. Press Refresh to try again.", error: reads.countingLessons.error });
  }
  if (!course.ok) {
    problems.push({ text: "Couldn't read which course is live, so no activity is shown. Press Refresh to try again.", error: course.error });
  }
  const progressKnown = reads.progress.ok && reads.countingLessons.ok;
  const courseIsNew = course.ok ? course.resetAt != null : null;
  const done = new Map(reads.progress.ok ? reads.progress.data.map((r) => [r.student_id, r.completed_count]) : []);
  const total = reads.countingLessons.ok ? reads.countingLessons.data : 0;

  const rows: StudentListRow[] = reads.students.data.map((s) => ({
    id: s.id,
    name: studentName(s),
    email: s.email,
    username: bareUsername(s.discord_username),
    status: s.membership_status ?? "",
    firstPaidAt: s.first_paid_at,
    day: dayNumber(s.first_paid_at, nowMs) ?? 1,
    lastActiveAt: s.last_active_at,
    // A student with no row in the view has finished nothing: 0 is known then.
    progress: progressKnown ? progressPercent(done.get(s.id) ?? 0, total) : null,
    activity:
      course.ok && course.resetAt != null ? activityLabel(course.lastByStudent.get(s.id) ?? null, nowMs) : null,
  }));
  rows.sort(byFirstPayment);
  return { rows, generatedAt: nowIso, progressKnown, courseIsNew, problems };
}

/** The rows in the order the page was asked for. Paid is the list's own order; the others fall back to it on a tie. */
export function sortStudents(rows: StudentListRow[], sort: StudentSort): StudentListRow[] {
  if (sort === "paid") return rows;
  const at = (iso: string | null) => (iso ? Date.parse(iso) || 0 : 0);
  const keyed = rows.map((r, i) => ({ r, i }));
  keyed.sort((x, y) => {
    let d = 0;
    if (sort === "name") d = x.r.name.localeCompare(y.r.name);
    else if (sort === "progress") d = (y.r.progress ?? -1) - (x.r.progress ?? -1);
    else d = at(y.r.lastActiveAt) - at(x.r.lastActiveAt);
    return d !== 0 ? d : x.i - y.i;
  });
  return keyed.map((k) => k.r);
}

/**
 * The membership filter (the owner's review, 2026-10-21): Active, Payment
 * failed (past_due) and Ended (canceled and expired together), Active first
 * and the one the page opens on. No "All": every student is under one of the
 * three (students.membership_status holds one of the four statuses).
 */
export const STATUS_FILTERS = [
  { value: "active", label: "Active" },
  { value: "past_due", label: "Payment failed" },
  { value: "ended", label: "Ended" },
] as const;

export type StatusFilter = (typeof STATUS_FILTERS)[number]["value"];

/** The filter the page opens on. */
export const DEFAULT_STATUS_FILTER: StatusFilter = "active";

/** The filter a membership status is under: canceled and expired are both Ended; null for a status outside the four. */
export function statusFilterOf(status: string): StatusFilter | null {
  if (status === "active") return "active";
  if (status === "past_due") return "past_due";
  if (status === "canceled" || status === "expired") return "ended";
  return null;
}

/** How many rows each filter holds, before any search: the counts on the pills. */
export function statusCounts(rows: readonly StudentListRow[]): Record<StatusFilter, number> {
  const counts: Record<StatusFilter, number> = { active: 0, past_due: 0, ended: 0 };
  for (const r of rows) {
    const f = statusFilterOf(r.status);
    if (f) counts[f] += 1;
  }
  return counts;
}

/** The rows a search (name, email or username, any case) and a membership filter keep. */
export function filterStudents(rows: StudentListRow[], search: string, status: StatusFilter): StudentListRow[] {
  const q = (bareUsername(search) ?? "").toLowerCase();
  return rows.filter(
    (r) =>
      statusFilterOf(r.status) === status &&
      (!q ||
        r.name.toLowerCase().includes(q) ||
        (r.email ?? "").toLowerCase().includes(q) ||
        (r.username ?? "").toLowerCase().includes(q)),
  );
}
