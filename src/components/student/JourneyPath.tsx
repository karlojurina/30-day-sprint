"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  TransformWrapper,
  TransformComponent,
} from "react-zoom-pan-pinch";
import { useStudent } from "@/contexts/StudentContext";
import { CheckpointNode } from "./CheckpointNode";
import { CheckpointCard } from "./CheckpointCard";
import { LessonPill } from "./LessonPill";
import { FlowingPath } from "./FlowingPath";
import { TaskDetailSheet } from "./TaskDetailSheet";
import { DiscountGate } from "./DiscountGate";
import { FogOverlay } from "./FogOverlay";
import { MapCharacter } from "./MapCharacter";
import { MapTerrain } from "./MapTerrain";
import { MapControls } from "./MapControls";
import {
  computePathLayout,
  defaultPathOptions,
  type PathNode,
} from "@/lib/path-layout";
import type { Task } from "@/types/database";

const CHECKPOINT_SIZE = 120;
const LESSON_SIZE = 36;

export function JourneyPath() {
  const {
    tasks,
    checkpoints,
    completedTaskIds,
    checkpointProgress,
    discountCheckpointsCompleted,
    discountCheckpointsTotal,
    currentTitle,
    toggleTask,
  } = useStudent();

  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  // Outer container — used as scroll anchor for the path drawing animation
  const scrollRef = useRef<HTMLDivElement>(null);
  // Inner path container — we measure its width for responsive spread
  const pathContainerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    if (!pathContainerRef.current) return;
    const el = pathContainerRef.current;
    const update = () => setContainerWidth(el.getBoundingClientRect().width);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  // Current-checkpoint finder — first incomplete checkpoint
  const currentCheckpointId = useMemo(() => {
    for (const cp of checkpoints) {
      if (!checkpointProgress[cp.id]?.isComplete) return cp.id;
    }
    return checkpoints[checkpoints.length - 1]?.id ?? null;
  }, [checkpoints, checkpointProgress]);

  // Current-task finder — first actionable task on the path
  const currentTaskId = useMemo(() => {
    // Non-completed, non-watch task in the current checkpoint first
    const currentCp = checkpoints.find((c) => c.id === currentCheckpointId);
    if (!currentCp) return null;
    const cpTasks = tasks
      .filter((t) => t.checkpoint_id === currentCp.id)
      .sort((a, b) => a.sort_order - b.sort_order);
    for (const t of cpTasks) {
      if (completedTaskIds.has(t.id)) continue;
      if (t.task_type === "watch") continue;
      return t.id;
    }
    for (const t of cpTasks) {
      if (!completedTaskIds.has(t.id)) return t.id;
    }
    return null;
  }, [tasks, currentCheckpointId, completedTaskIds, checkpoints]);

  // Group tasks by checkpoint
  const tasksByCheckpoint = useMemo(() => {
    const grouped: Record<string, Task[]> = {};
    for (const cp of checkpoints) grouped[cp.id] = [];
    for (const task of tasks) {
      if (!grouped[task.checkpoint_id]) continue;
      grouped[task.checkpoint_id].push(task);
    }
    for (const id of Object.keys(grouped)) {
      grouped[id].sort((a, b) => a.sort_order - b.sort_order);
    }
    return grouped;
  }, [tasks, checkpoints]);

  // Compute path layout in map mode
  const layout = useMemo(() => {
    if (!containerWidth || checkpoints.length === 0) {
      return { nodes: [] as PathNode[], totalHeight: 0, spread: 0, totalWidth: 0 };
    }
    const opts = defaultPathOptions(containerWidth, true);
    return computePathLayout(checkpoints, tasksByCheckpoint, opts);
  }, [containerWidth, checkpoints, tasksByCheckpoint]);

  // Which index on the path is "completed through"? Last completed task/checkpoint.
  const completedThroughIndex = useMemo(() => {
    let last = -1;
    for (const n of layout.nodes) {
      const done =
        n.kind === "checkpoint"
          ? checkpointProgress[n.id]?.isComplete
          : completedTaskIds.has(n.id);
      if (done) last = n.indexInPath;
      else break;
    }
    return last;
  }, [layout.nodes, completedTaskIds, checkpointProgress]);

  const discountGateCheckpointId = useMemo(
    () => checkpoints.find((c) => c.is_discount_gate)?.id ?? null,
    [checkpoints]
  );

  // Find the character position — current task or first incomplete node
  const characterPosition = useMemo(() => {
    // Place character at current task position
    if (currentTaskId) {
      const node = layout.nodes.find((n) => n.id === currentTaskId);
      if (node) return { x: node.x, y: node.y };
    }
    // Fallback: first incomplete checkpoint
    if (currentCheckpointId) {
      const node = layout.nodes.find((n) => n.id === currentCheckpointId);
      if (node) return { x: node.x, y: node.y };
    }
    // Fallback: start
    if (layout.nodes.length > 0) {
      return { x: layout.nodes[0].x, y: layout.nodes[0].y };
    }
    return { x: 0, y: 0 };
  }, [currentTaskId, currentCheckpointId, layout.nodes]);

  // Determine which checkpoint a node belongs to (for fog locking)
  const isNodeLocked = useMemo(() => {
    const lockedSet = new Set<string>();
    // A node is locked if its checkpoint is NOT the current one and NOT complete
    for (const n of layout.nodes) {
      const cpId = n.kind === "checkpoint"
        ? n.checkpoint?.id
        : n.task?.checkpoint_id;
      if (!cpId) continue;
      const isComplete = checkpointProgress[cpId]?.isComplete;
      const isCurrent = cpId === currentCheckpointId;
      if (!isComplete && !isCurrent) {
        lockedSet.add(n.id);
      }
    }
    return lockedSet;
  }, [layout.nodes, checkpointProgress, currentCheckpointId]);

  if (checkpoints.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-[var(--color-text-tertiary)] text-sm">
          Loading your journey&hellip;
        </p>
      </div>
    );
  }

  const centerX = containerWidth / 2;

  return (
    <div ref={scrollRef} className="relative -mx-5 sm:-mx-6">
      <div ref={pathContainerRef} className="relative w-full">
        <TransformWrapper
          initialScale={1}
          minScale={0.5}
          maxScale={2}
          centerOnInit
          limitToBounds={false}
          panning={{ velocityDisabled: true }}
          wheel={{ step: 0.08 }}
        >
          <MapControls />
          <TransformComponent
            wrapperStyle={{
              width: "100%",
              height: `min(${layout.totalHeight}px, 80vh)`,
              overflow: "hidden",
            }}
            contentStyle={{
              width: containerWidth || "100%",
              height: layout.totalHeight || 600,
            }}
          >
            {/* Terrain background */}
            <MapTerrain
              width={containerWidth}
              height={layout.totalHeight}
            />

            {/* Organic flowing path behind the nodes */}
            {containerWidth > 0 && layout.nodes.length > 1 && (
              <FlowingPath
                nodes={layout.nodes}
                containerWidth={containerWidth}
                totalHeight={layout.totalHeight}
                completedThroughIndex={completedThroughIndex}
                scrollContainerRef={scrollRef}
              />
            )}

            {/* Fog of war overlay */}
            <FogOverlay
              nodes={layout.nodes}
              containerWidth={containerWidth}
              totalHeight={layout.totalHeight}
              checkpointProgress={checkpointProgress}
              currentCheckpointId={currentCheckpointId}
              discountGateCheckpointId={discountGateCheckpointId}
            />

            {/* Character avatar */}
            <MapCharacter
              x={centerX + characterPosition.x}
              y={characterPosition.y}
              title={currentTitle}
            />

            {/* Nodes + cards at computed (x, y) */}
            {layout.nodes.map((n) => {
              const nodeSize = n.kind === "checkpoint" ? CHECKPOINT_SIZE : LESSON_SIZE;
              const halfSize = nodeSize / 2;
              const left = centerX + n.x - halfSize;
              const top = n.y;
              const locked = isNodeLocked.has(n.id);

              if (n.kind === "checkpoint" && n.checkpoint) {
                const cp = n.checkpoint;
                const progress = checkpointProgress[cp.id] ?? {
                  completed: 0,
                  total: 0,
                  isComplete: false,
                };
                const isCurrent = cp.id === currentCheckpointId && !progress.isComplete;
                const cardSide: "left" | "right" = n.x > 0 ? "left" : "right";

                return (
                  <div
                    key={cp.id}
                    className="absolute"
                    style={{
                      left,
                      top,
                      width: nodeSize,
                      height: nodeSize,
                      zIndex: 2,
                      opacity: locked ? 0.35 : undefined,
                      filter: locked ? "saturate(0.3) blur(0.5px)" : undefined,
                      transition: "opacity 0.4s, filter 0.4s",
                    }}
                  >
                    <CheckpointNode
                      checkpoint={cp}
                      isComplete={progress.isComplete}
                      isCurrent={isCurrent}
                    />

                    {/* Side text card — positioned relative to node; hidden on mobile */}
                    <div
                      className="hidden sm:block absolute top-0 w-[260px]"
                      style={{
                        ...(cardSide === "left"
                          ? { right: `calc(100% + 32px)` }
                          : { left: `calc(100% + 32px)` }),
                      }}
                    >
                      <CheckpointCard
                        checkpoint={cp}
                        completed={progress.completed}
                        total={progress.total}
                        isComplete={progress.isComplete}
                        isCurrent={isCurrent}
                        side={cardSide}
                      />
                    </div>

                    {/* Mobile card — below the node */}
                    <div className="sm:hidden absolute left-1/2 -translate-x-1/2 top-full mt-4 w-[280px] text-center">
                      <CheckpointCard
                        checkpoint={cp}
                        completed={progress.completed}
                        total={progress.total}
                        isComplete={progress.isComplete}
                        isCurrent={isCurrent}
                        side="right"
                      />
                    </div>
                  </div>
                );
              }

              if (n.kind === "lesson" && n.task) {
                const task = n.task;
                const isCompleted = completedTaskIds.has(task.id);
                const isCurrent = task.id === currentTaskId;
                return (
                  <div
                    key={task.id}
                    className="absolute"
                    style={{
                      left,
                      top,
                      width: nodeSize,
                      height: nodeSize,
                      zIndex: 2,
                      opacity: locked ? 0.25 : undefined,
                      filter: locked ? "saturate(0.2) blur(0.5px)" : undefined,
                      transition: "opacity 0.4s, filter 0.4s",
                    }}
                  >
                    <LessonPill
                      task={task}
                      isCompleted={isCompleted}
                      isCurrent={isCurrent}
                      onClick={locked ? undefined : () => setSelectedTask(task)}
                    />
                  </div>
                );
              }

              return null;
            })}

            {/* Discount gate — inserted at the y-position of the gate checkpoint's end */}
            {discountGateCheckpointId && (
              <DiscountGateOverlay
                gateCheckpointId={discountGateCheckpointId}
                layout={layout}
                centerX={centerX}
                completed={discountCheckpointsCompleted}
                required={discountCheckpointsTotal}
              />
            )}
          </TransformComponent>
        </TransformWrapper>
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

function DiscountGateOverlay({
  gateCheckpointId,
  layout,
  centerX,
  completed,
  required,
}: {
  gateCheckpointId: string;
  layout: { nodes: PathNode[] };
  centerX: number;
  completed: number;
  required: number;
}) {
  // Find the last lesson in the gate checkpoint to position the gate below it
  const gateNodes = layout.nodes.filter(
    (n) => n.checkpoint?.id === gateCheckpointId || n.task?.checkpoint_id === gateCheckpointId
  );
  const lastNode = gateNodes[gateNodes.length - 1];
  if (!lastNode) return null;

  return (
    <div
      className="absolute left-1/2 -translate-x-1/2 w-full px-4"
      style={{
        top: lastNode.y + 140,
        maxWidth: 500,
      }}
    >
      <DiscountGate completed={completed} required={required} />
    </div>
  );
}
