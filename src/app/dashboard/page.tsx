"use client";

import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useStudent } from "@/contexts/StudentContext";
import { MapCanvas } from "@/components/map/MapCanvas";
import { MapControls } from "@/components/map/MapControls";
import { TopBar } from "@/components/map/TopBar";
import { LessonSheet } from "@/components/map/LessonSheet";

export default function DashboardPage() {
  const { student } = useAuth();
  const { loading } = useStudent();

  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null);
  const [panTarget, setPanTarget] = useState<string | null>(null);
  const [lockedRegionId, setLockedRegionId] = useState<string | null>(null);
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
      className="relative w-screen overflow-hidden"
      style={{ height: "100vh", background: "#060C1A" }}
    >
      <TopBar
        setPanTarget={setPanTarget}
        onOpenNotebook={() => setNotebookOpen(true)}
      />

      <MapCanvas
        onOpenLesson={(id) => setSelectedLessonId(id)}
        onLockedRegion={(id) => setLockedRegionId(id)}
        panTarget={panTarget}
        setPanTarget={setPanTarget}
      />

      <MapControls setPanTarget={setPanTarget} />

      <LessonSheet
        lessonId={selectedLessonId}
        onClose={() => setSelectedLessonId(null)}
      />

      {/* Locked region prompt — minimal stub (full UI in Phase D) */}
      {lockedRegionId && (
        <div
          onClick={() => setLockedRegionId(null)}
          className="fixed inset-0 z-[45] flex items-center justify-center"
          style={{ background: "rgba(6,12,26,0.7)", backdropFilter: "blur(4px)" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-w-sm w-full mx-4 p-6 rounded-xl"
            style={{
              background: "#102042",
              border: "1px solid rgba(230,192,122,0.32)",
            }}
          >
            <p
              className="text-[11px] font-mono uppercase tracking-widest mb-2"
              style={{ color: "rgba(230,192,122,0.85)", letterSpacing: "0.16em" }}
            >
              Region locked
            </p>
            <h3
              className="italic text-[22px] mb-3"
              style={{
                fontFamily: "Cormorant Garamond, serif",
                color: "#E6DCC8",
              }}
            >
              The fog hasn&apos;t lifted here yet.
            </h3>
            <p
              className="text-[13px] mb-4"
              style={{ color: "rgba(230,220,200,0.68)" }}
            >
              Finish the previous region to chart this one.
            </p>
            <button
              onClick={() => setLockedRegionId(null)}
              className="w-full py-2.5 rounded-md font-semibold text-[13px]"
              style={{ background: "#E6C07A", color: "#060C1A" }}
            >
              Understood
            </button>
          </div>
        </div>
      )}

      {/* Notebook stub (Phase D) */}
      {notebookOpen && (
        <div
          onClick={() => setNotebookOpen(false)}
          className="fixed inset-0 z-[45] flex items-center justify-center"
          style={{ background: "rgba(6,12,26,0.7)", backdropFilter: "blur(4px)" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-w-md w-full mx-4 p-6 rounded-xl"
            style={{
              background: "#102042",
              border: "1px solid rgba(230,192,122,0.32)",
            }}
          >
            <p
              className="text-[11px] font-mono uppercase tracking-widest mb-2"
              style={{ color: "rgba(230,192,122,0.85)", letterSpacing: "0.16em" }}
            >
              Notebook
            </p>
            <h3
              className="italic text-[22px] mb-3"
              style={{
                fontFamily: "Cormorant Garamond, serif",
                color: "#E6DCC8",
              }}
            >
              Your Workshop
            </h3>
            <p
              className="text-[13px] mb-4"
              style={{ color: "rgba(230,220,200,0.68)" }}
            >
              Full notebook coming soon. For now, you can write notes inside each lesson.
            </p>
            <button
              onClick={() => setNotebookOpen(false)}
              className="w-full py-2.5 rounded-md font-semibold text-[13px]"
              style={{ background: "#E6C07A", color: "#060C1A" }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
