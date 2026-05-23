"use client";

/**
 * Region 1's quiz format: Swipe Cards.
 *
 * Polished pass (v54.1): card-stack with peeking next cards,
 * drag-to-swipe with tilt + color tint based on direction, larger
 * question typography, premium A/B tile design, smoother reveal
 * transitions. The mechanic stays the same:
 *
 *   - Shuffle deck on session start (no per-card persistence)
 *   - True/False (left = false, right = true)
 *   - A/B pick (left = A, right = B), positions randomized per render
 *   - Wrong = card returns to bottom of deck + reveal panel (correct
 *     answer + why_text) for 2.5s
 *   - Correct = green tick + why_text for 1.5s, card removed
 *   - Drag: > 90px horizontal commit, else snap back
 *   - Keyboard: ← / → mirror the swipe buttons
 *   - Signals progressLine + passed back to the parent via callbacks
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, useMotionValue, useTransform } from "framer-motion";
import type { SwipeCardQuestion } from "@/lib/region-quizzes";

interface SwipeCardsQuizProps {
  cards: SwipeCardQuestion[];
  onProgressChange: (line: string) => void;
  onPass: () => void;
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

const SWIPE_COMMIT_THRESHOLD = 90; // px horizontal drag to commit

export function SwipeCardsQuiz({
  cards,
  onProgressChange,
  onPass,
}: SwipeCardsQuizProps) {
  const [deck, setDeck] = useState<SwipeCardQuestion[]>(() => shuffle(cards));
  const [correctIds, setCorrectIds] = useState<Set<string>>(() => new Set());
  const [reveal, setReveal] = useState<RevealState | null>(null);
  const [swipeDir, setSwipeDir] = useState<"left" | "right" | null>(null);
  const revealTimerRef = useRef<number | null>(null);

  // Drag state for the active card. We use a motion value so the
  // card responds to drag in real time without re-rendering.
  const dragX = useMotionValue(0);
  const dragRotate = useTransform(dragX, [-220, 0, 220], [-10, 0, 10]);
  const leftTint = useTransform(dragX, [-160, -30, 0], [1, 0.2, 0]);
  const rightTint = useTransform(dragX, [0, 30, 160], [0, 0.2, 1]);

  // Per-card A/B swap (randomize which option is on the LEFT). Keyed
  // by card id, rebuilt when the deck changes so re-asks re-randomize.
  const swapAbForCard = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const c of deck) m.set(c.id, Math.random() < 0.5);
    return m;
  }, [deck]);

  const total = cards.length;

  useEffect(() => {
    onProgressChange(
      `${correctIds.size} of ${total} correct · ${deck.length} left in deck`,
    );
  }, [correctIds, deck.length, total, onProgressChange]);

  useEffect(() => {
    if (deck.length === 0 && total > 0) onPass();
  }, [deck.length, total, onPass]);

  useEffect(
    () => () => {
      if (revealTimerRef.current != null)
        window.clearTimeout(revealTimerRef.current);
    },
    [],
  );

  const top = deck[0] ?? null;
  const next = deck[1] ?? null;
  const next2 = deck[2] ?? null;

  const advanceDeck = useCallback((wasCorrect: boolean) => {
    setDeck((cur) => {
      if (cur.length === 0) return cur;
      const [first, ...rest] = cur;
      return wasCorrect ? rest : [...rest, first];
    });
    setReveal(null);
    setSwipeDir(null);
    dragX.set(0);
  }, [dragX]);

  const handlePick = useCallback(
    (pick: "left" | "right") => {
      if (!top || reveal != null) return;
      setSwipeDir(pick);

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
        if (revealTimerRef.current != null)
          window.clearTimeout(revealTimerRef.current);
        revealTimerRef.current = window.setTimeout(() => advanceDeck(true), 1500);
      } else {
        setReveal({ kind: "wrong", card: top, correctText });
        if (revealTimerRef.current != null)
          window.clearTimeout(revealTimerRef.current);
        revealTimerRef.current = window.setTimeout(() => advanceDeck(false), 2500);
      }
    },
    [top, reveal, swapAbForCard, advanceDeck],
  );

  // Keyboard arrows mirror swipe buttons.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (reveal != null) return;
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
  }, [handlePick, reveal]);

  if (!top) return null;

  const swap = swapAbForCard.get(top.id) ?? false;
  const isAb = top.question_type === "ab_pick";
  const leftLabel = isAb ? (swap ? "B" : "A") : "FALSE";
  const rightLabel = isAb ? (swap ? "A" : "B") : "TRUE";

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        padding: "18px 20px 22px",
        gap: 18,
        minHeight: 0,
      }}
    >
      {/* Progress bar - subtle visual feedback above the deck */}
      <div
        aria-hidden="true"
        style={{
          height: 3,
          background: "rgba(255,255,255,0.06)",
          borderRadius: 2,
          overflow: "hidden",
          flexShrink: 0,
        }}
      >
        <motion.div
          initial={false}
          animate={{
            width: `${total > 0 ? (correctIds.size / total) * 100 : 0}%`,
          }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          style={{
            height: "100%",
            background:
              "linear-gradient(90deg, rgba(134,239,172,0.85) 0%, rgba(125,211,252,0.85) 100%)",
            borderRadius: 2,
          }}
        />
      </div>

      {/* Card stack - up to 3 cards layered, only top is interactive */}
      <div
        style={{
          flex: 1,
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: 280,
          perspective: 1200,
        }}
      >
        {/* Peek card 2 (deepest) */}
        {next2 && (
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              top: 16,
              transform: "scale(0.92) translateY(8px)",
              opacity: 0.4,
              borderRadius: 16,
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.06)",
              pointerEvents: "none",
            }}
          />
        )}
        {/* Peek card 1 */}
        {next && (
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              top: 8,
              transform: "scale(0.96) translateY(4px)",
              opacity: 0.65,
              borderRadius: 16,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              pointerEvents: "none",
            }}
          />
        )}

        {/* Active card */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={top.id + ":" + (reveal?.kind ?? "ask")}
            drag={reveal == null ? "x" : false}
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.45}
            onDragEnd={(_, info) => {
              if (reveal != null) return;
              if (info.offset.x < -SWIPE_COMMIT_THRESHOLD) {
                handlePick("left");
              } else if (info.offset.x > SWIPE_COMMIT_THRESHOLD) {
                handlePick("right");
              } else {
                // Snap back
                dragX.set(0);
              }
            }}
            style={{
              x: dragX,
              rotate: reveal == null ? dragRotate : 0,
              position: "absolute",
              inset: 0,
              cursor: reveal == null ? "grab" : "default",
              touchAction: "pan-y",
            }}
            initial={
              reveal ? { opacity: 1 } : { opacity: 0, scale: 0.96, y: 14 }
            }
            animate={{
              opacity: 1,
              scale: 1,
              y: 0,
            }}
            exit={{
              opacity: 0,
              x:
                swipeDir === "left"
                  ? -360
                  : swipeDir === "right"
                    ? 360
                    : 0,
              rotate:
                swipeDir === "left" ? -14 : swipeDir === "right" ? 14 : 0,
              transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] },
            }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            whileTap={reveal == null ? { cursor: "grabbing" } : undefined}
          >
            <div
              style={{
                position: "relative",
                padding: "22px 22px 18px",
                background:
                  reveal?.kind === "correct"
                    ? "linear-gradient(180deg, rgba(34,197,94,0.08) 0%, rgba(34,197,94,0.04) 100%)"
                    : reveal?.kind === "wrong"
                      ? "linear-gradient(180deg, rgba(239,68,68,0.08) 0%, rgba(239,68,68,0.04) 100%)"
                      : "linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)",
                border: reveal
                  ? reveal.kind === "correct"
                    ? "1px solid rgba(34,197,94,0.45)"
                    : "1px solid rgba(239,68,68,0.45)"
                  : "1px solid rgba(255,255,255,0.12)",
                borderRadius: 16,
                display: "flex",
                flexDirection: "column",
                gap: 16,
                boxShadow:
                  "0 18px 50px rgba(0,0,0,0.45), 0 1px 0 rgba(255,255,255,0.06) inset",
                overflow: "hidden",
              }}
            >
              {/* Direction tint overlays - fade in as the student
                  drags toward a side. Pure visual feedback. */}
              {reveal == null && (
                <>
                  <motion.div
                    aria-hidden="true"
                    style={{
                      position: "absolute",
                      inset: 0,
                      background:
                        "linear-gradient(90deg, rgba(239,68,68,0.18) 0%, rgba(239,68,68,0) 50%)",
                      opacity: leftTint,
                      pointerEvents: "none",
                    }}
                  />
                  <motion.div
                    aria-hidden="true"
                    style={{
                      position: "absolute",
                      inset: 0,
                      background:
                        "linear-gradient(270deg, rgba(74,222,128,0.18) 0%, rgba(74,222,128,0) 50%)",
                      opacity: rightTint,
                      pointerEvents: "none",
                    }}
                  />
                </>
              )}

              {/* Question type tag */}
              <p
                style={{
                  fontSize: 10,
                  fontFamily: "var(--font-mono)",
                  letterSpacing: "0.22em",
                  textTransform: "uppercase",
                  color: "rgba(255,255,255,0.42)",
                  position: "relative",
                }}
              >
                {isAb ? "Pick one" : "True or False"}
              </p>

              {/* Question */}
              <p
                style={{
                  fontSize: 19,
                  fontWeight: 500,
                  letterSpacing: "-0.014em",
                  lineHeight: 1.4,
                  color: "rgba(255,255,255,0.96)",
                  position: "relative",
                }}
              >
                {top.question_text}
              </p>

              {isAb && (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 10,
                    position: "relative",
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

              {/* Reveal panel */}
              {reveal && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                  style={{
                    paddingTop: 14,
                    borderTop: "1px solid rgba(255,255,255,0.10)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    position: "relative",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <RevealGlyph kind={reveal.kind} />
                    <p
                      style={{
                        fontSize: 11,
                        fontFamily: "var(--font-mono)",
                        letterSpacing: "0.18em",
                        textTransform: "uppercase",
                        color:
                          reveal.kind === "correct" ? "#86EFAC" : "#FCA5A5",
                      }}
                    >
                      {reveal.kind === "correct"
                        ? "Correct"
                        : reveal.correctText
                          ? `Correct answer: ${reveal.correctText}`
                          : "Wrong"}
                    </p>
                  </div>
                  <p
                    style={{
                      fontSize: 14,
                      lineHeight: 1.5,
                      color: "rgba(255,255,255,0.82)",
                      letterSpacing: "-0.005em",
                    }}
                  >
                    {reveal.card.why_text}
                  </p>
                </motion.div>
              )}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Buttons */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 10,
          flexShrink: 0,
        }}
      >
        <SwipeButton
          side="left"
          label={leftLabel}
          disabled={reveal != null}
          onClick={() => handlePick("left")}
        />
        <SwipeButton
          side="right"
          label={rightLabel}
          disabled={reveal != null}
          onClick={() => handlePick("right")}
        />
      </div>
    </div>
  );
}

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
        padding: 14,
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 12,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        position: "relative",
        boxShadow:
          "0 4px 12px rgba(0,0,0,0.20), 0 1px 0 rgba(255,255,255,0.04) inset",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 22,
            height: 22,
            borderRadius: 999,
            background: "rgba(255,255,255,0.10)",
            border: "1px solid rgba(255,255,255,0.16)",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.04em",
            color: "rgba(255,255,255,0.92)",
            fontVariantNumeric: "tabular-nums",
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
            color: "rgba(255,255,255,0.38)",
          }}
        >
          {side === "left" ? "Swipe left" : "Swipe right"}
        </span>
      </div>
      <span
        style={{
          fontSize: 13.5,
          lineHeight: 1.45,
          color: "rgba(255,255,255,0.88)",
          letterSpacing: "-0.005em",
        }}
      >
        {text}
      </span>
    </div>
  );
}

function SwipeButton({
  side,
  label,
  disabled,
  onClick,
}: {
  side: "left" | "right";
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  const isTrue = label === "TRUE";
  const isFalse = label === "FALSE";
  // For T/F give the buttons a subtle red/green undertone. For A/B
  // keep them neutral - the picks are symmetric.
  const accent = isTrue
    ? "rgba(74,222,128,0.35)"
    : isFalse
      ? "rgba(239,68,68,0.32)"
      : "rgba(255,255,255,0.14)";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "15px 18px",
        background: disabled
          ? "rgba(255,255,255,0.03)"
          : "linear-gradient(180deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.04) 100%)",
        border: `1px solid ${disabled ? "rgba(255,255,255,0.08)" : accent}`,
        borderRadius: 12,
        color: disabled ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.94)",
        fontSize: 14,
        fontWeight: 700,
        letterSpacing: "0.02em",
        cursor: disabled ? "default" : "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: side === "left" ? "flex-start" : "flex-end",
        gap: 8,
        boxShadow: disabled
          ? "none"
          : "0 4px 12px rgba(0,0,0,0.25), 0 1px 0 rgba(255,255,255,0.06) inset",
        transition: "all 150ms cubic-bezier(0.22,1,0.36,1)",
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
      {label}
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

function RevealGlyph({ kind }: { kind: "correct" | "wrong" }) {
  return (
    <motion.div
      initial={{ scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{
        type: "spring",
        stiffness: 380,
        damping: 18,
        mass: 0.7,
      }}
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
