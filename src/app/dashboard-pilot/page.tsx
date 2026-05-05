"use client";

/**
 * Pilot dashboard — alternative version of /dashboard for evaluating
 * the new "game-quality" map techniques (AI-painted base, video
 * atmosphere overlays, animated compass, ink-bloom on completion,
 * sound). Production /dashboard is unchanged.
 *
 * Decision flow: if this version lands the way it should, we either
 * merge its contents into /dashboard or migrate users gradually.
 *
 * Branch: pilot-region-1.
 * Vercel auto-deploys a preview URL for this branch where you can
 * compare side-by-side with the production /dashboard.
 */

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useStudent } from "@/contexts/StudentContext";
import { TopBar } from "@/components/map/TopBar";
import { LessonSheet } from "@/components/map/LessonSheet";
import { NotebookSheet } from "@/components/map/NotebookSheet";
import { MapMockup } from "@/components/mockup/MapMockup";
import { MapCompass } from "@/components/map/MapCompass";
import {
  MapTerrainOverlay,
  REGION_1_ATMOSPHERE,
} from "@/components/map/MapTerrainOverlay";
import { LessonCompleteEffects } from "@/components/map/LessonCompleteEffects";
import { playSound } from "@/lib/audio";

export default function DashboardPilotPage() {
  const { student } = useAuth();
  const { loading } = useStudent();

  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null);
  const [panTarget, setPanTarget] = useState<string | null>(null);
  const [notebookOpen, setNotebookOpen] = useState(false);

  // Paper-rustle on lesson sheet open. Plays only when sound is enabled
  // (the playSound helper handles the gate).
  useEffect(() => {
    if (selectedLessonId) playSound("sheet-open", 0.45);
  }, [selectedLessonId]);

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
      <TopBar
        setPanTarget={setPanTarget}
        onOpenNotebook={() => setNotebookOpen(true)}
        showSettings
      />

      <div className="relative flex-1 min-h-0">
        {/* The existing map — unchanged */}
        <MapMockup onOpenLesson={(id) => setSelectedLessonId(id)} />

        {/* Atmospheric video overlays — Region 1 only for the pilot.
            Falls back to nothing if the AI-generated assets are missing. */}
        <MapTerrainOverlay clips={REGION_1_ATMOSPHERE} />

        {/* Lesson-complete bloom + sound */}
        <LessonCompleteEffects />

        {/* Compass — always points to next-uncompleted lesson */}
        <MapCompass onPointerClick={(id) => setPanTarget(id)} />
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
    </div>
  );
}
