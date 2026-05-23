"use client";

/**
 * Phase 2 - Why You're Here panel (brief v3 §02 + §9 of template-copy).
 *
 * 3-card modal flipbook that fires once after the intro video gate
 * clears. Final card's "Let's go →" closes the panel + persists the
 * dismissal so it doesn't fire again on subsequent loads. Persistent
 * re-access from the dashboard chrome opens it in rewatch mode (no
 * persistence write on dismiss).
 *
 * Copy is final per Karlo (lovro-brief-v3, 23-05-2026). Voice rules
 * apply - hyphens not em-dashes, lowercase "ecomtalent" in casual
 * context, no banned phrases.
 */

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

const CARDS: Array<{
  eyebrow: string;
  body: string;
  cta: string;
}> = [
  {
    eyebrow: "The next 30 days",
    body:
      "The next 30 days aren't about making money.\n\nThey're about proving to yourself you can show up every day and do the work. Some days more, some days less, the goal is to get consistent.\n\nEverything else follows from that.",
    cta: "Next",
  },
  {
    eyebrow: "We want you to win",
    body:
      "We want to help you win as much as possible - that's why we built the dashboard the way we did.\n\nLock in and take action and you can claim 30% off your second month, right inside this dashboard.",
    cta: "Next",
  },
  {
    eyebrow: "Looking ahead",
    body:
      'One last thing worth knowing.\n\nWithin the next few weeks, you\'ll be making ads for real brands and having the opportunity to earn while you learn through the "Ad Bounty Program". You\'ll hear more about that as you get there.\n\nFor now: show up, watch the lessons, ship the action items - and we\'ll do our best to support you 🤝',
    cta: "Let's go",
  },
];

interface WhyYoureHerePanelProps {
  open: boolean;
  /** Called when the student clicks the final card's "Let's go" CTA.
   *  Parent persists the dismissal via POST /api/student/dismiss-why-
   *  youre-here. Skipped when rewatchMode is true. */
  onDismiss: () => void;
  /** Re-watch mode (fired from the persistent re-access button) -
   *  same UI, but no persistence write on close. */
  rewatchMode?: boolean;
}

export function WhyYoureHerePanel({
  open,
  onDismiss,
  rewatchMode = false,
}: WhyYoureHerePanelProps) {
  const [idx, setIdx] = useState(0);

  // Reset to card 1 every time the panel opens.
  useEffect(() => {
    if (open) setIdx(0);
  }, [open]);

  if (!open) return null;

  const isLast = idx === CARDS.length - 1;
  const card = CARDS[idx];

  const handleNext = () => {
    if (isLast) {
      onDismiss();
    } else {
      setIdx((i) => i + 1);
    }
  };

  const handleBack = () => {
    setIdx((i) => Math.max(0, i - 1));
  };

  return (
    <AnimatePresence>
      <motion.div
        key="wyh-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Why you're here"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
        className="fixed inset-0 z-[180] flex items-center justify-center"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(8,12,22,0.92) 0%, rgba(4,8,16,0.98) 100%)",
          backdropFilter: "blur(20px) saturate(140%)",
          WebkitBackdropFilter: "blur(20px) saturate(140%)",
        }}
      >
        <motion.div
          initial={{ scale: 0.96, opacity: 0, y: 12 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
          style={{
            width: "min(620px, 92vw)",
            background: "rgba(10,14,22,0.96)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 18,
            padding: 32,
            boxShadow:
              "0 40px 100px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.06) inset",
          }}
        >
          {/* Step indicator */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginBottom: 22,
            }}
          >
            {CARDS.map((_, i) => (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: 3,
                  borderRadius: 2,
                  background:
                    i <= idx
                      ? "rgba(255,255,255,0.85)"
                      : "rgba(255,255,255,0.10)",
                  transition: "background 250ms cubic-bezier(0.22,1,0.36,1)",
                }}
              />
            ))}
          </div>

          {/* Card content */}
          <AnimatePresence mode="wait">
            <motion.div
              key={idx}
              initial={{ opacity: 0, x: 18 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -18 }}
              transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            >
              <p
                style={{
                  fontSize: 11,
                  fontFamily: "var(--font-mono)",
                  letterSpacing: "0.22em",
                  textTransform: "uppercase",
                  color: "rgba(255,255,255,0.45)",
                  marginBottom: 10,
                }}
              >
                {card.eyebrow} · {idx + 1} / {CARDS.length}
              </p>
              <div
                style={{
                  fontSize: 17,
                  lineHeight: 1.55,
                  letterSpacing: "-0.011em",
                  color: "rgba(255,255,255,0.92)",
                  whiteSpace: "pre-line",
                  marginBottom: 28,
                }}
              >
                {card.body}
              </div>
            </motion.div>
          </AnimatePresence>

          {/* Footer */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              marginTop: 4,
            }}
          >
            <div style={{ display: "flex", gap: 10 }}>
              {idx > 0 && (
                <button
                  onClick={handleBack}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 8,
                    background: "transparent",
                    border: "1px solid rgba(255,255,255,0.14)",
                    color: "rgba(255,255,255,0.72)",
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  ← Back
                </button>
              )}
              {rewatchMode && (
                <button
                  onClick={onDismiss}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 8,
                    background: "transparent",
                    border: "1px solid rgba(255,255,255,0.14)",
                    color: "rgba(255,255,255,0.55)",
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  Close
                </button>
              )}
            </div>
            <button
              onClick={handleNext}
              style={{
                padding: "12px 22px",
                borderRadius: 10,
                background: "rgba(255,255,255,0.94)",
                color: "rgba(15,17,21,0.92)",
                border: "none",
                fontSize: 14,
                fontWeight: 700,
                letterSpacing: "-0.011em",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              {card.cta}
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
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
