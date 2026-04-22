"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { gsap } from "gsap";
import { useStudent } from "@/contexts/StudentContext";
import {
  MAP_W,
  MAP_H,
  type RegionStripMap,
} from "@/lib/map/path-math";
import { LESSON_TYPE_LABELS } from "@/lib/constants";
import type { Lesson } from "@/types/database";
import { CloudTransition } from "./CloudTransition";

interface MapMockupProps {
  onOpenLesson: (lessonId: string) => void;
}

type RegionId = keyof RegionStripMap;
type View = "overview" | RegionId;

const SIDE_PANEL_WIDTH = 420;

const GOLD = "#E6C07A";
const GOLD_HI = "#F0D595";
const INK = "#E6DCC8";

/**
 * Puzzle-piece region hit zones — irregular ellipses positioned organically
 * over the main_image.png panorama. Coordinates are in the 3200×1400 map
 * coordinate space (not image pixels).
 *
 * The regions are NOT horizontal strips. Each is an ellipse roughly matching
 * its visible feature on the painted panorama:
 *   R1 — harbor / dock / sailboat (bottom-left)
 *   R2 — valley cabin / grass meadow (center, slightly low)
 *   R3 — mountain switchback + waterfall (center-right)
 *   R4 — summit archway + ruins (top-right)
 */
interface RegionZone {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** Tilt in degrees — gives the hit zone an organic, non-axis-aligned feel */
  rot: number;
  /** Focal point for the zoomed region view (may differ from cx/cy) */
  focusX: number;
  focusY: number;
}
const REGION_ZONES: Record<RegionId, RegionZone> = {
  r1: { cx: 480,  cy: 1080, rx: 440, ry: 260, rot: -8,  focusX: 480,  focusY: 1000 },
  r2: { cx: 1400, cy: 980,  rx: 470, ry: 290, rot: 4,   focusX: 1400, focusY: 900  },
  r3: { cx: 2100, cy: 720,  rx: 430, ry: 300, rot: -6,  focusX: 2100, focusY: 720  },
  r4: { cx: 2520, cy: 320,  rx: 400, ry: 260, rot: 10,  focusX: 2520, focusY: 320  },
};

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

  // Cloud-transition orchestration
  const [transitionCounter, setTransitionCounter] = useState(0);
  const pendingViewRef = useRef<View | null>(null);
  const [hoveredZone, setHoveredZone] = useState<RegionId | null>(null);

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

  // Default view: always start on the overview. The student opts into a region
  // by clicking its hit zone (which plays the cloud transition).
  useEffect(() => {
    if (outerSize.w === 0) return;
    setView("overview");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outerSize.w]);

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

    // Zoom into the region's focal point, leaving room for the side panel.
    // We target ~1.9× the overview scale so the landmark fills the frame.
    const z = REGION_ZONES[v];
    const usableW = vw - SIDE_PANEL_WIDTH;
    const sW = vw / MAP_W;
    const sH = vh / MAP_H;
    const overview = Math.max(sW, sH);
    const scale = overview * 1.9;
    return {
      x: usableW / 2 - z.focusX * scale,
      y: vh / 2 - z.focusY * scale,
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

  // Trigger a cloud transition then swap the view at peak coverage.
  const transitionTo = (next: View) => {
    if (pendingViewRef.current !== null) return; // already in flight
    pendingViewRef.current = next;
    setTransitionCounter((n) => n + 1);
  };

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
        {/* Base panorama — the whole website background (below topbar) */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: 'url("/regions/main_image.png")',
            backgroundSize: "cover",
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
          }}
        />

        {/* Dim overlay for locked regions (drawn ABOVE panorama, BELOW SVG) */}
        {view === "overview" &&
          regions.map((r) => {
            const z = REGION_ZONES[r.id as RegionId];
            const st = regionProgress[r.id];
            if (!z || !st || st.isUnlocked) return null;
            return (
              <div
                key={`fog-${r.id}`}
                style={{
                  position: "absolute",
                  left: z.cx - z.rx,
                  top: z.cy - z.ry,
                  width: z.rx * 2,
                  height: z.ry * 2,
                  transform: `rotate(${z.rot}deg)`,
                  borderRadius: "50%",
                  background: "rgba(6,12,26,0.55)",
                  backdropFilter: "saturate(0.5) brightness(0.7)",
                  WebkitBackdropFilter: "saturate(0.5) brightness(0.7)",
                  pointerEvents: "none",
                }}
              />
            );
          })}

        {/* SVG overlay — ellipse hit zones over the map (overview only) */}
        {view === "overview" && (
          <svg
            viewBox={`0 0 ${MAP_W} ${MAP_H}`}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              overflow: "visible",
            }}
          >
            <defs>
              <radialGradient id="zone-glow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="rgba(230,192,122,0.35)" />
                <stop offset="60%" stopColor="rgba(230,192,122,0.12)" />
                <stop offset="100%" stopColor="rgba(230,192,122,0)" />
              </radialGradient>
              <radialGradient id="zone-glow-hot" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="rgba(240,213,149,0.55)" />
                <stop offset="60%" stopColor="rgba(240,213,149,0.2)" />
                <stop offset="100%" stopColor="rgba(240,213,149,0)" />
              </radialGradient>
            </defs>

            {sortedRegions.map((r) => {
              const z = REGION_ZONES[r.id as RegionId];
              const st = regionProgress[r.id];
              if (!z || !st) return null;
              const locked = !st.isUnlocked;
              const hot = hoveredZone === r.id;
              const isCurrent =
                currentLesson?.region_id === r.id && !locked;
              const numeral = ["I", "II", "III", "IV"][r.order_num - 1];
              const stroke = st.isComplete ? GOLD_HI : locked ? "rgba(230,192,122,0.35)" : GOLD;
              return (
                <g
                  key={`zone-${r.id}`}
                  transform={`translate(${z.cx} ${z.cy}) rotate(${z.rot})`}
                  style={{
                    cursor: locked ? "not-allowed" : "pointer",
                    pointerEvents: "auto",
                  }}
                  onClick={() => !locked && transitionTo(r.id as RegionId)}
                  onMouseEnter={() => !locked && setHoveredZone(r.id as RegionId)}
                  onMouseLeave={() => setHoveredZone(null)}
                  onKeyDown={(e) => {
                    if (locked) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      transitionTo(r.id as RegionId);
                    }
                  }}
                  tabIndex={locked ? -1 : 0}
                  role="button"
                  aria-label={`${r.name} — ${st.completed}/${st.total} lessons${locked ? " (locked)" : ""}`}
                >
                  {/* Outer glow — brightens on hover */}
                  <ellipse
                    cx={0}
                    cy={0}
                    rx={z.rx}
                    ry={z.ry}
                    fill={hot ? "url(#zone-glow-hot)" : "url(#zone-glow)"}
                    style={{
                      transition: "opacity 0.4s cubic-bezier(0.22,1,0.36,1)",
                      opacity: locked ? 0.35 : 1,
                    }}
                  />

                  {/* Dashed perimeter — charted regions get solid gold, locked get faint */}
                  <ellipse
                    cx={0}
                    cy={0}
                    rx={z.rx * 0.92}
                    ry={z.ry * 0.92}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={hot ? 3 : 2}
                    strokeDasharray={locked ? "8 10" : st.isComplete ? "" : "14 8"}
                    opacity={hot ? 0.85 : 0.55}
                    style={{
                      transition: "opacity 0.4s, stroke-width 0.4s",
                    }}
                  />

                  {/* Pulsing ring on the student's current region */}
                  {isCurrent && (
                    <ellipse
                      cx={0}
                      cy={0}
                      rx={z.rx * 0.98}
                      ry={z.ry * 0.98}
                      fill="none"
                      stroke={GOLD_HI}
                      strokeWidth={2.5}
                      opacity={0.7}
                    >
                      <animate
                        attributeName="rx"
                        values={`${z.rx * 0.88};${z.rx * 1.04};${z.rx * 0.88}`}
                        dur="3.2s"
                        repeatCount="indefinite"
                      />
                      <animate
                        attributeName="ry"
                        values={`${z.ry * 0.88};${z.ry * 1.04};${z.ry * 0.88}`}
                        dur="3.2s"
                        repeatCount="indefinite"
                      />
                      <animate
                        attributeName="opacity"
                        values="0.25;0.75;0.25"
                        dur="3.2s"
                        repeatCount="indefinite"
                      />
                    </ellipse>
                  )}

                  {/* Center label */}
                  <g
                    transform={`rotate(${-z.rot})`}
                    style={{ pointerEvents: "none" }}
                  >
                    {/* Numeral plaque */}
                    <circle
                      cx={0}
                      cy={-28}
                      r={26}
                      fill="rgba(6,12,26,0.85)"
                      stroke={stroke}
                      strokeWidth={1.5}
                    />
                    <text
                      x={0}
                      y={-20}
                      textAnchor="middle"
                      style={{
                        fontFamily: "Cormorant Garamond, serif",
                        fontStyle: "italic",
                        fontWeight: 600,
                        fontSize: 26,
                        fill: stroke,
                      }}
                    >
                      {numeral}
                    </text>

                    {/* Region name */}
                    <text
                      x={0}
                      y={24}
                      textAnchor="middle"
                      style={{
                        fontFamily: "Cormorant Garamond, serif",
                        fontStyle: "italic",
                        fontWeight: 500,
                        fontSize: 34,
                        fill: INK,
                        paintOrder: "stroke fill",
                        stroke: "rgba(6,12,26,0.85)",
                        strokeWidth: 4,
                        strokeLinejoin: "round",
                      }}
                    >
                      {r.name}
                    </text>

                    {/* Progress / lock */}
                    <text
                      x={0}
                      y={52}
                      textAnchor="middle"
                      style={{
                        fontFamily: "JetBrains Mono, ui-monospace, monospace",
                        fontSize: 13,
                        letterSpacing: "0.22em",
                        fill: locked ? "rgba(230,220,200,0.55)" : GOLD,
                        textTransform: "uppercase",
                        paintOrder: "stroke fill",
                        stroke: "rgba(6,12,26,0.85)",
                        strokeWidth: 3,
                        strokeLinejoin: "round",
                      }}
                    >
                      {locked
                        ? "· LOCKED ·"
                        : st.isComplete
                          ? `CHARTED · ${st.total}`
                          : `${st.completed} / ${st.total} LESSONS`}
                    </text>

                    {/* Hover CTA */}
                    {hot && !locked && (
                      <text
                        x={0}
                        y={76}
                        textAnchor="middle"
                        style={{
                          fontFamily: "JetBrains Mono, ui-monospace, monospace",
                          fontSize: 11,
                          letterSpacing: "0.28em",
                          fill: GOLD_HI,
                          textTransform: "uppercase",
                          paintOrder: "stroke fill",
                          stroke: "rgba(6,12,26,0.85)",
                          strokeWidth: 3,
                          strokeLinejoin: "round",
                        }}
                      >
                        ENTER REGION →
                      </text>
                    )}
                  </g>
                </g>
              );
            })}
          </svg>
        )}
      </div>

      {/* Region side panel */}
      {focusedRegion && (
        <RegionSidePanel
          region={focusedRegion}
          lessons={focusedLessons}
          completedLessonIds={completedLessonIds}
          currentLessonId={currentLesson?.id ?? null}
          onOpenLesson={onOpenLesson}
          onBack={() => transitionTo("overview")}
          onPrev={prevRegion ? () => transitionTo(prevRegion.id as RegionId) : null}
          onNext={nextRegion ? () => transitionTo(nextRegion.id as RegionId) : null}
        />
      )}

      {/* Cloud scene-swap transition — fires at peak coverage */}
      <CloudTransition
        trigger={transitionCounter}
        duration={1.5}
        onPeak={() => {
          const next = pendingViewRef.current;
          if (next != null) {
            setView(next);
            pendingViewRef.current = null;
          }
        }}
      />
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
