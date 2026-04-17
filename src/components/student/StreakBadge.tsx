"use client";

import { useStudent } from "@/contexts/StudentContext";

export function StreakBadge() {
  const { streak } = useStudent();

  if (streak.current === 0) return null;

  // Visual milestones
  const isMilestone7 = streak.current >= 7;
  const isMilestone14 = streak.current >= 14;
  const isMilestone21 = streak.current >= 21;
  const isMilestone30 = streak.current >= 30;

  let flameColor = "var(--color-text-tertiary)";
  let textColor = "var(--color-text-secondary)";
  let bgClass = "bg-[var(--color-bg-elevated)]";
  let borderClass = "border-[var(--color-border)]";
  let glowClass = "";

  if (isMilestone30) {
    flameColor = "#FFD700";
    textColor = "#FFD700";
    bgClass = "bg-[#FFD700]/10";
    borderClass = "border-[#FFD700]/30";
    glowClass = "shadow-[0_0_12px_rgba(255,215,0,0.3)]";
  } else if (isMilestone21) {
    flameColor = "var(--color-accent)";
    textColor = "var(--color-accent)";
    bgClass = "bg-[var(--color-accent)]/10";
    borderClass = "border-[var(--color-accent)]/30";
    glowClass = "shadow-[0_0_8px_var(--color-accent-glow)]";
  } else if (isMilestone14) {
    flameColor = "var(--color-accent)";
    textColor = "var(--color-accent-light)";
  } else if (isMilestone7) {
    flameColor = "var(--color-accent)";
    textColor = "var(--color-text-primary)";
  }

  return (
    <div
      className={`
        flex items-center gap-1 px-2 py-0.5 rounded-full
        border ${bgClass} ${borderClass} ${glowClass}
        transition-all duration-300
      `}
    >
      <span
        className={`text-[13px] ${isMilestone7 ? "text-[15px]" : ""}`}
        style={{ color: flameColor }}
      >
        🔥
      </span>
      <span
        className="font-mono text-[11px] font-semibold tabular-nums"
        style={{ color: textColor }}
      >
        {streak.current}
      </span>
    </div>
  );
}
