"use client";

/**
 * Shared region-quiz modal wrapper (brief: lovro-brief-region-quiz).
 *
 * Hosts the modal chrome (backdrop, header, close, win screen) so
 * each per-format component (SwipeCardsQuiz, future StackBuilder,
 * etc.) only has to render its own card/interaction surface.
 *
 * The format components signal completion by calling onPass; the
 * wrapper renders the WinScreen and persists quiz_passed_at via
 * the StudentContext mutator. After ~2s or Continue click, it
 * dismisses + the caller transitions to the next region.
 */

import { ReactNode, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { WinScreen } from "./WinScreen";

interface QuizModalProps {
  open: boolean;
  regionName: string;
  /** "12 of 19" left-side counter line. Format component computes
   *  this from its own deck state. */
  progressLine: string;
  /** Passed in by the format component when the student clears the
   *  deck (or whatever the win condition is). Triggers the win
   *  screen overlay; the parent persists + transitions on Continue. */
  passed: boolean;
  onClose: () => void;
  /** Fires when the student dismisses the win screen (Continue or
   *  auto-timer). Parent should transitionTo the next region. */
  onAdvance: () => void;
  children: ReactNode;
}

export function QuizModal({
  open,
  regionName,
  progressLine,
  passed,
  onClose,
  onAdvance,
  children,
}: QuizModalProps) {
  // Auto-advance the win screen at 2s.
  useEffect(() => {
    if (!passed) return;
    const t = window.setTimeout(() => onAdvance(), 2000);
    return () => window.clearTimeout(t);
  }, [passed, onAdvance]);

  // Lock body scroll while open + close on Escape.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (typeof document === "undefined") return null;

  const content = (
    <AnimatePresence>
      {open && (
        <motion.div
          key="region-quiz-modal"
          role="dialog"
          aria-modal="true"
          aria-label={`${regionName} quiz`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          // Stop wheel/touchmove from bubbling into the map zoom
          // handler under the modal.
          onWheel={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
          className="fixed inset-0 z-[170] flex items-center justify-center"
          style={{
            background:
              "radial-gradient(ellipse at center, rgba(8,12,22,0.92) 0%, rgba(4,8,16,0.98) 100%)",
            backdropFilter: "blur(20px) saturate(140%)",
            WebkitBackdropFilter: "blur(20px) saturate(140%)",
            padding: 16,
          }}
        >
          <motion.div
            initial={{ scale: 0.96, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            style={{
              width: "min(560px, 100%)",
              maxHeight: "92vh",
              display: "flex",
              flexDirection: "column",
              background: "rgba(15, 17, 21, 0.96)",
              border: "1px solid rgba(255, 255, 255, 0.12)",
              borderRadius: 18,
              boxShadow:
                "0 30px 80px rgba(0,0,0,0.60), 0 1px 0 rgba(255,255,255,0.05) inset",
              color: "rgba(255,255,255,0.94)",
              overflow: "hidden",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "16px 20px 12px",
                borderBottom: "1px solid rgba(255,255,255,0.06)",
                flexShrink: 0,
              }}
            >
              <div>
                <p
                  style={{
                    fontSize: 10,
                    fontFamily: "var(--font-mono)",
                    letterSpacing: "0.22em",
                    textTransform: "uppercase",
                    color: "rgba(255,255,255,0.45)",
                    marginBottom: 2,
                  }}
                >
                  {regionName} quiz
                </p>
                <p
                  style={{
                    fontSize: 13,
                    color: "rgba(255,255,255,0.78)",
                    fontVariantNumeric: "tabular-nums",
                    letterSpacing: "-0.005em",
                  }}
                >
                  {progressLine}
                </p>
              </div>
              <button
                onClick={onClose}
                aria-label="Close quiz"
                style={{
                  background: "transparent",
                  border: "1px solid rgba(255,255,255,0.14)",
                  borderRadius: 8,
                  color: "rgba(255,255,255,0.65)",
                  width: 30,
                  height: 30,
                  cursor: "pointer",
                  fontSize: 17,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                ×
              </button>
            </div>

            {/* Body - either the format component OR the win screen */}
            <div
              style={{
                position: "relative",
                flex: 1,
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
              }}
            >
              {passed ? <WinScreen onAdvance={onAdvance} /> : children}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return createPortal(content, document.body);
}
