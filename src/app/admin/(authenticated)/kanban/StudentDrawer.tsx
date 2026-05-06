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
import { TOTAL_LESSONS } from "@/lib/constants";

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

  const overallPercent = student
    ? Math.round((completedIds.size / TOTAL_LESSONS) * 100)
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
      {/* Backdrop */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close drawer"
        className="fixed inset-0 z-40"
        style={{
          background: "rgba(6,12,26,0.55)",
          backdropFilter: "blur(2px)",
          animation: "overlay-in 0.25s cubic-bezier(0.22, 1, 0.36, 1) both",
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
          borderLeft: "1px solid var(--color-border-hover)",
          boxShadow: "-24px 0 48px rgba(0,0,0,0.5)",
          animation: "slide-in-right 0.32s cubic-bezier(0.22, 1, 0.36, 1) both",
        }}
      >
        {loading || !student ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="p-6 space-y-5">
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2
                  id="drawer-student-name"
                  className="text-lg font-semibold text-text-primary truncate"
                >
                  {student.name || "Unnamed student"}
                </h2>
                <p className="text-xs text-text-secondary truncate">
                  {student.email} · Day {dayNumber} · {student.membership_status}
                </p>
              </div>
              <button
                onClick={onClose}
                aria-label="Close drawer"
                className="text-text-tertiary hover:text-text-primary p-1 -m-1"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Stat cards */}
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Progress" value={`${overallPercent}%`} />
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
            <section>
              <h3 className="text-xs font-mono uppercase tracking-widest text-text-secondary mb-2">
                Lessons by region
              </h3>
              <div className="space-y-1.5">
                {regions.map((r) => {
                  const regionLessons = lessons.filter((l) => l.region_id === r.id);
                  const total = regionLessons.length;
                  const done = regionLessons.filter((l) =>
                    completedIds.has(l.id)
                  ).length;
                  const pct = total ? Math.round((done / total) * 100) : 0;
                  return (
                    <div key={r.id} className="flex items-center gap-3">
                      <span className="text-xs text-text-secondary w-32 truncate">
                        {r.name}
                      </span>
                      <div
                        className="flex-1 rounded-full overflow-hidden"
                        style={{
                          height: 4,
                          background: "rgba(230,192,122,0.12)",
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            width: `${pct}%`,
                            background: "var(--color-gold)",
                          }}
                        />
                      </div>
                      <span className="text-[10px] font-mono tabular-nums text-text-tertiary w-12 text-right">
                        {done}/{total}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Discount + verification toggle */}
            <section className="bg-bg-card border border-border rounded-xl p-3">
              <h3 className="text-xs font-mono uppercase tracking-widest text-text-secondary mb-2">
                Discount
              </h3>
              <p className="text-xs text-text-secondary mb-2">
                {discountRequest
                  ? `Application: ${discountRequest.status}${discountRequest.promo_code ? ` — ${discountRequest.promo_code}` : ""}`
                  : "No application submitted"}
              </p>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={student.ad_submissions_verified ?? false}
                  disabled={savingVerification}
                  onChange={(e) => toggleAdSubmissionsVerified(e.target.checked)}
                  className="mt-0.5 rounded accent-[var(--color-gold)] focus-visible:outline-2 focus-visible:outline-[var(--color-gold)] focus-visible:outline-offset-2"
                />
                <span className="text-xs">
                  <span className="font-medium text-text-primary block">
                    Ad submissions verified
                  </span>
                  <span className="text-text-tertiary">
                    Required before discount approval. Tick after confirming
                    submissions in Discord.
                  </span>
                </span>
              </label>
            </section>

            {/* Footer link to full detail */}
            <div className="pt-2 border-t border-border">
              <Link
                href={`/admin/students/${student.id}`}
                className="text-xs text-accent-light hover:text-accent transition-colors inline-flex items-center gap-1.5"
              >
                Open full detail page
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </Link>
            </div>
          </div>
        )}
      </aside>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg-card border border-border rounded-lg p-2.5">
      <p className="text-[10px] font-mono uppercase tracking-widest text-text-tertiary">
        {label}
      </p>
      <p className="text-base font-medium text-text-primary tabular-nums mt-0.5">
        {value}
      </p>
    </div>
  );
}
