"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import type {
  Student,
  Region,
  Lesson,
  StudentLessonCompletion,
  DiscountRequest,
} from "@/types/database";
import { getDayNumber } from "@/types/database";
import { LESSON_TYPE_LABELS, progressPercent } from "@/lib/constants";
import Link from "next/link";

export default function StudentDetailPage() {
  const params = useParams();
  const studentId = params.id as string;
  const supabase = createClient();

  const [student, setStudent] = useState<Student | null>(null);
  const [regions, setRegions] = useState<Region[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [completions, setCompletions] = useState<StudentLessonCompletion[]>([]);
  const [discountRequest, setDiscountRequest] = useState<DiscountRequest | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchStudent() {
      const [
        studentRes,
        regionsRes,
        lessonsRes,
        completionsRes,
        discountRes,
      ] = await Promise.all([
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

    fetchStudent();
  }, [studentId, supabase]);

  if (loading || !student) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const completedIds = new Set(completions.map((c) => c.lesson_id));
  const dayNumber = getDayNumber(student.joined_at);
  const overallPercent = progressPercent(completedIds.size, lessons.length);

  // Group lessons by region
  const lessonsByRegion: Record<string, Lesson[]> = {};
  for (const lesson of lessons) {
    if (!lessonsByRegion[lesson.region_id]) lessonsByRegion[lesson.region_id] = [];
    lessonsByRegion[lesson.region_id].push(lesson);
  }

  // Discount status
  const gateCompleted = completedIds.has("l18");

  // DM templates
  const dmTemplates = [
    {
      label: "Welcome",
      text: `Hey ${student.name || "there"}! Welcome to EcomTalent. I'm here to help you get the most out of your first 30 days. Have you checked out your expedition map yet? Let me know if you have any questions!`,
    },
    {
      label: "Check-in",
      text: `Hey ${student.name || "there"}! Just checking in — how's everything going? I noticed you're on Day ${dayNumber}. Is there anything I can help you with?`,
    },
    {
      label: "Encouragement",
      text: `Hey ${student.name || "there"}! You're making great progress — ${overallPercent}% through your expedition. Keep going! The next region is where things really click.`,
    },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/admin/students"
          className="text-text-secondary hover:text-text-primary transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-xl font-bold">{student.name || "Student"}</h1>
          <p className="text-sm text-text-secondary">
            {student.email} — Day {dayNumber} — {student.membership_status}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-bg-card border border-border rounded-xl p-3">
          <p className="text-xs text-text-secondary">Progress</p>
          <p className="text-xl font-bold text-accent-light">{overallPercent}%</p>
        </div>
        <div className="bg-bg-card border border-border rounded-xl p-3">
          <p className="text-xs text-text-secondary">Streak</p>
          <p className="text-xl font-bold">{student.current_streak ?? 0} days</p>
        </div>
        <div className="bg-bg-card border border-border rounded-xl p-3">
          <p className="text-xs text-text-secondary">Joined</p>
          <p className="text-sm font-medium">
            {new Date(student.joined_at).toLocaleDateString()}
          </p>
        </div>
        <div className="bg-bg-card border border-border rounded-xl p-3">
          <p className="text-xs text-text-secondary">Last Active</p>
          <p className="text-sm font-medium">
            {new Date(student.last_active_at).toLocaleDateString()}
          </p>
        </div>
      </div>

      {/* Whop sync diagnostic */}
      <div className="bg-bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold">Whop Sync</h2>
          {student.last_watch_sync_at && (
            <span className="text-[10px] text-text-tertiary font-mono uppercase tracking-widest">
              Last synced{" "}
              {new Date(student.last_watch_sync_at).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          )}
        </div>
        <div className="grid grid-cols-3 gap-3 mb-3">
          <div>
            <p className="text-[10px] text-text-tertiary font-mono uppercase tracking-widest mb-1">
              Fetched from Whop
            </p>
            <p className="text-base font-semibold">
              {student.whop_last_sync_fetched_count ?? "—"}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-text-tertiary font-mono uppercase tracking-widest mb-1">
              Matched
            </p>
            <p className="text-base font-semibold text-accent-light">
              {student.whop_last_sync_matched_count ?? "—"}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-text-tertiary font-mono uppercase tracking-widest mb-1">
              Unmatched
            </p>
            <p
              className={`text-base font-semibold ${
                (student.whop_last_sync_unmatched?.length ?? 0) > 0
                  ? "text-warning"
                  : "text-text-secondary"
              }`}
            >
              {student.whop_last_sync_unmatched?.length ?? 0}
            </p>
          </div>
        </div>

        {student.whop_last_sync_error && (
          <div className="mb-3 p-2 rounded bg-danger/10 border border-danger/30 text-xs text-danger">
            <strong>Last error:</strong> {student.whop_last_sync_error}
          </div>
        )}

        {student.whop_last_sync_unmatched &&
          student.whop_last_sync_unmatched.length > 0 && (
            <div>
              <p className="text-xs text-text-secondary mb-2">
                These Whop lesson IDs were fetched from this student&apos;s watch
                history but don&apos;t match any lesson in our DB. Map them with{" "}
                <code className="text-[11px] px-1 py-0.5 rounded bg-bg-elevated">
                  UPDATE lessons SET whop_lesson_id = &apos;lesn_XXX&apos; WHERE id
                  = &apos;lYYY&apos;;
                </code>
              </p>
              <div className="p-3 rounded bg-bg-elevated border border-border">
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {student.whop_last_sync_unmatched.map((id) => (
                    <p
                      key={id}
                      className="text-[11px] font-mono text-text-secondary select-all"
                    >
                      {id}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          )}

        {student.whop_last_sync_unmatched?.length === 0 && (
          <p className="text-xs text-success">
            All Whop lessons this student has watched are mapped. ✓
          </p>
        )}
      </div>

      {/* Lesson grid by region */}
      <div className="bg-bg-card border border-border rounded-xl p-4">
        <h2 className="text-sm font-semibold mb-3">Lesson Progress</h2>
        <div className="space-y-4">
          {regions.map((region) => (
            <div key={region.id}>
              <p className="text-xs text-text-secondary mb-2">
                {region.name} — {region.subtitle} ({region.days_label})
              </p>
              <div className="space-y-1">
                {(lessonsByRegion[region.id] || []).map((lesson) => {
                  const done = completedIds.has(lesson.id);
                  return (
                    <div
                      key={lesson.id}
                      className="flex items-center gap-2 text-xs"
                    >
                      <div
                        className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${
                          done ? "bg-accent border-accent" : "border-border"
                        }`}
                      >
                        {done && (
                          <svg
                            className="w-2 h-2 text-white"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={4}
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                      <span
                        className={
                          done ? "text-text-secondary line-through" : "text-text-primary"
                        }
                      >
                        Day {lesson.day}: {lesson.title}
                      </span>
                      <span className="text-text-tertiary">
                        ({LESSON_TYPE_LABELS[lesson.type]})
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-bg-card border border-border rounded-xl p-4">
        <h2 className="text-sm font-semibold mb-2">Discount Status</h2>
        <p className="text-xs text-text-secondary mb-2">
          Gate lesson (l18): {gateCompleted ? "completed" : "not yet"}
        </p>
        {discountRequest ? (
          <span
            className={`text-xs font-semibold uppercase px-2 py-1 rounded ${
              discountRequest.status === "approved"
                ? "bg-success/15 text-success"
                : discountRequest.status === "pending"
                  ? "bg-warning/15 text-warning"
                  : "bg-danger/15 text-danger"
            }`}
          >
            {discountRequest.status}
            {discountRequest.promo_code && ` — ${discountRequest.promo_code}`}
          </span>
        ) : (
          <span className="text-xs text-text-tertiary">No application submitted</span>
        )}

        {/* Ad-submissions verification toggle. Required for /api/discounts/approve
            to fire — if false, approval refuses with a clear error. */}
        <div className="mt-4 pt-4 border-t border-border">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={student.ad_submissions_verified ?? false}
              onChange={async (e) => {
                const verified = e.target.checked;
                const prev = student.ad_submissions_verified ?? false;
                // Optimistic update
                setStudent({ ...student, ad_submissions_verified: verified });
                const {
                  data: { session },
                } = await supabase.auth.getSession();
                const token = session?.access_token;
                if (!token) return;
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
              }}
              className="mt-0.5 rounded accent-[var(--color-gold)] focus-visible:outline-2 focus-visible:outline-[var(--color-gold)] focus-visible:outline-offset-2"
            />
            <div className="text-xs">
              <p className="font-medium text-text-primary">
                Ad submissions verified
              </p>
              <p className="text-text-tertiary mt-0.5">
                Tick this once you&rsquo;ve confirmed the student submitted
                all action items in the Discord ad-review channel. Required
                for discount approval.
              </p>
            </div>
          </label>
        </div>
      </div>

      <div className="bg-bg-card border border-border rounded-xl p-4">
        <h2 className="text-sm font-semibold mb-3">Quick DM Templates</h2>
        <div className="flex gap-2 flex-wrap">
          {dmTemplates.map((tmpl) => (
            <button
              key={tmpl.label}
              onClick={() => navigator.clipboard.writeText(tmpl.text)}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-bg-elevated hover:bg-accent/10 hover:text-accent-light transition-colors"
            >
              {tmpl.label}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-text-tertiary mt-2">
          Click to copy message to clipboard
        </p>
      </div>

    </div>
  );
}
