"use client";

import { motion } from "framer-motion";
import type { MonthReview } from "@/types/database";
import { getTitleLabel } from "@/lib/titles";

interface MonthReviewCardProps {
  review: MonthReview;
}

export function MonthReviewCard({ review }: MonthReviewCardProps) {
  const s = review.snapshot_data;

  const stats = [
    { label: "Tasks completed", value: `${s.tasks_completed}/${s.tasks_total}` },
    { label: "Current title", value: getTitleLabel(s.current_title), accent: true },
    { label: "Longest streak", value: `${s.longest_streak} days` },
    { label: "Notes written", value: String(s.notes_written) },
    { label: "Quizzes passed", value: `${s.quizzes_passed}/${s.quizzes_total}` },
    { label: "Rewards unlocked", value: String(s.rewards_unlocked) },
    { label: "Checkpoints sealed", value: `${s.checkpoints_completed}/${s.checkpoints_total}` },
    { label: "Bounties submitted", value: String(s.bounties_submitted) },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="mx-auto max-w-[560px]"
    >
      <div
        className="
          p-6 sm:p-8 rounded-2xl
          bg-gradient-to-b from-[var(--color-bg-card)] to-[#1A0E08]
          border border-[var(--color-accent)]/20
          shadow-[0_0_40px_var(--color-accent-glow)]
        "
      >
        {/* Header */}
        <div className="text-center mb-6">
          <p className="mono-label-accent mb-2">Day 28</p>
          <h3 className="display-heading text-[28px] sm:text-[34px] mb-2">
            Your Month in Review
          </h3>
          <p className="text-[14px] text-[var(--color-text-secondary)]">
            Look how far you&apos;ve come.
          </p>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="p-3 rounded-xl bg-[var(--color-bg-elevated)] border border-[var(--color-border)]"
            >
              <p className="mono-label mb-1">{stat.label}</p>
              <p
                className="text-[18px] font-semibold tabular-nums"
                style={{
                  color: stat.accent
                    ? "var(--color-accent)"
                    : "var(--color-text-primary)",
                }}
              >
                {stat.value}
              </p>
            </div>
          ))}
        </div>

        {/* Motivational closer */}
        <div className="text-center">
          <p className="text-[14px] text-[var(--color-text-secondary)] leading-relaxed">
            You&apos;re just getting started. Month 2 is where bounties start
            clicking and the money follows.
          </p>
        </div>
      </div>
    </motion.div>
  );
}
