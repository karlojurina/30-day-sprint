"use client";

import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useStudent } from "@/contexts/StudentContext";
import { TopBar } from "@/components/map/TopBar";
import { LessonSheet } from "@/components/map/LessonSheet";
import { NotebookSheet } from "@/components/map/NotebookSheet";
import { MapMockup } from "@/components/mockup/MapMockup";

export default function DashboardMockupPage() {
  const { student } = useAuth();
  const { loading } = useStudent();

  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null);
  const [panTarget, setPanTarget] = useState<string | null>(null);
  const [notebookOpen, setNotebookOpen] = useState(false);

  if (loading || !student) {
    return (
      <div
        className="flex items-center justify-center min-h-screen"
        style={{ background: "#060C1A" }}
      >
        <div
          className="w-8 h-8 rounded-full animate-spin"
          style={{
            border: "2px solid #E6C07A",
            borderTopColor: "transparent",
          }}
        />
      </div>
    );
  }

  return (
    <div
      className="flex flex-col w-screen overflow-hidden"
      style={{ height: "100vh", background: "#060C1A" }}
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
    </div>
  );
}
