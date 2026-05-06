"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import type { Student, StudentLessonCompletion } from "@/types/database";
import { getDayNumber } from "@/types/database";
import { TOTAL_LESSONS } from "@/lib/constants";
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
}

export default function KanbanPage() {
  const supabase = createClient();
  const [students, setStudents] = useState<StudentWithProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerStudentId, setDrawerStudentId] = useState<string | null>(null);

  useEffect(() => {
    async function fetchAll() {
      const [studentsRes, completionsRes] = await Promise.all([
        supabase.from("students").select("*").order("joined_at", { ascending: false }),
        supabase
          .from("student_lesson_completions")
          .select("student_id, completed_at, action_completed_at"),
      ]);

      const counts = new Map<string, number>();
      for (const c of (completionsRes.data ?? []) as Pick<
        StudentLessonCompletion,
        "student_id" | "completed_at" | "action_completed_at"
      >[]) {
        if (!c.completed_at) continue;
        counts.set(c.student_id, (counts.get(c.student_id) ?? 0) + 1);
      }

      const out: StudentWithProgress[] = (studentsRes.data ?? []).map((s) => ({
        ...s,
        completedCount: counts.get(s.id) ?? 0,
      }));
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="px-8 pt-8 pb-5 border-b border-border">
        <h1 className="text-2xl font-semibold tracking-tight">Kanban</h1>
        <p className="text-sm text-text-secondary mt-1">
          Students flow through columns automatically based on join date and
          membership status. Click a card to open their detail.
        </p>
      </div>

      {/* Columns */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <div
          className="flex gap-4 px-8 py-6 h-full"
          style={{ minWidth: "max-content" }}
        >
          {COLUMNS.map((col) => {
            const items = grouped.get(col.id) ?? [];
            return (
              <div
                key={col.id}
                className="flex flex-col h-full shrink-0"
                style={{ width: 280 }}
              >
                <div className="flex items-baseline justify-between mb-3 px-1">
                  <div>
                    <p
                      className="font-mono uppercase tracking-widest"
                      style={{
                        fontSize: 10,
                        letterSpacing: "0.18em",
                        color:
                          col.accent === "danger"
                            ? "var(--color-danger)"
                            : col.accent === "success"
                              ? "var(--color-success)"
                              : col.accent === "warm"
                                ? "var(--color-gold)"
                                : "var(--color-ink-dim)",
                      }}
                    >
                      {col.label}
                    </p>
                    <p className="text-[11px] text-text-tertiary mt-0.5">
                      {col.description}
                    </p>
                  </div>
                  <span
                    className="font-mono tabular-nums"
                    style={{
                      fontSize: 12,
                      color: "var(--color-ink-dim)",
                    }}
                  >
                    {items.length}
                  </span>
                </div>

                <div
                  className="flex-1 overflow-y-auto space-y-2 pr-1"
                  style={{ minHeight: 0 }}
                >
                  {items.length === 0 ? (
                    <div
                      className="rounded-lg border border-dashed py-8 text-center"
                      style={{
                        borderColor: "rgba(230,192,122,0.18)",
                        color: "var(--color-ink-faint)",
                        fontSize: 12,
                      }}
                    >
                      No students
                    </div>
                  ) : (
                    items.map((s) => (
                      <StudentCard
                        key={s.id}
                        student={s}
                        progressPercent={Math.round(
                          (s.completedCount / TOTAL_LESSONS) * 100
                        )}
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
