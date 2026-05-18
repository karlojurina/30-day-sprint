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
    regions,
    completedLessonIds,
    currentLesson,
    streak,
    discountRequest,
    discountAllLessonsDone,
    discountEligible,
    regionProgress,
    openDiscountFeedback,
  } = useStudent();

  const [applying, setApplying] = useState(false);

  function handleApply() {
    if (!discountEligible || applying) return;
    // Opens the 6-question feedback form — submit there creates the row.
    setApplying(true);
    openDiscountFeedback();
    // Reset the applying state quickly so the button is interactive again
    // once the modal mounts. (The actual submission lives inside the modal.)
    setTimeout(() => setApplying(false), 400);
  }

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

  // Current region — the one their next lesson lives in (falls back
  // to the first incomplete region if no current lesson).
  const currentRegionId = currentLesson?.region_id ?? null;
  const currentRegion = currentRegionId
    ? regions.find((r) => r.id === currentRegionId)
    : null;
  const regionInfo = currentRegion
    ? {
        name: currentRegion.name,
        numeral:
          ["I", "II", "III", "IV"][(currentRegion.order_num ?? 1) - 1] ?? "",
        completed: regionProgress[currentRegion.id]?.completed ?? 0,
        total: regionProgress[currentRegion.id]?.total ?? 0,
      }
    : null;

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
  //   • applied (approved — student never sees the code)
  //   • status (pending / rejected)
  //   • eligible — show Apply button
  //   • live countdown
  //   • nothing (window closed)
  const discountInfo = (() => {
    if (
      discountRequest?.status === "approved" ||
      discountRequest?.status === "applied"
    ) {
      return {
        kind: "applied" as const,
        text: "30% off applied to your account",
      };
    }
    if (discountRequest?.status === "pending") {
      return {
        kind: "status" as const,
        text: "Thanks - our team is reviewing your application",
      };
    }
    if (discountRequest?.status === "rejected") {
      return {
        kind: "status" as const,
        text: "Application not approved · DM in Discord",
      };
    }
    if (discountAllLessonsDone && discountEligible) {
      return { kind: "eligible" as const };
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
        top: 20,
        left: 20,
        zIndex: 30,
        width: 380,
        padding: "20px 22px",
        borderRadius: 18,
        background: "rgba(15, 17, 21, 0.62)",
        border: "1px solid rgba(255, 255, 255, 0.14)",
        backdropFilter: "blur(24px) saturate(140%)",
        WebkitBackdropFilter: "blur(24px) saturate(140%)",
        boxShadow:
          "0 14px 40px rgba(0,0,0,0.50), 0 1px 0 rgba(255,255,255,0.05) inset",
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
          gap: 14,
          marginBottom: 18,
        }}
      >
        <Image
          src="/ecomtalent-logo.png"
          alt="EcomTalent"
          width={547}
          height={547}
          priority
          style={{ height: 34, width: 34, objectFit: "contain", flexShrink: 0 }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: "rgba(255,255,255,0.96)",
              lineHeight: 1.2,
              letterSpacing: "-0.018em",
            }}
          >
            Hey {firstName},
          </p>
          <p
            style={{
              fontSize: 13,
              fontWeight: 400,
              color: "rgba(255,255,255,0.55)",
              lineHeight: 1.2,
              marginTop: 2,
            }}
          >
            welcome back
          </p>
          {/* v42 (v2): "Bounty Hunter" badge — surfaces persistently
              once the student claims bounty access on l057. Placement
              is intentionally small + earned-looking (green accent
              chip), not loud. TODO(karlo): visual direction. */}
          {student.bounty_access_claimed_at && (
            <span
              title="Claimed Bounty Access"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                marginTop: 6,
                padding: "2px 8px",
                borderRadius: 999,
                background: "rgba(34, 197, 94, 0.12)",
                border: "1px solid rgba(34, 197, 94, 0.45)",
                color: "#4ADE80",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
              }}
            >
              {/* tiny three-dot coin mark to echo the in-region marker */}
              <svg width="9" height="9" viewBox="-6 -6 12 12" aria-hidden="true">
                <circle cx="0" cy="-3" r="1.6" fill="#4ADE80" />
                <circle cx="-2.6" cy="1.5" r="1.6" fill="#4ADE80" />
                <circle cx="2.6" cy="1.5" r="1.6" fill="#4ADE80" />
              </svg>
              Bounty Apprentice
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={signOut}
          aria-label="Sign out"
          title="Sign out"
          style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            background: "transparent",
            border: "1px solid rgba(255,255,255,0.16)",
            color: "rgba(255,255,255,0.65)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            transition: "all 150ms cubic-bezier(0.25,0.1,0.25,1)",
          }}
        >
          <svg
            width="16"
            height="16"
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

      {/* Overall progress bar */}
      <div style={{ marginBottom: 18 }}>
        <div
          style={{
            height: 6,
            borderRadius: 3,
            background: "rgba(255,255,255,0.10)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${percent}%`,
              background: "rgba(255,255,255,0.94)",
              borderRadius: "inherit",
              transition: "width 400ms cubic-bezier(0.25, 0.1, 0.25, 1)",
            }}
          />
        </div>
        <p
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 12,
            color: "rgba(255,255,255,0.55)",
            marginTop: 8,
            fontVariantNumeric: "tabular-nums",
            letterSpacing: "-0.005em",
          }}
        >
          <span>
            <span style={{ color: "rgba(255,255,255,0.94)", fontWeight: 600 }}>
              {completed}
            </span>
            {" / "}
            {totalLessons} lessons
          </span>
          <span style={{ color: "rgba(255,255,255,0.94)", fontWeight: 600 }}>
            {percent}%
          </span>
        </p>
      </div>

      {/* Current region — line above the stat row showing where they are */}
      {regionInfo && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.08)",
            marginBottom: 14,
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div
            aria-hidden="true"
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.10)",
              border: "1px solid rgba(255,255,255,0.18)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 12,
              fontWeight: 600,
              color: "rgba(255,255,255,0.96)",
              letterSpacing: "-0.018em",
              flexShrink: 0,
            }}
          >
            {regionInfo.numeral}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p
              style={{
                fontSize: 10,
                fontWeight: 500,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "rgba(255,255,255,0.50)",
                marginBottom: 2,
              }}
            >
              You&rsquo;re in
            </p>
            <p
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: "rgba(255,255,255,0.96)",
                letterSpacing: "-0.014em",
                lineHeight: 1.2,
              }}
            >
              {regionInfo.name}
            </p>
          </div>
          <p
            className="tabular-nums"
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: "rgba(255,255,255,0.65)",
              flexShrink: 0,
              letterSpacing: "-0.005em",
            }}
          >
            {regionInfo.completed} / {regionInfo.total}
          </p>
        </div>
      )}

      {/* Stats row — streak (current + longest) + day */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 10,
          marginBottom: 16,
        }}
      >
        <Stat
          label="Streak"
          value={streak.current === 0 ? "-" : `${streak.current}d`}
          icon={
            <svg
              width="14"
              height="16"
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
          label="Best"
          value={streak.longest === 0 ? "-" : `${streak.longest}d`}
        />
        <Stat label="Day" value={`${dayNumber}/30`} />
      </div>

      {/* Next lesson — clickable card */}
      {currentLesson && (
        <button
          type="button"
          onClick={() => onOpenLesson?.(currentLesson.id)}
          style={{
            display: "block",
            width: "100%",
            padding: "14px 16px",
            borderRadius: 12,
            background: "rgba(255,255,255,0.07)",
            border: "1px solid rgba(255,255,255,0.16)",
            color: "inherit",
            textAlign: "left",
            cursor: "pointer",
            marginBottom: discountInfo ? 16 : 0,
            transition: "all 150ms cubic-bezier(0.25,0.1,0.25,1)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(255,255,255,0.12)";
            e.currentTarget.style.borderColor = "rgba(255,255,255,0.26)";
            e.currentTarget.style.transform = "translateY(-1px)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(255,255,255,0.07)";
            e.currentTarget.style.borderColor = "rgba(255,255,255,0.16)";
            e.currentTarget.style.transform = "translateY(0)";
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 6,
            }}
          >
            <p
              style={{
                fontSize: 11,
                fontWeight: 500,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "rgba(255,255,255,0.55)",
              }}
            >
              Next up
            </p>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="rgba(255,255,255,0.45)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 10,
              minWidth: 0,
            }}
          >
            <span
              className="truncate"
              style={{
                fontSize: 15,
                fontWeight: 600,
                color: "rgba(255,255,255,0.96)",
                letterSpacing: "-0.014em",
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
                  fontSize: 12,
                  color: "rgba(255,255,255,0.55)",
                  fontVariantNumeric: "tabular-nums",
                  flexShrink: 0,
                  fontWeight: 500,
                }}
              >
                {nextDuration}
              </span>
            )}
          </div>
        </button>
      )}

      {/* Discount line — inline row: green pulse dot + text. Bigger
          font than before so it reads as the focal status item. */}
      {discountInfo && (
        <div
          style={{
            paddingTop: 14,
            borderTop: "1px solid rgba(255,255,255,0.10)",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <GreenPulseDot />
          {discountInfo.kind === "countdown" && (
            <span
              style={{
                fontSize: 14,
                fontWeight: 500,
                color: "rgba(255, 255, 255, 0.85)",
                letterSpacing: "-0.011em",
                flex: 1,
              }}
            >
              <span
                className="tabular-nums"
                style={{ color: "rgba(255,255,255,0.96)", fontWeight: 700 }}
              >
                {discountInfo.text}
              </span>{" "}
              left to earn your{" "}
              <span style={{ color: "#FFFFFF", fontWeight: 700 }}>
                30% off
              </span>
            </span>
          )}

          {discountInfo.kind === "eligible" && (
            <>
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 500,
                  color: "rgba(255, 255, 255, 0.85)",
                  letterSpacing: "-0.011em",
                  flex: 1,
                }}
              >
                Ready for your{" "}
                <span style={{ color: "#FFFFFF", fontWeight: 700 }}>
                  30% off
                </span>
              </span>
              <button
                type="button"
                onClick={handleApply}
                disabled={applying}
                style={{
                  padding: "6px 14px",
                  borderRadius: 999,
                  background: applying
                    ? "rgba(255, 255, 255, 0.16)"
                    : "rgba(255, 255, 255, 0.94)",
                  border: "1px solid rgba(255, 255, 255, 0.92)",
                  color: applying
                    ? "rgba(255, 255, 255, 0.55)"
                    : "rgba(15, 17, 21, 0.92)",
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: "-0.005em",
                  cursor: applying ? "wait" : "pointer",
                  transition: "all 150ms cubic-bezier(0.25, 0.1, 0.25, 1)",
                  flexShrink: 0,
                }}
              >
                {applying ? "Applying…" : "Apply"}
              </button>
            </>
          )}

          {discountInfo.kind === "applied" && (
            <span
              style={{
                fontSize: 14,
                fontWeight: 500,
                color: "rgba(255, 255, 255, 0.85)",
                letterSpacing: "-0.011em",
              }}
            >
              <span style={{ color: "#FFFFFF", fontWeight: 700 }}>
                30% off
              </span>{" "}
              applied to your account
            </span>
          )}

          {discountInfo.kind === "status" && (
            <span
              style={{
                fontSize: 14,
                fontWeight: 500,
                color: "rgba(255, 255, 255, 0.85)",
                letterSpacing: "-0.011em",
              }}
            >
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
        padding: "12px 14px",
        borderRadius: 12,
        background: "rgba(255,255,255,0.05)",
        border: "1px solid rgba(255,255,255,0.10)",
      }}
    >
      <p
        style={{
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "rgba(255,255,255,0.55)",
        }}
      >
        {label}
      </p>
      <p
        style={{
          fontSize: 18,
          fontWeight: 700,
          color: "rgba(255,255,255,0.96)",
          marginTop: 4,
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "-0.022em",
          display: "flex",
          alignItems: "center",
          gap: 6,
          lineHeight: 1,
        }}
      >
        {icon}
        {value}
      </p>
    </div>
  );
}

/** Pulsing green status dot — used to draw attention to active
 *  discount state (window open or eligible). Reused in the map
 *  region label as well via an SVG sibling. */
function GreenPulseDot() {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: 10,
        height: 10,
        borderRadius: "50%",
        background: "#22C55E",
        boxShadow: "0 0 12px rgba(34, 197, 94, 0.65)",
        animation: "pulse-dot 1.6s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        flexShrink: 0,
      }}
    />
  );
}
