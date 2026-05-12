"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useStudent } from "@/contexts/StudentContext";
import { LessonSheet } from "@/components/map/LessonSheet";
import { MapMockup } from "@/components/mockup/MapMockup";
import { LessonCompleteEffects } from "@/components/map/LessonCompleteEffects";
import { StreakCelebration } from "@/components/map/StreakCelebration";
import { DiscountApprovedCelebration } from "@/components/map/DiscountApprovedCelebration";
import { DevTestPanel } from "@/components/dev/DevTestPanel";

const DISCOUNT_APPROVED_LAST_SEEN_KEY = "et.discountApproved.lastSeen";

const STREAK_LAST_SEEN_KEY = "et.streak.lastSeen";

export default function DashboardPage() {
  const { student } = useAuth();
  const { loading, streak, discountRequest } = useStudent();

  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null);
  const [streakCelebration, setStreakCelebration] = useState<number | null>(null);
  const [discountCelebration, setDiscountCelebration] = useState<boolean>(false);

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

      <DevTestPanel />
    </div>
  );
}
