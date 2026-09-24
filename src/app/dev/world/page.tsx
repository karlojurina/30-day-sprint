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

const AREAS = [
  "Introduction",
  "Fundamentals",
  "Video Ads I",
  "Video Ads II",
  "Static Ads",
  "AI Ads & Content",
  "Creative Strategy",
  "Job Board",
];

declare global {
  interface Window {
    __worldReady?: boolean;
    __worldError?: string;
    __worldDepth?: number;
    __worldMarkers?: ProjectedMarker[];
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

    const anchors: AreaAnchor[] = AREAS.map((_, i) => ({
      id: `a${i + 1}`,
      depth: 0.02 + (i / (AREAS.length - 1)) * 0.93,
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
            {AREAS[i]}
          </div>
        ))}
      </div>
    </>
  );
}
