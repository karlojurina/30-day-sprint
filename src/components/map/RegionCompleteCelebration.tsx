"use client";

/**
 * Full-screen "region charted" celebration. Fires once per region the
 * first time it flips from incomplete → complete. Shows a stamp graphic,
 * stats card, and a continue CTA.
 *
 * Persistence is the parent's responsibility — this component renders
 * from props. Parent tracks "newly completed regions" via a ref-diff
 * pattern (same approach already used for the lesson-complete pulse in
 * MapCanvas).
 */

import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { SPEC_EASE } from "@/lib/motion";
import { useFocusTrap } from "@/lib/useFocusTrap";
import type { Region } from "@/types/database";

interface Stats {
  lessons: number;
  daysSpent: number | null;
}

interface RegionCompleteCelebrationProps {
  region: Region | null;
  stats: Stats | null;
  onDismiss: () => void;
}

export function RegionCompleteCelebration({
  region,
  stats,
  onDismiss,
}: RegionCompleteCelebrationProps) {
  return (
    <AnimatePresence>
      {region && (
        <Content region={region} stats={stats} onDismiss={onDismiss} />
      )}
    </AnimatePresence>
  );
}

function Content({
  region,
  stats,
  onDismiss,
}: {
  region: Region;
  stats: Stats | null;
  onDismiss: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, true);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", handler);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handler);
      document.body.style.overflow = "";
    };
  }, [onDismiss]);

  return (
    <>
      <motion.button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss region complete"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.4 }}
        className="fixed inset-0 z-[70] cursor-default"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(6,12,26,0.85) 0%, rgba(6,12,26,0.96) 100%)",
          backdropFilter: "blur(10px)",
          border: "none",
          padding: 0,
        }}
      />

      {/* Decorative rays radiating from center */}
      <motion.svg
        aria-hidden
        className="fixed inset-0 z-[71] pointer-events-none"
        width="100%"
        height="100%"
        viewBox="0 0 800 800"
        preserveAspectRatio="xMidYMid meet"
        initial={{ opacity: 0, rotate: 0 }}
        animate={{ opacity: 0.3, rotate: 360 }}
        exit={{ opacity: 0 }}
        transition={{
          rotate: { duration: 80, repeat: Infinity, ease: "linear" },
          opacity: { duration: 1.5 },
        }}
      >
        {Array.from({ length: 16 }).map((_, i) => (
          <line
            key={i}
            x1={400}
            y1={400}
            x2={400}
            y2={40}
            stroke="rgba(230, 192, 122, 0.5)"
            strokeWidth={1.5}
            strokeDasharray="6 14"
            opacity={0.5}
            transform={`rotate(${i * 22.5} 400 400)`}
          />
        ))}
      </motion.svg>

      <div
        className="fixed inset-0 z-[75] flex items-center justify-center p-4"
        style={{ pointerEvents: "none" }}
      >
        <motion.div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="region-complete-title"
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.97 }}
          transition={{ duration: 0.6, ease: SPEC_EASE, delay: 0.15 }}
          className="text-center"
          style={{ pointerEvents: "auto", maxWidth: 480 }}
        >
          {/* Stamp */}
          <motion.div
            initial={{ scale: 0.4, rotate: -14 }}
            animate={{ scale: 1, rotate: -8 }}
            transition={{
              duration: 0.9,
              delay: 0.25,
              ease: SPEC_EASE,
            }}
            className="mx-auto mb-6 inline-flex"
          >
            <div
              className="relative px-8 py-3"
              style={{
                // Double-line frame — refined ceremonial-stamp treatment.
                // Inner 1.5px border + outer 1.5px outline at 3px offset
                // reads as a vintage postal stamp / certificate seal,
                // not the heavy single-stroke that flags as templated.
                border: "1.5px solid var(--color-gold)",
                outline: "1.5px solid var(--color-gold)",
                outlineOffset: 3,
                borderRadius: 4,
                background: "rgba(230,192,122,0.06)",
                boxShadow: "0 0 50px rgba(230,192,122,0.32)",
              }}
            >
              <span
                className="font-mono uppercase block"
                style={{
                  color: "var(--color-gold)",
                  letterSpacing: "0.32em",
                  fontSize: 14,
                  fontWeight: 700,
                }}
              >
                Complete
              </span>
            </div>
          </motion.div>

          <motion.span
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.55 }}
            className="font-mono uppercase block mb-3"
            style={{
              color: "rgba(230,192,122,0.8)",
              letterSpacing: "0.22em",
              fontSize: 12,
            }}
          >
            Region {region.order_num} complete
          </motion.span>

          <motion.h2
            id="region-complete-title"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.6,
              delay: 0.65,
              ease: SPEC_EASE,
            }}
            className="italic mb-3"
            style={{
              fontFamily: "var(--font-display)",
              color: "var(--color-ink)",
              fontWeight: 500,
              fontSize: 48,
              lineHeight: 1.05,
            }}
          >
            {region.name}
          </motion.h2>

          {region.tagline && (
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.78 }}
              className="italic mb-7"
              style={{
                fontFamily: "var(--font-display)",
                color: "rgba(230,220,200,0.65)",
                fontSize: 16,
                maxWidth: 380,
                margin: "0 auto 28px",
              }}
            >
              {region.tagline}
            </motion.p>
          )}

          {stats && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.9 }}
              className="flex justify-center gap-8 mb-8"
            >
              <Stat label="Lessons" value={stats.lessons.toString()} />
              {stats.daysSpent != null && (
                <Stat
                  label="Days"
                  value={stats.daysSpent === 0 ? "Same day" : stats.daysSpent.toString()}
                />
              )}
            </motion.div>
          )}

          <motion.button
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 1.0 }}
            onClick={onDismiss}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.97 }}
            className="px-6 py-3 rounded-lg font-semibold inline-flex items-center gap-2"
            style={{
              background: "var(--color-gold)",
              color: "var(--color-bg-primary)",
              fontSize: 14,
            }}
          >
            Continue
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </motion.button>
        </motion.div>
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        className="font-mono"
        style={{
          color: "var(--color-gold-light)",
          fontSize: 32,
          fontWeight: 600,
          fontFeatureSettings: '"tnum"',
        }}
      >
        {value}
      </div>
      <div
        className="font-mono uppercase mt-1"
        style={{
          color: "rgba(230,220,200,0.5)",
          letterSpacing: "0.18em",
          fontSize: 10,
        }}
      >
        {label}
      </div>
    </div>
  );
}
