"use client";

import { motion } from "framer-motion";
import { useStudent } from "@/contexts/StudentContext";

interface DiscountGateProps {
  completed: number;
  required: number;
}

export function DiscountGate({ completed, required }: DiscountGateProps) {
  const { discountRequest, requestDiscount } = useStudent();
  const isUnlocked = required > 0 && completed >= required;
  const hasRequested = !!discountRequest;
  const hasApproved = discountRequest?.status === "approved";
  const remaining = Math.max(0, required - completed);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-15%" }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="relative mx-auto max-w-[440px] px-4"
    >
      <div
        className={`
          relative overflow-hidden rounded-2xl border
          p-6 sm:p-7
          ${
            isUnlocked
              ? "bg-gradient-to-br from-[#2A1810] to-[#1A0E08] border-[var(--color-accent)]/40"
              : "bg-[var(--color-bg-card)] border-[var(--color-border)]"
          }
        `}
      >
        {/* Decorative glow */}
        {isUnlocked && (
          <div
            aria-hidden
            className="absolute -top-1/2 -right-1/4 w-[300px] h-[300px] rounded-full pointer-events-none"
            style={{
              background:
                "radial-gradient(circle, var(--color-accent-glow) 0%, transparent 60%)",
            }}
          />
        )}

        {/* Meta label */}
        <div className="relative flex items-center justify-between mb-3">
          <span
            className={
              isUnlocked ? "mono-label-accent" : "mono-label"
            }
          >
            {hasApproved ? "claimed" : isUnlocked ? "unlocked" : "milestone"}
          </span>
          <span
            className={`
              font-mono text-xs font-semibold
              ${isUnlocked ? "text-[var(--color-accent)]" : "text-[var(--color-text-tertiary)]"}
            `}
          >
            {completed}/{required}
          </span>
        </div>

        {/* Title */}
        <h3 className="display-heading text-[24px] sm:text-[28px] mb-2 relative">
          {hasApproved
            ? "Discount claimed."
            : isUnlocked
              ? "30% discount unlocked."
              : "30% off your next month."}
        </h3>

        {/* Subtitle with Karlo's voice */}
        <p className="text-[14px] leading-relaxed text-[var(--color-text-secondary)] mb-5 relative">
          {hasApproved
            ? "Code sent. You earned it."
            : hasRequested
              ? "Pending review. You'll get the code once it's approved."
              : isUnlocked
                ? "You put the work in. Claim it now."
                : `${remaining} checkpoint${remaining === 1 ? "" : "s"} to unlock. Finish Onboarding, Foundations, and First Ads.`}
        </p>

        {/* Action */}
        {isUnlocked && !hasApproved && !hasRequested && (
          <button
            onClick={() => requestDiscount()}
            className="
              w-full flex items-center justify-center
              px-6 py-3 rounded-xl
              bg-[var(--color-accent)] hover:bg-[var(--color-accent-dark)]
              text-[var(--color-bg-primary)] font-semibold text-[15px]
              transition-colors relative
            "
          >
            Claim discount
          </button>
        )}

        {hasApproved && discountRequest?.promo_code && (
          <div className="relative p-3 rounded-xl bg-[var(--color-bg-primary)] border border-[var(--color-accent)]/30 flex items-center justify-between">
            <span className="font-mono text-sm text-[var(--color-accent)]">
              {discountRequest.promo_code}
            </span>
            <button
              onClick={() =>
                navigator.clipboard.writeText(
                  discountRequest.promo_code ?? ""
                )
              }
              className="mono-label hover:text-[var(--color-text-primary)] transition-colors"
            >
              copy
            </button>
          </div>
        )}

        {hasRequested && !hasApproved && (
          <div className="relative mono-label py-2">awaiting approval…</div>
        )}
      </div>
    </motion.div>
  );
}
