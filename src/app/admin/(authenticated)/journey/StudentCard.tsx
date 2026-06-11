"use client";

import type { Student, RegionId } from "@/types/database";
import { getDayNumber } from "@/types/database";
import { Avatar, PacePill, Pill } from "@/components/admin/ui";
import { isCanceling } from "@/lib/admin/metrics-definitions";

interface StudentCardProps {
  student: Student;
  progressPercent: number;
  currentRegion: RegionId;
  paceLabel: "behind" | "on_pace" | "ahead";
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
const REGION_NUMERAL: Record<RegionId, string> = {
  r1: "I",
  r2: "II",
  r3: "III",
  r4: "IV",
};

const REGION_NAME: Record<RegionId, string> = {
  r1: "Foundation",
  r2: "Production",
  r3: "Strategy",
  r4: "Gate",
};

export function StudentCard({
  student,
  progressPercent,
  currentRegion,
  paceLabel,
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
        <RegionChip region={currentRegion} />
        <PacePill label={paceLabel} compact />
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
            width: `${Math.min(100, progressPercent)}%`,
            background: "var(--color-accent)",
            transition: "width 250ms cubic-bezier(0.25, 0.1, 0.25, 1)",
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
        <span>{progressPercent}% complete</span>
        <span>{lastActiveLabel}</span>
      </div>
    </button>
  );
}

/** Compact region chip: Roman numeral + short name. Mirrors the
 *  region numerals used on the map for at-a-glance recognition. */
function RegionChip({ region }: { region: RegionId }) {
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
        {REGION_NUMERAL[region]}
      </span>
      <span>{REGION_NAME[region]}</span>
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
