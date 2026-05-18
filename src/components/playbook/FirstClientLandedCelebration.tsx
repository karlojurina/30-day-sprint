"use client";

/**
 * v42 (v2) — the crowned celebration. The biggest moment in the
 * platform. Fires when the student clicks "I just landed my first
 * client" on the pb_land_first_client node sheet on Map 2.
 *
 * Per the brief (03-map1-changes.md §4):
 *
 *   "The 'Land Your First Client' celebration on Map 2 should feel
 *    BIGGER than the two Map 1 celebrations — it's the only milestone
 *    on Map 2 and the moment the whole program promise is delivered on.
 *    How that 'bigger' lands visually is Lovro's call (longer
 *    animation? more presence? sound?), but the family is the same."
 *
 * The "bigger" choices I'm making for P0:
 *   • Larger modal (560 vs 480)
 *   • Crown SVG above the headline (vs the % / coin / star)
 *   • Longer animation timing (.65s entry vs .5s)
 *   • Extra warmth in the gradient + heavier shadow
 *   • Triple-ring sparkle field instead of a single ring
 *   • Bigger headline type (38 vs 30)
 *
 * Copy is TODO(karlo) — placeholder text in his "what they
 * become" register, banned words avoided.
 */

import { motion, AnimatePresence } from "framer-motion";
import { SPEC_EASE } from "@/lib/motion";

interface Props {
  open: boolean;
  onDismiss: () => void;
}

export function FirstClientLandedCelebration({ open, onDismiss }: Props) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss first-client card"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            className="fixed inset-0 z-[90] cursor-default"
            style={{
              background: "rgba(6,12,26,0.92)",
              backdropFilter: "blur(14px)",
              border: "none",
              padding: 0,
            }}
          />

          <div
            className="fixed inset-0 z-[95] flex items-center justify-center p-4"
            style={{ pointerEvents: "none" }}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="first-client-celebration-title"
              initial={{ opacity: 0, y: 32, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.96 }}
              transition={{
                duration: 0.65,
                ease: SPEC_EASE,
                delay: 0.2,
              }}
              style={{
                pointerEvents: "auto",
                maxWidth: 560,
                width: "min(560px, 94vw)",
                background:
                  "linear-gradient(180deg, rgba(230,192,122,0.18) 0%, var(--color-bg-card) 50%, var(--color-bg-secondary) 100%)",
                border: "1.5px solid var(--color-gold-light)",
                borderRadius: 22,
                padding: "44px 36px 36px",
                boxShadow:
                  "0 80px 140px rgba(0,0,0,0.7), 0 0 100px rgba(245,245,240,0.28)",
              }}
              className="text-center"
            >
              <CrownBurst />
              <span
                className="font-mono uppercase block mb-3 mt-4"
                style={{
                  color: "var(--color-gold)",
                  letterSpacing: "0.26em",
                  fontSize: 12,
                }}
              >
                {/* TODO(karlo): eyebrow */}
                First client landed
              </span>
              <h2
                id="first-client-celebration-title"
                style={{
                  color: "var(--color-text-primary)",
                  fontSize: 38,
                  fontWeight: 600,
                  lineHeight: 1.05,
                  letterSpacing: "-0.028em",
                  marginBottom: 16,
                }}
              >
                {/* TODO(karlo): final headline */}
                You did it.
              </h2>
              <p
                style={{
                  color: "rgba(230,220,200,0.82)",
                  fontSize: 16,
                  lineHeight: 1.55,
                  marginBottom: 28,
                  maxWidth: 440,
                  margin: "0 auto 28px",
                }}
              >
                {/* TODO(karlo): "what they became" sub-copy.
                    This is THE moment — the entire program promise
                    delivered on. Karlo writes the final voice. */}
                You walked in a beginner. You walked out a marketer who
                can land paying clients. That&rsquo;s what we promised.
                That&rsquo;s what just happened.
              </p>
              <button
                onClick={onDismiss}
                className="px-6 py-3 rounded-lg font-mono uppercase"
                style={{
                  background: "var(--color-gold)",
                  color: "var(--color-bg-primary)",
                  border: "none",
                  fontSize: 12,
                  letterSpacing: "0.18em",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                {/* TODO(karlo): final CTA */}
                Keep going
              </button>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}

/**
 * Crown icon + triple-ring sparkle field above the headline. Bigger
 * than the StarBurst / CoinBurst used on Map 1 celebrations — this
 * is the crowned moment.
 */
function CrownBurst() {
  const innerSparks = Array.from({ length: 8 });
  const midSparks = Array.from({ length: 12 });
  const outerSparks = Array.from({ length: 16 });

  return (
    <div
      style={{
        position: "relative",
        width: 120,
        height: 80,
        margin: "0 auto 8px",
      }}
    >
      {/* Halo */}
      <div
        style={{
          position: "absolute",
          inset: "auto 0 0 0",
          width: 64,
          height: 64,
          margin: "auto",
          borderRadius: "50%",
          background:
            "radial-gradient(circle, var(--color-gold-light) 0%, var(--color-gold) 50%, rgba(245,245,240,0.0) 80%)",
          boxShadow: "0 0 60px rgba(245,245,240,0.6)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* Crown SVG — five-point crown with three filled gems. */}
        <svg width="36" height="36" viewBox="-18 -18 36 36">
          <path
            d="M -14 6 L -10 -8 L -4 0 L 0 -12 L 4 0 L 10 -8 L 14 6 Z"
            fill="rgba(15,17,21,0.92)"
            stroke="rgba(15,17,21,0.92)"
            strokeWidth={1.4}
            strokeLinejoin="round"
          />
          <path
            d="M -14 8 L 14 8"
            stroke="rgba(15,17,21,0.92)"
            strokeWidth={2.4}
            strokeLinecap="round"
          />
          <circle cx={-8} cy={2} r={1.6} fill="var(--color-gold-light)" />
          <circle cx={0} cy={-2} r={2} fill="var(--color-gold-light)" />
          <circle cx={8} cy={2} r={1.6} fill="var(--color-gold-light)" />
        </svg>
      </div>

      {/* Inner ring of sparkles — tight */}
      {innerSparks.map((_, i) => {
        const angle = (i / innerSparks.length) * Math.PI * 2 - Math.PI / 2;
        const dx = Math.cos(angle) * 30;
        const dy = Math.sin(angle) * 30;
        return (
          <motion.div
            key={`inner-${i}`}
            initial={{ x: 0, y: 0, opacity: 0, scale: 0.4 }}
            animate={{
              x: [0, dx],
              y: [0, dy],
              opacity: [0, 1, 0],
              scale: [0.4, 1, 0.5],
            }}
            transition={{
              duration: 1.4,
              delay: 0.3 + i * 0.04,
              repeat: Infinity,
              repeatDelay: 1.2,
              ease: SPEC_EASE,
            }}
            style={spark()}
          />
        );
      })}

      {/* Mid ring — wider sweep, delayed */}
      {midSparks.map((_, i) => {
        const angle = (i / midSparks.length) * Math.PI * 2 - Math.PI / 2;
        const dx = Math.cos(angle) * 46;
        const dy = Math.sin(angle) * 46;
        return (
          <motion.div
            key={`mid-${i}`}
            initial={{ x: 0, y: 0, opacity: 0, scale: 0.3 }}
            animate={{
              x: [0, dx],
              y: [0, dy],
              opacity: [0, 0.85, 0],
              scale: [0.3, 0.85, 0.4],
            }}
            transition={{
              duration: 1.8,
              delay: 0.7 + i * 0.04,
              repeat: Infinity,
              repeatDelay: 1.0,
              ease: SPEC_EASE,
            }}
            style={spark()}
          />
        );
      })}

      {/* Outer ring — widest, most delayed, smaller particles */}
      {outerSparks.map((_, i) => {
        const angle = (i / outerSparks.length) * Math.PI * 2 - Math.PI / 2;
        const dx = Math.cos(angle) * 62;
        const dy = Math.sin(angle) * 62;
        return (
          <motion.div
            key={`outer-${i}`}
            initial={{ x: 0, y: 0, opacity: 0, scale: 0.2 }}
            animate={{
              x: [0, dx],
              y: [0, dy],
              opacity: [0, 0.6, 0],
              scale: [0.2, 0.7, 0.3],
            }}
            transition={{
              duration: 2.2,
              delay: 1.1 + i * 0.03,
              repeat: Infinity,
              repeatDelay: 0.8,
              ease: SPEC_EASE,
            }}
            style={spark(4)}
          />
        );
      })}
    </div>
  );
}

function spark(size = 6) {
  return {
    position: "absolute" as const,
    top: "50%",
    left: "50%",
    width: size,
    height: size,
    marginLeft: -size / 2,
    marginTop: -size / 2,
    borderRadius: "50%",
    background: "var(--color-gold-light)",
    boxShadow: "0 0 10px rgba(245,245,240,0.85)",
  };
}
