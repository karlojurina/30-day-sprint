"use client";

/**
 * v42 (v2) — one-time welcome overlay that fires the first time a
 * student lands on Map 2 (after clicking "Finish Program" on l058).
 * Per brief 04-map2-playbook.md §8: "first-time experience (could
 * be a one-off intro overlay welcoming them to the Playbook,
 * dismissable, then just the hub)."
 *
 * Dismiss → POST /api/student/dismiss-playbook-welcome → row gets a
 * playbook_welcome_seen_at stamp → never appears again.
 *
 * For P0 this is the minimal version. The "sick as fuck" Map 1 → 2
 * transition lives in P1 (06-open-questions.md §1).
 *
 * All copy marked TODO(karlo).
 */

import { motion, AnimatePresence } from "framer-motion";
import { SPEC_EASE } from "@/lib/motion";

interface Props {
  open: boolean;
  onDismiss: () => void;
}

export function PlaybookWelcomeOverlay({ open, onDismiss }: Props) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            className="fixed inset-0 z-[80]"
            style={{
              background: "rgba(6,12,26,0.9)",
              backdropFilter: "blur(10px)",
            }}
          />

          <div
            className="fixed inset-0 z-[85] flex items-center justify-center p-4"
            style={{ pointerEvents: "none" }}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="pb-welcome-title"
              initial={{ opacity: 0, y: 24, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.97 }}
              transition={{ duration: 0.55, ease: SPEC_EASE, delay: 0.15 }}
              style={{
                pointerEvents: "auto",
                maxWidth: 540,
                width: "min(540px, 92vw)",
                background:
                  "linear-gradient(180deg, rgba(245,245,240,0.08) 0%, var(--color-bg-card) 60%, var(--color-bg-secondary) 100%)",
                border: "1px solid var(--color-gold)",
                borderRadius: 20,
                padding: "40px 32px 32px",
                boxShadow:
                  "0 60px 100px rgba(0,0,0,0.65), 0 0 80px rgba(245,245,240,0.18)",
              }}
              className="text-center"
            >
              <span
                className="font-mono uppercase block mb-3"
                style={{
                  color: "var(--color-gold)",
                  letterSpacing: "0.22em",
                  fontSize: 11,
                }}
              >
                {/* TODO(karlo): eyebrow */}
                Welcome to the Playbook
              </span>
              <h2
                id="pb-welcome-title"
                style={{
                  color: "var(--color-text-primary)",
                  fontSize: 30,
                  fontWeight: 600,
                  lineHeight: 1.15,
                  letterSpacing: "-0.025em",
                  marginBottom: 14,
                }}
              >
                {/* TODO(karlo): final headline */}
                You stopped being a student.
              </h2>
              <p
                style={{
                  color: "rgba(230,220,200,0.78)",
                  fontSize: 14,
                  lineHeight: 1.6,
                  marginBottom: 26,
                }}
              >
                {/* TODO(karlo): final sub-copy */}
                This is where you put the skill to work — bounty by
                bounty, brand by brand. Four activities sit on this
                hub, always open. Rotate through them until the income
                is real.
              </p>
              <button
                type="button"
                onClick={onDismiss}
                style={{
                  padding: "12px 28px",
                  borderRadius: 10,
                  border: "none",
                  background: "var(--color-gold)",
                  color: "var(--color-bg-primary)",
                  fontSize: 14,
                  fontWeight: 600,
                  letterSpacing: "-0.005em",
                  cursor: "pointer",
                }}
              >
                {/* TODO(karlo): final CTA */}
                Start the work
              </button>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
