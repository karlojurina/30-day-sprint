"use client";

import { useEffect, useRef } from "react";
import { CodexLandscape, type MapFrame } from "@/lib/world-codex/scene";

export default function MapCanvas({ parked, paused, onFrame, onReady, onFailure }: {
  parked: number | null; paused: boolean; onFrame: (frame: MapFrame) => void; onReady: () => void; onFailure: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const landscape = useRef<CodexLandscape | null>(null);
  useEffect(() => {
    if (!host.current) return;
    let scene: CodexLandscape;
    try {
      scene = new CodexLandscape(host.current, onFrame, onFailure);
      landscape.current = scene;
      onReady();
    } catch (error) {
      console.error("[codex map]", error);
      onFailure();
      return;
    }
    return () => {
      landscape.current = null;
      scene.dispose();
    };
  }, [onFrame, onReady, onFailure]);
  useEffect(() => {
    const onVisibility = () => landscape.current?.setPaused(paused || document.hidden);
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [paused]);
  useEffect(() => { landscape.current?.setParked(parked); }, [parked]);
  return <div ref={host} style={{ position: "fixed", inset: 0 }} />;
}
