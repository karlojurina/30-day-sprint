"use client";

import { useMemo } from "react";
import { useStudent } from "@/contexts/StudentContext";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Slim ribbon under the TopBar that gives a returning student
 * something to land on. Three signals, in priority order:
 *
 *   1. Discount window urgency — if the student is eligible OR
 *      within their 14-day window and hasn't claimed yet, surface
 *      "discount window: N days left".
 *   2. Last completion — "You charted Day X · {title} {when}"
 *      where `when` is "today" / "yesterday" / "Mon" / etc.
 *   3. Welcome ping for new students — "Day 1 begins below."
 *
 * All copy stays mono-caps + italic for the names. No emojis.
 * No "let's go!" or "welcome back champion" — direct, mentor tone.
 */
export function RecentActivityRibbon() {
  const { student } = useAuth();
  const { lessons, completions, discountEligible, discountRequest } =
    useStudent();

  const lastCompletion = useMemo(() => {
    if (!completions.length) return null;
    // Find the most recent completion timestamp across both kinds
    let bestTime = 0;
    let bestLessonId: string | null = null;
    for (const c of completions) {
      const candidate = Math.max(
        c.completed_at ? new Date(c.completed_at).getTime() : 0,
        c.action_completed_at
          ? new Date(c.action_completed_at).getTime()
          : 0
      );
      if (candidate > bestTime) {
        bestTime = candidate;
        bestLessonId = c.lesson_id;
      }
    }
    if (!bestLessonId || !bestTime) return null;
    const lesson = lessons.find((l) => l.id === bestLessonId);
    if (!lesson) return null;
    return { lesson, when: bestTime };
  }, [completions, lessons]);

  const discountDaysLeft = useMemo(() => {
    if (!student) return 0;
    const joined = new Date(student.joined_at).getTime();
    const deadline = joined + 14 * 86_400_000;
    return Math.max(0, Math.ceil((deadline - Date.now()) / 86_400_000));
  }, [student]);

  if (!student) return null;

  // Compose the message — discount urgency wins when it applies and
  // the student hasn't already claimed.
  const showDiscountPing =
    !discountRequest && discountDaysLeft > 0 && discountDaysLeft <= 14;

  let line: React.ReactNode = null;

  if (discountEligible && !discountRequest) {
    line = (
      <span>
        <em style={italicLabel}>Discount window&apos;s open</em>
        <span style={dot}>·</span>
        Claim it before the gate closes.
      </span>
    );
  } else if (lastCompletion) {
    line = (
      <span>
        Last charted&nbsp;
        <em style={italicLabel}>Day {lastCompletion.lesson.day}</em>
        <span style={dot}>·</span>
        <em style={italicLabel}>{lastCompletion.lesson.title}</em>
        <span style={dot}>·</span>
        {formatRelative(lastCompletion.when)}
        {showDiscountPing && (
          <>
            <span style={dot}>·</span>
            {discountDaysLeft} {discountDaysLeft === 1 ? "day" : "days"} to discount
          </>
        )}
      </span>
    );
  } else {
    line = (
      <span>
        <em style={italicLabel}>Day 1 begins below</em>
        <span style={dot}>·</span>
        Pick the first node and start charting.
      </span>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        height: 28,
        padding: "0 24px",
        display: "flex",
        alignItems: "center",
        background: "rgba(6,12,26,0.5)",
        borderBottom: "1px solid rgba(230,192,122,0.1)",
        color: "rgba(230,220,200,0.62)",
        fontFamily: "var(--font-display)",
        fontStyle: "italic",
        fontSize: 13,
        letterSpacing: "0.005em",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {line}
    </div>
  );
}

const italicLabel: React.CSSProperties = {
  color: "var(--color-gold-light)",
  fontStyle: "italic",
};

const dot: React.CSSProperties = {
  margin: "0 8px",
  color: "rgba(230,192,122,0.4)",
  fontStyle: "normal",
};

function formatRelative(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 0) return "just now";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr === 1 ? "an hour ago" : `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "yesterday";
  if (day < 7) return `${day} days ago`;
  // Older than a week — show short weekday
  return new Date(ms).toLocaleDateString(undefined, { weekday: "short" });
}
