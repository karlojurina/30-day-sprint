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
  DiscountFeedbackQuestion,
  DiscountFeedbackAnswer,
  StudentMilestones,
  StudentStreaks,
  StudentWhopSync,
  StudentCelebrations,
} from "@/types/database";
import { getTitleForRegions } from "@/lib/titles";
import { DISCOUNT_WINDOW_DAYS, progressPercent } from "@/lib/constants";

export interface RegionProgress {
  completed: number;
  total: number;
  isComplete: boolean;
  isUnlocked: boolean;
}

/** Snapshot of the last Whop watch-sync attempt — fed by student_whop_sync
 *  + the masked WHOP_COURSE_ID env var. Read by the sync debug panel;
 *  updated after every sync run. */
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
  /**
   * Save the Discord message link the student pastes after shipping an
   * action-item ad to #ad-review. Pass `null` (or empty string) to clear.
   * Resolves to a friendly error message string if the API rejects it.
   */
  saveDiscordLink: (lessonId: string, link: string | null) => Promise<string | null>;
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

  // v42 (v2): bounty access claim — l057's one-time "claim my Bounty
  // spot" button. claimBountyAccess() flips bounty_access_claimed_at,
  // marks l057 complete, and surfaces the celebration. The boolean
  // is the celebration takeover flag; clear it via dismissBountyClaim.
  bountyAccessClaimedAt: string | null;
  bountyAccessJustClaimed: boolean;
  claimBountyAccess: () => Promise<void>;
  dismissBountyClaim: () => void;

  // v42 (v2): l058 first-bounty-submitted celebration + Finish
  // Program flow. firstBountyJustSubmitted is raised the moment
  // toggleLesson('l058') flips it from incomplete → complete.
  // finishProgram() then sets sprint_completed_at and unlocks Map 2.
  sprintCompletedAt: string | null;
  firstBountyJustSubmitted: boolean;
  finishProgram: () => Promise<void>;
  dismissFirstBountyCelebration: () => void;

  // v42 (v2): one-time Map 2 welcome overlay. playbookWelcomeSeenAt
  // is the stamp; if null the overlay shows on first visit. Action
  // sets the stamp so it doesn't re-fire on the next load.
  playbookWelcomeSeenAt: string | null;
  dismissPlaybookWelcome: () => Promise<void>;

  // v42 (v2): "Land Your First Client" milestone on Map 2. Single
  // self-report. firstClientLandedAt is the stamp; firstClientJust
  // Landed is the celebration takeover flag set the moment the
  // markFirstClient API call resolves (and the timestamp wasn't
  // already set server-side).
  firstClientLandedAt: string | null;
  firstClientJustLanded: boolean;
  markFirstClient: () => Promise<void>;
  dismissFirstClientCelebration: () => void;

  // v46 — onboarding milestone + celebration state, sourced from
  // student_milestones / student_celebrations respectively.
  onboardingCompletedAt: string | null;
  celebrations: StudentCelebrations | null;

  // Discount feedback form (v29) — Apply button now opens a 6-question
  // form that's submitted atomically with the discount_requests row.
  discountFeedbackQuestions: DiscountFeedbackQuestion[];
  discountFeedbackOpen: boolean;
  openDiscountFeedback: () => void;
  closeDiscountFeedback: () => void;
  /** Returns null on success, or an error string on failure. */
  submitDiscountFeedback: (
    answers: DiscountFeedbackAnswer[],
  ) => Promise<string | null>;
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
  const { student, setStudent } = useAuth();

  const [regions, setRegions] = useState<Region[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [completions, setCompletions] = useState<StudentLessonCompletion[]>([]);
  const [discountRequest, setDiscountRequest] = useState<DiscountRequest | null>(null);
  // v46 — per-function student state, split from the students row into
  // their own tables. Each is one row per student (or null if the row
  // doesn't exist yet — treated as "all fields default").
  const [milestones, setMilestones] = useState<StudentMilestones | null>(null);
  const [whopSync, setWhopSync] = useState<StudentWhopSync | null>(null);
  const [celebrations, setCelebrations] = useState<StudentCelebrations | null>(
    null,
  );
  // student_streaks data folds into the existing `streak` state below
  // (the public shape stays { current, longest } for consumers).
  // v42 (v2): celebration takeover state for the l057 bounty claim.
  // True from the moment the claim API resolves until the celebration
  // is dismissed. The bounty_access_claimed_at timestamp itself lives
  // on the student row in AuthContext.
  const [bountyAccessJustClaimed, setBountyAccessJustClaimed] = useState(false);
  // v42 (v2): same pattern for l058 → first bounty submitted. Raised
  // by toggleLesson when it sees l058 flip incomplete → complete.
  const [firstBountyJustSubmitted, setFirstBountyJustSubmitted] = useState(false);
  // v42 (v2): crowned-celebration takeover for the Map 2 milestone.
  // Set on markFirstClient() success when it wasn't a duplicate.
  const [firstClientJustLanded, setFirstClientJustLanded] = useState(false);
  const [streak, setStreak] = useState<{ current: number; longest: number }>({
    current: 0,
    longest: 0,
  });
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [quizQuestions, setQuizQuestions] = useState<Record<string, QuizQuestion[]>>({});
  const [quizAttempts, setQuizAttempts] = useState<StudentQuizAttempt[]>([]);
  const [monthReview, setMonthReview] = useState<MonthReview | null>(null);
  const [discountFeedbackQuestions, setDiscountFeedbackQuestions] = useState<
    DiscountFeedbackQuestion[]
  >([]);
  const [discountFeedbackOpen, setDiscountFeedbackOpen] = useState(false);
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
        // v46 — sibling tables. Each can be null if the row doesn't
        // exist yet (e.g. brand new student) — treat null as defaults.
        setMilestones((data.milestones as StudentMilestones | null) ?? null);
        setWhopSync((data.whopSync as StudentWhopSync | null) ?? null);
        setCelebrations(
          (data.celebrations as StudentCelebrations | null) ?? null,
        );
        setStreak({
          current: (data.streaks as StudentStreaks | null)?.current_streak ?? 0,
          longest: (data.streaks as StudentStreaks | null)?.longest_streak ?? 0,
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
        // Discount feedback form questions — fetched separately via the
        // browser client + RLS (only active rows visible to students).
        const sbForQuestions = createClient();
        const { data: questions } = await sbForQuestions
          .from("discount_feedback_questions")
          .select("*")
          .eq("is_active", true)
          .order("order_num");
        setDiscountFeedbackQuestions(
          (questions as DiscountFeedbackQuestion[] | null) ?? [],
        );
        const ws = data.whopSync as StudentWhopSync | null;
        setSyncDiagnostics({
          lastSyncAt: ws?.last_sync_at ?? null,
          fetchedCount: ws?.last_sync_fetched ?? null,
          matchedCount: ws?.last_sync_matched ?? null,
          unmatchedWhopIds: ws?.last_sync_unmatched ?? [],
          lastError: ws?.last_sync_error ?? null,
          lastErrorAt: ws?.last_sync_error_at ?? null,
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

  // Pull /api/student/data and refresh completions + sync diagnostics
  // + the discount request. Used after every sync (silent or forced)
  // so the debug panel stays live AND so an admin-side discount
  // approval picks up on the next tab-refocus instead of going stale
  // until full page refresh.
  const refreshFromServer = useCallback(async (token: string) => {
    const dataRes = await fetch("/api/student/data", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!dataRes.ok) return;
    const fresh = await dataRes.json();
    setCompletions(fresh.completions ?? []);
    // Admin can change discount_requests.status (pending → approved →
    // applied) from /admin/discounts. Refresh it here so the student
    // sees the new state when they switch back to their tab.
    setDiscountRequest(fresh.discountRequest ?? null);
    // v46 — push the fresh student row up to AuthContext (identity
    // changes are rare but possible — name, avatar, membership status)
    // AND refresh the per-function sibling tables so admin-side state
    // changes flow through without a hard reload.
    if (fresh.student) setStudent(fresh.student);
    setMilestones((fresh.milestones as StudentMilestones | null) ?? null);
    setWhopSync((fresh.whopSync as StudentWhopSync | null) ?? null);
    setCelebrations(
      (fresh.celebrations as StudentCelebrations | null) ?? null,
    );
    setStreak({
      current: (fresh.streaks as StudentStreaks | null)?.current_streak ?? 0,
      longest: (fresh.streaks as StudentStreaks | null)?.longest_streak ?? 0,
    });
    const ws = fresh.whopSync as StudentWhopSync | null;
    setSyncDiagnostics({
      lastSyncAt: ws?.last_sync_at ?? null,
      fetchedCount: ws?.last_sync_fetched ?? null,
      matchedCount: ws?.last_sync_matched ?? null,
      unmatchedWhopIds: ws?.last_sync_unmatched ?? [],
      lastError: ws?.last_sync_error ?? null,
      lastErrorAt: ws?.last_sync_error_at ?? null,
      whopUserId: fresh.student?.whop_user_id ?? null,
      whopCourseIdMasked: fresh.whopCourseIdMasked ?? null,
    });
  }, [setStudent]);

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

  // Tab-focus sync: when the student comes back from Whop, we pull
  // updates. Two things happen here:
  //   1. runSilentSync() — Whop watch-history pull, throttled to 30s
  //      because it's an external API call.
  //   2. refreshFromServer() — local DB refetch, NOT throttled. Cheap,
  //      and catches admin-side state changes (discount approvals)
  //      between the silent-sync throttle windows.
  useEffect(() => {
    if (!student) return;
    const onVisible = async () => {
      if (document.visibilityState !== "visible") return;
      runSilentSync();
      const token = await getAccessToken();
      if (token) await refreshFromServer(token);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [student, runSilentSync, refreshFromServer]);

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

      // v42 (v2): l058 — first bounty submitted. Raise the
      // celebration flag the moment the student marks it complete
      // (NOT when they uncheck). One-shot: don't re-fire if the
      // sprint is already marked finished. v46 — sprint flag now
      // lives on student_milestones.
      if (
        !isCompleted &&
        lessonId === "l058" &&
        !milestones?.sprint_completed_at
      ) {
        setFirstBountyJustSubmitted(true);
      }

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
          discord_message_link: null,
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
    [student, completedLessonIds, milestones]
  );

  /**
   * Compound-lesson "I shipped the ad" toggle. Sets/clears the
   * action_completed_at column on student_lesson_completions without
   * touching the watch state (which auto-syncs from Whop separately).
   */
  const toggleLessonAction = useCallback(
    async (lessonId: string) => {
      if (!student) return;

      // Run the optimistic update IMMEDIATELY before any awaits — the
      // earlier version awaited getAccessToken() first, which made the
      // button feel laggy ("glitch back to Shipped") because Supabase
      // session lookups can take 100-300ms on a cold tab.
      const isShipped = actionShippedLessonIds.has(lessonId);
      const optimisticTimestamp = isShipped ? null : new Date().toISOString();
      setCompletions((prev) => {
        const existing = prev.find((c) => c.lesson_id === lessonId);
        if (existing) {
          return prev.map((c) =>
            c.lesson_id === lessonId
              ? { ...c, action_completed_at: optimisticTimestamp }
              : c
          );
        }
        return [
          ...prev,
          {
            id: crypto.randomUUID(),
            student_id: student.id,
            lesson_id: lessonId,
            completed_at: null,
            action_completed_at: optimisticTimestamp,
            skipped_at: null,
            discord_message_link: null,
          },
        ];
      });

      const token = await getAccessToken();
      if (!token) return;

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

  /**
   * Save (or clear) the Discord message link the student pasted on an
   * action-item lesson sheet. Returns null on success, or an error
   * string on failure so the calling UI can surface it.
   */
  const saveDiscordLink = useCallback(
    async (lessonId: string, link: string | null): Promise<string | null> => {
      if (!student) return "Not signed in";
      const token = await getAccessToken();
      if (!token) return "Not signed in";

      const normalized = link && link.trim().length > 0 ? link.trim() : null;

      // Optimistic update
      setCompletions((prev) =>
        prev.map((c) =>
          c.lesson_id === lessonId
            ? { ...c, discord_message_link: normalized }
            : c,
        ),
      );

      const res = await fetch("/api/student/save-action-link", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ lessonId, link: normalized }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        // Revert by refetching to be safe.
        const dataRes = await fetch("/api/student/data", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (dataRes.ok) {
          const data = await dataRes.json();
          setCompletions(data.completions ?? []);
        }
        return typeof body.error === "string"
          ? body.error
          : `Save failed (${res.status})`;
      }

      const { completion } = await res.json();
      if (completion) {
        setCompletions((prev) =>
          prev.map((c) => (c.lesson_id === lessonId ? completion : c)),
        );
      }
      return null;
    },
    [student],
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
          discord_message_link: null,
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

  /**
   * v42 — l057 "Claim my Bounty spot" handler. Calls
   * /api/student/claim-bounty-access which atomically flips the
   * student's bounty_access_claimed_at and marks l057 complete.
   * On success, patches the local student row + adds l057 to the
   * completions list + raises the celebration takeover flag.
   */
  const claimBountyAccess = useCallback(async () => {
    if (!student || milestones?.bounty_access_claimed_at) return;

    const token = await getAccessToken();
    if (!token) return;

    const res = await fetch("/api/student/claim-bounty-access", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      console.error("Claim bounty access failed:", res.status);
      return;
    }
    const data = await res.json();
    if (!data.ok) return;

    // v46 — patch the milestones state so any UI reading
    // bountyAccessClaimedAt flips instantly.
    setMilestones((prev) => ({
      student_id: student.id,
      onboarding_completed_at: prev?.onboarding_completed_at ?? null,
      first_sprint_login_at: prev?.first_sprint_login_at ?? null,
      sprint_completed_at: prev?.sprint_completed_at ?? null,
      first_client_landed_at: prev?.first_client_landed_at ?? null,
      playbook_welcome_seen_at: prev?.playbook_welcome_seen_at ?? null,
      bounty_access_claimed_at: data.bounty_access_claimed_at,
      updated_at: data.bounty_access_claimed_at,
    }));
    // Add l057 to completions if it's not there yet — the API
    // upserts the row server-side; mirror it client-side so the
    // map node + sheet flip without waiting for a refetch.
    setCompletions((prev) => {
      if (prev.some((c) => c.lesson_id === "l057")) return prev;
      return [
        ...prev,
        {
          id: `local-l057-${student.id}`,
          student_id: student.id,
          lesson_id: "l057",
          completed_at: data.bounty_access_claimed_at,
          action_completed_at: null,
          skipped_at: null,
          discord_message_link: null,
        } as StudentLessonCompletion,
      ];
    });
    // Fire the celebration unless this was a duplicate click.
    if (!data.already_claimed) setBountyAccessJustClaimed(true);
  }, [student, milestones]);

  const dismissBountyClaim = useCallback(() => {
    setBountyAccessJustClaimed(false);
  }, []);

  /**
   * v42 — l058 "Finish Program" handler. Calls
   * /api/student/finish-program which sets sprint_completed_at on
   * the student row (with NULL guard). Patches the local student
   * row so the LessonSheet swap + the eventual Map 2 redirect see
   * the new state immediately.
   */
  const finishProgram = useCallback(async () => {
    if (!student || milestones?.sprint_completed_at) return;

    const token = await getAccessToken();
    if (!token) return;

    const res = await fetch("/api/student/finish-program", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      console.error("Finish program failed:", res.status);
      return;
    }
    const data = await res.json();
    if (!data.ok) return;

    setMilestones((prev) => ({
      student_id: student.id,
      onboarding_completed_at: prev?.onboarding_completed_at ?? null,
      first_sprint_login_at: prev?.first_sprint_login_at ?? null,
      bounty_access_claimed_at: prev?.bounty_access_claimed_at ?? null,
      first_client_landed_at: prev?.first_client_landed_at ?? null,
      playbook_welcome_seen_at: prev?.playbook_welcome_seen_at ?? null,
      sprint_completed_at: data.sprint_completed_at,
      updated_at: data.sprint_completed_at,
    }));
  }, [student, milestones]);

  const dismissFirstBountyCelebration = useCallback(() => {
    setFirstBountyJustSubmitted(false);
  }, []);

  /**
   * v42 — "I just landed my first client" handler. Single
   * self-report on Map 2's milestone node sheet. POST flips
   * students.first_client_landed_at; on a fresh land (not a
   * duplicate), raises the crowned-celebration flag.
   */
  const markFirstClient = useCallback(async () => {
    if (!student || milestones?.first_client_landed_at) return;
    const token = await getAccessToken();
    if (!token) return;

    const res = await fetch("/api/student/mark-first-client", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      console.error("Mark first client failed:", res.status);
      return;
    }
    const data = await res.json();
    if (!data.ok) return;

    setMilestones((prev) => ({
      student_id: student.id,
      onboarding_completed_at: prev?.onboarding_completed_at ?? null,
      first_sprint_login_at: prev?.first_sprint_login_at ?? null,
      bounty_access_claimed_at: prev?.bounty_access_claimed_at ?? null,
      sprint_completed_at: prev?.sprint_completed_at ?? null,
      playbook_welcome_seen_at: prev?.playbook_welcome_seen_at ?? null,
      first_client_landed_at: data.first_client_landed_at,
      updated_at: data.first_client_landed_at,
    }));
    if (!data.already_landed) setFirstClientJustLanded(true);
  }, [student, milestones]);

  const dismissFirstClientCelebration = useCallback(() => {
    setFirstClientJustLanded(false);
  }, []);

  /**
   * v42 — one-shot dismiss for the Map 2 welcome overlay. Sets
   * students.playbook_welcome_seen_at and patches the local row.
   */
  const dismissPlaybookWelcome = useCallback(async () => {
    if (!student || milestones?.playbook_welcome_seen_at) return;
    const token = await getAccessToken();
    if (!token) return;

    const res = await fetch("/api/student/dismiss-playbook-welcome", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    const data = await res.json();
    if (!data.ok) return;

    setMilestones((prev) => ({
      student_id: student.id,
      onboarding_completed_at: prev?.onboarding_completed_at ?? null,
      first_sprint_login_at: prev?.first_sprint_login_at ?? null,
      bounty_access_claimed_at: prev?.bounty_access_claimed_at ?? null,
      sprint_completed_at: prev?.sprint_completed_at ?? null,
      first_client_landed_at: prev?.first_client_landed_at ?? null,
      playbook_welcome_seen_at: data.playbook_welcome_seen_at,
      updated_at: data.playbook_welcome_seen_at,
    }));
  }, [student, milestones]);

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
      } else {
        const data = await res.json().catch(() => ({}));
        const msg = data?.error || `Request failed (HTTP ${res.status})`;
        console.error("Discount request rejected:", msg);
        if (typeof window !== "undefined") {
          window.alert(`Couldn't submit your discount application:\n\n${msg}`);
        }
      }
    } catch (err) {
      console.error("Failed to request discount:", err);
      if (typeof window !== "undefined") {
        window.alert(
          "Couldn't reach our servers to submit your discount application. Try again in a moment."
        );
      }
    }
  }, [student, discountEligible]);

  const openDiscountFeedback = useCallback(() => {
    setDiscountFeedbackOpen(true);
  }, []);
  const closeDiscountFeedback = useCallback(() => {
    setDiscountFeedbackOpen(false);
  }, []);

  /**
   * Atomic discount-request + feedback responses submit. Closes the
   * modal + refreshes student data on success. Returns null on success,
   * or a user-facing error string on failure.
   */
  const submitDiscountFeedback = useCallback(
    async (answers: DiscountFeedbackAnswer[]): Promise<string | null> => {
      if (!student) return "Not signed in";

      try {
        const res = await fetch("/api/discounts/submit-feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            studentId: student.id,
            answers,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          return data?.error || `Submit failed (HTTP ${res.status})`;
        }

        // Refetch the discount_request row so the dashboard widget
        // flips into the "pending review" state.
        const sb = createClient();
        const { data: fresh } = await sb
          .from("discount_requests")
          .select("*")
          .eq("student_id", student.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .single();
        if (fresh) setDiscountRequest(fresh as DiscountRequest);

        setDiscountFeedbackOpen(false);
        return null;
      } catch (err) {
        return err instanceof Error ? err.message : "Network error";
      }
    },
    [student],
  );

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
        saveDiscordLink,
        skipLesson,
        discountFeedbackQuestions,
        discountFeedbackOpen,
        openDiscountFeedback,
        closeDiscountFeedback,
        submitDiscountFeedback,
        submitQuiz,
        requestDiscount,
        // v46 — sprint milestones now read from student_milestones,
        // not the students row. Same public field names so consumers
        // don't change.
        bountyAccessClaimedAt: milestones?.bounty_access_claimed_at ?? null,
        bountyAccessJustClaimed,
        claimBountyAccess,
        dismissBountyClaim,
        sprintCompletedAt: milestones?.sprint_completed_at ?? null,
        firstBountyJustSubmitted,
        finishProgram,
        dismissFirstBountyCelebration,
        playbookWelcomeSeenAt: milestones?.playbook_welcome_seen_at ?? null,
        dismissPlaybookWelcome,
        firstClientLandedAt: milestones?.first_client_landed_at ?? null,
        firstClientJustLanded,
        markFirstClient,
        dismissFirstClientCelebration,
        onboardingCompletedAt: milestones?.onboarding_completed_at ?? null,
        celebrations,
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

