"use client";

import { useMemo, useRef, useState } from "react";
import { useStudent } from "@/contexts/StudentContext";
import { CheckpointNode } from "./CheckpointNode";
import { CheckpointExpanded } from "./CheckpointExpanded";
import { FlowingPath } from "./FlowingPath";
import { TaskDetailSheet } from "./TaskDetailSheet";
import { DiscountGate } from "./DiscountGate";
import type { Task } from "@/types/database";

export function JourneyPath() {
  const {
    tasks,
    checkpoints,
    completedTaskIds,
    checkpointProgress,
    discountCheckpointsCompleted,
    discountCheckpointsTotal,
    toggleTask,
  } = useStudent();

  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [openCheckpointId, setOpenCheckpointId] = useState<string | null>(null);

  // Ref to the scroll container so FlowingPath can measure relative positions
  const containerRef = useRef<HTMLDivElement>(null);
  // One ref per checkpoint node for path measurement
  const nodeRefs = useMemo(
    () => checkpoints.map(() => ({ current: null as HTMLDivElement | null })),
    [checkpoints]
  );

  // Find the "current" checkpoint and task
  const currentCheckpointId = useMemo(() => {
    for (const cp of checkpoints) {
      if (!checkpointProgress[cp.id]?.isComplete) return cp.id;
    }
    return checkpoints[checkpoints.length - 1]?.id ?? null;
  }, [checkpoints, checkpointProgress]);

  const currentTaskId = useMemo(() => {
    // First non-completed, non-watch task in the current checkpoint — or any
    // non-completed task if all "action" tasks in current cp are done
    const currentCpTasks = tasks
      .filter((t) => t.checkpoint_id === currentCheckpointId)
      .sort((a, b) => a.sort_order - b.sort_order);
    for (const t of currentCpTasks) {
      if (completedTaskIds.has(t.id)) continue;
      if (t.task_type === "watch") continue;
      return t.id;
    }
    for (const t of currentCpTasks) {
      if (!completedTaskIds.has(t.id)) return t.id;
    }
    return null;
  }, [tasks, currentCheckpointId, completedTaskIds]);

  // Tasks grouped by checkpoint (preserve sort order)
  const tasksByCheckpoint = useMemo(() => {
    const grouped: Record<string, Task[]> = {};
    for (const cp of checkpoints) {
      grouped[cp.id] = [];
    }
    for (const task of tasks) {
      if (!grouped[task.checkpoint_id]) continue;
      grouped[task.checkpoint_id].push(task);
    }
    for (const id of Object.keys(grouped)) {
      grouped[id].sort((a, b) => a.sort_order - b.sort_order);
    }
    return grouped;
  }, [tasks, checkpoints]);

  // How many checkpoints (indexes) are "completed so far" — used by FlowingPath
  const completedThroughIndex = useMemo(() => {
    let lastComplete = -1;
    checkpoints.forEach((cp, i) => {
      if (checkpointProgress[cp.id]?.isComplete) lastComplete = i;
    });
    return lastComplete;
  }, [checkpoints, checkpointProgress]);

  // Discount gate — render after the checkpoint with is_discount_gate
  const discountGateAfterId = useMemo(
    () => checkpoints.find((c) => c.is_discount_gate)?.id ?? null,
    [checkpoints]
  );

  if (checkpoints.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-[var(--color-text-tertiary)] text-sm">
          Loading your journey…
        </p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Organic flowing path behind the nodes */}
      <FlowingPath
        nodeRefs={nodeRefs}
        containerRef={containerRef}
        completedThroughIndex={completedThroughIndex}
      />

      {/* Checkpoints stack */}
      <div className="relative flex flex-col items-center gap-20 sm:gap-24 py-8">
        {checkpoints.map((cp, i) => {
          const progress = checkpointProgress[cp.id] ?? {
            completed: 0,
            total: 0,
            isComplete: false,
          };
          const isOpen = openCheckpointId === cp.id;
          const isCurrent = cp.id === currentCheckpointId && !progress.isComplete;

          return (
            <div key={cp.id} className="relative w-full flex flex-col items-center">
              <CheckpointNode
                ref={nodeRefs[i] as React.RefObject<HTMLDivElement>}
                checkpoint={cp}
                completed={progress.completed}
                total={progress.total}
                isComplete={progress.isComplete}
                isCurrent={isCurrent}
                isOpen={isOpen}
                indexInPath={i}
                onToggle={() =>
                  setOpenCheckpointId((prev) => (prev === cp.id ? null : cp.id))
                }
              />

              <CheckpointExpanded
                isOpen={isOpen}
                tasks={tasksByCheckpoint[cp.id] ?? []}
                completedTaskIds={completedTaskIds}
                currentTaskId={currentTaskId}
                onTaskClick={(t) => setSelectedTask(t)}
              />

              {/* Discount gate rendered just after its checkpoint */}
              {cp.id === discountGateAfterId && (
                <div className="mt-14 w-full">
                  <DiscountGate
                    completed={discountCheckpointsCompleted}
                    required={discountCheckpointsTotal}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

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
