"use client";

import { useState, useEffect } from "react";
import { AnimatePresence } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";
import { useStudent } from "@/contexts/StudentContext";
import { TopBar } from "@/components/map/TopBar";
import { LessonSheet } from "@/components/map/LessonSheet";
import { NotebookSheet } from "@/components/map/NotebookSheet";
import { MapMockup } from "@/components/mockup/MapMockup";
import { SyncDebugPanel } from "@/components/map/SyncDebugPanel";
import { OnboardingFlow } from "@/components/map/OnboardingFlow";
import { createClient } from "@/lib/supabase-browser";

export default function DashboardMockupPage() {
  const { student } = useAuth();
  const { loading } = useStudent();

  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null);
  const [panTarget, setPanTarget] = useState<string | null>(null);
  const [notebookOpen, setNotebookOpen] = useState(false);
  // Onboarding only fires on the very first load. We snapshot the flag
  // value at mount and never re-show — even if `student` updates after
  // the API call sets the timestamp.
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null);

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
      // Best-effort. If the call fails, the modal will reappear next
      // visit — annoying but not catastrophic.
    }
  };

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
