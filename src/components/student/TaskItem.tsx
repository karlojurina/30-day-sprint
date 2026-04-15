"use client";

import type { Task } from "@/types/database";
import { TASK_TYPE_LABELS } from "@/lib/constants";

interface TaskItemProps {
  task: Task;
  isCompleted: boolean;
  onToggle: () => void;
}

const typeColors: Record<string, string> = {
  setup: "bg-warning/15 text-warning",
  watch: "bg-accent/15 text-accent-light",
  action: "bg-success/15 text-success",
};

export function TaskItem({ task, isCompleted, onToggle }: TaskItemProps) {
  return (
    <button
      onClick={onToggle}
      className={`w-full flex items-start gap-3 p-3 rounded-lg text-left transition-colors group ${
        isCompleted
          ? "bg-bg-elevated/50"
          : "hover:bg-bg-elevated/50"
      }`}
    >
      {/* Checkbox */}
      <div
        className={`mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-all ${
          isCompleted
            ? "bg-accent border-accent"
            : "border-border group-hover:border-accent/50"
        }`}
      >
        {isCompleted && (
          <svg
            className="w-3 h-3 text-white"
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
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={`text-sm font-medium ${
              isCompleted ? "text-text-secondary line-through" : "text-text-primary"
            }`}
          >
            {task.title}
          </span>
          <span
            className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${
              typeColors[task.task_type]
            }`}
          >
            {TASK_TYPE_LABELS[task.task_type]}
          </span>
        </div>
        {task.description && (
          <p
            className={`mt-1 text-xs leading-relaxed ${
              isCompleted ? "text-text-tertiary" : "text-text-secondary"
            }`}
          >
            {task.description}
          </p>
        )}
      </div>
    </button>
  );
}
