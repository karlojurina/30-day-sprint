"use client";

import { useAuth } from "@/contexts/AuthContext";
import { useStudent } from "@/contexts/StudentContext";
import { getDayNumber } from "@/types/database";
import { TOTAL_TASKS, DISCOUNT_REQUIRED_TASKS } from "@/lib/constants";

export function ProgressHeader() {
  const { student, signOut } = useAuth();
  const { completedTaskIds, discountTasksCompleted, overallProgress } =
    useStudent();

  if (!student) return null;

  const dayNumber = getDayNumber(student.joined_at);
  const daysLeft = Math.max(0, 30 - dayNumber);
  const discountRemaining = Math.max(
    0,
    DISCOUNT_REQUIRED_TASKS - discountTasksCompleted
  );
  const firstName = student.name?.split(" ")[0] || "";

  return (
    <header
      className="
        sticky top-0 z-30
        bg-[var(--color-bg-primary)]/85 backdrop-blur-xl
        border-b border-[var(--color-border)]
      "
    >
      <div className="max-w-[720px] mx-auto px-5 sm:px-6 py-4">
        {/* Top row: avatar + name + sign out */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            {student.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={student.avatar_url}
                alt=""
                className="w-9 h-9 rounded-full ring-1 ring-[var(--color-border-strong)]"
              />
            ) : (
              <div className="w-9 h-9 rounded-full bg-[var(--color-accent)]/15 flex items-center justify-center text-[var(--color-accent)] text-sm font-bold ring-1 ring-[var(--color-accent)]/20">
                {(firstName || "?")[0].toUpperCase()}
              </div>
            )}
            <div className="leading-tight">
              <p className="text-[14px] font-semibold text-[var(--color-text-primary)]">
                {firstName ? `Hey, ${firstName}.` : "Welcome back."}
              </p>
              <p className="mono-label mt-0.5">
                Day {String(dayNumber).padStart(2, "0")} / 30
                {daysLeft > 0 && (
                  <span className="text-[var(--color-text-quaternary)]">
                    {" · "}
                    {daysLeft} left
                  </span>
                )}
              </p>
            </div>
          </div>
          <button
            onClick={signOut}
            className="mono-label hover:text-[var(--color-text-primary)] transition-colors"
          >
            Sign out
          </button>
        </div>

        {/* Progress row: overall + discount status */}
        <div className="flex items-center gap-3">
          {/* Overall progress bar */}
          <div className="flex-1 flex items-center gap-3">
            <div className="flex-1 relative h-1.5 rounded-full bg-[var(--color-bg-elevated)] overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-accent-light)] transition-[width] duration-500 ease-out"
                style={{ width: `${overallProgress}%` }}
              />
            </div>
            <span className="font-mono text-[12px] font-semibold tabular-nums text-[var(--color-text-primary)]">
              {completedTaskIds.size}/{TOTAL_TASKS}
            </span>
          </div>

          {/* Discount countdown pill */}
          {discountRemaining > 0 ? (
            <div
              className="
                hidden sm:flex items-center gap-1.5
                px-2.5 py-1 rounded-full
                bg-[var(--color-bg-elevated)] border border-[var(--color-border)]
              "
            >
              <span
                className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)]"
                aria-hidden
              />
              <span className="mono-label">
                {discountRemaining} to discount
              </span>
            </div>
          ) : (
            <div
              className="
                hidden sm:flex items-center gap-1.5
                px-2.5 py-1 rounded-full
                bg-[var(--color-accent)]/15 border border-[var(--color-accent)]/40
              "
            >
              <span className="mono-label-accent">discount ready</span>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
