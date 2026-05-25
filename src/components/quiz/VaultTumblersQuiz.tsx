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
import { motion, AnimatePresence } from "framer-motion";
import type { SwipeCardQuestion } from "@/lib/region-quizzes";
import type {
  QuizCompletePayload,
  QuizWrongAnswer,
} from "./SwipeCardsQuiz";

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
      {/* Dial row */}
      <DialRow
        dials={dialStates}
        activeDialIdx={activeDialIdx}
        thunkKey={thunkKey}
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

      {/* Buttons */}
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
        gap: 8,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          justifyContent: "center",
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
          gap: 12,
          justifyContent: "center",
        }}
      >
        {dials.map((d) => (
          <span
            key={`label-${d.idx}`}
            style={{
              width: 40,
              fontSize: 9,
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.10em",
              textTransform: "uppercase",
              textAlign: "center",
              color: d.isLocked
                ? "rgba(230,192,122,0.92)"
                : d.isActive
                  ? "rgba(255,255,255,0.78)"
                  : "rgba(255,255,255,0.35)",
            }}
          >
            {d.isLocked ? "✓" : d.idx + 1}
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
  // When dial transitions to locked, do a satisfying ~360deg spin.
  // When wrong (thunkKey bump), counter-rotate ~-20deg briefly.
  const baseRotate = state.isLocked ? 360 : 0;

  // Compute the three "mark slots" around the inside ring. Each mark
  // is filled if its question was answered correctly.
  const marks = Array.from({ length: QUESTIONS_PER_DIAL }, (_, i) => {
    const isFilled = i < state.correctInDial;
    const wasAsked = i < state.askedInDial;
    return { i, isFilled, wasAsked };
  });

  return (
    <motion.div
      key={`dial-${state.idx}`}
      animate={
        thunkKey > 0
          ? {
              rotate: [baseRotate, baseRotate - 20, baseRotate],
              transition: { duration: 0.45, ease: "easeOut" },
            }
          : { rotate: baseRotate }
      }
      transition={
        state.isLocked
          ? { duration: 0.7, ease: [0.22, 1, 0.36, 1] }
          : { duration: 0.3 }
      }
      style={{
        position: "relative",
        width: 40,
        height: 40,
        borderRadius: "50%",
        background: state.isLocked
          ? "linear-gradient(135deg, rgba(230,192,122,0.45) 0%, rgba(195,159,98,0.55) 100%)"
          : state.isActive
            ? "linear-gradient(135deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.06) 100%)"
            : "rgba(255,255,255,0.04)",
        border: state.isLocked
          ? "1.5px solid rgba(230,192,122,0.95)"
          : state.isActive
            ? "1.5px solid rgba(255,255,255,0.42)"
            : "1px solid rgba(255,255,255,0.14)",
        boxShadow: state.isLocked
          ? "0 4px 12px rgba(230,192,122,0.30), 0 1px 0 rgba(255,255,255,0.18) inset"
          : state.isActive
            ? "0 2px 8px rgba(0,0,0,0.35), 0 1px 0 rgba(255,255,255,0.10) inset"
            : "inset 0 1px 2px rgba(0,0,0,0.30)",
      }}
    >
      {/* Three mark slots inside the dial - top, bottom-right,
          bottom-left. Filled when the corresponding question in this
          dial was answered correctly. Stays "ghost" if wrong/unasked. */}
      {marks.map((m) => {
        const angle = -90 + m.i * 120; // top, then clockwise
        const r = 11; // distance from center
        const rad = (angle * Math.PI) / 180;
        const x = Math.cos(rad) * r;
        const y = Math.sin(rad) * r;
        const fillColor = state.isLocked
          ? "rgba(255,255,255,0.92)"
          : m.isFilled
            ? "rgba(134,239,172,0.92)"
            : m.wasAsked
              ? "rgba(252,165,165,0.55)"
              : "rgba(255,255,255,0.22)";
        return (
          <div
            key={m.i}
            aria-hidden="true"
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`,
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: fillColor,
              transition: "background 220ms",
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
