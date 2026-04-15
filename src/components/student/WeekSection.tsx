"use client";

import { useState } from "react";
import type { Task } from "@/types/database";
import { WEEK_TITLES } from "@/lib/constants";
import { TaskItem } from "./TaskItem";
import { ProgressBar } from "./ProgressBar";

interface WeekSectionProps {
  week: number;
  tasks: Task[];
  completedTaskIds: Set<string>;
  onToggleTask: (taskId: string) => void;
  defaultOpen?: boolean;
}

export function WeekSection({
  week,
  tasks,
  completedTaskIds,
  onToggleTask,
  defaultOpen = false,
}: WeekSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  const completed = tasks.filter((t) => completedTaskIds.has(t.id)).length;
  const total = tasks.length;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  const isComplete = completed === total;

  return (
    <div className="bg-bg-card border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 hover:bg-bg-elevated/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div
            className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold ${
              isComplete
                ? "bg-success/15 text-success"
                : "bg-accent/15 text-accent-light"
            }`}
          >
            {isComplete ? (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              week
            )}
          </div>
          <div className="text-left">
            <h3 className="text-sm font-semibold">Week {week}</h3>
            <p className="text-xs text-text-secondary">
              {WEEK_TITLES[week]}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-text-secondary">
            {completed}/{total}
          </span>
          <svg
            className={`w-4 h-4 text-text-tertiary transition-transform ${
              isOpen ? "rotate-180" : ""
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </div>
      </button>

      {/* Progress bar */}
      <div className="px-4 pb-2">
        <ProgressBar value={percent} size="sm" />
      </div>

      {/* Tasks */}
      {isOpen && (
        <div className="px-2 pb-2 space-y-0.5">
          {tasks.map((task) => (
            <TaskItem
              key={task.id}
              task={task}
              isCompleted={completedTaskIds.has(task.id)}
              onToggle={() => onToggleTask(task.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
