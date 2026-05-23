"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { useStudent } from "@/contexts/StudentContext";
import { getDayNumber } from "@/types/database";
import {
  DISCOUNT_WINDOW_DAYS,
  LESSON_GROUPS,
  lessonGroupOf,
  progressPercent,
} from "@/lib/constants";
import { useIsPhone } from "@/lib/useMediaQuery";
import { AchievementsButton } from "@/components/map/AchievementsButton";

interface StatsWidgetProps {
  onOpenLesson?: (lessonId: string) => void;
}

/**
 * Top-left floating widget that sits over the map. Redesigned for v2:
 * tighter width (300 vs 380), less ornament, no "welcome back" filler,
 * sign-out moved behind a kebab menu. New: "Open the Playbook" CTA
 * at the bottom whenever sprint_completed_at is set so the path
 * forward isn't trapped on the l058 sheet.
 *
 * Visibility: always rendered (overview AND region views).
 * Position: absolute top-left of its parent (the map container).
 */
export function StatsWidget({ onOpenLesson }: StatsWidgetProps) {
  const isPhone = useIsPhone();
  const [phoneOpen, setPhoneOpen] = useState(false);

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
    bountyAccessClaimedAt,
  } = useStudent();

  const [applying, setApplying] = useState(false);

  function handleApply() {
    if (!discountEligible || applying) return;
    // Opens the 6-question feedback form. Submit there creates the row.
    setApplying(true);
    openDiscountFeedback();
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

  const joined = new Date(student.joined_at).getTime();
  const deadline = joined + DISCOUNT_WINDOW_DAYS * 86_400_000;
  const msLeft = Math.max(0, deadline - Date.now());

  const currentGroupId = currentLesson ? lessonGroupOf(currentLesson.id) : null;
  const nextTitle = currentGroupId
    ? LESSON_GROUPS[currentGroupId]?.title ?? currentLesson?.title
    : currentLesson?.title;
  const nextDuration = currentGroupId ? null : currentLesson?.duration_label;

  // Discount status — one of:
  //   applied / status (pending / rejected) / eligible / countdown / null
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
      };
    }
    return null;
  })();

  // v50 — the "Open the Playbook" CTA appears the moment the student
  // claims Bounty Access on l057. That's the new finish line.
  const sprintFinished = Boolean(bountyAccessClaimedAt);
  const hasBountyAccess = Boolean(bountyAccessClaimedAt);

  const body = (
    <>
      {/* Header - brand logo + welcome + signout */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
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
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(255,255,255,0.08)";
            e.currentTarget.style.color = "rgba(255,255,255,0.92)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "rgba(255,255,255,0.65)";
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

      {/* Bounty Apprentice chip (when claimed) + Achievements button.
          Both sit in the same row so the floating bar stays compact. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        {hasBountyAccess && (
          <span
            title="Claimed Bounty Access"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "3px 9px",
              borderRadius: 999,
              background: "rgba(34, 197, 94, 0.12)",
              border: "1px solid rgba(34, 197, 94, 0.40)",
              color: "#4ADE80",
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}
          >
            <svg width="9" height="9" viewBox="-6 -6 12 12" aria-hidden="true">
              <circle cx="0" cy="-3" r="1.6" fill="#4ADE80" />
              <circle cx="-2.6" cy="1.5" r="1.6" fill="#4ADE80" />
              <circle cx="2.6" cy="1.5" r="1.6" fill="#4ADE80" />
            </svg>
            Bounty Apprentice
          </span>
        )}
        {/* v53 (Phase 5) - Achievements pill. Sits inline with the
            Bounty Apprentice chip so the floating bar absorbs it
            without adding height. */}
        {student && <AchievementsButton studentId={student.id} />}
      </div>

      {/* Progress block */}
      <div>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            marginBottom: 6,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", letterSpacing: "0.04em", textTransform: "uppercase" }}>
            Progress
          </span>
          <span style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.96)" }}>
            {percent}%
          </span>
        </div>
        <div
          style={{
            height: 4,
            borderRadius: 999,
            background: "rgba(255,255,255,0.10)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${percent}%`,
              background:
                "linear-gradient(90deg, rgba(255,255,255,0.96), rgba(255,255,255,0.78))",
              transition: "width 400ms cubic-bezier(0.25,0.1,0.25,1)",
            }}
          />
        </div>
        <p
          style={{
            marginTop: 6,
            fontSize: 11,
            color: "rgba(255,255,255,0.5)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {completed} / {totalLessons} lessons completed
        </p>
      </div>

      {/* Current region */}
      {regionInfo && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 12px",
            borderRadius: 10,
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <div
            aria-hidden="true"
            style={{
              width: 26,
              height: 26,
              borderRadius: "50%",
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.14)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 11,
              fontWeight: 700,
              color: "rgba(255,255,255,0.92)",
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
                color: "rgba(255,255,255,0.45)",
              }}
            >
              In progress
            </p>
            <p
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "rgba(255,255,255,0.94)",
                letterSpacing: "-0.011em",
                lineHeight: 1.2,
                marginTop: 1,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {regionInfo.name}
            </p>
          </div>
          <p
            style={{
              fontSize: 11,
              color: "rgba(255,255,255,0.55)",
              fontVariantNumeric: "tabular-nums",
              flexShrink: 0,
            }}
          >
            {regionInfo.completed} / {regionInfo.total}
          </p>
        </div>
      )}

      {/* Next lesson */}
      {currentLesson && (
        <button
          type="button"
          onClick={() => onOpenLesson?.(currentLesson.id)}
          style={{
            display: "block",
            width: "100%",
            padding: "12px 14px",
            borderRadius: 10,
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.14)",
            color: "inherit",
            textAlign: "left",
            cursor: "pointer",
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
              color: "rgba(255,255,255,0.45)",
              marginBottom: 4,
            }}
          >
            Next up
          </p>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 10,
              minWidth: 0,
            }}
          >
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "rgba(255,255,255,0.94)",
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
                  color: "rgba(255,255,255,0.5)",
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

      {/* Streak / Best / Day chips */}
      <div style={{ display: "flex", gap: 8 }}>
        <StreakChip
          label="Streak"
          value={streak.current === 0 ? "-" : `${streak.current}d`}
          active={streak.current > 0}
        />
        <StreakChip
          label="Best"
          value={streak.longest === 0 ? "-" : `${streak.longest}d`}
        />
        <StreakChip
          label="Day"
          value={`${dayNumber}/30`}
        />
      </div>

      {/* Discount status */}
      {discountInfo && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 12px",
            borderRadius: 10,
            background: "rgba(34, 197, 94, 0.08)",
            border: "1px solid rgba(34, 197, 94, 0.25)",
          }}
        >
          <GreenPulseDot />
          {discountInfo.kind === "countdown" && (
            <span
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: "rgba(255,255,255,0.85)",
                flex: 1,
              }}
            >
              <span style={{ color: "#FFFFFF", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                {discountInfo.text}
              </span>{" "}
              left to earn 30% off
            </span>
          )}
          {discountInfo.kind === "eligible" && (
            <>
              <span style={{ fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,0.85)", flex: 1 }}>
                Ready for 30% off
              </span>
              <button
                type="button"
                onClick={handleApply}
                disabled={applying}
                style={{
                  padding: "4px 12px",
                  borderRadius: 999,
                  background: applying ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.94)",
                  border: "none",
                  color: applying ? "rgba(255,255,255,0.55)" : "rgba(15,17,21,0.92)",
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: applying ? "wait" : "pointer",
                  flexShrink: 0,
                }}
              >
                {applying ? "..." : "Apply"}
              </button>
            </>
          )}
          {(discountInfo.kind === "applied" || discountInfo.kind === "status") && (
            <span style={{ fontSize: 12, fontWeight: 500, color: "rgba(255,255,255,0.85)" }}>
              {discountInfo.text}
            </span>
          )}
        </div>
      )}

      {/* v42 (v2): Map 2 CTA - shows once the student has clicked
          Finish Program on l058. Without this, the only way to reach
          Map 2 was via the l058 sheet, which is annoying once the
          claim was already made. */}
      {sprintFinished && (
        <Link
          href="/dashboard/playbook"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: "12px 16px",
            borderRadius: 10,
            background: "var(--color-gold)",
            color: "var(--color-bg-primary)",
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: "-0.011em",
            textDecoration: "none",
            border: "1px solid var(--color-gold-light)",
          }}
        >
          Open the Playbook
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M5 12h14M13 5l7 7-7 7" />
          </svg>
        </Link>
      )}
    </>
  );

  // Phone: compact pill at top-left + bottom-sheet on tap.
  if (isPhone) {
    return (
      <>
        <button
          type="button"
          onClick={() => setPhoneOpen(true)}
          aria-label="Open progress panel"
          style={{
            position: "absolute",
            top: 12,
            left: 12,
            zIndex: 30,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 12px",
            borderRadius: 999,
            // Solid bg (no backdrop-filter) on phone. blur() over a
            // moving map underneath was forcing the GPU to re-blur on
            // every frame and tanking pan smoothness.
            background: "rgba(15, 17, 21, 0.96)",
            border: "1px solid rgba(255, 255, 255, 0.16)",
            boxShadow: "0 10px 30px rgba(0,0,0,0.45)",
            color: "rgba(255, 255, 255, 0.94)",
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: "-0.005em",
            cursor: "pointer",
          }}
        >
          <Image
            src="/ecomtalent-logo.png"
            alt=""
            width={547}
            height={547}
            priority
            style={{ height: 22, width: 22, objectFit: "contain", flexShrink: 0 }}
          />
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            Day {dayNumber} · {percent}%
          </span>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            style={{ opacity: 0.7 }}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>

        {phoneOpen && (
          <>
            <div
              onClick={() => setPhoneOpen(false)}
              aria-hidden="true"
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 60,
                background: "rgba(6, 12, 26, 0.72)",
                backdropFilter: "blur(8px)",
                WebkitBackdropFilter: "blur(8px)",
              }}
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Progress panel"
              style={{
                position: "fixed",
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 70,
                maxHeight: "85vh",
                overflowY: "auto",
                padding: "20px 18px 28px",
                borderTopLeftRadius: 22,
                borderTopRightRadius: 22,
                background: "rgba(15, 17, 21, 0.96)",
                borderTop: "1px solid rgba(255, 255, 255, 0.14)",
                color: "rgba(255, 255, 255, 0.94)",
                fontSize: 13,
                letterSpacing: "-0.005em",
                display: "flex",
                flexDirection: "column",
                gap: 16,
                boxShadow: "0 -20px 60px rgba(0,0,0,0.6)",
              }}
            >
              {/* Drag handle */}
              <div
                aria-hidden="true"
                style={{
                  width: 38,
                  height: 4,
                  borderRadius: 999,
                  background: "rgba(255,255,255,0.18)",
                  margin: "-6px auto 4px",
                }}
              />
              <div
                onClick={(e) => {
                  // Close the sheet when a primary action (Next Up,
                  // Open Playbook) is taken so the map shows under it.
                  const target = e.target as HTMLElement;
                  if (
                    target.closest("a") ||
                    target.closest('button[aria-label="Sign out"]') ||
                    target.closest('button[type="button"]')?.getAttribute("data-sheet-close") === "true"
                  ) {
                    setPhoneOpen(false);
                  }
                }}
                style={{ display: "flex", flexDirection: "column", gap: 16 }}
              >
                {body}
              </div>
            </div>
          </>
        )}
      </>
    );
  }

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
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      {body}
    </div>
  );
}

function StreakChip({
  label,
  value,
  active = false,
}: {
  label: string;
  value: string;
  active?: boolean;
}) {
  // v50.5 — custom popover replaces the native `title` tooltip
  // (browser default delay was ~1.5 s and the styling clashed with
  // the rest of the dashboard). Same dark-panel + uppercase-label
  // language as the existing widgets, fires after 120 ms on hover
  // / focus so it feels snappy without being jumpy.
  const tooltip =
    label === "Streak"
      ? "Complete one lesson every day to keep your streak going. Miss a day and it resets to 1."
      : label === "Best"
        ? "Your longest streak so far."
        : label === "Day"
          ? "Days since you started the 30-day sprint."
          : undefined;
  const [tipOpen, setTipOpen] = useState(false);
  const tipTimerRef = useRef<number | null>(null);
  const openTip = () => {
    if (tipTimerRef.current != null) window.clearTimeout(tipTimerRef.current);
    tipTimerRef.current = window.setTimeout(() => setTipOpen(true), 120);
  };
  const closeTip = () => {
    if (tipTimerRef.current != null) window.clearTimeout(tipTimerRef.current);
    setTipOpen(false);
  };
  useEffect(
    () => () => {
      if (tipTimerRef.current != null) window.clearTimeout(tipTimerRef.current);
    },
    [],
  );
  return (
    <div
      onMouseEnter={tooltip ? openTip : undefined}
      onMouseLeave={tooltip ? closeTip : undefined}
      onFocus={tooltip ? openTip : undefined}
      onBlur={tooltip ? closeTip : undefined}
      tabIndex={tooltip ? 0 : undefined}
      aria-describedby={tooltip ? `streakchip-tip-${label}` : undefined}
      style={{
        flex: 1,
        padding: "8px 12px",
        borderRadius: 10,
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
        display: "flex",
        alignItems: "center",
        gap: 8,
        cursor: tooltip ? "help" : "default",
        position: "relative",
      }}
    >
      {tooltip && tipOpen && (
        <div
          id={`streakchip-tip-${label}`}
          role="tooltip"
          style={{
            position: "absolute",
            bottom: "calc(100% + 8px)",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 80,
            width: 220,
            padding: "10px 12px",
            borderRadius: 8,
            background: "rgba(10,14,22,0.96)",
            border: "1px solid rgba(255,255,255,0.10)",
            boxShadow: "0 12px 28px rgba(0,0,0,0.45)",
            color: "rgba(255,255,255,0.92)",
            fontSize: 12,
            lineHeight: 1.45,
            letterSpacing: "-0.003em",
            pointerEvents: "none",
            animation: "fade-in-tip 120ms cubic-bezier(0.22,1,0.36,1) both",
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: "rgba(255,255,255,0.45)",
              letterSpacing: "0.10em",
              textTransform: "uppercase",
              marginBottom: 4,
            }}
          >
            {label}
          </div>
          {tooltip}
          {/* Caret pointing down to the chip */}
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              top: "100%",
              left: "50%",
              transform: "translate(-50%, -1px)",
              width: 0,
              height: 0,
              borderLeft: "6px solid transparent",
              borderRight: "6px solid transparent",
              borderTop: "6px solid rgba(10,14,22,0.96)",
            }}
          />
        </div>
      )}
      {label === "Streak" && (
        <svg
          width="12"
          height="14"
          viewBox="0 0 24 28"
          aria-hidden="true"
          style={{ flexShrink: 0, overflow: "visible" }}
        >
          <path
            d="M12 2 C 9 7, 5 10, 5 16 a 7 7 0 0 0 14 0 C 19 12, 16 10, 14 6 C 13 9, 11 9, 12 2 Z"
            fill={active ? "#FF8C3C" : "rgba(255,255,255,0.25)"}
          />
        </svg>
      )}
      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.45)",
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontSize: 15,
            fontWeight: 700,
            color: "rgba(255,255,255,0.96)",
            fontVariantNumeric: "tabular-nums",
            letterSpacing: "-0.018em",
            marginTop: 2,
          }}
        >
          {value}
        </span>
      </div>
    </div>
  );
}

/** Pulsing green status dot - used to draw attention to active
 *  discount state (window open or eligible). */
function GreenPulseDot() {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: "#22C55E",
        boxShadow: "0 0 10px rgba(34, 197, 94, 0.6)",
        animation: "pulse-dot 1.6s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        flexShrink: 0,
      }}
    />
  );
}
