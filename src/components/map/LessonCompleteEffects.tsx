"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { useStudent } from "@/contexts/StudentContext";
import { SPEC_EASE } from "@/lib/motion";

/**
 * Lesson completion visual effect.
 *
 * Tracks `completedLessonIds` from StudentContext. When a NEW id
 * appears (the student just marked something done), fires a soft
 * gold ink-bloom that flashes across the map (~850 ms). Self-
 * contained: doesn't modify MapMockup, sits on top as an
 * absolutely-positioned pointer-events-none layer.
 *
 * Future: Phase 3 will replace this global bloom with a per-node
 * ink-fill animation tied to the actual lesson node's SVG position.
 */
export function LessonCompleteEffects() {
  const { completedLessonIds } = useStudent();
  const prevIdsRef = useRef<Set<string> | null>(null);
  const [bloomKey, setBloomKey] = useState(0);

  useEffect(() => {
    const prev = prevIdsRef.current;

    // First render — seed the ref so we don't fire on initial load
    // for already-completed lessons.
    if (prev === null) {
      prevIdsRef.current = new Set(completedLessonIds);
      return;
    }

    // Detect newly-added ids
    let newOne: string | null = null;
    for (const id of completedLessonIds) {
      if (!prev.has(id)) {
        newOne = id;
        break;
      }
    }

    if (newOne) {
      setBloomKey((k) => k + 1);
    }

    prevIdsRef.current = new Set(completedLessonIds);
  }, [completedLessonIds]);

  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        overflow: "hidden",
        zIndex: 20,
      }}
    >
      <AnimatePresence>
        {bloomKey > 0 && (
          <motion.div
            key={bloomKey}
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.35, 0] }}
            transition={{ duration: 0.85, ease: SPEC_EASE, times: [0, 0.25, 1] }}
            exit={{ opacity: 0 }}
            style={{
              position: "absolute",
              inset: 0,
              background:
                "radial-gradient(circle at 50% 60%, rgba(230,192,122,0.55) 0%, rgba(230,192,122,0.18) 40%, rgba(230,192,122,0) 70%)",
              mixBlendMode: "screen",
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
