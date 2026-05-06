"use client";

import { TOTAL_LESSONS } from "@/lib/constants";

interface ProgressDialProps {
  /** Number of completed lessons (0..TOTAL_LESSONS). */
  completed: number;
  /** Optional override of the total. Defaults to TOTAL_LESSONS. */
  total?: number;
  /** Pixel size of the SVG (square). Default 44. */
  size?: number;
}

/**
 * Compact progress dial for the TopBar. A single gold-ink stroke arc
 * around a faint track, with the count "{completed} / {total}" inside.
 *
 * Apple-clean: no labels, no percentage text, no ornament. The arc
 * length IS the information. Hover to read a tooltip if needed.
 *
 * Animates smoothly to its target value via CSS transition on
 * stroke-dashoffset (no JS animation needed).
 */
export function ProgressDial({
  completed,
  total = TOTAL_LESSONS,
  size = 44,
}: ProgressDialProps) {
  const stroke = 3;
  const radius = size / 2 - stroke;
  const circumference = 2 * Math.PI * radius;
  const ratio = total > 0 ? Math.min(1, Math.max(0, completed / total)) : 0;
  const dashOffset = circumference * (1 - ratio);

  return (
    <div
      className="flex items-center justify-center shrink-0"
      style={{ width: size, height: size, position: "relative" }}
      title={`${completed} of ${total} lessons complete`}
      aria-label={`${completed} of ${total} lessons complete`}
      role="img"
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden="true"
        style={{ transform: "rotate(-90deg)" }}
      >
        {/* Faint track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(230,192,122,0.18)"
          strokeWidth={stroke}
        />
        {/* Gold ink arc — animates via dashoffset transition */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-gold)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          style={{
            transition:
              "stroke-dashoffset 600ms cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        />
      </svg>
      <span
        className="absolute"
        style={{
          color: "var(--color-text-primary)",
          fontSize: size >= 44 ? 11 : size >= 40 ? 10 : 9,
          fontWeight: 600,
          lineHeight: 1,
          letterSpacing: "-0.01em",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {completed}/{total}
      </span>
    </div>
  );
}
