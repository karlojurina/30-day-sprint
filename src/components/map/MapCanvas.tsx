"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useStudent } from "@/contexts/StudentContext";
import {
  MAP_W,
  MAP_H,
  REGION_STRIPS,
  buildExplorerWaypoints,
  catmullRomToBezier,
  samplePath,
  placeLessons,
  type RegionStripMap,
} from "@/lib/map/path-math";
import { LessonNode, HoverPreviewCard } from "./LessonNode";
import { RegionCartouche } from "./MapChrome";

interface MapCanvasProps {
  onOpenLesson: (lessonId: string) => void;
  onLockedRegion: (regionId: string) => void;
  panTarget: string | null;
  setPanTarget: Dispatch<SetStateAction<string | null>>;
}

const MAX_ZOOM = 1.4;

/**
 * The Expedition Map canvas. Pan/zoom with cover-fit bounds so the map
 * always fills the viewport; no dark margins appear around it. The chart
 * frame / corner ornaments / compass / scale bar / legend were all removed
 * so the map IS the page.
 */
export function MapCanvas({
  onOpenLesson,
  onLockedRegion,
  panTarget,
  setPanTarget,
}: MapCanvasProps) {
  const {
    regions,
    lessons,
    completedLessonIds,
    currentLesson,
    regionProgress,
  } = useStudent();

  const outerRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 0.6 });
  const [isDragging, setIsDragging] = useState(false);
  const [hasFitted, setHasFitted] = useState(false);
  const [hasAutoZoomed, setHasAutoZoomed] = useState(false);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const mouseDownPos = useRef<{ x: number; y: number } | null>(null);
  const wasDragged = useRef(false);
  const animRef = useRef<number | null>(null);
  const coverScaleRef = useRef(0.5);
  const [hoveredLessonId, setHoveredLessonId] = useState<string | null>(null);

  // Delight: track newly-completed lessons and regions so we can fire a
  // short pulse / ribbon animation exactly once per new completion.
  const prevCompletionsRef = useRef<Set<string>>(new Set());
  const prevCompleteRegionsRef = useRef<Set<string>>(new Set());
  const [justCompletedLessonIds, setJustCompletedLessonIds] = useState<Set<string>>(new Set());
  const [justChartedRegionIds, setJustChartedRegionIds] = useState<Set<string>>(new Set());

  // Path — stable across renders
  const { pathD, sampled } = useMemo(() => {
    const spine = buildExplorerWaypoints();
    const sp = samplePath(spine, 1400);
    return { pathD: catmullRomToBezier(spine), sampled: sp };
  }, []);

  const placed = useMemo(() => {
    if (lessons.length === 0) return [];
    return placeLessons(sampled, lessons);
  }, [sampled, lessons]);

  const placedById = useMemo(() => {
    const m = new Map<string, (typeof placed)[number]>();
    for (const p of placed) m.set(p.lessonId, p);
    return m;
  }, [placed]);

  const currentIdx = useMemo(() => {
    if (!currentLesson) return -1;
    return placed.findIndex((p) => p.lessonId === currentLesson.id);
  }, [placed, currentLesson]);

  const completedThroughT = useMemo(() => {
    let lastT = -1;
    for (const n of placed) {
      if (completedLessonIds.has(n.lessonId)) lastT = n.t;
      else break;
    }
    return lastT;
  }, [placed, completedLessonIds]);

  const completedPathD = useMemo(() => {
    if (completedThroughT < 0) return "";
    const pts = sampled.points.filter((p) => p.t <= completedThroughT + 0.002);
    if (pts.length < 2) return "";
    const simplified = pts.filter((_, i, a) => i === 0 || i === a.length - 1 || i % 4 === 0);
    return catmullRomToBezier(simplified);
  }, [sampled, completedThroughT]);

  // Clamp a transform so the map always covers the viewport.
  // Caller passes scale + desired x/y; we return the nearest valid transform.
  const clampTransform = useCallback(
    (t: { x: number; y: number; scale: number }) => {
      const el = outerRef.current;
      if (!el) return t;
      const vw = el.clientWidth;
      const vh = el.clientHeight;
      // Minimum scale = cover (map fills viewport in both dimensions)
      const coverScale = Math.max(vw / MAP_W, vh / MAP_H);
      const scale = Math.max(coverScale, Math.min(MAX_ZOOM, t.scale));
      const mw = MAP_W * scale;
      const mh = MAP_H * scale;
      return {
        scale,
        x: Math.max(vw - mw, Math.min(0, t.x)),
        y: Math.max(vh - mh, Math.min(0, t.y)),
      };
    },
    []
  );

  // Fit: the map fills the viewport (cover-fit, not contain)
  const fitCover = useCallback(() => {
    const el = outerRef.current;
    if (!el) return null;
    const sW = el.clientWidth / MAP_W;
    const sH = el.clientHeight / MAP_H;
    const scale = Math.max(sW, sH);
    coverScaleRef.current = scale;
    const x = (el.clientWidth - MAP_W * scale) / 2;
    const y = (el.clientHeight - MAP_H * scale) / 2;
    return { x, y, scale };
  }, []);

  useEffect(() => {
    if (hasFitted) return;
    const t = fitCover();
    if (t) {
      setTransform(t);
      setHasFitted(true);
    }
  }, [fitCover, hasFitted]);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const onResize = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        const t = fitCover();
        if (t)
          setTransform((prev) =>
            clampTransform({ ...prev, scale: Math.max(t.scale, prev.scale) })
          );
      }, 150);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [fitCover, clampTransform]);

  const animateTo = useCallback(
    (target: { x: number; y: number; scale: number }) => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      const clamped = clampTransform(target);
      const start = { ...transform };
      const startTime = performance.now();
      const dur = 800;
      const ease = (t: number) =>
        t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const step = (now: number) => {
        const t = Math.min(1, (now - startTime) / dur);
        const e = ease(t);
        setTransform({
          x: start.x + (clamped.x - start.x) * e,
          y: start.y + (clamped.y - start.y) * e,
          scale: start.scale + (clamped.scale - start.scale) * e,
        });
        if (t < 1) animRef.current = requestAnimationFrame(step);
      };
      animRef.current = requestAnimationFrame(step);
    },
    [transform, clampTransform]
  );

  const zoomToPoint = useCallback(
    (x: number, y: number, scale: number) => {
      const el = outerRef.current;
      if (!el) return;
      const tx = el.clientWidth / 2 - x * scale;
      const ty = el.clientHeight / 2 - y * scale;
      animateTo({ x: tx, y: ty, scale });
    },
    [animateTo]
  );

  // Auto-zoom to current lesson ~900ms after the initial fit, so the student
  // briefly sees the whole map, then the camera glides to where they are.
  useEffect(() => {
    if (!hasFitted || hasAutoZoomed || placed.length === 0) return;
    if (!currentLesson) {
      setHasAutoZoomed(true);
      return;
    }
    // Don't auto-zoom into a locked region
    const region = regions.find((r) => r.id === currentLesson.region_id);
    const regionUnlocked = region
      ? regionProgress[region.id]?.isUnlocked
      : false;
    if (!regionUnlocked) {
      setHasAutoZoomed(true);
      return;
    }
    const n = placedById.get(currentLesson.id);
    if (!n) {
      setHasAutoZoomed(true);
      return;
    }
    const id = window.setTimeout(() => {
      zoomToPoint(n.x, n.y, 1.0);
      setHasAutoZoomed(true);
    }, 900);
    return () => window.clearTimeout(id);
  }, [
    hasFitted,
    hasAutoZoomed,
    currentLesson,
    regions,
    regionProgress,
    placed.length,
    placedById,
    zoomToPoint,
  ]);

  // Diff completions + region completions against the previous render. Fire
  // the delight animation ONCE per new completion, then clear it after the
  // animation duration so the node settles back into its normal "done" state.
  useEffect(() => {
    // On first render, seed the "seen" sets so the initial load (with
    // pre-existing completions) doesn't trigger a pulse on every node.
    if (prevCompletionsRef.current.size === 0 && completedLessonIds.size > 0) {
      prevCompletionsRef.current = new Set(completedLessonIds);
      prevCompleteRegionsRef.current = new Set(
        regions.filter((r) => regionProgress[r.id]?.isComplete).map((r) => r.id)
      );
      return;
    }

    // Lesson-level: anything in completedLessonIds not in the previous set
    const newLessons = new Set<string>();
    for (const id of completedLessonIds) {
      if (!prevCompletionsRef.current.has(id)) newLessons.add(id);
    }
    if (newLessons.size > 0) {
      setJustCompletedLessonIds(newLessons);
      window.setTimeout(() => setJustCompletedLessonIds(new Set()), 1100);
    }
    prevCompletionsRef.current = new Set(completedLessonIds);

    // Region-level: regions that JUST became complete
    const newRegions = new Set<string>();
    for (const r of regions) {
      const isComplete = regionProgress[r.id]?.isComplete;
      if (isComplete && !prevCompleteRegionsRef.current.has(r.id)) {
        newRegions.add(r.id);
      }
    }
    if (newRegions.size > 0) {
      setJustChartedRegionIds(newRegions);
      window.setTimeout(() => setJustChartedRegionIds(new Set()), 2200);
    }
    prevCompleteRegionsRef.current = new Set(
      regions.filter((r) => regionProgress[r.id]?.isComplete).map((r) => r.id)
    );
  }, [completedLessonIds, regions, regionProgress]);

  // Respond to panTarget changes (fired by topbar, map controls, notebook)
  useEffect(() => {
    if (!panTarget) return;
    if (panTarget === "out") {
      const t = fitCover();
      if (t) animateTo(t);
    } else if (panTarget === "current" && currentIdx >= 0) {
      const n = placed[currentIdx];
      zoomToPoint(n.x, n.y, 1.0);
    } else {
      const n = placedById.get(panTarget);
      if (n) zoomToPoint(n.x, n.y, 1.0);
    }
    setPanTarget(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panTarget]);

  const onMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("[data-node]")) return;
    wasDragged.current = false;
    mouseDownPos.current = { x: e.clientX, y: e.clientY };
    setIsDragging(true);
    dragStart.current = { x: e.clientX - transform.x, y: e.clientY - transform.y };
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDragging || !dragStart.current) return;
      if (mouseDownPos.current) {
        const dx = Math.abs(e.clientX - mouseDownPos.current.x);
        const dy = Math.abs(e.clientY - mouseDownPos.current.y);
        if (dx + dy > 5) wasDragged.current = true;
      }
      setTransform((t) =>
        clampTransform({
          ...t,
          x: e.clientX - dragStart.current!.x,
          y: e.clientY - dragStart.current!.y,
        })
      );
    };
    const onUp = () => {
      setIsDragging(false);
      dragStart.current = null;
      mouseDownPos.current = null;
      setTimeout(() => {
        wasDragged.current = false;
      }, 0);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isDragging, clampTransform]);

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const el = outerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const delta = -e.deltaY * 0.0015;
    const coverScale = Math.max(el.clientWidth / MAP_W, el.clientHeight / MAP_H);
    const nextScale = Math.max(
      coverScale,
      Math.min(MAX_ZOOM, transform.scale * (1 + delta))
    );
    const factor = nextScale / transform.scale;
    const next = {
      scale: nextScale,
      x: mx - (mx - transform.x) * factor,
      y: my - (my - transform.y) * factor,
    };
    setTransform(clampTransform(next));
  };

  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    touchStart.current = { x: t.clientX - transform.x, y: t.clientY - transform.y };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length !== 1 || !touchStart.current) return;
    const t = e.touches[0];
    setTransform((prev) =>
      clampTransform({
        ...prev,
        x: t.clientX - touchStart.current!.x,
        y: t.clientY - touchStart.current!.y,
      })
    );
  };

  // Hovered-lesson details for the top-layer preview card
  const hoveredLesson = hoveredLessonId
    ? lessons.find((l) => l.id === hoveredLessonId)
    : null;
  const hoveredPlaced = hoveredLessonId ? placedById.get(hoveredLessonId) : null;
  const hoveredNodeR = useMemo(() => {
    if (!hoveredLesson) return 18;
    if (hoveredLesson.is_boss) return 28;
    if (hoveredLesson.is_gate) return 44;
    return 22;
  }, [hoveredLesson]);

  return (
    <div
      ref={outerRef}
      onMouseDown={onMouseDown}
      onWheel={onWheel}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        cursor: isDragging ? "grabbing" : "grab",
        background: `
          radial-gradient(ellipse 70% 50% at 50% 42%, rgba(77,160,216,0.14) 0%, transparent 60%),
          linear-gradient(180deg, #060C1A 0%, #0A1428 50%, #060C1A 100%)
        `,
      }}
    >
      {/* Parchment grain layer */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          zIndex: 1,
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0.9 0 0 0 0 0.95 0 0 0 0 1 0 0 0 0.08 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
          opacity: 0.6,
        }}
      />

      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: MAP_W,
          height: MAP_H,
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          transformOrigin: "0 0",
          willChange: "transform",
        }}
      >
        {/* Painted region images — HTML layer beneath the SVG */}
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          {regions.map((r) => {
            const s = REGION_STRIPS[r.id as keyof RegionStripMap];
            if (!s) return null;
            const st = regionProgress[r.id];
            return (
              <div
                key={`img-${r.id}`}
                style={{
                  position: "absolute",
                  left: s.xStart,
                  top: s.yTop,
                  width: s.xEnd - s.xStart,
                  height: s.yBot - s.yTop,
                  backgroundImage: `url("${s.image}")`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                  filter: st?.isUnlocked ? "none" : "brightness(0.7) saturate(0.8)",
                  opacity: st?.isUnlocked ? 1 : 0.75,
                  transition: "filter 0.8s ease, opacity 0.8s ease",
                }}
              />
            );
          })}
        </div>

        <svg
          width={MAP_W}
          height={MAP_H}
          viewBox={`0 0 ${MAP_W} ${MAP_H}`}
          style={{ position: "absolute", inset: 0, display: "block" }}
        >
          <defs>
            <radialGradient id="chart-vignette" cx="50%" cy="50%" r="62%">
              <stop offset="60%" stopColor="rgba(6,12,26,0)" />
              <stop offset="100%" stopColor="rgba(6,12,26,0.65)" />
            </radialGradient>
            <linearGradient id="path-completed" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#E6C07A" />
              <stop offset="100%" stopColor="#F0D595" />
            </linearGradient>
            <radialGradient id="you-fill" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#FFEBBA" />
              <stop offset="70%" stopColor="#E6C07A" />
              <stop offset="100%" stopColor="#C89A4A" />
            </radialGradient>
            <filter id="you-glow" x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur stdDeviation="10" />
            </filter>
            <pattern
              id="lock-hatch"
              x="0"
              y="0"
              width="16"
              height="16"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <line x1="0" y1="0" x2="0" y2="16" stroke="rgba(10,20,40,0.5)" strokeWidth="14" />
            </pattern>
          </defs>

          {/* Region seams */}
          {regions.slice(0, -1).map((r) => {
            const s = REGION_STRIPS[r.id as keyof RegionStripMap];
            if (!s) return null;
            return (
              <line
                key={`seam-${r.id}`}
                x1={s.xEnd}
                y1={90}
                x2={s.xEnd}
                y2={MAP_H - 90}
                stroke="rgba(230,220,200,0.2)"
                strokeWidth="1"
                strokeDasharray="2 10"
              />
            );
          })}

          {/* Locked-region FOG — rect + hatch only. Lock icon lives in a later
              render pass so it sits above the path. */}
          {regions.map((r) => {
            const s = REGION_STRIPS[r.id as keyof RegionStripMap];
            if (!s) return null;
            const st = regionProgress[r.id];
            if (st?.isUnlocked) return null;
            return (
              <g key={`veil-${r.id}`} style={{ pointerEvents: "none" }}>
                <rect
                  x={s.xStart}
                  y={s.yTop}
                  width={s.xEnd - s.xStart}
                  height={s.yBot - s.yTop}
                  fill="rgba(6,12,26,0.42)"
                />
                <rect
                  x={s.xStart}
                  y={s.yTop}
                  width={s.xEnd - s.xStart}
                  height={s.yBot - s.yTop}
                  fill="url(#lock-hatch)"
                  opacity="0.18"
                />
              </g>
            );
          })}

          {/* Main dashed path */}
          <path
            d={pathD}
            fill="none"
            stroke="rgba(230,192,122,0.35)"
            strokeWidth="5"
            strokeDasharray="3 14"
            strokeLinecap="round"
          />

          {/* Completed overlay */}
          {completedPathD && (
            <path
              d={completedPathD}
              fill="none"
              stroke="url(#path-completed)"
              strokeWidth="7"
              strokeLinecap="round"
            />
          )}

          {/* Vignette */}
          <rect
            x="60"
            y="60"
            width={MAP_W - 120}
            height={MAP_H - 120}
            fill="url(#chart-vignette)"
            pointerEvents="none"
          />

          {/* Region cartouches — still useful to label each region */}
          {regions.map((r) => {
            const s = REGION_STRIPS[r.id as keyof RegionStripMap];
            const st = regionProgress[r.id];
            if (!s || !st) return null;
            return <RegionCartouche key={r.id} region={r} regionStrip={s} state={st} />;
          })}

          {/* Lesson nodes */}
          {placed.map((n) => {
            const lesson = lessons.find((l) => l.id === n.lessonId);
            if (!lesson) return null;
            const isDone = completedLessonIds.has(n.lessonId);
            const isCurrent = n.lessonId === currentLesson?.id;
            const regionUnlocked = regionProgress[n.regionId]?.isUnlocked ?? false;
            const prevIdx = placed.findIndex((p) => p.lessonId === n.lessonId) - 1;
            const prevDone =
              prevIdx < 0 || completedLessonIds.has(placed[prevIdx].lessonId);
            const isUnlocked = regionUnlocked && (prevDone || isCurrent || isDone);

            return (
              <g key={n.lessonId} transform={`translate(${n.x}, ${n.y})`}>
                <LessonNode
                  lesson={lesson}
                  x={0}
                  y={0}
                  isDone={isDone}
                  isCurrent={isCurrent}
                  isUnlocked={isUnlocked}
                  regionLocked={!regionUnlocked}
                  justCompleted={justCompletedLessonIds.has(n.lessonId)}
                  onClick={() =>
                    regionUnlocked ? onOpenLesson(lesson.id) : onLockedRegion(n.regionId)
                  }
                  onHoverStart={
                    regionUnlocked ? () => setHoveredLessonId(lesson.id) : undefined
                  }
                  onHoverEnd={() => setHoveredLessonId(null)}
                  peerCount={0}
                />
              </g>
            );
          })}

          {/* Lock icons — rendered AFTER the lesson nodes so they sit on top
              of every node in the locked region. Clicking opens the prompt. */}
          {regions.map((r) => {
            const s = REGION_STRIPS[r.id as keyof RegionStripMap];
            if (!s) return null;
            const st = regionProgress[r.id];
            if (st?.isUnlocked) return null;
            return (
              <g
                key={`lock-${r.id}`}
                data-locked-region={r.id}
                role="button"
                tabIndex={0}
                aria-label={`${r.name} — region locked, complete the previous region to unlock`}
                style={{ cursor: "pointer" }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (wasDragged.current) return;
                  onLockedRegion(r.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onLockedRegion(r.id);
                  }
                }}
                transform={`translate(${(s.xStart + s.xEnd) / 2}, ${(s.yTop + s.yBot) / 2})`}
              >
                <circle r="72" fill="rgba(6,12,26,0.92)" stroke="rgba(230,192,122,0.75)" strokeWidth="2.4" />
                <g transform="translate(-28, -28)">
                  <rect x="0" y="24" width="56" height="44" rx="6" fill="none" stroke="#E6C07A" strokeWidth="4" />
                  <path d="M 10 24 V 14 a 18 18 0 0 1 36 0 V 24" fill="none" stroke="#E6C07A" strokeWidth="4" />
                  <circle cx="28" cy="46" r="5" fill="#E6C07A" />
                  <rect x="26" y="48" width="4" height="12" fill="#E6C07A" />
                </g>
              </g>
            );
          })}

          {/* Hover preview — rendered AFTER all nodes so it's never clipped
              by a later-drawn neighbor. */}
          {hoveredLesson && hoveredPlaced && (
            <HoverPreviewCard
              lesson={hoveredLesson}
              x={hoveredPlaced.x}
              y={hoveredPlaced.y}
              r={hoveredNodeR}
            />
          )}

          {/* Region-charted ribbon — fires once for ~2s when a region's last
              lesson completes. Positioned above each region cartouche. */}
          {regions.map((r) => {
            if (!justChartedRegionIds.has(r.id)) return null;
            const s = REGION_STRIPS[r.id as keyof RegionStripMap];
            if (!s) return null;
            const xMid = (s.xStart + s.xEnd) / 2;
            const yRibbon = s.yTop - 150;
            return (
              <g
                key={`charted-${r.id}`}
                transform={`translate(${xMid}, ${yRibbon})`}
                className="region-charted-ribbon"
                style={{ pointerEvents: "none" }}
              >
                <rect
                  x={-130}
                  y={-22}
                  width={260}
                  height={44}
                  rx="6"
                  fill="#0A1428"
                  stroke="#F0D595"
                  strokeWidth="1.8"
                />
                <rect
                  x={-124}
                  y={-16}
                  width={248}
                  height={32}
                  rx="3"
                  fill="none"
                  stroke="rgba(230,192,122,0.45)"
                  strokeWidth="0.7"
                />
                <text
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontFamily="JetBrains Mono, ui-monospace, monospace"
                  fontSize="11"
                  fontWeight="700"
                  fill="#F0D595"
                  letterSpacing="5"
                  y={-4}
                >
                  REGION CHARTED
                </text>
                <text
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontFamily="Cormorant Garamond, serif"
                  fontStyle="italic"
                  fontSize="14"
                  fill="#E6DCC8"
                  y={13}
                >
                  {r.name}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
