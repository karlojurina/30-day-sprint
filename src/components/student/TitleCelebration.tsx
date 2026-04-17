"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { StudentTitle } from "@/types/database";
import { getTitleLabel } from "@/lib/titles";

const TITLE_MESSAGES: Record<StudentTitle, string> = {
  recruit: "Welcome to the journey.",
  explorer: "You've taken the first step. The path is yours.",
  apprentice: "Foundations locked in. Time to create.",
  ad_creator: "You're making ads now. This is where it gets real.",
  strategist: "You see the patterns others miss.",
  bounty_hunter: "The money is within reach. Go get it.",
  ecomtalent_pro: "You did it. Every checkpoint. Every task. You're a pro.",
};

interface TitleCelebrationProps {
  title: StudentTitle | null;
  onDismiss: () => void;
}

export function TitleCelebration({ title, onDismiss }: TitleCelebrationProps) {
  return (
    <AnimatePresence>
      {title && <CelebrationContent title={title} onDismiss={onDismiss} />}
    </AnimatePresence>
  );
}

function CelebrationContent({
  title,
  onDismiss,
}: {
  title: StudentTitle;
  onDismiss: () => void;
}) {
  const label = getTitleLabel(title);
  const message = TITLE_MESSAGES[title];
  const isPro = title === "ecomtalent_pro";

  const accentColor = isPro ? "#FFD700" : "var(--color-accent)";
  const glowColor = isPro
    ? "rgba(255, 215, 0, 0.4)"
    : "var(--color-accent-glow)";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="fixed inset-0 z-50 flex items-center justify-center px-5"
      onClick={onDismiss}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-[var(--color-bg-primary)]/85 backdrop-blur-md" />

      {/* Glow */}
      <div
        className="absolute inset-0 opacity-50"
        style={{
          background: `radial-gradient(60% 60% at 50% 50%, ${glowColor}, transparent)`,
        }}
      />

      {/* Content */}
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 text-center max-w-[400px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Rank up label */}
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.5 }}
          className="mono-label-accent mb-4"
          style={{ color: accentColor }}
        >
          Rank Up
        </motion.p>

        {/* Title */}
        <motion.h2
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{
            delay: 0.35,
            duration: 0.6,
            ease: [0.34, 1.56, 0.64, 1],
          }}
          className="display-heading text-[40px] sm:text-[52px] mb-4"
          style={{ color: accentColor }}
        >
          {label}
        </motion.h2>

        {/* Message */}
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.55, duration: 0.5 }}
          className="text-[16px] sm:text-[18px] text-[var(--color-text-secondary)] leading-relaxed italic mb-8"
        >
          &ldquo;{message}&rdquo;
        </motion.p>

        {/* Button */}
        <motion.button
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7, duration: 0.4 }}
          whileHover={{ y: -2 }}
          whileTap={{ scale: 0.97 }}
          onClick={onDismiss}
          className="
            px-8 py-3.5 rounded-xl
            font-semibold text-[15px]
            text-[var(--color-bg-primary)]
            transition-colors
          "
          style={{ backgroundColor: accentColor }}
        >
          Keep going &rarr;
        </motion.button>
      </motion.div>
    </motion.div>
  );
}
