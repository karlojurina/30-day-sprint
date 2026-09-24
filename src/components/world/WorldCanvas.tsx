"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  WorldScene,
  type AreaAnchor,
  type ProjectedMarker,
} from "@/lib/world/scene";
import { useWorldCatalog } from "@/lib/world/useWorldCatalog";

/**
 * The world, on a scroll rail.
 *
 * THE CANVAS IS FIXED AND A TALL SPACER SUPPLIES THE SCROLL RANGE. This is not
 * a style choice: a wheel listener does not survive iOS momentum scrolling, and
 * the prototype settled on this after that failed. The camera reads scrollY
 * every frame rather than reacting to scroll events.
 *
 * MARKERS ARE REAL BUTTONS, not raycast hits on 3D objects. They are positioned
 * each frame by projecting a world anchor into screen space, which means they
 * are focusable, tabbable, screen-reader addressable and work on touch without
 * a single line of hit-testing. A 3D pin would have been none of those things.
 *
 * Art direction is DEFERRED by Lovro's explicit ask, so nothing here decides
 * what the eight places look like. Every scene value is the prototype's,
 * carried across unchanged.
 */

const WORLD_GLB = "/world/world.glb";
const POSTER = "/world/poster.jpg";

/** Rail stops for eight areas when the catalog has no rail_at yet (art talk output). */
function fallbackDepth(index: number, total: number): number {
  if (total <= 1) return 0;
  // 0.02 -> 0.95. Not 0..1: the very start is the shore looking in, and the
  // very end is past the last landmark.
  return 0.02 + (index / (total - 1)) * 0.93;
}

type Phase = "loading" | "ready" | "failed" | "nowebgl";

export function WorldCanvas({
  parkedAreaId = null,
}: {
  /** Set by a child route (the area screen) to hold the camera at its stop. */
  parkedAreaId?: string | null;
}) {
  const router = useRouter();
  const { areas, areaProgress, currentAreaId, loading, loadError, isEmpty } =
    useWorldCatalog();

  const stageRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<WorldScene | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [markers, setMarkers] = useState<ProjectedMarker[]>([]);
  const [depth, setDepth] = useState(0);
  const autoTravelledRef = useRef(false);

  const anchors: AreaAnchor[] = areas.map((a, i) => ({
    id: a.id,
    depth: a.railAt ?? fallbackDepth(i, areas.length),
  }));
  const anchorsKey = anchors.map((a) => `${a.id}:${a.depth}`).join(",");

  // ── Mount the scene once. Never on every render: a second WebGL context
  //    would be created before the first is disposed and the tab dies.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    let scene: WorldScene;
    try {
      scene = new WorldScene(stage);
    } catch {
      setPhase("nowebgl");
      return;
    }
    sceneRef.current = scene;
    scene.start();

    let cancelled = false;
    scene
      .load(WORLD_GLB)
      .then(() => {
        if (!cancelled) setPhase("ready");
      })
      .catch((err) => {
        console.error("[world] failed to load", err);
        if (!cancelled) setPhase("failed");
      });

    return () => {
      cancelled = true;
      sceneRef.current = null;
      scene.dispose();
    };
  }, []);

  // ── Feed the scene the rail stops, and take back projected marker positions.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.setAnchors(anchors);
    scene.onFrame((d, m) => {
      setDepth(d);
      setMarkers(m);
    });
    return () => scene.onFrame(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorsKey]);

  // ── Park at an area's stop while its screen is open, and dim behind it.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (!parkedAreaId) {
      scene.setParked(null);
      return;
    }
    const target = anchors.find((a) => a.id === parkedAreaId);
    scene.setParked(target ? target.depth : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parkedAreaId, anchorsKey]);

  // ── Stop rendering when the tab is hidden. A backgrounded rAF loop still
  //    burns a phone battery for a world nobody is looking at.
  useEffect(() => {
    const onVis = () =>
      sceneRef.current?.setPaused(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // ── Auto-travel: on arrival, fly from the shore to the area they are up to.
  //    Lovro's decision, and the default rather than an option.
  useEffect(() => {
    if (phase !== "ready" || autoTravelledRef.current) return;
    if (loading || !currentAreaId) return;
    autoTravelledRef.current = true;

    const target = anchors.find((a) => a.id === currentAreaId);
    if (!target || target.depth <= 0.01) return;

    const max = document.body.scrollHeight - window.innerHeight;
    if (max <= 0) return;
    const to = target.depth * max;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      window.scrollTo(0, to);
      sceneRef.current?.snapTo(target.depth);
      return;
    }

    const from = window.scrollY;
    const start = performance.now();
    const DURATION = 3000;
    let cancelledByUser = false;

    // Any real input cancels it. Being flown somewhere you did not ask to go,
    // with no way to stop, is worse than no animation at all.
    const cancel = () => {
      cancelledByUser = true;
    };
    const opts = { passive: true, once: true } as const;
    window.addEventListener("wheel", cancel, opts);
    window.addEventListener("touchstart", cancel, opts);
    window.addEventListener("keydown", cancel, opts);

    const step = (now: number) => {
      if (cancelledByUser) return;
      const t = Math.min(1, (now - start) / DURATION);
      // easeInOutCubic
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      window.scrollTo(0, from + (to - from) * e);
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);

    return () => {
      window.removeEventListener("wheel", cancel);
      window.removeEventListener("touchstart", cancel);
      window.removeEventListener("keydown", cancel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, loading, currentAreaId, anchorsKey]);

  const openArea = useCallback(
    (areaId: string) => router.push(`/world/${areaId}`),
    [router],
  );

  const areaById = new Map(areas.map((a) => [a.id, a]));

  return (
    <>
      <div
        ref={stageRef}
        aria-hidden="true"
        style={{ position: "fixed", inset: 0, zIndex: 0, background: "#1d1826" }}
      />

      {/* The scroll range. pointer-events:none so the markers above stay
          clickable. Collapsed while parked, so the page behind an area screen
          cannot be scrolled out from under it. */}
      <div
        style={{
          position: "relative",
          height: parkedAreaId ? "100vh" : "640vh",
          zIndex: 1,
          pointerEvents: "none",
        }}
      />

      {/* Markers. Real buttons, projected each frame. */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 3,
          pointerEvents: "none",
          // The area screen is the surface while it is open; its markers would
          // float over the panel and steal clicks.
          opacity: parkedAreaId ? 0 : 1,
          transition: "opacity 250ms ease",
        }}
        aria-hidden={parkedAreaId ? "true" : undefined}
      >
        {markers.map((m) => {
          const area = areaById.get(m.id);
          if (!area) return null;
          const p = areaProgress(area.id);
          const isCurrent = area.id === currentAreaId;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => openArea(area.id)}
              aria-label={`${area.name} — ${p.done} of ${p.total} lessons done`}
              style={{
                position: "absolute",
                left: m.x,
                top: m.y,
                transform: "translate(-50%, -50%)",
                // Hidden rather than unmounted: unmounting and remounting eight
                // buttons every frame would thrash focus and break tabbing.
                opacity: m.visible ? 0.35 + m.proximity * 0.65 : 0,
                pointerEvents: m.visible && !parkedAreaId ? "auto" : "none",
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "7px 12px",
                borderRadius: 999,
                border: `1px solid ${isCurrent ? "rgba(232,168,106,.75)" : "rgba(246,239,230,.22)"}`,
                background: "rgba(20,15,18,.64)",
                backdropFilter: "blur(6px)",
                color: "#F6EFE6",
                font: "600 12px/1 ui-sans-serif, system-ui, sans-serif",
                letterSpacing: "0.01em",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 999,
                  background: p.isComplete
                    ? "rgba(232,168,106,1)"
                    : p.done > 0
                      ? "rgba(232,168,106,.55)"
                      : "rgba(246,239,230,.3)",
                }}
              />
              {area.name}
              <span style={{ opacity: 0.6, fontWeight: 400 }}>
                {p.done}/{p.total}
              </span>
            </button>
          );
        })}
      </div>

      {/* Poster + failure states. Covers the canvas until the world is up. */}
      {phase !== "ready" && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 4,
            background: `#241C22 center/cover no-repeat url(${POSTER})`,
            display: "grid",
            placeItems: "center",
            padding: 20,
          }}
        >
          <div
            style={{
              background: "rgba(20,15,18,.72)",
              border: "1px solid rgba(246,239,230,.16)",
              borderRadius: 4,
              padding: "18px 22px",
              textAlign: "center",
              backdropFilter: "blur(6px)",
              maxWidth: "min(90vw, 420px)",
              color: "#C9B9A8",
              font: "400 14px/1.6 ui-sans-serif, system-ui, sans-serif",
            }}
          >
            {phase === "loading" && "Loading the world…"}
            {phase === "failed" &&
              "The world could not be loaded. The still behind this card is the same scene."}
            {phase === "nowebgl" &&
              "This browser cannot draw the world. The still behind this card is the same scene."}
          </div>
        </div>
      )}

      {/* A catalog that failed to load must say so, not render an empty world. */}
      {phase === "ready" && !loading && (loadError || isEmpty) && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 5,
            display: "grid",
            placeItems: "center",
            background: "rgba(29,24,38,.82)",
            padding: 20,
          }}
        >
          <div
            style={{
              textAlign: "center",
              color: "#F6EFE6",
              font: "400 14px/1.6 ui-sans-serif, system-ui, sans-serif",
            }}
          >
            <p style={{ margin: "0 0 14px" }}>
              {loadError
                ? "Your course didn't load."
                : "There are no lessons here yet."}
            </p>
            {loadError && (
              <button
                type="button"
                onClick={() => window.location.reload()}
                style={{
                  padding: "9px 18px",
                  borderRadius: 8,
                  border: "1px solid rgba(246,239,230,.3)",
                  background: "transparent",
                  color: "#F6EFE6",
                  cursor: "pointer",
                  font: "600 13px ui-sans-serif, system-ui, sans-serif",
                }}
              >
                Try again
              </button>
            )}
          </div>
        </div>
      )}

      {/* Depth readout. Placeholder chrome — the HUD is an art-talk output. */}
      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          left: 0,
          bottom: 0,
          zIndex: 3,
          height: 2,
          width: `${Math.round(depth * 100)}%`,
          background: "rgba(232,168,106,.5)",
          pointerEvents: "none",
        }}
      />
    </>
  );
}
