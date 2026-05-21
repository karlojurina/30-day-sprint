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
 */

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { ADMIN_STUDENT_JOIN_CUTOFF, TOTAL_LESSONS } from "@/lib/constants";
import { getDayNumber } from "@/types/database";
import type { RegionId } from "@/types/database";
import { buildPaceSummary } from "@/lib/csm-triggers";

export interface PaceCounts {
  behind: number;
  on_pace: number;
  ahead: number;
  /** All three summed — useful for nav-button "any" badge. */
  total: number;
  /** True while the first fetch is in flight. */
  loading: boolean;
}

export function useJourneyPaceCounts(): PaceCounts {
  const [counts, setCounts] = useState<PaceCounts>({
    behind: 0,
    on_pace: 0,
    ahead: 0,
    total: 0,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    (async () => {
      const [studentsRes, countsRes, regionsRes, totalLessonsRes] =
        await Promise.all([
          supabase
            .from("students")
            .select("id, joined_at, membership_status")
            .not("whop_membership_id", "is", null)
            .in("membership_status", ["active", "past_due"])
            .gte("joined_at", ADMIN_STUDENT_JOIN_CUTOFF),
          supabase
            .from("student_progress_counts")
            .select("student_id, completed_count"),
          supabase
            .from("student_current_region")
            .select("student_id, current_region"),
          supabase.from("lessons").select("id", { count: "exact", head: true }),
        ]);

      const totalLessons =
        typeof totalLessonsRes.count === "number" &&
        totalLessonsRes.count > 0
          ? totalLessonsRes.count
          : TOTAL_LESSONS;

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
      };
      for (const s of studentsRes.data ?? []) {
        const day = getDayNumber(s.joined_at);
        if (day > 30) continue;
        const completedCount = countByStudent.get(s.id) ?? 0;
        const currentRegion = regionByStudent.get(s.id) ?? "r1";
        const pace = buildPaceSummary(
          s.joined_at,
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
