"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { HiddenReward } from "@/types/database";

const REWARD_TYPE_LABELS: Record<string, string> = {
  personal_note: "Personal Note from Karlo",
  exclusive_resource: "Exclusive Resource",
  secret_task: "Secret Mission",
  early_access: "Early Access",
  shoutout: "Community Shoutout",
};

interface RewardModalProps {
  reward: HiddenReward | null;
  onDismiss: () => void;
}

export function RewardModal({ reward, onDismiss }: RewardModalProps) {
  return (
    <AnimatePresence>
      {reward && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 z-50 bg-[var(--color-bg-primary)]/85 backdrop-blur-md"
            onClick={onDismiss}
          />

          {/* Gold glow */}
          <div
            className="fixed inset-0 z-50 pointer-events-none"
            style={{
              background:
                "radial-gradient(60% 60% at 50% 50%, rgba(255, 193, 69, 0.25), transparent)",
            }}
          />

          {/* Content */}
          <motion.div
            initial={{ opacity: 0, scale: 0.85, y: 30 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 15 }}
            transition={{
              duration: 0.5,
              ease: [0.34, 1.56, 0.64, 1],
            }}
            className="fixed inset-0 z-50 flex items-center justify-center px-5 pointer-events-none"
          >
            <div
              className="
                relative max-w-[420px] w-full
                bg-gradient-to-b from-[#2A1A08] to-[var(--color-bg-card)]
                border border-[#FFC145]/30
                rounded-2xl p-8 text-center
                pointer-events-auto
                shadow-[0_0_80px_rgba(255,193,69,0.2)]
              "
              onClick={(e) => e.stopPropagation()}
            >
              {/* Sparkle icon */}
              <motion.div
                initial={{ scale: 0, rotate: -30 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ delay: 0.2, duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
                className="mx-auto mb-4 w-16 h-16 rounded-full bg-[#FFC145]/15 flex items-center justify-center"
              >
                <svg
                  className="w-8 h-8"
                  viewBox="0 0 24 24"
                  fill="#FFC145"
                >
                  <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8l-6.2 4.5 2.4-7.4L2 9.4h7.6z" />
                </svg>
              </motion.div>

              {/* Type label */}
              <motion.p
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="mono-label mb-2"
                style={{ color: "#FFC145" }}
              >
                {REWARD_TYPE_LABELS[reward.reward_type] ?? "Surprise Reward"}
              </motion.p>

              {/* Title */}
              <motion.h2
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
                className="display-heading text-[28px] sm:text-[34px] mb-3"
                style={{ color: "#FFC145" }}
              >
                {reward.title}
              </motion.h2>

              {/* Description */}
              <motion.p
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
                className="text-[14px] text-[var(--color-text-secondary)] leading-relaxed mb-6"
              >
                {reward.description}
              </motion.p>

              {/* Content (if any) */}
              {reward.content && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.6 }}
                  className="p-4 rounded-xl bg-[var(--color-bg-elevated)] border border-[var(--color-border)] text-[13px] text-[var(--color-text-primary)] leading-relaxed mb-6 text-left"
                >
                  {reward.content}
                </motion.div>
              )}

              {/* Dismiss */}
              <motion.button
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.7 }}
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.97 }}
                onClick={onDismiss}
                className="
                  px-8 py-3.5 rounded-xl
                  font-semibold text-[15px]
                  text-[var(--color-bg-primary)]
                  transition-colors
                "
                style={{ backgroundColor: "#FFC145" }}
              >
                Claim reward
              </motion.button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
