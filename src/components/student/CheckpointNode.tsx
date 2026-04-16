"use client";

import { forwardRef } from "react";
import { motion } from "framer-motion";
import type { Checkpoint } from "@/types/database";
import { getCheckpointTheme, colorVarsForFamily } from "@/lib/checkpoints";

interface CheckpointNodeProps {
  checkpoint: Checkpoint;
  completed: number;
  total: number;
  isComplete: boolean;
  isCurrent: boolean;
  isOpen: boolean;
  indexInPath: number; // for snake offset
  onToggle: () => void;
}

export const CheckpointNode = forwardRef<HTMLDivElement, CheckpointNodeProps>(
  function CheckpointNode(
    {
      checkpoint,
      completed,
      total,
      isComplete,
      isCurrent,
      isOpen,
      indexInPath,
      onToggle,
    },
    ref
  ) {
    const theme = getCheckpointTheme(checkpoint.theme_key);
    const colors = colorVarsForFamily(theme.colorFamily);
    const cpNumber = String(checkpoint.sort_order).padStart(2, "0");

    // Snake offset: even indexes lean right, odd lean left (subtle on mobile)
    // This gives the path organic variety without huge horizontal moves
    const dirX = indexInPath % 2 === 0 ? 1 : -1;
    const magnitude = indexInPath === 0 ? 0 : 1; // first node centered
    const offsetX = dirX * magnitude * 60; // desktop: ±60px

    return (
      <div
        ref={ref}
        className="relative flex w-full flex-col items-center"
        style={{
          transform: `translateX(${offsetX}px)`,
        }}
        data-checkpoint-id={checkpoint.id}
      >
        {/* Meta label above node */}
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-15%" }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="mb-3 flex items-center gap-2"
        >
          <span className="mono-label">
            Checkpoint {cpNumber}
          </span>
          {checkpoint.is_discount_gate && (
            <span className="mono-label-accent">· Discount gate</span>
          )}
        </motion.div>

        {/* The themed shape button */}
        <motion.button
          onClick={onToggle}
          initial={{ opacity: 0, scale: 0.85 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true, margin: "-15%" }}
          transition={{
            duration: 0.55,
            ease: [0.22, 1, 0.36, 1],
          }}
          whileHover={{ y: -4, scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          className="relative group outline-none"
          style={{
            width: 120,
            height: 120,
          }}
          aria-expanded={isOpen}
          aria-label={`${checkpoint.title} — ${completed} of ${total} done`}
        >
          {/* Warm glow behind the shape when active or complete */}
          {(isComplete || isCurrent) && (
            <div
              aria-hidden
              className="absolute inset-[-30%] pointer-events-none"
              style={{
                background: `radial-gradient(circle, ${colors.glow} 0%, transparent 65%)`,
                filter: "blur(4px)",
              }}
            />
          )}

          {/* The SVG shape */}
          <svg
            viewBox="0 0 120 120"
            className="relative w-full h-full"
            style={{
              transform: `rotate(${theme.shapeRotation}deg)`,
              transition: "transform 300ms cubic-bezier(0.22, 1, 0.36, 1)",
            }}
          >
            <defs>
              <linearGradient
                id={`cp-grad-${checkpoint.id}`}
                x1="0"
                y1="0"
                x2="1"
                y2="1"
              >
                <stop offset="0%" stopColor={colors.accent} stopOpacity={1} />
                <stop
                  offset="100%"
                  stopColor={colors.accent}
                  stopOpacity={0.7}
                />
              </linearGradient>
            </defs>

            {/* Shape fill */}
            <path
              d={theme.shapePath}
              fill={
                isComplete
                  ? `url(#cp-grad-${checkpoint.id})`
                  : "var(--color-bg-card)"
              }
              stroke={
                isComplete
                  ? "transparent"
                  : isCurrent
                    ? colors.accent
                    : "var(--color-border-strong)"
              }
              strokeWidth={isCurrent ? 2.5 : 1.5}
              style={{
                transition:
                  "fill 300ms cubic-bezier(0.22, 1, 0.36, 1), stroke 300ms ease",
                filter: isCurrent
                  ? `drop-shadow(0 0 12px ${colors.glow})`
                  : undefined,
              }}
            />

            {/* Current-state pulsing ring */}
            {isCurrent && !isComplete && (
              <path
                d={theme.shapePath}
                fill="none"
                stroke={colors.accent}
                strokeWidth={2}
                className="pulse-ring-svg"
                style={{
                  transformOrigin: "60px 60px",
                  animation:
                    "pulse-ring-svg 2.4s cubic-bezier(0.22, 1, 0.36, 1) infinite",
                }}
              />
            )}

            {/* Icon (rendered at center, unrotated relative to shape rotation) */}
            <g
              transform={`translate(60 60) rotate(${-theme.shapeRotation}) translate(-12 -12)`}
            >
              <g transform="scale(1.4) translate(-3.5 -3.5)">
                <path
                  d={theme.iconPath}
                  fill={
                    theme.iconStyle === "fill"
                      ? isComplete
                        ? "var(--color-bg-primary)"
                        : isCurrent
                          ? colors.accent
                          : "var(--color-text-tertiary)"
                      : "none"
                  }
                  stroke={
                    theme.iconStyle === "stroke"
                      ? isComplete
                        ? "var(--color-bg-primary)"
                        : isCurrent
                          ? colors.accent
                          : "var(--color-text-tertiary)"
                      : "none"
                  }
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{
                    transition:
                      "stroke 300ms ease, fill 300ms ease",
                  }}
                />
              </g>
            </g>
          </svg>

          {/* Completion check badge in corner */}
          {isComplete && (
            <motion.div
              initial={{ scale: 0, rotate: -20 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{
                duration: 0.4,
                ease: [0.34, 1.56, 0.64, 1],
              }}
              className="absolute -top-1 -right-1 w-7 h-7 rounded-full bg-[var(--color-bg-primary)] flex items-center justify-center"
              style={{
                border: `2px solid ${colors.accent}`,
              }}
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke={colors.accent}
                strokeWidth={3}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </motion.div>
          )}
        </motion.button>

        {/* Title + subtitle + progress below node */}
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-15%" }}
          transition={{
            duration: 0.5,
            delay: 0.1,
            ease: [0.22, 1, 0.36, 1],
          }}
          className="mt-4 text-center max-w-[280px]"
        >
          <h3
            className={`display-heading text-[22px] sm:text-[26px] leading-tight mb-1 ${
              isComplete
                ? "text-[var(--color-text-secondary)]"
                : isCurrent
                  ? "text-[var(--color-text-primary)]"
                  : "text-[var(--color-text-secondary)]"
            }`}
          >
            {checkpoint.title}
          </h3>
          {checkpoint.subtitle && (
            <p className="text-[13px] leading-snug text-[var(--color-text-tertiary)] mb-2">
              {checkpoint.subtitle}
            </p>
          )}
          <div className="flex items-center justify-center gap-2">
            <span
              className={`font-mono text-[11px] font-semibold tabular-nums ${
                isComplete
                  ? "text-[var(--color-accent)]"
                  : "text-[var(--color-text-tertiary)]"
              }`}
            >
              {completed}/{total}
            </span>
            <span className="text-[var(--color-text-quaternary)]">·</span>
            <span className="mono-label">
              {isOpen ? "hide tasks" : "see tasks"}
            </span>
            <svg
              className={`w-3 h-3 text-[var(--color-text-tertiary)] transition-transform duration-300 ${isOpen ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </div>
        </motion.div>
      </div>
    );
  }
);
