"use client";

/**
 * Ambient atmosphere layer that sits behind the lesson nodes inside
 * the main map SVG. Adds:
 *   - 4 stylized birds drifting on long-arc paths
 *   - 3 low-opacity clouds slowly moving left-to-right
 *   - 5 small sparkles near the current lesson (when one exists)
 *
 * All animations use `transform` and `opacity` only. Browsers throttle
 * rAF when the tab is hidden, so framer-motion loops naturally pause
 * without us doing anything — no manual visibility tracking.
 *
 * Skip rendering on viewport <640px to keep mobile clean. Non-interactive
 * (pointer-events: none) so it never intercepts lesson clicks or pan.
 */

import { useEffect, useState, useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { SPEC_EASE } from "@/lib/motion";
import { MAP_W } from "@/lib/map/path-math";

interface BirdSpec {
  id: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  duration: number;
  delay: number;
}

interface CloudSpec {
  id: string;
  y: number;
  rx: number;
  ry: number;
  duration: number;
  delay: number;
  opacity: number;
}

interface SparkleSpec {
  id: string;
  dx: number;
  dy: number;
  duration: number;
  delay: number;
}

const BIRDS: BirdSpec[] = [
  // 4 wide-arc flights spread across the 4 regions
  {
    id: "b1",
    startX: -100,
    startY: 280,
    endX: 1100,
    endY: 200,
    duration: 28,
    delay: 0,
  },
  {
    id: "b2",
    startX: 800,
    startY: 220,
    endX: 1900,
    endY: 320,
    duration: 32,
    delay: 9,
  },
  {
    id: "b3",
    startX: 1700,
    startY: 380,
    endX: 2700,
    endY: 240,
    duration: 30,
    delay: 17,
  },
  {
    id: "b4",
    startX: 2500,
    startY: 200,
    endX: 3400,
    endY: 340,
    duration: 26,
    delay: 5,
  },
];

const CLOUDS: CloudSpec[] = [
  { id: "c1", y: 120, rx: 220, ry: 32, duration: 110, delay: 0, opacity: 0.16 },
  { id: "c2", y: 260, rx: 180, ry: 26, duration: 130, delay: 35, opacity: 0.12 },
  { id: "c3", y: 90,  rx: 260, ry: 38, duration: 145, delay: 70, opacity: 0.18 },
];

const SPARKLES: SparkleSpec[] = [
  { id: "s1", dx: -38, dy: -42, duration: 2.6, delay: 0    },
  { id: "s2", dx: 44,  dy: -28, duration: 3.1, delay: 0.4  },
  { id: "s3", dx: -22, dy: 36,  duration: 2.4, delay: 0.9  },
  { id: "s4", dx: 30,  dy: 30,  duration: 2.8, delay: 1.4  },
  { id: "s5", dx: 0,   dy: -54, duration: 3.4, delay: 0.6  },
];

interface MapAmbienceProps {
  /** Center of the current lesson on the map (in viewBox coordinates),
   * or null to skip sparkles. */
  currentLessonPosition: { x: number; y: number } | null;
}

export function MapAmbience({ currentLessonPosition }: MapAmbienceProps) {
  const reducedMotion = useReducedMotion();
  const [enabled, setEnabled] = useState(true);

  // Skip rendering on small viewports to keep mobile clean. Debounced so
  // resize doesn't thrash the enabled flag during window drag.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let timer: number | undefined;
    const update = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        setEnabled(window.innerWidth >= 640);
      }, 200);
    };
    setEnabled(window.innerWidth >= 640);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      window.clearTimeout(timer);
    };
  }, []);

  const sparkleOrigin = useMemo(() => currentLessonPosition, [currentLessonPosition]);

  if (!enabled || reducedMotion) return null;

  return (
    <g aria-hidden style={{ pointerEvents: "none" }}>
      {/* Clouds — drift left to right across the full map width */}
      {CLOUDS.map((c) => (
        <motion.g
          key={c.id}
          initial={{ x: -c.rx * 2 }}
          animate={{ x: MAP_W + c.rx * 2 }}
          transition={{
            duration: c.duration,
            delay: c.delay,
            repeat: Infinity,
            repeatType: "loop",
            ease: "linear",
          }}
        >
          <ellipse
            cx={0}
            cy={c.y}
            rx={c.rx}
            ry={c.ry}
            fill="rgba(245, 242, 237, 1)"
            opacity={c.opacity}
            filter="blur(18px)"
          />
        </motion.g>
      ))}

      {/* Birds — long arc drift across regions */}
      {BIRDS.map((b) => (
        <motion.g
          key={b.id}
          initial={{ x: b.startX, y: b.startY, opacity: 0 }}
          animate={{
            x: [b.startX, b.endX],
            y: [
              b.startY,
              b.startY + (b.endY - b.startY) * 0.5 - 24,
              b.endY,
            ],
            opacity: [0, 0.45, 0.45, 0],
          }}
          transition={{
            duration: b.duration,
            delay: b.delay,
            repeat: Infinity,
            repeatType: "loop",
            times: [0, 0.5, 1],
            ease: "linear",
          }}
        >
          <BirdGlyph />
        </motion.g>
      ))}

      {/* Sparkles around the current lesson */}
      {sparkleOrigin &&
        SPARKLES.map((s) => (
          <motion.circle
            key={s.id}
            cx={sparkleOrigin.x + s.dx}
            cy={sparkleOrigin.y + s.dy}
            r={2.2}
            fill="rgba(230, 192, 122, 0.9)"
            initial={{ opacity: 0, scale: 0.4 }}
            animate={{ opacity: [0, 0.9, 0], scale: [0.4, 1.2, 0.4] }}
            transition={{
              duration: s.duration,
              delay: s.delay,
              repeat: Infinity,
              repeatType: "loop",
              ease: SPEC_EASE,
            }}
          />
        ))}
    </g>
  );
}

/**
 * A simple bird silhouette as 2 wing curves. Tiny CSS keyframe gives
 * the wings a soft flap without React re-rendering each frame.
 */
function BirdGlyph() {
  return (
    <g>
      {/* Two stroked arcs sharing a center → bird shape */}
      <path
        d="M -10 0 Q -5 -6 0 0"
        stroke="rgba(46, 35, 28, 0.55)"
        strokeWidth={1.3}
        fill="none"
        strokeLinecap="round"
        style={{
          animation: "ambience-wing-flap 0.45s ease-in-out infinite alternate",
          transformOrigin: "0 0",
        }}
      />
      <path
        d="M 0 0 Q 5 -6 10 0"
        stroke="rgba(46, 35, 28, 0.55)"
        strokeWidth={1.3}
        fill="none"
        strokeLinecap="round"
        style={{
          animation: "ambience-wing-flap 0.45s ease-in-out infinite alternate-reverse",
          transformOrigin: "0 0",
        }}
      />
    </g>
  );
}
