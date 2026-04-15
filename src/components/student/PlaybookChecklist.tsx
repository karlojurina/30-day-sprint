"use client";

import { useMemo } from "react";
import { useStudent } from "@/contexts/StudentContext";
import { useAuth } from "@/contexts/AuthContext";
import { WeekSection } from "./WeekSection";
import { getDayNumber } from "@/types/database";

export function PlaybookChecklist() {
  const { tasks, completedTaskIds, toggleTask } = useStudent();
  const { student } = useAuth();

  const dayNumber = student ? getDayNumber(student.joined_at) : 1;

  // Determine which week to auto-expand
  const currentWeek = Math.min(4, Math.ceil(dayNumber / 7));

  // Group tasks by week
  const tasksByWeek = useMemo(() => {
    const grouped: Record<number, typeof tasks> = {};
    for (const task of tasks) {
      if (!grouped[task.week]) grouped[task.week] = [];
      grouped[task.week].push(task);
    }
    return grouped;
  }, [tasks]);

  return (
    <div className="space-y-3">
      {[1, 2, 3, 4].map((week) => (
        <WeekSection
          key={week}
          week={week}
          tasks={tasksByWeek[week] || []}
          completedTaskIds={completedTaskIds}
          onToggleTask={toggleTask}
          defaultOpen={week === currentWeek}
        />
      ))}
    </div>
  );
}
