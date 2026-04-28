"use client";

/**
 * Replaces the native alert() that fired when the student clicked
 * the R2 "Claim discount" marker. Three states:
 *
 *   - claiming    → calling requestDiscount()
 *   - approved    → show the promo code with copy button
 *   - pending     → "we're reviewing" message
 *   - rejected    → reason + Discord pointer
 *   - notEligible → tells them what's left
 *
 * Caller passes the current discountRequest (or null) and a
 * `mode` indicating which state to render.
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { DiscountRequest } from "@/types/database";

export type DiscountCelebrationMode =
  | "claim"      // unclaimed but eligible — show "Claim my 30% discount" CTA
  | "review"    // already requested — show pending/approved/rejected detail
  | "blocked";  // not yet eligible — show what's left

interface Props {
  open: boolean;
  mode: DiscountCelebrationMode;
  discountRequest: DiscountRequest | null;
  /** Called when student clicks "Claim my 30% discount" (mode='claim') */
  onClaim: () => Promise<void> | void;
  onDismiss: () => void;
  /** What's blocking eligibility, when mode='blocked' */
  blockerReason?: string;
}

export function DiscountClaimCelebration({
  open,
  mode,
  discountRequest,
  onClaim,
  onDismiss,
  blockerReason,
}: Props) {
  const [claiming, setClaiming] = useState(false);
  const [copied, setCopied] = useState(false);

  const status = discountRequest?.status ?? null;
  const promoCode = discountRequest?.promo_code ?? null;

  const handleClaim = async () => {
    if (claiming) return;
    setClaiming(true);
    try {
      await onClaim();
    } finally {
      setClaiming(false);
    }
  };

  const handleCopy = async () => {
    if (!promoCode) return;
    await navigator.clipboard.writeText(promoCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss discount card"
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
              aria-labelledby="discount-celebration-title"
              initial={{ opacity: 0, y: 20, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.97 }}
              transition={{
                duration: 0.5,
                ease: [0.22, 1, 0.36, 1],
                delay: 0.1,
              }}
              style={{
                pointerEvents: "auto",
                maxWidth: 480,
                width: "min(480px, 92vw)",
                background:
                  "linear-gradient(180deg, rgba(230,192,122,0.08) 0%, var(--color-bg-card) 50%, var(--color-bg-secondary) 100%)",
                border: "1px solid var(--color-gold)",
                borderRadius: 18,
                padding: "32px 28px 28px",
                boxShadow:
                  "0 40px 80px rgba(0,0,0,0.6), 0 0 60px rgba(230,192,122,0.18)",
              }}
              className="text-center"
            >
              {/* Mode-specific content */}
              {mode === "claim" && !discountRequest && (
                <>
                  <CoinBurst />
                  <span
                    className="font-mono uppercase block mb-2 mt-4"
                    style={{
                      color: "var(--color-gold)",
                      letterSpacing: "0.22em",
                      fontSize: 11,
                    }}
                  >
                    Reward unlocked
                  </span>
                  <h2
                    id="discount-celebration-title"
                    className="italic mb-3"
                    style={{
                      fontFamily: "var(--font-display)",
                      color: "var(--color-ink)",
                      fontSize: 36,
                      fontWeight: 500,
                      lineHeight: 1.05,
                    }}
                  >
                    30% off your next month.
                  </h2>
                  <p
                    style={{
                      color: "rgba(230,220,200,0.7)",
                      fontSize: 14,
                      lineHeight: 1.55,
                      marginBottom: 22,
                    }}
                  >
                    R1 + R2 done inside the window. Claim now and the team
                    will review within 24 hours.
                  </p>
                  <button
                    onClick={handleClaim}
                    disabled={claiming}
                    className="w-full px-6 py-3.5 rounded-lg font-semibold transition-colors"
                    style={{
                      background: "var(--color-gold)",
                      color: "var(--color-bg-primary)",
                      fontSize: 15,
                      opacity: claiming ? 0.7 : 1,
                    }}
                  >
                    {claiming ? "Claiming…" : "Claim my 30% discount"}
                  </button>
                </>
              )}

              {(mode === "review" || (mode === "claim" && discountRequest)) && (
                <>
                  <span
                    className="font-mono uppercase block mb-2"
                    style={{
                      color:
                        status === "approved"
                          ? "var(--color-gold)"
                          : status === "rejected"
                            ? "var(--color-danger)"
                            : "rgba(230,220,200,0.6)",
                      letterSpacing: "0.22em",
                      fontSize: 11,
                    }}
                  >
                    {status === "approved"
                      ? "Discount approved"
                      : status === "rejected"
                        ? "Discount rejected"
                        : "Review in progress"}
                  </span>

                  {status === "approved" && promoCode ? (
                    <>
                      <h2
                        id="discount-celebration-title"
                        className="italic mb-2"
                        style={{
                          fontFamily: "var(--font-display)",
                          color: "var(--color-ink)",
                          fontSize: 28,
                          fontWeight: 500,
                          lineHeight: 1.1,
                        }}
                      >
                        Your code is ready.
                      </h2>
                      <p
                        style={{
                          color: "rgba(230,220,200,0.62)",
                          fontSize: 13,
                          marginBottom: 18,
                        }}
                      >
                        Apply at checkout for 30% off the next month.
                      </p>
                      <div
                        className="flex items-center gap-2 mb-5"
                        style={{
                          padding: "12px 14px",
                          background: "rgba(6,12,26,0.55)",
                          border: "1px solid rgba(230,192,122,0.4)",
                          borderRadius: 10,
                        }}
                      >
                        <code
                          className="flex-1 font-mono text-left"
                          style={{
                            color: "var(--color-gold-light)",
                            fontSize: 16,
                            letterSpacing: "0.06em",
                          }}
                        >
                          {promoCode}
                        </code>
                        <button
                          onClick={handleCopy}
                          className="font-mono uppercase px-3 py-1.5 rounded"
                          style={{
                            background: "var(--color-gold)",
                            color: "var(--color-bg-primary)",
                            fontSize: 11,
                            letterSpacing: "0.12em",
                          }}
                        >
                          {copied ? "Copied" : "Copy"}
                        </button>
                      </div>
                    </>
                  ) : status === "rejected" ? (
                    <>
                      <h2
                        id="discount-celebration-title"
                        className="italic mb-3"
                        style={{
                          fontFamily: "var(--font-display)",
                          color: "var(--color-ink)",
                          fontSize: 28,
                          fontWeight: 500,
                        }}
                      >
                        The team flagged this one.
                      </h2>
                      <p
                        style={{
                          color: "rgba(230,220,200,0.7)",
                          fontSize: 14,
                          lineHeight: 1.55,
                          marginBottom: 18,
                        }}
                      >
                        {discountRequest?.rejection_reason ??
                          "Reach out in #ad-review on Discord and we'll sort it out."}
                      </p>
                    </>
                  ) : (
                    <>
                      <h2
                        id="discount-celebration-title"
                        className="italic mb-3"
                        style={{
                          fontFamily: "var(--font-display)",
                          color: "var(--color-ink)",
                          fontSize: 28,
                          fontWeight: 500,
                        }}
                      >
                        Pending review.
                      </h2>
                      <p
                        style={{
                          color: "rgba(230,220,200,0.7)",
                          fontSize: 14,
                          lineHeight: 1.55,
                          marginBottom: 18,
                        }}
                      >
                        We&rsquo;ll review within 24 hours. Your code shows
                        up here as soon as it&rsquo;s approved.
                      </p>
                    </>
                  )}

                  <button
                    onClick={onDismiss}
                    className="px-5 py-2.5 rounded-lg font-mono uppercase"
                    style={{
                      background: "rgba(230,192,122,0.1)",
                      color: "rgba(230,220,200,0.78)",
                      border: "1px solid rgba(230,192,122,0.28)",
                      fontSize: 11,
                      letterSpacing: "0.16em",
                    }}
                  >
                    Close
                  </button>
                </>
              )}

              {mode === "blocked" && (
                <>
                  <span
                    className="font-mono uppercase block mb-2"
                    style={{
                      color: "rgba(230,192,122,0.7)",
                      letterSpacing: "0.22em",
                      fontSize: 11,
                    }}
                  >
                    Almost there
                  </span>
                  <h2
                    id="discount-celebration-title"
                    className="italic mb-3"
                    style={{
                      fontFamily: "var(--font-display)",
                      color: "var(--color-ink)",
                      fontSize: 30,
                      fontWeight: 500,
                      lineHeight: 1.1,
                    }}
                  >
                    Discount locks behind R1 + R2.
                  </h2>
                  <p
                    style={{
                      color: "rgba(230,220,200,0.7)",
                      fontSize: 14,
                      lineHeight: 1.55,
                      marginBottom: 18,
                    }}
                  >
                    {blockerReason ??
                      "Finish every lesson in Region 1 and Region 2 within the 14-day window to claim 30% off."}
                  </p>
                  <button
                    onClick={onDismiss}
                    className="px-5 py-2.5 rounded-lg font-mono uppercase"
                    style={{
                      background: "var(--color-gold)",
                      color: "var(--color-bg-primary)",
                      fontSize: 11,
                      letterSpacing: "0.16em",
                    }}
                  >
                    Got it
                  </button>
                </>
              )}
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}

// Subtle animated coin burst above the title for the unclaimed state.
function CoinBurst() {
  const coins = Array.from({ length: 8 });
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
          width: 36,
          height: 36,
          margin: "auto",
          borderRadius: "50%",
          background:
            "radial-gradient(circle, var(--color-gold) 0%, var(--color-gold-light) 60%, rgba(230,192,122,0.2) 100%)",
          boxShadow: "0 0 30px rgba(230,192,122,0.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--color-bg-primary)",
          fontFamily: "monospace",
          fontWeight: 700,
          fontSize: 18,
        }}
      >
        %
      </div>
      {coins.map((_, i) => {
        const angle = (i / coins.length) * Math.PI * 2 - Math.PI / 2;
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
              ease: "easeOut",
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
              boxShadow: "0 0 8px rgba(230,192,122,0.8)",
            }}
          />
        );
      })}
    </div>
  );
}
