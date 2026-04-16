"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { Checkpoint } from "@/types/database";
import {
  getCheckpointTheme,
  colorVarsForFamily,
} from "@/lib/checkpoints";

interface CheckpointCelebrationProps {
  checkpoint: Checkpoint | null;
  onDismiss: () => void;
}

export function CheckpointCelebration({
  checkpoint,
  onDismiss,
}: CheckpointCelebrationProps) {
  return (
    <AnimatePresence>
      {checkpoint && (
        <CelebrationContent
          checkpoint={checkpoint}
          onDismiss={onDismiss}
        />
      )}
    </AnimatePresence>
  );
}

function CelebrationContent({
  checkpoint,
  onDismiss,
}: {
  checkpoint: Checkpoint;
  onDismiss: () => void;
}) {
  const theme = getCheckpointTheme(checkpoint.theme_key);
  const colors = colorVarsForFamily(theme.colorFamily);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="fixed inset-0 z-50 flex items-center justify-center px-5"
      onClick={onDismiss}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-[var(--color-bg-primary)]/90 backdrop-blur-xl" />

      {/* Big radial glow */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `radial-gradient(ellipse 60% 50% at 50% 50%, ${colors.glow} 0%, transparent 65%)`,
          opacity: 0.7,
        }}
      />

      {/* Decorative rays */}
      <motion.svg
        aria-hidden
        className="absolute pointer-events-none"
        width="700"
        height="700"
        viewBox="0 0 700 700"
        initial={{ rotate: 0, opacity: 0 }}
        animate={{ rotate: 360, opacity: 0.25 }}
        transition={{
          rotate: { duration: 60, repeat: Infinity, ease: "linear" },
          opacity: { duration: 1.2 },
        }}
      >
        {Array.from({ length: 18 }).map((_, i) => (
          <line
            key={i}
            x1={350}
            y1={350}
            x2={350}
            y2={40}
            stroke={colors.accent}
            strokeWidth={1}
            strokeDasharray="6 14"
            opacity={0.35}
            transform={`rotate(${i * 20} 350 350)`}
          />
        ))}
      </motion.svg>

      {/* Content */}
      <motion.div
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, y: 16, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={{
          duration: 0.6,
          ease: [0.22, 1, 0.36, 1],
          delay: 0.1,
        }}
        className="relative z-10 flex flex-col items-center text-center max-w-[440px]"
      >
        {/* Big shape badge */}
        <motion.div
          initial={{ scale: 0.4, rotate: -8 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{
            duration: 0.8,
            delay: 0.2,
            ease: [0.34, 1.56, 0.64, 1],
          }}
          className="relative w-[180px] h-[180px] mb-8"
        >
          <div
            aria-hidden
            className="absolute inset-[-30%]"
            style={{
              background: `radial-gradient(circle, ${colors.glow} 0%, transparent 65%)`,
              filter: "blur(8px)",
            }}
          />
          <svg
            viewBox="0 0 120 120"
            className="relative w-full h-full"
            style={{ transform: `rotate(${theme.shapeRotation}deg)` }}
          >
            <defs>
              <linearGradient
                id={`cp-celeb-grad-${checkpoint.id}`}
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
            <path
              d={theme.shapePath}
              fill={`url(#cp-celeb-grad-${checkpoint.id})`}
              style={{
                filter: `drop-shadow(0 0 24px ${colors.glow})`,
              }}
            />
            <g
              transform={`translate(60 60) rotate(${-theme.shapeRotation}) translate(-12 -12)`}
            >
              <g transform="scale(1.6) translate(-4.5 -4.5)">
                <path
                  d={theme.iconPath}
                  fill={
                    theme.iconStyle === "fill"
                      ? "var(--color-bg-primary)"
                      : "none"
                  }
                  stroke={
                    theme.iconStyle === "stroke"
                      ? "var(--color-bg-primary)"
                      : "none"
                  }
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
            </g>
          </svg>
        </motion.div>

        {/* Meta label */}
        <motion.span
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.5 }}
          className="mono-label-accent mb-3"
        >
          Checkpoint {String(checkpoint.sort_order).padStart(2, "0")} · Done
        </motion.span>

        {/* Title */}
        <motion.h2
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="display-heading text-[40px] sm:text-[52px] leading-[0.95] mb-4"
        >
          {checkpoint.title}
        </motion.h2>

        {/* Karlo's line */}
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.75 }}
          className="text-[16px] sm:text-[18px] leading-relaxed text-[var(--color-text-secondary)] mb-10 max-w-[380px]"
        >
          {theme.karloLine}
        </motion.p>

        {/* Continue button */}
        <motion.button
          onClick={onDismiss}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.9 }}
          whileHover={{ y: -2 }}
          whileTap={{ scale: 0.97 }}
          className="
            inline-flex items-center gap-2
            px-7 py-3.5 rounded-full
            bg-[var(--color-accent)] hover:bg-[var(--color-accent-dark)]
            text-[var(--color-bg-primary)] font-semibold text-[15px]
            transition-colors
          "
        >
          Keep going
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M17 8l4 4m0 0l-4 4m4-4H3"
            />
          </svg>
        </motion.button>
      </motion.div>
    </motion.div>
  );
}
