"use client";

import { motion } from "framer-motion";

interface WeekZoneProps {
  weekNumber: number;
  title: string;
  subtitle: string;
  completed: number;
  total: number;
}

export function WeekZone({
  weekNumber,
  title,
  subtitle,
  completed,
  total,
}: WeekZoneProps) {
  const isComplete = completed === total;
  const weekLabel = `Week ${String(weekNumber).padStart(2, "0")}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-15%" }}
      transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      className="relative px-6 py-10 text-center"
    >
      {/* Horizontal rule on sides */}
      <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 flex items-center gap-4 px-4 opacity-40">
        <div className="flex-1 h-px bg-gradient-to-r from-transparent via-[var(--color-border-strong)] to-transparent" />
      </div>

      {/* Content */}
      <div className="relative flex flex-col items-center gap-2">
        <span className="mono-label flex items-center gap-2">
          <span>{weekLabel}</span>
          <span className="text-[var(--color-text-quaternary)]">/</span>
          <span className={isComplete ? "text-[var(--color-accent)]" : ""}>
            {completed}/{total}
          </span>
          {isComplete && (
            <span className="ml-1 text-[var(--color-accent)]">sealed</span>
          )}
        </span>
        <h2 className="display-heading text-[28px] sm:text-[34px] text-[var(--color-text-primary)]">
          {title}
        </h2>
        <p className="text-[13px] text-[var(--color-text-secondary)] max-w-[320px] leading-relaxed">
          {subtitle}
        </p>
      </div>
    </motion.div>
  );
}
