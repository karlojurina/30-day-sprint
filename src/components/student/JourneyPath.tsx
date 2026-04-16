"use client";

import { useState, useMemo } from "react";
import { useStudent } from "@/contexts/StudentContext";
import { TaskNode } from "./TaskNode";
import { WeekZone } from "./WeekZone";
import { TaskDetailSheet } from "./TaskDetailSheet";
import { DiscountGate } from "./DiscountGate";
import type { Task } from "@/types/database";

// Karlo-voiced week framings
const WEEK_META: Record<
  number,
  { title: string; subtitle: string }
> = {
  1: {
    title: "Foundation + First Ads",
    subtitle: "Setup. Get the basics in. No skipping steps.",
  },
  2: {
    title: "Level Up Your Editing",
    subtitle: "Now you sharpen. Make ads that don't look like ads.",
  },
  3: {
    title: "Strategy + Job Board",
    subtitle: "You've got the skills. Time to use them.",
  },
  4: {
    title: "Ad Bounties — The Real Work",
    subtitle: "Real briefs. Real brands. Real money on the line.",
  },
};

function snakeOffset(indexInWeek: number, weekLength: number): number {
  // Returns a value from -1 to 1 for horizontal offset
  // Creates a snake: 0, 0.6, 1, 0.6, 0, -0.6, -1, -0.6, 0, ...
  const phase = (indexInWeek / Math.max(1, weekLength - 1)) * Math.PI * 2;
  return Math.sin(phase);
}

export function JourneyPath() {
  const {
    tasks,
    completedTaskIds,
    discountCheckpointsCompleted,
    discountCheckpointsTotal,
    toggleTask,
  } = useStudent();
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  // Find the current task — first non-completed, non-watch task
  const currentTaskId = useMemo(() => {
    for (const task of tasks) {
      if (completedTaskIds.has(task.id)) continue;
      if (task.task_type === "watch") continue;
      return task.id;
    }
    // If everything that's checkable is done, surface the first incomplete watch task
    for (const task of tasks) {
      if (!completedTaskIds.has(task.id)) return task.id;
    }
    return null;
  }, [tasks, completedTaskIds]);

  // Group tasks by week
  const tasksByWeek = useMemo(() => {
    const grouped: Record<number, Task[]> = {};
    for (const task of tasks) {
      if (!grouped[task.week]) grouped[task.week] = [];
      grouped[task.week].push(task);
    }
    // Sort each week by sort_order
    for (const week in grouped) {
      grouped[week].sort((a, b) => a.sort_order - b.sort_order);
    }
    return grouped;
  }, [tasks]);

  const weeks = Object.keys(tasksByWeek)
    .map(Number)
    .sort((a, b) => a - b);

  // Find where the discount gate should be rendered
  // It appears after the last required task (13 total across Weeks 1-2)
  const discountGateInsertedAfter = useMemo(() => {
    let requiredSeen = 0;
    for (const task of tasks) {
      if (task.is_discount_required) {
        requiredSeen++;
        if (requiredSeen === 13) return task.id;
      }
    }
    return null;
  }, [tasks]);

  return (
    <div className="relative">
      {/* SVG vertical connector line (subtle, behind nodes) */}
      <div
        aria-hidden
        className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-gradient-to-b from-transparent via-[var(--color-border-strong)] to-transparent pointer-events-none"
      />

      {/* Path content */}
      <div className="relative flex flex-col gap-10 sm:gap-7 py-6">
        {weeks.map((weekNum) => {
          const weekTasks = tasksByWeek[weekNum];
          const weekCompleted = weekTasks.filter((t) =>
            completedTaskIds.has(t.id)
          ).length;

          return (
            <div key={weekNum} className="flex flex-col gap-10 sm:gap-8">
              <WeekZone
                weekNumber={weekNum}
                title={WEEK_META[weekNum]?.title ?? `Week ${weekNum}`}
                subtitle={WEEK_META[weekNum]?.subtitle ?? ""}
                completed={weekCompleted}
                total={weekTasks.length}
              />
              {weekTasks.map((task, idx) => (
                <div key={task.id}>
                  <TaskNode
                    task={task}
                    isCompleted={completedTaskIds.has(task.id)}
                    isCurrent={task.id === currentTaskId}
                    offsetX={snakeOffset(idx, weekTasks.length)}
                    onClick={() => setSelectedTask(task)}
                  />
                  {/* Insert discount gate after the 13th required task */}
                  {task.id === discountGateInsertedAfter && (
                    <div className="mt-10 sm:mt-8">
                      <DiscountGate
                        completed={discountCheckpointsCompleted}
                        required={discountCheckpointsTotal}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {/* Task detail sheet */}
      <TaskDetailSheet
        task={selectedTask}
        isCompleted={
          selectedTask ? completedTaskIds.has(selectedTask.id) : false
        }
        onClose={() => setSelectedTask(null)}
        onToggle={() => {
          if (selectedTask && selectedTask.task_type !== "watch") {
            toggleTask(selectedTask.id);
          }
        }}
      />
    </div>
  );
}
