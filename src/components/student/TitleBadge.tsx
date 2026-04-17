"use client";

import { getTitleLabel } from "@/lib/titles";
import type { StudentTitle } from "@/types/database";

interface TitleBadgeProps {
  title: StudentTitle;
}

export function TitleBadge({ title }: TitleBadgeProps) {
  const label = getTitleLabel(title);

  // Higher ranks get more prominent styling
  const isHighRank =
    title === "strategist" ||
    title === "bounty_hunter" ||
    title === "ecomtalent_pro";
  const isPro = title === "ecomtalent_pro";

  return (
    <span
      className={`
        inline-flex items-center px-2 py-0.5 rounded-full
        font-mono text-[10px] font-semibold uppercase tracking-wider
        transition-all duration-300
        ${
          isPro
            ? "bg-[#FFD700]/15 text-[#FFD700] border border-[#FFD700]/30 shadow-[0_0_8px_rgba(255,215,0,0.2)]"
            : isHighRank
              ? "bg-[var(--color-accent)]/10 text-[var(--color-accent-light)] border border-[var(--color-accent)]/20"
              : "bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] border border-[var(--color-border)]"
        }
      `}
    >
      {label}
    </span>
  );
}
