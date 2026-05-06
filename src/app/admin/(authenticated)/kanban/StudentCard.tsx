"use client";

import { useState } from "react";
import type { Student } from "@/types/database";
import { getDayNumber } from "@/types/database";
import { SOP_TEMPLATES, renderSopTemplate } from "@/lib/sop-templates";

interface StudentCardProps {
  student: Student;
  progressPercent: number;
  onClick: () => void;
}

/**
 * Compact card for the kanban view. Shows the bare essentials:
 * name, day-of-program, progress bar, last-active relative time,
 * plus 4 SOP message chips that copy a templated message to the
 * clipboard.
 */
export function StudentCard({ student, progressPercent, onClick }: StudentCardProps) {
  const [justCopied, setJustCopied] = useState<string | null>(null);
  const day = getDayNumber(student.joined_at);
  const firstName = student.name?.split(" ")[0] ?? "there";
  const fullName = student.name ?? "there";

  const lastActiveLabel = relativeTime(student.last_active_at);

  function handleSopClick(e: React.MouseEvent, templateId: string) {
    e.stopPropagation(); // don't trigger card onClick
    const tmpl = SOP_TEMPLATES.find((t) => t.id === templateId);
    if (!tmpl) return;
    const body = renderSopTemplate(tmpl, {
      firstName,
      fullName,
      dayNumber: day,
    });
    navigator.clipboard.writeText(body);
    setJustCopied(templateId);
    window.setTimeout(() => setJustCopied(null), 1400);
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left surface-resting transition-colors"
      style={{
        background: "var(--color-bg-card)",
        border: "none",
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
          marginBottom: 12,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <span>{progressPercent}% complete</span>
        <span>{lastActiveLabel}</span>
      </div>

      {/* SOP chips — Day 1 / 7 / 14 / 21 */}
      <div className="flex gap-1.5 flex-wrap">
        {SOP_TEMPLATES.map((tmpl) => {
          const copied = justCopied === tmpl.id;
          return (
            <button
              key={tmpl.id}
              type="button"
              onClick={(e) => handleSopClick(e, tmpl.id)}
              className="transition-colors"
              style={{
                fontSize: 11,
                fontWeight: 500,
                letterSpacing: "-0.005em",
                padding: "4px 8px",
                borderRadius: 6,
                background: copied
                  ? "var(--color-accent)"
                  : "var(--color-bg-elevated)",
                color: copied
                  ? "#FFFFFF"
                  : "var(--color-text-secondary)",
                border: "none",
                cursor: "pointer",
              }}
              title={`Copy ${tmpl.label} message to clipboard`}
            >
              {copied ? "Copied" : tmpl.label}
            </button>
          );
        })}
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
