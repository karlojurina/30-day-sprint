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

const GOLD = "#E6C07A";
const GOLD_HI = "#F0D595";
const GOLD_DIM = "rgba(230,192,122,0.62)";

/**
 * Top bar: two rows — brand + current-lesson breadcrumb + prominent streak/rank,
 * and the 30-day ruler below with region bands.
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
        background: "rgba(6,12,26,0.9)",
        backdropFilter: "blur(14px)",
        borderBottom: "1px solid rgba(230,192,122,0.18)",
      }}
    >
      {/* Row 1 — brand + breadcrumb + stats */}
      <div className="flex items-center justify-between px-6 py-4 gap-4">
        {/* Brand (EcomTalent logo) */}
        <div className="flex items-center gap-3 shrink-0">
          <Image
            src="/ecomtalent-logo.png"
            alt="EcomTalent"
            width={160}
            height={40}
            priority
            style={{
              height: 28,
              width: "auto",
              objectFit: "contain",
            }}
          />
        </div>

        {/* Breadcrumb (current lesson) */}
        {currentLesson && currentRegion && (
          <button
            onClick={() => setPanTarget(currentLesson.id)}
            className="hidden md:flex items-center gap-4 px-5 py-3 rounded-xl transition-colors flex-1 max-w-2xl"
            style={{
              background: "rgba(16,32,66,0.75)",
              border: "1px solid rgba(230,192,122,0.3)",
            }}
          >
            <div className="flex-1 min-w-0">
              <p
                className="text-[11px] font-mono tracking-widest uppercase text-left mb-1"
                style={{ color: GOLD_DIM, letterSpacing: "0.18em" }}
              >
                Day {dayNumber} · {currentRegion.name}
              </p>
              <p
                className="italic text-[20px] leading-tight text-left truncate"
                style={{
                  fontFamily: "Cormorant Garamond, serif",
                  color: "#E6DCC8",
                  fontWeight: 500,
                }}
              >
                {currentLesson.title}
              </p>
            </div>
            {currentLesson.duration_label && (
              <span
                className="font-mono text-[12px] px-3 py-1 rounded shrink-0"
                style={{
                  background: "rgba(230,192,122,0.15)",
                  color: GOLD,
                  letterSpacing: "0.08em",
                }}
              >
                {currentLesson.duration_label}
              </span>
            )}
          </button>
        )}

        {/* Right cluster — Streak, Rank, Actions */}
        <div className="flex items-center gap-3 shrink-0">
          {/* STREAK — prominent */}
          {streak.current > 0 && (
            <div
              className="flex items-center gap-2 px-3 py-2 rounded-lg"
              style={{
                background: "rgba(230,192,122,0.12)",
                border: "1px solid rgba(230,192,122,0.35)",
                boxShadow:
                  streak.current >= 7
                    ? "0 0 14px rgba(230,192,122,0.25)"
                    : "none",
              }}
              title={`${streak.current}-day streak (longest: ${streak.longest})`}
            >
              <span style={{ fontSize: 20, lineHeight: 1 }}>🔥</span>
              <div className="flex flex-col items-start leading-none">
                <span
                  className="font-mono text-[16px] font-bold tabular-nums"
                  style={{ color: GOLD_HI }}
                >
                  {streak.current}
                </span>
                <span
                  className="text-[9px] font-mono uppercase mt-0.5"
                  style={{ color: GOLD_DIM, letterSpacing: "0.12em" }}
                >
                  Streak
                </span>
              </div>
            </div>
          )}

          {/* RANK — prominent */}
          <div
            className="hidden sm:flex items-center gap-2 px-3 py-2 rounded-lg"
            style={{
              background: "rgba(16,32,66,0.75)",
              border: "1px solid rgba(230,192,122,0.35)",
            }}
            title={`Current rank: ${getTitleLabel(currentTitle)}`}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill={GOLD}>
              <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8l-6.2 4.5 2.4-7.4L2 9.4h7.6z" />
            </svg>
            <div className="flex flex-col items-start leading-none">
              <span
                className="text-[14px] font-semibold"
                style={{
                  fontFamily: "Cormorant Garamond, serif",
                  fontStyle: "italic",
                  color: "#E6DCC8",
                }}
              >
                {getTitleLabel(currentTitle)}
              </span>
              <span
                className="text-[9px] font-mono uppercase mt-0.5"
                style={{ color: GOLD_DIM, letterSpacing: "0.12em" }}
              >
                Rank
              </span>
            </div>
          </div>

          {/* Notebook */}
          <button
            onClick={onOpenNotebook}
            className="flex items-center gap-2 px-3 py-2 rounded-lg transition-colors"
            style={{
              background: "rgba(16,32,66,0.5)",
              border: "1px solid rgba(230,192,122,0.18)",
              color: "rgba(230,220,200,0.8)",
            }}
            title="Your notebook"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.6">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            <span className="hidden lg:inline font-mono text-[11px] uppercase tracking-widest" style={{ letterSpacing: "0.14em" }}>
              Notes
            </span>
          </button>

          {/* Sign out */}
          <button
            onClick={signOut}
            className="font-mono text-[11px] uppercase tracking-widest transition-colors px-2"
            style={{ color: "rgba(230,220,200,0.48)", letterSpacing: "0.14em" }}
            title="Sign out"
          >
            <span className="hover:text-[#E6DCC8]">Sign out</span>
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

  return (
    <div
      className="relative px-6 py-3 flex items-center gap-6"
      style={{ borderTop: "1px solid rgba(230,192,122,0.12)" }}
    >
      <div className="flex-shrink-0 hidden md:block">
        <p
          className="text-[11px] font-mono uppercase tracking-widest"
          style={{ color: GOLD, letterSpacing: "0.18em" }}
        >
          Hey, {firstName}
        </p>
        <p className="text-[12px] font-mono mt-0.5" style={{ color: "rgba(230,220,200,0.75)" }}>
          {overallProgress}% charted · {daysLeft} days left
        </p>
      </div>

      <div className="flex-1 relative h-8">
        {/* Region bands */}
        <div className="absolute inset-0 flex rounded-md overflow-hidden">
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
                  height: isMilestone ? 14 : 8,
                  background: isDone
                    ? GOLD
                    : hasLesson
                      ? "rgba(230,220,200,0.72)"
                      : "rgba(230,220,200,0.28)",
                  marginLeft: -1,
                }}
              />
              {isMilestone && (
                <span
                  className="absolute font-mono text-[10px] mt-1 font-semibold"
                  style={{
                    top: 14,
                    left: "50%",
                    transform: "translateX(-50%)",
                    color: "rgba(230,220,200,0.62)",
                    letterSpacing: "0.08em",
                  }}
                >
                  {day}
                </span>
              )}
              {/* Current-day pin */}
              {isCurrent && (
                <div
                  className="absolute pulse-ring"
                  style={{
                    top: -6,
                    left: 0,
                    transform: "translateX(-50%)",
                    width: 14,
                    height: 14,
                    background: GOLD,
                    borderRadius: "50%",
                    boxShadow: "0 0 14px rgba(230,192,122,0.9)",
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
