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
        gap: 14,
        minHeight: 0,
      }}
    >
      {/* Tower visual - ghost slots top to bottom, filled blocks
          stack from foundation upward as correct answers land.

          Brief v2: "the tower can scale down slightly with each
          block so it always fits on screen." We give the tower a
          fixed-height container and scale block size to fit; for
          18-card decks at small viewports this keeps everything
          visible without scroll. */}
      <Tower
        total={total}
        correctCount={correctCount}
        wobbleKey={wobbleKey}
      />

      {/* Question card */}
      {top && (
        <div
          style={{
            background:
              reveal?.kind === "correct"
                ? "linear-gradient(155deg, rgba(74,222,128,0.16) 0%, rgba(34,197,94,0.04) 100%)"
                : reveal?.kind === "wrong"
                  ? "linear-gradient(155deg, rgba(252,165,165,0.18) 0%, rgba(239,68,68,0.04) 100%)"
                  : "linear-gradient(155deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.02) 100%)",
            border: reveal
              ? reveal.kind === "correct"
                ? "1px solid rgba(74,222,128,0.50)"
                : "1px solid rgba(252,165,165,0.50)"
              : "1px solid rgba(255,255,255,0.14)",
            borderRadius: 14,
            padding: "14px 16px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
            transition: "background 200ms, border-color 200ms",
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
                  color: "rgba(255,255,255,0.42)",
                }}
              >
                {isAb ? "Pick one" : "True or False"}
              </p>
              <p
                style={{
                  fontSize: 16,
                  fontWeight: 500,
                  lineHeight: 1.4,
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
      )}

      {/* Buttons - either pick (left/right) or continue */}
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

function Tower({
  total,
  correctCount,
  wobbleKey,
}: {
  total: number;
  correctCount: number;
  wobbleKey: number;
}) {
  // The tower container is fixed height. Block size scales with
  // total so 18 blocks always fit on small viewports. Brief allows
  // either scrolling OR scaling; we pick scaling.
  const containerHeight = 160; // px
  const foundationHeight = 4;
  const usableHeight = containerHeight - foundationHeight - 6; // 6px gap
  const blockHeight = Math.max(4, Math.min(14, usableHeight / total - 2));
  const blockGap = 2;
  const blockWidth = 90;

  // Build slot array bottom-to-top. Slot index 0 = bottom = first
  // correct answer's block. We render from bottom up so blocks
  // appear stacked correctly.
  const slots = Array.from({ length: total }, (_, i) => {
    const isFilled = i < correctCount;
    return { i, isFilled };
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
        gap: 4,
      }}
    >
      <motion.div
        key={wobbleKey}
        // Wobble animation on every increment of wobbleKey (= every
        // wrong answer). Subtle - 3 degrees side to side, ~600ms.
        animate={
          wobbleKey > 0
            ? {
                rotate: [0, -3, 3, -2, 2, 0],
                transition: { duration: 0.6, ease: "easeInOut" },
              }
            : { rotate: 0 }
        }
        style={{
          display: "flex",
          flexDirection: "column-reverse",
          alignItems: "center",
          gap: blockGap,
          transformOrigin: "bottom center",
        }}
      >
        {slots.map((slot) => (
          <Block
            key={slot.i}
            isFilled={slot.isFilled}
            width={blockWidth}
            height={blockHeight}
            // Stagger the drop-in only for the most recent block.
            isNewest={slot.isFilled && slot.i === correctCount - 1}
          />
        ))}
      </motion.div>
      {/* Foundation */}
      <div
        aria-hidden="true"
        style={{
          width: blockWidth + 18,
          height: foundationHeight,
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.06) 100%)",
          borderRadius: 2,
          boxShadow: "0 1px 3px rgba(0,0,0,0.4)",
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
      initial={
        isNewest ? { y: -40, scale: 1.1, opacity: 0 } : false
      }
      animate={
        isNewest
          ? {
              y: [-40, 4, 0],
              scale: [1.1, 0.96, 1],
              opacity: [0, 1, 1],
              transition: { duration: 0.42, ease: [0.22, 1, 0.36, 1] },
            }
          : undefined
      }
      style={{
        width,
        height,
        borderRadius: 3,
        background: isFilled
          ? "linear-gradient(180deg, rgba(230,192,122,0.96) 0%, rgba(195,159,98,0.96) 100%)"
          : "transparent",
        border: isFilled
          ? "1px solid rgba(230,192,122,1)"
          : "1px dashed rgba(255,255,255,0.18)",
        boxShadow: isFilled
          ? "0 2px 4px rgba(0,0,0,0.35), 0 1px 0 rgba(255,255,255,0.20) inset"
          : "none",
      }}
    />
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
        padding: 12,
        background:
          "linear-gradient(160deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.02) 100%)",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 10,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 22,
            height: 22,
            borderRadius: 999,
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0.06) 100%)",
            border: "1px solid rgba(255,255,255,0.22)",
            fontSize: 10,
            fontWeight: 700,
            color: "rgba(255,255,255,0.96)",
          }}
        >
          {badge}
        </span>
        <span
          style={{
            fontSize: 9,
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.42)",
          }}
        >
          {side === "left" ? "Left" : "Right"}
        </span>
      </div>
      <span
        style={{
          fontSize: 13,
          lineHeight: 1.4,
          color: "rgba(255,255,255,0.88)",
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
  const isTrue = label === "TRUE";
  const isFalse = label === "FALSE";
  const accent = isTrue
    ? "rgba(74,222,128,0.40)"
    : isFalse
      ? "rgba(239,68,68,0.38)"
      : "rgba(255,255,255,0.16)";
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "14px 16px",
        background:
          "linear-gradient(180deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.04) 100%)",
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
        gap: 8,
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
      <span>{label}</span>
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

function ContinueButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      autoFocus
      style={{
        width: "100%",
        padding: "13px 18px",
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
