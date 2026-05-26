"use client";

/**
 * Region 4 quiz format: Vault Tumblers - the capstone.
 *
 * Visual spec per brief v2 §08: 5 dials horizontally at the top.
 * Each dial = 3 questions (Q1-Q3 → dial 1, Q4-Q6 → dial 2, etc.).
 * Questions in fixed 1→15 order (no shuffle - themed by dial).
 * Each dial rotates + locks when all 3 of its questions are
 * answered correctly. If any wrong, the dial stays "partial"
 * showing the marks it earned (0/3, 1/3, 2/3).
 *
 * Mechanics: v65 drain-through (each question shown once, wrong
 * stays wrong, advance). Pass at >= 50% (8/15).
 *
 * Perfect-run bonus (5/5 dials locked): VAULT OPEN overlay
 * before the ResultScreen renders. Sub-perfect runs go straight
 * to ResultScreen.
 *
 * Same QuizCompletePayload contract as SwipeCardsQuiz +
 * StackBuilderQuiz. Plugs into shared QuizModal + ResultScreen.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import type { SwipeCardQuestion } from "@/lib/region-quizzes";
import type {
  QuizCompletePayload,
  QuizWrongAnswer,
} from "./SwipeCardsQuiz";
import { useQuizAnimationSlots } from "./QuizModal";

interface VaultTumblersQuizProps {
  /** Brief v2: must be exactly 15 cards in fixed 1→15 order. */
  cards: SwipeCardQuestion[];
  onProgressChange: (line: string) => void;
  onComplete: (result: QuizCompletePayload) => void;
}

interface RevealState {
  kind: "correct" | "wrong";
  card: SwipeCardQuestion;
  correctText: string | null;
}

const DIAL_COUNT = 5;
const QUESTIONS_PER_DIAL = 3;

export function VaultTumblersQuiz({
  cards,
  onProgressChange,
  onComplete,
}: VaultTumblersQuizProps) {
  // Fixed order per brief - NO shuffle. Dials are themed by group.
  const [questionIdx, setQuestionIdx] = useState(0);
  const [correctIds, setCorrectIds] = useState<Set<string>>(() => new Set());
  const [wrongAnswers, setWrongAnswers] = useState<QuizWrongAnswer[]>([]);
  const [reveal, setReveal] = useState<RevealState | null>(null);
  // Counter-rotate trigger: increments on each wrong answer so the
  // active dial briefly counter-rotates ("thunk").
  const [thunkKey, setThunkKey] = useState(0);

  // Per-card A/B swap (which option appears on the LEFT). Keyed by
  // card id, stable per render.
  const swapAbForCard = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const c of cards) m.set(c.id, Math.random() < 0.5);
    return m;
  }, [cards]);

  const total = cards.length; // expected 15
  const top = questionIdx < total ? cards[questionIdx] : null;

  useEffect(() => {
    onProgressChange(`Question ${Math.min(questionIdx + 1, total)} of ${total}`);
  }, [questionIdx, total, onProgressChange]);

  useEffect(() => {
    if (questionIdx >= total && total > 0) {
      onComplete({ correctIds, wrongAnswers, total });
    }
    // Intentionally omit onComplete from deps - fires once on the
    // questionIdx >= total transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionIdx, total]);

  const advance = useCallback(() => {
    setQuestionIdx((i) => i + 1);
    setReveal(null);
  }, []);

  const handlePick = useCallback(
    (pick: "left" | "right") => {
      if (!top || reveal != null) return;

      let isCorrect = false;
      let correctText: string | null = null;
      if (top.question_type === "true_false") {
        const chosen = pick === "right" ? "true" : "false";
        isCorrect = chosen === top.correct_answer;
        if (!isCorrect)
          correctText = top.correct_answer === "true" ? "TRUE" : "FALSE";
      } else {
        const swap = swapAbForCard.get(top.id) ?? false;
        const leftIsA = !swap;
        const chosenLetter =
          pick === "left" ? (leftIsA ? "a" : "b") : leftIsA ? "b" : "a";
        isCorrect = chosenLetter === top.correct_answer;
        if (!isCorrect) {
          correctText =
            top.correct_answer === "a" ? top.option_a : top.option_b;
        }
      }

      if (isCorrect) {
        setCorrectIds((prev) => {
          const next = new Set(prev);
          next.add(top.id);
          return next;
        });
        setReveal({ kind: "correct", card: top, correctText: null });
      } else {
        const derivedCorrect =
          correctText ??
          (top.question_type === "true_false"
            ? top.correct_answer === "true"
              ? "TRUE"
              : "FALSE"
            : top.correct_answer === "a"
              ? top.option_a
              : top.option_b);
        setWrongAnswers((prev) => [
          ...prev,
          { card: top, correctText: derivedCorrect },
        ]);
        setReveal({ kind: "wrong", card: top, correctText });
        setThunkKey((k) => k + 1);
      }
    },
    [top, reveal, swapAbForCard],
  );

  const advanceFromReveal = useCallback(() => {
    if (reveal == null) return;
    advance();
  }, [reveal, advance]);

  // Keyboard: ← LEFT, → RIGHT, Enter/Space/→ on reveal advances.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (reveal != null) {
        if (e.key === "Enter" || e.key === " " || e.key === "ArrowRight") {
          e.preventDefault();
          advanceFromReveal();
        }
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        handlePick("left");
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        handlePick("right");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handlePick, reveal, advanceFromReveal]);

  // Compute dial states. For each dial, count how many of its 3
  // questions have been answered (asked) and how many were correct.
  // A dial is "locked" once all 3 of its questions have been
  // answered correctly. An "active" dial is the one currently
  // being asked.
  const activeDialIdx = Math.min(
    DIAL_COUNT - 1,
    Math.floor(questionIdx / QUESTIONS_PER_DIAL),
  );
  const dialStates = useMemo(() => {
    return Array.from({ length: DIAL_COUNT }, (_, d) => {
      const start = d * QUESTIONS_PER_DIAL;
      const end = start + QUESTIONS_PER_DIAL;
      const dialCards = cards.slice(start, end);
      const correctInDial = dialCards.filter((c) => correctIds.has(c.id)).length;
      const askedInDial = Math.max(0, Math.min(QUESTIONS_PER_DIAL, questionIdx - start));
      const isComplete = askedInDial >= QUESTIONS_PER_DIAL;
      const isLocked = isComplete && correctInDial === QUESTIONS_PER_DIAL;
      const isActive = d === activeDialIdx && !isComplete;
      return { idx: d, correctInDial, askedInDial, isLocked, isComplete, isActive };
    });
  }, [cards, correctIds, questionIdx, activeDialIdx]);

  if (!top && questionIdx < total) return null;

  const animationSlots = useQuizAnimationSlots();
  const swap = top ? swapAbForCard.get(top.id) ?? false : false;
  const isAb = top?.question_type === "ab_pick";
  const leftLabel = isAb ? (swap ? "B" : "A") : "FALSE";
  const rightLabel = isAb ? (swap ? "A" : "B") : "TRUE";

  return (
    <>
      {/* v70.3 - dial row portaled OUTSIDE the panel into the top
          slot owned by QuizModal. */}
      {animationSlots.top &&
        createPortal(
          <DialRow
            dials={dialStates}
            activeDialIdx={activeDialIdx}
            thunkKey={thunkKey}
          />,
          animationSlots.top,
        )}

      <div
        style={{
          // v70.8 - stable body height locks the modal panel size
          // across questions.
          flex: 1,
          display: "flex",
          flexDirection: "column",
          padding: "16px 20px 18px",
          minHeight: 360,
        }}
      >
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          marginBottom: 14,
          minHeight: 0,
        }}
      >
      {top && (
        <div
          style={{
            position: "relative",
            width: "100%",
            background:
              reveal?.kind === "correct"
                ? "linear-gradient(155deg, rgba(74,222,128,0.16) 0%, rgba(34,197,94,0.06) 55%, rgba(34,197,94,0.02) 100%)"
                : reveal?.kind === "wrong"
                  ? "linear-gradient(155deg, rgba(252,165,165,0.18) 0%, rgba(239,68,68,0.06) 55%, rgba(239,68,68,0.02) 100%)"
                  : "linear-gradient(155deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.04) 55%, rgba(255,255,255,0.02) 100%)",
            backdropFilter: "blur(20px) saturate(170%)",
            WebkitBackdropFilter: "blur(20px) saturate(170%)",
            border: reveal
              ? reveal.kind === "correct"
                ? "1px solid rgba(74,222,128,0.50)"
                : "1px solid rgba(252,165,165,0.50)"
              : "1px solid rgba(255,255,255,0.16)",
            borderRadius: 16,
            padding: "16px 18px",
            boxShadow:
              "0 16px 40px -8px rgba(0,0,0,0.45), 0 4px 10px rgba(0,0,0,0.30), 0 1px 0 rgba(255,255,255,0.10) inset, 0 -1px 0 rgba(0,0,0,0.30) inset",
            overflow: "hidden",
            transition: "background 240ms, border-color 240ms",
          }}
        >
          {/* Top sheen */}
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: 60,
              background:
                "linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0) 100%)",
              pointerEvents: "none",
              opacity: 0.9,
            }}
          />
          {/* Content above sheen */}
          <div
            style={{
              position: "relative",
              zIndex: 1,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            {reveal == null ? (
              <>
                <p
                  style={{
                    fontSize: 10,
                    fontFamily: "var(--font-mono)",
                    letterSpacing: "0.22em",
                    textTransform: "uppercase",
                    color: "rgba(255,255,255,0.45)",
                  }}
                >
                  {isAb ? "Pick one" : "True or False"}
                </p>
                <p
                  style={{
                    fontSize: 16,
                    fontWeight: 500,
                    lineHeight: 1.42,
                    color: "rgba(255,255,255,0.96)",
                    letterSpacing: "-0.011em",
                  }}
                >
                  {top.question_text}
                </p>
                {isAb && (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 8,
                      marginTop: 4,
                    }}
                  >
                    <OptionTile
                      side="left"
                      badge={swap ? "B" : "A"}
                      text={swap ? top.option_b : top.option_a}
                    />
                    <OptionTile
                      side="right"
                      badge={swap ? "A" : "B"}
                      text={swap ? top.option_a : top.option_b}
                    />
                  </div>
                )}
              </>
            ) : (
              <RevealPanel reveal={reveal} />
            )}
          </div>
        </div>
      )}
      </div>

      {/* Buttons - pinned to the bottom of the stable-height body. */}
      <div style={{ flexShrink: 0 }}>
        {reveal == null ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 10,
            }}
          >
            <PickButton
              side="left"
              label={leftLabel}
              onClick={() => handlePick("left")}
            />
            <PickButton
              side="right"
              label={rightLabel}
              onClick={() => handlePick("right")}
            />
          </div>
        ) : (
          <ContinueButton onClick={advanceFromReveal} />
        )}
      </div>
      </div>
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Dial row visual
// ──────────────────────────────────────────────────────────────────────

interface DialState {
  idx: number;
  correctInDial: number;
  askedInDial: number;
  isLocked: boolean;
  isComplete: boolean;
  isActive: boolean;
}

function DialRow({
  dials,
  activeDialIdx,
  thunkKey,
}: {
  dials: DialState[];
  activeDialIdx: number;
  thunkKey: number;
}) {
  return (
    <div
      style={{
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 10,
        position: "relative",
      }}
    >
      {/* Subtle glow under the active dial - draws the eye without
          shouting. Mirrors the SwipeCards ambient lighting. */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: -10,
          left: 0,
          right: 0,
          height: 80,
          background:
            "radial-gradient(ellipse 240px 60px at center top, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0) 70%)",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          justifyContent: "center",
          position: "relative",
        }}
      >
        {dials.map((d) => (
          <Dial
            key={d.idx}
            state={d}
            // Counter-rotate the ACTIVE dial when a wrong answer
            // fires (thunk key change).
            thunkKey={d.idx === activeDialIdx ? thunkKey : 0}
          />
        ))}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          justifyContent: "center",
        }}
      >
        {dials.map((d) => (
          <span
            key={`label-${d.idx}`}
            style={{
              width: 116,
              fontSize: 10,
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              textAlign: "center",
              fontWeight: d.isLocked || d.isActive ? 600 : 400,
              color: d.isLocked
                ? "rgba(255,255,255,0.92)"
                : d.isActive
                  ? "rgba(255,255,255,0.78)"
                  : "rgba(255,255,255,0.30)",
              transition: "color 240ms",
            }}
          >
            {d.isLocked ? "Locked" : `Dial ${d.idx + 1}`}
          </span>
        ))}
      </div>
    </div>
  );
}

function Dial({
  state,
  thunkKey,
}: {
  state: DialState;
  thunkKey: number;
}) {
  const baseRotate = state.isLocked ? 360 : 0;

  const marks = Array.from({ length: QUESTIONS_PER_DIAL }, (_, i) => {
    const isFilled = i < state.correctInDial;
    const wasAsked = i < state.askedInDial;
    return { i, isFilled, wasAsked };
  });

  // v70.6 - bigger and more mechanical. Added knurled rim with 24
  // tick marks, a pointer indicator at top, center screw detail.
  // Reads as an actual rotating dial, not just a circle with dots.
  const size = 116;
  const innerRadius = size / 2 - 18;
  const markSize = 11;
  const tickCount = 24;
  const tickInnerR = size / 2 - 6;
  const tickOuterR = size / 2 - 2;

  return (
    <motion.div
      key={`dial-${state.idx}`}
      animate={
        thunkKey > 0
          ? {
              rotate: [baseRotate, baseRotate - 18, baseRotate + 4, baseRotate],
              transition: {
                duration: 0.55,
                ease: [0.32, 0.72, 0.36, 1],
                times: [0, 0.35, 0.7, 1],
              },
            }
          : { rotate: baseRotate }
      }
      transition={
        state.isLocked
          ? { type: "spring", stiffness: 110, damping: 16, mass: 1.1 }
          : { duration: 0.3 }
      }
      style={{
        position: "relative",
        width: size,
        height: size,
        borderRadius: "50%",
        // Neutral glass palette across all states. Locked is the
        // brightest (more opaque + saturate), active is mid (a lit
        // surface), inactive is recessed (inset shadow only).
        background: state.isLocked
          ? "radial-gradient(circle at 30% 25%, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.08) 55%, rgba(255,255,255,0.02) 100%)"
          : state.isActive
            ? "radial-gradient(circle at 30% 25%, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.05) 55%, rgba(255,255,255,0.01) 100%)"
            : "linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.02) 100%)",
        backdropFilter: state.isLocked || state.isActive
          ? "blur(8px) saturate(160%)"
          : undefined,
        WebkitBackdropFilter: state.isLocked || state.isActive
          ? "blur(8px) saturate(160%)"
          : undefined,
        border: state.isLocked
          ? "1.5px solid rgba(255,255,255,0.42)"
          : state.isActive
            ? "1.5px solid rgba(255,255,255,0.32)"
            : "1px solid rgba(255,255,255,0.10)",
        boxShadow: state.isLocked
          ? "0 6px 16px rgba(0,0,0,0.40), 0 0 18px rgba(255,255,255,0.10), 0 1px 0 rgba(255,255,255,0.24) inset, 0 -1px 0 rgba(0,0,0,0.30) inset"
          : state.isActive
            ? "0 4px 12px rgba(0,0,0,0.42), 0 1px 0 rgba(255,255,255,0.16) inset, 0 -1px 0 rgba(0,0,0,0.30) inset"
            : "inset 0 2px 4px rgba(0,0,0,0.42), 0 1px 0 rgba(255,255,255,0.04)",
      }}
    >
      {/* Knurled rim - 24 short tick marks around the perimeter.
          Makes the dial feel like a real mechanical rotating element
          you'd grip. Rendered via SVG inside the dial. */}
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${size} ${size}`}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
        }}
      >
        {Array.from({ length: tickCount }, (_, i) => {
          const angle = (i / tickCount) * 360 - 90;
          const rad = (angle * Math.PI) / 180;
          const x1 = size / 2 + Math.cos(rad) * tickInnerR;
          const y1 = size / 2 + Math.sin(rad) * tickInnerR;
          const x2 = size / 2 + Math.cos(rad) * tickOuterR;
          const y2 = size / 2 + Math.sin(rad) * tickOuterR;
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={
                state.isLocked
                  ? "rgba(255,255,255,0.55)"
                  : state.isActive
                    ? "rgba(255,255,255,0.32)"
                    : "rgba(255,255,255,0.12)"
              }
              strokeWidth="1"
              strokeLinecap="round"
            />
          );
        })}
      </svg>
      {/* Inner ring - a recessed groove that the tumbler marks orbit. */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: innerRadius * 2 + markSize + 4,
          height: innerRadius * 2 + markSize + 4,
          borderRadius: "50%",
          border:
            state.isLocked || state.isActive
              ? "0.5px solid rgba(255,255,255,0.20)"
              : "0.5px solid rgba(255,255,255,0.08)",
          boxShadow:
            "inset 0 0 8px rgba(0,0,0,0.30)",
          pointerEvents: "none",
        }}
      />
      {/* Center screw - small recessed disk in the middle. Sells the
          mechanical-object metaphor. */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: 12,
          height: 12,
          borderRadius: "50%",
          background:
            "radial-gradient(circle at 35% 30%, rgba(255,255,255,0.20) 0%, rgba(255,255,255,0.06) 50%, rgba(0,0,0,0.20) 100%)",
          border: "0.5px solid rgba(255,255,255,0.18)",
          boxShadow:
            "inset 0 1px 2px rgba(0,0,0,0.40), 0 0 0 1px rgba(0,0,0,0.10)",
          pointerEvents: "none",
        }}
      />
      {/* Center notch - horizontal line crossing the screw. */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: 8,
          height: 1.5,
          borderRadius: 1,
          background: state.isLocked
            ? "rgba(255,255,255,0.55)"
            : state.isActive
              ? "rgba(255,255,255,0.32)"
              : "rgba(255,255,255,0.14)",
          pointerEvents: "none",
        }}
      />

      {/* Three tumbler marks orbiting the inner ring. Green for
          correct, soft red for wrong/asked, ghost otherwise.
          Locked state lifts all three to bright white (the dial
          has "clicked into place"). */}
      {marks.map((m) => {
        const angle = -90 + m.i * 120; // top, then clockwise
        const rad = (angle * Math.PI) / 180;
        const x = Math.cos(rad) * innerRadius;
        const y = Math.sin(rad) * innerRadius;
        const fillColor = state.isLocked
          ? "rgba(255,255,255,0.95)"
          : m.isFilled
            ? "rgba(134,239,172,0.95)"
            : m.wasAsked
              ? "rgba(252,165,165,0.55)"
              : "rgba(255,255,255,0.18)";
        const glow = state.isLocked
          ? "0 0 6px rgba(255,255,255,0.40), 0 1px 0 rgba(255,255,255,0.30) inset"
          : m.isFilled
            ? "0 0 5px rgba(134,239,172,0.45)"
            : "inset 0 1px 1px rgba(0,0,0,0.30)";
        return (
          <div
            key={m.i}
            aria-hidden="true"
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`,
              width: markSize,
              height: markSize,
              borderRadius: "50%",
              background: fillColor,
              boxShadow: glow,
              transition: "background 280ms, box-shadow 280ms",
            }}
          />
        );
      })}
    </motion.div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Shared button + reveal pieces (mirror StackBuilderQuiz)
// ──────────────────────────────────────────────────────────────────────

function OptionTile({
  side,
  badge,
  text,
}: {
  side: "left" | "right";
  badge: string;
  text: string;
}) {
  return (
    <div
      style={{
        position: "relative",
        padding: 14,
        background:
          "linear-gradient(160deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.03) 100%)",
        backdropFilter: "blur(12px) saturate(150%)",
        WebkitBackdropFilter: "blur(12px) saturate(150%)",
        border: "1px solid rgba(255,255,255,0.14)",
        borderRadius: 12,
        boxShadow:
          "0 6px 16px rgba(0,0,0,0.25), 0 1px 0 rgba(255,255,255,0.10) inset, 0 -1px 0 rgba(0,0,0,0.20) inset",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 32,
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0) 100%)",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          position: "relative",
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 24,
            height: 24,
            borderRadius: 999,
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0.06) 100%)",
            border: "1px solid rgba(255,255,255,0.22)",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.04em",
            color: "rgba(255,255,255,0.96)",
            fontVariantNumeric: "tabular-nums",
            boxShadow:
              "0 1px 2px rgba(0,0,0,0.30), 0 1px 0 rgba(255,255,255,0.18) inset",
          }}
        >
          {badge}
        </span>
        <span
          style={{
            fontSize: 9.5,
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.20em",
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.45)",
          }}
        >
          {side === "left" ? "Left button" : "Right button"}
        </span>
      </div>
      <span
        style={{
          position: "relative",
          fontSize: 13.5,
          lineHeight: 1.45,
          color: "rgba(255,255,255,0.90)",
          letterSpacing: "-0.005em",
        }}
      >
        {text}
      </span>
    </div>
  );
}

function PickButton({
  side,
  label,
  onClick,
}: {
  side: "left" | "right";
  label: string;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const isTrue = label === "TRUE";
  const isFalse = label === "FALSE";
  const accent = isTrue
    ? "rgba(74,222,128,0.40)"
    : isFalse
      ? "rgba(239,68,68,0.38)"
      : "rgba(255,255,255,0.16)";
  const glowColor = isTrue
    ? "rgba(74,222,128,0.22)"
    : isFalse
      ? "rgba(239,68,68,0.20)"
      : "rgba(255,255,255,0.12)";
  const lifted = hovered && !pressed;
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setPressed(false);
      }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      style={{
        padding: "15px 18px",
        background:
          "linear-gradient(180deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.04) 100%)",
        backdropFilter: "blur(12px) saturate(150%)",
        WebkitBackdropFilter: "blur(12px) saturate(150%)",
        border: `1px solid ${accent}`,
        borderRadius: 12,
        color: "rgba(255,255,255,0.96)",
        fontSize: 14,
        fontWeight: 700,
        letterSpacing: "0.02em",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: side === "left" ? "flex-start" : "flex-end",
        gap: 10,
        transform: pressed
          ? "scale(0.97)"
          : lifted
            ? "translateY(-2px)"
            : "translateY(0)",
        boxShadow: lifted
          ? `0 14px 30px ${glowColor}, 0 1px 0 rgba(255,255,255,0.14) inset, 0 -1px 0 rgba(0,0,0,0.25) inset`
          : "0 8px 22px rgba(0,0,0,0.32), 0 1px 0 rgba(255,255,255,0.10) inset, 0 -1px 0 rgba(0,0,0,0.20) inset",
        transition:
          "transform 150ms cubic-bezier(0.22,1,0.36,1), box-shadow 200ms cubic-bezier(0.22,1,0.36,1)",
      }}
    >
      {side === "left" && (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
      )}
      <span>{label}</span>
      {side === "right" && (
        <svg
          width="16"
          height="16"
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
      )}
    </button>
  );
}

function ContinueButton({ onClick }: { onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const lifted = hovered && !pressed;
  return (
    <button
      type="button"
      onClick={onClick}
      autoFocus
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setPressed(false);
      }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      style={{
        width: "100%",
        padding: "15px 18px",
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
        gap: 10,
        transform: pressed
          ? "scale(0.97)"
          : lifted
            ? "translateY(-2px)"
            : "translateY(0)",
        boxShadow: lifted
          ? "0 14px 30px rgba(255,255,255,0.22), 0 1px 0 rgba(255,255,255,0.60) inset, 0 -1px 0 rgba(0,0,0,0.18) inset"
          : "0 8px 22px rgba(0,0,0,0.32), 0 1px 0 rgba(255,255,255,0.60) inset, 0 -1px 0 rgba(0,0,0,0.15) inset",
        transition:
          "transform 150ms cubic-bezier(0.22,1,0.36,1), box-shadow 200ms cubic-bezier(0.22,1,0.36,1)",
      }}
    >
      Continue
      <svg
        width="16"
        height="16"
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
  );
}

function RevealPanel({ reveal }: { reveal: RevealState }) {
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={reveal.card.id + ":" + reveal.kind}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        style={{ display: "flex", flexDirection: "column", gap: 10 }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <RevealGlyph kind={reveal.kind} />
          <p
            style={{
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              color: reveal.kind === "correct" ? "#86EFAC" : "#FCA5A5",
            }}
          >
            {reveal.kind === "correct" ? "Correct" : "Wrong"}
          </p>
        </div>
        {reveal.kind === "wrong" && reveal.correctText && (
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <p
              style={{
                fontSize: 10,
                fontFamily: "var(--font-mono)",
                letterSpacing: "0.22em",
                textTransform: "uppercase",
                color: "rgba(255,255,255,0.42)",
              }}
            >
              Correct answer
            </p>
            <p
              style={{
                fontSize: 14,
                fontWeight: 500,
                color: "rgba(255,255,255,0.94)",
                lineHeight: 1.4,
              }}
            >
              {reveal.correctText}
            </p>
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <p
            style={{
              fontSize: 10,
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.42)",
            }}
          >
            Why
          </p>
          <p
            style={{
              fontSize: 14,
              lineHeight: 1.5,
              color: "rgba(255,255,255,0.88)",
            }}
          >
            {reveal.card.why_text}
          </p>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

function RevealGlyph({ kind }: { kind: "correct" | "wrong" }) {
  return (
    <motion.div
      initial={{ scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 380, damping: 18, mass: 0.7 }}
      style={{
        width: 22,
        height: 22,
        borderRadius: 999,
        background:
          kind === "correct" ? "rgba(34,197,94,0.20)" : "rgba(239,68,68,0.20)",
        border:
          kind === "correct"
            ? "1px solid rgba(34,197,94,0.6)"
            : "1px solid rgba(239,68,68,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke={kind === "correct" ? "#86EFAC" : "#FCA5A5"}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {kind === "correct" ? (
          <path d="M5 12l5 5L20 7" />
        ) : (
          <>
            <path d="M6 6l12 12" />
            <path d="M6 18L18 6" />
          </>
        )}
      </svg>
    </motion.div>
  );
}
