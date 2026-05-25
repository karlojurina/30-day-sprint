"use client";

/**
 * v65 - Region quiz result screen. Replaces the v54 WinScreen.
 *
 * Drives the post-attempt state: shows the percentage, the
 * pass/fail badge, an optional review of wrong answers, and the
 * two CTAs (Retake + Continue). Continue is only enabled when the
 * student has passed at >= 50% on the OVERALL best score (not
 * just this attempt) - so a student who already passed once and
 * just retook for fun can still continue even if this attempt
 * was a regression.
 *
 * Per Karlo's overhaul:
 *   • Pass bar is 50%. Below that, Onward stays locked and Retake
 *     is the primary CTA.
 *   • Review is opt-in (Show review toggle) - we don't want to
 *     overwhelm a failing student with a wall of correct answers
 *     before they've had a chance to feel the grade.
 *   • Retake has no cooldown. Click it and we're back to a fresh
 *     deck immediately.
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { QuizWrongAnswer } from "./SwipeCardsQuiz";

export interface ResultScreenProps {
  /** This attempt's score (0-100). */
  scorePct: number;
  /** OVERALL pass state (best ever >= 50%). Drives whether
   *  Continue is enabled - not just this attempt. */
  overallPassed: boolean;
  /** Cards the student got wrong this attempt. */
  wrongAnswers: QuizWrongAnswer[];
  /** Total questions in the deck (for the "X out of Y" line). */
  total: number;
  onRetake: () => void;
  onContinue: () => void;
}

function gradeFor(scorePct: number): { label: string; color: string } {
  if (scorePct >= 90) return { label: "Crushed it", color: "#86EFAC" };
  if (scorePct >= 75) return { label: "Solid", color: "#86EFAC" };
  if (scorePct >= 50) return { label: "Passed", color: "#86EFAC" };
  return { label: "Not yet", color: "#FCA5A5" };
}

export function ResultScreen({
  scorePct,
  overallPassed,
  wrongAnswers,
  total,
  onRetake,
  onContinue,
}: ResultScreenProps) {
  const correctCount = total - wrongAnswers.length;
  const grade = gradeFor(scorePct);
  const passedThisAttempt = scorePct >= 50;
  const [reviewOpen, setReviewOpen] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        padding: "28px 24px 22px",
        gap: 18,
        overflow: "auto",
      }}
    >
      {/* Big score + grade */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 4,
        }}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{
            duration: 0.5,
            delay: 0.1,
            ease: [0.22, 1, 0.36, 1],
          }}
          style={{
            fontSize: 64,
            fontWeight: 700,
            letterSpacing: "-0.04em",
            color: passedThisAttempt ? "#86EFAC" : "#FCA5A5",
            lineHeight: 1,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {scorePct}%
        </motion.div>
        <motion.p
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.3 }}
          style={{
            fontSize: 13,
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: grade.color,
            marginTop: 6,
          }}
        >
          {grade.label}
        </motion.p>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.4 }}
          style={{
            fontSize: 13,
            color: "rgba(255,255,255,0.55)",
            letterSpacing: "-0.005em",
            marginTop: 2,
          }}
        >
          {correctCount} of {total} correct · pass at 50%
        </motion.p>
      </div>

      {/* Status line - what the student needs to do next */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.5 }}
        style={{
          padding: "12px 14px",
          borderRadius: 10,
          background: overallPassed
            ? "rgba(74,222,128,0.08)"
            : "rgba(252,165,165,0.06)",
          border: overallPassed
            ? "1px solid rgba(74,222,128,0.28)"
            : "1px solid rgba(252,165,165,0.30)",
          fontSize: 13,
          lineHeight: 1.5,
          color: "rgba(255,255,255,0.86)",
          textAlign: "center",
        }}
      >
        {overallPassed
          ? "Path opened. Continue when you're ready, or retake to push the score up."
          : `Onward stays locked until you hit 50%. You needed ${Math.max(1, Math.ceil(total * 0.5) - correctCount)} more right.`}
      </motion.div>

      {/* Review toggle - only show if there were wrong answers */}
      {wrongAnswers.length > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.55 }}
          style={{ display: "flex", flexDirection: "column", gap: 10 }}
        >
          <button
            type="button"
            onClick={() => setReviewOpen((v) => !v)}
            style={{
              alignSelf: "center",
              padding: "8px 14px",
              borderRadius: 8,
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.14)",
              color: "rgba(255,255,255,0.72)",
              fontSize: 12,
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.10em",
              textTransform: "uppercase",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            {reviewOpen ? "Hide review" : `Review ${wrongAnswers.length} miss${wrongAnswers.length === 1 ? "" : "es"}`}
            <span
              aria-hidden="true"
              style={{
                display: "inline-block",
                transform: reviewOpen ? "rotate(180deg)" : "rotate(0deg)",
                transition: "transform 220ms cubic-bezier(0.22,1,0.36,1)",
                fontSize: 10,
              }}
            >
              ▾
            </span>
          </button>

          <AnimatePresence initial={false}>
            {reviewOpen && (
              <motion.div
                key="review-list"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                style={{
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                {wrongAnswers.map(({ card, correctText }) => (
                  <div
                    key={card.id}
                    style={{
                      padding: "12px 14px",
                      borderRadius: 10,
                      background: "rgba(255,255,255,0.03)",
                      border: "1px solid rgba(255,255,255,0.08)",
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                    }}
                  >
                    <p
                      style={{
                        fontSize: 13.5,
                        fontWeight: 500,
                        color: "rgba(255,255,255,0.92)",
                        letterSpacing: "-0.008em",
                        lineHeight: 1.4,
                      }}
                    >
                      {card.question_text}
                    </p>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        gap: 8,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 10,
                          fontFamily: "var(--font-mono)",
                          letterSpacing: "0.18em",
                          textTransform: "uppercase",
                          color: "rgba(134,239,172,0.86)",
                        }}
                      >
                        Correct
                      </span>
                      <span
                        style={{
                          fontSize: 13,
                          color: "rgba(255,255,255,0.86)",
                        }}
                      >
                        {correctText}
                      </span>
                    </div>
                    <p
                      style={{
                        fontSize: 12.5,
                        color: "rgba(255,255,255,0.66)",
                        lineHeight: 1.5,
                        letterSpacing: "-0.005em",
                      }}
                    >
                      {card.why_text}
                    </p>
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}

      <div style={{ flex: 1 }} />

      {/* CTAs */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.6 }}
        style={{
          display: "grid",
          gridTemplateColumns: overallPassed ? "1fr 1fr" : "1fr",
          gap: 10,
        }}
      >
        <button
          type="button"
          onClick={onRetake}
          style={{
            padding: "14px 18px",
            background: overallPassed
              ? "rgba(255,255,255,0.06)"
              : "linear-gradient(180deg, rgba(255,255,255,0.96) 0%, rgba(238,242,247,0.96) 100%)",
            border: overallPassed
              ? "1px solid rgba(255,255,255,0.16)"
              : "1px solid rgba(255,255,255,0.40)",
            borderRadius: 12,
            color: overallPassed
              ? "rgba(255,255,255,0.88)"
              : "rgba(15,17,21,0.92)",
            fontSize: 14,
            fontWeight: 700,
            letterSpacing: "0.02em",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
        >
          {overallPassed ? "Retake" : "Try again"}
        </button>
        {overallPassed && (
          <button
            type="button"
            onClick={onContinue}
            style={{
              padding: "14px 18px",
              background:
                "linear-gradient(180deg, rgba(255,255,255,0.96) 0%, rgba(238,242,247,0.96) 100%)",
              border: "1px solid rgba(255,255,255,0.40)",
              borderRadius: 12,
              color: "rgba(15,17,21,0.92)",
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: "0.02em",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            Continue
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
        )}
      </motion.div>
    </motion.div>
  );
}
