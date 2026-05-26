"use client";

/**
 * Region 2 + Region 3 quiz format: Stack Builder.
 *
 * Visual spec per brief v2 §04: tower with N outlined "ghost slots"
 * visible from start. Each correct answer fills its slot with a
 * solid block (drops in with a thud). Wrong answer = tower wobbles,
 * slot stays empty.
 *
 * Mechanics: v65 drain-through (each question shown once, wrong
 * stays wrong). Pass at >= 50%. Same per-Q reveal as SwipeCardsQuiz
 * (red X + correct answer + why text on wrong, green tick on right).
 * Continue button advances to next question.
 *
 * Underneath the visual: identical contract to SwipeCardsQuiz -
 * same QuizCompletePayload signature, same onProgressChange.
 * Plugs into the shared QuizModal + ResultScreen with zero changes.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { SwipeCardQuestion } from "@/lib/region-quizzes";
import type {
  QuizCompletePayload,
  QuizWrongAnswer,
} from "./SwipeCardsQuiz";

interface StackBuilderQuizProps {
  cards: SwipeCardQuestion[];
  onProgressChange: (line: string) => void;
  onComplete: (result: QuizCompletePayload) => void;
}

interface RevealState {
  kind: "correct" | "wrong";
  card: SwipeCardQuestion;
  correctText: string | null;
}

function shuffle<T>(arr: T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function StackBuilderQuiz({
  cards,
  onProgressChange,
  onComplete,
}: StackBuilderQuizProps) {
  // Session-shuffled deck. drain-through: each question shown
  // exactly once, regardless of correctness.
  const [deck, setDeck] = useState<SwipeCardQuestion[]>(() => shuffle(cards));
  const [correctIds, setCorrectIds] = useState<Set<string>>(() => new Set());
  const [wrongAnswers, setWrongAnswers] = useState<QuizWrongAnswer[]>([]);
  const [reveal, setReveal] = useState<RevealState | null>(null);
  // Wobble trigger: increments on each wrong answer so framer-motion
  // re-fires the animation. Tied to the tower's animate key.
  const [wobbleKey, setWobbleKey] = useState(0);

  // Per-card A/B swap (which option appears on the LEFT). Keyed by
  // card id, rebuilt when the deck changes so re-asks re-randomize
  // (not used by drain-through but stays stable per-render).
  const swapAbForCard = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const c of deck) m.set(c.id, Math.random() < 0.5);
    return m;
  }, [deck]);

  const total = cards.length;
  const answered = correctIds.size + wrongAnswers.length;
  const correctCount = correctIds.size;

  useEffect(() => {
    onProgressChange(`Question ${Math.min(answered + 1, total)} of ${total}`);
  }, [answered, total, onProgressChange]);

  useEffect(() => {
    if (deck.length === 0 && total > 0) {
      onComplete({ correctIds, wrongAnswers, total });
    }
    // Intentionally omit onComplete from deps - fires once on deck-
    // empty transition, not on every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck.length, total]);

  const top = deck[0] ?? null;

  const advanceDeck = useCallback(() => {
    setDeck((cur) => (cur.length === 0 ? cur : cur.slice(1)));
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
        // Trigger the tower wobble.
        setWobbleKey((k) => k + 1);
      }
    },
    [top, reveal, swapAbForCard],
  );

  const advanceFromReveal = useCallback(() => {
    if (reveal == null) return;
    advanceDeck();
  }, [reveal, advanceDeck]);

  // Keyboard support per brief: ← = LEFT button, → = RIGHT button.
  // During reveal: Enter / Space / → advance.
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

  if (!top && deck.length === 0) return null;

  const swap = top ? swapAbForCard.get(top.id) ?? false : false;
  const isAb = top?.question_type === "ab_pick";
  const leftLabel = isAb ? (swap ? "B" : "A") : "FALSE";
  const rightLabel = isAb ? (swap ? "A" : "B") : "TRUE";

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        padding: "16px 20px 22px",
        minHeight: 0,
      }}
    >
      {/* Tower visual - top of modal body, fixed natural height.

          Brief v2: "the tower can scale down slightly with each
          block so it always fits on screen." Fixed-height
          container with auto-scaling blocks; question card sits
          in the centered middle band below it. */}
      <div style={{ flexShrink: 0 }}>
        <Tower
          total={total}
          correctCount={correctCount}
          wobbleKey={wobbleKey}
        />
      </div>

      {/* Question card - vertically centered in remaining space.
          Tower above, buttons below; this middle band absorbs
          whatever vertical room is left so the question sits
          where the student's eye actually lands. */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "16px 0",
          minHeight: 0,
        }}
      >

      {/* Question card - full glassmorphism treatment matching R1's
          SwipeCards card. Backdrop blur + saturate, top sheen
          overlay, layered drop shadow, hairline inset highlight. */}
      {top && (
        <div
          style={{
            position: "relative",
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
          {/* Content - sits above the sheen via z-index */}
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

      {/* Buttons - either pick (left/right) or continue. Pinned to
          the bottom of the modal body. */}
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
  );
}

// ──────────────────────────────────────────────────────────────────────
// Tower visual
// ──────────────────────────────────────────────────────────────────────
// Design language matches R1 SwipeCards: neutral white glassmorphism,
// no gold. Filled blocks have backdrop-blur, top sheen, layered drop
// shadow, and a hairline highlight on top. Empty slots are recessed
// glass placeholders with subtle inner shadow.

function Tower({
  total,
  correctCount,
  wobbleKey,
}: {
  total: number;
  correctCount: number;
  wobbleKey: number;
}) {
  // v70.1 - taller container and wider blocks. The animation now
  // gets its own prominent zone at the top of the modal so it can
  // actually breathe instead of competing with the question card.
  const containerHeight = 240;
  const foundationHeight = 8;
  const usableHeight = containerHeight - foundationHeight - 10;
  const blockGap = 4;
  const blockHeight = Math.max(9, Math.min(20, usableHeight / total - blockGap));
  const blockWidth = 160;

  const slots = Array.from({ length: total }, (_, i) => {
    const isFilled = i < correctCount;
    const isNewest = isFilled && i === correctCount - 1;
    return { i, isFilled, isNewest };
  });

  return (
    <div
      style={{
        flexShrink: 0,
        height: containerHeight,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: 6,
        position: "relative",
      }}
    >
      {/* Bigger ground glow with two layers - tight inner contact +
          wider ambient pool. Floats the tower in space without
          needing a hard surface. */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          bottom: -8,
          width: blockWidth + 120,
          height: 50,
          background:
            "radial-gradient(ellipse at center, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.04) 35%, rgba(255,255,255,0) 75%)",
          pointerEvents: "none",
        }}
      />

      <motion.div
        key={wobbleKey}
        // Spring wobble - more organic than the previous easeInOut.
        animate={
          wobbleKey > 0
            ? {
                rotate: [0, -2.5, 2.2, -1.4, 1, -0.4, 0],
                transition: {
                  duration: 0.7,
                  ease: [0.32, 0.72, 0.36, 1],
                  times: [0, 0.18, 0.38, 0.58, 0.76, 0.9, 1],
                },
              }
            : { rotate: 0 }
        }
        style={{
          display: "flex",
          flexDirection: "column-reverse",
          alignItems: "center",
          gap: blockGap,
          transformOrigin: "bottom center",
          position: "relative",
        }}
      >
        {slots.map((slot) => (
          <Block
            key={slot.i}
            isFilled={slot.isFilled}
            width={blockWidth}
            height={blockHeight}
            isNewest={slot.isNewest}
          />
        ))}
      </motion.div>

      {/* Foundation - bigger, more dimensional. */}
      <div
        aria-hidden="true"
        style={{
          width: blockWidth + 40,
          height: foundationHeight,
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.20) 0%, rgba(255,255,255,0.06) 60%, rgba(255,255,255,0.02) 100%)",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 4,
          boxShadow:
            "0 3px 8px rgba(0,0,0,0.50), 0 1px 0 rgba(255,255,255,0.16) inset",
        }}
      />
    </div>
  );
}

function Block({
  isFilled,
  width,
  height,
  isNewest,
}: {
  isFilled: boolean;
  width: number;
  height: number;
  isNewest: boolean;
}) {
  return (
    <motion.div
      initial={isNewest ? { y: -48, scale: 1.12, opacity: 0 } : false}
      animate={
        isNewest
          ? {
              // Anticipation drop: overshoot down + tiny squash on
              // impact + settle. Spring-like via custom timing
              // instead of generic ease.
              y: [-48, 6, -1, 0],
              scaleY: [1, 0.88, 1.04, 1],
              scaleX: [1, 1.06, 0.98, 1],
              opacity: [0, 1, 1, 1],
              transition: {
                duration: 0.5,
                ease: [0.22, 1, 0.36, 1],
                times: [0, 0.55, 0.78, 1],
              },
            }
          : undefined
      }
      style={{
        position: "relative",
        width,
        height,
        borderRadius: 4,
        overflow: "hidden",
        // Filled = neutral white glass with depth. Empty = thin
        // recessed slot. No gold anywhere - matches R1's scheme.
        background: isFilled
          ? "linear-gradient(155deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0.08) 55%, rgba(255,255,255,0.04) 100%)"
          : "linear-gradient(180deg, rgba(0,0,0,0.10) 0%, rgba(0,0,0,0.04) 100%)",
        backdropFilter: isFilled ? "blur(8px) saturate(160%)" : undefined,
        WebkitBackdropFilter: isFilled
          ? "blur(8px) saturate(160%)"
          : undefined,
        border: isFilled
          ? "1px solid rgba(255,255,255,0.22)"
          : "1px solid rgba(255,255,255,0.06)",
        boxShadow: isFilled
          ? // Lifted glass: outer drop, hairline top highlight, hairline
            // bottom shadow. Mirrors the SwipeCards card material.
            "0 3px 8px rgba(0,0,0,0.40), 0 1px 0 rgba(255,255,255,0.20) inset, 0 -1px 0 rgba(0,0,0,0.30) inset"
          : // Empty: inner shadow only, suggests recess.
            "inset 0 1px 2px rgba(0,0,0,0.30)",
      }}
    >
      {/* Top sheen on filled blocks - light catches the glass edge.
          Matches the SwipeCards card sheen. Decorative only. */}
      {isFilled && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: Math.max(2, Math.min(6, height / 2)),
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 100%)",
            pointerEvents: "none",
            opacity: 0.9,
          }}
        />
      )}
    </motion.div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Option / pick / continue buttons + reveal panel (mirror SwipeCardsQuiz)
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
        // Premium glass to match R1 tile material.
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
      {/* Top sheen on tile */}
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
