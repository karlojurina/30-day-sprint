"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { gsap } from "gsap";
import { useStudent } from "@/contexts/StudentContext";
import {
  MAP_W,
  MAP_H,
  REGION_STRIPS,
  type RegionStripMap,
} from "@/lib/map/path-math";
import { LESSON_TYPE_LABELS } from "@/lib/constants";
import type { Lesson } from "@/types/database";

interface MapMockupProps {
  onOpenLesson: (lessonId: string) => void;
}

type RegionId = keyof RegionStripMap;
type View = "overview" | RegionId;

const REGION_ORDER: RegionId[] = ["r1", "r2", "r3", "r4"];
const SIDE_PANEL_WIDTH = 420;

const GOLD = "#E6C07A";
const GOLD_HI = "#F0D595";
const INK = "#E6DCC8";

/**
 * Mockup: region-centric expedition. No 63-node path.
 *
 *   Overview — whole painted world, 4 regions labelled with progress
 *              Click a region → zoom in.
 *   Region focus — map zooms to that region, side panel shows its lessons
 *              Click a lesson → open the existing LessonSheet modal.
 *              Prev / Next region buttons navigate between regions.
 *              "Back to map" returns to overview.
 */
export function MapMockup({ onOpenLesson }: MapMockupProps) {
  const { regions, lessons, completedLessonIds, regionProgress, currentLesson } =
    useStudent();

  const outerRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef({ x: 0, y: 0, scale: 1 });
  const tweenRef = useRef<gsap.core.Tween | null>(null);

  const [view, setView] = useState<View>("overview");
  const [outerSize, setOuterSize] = useState({ w: 0, h: 0 });
  const [displayTransform, setDisplayTransform] = useState({
    x: 0,
    y: 0,
    scale: 1,
  });

  // Measure outer container
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const update = () =>
      setOuterSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Default view: if student has a current lesson, start zoomed on that region
  useEffect(() => {
    if (outerSize.w === 0) return;
    if (currentLesson) {
      const rid = currentLesson.region_id as RegionId;
      if (REGION_ORDER.includes(rid)) {
        setView(rid);
        return;
      }
    }
    setView("overview");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outerSize.w, currentLesson?.id]);

  // Compute target transform for a given view
  const getTargetTransform = (v: View) => {
    const vw = outerSize.w || 1;
    const vh = outerSize.h || 1;

    if (v === "overview") {
      const sW = vw / MAP_W;
      const sH = vh / MAP_H;
      const scale = Math.max(sW, sH);
      return {
        x: (vw - MAP_W * scale) / 2,
        y: (vh - MAP_H * scale) / 2,
        scale,
      };
    }

    // Zoom to region, leaving room on the right for the side panel
    const s = REGION_STRIPS[v];
    const usableW = vw - SIDE_PANEL_WIDTH;
    const regionW = s.xEnd - s.xStart;
    const regionH = s.yBot - s.yTop;
    // Cover-fit the region into the usable area, plus slight overscan
    const scale =
      Math.max(usableW / regionW, vh / regionH) * 1.02;
    const centerX = (s.xStart + s.xEnd) / 2;
    const centerY = (s.yTop + s.yBot) / 2;
    return {
      x: usableW / 2 - centerX * scale,
      y: vh / 2 - centerY * scale,
      scale,
    };
  };

  // Animate transform on view change
  useEffect(() => {
    if (outerSize.w === 0) return;
    const target = getTargetTransform(view);
    if (tweenRef.current) {
      tweenRef.current.kill();
      tweenRef.current = null;
    }
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      transformRef.current = target;
      setDisplayTransform(target);
      return;
    }
    tweenRef.current = gsap.to(transformRef.current, {
      x: target.x,
      y: target.y,
      scale: target.scale,
      duration: 1.1,
      ease: "power3.inOut",
      onUpdate: () => {
        setDisplayTransform({ ...transformRef.current });
      },
      onComplete: () => {
        tweenRef.current = null;
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, outerSize]);

  // Lessons for focused region, in day + sort_order sequence
  const focusedRegion =
    view !== "overview" ? regions.find((r) => r.id === view) : null;
  const focusedLessons: Lesson[] = useMemo(() => {
    if (!focusedRegion) return [];
    return [...lessons]
      .filter((l) => l.region_id === focusedRegion.id)
      .sort((a, b) => a.day - b.day || a.sort_order - b.sort_order);
  }, [focusedRegion, lessons]);

  const sortedRegions = useMemo(
    () => [...regions].sort((a, b) => a.order_num - b.order_num),
    [regions]
  );

  const focusedIdx =
    focusedRegion == null
      ? -1
      : sortedRegions.findIndex((r) => r.id === focusedRegion.id);
  const prevRegion = focusedIdx > 0 ? sortedRegions[focusedIdx - 1] : null;
  const nextRegion =
    focusedIdx >= 0 && focusedIdx < sortedRegions.length - 1
      ? sortedRegions[focusedIdx + 1]
      : null;

  return (
    <div
      ref={outerRef}
      className="absolute inset-0 overflow-hidden"
      style={{ background: "#060C1A" }}
    >
      {/* Map inner — scaled + translated by GSAP (mirrored to React state) */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: MAP_W,
          height: MAP_H,
          transform: `translate(${displayTransform.x}px, ${displayTransform.y}px) scale(${displayTransform.scale})`,
          transformOrigin: "0 0",
          willChange: "transform",
        }}
      >
        {/* Base panorama */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: 'url("/regions/expedition-map.png")',
            backgroundSize: "cover",
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
          }}
        />

        {/* Fog of war over locked regions */}
        {regions.map((r) => {
          const s = REGION_STRIPS[r.id as RegionId];
          const st = regionProgress[r.id];
          if (!s || st?.isUnlocked) return null;
          return (
            <div
              key={`fog-${r.id}`}
              style={{
                position: "absolute",
                left: s.xStart,
                top: s.yTop,
                width: s.xEnd - s.xStart,
                height: s.yBot - s.yTop,
                background: "rgba(6,12,26,0.45)",
                backdropFilter: "saturate(0.5) brightness(0.75)",
                WebkitBackdropFilter: "saturate(0.5) brightness(0.75)",
              }}
            />
          );
        })}

        {/* Region badges — visible only in overview. Clicking a badge zooms in. */}
        {view === "overview" &&
          sortedRegions.map((r) => {
            const s = REGION_STRIPS[r.id as RegionId];
            const st = regionProgress[r.id];
            if (!s || !st) return null;
            const centerX = (s.xStart + s.xEnd) / 2;
            const centerY = (s.yTop + s.yBot) / 2;
            const locked = !st.isUnlocked;
            return (
              <button
                key={r.id}
                onClick={() => !locked && setView(r.id as RegionId)}
                disabled={locked}
                style={{
                  position: "absolute",
                  left: centerX,
                  top: centerY,
                  transform: "translate(-50%, -50%)",
                  cursor: locked ? "not-allowed" : "pointer",
                  background: "transparent",
                  border: "none",
                  padding: 0,
                }}
                aria-label={`${r.name} — ${st.completed}/${st.total} lessons`}
              >
                <RegionBadge
                  region={r}
                  progress={st}
                  locked={locked}
                />
              </button>
            );
          })}
      </div>

      {/* Region side panel */}
      {focusedRegion && (
        <RegionSidePanel
          region={focusedRegion}
          lessons={focusedLessons}
          completedLessonIds={completedLessonIds}
          currentLessonId={currentLesson?.id ?? null}
          onOpenLesson={onOpenLesson}
          onBack={() => setView("overview")}
          onPrev={prevRegion ? () => setView(prevRegion.id as RegionId) : null}
          onNext={nextRegion ? () => setView(nextRegion.id as RegionId) : null}
        />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Region badge (shown in overview)
// ──────────────────────────────────────────────────────────────

function RegionBadge({
  region,
  progress,
  locked,
}: {
  region: ReturnType<typeof useStudent>["regions"][number];
  progress: { completed: number; total: number; isComplete: boolean };
  locked: boolean;
}) {
  const numeral = ["I", "II", "III", "IV"][region.order_num - 1];
  const accent = progress.isComplete ? GOLD_HI : locked ? "rgba(230,192,122,0.35)" : GOLD;

  return (
    <div
      className="group"
      style={{
        width: 320,
        padding: "22px 26px",
        background: "rgba(6,12,26,0.78)",
        border: `1.5px solid ${accent}`,
        borderRadius: 14,
        backdropFilter: "blur(8px)",
        textAlign: "center",
        transition: "transform 0.35s cubic-bezier(0.22,1,0.36,1), background 0.35s, border-color 0.35s",
        boxShadow: progress.isComplete
          ? `0 0 60px rgba(230,192,122,0.25)`
          : locked
            ? "none"
            : `0 0 30px rgba(230,192,122,0.15)`,
      }}
      onMouseEnter={(e) => {
        if (locked) return;
        e.currentTarget.style.transform = "scale(1.04)";
        e.currentTarget.style.background = "rgba(16,32,66,0.85)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "scale(1)";
        e.currentTarget.style.background = "rgba(6,12,26,0.78)";
      }}
    >
      {/* Numeral disc */}
      <div
        style={{
          width: 44,
          height: 44,
          margin: "0 auto 10px",
          borderRadius: "50%",
          background: "rgba(10,20,40,0.85)",
          border: `1.5px solid ${accent}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "Cormorant Garamond, serif",
          fontStyle: "italic",
          fontWeight: 600,
          fontSize: 22,
          color: accent,
        }}
      >
        {numeral}
      </div>

      {/* Region label */}
      <p
        className="font-mono uppercase"
        style={{
          color: accent,
          letterSpacing: "0.2em",
          fontSize: 10,
          marginBottom: 4,
        }}
      >
        Region {numeral}
      </p>
      <h3
        className="italic"
        style={{
          fontFamily: "Cormorant Garamond, serif",
          fontWeight: 500,
          fontSize: 26,
          color: locked ? "rgba(230,220,200,0.5)" : INK,
          lineHeight: 1.1,
          marginBottom: 8,
        }}
      >
        {region.name}
      </h3>
      <p
        className="italic"
        style={{
          fontFamily: "Cormorant Garamond, serif",
          fontStyle: "italic",
          fontSize: 13,
          color: "rgba(230,220,200,0.6)",
          marginBottom: 14,
          minHeight: 38,
        }}
      >
        {region.tagline}
      </p>

      {/* Progress */}
      <div
        className="font-mono"
        style={{
          fontSize: 11,
          color: progress.isComplete
            ? GOLD_HI
            : locked
              ? "rgba(230,220,200,0.35)"
              : "rgba(230,220,200,0.7)",
          letterSpacing: "0.14em",
          textTransform: "uppercase",
        }}
      >
        {locked
          ? "Locked"
          : progress.isComplete
            ? `Charted · ${progress.total} lessons`
            : `${progress.completed} / ${progress.total} lessons`}
      </div>

      {/* Hover CTA */}
      {!locked && (
        <div
          className="font-mono"
          style={{
            marginTop: 14,
            paddingTop: 14,
            borderTop: "1px solid rgba(230,192,122,0.2)",
            color: GOLD,
            fontSize: 11,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
          }}
        >
          {progress.isComplete ? "Revisit" : "Enter region →"}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Side panel (shown when a region is focused)
// ──────────────────────────────────────────────────────────────

function RegionSidePanel({
  region,
  lessons,
  completedLessonIds,
  currentLessonId,
  onOpenLesson,
  onBack,
  onPrev,
  onNext,
}: {
  region: ReturnType<typeof useStudent>["regions"][number];
  lessons: Lesson[];
  completedLessonIds: Set<string>;
  currentLessonId: string | null;
  onOpenLesson: (id: string) => void;
  onBack: () => void;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
}) {
  const numeral = ["I", "II", "III", "IV"][region.order_num - 1];

  const completed = lessons.filter((l) => completedLessonIds.has(l.id)).length;
  const total = lessons.length;

  return (
    <aside
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        width: SIDE_PANEL_WIDTH,
        background:
          "linear-gradient(180deg, rgba(6,12,26,0.96) 0%, rgba(10,20,40,0.96) 100%)",
        borderLeft: "1px solid rgba(230,192,122,0.25)",
        display: "flex",
        flexDirection: "column",
        animation: "slide-in-right 0.6s cubic-bezier(0.22,1,0.36,1) both",
        boxShadow: "-30px 0 60px rgba(0,0,0,0.5)",
      }}
    >
      {/* Back button */}
      <button
        onClick={onBack}
        className="flex items-center gap-2 px-6 py-4 transition-colors"
        style={{
          background: "transparent",
          border: "none",
          borderBottom: "1px solid rgba(230,192,122,0.12)",
          color: "rgba(230,220,200,0.75)",
          fontFamily: "JetBrains Mono, ui-monospace, monospace",
          fontSize: 11,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          cursor: "pointer",
          textAlign: "left",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = INK)}
        onMouseLeave={(e) =>
          (e.currentTarget.style.color = "rgba(230,220,200,0.75)")
        }
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.6">
          <path strokeLinecap="round" strokeLinejoin="round" d="M11 17l-5-5m0 0l5-5m-5 5h12" />
        </svg>
        Back to map
      </button>

      {/* Region header */}
      <div className="px-6 py-5" style={{ borderBottom: "1px solid rgba(230,192,122,0.12)" }}>
        <p
          className="font-mono uppercase mb-1"
          style={{
            color: GOLD,
            letterSpacing: "0.22em",
            fontSize: 10,
          }}
        >
          Region {numeral}
        </p>
        <h2
          className="italic"
          style={{
            fontFamily: "Cormorant Garamond, serif",
            fontWeight: 500,
            fontSize: 34,
            color: INK,
            lineHeight: 1,
            marginBottom: 10,
          }}
        >
          {region.name}
        </h2>
        <p
          className="italic"
          style={{
            fontFamily: "Cormorant Garamond, serif",
            fontStyle: "italic",
            fontSize: 14,
            color: "rgba(230,220,200,0.68)",
            marginBottom: 16,
            lineHeight: 1.4,
          }}
        >
          {region.tagline}
        </p>

        {/* Progress bar */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span
              className="font-mono"
              style={{
                color: GOLD_HI,
                fontSize: 10,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
              }}
            >
              {completed} / {total} charted
            </span>
            <span
              className="font-mono"
              style={{
                color: "rgba(230,220,200,0.5)",
                fontSize: 10,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
              }}
            >
              {region.days_label}
            </span>
          </div>
          <div
            style={{
              height: 3,
              background: "rgba(230,192,122,0.12)",
              borderRadius: 2,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: total > 0 ? `${(completed / total) * 100}%` : "0%",
                height: "100%",
                background: `linear-gradient(90deg, ${GOLD} 0%, ${GOLD_HI} 100%)`,
                transition: "width 0.6s cubic-bezier(0.22,1,0.36,1)",
              }}
            />
          </div>
        </div>
      </div>

      {/* Lesson list */}
      <div
        className="flex-1 overflow-y-auto px-6 py-5"
        style={{ overscrollBehavior: "contain" }}
      >
        <div className="space-y-2">
          {lessons.map((lesson, i) => {
            const isDone = completedLessonIds.has(lesson.id);
            const isCurrent = lesson.id === currentLessonId;
            return (
              <button
                key={lesson.id}
                onClick={() => onOpenLesson(lesson.id)}
                className="w-full flex items-start gap-3 p-3 rounded-lg text-left transition-all"
                style={{
                  background: isCurrent
                    ? "rgba(230,192,122,0.16)"
                    : "rgba(6,12,26,0.4)",
                  border: `1px solid ${
                    isCurrent
                      ? "rgba(230,192,122,0.55)"
                      : isDone
                        ? "rgba(230,192,122,0.2)"
                        : "rgba(230,192,122,0.08)"
                  }`,
                  opacity: isDone && !isCurrent ? 0.7 : 1,
                }}
                onMouseEnter={(e) => {
                  if (isCurrent) return;
                  e.currentTarget.style.background = "rgba(6,12,26,0.75)";
                  e.currentTarget.style.borderColor = "rgba(230,192,122,0.32)";
                }}
                onMouseLeave={(e) => {
                  if (isCurrent) return;
                  e.currentTarget.style.background = "rgba(6,12,26,0.4)";
                  e.currentTarget.style.borderColor = isDone
                    ? "rgba(230,192,122,0.2)"
                    : "rgba(230,192,122,0.08)";
                }}
              >
                {/* Status indicator */}
                <div
                  className="flex-shrink-0 rounded-full flex items-center justify-center mt-0.5"
                  style={{
                    width: 24,
                    height: 24,
                    background: isDone
                      ? GOLD
                      : isCurrent
                        ? "rgba(230,192,122,0.2)"
                        : "transparent",
                    border: isCurrent
                      ? `1.5px solid ${GOLD_HI}`
                      : !isDone
                        ? "1px solid rgba(230,220,200,0.22)"
                        : "none",
                  }}
                >
                  {isDone ? (
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="#0A1428" strokeWidth="3">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  ) : isCurrent ? (
                    <div
                      className="pulse-ring"
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: GOLD_HI,
                      }}
                    />
                  ) : (
                    <span
                      className="font-mono"
                      style={{
                        color: "rgba(230,220,200,0.45)",
                        fontSize: 10,
                        fontWeight: 600,
                      }}
                    >
                      {i + 1}
                    </span>
                  )}
                </div>

                {/* Lesson title + meta */}
                <div className="flex-1 min-w-0">
                  <p
                    style={{
                      fontFamily: "Cormorant Garamond, serif",
                      fontStyle: "italic",
                      fontSize: 15,
                      fontWeight: 500,
                      color: INK,
                      lineHeight: 1.25,
                      marginBottom: 3,
                    }}
                  >
                    {lesson.title}
                  </p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className="font-mono uppercase"
                      style={{
                        fontSize: 9,
                        letterSpacing: "0.16em",
                        color: isCurrent
                          ? GOLD
                          : "rgba(230,220,200,0.42)",
                      }}
                    >
                      {LESSON_TYPE_LABELS[lesson.type]}
                    </span>
                    {lesson.duration_label && (
                      <>
                        <span style={{ color: "rgba(230,220,200,0.25)", fontSize: 10 }}>
                          ·
                        </span>
                        <span
                          className="font-mono"
                          style={{
                            fontSize: 10,
                            color: "rgba(230,220,200,0.42)",
                            letterSpacing: "0.04em",
                          }}
                        >
                          {lesson.duration_label}
                        </span>
                      </>
                    )}
                    {lesson.is_gate && (
                      <span
                        className="font-mono uppercase"
                        style={{
                          fontSize: 9,
                          letterSpacing: "0.16em",
                          color: GOLD_HI,
                          background: "rgba(230,192,122,0.12)",
                          padding: "2px 6px",
                          borderRadius: 3,
                        }}
                      >
                        Discount
                      </span>
                    )}
                    {lesson.is_boss && (
                      <span
                        className="font-mono uppercase"
                        style={{
                          fontSize: 9,
                          letterSpacing: "0.16em",
                          color: "#F0A0A8",
                          background: "rgba(196,74,84,0.18)",
                          padding: "2px 6px",
                          borderRadius: 3,
                        }}
                      >
                        Final
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Prev / Next region footer */}
      <div
        className="flex"
        style={{ borderTop: "1px solid rgba(230,192,122,0.15)" }}
      >
        <button
          onClick={onPrev ?? undefined}
          disabled={!onPrev}
          className="flex-1 px-5 py-4 text-left transition-colors"
          style={{
            background: "transparent",
            border: "none",
            borderRight: "1px solid rgba(230,192,122,0.12)",
            color: onPrev ? "rgba(230,220,200,0.85)" : "rgba(230,220,200,0.3)",
            cursor: onPrev ? "pointer" : "default",
          }}
          onMouseEnter={(e) => {
            if (!onPrev) return;
            e.currentTarget.style.background = "rgba(230,192,122,0.08)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
          }}
        >
          <p
            className="font-mono uppercase"
            style={{
              fontSize: 9,
              letterSpacing: "0.2em",
              color: "rgba(230,220,200,0.5)",
            }}
          >
            Previous
          </p>
          <p
            className="italic"
            style={{
              fontFamily: "Cormorant Garamond, serif",
              fontSize: 15,
              fontWeight: 500,
            }}
          >
            ← {onPrev ? "Go back" : "—"}
          </p>
        </button>
        <button
          onClick={onNext ?? undefined}
          disabled={!onNext}
          className="flex-1 px-5 py-4 text-right transition-colors"
          style={{
            background: "transparent",
            border: "none",
            color: onNext ? "rgba(230,220,200,0.85)" : "rgba(230,220,200,0.3)",
            cursor: onNext ? "pointer" : "default",
          }}
          onMouseEnter={(e) => {
            if (!onNext) return;
            e.currentTarget.style.background = "rgba(230,192,122,0.08)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
          }}
        >
          <p
            className="font-mono uppercase"
            style={{
              fontSize: 9,
              letterSpacing: "0.2em",
              color: "rgba(230,220,200,0.5)",
            }}
          >
            Next region
          </p>
          <p
            className="italic"
            style={{
              fontFamily: "Cormorant Garamond, serif",
              fontSize: 15,
              fontWeight: 500,
            }}
          >
            {onNext ? "Onward" : "—"} →
          </p>
        </button>
      </div>
    </aside>
  );
}
