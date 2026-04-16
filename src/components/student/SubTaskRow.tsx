"use client";

import { motion } from "framer-motion";
import type { Task } from "@/types/database";
import { TASK_TYPE_LABELS } from "@/lib/constants";

interface SubTaskRowProps {
  task: Task;
  isCompleted: boolean;
  isCurrent: boolean;
  index: number;
  onClick: () => void;
}

export function SubTaskRow({
  task,
  isCompleted,
  isCurrent,
  index,
  onClick,
}: SubTaskRowProps) {
  const isWatch = task.task_type === "watch";

  return (
    <motion.button
      onClick={onClick}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.3,
        delay: index * 0.04,
        ease: [0.22, 1, 0.36, 1],
      }}
      whileHover={{ x: 2 }}
      className={`
        group w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left
        transition-colors duration-150
        ${
          isCurrent
            ? "bg-[var(--color-bg-elevated)] border border-[var(--color-accent)]/40"
            : "bg-[var(--color-bg-card)]/50 hover:bg-[var(--color-bg-card)] border border-[var(--color-border)]"
        }
      `}
    >
      {/* Check indicator / watch play */}
      <div
        className={`
          shrink-0 w-6 h-6 rounded-full flex items-center justify-center
          transition-colors duration-150
          ${
            isCompleted
              ? "bg-[var(--color-accent)]"
              : isCurrent
                ? "border-2 border-[var(--color-accent)]"
                : isWatch
                  ? "bg-[var(--color-bg-elevated)]"
                  : "border-2 border-[var(--color-border-strong)] group-hover:border-[var(--color-accent)]/60"
          }
        `}
      >
        {isCompleted ? (
          <svg
            className="w-3.5 h-3.5 text-[var(--color-bg-primary)]"
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
        ) : isWatch ? (
          <svg
            className="w-3 h-3 text-[var(--color-text-tertiary)] translate-x-[1px]"
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M8 5v14l11-7z" />
          </svg>
        ) : null}
      </div>

      {/* Title + type */}
      <div className="flex-1 min-w-0">
        <p
          className={`
            text-[14px] leading-tight font-medium truncate
            ${
              isCompleted
                ? "text-[var(--color-text-tertiary)] line-through"
                : isCurrent
                  ? "text-[var(--color-text-primary)]"
                  : "text-[var(--color-text-primary)]"
            }
          `}
        >
          {task.title}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="mono-label">
            {TASK_TYPE_LABELS[task.task_type]}
          </span>
          {task.activation_point_id && (
            <>
              <span className="text-[var(--color-text-quaternary)]">·</span>
              <span
                className="mono-label"
                style={{ color: "var(--color-milestone)" }}
              >
                {task.activation_point_id}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Chevron */}
      <svg
        className="shrink-0 w-4 h-4 text-[var(--color-text-quaternary)] group-hover:text-[var(--color-text-secondary)] transition-colors"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 5l7 7-7 7"
        />
      </svg>
    </motion.button>
  );
}
