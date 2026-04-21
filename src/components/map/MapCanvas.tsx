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
import { LessonNode, YouAreHere } from "./LessonNode";
import {
  RegionCartouche,
  CompassRose,
  ScaleBar,
  MapLegend,
  CornerOrnament,
} from "./MapChrome";

interface MapCanvasProps {
  onOpenLesson: (lessonId: string) => void;
  onLockedRegion: (regionId: string) => void;
  panTarget: string | null; // lessonId | "out" | "current" | null
  setPanTarget: Dispatch<SetStateAction<string | null>>;
}

/**
 * The Expedition Map canvas: pan/zoom, painted region backgrounds,
 * main path + completed overlay, lesson nodes, region cartouches.
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
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 0.4 });
  const [isDragging, setIsDragging] = useState(false);
  const [hasFitted, setHasFitted] = useState(false);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const mouseDownPos = useRef<{ x: number; y: number } | null>(null);
  const wasDragged = useRef(false);
  const animRef = useRef<number | null>(null);

  // Build path — stable across renders
  const { pathD, sampled } = useMemo(() => {
    const spine = buildExplorerWaypoints();
    const sp = samplePath(spine, 1400);
    return { pathD: catmullRomToBezier(spine), sampled: sp };
  }, []);

  // Place lessons on the path
  const placed = useMemo(() => {
    if (lessons.length === 0) return [];
    return placeLessons(sampled, lessons);
  }, [sampled, lessons]);

  // Index of current lesson in placed
  const currentIdx = useMemo(() => {
    if (!currentLesson) return -1;
    return placed.findIndex((p) => p.lessonId === currentLesson.id);
  }, [placed, currentLesson]);

  // Completed-through t (furthest t where all prior lessons are done)
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
    // Simplify: keep every 4th point plus endpoints
    const simplified = pts.filter((_, i, a) => i === 0 || i === a.length - 1 || i % 4 === 0);
    return catmullRomToBezier(simplified);
  }, [sampled, completedThroughT]);

  // Fit-to-all on mount
  const fitAll = useCallback(() => {
    const el = outerRef.current;
    if (!el) return null;
    const pad = 40;
    const sW = (el.clientWidth - pad * 2) / MAP_W;
    const sH = (el.clientHeight - pad * 2) / MAP_H;
    const scale = Math.min(sW, sH);
    const x = (el.clientWidth - MAP_W * scale) / 2;
    const y = (el.clientHeight - MAP_H * scale) / 2;
    return { x, y, scale };
  }, []);

  useEffect(() => {
    if (hasFitted) return;
    const t = fitAll();
    if (t) {
      setTransform(t);
      setHasFitted(true);
    }
  }, [fitAll, hasFitted]);

  useEffect(() => {
    const onResize = () => {
      const t = fitAll();
      if (t) setTransform(t);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [fitAll]);

  // Animated zoom to a point
  const animateTo = useCallback(
    (target: { x: number; y: number; scale: number }) => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      const start = { ...transform };
      const startTime = performance.now();
      const dur = 650;
      const ease = (t: number) =>
        t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const step = (now: number) => {
        const t = Math.min(1, (now - startTime) / dur);
        const e = ease(t);
        setTransform({
          x: start.x + (target.x - start.x) * e,
          y: start.y + (target.y - start.y) * e,
          scale: start.scale + (target.scale - start.scale) * e,
        });
        if (t < 1) animRef.current = requestAnimationFrame(step);
      };
      animRef.current = requestAnimationFrame(step);
    },
    [transform]
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

  // Respond to panTarget changes
  useEffect(() => {
    if (!panTarget) return;
    if (panTarget === "out") {
      const t = fitAll();
      if (t) animateTo(t);
    } else if (panTarget === "current" && currentIdx >= 0) {
      const n = placed[currentIdx];
      zoomToPoint(n.x, n.y, 1.0);
    } else {
      const n = placed.find((p) => p.lessonId === panTarget);
      if (n) zoomToPoint(n.x, n.y, 1.0);
    }
    setPanTarget(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panTarget]);

  // Drag panning — starts from anywhere EXCEPT directly on a lesson node.
  // Locked-region clicks are suppressed by checking wasDragged.
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
      setTransform((t) => ({
        ...t,
        x: e.clientX - dragStart.current!.x,
        y: e.clientY - dragStart.current!.y,
      }));
    };
    const onUp = () => {
      setIsDragging(false);
      dragStart.current = null;
      mouseDownPos.current = null;
      // Keep wasDragged true until the synthetic click fires, then reset.
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
  }, [isDragging]);

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const el = outerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const delta = -e.deltaY * 0.0015;
    // Cap max zoom to 1.2 — region PNGs start pixelating above that.
    const nextScale = Math.max(0.25, Math.min(1.2, transform.scale * (1 + delta)));
    const factor = nextScale / transform.scale;
    setTransform({
      scale: nextScale,
      x: mx - (mx - transform.x) * factor,
      y: my - (my - transform.y) * factor,
    });
  };

  // Touch for mobile pan (simple — no pinch)
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    touchStart.current = { x: t.clientX - transform.x, y: t.clientY - transform.y };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length !== 1 || !touchStart.current) return;
    const t = e.touches[0];
    setTransform((prev) => ({
      ...prev,
      x: t.clientX - touchStart.current!.x,
      y: t.clientY - touchStart.current!.y,
    }));
  };

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
      {/* Subtle parchment grain layer */}
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
        {/* Painted region images (HTML layer, beneath the SVG) */}
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
                  imageRendering: "auto",
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
            <clipPath id="chart-clip">
              <rect x="60" y="60" width={MAP_W - 120} height={MAP_H - 120} rx="18" ry="18" />
            </clipPath>
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

          {/* Chart outer frame */}
          <rect
            x="32"
            y="32"
            width={MAP_W - 64}
            height={MAP_H - 64}
            rx="24"
            ry="24"
            fill="none"
            stroke="rgba(230,220,200,0.22)"
            strokeWidth="2"
          />
          <rect
            x="42"
            y="42"
            width={MAP_W - 84}
            height={MAP_H - 84}
            rx="20"
            ry="20"
            fill="none"
            stroke="rgba(230,220,200,0.12)"
            strokeWidth="1"
          />

          <g clipPath="url(#chart-clip)">
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

            {/* Locked-region veils */}
            {regions.map((r) => {
              const s = REGION_STRIPS[r.id as keyof RegionStripMap];
              if (!s) return null;
              const st = regionProgress[r.id];
              if (st?.isUnlocked) return null;
              return (
                <g
                  key={`veil-${r.id}`}
                  data-locked-region={r.id}
                  style={{ cursor: "pointer" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (wasDragged.current) return;
                    onLockedRegion(r.id);
                  }}
                >
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
                  {/* Key icon, centered — no "LOCKED" text */}
                  <g
                    transform={`translate(${(s.xStart + s.xEnd) / 2}, ${(s.yTop + s.yBot) / 2})`}
                  >
                    <circle r="72" fill="rgba(6,12,26,0.82)" stroke="rgba(230,192,122,0.55)" strokeWidth="2" />
                    {/* Padlock, vertically centered inside the 144x144 circle */}
                    <g transform="translate(-28, -28)">
                      <rect x="0" y="24" width="56" height="44" rx="6" fill="none" stroke="#E6C07A" strokeWidth="4" />
                      <path d="M 10 24 V 14 a 18 18 0 0 1 36 0 V 24" fill="none" stroke="#E6C07A" strokeWidth="4" />
                      <circle cx="28" cy="46" r="5" fill="#E6C07A" />
                      <rect x="26" y="48" width="4" height="12" fill="#E6C07A" />
                    </g>
                  </g>
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
          </g>

          {/* Corner ornaments */}
          <CornerOrnament x={70} y={70} />
          <CornerOrnament x={MAP_W - 70} y={70} rot={90} />
          <CornerOrnament x={MAP_W - 70} y={MAP_H - 70} rot={180} />
          <CornerOrnament x={70} y={MAP_H - 70} rot={270} />

          <CompassRose x={MAP_W - 180} y={200} />
          <ScaleBar x={130} y={MAP_H - 130} />
          <MapLegend x={MAP_W - 480} y={MAP_H - 170} />

          {/* Region cartouches */}
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
            // Unlocked if region is unlocked AND (previous lesson in region is done, or is current/done itself)
            const prevIdx = placed.findIndex((p) => p.lessonId === n.lessonId) - 1;
            const prevDone =
              prevIdx < 0 || completedLessonIds.has(placed[prevIdx].lessonId);
            const isUnlocked = regionUnlocked && (prevDone || isCurrent || isDone);

            return (
              <LessonNode
                key={n.lessonId}
                lesson={lesson}
                x={n.x}
                y={n.y}
                isDone={isDone}
                isCurrent={isCurrent}
                isUnlocked={isUnlocked}
                regionLocked={!regionUnlocked}
                onClick={() =>
                  regionUnlocked ? onOpenLesson(lesson.id) : onLockedRegion(n.regionId)
                }
                peerCount={0}
              />
            );
          })}

          {/* "You are here" marker */}
          {currentIdx >= 0 &&
            regionProgress[placed[currentIdx].regionId]?.isUnlocked && (
              <YouAreHere x={placed[currentIdx].x} y={placed[currentIdx].y} />
            )}
        </svg>
      </div>
    </div>
  );
}
