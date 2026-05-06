"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase-browser";
import type {
  Student,
  Region,
  Lesson,
  StudentLessonCompletion,
  DiscountRequest,
} from "@/types/database";
import { getDayNumber } from "@/types/database";
import { TOTAL_LESSONS, progressPercent } from "@/lib/constants";

interface StudentDrawerProps {
  studentId: string | null;
  onClose: () => void;
}

/**
 * Right-side drawer with a student's detail. Opens from the kanban
 * cards. A condensed version of /admin/students/[id] — same data,
 * lighter chrome. Click "Open full page" to jump to the full detail.
 *
 * Slide-in animation; click backdrop or Escape to dismiss.
 */
export function StudentDrawer({ studentId, onClose }: StudentDrawerProps) {
  const supabase = createClient();
  const [student, setStudent] = useState<Student | null>(null);
  const [regions, setRegions] = useState<Region[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [completions, setCompletions] = useState<StudentLessonCompletion[]>([]);
  const [discountRequest, setDiscountRequest] = useState<DiscountRequest | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [savingVerification, setSavingVerification] = useState(false);

  useEffect(() => {
    if (!studentId) return;
    setLoading(true);
    setStudent(null);

    async function fetchAll() {
      const [studentRes, regionsRes, lessonsRes, completionsRes, discountRes] =
        await Promise.all([
          supabase.from("students").select("*").eq("id", studentId).single(),
          supabase.from("regions").select("*").order("order_num"),
          supabase.from("lessons").select("*").order("day").order("sort_order"),
          supabase
            .from("student_lesson_completions")
            .select("*")
            .eq("student_id", studentId),
          supabase
            .from("discount_requests")
            .select("*")
            .eq("student_id", studentId)
            .order("created_at", { ascending: false })
            .limit(1)
            .single(),
        ]);

      if (studentRes.data) setStudent(studentRes.data);
      if (regionsRes.data) setRegions(regionsRes.data);
      if (lessonsRes.data) setLessons(lessonsRes.data);
      if (completionsRes.data) setCompletions(completionsRes.data);
      if (discountRes.data) setDiscountRequest(discountRes.data);
      setLoading(false);
    }
    fetchAll();
  }, [studentId, supabase]);

  // Escape closes
  useEffect(() => {
    if (!studentId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [studentId, onClose]);

  const completedIds = useMemo(
    () => new Set(completions.filter((c) => c.completed_at).map((c) => c.lesson_id)),
    [completions]
  );

  // Use the live lessons array length when available so the math
  // tracks actual content (defends against TOTAL_LESSONS drift after
  // content migrations).
  const overallPercent = student
    ? progressPercent(completedIds.size, lessons.length || TOTAL_LESSONS)
    : 0;

  const dayNumber = student ? getDayNumber(student.joined_at) : 1;

  async function toggleAdSubmissionsVerified(verified: boolean) {
    if (!student) return;
    const prev = student.ad_submissions_verified;
    setStudent({ ...student, ad_submissions_verified: verified });
    setSavingVerification(true);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) {
      setSavingVerification(false);
      return;
    }
    const res = await fetch("/api/admin/verify-ad-submissions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ studentId: student.id, verified }),
    });
    if (!res.ok) {
      // Revert on failure
      setStudent({ ...student, ad_submissions_verified: prev });
    }
    setSavingVerification(false);
  }

  if (!studentId) return null;

  return (
    <>
      {/* Backdrop — Apple-style soft scrim */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close drawer"
        className="fixed inset-0 z-40"
        style={{
          background: "rgba(20, 20, 24, 0.30)",
          backdropFilter: "blur(2px)",
          animation: "overlay-in 0.25s cubic-bezier(0.25, 0.1, 0.25, 1) both",
          border: "none",
          padding: 0,
        }}
      />

      {/* Drawer */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-student-name"
        className="fixed top-0 right-0 h-screen z-50 overflow-y-auto"
        style={{
          width: "min(520px, 92vw)",
          background: "var(--color-bg-secondary)",
          borderLeft: "1px solid var(--color-border)",
          boxShadow: "-24px 0 64px rgba(20,20,24,0.18), -2px 0 8px rgba(20,20,24,0.06)",
          animation: "slide-in-right 0.32s cubic-bezier(0.25, 0.1, 0.25, 1) both",
        }}
      >
        {loading || !student ? (
          <div className="flex items-center justify-center h-full">
            <div
              className="rounded-full animate-spin"
              style={{
                width: 22,
                height: 22,
                border: "2px solid var(--color-accent)",
                borderTopColor: "transparent",
              }}
            />
          </div>
        ) : (
          <div style={{ padding: 24 }}>
            {/* Header */}
            <div
              className="flex items-start justify-between"
              style={{ gap: 12, marginBottom: 24 }}
            >
              <div className="min-w-0">
                <h2
                  id="drawer-student-name"
                  className="truncate"
                  style={{
                    fontSize: 20,
                    fontWeight: 600,
                    color: "var(--color-text-primary)",
                    letterSpacing: "-0.019em",
                  }}
                >
                  {student.name || "Unnamed student"}
                </h2>
                <p
                  className="truncate"
                  style={{
                    fontSize: 13,
                    color: "var(--color-text-secondary)",
                    marginTop: 2,
                    letterSpacing: "-0.005em",
                  }}
                >
                  {student.email} · Day {dayNumber} · {student.membership_status}
                </p>
              </div>
              <button
                onClick={onClose}
                aria-label="Close drawer"
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  background: "var(--color-bg-elevated)",
                  border: "none",
                  color: "var(--color-text-tertiary)",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Stat cards */}
            <div
              className="grid grid-cols-2"
              style={{ gap: 8, marginBottom: 24 }}
            >
              <Stat label="Progress" value={`${overallPercent}%`} accent />
              <Stat label="Streak" value={`${student.current_streak ?? 0}d`} />
              <Stat
                label="Joined"
                value={new Date(student.joined_at).toLocaleDateString()}
              />
              <Stat
                label="Last active"
                value={new Date(student.last_active_at).toLocaleDateString()}
              />
            </div>

            {/* Region breakdown */}
            <section style={{ marginBottom: 24 }}>
              <p
                className="section-label"
                style={{ marginBottom: 10 }}
              >
                Lessons by region
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {regions.map((r) => {
                  const regionLessons = lessons.filter((l) => l.region_id === r.id);
                  const total = regionLessons.length;
                  const done = regionLessons.filter((l) =>
                    completedIds.has(l.id)
                  ).length;
                  const pct = total ? Math.round((done / total) * 100) : 0;
                  return (
                    <div
                      key={r.id}
                      className="flex items-center"
                      style={{ gap: 12 }}
                    >
                      <span
                        className="truncate"
                        style={{
                          fontSize: 13,
                          color: "var(--color-text-secondary)",
                          width: 120,
                          letterSpacing: "-0.005em",
                        }}
                      >
                        {r.name}
                      </span>
                      <div
                        className="flex-1 overflow-hidden"
                        style={{
                          height: 4,
                          borderRadius: 2,
                          background: "var(--color-fill-secondary, rgba(20,20,24,0.06))",
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            width: `${pct}%`,
                            background: "var(--color-accent)",
                            transition:
                              "width 250ms cubic-bezier(0.25, 0.1, 0.25, 1)",
                          }}
                        />
                      </div>
                      <span
                        style={{
                          fontSize: 12,
                          color: "var(--color-text-tertiary)",
                          fontVariantNumeric: "tabular-nums",
                          width: 48,
                          textAlign: "right",
                        }}
                      >
                        {done}/{total}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Discount + verification */}
            <section
              className="surface-resting"
              style={{
                background: "var(--color-bg-card)",
                borderRadius: 12,
                padding: 16,
                marginBottom: 24,
              }}
            >
              <p
                className="section-label"
                style={{ marginBottom: 8 }}
              >
                Discount
              </p>
              <p
                style={{
                  fontSize: 13,
                  color: "var(--color-text-secondary)",
                  marginBottom: 14,
                  letterSpacing: "-0.005em",
                }}
              >
                {discountRequest
                  ? `Application: ${discountRequest.status}${discountRequest.promo_code ? ` · ${discountRequest.promo_code}` : ""}`
                  : "No application submitted"}
              </p>
              <label
                className="flex items-start cursor-pointer"
                style={{ gap: 10 }}
              >
                <input
                  type="checkbox"
                  checked={student.ad_submissions_verified ?? false}
                  disabled={savingVerification}
                  onChange={(e) => toggleAdSubmissionsVerified(e.target.checked)}
                  className="rounded accent-[var(--color-accent)]"
                  style={{ marginTop: 2 }}
                />
                <span style={{ fontSize: 13 }}>
                  <span
                    style={{
                      display: "block",
                      fontWeight: 500,
                      color: "var(--color-text-primary)",
                      letterSpacing: "-0.005em",
                    }}
                  >
                    Ad submissions verified
                  </span>
                  <span
                    style={{
                      color: "var(--color-text-tertiary)",
                      fontSize: 12,
                    }}
                  >
                    Required before discount approval. Tick after confirming
                    submissions in Discord.
                  </span>
                </span>
              </label>
            </section>

            {/* Footer link to full detail */}
            <div
              style={{
                paddingTop: 16,
                borderTop: "1px solid var(--color-border)",
              }}
            >
              <Link
                href={`/admin/students/${student.id}`}
                className="inline-flex items-center"
                style={{
                  gap: 6,
                  fontSize: 13,
                  color: "var(--color-accent-dark)",
                  textDecoration: "none",
                  letterSpacing: "-0.005em",
                }}
              >
                Open full detail page
                <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </Link>
            </div>
          </div>
        )}
      </aside>
    </>
  );
}

function Stat({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className="surface-resting"
      style={{
        background: "var(--color-bg-card)",
        borderRadius: 10,
        padding: 12,
      }}
    >
      <p
        style={{
          fontSize: 10,
          fontWeight: 500,
          color: "var(--color-text-tertiary)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        {label}
      </p>
      <p
        style={{
          fontSize: 18,
          fontWeight: 600,
          color: accent
            ? "var(--color-accent-dark)"
            : "var(--color-text-primary)",
          marginTop: 4,
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "-0.018em",
          lineHeight: 1.05,
        }}
      >
        {value}
      </p>
    </div>
  );
}
