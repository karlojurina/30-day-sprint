"use client";

/**
 * Bottom-right toast that appears when the student's streak hits a
 * milestone day (7, 14, or 30). Auto-dismisses after 4s. Caller is
 * responsible for de-duping (i.e. tracking last-shown milestone via
 * a server flag so it doesn't re-fire on streak dip + recovery).
 */

import { motion, AnimatePresence } from "framer-motion";
import { useEffect } from "react";

interface StreakToastProps {
  milestoneDays: 7 | 14 | 30 | null;
  onDismiss: () => void;
}

const MILESTONES = {
  7: {
    label: "Week 1 streak",
    body: "Past the quitting zone. Keep going.",
  },
  14: {
    label: "2-week streak",
    body: "You're consistent now. This is the work.",
  },
  30: {
    label: "30-day streak",
    body: "Full sprint, no missed days. Rare.",
  },
} as const;

export function StreakToast({ milestoneDays, onDismiss }: StreakToastProps) {
  useEffect(() => {
    if (!milestoneDays) return;
    const id = window.setTimeout(onDismiss, 4500);
    return () => window.clearTimeout(id);
  }, [milestoneDays, onDismiss]);

  return (
    <AnimatePresence>
      {milestoneDays && (
        <motion.div
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.96 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="fixed bottom-5 right-5 z-[55] pointer-events-auto"
          style={{
            maxWidth: 320,
            padding: "16px 18px",
            background:
              "linear-gradient(135deg, rgba(230,192,122,0.18) 0%, rgba(230,192,122,0.05) 100%)",
            border: "1px solid var(--color-gold)",
            borderRadius: 12,
            boxShadow:
              "0 12px 28px rgba(0,0,0,0.4), 0 0 30px rgba(230,192,122,0.18)",
            backdropFilter: "blur(10px)",
          }}
        >
          <div className="flex items-start gap-3">
            <div
              className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center"
              style={{
                background:
                  "radial-gradient(circle, rgba(230,192,122,0.28) 0%, transparent 70%)",
                border: "1px solid var(--color-gold)",
              }}
            >
              <span
                className="font-mono"
                style={{
                  color: "var(--color-gold)",
                  fontSize: 14,
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                }}
              >
                {milestoneDays}
              </span>
            </div>
            <div className="min-w-0">
              <p
                className="font-mono uppercase mb-0.5"
                style={{
                  color: "var(--color-gold)",
                  letterSpacing: "0.18em",
                  fontSize: 10,
                }}
              >
                {MILESTONES[milestoneDays].label}
              </p>
              <p
                className="italic"
                style={{
                  fontFamily: "var(--font-display)",
                  color: "rgba(230,220,200,0.88)",
                  fontSize: 14,
                  lineHeight: 1.4,
                }}
              >
                {MILESTONES[milestoneDays].body}
              </p>
            </div>
            <button
              onClick={onDismiss}
              aria-label="Dismiss"
              className="shrink-0 -mr-1 -mt-1 w-6 h-6 rounded-full flex items-center justify-center"
              style={{ color: "rgba(230,220,200,0.5)" }}
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
