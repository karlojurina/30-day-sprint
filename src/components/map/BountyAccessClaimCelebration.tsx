"use client";

/**
 * v42 (v2) — celebration takeover that fires immediately after the
 * student clicks "Claim my Bounty spot" on the l057 lesson sheet.
 *
 * Single state — there's no review queue, no rejection path, no
 * eligibility gate. Click → flag set → this overlay appears →
 * student dismisses → panel on the sheet collapses to a confirmation.
 *
 * Visual family is the same as DiscountClaimCelebration (full-screen
 * dim + centered card) but every gold accent flips to green so the
 * "Bounty Access" moment reads distinct from the discount claim.
 *
 * All user-facing strings are marked TODO(karlo) — Karlo will swap
 * to his final voice once the visual moment is signed off.
 */

import { motion, AnimatePresence } from "framer-motion";
import { SPEC_EASE } from "@/lib/motion";

interface Props {
  open: boolean;
  onDismiss: () => void;
}

export function BountyAccessClaimCelebration({ open, onDismiss }: Props) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss bounty access card"
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
              aria-labelledby="bounty-claim-title"
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
                  "linear-gradient(180deg, rgba(34,197,94,0.10) 0%, var(--color-bg-card) 50%, var(--color-bg-secondary) 100%)",
                border: "1px solid #22C55E",
                borderRadius: 18,
                padding: "32px 28px 28px",
                boxShadow:
                  "0 40px 80px rgba(0,0,0,0.6), 0 0 60px rgba(34,197,94,0.22)",
              }}
              className="text-center"
            >
              <CoinBurst />
              <span
                className="font-mono uppercase block mb-2 mt-4"
                style={{
                  color: "#4ADE80",
                  letterSpacing: "0.22em",
                  fontSize: 11,
                }}
              >
                {/* TODO(karlo): final eyebrow */}
                Bounty Access claimed
              </span>
              <h2
                id="bounty-claim-title"
                style={{
                  color: "var(--color-text-primary)",
                  fontSize: 30,
                  fontWeight: 600,
                  lineHeight: 1.1,
                  letterSpacing: "-0.025em",
                  marginBottom: 12,
                }}
              >
                {/* TODO(karlo): final headline */}
                You&rsquo;re in.
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
                You&rsquo;ve climbed the map. The program you&rsquo;ve
                been training for is now open to you. Head into Discord
                when you&rsquo;re ready to pick your first bounty.
              </p>
              <button
                onClick={onDismiss}
                className="px-5 py-2.5 rounded-lg font-mono uppercase"
                style={{
                  background: "rgba(34,197,94,0.16)",
                  color: "#4ADE80",
                  border: "1px solid rgba(34,197,94,0.45)",
                  fontSize: 11,
                  letterSpacing: "0.16em",
                  cursor: "pointer",
                }}
              >
                Keep going
              </button>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}

// Animated coin / spark burst above the headline. Mirrors the
// CoinBurst on DiscountClaimCelebration but in green, with a stack
// of coins (the bounty payout metaphor) instead of a single %.
function CoinBurst() {
  const sparks = Array.from({ length: 8 });
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
          width: 40,
          height: 40,
          margin: "auto",
          borderRadius: "50%",
          background:
            "radial-gradient(circle, #22C55E 0%, #4ADE80 60%, rgba(74,222,128,0.2) 100%)",
          boxShadow: "0 0 30px rgba(34,197,94,0.55)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "rgba(15,17,21,0.92)",
        }}
      >
        {/* Three-dot coin cluster mark, same as the in-region
            ClaimMarker. Identifies this as the bounty moment. */}
        <svg width="20" height="20" viewBox="-12 -12 24 24">
          <circle cx="0" cy="-6" r="3.2" fill="rgba(15,17,21,0.92)" />
          <circle cx="-5" cy="3" r="3.2" fill="rgba(15,17,21,0.92)" />
          <circle cx="5" cy="3" r="3.2" fill="rgba(15,17,21,0.92)" />
        </svg>
      </div>
      {sparks.map((_, i) => {
        const angle = (i / sparks.length) * Math.PI * 2 - Math.PI / 2;
        const dist = 28;
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
              duration: 1.2,
              delay: 0.3 + i * 0.04,
              repeat: Infinity,
              repeatDelay: 1.6,
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
              background: "#4ADE80",
              boxShadow: "0 0 8px rgba(74,222,128,0.8)",
            }}
          />
        );
      })}
    </div>
  );
}
