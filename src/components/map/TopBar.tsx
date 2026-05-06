"use client";

import { useMemo } from "react";
import type { Dispatch, SetStateAction } from "react";
import Image from "next/image";
import { useAuth } from "@/contexts/AuthContext";
import { useStudent } from "@/contexts/StudentContext";
import { getDayNumber } from "@/types/database";
import { StreakFlame } from "./StreakFlame";
import { ProgressDial } from "./ProgressDial";
import { DiscountCountdown } from "./DiscountCountdown";
import { DiscountProgressBar } from "./DiscountProgressBar";

interface TopBarProps {
  setPanTarget: Dispatch<SetStateAction<string | null>>;
}

const PILL_HEIGHT = 36; // shared height so every topbar pill aligns perfectly

// Shared pill styling used across every topbar chip so they all line up.
const pillBaseStyle: React.CSSProperties = {
  height: PILL_HEIGHT,
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "0 12px",
  borderRadius: 8,
  border: "1px solid rgba(230,192,122,0.28)",
  background: "rgba(16,32,66,0.6)",
};

export function TopBar({ setPanTarget }: TopBarProps) {
  const { student, signOut } = useAuth();
  const {
    regions,
    currentLesson,
    streak,
    completedLessonIds,
  } = useStudent();

  const dayNumber = useMemo(
    () => (student ? getDayNumber(student.joined_at) : 1),
    [student]
  );

  if (!student) return null;

  const currentRegion = currentLesson
    ? regions.find((r) => r.id === currentLesson.region_id)
    : null;

  const firstName = student.name?.split(" ")[0] || "Explorer";

  return (
    <header
      className="relative shrink-0 z-30"
      style={{
        background: "rgba(6,12,26,0.9)",
        backdropFilter: "blur(14px)",
        borderBottom: "1px solid rgba(230,192,122,0.18)",
      }}
    >
      {/* Row 1 — slim 64px header. Focal point is the breadcrumb in the
          middle (next task) flanked by progress + streak. */}
      <div
        className="flex items-center justify-between gap-3 px-6"
        style={{ height: 64 }}
      >
        {/* Brand — just the logo. Wordmark dropped; the brand is in
            the experience, not the chrome. */}
        <div
          className="flex items-center shrink-0"
          style={{ height: PILL_HEIGHT }}
        >
          <Image
            src="/ecomtalent-logo.png"
            alt="EcomTalent"
            width={547}
            height={547}
            priority
            style={{
              height: 32,
              width: 32,
              objectFit: "contain",
            }}
          />
        </div>

        {/* Breadcrumb — italic title only. The TopBar is one thing now:
            "what to do next." */}
        {currentLesson && (
          <button
            onClick={() => setPanTarget(currentLesson.id)}
            className="btn-pill-deep hidden md:flex items-center gap-3 flex-1 min-w-0 justify-center"
            style={{
              ...pillBaseStyle,
              maxWidth: 560,
              padding: "0 16px",
              height: PILL_HEIGHT,
            }}
            title={
              currentRegion
                ? `Day ${dayNumber} · ${currentRegion.name} · ${currentLesson.title}`
                : currentLesson.title
            }
          >
            <span
              className="italic truncate text-center"
              style={{
                fontFamily: "var(--font-display)",
                color: "var(--color-ink)",
                fontWeight: 500,
                fontSize: 16,
                lineHeight: 1,
              }}
            >
              {currentLesson.title}
            </span>
            {currentLesson.duration_label && (
              <span
                className="font-mono shrink-0"
                style={{
                  color: "var(--color-gold)",
                  fontSize: 10,
                  letterSpacing: "0.12em",
                  opacity: 0.75,
                  textTransform: "uppercase",
                }}
              >
                {currentLesson.duration_label}
              </span>
            )}
          </button>
        )}

        {/* Right cluster — progress dial + discount countdown + streak
            lantern + sign out. Discount countdown auto-hides when
            window closes or student has applied. */}
        <div className="flex items-center gap-2 shrink-0">
          <ProgressDial completed={completedLessonIds.size} size={36} />
          <DiscountCountdown />
          <StreakFlame current={streak.current} longest={streak.longest} />

          {/* Sign out */}
          <button
            onClick={signOut}
            className="btn-ghost"
            style={{
              ...pillBaseStyle,
              border: "1px solid rgba(230,192,122,0.18)",
              background: "transparent",
              color: "var(--color-ink-dim)",
              cursor: "pointer",
              padding: "0 12px",
            }}
            title="Sign out"
            aria-label="Sign out"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Row 2 — single horizontal bar to the discount checkpoint */}
      <DiscountProgressBar firstName={firstName} />
    </header>
  );
}

