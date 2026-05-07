"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useStudent } from "@/contexts/StudentContext";
import { TopBar } from "@/components/map/TopBar";
import { LessonSheet } from "@/components/map/LessonSheet";
import { MapMockup } from "@/components/mockup/MapMockup";
import { LessonCompleteEffects } from "@/components/map/LessonCompleteEffects";
import { DiscountUrgencyBanner } from "@/components/map/DiscountUrgencyBanner";
import { StreakCelebration } from "@/components/map/StreakCelebration";
import { DevTestPanel } from "@/components/dev/DevTestPanel";

const STREAK_LAST_SEEN_KEY = "et.streak.lastSeen";

export default function DashboardPage() {
  const { student } = useAuth();
  const { loading, streak } = useStudent();

  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null);
  const [streakCelebration, setStreakCelebration] = useState<number | null>(null);

  // Detect streak increment vs the last-seen value in localStorage.
  // Fires the celebration when current > lastSeen AND > 0. Persists
  // the new value immediately so a refresh doesn't double-fire.
  const initialised = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (loading) return;
    if (streak.current <= 0) return;

    const lastSeenRaw = window.localStorage.getItem(STREAK_LAST_SEEN_KEY);
    const lastSeen = lastSeenRaw ? parseInt(lastSeenRaw, 10) : 0;

    // First load after server fetch — record current as baseline,
    // don't fire (we don't want to celebrate on every page load).
    if (!initialised.current) {
      initialised.current = true;
      if (Number.isNaN(lastSeen) || lastSeen < streak.current) {
        // If localStorage is behind server, sync without firing.
        window.localStorage.setItem(STREAK_LAST_SEEN_KEY, String(streak.current));
      }
      return;
    }

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
      <TopBar onOpenLesson={(id) => setSelectedLessonId(id)} />

      <div className="relative flex-1 min-h-0">
        <MapMockup onOpenLesson={(id) => setSelectedLessonId(id)} />
        <LessonCompleteEffects />
        <DiscountUrgencyBanner />
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

      <DevTestPanel />
    </div>
  );
}
