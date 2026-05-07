"use client";

import { useEffect, useState } from "react";
import { useStudent } from "@/contexts/StudentContext";

/**
 * Single-line urgency banner that slides down from beneath the TopBar
 * on every page load, sits for 5 seconds, then slides away. Frames
 * the discount window as a deadline so the student feels it without
 * needing to read the small print under the progress bar.
 *
 * Visibility rules:
 *   - Only fires when there's an active, unredeemed discount window
 *     (no request yet, days remaining > 0, R1 + R2 not all done — i.e.
 *     the student still has work to do AND still has time to do it)
 *   - Auto-dismisses after 5s with a slide-up + fade out
 *   - Click dismisses early
 *
 * Color escalates as the deadline approaches:
 *   - >7 days   → calm gold
 *   - 3-7 days  → warmer gold (gentle nudge)
 *   - ≤2 days   → crimson tinge (real urgency)
 */
export function DiscountUrgencyBanner() {
  const { discountMsLeft, discountRequest, discountAllLessonsDone } = useStudent();
  const [visible, setVisible] = useState(false);

  const daysLeft = Math.max(0, Math.ceil(discountMsLeft / 86_400_000));
  const isActive =
    !discountRequest && !discountAllLessonsDone && discountMsLeft > 0;

  // Show on mount when active, then auto-hide after 5s.
  useEffect(() => {
    if (!isActive) return;
    setVisible(true);
    const t = window.setTimeout(() => setVisible(false), 5000);
    return () => window.clearTimeout(t);
  }, [isActive]);

  if (!isActive) return null;

  const tone =
    daysLeft <= 2
      ? "crimson"
      : daysLeft <= 7
        ? "warm"
        : "calm";

  // Tone palette — all gold-family except crimson which signals "real"
  // urgency for the final 48 hours.
  const palette =
    tone === "crimson"
      ? {
          bg: "rgba(180, 64, 60, 0.18)",
          border: "rgba(220, 96, 96, 0.42)",
          text: "rgba(255, 220, 220, 0.92)",
          accent: "#F08080",
        }
      : tone === "warm"
        ? {
            bg: "rgba(212, 162, 76, 0.16)",
            border: "rgba(230, 192, 122, 0.40)",
            text: "rgba(255, 240, 210, 0.94)",
            accent: "var(--color-gold-light)",
          }
        : {
            bg: "rgba(200, 157, 85, 0.10)",
            border: "rgba(200, 157, 85, 0.28)",
            text: "rgba(255, 247, 235, 0.88)",
            accent: "var(--color-gold)",
          };

  return (
    <div
      onClick={() => setVisible(false)}
      role="status"
      aria-live="polite"
      style={{
        position: "absolute",
        top: 0,
        left: "50%",
        transform: visible
          ? "translate(-50%, 0)"
          : "translate(-50%, -120%)",
        transition:
          "transform 480ms cubic-bezier(0.22, 1, 0.36, 1), opacity 480ms cubic-bezier(0.22, 1, 0.36, 1)",
        opacity: visible ? 1 : 0,
        zIndex: 25,
        marginTop: 12,
        padding: "10px 22px",
        borderRadius: 999,
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        backdropFilter: "blur(20px) saturate(140%)",
        WebkitBackdropFilter: "blur(20px) saturate(140%)",
        boxShadow:
          "0 8px 24px rgba(0,0,0,0.32), 0 1px 0 rgba(255,255,255,0.04) inset",
        color: palette.text,
        cursor: "pointer",
        userSelect: "none",
        whiteSpace: "nowrap",
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke={palette.accent}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        <polyline points="12 7 12 12 15 15" />
      </svg>
      <span
        style={{
          fontSize: 14,
          fontWeight: 500,
          letterSpacing: "-0.011em",
        }}
      >
        <span
          className="tabular-nums"
          style={{ color: palette.accent, fontWeight: 700 }}
        >
          {daysLeft} {daysLeft === 1 ? "day" : "days"} left
        </span>
        {" "}to earn your{" "}
        <span style={{ color: palette.accent, fontWeight: 700 }}>30% discount</span>
      </span>
    </div>
  );
}
