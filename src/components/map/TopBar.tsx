"use client";

import type { Dispatch, SetStateAction } from "react";
import Image from "next/image";
import { useAuth } from "@/contexts/AuthContext";
import { useStudent } from "@/contexts/StudentContext";
import { LESSON_GROUPS, lessonGroupOf } from "@/lib/constants";
import { StreakFlame } from "./StreakFlame";
import { DiscountProgressBar } from "./DiscountProgressBar";

interface TopBarProps {
  setPanTarget: Dispatch<SetStateAction<string | null>>;
}

const PILL_HEIGHT = 36;

/**
 * Single-row top bar. Was two rows (breadcrumb + progress dial pill +
 * countdown pill on row 1, progress bar on row 2). Now everything
 * collapses around the bar so there's exactly one focal point:
 *   brand · current lesson · discount progress bar · streak · signout
 *
 * Dropped:
 *   - "Hey {name}" greeting (streak is a better personal anchor)
 *   - ProgressDial (the bar already shows progress)
 *   - DiscountCountdown pill (countdown lives in the bar's status line)
 */
export function TopBar({ setPanTarget }: TopBarProps) {
  const { student, signOut } = useAuth();
  const { regions, currentLesson, streak } = useStudent();

  if (!student) return null;

  const currentRegion = currentLesson
    ? regions.find((r) => r.id === currentLesson.region_id)
    : null;

  // If the current lesson belongs to a group, show the group's title
  // in the breadcrumb so it matches what the student sees on the map.
  const currentGroupId = currentLesson ? lessonGroupOf(currentLesson.id) : null;
  const breadcrumbTitle = currentGroupId
    ? LESSON_GROUPS[currentGroupId]?.title ?? currentLesson?.title
    : currentLesson?.title;
  const breadcrumbDuration = currentGroupId ? null : currentLesson?.duration_label;

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
      <div
        className="flex items-center gap-4 px-6"
        style={{ minHeight: 64, paddingTop: 12, paddingBottom: 10 }}
      >
        {/* Brand — just the logo */}
        <div className="flex items-center shrink-0" style={{ height: PILL_HEIGHT }}>
          <Image
            src="/ecomtalent-logo.png"
            alt="EcomTalent"
            width={547}
            height={547}
            priority
            style={{ height: 28, width: 28, objectFit: "contain" }}
          />
        </div>

        {/* Current lesson breadcrumb — narrower than before so the bar
            gets the room. Hidden on tablet to save horizontal space. */}
        {currentLesson && (
          <button
            onClick={() => setPanTarget(currentLesson.id)}
            className="hidden lg:flex items-center shrink-0 transition-colors"
            style={{
              gap: 8,
              maxWidth: 320,
              minWidth: 0,
              padding: "0 12px",
              height: PILL_HEIGHT,
              borderRadius: 10,
              border: "1px solid var(--color-border)",
              background: "var(--color-fill-secondary)",
              cursor: "pointer",
            }}
            title={
              currentRegion
                ? `${currentRegion.name} · ${breadcrumbTitle}`
                : breadcrumbTitle
            }
          >
            <span
              className="truncate"
              style={{
                color: "var(--color-text-primary)",
                fontWeight: 600,
                fontSize: 13,
                letterSpacing: "-0.011em",
                lineHeight: 1,
              }}
            >
              {breadcrumbTitle}
            </span>
            {breadcrumbDuration && (
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
                {breadcrumbDuration}
              </span>
            )}
          </button>
        )}

        {/* Focal element — the discount progress bar takes the rest of
            the width. Internal layout (label, milestone, countdown) is
            handled inside the component. */}
        <div className="flex-1 min-w-0">
          <DiscountProgressBar />
        </div>

        {/* Right cluster — streak + signout. Compact pair. */}
        <div className="flex items-center gap-2 shrink-0">
          <StreakFlame current={streak.current} longest={streak.longest} />
          <button
            onClick={signOut}
            style={{
              height: PILL_HEIGHT,
              padding: "0 10px",
              borderRadius: 8,
              border: "1px solid var(--color-border)",
              background: "transparent",
              color: "var(--color-text-tertiary)",
              cursor: "pointer",
              transition: "all 150ms cubic-bezier(0.25,0.1,0.25,1)",
              display: "flex",
              alignItems: "center",
              gap: 8,
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
    </header>
  );
}
