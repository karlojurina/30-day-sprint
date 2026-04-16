"use client";

import { motion } from "framer-motion";
import type { Checkpoint } from "@/types/database";
import { getCheckpointTheme, colorVarsForFamily } from "@/lib/checkpoints";

interface CheckpointNodeProps {
  checkpoint: Checkpoint;
  isComplete: boolean;
  isCurrent: boolean;
  /** Optional click handler; pass undefined to make it display-only */
  onClick?: () => void;
  ariaLabel?: string;
}

/**
 * The big themed shape for a checkpoint. Displayed at a computed
 * (x,y) on the path. All text (title, subtitle, progress, Karlo line)
 * is rendered separately in CheckpointCard beside the node — this
 * component is purely the visual shape + icon + state.
 */
export function CheckpointNode({
  checkpoint,
  isComplete,
  isCurrent,
  onClick,
  ariaLabel,
}: CheckpointNodeProps) {
  const theme = getCheckpointTheme(checkpoint.theme_key);
  const colors = colorVarsForFamily(theme.colorFamily);

  const Container = onClick ? motion.button : motion.div;

  return (
    <Container
      onClick={onClick}
      initial={{ opacity: 0, scale: 0.85 }}
      whileInView={{ opacity: 1, scale: 1 }}
      viewport={{ once: true, margin: "-15%" }}
      transition={{
        duration: 0.55,
        ease: [0.22, 1, 0.36, 1],
      }}
      {...(onClick
        ? {
            whileHover: { y: -4, scale: 1.02 },
            whileTap: { scale: 0.97 },
          }
        : {})}
      className="relative group outline-none"
      style={{
        width: 120,
        height: 120,
        opacity: isComplete ? 0.45 : 1,
        filter: isComplete ? "saturate(0.55)" : undefined,
        transform: isComplete ? "scale(0.95)" : undefined,
        transition: "opacity 400ms ease, filter 400ms ease, transform 400ms ease",
      }}
      aria-label={ariaLabel ?? checkpoint.title}
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
            <stop offset="100%" stopColor={colors.accent} stopOpacity={0.7} />
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
            style={{
              transformOrigin: "60px 60px",
              animation:
                "pulse-ring-svg 2.4s cubic-bezier(0.22, 1, 0.36, 1) infinite",
            }}
          />
        )}

        {/* Icon centered inside the shape */}
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
                transition: "stroke 300ms ease, fill 300ms ease",
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
    </Container>
  );
}
