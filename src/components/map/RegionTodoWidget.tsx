"use client";

/**
 * v44 — Region to-do widget. Sits next to the StatsWidget on the
 * overview, top-left of the map. Lists the concrete things the student
 * needs to do to finish their current region.
 *
 * R1 (only one wired today):
 *   1. Complete all lessons   — auto-tracked from completedLessonIds
 *   2. Ship Organic ad (l018) — manual "Mark Ad Shipped"
 *   3. Ship UGC ad (l020)     — manual "Mark Ad Shipped"
 *
 * R2/R3/R4: not specced yet — widget hides itself when no tasks.
 *
 * Per Karlo's brief:
 *   - inline Mark Ad Shipped on each row (no need to open the lesson)
 *   - the Discord link is captured separately and stays optional;
 *     this widget doesn't even surface it
 *   - the discount check still runs server-side on action_completed_at,
 *     so a student who fakes a row gets caught in the discount review
 */

import { useMemo } from "react";
import { useStudent } from "@/contexts/StudentContext";

type TodoKind =
  | { type: "all_lessons_in_region"; regionId: string }
  | { type: "action_shipped"; lessonId: string };

interface TodoSpec {
  id: string;
  title: string;
  kind: TodoKind;
}

const REGION_TODOS: Record<string, TodoSpec[]> = {
  r1: [
    {
      id: "r1_all_lessons",
      title: "Complete all R1 lessons",
      kind: { type: "all_lessons_in_region", regionId: "r1" },
    },
    {
      id: "r1_ship_organic",
      title: "Ship your Organic ad",
      kind: { type: "action_shipped", lessonId: "l018" },
    },
    {
      id: "r1_ship_ugc",
      title: "Ship your UGC ad",
      kind: { type: "action_shipped", lessonId: "l020" },
    },
  ],
  // R2/R3/R4: empty for now — Karlo to spec.
  r2: [],
  r3: [],
  r4: [],
};

export function RegionTodoWidget() {
  const {
    lessons,
    completedLessonIds,
    actionShippedLessonIds,
    currentLesson,
    regions,
    toggleLessonAction,
  } = useStudent();

  // Anchor region: where the student is currently working. Falls back
  // to r1 (the first region) for new accounts before any progress.
  const currentRegionId = (currentLesson?.region_id as string) ?? "r1";
  const region = regions.find((r) => r.id === currentRegionId);
  const todos = REGION_TODOS[currentRegionId] ?? [];

  // Aggregate R1 lesson totals once (cheap, but memoize for cleanliness).
  const regionLessonStats = useMemo(() => {
    const inRegion = lessons.filter((l) => l.region_id === currentRegionId);
    const total = inRegion.length;
    const done = inRegion.filter((l) => completedLessonIds.has(l.id)).length;
    return { total, done };
  }, [lessons, completedLessonIds, currentRegionId]);

  if (todos.length === 0 || !region) return null;

  const numeral =
    ["I", "II", "III", "IV"][(region.order_num ?? 1) - 1] ?? "";

  return (
    <div
      style={{
        position: "absolute",
        top: 20,
        left: 20 + 380 + 12, // sits flush to the right of StatsWidget
        zIndex: 30,
        width: 300,
        padding: "18px 20px",
        borderRadius: 18,
        background: "rgba(15, 17, 21, 0.62)",
        border: "1px solid rgba(255, 255, 255, 0.14)",
        backdropFilter: "blur(24px) saturate(140%)",
        WebkitBackdropFilter: "blur(24px) saturate(140%)",
        boxShadow:
          "0 14px 40px rgba(0,0,0,0.50), 0 1px 0 rgba(255,255,255,0.05) inset",
        color: "rgba(255, 255, 255, 0.94)",
        fontSize: 13,
        letterSpacing: "-0.005em",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.10em",
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.45)",
          }}
        >
          Region {numeral} · To-do
        </span>
      </div>

      {/* Rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {todos.map((todo) => {
          if (todo.kind.type === "all_lessons_in_region") {
            const { done, total } = regionLessonStats;
            const isDone = total > 0 && done === total;
            return (
              <TodoRow
                key={todo.id}
                title={todo.title}
                isDone={isDone}
                meta={`${done} / ${total}`}
              />
            );
          }
          if (todo.kind.type === "action_shipped") {
            const lessonId = todo.kind.lessonId;
            const isDone = actionShippedLessonIds.has(lessonId);
            return (
              <TodoRow
                key={todo.id}
                title={todo.title}
                isDone={isDone}
                action={
                  <ShipButton
                    shipped={isDone}
                    onClick={() => {
                      void toggleLessonAction(lessonId);
                    }}
                  />
                }
              />
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}

function TodoRow({
  title,
  isDone,
  meta,
  action,
}: {
  title: string;
  isDone: boolean;
  meta?: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "6px 8px",
        borderRadius: 10,
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <CheckCircle done={isDone} />
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 13,
          fontWeight: 500,
          color: isDone
            ? "rgba(255,255,255,0.55)"
            : "rgba(255,255,255,0.94)",
          textDecoration: isDone ? "line-through" : "none",
          letterSpacing: "-0.005em",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {title}
      </span>
      {meta && (
        <span
          style={{
            fontSize: 11,
            color: "rgba(255,255,255,0.55)",
            fontVariantNumeric: "tabular-nums",
            flexShrink: 0,
          }}
        >
          {meta}
        </span>
      )}
      {action}
    </div>
  );
}

function CheckCircle({ done }: { done: boolean }) {
  return (
    <div
      aria-hidden="true"
      style={{
        flexShrink: 0,
        width: 18,
        height: 18,
        borderRadius: "50%",
        background: done
          ? "rgba(34, 197, 94, 0.92)"
          : "rgba(255,255,255,0.06)",
        border: done
          ? "1px solid rgba(34, 197, 94, 1)"
          : "1px solid rgba(255,255,255,0.20)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {done && (
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="rgba(15,17,21,0.92)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M5 13l4 4L19 7" />
        </svg>
      )}
    </div>
  );
}

function ShipButton({
  shipped,
  onClick,
}: {
  shipped: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flexShrink: 0,
        padding: "4px 10px",
        borderRadius: 999,
        background: shipped
          ? "rgba(255,255,255,0.08)"
          : "rgba(255,255,255,0.94)",
        border: shipped
          ? "1px solid rgba(255,255,255,0.18)"
          : "none",
        color: shipped ? "rgba(255,255,255,0.62)" : "rgba(15,17,21,0.92)",
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        cursor: "pointer",
      }}
      title={shipped ? "Tap to undo" : "Mark this ad as shipped"}
    >
      {shipped ? "Shipped" : "Mark shipped"}
    </button>
  );
}
