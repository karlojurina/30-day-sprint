"use client";

import { motion } from "framer-motion";
import type { Checkpoint } from "@/types/database";
import {
  getCheckpointTheme,
  colorVarsForFamily,
} from "@/lib/checkpoints";
import { TITLES } from "@/lib/titles";

interface CheckpointCardProps {
  checkpoint: Checkpoint;
  completed: number;
  total: number;
  isComplete: boolean;
  isCurrent: boolean;
  /** 'left' or 'right' — which side of the path to render on */
  side: "left" | "right";
}

/**
 * Editorial-style text block next to a checkpoint node. Title + subtitle
 * + progress + Karlo voice line. Alternates sides with the snake.
 * On mobile (<640px) the card collapses below the node via CSS.
 */
export function CheckpointCard({
  checkpoint,
  completed,
  total,
  isComplete,
  isCurrent,
  side,
}: CheckpointCardProps) {
  const theme = getCheckpointTheme(checkpoint.theme_key);
  const colors = colorVarsForFamily(theme.colorFamily);
  const cpNumber = String(checkpoint.sort_order).padStart(2, "0");

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, x: side === "left" ? -8 : 8 }}
      whileInView={{ opacity: 1, y: 0, x: 0 }}
      viewport={{ once: true, margin: "-10%" }}
      transition={{
        duration: 0.6,
        ease: [0.22, 1, 0.36, 1],
        delay: 0.1,
      }}
      className="pointer-events-none"
      style={{
        opacity: isComplete ? 0.55 : 1,
        filter: isComplete ? "saturate(0.7)" : undefined,
      }}
    >
      <div
        className={`
          relative
          ${side === "left" ? "text-right" : "text-left"}
        `}
      >
        {/* Meta row */}
        <div
          className={`flex items-center gap-2 mb-2 ${side === "left" ? "justify-end" : "justify-start"}`}
        >
          <span
            className={
              isCurrent || isComplete ? "mono-label-accent" : "mono-label"
            }
            style={
              isCurrent
                ? { color: colors.accent }
                : isComplete
                  ? { color: "var(--color-text-secondary)" }
                  : undefined
            }
          >
            Checkpoint {cpNumber}
          </span>
          {checkpoint.is_discount_gate && (
            <>
              <span className="text-[var(--color-text-quaternary)]">·</span>
              <span
                className="mono-label"
                style={{ color: "var(--color-accent)" }}
              >
                Discount gate
              </span>
            </>
          )}
        </div>

        {/* Title */}
        <h3
          className="display-heading text-[28px] sm:text-[34px] leading-[1.0] mb-2"
          style={{
            color: isCurrent
              ? "var(--color-text-primary)"
              : isComplete
                ? "var(--color-text-secondary)"
                : "var(--color-text-primary)",
            textDecoration: isComplete ? undefined : undefined,
          }}
        >
          {checkpoint.title}
        </h3>

        {/* Subtitle */}
        {checkpoint.subtitle && (
          <p className="text-[14px] leading-relaxed text-[var(--color-text-secondary)] mb-3 max-w-[280px] inline-block">
            {checkpoint.subtitle}
          </p>
        )}

        {/* Progress line */}
        <div
          className={`flex items-center gap-2 ${side === "left" ? "justify-end" : "justify-start"}`}
        >
          <span
            className="font-mono text-[12px] font-semibold tabular-nums"
            style={{
              color: isComplete
                ? colors.accent
                : "var(--color-text-tertiary)",
            }}
          >
            {completed}/{total}
          </span>
          {isComplete && (
            <span className="mono-label" style={{ color: colors.accent }}>
              sealed
            </span>
          )}
          {isCurrent && !isComplete && (
            <span className="mono-label-accent">in progress</span>
          )}
        </div>

        {/* Unlockable title */}
        {!isComplete && (() => {
          const unlocksTitle = TITLES.find(
            (t) => t.minCheckpoints === checkpoint.sort_order
          );
          if (!unlocksTitle) return null;
          return (
            <p
              className={`mt-2 text-[11px] font-mono font-semibold uppercase tracking-wider ${side === "left" ? "" : ""}`}
              style={{ color: "var(--color-text-quaternary)" }}
            >
              Unlocks: {unlocksTitle.label}
            </p>
          );
        })()}

        {/* Karlo voice line — only for current and complete */}
        {(isCurrent || isComplete) && (
          <p
            className={`mt-3 text-[12px] leading-relaxed italic max-w-[280px] inline-block text-[var(--color-text-tertiary)] ${side === "left" ? "" : ""}`}
          >
            &ldquo;{theme.karloLine}&rdquo;
          </p>
        )}
      </div>
    </motion.div>
  );
}
