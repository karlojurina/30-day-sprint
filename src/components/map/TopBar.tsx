"use client";

import { useMemo } from "react";
import type { Dispatch, SetStateAction } from "react";
import Image from "next/image";
import { useAuth } from "@/contexts/AuthContext";
import { useStudent } from "@/contexts/StudentContext";
import { getDayNumber } from "@/types/database";
import { TOTAL_DAYS } from "@/lib/constants";
import { StreakLantern } from "./StreakLantern";
import { ProgressDial } from "./ProgressDial";
import { DiscountCountdown } from "./DiscountCountdown";

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
    overallProgress,
    completedLessonIds,
    lessons,
  } = useStudent();

  const dayNumber = useMemo(
    () => (student ? getDayNumber(student.joined_at) : 1),
    [student]
  );
  const daysLeft = Math.max(0, TOTAL_DAYS - dayNumber);

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
          <StreakLantern current={streak.current} longest={streak.longest} />

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

      {/* Row 2 — Day ruler */}
      <DayRuler
        dayNumber={dayNumber}
        daysLeft={daysLeft}
        regions={regions}
        setPanTarget={setPanTarget}
        lessons={lessons}
        completedLessonIds={completedLessonIds}
        overallProgress={overallProgress}
        firstName={firstName}
      />
    </header>
  );
}

interface DayRulerProps {
  dayNumber: number;
  daysLeft: number;
  regions: ReturnType<typeof useStudent>["regions"];
  setPanTarget: Dispatch<SetStateAction<string | null>>;
  lessons: ReturnType<typeof useStudent>["lessons"];
  completedLessonIds: ReturnType<typeof useStudent>["completedLessonIds"];
  overallProgress: number;
  firstName: string;
}

function DayRuler({
  dayNumber,
  daysLeft,
  regions,
  setPanTarget,
  lessons,
  completedLessonIds,
  overallProgress,
  firstName,
}: DayRulerProps) {
  const daysWithLessons = useMemo(() => {
    const s = new Set<number>();
    for (const l of lessons) s.add(l.day);
    return s;
  }, [lessons]);

  const daysComplete = useMemo(() => {
    const byDay: Record<number, string[]> = {};
    for (const l of lessons) {
      if (!byDay[l.day]) byDay[l.day] = [];
      byDay[l.day].push(l.id);
    }
    const s = new Set<number>();
    for (const [day, ids] of Object.entries(byDay)) {
      if (ids.every((id) => completedLessonIds.has(id))) {
        s.add(Number(day));
      }
    }
    return s;
  }, [lessons, completedLessonIds]);

  // Each day owns 1/TOTAL_DAYS of the ruler width as an invisible click slot,
  // so the 1–2 px tick has a usable hit area on both mouse and touch (the
  // slot widens on bigger viewports, narrows on smaller ones — never below
  // tick-width).
  const slotWidth = 100 / TOTAL_DAYS;

  return (
    <div
      className="relative px-6 py-3 flex items-center gap-6"
      style={{ borderTop: "1px solid rgba(230,192,122,0.12)" }}
    >
      <div className="flex-shrink-0 hidden md:block">
        <p
          className="font-mono uppercase tracking-widest"
          style={{ color: "var(--color-gold)", letterSpacing: "0.18em", fontSize: 11 }}
        >
          Hey, {firstName}
        </p>
        <p
          className="font-mono"
          style={{ color: "var(--color-ink-dim)", fontSize: 12 }}
        >
          {overallProgress}% charted · {daysLeft} days left
        </p>
      </div>

      <div className="flex-1 relative h-8">
        <div className="absolute inset-0 flex rounded-md overflow-hidden" aria-hidden="true">
          {regions.map((r) => {
            const width = ((r.day_end - r.day_start + 1) / TOTAL_DAYS) * 100;
            const colors: Record<string, string> = {
              shore: "rgba(77,160,216,0.1)",
              forest: "rgba(77,206,196,0.12)",
              mountains: "rgba(230,220,200,0.08)",
              city: "rgba(230,192,122,0.12)",
            };
            return (
              <div
                key={r.id}
                style={{
                  width: `${width}%`,
                  background: colors[r.terrain] ?? "transparent",
                }}
                title={r.name}
              />
            );
          })}
        </div>

        {Array.from({ length: TOTAL_DAYS }).map((_, i) => {
          const day = i + 1;
          const slotLeft = i * slotWidth;
          const isMilestone =
            day === 1 || day === 8 || day === 15 || day === 23 || day === 30;
          const hasLesson = daysWithLessons.has(day);
          const isDone = daysComplete.has(day);
          const isCurrent = day === dayNumber;
          // On <md viewports each tick collapses below the 40px touch-target
          // floor, so we mark them inert. Mobile users navigate via lesson
          // taps instead — desktop remains the primary interaction context.
          return (
            <button
              key={day}
              type="button"
              disabled={!hasLesson}
              onClick={() => {
                const l = lessons.find((lesson) => lesson.day === day);
                if (l) setPanTarget(l.id);
              }}
              className="day-ruler-tick absolute top-0 bottom-0 flex items-center justify-center bg-transparent border-0 p-0"
              style={{
                left: `${slotLeft}%`,
                width: `${slotWidth}%`,
                cursor: hasLesson ? "pointer" : "default",
              }}
              aria-label={`Day ${day}${isDone ? ", charted" : hasLesson ? "" : ", no lesson"}`}
            >
              <span className="relative inline-flex items-center justify-center">
                <span
                  aria-hidden="true"
                  style={{
                    display: "block",
                    width: isMilestone ? 2 : 1,
                    height: isMilestone ? 14 : 8,
                    background: isDone
                      ? "var(--color-gold)"
                      : hasLesson
                        ? "rgba(230,220,200,0.78)"
                        : "rgba(230,220,200,0.32)",
                  }}
                />
                {isMilestone && (
                  <span
                    aria-hidden="true"
                    className="absolute font-mono font-semibold"
                    style={{
                      top: 14,
                      left: "50%",
                      transform: "translateX(-50%)",
                      color: "var(--color-ink-dim)",
                      letterSpacing: "0.08em",
                      fontSize: 11,
                    }}
                  >
                    {day}
                  </span>
                )}
                {isCurrent && (
                  <span
                    aria-hidden="true"
                    className="absolute pulse-ring"
                    style={{
                      top: -6,
                      left: "50%",
                      transform: "translateX(-50%)",
                      width: 14,
                      height: 14,
                      background: "var(--color-gold)",
                      borderRadius: "50%",
                      boxShadow: "0 0 14px rgba(230,192,122,0.9)",
                    }}
                  />
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
