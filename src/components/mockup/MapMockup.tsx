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
 * Puzzle-piece region hit zones — irregular closed polygons positioned over
 * the main_image.png panorama. Coordinates are in the 3200×1400 map space.
 *
 * Use `/dashboard-mockup/edit-regions` (the picker tool) to trace accurate
 * polygons and replace these values. Current placeholders are 16-point
 * ellipse approximations — close-ish but not precise.
 */
interface RegionZone {
  /** Closed polygon outline (last point auto-connects to first) */
  polygon: Array<{ x: number; y: number }>;
  /** Label position — usually polygon centroid but can be hand-tuned */
  labelX: number;
  labelY: number;
}

// Helper: build a polygon by sampling N points around an ellipse. Used for
// initial placeholder values only — real regions are irregular and should be
// traced with the region picker tool.
function ellipsePoly(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rotDeg: number,
  n = 16
): Array<{ x: number; y: number }> {
  const rot = (rotDeg * Math.PI) / 180;
  const cs = Math.cos(rot);
  const sn = Math.sin(rot);
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x0 = rx * Math.cos(a);
    const y0 = ry * Math.sin(a);
    pts.push({
      x: Math.round(cx + x0 * cs - y0 * sn),
      y: Math.round(cy + x0 * sn + y0 * cs),
    });
  }
  return pts;
}

// Re-traced from the new precise regions.png (2026-04-22):
//   R1 — port/harbor/dock (bottom-left). Kidney shape around the boats.
//   R2 — green valley with cabin (center-bottom). Wide horizontal shape.
//   R3 — waterfall/cliff/bridge (middle-right). Vertical-ish, narrower.
//   R4 — summit with archway (top). Wide horizontal shape across the peak.
// These are still ellipse approximations. Use /dashboard-mockup/edit-regions
// to trace pixel-accurate polygons and replace.
const REGION_ZONES: Record<RegionId, RegionZone> = {
  r1: {
    polygon: ellipsePoly(640, 1080, 384, 215, -5),
    labelX: 640,
    labelY: 1080,
  },
  r2: {
    polygon: ellipsePoly(1536, 1106, 480, 196, 0),
    labelX: 1536,
    labelY: 1106,
  },
  r3: {
    polygon: ellipsePoly(2080, 728, 336, 245, 0),
    labelX: 2080,
    labelY: 728,
  },
  r4: {
    polygon: ellipsePoly(2016, 294, 464, 217, 0),
    labelX: 2016,
    labelY: 294,
  },
};

// ──────────────────────────────────────────────────────────────
// Scene data — per-region background image + red-line waypoints.
// Regions without a scene image fall back to zoom-on-main.
// Waypoint coords are in the 3200×1400 map space (image cover-fits into it).
// ──────────────────────────────────────────────────────────────

interface Scene {
  image: string;
  waypoints: { x: number; y: number }[];
}
const SCENES: Partial<Record<RegionId, Scene>> = {
  r1: {
    image: "/regions/first_location.png",
    waypoints: [
      { x: 200,  y: 1250 }, // dock tip (bottom-left)
      { x: 460,  y: 1110 }, // along dock planks
      { x: 760,  y: 980  }, // dock base / onto land
      { x: 1100, y: 940  }, // signpost
      { x: 1500, y: 920  }, // crossing grass
      { x: 1800, y: 890  }, // near cairn
      { x: 2100, y: 830  }, // climbing toward forest
      { x: 2350, y: 700  }, // approach forest
      { x: 2600, y: 560  }, // forest edge
      { x: 2850, y: 380  }, // into the trees
      { x: 3020, y: 230  }, // deep in forest (end)
    ],
  },
  r3: {
    image: "/regions/third_location.png",
    waypoints: [
      { x: 160,  y: 1275 }, // trail start (bottom-left)
      { x: 380,  y: 1150 }, // rocky path
      { x: 640,  y: 1000 }, // near the cross / cairn
      { x: 920,  y: 950  }, // approaching bridge
      { x: 1120, y: 985  }, // onto bridge
      { x: 1450, y: 1050 }, // bridge dip (middle)
      { x: 1800, y: 1045 }, // past dip
      { x: 2030, y: 965  }, // end of bridge
      { x: 2320, y: 870  }, // switchback begin
      { x: 2620, y: 720  }, // up the switchback
      { x: 2870, y: 540  }, // higher ledge
      { x: 3050, y: 380  }, // near archway (end)
    ],
  },
};

// ──────────────────────────────────────────────────────────────
// Mockup lesson redistribution (client-side only — does NOT mutate DB).
//
// Per user 2026-04-22:
//   - R1: L001 → L020 (L006 removed, L012 moved to 2nd position) + L021 shown
//         as an action marker ("Make UGC Ads")
//   - R2: L022 → L042
//   - R3: L043 → L056
//   - R4: L057 → L063
//
// Lessons whose title starts with "Action Item:" are rendered as diamond
// markers on the path. L021 is re-titled for the mockup to reflect the
// "Make UGC Action Items" concept the user described.
// ──────────────────────────────────────────────────────────────

const MOCKUP_REGION_LESSONS: Record<RegionId, string[]> = {
  r1: [
    "l001", "l012", // L012 moved to 2nd place
    "l002", "l003", "l004", "l005", // L006 removed
    "l007", "l008", "l009", "l010", "l011",
    "l013", "l014", "l015", "l016", "l017",
    "l018", "l019", "l020", "l021",
  ],
  r2: Array.from({ length: 21 }, (_, i) => `l0${String(22 + i).padStart(2, "0")}`),
  r3: Array.from({ length: 14 }, (_, i) => `l0${String(43 + i).padStart(2, "0")}`),
  r4: Array.from({ length: 7 }, (_, i) => `l0${String(57 + i).padStart(2, "0")}`),
};

// Titles can be overridden for the mockup (e.g. L021 → "Make UGC Action Items")
const MOCKUP_TITLE_OVERRIDES: Record<string, string> = {
  l021: "Action Item: Make UGC Ads",
};

function isActionItem(lesson: Lesson): boolean {
  const title = MOCKUP_TITLE_OVERRIDES[lesson.id] ?? lesson.title;
  return /^Action Item:/i.test(title);
}

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
  const { regions, lessons, completedLessonIds, currentLesson } = useStudent();

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
  }, [outerSize.w]);

  // Preload scene images so the cloud-transition scene swap is instant.
  // Without this, clicking a region fires the cloud animation, but the new
  // 37 MB scene image is still downloading when the clouds retreat — so the
  // user sees stale main_image underneath (looks like "fog on the region").
  useEffect(() => {
    (Object.values(SCENES) as Scene[]).forEach((scene) => {
      const img = new window.Image();
      img.src = scene.image;
    });
  }, []);

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

    // Region view — leaves room on the right for the side panel.
    const usableW = vw - SIDE_PANEL_WIDTH;

    // If this region has its own scene image, cover-fit the WHOLE image into
    // the usable area (no zoom beyond fit). This makes the scene be the view.
    if (SCENES[v]) {
      const scale = Math.max(usableW / MAP_W, vh / MAP_H);
      return {
        x: (usableW - MAP_W * scale) / 2,
        y: (vh - MAP_H * scale) / 2,
        scale,
      };
    }

    // Fallback — region has no scene image yet, zoom into its focal point on
    // the overview panorama.
    const z = REGION_ZONES[v];
    const sW = vw / MAP_W;
    const sH = vh / MAP_H;
    const overview = Math.max(sW, sH);
    const scale = overview * 1.9;
    return {
      x: usableW / 2 - z.labelX * scale,
      y: vh / 2 - z.labelY * scale,
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

  // ──────────────────────────────────────────────────────────
  // Pan + zoom (overview only).
  // - Drag to pan, wheel to zoom (pointer-anchored).
  // - Scale clamped to [coverScale, coverScale * 1.6] so the viewport is
  //   always fully covered by the image (no black edges).
  // - Position clamped so the image always covers the viewport.
  // - Inside a region scene, pan/zoom is disabled for now.
  // - Drag with >5px motion also blocks the zone click that would otherwise
  //   fire on release.
  // ──────────────────────────────────────────────────────────
  const dragStartRef = useRef<{
    cx: number;
    cy: number;
    tx: number;
    ty: number;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);

  const clampTransform = (t: { x: number; y: number; scale: number }) => {
    const vw = outerSize.w;
    const vh = outerSize.h;
    const imgW = MAP_W * t.scale;
    const imgH = MAP_H * t.scale;
    // If the image is narrower than the viewport at this scale, center it.
    const minX = Math.min(0, vw - imgW);
    const maxX = Math.max(0, vw - imgW);
    const minY = Math.min(0, vh - imgH);
    const maxY = Math.max(0, vh - imgH);
    return {
      x: Math.max(minX, Math.min(maxX, t.x)),
      y: Math.max(minY, Math.min(maxY, t.y)),
      scale: t.scale,
    };
  };

  const onMapPointerDown = (e: React.PointerEvent) => {
    if (view !== "overview") return;
    // Don't start a pan on right-click / middle-click
    if (e.button !== 0) return;
    // Kill any in-flight tween so it doesn't fight manual pan
    if (tweenRef.current) {
      tweenRef.current.kill();
      tweenRef.current = null;
    }
    dragStartRef.current = {
      cx: e.clientX,
      cy: e.clientY,
      tx: transformRef.current.x,
      ty: transformRef.current.y,
      moved: false,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onMapPointerMove = (e: React.PointerEvent) => {
    const s = dragStartRef.current;
    if (!s) return;
    const dx = e.clientX - s.cx;
    const dy = e.clientY - s.cy;
    if (!s.moved && Math.hypot(dx, dy) > 5) {
      s.moved = true;
    }
    if (!s.moved) return;
    const next = clampTransform({
      x: s.tx + dx,
      y: s.ty + dy,
      scale: transformRef.current.scale,
    });
    transformRef.current = next;
    setDisplayTransform(next);
  };

  const onMapPointerUp = (e: React.PointerEvent) => {
    const s = dragStartRef.current;
    if (!s) return;
    // If the user dragged, suppress the click that would fire on a
    // child zone polygon so we don't accidentally enter a region.
    if (s.moved) {
      suppressClickRef.current = true;
      // Clear on next tick so later clicks aren't blocked.
      setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    }
    dragStartRef.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // pointer may already be released; ignore
    }
  };

  const onMapWheel = (e: React.WheelEvent) => {
    if (view !== "overview") return;
    if (outerSize.w === 0) return;
    e.preventDefault();
    if (tweenRef.current) {
      tweenRef.current.kill();
      tweenRef.current = null;
    }
    const coverScale = Math.max(
      outerSize.w / MAP_W,
      outerSize.h / MAP_H
    );
    const maxScale = coverScale * 1.6;
    const current = transformRef.current;
    const zoomFactor = Math.exp(-e.deltaY * 0.0015);
    const newScale = Math.max(
      coverScale,
      Math.min(maxScale, current.scale * zoomFactor)
    );
    if (newScale === current.scale) return;
    // Anchor the zoom to the cursor position
    const rect = outerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    // Map coord under cursor
    const mx = (px - current.x) / current.scale;
    const my = (py - current.y) / current.scale;
    const nextX = px - mx * newScale;
    const nextY = py - my * newScale;
    const next = clampTransform({ x: nextX, y: nextY, scale: newScale });
    transformRef.current = next;
    setDisplayTransform(next);
  };

  // Build a lookup for fast lesson-by-id access
  const lessonsById = useMemo(() => {
    const m = new Map<string, Lesson>();
    lessons.forEach((l) => m.set(l.id, l));
    return m;
  }, [lessons]);

  // Lessons for each region are redistributed per MOCKUP_REGION_LESSONS
  // (mockup-only client-side override — DB region_id is ignored).
  const lessonsByRegion = useMemo(() => {
    const out: Partial<Record<RegionId, Lesson[]>> = {};
    (Object.keys(MOCKUP_REGION_LESSONS) as RegionId[]).forEach((rid) => {
      out[rid] = MOCKUP_REGION_LESSONS[rid]
        .map((id) => lessonsById.get(id))
        .filter((l): l is Lesson => l != null);
    });
    return out as Record<RegionId, Lesson[]>;
  }, [lessonsById]);

  const focusedRegion =
    view !== "overview" ? regions.find((r) => r.id === view) : null;
  const focusedLessons: Lesson[] =
    focusedRegion ? lessonsByRegion[focusedRegion.id as RegionId] ?? [] : [];

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
  // Blocked while a drag was in progress (pan shouldn't also click a zone).
  const transitionTo = (next: View) => {
    if (suppressClickRef.current) return;
    if (pendingViewRef.current !== null) return; // already in flight
    pendingViewRef.current = next;
    setTransitionCounter((n) => n + 1);
  };

  return (
    <div
      ref={outerRef}
      className="absolute inset-0 overflow-hidden"
      style={{
        background: "#060C1A",
        cursor: view === "overview" ? "grab" : "default",
        touchAction: "none",
      }}
      onPointerDown={onMapPointerDown}
      onPointerMove={onMapPointerMove}
      onPointerUp={onMapPointerUp}
      onPointerCancel={onMapPointerUp}
      onWheel={onMapWheel}
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
        {/* Scene image — swaps based on current view. Overview shows the full
            panorama; per-region scenes (R1, R3…) replace it with their own
            painted location. Regions without a scene fall back to panorama. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: `url("${
              view !== "overview" && SCENES[view]
                ? SCENES[view]!.image
                : "/regions/main_image.png"
            }")`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
          }}
        />

        {/* Inside a region scene — draw the path + lesson nodes */}
        {view !== "overview" && SCENES[view] && (
          <ScenePathOverlay
            scene={SCENES[view]!}
            lessons={focusedLessons}
            completedLessonIds={completedLessonIds}
            currentLessonId={currentLesson?.id ?? null}
            onOpenLesson={onOpenLesson}
          />
        )}

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
              const regionLessons = lessonsByRegion[r.id as RegionId] ?? [];
              if (!z) return null;
              // Mockup is for placement verification — all regions clickable.
              const total = regionLessons.length;
              const completed = regionLessons.filter((l) =>
                completedLessonIds.has(l.id)
              ).length;
              const isComplete = total > 0 && completed === total;
              const hot = hoveredZone === r.id;
              const hasCurrent = regionLessons.some(
                (l) => l.id === currentLesson?.id
              );
              const isCurrent = hasCurrent;
              const numeral = ["I", "II", "III", "IV"][r.order_num - 1];
              const stroke = isComplete ? GOLD_HI : GOLD;
              const pointsStr = z.polygon
                .map((p) => `${p.x},${p.y}`)
                .join(" ");

              return (
                <g
                  key={`zone-${r.id}`}
                  style={{ cursor: "pointer" }}
                  onClick={() => transitionTo(r.id as RegionId)}
                  onMouseEnter={() => setHoveredZone(r.id as RegionId)}
                  onMouseLeave={() => setHoveredZone(null)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      transitionTo(r.id as RegionId);
                    }
                  }}
                  tabIndex={0}
                  role="button"
                  aria-label={`${r.name} — ${completed}/${total} lessons`}
                >
                  {/* Invisible hit surface — catches clicks over the whole
                      polygon regardless of any gradient fill transparency.
                      pointer-events="all" works even with fill="none". */}
                  <polygon
                    points={pointsStr}
                    fill="rgba(0,0,0,0.001)"
                    pointerEvents="all"
                  />

                  {/* Glow fill — no pointer events; hit surface handles those */}
                  <polygon
                    points={pointsStr}
                    fill={hot ? "url(#zone-glow-hot)" : "url(#zone-glow)"}
                    pointerEvents="none"
                    style={{
                      transition: "opacity 0.4s cubic-bezier(0.22,1,0.36,1)",
                    }}
                  />

                  {/* Dashed outline — visible border */}
                  <polygon
                    points={pointsStr}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={hot ? 3 : 2}
                    strokeDasharray={isComplete ? "" : "14 8"}
                    strokeLinejoin="round"
                    opacity={hot ? 0.9 : 0.6}
                    pointerEvents="none"
                    style={{
                      transition: "opacity 0.4s, stroke-width 0.4s",
                    }}
                  />

                  {/* Pulsing ring on the student's current region */}
                  {isCurrent && (
                    <polygon
                      points={pointsStr}
                      fill="none"
                      stroke={GOLD_HI}
                      strokeWidth={2.5}
                      opacity={0.5}
                      pointerEvents="none"
                    >
                      <animate
                        attributeName="opacity"
                        values="0.2;0.65;0.2"
                        dur="3.2s"
                        repeatCount="indefinite"
                      />
                    </polygon>
                  )}

                  {/* Center label — positioned at labelX/labelY in map space */}
                  <g
                    transform={`translate(${z.labelX} ${z.labelY})`}
                    pointerEvents="none"
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

                    {/* Progress */}
                    <text
                      x={0}
                      y={52}
                      textAnchor="middle"
                      style={{
                        fontFamily: "JetBrains Mono, ui-monospace, monospace",
                        fontSize: 13,
                        letterSpacing: "0.22em",
                        fill: GOLD,
                        textTransform: "uppercase",
                        paintOrder: "stroke fill",
                        stroke: "rgba(6,12,26,0.85)",
                        strokeWidth: 3,
                        strokeLinejoin: "round",
                      }}
                    >
                      {isComplete
                        ? `CHARTED · ${total}`
                        : `${completed} / ${total} LESSONS`}
                    </text>

                    {/* Hover CTA */}
                    {hot && (
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
                    {MOCKUP_TITLE_OVERRIDES[lesson.id] ?? lesson.title}
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

// ──────────────────────────────────────────────────────────────
// Scene path overlay — draws the red-line path as a dashed gold trail
// inside a region scene, and places lesson nodes evenly along it.
// ──────────────────────────────────────────────────────────────

function buildSmoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[i - 1];
    const p1 = pts[i];
    const pm1 = pts[i - 2] ?? p0;
    const p2 = pts[i + 1] ?? p1;
    // Catmull-Rom → cubic Bezier control points (tension = 0.5)
    const c1x = p0.x + (p1.x - pm1.x) / 6;
    const c1y = p0.y + (p1.y - pm1.y) / 6;
    const c2x = p1.x - (p2.x - p0.x) / 6;
    const c2y = p1.y - (p2.y - p0.y) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p1.x} ${p1.y}`;
  }
  return d;
}

interface ScenePathOverlayProps {
  scene: Scene;
  lessons: Lesson[];
  completedLessonIds: Set<string>;
  currentLessonId: string | null;
  onOpenLesson: (id: string) => void;
}

function ScenePathOverlay({
  scene,
  lessons,
  completedLessonIds,
  currentLessonId,
  onOpenLesson,
}: ScenePathOverlayProps) {
  const pathRef = useRef<SVGPathElement>(null);
  const [nodePositions, setNodePositions] = useState<
    { x: number; y: number }[]
  >([]);
  const pathD = useMemo(() => buildSmoothPath(scene.waypoints), [scene]);

  // Lay lessons out at even arc-length increments along the path.
  // This is a legitimate DOM-measure pattern: we need the rendered path element
  // to compute getPointAtLength. The extra render is intentional and bounded.
  // eslint-disable-next-line react-hooks/react-compiler
  useEffect(() => {
    const el = pathRef.current;
    if (!el || lessons.length === 0) {
      setNodePositions([]);
      return;
    }
    const total = el.getTotalLength();
    const edgeInset = Math.min(40, total * 0.04);
    const usable = total - edgeInset * 2;
    const positions = lessons.map((_, i) => {
      const t = lessons.length === 1 ? 0.5 : i / (lessons.length - 1);
      const pt = el.getPointAtLength(edgeInset + usable * t);
      return { x: pt.x, y: pt.y };
    });
    setNodePositions(positions);
  }, [lessons, pathD]);

  return (
    <svg
      viewBox={`0 0 ${MAP_W} ${MAP_H}`}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        overflow: "visible",
        pointerEvents: "none",
      }}
    >
      <defs>
        <filter id="path-shadow" x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>

      {/* Dark underlay — lifts the gold path off the painted scene */}
      <path
        d={pathD}
        fill="none"
        stroke="rgba(6,12,26,0.55)"
        strokeWidth={14}
        strokeLinecap="round"
        strokeLinejoin="round"
        filter="url(#path-shadow)"
      />
      {/* Dashed gold trail — visible path */}
      <path
        ref={pathRef}
        d={pathD}
        fill="none"
        stroke={GOLD}
        strokeWidth={4}
        strokeDasharray="14 10"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.85}
      />

      {/* Lesson nodes */}
      {nodePositions.map((pos, i) => {
        const lesson = lessons[i];
        if (!lesson) return null;
        const isDone = completedLessonIds.has(lesson.id);
        const isCurrent = lesson.id === currentLessonId;
        const isAction = isActionItem(lesson);
        const displayTitle =
          MOCKUP_TITLE_OVERRIDES[lesson.id] ?? lesson.title;
        return (
          <LessonMarker
            key={lesson.id}
            x={pos.x}
            y={pos.y}
            index={i + 1}
            isDone={isDone}
            isCurrent={isCurrent}
            isAction={isAction}
            title={displayTitle}
            onClick={() => onOpenLesson(lesson.id)}
          />
        );
      })}
    </svg>
  );
}

interface LessonMarkerProps {
  x: number;
  y: number;
  index: number;
  isDone: boolean;
  isCurrent: boolean;
  isAction: boolean;
  title: string;
  onClick: () => void;
}

function LessonMarker({
  x,
  y,
  index,
  isDone,
  isCurrent,
  isAction,
  title,
  onClick,
}: LessonMarkerProps) {
  const [hot, setHot] = useState(false);
  const fill = isDone
    ? GOLD
    : isCurrent
      ? "rgba(230,192,122,0.25)"
      : "rgba(6,12,26,0.92)";
  const stroke = isCurrent ? GOLD_HI : GOLD;
  const size = isAction ? 32 : 26;

  return (
    <g
      transform={`translate(${x} ${y})`}
      style={{ cursor: "pointer", pointerEvents: "auto" }}
      onClick={onClick}
      onMouseEnter={() => setHot(true)}
      onMouseLeave={() => setHot(false)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      tabIndex={0}
      role="button"
      aria-label={title}
    >
      {/* Pulsing ring for current */}
      {isCurrent && (
        <circle
          r={size + 6}
          fill="none"
          stroke={GOLD_HI}
          strokeWidth={2}
          opacity={0.6}
        >
          <animate
            attributeName="r"
            values={`${size + 2};${size + 14};${size + 2}`}
            dur="2.4s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="opacity"
            values="0.15;0.7;0.15"
            dur="2.4s"
            repeatCount="indefinite"
          />
        </circle>
      )}

      {/* Hover glow */}
      {hot && (
        <circle
          r={size + 4}
          fill="rgba(240,213,149,0.25)"
          style={{ transition: "opacity 0.2s" }}
        />
      )}

      {/* Marker shape — circle for lessons, diamond for action items */}
      {isAction ? (
        <rect
          x={-size * 0.75}
          y={-size * 0.75}
          width={size * 1.5}
          height={size * 1.5}
          transform="rotate(45)"
          fill={fill}
          stroke={stroke}
          strokeWidth={2.5}
        />
      ) : (
        <circle
          r={size}
          fill={fill}
          stroke={stroke}
          strokeWidth={isCurrent ? 3 : 2}
        />
      )}

      {/* Inner glyph */}
      {isDone ? (
        <path
          d="M -9 0 L -2 7 L 10 -7"
          fill="none"
          stroke="#0A1428"
          strokeWidth={3.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : isAction ? (
        // Small lightning / action glyph
        <path
          d="M -5 -9 L 3 -2 L -1 -2 L 5 9 L -3 2 L 1 2 Z"
          fill={isCurrent ? GOLD_HI : GOLD}
          stroke="none"
        />
      ) : (
        <text
          y={6}
          textAnchor="middle"
          style={{
            fontFamily: "JetBrains Mono, ui-monospace, monospace",
            fontSize: 16,
            fontWeight: 600,
            fill: isCurrent ? GOLD_HI : GOLD,
          }}
        >
          {index}
        </text>
      )}

      {/* Hover label */}
      {hot && (
        <g transform={`translate(0 ${-(size + 18)})`} pointerEvents="none">
          <rect
            x={-120}
            y={-22}
            width={240}
            height={28}
            rx={4}
            fill="rgba(6,12,26,0.92)"
            stroke="rgba(230,192,122,0.3)"
            strokeWidth={1}
          />
          <text
            y={-3}
            textAnchor="middle"
            style={{
              fontFamily: "Cormorant Garamond, serif",
              fontStyle: "italic",
              fontSize: 16,
              fill: INK,
            }}
          >
            {title.length > 36 ? title.slice(0, 33) + "…" : title}
          </text>
        </g>
      )}
    </g>
  );
}
