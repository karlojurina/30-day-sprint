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
  StudentRegionQuiz,
  RegionId,
} from "@/types/database";
import { getTitleForRegions } from "@/lib/titles";
import {
  DISCOUNT_WINDOW_DAYS,
  SPRINT_EXCLUDED_LESSON_IDS,
  progressPercent,
} from "@/lib/constants";
import { isLessonComplete } from "@/lib/progress";

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
  /** Lessons that count toward the sprint (lessons minus
   *  SPRINT_EXCLUDED_LESSON_IDS — currently just l057 bounty
   *  onboarding). Use this for any "X / Y lessons completed"
   *  display so the denominator matches Karlo's 64-lesson sprint
   *  definition. */
  sprintLessons: Lesson[];
  /** Number of *sprint* lessons the student has completed (excludes
   *  the SPRINT_EXCLUDED set). */
  sprintCompletedCount: number;
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

  // v50.5 — Bounty Access state. Stamped exclusively by Zak's
  // /api/webhooks/adbounty (no self-claim, no admin self-stamp).
  // v72.8 - claim celebration removed; no in-app celebration on the
  // null→set transition anymore.
  bountyAccessClaimedAt: string | null;

  // v50 — Bounty Access (l057) is the finish line. The old "Finish
  // Program" flow on l058 is gone; l058-l063 don't exist as lessons
  // anymore (their concepts moved into the Playbook). bountyAccess-
  // ClaimedAt above is now the single signal that unlocks Map 2.

  // v42 (v2): one-time Map 2 welcome overlay. playbookWelcomeSeenAt
  // is the stamp; if null the overlay shows on first visit. Action
  // sets the stamp so it doesn't re-fire on the next load.
  playbookWelcomeSeenAt: string | null;
  dismissPlaybookWelcome: () => Promise<void>;

  // v46 — onboarding milestone + celebration state, sourced from
  // student_milestones / student_celebrations respectively.
  onboardingCompletedAt: string | null;
  celebrations: StudentCelebrations | null;

  // v54 (brief-region-quiz) — per-region quiz gate. Keyed by
  // region id; each region's row is independent. quiz_passed_at
  // null = never scored 50%+. v65 - Onward stays locked until best
  // score >= 50%; retakes always allowed. Score fields drive the
  // region card's "Best: 78%" badge + retake CTA copy.
  regionQuiz: Record<RegionId, StudentRegionQuiz | null>;
  /** v65 - submits one completed attempt. Increments quiz_attempts,
   *  updates last/best scores, stamps quiz_passed_at on the first
   *  attempt scoring >= 50%. Returns whether the OVERALL pass state
   *  (best ever >= 50%) is now true. */
  submitRegionQuiz: (
    regionId: RegionId,
    scorePct: number,
  ) => Promise<{ passed: boolean; bestScorePct: number } | null>;

  // v75 - per-lesson rating + optional comment. Map keyed by
  // lesson id. Read-mostly; the LessonSheet writes via rateLesson()
  // once the student is done with the lesson.
  lessonRatings: Map<string, { stars: number; comment: string | null }>;
  /** Upsert a rating for a lesson. Optimistic; server reconciles
   *  in the background. */
  rateLesson: (
    lessonId: string,
    stars: number,
    comment: string | null,
  ) => Promise<void>;

  // v51 (Phase 2, brief v3) — intro video gate + WYH panel state.
  // The 3 flags below drive the first-login chain on /dashboard.
  // markDashboardLogin() fires on first /dashboard load to stamp
  // first_dashboard_login_at. markIntroVideoThreshold() fires when
  // watch progress crosses ~65%. dismissWhyYoureHere() fires when
  // the student clicks Let's go on the final WYH card.
  firstDashboardLoginAt: string | null;
  introVideoThresholdMet: boolean;
  whyYoureHerePanelDismissed: boolean;
  markDashboardLogin: () => Promise<void>;
  markIntroVideoThreshold: () => Promise<void>;
  dismissWhyYoureHere: () => Promise<void>;

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
  // v54 (brief-region-quiz) - per-region quiz state, fetched as a
  // small array and folded into a Map for O(1) per-region lookup.
  const [regionQuizMap, setRegionQuizMap] = useState<
    Record<RegionId, StudentRegionQuiz | null>
  >({ r1: null, r2: null, r3: null, r4: null });

  // v75 - per-lesson rating map. Keyed by lesson_id.
  const [lessonRatings, setLessonRatings] = useState<
    Map<string, { stars: number; comment: string | null }>
  >(new Map());

  function foldLessonRatings(
    rows: Array<{ lesson_id: string; stars: number; comment: string | null }>,
  ): Map<string, { stars: number; comment: string | null }> {
    const out = new Map<string, { stars: number; comment: string | null }>();
    for (const r of rows) {
      out.set(r.lesson_id, { stars: r.stars, comment: r.comment ?? null });
    }
    return out;
  }

  function foldRegionQuiz(
    rows: Array<{
      region_id: string;
      quiz_passed_at: string | null;
      quiz_attempts: number;
      best_score_pct: number | null;
      last_score_pct: number | null;
      last_attempt_at: string | null;
    }> | null,
    studentId: string | undefined,
  ): Record<RegionId, StudentRegionQuiz | null> {
    const out: Record<RegionId, StudentRegionQuiz | null> = {
      r1: null,
      r2: null,
      r3: null,
      r4: null,
    };
    if (!rows || !studentId) return out;
    for (const r of rows) {
      if (r.region_id === "r1" || r.region_id === "r2" || r.region_id === "r3" || r.region_id === "r4") {
        out[r.region_id] = {
          student_id: studentId,
          region_id: r.region_id,
          quiz_passed_at: r.quiz_passed_at,
          quiz_attempts: r.quiz_attempts,
          best_score_pct: r.best_score_pct,
          last_score_pct: r.last_score_pct,
          last_attempt_at: r.last_attempt_at,
        };
      }
    }
    return out;
  }
  // student_streaks data folds into the existing `streak` state below
  // (the public shape stays { current, longest } for consumers).
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

  // v74 - track which lesson completions were just touched locally
  // (via toggleLesson / toggleLessonAction / skipLesson). When
  // refreshFromServer fires soon after, it preserves the LOCAL row
  // for any lesson in this window instead of overwriting with the
  // server's possibly-not-yet-replicated state. Fixes the "ship ->
  // unship -> ship -> unship" flicker Karlo saw on action items
  // (Supabase read-replica lag racing the post-write refresh).
  const recentlyToggledRef = useRef<Map<string, number>>(new Map());
  const RECENT_TOGGLE_WINDOW_MS = 3000;
  function markRecentlyToggled(lessonId: string) {
    const now = Date.now();
    recentlyToggledRef.current.set(lessonId, now);
    // Lazy cleanup expired entries each time we mark a new one.
    for (const [id, ts] of recentlyToggledRef.current.entries()) {
      if (now - ts > RECENT_TOGGLE_WINDOW_MS) {
        recentlyToggledRef.current.delete(id);
      }
    }
  }

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
        setRegionQuizMap(
          foldRegionQuiz(
            data.regionQuiz as Array<{
              region_id: string;
              quiz_passed_at: string | null;
              quiz_attempts: number;
              best_score_pct: number | null;
              last_score_pct: number | null;
              last_attempt_at: string | null;
            }> | null,
            student?.id,
          ),
        );
        setLessonRatings(
          foldLessonRatings(
            (data.lessonRatings ?? []) as Array<{
              lesson_id: string;
              stars: number;
              comment: string | null;
            }>,
          ),
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
    // v74 - merge instead of replace: any lesson the user just touched
    // (within RECENT_TOGGLE_WINDOW_MS) keeps its LOCAL completion row
    // so a stale read-replica response can't undo their action.
    const freshCompletions = (fresh.completions ?? []) as StudentLessonCompletion[];
    const now = Date.now();
    for (const [id, ts] of recentlyToggledRef.current.entries()) {
      if (now - ts > RECENT_TOGGLE_WINDOW_MS) {
        recentlyToggledRef.current.delete(id);
      }
    }
    if (recentlyToggledRef.current.size === 0) {
      setCompletions(freshCompletions);
    } else {
      const recent = recentlyToggledRef.current;
      setCompletions((prev) => {
        const result: StudentLessonCompletion[] = [];
        const seen = new Set<string>();
        for (const f of freshCompletions) {
          seen.add(f.lesson_id);
          if (recent.has(f.lesson_id)) {
            const local = prev.find((p) => p.lesson_id === f.lesson_id);
            if (local) {
              result.push(local);
              continue;
            }
          }
          result.push(f);
        }
        // Preserve optimistic local rows not yet visible on the server.
        for (const p of prev) {
          if (!seen.has(p.lesson_id) && recent.has(p.lesson_id)) {
            result.push(p);
          }
        }
        return result;
      });
    }
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
    setRegionQuizMap(
      foldRegionQuiz(
        fresh.regionQuiz as Array<{
          region_id: string;
          quiz_passed_at: string | null;
          quiz_attempts: number;
          best_score_pct: number | null;
          last_score_pct: number | null;
          last_attempt_at: string | null;
        }> | null,
        fresh.student?.id,
      ),
    );
    setLessonRatings(
      foldLessonRatings(
        (fresh.lessonRatings ?? []) as Array<{
          lesson_id: string;
          stars: number;
          comment: string | null;
        }>,
      ),
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

  // Canonical "lesson is complete" check lives in src/lib/progress.ts
  // — same formula the student_progress_counts view encodes in SQL and
  // the admin kanban / students-list use, so every surface agrees.
  const completedLessonIds = useMemo(() => {
    const s = new Set<string>();
    for (const c of completions) {
      if (isLessonComplete(c, lessonsById.get(c.lesson_id))) {
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
    // count - exclude SPRINT_EXCLUDED_LESSON_IDS (currently just
    // l057 bounty onboarding). See src/lib/constants.ts.
    for (const lesson of lessons) {
      if (!progress[lesson.region_id]) continue;
      if (SPRINT_EXCLUDED_LESSON_IDS.has(lesson.id)) continue;
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
    // Sequential unlock: R1 always open; every later region requires
    // BOTH the previous region's lessons to be 100% complete AND its
    // region quiz passed. v74 - the quiz-pass requirement was missing,
    // so a student could finish R2 lessons and walk straight into R3
    // without ever taking the quiz (Karlo's bug report 2026-05-29).
    const sortedRegions = [...regions].sort((a, b) => a.order_num - b.order_num);
    for (let i = 0; i < sortedRegions.length; i++) {
      const r = sortedRegions[i];
      if (i === 0) {
        progress[r.id].isUnlocked = true;
      } else {
        const prev = sortedRegions[i - 1];
        const prevComplete = progress[prev.id]?.isComplete ?? false;
        const prevQuizPassed =
          regionQuizMap[prev.id as RegionId]?.quiz_passed_at != null;
        progress[r.id].isUnlocked = prevComplete && prevQuizPassed;
      }
    }
    return progress;
  }, [regions, lessons, completedLessonIds, regionQuizMap]);

  // v75.1 - "sprint" view of lessons excludes SPRINT_EXCLUDED_LESSON_IDS
  // (currently just l057 bounty onboarding). Every X/Y display the
  // student sees should use these instead of the raw lessons array
  // so the denominator matches the 64-lesson sprint definition.
  const sprintLessons = useMemo(
    () => lessons.filter((l) => !SPRINT_EXCLUDED_LESSON_IDS.has(l.id)),
    [lessons],
  );
  const sprintCompletedCount = useMemo(
    () =>
      sprintLessons.filter((l) => completedLessonIds.has(l.id)).length,
    [sprintLessons, completedLessonIds],
  );

  const overallProgress = useMemo(() => {
    return progressPercent(sprintCompletedCount, sprintLessons.length);
  }, [sprintLessons, sprintCompletedCount]);

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

  // v72.4 - the previous useMemo with Date.now() inside violated
  // React 19's react-hooks/purity rule. Now backed by a state that
  // ticks every minute via setInterval - the component body becomes
  // deterministic (a pure function of `student` and `nowMs`) and the
  // value still updates as time passes. 60s cadence is fine for the
  // only consumers: discountEligible (boolean threshold check) and
  // DiscountCountdown (which has its own 60s tick).
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // v75.18: anchor on first_paid_at (original signup), not joined_at
  // (current cycle start). Returning customers don't get a fresh
  // 14-day discount window from a renewal.
  const discountMsLeft = student
    ? new Date(student.first_paid_at ?? student.joined_at).getTime() +
      DISCOUNT_WINDOW_DAYS * 86_400_000 -
      nowMs
    : 0;

  const discountEligible = discountAllLessonsDone && discountMsLeft > 0;

  // Actions

  const toggleLesson = useCallback(
    async (lessonId: string) => {
      if (!student) return;
      const token = await getAccessToken();
      if (!token) return;

      const isCompleted = completedLessonIds.has(lessonId);

      // v74 - mark so a racing refreshFromServer doesn't undo this.
      markRecentlyToggled(lessonId);

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
          // v50.4 — refresh streak (+ everything else from
          // /api/student/data) so streak.current bumps on the client
          // when the server-side updateStudentStreak() ticks it. The
          // dashboard's StreakCelebration effect only fires on
          // `streak.current` changing — without this refetch the
          // streak stayed stale until a hard reload, so the
          // celebration never fired in real use. Best-effort: failure
          // doesn't roll back the toggle.
          void refreshFromServer(token);
          // v53 (Phase 5) - signal AchievementsButton to re-poll the
          // unlocks (server-side evaluator runs inside the route, so
          // the row may already exist).
          if (typeof window !== "undefined")
            window.dispatchEvent(new Event("et:achievements-changed"));
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
    [student, completedLessonIds, milestones, refreshFromServer]
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
      markRecentlyToggled(lessonId);
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
          // v50.4 — mark-action-shipped also calls updateStudentStreak
          // server-side. Refresh so streak.current bumps on the client
          // and the dashboard's celebration effect picks it up.
          void refreshFromServer(token);
          // v53 (Phase 5) - signal AchievementsButton to re-poll.
          if (typeof window !== "undefined")
            window.dispatchEvent(new Event("et:achievements-changed"));
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
    [student, actionShippedLessonIds, refreshFromServer]
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

      markRecentlyToggled(lessonId);

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
      // v50.4 — submit-quiz also ticks the streak server-side. Refresh
      // so the dashboard's celebration effect can fire.
      void refreshFromServer(token);
      // v53 (Phase 5) - signal AchievementsButton to re-poll.
      if (typeof window !== "undefined")
        window.dispatchEvent(new Event("et:achievements-changed"));
      return {
        score: data.score,
        total: data.total,
        passed: data.passed,
        answers: data.answers,
      };
    },
    [refreshFromServer]
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

  // v50.5 - claimBountyAccess removed. Bounty Access is no longer
  // self-claimable from l057; students apply via Tally form and the
  // webhook (/api/webhooks/adbounty) is the SOLE source of
  // bounty_access_claimed_at now. The old /api/student/claim-
  // bounty-access route is gone too.

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
      first_dashboard_login_at: prev?.first_dashboard_login_at ?? null,
      intro_video_threshold_met: prev?.intro_video_threshold_met ?? false,
      why_youre_here_panel_dismissed: prev?.why_youre_here_panel_dismissed ?? false,
      bounty_access_claimed_at: prev?.bounty_access_claimed_at ?? null,
      first_client_landed_at: prev?.first_client_landed_at ?? null,
      playbook_welcome_seen_at: data.playbook_welcome_seen_at,
      updated_at: data.playbook_welcome_seen_at,
    }));
  }, [student, milestones]);

  // v51 (Phase 2) — intro video gate + WYH panel persistence. All
  // three patch the local milestones row optimistically so the UI
  // can transition immediately; on API failure the next
  // refreshFromServer reconciles.
  const patchMilestoneFlag = useCallback(
    (
      partial: Partial<
        Pick<
          StudentMilestones,
          | "first_dashboard_login_at"
          | "intro_video_threshold_met"
          | "why_youre_here_panel_dismissed"
        >
      >,
    ) => {
      setMilestones((prev) => ({
        student_id: prev?.student_id ?? student?.id ?? "",
        onboarding_completed_at: prev?.onboarding_completed_at ?? null,
        first_sprint_login_at: prev?.first_sprint_login_at ?? null,
        first_dashboard_login_at:
          partial.first_dashboard_login_at !== undefined
            ? partial.first_dashboard_login_at
            : prev?.first_dashboard_login_at ?? null,
        intro_video_threshold_met:
          partial.intro_video_threshold_met !== undefined
            ? partial.intro_video_threshold_met
            : prev?.intro_video_threshold_met ?? false,
        why_youre_here_panel_dismissed:
          partial.why_youre_here_panel_dismissed !== undefined
            ? partial.why_youre_here_panel_dismissed
            : prev?.why_youre_here_panel_dismissed ?? false,
        bounty_access_claimed_at: prev?.bounty_access_claimed_at ?? null,
        first_client_landed_at: prev?.first_client_landed_at ?? null,
        playbook_welcome_seen_at: prev?.playbook_welcome_seen_at ?? null,
        updated_at: new Date().toISOString(),
      }));
    },
    [student],
  );

  const markDashboardLogin = useCallback(async () => {
    if (!student || milestones?.first_dashboard_login_at) return;
    const token = await getAccessToken();
    if (!token) return;
    patchMilestoneFlag({ first_dashboard_login_at: new Date().toISOString() });
    await fetch("/api/student/mark-dashboard-login", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
  }, [student, milestones, patchMilestoneFlag]);

  const markIntroVideoThreshold = useCallback(async () => {
    if (!student || milestones?.intro_video_threshold_met) return;
    const token = await getAccessToken();
    if (!token) return;
    patchMilestoneFlag({ intro_video_threshold_met: true });
    await fetch("/api/student/mark-intro-video-threshold", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
  }, [student, milestones, patchMilestoneFlag]);

  const dismissWhyYoureHere = useCallback(async () => {
    if (!student || milestones?.why_youre_here_panel_dismissed) return;
    const token = await getAccessToken();
    if (!token) return;
    patchMilestoneFlag({ why_youre_here_panel_dismissed: true });
    await fetch("/api/student/dismiss-why-youre-here", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
  }, [student, milestones, patchMilestoneFlag]);

  // v65 - single mutator replaces the v54 mark + attempts split.
  // v74 - server call is now fire-and-forget so the ResultScreen
  // flips instantly. Before: awaiting the API took ~1.5-2s on
  // production (Supabase round-trip + insert) which Karlo noticed
  // as "two seconds of nothing after I finish the quiz." Now we
  // return the optimistic pass/score immediately and the server
  // reconciliation runs in the background.
  const submitRegionQuiz = useCallback(
    async (regionId: RegionId, scorePct: number) => {
      if (!student) return null;
      const existing = regionQuizMap[regionId];
      const scoreInt = Math.max(0, Math.min(100, Math.round(scorePct)));
      const now = new Date().toISOString();
      const optimisticBest = Math.max(scoreInt, existing?.best_score_pct ?? 0);
      const optimisticAttempts = (existing?.quiz_attempts ?? 0) + 1;
      const optimisticPassedAt =
        existing?.quiz_passed_at ?? (scoreInt >= 50 ? now : null);

      setRegionQuizMap((prev) => ({
        ...prev,
        [regionId]: {
          student_id: student.id,
          region_id: regionId,
          quiz_passed_at: optimisticPassedAt,
          quiz_attempts: optimisticAttempts,
          best_score_pct: optimisticBest,
          last_score_pct: scoreInt,
          last_attempt_at: now,
        },
      }));

      // Fire-and-forget server reconciliation. Result screen has
      // already flipped from the optimistic update above.
      void (async () => {
        const token = await getAccessToken();
        if (!token) return;
        try {
          const res = await fetch("/api/student/submit-region-quiz", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ regionId, scorePct: scoreInt }),
          });
          if (!res.ok) return;
          const data = (await res.json()) as {
            passed: boolean;
            best_score_pct: number;
            last_score_pct: number;
            quiz_attempts: number;
            quiz_passed_at: string | null;
          };
          setRegionQuizMap((prev) => ({
            ...prev,
            [regionId]: {
              student_id: student.id,
              region_id: regionId,
              quiz_passed_at: data.quiz_passed_at,
              quiz_attempts: data.quiz_attempts,
              best_score_pct: data.best_score_pct,
              last_score_pct: data.last_score_pct,
              last_attempt_at: now,
            },
          }));
          if (typeof window !== "undefined")
            window.dispatchEvent(new Event("et:achievements-changed"));
        } catch {
          // Server reconciliation failed; optimistic state stays.
        }
      })();

      return { passed: optimisticBest >= 50, bestScorePct: optimisticBest };
    },
    [student, regionQuizMap],
  );

  // v75 - upsert a lesson rating. Optimistic - the map flips
  // immediately so the LessonSheet UI shows the chosen stars + saved
  // comment without waiting on the round-trip. Server reconciliation
  // runs in the background.
  const rateLesson = useCallback(
    async (lessonId: string, stars: number, comment: string | null) => {
      if (!student) return;
      const cleanedStars = Math.max(1, Math.min(5, Math.round(stars)));
      const cleanedComment =
        typeof comment === "string" && comment.trim().length > 0
          ? comment.trim().slice(0, 2000)
          : null;
      setLessonRatings((prev) => {
        const next = new Map(prev);
        next.set(lessonId, { stars: cleanedStars, comment: cleanedComment });
        return next;
      });
      void (async () => {
        const token = await getAccessToken();
        if (!token) return;
        try {
          await fetch("/api/student/rate-lesson", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              lessonId,
              stars: cleanedStars,
              comment: cleanedComment,
            }),
          });
        } catch {
          // Optimistic state persists; next refreshFromServer will
          // reconcile if the server diverged.
        }
      })();
    },
    [student],
  );

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
        sprintLessons,
        sprintCompletedCount,
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
        playbookWelcomeSeenAt: milestones?.playbook_welcome_seen_at ?? null,
        dismissPlaybookWelcome,
        onboardingCompletedAt: milestones?.onboarding_completed_at ?? null,
        celebrations,
        firstDashboardLoginAt: milestones?.first_dashboard_login_at ?? null,
        introVideoThresholdMet: milestones?.intro_video_threshold_met ?? false,
        whyYoureHerePanelDismissed:
          milestones?.why_youre_here_panel_dismissed ?? false,
        markDashboardLogin,
        markIntroVideoThreshold,
        dismissWhyYoureHere,
        regionQuiz: regionQuizMap,
        submitRegionQuiz,
        lessonRatings,
        rateLesson,
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

