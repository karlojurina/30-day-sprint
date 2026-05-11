"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useAuth } from "@/contexts/AuthContext";
import { useStudent } from "@/contexts/StudentContext";
import { getDayNumber } from "@/types/database";
import {
  DISCOUNT_WINDOW_DAYS,
  LESSON_GROUPS,
  lessonGroupOf,
  progressPercent,
} from "@/lib/constants";

interface StatsWidgetProps {
  onOpenLesson?: (lessonId: string) => void;
}

/**
 * Floating top-left widget that replaces the old TopBar. Hosts a
 * personal welcome, progress, streak, the next lesson, the discount
 * countdown / code, and sign-out — all in a single transparent
 * card that sits ON the map.
 *
 * Visibility: always rendered (overview AND region views).
 * Position: absolute top-left of its parent (the map container).
 */
export function StatsWidget({ onOpenLesson }: StatsWidgetProps) {
  const { student, signOut } = useAuth();
  const {
    lessons,
    completedLessonIds,
    currentLesson,
    streak,
    discountRequest,
    discountAllLessonsDone,
  } = useStudent();

  // Tick the live discount countdown once per second.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  if (!student) return null;

  const firstName = student.name?.split(" ")[0] || "Explorer";
  const dayNumber = getDayNumber(student.joined_at);
  const totalLessons = lessons.length;
  const completed = completedLessonIds.size;
  const percent = progressPercent(completed, totalLessons);

  // Live discount ms remaining
  const joined = new Date(student.joined_at).getTime();
  const deadline = joined + DISCOUNT_WINDOW_DAYS * 86_400_000;
  const msLeft = Math.max(0, deadline - Date.now());

  // Current / next lesson — show the group title if it's part of one.
  const currentGroupId = currentLesson ? lessonGroupOf(currentLesson.id) : null;
  const nextTitle = currentGroupId
    ? LESSON_GROUPS[currentGroupId]?.title ?? currentLesson?.title
    : currentLesson?.title;
  const nextDuration = currentGroupId ? null : currentLesson?.duration_label;

  // Discount status line — one of:
  //   • code (approved)
  //   • status (pending / rejected)
  //   • ready (eligible)
  //   • live countdown
  //   • nothing (window closed)
  const discountInfo = (() => {
    if (discountRequest?.status === "approved") {
      return {
        kind: "code" as const,
        text: discountRequest.promo_code ?? "—",
        prefix: "30% code",
      };
    }
    if (discountRequest?.status === "pending") {
      return { kind: "status" as const, text: "Discount under review" };
    }
    if (discountRequest?.status === "rejected") {
      return {
        kind: "status" as const,
        text: "Application not approved · DM in Discord",
      };
    }
    if (discountAllLessonsDone) {
      return { kind: "status" as const, text: "Ready to apply for 30% off" };
    }
    if (msLeft > 0) {
      const totalSec = Math.floor(msLeft / 1000);
      const d = Math.floor(totalSec / 86_400);
      const h = Math.floor((totalSec % 86_400) / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      const parts: string[] = [];
      if (d > 0) parts.push(`${d}d`);
      if (h > 0 || d > 0) parts.push(`${h}h`);
      if (m > 0 || h > 0 || d > 0) parts.push(`${m}m`);
      parts.push(`${s}s`);
      return {
        kind: "countdown" as const,
        text: parts.join(" "),
        suffix: "left for 30% off",
      };
    }
    return null;
  })();

  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        left: 16,
        zIndex: 30,
        width: 320,
        padding: "16px 18px",
        borderRadius: 16,
        background: "rgba(15, 17, 21, 0.62)",
        border: "1px solid rgba(255, 255, 255, 0.12)",
        backdropFilter: "blur(24px) saturate(140%)",
        WebkitBackdropFilter: "blur(24px) saturate(140%)",
        boxShadow:
          "0 12px 32px rgba(0,0,0,0.45), 0 1px 0 rgba(255,255,255,0.04) inset",
        color: "rgba(255, 255, 255, 0.94)",
        fontSize: 13,
        letterSpacing: "-0.005em",
      }}
    >
      {/* Header — brand + welcome + signout */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <Image
          src="/ecomtalent-logo.png"
          alt="EcomTalent"
          width={547}
          height={547}
          priority
          style={{ height: 28, width: 28, objectFit: "contain", flexShrink: 0 }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "rgba(255,255,255,0.96)",
              lineHeight: 1.2,
              letterSpacing: "-0.011em",
            }}
          >
            Hey {firstName},
          </p>
          <p
            style={{
              fontSize: 12,
              fontWeight: 400,
              color: "rgba(255,255,255,0.55)",
              lineHeight: 1.2,
              marginTop: 1,
            }}
          >
            welcome back
          </p>
        </div>
        <button
          type="button"
          onClick={signOut}
          aria-label="Sign out"
          title="Sign out"
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            background: "transparent",
            border: "1px solid rgba(255,255,255,0.14)",
            color: "rgba(255,255,255,0.55)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            transition: "all 150ms cubic-bezier(0.25,0.1,0.25,1)",
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
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

      {/* Progress bar — overall lessons */}
      <div style={{ marginBottom: 14 }}>
        <div
          style={{
            height: 5,
            borderRadius: 3,
            background: "rgba(255,255,255,0.10)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${percent}%`,
              background: "rgba(255,255,255,0.92)",
              borderRadius: "inherit",
              transition: "width 400ms cubic-bezier(0.25, 0.1, 0.25, 1)",
            }}
          />
        </div>
        <p
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 11,
            color: "rgba(255,255,255,0.55)",
            marginTop: 6,
            fontVariantNumeric: "tabular-nums",
            letterSpacing: "-0.005em",
          }}
        >
          <span>
            <span style={{ color: "rgba(255,255,255,0.92)", fontWeight: 600 }}>
              {completed}
            </span>
            {" / "}
            {totalLessons} lessons
          </span>
          <span>{percent}%</span>
        </p>
      </div>

      {/* Stats row — streak + day */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
          marginBottom: 14,
        }}
      >
        <Stat
          label="Streak"
          value={streak.current === 0 ? "—" : `${streak.current}d`}
          icon={
            <svg
              width="12"
              height="14"
              viewBox="0 0 24 28"
              aria-hidden="true"
              style={{ overflow: "visible" }}
            >
              <path
                d="M12 2 C 9 7, 5 10, 5 16 a 7 7 0 0 0 14 0 C 19 12, 16 10, 14 6 C 13 9, 11 9, 12 2 Z"
                fill={streak.current > 0 ? "#FF8C3C" : "rgba(255,255,255,0.25)"}
              />
            </svg>
          }
        />
        <Stat
          label="Day"
          value={`${dayNumber} / 30`}
        />
      </div>

      {/* Next lesson — clickable card */}
      {currentLesson && (
        <button
          type="button"
          onClick={() => onOpenLesson?.(currentLesson.id)}
          style={{
            display: "block",
            width: "100%",
            padding: "10px 12px",
            borderRadius: 10,
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.14)",
            color: "inherit",
            textAlign: "left",
            cursor: "pointer",
            marginBottom: discountInfo ? 14 : 0,
            transition: "all 150ms cubic-bezier(0.25,0.1,0.25,1)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(255,255,255,0.10)";
            e.currentTarget.style.borderColor = "rgba(255,255,255,0.22)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(255,255,255,0.06)";
            e.currentTarget.style.borderColor = "rgba(255,255,255,0.14)";
          }}
        >
          <p
            style={{
              fontSize: 10,
              fontWeight: 500,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.50)",
              marginBottom: 4,
            }}
          >
            Next up
          </p>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 8,
              minWidth: 0,
            }}
          >
            <span
              className="truncate"
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "rgba(255,255,255,0.95)",
                letterSpacing: "-0.011em",
                flex: 1,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {nextTitle}
            </span>
            {nextDuration && (
              <span
                style={{
                  fontSize: 11,
                  color: "rgba(255,255,255,0.55)",
                  fontVariantNumeric: "tabular-nums",
                  flexShrink: 0,
                }}
              >
                {nextDuration}
              </span>
            )}
          </div>
        </button>
      )}

      {/* Discount line — countdown / code / status */}
      {discountInfo && (
        <div
          style={{
            paddingTop: 12,
            borderTop: "1px solid rgba(255,255,255,0.08)",
            fontSize: 12,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="rgba(255,255,255,0.45)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <polyline points="12 7 12 12 15 15" />
          </svg>
          {discountInfo.kind === "countdown" && (
            <span style={{ color: "rgba(255,255,255,0.78)" }}>
              <span
                className="tabular-nums"
                style={{ color: "rgba(255,255,255,0.96)", fontWeight: 600 }}
              >
                {discountInfo.text}
              </span>{" "}
              {discountInfo.suffix}
            </span>
          )}
          {discountInfo.kind === "code" && (
            <span style={{ color: "rgba(255,255,255,0.78)" }}>
              {discountInfo.prefix}{" "}
              <span
                className="tabular-nums"
                style={{ color: "rgba(255,255,255,0.96)", fontWeight: 600 }}
              >
                {discountInfo.text}
              </span>
            </span>
          )}
          {discountInfo.kind === "status" && (
            <span style={{ color: "rgba(255,255,255,0.78)" }}>
              {discountInfo.text}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
  return (
    <div
      style={{
        padding: "10px 12px",
        borderRadius: 10,
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <p
        style={{
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "rgba(255,255,255,0.50)",
        }}
      >
        {label}
      </p>
      <p
        style={{
          fontSize: 16,
          fontWeight: 600,
          color: "rgba(255,255,255,0.96)",
          marginTop: 3,
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "-0.018em",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        {icon}
        {value}
      </p>
    </div>
  );
}
