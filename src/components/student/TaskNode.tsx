"use client";

import { motion } from "framer-motion";
import type { Task } from "@/types/database";

interface TaskNodeProps {
  task: Task;
  isCompleted: boolean;
  isCurrent: boolean;
  offsetX: number; // -1 to 1, for horizontal snake positioning
  onClick: () => void;
}

export function TaskNode({
  task,
  isCompleted,
  isCurrent,
  offsetX,
  onClick,
}: TaskNodeProps) {
  const isWatch = task.task_type === "watch";

  return (
    <div
      className="relative flex w-full items-center"
      style={{ justifyContent: "center" }}
    >
      <motion.button
        onClick={onClick}
        initial={{ opacity: 0, y: 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-20%" }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        whileHover={{ y: -3 }}
        whileTap={{ scale: 0.97 }}
        style={{
          transform: `translateX(${offsetX * 100}px)`,
        }}
        className={`
          group relative flex items-center justify-center
          w-[72px] h-[72px] rounded-full
          transition-[background,border,box-shadow] duration-200 ease-out
          ${
            isCompleted
              ? "bg-[var(--color-accent)] border-2 border-[var(--color-accent-dark)]"
              : isCurrent
                ? "bg-[var(--color-bg-elevated)] border-2 border-[var(--color-accent)] pulse-ring"
                : "bg-[var(--color-bg-card)] border-2 border-[var(--color-border-strong)] hover:border-[var(--color-accent)]/50"
          }
        `}
        aria-label={task.title}
      >
        {/* Content */}
        {isCompleted ? (
          <svg
            className="w-7 h-7 text-[var(--color-bg-primary)]"
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
          // Play icon for watch tasks
          <svg
            className={`w-7 h-7 ${isCurrent ? "text-[var(--color-accent)]" : "text-[var(--color-text-secondary)]"} ml-1`}
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M8 5v14l11-7z" />
          </svg>
        ) : (
          // Number or dot for upcoming tasks
          <span
            className={`
              font-mono text-xs font-semibold tracking-tight
              ${isCurrent ? "text-[var(--color-accent)]" : "text-[var(--color-text-tertiary)]"}
            `}
          >
            {task.sort_order}
          </span>
        )}

        {/* AP badge */}
        {task.activation_point_id && (
          <span
            className={`
              absolute -top-1.5 -right-1.5 flex items-center justify-center
              w-[22px] h-[22px] rounded-full text-[9px] font-bold font-mono
              ${
                isCompleted
                  ? "bg-[var(--color-milestone)] text-[var(--color-bg-primary)]"
                  : "bg-[var(--color-bg-primary)] text-[var(--color-milestone)] border border-[var(--color-milestone)]/60"
              }
            `}
          >
            {task.activation_point_id.replace("AP", "")}
          </span>
        )}
      </motion.button>

      {/* Task title label (beside node) */}
      <motion.div
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, margin: "-20%" }}
        transition={{ duration: 0.6, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
        className={`
          absolute top-1/2 -translate-y-1/2 pointer-events-none
          ${offsetX < 0 ? "left-1/2 ml-[90px]" : "right-1/2 mr-[90px] text-right"}
          hidden sm:block
          max-w-[180px]
        `}
      >
        <p
          className={`
            text-[13px] leading-tight font-medium truncate
            ${isCompleted ? "text-[var(--color-text-tertiary)] line-through" : isCurrent ? "text-[var(--color-text-primary)]" : "text-[var(--color-text-secondary)]"}
          `}
        >
          {task.title}
        </p>
        {isCurrent && (
          <p className="mono-label-accent mt-1">Do this</p>
        )}
      </motion.div>

      {/* Mobile label (below node) */}
      <motion.div
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, margin: "-20%" }}
        transition={{ duration: 0.6, delay: 0.1 }}
        className="sm:hidden absolute top-full mt-2 left-0 right-0 text-center px-4 pointer-events-none"
      >
        <p
          className={`
            text-[12px] leading-tight font-medium
            ${isCompleted ? "text-[var(--color-text-tertiary)] line-through" : isCurrent ? "text-[var(--color-text-primary)]" : "text-[var(--color-text-secondary)]"}
          `}
        >
          {task.title}
        </p>
      </motion.div>
    </div>
  );
}
