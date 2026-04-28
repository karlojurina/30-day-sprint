"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { AnimatePresence } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";
import { useStudent } from "@/contexts/StudentContext";
import { TopBar } from "@/components/map/TopBar";
import { LessonSheet } from "@/components/map/LessonSheet";
import { NotebookSheet } from "@/components/map/NotebookSheet";
import { MapMockup } from "@/components/mockup/MapMockup";
import { SyncDebugPanel } from "@/components/map/SyncDebugPanel";
import { OnboardingFlow } from "@/components/map/OnboardingFlow";
import { RegionCompleteCelebration } from "@/components/map/RegionCompleteCelebration";
import { StreakToast } from "@/components/map/StreakToast";
import { GraduationModal } from "@/components/map/GraduationModal";
import { createClient } from "@/lib/supabase-browser";
import { getDayNumber } from "@/types/database";

type StreakMilestone = 7 | 14 | 30;

async function postCelebrationSeen(body: object) {
  try {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return;
    await fetch("/api/student/celebration-seen", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    // silent — best-effort persistence
  }
}

export default function DashboardMockupPage() {
  const { student } = useAuth();
  const {
    loading,
    regions,
    lessons,
    regionProgress,
    completedLessonIds,
    streak,
    monthReview,
  } = useStudent();

  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null);
  const [, setPanTarget] = useState<string | null>(null);
  const [notebookOpen, setNotebookOpen] = useState(false);

  // Onboarding only fires on the very first load.
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null);

  // Region-complete celebration queue: regions that JUST flipped complete
  // since this mount. We seed the "already celebrated" set from the
  // student's persisted celebrated_region_ids on first render so reload
  // doesn't re-fire moments they've already seen.
  const seenRegionsRef = useRef<Set<string> | null>(null);
  const [celebratingRegionId, setCelebratingRegionId] = useState<string | null>(null);

  // Streak milestone — fired when streak crosses one of the thresholds
  // for the first time (compared against the persisted value).
  const [streakToastMilestone, setStreakToastMilestone] = useState<StreakMilestone | null>(null);

  // Graduation modal
  const [showGraduation, setShowGraduation] = useState(false);

  // ---------- Onboarding bootstrap ----------
  useEffect(() => {
    if (!student) return;
    if (showOnboarding !== null) return;
    setShowOnboarding(student.onboarding_completed_at == null);
  }, [student, showOnboarding]);

  const dismissOnboarding = async () => {
    setShowOnboarding(false);
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return;
      await fetch("/api/student/complete-onboarding", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      // best-effort
    }
  };

  // ---------- Region complete diff ----------
  // Initialize the "seen" set from the persisted celebrated_region_ids.
  useEffect(() => {
    if (seenRegionsRef.current !== null) return;
    if (!student) return;
    seenRegionsRef.current = new Set(student.celebrated_region_ids ?? []);
  }, [student]);

  // Watch regionProgress for newly-complete regions
  useEffect(() => {
    if (!student) return;
    if (seenRegionsRef.current === null) return;
    if (celebratingRegionId) return; // one at a time
    for (const region of regions) {
      const p = regionProgress[region.id];
      if (!p?.isComplete) continue;
      if (seenRegionsRef.current.has(region.id)) continue;
      // Found a new completion → fire celebration
      seenRegionsRef.current.add(region.id);
      setCelebratingRegionId(region.id);
      postCelebrationSeen({ kind: "region", regionId: region.id });
      break;
    }
  }, [regions, regionProgress, student, celebratingRegionId]);

  const celebratingRegion = useMemo(
    () => regions.find((r) => r.id === celebratingRegionId) ?? null,
    [regions, celebratingRegionId]
  );

  const celebratingStats = useMemo(() => {
    if (!celebratingRegion) return null;
    const lessonsInRegion = lessons.filter(
      (l) => l.region_id === celebratingRegion.id
    );
    return {
      lessons: lessonsInRegion.length,
      daysSpent: null,
    };
  }, [celebratingRegion, lessons]);

  // ---------- Streak milestones ----------
  useEffect(() => {
    if (!student) return;
    const lastShown = student.last_streak_milestone_shown ?? 0;
    const current = streak.current;
    let milestone: StreakMilestone | null = null;
    if (current >= 30 && lastShown < 30) milestone = 30;
    else if (current >= 14 && lastShown < 14) milestone = 14;
    else if (current >= 7 && lastShown < 7) milestone = 7;
    if (milestone && streakToastMilestone == null) {
      setStreakToastMilestone(milestone);
      postCelebrationSeen({ kind: "streak", milestone });
    }
  }, [student, streak.current, streakToastMilestone]);

  // ---------- Graduation modal ----------
  useEffect(() => {
    if (!student) return;
    if (showGraduation) return;
    if (student.month_review_seen_at) return;
    if (!monthReview) return;
    const day = getDayNumber(student.joined_at);
    if (day < 28) return;
    setShowGraduation(true);
  }, [student, monthReview, showGraduation]);

  const dismissGraduation = () => {
    setShowGraduation(false);
    postCelebrationSeen({ kind: "month_review" });
  };

  // ---------- early return ----------
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

  // Suppress unused-var warnings for consumers we keep wired but don't call here
  void completedLessonIds;

  return (
    <div
      className="flex flex-col w-screen overflow-hidden"
      style={{ height: "100vh", background: "var(--color-bg-primary)" }}
    >
      <TopBar
        setPanTarget={setPanTarget}
        onOpenNotebook={() => setNotebookOpen(true)}
      />

      <div className="relative flex-1 min-h-0">
        <MapMockup onOpenLesson={(id) => setSelectedLessonId(id)} />
      </div>

      <LessonSheet
        lessonId={selectedLessonId}
        onClose={() => setSelectedLessonId(null)}
      />

      <NotebookSheet
        open={notebookOpen}
        onClose={() => setNotebookOpen(false)}
        onOpenLesson={(id) => setSelectedLessonId(id)}
      />

      <SyncDebugPanel />

      <RegionCompleteCelebration
        region={celebratingRegion}
        stats={celebratingStats}
        onDismiss={() => setCelebratingRegionId(null)}
      />

      <StreakToast
        milestoneDays={streakToastMilestone}
        onDismiss={() => setStreakToastMilestone(null)}
      />

      <GraduationModal
        open={showGraduation}
        studentName={student.name?.split(" ")[0] ?? ""}
        monthReview={
          monthReview as unknown as {
            total_lessons_completed: number;
            total_lessons: number;
            longest_streak: number;
            ad_submissions: number;
            discount_earned: boolean;
            notes_count: number;
            days_to_finish: number | null;
          } | null
        }
        onDismiss={dismissGraduation}
        onDownloadJournal={() => {
          // Phase 4c will implement this — for now route to placeholder
          if (student) window.open(`/journal/${student.id}`, "_blank");
        }}
      />

      <AnimatePresence>
        {showOnboarding && student && (
          <OnboardingFlow
            studentFirstName={student.name?.split(" ")[0] ?? ""}
            onDismiss={dismissOnboarding}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
