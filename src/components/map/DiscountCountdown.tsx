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
        height: 36,
        padding: "0 12px",
        borderRadius: 8,
        border: urgent
          ? "1px solid rgba(200,154,74,0.55)"
          : "1px solid rgba(230,192,122,0.28)",
        background: urgent
          ? "rgba(200,154,74,0.12)"
          : "rgba(16,32,66,0.6)",
        transition: "all 300ms cubic-bezier(0.22,1,0.36,1)",
      }}
      title={`${daysLeft} day${daysLeft === 1 ? "" : "s"} left to apply for the 30% discount`}
      aria-label={`${daysLeft} day${daysLeft === 1 ? "" : "s"} left in discount window`}
    >
      <span
        className="font-mono tabular-nums"
        style={{
          color: urgent ? "var(--color-gold-deep)" : "var(--color-gold-light)",
          fontSize: 14,
          fontWeight: 600,
          lineHeight: 1,
        }}
      >
        {daysLeft}d
      </span>
      <span
        className="font-mono uppercase"
        style={{
          color: urgent
            ? "var(--color-gold-deep)"
            : "rgba(230,192,122,0.7)",
          fontSize: 9,
          letterSpacing: "0.18em",
          lineHeight: 1,
        }}
      >
        Discount
      </span>
    </div>
  );
}
