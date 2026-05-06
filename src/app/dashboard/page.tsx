"use client";

import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useStudent } from "@/contexts/StudentContext";
import { TopBar } from "@/components/map/TopBar";
import { LessonSheet } from "@/components/map/LessonSheet";
import { MapMockup } from "@/components/mockup/MapMockup";
import { LessonCompleteEffects } from "@/components/map/LessonCompleteEffects";
import { SyncDebugPanel } from "@/components/map/SyncDebugPanel";

export default function DashboardPage() {
  const { student } = useAuth();
  const { loading } = useStudent();

  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null);
  const [, setPanTarget] = useState<string | null>(null);

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
      <TopBar setPanTarget={setPanTarget} />

      <div className="relative flex-1 min-h-0">
        <MapMockup onOpenLesson={(id) => setSelectedLessonId(id)} />
        <LessonCompleteEffects />
      </div>

      <LessonSheet
        lessonId={selectedLessonId}
        onClose={() => setSelectedLessonId(null)}
        onSelectLesson={(id) => setSelectedLessonId(id)}
      />

      <SyncDebugPanel />
    </div>
  );
}
