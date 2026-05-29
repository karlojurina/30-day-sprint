"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
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

// v72.8 - scope by student id. Was a global key, which meant
// switching accounts on the same browser carried the previous
// account's "last celebrated" value over - a new account with
// streak=1 would silently not fire because the localStorage said
// "we already celebrated 30." Bug Karlo flagged on 2026-05-29.
const streakLastSeenKey = (studentId: string) =>
  `et.streak.lastSeen.${studentId}`;

export default function DashboardPage() {
  const { student } = useAuth();
  const {
    loading,
    streak,
    discountRequest,
    firstDashboardLoginAt,
    introVideoThresholdMet,
    whyYoureHerePanelDismissed,
    markDashboardLogin,
    markIntroVideoThreshold,
    dismissWhyYoureHere,
  } = useStudent();

  // v74.1 - DevTestPanel now also mounts in production when the URL
  // has ?devtest=1 - lets Karlo / Lovro fire the graduation modal
  // (and other test events) on live to verify changes without
  // running locally. Regular students never see the panel.
  const searchParams = useSearchParams();
  const showDevPanel =
    process.env.NODE_ENV === "development" ||
    searchParams.get("devtest") === "1";

  // v72.8 - removed the auto-redirect to /dashboard/playbook. Even
  // when the student has unlocked the Playbook (completed l078) we
  // leave them on the map by default. The student picks where they
  // go - the Playbook is accessible via the StatsWidget CTA or
  // direct navigation.

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
  //   4. v72.7 - both intro AND WYH rewatch buttons removed. Once
  //      watched / dismissed, neither resurfaces.
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
    if (!student) return;
    if (streak.current <= 0) return;

    const key = streakLastSeenKey(student.id);
    const lastSeenRaw = window.localStorage.getItem(key);
    const lastSeen = lastSeenRaw ? parseInt(lastSeenRaw, 10) : 0;
    if (Number.isNaN(lastSeen)) return;

    if (streak.current > lastSeen) {
      setStreakCelebration(streak.current);
      window.localStorage.setItem(key, String(streak.current));
    }
  }, [streak.current, loading, student]);

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

  // Graduation modal listener. Single channel for both the auto-fire
  // (MapMockup dispatches when l078 completes IN the R4 view) AND
  // the dev test panel (which dispatches with mock data). Once-per-
  // student dedupe lives in MapMockup via localStorage.
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<MockMonthReview>;
      if (ce.detail) setGraduationReview(ce.detail);
    };
    window.addEventListener("et:graduation", handler);
    return () => window.removeEventListener("et:graduation", handler);
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

      {/* v72.3 - dev only. v74.1 - now also shows in prod when the URL
          has ?devtest=1 so the team can fire the graduation modal /
          streak / discount celebrations against a live account. */}
      {showDevPanel && <DevTestPanel />}

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
          final card's CTA. v72.7: rewatch button removed; the panel
          is single-shot now. */}
      <WhyYoureHerePanel
        open={showWyh}
        onDismiss={() => void dismissWhyYoureHere()}
      />

    </div>
  );
}
