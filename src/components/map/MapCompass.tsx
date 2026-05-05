"use client";

import { motion, useSpring, useTransform } from "framer-motion";
import { useEffect } from "react";
import { useStudent } from "@/contexts/StudentContext";

interface MapCompassProps {
  /**
   * Called with the lesson id when the user clicks the compass.
   * The dashboard wires this to its setPanTarget so the camera flies
   * to the targeted lesson.
   */
  onPointerClick: (lessonId: string) => void;
  /** Optional: hide on small viewports if the parent already does that. */
  className?: string;
}

/**
 * Compass rose anchored bottom-right. Needle rotates with spring
 * physics to point at the next uncompleted lesson — so no matter
 * where the student has panned, there's always a one-glance answer
 * to "where am I supposed to be?".
 *
 * Clicking the compass calls `onPointerClick(targetLessonId)` so the
 * parent can pan the camera there.
 *
 * Pure SVG. ~100 KB nothing — no external assets, fully scalable.
 */
export function MapCompass({ onPointerClick, className }: MapCompassProps) {
  const { lessons, completedLessonIds, currentLesson } = useStudent();

  // Pick the target lesson — prefer "currentLesson" if it's not done,
  // otherwise the first lesson in day-order that hasn't been completed.
  const targetLesson = (() => {
    if (currentLesson && !completedLessonIds.has(currentLesson.id)) {
      return currentLesson;
    }
    const byDay = [...lessons].sort(
      (a, b) => a.day - b.day || a.sort_order - b.sort_order
    );
    return byDay.find((l) => !completedLessonIds.has(l.id)) ?? null;
  })();

  // Compute angle from compass center (bottom-right of viewport) to
  // target. We don't have the live SVG coords here without coupling to
  // MapMockup internals, so we approximate using region order:
  // R1 → west, R2 → north-west, R3 → north, R4 → north-east. Good
  // enough for the pilot. (Phase 2c will replace this with real
  // coords from a shared layout context.)
  const angle = (() => {
    if (!targetLesson) return 0;
    const ord = (() => {
      switch (targetLesson.region_id) {
        case "r1":
          return 0; // West
        case "r2":
          return 1;
        case "r3":
          return 2;
        case "r4":
          return 3;
        default:
          return 0;
      }
    })();
    // Map 0-3 to angles -135 (west-ish) → -45 (north-east)
    return -135 + ord * 30;
  })();

  // Spring-driven needle rotation — a needle has weight, so it
  // overshoots slightly and settles. Capped so it stays "calm".
  const rotation = useSpring(angle, {
    stiffness: 60,
    damping: 14,
    mass: 1.2,
  });

  useEffect(() => {
    rotation.set(angle);
  }, [angle, rotation]);

  const transform = useTransform(rotation, (v) => `rotate(${v}deg)`);

  if (!targetLesson) return null;

  return (
    <button
      type="button"
      onClick={() => onPointerClick(targetLesson.id)}
      aria-label={`Compass — points to ${targetLesson.title}. Click to fly there.`}
      title={`Next: ${targetLesson.title}`}
      className={className}
      style={{
        position: "absolute",
        right: 24,
        bottom: 24,
        width: 88,
        height: 88,
        borderRadius: "50%",
        background:
          "radial-gradient(circle at 35% 30%, rgba(16,32,66,0.92) 0%, rgba(10,20,40,0.96) 70%)",
        border: "1px solid rgba(230,192,122,0.45)",
        boxShadow:
          "0 12px 32px rgba(0,0,0,0.5), inset 0 0 24px rgba(230,192,122,0.12)",
        cursor: "pointer",
        zIndex: 25,
        padding: 0,
      }}
    >
      <svg viewBox="-50 -50 100 100" width="86" height="86" aria-hidden="true">
        {/* Outer ring */}
        <circle
          r="46"
          fill="none"
          stroke="rgba(230,192,122,0.32)"
          strokeWidth="0.6"
        />
        <circle
          r="40"
          fill="none"
          stroke="rgba(230,192,122,0.18)"
          strokeWidth="0.4"
        />

        {/* Cardinal tick marks */}
        {[0, 90, 180, 270].map((a) => (
          <line
            key={a}
            x1="0"
            y1="-44"
            x2="0"
            y2="-38"
            stroke="rgba(230,192,122,0.7)"
            strokeWidth="0.8"
            transform={`rotate(${a})`}
          />
        ))}
        {/* Sub-cardinal ticks */}
        {[45, 135, 225, 315].map((a) => (
          <line
            key={a}
            x1="0"
            y1="-43"
            x2="0"
            y2="-39"
            stroke="rgba(230,192,122,0.32)"
            strokeWidth="0.5"
            transform={`rotate(${a})`}
          />
        ))}

        {/* N marker */}
        <text
          x="0"
          y="-30"
          textAnchor="middle"
          fontFamily="var(--font-display)"
          fontStyle="italic"
          fontSize="10"
          fill="rgba(230,192,122,0.85)"
        >
          N
        </text>

        {/* The needle — rotates with spring physics. The motion.g
            sits inside SVG; framer-motion supports SVG transforms via
            inline style, so we set transform via the spring above. */}
        <motion.g style={{ transform, transformOrigin: "center" }}>
          {/* Needle north (active gold) */}
          <polygon
            points="0,-30 -3,0 0,-2 3,0"
            fill="var(--color-gold)"
            stroke="var(--color-gold-light)"
            strokeWidth="0.4"
          />
          {/* Needle south (dimmed) */}
          <polygon
            points="0,30 -3,0 0,2 3,0"
            fill="rgba(230,192,122,0.32)"
          />
          {/* Hub */}
          <circle r="3" fill="rgba(10,20,40,1)" stroke="var(--color-gold)" strokeWidth="0.6" />
        </motion.g>
      </svg>
    </button>
  );
}
