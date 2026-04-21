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
  Region,
  Lesson,
  StudentLessonCompletion,
  DailyNote,
  DiscountRequest,
  LessonNote,
  StudentTitle,
  Quiz,
  QuizQuestion,
  StudentQuizAttempt,
  MonthReview,
} from "@/types/database";
import { getTitleForRegions } from "@/lib/titles";

export interface RegionProgress {
  completed: number;
  total: number;
  isComplete: boolean;
  isUnlocked: boolean;
}

interface StudentContextType {
  // Raw data
  regions: Region[];
  lessons: Lesson[];
  completions: StudentLessonCompletion[];
  todayNote: DailyNote | null;
  discountRequest: DiscountRequest | null;
  lessonNotes: Record<string, string>;
  quizzes: Quiz[];
  quizQuestions: Record<string, QuizQuestion[]>;
  quizAttempts: StudentQuizAttempt[];
  monthReview: MonthReview | null;
  loading: boolean;

  // Derived state
  completedLessonIds: Set<string>;
  regionProgress: Record<string, RegionProgress>;
  overallProgress: number;                 // 0-100 across all lessons
  currentLesson: Lesson | null;            // first incomplete lesson in day order
  currentRegionId: string | null;
  streak: { current: number; longest: number };
  currentTitle: StudentTitle;
  completedRegionCount: number;
  discountEligible: boolean;               // l18 is complete
  discountUnlockedInRegion: boolean;       // region 2 completed

  // Actions
  toggleLesson: (lessonId: string) => Promise<void>;
  saveNote: (content: string) => Promise<void>;
  saveLessonNote: (lessonId: string, content: string) => Promise<void>;
  submitQuiz: (
    quizId: string,
    selections: Record<string, number>
  ) => Promise<{
    score: number;
    total: number;
    passed: boolean;
    answers: { questionId: string; selectedIndex: number; correct: boolean }[];
  }>;
  requestDiscount: () => Promise<void>;
  refreshWatchProgress: () => Promise<{
    synced: number;
    message: string;
    reAuth?: boolean;
  }>;
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

  const [regions, setRegions] = useState<Region[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [completions, setCompletions] = useState<StudentLessonCompletion[]>([]);
  const [todayNote, setTodayNote] = useState<DailyNote | null>(null);
  const [discountRequest, setDiscountRequest] = useState<DiscountRequest | null>(null);
  const [lessonNotes, setLessonNotes] = useState<Record<string, string>>({});
  const [streak, setStreak] = useState<{ current: number; longest: number }>({
    current: 0,
    longest: 0,
  });
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [quizQuestions, setQuizQuestions] = useState<Record<string, QuizQuestion[]>>({});
  const [quizAttempts, setQuizAttempts] = useState<StudentQuizAttempt[]>([]);
  const [monthReview, setMonthReview] = useState<MonthReview | null>(null);
  const [loading, setLoading] = useState(true);

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
        setRegions(data.regions ?? []);
        setLessons(data.lessons ?? []);
        setCompletions(data.completions ?? []);
        setTodayNote(data.todayNote ?? null);
        setDiscountRequest(data.discountRequest ?? null);
        setStreak({
          current: data.student?.current_streak ?? 0,
          longest: data.student?.longest_streak ?? 0,
        });

        const notesMap: Record<string, string> = {};
        for (const note of data.lessonNotes ?? []) {
          notesMap[note.lesson_id] = note.content;
        }
        setLessonNotes(notesMap);

        setQuizzes(data.quizzes ?? []);
        setQuizAttempts(data.quizAttempts ?? []);
        const qMap: Record<string, QuizQuestion[]> = {};
        for (const q of data.quizQuestions ?? []) {
          if (!qMap[q.quiz_id]) qMap[q.quiz_id] = [];
          qMap[q.quiz_id].push(q);
        }
        for (const key of Object.keys(qMap)) {
          qMap[key].sort(
            (a: QuizQuestion, b: QuizQuestion) => a.sort_order - b.sort_order
          );
        }
        setQuizQuestions(qMap);
        setMonthReview(data.monthReview ?? null);
      } catch (err) {
        console.error("Failed to fetch student data:", err);
      }
      setLoading(false);
    }

    fetchData();
  }, [student]);

  // Derived state
  const completedLessonIds = useMemo(
    () => new Set(completions.map((c) => c.lesson_id)),
    [completions]
  );

  const regionProgress = useMemo(() => {
    const progress: Record<string, RegionProgress> = {};
    // init
    for (const r of regions) {
      progress[r.id] = { completed: 0, total: 0, isComplete: false, isUnlocked: false };
    }
    // count
    for (const lesson of lessons) {
      if (!progress[lesson.region_id]) continue;
      progress[lesson.region_id].total++;
      if (completedLessonIds.has(lesson.id)) {
        progress[lesson.region_id].completed++;
      }
    }
    // mark complete
    for (const id of Object.keys(progress)) {
      progress[id].isComplete =
        progress[id].total > 0 &&
        progress[id].completed === progress[id].total;
    }
    // compute unlock state (sequential: r1 unlocked, each next unlocks when prev complete)
    const sortedRegions = [...regions].sort((a, b) => a.order_num - b.order_num);
    for (let i = 0; i < sortedRegions.length; i++) {
      const r = sortedRegions[i];
      if (i === 0) {
        progress[r.id].isUnlocked = true;
      } else {
        const prev = sortedRegions[i - 1];
        progress[r.id].isUnlocked = progress[prev.id]?.isComplete ?? false;
      }
    }
    return progress;
  }, [regions, lessons, completedLessonIds]);

  const overallProgress = useMemo(() => {
    if (lessons.length === 0) return 0;
    return Math.round((completedLessonIds.size / lessons.length) * 100);
  }, [lessons, completedLessonIds]);

  // First incomplete lesson in day/sort_order sequence
  const currentLesson = useMemo(() => {
    const sorted = [...lessons].sort(
      (a, b) => a.day - b.day || a.sort_order - b.sort_order
    );
    for (const l of sorted) {
      if (!completedLessonIds.has(l.id)) return l;
    }
    return null;
  }, [lessons, completedLessonIds]);

  const currentRegionId = currentLesson?.region_id ?? null;

  const completedRegionCount = useMemo(() => {
    return Object.values(regionProgress).filter((p) => p.isComplete).length;
  }, [regionProgress]);

  const currentTitle = useMemo(() => {
    return getTitleForRegions(completedRegionCount).key;
  }, [completedRegionCount]);

  // Discount: l18 is complete (or simpler: region 2 is complete)
  const discountEligible = useMemo(() => {
    return completedLessonIds.has("l18");
  }, [completedLessonIds]);

  const discountUnlockedInRegion = useMemo(() => {
    return regionProgress["r2"]?.isComplete ?? false;
  }, [regionProgress]);

  // Actions

  const toggleLesson = useCallback(
    async (lessonId: string) => {
      if (!student) return;
      const token = await getAccessToken();
      if (!token) return;

      const isCompleted = completedLessonIds.has(lessonId);

      // Optimistic update
      if (isCompleted) {
        setCompletions((prev) => prev.filter((c) => c.lesson_id !== lessonId));
      } else {
        const optimistic: StudentLessonCompletion = {
          id: crypto.randomUUID(),
          student_id: student.id,
          lesson_id: lessonId,
          completed_at: new Date().toISOString(),
        };
        setCompletions((prev) => [...prev, optimistic]);
      }

      try {
        const res = await fetch("/api/student/toggle-lesson", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ lessonId }),
        });

        if (!res.ok) {
          // Revert on error: refetch
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
            setCompletions((prev) =>
              prev.map((c) =>
                c.lesson_id === lessonId ? result.completion : c
              )
            );
          }
        }
      } catch {
        // Revert on network error
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
    [student, completedLessonIds]
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

  const saveLessonNote = useCallback(
    async (lessonId: string, content: string) => {
      if (!student) return;

      setLessonNotes((prev) => ({ ...prev, [lessonId]: content }));

      const token = await getAccessToken();
      if (!token) return;

      try {
        const res = await fetch("/api/student/save-lesson-note", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ lessonId, content }),
        });
        if (!res.ok) {
          console.error("Failed to save lesson note");
        }
      } catch (err) {
        console.error("Failed to save lesson note:", err);
      }
    },
    [student]
  );

  const submitQuiz = useCallback(
    async (quizId: string, selections: Record<string, number>) => {
      const token = await getAccessToken();
      if (!token) throw new Error("Not authenticated");

      const res = await fetch("/api/student/submit-quiz", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ quizId, selections }),
      });

      if (!res.ok) throw new Error("Failed to submit quiz");

      const data = await res.json();
      if (data.attempt) {
        setQuizAttempts((prev) => [...prev, data.attempt]);
      }
      return {
        score: data.score,
        total: data.total,
        passed: data.passed,
        answers: data.answers,
      };
    },
    []
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
        const err = await res
          .json()
          .catch(() => ({ error: "Unknown error", reAuth: false }));
        return {
          synced: 0,
          message: err.error || "Sync failed",
          reAuth: Boolean(err.reAuth),
        };
      }

      const data = await res.json();

      const dataRes = await fetch("/api/student/data", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (dataRes.ok) {
        const fresh = await dataRes.json();
        setLessons(fresh.lessons);
        setRegions(fresh.regions ?? []);
        setCompletions(fresh.completions);
      }

      const synced = data.syncedCount ?? 0;
      const fetched = data.fetchedCount ?? 0;
      let message: string;
      if (synced > 0) {
        message = `Synced ${synced} lesson${synced === 1 ? "" : "s"} from Whop.`;
      } else if (fetched > 0) {
        message = `Found ${fetched} completion${fetched === 1 ? "" : "s"} on Whop, but none matched a lesson in the app.`;
      } else {
        message = "All up to date.";
      }
      return { synced, message };
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
        body: JSON.stringify({ studentId: student.id }),
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
        regions,
        lessons,
        completions,
        todayNote,
        discountRequest,
        lessonNotes,
        quizzes,
        quizQuestions,
        quizAttempts,
        monthReview,
        loading,
        completedLessonIds,
        regionProgress,
        overallProgress,
        currentLesson,
        currentRegionId,
        streak,
        currentTitle,
        completedRegionCount,
        discountEligible,
        discountUnlockedInRegion,
        toggleLesson,
        saveNote,
        saveLessonNote,
        submitQuiz,
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

// Re-export LessonNote for convenience
export type { LessonNote };
