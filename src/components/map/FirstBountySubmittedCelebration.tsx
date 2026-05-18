"use client";

/**
 * v42 (v2) — celebration takeover that fires immediately after the
 * student marks l058 complete.
 *
 * Per the brief (03-map1-changes.md §3.2), l058 is the climactic
 * final task — the moment everything on Map 1 has been climbing
 * toward. The celebration uses the gold family (same shape as the
 * discount-claim and bounty-claim takeovers, gold palette) and
 * deliberately leaves the "Finish Program" CTA on the lesson
 * sheet — the student dismisses this overlay and finds the
 * Finish Program button waiting for them when they come back to
 * the sheet. The beat between celebration and crossing is the
 * point.
 *
 * All user-facing copy marked TODO(karlo).
 */

import { motion, AnimatePresence } from "framer-motion";
import { SPEC_EASE } from "@/lib/motion";

interface Props {
  open: boolean;
  onDismiss: () => void;
}

export function FirstBountySubmittedCelebration({ open, onDismiss }: Props) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss first-bounty card"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 z-[70] cursor-default"
            style={{
              background: "rgba(6,12,26,0.84)",
              backdropFilter: "blur(8px)",
              border: "none",
              padding: 0,
            }}
          />

          <div
            className="fixed inset-0 z-[75] flex items-center justify-center p-4"
            style={{ pointerEvents: "none" }}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="first-bounty-celebration-title"
              initial={{ opacity: 0, y: 20, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.97 }}
              transition={{
                duration: 0.5,
                ease: SPEC_EASE,
                delay: 0.1,
              }}
              style={{
                pointerEvents: "auto",
                maxWidth: 480,
                width: "min(480px, 92vw)",
                background:
                  "linear-gradient(180deg, rgba(245,245,240,0.10) 0%, var(--color-bg-card) 50%, var(--color-bg-secondary) 100%)",
                border: "1px solid var(--color-gold)",
                borderRadius: 18,
                padding: "32px 28px 28px",
                boxShadow:
                  "0 40px 80px rgba(0,0,0,0.6), 0 0 60px rgba(245,245,240,0.22)",
              }}
              className="text-center"
            >
              <StarBurst />
              <span
                className="font-mono uppercase block mb-2 mt-4"
                style={{
                  color: "var(--color-gold)",
                  letterSpacing: "0.22em",
                  fontSize: 11,
                }}
              >
                {/* TODO(karlo): final eyebrow */}
                First bounty submitted
              </span>
              <h2
                id="first-bounty-celebration-title"
                style={{
                  color: "var(--color-text-primary)",
                  fontSize: 32,
                  fontWeight: 600,
                  lineHeight: 1.1,
                  letterSpacing: "-0.025em",
                  marginBottom: 12,
                }}
              >
                {/* TODO(karlo): final headline */}
                You shipped real work.
              </h2>
              <p
                style={{
                  color: "rgba(230,220,200,0.78)",
                  fontSize: 14,
                  lineHeight: 1.55,
                  marginBottom: 22,
                }}
              >
                {/* TODO(karlo): final sub-copy in the "what they
                    become" voice */}
                30 days ago you were a beginner. Right now you&rsquo;ve
                submitted a real ad for a real brand. That&rsquo;s a
                marketer.
              </p>
              <button
                onClick={onDismiss}
                className="px-5 py-2.5 rounded-lg font-mono uppercase"
                style={{
                  background: "rgba(230,192,122,0.18)",
                  color: "var(--color-gold-light)",
                  border: "1px solid rgba(230,192,122,0.5)",
                  fontSize: 11,
                  letterSpacing: "0.16em",
                  cursor: "pointer",
                }}
              >
                Take a beat
              </button>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}

// Gold star + radiating sparks above the headline. Echoes the
// in-region claim-marker visual language so the celebration feels
// like one continuous gold thread across the climactic moments.
function StarBurst() {
  const sparks = Array.from({ length: 10 });
  return (
    <div
      style={{
        position: "relative",
        width: 80,
        height: 56,
        margin: "0 auto 4px",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: "auto 0 0 0",
          width: 44,
          height: 44,
          margin: "auto",
          borderRadius: "50%",
          background:
            "radial-gradient(circle, var(--color-gold-light) 0%, var(--color-gold) 60%, rgba(245,245,240,0.2) 100%)",
          boxShadow: "0 0 36px rgba(245,245,240,0.55)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* 16-point star icon — mirrors the in-scene ClaimMarker
            shape so the same visual reads across both moments. */}
        <svg width="24" height="24" viewBox="-14 -14 28 28">
          <polygon
            points="0,-12 4.5,-4.5 11.3,-8.6 6.5,-2.5 13.3,-1.4 7.6,2.5 12.2,8.6 5.2,7.4 8.4,13.5 1.7,10.2 0,12 -1.7,10.2 -8.4,13.5 -5.2,7.4 -12.2,8.6 -7.6,2.5 -13.3,-1.4 -6.5,-2.5 -11.3,-8.6 -4.5,-4.5"
            fill="rgba(15,17,21,0.92)"
          />
        </svg>
      </div>
      {sparks.map((_, i) => {
        const angle = (i / sparks.length) * Math.PI * 2 - Math.PI / 2;
        const dist = 32;
        const dx = Math.cos(angle) * dist;
        const dy = Math.sin(angle) * dist;
        return (
          <motion.div
            key={i}
            initial={{ x: 0, y: 0, opacity: 0, scale: 0.4 }}
            animate={{
              x: [0, dx],
              y: [0, dy],
              opacity: [0, 1, 0],
              scale: [0.4, 1, 0.6],
            }}
            transition={{
              duration: 1.4,
              delay: 0.3 + i * 0.05,
              repeat: Infinity,
              repeatDelay: 1.4,
              ease: SPEC_EASE,
            }}
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              width: 6,
              height: 6,
              marginLeft: -3,
              marginTop: -3,
              borderRadius: "50%",
              background: "var(--color-gold-light)",
              boxShadow: "0 0 10px rgba(245,245,240,0.8)",
            }}
          />
        );
      })}
    </div>
  );
}
