"use client";

/**
 * Shared region-quiz modal wrapper.
 *
 * Hosts the modal chrome (backdrop, header, close, result screen)
 * so each per-format component (SwipeCardsQuiz, future StackBuilder,
 * etc.) only has to render its own card/interaction surface.
 *
 * v65 - the format components signal completion by handing the
 * parent a CompletePayload (correctIds + wrongAnswers + total).
 * The parent computes the score, submits it to the server, then
 * sets the `result` prop here, which mounts ResultScreen.
 *
 * Continue / Retake are owned by ResultScreen and fire onAdvance /
 * onRetake here, which the parent wires up.
 */

import { ReactNode, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ResultScreen } from "./ResultScreen";
import type { QuizWrongAnswer } from "./SwipeCardsQuiz";

export interface QuizResult {
  scorePct: number;
  overallPassed: boolean;
  wrongAnswers: QuizWrongAnswer[];
  total: number;
}

interface QuizModalProps {
  open: boolean;
  regionName: string;
  /** "Question 5 of 19" left-side counter. Format component computes
   *  this from its own deck state. */
  progressLine: string;
  /** v65 - non-null = the student finished an attempt and we show
   *  the result screen instead of the deck. */
  result: QuizResult | null;
  onClose: () => void;
  /** v65 - fires when the student clicks Continue on the result
   *  screen. Parent should transitionTo the next region. */
  onAdvance: () => void;
  /** v65 - fires when the student clicks Retake on the result
   *  screen. Parent should remount the format component with a
   *  fresh deck (e.g. bump a session key). */
  onRetake: () => void;
  children: ReactNode;
}

export function QuizModal({
  open,
  regionName,
  progressLine,
  result,
  onClose,
  onAdvance,
  onRetake,
  children,
}: QuizModalProps) {
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
                  {result ? "Results" : progressLine}
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

            {/* Body - either the format component OR the result screen */}
            <div
              style={{
                position: "relative",
                flex: 1,
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
              }}
            >
              {result ? (
                <ResultScreen
                  scorePct={result.scorePct}
                  overallPassed={result.overallPassed}
                  wrongAnswers={result.wrongAnswers}
                  total={result.total}
                  onRetake={onRetake}
                  onContinue={onAdvance}
                />
              ) : (
                children
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return createPortal(content, document.body);
}
