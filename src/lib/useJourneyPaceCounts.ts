"use client";

/**
 * Shared hook: counts of students currently on the 30-day journey
 * split by pace label — behind / on_pace / ahead.
 *
 * Used by:
 *   - the admin sidebar's Student-journey nav button (small badge)
 *   - the /admin/journey page header (three-stat overview)
 *   - /admin/insights/progress (detailed pace breakdown card)
 *
 * Cohort: only students who joined ON OR AFTER
 * ADMIN_STUDENT_JOIN_CUTOFF (May 1 2026). Active + past_due only.
 * Skip students past day 30 — not on the curve anymore.
 *
 * v49: pulls from the student_progress_counts + student_current_region
 * VIEWS rather than raw completions, so PostgREST's 1000-row cap
 * doesn't silently truncate the count for large cohorts. This is
 * the same source-of-truth /admin/students uses, which is why the
 * students list has always been correct.
 *
 * After the course switch (admin_config.curriculum_reset_at present) the
 * new course has no 30-day plan to be ahead of or behind, so the hook
 * counts activity instead: not started / moving / slipping / stalled, from
 * each student's last counted lesson (cutover PRD, C4). Every active
 * student is on the new course, so the day-30 cut no longer applies.
 *
 * This file also holds the activity pieces the other admin pages share:
 * the pill words and tones, and loadCourseActivity.
 */

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase-browser";
import { ADMIN_STUDENT_JOIN_CUTOFF } from "@/lib/constants";
import { PAYING_WHOP_PLAN_IDS_ARRAY } from "@/lib/admin/metrics-definitions";
import { fetchAllRowsPaginated } from "@/lib/supabase-pagination";
import { getDayNumber } from "@/types/database";
import type { RegionId, Student } from "@/types/database";
import { buildPaceSummary } from "@/lib/csm-triggers";
import {
  activityLabel,
  getCurriculumResetAt,
  type ActivityLabel,
} from "@/lib/curriculum-reset";

/** The activity pill's words, as the plan names them. */
export const ACTIVITY_TEXT: Record<ActivityLabel, string> = {
  not_started: "Not started",
  moving: "Moving",
  slipping: "Slipping",
  stalled: "Stalled",
};

/** The activity pill's tone, one of the admin Pill tones. */
export const ACTIVITY_TONE: Record<
  ActivityLabel,
  "neutral" | "success" | "warning" | "danger"
> = {
  not_started: "neutral",
  moving: "success",
  slipping: "warning",
  stalled: "danger",
};

/** Every activity label, in the order the pages show them. */
export const ACTIVITY_ORDER: ActivityLabel[] = [
  "not_started",
  "moving",
  "slipping",
  "stalled",
];

/**
 * Which course the admin pages judge students on.
 *
 *   ok, resetAt null  the old course is live: show today's pace pill.
 *   ok, resetAt set   the switch has run: show activity, from lastByStudent
 *                     (student_last_counted_completion; a student with no
 *                     row there has finished no counted lesson).
 *   not ok            a read failed: the page cannot know which course is
 *                     live, so it shows "—" instead of guessing.
 */
export type CourseActivity =
  | { ok: true; resetAt: string | null; lastByStudent: Map<string, string> }
  | { ok: false; error: string };

/**
 * Reads the reset key, and the view of last counted lessons only when the
 * key exists (the view comes from v103 and means nothing before the
 * switch). Hand it `studentId` to read one student's row instead of all.
 * Never throws: a failed read comes back as `{ ok: false }`.
 */
export async function loadCourseActivity(
  supabase: SupabaseClient,
  studentId?: string,
): Promise<CourseActivity> {
  try {
    const resetAt = await getCurriculumResetAt(supabase);
    const lastByStudent = new Map<string, string>();
    if (resetAt == null) return { ok: true, resetAt, lastByStudent };

    type Row = { student_id: string; last_completed_at: string | null };
    let rows: Row[];
    if (studentId) {
      const { data, error } = await supabase
        .from("student_last_counted_completion")
        .select("student_id, last_completed_at")
        .eq("student_id", studentId);
      if (error) throw new Error(error.message);
      rows = (data ?? []) as Row[];
    } else {
      const res = await fetchAllRowsPaginated<Row>(() =>
        supabase
          .from("student_last_counted_completion")
          .select("student_id, last_completed_at")
          // Stable order for .range() pagination; a view has none of its own.
          .order("student_id"),
      );
      if (res.error) throw res.error;
      rows = res.data;
    }
    for (const r of rows) {
      if (r.last_completed_at) lastByStudent.set(r.student_id, r.last_completed_at);
    }
    return { ok: true, resetAt, lastByStudent };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error("[admin] which course is live could not be read:", error);
    return { ok: false, error };
  }
}

export interface PaceCounts {
  behind: number;
  on_pace: number;
  ahead: number;
  /** All three summed — useful for nav-button "any" badge. After the
   *  switch, the four activity counts summed. */
  total: number;
  /** True while the first fetch is in flight. */
  loading: boolean;
  /** True once the switch has run: read `activity`, not the three above. */
  courseIsNew: boolean;
  /** After the switch, students per activity label. */
  activity: Record<ActivityLabel, number>;
  /** Set when a read failed; every count is then unknown, never 0. */
  error: string | null;
}

function emptyActivity(): Record<ActivityLabel, number> {
  return { not_started: 0, moving: 0, slipping: 0, stalled: 0 };
}

export function useJourneyPaceCounts(): PaceCounts {
  const [counts, setCounts] = useState<PaceCounts>({
    behind: 0,
    on_pace: 0,
    ahead: 0,
    total: 0,
    loading: true,
    courseIsNew: false,
    activity: emptyActivity(),
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    (async () => {
      const fail = (error: string) => {
        if (!cancelled) {
          setCounts({
            behind: 0,
            on_pace: 0,
            ahead: 0,
            total: 0,
            loading: false,
            courseIsNew: false,
            activity: emptyActivity(),
            error,
          });
        }
      };
      const course = await loadCourseActivity(supabase);
      if (!course.ok) return fail(course.error);

      // v75.32: cohort filter on first_paid_at + paying-plan filter +
      // non-counting lessons left out of the denominator + paginated view
      // fetches. Previously counted free-plan members, renewers re-entered
      // cohort, and the view fetch silently truncated past 1000 rows.
      const fetchStudents = () =>
        fetchAllRowsPaginated<
          Pick<Student, "id" | "joined_at" | "first_paid_at" | "membership_status">
        >(() =>
          supabase
            .from("students")
            .select("id, joined_at, first_paid_at, membership_status")
            .not("whop_membership_id", "is", null)
            .in("membership_status", ["active", "past_due"])
            .in("whop_plan_id", PAYING_WHOP_PLAN_IDS_ARRAY as string[])
            .gte("first_paid_at", ADMIN_STUDENT_JOIN_CUTOFF),
        );

      if (course.resetAt != null) {
        const studentsRes = await fetchStudents();
        if (studentsRes.error) return fail(studentsRes.error.message);
        const activity = emptyActivity();
        let total = 0;
        for (const s of studentsRes.data) {
          activity[activityLabel(course.lastByStudent.get(s.id) ?? null)]++;
          total++;
        }
        if (!cancelled) {
          setCounts({
            behind: 0,
            on_pace: 0,
            ahead: 0,
            total,
            loading: false,
            courseIsNew: true,
            activity,
            error: null,
          });
        }
        return;
      }

      const [studentsRes, countsRes, regionsRes, totalLessonsRes] =
        await Promise.all([
          fetchStudents(),
          fetchAllRowsPaginated<{
            student_id: string;
            completed_count: number;
          }>(() =>
            supabase
              .from("student_progress_counts")
              .select("student_id, completed_count"),
          ),
          fetchAllRowsPaginated<{
            student_id: string;
            current_region: string;
          }>(() =>
            supabase
              .from("student_current_region")
              .select("student_id, current_region"),
          ),
          supabase
            .from("lessons")
            .select("id", { count: "exact", head: true })
            .eq("counts_toward_progress", true),
        ]);

      // A failed count shows "—", never a pace against a made-up number.
      const totalLessons =
        !totalLessonsRes.error &&
        typeof totalLessonsRes.count === "number" &&
        totalLessonsRes.count > 0
          ? totalLessonsRes.count
          : null;
      if (totalLessons == null) {
        return fail(
          `lessons could not be counted${totalLessonsRes.error ? `: ${totalLessonsRes.error.message}` : ""}`,
        );
      }

      const countByStudent = new Map<string, number>();
      for (const row of (countsRes.data ?? []) as Array<{
        student_id: string;
        completed_count: number;
      }>) {
        countByStudent.set(row.student_id, row.completed_count);
      }

      const regionByStudent = new Map<string, RegionId>();
      for (const row of (regionsRes.data ?? []) as Array<{
        student_id: string;
        current_region: string;
      }>) {
        regionByStudent.set(row.student_id, row.current_region as RegionId);
      }

      const out: PaceCounts = {
        behind: 0,
        on_pace: 0,
        ahead: 0,
        total: 0,
        loading: false,
        courseIsNew: false,
        activity: emptyActivity(),
        error: null,
      };
      for (const s of studentsRes.data ?? []) {
        // v75.32: anchor day on first_paid_at (real platform tenure)
        // not joined_at (cycle start). Matches the v75.20 day-count
        // contract everywhere else.
        const anchor = s.first_paid_at ?? s.joined_at;
        const day = getDayNumber(anchor);
        if (day > 30) continue;
        const completedCount = countByStudent.get(s.id) ?? 0;
        const currentRegion = regionByStudent.get(s.id) ?? "r1";
        const pace = buildPaceSummary(
          anchor,
          completedCount,
          totalLessons,
          currentRegion,
        );
        out[pace.progressLabel]++;
        out.total++;
      }

      if (!cancelled) setCounts(out);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return counts;
}
