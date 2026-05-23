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

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  motion,
  AnimatePresence,
  useMotionValue,
  useTransform,
} from "framer-motion";
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

  // v54.4 - dragVisualX is decoupled from the card's actual transform.
  // It only drives the rotate/tint effects DURING drag (via onDrag
  // updates from framer-motion). The card itself uses framer-motion's
  // internal drag transform, so exit animations on `x` don't leak
  // their final value (e.g. 460) into dragVisualX and cause the next
  // card to mount off-center.
  const dragVisualX = useMotionValue(0);
  const dragRotate = useTransform(dragVisualX, [-220, 0, 220], [-10, 0, 10]);
  const leftTint = useTransform(dragVisualX, [-160, -30, 0], [1, 0.2, 0]);
  const rightTint = useTransform(dragVisualX, [0, 30, 160], [0, 0.2, 1]);

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
    dragVisualX.set(0);
  }, [dragVisualX]);

  const handlePick = useCallback(
    (pick: "left" | "right") => {
      if (!top || reveal != null) return;
      setSwipeDir(pick);
      // v54.4 - reset the drag visual tracker. The actual card
      // transform is managed by framer-motion's internal drag, so
      // we no longer need to fight an x-bound motion value.
      dragVisualX.set(0);

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
        setReveal({ kind: "wrong", card: top, correctText });
      }
      // v54.6 - no more auto-advance setTimeout. The student clicks
      // Continue when they're ready, OR taps the card itself. Gives
      // them full read time on long "why" lines.
    },
    [top, reveal, swapAbForCard, dragVisualX],
  );

  // v54.6 - manual advance when reveal is showing. Wraps advanceDeck
  // with the correct/wrong signal from the current reveal state.
  const advanceFromReveal = useCallback(() => {
    if (reveal == null) return;
    advanceDeck(reveal.kind === "correct");
  }, [reveal, advanceDeck]);

  // Keyboard:
  //   - During question: ← / → mirror the swipe buttons
  //   - During reveal: Enter / Space / → advance to the next card
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
            onDrag={(_, info) => {
              if (reveal != null) return;
              // Mirror the actual drag offset into the visual
              // tracker so the rotate + tints respond in real time.
              // The card's own x transform is managed internally by
              // framer-motion - we don't bind it via style anymore.
              dragVisualX.set(info.offset.x);
            }}
            onDragEnd={(_, info) => {
              if (reveal != null) return;
              if (info.offset.x < -SWIPE_COMMIT_THRESHOLD) {
                handlePick("left");
              } else if (info.offset.x > SWIPE_COMMIT_THRESHOLD) {
                handlePick("right");
              } else {
                // framer-motion's drag automatically springs the
                // card back to x=0 via dragConstraints {left:0,
                // right:0}. We just reset the visual tracker.
                dragVisualX.set(0);
              }
            }}
            style={{
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
                  ? -460
                  : swipeDir === "right"
                    ? 460
                    : 0,
              y: 30,
              rotate:
                swipeDir === "left" ? -18 : swipeDir === "right" ? 18 : 0,
              transition: {
                duration: 0.45,
                ease: [0.32, 0, 0.32, 1],
              },
            }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            whileTap={reveal == null ? { cursor: "grabbing" } : undefined}
          >
            <div
              // v54.6 - click-anywhere-to-advance during reveal as a
              // secondary affordance (Continue button is the primary).
              // The card cursor flips to pointer so it reads clickable.
              onClick={reveal != null ? advanceFromReveal : undefined}
              style={{
                position: "relative",
                padding: "24px 24px 20px",
                cursor: reveal != null ? "pointer" : "default",
                // v54.5 - premium glassmorphism. Layered translucent
                // surface: a base tinted gradient (correct/wrong/
                // neutral) PLUS a backdrop-filter that picks up the
                // dimmed map behind the modal. Hairline 1px borders
                // with low alpha so the card edge reads as glass.
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
                borderRadius: 18,
                display: "flex",
                flexDirection: "column",
                gap: 16,
                // Layered shadow: deep ambient + tight contact + inner
                // top highlight. Reads as "lifted glass" not "card on
                // a flat surface".
                boxShadow:
                  "0 24px 60px -8px rgba(0,0,0,0.55), 0 4px 12px rgba(0,0,0,0.35), 0 1px 0 rgba(255,255,255,0.10) inset, 0 -1px 0 rgba(0,0,0,0.30) inset",
                overflow: "hidden",
              }}
            >
              {/* v54.5 - top sheen. A subtle light gradient at the
                  card's top edge mimics how light catches a piece of
                  glass. Pure decoration, pointer-events:none. */}
              <div
                aria-hidden="true"
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  height: 80,
                  background:
                    "linear-gradient(180deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0) 100%)",
                  pointerEvents: "none",
                  opacity: 0.9,
                }}
              />
              {/* Direction tint overlays - fade in as the student
                  drags toward a side. Pure visual feedback. Only
                  during the question state. */}
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

              {reveal == null ? (
                <>
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
                </>
              ) : (
                /* v54.7 - REVEAL STATE. The question + tiles are
                    replaced by a focused reveal layout so the
                    explanation has room to breathe AND no overflow
                    into the Continue button below. The student
                    just answered, so repeating the question/tiles
                    isn't needed.

                    Layout: big glyph + status label + (if wrong,
                    the correct answer) + the "why" text. Nothing
                    competes with the explanation. */
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    gap: 14,
                    position: "relative",
                    minHeight: 200,
                    paddingTop: 4,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                    }}
                  >
                    <RevealGlyph kind={reveal.kind} />
                    <p
                      style={{
                        fontSize: 11,
                        fontFamily: "var(--font-mono)",
                        letterSpacing: "0.22em",
                        textTransform: "uppercase",
                        color:
                          reveal.kind === "correct" ? "#86EFAC" : "#FCA5A5",
                      }}
                    >
                      {reveal.kind === "correct" ? "Correct" : "Wrong"}
                    </p>
                  </div>
                  {reveal.kind === "wrong" && reveal.correctText && (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                      }}
                    >
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
                          fontSize: 15,
                          fontWeight: 500,
                          letterSpacing: "-0.011em",
                          lineHeight: 1.45,
                          color: "rgba(255,255,255,0.94)",
                        }}
                      >
                        {reveal.correctText}
                      </p>
                    </div>
                  )}
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                    }}
                  >
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
                        fontSize: 16,
                        fontWeight: 400,
                        lineHeight: 1.5,
                        color: "rgba(255,255,255,0.90)",
                        letterSpacing: "-0.005em",
                      }}
                    >
                      {reveal.card.why_text}
                    </p>
                  </div>
                </motion.div>
              )}

            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* v54.6 - footer swaps the two swipe buttons for a single
          Continue when the reveal is showing. This:
            1. Stops the reveal panel from overlapping the swipe
               buttons (Lovro's screenshot bug). Now the footer has
               one button instead of two, and the swipe buttons
               aren't visible while the reveal is.
            2. Lets the student read the explanation at their own
               pace - auto-advance is gone. */}
      <div
        style={{
          flexShrink: 0,
        }}
      >
        {reveal == null ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 10,
            }}
          >
            <SwipeButton
              side="left"
              label={leftLabel}
              disabled={false}
              onClick={() => handlePick("left")}
            />
            <SwipeButton
              side="right"
              label={rightLabel}
              disabled={false}
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
        // v54.5 - matching glassmorphism on the option tiles. Slightly
        // brighter glass than the card body so they read as
        // separate, interactive surfaces.
        background:
          "linear-gradient(160deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.03) 100%)",
        backdropFilter: "blur(12px) saturate(150%)",
        WebkitBackdropFilter: "blur(12px) saturate(150%)",
        border: "1px solid rgba(255,255,255,0.14)",
        borderRadius: 12,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        position: "relative",
        boxShadow:
          "0 6px 16px rgba(0,0,0,0.25), 0 1px 0 rgba(255,255,255,0.08) inset, 0 -1px 0 rgba(0,0,0,0.20) inset",
        overflow: "hidden",
      }}
    >
      {/* Tile top sheen */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 36,
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
            color: "rgba(255,255,255,0.42)",
          }}
        >
          {side === "left" ? "Swipe left" : "Swipe right"}
        </span>
      </div>
      <span
        style={{
          fontSize: 13.5,
          lineHeight: 1.45,
          color: "rgba(255,255,255,0.90)",
          letterSpacing: "-0.005em",
          position: "relative",
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
  const lifted = !disabled && hovered && !pressed;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setPressed(false);
      }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      style={{
        padding: "15px 18px",
        background: disabled
          ? "rgba(255,255,255,0.03)"
          // v54.5 - matching glassmorphism. Subtle gradient + frost
          // so the buttons read as part of the same material as the
          // card above them.
          : "linear-gradient(180deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.04) 100%)",
        backdropFilter: disabled ? undefined : "blur(12px) saturate(150%)",
        WebkitBackdropFilter: disabled ? undefined : "blur(12px) saturate(150%)",
        border: `1px solid ${disabled ? "rgba(255,255,255,0.08)" : accent}`,
        borderRadius: 12,
        color: disabled ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.96)",
        fontSize: 14,
        fontWeight: 700,
        letterSpacing: "0.02em",
        cursor: disabled ? "default" : "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: side === "left" ? "flex-start" : "flex-end",
        gap: 10,
        transform: pressed
          ? "scale(0.97)"
          : lifted
            ? "translateY(-2px)"
            : "translateY(0)",
        boxShadow: disabled
          ? "none"
          : lifted
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
