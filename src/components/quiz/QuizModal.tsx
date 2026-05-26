"use client";

/**
 * Shared region-quiz modal wrapper.
 *
 * Hosts the modal chrome (backdrop, header, close, result screen) so
 * each per-format component (SwipeCardsQuiz, StackBuilderQuiz, etc.)
 * only has to render its own card/interaction surface.
 *
 * v65 - the format components signal completion by handing the
 * parent a CompletePayload (correctIds + wrongAnswers + total). The
 * parent computes the score, submits it to the server, then sets
 * the `result` prop here, which mounts ResultScreen.
 *
 * v70.3 - animation slots live OUTSIDE the modal panel (per Karlo:
 * "Animations can be outside of that main question window and float
 *  ... above the question window floating or on the sides floating").
 * Format components portal their animation visuals into these slots
 * via the `useQuizAnimationSlots` context. The modal panel itself
 * stays compact, R1-style, containing just question + buttons.
 *
 * Slot layout in the overlay:
 *
 *        ┌──────────────────────┐
 *        │     [top slot]       │     ← animations float here
 *        └──────────────────────┘
 *   ┌──┐ ┌──────────────────────┐ ┌──┐
 *   │L │ │   modal panel        │ │R │ ← compact panel; question +
 *   │  │ │   (compact)          │ │  │   buttons only.
 *   └──┘ └──────────────────────┘ └──┘
 */

import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
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

/** Animation slots exposed by QuizModal. Format components consume
 *  them via useQuizAnimationSlots() + createPortal to render their
 *  visual OUTSIDE the modal panel (top / left / right of it). */
interface QuizAnimationSlots {
  top: HTMLDivElement | null;
  left: HTMLDivElement | null;
  right: HTMLDivElement | null;
}

const QuizAnimationSlotsContext = createContext<QuizAnimationSlots>({
  top: null,
  left: null,
  right: null,
});

export function useQuizAnimationSlots(): QuizAnimationSlots {
  return useContext(QuizAnimationSlotsContext);
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

  // v70.3 - DOM refs for animation slots that live OUTSIDE the modal
  // panel. State-setter refs (not useRef) so children re-render after
  // mount and pick up the now-non-null slot element via context.
  const [topSlot, setTopSlot] = useState<HTMLDivElement | null>(null);
  const [leftSlot, setLeftSlot] = useState<HTMLDivElement | null>(null);
  const [rightSlot, setRightSlot] = useState<HTMLDivElement | null>(null);

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
          onWheel={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
          className="fixed inset-0 z-[170]"
          style={{
            background:
              "radial-gradient(ellipse at center, rgba(8,12,22,0.92) 0%, rgba(4,8,16,0.98) 100%)",
            backdropFilter: "blur(20px) saturate(140%)",
            WebkitBackdropFilter: "blur(20px) saturate(140%)",
            padding: 16,
            // v70.7 - 3-row grid layout. Row 1 (1fr): top space +
            // top slot anchored to bottom of row. Row 2 (auto):
            // modal panel. Row 3 (1fr): bottom space. Equal 1fr
            // rows mean the modal lands EXACTLY at viewport center
            // regardless of how tall the top slot's animation gets.
            // Replaces flex items-center which let animation
            // overflow push perceived layout around on small
            // viewports.
            display: "grid",
            gridTemplateRows: "1fr auto 1fr",
            justifyItems: "center",
            alignItems: "center",
          }}
        >
          {/* GRID ROW 1: top slot - anchored to the BOTTOM of row 1
              so the animation sits just above the modal panel's
              top edge. justifyItems on the parent grid centers
              horizontally. Wider than the panel so formats with
              wide visuals (Vault dials) can extend beyond the
              panel edges - like a shelf above the panel. */}
          <div
            ref={setTopSlot}
            style={{
              alignSelf: "end",
              marginBottom: 24,
              width: "min(720px, 100vw)",
              display: "flex",
              justifyContent: "center",
              pointerEvents: "none",
            }}
          />

          {/* GRID ROW 2: modal cluster. Sits in the auto-sized
              middle row, which is EXACTLY at viewport center
              (because rows 1 and 3 are equal 1fr). */}
          <div
            style={{
              position: "relative",
              width: "min(560px, 100%)",
              flexShrink: 0,
            }}
          >
            {/* LEFT slot - right edge sits at the panel's left edge. */}
            <div
              ref={setLeftSlot}
              style={{
                position: "absolute",
                right: "100%",
                marginRight: 24,
                top: "50%",
                transform: "translateY(-50%)",
                display: "flex",
                justifyContent: "center",
                pointerEvents: "none",
              }}
            />

            {/* RIGHT slot - left edge sits at the panel's right edge. */}
            <div
              ref={setRightSlot}
              style={{
                position: "absolute",
                left: "100%",
                marginLeft: 24,
                top: "50%",
                transform: "translateY(-50%)",
                display: "flex",
                justifyContent: "center",
                pointerEvents: "none",
              }}
            />

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

                {/* Body - either the format component OR the result
                    screen */}
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
                    <QuizAnimationSlotsContext.Provider
                      value={{ top: topSlot, left: leftSlot, right: rightSlot }}
                    >
                      {children}
                    </QuizAnimationSlotsContext.Provider>
                  )}
                </div>
              </motion.div>
          </div>

          {/* GRID ROW 3: empty spacer. Balances row 1 (1fr) so the
              modal in row 2 lands at exactly viewport center. */}
          <div />
        </motion.div>
      )}
    </AnimatePresence>
  );

  return createPortal(content, document.body);
}
