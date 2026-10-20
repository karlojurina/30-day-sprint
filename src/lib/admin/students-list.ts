/**
 * All students, /admin/students (admin rebuild 2, D9): what the page reads
 * and the list it shows.
 *
 * WHO IS ON IT. Every student with a real first payment
 * (students.first_paid_at is not null), whatever their plan, membership
 * status or date. Since the first-paid fix (2026-10-20) first_paid_at is the
 * first real Whop payment, so free seats, which hold null, are left out. The
 * list used to hold the $97 monthly plan only, from 25 May, without saying
 * so; no plan is read or shown any more.
 *
 * THE ORDER. By first payment, newest first; the page can sort by name,
 * progress or last activity instead.
 *
 * A FAILED READ SAYS SO. The students read failing is the page's error, with
 * Retry, never "no students". A failed progress read, lesson count or
 * course read leaves that column unknown (null), with a sentence in
 * `problems`, never 0%.
 *
 *   readStudentsList   the reads, each one's result kept apart (people-common.ts's Read)
 *   buildStudentsList  the rows, from those reads, the course and the clock
 *
 * The course (which one is live, and each student's last counted lesson)
 * comes from loadCourseActivity (src/lib/useJourneyPaceCounts.ts), which the
 * transport reads beside these. No React, no Next.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRowsByKey } from "@/lib/supabase-pagination";
import { progressPercent } from "@/lib/constants";
import { activityLabel, type ActivityLabel } from "@/lib/curriculum-reset";
import type { CourseActivity } from "@/lib/useJourneyPaceCounts";
import { bareUsername, dayNumber, failed, ok, readCountingLessons, type Read } from "./people-common";

/** The columns the list needs, and no more: `*` would carry every column of every student to the browser. */
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

/** Every student with a first payment, any plan, and the two things their progress needs. */
export async function readStudentsList(supabase: SupabaseClient): Promise<StudentsListReads> {
  const [students, progress, countingLessons] = await Promise.all([
    // By key, not by offset: a student whose row changes while the pages
    // are read never makes another one drop off (supabase-pagination.ts).
    fetchAllRowsByKey<ListStudent>(
      () => supabase.from("students").select(LIST_COLUMNS).not("first_paid_at", "is", null).order("id"),
      "id",
    ),
    fetchAllRowsByKey<{ student_id: string; completed_count: number }>(
      () => supabase.from("student_progress_counts").select("student_id, completed_count").order("student_id"),
      "student_id",
    ),
    readCountingLessons(supabase),
  ]);
  return {
    students: students.error ? failed(students.error) : ok(students.data),
    progress: progress.error ? failed(progress.error) : ok(progress.data),
    countingLessons,
  };
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
  /** Each read that failed, in a sentence for the top of the list. */
  problems: string[];
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
  const problems: string[] = [];
  if (!reads.progress.ok) {
    problems.push(`Couldn't load the students' progress (${reads.progress.error}), so Progress says so on every row. Press Refresh to try again.`);
  } else if (!reads.countingLessons.ok) {
    problems.push(`Couldn't count the course's lessons (${reads.countingLessons.error}), so no progress is shown. Press Refresh to try again.`);
  }
  if (!course.ok) {
    problems.push(`Couldn't read which course is live (${course.error}), so no activity is shown. Press Refresh to try again.`);
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

/** The status filter: every status, or one. Payment failed is past_due. */
export const STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "past_due", label: "Payment failed" },
  { value: "canceled", label: "Canceled" },
  { value: "expired", label: "Expired" },
] as const;

export type StatusFilter = (typeof STATUS_FILTERS)[number]["value"];

/** The rows a search (name, email or username, any case) and a status keep. */
export function filterStudents(rows: StudentListRow[], search: string, status: StatusFilter): StudentListRow[] {
  const q = (bareUsername(search) ?? "").toLowerCase();
  return rows.filter(
    (r) =>
      (status === "all" || r.status === status) &&
      (!q ||
        r.name.toLowerCase().includes(q) ||
        (r.email ?? "").toLowerCase().includes(q) ||
        (r.username ?? "").toLowerCase().includes(q)),
  );
}
