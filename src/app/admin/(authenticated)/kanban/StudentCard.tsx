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
      className="w-full text-left rounded-xl bg-bg-card border border-border p-3 hover:border-accent/40 transition-colors"
    >
      {/* Name + day */}
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <p className="text-sm font-medium text-text-primary truncate">
          {student.name || "Unnamed student"}
        </p>
        <span
          className="font-mono tabular-nums shrink-0"
          style={{
            fontSize: 10,
            letterSpacing: "0.06em",
            color: "var(--color-ink-dim)",
          }}
        >
          D{day}
        </span>
      </div>

      {/* Progress bar */}
      <div
        className="rounded-full overflow-hidden mb-2"
        style={{
          height: 4,
          background: "rgba(230,192,122,0.12)",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${Math.min(100, progressPercent)}%`,
            background: "var(--color-gold)",
            transition: "width 400ms cubic-bezier(0.22,1,0.36,1)",
          }}
        />
      </div>
      <div className="flex items-center justify-between text-[10px] text-text-tertiary mb-2 font-mono">
        <span>{progressPercent}% complete</span>
        <span>{lastActiveLabel}</span>
      </div>

      {/* SOP chips — Day 1 / 7 / 14 / 21 */}
      <div className="flex gap-1 flex-wrap">
        {SOP_TEMPLATES.map((tmpl) => (
          <button
            key={tmpl.id}
            type="button"
            onClick={(e) => handleSopClick(e, tmpl.id)}
            className="text-[10px] font-mono uppercase tracking-wider rounded-md px-2 py-1 transition-colors"
            style={{
              background:
                justCopied === tmpl.id
                  ? "var(--color-gold)"
                  : "rgba(230,192,122,0.08)",
              color:
                justCopied === tmpl.id
                  ? "var(--color-bg-primary)"
                  : "var(--color-gold-light)",
              border: "1px solid rgba(230,192,122,0.2)",
            }}
            title={`Copy ${tmpl.label} message to clipboard`}
          >
            {justCopied === tmpl.id ? "Copied" : tmpl.label}
          </button>
        ))}
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
