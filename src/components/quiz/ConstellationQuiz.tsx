"use client";

/**
 * Region 3 quiz format: Constellation.
 *
 * Visual: a climbing arc of 18 stars (low-left to high-right).
 * Each correct answer "ignites" the next star in sequence + draws
 * a connecting line from the previously-lit star. Wrong answers
 * leave a gap - the star at that sequence position stays dim, and
 * no line is drawn to or from it. The final constellation shape
 * tells the score visually (full chain = 100%, gaps = misses).
 *
 * Mechanics: v65 drain-through, 50% pass threshold, plugs into
 * the shared QuizModal + ResultScreen via the same
 * QuizCompletePayload contract as Swipe / Stack / Vault.
 *
 * No gold, no mascots. Pure geometric stars + thin lines on the
 * existing dark map background.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { SwipeCardQuestion } from "@/lib/region-quizzes";
import type {
  QuizCompletePayload,
  QuizWrongAnswer,
} from "./SwipeCardsQuiz";

interface ConstellationQuizProps {
  cards: SwipeCardQuestion[];
  onProgressChange: (line: string) => void;
  onComplete: (result: QuizCompletePayload) => void;
}

interface RevealState {
  kind: "correct" | "wrong";
  card: SwipeCardQuestion;
  correctText: string | null;
}

// 18 stars arranged as a climbing arc - low-left to high-right.
// Coords are 0-100 normalized (SVG viewBox). Designed so the
// constellation reads as deliberate, not random. Final star sits
// near the top-right corner for a satisfying "completion" feel.
const STAR_POSITIONS = [
  { x: 4, y: 82 },
  { x: 10, y: 76 },
  { x: 16, y: 69 },
  { x: 22, y: 62 },
  { x: 28, y: 55 },
  { x: 34, y: 50 },
  { x: 40, y: 46 },
  { x: 46, y: 44 },
  { x: 52, y: 42 },
  { x: 58, y: 40 },
  { x: 63, y: 36 },
  { x: 68, y: 32 },
  { x: 73, y: 27 },
  { x: 78, y: 22 },
  { x: 83, y: 17 },
  { x: 88, y: 12 },
  { x: 93, y: 8 },
  { x: 97, y: 4 },
] as const;

function shuffle<T>(arr: T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function ConstellationQuiz({
  cards,
  onProgressChange,
  onComplete,
}: ConstellationQuizProps) {
  const [deck, setDeck] = useState<SwipeCardQuestion[]>(() => shuffle(cards));
  const [correctIds, setCorrectIds] = useState<Set<string>>(() => new Set());
  const [wrongAnswers, setWrongAnswers] = useState<QuizWrongAnswer[]>([]);
  // Ordered log of correctness per answered question. Drives which
  // stars in STAR_POSITIONS get lit (index N = the Nth answered
  // question's correctness).
  const [answerLog, setAnswerLog] = useState<Array<{ correct: boolean }>>([]);
  const [reveal, setReveal] = useState<RevealState | null>(null);
  // Increments on each wrong - the next-in-sequence star flickers
  // briefly to acknowledge the answer.
  const [flickerKey, setFlickerKey] = useState(0);

  const swapAbForCard = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const c of deck) m.set(c.id, Math.random() < 0.5);
    return m;
  }, [deck]);

  const total = cards.length;
  const answered = correctIds.size + wrongAnswers.length;

  useEffect(() => {
    onProgressChange(`Question ${Math.min(answered + 1, total)} of ${total}`);
  }, [answered, total, onProgressChange]);

  useEffect(() => {
    if (deck.length === 0 && total > 0) {
      onComplete({ correctIds, wrongAnswers, total });
    }
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

      setAnswerLog((prev) => [...prev, { correct: isCorrect }]);

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
        setFlickerKey((k) => k + 1);
      }
    },
    [top, reveal, swapAbForCard],
  );

  const advanceFromReveal = useCallback(() => {
    if (reveal == null) return;
    advanceDeck();
  }, [reveal, advanceDeck]);

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
      {/* Constellation - top of modal body, fixed natural height. */}
      <div style={{ flexShrink: 0 }}>
        <Constellation
          answerLog={answerLog}
          total={total}
          flickerKey={flickerKey}
        />
      </div>

      {/* Question card - vertically centered in remaining space. */}
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

      {/* Buttons - pinned to bottom. */}
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
// Constellation visual
// ──────────────────────────────────────────────────────────────────────

function Constellation({
  answerLog,
  total,
  flickerKey,
}: {
  answerLog: Array<{ correct: boolean }>;
  total: number;
  flickerKey: number;
}) {
  // SVG viewBox is 100 × 90 to match the star positions array. Width
  // is 100% of container, height auto via aspect ratio (~10:9).
  // Container height locked so the constellation has consistent size.
  const containerHeight = 180;
  const stars = STAR_POSITIONS.slice(0, total).map((pos, i) => {
    const answered = i < answerLog.length;
    const isLit = answered && answerLog[i].correct;
    const isDim = answered && !answerLog[i].correct;
    return { ...pos, idx: i, isLit, isDim };
  });

  // Lines connect consecutive LIT stars only. A wrong answer (dim
  // star) creates a visible gap in the chain.
  const lines: Array<{
    from: (typeof stars)[number];
    to: (typeof stars)[number];
    key: string;
  }> = [];
  for (let i = 0; i < stars.length - 1; i++) {
    if (stars[i].isLit && stars[i + 1].isLit) {
      lines.push({ from: stars[i], to: stars[i + 1], key: `${i}-${i + 1}` });
    }
  }

  // The flicker target - the next-in-sequence star (whichever was
  // just answered wrong). Used to pulse the most recent dim star.
  const lastAnsweredIdx = answerLog.length - 1;

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: containerHeight,
        overflow: "visible",
      }}
    >
      <svg
        viewBox="0 0 100 90"
        preserveAspectRatio="xMidYMid meet"
        style={{
          width: "100%",
          height: "100%",
          overflow: "visible",
        }}
      >
        {/* Faint background starfield - decorative dim dots that
            never light up. Adds depth so the constellation feels
            like it's in a sky, not floating on a flat background. */}
        <BackgroundStars />

        {/* Connecting lines between lit stars */}
        <AnimatePresence>
          {lines.map((l) => (
            <motion.line
              key={l.key}
              x1={l.from.x}
              y1={l.from.y}
              x2={l.to.x}
              y2={l.to.y}
              stroke="rgba(255,255,255,0.32)"
              strokeWidth="0.35"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
            />
          ))}
        </AnimatePresence>

        {/* Stars */}
        {stars.map((s) => (
          <Star
            key={s.idx}
            x={s.x}
            y={s.y}
            isLit={s.isLit}
            isDim={s.isDim}
            shouldFlicker={s.idx === lastAnsweredIdx && s.isDim}
            flickerKey={flickerKey}
          />
        ))}
      </svg>
    </div>
  );
}

function Star({
  x,
  y,
  isLit,
  isDim,
  shouldFlicker,
  flickerKey,
}: {
  x: number;
  y: number;
  isLit: boolean;
  isDim: boolean;
  shouldFlicker: boolean;
  flickerKey: number;
}) {
  // Three layers: ambient halo (large soft circle), mid glow, bright
  // core. Lit stars get all three; dim stars only get the core at
  // low opacity. Unanswered stars are a tiny ghost dot.
  if (isLit) {
    return (
      <motion.g
        initial={{ opacity: 0, scale: 0.4 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        style={{ transformOrigin: `${x}px ${y}px` }}
      >
        {/* Soft outer halo */}
        <circle
          cx={x}
          cy={y}
          r={3.6}
          fill="rgba(255,255,255,0.08)"
        />
        {/* Mid glow */}
        <circle
          cx={x}
          cy={y}
          r={1.8}
          fill="rgba(255,255,255,0.32)"
        />
        {/* Bright core */}
        <circle
          cx={x}
          cy={y}
          r={0.85}
          fill="rgba(255,255,255,0.98)"
        />
      </motion.g>
    );
  }

  if (isDim) {
    return (
      <motion.g
        key={shouldFlicker ? `flicker-${flickerKey}` : undefined}
        animate={
          shouldFlicker
            ? {
                opacity: [0.25, 0.85, 0.25, 0.6, 0.25],
                transition: { duration: 0.55, ease: "easeInOut" },
              }
            : { opacity: 0.25 }
        }
        initial={{ opacity: 0.25 }}
      >
        <circle
          cx={x}
          cy={y}
          r={0.85}
          fill="rgba(252,165,165,0.7)"
        />
      </motion.g>
    );
  }

  // Unanswered - tiny ghost dot.
  return (
    <circle
      cx={x}
      cy={y}
      r={0.6}
      fill="rgba(255,255,255,0.18)"
    />
  );
}

function BackgroundStars() {
  // Stable seeded background stars - same positions every render so
  // they don't twinkle distractingly. Just dim decoration.
  const positions = [
    { x: 8, y: 18 },
    { x: 26, y: 8 },
    { x: 38, y: 75 },
    { x: 56, y: 12 },
    { x: 72, y: 78 },
    { x: 12, y: 50 },
    { x: 88, y: 60 },
    { x: 50, y: 65 },
    { x: 18, y: 88 },
    { x: 64, y: 60 },
  ];
  return (
    <>
      {positions.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={0.3}
          fill="rgba(255,255,255,0.10)"
        />
      ))}
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Shared button + reveal pieces - mirror StackBuilder / VaultTumblers
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
