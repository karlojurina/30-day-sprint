"use client";

import { motion } from "framer-motion";
import type { Task } from "@/types/database";

interface LessonPillProps {
  task: Task;
  isCompleted: boolean;
  isCurrent: boolean;
  onClick: () => void;
}

/**
 * Small always-visible node on the path, one per task. Replaces the
 * expand-on-click SubTaskRow pattern with a react.gg-style constant
 * visibility.
 */
export function LessonPill({
  task,
  isCompleted,
  isCurrent,
  onClick,
}: LessonPillProps) {
  const isWatch = task.task_type === "watch";

  return (
    <motion.button
      onClick={onClick}
      initial={{ opacity: 0, scale: 0.6 }}
      whileInView={{ opacity: 1, scale: 1 }}
      viewport={{ once: true, margin: "-10%" }}
      transition={{
        duration: 0.4,
        ease: [0.22, 1, 0.36, 1],
      }}
      whileHover={{ scale: 1.15, y: -2 }}
      whileTap={{ scale: 0.92 }}
      className="group relative outline-none"
      style={{
        width: 36,
        height: 36,
      }}
      aria-label={task.title}
    >
      {/* Extended hit area for touch */}
      <span aria-hidden className="absolute inset-[-6px]" />

      {/* Outer ring — always visible */}
      <span
        className="absolute inset-0 rounded-full transition-[opacity,filter,transform] duration-300"
        style={{
          opacity: isCompleted ? 0.45 : 1,
          filter: isCompleted ? "saturate(0.5)" : undefined,
          transform: isCompleted ? "scale(0.92)" : undefined,
        }}
      >
        {isCompleted ? (
          // Filled accent circle with check
          <span
            className="block w-full h-full rounded-full flex items-center justify-center"
            style={{
              background: "var(--color-accent)",
              boxShadow: `0 0 10px var(--color-accent-glow)`,
            }}
          >
            <svg
              className="w-4 h-4 text-[var(--color-bg-primary)]"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={3}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 13l4 4L19 7"
              />
            </svg>
          </span>
        ) : isCurrent ? (
          // Current: outlined with pulse
          <span
            className="block w-full h-full rounded-full flex items-center justify-center pulse-ring"
            style={{
              background: "var(--color-bg-elevated)",
              border: `2px solid var(--color-accent)`,
            }}
          >
            {isWatch ? (
              <svg
                className="w-3.5 h-3.5 text-[var(--color-accent)] translate-x-[1px]"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
            ) : (
              <span
                className="w-2 h-2 rounded-full"
                style={{ background: "var(--color-accent)" }}
              />
            )}
          </span>
        ) : (
          // Upcoming: subtle dot
          <span
            className="block w-full h-full rounded-full flex items-center justify-center transition-colors group-hover:border-[var(--color-accent)]/60"
            style={{
              background: "var(--color-bg-card)",
              border: `1.5px solid var(--color-border-strong)`,
            }}
          >
            {isWatch ? (
              <svg
                className="w-3 h-3 text-[var(--color-text-tertiary)] translate-x-[1px]"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
            ) : (
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: "var(--color-text-tertiary)" }}
              />
            )}
          </span>
        )}
      </span>
    </motion.button>
  );
}
