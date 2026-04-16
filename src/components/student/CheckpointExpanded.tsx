"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { Task } from "@/types/database";
import { SubTaskRow } from "./SubTaskRow";

interface CheckpointExpandedProps {
  isOpen: boolean;
  tasks: Task[];
  completedTaskIds: Set<string>;
  currentTaskId: string | null;
  onTaskClick: (task: Task) => void;
}

export function CheckpointExpanded({
  isOpen,
  tasks,
  completedTaskIds,
  currentTaskId,
  onTaskClick,
}: CheckpointExpandedProps) {
  return (
    <AnimatePresence initial={false}>
      {isOpen && (
        <motion.div
          key="expanded"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{
            duration: 0.35,
            ease: [0.22, 1, 0.36, 1],
          }}
          className="overflow-hidden"
        >
          <div className="mt-6 w-full max-w-[480px] mx-auto px-2 flex flex-col gap-2">
            {tasks.map((task, i) => (
              <SubTaskRow
                key={task.id}
                task={task}
                isCompleted={completedTaskIds.has(task.id)}
                isCurrent={task.id === currentTaskId}
                index={i}
                onClick={() => onTaskClick(task)}
              />
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
