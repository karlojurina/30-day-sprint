"use client";

/**
 * Region to-do widget. Sits next to the StatsWidget on the overview,
 * top-left of the map. Lists the concrete things the student needs
 * to do to finish their current region.
 *
 * Three todo kinds:
 *   - watch_lessons_in_region: counts non-action lessons in the
 *     region. Auto-tracked via the Whop watch sync + manual toggles.
 *   - action_shipped: counts a specific lesson's action_completed_at.
 *     Renders an inline "Mark Ad Shipped" button.
 *   - manual: honor-system todo not tied to a lesson. Backed by
 *     student_manual_todos (v66). Renders a "Mark done" button.
 *
 * The "watch" count deliberately excludes lessons where
 * requires_action = true. Those have their own dedicated
 * "Ship your X ad" todos and shouldn't double-count.
 *
 * v66 - arrow nav. Student can scroll backward through completed
 * regions (read-only). Cannot peek forward into locked regions.
 * Per Karlo + Lovro: prevent accidental edits to old state.
 */

import { useEffect, useMemo, useState } from "react";
import { useStudent } from "@/contexts/StudentContext";

type TodoKind =
  | { type: "watch_lessons_in_region"; regionId: string }
  | { type: "action_shipped"; lessonId: string }
  | { type: "manual"; todoKey: string };

interface TodoSpec {
  id: string;
  title: string;
  kind: TodoKind;
}

const REGION_TODOS: Record<string, TodoSpec[]> = {
  r1: [
    {
      id: "r1_watch_lessons",
      title: "Watch all R1 lessons",
      kind: { type: "watch_lessons_in_region", regionId: "r1" },
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
  r2: [
    {
      id: "r2_watch_lessons",
      title: "Watch all R2 lessons",
      kind: { type: "watch_lessons_in_region", regionId: "r2" },
    },
    {
      id: "r2_ship_vsl",
      title: "Ship your VSL ad",
      kind: { type: "action_shipped", lessonId: "l022" },
    },
    {
      id: "r2_ship_highprod",
      title: "Ship your High-Prod ad",
      kind: { type: "action_shipped", lessonId: "l024" },
    },
  ],
  // v72.2 - R3 + R4 are 2-todo regions (Karlo's call). They don't
  // have a natural third shippable action, so no placeholder.
  r3: [
    {
      id: "r3_watch_lessons",
      title: "Watch all R3 lessons",
      kind: { type: "watch_lessons_in_region", regionId: "r3" },
    },
    {
      id: "r3_ship_static",
      title: "Ship your Static ad",
      kind: { type: "action_shipped", lessonId: "l049" },
    },
  ],
  r4: [
    {
      id: "r4_watch_lessons",
      title: "Watch all R4 lessons",
      kind: { type: "watch_lessons_in_region", regionId: "r4" },
    },
    {
      id: "r4_claim_bounty",
      title: "Claim your Bounty Access",
      kind: { type: "action_shipped", lessonId: "l057" },
    },
  ],
};

const REGION_ORDER = ["r1", "r2", "r3", "r4"] as const;
type RegionId = (typeof REGION_ORDER)[number];

export function RegionTodoWidget() {
  const {
    lessons,
    completedLessonIds,
    actionShippedLessonIds,
    currentLesson,
    regions,
    toggleLessonAction,
    manualTodosDone,
    toggleManualTodo,
  } = useStudent();

  // Anchor: where the student is currently working. This is the
  // default view AND the upper bound for the arrow nav (no peeking
  // forward). currentLesson is null in two cases:
  //   - Brand new account, no progress yet -> fall back to r1
  //   - Student has completed ALL lessons -> anchor to the highest
  //     region with any completion so they can scroll back through
  //     everything (v66.1 fix: was trapping post-sprint students on
  //     r1 with both arrows greyed out).
  const currentRegionId = useMemo<RegionId>(() => {
    if (currentLesson?.region_id) return currentLesson.region_id as RegionId;
    let highest: RegionId = "r1";
    for (const l of lessons) {
      if (
        completedLessonIds.has(l.id) &&
        REGION_ORDER.includes(l.region_id as RegionId)
      ) {
        const lessonIdx = REGION_ORDER.indexOf(l.region_id as RegionId);
        if (lessonIdx > REGION_ORDER.indexOf(highest)) {
          highest = l.region_id as RegionId;
        }
      }
    }
    return highest;
  }, [currentLesson, lessons, completedLessonIds]);
  const currentIdx = Math.max(0, REGION_ORDER.indexOf(currentRegionId));

  // Viewed region: which region's todos are currently rendered.
  // Defaults to the current region. Arrows shift this back and
  // forth within [0, currentIdx]. We snap back to current whenever
  // currentRegionId changes (e.g. lesson sync bumps the student to
  // the next region).
  const [viewedIdx, setViewedIdx] = useState(currentIdx);
  useEffect(() => {
    setViewedIdx(currentIdx);
  }, [currentIdx]);
  const clampedIdx = Math.min(Math.max(0, viewedIdx), currentIdx);
  const viewedRegionId = REGION_ORDER[clampedIdx];
  const region = regions.find((r) => r.id === viewedRegionId);
  const todos = REGION_TODOS[viewedRegionId] ?? [];

  // Past region = anything before the current one. Buttons render
  // read-only so the student doesn't accidentally undo old state.
  const isPastRegion = clampedIdx < currentIdx;
  const canGoBack = clampedIdx > 0;
  const canGoForward = clampedIdx < currentIdx;

  // Watch-only count: lessons in the VIEWED region where
  // requires_action is false. Action items have their own todos.
  const regionLessonStats = useMemo(() => {
    const inRegion = lessons.filter(
      (l) => l.region_id === viewedRegionId && !l.requires_action,
    );
    const total = inRegion.length;
    const done = inRegion.filter((l) => completedLessonIds.has(l.id)).length;
    return { total, done };
  }, [lessons, completedLessonIds, viewedRegionId]);

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
      {/* Header - region label flanked by < > arrows */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <ArrowButton
          direction="back"
          disabled={!canGoBack}
          onClick={() => setViewedIdx((i) => Math.max(0, i - 1))}
        />
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.10em",
            textTransform: "uppercase",
            color: isPastRegion
              ? "rgba(255,255,255,0.34)"
              : "rgba(255,255,255,0.45)",
            flex: 1,
            textAlign: "center",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
          }}
        >
          Region {numeral} · To-do
          {isPastRegion && (
            <span
              style={{
                fontSize: 8.5,
                padding: "1px 6px",
                borderRadius: 4,
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.10)",
                letterSpacing: "0.10em",
              }}
            >
              Read-only
            </span>
          )}
        </span>
        <ArrowButton
          direction="forward"
          disabled={!canGoForward}
          onClick={() => setViewedIdx((i) => Math.min(currentIdx, i + 1))}
        />
      </div>

      {/* Rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {todos.map((todo) => {
          if (todo.kind.type === "watch_lessons_in_region") {
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
                    disabled={isPastRegion}
                    onClick={() => {
                      if (isPastRegion) return;
                      void toggleLessonAction(lessonId);
                    }}
                  />
                }
              />
            );
          }
          if (todo.kind.type === "manual") {
            const todoKey = todo.kind.todoKey;
            const isDone = manualTodosDone.has(todoKey);
            return (
              <TodoRow
                key={todo.id}
                title={todo.title}
                isDone={isDone}
                action={
                  <ShipButton
                    shipped={isDone}
                    disabled={isPastRegion}
                    label={isDone ? "Done" : "Mark done"}
                    onClick={() => {
                      if (isPastRegion) return;
                      void toggleManualTodo(todoKey);
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

function ArrowButton({
  direction,
  disabled,
  onClick,
}: {
  direction: "back" | "forward";
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={direction === "back" ? "Previous region" : "Next region"}
      style={{
        flexShrink: 0,
        width: 22,
        height: 22,
        borderRadius: 6,
        background: "transparent",
        border: "1px solid rgba(255,255,255,0.10)",
        color: disabled
          ? "rgba(255,255,255,0.20)"
          : "rgba(255,255,255,0.78)",
        cursor: disabled ? "default" : "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? 0.45 : 1,
        transition: "opacity 150ms, color 150ms",
      }}
    >
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {direction === "back" ? (
          <path d="M15 18l-6-6 6-6" />
        ) : (
          <path d="M9 18l6-6-6-6" />
        )}
      </svg>
    </button>
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
  disabled = false,
  label,
  onClick,
}: {
  shipped: boolean;
  disabled?: boolean;
  /** Override the default "Shipped" / "Mark shipped" label.
   *  Used by manual todos which show "Done" / "Mark done". */
  label?: string;
  onClick: () => void;
}) {
  const resolvedLabel =
    label ?? (shipped ? "Shipped" : "Mark shipped");
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        flexShrink: 0,
        padding: "4px 10px",
        borderRadius: 999,
        background: disabled
          ? "rgba(255,255,255,0.04)"
          : shipped
            ? "rgba(255,255,255,0.08)"
            : "rgba(255,255,255,0.94)",
        border: disabled
          ? "1px solid rgba(255,255,255,0.10)"
          : shipped
            ? "1px solid rgba(255,255,255,0.18)"
            : "none",
        color: disabled
          ? "rgba(255,255,255,0.32)"
          : shipped
            ? "rgba(255,255,255,0.62)"
            : "rgba(15,17,21,0.92)",
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.7 : 1,
      }}
      title={
        disabled
          ? "Read-only - past region"
          : shipped
            ? "Tap to undo"
            : "Mark this as done"
      }
    >
      {resolvedLabel}
    </button>
  );
}
