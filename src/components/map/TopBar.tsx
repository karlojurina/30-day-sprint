"use client";

import { useMemo } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useStudent } from "@/contexts/StudentContext";
import { getDayNumber } from "@/types/database";
import { getTitleLabel } from "@/lib/titles";
import { TOTAL_DAYS } from "@/lib/constants";

interface TopBarProps {
  setPanTarget: Dispatch<SetStateAction<string | null>>;
  onOpenNotebook: () => void;
}

const GOLD = "#E6C07A";
const GOLD_DIM = "rgba(230,192,122,0.5)";

/**
 * Top bar: two rows — brand + current-lesson breadcrumb on top,
 * day ruler with region bands + current-day pin below.
 */
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
      className="absolute top-0 left-0 right-0 z-30"
      style={{
        background: "rgba(6,12,26,0.85)",
        backdropFilter: "blur(12px)",
        borderBottom: "1px solid rgba(230,192,122,0.12)",
      }}
    >
      {/* Row 1 — brand + breadcrumb + actions */}
      <div className="flex items-center justify-between px-6 py-3 gap-4">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center"
              style={{
                background: "rgba(230,192,122,0.12)",
                border: "1px solid rgba(230,192,122,0.32)",
              }}
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill={GOLD}>
                <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8l-6.2 4.5 2.4-7.4L2 9.4h7.6z" />
              </svg>
            </div>
            <div className="hidden sm:block">
              <p
                className="text-[11px] font-mono tracking-widest uppercase"
                style={{ color: GOLD_DIM }}
              >
                EcomTalent
              </p>
              <p
                className="text-[15px] italic font-medium"
                style={{ fontFamily: "Cormorant Garamond, serif" }}
              >
                Expedition
              </p>
            </div>
          </div>
        </div>

        {/* Breadcrumb (current lesson) */}
        {currentLesson && currentRegion && (
          <button
            onClick={() => setPanTarget(currentLesson.id)}
            className="hidden md:flex items-center gap-3 px-4 py-2 rounded-xl transition-colors"
            style={{
              background: "rgba(16,32,66,0.7)",
              border: "1px solid rgba(230,192,122,0.25)",
            }}
          >
            <div>
              <p
                className="text-[10px] font-mono tracking-widest uppercase text-left"
                style={{ color: GOLD_DIM }}
              >
                Day {dayNumber} · {currentRegion.name.toUpperCase()}
              </p>
              <p
                className="italic text-[16px] leading-tight text-left"
                style={{
                  fontFamily: "Cormorant Garamond, serif",
                  color: "#E6DCC8",
                }}
              >
                {currentLesson.title}
              </p>
            </div>
            {currentLesson.duration_label && (
              <span
                className="font-mono text-[10px] px-2 py-0.5 rounded"
                style={{
                  background: "rgba(230,192,122,0.12)",
                  color: GOLD,
                  letterSpacing: "0.08em",
                }}
              >
                {currentLesson.duration_label}
              </span>
            )}
          </button>
        )}

        {/* Actions */}
        <div className="flex items-center gap-4">
          {/* Streak */}
          {streak.current > 0 && (
            <div
              className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-md"
              style={{
                background: "rgba(230,192,122,0.08)",
                border: "1px solid rgba(230,192,122,0.2)",
              }}
            >
              <span className="text-[13px]">🔥</span>
              <span
                className="font-mono text-[11px] font-semibold"
                style={{ color: GOLD }}
              >
                {streak.current}
              </span>
            </div>
          )}

          {/* Title */}
          <span
            className="hidden md:inline-flex font-mono text-[10px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded"
            style={{
              color: GOLD,
              background: "rgba(230,192,122,0.1)",
              border: "1px solid rgba(230,192,122,0.2)",
              letterSpacing: "0.14em",
            }}
          >
            {getTitleLabel(currentTitle)}
          </span>

          {/* Notebook */}
          <button
            onClick={onOpenNotebook}
            className="font-mono text-[11px] uppercase tracking-widest transition-colors"
            style={{ color: "rgba(230,220,200,0.62)", letterSpacing: "0.14em" }}
            title="Your notebook"
          >
            <span className="hover:text-[#E6DCC8]">Notes</span>
          </button>

          {/* Day countdown */}
          <span
            className="hidden lg:inline-flex font-mono text-[11px] uppercase tracking-widest"
            style={{ color: "rgba(230,220,200,0.62)", letterSpacing: "0.14em" }}
          >
            {daysLeft} days left
          </span>

          {/* Sign out */}
          <button
            onClick={signOut}
            className="font-mono text-[11px] uppercase tracking-widest transition-colors"
            style={{ color: "rgba(230,220,200,0.42)", letterSpacing: "0.14em" }}
          >
            <span className="hover:text-[#E6DCC8]">Sign out</span>
          </button>
        </div>
      </div>

      {/* Row 2 — Day ruler */}
      <DayRuler
        dayNumber={dayNumber}
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
  regions: ReturnType<typeof useStudent>["regions"];
  setPanTarget: Dispatch<SetStateAction<string | null>>;
  lessons: ReturnType<typeof useStudent>["lessons"];
  completedLessonIds: ReturnType<typeof useStudent>["completedLessonIds"];
  overallProgress: number;
  firstName: string;
}

function DayRuler({
  dayNumber,
  regions,
  setPanTarget,
  lessons,
  completedLessonIds,
  overallProgress,
  firstName,
}: DayRulerProps) {
  // Which day has a lesson?
  const daysWithLessons = useMemo(() => {
    const s = new Set<number>();
    for (const l of lessons) s.add(l.day);
    return s;
  }, [lessons]);

  // Which days are fully complete (all lessons on that day done)?
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

  return (
    <div
      className="relative px-6 py-2 flex items-center gap-4"
      style={{ borderTop: "1px solid rgba(230,192,122,0.08)" }}
    >
      <div className="flex-shrink-0 hidden md:block">
        <p
          className="text-[10px] font-mono uppercase tracking-widest"
          style={{ color: GOLD_DIM, letterSpacing: "0.16em" }}
        >
          Hey, {firstName}
        </p>
        <p className="text-[11px] font-mono" style={{ color: "rgba(230,220,200,0.62)" }}>
          {overallProgress}% charted
        </p>
      </div>

      <div className="flex-1 relative h-6">
        {/* Region bands */}
        <div className="absolute inset-0 flex">
          {regions.map((r) => {
            const width = ((r.day_end - r.day_start + 1) / TOTAL_DAYS) * 100;
            const colors: Record<string, string> = {
              shore: "rgba(77,160,216,0.07)",
              forest: "rgba(77,206,196,0.08)",
              mountains: "rgba(230,220,200,0.06)",
              city: "rgba(230,192,122,0.08)",
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

        {/* Tick marks */}
        {Array.from({ length: TOTAL_DAYS }).map((_, i) => {
          const day = i + 1;
          const left = ((day - 0.5) / TOTAL_DAYS) * 100;
          const isMilestone =
            day === 1 || day === 8 || day === 15 || day === 23 || day === 30;
          const hasLesson = daysWithLessons.has(day);
          const isDone = daysComplete.has(day);
          const isCurrent = day === dayNumber;
          return (
            <div
              key={day}
              onClick={() => {
                const l = lessons.find((lesson) => lesson.day === day);
                if (l) setPanTarget(l.id);
              }}
              className="absolute top-1/2 -translate-y-1/2 cursor-pointer group"
              style={{ left: `${left}%` }}
            >
              <div
                style={{
                  width: isMilestone ? 2 : 1,
                  height: isMilestone ? 10 : 6,
                  background: isDone
                    ? GOLD
                    : hasLesson
                      ? "rgba(230,220,200,0.62)"
                      : "rgba(230,220,200,0.22)",
                  marginLeft: -1,
                }}
              />
              {isMilestone && (
                <span
                  className="absolute font-mono text-[9px] mt-1"
                  style={{
                    top: 10,
                    left: "50%",
                    transform: "translateX(-50%)",
                    color: "rgba(230,220,200,0.42)",
                    letterSpacing: "0.08em",
                  }}
                >
                  {day}
                </span>
              )}
              {/* Current-day pin (pulsing) */}
              {isCurrent && (
                <div
                  className="absolute pulse-ring"
                  style={{
                    top: -4,
                    left: 0,
                    transform: "translateX(-50%)",
                    width: 10,
                    height: 10,
                    background: GOLD,
                    borderRadius: "50%",
                    boxShadow: "0 0 10px rgba(230,192,122,0.8)",
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
