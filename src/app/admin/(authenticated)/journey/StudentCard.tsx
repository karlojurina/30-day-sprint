"use client";

import type { Student } from "@/types/database";
import { getDayNumber } from "@/types/database";
import { Avatar, PacePill, Pill } from "@/components/admin/ui";
import { isCanceling } from "@/lib/admin/metrics-definitions";
import type { ActivityLabel } from "@/lib/curriculum-reset";
import { ACTIVITY_TEXT, ACTIVITY_TONE } from "@/lib/useJourneyPaceCounts";

/** The student's area, as `regions` names and orders it. */
export interface CardArea {
  order: number;
  name: string;
}

/**
 * Before the course switch: the pace pill. After it: the activity pill.
 * Null when it cannot be known (a read failed): the card shows neither.
 */
export type CardPace =
  | { course: "old"; label: "behind" | "on_pace" | "ahead" }
  | { course: "new"; label: ActivityLabel };

interface StudentCardProps {
  student: Student;
  /** Null when the lessons could not be counted: the card shows "—". */
  progressPercent: number | null;
  /** Null when the areas could not be read: no chip. */
  area: CardArea | null;
  pace: CardPace | null;
  onClick: () => void;
}

/**
 * Kanban card. Surfaces the four things Karlo asked for at a glance:
 *
 *   1. WHO          — avatar + name (line 1)
 *   2. WHEN         — Day N chip on the right (line 1)
 *   3. WHERE        — current region chip + pace pill (line 2)
 *   4. PROGRESS     — bar + percent + last-active (lines 3-4)
 *
 * Clicking opens the right-side drawer with the full detail.
 */
const NUMERALS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

/** The area's numeral from its order_num: I..IV on the old course, I..VIII on the new. */
function numeral(order: number): string {
  return NUMERALS[order - 1] ?? String(order);
}

export function StudentCard({
  student,
  progressPercent,
  area,
  pace,
  onClick,
}: StudentCardProps) {
  // v75.18: day from first_paid_at (original signup).
  const day = getDayNumber(student.first_paid_at ?? student.joined_at);
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
        border: "1px solid var(--color-border)",
      }}
    >
      {/* Line 1: avatar + name + day chip */}
      <div
        className="flex items-center"
        style={{ gap: 10, marginBottom: 10 }}
      >
        <Avatar src={student.avatar_url} name={student.name} size={28} />
        <p
          className="truncate flex-1 min-w-0"
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

      {/* Line 2: region chip + pace pill + canceling pill (if applicable)
          v75.47: amber "Canceling" pill for students who clicked cancel
          in Whop but still have access through end of cycle. They stay
          in their current week column (still active) but Karlo can
          see at-a-glance that they're churning. */}
      <div
        className="flex items-center"
        style={{ gap: 6, marginBottom: 10, flexWrap: "wrap" }}
      >
        {area && <RegionChip area={area} />}
        {pace?.course === "old" && <PacePill label={pace.label} compact />}
        {pace?.course === "new" && (
          <Pill tone={ACTIVITY_TONE[pace.label]}>{ACTIVITY_TEXT[pace.label]}</Pill>
        )}
        {isCanceling(student) && (
          <Pill tone="warning">
            <span aria-hidden="true">⏳</span>
            <span style={{ marginLeft: 4 }}>Canceling</span>
          </Pill>
        )}
      </div>

      {/* Line 3: progress bar */}
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
            width: `${Math.min(100, progressPercent ?? 0)}%`,
            background: "var(--color-accent)",
            transition: "width 250ms var(--ease-default)",
          }}
        />
      </div>
      {/* Line 4: progress count + last active */}
      <div
        className="flex items-center justify-between"
        style={{
          fontSize: 11,
          color: "var(--color-text-tertiary)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <span>
          {progressPercent == null ? "—" : `${progressPercent}% complete`}
        </span>
        <span>{lastActiveLabel}</span>
      </div>
    </button>
  );
}

/** Compact region chip: Roman numeral + the area's name from `regions`.
 *  Mirrors the region numerals used on the map for at-a-glance recognition. */
function RegionChip({ area }: { area: CardArea }) {
  return (
    <span
      className="inline-flex items-center"
      style={{
        gap: 5,
        padding: "2px 8px",
        borderRadius: 999,
        background: "var(--color-bg-elevated)",
        border: "1px solid var(--color-border)",
        fontSize: 10,
        fontWeight: 600,
        color: "var(--color-text-secondary)",
        letterSpacing: "0.02em",
      }}
    >
      <span
        style={{
          color: "var(--color-accent-dark)",
          fontFamily: "var(--font-mono)",
          fontSize: 10,
        }}
      >
        {numeral(area.order)}
      </span>
      <span>{area.name}</span>
    </span>
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
