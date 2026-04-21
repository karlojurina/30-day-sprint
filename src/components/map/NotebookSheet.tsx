"use client";

import { useEffect, useMemo, useState } from "react";
import { useStudent } from "@/contexts/StudentContext";

interface NotebookSheetProps {
  open: boolean;
  onClose: () => void;
  onOpenLesson: (lessonId: string) => void;
}

const GOLD = "#E6C07A";
const GOLD_HI = "#F0D595";
const GOLD_DIM = "rgba(230,192,122,0.6)";

/**
 * Central notebook — organizes all lesson notes by region.
 * Each entry links back to the lesson so the student can continue writing.
 */
export function NotebookSheet({ open, onClose, onOpenLesson }: NotebookSheetProps) {
  const { regions, lessons, lessonNotes, regionProgress, completedLessonIds } =
    useStudent();
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [open]);

  // Group notes by region
  const groups = useMemo(() => {
    const byRegion: Record<
      string,
      {
        entries: { lessonId: string; title: string; day: number; content: string }[];
      }
    > = {};
    for (const r of regions) byRegion[r.id] = { entries: [] };

    const sorted = [...lessons].sort((a, b) => a.day - b.day || a.sort_order - b.sort_order);
    for (const lesson of sorted) {
      const content = lessonNotes[lesson.id];
      if (!content?.trim()) continue;
      if (
        search &&
        !lesson.title.toLowerCase().includes(search.toLowerCase()) &&
        !content.toLowerCase().includes(search.toLowerCase())
      ) {
        continue;
      }
      if (!byRegion[lesson.region_id]) byRegion[lesson.region_id] = { entries: [] };
      byRegion[lesson.region_id].entries.push({
        lessonId: lesson.id,
        title: lesson.title,
        day: lesson.day,
        content,
      });
    }
    return regions
      .filter((r) => byRegion[r.id]?.entries.length > 0)
      .map((r) => ({ region: r, entries: byRegion[r.id].entries }));
  }, [regions, lessons, lessonNotes, search]);

  const totalNotes = Object.values(lessonNotes).filter((v) => v?.trim()).length;

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-0 z-[45]"
        style={{
          background: "rgba(6,12,26,0.75)",
          backdropFilter: "blur(6px)",
          animation: "overlay-in 0.3s cubic-bezier(0.22, 1, 0.36, 1) both",
        }}
      />

      {/* Sheet */}
      <div
        className="fixed z-[50] flex flex-col"
        style={{
          top: "5%",
          bottom: "5%",
          left: "50%",
          transform: "translateX(-50%)",
          width: "min(720px, 95vw)",
          background: "linear-gradient(180deg, #102042 0%, #0A1428 100%)",
          border: "1px solid rgba(230,192,122,0.32)",
          borderRadius: 16,
          overflow: "hidden",
          boxShadow: "0 40px 80px rgba(0,0,0,0.6)",
          animation: "fade-in 0.4s cubic-bezier(0.22, 1, 0.36, 1) both",
        }}
      >
        {/* Header */}
        <div
          className="flex items-start justify-between p-6"
          style={{ borderBottom: "1px solid rgba(230,192,122,0.2)" }}
        >
          <div>
            <p
              className="text-[11px] font-mono uppercase tracking-widest mb-1"
              style={{ color: GOLD, letterSpacing: "0.18em" }}
            >
              Your Workshop
            </p>
            <h2
              className="italic text-[28px] leading-tight"
              style={{
                fontFamily: "Cormorant Garamond, serif",
                color: "#E6DCC8",
                fontWeight: 500,
              }}
            >
              The Notebook
            </h2>
            <p
              className="text-[13px] mt-2"
              style={{
                fontFamily: "Cormorant Garamond, serif",
                fontStyle: "italic",
                color: GOLD_DIM,
              }}
            >
              {totalNotes} {totalNotes === 1 ? "entry" : "entries"} recorded
              across your expedition.
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-full flex items-center justify-center transition-colors"
            style={{
              color: "rgba(230,220,200,0.62)",
              border: "1px solid rgba(230,192,122,0.2)",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = "rgba(230,192,122,0.08)")
            }
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Search */}
        <div className="px-6 pt-4">
          <input
            type="text"
            placeholder="Search your notes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-4 py-2.5 rounded-lg outline-none transition-colors text-[14px]"
            style={{
              background: "rgba(6,12,26,0.6)",
              border: "1px solid rgba(230,192,122,0.2)",
              color: "#E6DCC8",
              fontFamily: "Cormorant Garamond, serif",
              fontStyle: "italic",
            }}
          />
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          {groups.length === 0 ? (
            <EmptyState regions={regions} regionProgress={regionProgress} completedCount={completedLessonIds.size} />
          ) : (
            groups.map(({ region, entries }) => (
              <div key={region.id}>
                <div className="flex items-center gap-3 mb-4">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center"
                    style={{
                      background: "rgba(230,192,122,0.12)",
                      border: "1px solid rgba(230,192,122,0.32)",
                      color: GOLD_HI,
                      fontFamily: "Cormorant Garamond, serif",
                      fontStyle: "italic",
                      fontSize: 15,
                      fontWeight: 600,
                    }}
                  >
                    {["I", "II", "III", "IV"][region.order_num - 1]}
                  </div>
                  <div>
                    <p
                      className="text-[10px] font-mono uppercase"
                      style={{ color: GOLD_DIM, letterSpacing: "0.16em" }}
                    >
                      Region {region.order_num} · {region.days_label}
                    </p>
                    <h3
                      className="italic text-[20px] leading-tight"
                      style={{
                        fontFamily: "Cormorant Garamond, serif",
                        color: "#E6DCC8",
                        fontWeight: 500,
                      }}
                    >
                      {region.name}
                    </h3>
                  </div>
                </div>

                <div className="space-y-3 pl-11">
                  {entries.map((entry) => (
                    <button
                      key={entry.lessonId}
                      onClick={() => {
                        onOpenLesson(entry.lessonId);
                        onClose();
                      }}
                      className="w-full text-left p-4 rounded-lg transition-colors"
                      style={{
                        background: "rgba(6,12,26,0.55)",
                        border: "1px solid rgba(230,192,122,0.14)",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = "rgba(6,12,26,0.8)";
                        e.currentTarget.style.borderColor =
                          "rgba(230,192,122,0.32)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "rgba(6,12,26,0.55)";
                        e.currentTarget.style.borderColor =
                          "rgba(230,192,122,0.14)";
                      }}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span
                          className="font-mono text-[10px] uppercase tracking-widest"
                          style={{ color: GOLD, letterSpacing: "0.16em" }}
                        >
                          Day {entry.day}
                        </span>
                        <span style={{ color: GOLD_DIM }}>·</span>
                        <span
                          className="text-[14px] truncate"
                          style={{
                            fontFamily: "Cormorant Garamond, serif",
                            fontStyle: "italic",
                            color: "#E6DCC8",
                          }}
                        >
                          {entry.title}
                        </span>
                      </div>
                      <p
                        className="text-[13px] leading-relaxed whitespace-pre-wrap"
                        style={{ color: "rgba(230,220,200,0.85)" }}
                      >
                        {entry.content.length > 240
                          ? entry.content.slice(0, 238) + "…"
                          : entry.content}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}

function EmptyState({
  regions,
  regionProgress,
  completedCount,
}: {
  regions: ReturnType<typeof useStudent>["regions"];
  regionProgress: ReturnType<typeof useStudent>["regionProgress"];
  completedCount: number;
}) {
  const unlockedCount = regions.filter((r) => regionProgress[r.id]?.isUnlocked).length;

  return (
    <div className="text-center py-12 px-4">
      <div
        className="mx-auto mb-5 w-20 h-20 rounded-full flex items-center justify-center"
        style={{
          background: "rgba(230,192,122,0.08)",
          border: "1px solid rgba(230,192,122,0.25)",
        }}
      >
        <svg
          className="w-10 h-10"
          fill="none"
          viewBox="0 0 24 24"
          stroke={GOLD}
          strokeWidth="1.2"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
          />
        </svg>
      </div>
      <h3
        className="italic text-[22px] mb-2"
        style={{
          fontFamily: "Cormorant Garamond, serif",
          color: "#E6DCC8",
          fontWeight: 500,
        }}
      >
        Your notebook is waiting.
      </h3>
      <p
        className="text-[14px] max-w-sm mx-auto"
        style={{
          fontFamily: "Cormorant Garamond, serif",
          fontStyle: "italic",
          color: "rgba(230,220,200,0.62)",
        }}
      >
        Open any lesson on the map and write down what stood out, what
        you&apos;ll try next, or anything worth remembering. Every entry shows
        up here, organized by region.
      </p>
      <div
        className="mt-6 inline-flex items-center gap-2 px-3 py-1.5 rounded-md"
        style={{
          background: "rgba(230,192,122,0.08)",
          border: "1px solid rgba(230,192,122,0.2)",
        }}
      >
        <span
          className="font-mono text-[10px] uppercase"
          style={{ color: GOLD_DIM, letterSpacing: "0.16em" }}
        >
          {completedCount} lessons charted · {unlockedCount}/{regions.length} regions explored
        </span>
      </div>
    </div>
  );
}
