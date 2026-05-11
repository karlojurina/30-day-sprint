"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { SPEC_EASE } from "@/lib/motion";

interface StreakCelebrationProps {
  /** Streak count to celebrate. Null = no celebration showing. */
  streak: number | null;
  onDismiss: () => void;
}

/**
 * Premium streak celebration modal — fires when a student completes
 * their first lesson of a new day (streak ticks up).
 *
 * Sequence (~1.5s before becoming dismissable):
 *   0.0 → backdrop fades in
 *   0.1 → flame scales 0 → 1.2 → 1.0 with spring bounce
 *   0.4 → "Day N streak!" headline animates in (rise + fade)
 *   0.65 → subtitle animates in
 *   1.5 → fully interactive, click anywhere to dismiss
 *   Auto-dismiss safety net at 5s if the student hasn't clicked.
 *
 * Click anywhere → fade-out (250ms) → onDismiss().
 */
export function StreakCelebration({ streak, onDismiss }: StreakCelebrationProps) {
  const [visible, setVisible] = useState(false);
  const dismissTimer = useRef<number | null>(null);

  useEffect(() => {
    if (streak == null) {
      setVisible(false);
      return;
    }
    setVisible(true);
    // Auto-dismiss safety net at 5s.
    dismissTimer.current = window.setTimeout(() => {
      setVisible(false);
    }, 5000);
    return () => {
      if (dismissTimer.current) {
        window.clearTimeout(dismissTimer.current);
        dismissTimer.current = null;
      }
    };
  }, [streak]);

  // After the visible-out animation finishes, tell the parent.
  function handleAnimationComplete() {
    if (!visible) onDismiss();
  }

  function handleClick() {
    setVisible(false);
  }

  if (streak == null) return null;

  return (
    <AnimatePresence onExitComplete={handleAnimationComplete}>
      {visible && (
        <motion.div
          key="streak-celebration"
          role="dialog"
          aria-modal="true"
          aria-label={`${streak} day streak`}
          onClick={handleClick}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25, ease: SPEC_EASE }}
          className="fixed inset-0 z-[200] flex items-center justify-center"
          style={{
            background:
              "radial-gradient(ellipse at center, rgba(8,12,22,0.78) 0%, rgba(4,8,16,0.92) 100%)",
            backdropFilter: "blur(14px) saturate(140%)",
            WebkitBackdropFilter: "blur(14px) saturate(140%)",
            cursor: "pointer",
          }}
        >
          {/* Sparks layer — small radial flecks expanding outward,
              behind the flame. Pure decoration. */}
          <Sparks />

          <motion.div
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.92, opacity: 0 }}
            transition={{
              type: "spring",
              stiffness: 220,
              damping: 18,
              mass: 0.9,
            }}
            className="flex flex-col items-center"
            style={{ pointerEvents: "none" }}
          >
            {/* Flame — larger, animated version of the topbar streak.
                Wrapped with a DOM-level warm glow that's unbounded
                (no SVG viewBox to clip it), so the flame reads as
                catching the room rather than sitting in a frame. */}
            <motion.div
              initial={{ scale: 0.5 }}
              animate={{ scale: 1 }}
              transition={{
                type: "spring",
                stiffness: 200,
                damping: 14,
                delay: 0.1,
              }}
              style={{
                marginBottom: 28,
                position: "relative",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {/* Soft warm radial glow behind the flame */}
              <div
                aria-hidden="true"
                style={{
                  position: "absolute",
                  inset: -60,
                  borderRadius: "50%",
                  background:
                    "radial-gradient(circle, rgba(255, 200, 100, 0.32) 0%, rgba(255, 140, 60, 0.14) 35%, rgba(255, 100, 40, 0) 65%)",
                  pointerEvents: "none",
                  filter: "blur(8px)",
                }}
              />
              <BigFlame />
            </motion.div>

            <motion.p
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: 0.4, ease: SPEC_EASE }}
              style={{
                fontSize: 14,
                fontWeight: 500,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                color: "rgba(255, 200, 130, 0.82)",
                marginBottom: 10,
              }}
            >
              You&rsquo;re on a streak
            </motion.p>

            <motion.h1
              initial={{ opacity: 0, y: 18, scale: 0.92 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{
                duration: 0.55,
                delay: 0.5,
                ease: SPEC_EASE,
              }}
              style={{
                fontSize: 96,
                fontWeight: 700,
                letterSpacing: "-0.04em",
                lineHeight: 1,
                color: "#FFE4A8",
                fontVariantNumeric: "tabular-nums",
                textShadow: "0 0 60px rgba(255, 180, 90, 0.5)",
              }}
            >
              {streak}
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: 0.7, ease: SPEC_EASE }}
              style={{
                fontSize: 22,
                fontWeight: 600,
                letterSpacing: "-0.02em",
                color: "rgba(255, 247, 235, 0.94)",
                marginTop: 6,
              }}
            >
              {streak === 1 ? "Day one." : `${streak} days in a row.`}
            </motion.p>

            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: 0.85, ease: SPEC_EASE }}
              style={{
                fontSize: 14,
                fontWeight: 500,
                letterSpacing: "-0.005em",
                color: "rgba(255, 247, 235, 0.55)",
                marginTop: 18,
                maxWidth: 360,
                textAlign: "center",
                lineHeight: 1.4,
              }}
            >
              Come back tomorrow to keep it alive.
            </motion.p>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              transition={{ duration: 0.5, delay: 1.5 }}
              style={{
                fontSize: 12,
                fontWeight: 500,
                letterSpacing: "-0.005em",
                color: "rgba(255, 247, 235, 0.4)",
                marginTop: 36,
              }}
            >
              Click anywhere to continue
            </motion.p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Big flame at hero scale. Uses the same SVG paths as StreakFlame
 *  so the icon family stays consistent. The radial glow is rendered
 *  as a separate full-screen DOM layer (see StreakCelebration body)
 *  rather than inside the SVG, so the SVG viewBox doesn't clip it.
 *  `overflow: visible` keeps the soft outer glow from being cropped
 *  if the flame ever grows past its bounding box. */
function BigFlame() {
  return (
    <svg
      width="160"
      height="180"
      viewBox="-2 -2 28 32"
      aria-hidden="true"
      style={{ overflow: "visible" }}
    >
      <defs>
        <linearGradient id="big-flame-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FF4500" />
          <stop offset="55%" stopColor="#FF8C3C" />
          <stop offset="100%" stopColor="#FFE9B0" />
        </linearGradient>
      </defs>

      {/* Outer flame body */}
      <path
        d="M12 2 C 9 7, 5 10, 5 16 a 7 7 0 0 0 14 0 C 19 12, 16 10, 14 6 C 13 9, 11 9, 12 2 Z"
        fill="url(#big-flame-grad)"
        stroke="rgba(255, 180, 60, 0.5)"
        strokeWidth={0.4}
      >
        <animate
          attributeName="opacity"
          values="0.95;1;0.95"
          dur="1.8s"
          repeatCount="indefinite"
        />
      </path>

      {/* Inner flame core */}
      <path
        d="M12 9 C 10 12, 8 14, 8 17 a 4 4 0 0 0 8 0 C 16 14, 14 12, 12 9 Z"
        fill="#FFE9B0"
        opacity="0.95"
      >
        <animate
          attributeName="opacity"
          values="0.85;1;0.85"
          dur="1.4s"
          repeatCount="indefinite"
        />
      </path>
    </svg>
  );
}

/** 12 small spark flecks emanating outward from center.
 *  Uses framer-motion for staggered radial spread. */
function Sparks() {
  return (
    <div
      className="absolute inset-0"
      aria-hidden="true"
      style={{ pointerEvents: "none" }}
    >
      {Array.from({ length: 16 }).map((_, i) => {
        const angle = (i * 360) / 16;
        const rad = (angle * Math.PI) / 180;
        const distance = 220 + (i % 3) * 40;
        const x = Math.cos(rad) * distance;
        const y = Math.sin(rad) * distance;
        return (
          <motion.div
            key={i}
            initial={{ x: 0, y: 0, opacity: 0, scale: 0.4 }}
            animate={{ x, y, opacity: [0, 0.85, 0], scale: 1 }}
            transition={{
              duration: 1.4,
              delay: 0.2 + (i % 4) * 0.06,
              ease: "easeOut",
            }}
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "rgba(255, 200, 130, 0.95)",
              boxShadow:
                "0 0 8px rgba(255, 180, 100, 0.7), 0 0 16px rgba(255, 140, 60, 0.4)",
            }}
          />
        );
      })}
    </div>
  );
}
