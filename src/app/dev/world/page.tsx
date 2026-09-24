"use client";

import { useEffect, useRef, useState } from "react";
import { notFound } from "next/navigation";
import {
  WorldScene,
  type AreaAnchor,
  type ProjectedMarker,
} from "@/lib/world/scene";

/**
 * Development-only harness for the world scene.
 *
 * WHY THIS EXISTS. This project produced three confident, wrong visual
 * diagnoses in a row because I reasoned about renders I could not see. The
 * lesson recorded from that: build the looking-tool BEFORE shipping a guess.
 * This page is that tool — it mounts the REAL WorldScene with fake anchors and
 * no session, so headless Chrome can render it and a human (or a pixel
 * sampler) can actually look.
 *
 * It renders nothing in production: notFound() below.
 *
 * Test hooks (window.__world*) exist ONLY on this page. The shipped
 * WorldCanvas has none — the README's rule is to inject hooks into a copy,
 * never the real file.
 */

// name, landmark mesh, rail depth — the real values, so the dev harness
// exercises the same anchoring the app will. Depths come from check_geom.py.
const AREAS: Array<[string, string, number]> = [
  ["Introduction",     "LM_Lighthouse", 0.0708],
  ["Fundamentals",     "LM_Windmill",   0.1934],
  ["Video Ads I",      "LM_Bridge",     0.3000],
  ["Video Ads II",     "LM_Viaduct",    0.4151],
  ["Static Ads",       "LM_Watchtower", 0.5236],
  ["AI Ads & Content", "LM_Cairn",      0.6321],
  ["Creative Strategy","LM_Jetty",      0.6863],
  ["Job Board",        "LM_Obelisk",    0.8302],
];

declare global {
  interface Window {
    __worldReady?: boolean;
    __worldError?: string;
    __worldDepth?: number;
    __worldMarkers?: ProjectedMarker[];
    __worldLandmarks?: string[];
    /** Harness only: hide every object whose name starts with `prefix`. Returns how many. */
    __worldHide?: (prefix: string) => number;
    /** Harness only: every object name in the loaded scene. */
    __worldNames?: () => string[];
  }
}

export default function DevWorldPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <DevWorld />;
}

function DevWorld() {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [markers, setMarkers] = useState<ProjectedMarker[]>([]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const anchors: AreaAnchor[] = AREAS.map(([, mesh, depth], i) => ({
      id: `a${i + 1}`,
      depth,
      landmark: mesh,
    }));

    let scene: WorldScene;
    try {
      scene = new WorldScene(stage);
    } catch (e) {
      window.__worldError = String(e);
      return;
    }
    scene.setAnchors(anchors);
    scene.onFrame((d, m) => {
      window.__worldDepth = d;
      window.__worldMarkers = m;
      setMarkers(m);
    });
    scene.start();
    scene
      .load("/world/world.glb")
      .then(() => {
        // Surface what the glb actually contains, so a renamed or missing
        // landmark shows up as a fact rather than as "the markers drifted".
        window.__worldLandmarks = scene.landmarkNames();
        window.__worldHide = (prefix: string) => {
          const sc = scene.debugScene();
          let n = 0;
          sc?.traverse((o) => {
            if (o.name.startsWith(prefix) && o.visible) {
              o.visible = false;
              n++;
            }
          });
          return n;
        };
        window.__worldNames = () => {
          const sc = scene.debugScene();
          const names = new Set<string>();
          sc?.traverse((o) => {
            if (o.name) names.add(o.name.replace(/[._]\d+$/, ""));
          });
          return [...names].sort();
        };
        window.__worldReady = true;
      })
      .catch((e) => {
        window.__worldError = String(e);
      });

    return () => {
      window.__worldReady = false;
      scene.dispose();
    };
  }, []);

  return (
    <>
      <div ref={stageRef} style={{ position: "fixed", inset: 0, zIndex: 0, background: "#1d1826" }} />
      <div style={{ position: "relative", height: "640vh", zIndex: 1, pointerEvents: "none" }} />
      <div style={{ position: "fixed", inset: 0, zIndex: 3, pointerEvents: "none" }}>
        {markers.map((m, i) => (
          <div
            key={m.id}
            style={{
              position: "absolute",
              left: m.x,
              top: m.y,
              transform: "translate(-50%, -50%)",
              opacity: m.visible ? 0.35 + m.proximity * 0.65 : 0,
              padding: "7px 12px",
              borderRadius: 999,
              border: "1px solid rgba(246,239,230,.22)",
              background: "rgba(20,15,18,.64)",
              color: "#F6EFE6",
              font: "600 12px/1 ui-sans-serif, system-ui, sans-serif",
              whiteSpace: "nowrap",
            }}
          >
            {AREAS[i]?.[0]}
          </div>
        ))}
      </div>
    </>
  );
}
