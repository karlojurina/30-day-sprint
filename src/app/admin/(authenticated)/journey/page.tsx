"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import type {
  Student,
  StudentLessonCompletion,
  RegionId,
} from "@/types/database";
import { getDayNumber } from "@/types/database";
import {
  TOTAL_LESSONS,
  progressPercent,
  ADMIN_STUDENT_JOIN_CUTOFF,
} from "@/lib/constants";
import { buildPaceSummary } from "@/lib/csm-triggers";
import { completedLessonIdsFor } from "@/lib/progress";
import { StudentCard } from "./StudentCard";
import { StudentDrawer } from "./StudentDrawer";

/**
 * Kanban view for Customer Success follow-ups.
 *
 * Six columns derived live from `joined_at` + `membership_status`:
 *
 *   WEEK 1 (days 1–7)     · WEEK 2 (8–14)    · WEEK 3 (15–21)
 *   WEEK 4 (22–30)        · CHURNED          · MONTH 2 (>30d, active)
 *
 * No backing state — students "auto-flow" through columns simply
 * because the day count is computed from joined_at on every render.
 *
 * Click a card → right-side drawer with the per-student detail.
 */

type ColumnId = "week-1" | "week-2" | "week-3" | "week-4" | "churned" | "month-2";

interface Column {
  id: ColumnId;
  label: string;
  description: string;
  accent: "neutral" | "warm" | "danger" | "success";
}

const COLUMNS: Column[] = [
  { id: "week-1", label: "Week 1", description: "Days 1–7", accent: "neutral" },
  { id: "week-2", label: "Week 2", description: "Days 8–14", accent: "neutral" },
  { id: "week-3", label: "Week 3", description: "Days 15–21", accent: "warm" },
  { id: "week-4", label: "Week 4", description: "Days 22–30", accent: "warm" },
  { id: "churned", label: "Churned", description: "Cancelled", accent: "danger" },
  { id: "month-2", label: "Month 2+", description: "Stayed past 30d", accent: "success" },
];

function columnFor(student: Student): ColumnId {
  if (student.membership_status === "canceled") return "churned";
  const day = getDayNumber(student.joined_at);
  if (day > 30 && student.membership_status === "active") return "month-2";
  if (day <= 7) return "week-1";
  if (day <= 14) return "week-2";
  if (day <= 21) return "week-3";
  return "week-4";
}

interface StudentWithProgress extends Student {
  completedCount: number;
  /** Highest region the student has any complete lesson in. r1 default. */
  currentRegion: RegionId;
  /** Pace label vs the linear 30-day glide path. */
  paceLabel: "behind" | "on_pace" | "ahead";
}

const REGION_ORDER: RegionId[] = ["r1", "r2", "r3", "r4"];

export default function KanbanPage() {
  const supabase = createClient();
  const [students, setStudents] = useState<StudentWithProgress[]>([]);
  const [totalLessons, setTotalLessons] = useState<number>(TOTAL_LESSONS);
  const [loading, setLoading] = useState(true);
  const [drawerStudentId, setDrawerStudentId] = useState<string | null>(null);

  useEffect(() => {
    async function fetchAll() {
      // Filter to actual paying students — see /admin/students for rationale.
      // Cutoff: ADMIN_STUDENT_JOIN_CUTOFF (May 1, 2026) — see lib/constants.ts.
      const [studentsRes, completionsRes, lessonsRes] = await Promise.all([
        supabase
          .from("students")
          .select("*")
          .not("whop_membership_id", "is", null)
          .in("membership_status", ["active", "past_due", "canceled"])
          .gte("joined_at", ADMIN_STUDENT_JOIN_CUTOFF)
          .order("joined_at", { ascending: false }),
        supabase
          .from("student_lesson_completions")
          .select("student_id, lesson_id, completed_at, action_completed_at"),
        // Pull lesson id + region_id + requires_action so we can derive
        // each student's current region (highest region they have any
        // completion in) AND so the canonical progress helper knows
        // which lessons are compound (need watch + ship to count).
        supabase.from("lessons").select("id, region_id, requires_action"),
      ]);

      const lessonsList = (lessonsRes.data ?? []) as Array<{
        id: string;
        region_id: string;
        requires_action: boolean;
      }>;
      if (lessonsList.length > 0) {
        setTotalLessons(lessonsList.length);
      }
      const lessonToRegion = new Map(
        lessonsList.map((l) => [l.id, l.region_id as RegionId]),
      );

      // Group completions by student so we can run the canonical
      // "is this lesson complete?" check per-student. Uses the shared
      // helper in src/lib/progress.ts so kanban agrees with every
      // other surface (and with the student_progress_counts view).
      const completionsByStudent = new Map<
        string,
        StudentLessonCompletion[]
      >();
      for (const c of (completionsRes.data ?? []) as StudentLessonCompletion[]) {
        const arr = completionsByStudent.get(c.student_id) ?? [];
        arr.push(c);
        completionsByStudent.set(c.student_id, arr);
      }

      // For each student, derive the count of completed lessons + the
      // highest region they have any completed lesson in (drives the
      // region chip on the card).
      const counts = new Map<string, number>();
      const currentRegionByStudent = new Map<string, RegionId>();
      for (const [studentId, rows] of completionsByStudent) {
        const doneIds = completedLessonIdsFor(rows, lessonsList);
        counts.set(studentId, doneIds.size);
        for (const lid of doneIds) {
          const rid = lessonToRegion.get(lid);
          if (!rid) continue;
          const existing = currentRegionByStudent.get(studentId);
          if (
            !existing ||
            REGION_ORDER.indexOf(rid) > REGION_ORDER.indexOf(existing)
          ) {
            currentRegionByStudent.set(studentId, rid);
          }
        }
      }

      const totalLessonsCount = lessonsList.length || TOTAL_LESSONS;
      const out: StudentWithProgress[] = (studentsRes.data ?? []).map((s) => {
        const completedCount = counts.get(s.id) ?? 0;
        const currentRegion = currentRegionByStudent.get(s.id) ?? "r1";
        const pace = buildPaceSummary(
          s.joined_at,
          completedCount,
          totalLessonsCount,
          currentRegion,
        );
        return {
          ...s,
          completedCount,
          currentRegion,
          paceLabel: pace.progressLabel,
        };
      });
      setStudents(out);
      setLoading(false);
    }
    fetchAll();
  }, [supabase]);

  const grouped = useMemo(() => {
    const map = new Map<ColumnId, StudentWithProgress[]>();
    for (const c of COLUMNS) map.set(c.id, []);
    for (const s of students) {
      const col = columnFor(s);
      map.get(col)?.push(s);
    }
    return map;
  }, [students]);

  // Pace overview — only count students who are still on the journey
  // (in one of the 4 weekly columns). Churned + Month 2+ aren't on
  // the pace curve anymore.
  const paceCounts = useMemo(() => {
    const counts = { behind: 0, on_pace: 0, ahead: 0 };
    for (const s of students) {
      const col = columnFor(s);
      if (col === "churned" || col === "month-2") continue;
      counts[s.paceLabel]++;
    }
    return counts;
  }, [students]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Header — title on the left, pace overview on the right */}
      <header
        style={{
          padding: "32px 48px 20px",
          borderBottom: "1px solid var(--color-border)",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 24,
          flexWrap: "wrap",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <h1
            style={{
              fontSize: 28,
              fontWeight: 600,
              letterSpacing: "-0.025em",
              lineHeight: 1.15,
              color: "var(--color-text-primary)",
            }}
          >
            Student journey
          </h1>
          <p
            style={{
              fontSize: 14,
              color: "var(--color-text-secondary)",
              marginTop: 4,
              letterSpacing: "-0.005em",
            }}
          >
            Students flow through columns automatically based on join date
            and membership status. Click a card to open their detail.
          </p>
        </div>

        {/* Pace overview — three quick stats for everyone still on the
            30-day journey (Week 1-4 columns). Detailed breakdown lives
            on /admin/insights/progress. */}
        <div
          className="flex items-stretch"
          style={{
            gap: 8,
            background: "var(--color-bg-card)",
            border: "1px solid var(--color-border)",
            borderRadius: 12,
            padding: "10px 14px",
          }}
        >
          <PaceStat
            label="Behind"
            value={paceCounts.behind}
            color="var(--color-danger)"
          />
          <Divider />
          <PaceStat
            label="On pace"
            value={paceCounts.on_pace}
            color="var(--color-text-primary)"
          />
          <Divider />
          <PaceStat
            label="Ahead"
            value={paceCounts.ahead}
            color="var(--color-success)"
          />
        </div>
      </header>

      {/* Columns */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <div
          className="flex h-full"
          style={{
            gap: 12,
            padding: "20px 48px",
            minWidth: "max-content",
          }}
        >
          {COLUMNS.map((col) => {
            const items = grouped.get(col.id) ?? [];
            const labelColor =
              col.accent === "danger"
                ? "var(--color-danger)"
                : col.accent === "success"
                  ? "var(--color-success)"
                  : col.accent === "warm"
                    ? "var(--color-accent-dark)"
                    : "var(--color-text-secondary)";
            return (
              <div
                key={col.id}
                className="flex flex-col h-full shrink-0"
                style={{ width: 288 }}
              >
                <div
                  className="flex items-baseline justify-between"
                  style={{ marginBottom: 10, padding: "0 4px" }}
                >
                  <div>
                    <p
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        letterSpacing: "0.04em",
                        textTransform: "uppercase",
                        color: labelColor,
                      }}
                    >
                      {col.label}
                    </p>
                    <p
                      style={{
                        fontSize: 11,
                        color: "var(--color-text-tertiary)",
                        marginTop: 2,
                        letterSpacing: "-0.005em",
                      }}
                    >
                      {col.description}
                    </p>
                  </div>
                  <span
                    style={{
                      fontSize: 12,
                      color: "var(--color-text-tertiary)",
                      fontVariantNumeric: "tabular-nums",
                      fontWeight: 500,
                    }}
                  >
                    {items.length}
                  </span>
                </div>

                <div
                  className="flex-1 overflow-y-auto"
                  style={{
                    minHeight: 0,
                    paddingRight: 4,
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  {items.length === 0 ? (
                    <div
                      style={{
                        padding: "32px 16px",
                        textAlign: "center",
                        fontSize: 12,
                        color: "var(--color-text-tertiary)",
                        background: "var(--color-bg-elevated)",
                        borderRadius: 12,
                      }}
                    >
                      No students
                    </div>
                  ) : (
                    items.map((s) => (
                      <StudentCard
                        key={s.id}
                        student={s}
                        progressPercent={progressPercent(
                          s.completedCount,
                          totalLessons
                        )}
                        currentRegion={s.currentRegion}
                        paceLabel={s.paceLabel}
                        onClick={() => setDrawerStudentId(s.id)}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Drawer */}
      <StudentDrawer
        studentId={drawerStudentId}
        onClose={() => setDrawerStudentId(null)}
      />
    </div>
  );
}

/** Small stat cell for the pace overview row. Value above label,
 *  numeric tabular alignment so the trio line up cleanly. */
function PaceStat({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center"
      style={{ minWidth: 64, padding: "0 6px" }}
    >
      <span
        style={{
          fontSize: 20,
          fontWeight: 600,
          color,
          letterSpacing: "-0.018em",
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1.1,
        }}
      >
        {value}
      </span>
      <span
        style={{
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          color: "var(--color-text-tertiary)",
          marginTop: 4,
        }}
      >
        {label}
      </span>
    </div>
  );
}

function Divider() {
  return (
    <div
      aria-hidden="true"
      style={{
        width: 1,
        background: "var(--color-border)",
        margin: "2px 0",
      }}
    />
  );
}
