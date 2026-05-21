"use client";

/**
 * Shared hook: counts of students currently on the 30-day journey
 * (Week 1-4 columns) split by pace label — behind / on_pace / ahead.
 *
 * Used by:
 *   - the admin sidebar's Student-journey nav button (shows a small
 *     red dot for behind count)
 *   - the /admin/journey page header (full three-stat overview)
 *   - /admin/insights/progress (detailed pace breakdown card)
 *
 * Both surfaces fetch independently, but the SQL is small (one count
 * query against students + a join through completions + lessons) so
 * cost is negligible. Centralising the hook keeps the math identical
 * across surfaces.
 *
 * Cohort: only students who joined ON OR AFTER
 * ADMIN_STUDENT_JOIN_CUTOFF (May 1 2026) — matches the journey page.
 * Excludes churned + month-2 students (they aren't on the curve).
 */

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { ADMIN_STUDENT_JOIN_CUTOFF, TOTAL_LESSONS } from "@/lib/constants";
import { getDayNumber } from "@/types/database";
import type { RegionId } from "@/types/database";
import { buildPaceSummary } from "@/lib/csm-triggers";
import { completedLessonIdsFor } from "@/lib/progress";

export interface PaceCounts {
  behind: number;
  on_pace: number;
  ahead: number;
  /** All three summed — useful for nav-button "any" badge. */
  total: number;
  /** True while the first fetch is in flight. */
  loading: boolean;
}

const REGION_ORDER: RegionId[] = ["r1", "r2", "r3", "r4"];

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
      const [studentsRes, completionsRes, lessonsRes] = await Promise.all([
        supabase
          .from("students")
          .select("id, joined_at, membership_status")
          .not("whop_membership_id", "is", null)
          .in("membership_status", ["active", "past_due"])
          .gte("joined_at", ADMIN_STUDENT_JOIN_CUTOFF),
        supabase
          .from("student_lesson_completions")
          .select("student_id, lesson_id, completed_at, action_completed_at, skipped_at"),
        supabase.from("lessons").select("id, region_id, requires_action"),
      ]);

      const lessons = (lessonsRes.data ?? []) as Array<{
        id: string;
        region_id: string;
        requires_action: boolean;
      }>;
      const totalLessons = lessons.length || TOTAL_LESSONS;
      const lessonToRegion = new Map(
        lessons.map((l) => [l.id, l.region_id as RegionId]),
      );

      const completionsByStudent = new Map<
        string,
        Array<{
          lesson_id: string;
          completed_at: string | null;
          action_completed_at: string | null;
          skipped_at: string | null;
        }>
      >();
      for (const c of completionsRes.data ?? []) {
        const arr = completionsByStudent.get(c.student_id) ?? [];
        arr.push(c);
        completionsByStudent.set(c.student_id, arr);
      }

      const out: PaceCounts = {
        behind: 0,
        on_pace: 0,
        ahead: 0,
        total: 0,
        loading: false,
      };
      for (const s of studentsRes.data ?? []) {
        // Skip students past day 30 — not on the curve anymore.
        const day = getDayNumber(s.joined_at);
        if (day > 30) continue;
        const rows = completionsByStudent.get(s.id) ?? [];
        const doneIds = completedLessonIdsFor(rows, lessons);
        let currentRegion: RegionId = "r1";
        for (const lid of doneIds) {
          const rid = lessonToRegion.get(lid);
          if (
            rid &&
            REGION_ORDER.indexOf(rid) > REGION_ORDER.indexOf(currentRegion)
          ) {
            currentRegion = rid;
          }
        }
        const pace = buildPaceSummary(
          s.joined_at,
          doneIds.size,
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
