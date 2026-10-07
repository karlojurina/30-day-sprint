"use client";

import { useEffect, useRef } from "react";

/**
 * The V4 scene on a fixed stage with a spacer the scene sizes itself
 * (bindSpacer). Exposes the scene as window.__v4 and a frame counter as
 * window.__v4Frames for the render harness. No interface, no fetches.
 */
export function CameraHarness() {
  const stageRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stage = stageRef.current;
    const spacer = spacerRef.current;
    if (!stage || !spacer) return;
    let disposed = false;
    let scene: import("@/lib/world-v5/scene").WorldScene | null = null;
    const w = window as unknown as Record<string, unknown>;
    w.__v4Frames = 0;
    (async () => {
      const mod = await import("@/lib/world-v5/scene");
      if (disposed) return;
      const bare = new URLSearchParams(window.location.search).get("bare") === "1";
      scene = new mod.WorldScene(stage, bare ? { modules: [] } : {});
      scene.bindSpacer(spacer);
      scene.onFrame(() => {
        w.__v4Frames = (w.__v4Frames as number) + 1;
      });
      scene.start();
      w.__v4 = scene;
      try {
        await scene.load();
        w.__v4Ready = true;
      } catch (e) {
        w.__v4Error = String(e);
      }
    })();
    return () => {
      disposed = true;
      scene?.dispose();
      delete w.__v4;
      delete w.__v4Ready;
    };
  }, []);

  return (
    <div style={{ background: "#9aa3ad" }}>
      <div ref={stageRef} style={{ position: "fixed", inset: 0 }} />
      <div ref={spacerRef} style={{ height: "1770vh", pointerEvents: "none" }} aria-hidden="true" />
    </div>
  );
}
