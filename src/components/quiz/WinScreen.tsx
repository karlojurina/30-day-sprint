"use client";

/**
 * Shared "Path opened" win screen (brief §02). Renders inside
 * QuizModal when the format component signals pass. Karlo's brand
 * is "real, hard, no cringe" - clean typography, no confetti, no
 * fanfare. Big PATH OPENED + small subline + Continue button.
 */

import { motion } from "framer-motion";

interface WinScreenProps {
  onAdvance: () => void;
}

export function WinScreen({ onAdvance }: WinScreenProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 18,
        padding: "48px 24px",
        textAlign: "center",
      }}
    >
      <motion.h2
        initial={{ opacity: 0, y: 8, letterSpacing: "-0.05em" }}
        animate={{ opacity: 1, y: 0, letterSpacing: "-0.03em" }}
        transition={{ duration: 0.6, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
        style={{
          fontSize: 44,
          fontWeight: 700,
          letterSpacing: "-0.03em",
          color: "rgba(255,255,255,0.96)",
          lineHeight: 1,
        }}
      >
        PATH OPENED
      </motion.h2>
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.45 }}
        style={{
          fontSize: 15,
          color: "rgba(255,255,255,0.62)",
          letterSpacing: "-0.005em",
          lineHeight: 1.4,
        }}
      >
        Next region awaits.
      </motion.p>
      <motion.button
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.85 }}
        onClick={onAdvance}
        style={{
          marginTop: 12,
          padding: "11px 22px",
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
        Continue
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
      </motion.button>
    </motion.div>
  );
}
