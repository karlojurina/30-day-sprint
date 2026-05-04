"use client";

import { useMemo } from "react";
import type { Dispatch, SetStateAction } from "react";
import Image from "next/image";
import { useAuth } from "@/contexts/AuthContext";
import { useStudent } from "@/contexts/StudentContext";
import { getDayNumber } from "@/types/database";
import { getTitleLabel } from "@/lib/titles";
import { TOTAL_DAYS } from "@/lib/constants";

interface TopBarProps {
  setPanTarget: Dispatch<SetStateAction<string | null>>;
  onOpenNotebook: () => void;
}

const GOLD_DIM = "rgba(230,192,122,0.7)";

const PILL_HEIGHT = 52; // shared height so every chip/card aligns perfectly

// Shared pill styling used across every topbar chip so they all line up.
const pillBaseStyle: React.CSSProperties = {
  height: PILL_HEIGHT,
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "0 14px",
  borderRadius: 10,
  border: "1px solid rgba(230,192,122,0.28)",
  background: "rgba(16,32,66,0.7)",
};

export function TopBar({ setPanTarget, onOpenNotebook }: TopBarProps) {
  const { student, signOut } = useAuth();
  const {
    regions,
    currentLesson,
    currentTitle,
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
      {/* Row 1 — fixed pill height, everything vertically centered */}
      <div className="flex items-center justify-between gap-3 px-6" style={{ height: 84 }}>
        {/* Brand — square logo + wordmark */}
        <div className="flex items-center gap-3 shrink-0" style={{ height: PILL_HEIGHT }}>
          <Image
            src="/ecomtalent-logo.png"
            alt="EcomTalent"
            width={547}
            height={547}
            priority
            style={{
              height: 40,
              width: 40,
              objectFit: "contain",
            }}
          />
          <div className="hidden sm:block leading-tight">
            <p
              className="italic"
              style={{
                fontFamily: "var(--font-display)",
                color: "var(--color-ink)",
                fontWeight: 500,
                fontSize: 18,
                lineHeight: "20px",
              }}
            >
              EcomTalent
            </p>
            <p
              className="font-mono uppercase"
              style={{
                color: GOLD_DIM,
                letterSpacing: "0.2em",
                fontSize: 10,
              }}
            >
              Expedition
            </p>
          </div>
        </div>

        {/* Breadcrumb — same pill height as badges on the right */}
        {currentLesson && currentRegion && (
          <button
            onClick={() => setPanTarget(currentLesson.id)}
            className="btn-pill-deep hidden md:flex items-center gap-3 flex-1 min-w-0"
            style={{
              ...pillBaseStyle,
              maxWidth: 560,
              padding: "0 16px",
            }}
          >
            <div className="flex-1 min-w-0 text-left leading-tight overflow-hidden">
              <p
                className="font-mono uppercase tracking-widest truncate"
                style={{
                  color: GOLD_DIM,
                  letterSpacing: "0.18em",
                  fontSize: 11,
                  lineHeight: "13px",
                }}
              >
                Day {dayNumber} · {currentRegion.name}
              </p>
              <p
                className="italic truncate"
                style={{
                  fontFamily: "var(--font-display)",
                  color: "var(--color-ink)",
                  fontWeight: 500,
                  fontSize: 18,
                  lineHeight: "22px",
                }}
              >
                {currentLesson.title}
              </p>
            </div>
            {currentLesson.duration_label && (
              <span
                className="font-mono shrink-0 rounded"
                style={{
                  background: "rgba(230,192,122,0.15)",
                  color: "var(--color-gold)",
                  fontSize: 11,
                  letterSpacing: "0.08em",
                  padding: "4px 8px",
                }}
              >
                {currentLesson.duration_label}
              </span>
            )}
          </button>
        )}

        {/* Right cluster — all chips share the same PILL_HEIGHT */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Streak */}
          {streak.current > 0 && (
            <div
              style={{
                ...pillBaseStyle,
                background: "rgba(230,192,122,0.14)",
                boxShadow:
                  streak.current >= 7
                    ? "0 0 16px rgba(230,192,122,0.3)"
                    : "none",
              }}
              title={`${streak.current}-day streak · longest: ${streak.longest}`}
              aria-label={`${streak.current}-day streak, longest ${streak.longest}`}
            >
              <span style={{ fontSize: 18, lineHeight: 1 }} aria-hidden="true">🔥</span>
              <span
                className="font-mono tabular-nums font-bold"
                style={{ color: "var(--color-gold-light)", fontSize: 16 }}
              >
                {streak.current}
              </span>
            </div>
          )}

          {/* Rank */}
          <div
            style={pillBaseStyle}
            title={`Current rank: ${getTitleLabel(currentTitle)}`}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="var(--color-gold)" aria-hidden="true">
              <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8l-6.2 4.5 2.4-7.4L2 9.4h7.6z" />
            </svg>
            <span
              className="italic whitespace-nowrap"
              style={{
                fontFamily: "var(--font-display)",
                color: "var(--color-ink)",
                fontWeight: 500,
                fontSize: 16,
              }}
            >
              {getTitleLabel(currentTitle)}
            </span>
          </div>

          {/* Notebook */}
          <button
            onClick={onOpenNotebook}
            className="btn-pill-deep"
            style={{
              ...pillBaseStyle,
              cursor: "pointer",
              color: "var(--color-ink)",
            }}
            title="Your notebook"
            aria-label="Open notebook"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
              />
            </svg>
            <span
              className="hidden lg:inline font-mono uppercase"
              style={{
                fontSize: 11,
                letterSpacing: "0.16em",
              }}
            >
              Notes
            </span>
          </button>

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
              padding: "0 14px",
            }}
            title="Sign out"
          >
            <span
              className="font-mono uppercase"
              style={{ fontSize: 11, letterSpacing: "0.16em" }}
            >
              Sign out
            </span>
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
