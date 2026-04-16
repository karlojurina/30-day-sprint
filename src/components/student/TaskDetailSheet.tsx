"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";
import type { Task } from "@/types/database";
import { TASK_TYPE_LABELS } from "@/lib/constants";

interface TaskDetailSheetProps {
  task: Task | null;
  isCompleted: boolean;
  onClose: () => void;
  onToggle: () => void;
}

export function TaskDetailSheet({
  task,
  isCompleted,
  onClose,
  onToggle,
}: TaskDetailSheetProps) {
  // Close on Escape
  useEffect(() => {
    if (!task) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [task, onClose]);

  // Prevent body scroll when open
  useEffect(() => {
    if (task) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [task]);

  const isWatch = task?.task_type === "watch";

  return (
    <AnimatePresence>
      {task && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-[var(--color-bg-primary)]/70 backdrop-blur-md"
            onClick={onClose}
          />

          {/* Sheet */}
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.98 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="
              fixed left-1/2 -translate-x-1/2 bottom-0 sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2
              z-50 w-full sm:w-[520px] max-w-full
              bg-[var(--color-bg-card)] border border-[var(--color-border-strong)]
              rounded-t-3xl sm:rounded-3xl
              shadow-[0_-20px_60px_rgba(0,0,0,0.5)]
            "
          >
            <div className="relative p-6 sm:p-8">
              {/* Close button */}
              <button
                onClick={onClose}
                className="
                  absolute top-4 right-4
                  w-9 h-9 rounded-full
                  flex items-center justify-center
                  text-[var(--color-text-tertiary)]
                  hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)]
                  transition-colors
                "
                aria-label="Close"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.8}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>

              {/* Meta row */}
              <div className="flex items-center gap-2 mb-3">
                <span className="mono-label-accent">
                  Week {task.week} · Task {task.sort_order}
                </span>
                <span className="text-[var(--color-text-quaternary)]">·</span>
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

              {/* Title */}
              <h3 className="display-heading text-[24px] sm:text-[28px] mb-4 pr-10">
                {task.title}
              </h3>

              {/* Description */}
              {task.description && (
                <p className="text-[15px] leading-relaxed text-[var(--color-text-secondary)] mb-8">
                  {task.description}
                </p>
              )}

              {/* Action */}
              {isWatch ? (
                <div className="space-y-3">
                  <div className="p-4 rounded-xl bg-[var(--color-bg-elevated)] border border-[var(--color-border)] text-[13px] text-[var(--color-text-tertiary)] leading-relaxed">
                    Watch tasks auto-check when you finish the lesson in Whop&apos;s player. Or hit &quot;sync Whop&quot; in the header after watching.
                  </div>
                  <a
                    href={
                      task.whop_lesson_id
                        ? `https://whop.com/joined/ecomtalent/knowledge-KBhMkENW27qoZB/app/courses/cors_6cYEj5qoUcmbcpSryUrfiR/lessons/${task.whop_lesson_id}/`
                        : "https://whop.com/ecomtalent"
                    }
                    target="_blank"
                    rel="noopener"
                    className="
                      w-full flex items-center justify-center gap-2
                      px-6 py-3.5 rounded-xl
                      bg-[var(--color-accent)] hover:bg-[var(--color-accent-dark)]
                      text-[var(--color-bg-primary)] font-semibold text-[15px]
                      transition-colors
                    "
                  >
                    <svg
                      className="w-4 h-4"
                      fill="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path d="M8 5v14l11-7z" />
                    </svg>
                    Open lesson in Whop
                  </a>
                </div>
              ) : (
                <button
                  onClick={() => {
                    onToggle();
                    onClose();
                  }}
                  className={`
                    w-full flex items-center justify-center gap-2
                    px-6 py-3.5 rounded-xl
                    font-semibold text-[15px]
                    transition-colors
                    ${
                      isCompleted
                        ? "bg-[var(--color-bg-elevated)] hover:bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] border border-[var(--color-border-strong)]"
                        : "bg-[var(--color-accent)] hover:bg-[var(--color-accent-dark)] text-[var(--color-bg-primary)]"
                    }
                  `}
                >
                  {isCompleted ? "Undo completion" : "Check it off"}
                </button>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
