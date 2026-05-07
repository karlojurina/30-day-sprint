"use client";

import type { Dispatch, SetStateAction } from "react";
import Image from "next/image";
import { useAuth } from "@/contexts/AuthContext";
import { useStudent } from "@/contexts/StudentContext";
import { getDayNumber } from "@/types/database";
import { StreakFlame } from "./StreakFlame";
import { DiscountProgressBar } from "./DiscountProgressBar";

interface TopBarProps {
  setPanTarget: Dispatch<SetStateAction<string | null>>;
}

const PILL_HEIGHT = 36;

/**
 * Single-row top bar. The discount progress bar is the focal element,
 * centered in the available width. Left/right clusters mirror in
 * weight so the bar reads as the page's center of gravity.
 *
 * Left cluster:  brand + Day-of-program chip
 * Center:        discount progress bar (focal)
 * Right cluster: streak + signout
 *
 * The current-lesson breadcrumb pill was retired — the bar's status
 * line and the highlighted current lesson on the map already
 * communicate "what to do next." Two surfaces saying the same thing
 * created visual competition and pushed the bar off-center.
 */
export function TopBar({ setPanTarget }: TopBarProps) {
  void setPanTarget;
  const { student, signOut } = useAuth();
  const { streak } = useStudent();

  if (!student) return null;

  const dayNumber = getDayNumber(student.joined_at);

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
        style={{ minHeight: 76, paddingTop: 12, paddingBottom: 16 }}
      >
        {/* Left cluster — brand + Day chip */}
        <div className="flex items-center shrink-0" style={{ gap: 12 }}>
          <Image
            src="/ecomtalent-logo.png"
            alt="EcomTalent"
            width={547}
            height={547}
            priority
            style={{ height: 28, width: 28, objectFit: "contain" }}
          />
          <div
            className="hidden md:flex items-center"
            style={{
              height: PILL_HEIGHT,
              padding: "0 12px",
              borderRadius: 999,
              border: "1px solid var(--color-border)",
              background: "var(--color-fill-secondary)",
              gap: 6,
            }}
            title={`Day ${dayNumber} of 30`}
            aria-label={`Day ${dayNumber} of 30`}
          >
            <span
              style={{
                color: "var(--color-text-tertiary)",
                fontSize: 11,
                fontWeight: 500,
                letterSpacing: "-0.005em",
              }}
            >
              Day
            </span>
            <span
              className="tabular-nums"
              style={{
                color: "var(--color-text-primary)",
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: "-0.011em",
              }}
            >
              {dayNumber}
              <span style={{ color: "var(--color-text-tertiary)", fontWeight: 500 }}>
                {" / 30"}
              </span>
            </span>
          </div>
        </div>

        {/* Focal element — discount progress bar */}
        <div className="flex-1 min-w-0">
          <DiscountProgressBar />
        </div>

        {/* Right cluster — streak + signout */}
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
