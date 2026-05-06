"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
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
  DiscountRequest,
  StudentTitle,
  Quiz,
  QuizQuestion,
  StudentQuizAttempt,
  MonthReview,
} from "@/types/database";
import { getTitleForRegions } from "@/lib/titles";
import { DISCOUNT_WINDOW_DAYS, progressPercent } from "@/lib/constants";

export interface RegionProgress {
  completed: number;
  total: number;
  isComplete: boolean;
  isUnlocked: boolean;
}

/** Snapshot of the last Whop watch-sync attempt — fed by the diagnostic
 *  columns on the students row + the masked WHOP_COURSE_ID env var. Read
 *  by the sync debug panel; updated after every sync run. */
export interface SyncDiagnostics {
  lastSyncAt: string | null;
  fetchedCount: number | null;
  matchedCount: number | null;
  unmatchedWhopIds: string[];
  lastError: string | null;
  lastErrorAt: string | null;
  whopUserId: string | null;
  whopCourseIdMasked: string | null;
}

interface StudentContextType {
  // Raw data
  regions: Region[];
  lessons: Lesson[];
  completions: StudentLessonCompletion[];
  discountRequest: DiscountRequest | null;
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
  discountEligible: boolean;               // all R1+R2 done AND within time window
  discountMsLeft: number;                  // ms until the discount window closes (negative if expired)
  discountAllLessonsDone: boolean;         // R1 + R2 fully complete (regardless of time)

  // Sets exposing fine-grained completion state for compound lessons
  /** Lessons where the watch/main half is complete (briefing watched OR non-compound finished) */
  watchedLessonIds: Set<string>;
  /** Lessons where the manual "I shipped the ad" half is complete (only compound lessons) */
  actionShippedLessonIds: Set<string>;
  /** Lessons the student deliberately skipped (count toward path, flagged separately) */
  skippedLessonIds: Set<string>;

  // Actions
  toggleLesson: (lessonId: string) => Promise<void>;
  /** For compound lessons: toggle the manual "shipped" half independent of watch state */
  toggleLessonAction: (lessonId: string) => Promise<void>;
  /** Mark a grouped/optional lesson as skipped (or un-skip if it's already skipped) */
  skipLesson: (lessonId: string) => Promise<void>;
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

  // Sync debug — last sync result + a forced (un-throttled) re-run
  syncDiagnostics: SyncDiagnostics;
  forceSync: () => Promise<{
    ok: boolean;
    message?: string;
    /** Local lesson IDs that matched a Whop completion this run */
    matchedLessonIds?: string[];
    /** Full list of Whop lesson IDs returned by the API this run */
    fetchedWhopIds?: string[];
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
  const [discountRequest, setDiscountRequest] = useState<DiscountRequest | null>(null);
  const [streak, setStreak] = useState<{ current: number; longest: number }>({
    current: 0,
    longest: 0,
  });
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [quizQuestions, setQuizQuestions] = useState<Record<string, QuizQuestion[]>>({});
  const [quizAttempts, setQuizAttempts] = useState<StudentQuizAttempt[]>([]);
  const [monthReview, setMonthReview] = useState<MonthReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncDiagnostics, setSyncDiagnostics] = useState<SyncDiagnostics>({
    lastSyncAt: null,
    fetchedCount: null,
    matchedCount: null,
    unmatchedWhopIds: [],
    lastError: null,
    lastErrorAt: null,
    whopUserId: null,
    whopCourseIdMasked: null,
  });

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
        setDiscountRequest(data.discountRequest ?? null);
        setStreak({
          current: data.student?.current_streak ?? 0,
          longest: data.student?.longest_streak ?? 0,
        });

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
        setSyncDiagnostics({
          lastSyncAt: data.student?.last_watch_sync_at ?? null,
          fetchedCount: data.student?.whop_last_sync_fetched_count ?? null,
          matchedCount: data.student?.whop_last_sync_matched_count ?? null,
          unmatchedWhopIds: data.student?.whop_last_sync_unmatched ?? [],
          lastError: data.student?.whop_last_sync_error ?? null,
          lastErrorAt: data.student?.whop_last_sync_error_at ?? null,
          whopUserId: data.student?.whop_user_id ?? null,
          whopCourseIdMasked: data.whopCourseIdMasked ?? null,
        });
      } catch (err) {
        console.error("Failed to fetch student data:", err);
      }
      setLoading(false);
    }

    fetchData();
  }, [student]);

  // Pull /api/student/data and refresh both completions + sync diagnostics.
  // Used after every sync (silent or forced) so the debug panel stays live.
  const refreshFromServer = useCallback(async (token: string) => {
    const dataRes = await fetch("/api/student/data", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!dataRes.ok) return;
    const fresh = await dataRes.json();
    setCompletions(fresh.completions ?? []);
    setSyncDiagnostics({
      lastSyncAt: fresh.student?.last_watch_sync_at ?? null,
      fetchedCount: fresh.student?.whop_last_sync_fetched_count ?? null,
      matchedCount: fresh.student?.whop_last_sync_matched_count ?? null,
      unmatchedWhopIds: fresh.student?.whop_last_sync_unmatched ?? [],
      lastError: fresh.student?.whop_last_sync_error ?? null,
      lastErrorAt: fresh.student?.whop_last_sync_error_at ?? null,
      whopUserId: fresh.student?.whop_user_id ?? null,
      whopCourseIdMasked: fresh.whopCourseIdMasked ?? null,
    });
  }, []);

  // Auto-sync Whop progress. Silent — no button, no flash.
  //   - Once on mount (first load after login)
  //   - Every time the tab regains visibility (student alt-tabs back from
  //     Whop after watching a lesson), throttled to at most once per 30s
  const lastSyncAtRef = useRef(0);
  const runSilentSync = useCallback(async () => {
    const now = Date.now();
    if (now - lastSyncAtRef.current < 30_000) return; // throttle
    lastSyncAtRef.current = now;

    const token = await getAccessToken();
    if (!token) return;

    try {
      const res = await fetch("/api/student/refresh-watch-sync", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      await refreshFromServer(token);
    } catch {
      // silent — errors are persisted server-side for admin review
    }
  }, [refreshFromServer]);

  // Forced sync — no throttle, returns the result so the debug panel can
  // display ok/error + the matched/fetched lesson IDs inline.
  const forceSync = useCallback(async () => {
    lastSyncAtRef.current = Date.now(); // also reset throttle
    const token = await getAccessToken();
    if (!token) return { ok: false as const, message: "Session expired" };
    try {
      const res = await fetch("/api/student/refresh-watch-sync", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => null);
      // Always re-read the student row so the panel reflects the latest
      // diagnostic columns even when the sync itself errored.
      await refreshFromServer(token);
      if (!res.ok) {
        return {
          ok: false as const,
          message: json?.error ?? `Sync failed (HTTP ${res.status})`,
        };
      }
      return {
        ok: true as const,
        matchedLessonIds: (json?.matchedLessonIds ?? []) as string[],
        fetchedWhopIds: (json?.fetchedWhopIds ?? []) as string[],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false as const, message };
    }
  }, [refreshFromServer]);

  // One-shot mount sync
  const hasAutoSyncedRef = useRef(false);
  useEffect(() => {
    if (!student || hasAutoSyncedRef.current) return;
    hasAutoSyncedRef.current = true;
    runSilentSync();
  }, [student, runSilentSync]);

  // Tab-focus sync: when the student comes back from Whop, we pull updates.
  useEffect(() => {
    if (!student) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") runSilentSync();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [student, runSilentSync]);

  // Derived state.
  //
  // For COMPOUND lessons (lessons.requires_action = true) a single
  // student_lesson_completions row carries TWO timestamps:
  //   - completed_at         → briefing was watched (auto-synced from Whop)
  //   - action_completed_at  → student manually checked "I shipped the ad"
  //
  // The lesson is only "fully complete" when both are non-null.
  // We expose three sets so the UI can render partial states cleanly.
  const lessonsById = useMemo(() => {
    const m = new Map<string, Lesson>();
    for (const l of lessons) m.set(l.id, l);
    return m;
  }, [lessons]);

  const watchedLessonIds = useMemo(() => {
    const s = new Set<string>();
    for (const c of completions) if (c.completed_at) s.add(c.lesson_id);
    return s;
  }, [completions]);

  const actionShippedLessonIds = useMemo(() => {
    const s = new Set<string>();
    for (const c of completions) if (c.action_completed_at) s.add(c.lesson_id);
    return s;
  }, [completions]);

  const skippedLessonIds = useMemo(() => {
    const s = new Set<string>();
    for (const c of completions) if (c.skipped_at) s.add(c.lesson_id);
    return s;
  }, [completions]);

  const completedLessonIds = useMemo(() => {
    const s = new Set<string>();
    for (const c of completions) {
      const lesson = lessonsById.get(c.lesson_id);
      if (!lesson) continue;
      // Skipped lessons count toward path progression so the student
      // can keep moving past optional content. Journal/workshop tell
      // skipped from watched via skippedLessonIds.
      if (c.skipped_at) {
        s.add(c.lesson_id);
        continue;
      }
      if (lesson.requires_action) {
        if (c.completed_at && c.action_completed_at) s.add(c.lesson_id);
      } else if (c.completed_at) {
        s.add(c.lesson_id);
      }
    }
    return s;
  }, [completions, lessonsById]);

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
    return progressPercent(completedLessonIds.size, lessons.length);
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

  // Discount window: R1 + R2 all complete AND finished within
  // DISCOUNT_WINDOW_DAYS of the student's Whop join date.
  const discountAllLessonsDone = useMemo(() => {
    const r1 = regionProgress["r1"];
    const r2 = regionProgress["r2"];
    return Boolean(r1?.isComplete && r2?.isComplete);
  }, [regionProgress]);

  const discountMsLeft = useMemo(() => {
    if (!student) return 0;
    const joined = new Date(student.joined_at).getTime();
    const deadline = joined + DISCOUNT_WINDOW_DAYS * 86_400_000;
    return deadline - Date.now();
  }, [student]);

  const discountEligible = useMemo(() => {
    return discountAllLessonsDone && discountMsLeft > 0;
  }, [discountAllLessonsDone, discountMsLeft]);

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
          action_completed_at: null,
          skipped_at: null,
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

  /**
   * Compound-lesson "I shipped the ad" toggle. Sets/clears the
   * action_completed_at column on student_lesson_completions without
   * touching the watch state (which auto-syncs from Whop separately).
   */
  const toggleLessonAction = useCallback(
    async (lessonId: string) => {
      if (!student) return;
      const token = await getAccessToken();
      if (!token) return;

      const isShipped = actionShippedLessonIds.has(lessonId);
      const optimisticTimestamp = isShipped ? null : new Date().toISOString();

      // Optimistic update — preserve existing watch state
      setCompletions((prev) => {
        const existing = prev.find((c) => c.lesson_id === lessonId);
        if (existing) {
          return prev.map((c) =>
            c.lesson_id === lessonId
              ? { ...c, action_completed_at: optimisticTimestamp }
              : c
          );
        }
        // No row yet — create one with only the action half set
        return [
          ...prev,
          {
            id: crypto.randomUUID(),
            student_id: student.id,
            lesson_id: lessonId,
            completed_at: null,
            action_completed_at: optimisticTimestamp,
            skipped_at: null,
          },
        ];
      });

      try {
        const res = await fetch("/api/student/mark-action-shipped", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ lessonId, shipped: !isShipped }),
        });

        if (!res.ok) {
          // Revert by refetching
          const dataRes = await fetch("/api/student/data", {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (dataRes.ok) {
            const data = await dataRes.json();
            setCompletions(data.completions);
          }
        } else {
          const result = await res.json();
          if (result.completion) {
            setCompletions((prev) => {
              const exists = prev.some((c) => c.lesson_id === lessonId);
              if (exists) {
                return prev.map((c) =>
                  c.lesson_id === lessonId ? result.completion : c
                );
              }
              return [...prev, result.completion];
            });
          }
        }
      } catch {
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
    [student, actionShippedLessonIds]
  );

  const skipLesson = useCallback(
    async (lessonId: string) => {
      if (!student) return;
      const token = await getAccessToken();
      if (!token) return;

      const isSkipped = skippedLessonIds.has(lessonId);
      const isWatched = watchedLessonIds.has(lessonId);
      // Don't trample a watched row.
      if (isWatched) return;

      // Optimistic update
      if (isSkipped) {
        setCompletions((prev) => prev.filter((c) => c.lesson_id !== lessonId));
      } else {
        const optimistic: StudentLessonCompletion = {
          id: crypto.randomUUID(),
          student_id: student.id,
          lesson_id: lessonId,
          completed_at: null,
          action_completed_at: null,
          skipped_at: new Date().toISOString(),
        };
        setCompletions((prev) => [...prev, optimistic]);
      }

      try {
        const res = await fetch("/api/student/skip-lesson", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ lessonId }),
        });

        if (!res.ok) {
          const dataRes = await fetch("/api/student/data", {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (dataRes.ok) {
            const data = await dataRes.json();
            setCompletions(data.completions);
          }
        } else {
          const result = await res.json();
          if (result.action === "skipped" && result.completion) {
            setCompletions((prev) => {
              const exists = prev.some((c) => c.lesson_id === lessonId);
              if (exists) {
                return prev.map((c) =>
                  c.lesson_id === lessonId ? result.completion : c
                );
              }
              return [...prev, result.completion];
            });
          }
        }
      } catch {
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
    [student, skippedLessonIds, watchedLessonIds]
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
        discountRequest,
        quizzes,
        quizQuestions,
        quizAttempts,
        monthReview,
        loading,
        completedLessonIds,
        watchedLessonIds,
        actionShippedLessonIds,
        skippedLessonIds,
        regionProgress,
        overallProgress,
        currentLesson,
        currentRegionId,
        streak,
        currentTitle,
        completedRegionCount,
        discountEligible,
        discountMsLeft,
        discountAllLessonsDone,
        toggleLesson,
        toggleLessonAction,
        skipLesson,
        submitQuiz,
        requestDiscount,
        refreshWatchProgress,
        syncDiagnostics,
        forceSync,
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

