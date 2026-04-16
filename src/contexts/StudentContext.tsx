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
import type {
  Task,
  Checkpoint,
  StudentTaskCompletion,
  DailyNote,
  DiscountRequest,
} from "@/types/database";

export interface CheckpointProgress {
  completed: number;
  total: number;
  isComplete: boolean;
}

interface StudentContextType {
  tasks: Task[];
  checkpoints: Checkpoint[];
  completions: StudentTaskCompletion[];
  todayNote: DailyNote | null;
  discountRequest: DiscountRequest | null;
  loading: boolean;

  // Derived state
  completedTaskIds: Set<string>;
  weekProgress: Record<number, { completed: number; total: number }>;
  checkpointProgress: Record<string, CheckpointProgress>;
  overallProgress: number;
  activationPoints: { ap1: boolean; ap2: boolean; ap3: boolean };
  discountEligible: boolean;
  discountCheckpointsCompleted: number;
  discountCheckpointsTotal: number;

  // Actions
  toggleTask: (taskId: string) => Promise<void>;
  saveNote: (content: string) => Promise<void>;
  requestDiscount: () => Promise<void>;
  refreshWatchProgress: () => Promise<{ synced: number; message: string }>;
}

const StudentContext = createContext<StudentContextType | null>(null);

async function getAccessToken() {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export function StudentProvider({ children }: { children: ReactNode }) {
  const { student } = useAuth();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [completions, setCompletions] = useState<StudentTaskCompletion[]>([]);
  const [todayNote, setTodayNote] = useState<DailyNote | null>(null);
  const [discountRequest, setDiscountRequest] = useState<DiscountRequest | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch all data via API route (bypasses RLS)
  useEffect(() => {
    if (!student) return;

    async function fetchData() {
      const token = await getAccessToken();
      if (!token) {
        setLoading(false);
        return;
      }

      try {
        const res = await fetch("/api/student/data", {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!res.ok) {
          setLoading(false);
          return;
        }

        const data = await res.json();
        setTasks(data.tasks);
        setCheckpoints(data.checkpoints ?? []);
        setCompletions(data.completions);
        setTodayNote(data.todayNote);
        setDiscountRequest(data.discountRequest);
      } catch (err) {
        console.error("Failed to fetch student data:", err);
      }
      setLoading(false);
    }

    fetchData();
  }, [student]);

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

  const checkpointProgress = useMemo(() => {
    const progress: Record<string, CheckpointProgress> = {};
    for (const cp of checkpoints) {
      progress[cp.id] = { completed: 0, total: 0, isComplete: false };
    }
    for (const task of tasks) {
      if (!progress[task.checkpoint_id]) continue;
      progress[task.checkpoint_id].total++;
      if (completedTaskIds.has(task.id)) {
        progress[task.checkpoint_id].completed++;
      }
    }
    for (const id of Object.keys(progress)) {
      progress[id].isComplete =
        progress[id].total > 0 && progress[id].completed === progress[id].total;
    }
    return progress;
  }, [tasks, checkpoints, completedTaskIds]);

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

  // Discount eligibility: all checkpoints up to and including the one marked
  // is_discount_gate must be fully complete.
  const { discountEligible, discountCheckpointsCompleted, discountCheckpointsTotal } = useMemo(() => {
    const gateCp = checkpoints.find((c) => c.is_discount_gate);
    if (!gateCp) {
      return {
        discountEligible: false,
        discountCheckpointsCompleted: 0,
        discountCheckpointsTotal: 0,
      };
    }
    const required = checkpoints.filter(
      (c) => c.sort_order <= gateCp.sort_order
    );
    const done = required.filter(
      (c) => checkpointProgress[c.id]?.isComplete
    ).length;
    return {
      discountEligible: done === required.length,
      discountCheckpointsCompleted: done,
      discountCheckpointsTotal: required.length,
    };
  }, [checkpoints, checkpointProgress]);

  // Actions — all via API routes
  const toggleTask = useCallback(
    async (taskId: string) => {
      if (!student) return;

      const token = await getAccessToken();
      if (!token) return;

      const isCompleted = completedTaskIds.has(taskId);

      // Optimistic update
      if (isCompleted) {
        setCompletions((prev) => prev.filter((c) => c.task_id !== taskId));
      } else {
        const optimistic: StudentTaskCompletion = {
          id: crypto.randomUUID(),
          student_id: student.id,
          task_id: taskId,
          completed_at: new Date().toISOString(),
        };
        setCompletions((prev) => [...prev, optimistic]);
      }

      try {
        const res = await fetch("/api/student/toggle-task", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ taskId }),
        });

        if (!res.ok) {
          // Revert: re-fetch all completions
          const dataRes = await fetch("/api/student/data", {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (dataRes.ok) {
            const data = await dataRes.json();
            setCompletions(data.completions);
          }
        } else {
          const result = await res.json();
          if (result.action === "checked" && result.completion) {
            // Replace optimistic with real data
            setCompletions((prev) =>
              prev.map((c) =>
                c.task_id === taskId && !c.id.includes("-")
                  ? c
                  : c.task_id === taskId
                    ? result.completion
                    : c
              )
            );
          }
        }
      } catch {
        // Revert on network error: re-fetch
        const token2 = await getAccessToken();
        if (token2) {
          const dataRes = await fetch("/api/student/data", {
            headers: { Authorization: `Bearer ${token2}` },
          });
          if (dataRes.ok) {
            const data = await dataRes.json();
            setCompletions(data.completions);
          }
        }
      }
    },
    [student, completedTaskIds]
  );

  const saveNote = useCallback(
    async (content: string) => {
      if (!student) return;

      const token = await getAccessToken();
      if (!token) return;

      try {
        const res = await fetch("/api/student/save-note", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ content }),
        });

        if (res.ok) {
          const data = await res.json();
          setTodayNote(data.note);
        }
      } catch (err) {
        console.error("Failed to save note:", err);
      }
    },
    [student]
  );

  const refreshWatchProgress = useCallback(async () => {
    if (!student) return { synced: 0, message: "Not logged in" };

    const token = await getAccessToken();
    if (!token) return { synced: 0, message: "Session expired" };

    try {
      const res = await fetch("/api/student/refresh-watch-sync", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        return {
          synced: 0,
          message: err.error || "Sync failed",
        };
      }

      const data = await res.json();

      // Re-fetch all student data to pick up the new completions
      const dataRes = await fetch("/api/student/data", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (dataRes.ok) {
        const fresh = await dataRes.json();
        setTasks(fresh.tasks);
        setCheckpoints(fresh.checkpoints ?? []);
        setCompletions(fresh.completions);
      }

      return {
        synced: data.syncedCount ?? 0,
        message:
          data.syncedCount > 0
            ? `Synced ${data.syncedCount} lesson${data.syncedCount === 1 ? "" : "s"} from Whop.`
            : "All up to date.",
      };
    } catch {
      return { synced: 0, message: "Network error" };
    }
  }, [student]);

  const requestDiscount = useCallback(async () => {
    if (!student || !discountEligible) return;

    const token = await getAccessToken();
    if (!token) return;

    try {
      const res = await fetch("/api/discounts/request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      if (res.ok) {
        const data = await res.json();
        setDiscountRequest(data);
      }
    } catch (err) {
      console.error("Failed to request discount:", err);
    }
  }, [student, discountEligible]);

  return (
    <StudentContext.Provider
      value={{
        tasks,
        checkpoints,
        completions,
        todayNote,
        discountRequest,
        loading,
        completedTaskIds,
        weekProgress,
        checkpointProgress,
        overallProgress,
        activationPoints,
        discountEligible,
        discountCheckpointsCompleted,
        discountCheckpointsTotal,
        toggleTask,
        saveNote,
        requestDiscount,
        refreshWatchProgress,
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
