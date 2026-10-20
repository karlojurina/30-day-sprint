"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { motion, AnimatePresence, MotionConfig, useReducedMotion } from "framer-motion";
import { SPEC_EASE } from "@/lib/motion";

interface DiscountApprovedCelebrationProps {
  /** True = show the celebration. Null/false = no celebration. */
  show: boolean;
  onDismiss: () => void;
  /**
   * "map": the new course's map (WorldCelebrations.tsx). It plays when the
   * application is approved, before the team has put the 30% on, so its line
   * says the team is putting it on, in the map panel's words. The old
   * dashboard (the default) keeps its words (D5).
   */
  where?: "dashboard" | "map";
  /**
   * On the map: the application is applied already (the team approved it and
   * put the 30% on before the student was back on the map), so the line says
   * it is on (2026-10-20, streak-2; Lovro may change the words). The map passes
   * it only within 5 days of the application, while that payment is sure to
   * be still ahead (celebrations.ts approvalOnMap).
   */
  applied?: boolean;
}

/** A finger, not a mouse: the closing line says tap. */
const COARSE_QUERY = "(pointer: coarse)";
const subscribeCoarse = (cb: () => void) => {
  const m = window.matchMedia(COARSE_QUERY);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
const getCoarse = () => window.matchMedia(COARSE_QUERY).matches;
const getFalse = () => false;

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
 *   1.5  how to close it: "Click anywhere or press Esc to close" ("Tap
 *        anywhere to close" on a touch screen)
 *   5.0s safety net auto-dismiss
 *
 * 2026-10-16 (map review, Lovro's second Loom): the hero stays on one line
 * down to a 320 px phone (its size follows the screen's width, 88 px at
 * most); under prefers-reduced-motion nothing springs, grows or slides: the
 * fades stay, and nothing starts small (MotionConfig reducedMotion="user"
 * alone made the spring instant, but the hero still showed at half size for
 * two frames, then jumped); Esc closes it, before anything under it hears
 * the key; the closing line is readable (it was 20% white) and says how. On
 * the map (`where="map"`) the explainer no longer says the 30% is applied:
 * "The team is putting it on your Whop subscription, and you'll see it on
 * your next renewal. Nothing else to do.", as the map's panel says when
 * approved. Since 2026-10-20 the map also plays it for an application the
 * team has applied already (`applied`), whose line is "Your 30% is on your
 * next payment."
 */
export function DiscountApprovedCelebration({
  show,
  onDismiss,
  where = "dashboard",
  applied = false,
}: DiscountApprovedCelebrationProps) {
  /** Closed by a click, Esc or the safety net; the exit animation then calls onDismiss. */
  const [closed, setClosed] = useState(false);
  // A new `show` starts open again (set while rendering, as React's docs adjust state to a prop).
  const [shownBefore, setShownBefore] = useState(show);
  if (show !== shownBefore) {
    setShownBefore(show);
    if (show) setClosed(false);
  }
  const visible = show && !closed;
  const touch = useSyncExternalStore(subscribeCoarse, getCoarse, getFalse);
  /** prefers-reduced-motion: the fades only, every scale and rise left out. */
  const still = useReducedMotion() === true;

  useEffect(() => {
    if (!visible) return;
    const t = window.setTimeout(() => setClosed(true), 5000);
    // Esc is the celebration's while it is up: the map under it (an open
    // place, the checkpoint) does not hear it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setClosed(true);
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [visible]);

  function handleAnimationComplete() {
    if (!visible) onDismiss();
  }

  function handleClick() {
    setClosed(true);
  }

  if (!show) return null;

  return (
    <MotionConfig reducedMotion="user">
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
              initial={still ? { opacity: 0 } : { scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={still ? { opacity: 0 } : { scale: 0.92, opacity: 0 }}
              transition={{
                type: "spring",
                stiffness: 220,
                damping: 18,
                mass: 0.9,
              }}
              className="flex flex-col items-center"
              // Off the screen's edges on a phone, where the explainer would otherwise touch them.
              style={{ position: "relative", padding: "0 24px", maxWidth: "100%" }}
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

              {/* Big "30% OFF" hero: one line at any width, 88 px from a 440 px screen up */}
              <motion.div
                initial={still ? false : { scale: 0.5 }}
                animate={{ scale: 1 }}
                transition={{
                  type: "spring",
                  stiffness: 200,
                  damping: 14,
                  delay: 0.1,
                }}
                style={{
                  fontSize: "clamp(48px, 20vw, 88px)",
                  fontWeight: 700,
                  letterSpacing: "-0.045em",
                  lineHeight: 1,
                  whiteSpace: "nowrap",
                  color: "#FFFFFF",
                  marginBottom: 28,
                  fontVariantNumeric: "tabular-nums",
                  textShadow: "0 0 60px rgba(255, 255, 255, 0.28)",
                }}
              >
                30% OFF
              </motion.div>

              <motion.p
                initial={{ opacity: 0, y: still ? 0 : 14 }}
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
                initial={{ opacity: 0, y: still ? 0 : 10 }}
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
                {where === "map" && applied ? (
                  <>Your 30% is on your next payment.</>
                ) : where === "map" ? (
                  <>
                    The team is putting it on your Whop subscription, and
                    you&rsquo;ll see it on your next renewal. Nothing else to do.
                  </>
                ) : (
                  <>
                    Our team has applied the 30% discount to your
                    subscription. You&rsquo;ll see it on your next Whop
                    renewal. Nothing else to do.
                  </>
                )}
              </motion.p>

              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5, delay: 1.5 }}
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  letterSpacing: "-0.005em",
                  color: "rgba(255, 255, 255, 0.62)",
                  textAlign: "center",
                  marginTop: 36,
                }}
              >
                {touch ? "Tap anywhere to close" : "Click anywhere or press Esc to close"}
              </motion.p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </MotionConfig>
  );
}
