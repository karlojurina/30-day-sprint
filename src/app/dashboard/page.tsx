"use client";

import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useStudent } from "@/contexts/StudentContext";
import { MapCanvas } from "@/components/map/MapCanvas";
import { MapControls } from "@/components/map/MapControls";
import { TopBar } from "@/components/map/TopBar";
import { LessonSheet } from "@/components/map/LessonSheet";
import { NotebookSheet } from "@/components/map/NotebookSheet";
import { MapLegend } from "@/components/map/MapLegend";

export default function DashboardPage() {
  const { student } = useAuth();
  const { loading } = useStudent();

  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null);
  const [panTarget, setPanTarget] = useState<string | null>(null);
  const [lockedRegionId, setLockedRegionId] = useState<string | null>(null);
  const [notebookOpen, setNotebookOpen] = useState(false);
  const { lessons, completedLessonIds, regions } = useStudent();

  // Given a locked region, find the previous region and its first
  // incomplete lesson — that's the blocker the student needs to chart.
  const blockerForRegion = (regionId: string) => {
    const sorted = [...regions].sort((a, b) => a.order_num - b.order_num);
    const idx = sorted.findIndex((r) => r.id === regionId);
    if (idx <= 0) return null;
    const prev = sorted[idx - 1];
    const prevLessons = lessons
      .filter((l) => l.region_id === prev.id)
      .sort((a, b) => a.day - b.day || a.sort_order - b.sort_order);
    const firstIncomplete = prevLessons.find((l) => !completedLessonIds.has(l.id));
    return firstIncomplete?.id ?? prevLessons[0]?.id ?? null;
  };

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

      {/* Map fills everything under the topbar. MapCanvas is absolutely
          positioned inside this flex-1 wrapper, so it can't overlap the
          topbar any more. */}
      <div className="relative flex-1 min-h-0">
        <MapCanvas
          onOpenLesson={(id) => setSelectedLessonId(id)}
          onLockedRegion={(id) => setLockedRegionId(id)}
          panTarget={panTarget}
          setPanTarget={setPanTarget}
        />
      </div>

      <MapControls setPanTarget={setPanTarget} />

      <MapLegend />

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
          onTakeMeThere={() => {
            const target = blockerForRegion(lockedRegionId);
            if (target) setPanTarget(target);
            setLockedRegionId(null);
          }}
        />
      )}
    </div>
  );
}

function LockedRegionPrompt({
  regionId,
  onDismiss,
  onTakeMeThere,
}: {
  regionId: string;
  onDismiss: () => void;
  onTakeMeThere: () => void;
}) {
  const { regions, regionProgress } = useStudent();
  const region = regions.find((r) => r.id === regionId);
  if (!region) return null;

  const sortedRegions = [...regions].sort((a, b) => a.order_num - b.order_num);
  const idx = sortedRegions.findIndex((r) => r.id === regionId);
  const prev = idx > 0 ? sortedRegions[idx - 1] : null;
  const prevProgress = prev ? regionProgress[prev.id] : null;
  const hasBlocker = Boolean(prev);

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
          style={{
            color: "rgba(230,192,122,0.85)",
            letterSpacing: "0.18em",
            fontFamily: "JetBrains Mono, ui-monospace, monospace",
          }}
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
            ? `Chart the rest of ${prev.name} to reveal ${region.name}. ${prevProgress.completed} of ${prevProgress.total} lessons done.`
            : `Complete the previous region to unlock ${region.name}.`}
        </p>
        <div className="space-y-2">
          {hasBlocker && (
            <button
              onClick={onTakeMeThere}
              className="w-full py-3 rounded-lg font-semibold text-[14px] transition-colors"
              style={{ background: "#E6C07A", color: "#060C1A" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#F0D595")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "#E6C07A")}
            >
              Take me to {prev?.name}
            </button>
          )}
          <button
            onClick={onDismiss}
            className="w-full py-2.5 rounded-lg text-[13px] transition-colors"
            style={{
              background: "transparent",
              color: "rgba(230,220,200,0.62)",
              border: "1px solid rgba(230,192,122,0.2)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "#E6DCC8";
              e.currentTarget.style.borderColor = "rgba(230,192,122,0.45)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "rgba(230,220,200,0.62)";
              e.currentTarget.style.borderColor = "rgba(230,192,122,0.2)";
            }}
          >
            {hasBlocker ? "Not yet" : "Understood"}
          </button>
        </div>
      </div>
    </div>
  );
}
