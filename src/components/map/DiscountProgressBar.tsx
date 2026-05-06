"use client";

import { useMemo } from "react";
import { useStudent } from "@/contexts/StudentContext";
import { progressPercent } from "@/lib/constants";

/**
 * Focal element of the (now single-row) TopBar. Horizontal bar showing
 * progress through every lesson, with the 30% discount marker sitting
 * at the R1+R2 boundary (the "gate"). The milestone has an inline
 * explanation directly underneath so a brand-new student understands
 * what the badge means at a glance.
 *
 * State machine for the status line:
 *   - Pre-eligible:  "30% off month 2 · finish R1 + R2 within Nd"
 *   - Eligible:      "Ready to apply for your 30% discount"
 *   - Pending:       "Application under review"
 *   - Approved:      "Your 30% code is ready · CODE"
 *   - Rejected:      "Application not approved · DM the team in Discord"
 *   - Window closed: "Discount window closed"
 */
export function DiscountProgressBar() {
  const {
    lessons,
    completedLessonIds,
    discountAllLessonsDone,
    discountMsLeft,
    discountRequest,
  } = useStudent();

  const {
    overallPercent,
    overallCompleted,
    overallTotal,
    milestonePercent,
  } = useMemo(() => {
    const total = lessons.length;
    const completed = lessons.filter((l) => completedLessonIds.has(l.id)).length;
    const gateTotal = lessons.filter(
      (l) => l.region_id === "r1" || l.region_id === "r2"
    ).length;
    return {
      overallPercent: progressPercent(completed, total),
      overallCompleted: completed,
      overallTotal: total,
      milestonePercent: total > 0 ? (gateTotal / total) * 100 : 0,
    };
  }, [lessons, completedLessonIds]);

  const daysLeft = Math.max(0, Math.ceil(discountMsLeft / 86_400_000));
  const windowClosed = discountMsLeft <= 0 && !discountRequest;
  const milestoneReached = overallPercent >= milestonePercent;

  let statusLine: React.ReactNode;
  if (discountRequest?.status === "approved") {
    statusLine = (
      <span style={{ color: "var(--color-gold-light)" }}>
        Your 30% code is ready
        {discountRequest.promo_code ? ` · ${discountRequest.promo_code}` : ""}
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
        30% off month 2 · finish R1 + R2 within {daysLeft}d
      </span>
    );
  }

  return (
    <div className="flex items-center gap-4 w-full min-w-0">
      <div className="flex-1 min-w-0">
        {/* Bar with milestone marker. Reserved height keeps the floating
            badge from shifting layout above. */}
        <div
          className="relative"
          style={{ height: 22, display: "flex", alignItems: "center" }}
          aria-label={`${overallPercent}% complete · 30% discount milestone at ${Math.round(milestonePercent)}%`}
        >
          <div
            className="relative w-full overflow-hidden"
            style={{
              height: 6,
              borderRadius: 3,
              background: "var(--color-fill-secondary)",
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                width: `${overallPercent}%`,
                background: "var(--color-gold)",
                borderRadius: "inherit",
                transition:
                  "width 400ms cubic-bezier(0.25, 0.1, 0.25, 1)",
              }}
            />
          </div>

          {/* Milestone tick across the bar */}
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              left: `${milestonePercent}%`,
              top: 0,
              bottom: 0,
              width: 2,
              background: milestoneReached
                ? "var(--color-gold-light)"
                : "rgba(200, 157, 85, 0.55)",
              transform: "translateX(-1px)",
            }}
          />

          {/* 30% badge floating above the milestone */}
          <div
            className="absolute"
            style={{
              left: `${milestonePercent}%`,
              top: -20,
              transform: "translateX(-50%)",
              padding: "2px 8px",
              borderRadius: 999,
              background: milestoneReached
                ? "rgba(200, 157, 85, 0.18)"
                : "var(--color-fill-secondary)",
              border: milestoneReached
                ? "1px solid rgba(200, 157, 85, 0.55)"
                : "1px solid var(--color-border)",
              display: "flex",
              alignItems: "center",
              gap: 4,
              whiteSpace: "nowrap",
              pointerEvents: "none",
            }}
            title="30% off your next month — finish R1 + R2 within 14 days of joining"
          >
            <svg
              width="9"
              height="9"
              viewBox="0 0 24 24"
              fill="none"
              stroke={
                milestoneReached
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
              className="tabular-nums"
              style={{
                color: milestoneReached
                  ? "var(--color-gold-light)"
                  : "var(--color-gold)",
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: "-0.005em",
              }}
            >
              30%
            </span>
          </div>
        </div>

        {/* Inline explainer */}
        <p
          style={{
            fontSize: 12,
            lineHeight: 1.4,
            marginTop: 4,
            letterSpacing: "-0.005em",
          }}
        >
          {statusLine}
        </p>
      </div>

      {/* Compact lesson counter on the right of the bar */}
      <div
        className="shrink-0 hidden md:flex flex-col"
        style={{ alignItems: "flex-end" }}
      >
        <p
          style={{
            color: "var(--color-text-primary)",
            fontSize: 13,
            fontWeight: 600,
            lineHeight: 1.2,
            letterSpacing: "-0.011em",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {overallCompleted}
          <span style={{ color: "var(--color-text-tertiary)", fontWeight: 500 }}>
            {" / "}
            {overallTotal}
          </span>
        </p>
        <p
          style={{
            color: "var(--color-text-tertiary)",
            fontSize: 11,
            lineHeight: 1.2,
            letterSpacing: "-0.005em",
            marginTop: 2,
          }}
        >
          lessons
        </p>
      </div>
    </div>
  );
}
