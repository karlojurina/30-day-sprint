"use client";

/**
 * Region 3 quiz format: Starfield.
 *
 * v70.1 redesign: the original "climbing arc with connecting lines"
 * looked like a trendline. Replaced with an actual cosmic starfield
 * - 18 answer stars scattered across the top zone in a deliberate
 * but organic pattern, surrounded by 40+ ambient background stars
 * that breathe with a slow twinkle. No connecting lines.
 *
 * Each correct answer ignites the next star in sequence:
 *   - Soft pulse-in + 4-layer glow (outer halo, mid, core, sparkle)
 *   - Subtle slow pulse animation after ignition (1.5s loop)
 * Wrong answer leaves that star dim with a brief red flicker.
 *
 * Mechanics: v65 drain-through, 50% pass threshold, plugs into the
 * shared QuizModal + ResultScreen via the same QuizCompletePayload
 * contract as Swipe / Stack / Vault.
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

// 18 answer stars scattered across the starfield in a deliberate
// but organic pattern. Loosely clustered in 3 horizontal bands so
// the field reads as a real sky, not a line. Sizes vary per star
// (some are "anchor" stars, larger and brighter when lit).
// Coords are 0-100 normalized (SVG viewBox 0 0 100 60).
const STAR_POSITIONS: Array<{ x: number; y: number; size: 1 | 2 | 3 }> = [
  // Top band - 5 stars
  { x: 14, y: 8, size: 1 },
  { x: 30, y: 12, size: 2 },
  { x: 46, y: 6, size: 1 },
  { x: 64, y: 11, size: 3 },
  { x: 84, y: 9, size: 2 },
  // Middle band - 7 stars (denser, with anchor stars)
  { x: 8, y: 26, size: 1 },
  { x: 22, y: 30, size: 2 },
  { x: 38, y: 24, size: 3 },
  { x: 54, y: 32, size: 1 },
  { x: 68, y: 26, size: 2 },
  { x: 82, y: 30, size: 1 },
  { x: 93, y: 22, size: 2 },
  // Bottom band - 6 stars
  { x: 12, y: 48, size: 2 },
  { x: 28, y: 52, size: 1 },
  { x: 44, y: 46, size: 3 },
  { x: 60, y: 52, size: 1 },
  { x: 76, y: 48, size: 2 },
  { x: 90, y: 54, size: 1 },
];

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

  const animationSlots = useQuizAnimationSlots();
  const swap = top ? swapAbForCard.get(top.id) ?? false : false;
  const isAb = top?.question_type === "ab_pick";
  const leftLabel = isAb ? (swap ? "B" : "A") : "FALSE";
  const rightLabel = isAb ? (swap ? "A" : "B") : "TRUE";

  return (
    <>
      {/* v70.9 - ambient viewport-wide starfield. Wraps around the
          modal with radial fade so stars dwindle out at the edges
          without a hard cutoff. */}
      {animationSlots.background &&
        createPortal(<AmbientViewportStarfield />, animationSlots.background)}

      {/* v70.3 - focused starfield (18 answer stars) portaled into
          the top slot above the modal panel. */}
      {animationSlots.top &&
        createPortal(
          <Constellation
            answerLog={answerLog}
            total={total}
            flickerKey={flickerKey}
          />,
          animationSlots.top,
        )}

      <div
        style={{
          // v70.8 - stable body height locks the modal panel size.
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
  // v70.6 - significantly bigger. Karlo: "we have so much space now
  // to use." Container goes from 240 to 380px tall + uses the full
  // available width. Stars scale up, glow halos get more dramatic.
  const containerHeight = 380;
  const stars = STAR_POSITIONS.slice(0, total).map((pos, i) => {
    const answered = i < answerLog.length;
    const isLit = answered && answerLog[i].correct;
    const isDim = answered && !answerLog[i].correct;
    return { ...pos, idx: i, isLit, isDim };
  });

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
      {/* Nebula - v70.8 much more subtle. The previous pass made
          the cluster MORE visible by widening coverage; user
          wanted the OPPOSITE (smoother edges = less perceivable
          cluster). Single very-low-alpha radial wash centered on
          the starfield. Just enough hint of atmosphere; no visible
          cluster boundary. */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse 65% 75% at 50% 50%, rgba(70,100,160,0.05) 0%, rgba(55,80,135,0.035) 25%, rgba(40,60,100,0.02) 50%, rgba(20,30,55,0.008) 75%, rgba(0,0,0,0) 100%)",
          pointerEvents: "none",
        }}
      />

      <svg
        viewBox="0 0 100 60"
        preserveAspectRatio="xMidYMid meet"
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          overflow: "visible",
        }}
      >
        <BackgroundStars />

        {stars.map((s) => (
          <Star
            key={s.idx}
            x={s.x}
            y={s.y}
            size={s.size}
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
  size,
  isLit,
  isDim,
  shouldFlicker,
  flickerKey,
}: {
  x: number;
  y: number;
  size: 1 | 2 | 3;
  isLit: boolean;
  isDim: boolean;
  shouldFlicker: boolean;
  flickerKey: number;
}) {
  // v70.6 - bigger stars all around. Anchor stars (size 3) get a
  // dramatic 4-pointed glint cross + outer halo. Mid stars (size 2)
  // get a substantial glow. Small stars (size 1) are still readable.
  const haloR = size === 3 ? 7 : size === 2 ? 5 : 3.6;
  const midR = size === 3 ? 3.2 : size === 2 ? 2.4 : 1.7;
  const coreR = size === 3 ? 1.6 : size === 2 ? 1.2 : 0.85;
  const glintLength = size === 3 ? 7 : size === 2 ? 4.5 : 0; // size 1 = no glint

  if (isLit) {
    const pulseScale = size === 3 ? 1.14 : size === 2 ? 1.09 : 1.05;
    return (
      <motion.g
        initial={{ opacity: 0, scale: 0.3 }}
        animate={{
          opacity: 1,
          scale: [0.3, 1.3, 1],
          transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] },
        }}
        style={{ transformOrigin: `${x}px ${y}px` }}
      >
        {/* Outer ambient halo with breathing pulse */}
        <motion.circle
          cx={x}
          cy={y}
          r={haloR}
          fill="rgba(180,210,255,0.08)"
          animate={{
            opacity: [0.5, 1, 0.5],
            scale: [1, pulseScale, 1],
          }}
          transition={{
            duration: 2.8,
            ease: "easeInOut",
            repeat: Infinity,
            delay: Math.random() * 1.5,
          }}
          style={{ transformOrigin: `${x}px ${y}px` }}
        />
        {/* Inner halo - tighter, brighter */}
        <circle
          cx={x}
          cy={y}
          r={haloR * 0.6}
          fill="rgba(220,235,255,0.14)"
        />
        {/* 4-pointed glint cross for medium + anchor stars - makes
            them feel like real stars not just dots. Crisp diagonal
            lines that catch the eye. */}
        {glintLength > 0 && (
          <g opacity={0.85}>
            {/* Horizontal arm */}
            <line
              x1={x - glintLength}
              y1={y}
              x2={x + glintLength}
              y2={y}
              stroke="rgba(255,255,255,0.50)"
              strokeWidth="0.18"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
            {/* Vertical arm */}
            <line
              x1={x}
              y1={y - glintLength}
              x2={x}
              y2={y + glintLength}
              stroke="rgba(255,255,255,0.50)"
              strokeWidth="0.18"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        )}
        {/* Mid glow */}
        <circle
          cx={x}
          cy={y}
          r={midR}
          fill="rgba(255,255,255,0.40)"
        />
        {/* Bright core */}
        <circle
          cx={x}
          cy={y}
          r={coreR}
          fill="rgba(255,255,255,1)"
        />
        {/* Tiny sparkle offset for anchor stars */}
        {size === 3 && (
          <circle
            cx={x + coreR * 0.6}
            cy={y - coreR * 0.4}
            r={0.28}
            fill="rgba(255,255,255,1)"
          />
        )}
      </motion.g>
    );
  }

  if (isDim) {
    const baseR = coreR * 1.2;
    return (
      <motion.g
        key={shouldFlicker ? `flicker-${flickerKey}` : undefined}
        animate={
          shouldFlicker
            ? {
                opacity: [0.3, 0.95, 0.4, 0.75, 0.34],
                transition: { duration: 0.6, ease: "easeInOut" },
              }
            : { opacity: 0.34 }
        }
        initial={{ opacity: 0.34 }}
      >
        {/* Soft red halo */}
        <circle
          cx={x}
          cy={y}
          r={baseR * 2}
          fill="rgba(252,165,165,0.08)"
        />
        <circle
          cx={x}
          cy={y}
          r={baseR}
          fill="rgba(252,165,165,0.85)"
        />
      </motion.g>
    );
  }

  // Unanswered "ghost" - dim white dot, slightly larger than before
  // so the constellation skeleton reads from the start.
  return (
    <g opacity={0.22}>
      <circle
        cx={x}
        cy={y}
        r={coreR * 1.4}
        fill="rgba(255,255,255,0.12)"
      />
      <circle
        cx={x}
        cy={y}
        r={coreR * 0.65}
        fill="rgba(255,255,255,0.55)"
      />
    </g>
  );
}

// 40+ ambient background stars inside the focused starfield zone.
// Stable positions, each twinkles independently. These fill the
// constellation slot above the modal. For the wider VIEWPORT-FILLING
// ambient field that wraps around the modal with radial fade, see
// AMBIENT_VIEWPORT_STARS below.
const BACKGROUND_STARS: Array<{ x: number; y: number; r: number; delay: number }> = [
  // Top band
  { x: 4, y: 4, r: 0.22, delay: 0.0 },
  { x: 19, y: 2, r: 0.18, delay: 1.2 },
  { x: 24, y: 15, r: 0.28, delay: 0.5 },
  { x: 38, y: 17, r: 0.20, delay: 2.1 },
  { x: 52, y: 14, r: 0.18, delay: 0.8 },
  { x: 58, y: 4, r: 0.24, delay: 3.0 },
  { x: 70, y: 3, r: 0.20, delay: 1.6 },
  { x: 78, y: 16, r: 0.28, delay: 0.3 },
  { x: 90, y: 4, r: 0.18, delay: 2.4 },
  { x: 96, y: 15, r: 0.22, delay: 1.0 },
  // Middle band
  { x: 2, y: 22, r: 0.20, delay: 1.8 },
  { x: 14, y: 21, r: 0.22, delay: 0.6 },
  { x: 28, y: 35, r: 0.18, delay: 2.7 },
  { x: 32, y: 22, r: 0.26, delay: 0.2 },
  { x: 44, y: 36, r: 0.20, delay: 1.4 },
  { x: 48, y: 22, r: 0.18, delay: 3.2 },
  { x: 62, y: 35, r: 0.24, delay: 0.9 },
  { x: 72, y: 36, r: 0.18, delay: 2.0 },
  { x: 88, y: 36, r: 0.22, delay: 0.4 },
  { x: 98, y: 30, r: 0.18, delay: 1.7 },
  // Lower-middle gaps
  { x: 5, y: 35, r: 0.22, delay: 0.8 },
  { x: 17, y: 40, r: 0.18, delay: 2.3 },
  { x: 36, y: 42, r: 0.20, delay: 0.5 },
  { x: 54, y: 42, r: 0.18, delay: 1.5 },
  { x: 68, y: 40, r: 0.22, delay: 2.8 },
  { x: 86, y: 44, r: 0.18, delay: 0.7 },
  // Bottom band
  { x: 4, y: 56, r: 0.20, delay: 1.1 },
  { x: 22, y: 58, r: 0.18, delay: 2.6 },
  { x: 38, y: 56, r: 0.24, delay: 0.6 },
  { x: 54, y: 58, r: 0.18, delay: 1.9 },
  { x: 70, y: 56, r: 0.22, delay: 0.3 },
  { x: 84, y: 58, r: 0.18, delay: 2.2 },
  { x: 96, y: 56, r: 0.20, delay: 1.3 },
  // Filler dots scattered through
  { x: 9, y: 11, r: 0.14, delay: 0.4 },
  { x: 41, y: 8, r: 0.14, delay: 1.7 },
  { x: 65, y: 17, r: 0.14, delay: 2.9 },
  { x: 81, y: 25, r: 0.14, delay: 0.8 },
  { x: 25, y: 49, r: 0.14, delay: 2.0 },
  { x: 58, y: 49, r: 0.14, delay: 0.5 },
  { x: 92, y: 49, r: 0.14, delay: 1.6 },
];

function BackgroundStars() {
  return (
    <>
      {BACKGROUND_STARS.map((p, i) => (
        <motion.circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={p.r}
          fill="rgba(255,255,255,0.45)"
          initial={{ opacity: 0.25 }}
          animate={{ opacity: [0.25, 0.6, 0.25] }}
          transition={{
            duration: 4.5 + (i % 3) * 1.2,
            ease: "easeInOut",
            repeat: Infinity,
            delay: p.delay,
          }}
        />
      ))}
    </>
  );
}

// v70.9 - viewport-wide ambient starfield. Renders into the
// background slot (full overlay) so stars wrap around the modal
// with a soft radial fade toward the edges. No hard cutoff at
// the focused-slot boundary - the night sky just continues out
// across the page.
//
// 180 stars generated deterministically via a seeded pseudo-random
// sequence so positions stay stable across renders. Each star gets
// a base opacity scaled by its distance from the viewport center
// (stars near the modal are denser/brighter; stars near the edges
// fade to nearly nothing).
// v70.10 - dropped from 180 to 80. The previous count overwhelmed
// the constellation. 80 is enough to suggest a starry surround
// without competing with the focused 18 answer stars + 40 stars
// in the focused zone.
const AMBIENT_STAR_COUNT = 80;
const AMBIENT_STARS = generateAmbientStars(AMBIENT_STAR_COUNT);

function generateAmbientStars(count: number) {
  // Mulberry32 PRNG for deterministic positions.
  let seed = 0x9d2c5680;
  function rand() {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return Array.from({ length: count }, () => {
    const x = rand() * 100;
    const y = rand() * 100;
    // Radial distance from viewport center (50, 50). Max possible
    // distance is from corner = sqrt(50^2 + 50^2) ~= 70.7.
    const dx = x - 50;
    const dy = y - 50;
    const dist = Math.sqrt(dx * dx + dy * dy);
    // Fade curve: 1 at center, 0 at distance ~55 from center. Stars
    // near edges are basically invisible.
    const fade = Math.max(0, Math.min(1, 1 - dist / 55));
    return {
      x,
      y,
      r: 0.10 + rand() * 0.14, // 0.10 - 0.24 - smaller than before
      fade,
      delay: rand() * 4,
      duration: 4 + rand() * 4, // 4-8s twinkle cycles
    };
  });
}

export function AmbientViewportStarfield() {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
      }}
    >
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid slice"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
        }}
      >
        {AMBIENT_STARS.map((s, i) => (
          <motion.circle
            key={i}
            cx={s.x}
            cy={s.y}
            r={s.r}
            fill="rgba(220,230,255,1)"
            initial={{ opacity: s.fade * 0.18 }}
            animate={{
              opacity: [
                s.fade * 0.18,
                s.fade * 0.42,
                s.fade * 0.18,
              ],
            }}
            transition={{
              duration: s.duration,
              ease: "easeInOut",
              repeat: Infinity,
              delay: s.delay,
            }}
          />
        ))}
      </svg>
    </div>
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
