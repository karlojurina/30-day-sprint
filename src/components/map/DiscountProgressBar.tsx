"use client";

import { useMemo } from "react";
import { useStudent } from "@/contexts/StudentContext";
import { progressPercent } from "@/lib/constants";

interface DiscountProgressBarProps {
  firstName: string;
}

/**
 * The TopBar's secondary row. Single horizontal bar showing how
 * close the student is to unlocking the 30% discount, which lives
 * at the end of Region 2.
 *
 * Filled portion = lessons completed across R1 + R2.
 * Marker at the far right = the discount gate.
 *
 * Replaces the old 30-day tick ruler. One bar, one milestone, one
 * focal point — much clearer than 30 ticks the student had to
 * decode.
 *
 * Below the bar: a single line that switches based on state:
 *   - Not eligible yet:  "Foundation + Strategy unlock the gate · N days left"
 *   - Eligible:          "Ready to apply for your 30% discount"
 *   - Applied (pending): "Application under review"
 *   - Approved:          "Your 30% code is ready"
 *   - Window closed:     "Discount window closed"
 */
export function DiscountProgressBar({ firstName }: DiscountProgressBarProps) {
  const {
    lessons,
    completedLessonIds,
    discountAllLessonsDone,
    discountMsLeft,
    discountRequest,
  } = useStudent();

  const { gatePercent, totalGateLessons, completedGateLessons } = useMemo(() => {
    const gateLessons = lessons.filter(
      (l) => l.region_id === "r1" || l.region_id === "r2"
    );
    const total = gateLessons.length;
    const completed = gateLessons.filter((l) =>
      completedLessonIds.has(l.id)
    ).length;
    return {
      gatePercent: progressPercent(completed, total),
      totalGateLessons: total,
      completedGateLessons: completed,
    };
  }, [lessons, completedLessonIds]);

  const daysLeft = Math.max(0, Math.ceil(discountMsLeft / 86_400_000));
  const windowClosed = discountMsLeft <= 0 && !discountRequest;

  // Status line state machine
  let statusLine: React.ReactNode;
  if (discountRequest?.status === "approved") {
    statusLine = (
      <span style={{ color: "var(--color-gold-light)" }}>
        Your 30% code is ready{discountRequest.promo_code ? ` · ${discountRequest.promo_code}` : ""}
      </span>
    );
  } else if (discountRequest?.status === "pending") {
    statusLine = (
      <span style={{ color: "var(--color-ink-dim)" }}>
        Application under review
      </span>
    );
  } else if (discountRequest?.status === "rejected") {
    statusLine = (
      <span style={{ color: "var(--color-danger)" }}>
        Application not approved · DM the team in Discord
      </span>
    );
  } else if (windowClosed) {
    statusLine = (
      <span style={{ color: "var(--color-ink-faint)" }}>
        Discount window closed
      </span>
    );
  } else if (discountAllLessonsDone) {
    statusLine = (
      <span style={{ color: "var(--color-gold-light)" }}>
        Ready to apply for your 30% discount
      </span>
    );
  } else {
    statusLine = (
      <span style={{ color: "var(--color-ink-dim)" }}>
        Foundation + Strategy unlock the gate · {daysLeft}d left
      </span>
    );
  }

  return (
    <div
      className="px-6 py-3 flex items-center gap-5"
      style={{ borderTop: "1px solid var(--color-border)" }}
    >
      {/* Greeting (md+ only) */}
      <div className="flex-shrink-0 hidden md:block">
        <p
          style={{
            color: "var(--color-text-primary)",
            fontSize: 13,
            fontWeight: 500,
            lineHeight: 1.2,
            letterSpacing: "-0.005em",
          }}
        >
          Hey, {firstName}
        </p>
        <p
          style={{
            color: "var(--color-text-tertiary)",
            fontSize: 11,
            lineHeight: 1.2,
            fontVariantNumeric: "tabular-nums",
            letterSpacing: "-0.005em",
            marginTop: 2,
          }}
        >
          {completedGateLessons} of {totalGateLessons} to discount
        </p>
      </div>

      {/* The bar */}
      <div className="flex-1">
        <div className="flex items-center gap-3">
          <div
            className="relative flex-1 overflow-hidden"
            style={{
              height: 6,
              borderRadius: 3,
              background: "var(--color-fill-secondary)",
            }}
            aria-label={`${gatePercent}% of the way to the discount gate`}
          >
            {/* Fill */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                width: `${gatePercent}%`,
                background: "var(--color-gold)",
                borderRadius: "inherit",
                transition:
                  "width 400ms cubic-bezier(0.25, 0.1, 0.25, 1)",
              }}
            />
          </div>
          {/* End-of-bar checkpoint marker */}
          <div
            className="flex items-center gap-1.5 shrink-0"
            style={{
              padding: "3px 9px",
              borderRadius: 999,
              background: discountAllLessonsDone
                ? "rgba(200, 157, 85, 0.18)"
                : "var(--color-fill-secondary)",
              border: discountAllLessonsDone
                ? "1px solid rgba(200, 157, 85, 0.45)"
                : "1px solid var(--color-border)",
            }}
            title="The 30% discount gate"
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke={
                discountAllLessonsDone
                  ? "var(--color-gold-light)"
                  : "var(--color-gold)"
              }
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 2 L4 6 v6 c0 5 4 9 8 10 4-1 8-5 8-10 V6 z" />
            </svg>
            <span
              className="font-mono tabular-nums font-semibold"
              style={{
                color: discountAllLessonsDone
                  ? "var(--color-gold-light)"
                  : "var(--color-gold)",
                fontSize: 11,
                letterSpacing: "0.04em",
              }}
            >
              30%
            </span>
          </div>
        </div>
        <p
          style={{
            fontSize: 12,
            lineHeight: 1.4,
            marginTop: 6,
            letterSpacing: "-0.005em",
          }}
        >
          {statusLine}
        </p>
      </div>
    </div>
  );
}
