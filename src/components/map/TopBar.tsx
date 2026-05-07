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
 * Single-row top bar. Layout (left → right):
 *   brand · current-lesson breadcrumb · [progress bar] · streak · signout
 *
 * The progress bar wrapper is exactly PILL_HEIGHT (36px) tall so it
 * vertically aligns with every other pill. The bar itself sits at
 * the wrapper's vertical center; the milestone badge + status text
 * are absolute-positioned BELOW the wrapper so they don't pull the
 * bar's centerline off the row's centerline. Bottom padding on the
 * row reserves space for that overflow.
 */
export function TopBar({ setPanTarget }: TopBarProps) {
  const { student, signOut } = useAuth();
  const { regions, currentLesson, streak } = useStudent();

  if (!student) return null;

  const currentRegion = currentLesson
    ? regions.find((r) => r.id === currentLesson.region_id)
    : null;

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
        style={{ paddingTop: 12, paddingBottom: 36 }}
      >
        {/* Brand */}
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
            style={{ height: 28, width: 28, objectFit: "contain" }}
          />
        </div>

        {/* Current-lesson breadcrumb */}
        {currentLesson && (
          <button
            onClick={() => setPanTarget(currentLesson.id)}
            className="hidden md:flex items-center shrink-0 transition-colors"
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

        {/* Progress bar — flex-1 with its 30% badge + status text
            absolute-positioned BELOW. The wrapper is PILL_HEIGHT tall
            so the bar's center matches every other pill's center. */}
        <div className="flex-1 min-w-0" style={{ height: PILL_HEIGHT }}>
          <DiscountProgressBar />
        </div>

        {/* Streak */}
        <StreakFlame current={streak.current} longest={streak.longest} />

        {/* Sign out */}
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
    </header>
  );
}
