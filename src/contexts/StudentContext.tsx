"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import { createClient } from "@/lib/supabase-browser";
import { useAuth } from "./AuthContext";
import type { Task, StudentTaskCompletion, DailyNote, DiscountRequest } from "@/types/database";
import { DISCOUNT_REQUIRED_TASKS } from "@/lib/constants";

interface StudentContextType {
  tasks: Task[];
  completions: StudentTaskCompletion[];
  todayNote: DailyNote | null;
  discountRequest: DiscountRequest | null;
  loading: boolean;

  // Derived state
  completedTaskIds: Set<string>;
  weekProgress: Record<number, { completed: number; total: number }>;
  overallProgress: number;
  activationPoints: { ap1: boolean; ap2: boolean; ap3: boolean };
  discountEligible: boolean;
  discountTasksCompleted: number;

  // Actions
  toggleTask: (taskId: string) => Promise<void>;
  saveNote: (content: string) => Promise<void>;
  requestDiscount: () => Promise<void>;
}

const StudentContext = createContext<StudentContextType | null>(null);

export function StudentProvider({ children }: { children: ReactNode }) {
  const { student } = useAuth();
  const supabase = createClient();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [completions, setCompletions] = useState<StudentTaskCompletion[]>([]);
  const [todayNote, setTodayNote] = useState<DailyNote | null>(null);
  const [discountRequest, setDiscountRequest] = useState<DiscountRequest | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch all data on mount
  useEffect(() => {
    if (!student) return;

    async function fetchData() {
      const today = new Date().toISOString().split("T")[0];

      const [tasksRes, completionsRes, noteRes, discountRes] = await Promise.all([
        supabase.from("tasks").select("*").order("week").order("sort_order"),
        supabase
          .from("student_task_completions")
          .select("*")
          .eq("student_id", student!.id),
        supabase
          .from("daily_notes")
          .select("*")
          .eq("student_id", student!.id)
          .eq("note_date", today)
          .single(),
        supabase
          .from("discount_requests")
          .select("*")
          .eq("student_id", student!.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .single(),
      ]);

      if (tasksRes.data) setTasks(tasksRes.data);
      if (completionsRes.data) setCompletions(completionsRes.data);
      if (noteRes.data) setTodayNote(noteRes.data);
      if (discountRes.data) setDiscountRequest(discountRes.data);
      setLoading(false);
    }

    fetchData();
  }, [student, supabase]);

  // Derived state
  const completedTaskIds = useMemo(
    () => new Set(completions.map((c) => c.task_id)),
    [completions]
  );

  const weekProgress = useMemo(() => {
    const progress: Record<number, { completed: number; total: number }> = {};
    for (const task of tasks) {
      if (!progress[task.week]) {
        progress[task.week] = { completed: 0, total: 0 };
      }
      progress[task.week].total++;
      if (completedTaskIds.has(task.id)) {
        progress[task.week].completed++;
      }
    }
    return progress;
  }, [tasks, completedTaskIds]);

  const overallProgress = useMemo(() => {
    if (tasks.length === 0) return 0;
    return Math.round((completedTaskIds.size / tasks.length) * 100);
  }, [tasks, completedTaskIds]);

  const activationPoints = useMemo(() => {
    const ap1Tasks = tasks.filter((t) => t.activation_point_id === "AP1");
    const ap2Tasks = tasks.filter((t) => t.activation_point_id === "AP2");
    const ap3Tasks = tasks.filter((t) => t.activation_point_id === "AP3");

    return {
      ap1: ap1Tasks.some((t) => completedTaskIds.has(t.id)),
      ap2: ap2Tasks.some((t) => completedTaskIds.has(t.id)),
      ap3: ap3Tasks.some((t) => completedTaskIds.has(t.id)),
    };
  }, [tasks, completedTaskIds]);

  const discountTasksCompleted = useMemo(() => {
    return tasks.filter(
      (t) => t.is_discount_required && completedTaskIds.has(t.id)
    ).length;
  }, [tasks, completedTaskIds]);

  const discountEligible = discountTasksCompleted >= DISCOUNT_REQUIRED_TASKS;

  // Actions
  const toggleTask = useCallback(
    async (taskId: string) => {
      if (!student) return;

      const isCompleted = completedTaskIds.has(taskId);

      if (isCompleted) {
        // Uncheck: delete completion
        const completion = completions.find((c) => c.task_id === taskId);
        if (!completion) return;

        setCompletions((prev) => prev.filter((c) => c.task_id !== taskId));

        const { error } = await supabase
          .from("student_task_completions")
          .delete()
          .eq("id", completion.id);

        if (error) {
          // Revert on failure
          setCompletions((prev) => [...prev, completion]);
          console.error("Failed to uncheck task:", error);
        }
      } else {
        // Check: insert completion
        const optimistic: StudentTaskCompletion = {
          id: crypto.randomUUID(),
          student_id: student.id,
          task_id: taskId,
          completed_at: new Date().toISOString(),
        };

        setCompletions((prev) => [...prev, optimistic]);

        const { data, error } = await supabase
          .from("student_task_completions")
          .insert({ student_id: student.id, task_id: taskId })
          .select()
          .single();

        if (error) {
          // Revert on failure
          setCompletions((prev) =>
            prev.filter((c) => c.id !== optimistic.id)
          );
          console.error("Failed to check task:", error);
        } else if (data) {
          // Replace optimistic with real data
          setCompletions((prev) =>
            prev.map((c) => (c.id === optimistic.id ? data : c))
          );
        }
      }

      // Update last_active_at
      await supabase
        .from("students")
        .update({ last_active_at: new Date().toISOString() })
        .eq("id", student.id);
    },
    [student, completedTaskIds, completions, supabase]
  );

  const saveNote = useCallback(
    async (content: string) => {
      if (!student) return;
      const today = new Date().toISOString().split("T")[0];

      const { data, error } = await supabase
        .from("daily_notes")
        .upsert(
          { student_id: student.id, note_date: today, content },
          { onConflict: "student_id,note_date" }
        )
        .select()
        .single();

      if (error) {
        console.error("Failed to save note:", error);
      } else if (data) {
        setTodayNote(data);
      }

      // Update last_active_at
      await supabase
        .from("students")
        .update({ last_active_at: new Date().toISOString() })
        .eq("id", student.id);
    },
    [student, supabase]
  );

  const requestDiscount = useCallback(async () => {
    if (!student || !discountEligible) return;

    const { data, error } = await supabase
      .from("discount_requests")
      .insert({ student_id: student.id })
      .select()
      .single();

    if (error) {
      console.error("Failed to request discount:", error);
    } else if (data) {
      setDiscountRequest(data);
    }
  }, [student, discountEligible, supabase]);

  return (
    <StudentContext.Provider
      value={{
        tasks,
        completions,
        todayNote,
        discountRequest,
        loading,
        completedTaskIds,
        weekProgress,
        overallProgress,
        activationPoints,
        discountEligible,
        discountTasksCompleted,
        toggleTask,
        saveNote,
        requestDiscount,
      }}
    >
      {children}
    </StudentContext.Provider>
  );
}

export function useStudent() {
  const context = useContext(StudentContext);
  if (!context) {
    throw new Error("useStudent must be used within a StudentProvider");
  }
  return context;
}
