"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useStudent } from "@/contexts/StudentContext";
import { LessonSheet } from "@/components/map/LessonSheet";
import { MapMockup } from "@/components/mockup/MapMockup";
import { LessonCompleteEffects } from "@/components/map/LessonCompleteEffects";
import { StreakCelebration } from "@/components/map/StreakCelebration";
import { DiscountApprovedCelebration } from "@/components/map/DiscountApprovedCelebration";
import { DiscountFeedbackModal } from "@/components/map/DiscountFeedbackModal";
import { GraduationModal } from "@/components/map/GraduationModal";
import { DevTestPanel } from "@/components/dev/DevTestPanel";
import { IntroVideoGate } from "@/components/onboarding/IntroVideoGate";
import { WhyYoureHerePanel } from "@/components/onboarding/WhyYoureHerePanel";
import { PLAYBOOK_UNLOCK_LESSON_ID } from "@/lib/constants";

interface MockMonthReview {
  total_lessons_completed: number;
  total_lessons: number;
  longest_streak: number;
  ad_submissions: number;
  discount_earned: boolean;
  notes_count: number;
  days_to_finish: number | null;
}

const DISCOUNT_APPROVED_LAST_SEEN_KEY = "et.discountApproved.lastSeen";

const STREAK_LAST_SEEN_KEY = "et.streak.lastSeen";

export default function DashboardPage() {
  const { student } = useAuth();
  const {
    loading,
    streak,
    discountRequest,
    completedLessonIds,
    firstDashboardLoginAt,
    introVideoThresholdMet,
    whyYoureHerePanelDismissed,
    markDashboardLogin,
    markIntroVideoThreshold,
    dismissWhyYoureHere,
  } = useStudent();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Conditional default surface. Students who have completed l078
  // (the Playbook-unlock lesson - see PLAYBOOK_UNLOCK_LESSON_ID in
  // src/lib/constants.ts) land on Map 2 (the Playbook) by default.
  // The ?map=1 query param overrides - used by "Back to the climb"
  // on Map 2 so the student can return to the original map.
  // v72.7 - was bountyAccessClaimedAt; corrected because bounty is a
  // separate milestone that does NOT unlock the Playbook.
  const playbookUnlocked = completedLessonIds.has(PLAYBOOK_UNLOCK_LESSON_ID);
  const forceMap1 = searchParams.get("map") === "1";
  useEffect(() => {
    if (!loading && playbookUnlocked && !forceMap1) {
      router.replace("/dashboard/playbook");
    }
  }, [loading, playbookUnlocked, forceMap1, router]);

  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null);
  const [streakCelebration, setStreakCelebration] = useState<number | null>(null);

  // v51 (Phase 2) - first-login chain. v72.6 split: intro and WYH
  // are now SEPARATE sessions to avoid dumping everything on the
  // student at once.
  //   1. Stamp first_dashboard_login_at the first time we're here
  //   2. Session N (first visit): IntroVideoGate. Student must watch
  //      the full video, then click Continue manually. Server stamps
  //      intro_video_threshold_met. Student lands on the map and can
  //      start using it immediately. No WYH this session.
  //   3. Session N+1+ (next visit): WYH panel auto-mounts. Student
  //      dismisses → why_youre_here_panel_dismissed. Stays dormant.
  //   4. WYH re-access button stays (separate ask); intro rewatch
  //      removed (v72.6 - once watched, never shown again).
  const [wyhRewatch, setWyhRewatch] = useState(false);
  // True after the student clicks Continue on the intro gate THIS
  // session. Drives two things: (a) hides the gate immediately, (b)
  // suppresses WYH until the next session so we don't auto-mount
  // it the moment the student lands on the map.
  const [introCompletedThisSession, setIntroCompletedThisSession] =
    useState(false);

  useEffect(() => {
    if (loading || !student) return;
    if (!firstDashboardLoginAt) void markDashboardLogin();
  }, [loading, student, firstDashboardLoginAt, markDashboardLogin]);

  const showIntroGate =
    !!student &&
    !loading &&
    !introVideoThresholdMet &&
    !introCompletedThisSession;
  // WYH fires only on a SECOND-or-later session: the DB sticky is set
  // (so they watched the intro at some point in the past) AND we
  // didn't just finish the intro in this same session.
  const showWyh =
    !!student &&
    !loading &&
    introVideoThresholdMet &&
    !introCompletedThisSession &&
    !whyYoureHerePanelDismissed;
  const [discountCelebration, setDiscountCelebration] = useState<boolean>(false);
  const [graduationReview, setGraduationReview] = useState<MockMonthReview | null>(null);

  // Fire the discount-approved celebration ONCE per approval. The
  // student never sees a promo code — the team applies it directly
  // in Whop — so we track approvals by request id. Reload doesn't
  // refire because we record the celebrated id in localStorage.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (loading) return;
    if (discountRequest?.status !== "approved") return;
    const id = discountRequest.id;
    if (!id) return;

    const lastSeen = window.localStorage.getItem(
      DISCOUNT_APPROVED_LAST_SEEN_KEY,
    );
    if (lastSeen === id) return;

    setDiscountCelebration(true);
    window.localStorage.setItem(DISCOUNT_APPROVED_LAST_SEEN_KEY, id);
  }, [discountRequest?.status, discountRequest?.id, loading]);

  // Detect streak increment vs the last value we already celebrated
  // (stored in localStorage). Fire whenever the SERVER says the
  // streak is higher than what we last celebrated — covers all the
  // cases:
  //   - Student completes a lesson on the site (toggleLesson refreshes
  //     student data → streak.current bumps → fires)
  //   - Student watches on Whop, then returns to the site (silent
  //     watch-sync on visibility → streak.current bumps → fires)
  //   - Student opens app on a new device with a streak earned
  //     elsewhere (lastSeen=0 in localStorage, streak.current>0,
  //     fires once and records)
  // The localStorage key is what we LAST CELEBRATED, not what we
  // last saw — so reload doesn't refire (current==lastSeen → skip).
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (loading) return;
    if (streak.current <= 0) return;

    const lastSeenRaw = window.localStorage.getItem(STREAK_LAST_SEEN_KEY);
    const lastSeen = lastSeenRaw ? parseInt(lastSeenRaw, 10) : 0;
    if (Number.isNaN(lastSeen)) return;

    if (streak.current > lastSeen) {
      setStreakCelebration(streak.current);
      window.localStorage.setItem(STREAK_LAST_SEEN_KEY, String(streak.current));
    }
  }, [streak.current, loading]);

  // Dev test panel listener — manually fire the streak celebration
  // with any value (no API call, no streak mutation).
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<number>;
      if (typeof ce.detail === "number") setStreakCelebration(ce.detail);
    };
    window.addEventListener("et:test:streak", handler);
    return () => window.removeEventListener("et:test:streak", handler);
  }, []);

  // Dev test panel listener — manually fire the discount-approved
  // celebration (no API call).
  useEffect(() => {
    const handler = () => setDiscountCelebration(true);
    window.addEventListener("et:test:discount-approved", handler);
    return () =>
      window.removeEventListener("et:test:discount-approved", handler);
  }, []);

  // Dev test panel listener — manually fire the graduation modal with a
  // mock month-review payload. Auto-fire on real completion still TODO
  // (needs a backend job to write the month_reviews row when a student
  // hits 100% — without that the GraduationModal stays hidden because
  // it requires monthReview to be non-null).
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<MockMonthReview>;
      if (ce.detail) setGraduationReview(ce.detail);
    };
    window.addEventListener("et:test:graduation", handler);
    return () => window.removeEventListener("et:test:graduation", handler);
  }, []);

  if (loading || !student) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center justify-center min-h-screen"
        style={{ background: "var(--color-bg-primary)" }}
      >
        <div
          aria-hidden="true"
          className="w-8 h-8 rounded-full animate-spin"
          style={{
            border: "2px solid var(--color-gold)",
            borderTopColor: "transparent",
          }}
        />
        <span className="sr-only">Loading your map…</span>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col w-screen overflow-hidden"
      style={{ height: "100vh", background: "var(--color-bg-primary)" }}
    >
      <div className="relative flex-1 min-h-0">
        <MapMockup onOpenLesson={(id) => setSelectedLessonId(id)} />
        <LessonCompleteEffects />
      </div>

      <LessonSheet
        lessonId={selectedLessonId}
        onClose={() => setSelectedLessonId(null)}
        onSelectLesson={(id) => setSelectedLessonId(id)}
      />

      <StreakCelebration
        streak={streakCelebration}
        onDismiss={() => setStreakCelebration(null)}
      />

      <DiscountApprovedCelebration
        show={discountCelebration}
        onDismiss={() => setDiscountCelebration(false)}
      />

      <DiscountFeedbackModal />

      <GraduationModal
        open={graduationReview != null}
        studentName={student.name?.split(" ")[0] ?? ""}
        monthReview={graduationReview}
        onDismiss={() => setGraduationReview(null)}
      />

      {/* v72.3 - dev only. Students were seeing the 🛠 button
          bottom-right in production. */}
      {process.env.NODE_ENV === "development" && <DevTestPanel />}

      {/* v51 (Phase 2) - first-login intro video gate. v72.6: student
          must watch the full video then click Continue manually. */}
      <IntroVideoGate
        open={showIntroGate}
        onContinue={() => {
          void markIntroVideoThreshold();
          setIntroCompletedThisSession(true);
        }}
      />

      {/* v51 (Phase 2) - Why You're Here flipbook. v72.6: fires on the
          NEXT session after the intro is watched (not in the same
          session as the intro - too much at once). Dismisses on the
          final card's CTA. */}
      <WhyYoureHerePanel
        open={showWyh || wyhRewatch}
        rewatchMode={wyhRewatch}
        onDismiss={() => {
          if (wyhRewatch) {
            setWyhRewatch(false);
            return;
          }
          void dismissWhyYoureHere();
        }}
      />

      {/* v51 (Phase 2) - persistent WYH re-access button. v72.6:
          intro rewatch button removed (once watched, never shown
          again). Only the WYH "Why you're here" pill remains. */}
      {introVideoThresholdMet && whyYoureHerePanelDismissed && (
        <div
          style={{
            position: "fixed",
            top: 20,
            right: 20,
            zIndex: 40,
            display: "flex",
            gap: 8,
          }}
        >
          <button
            onClick={() => setWyhRewatch(true)}
            title="Open the Why You're Here panel"
            style={{
              padding: "8px 14px",
              borderRadius: 999,
              background: "rgba(10,14,22,0.7)",
              border: "1px solid rgba(255,255,255,0.16)",
              backdropFilter: "blur(20px) saturate(140%)",
              WebkitBackdropFilter: "blur(20px) saturate(140%)",
              color: "rgba(255,255,255,0.78)",
              fontSize: 12,
              fontWeight: 500,
              letterSpacing: "-0.005em",
              cursor: "pointer",
            }}
          >
            Why you&rsquo;re here
          </button>
        </div>
      )}
    </div>
  );
}
