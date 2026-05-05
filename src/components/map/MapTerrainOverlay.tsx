"use client";

import { useEffect, useRef, useState } from "react";

interface AtmosphereClip {
  /** Source path under public/, e.g. /regions/r1-atmosphere-sea.webm */
  src: string;
  /**
   * Position + size as percentages of the map container (0-100).
   * Lets the clip cover only the relevant biome area (e.g. the sea,
   * the forest canopy, etc.).
   */
  left: number;
  top: number;
  width: number;
  height: number;
  /** 0-1 visual opacity. Atmosphere should be felt, not stared at. */
  opacity: number;
  /** CSS blend mode. "screen" tends to read as light/luminous. */
  blendMode?: React.CSSProperties["mixBlendMode"];
}

interface MapTerrainOverlayProps {
  /** Atmosphere clips for the active region (or all regions). */
  clips: AtmosphereClip[];
}

/**
 * Atmospheric video layer for the pilot map.
 *
 * Renders a list of looping `<video>` clips positioned over the map.
 * Each clip is autoplay + muted + loop + playsinline so it
 * starts immediately and runs free.
 *
 * Failure-tolerant: if a clip's src 404s (asset not provided yet),
 * we just don't render that clip. Other clips and the underlying
 * map continue to work. No console spam beyond the browser's own.
 *
 * Pause-when-tab-hidden behavior comes free from the browser.
 */
export function MapTerrainOverlay({ clips }: MapTerrainOverlayProps) {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        overflow: "hidden",
      }}
    >
      {clips.map((clip, i) => (
        <AtmosphereClipNode key={i} clip={clip} />
      ))}
    </div>
  );
}

function AtmosphereClipNode({ clip }: { clip: AtmosphereClip }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [hidden, setHidden] = useState(false);

  // If the asset is missing or fails to play, hide silently.
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const onError = () => setHidden(true);
    v.addEventListener("error", onError);
    return () => v.removeEventListener("error", onError);
  }, []);

  if (hidden) return null;

  return (
    <video
      ref={ref}
      src={clip.src}
      autoPlay
      loop
      muted
      playsInline
      preload="auto"
      style={{
        position: "absolute",
        left: `${clip.left}%`,
        top: `${clip.top}%`,
        width: `${clip.width}%`,
        height: `${clip.height}%`,
        objectFit: "cover",
        opacity: clip.opacity,
        mixBlendMode: clip.blendMode ?? "normal",
        pointerEvents: "none",
      }}
    />
  );
}

/**
 * Atmosphere config for Region 1 (Base Camp / sea biome) — the pilot.
 * Tweak coords after the AI-generated assets land.
 *
 * Region 1 occupies roughly the left ~25% of the map (per
 * REGION_STRIPS in src/lib/map/path-math.ts). Within that strip:
 *   - sea-shimmer covers the bottom-right where the painted water
 *     surface lives in the AI-generated terrain
 *   - drifting-clouds covers the top quarter for sky atmosphere
 */
export const REGION_1_ATMOSPHERE: AtmosphereClip[] = [
  {
    src: "/regions/r1-atmosphere-sea.webm",
    left: 4,
    top: 55,
    width: 22,
    height: 35,
    opacity: 0.55,
    blendMode: "screen",
  },
  {
    src: "/regions/r1-atmosphere-clouds.webm",
    left: 0,
    top: 4,
    width: 28,
    height: 22,
    opacity: 0.4,
    blendMode: "screen",
  },
];
