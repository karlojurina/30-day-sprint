"use client";

import { useEffect, useState } from "react";
import { useStudent } from "@/contexts/StudentContext";

/**
 * Compact pill showing how many days are left in the discount window.
 *
 * Hidden when:
 *   - the student has already applied (discountRequest exists)
 *   - the window has already closed (negative ms)
 *
 * Stays calm. Color shifts from neutral → urgent (gold-deep) at <2 days
 * remaining, but never crimson — the urgency is in the number itself,
 * not theatrics.
 */
export function DiscountCountdown() {
  const { discountMsLeft, discountRequest } = useStudent();
  // Tick every minute so the counter doesn't go stale on long sessions
  const [, force] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => force((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

  if (discountRequest) return null;
  if (discountMsLeft <= 0) return null;

  const daysLeft = Math.ceil(discountMsLeft / 86_400_000);
  const urgent = daysLeft <= 2;

  return (
    <div
      className="flex items-center gap-2 shrink-0"
      style={{
        height: 32,
        padding: "0 10px",
        borderRadius: 8,
        border: "1px solid var(--color-border)",
        background: urgent
          ? "rgba(200, 157, 85, 0.12)"
          : "var(--color-fill-secondary)",
        transition: "all 250ms cubic-bezier(0.25, 0.1, 0.25, 1)",
      }}
      title={`${daysLeft} day${daysLeft === 1 ? "" : "s"} left to apply for the 30% discount`}
      aria-label={`${daysLeft} day${daysLeft === 1 ? "" : "s"} left in discount window`}
    >
      <span
        style={{
          color: urgent
            ? "var(--color-gold-light)"
            : "var(--color-gold)",
          fontSize: 13,
          fontWeight: 600,
          lineHeight: 1,
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "-0.005em",
        }}
      >
        {daysLeft}d
      </span>
      <span
        style={{
          color: "var(--color-text-tertiary)",
          fontSize: 12,
          fontWeight: 500,
          lineHeight: 1,
          letterSpacing: "-0.005em",
        }}
      >
        discount
      </span>
    </div>
  );
}
