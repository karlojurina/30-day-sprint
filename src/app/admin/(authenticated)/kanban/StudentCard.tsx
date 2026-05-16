"use client";

import type { Student } from "@/types/database";
import { getDayNumber } from "@/types/database";

interface StudentCardProps {
  student: Student;
  progressPercent: number;
  onClick: () => void;
}

/**
 * Compact card for the kanban view. Shows the bare essentials:
 * name, day-of-program, progress bar, last-active relative time.
 *
 * Day-1/7/14/21 SOP chips were removed 2026-05-16 — the CSM templates
 * + task queue replace them. Astrid copies from /admin/tasks now.
 */
export function StudentCard({ student, progressPercent, onClick }: StudentCardProps) {
  const day = getDayNumber(student.joined_at);
  const lastActiveLabel = relativeTime(student.last_active_at);

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left surface-resting transition-colors"
      style={{
        background: "var(--color-bg-card)",
        borderRadius: 12,
        padding: 14,
        cursor: "pointer",
      }}
    >
      {/* Name + day */}
      <div className="flex items-baseline justify-between gap-2" style={{ marginBottom: 10 }}>
        <p
          className="truncate"
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: "var(--color-text-primary)",
            letterSpacing: "-0.011em",
          }}
        >
          {student.name || "Unnamed student"}
        </p>
        <span
          className="shrink-0"
          style={{
            fontSize: 11,
            color: "var(--color-text-tertiary)",
            fontVariantNumeric: "tabular-nums",
            fontWeight: 500,
          }}
        >
          Day {day}
        </span>
      </div>

      {/* Progress bar */}
      <div
        style={{
          height: 4,
          borderRadius: 2,
          background: "var(--color-fill-secondary, rgba(20,20,24,0.06))",
          overflow: "hidden",
          marginBottom: 8,
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${Math.min(100, progressPercent)}%`,
            background: "var(--color-accent)",
            transition: "width 250ms cubic-bezier(0.25, 0.1, 0.25, 1)",
          }}
        />
      </div>
      <div
        className="flex items-center justify-between"
        style={{
          fontSize: 11,
          color: "var(--color-text-tertiary)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <span>{progressPercent}% complete</span>
        <span>{lastActiveLabel}</span>
      </div>
    </button>
  );
}

function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "just now";
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
