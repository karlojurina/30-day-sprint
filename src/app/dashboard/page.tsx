"use client";

import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useStudent } from "@/contexts/StudentContext";
import { MapCanvas } from "@/components/map/MapCanvas";
import { MapControls } from "@/components/map/MapControls";
import { TopBar } from "@/components/map/TopBar";
import { LessonSheet } from "@/components/map/LessonSheet";
import { NotebookSheet } from "@/components/map/NotebookSheet";

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

      <NotebookSheet
        open={notebookOpen}
        onClose={() => setNotebookOpen(false)}
        onOpenLesson={(id) => setSelectedLessonId(id)}
      />

      {/* Locked region prompt */}
      {lockedRegionId && (
        <LockedRegionPrompt
          regionId={lockedRegionId}
          onDismiss={() => setLockedRegionId(null)}
        />
      )}
    </div>
  );
}

function LockedRegionPrompt({
  regionId,
  onDismiss,
}: {
  regionId: string;
  onDismiss: () => void;
}) {
  const { regions, regionProgress } = useStudent();
  const region = regions.find((r) => r.id === regionId);
  if (!region) return null;

  const sortedRegions = [...regions].sort((a, b) => a.order_num - b.order_num);
  const idx = sortedRegions.findIndex((r) => r.id === regionId);
  const prev = idx > 0 ? sortedRegions[idx - 1] : null;
  const prevProgress = prev ? regionProgress[prev.id] : null;

  return (
    <div
      onClick={onDismiss}
      className="fixed inset-0 z-[45] flex items-center justify-center px-4"
      style={{
        background: "rgba(6,12,26,0.78)",
        backdropFilter: "blur(6px)",
        animation: "overlay-in 0.3s cubic-bezier(0.22, 1, 0.36, 1) both",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-w-md w-full p-8 rounded-2xl text-center"
        style={{
          background: "linear-gradient(180deg, #102042 0%, #0A1428 100%)",
          border: "1px solid rgba(230,192,122,0.32)",
          boxShadow: "0 40px 80px rgba(0,0,0,0.6)",
          animation: "fade-in 0.4s cubic-bezier(0.22, 1, 0.36, 1) both",
        }}
      >
        <div
          className="mx-auto mb-4 w-16 h-16 rounded-full flex items-center justify-center"
          style={{
            background: "rgba(6,12,26,0.82)",
            border: "1px solid rgba(230,192,122,0.55)",
          }}
        >
          <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="#E6C07A" strokeWidth="1.8">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 11v2m-6-2v6a2 2 0 002 2h8a2 2 0 002-2v-6m-12 0V9a6 6 0 1112 0v2" />
          </svg>
        </div>
        <p
          className="text-[11px] font-mono uppercase tracking-widest mb-2"
          style={{ color: "rgba(230,192,122,0.85)", letterSpacing: "0.18em" }}
        >
          Region {region.order_num} · Locked
        </p>
        <h3
          className="italic text-[26px] mb-3"
          style={{ fontFamily: "Cormorant Garamond, serif", color: "#E6DCC8", fontWeight: 500 }}
        >
          The fog hasn&apos;t lifted here yet.
        </h3>
        <p
          className="text-[14px] leading-relaxed mb-5"
          style={{
            fontFamily: "Cormorant Garamond, serif",
            fontStyle: "italic",
            color: "rgba(230,220,200,0.72)",
          }}
        >
          {prev && prevProgress
            ? `Chart the rest of ${prev.name} to reveal ${region.name}. ${prevProgress.completed}/${prevProgress.total} lessons done.`
            : `Complete the previous region to unlock ${region.name}.`}
        </p>
        <button
          onClick={onDismiss}
          className="w-full py-3 rounded-lg font-semibold text-[14px] transition-colors"
          style={{ background: "#E6C07A", color: "#060C1A" }}
        >
          Understood
        </button>
      </div>
    </div>
  );
}
