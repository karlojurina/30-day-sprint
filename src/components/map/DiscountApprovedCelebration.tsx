"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { SPEC_EASE } from "@/lib/motion";

interface DiscountApprovedCelebrationProps {
  /** True = show the celebration. Null/false = no celebration. */
  show: boolean;
  onDismiss: () => void;
}

/**
 * Full-screen celebration that fires once when the team approves the
 * student's 30% discount. The team applies the promo code directly to
 * the student's Whop subscription in the Whop dashboard, so the
 * student never sees a code — only the confirmation that the
 * discount has landed on their account.
 *
 * Tracked from the dashboard via localStorage so reload doesn't
 * refire.
 *
 * Sequence (~1.5s before becoming dismissable):
 *   0.0  Backdrop fades in
 *   0.1  Big "30% OFF" springs up
 *   0.4  Eyebrow "Discount approved" fades in
 *   0.7  Subtitle explainer
 *   1.5  "Click anywhere to continue" prompt
 *   5.0s safety net auto-dismiss
 */
export function DiscountApprovedCelebration({
  show,
  onDismiss,
}: DiscountApprovedCelebrationProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!show) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const t = window.setTimeout(() => setVisible(false), 5000);
    return () => window.clearTimeout(t);
  }, [show]);

  function handleAnimationComplete() {
    if (!visible) onDismiss();
  }

  function handleClick() {
    setVisible(false);
  }

  if (!show) return null;

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
                marginBottom: 18,
              }}
            >
              Discount approved
            </motion.p>

            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.7, ease: SPEC_EASE }}
              style={{
                fontSize: 16,
                fontWeight: 500,
                letterSpacing: "-0.011em",
                color: "rgba(255, 255, 255, 0.85)",
                maxWidth: 420,
                textAlign: "center",
                lineHeight: 1.5,
              }}
            >
              Our team has applied the 30% discount to your
              subscription. You&rsquo;ll see it on your next Whop
              renewal — nothing else to do.
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
