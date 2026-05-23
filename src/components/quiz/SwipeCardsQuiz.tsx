"use client";

/**
 * Region 1's quiz format: Swipe Cards.
 *
 * Mounts inside QuizModal. Owns its own deck state + interaction:
 *   - Shuffle on session start (no per-card persistence across reload)
 *   - True/False (left = false, right = true)
 *   - A/B pick (left = A, right = B), positions randomized on render
 *   - Wrong = card rotates to the bottom of the deck + reveal panel
 *     (correct answer + why_text) for 2.5s
 *   - Correct = green tick + why_text for 1.5s, card removed
 *   - Keyboard: ← / → mirror the swipe buttons
 *
 * Signals progressLine + passed back to the parent via callbacks so
 * the QuizModal chrome can render the counter + win screen
 * uniformly.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { SwipeCardQuestion } from "@/lib/region-quizzes";

interface SwipeCardsQuizProps {
  cards: SwipeCardQuestion[];
  onProgressChange: (line: string) => void;
  onPass: () => void;
}

interface RevealState {
  kind: "correct" | "wrong";
  card: SwipeCardQuestion;
  // For ab_pick we display "Correct answer was: <text>" on wrong;
  // the text passes in pre-resolved.
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

export function SwipeCardsQuiz({
  cards,
  onProgressChange,
  onPass,
}: SwipeCardsQuizProps) {
  // Deck is the array of cards still to clear. correctCount is the
  // number unique cards answered right at least once.
  const [deck, setDeck] = useState<SwipeCardQuestion[]>(() => shuffle(cards));
  const [correctIds, setCorrectIds] = useState<Set<string>>(() => new Set());
  const [reveal, setReveal] = useState<RevealState | null>(null);
  const [swipeDir, setSwipeDir] = useState<"left" | "right" | null>(null);
  const revealTimerRef = useRef<number | null>(null);

  // For ab_pick - randomize which option renders on the LEFT once
  // per card render. Recomputed when the deck shifts so re-asks
  // shuffle the positions too. Keyed by card id + a deck-index
  // signature to force re-randomization on re-ask.
  const swapAbForCard = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const c of deck) {
      m.set(c.id, Math.random() < 0.5);
    }
    return m;
  }, [deck]);

  const total = cards.length;

  // Notify parent of counter line. Reads current state, fires on
  // every change.
  useEffect(() => {
    onProgressChange(
      `${correctIds.size} of ${total} correct · ${deck.length} left in deck`,
    );
  }, [correctIds, deck.length, total, onProgressChange]);

  // Detect pass = deck empty.
  useEffect(() => {
    if (deck.length === 0 && total > 0) {
      onPass();
    }
  }, [deck.length, total, onPass]);

  // Cleanup pending reveal timer on unmount.
  useEffect(
    () => () => {
      if (revealTimerRef.current != null)
        window.clearTimeout(revealTimerRef.current);
    },
    [],
  );

  const top = deck[0] ?? null;

  const advanceDeck = useCallback(
    (wasCorrect: boolean) => {
      setDeck((cur) => {
        if (cur.length === 0) return cur;
        const [first, ...rest] = cur;
        // Correct = drop the card. Wrong = push to the bottom.
        return wasCorrect ? rest : [...rest, first];
      });
      setReveal(null);
      setSwipeDir(null);
    },
    [],
  );

  const handlePick = useCallback(
    (pick: "left" | "right") => {
      if (!top || reveal != null) return;
      setSwipeDir(pick);

      // Resolve correctness based on card type.
      let isCorrect = false;
      let correctText: string | null = null;
      if (top.question_type === "true_false") {
        const chosen = pick === "right" ? "true" : "false";
        isCorrect = chosen === top.correct_answer;
        if (!isCorrect)
          correctText =
            top.correct_answer === "true" ? "TRUE" : "FALSE";
      } else {
        // ab_pick - the LEFT-side option depends on swapAbForCard.
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
        revealTimerRef.current = window.setTimeout(
          () => advanceDeck(true),
          1500,
        );
      } else {
        setReveal({ kind: "wrong", card: top, correctText });
        if (revealTimerRef.current != null)
          window.clearTimeout(revealTimerRef.current);
        revealTimerRef.current = window.setTimeout(
          () => advanceDeck(false),
          2500,
        );
      }
    },
    [top, reveal, swapAbForCard, advanceDeck],
  );

  // Keyboard: ← / → mirror the buttons.
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
  const leftLabel = isAb
    ? swap
      ? "B"
      : "A"
    : "FALSE";
  const rightLabel = isAb ? (swap ? "A" : "B") : "TRUE";

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        padding: "18px 20px 20px",
        gap: 16,
        minHeight: 0,
      }}
    >
      {/* Card stack */}
      <div
        style={{
          flex: 1,
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: 240,
        }}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={top.id + ":" + (reveal?.kind ?? "ask")}
            initial={
              reveal
                ? { opacity: 1 }
                : { opacity: 0, scale: 0.96, y: 12 }
            }
            animate={{
              opacity: 1,
              scale: 1,
              y: 0,
              x: swipeDir && reveal ? (swipeDir === "left" ? -28 : 28) : 0,
              rotate: swipeDir && reveal ? (swipeDir === "left" ? -3 : 3) : 0,
            }}
            exit={{
              opacity: 0,
              x: swipeDir === "left" ? -260 : swipeDir === "right" ? 260 : 0,
              rotate: swipeDir === "left" ? -8 : swipeDir === "right" ? 8 : 0,
              transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] },
            }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            style={{
              width: "100%",
              minHeight: 200,
              padding: 20,
              background: reveal
                ? reveal.kind === "correct"
                  ? "rgba(34,197,94,0.10)"
                  : "rgba(239,68,68,0.10)"
                : "rgba(255,255,255,0.04)",
              border: reveal
                ? reveal.kind === "correct"
                  ? "1px solid rgba(34,197,94,0.45)"
                  : "1px solid rgba(239,68,68,0.45)"
                : "1px solid rgba(255,255,255,0.10)",
              borderRadius: 14,
              display: "flex",
              flexDirection: "column",
              gap: 14,
              boxShadow:
                "0 10px 30px rgba(0,0,0,0.30), 0 1px 0 rgba(255,255,255,0.04) inset",
            }}
          >
            <p
              style={{
                fontSize: 16,
                fontWeight: 500,
                letterSpacing: "-0.011em",
                lineHeight: 1.4,
                color: "rgba(255,255,255,0.92)",
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
                }}
              >
                <OptionTile
                  label={swap ? "B" : "A"}
                  text={swap ? top.option_b : top.option_a}
                />
                <OptionTile
                  label={swap ? "A" : "B"}
                  text={swap ? top.option_a : top.option_b}
                />
              </div>
            )}

            {/* Reveal: tick/x + why text. Correct also fades the
                "Correct" line shorter; wrong shows the actual right
                answer. */}
            {reveal && (
              <div
                style={{
                  paddingTop: 8,
                  borderTop: "1px solid rgba(255,255,255,0.10)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
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
                    ? "✓ correct"
                    : reveal.correctText
                      ? `✗ correct answer: ${reveal.correctText}`
                      : "✗ wrong"}
                </p>
                <p
                  style={{
                    fontSize: 13,
                    lineHeight: 1.45,
                    color: "rgba(255,255,255,0.78)",
                  }}
                >
                  {reveal.card.why_text}
                </p>
              </div>
            )}
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

function OptionTile({ label, text }: { label: string; text: string }) {
  return (
    <div
      style={{
        padding: 12,
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.10)",
        borderRadius: 10,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontFamily: "var(--font-mono)",
          letterSpacing: "0.22em",
          textTransform: "uppercase",
          color: "rgba(255,255,255,0.45)",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 13,
          lineHeight: 1.4,
          color: "rgba(255,255,255,0.86)",
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
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "14px 16px",
        background: disabled ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.08)",
        border: "1px solid rgba(255,255,255,0.14)",
        borderRadius: 12,
        color: disabled ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.92)",
        fontSize: 14,
        fontWeight: 600,
        letterSpacing: "-0.011em",
        cursor: disabled ? "default" : "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: side === "left" ? "flex-start" : "flex-end",
        gap: 8,
        transition: "all 150ms cubic-bezier(0.22,1,0.36,1)",
      }}
    >
      {side === "left" && (
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
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
      )}
      {label}
      {side === "right" && (
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
      )}
    </button>
  );
}
