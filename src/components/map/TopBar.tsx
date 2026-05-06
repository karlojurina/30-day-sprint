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
        background: "rgba(15, 17, 21, 0.85)",
        backdropFilter: "blur(20px) saturate(140%)",
        WebkitBackdropFilter: "blur(20px) saturate(140%)",
        borderBottom: "1px solid var(--color-border)",
      }}
    >
      {/* Row 1 — 60px header. Focal point is the breadcrumb in the
          middle (next task), flanked by progress + streak. */}
      <div
        className="flex items-center justify-between gap-4 px-6"
        style={{ height: 60 }}
      >
        {/* Brand — just the logo. */}
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
              height: 28,
              width: 28,
              objectFit: "contain",
            }}
          />
        </div>

        {/* Breadcrumb — Inter title. The TopBar is one thing now:
            'what to do next.' Italic Cormorant retired. */}
        {currentLesson && (
          <button
            onClick={() => setPanTarget(currentLesson.id)}
            className="hidden md:flex items-center flex-1 min-w-0 justify-center transition-colors"
            style={{
              gap: 10,
              maxWidth: 560,
              padding: "0 14px",
              height: PILL_HEIGHT,
              borderRadius: 10,
              border: "1px solid var(--color-border)",
              background: "var(--color-fill-secondary)",
              cursor: "pointer",
            }}
            title={
              currentRegion
                ? `Day ${dayNumber} · ${currentRegion.name} · ${currentLesson.title}`
                : currentLesson.title
            }
          >
            <span
              className="truncate"
              style={{
                color: "var(--color-text-primary)",
                fontWeight: 600,
                fontSize: 14,
                letterSpacing: "-0.011em",
                lineHeight: 1,
              }}
            >
              {currentLesson.title}
            </span>
            {currentLesson.duration_label && (
              <span
                className="shrink-0"
                style={{
                  color: "var(--color-text-tertiary)",
                  fontSize: 12,
                  fontVariantNumeric: "tabular-nums",
                  letterSpacing: "-0.005em",
                  fontWeight: 500,
                }}
              >
                {currentLesson.duration_label}
              </span>
            )}
          </button>
        )}

        {/* Right cluster — progress dial + discount countdown + streak
            flame + sign out. Discount countdown auto-hides when window
            closes or student has applied. */}
        <div className="flex items-center gap-2 shrink-0">
          <ProgressDial completed={completedLessonIds.size} size={44} />
          <DiscountCountdown />
          <StreakFlame current={streak.current} longest={streak.longest} />

          {/* Sign out */}
          <button
            onClick={signOut}
            style={{
              ...pillBaseStyle,
              border: "1px solid var(--color-border)",
              background: "transparent",
              color: "var(--color-text-tertiary)",
              cursor: "pointer",
              padding: "0 10px",
              transition: "all 150ms cubic-bezier(0.25,0.1,0.25,1)",
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
              strokeWidth="1.7"
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

