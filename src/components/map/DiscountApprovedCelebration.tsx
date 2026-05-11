"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { SPEC_EASE } from "@/lib/motion";

interface DiscountApprovedCelebrationProps {
  /** Promo code to celebrate. Null = no celebration showing. */
  code: string | null;
  onDismiss: () => void;
}

/**
 * Full-screen celebration that fires once when the admin manually
 * approves the student's 30% discount and a Whop promo code is
 * minted. Tracked via localStorage so reload doesn't refire.
 *
 * Sequence (~1.5s before becoming dismissable):
 *   0.0  Backdrop fades in
 *   0.1  Big "30% OFF" pill springs up
 *   0.4  Eyebrow "Discount approved" fades in
 *   0.5  Promo code reveals
 *   0.7  Subtitle + Copy button
 *   1.5  "Click anywhere to continue" prompt
 *   5.0s safety net auto-dismiss
 */
export function DiscountApprovedCelebration({
  code,
  onDismiss,
}: DiscountApprovedCelebrationProps) {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (code == null) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const t = window.setTimeout(() => setVisible(false), 5000);
    return () => window.clearTimeout(t);
  }, [code]);

  function handleAnimationComplete() {
    if (!visible) onDismiss();
  }

  function handleClick(e: React.MouseEvent) {
    // Don't dismiss when clicking the Copy button
    if ((e.target as HTMLElement).closest("button")) return;
    setVisible(false);
  }

  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    if (!code) return;
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    });
  }

  if (code == null) return null;

  return (
    <AnimatePresence onExitComplete={handleAnimationComplete}>
      {visible && (
        <motion.div
          key="discount-celebration"
          role="dialog"
          aria-modal="true"
          aria-label="30% discount approved"
          onClick={handleClick}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25, ease: SPEC_EASE }}
          className="fixed inset-0 z-[200] flex items-center justify-center"
          style={{
            background:
              "radial-gradient(ellipse at center, rgba(8,12,22,0.78) 0%, rgba(4,8,16,0.92) 100%)",
            backdropFilter: "blur(14px) saturate(140%)",
            WebkitBackdropFilter: "blur(14px) saturate(140%)",
            cursor: "pointer",
          }}
        >
          <motion.div
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.92, opacity: 0 }}
            transition={{
              type: "spring",
              stiffness: 220,
              damping: 18,
              mass: 0.9,
            }}
            className="flex flex-col items-center"
            style={{ position: "relative" }}
          >
            {/* Soft warm halo behind the 30% */}
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                top: -40,
                width: 360,
                height: 360,
                borderRadius: "50%",
                background:
                  "radial-gradient(circle, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.04) 40%, rgba(255,255,255,0) 70%)",
                pointerEvents: "none",
                filter: "blur(12px)",
              }}
            />

            {/* Big "30% OFF" hero */}
            <motion.div
              initial={{ scale: 0.5 }}
              animate={{ scale: 1 }}
              transition={{
                type: "spring",
                stiffness: 200,
                damping: 14,
                delay: 0.1,
              }}
              style={{
                fontSize: 88,
                fontWeight: 700,
                letterSpacing: "-0.045em",
                lineHeight: 1,
                color: "#FFFFFF",
                marginBottom: 28,
                fontVariantNumeric: "tabular-nums",
                textShadow: "0 0 60px rgba(255, 255, 255, 0.28)",
              }}
            >
              30% OFF
            </motion.div>

            <motion.p
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: 0.4, ease: SPEC_EASE }}
              style={{
                fontSize: 14,
                fontWeight: 500,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                color: "rgba(255, 255, 255, 0.65)",
                marginBottom: 12,
              }}
            >
              Discount approved
            </motion.p>

            {/* Promo code with Copy button */}
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{
                duration: 0.55,
                delay: 0.5,
                ease: SPEC_EASE,
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 20px",
                borderRadius: 14,
                background: "rgba(255, 255, 255, 0.08)",
                border: "1px solid rgba(255, 255, 255, 0.22)",
                backdropFilter: "blur(20px)",
                marginBottom: 18,
              }}
            >
              <span
                className="tabular-nums"
                style={{
                  fontSize: 22,
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  color: "rgba(255, 255, 255, 0.96)",
                  fontFamily:
                    'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
                }}
              >
                {code}
              </span>
              <button
                type="button"
                onClick={handleCopy}
                style={{
                  padding: "6px 14px",
                  borderRadius: 999,
                  background: copied
                    ? "rgba(255, 255, 255, 0.92)"
                    : "rgba(255, 255, 255, 0.16)",
                  border: "1px solid rgba(255, 255, 255, 0.28)",
                  color: copied
                    ? "rgba(15, 17, 21, 0.92)"
                    : "rgba(255, 255, 255, 0.92)",
                  fontSize: 12,
                  fontWeight: 600,
                  letterSpacing: "-0.005em",
                  cursor: "pointer",
                  transition: "all 150ms cubic-bezier(0.25, 0.1, 0.25, 1)",
                }}
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </motion.div>

            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: 0.7, ease: SPEC_EASE }}
              style={{
                fontSize: 14,
                fontWeight: 500,
                letterSpacing: "-0.005em",
                color: "rgba(255, 255, 255, 0.65)",
                marginTop: 4,
                maxWidth: 380,
                textAlign: "center",
                lineHeight: 1.5,
              }}
            >
              Apply this code in your Whop billing portal and the
              discount lands on your next renewal — no need to cancel.
            </motion.p>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              transition={{ duration: 0.5, delay: 1.5 }}
              style={{
                fontSize: 12,
                fontWeight: 500,
                letterSpacing: "-0.005em",
                color: "rgba(255, 255, 255, 0.4)",
                marginTop: 36,
              }}
            >
              Click anywhere to continue
            </motion.p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
