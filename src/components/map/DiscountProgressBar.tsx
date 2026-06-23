"use client";

import { useMemo } from "react";
import { useStudent } from "@/contexts/StudentContext";
import { progressPercent, DISCOUNT_WINDOW_DAYS } from "@/lib/constants";

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

  const { overallPercent, milestonePercent } = useMemo(() => {
    const total = lessons.length;
    const completed = lessons.filter((l) => completedLessonIds.has(l.id)).length;
    const gateTotal = lessons.filter(
      (l) => l.region_id === "r1" || l.region_id === "r2"
    ).length;
    return {
      overallPercent: progressPercent(completed, total),
      milestonePercent: total > 0 ? (gateTotal / total) * 100 : 0,
    };
  }, [lessons, completedLessonIds]);

  const milestoneReached = overallPercent >= milestonePercent;

  // Status copy lives in the permanent banner under the TopBar now,
  // so we don't render it here. Variables preserved (discountMsLeft,
  // etc.) only if their values change layout above the bar.
  void discountMsLeft;
  void discountRequest;
  void discountAllLessonsDone;

  return (
    <div
      className="relative w-full min-w-0 flex items-center"
      style={{ height: "100%" }}
      aria-label={`${overallPercent}% complete · 30% discount milestone at ${Math.round(milestonePercent)}%`}
    >
      {/* Bar wrapper — flex-aligned to the vertical center of its
          parent (the 36px shell in TopBar). Badge + status text below
          are absolute-positioned so they don't pull the bar off-center. */}
      <div
        className="relative w-full"
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

          {/* Milestone tick — extends slightly above and below the bar
              so the eye reads it as a single line that the badge below
              hangs off of. */}
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              left: `${milestonePercent}%`,
              top: -3,
              height: 12,
              width: 2,
              background: milestoneReached
                ? "var(--color-gold-light)"
                : "rgba(140, 140, 130, 0.55)",
              transform: "translateX(-1px)",
            }}
          />

          {/* 30% badge BELOW the bar at the milestone position. Hangs
              off the milestone tick. Apple-style: pill with hairline
              border, no shadow, accent color tinted not full-bleed. */}
          <div
            className="absolute"
            style={{
              left: `${milestonePercent}%`,
              top: 12,
              transform: "translateX(-50%)",
              padding: "2px 8px",
              borderRadius: 999,
              background: milestoneReached
                ? "rgba(140, 140, 130, 0.18)"
                : "var(--color-fill-secondary)",
              border: milestoneReached
                ? "1px solid rgba(140, 140, 130, 0.55)"
                : "1px solid var(--color-border)",
              display: "flex",
              alignItems: "center",
              gap: 4,
              whiteSpace: "nowrap",
              pointerEvents: "none",
              lineHeight: 1,
            }}
            title={`30% off your next month — finish R1 + R2 within ${DISCOUNT_WINDOW_DAYS} days of joining`}
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

      {/* Below-bar row removed per user spec — discount status copy
          now lives in the permanent banner under the TopBar. */}
    </div>
  );
}
