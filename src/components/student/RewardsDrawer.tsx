"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";
import type { HiddenReward, StudentReward } from "@/types/database";

interface RewardsDrawerProps {
  open: boolean;
  onClose: () => void;
  rewards: HiddenReward[];
  studentRewards: StudentReward[];
}

export function RewardsDrawer({
  open,
  onClose,
  rewards,
  studentRewards,
}: RewardsDrawerProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = ""; };
    }
  }, [open]);

  // Map reward IDs to their definitions
  const rewardMap = new Map(rewards.map((r) => [r.id, r]));
  const unlockedEntries = studentRewards
    .map((sr) => ({
      studentReward: sr,
      reward: rewardMap.get(sr.reward_id),
    }))
    .filter((e) => e.reward)
    .sort(
      (a, b) =>
        new Date(b.studentReward.unlocked_at).getTime() -
        new Date(a.studentReward.unlocked_at).getTime()
    );

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-[var(--color-bg-primary)]/70 backdrop-blur-md"
            onClick={onClose}
          />

          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.98 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="
              fixed inset-4 sm:inset-8 md:left-1/2 md:-translate-x-1/2 md:w-[560px] md:max-w-full md:inset-y-8
              z-50 flex flex-col
              bg-[var(--color-bg-card)] border border-[var(--color-border-strong)]
              rounded-2xl shadow-[0_0_60px_rgba(0,0,0,0.5)]
              overflow-hidden
            "
          >
            <div className="flex items-center justify-between p-5 sm:p-6 border-b border-[var(--color-border)]">
              <div>
                <h2 className="display-heading text-[22px] sm:text-[26px]">
                  Your Rewards
                </h2>
                <p className="mono-label mt-1">
                  {unlockedEntries.length} reward
                  {unlockedEntries.length === 1 ? "" : "s"} unlocked
                </p>
              </div>
              <button
                onClick={onClose}
                className="w-9 h-9 rounded-full flex items-center justify-center text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4">
              {unlockedEntries.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-[var(--color-text-tertiary)] text-[14px]">
                    No rewards yet. Keep completing tasks &mdash; surprises are
                    hidden along the way!
                  </p>
                </div>
              ) : (
                unlockedEntries.map(({ studentReward, reward }) => (
                  <div
                    key={studentReward.id}
                    className="p-4 rounded-xl bg-[var(--color-bg-elevated)] border border-[#FFC145]/20"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="#FFC145">
                        <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8l-6.2 4.5 2.4-7.4L2 9.4h7.6z" />
                      </svg>
                      <span
                        className="text-[14px] font-semibold"
                        style={{ color: "#FFC145" }}
                      >
                        {reward!.title}
                      </span>
                    </div>
                    <p className="text-[13px] text-[var(--color-text-secondary)] leading-relaxed">
                      {reward!.description}
                    </p>
                    {reward!.content && (
                      <p className="mt-2 text-[12px] text-[var(--color-text-primary)] leading-relaxed">
                        {reward!.content}
                      </p>
                    )}
                    <p className="mt-2 mono-label text-[var(--color-text-quaternary)]">
                      {new Date(studentReward.unlocked_at).toLocaleDateString()}
                    </p>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
