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
    <div
      className="px-12 pt-12 pb-16"
      style={{ maxWidth: 1180, margin: "0 auto" }}
    >
      {/* Header */}
      <div
        className="flex items-center"
        style={{ gap: 12, marginBottom: 32 }}
      >
        <Link
          href="/admin/students"
          aria-label="Back to students"
          style={{
            color: "var(--color-text-secondary)",
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            borderRadius: 8,
            transition: "background 150ms cubic-bezier(0.25,0.1,0.25,1)",
          }}
        >
          <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1
            style={{
              fontSize: 26,
              fontWeight: 600,
              letterSpacing: "-0.022em",
              lineHeight: 1.15,
              color: "var(--color-text-primary)",
            }}
          >
            {student.name || "Student"}
          </h1>
          <p
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
      </div>

      {/* Stat row */}
      <div
        className="grid grid-cols-2 lg:grid-cols-4"
        style={{ gap: 12, marginBottom: 32 }}
      >
        <Stat label="Progress" value={`${overallPercent}%`} accent />
        <Stat
          label="Streak"
          value={`${student.current_streak ?? 0}d`}
        />
        <Stat
          label="Joined"
          value={new Date(student.joined_at).toLocaleDateString()}
        />
        <Stat
          label="Last active"
          value={new Date(student.last_active_at).toLocaleDateString()}
        />
      </div>

      {/* Whop sync diagnostic */}
      <div
        className="surface-resting"
        style={{
          background: "var(--color-bg-card)",
          borderRadius: 12,
          padding: 20,
          marginBottom: 16,
        }}
      >
        <div
          className="flex items-center justify-between"
          style={{ marginBottom: 14 }}
        >
          <h2
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "var(--color-text-primary)",
              letterSpacing: "-0.011em",
            }}
          >
            Whop sync
          </h2>
          {student.last_watch_sync_at && (
            <span
              style={{
                fontSize: 11,
                color: "var(--color-text-tertiary)",
                letterSpacing: "-0.005em",
              }}
            >
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
        <div className="grid grid-cols-3" style={{ gap: 16, marginBottom: 14 }}>
          <SyncStat label="Fetched" value={student.whop_last_sync_fetched_count} />
          <SyncStat
            label="Matched"
            value={student.whop_last_sync_matched_count}
            accent
          />
          <SyncStat
            label="Unmatched"
            value={student.whop_last_sync_unmatched?.length ?? 0}
            warn={(student.whop_last_sync_unmatched?.length ?? 0) > 0}
          />
        </div>

        {student.whop_last_sync_error && (
          <div
            style={{
              padding: "8px 10px",
              borderRadius: 8,
              background: "rgba(200,74,74,0.08)",
              fontSize: 12,
              color: "var(--color-danger)",
              marginBottom: 10,
            }}
          >
            <strong>Last error:</strong> {student.whop_last_sync_error}
          </div>
        )}

        {student.whop_last_sync_unmatched &&
          student.whop_last_sync_unmatched.length > 0 && (
            <div>
              <p
                style={{
                  fontSize: 12,
                  color: "var(--color-text-secondary)",
                  marginBottom: 8,
                }}
              >
                These Whop lesson IDs were fetched from this student&apos;s watch
                history but don&apos;t match any lesson in our DB.
              </p>
              <div
                style={{
                  padding: 12,
                  borderRadius: 8,
                  background: "var(--color-bg-elevated)",
                  maxHeight: 192,
                  overflowY: "auto",
                }}
              >
                {student.whop_last_sync_unmatched.map((id) => (
                  <p
                    key={id}
                    className="select-all"
                    style={{
                      fontSize: 11,
                      fontFamily: "var(--font-mono)",
                      color: "var(--color-text-secondary)",
                    }}
                  >
                    {id}
                  </p>
                ))}
              </div>
            </div>
          )}

        {student.whop_last_sync_unmatched?.length === 0 && (
          <p
            style={{
              fontSize: 12,
              color: "var(--color-success)",
              letterSpacing: "-0.005em",
            }}
          >
            All Whop lessons this student has watched are mapped. ✓
          </p>
        )}
      </div>

      {/* Lesson grid by region */}
      <div
        className="surface-resting"
        style={{
          background: "var(--color-bg-card)",
          borderRadius: 12,
          padding: 20,
          marginBottom: 16,
        }}
      >
        <h2
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "var(--color-text-primary)",
            letterSpacing: "-0.011em",
            marginBottom: 14,
          }}
        >
          Lesson progress
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {regions.map((region) => (
            <div key={region.id}>
              <p
                style={{
                  fontSize: 12,
                  color: "var(--color-text-secondary)",
                  marginBottom: 8,
                  letterSpacing: "-0.005em",
                }}
              >
                {region.name} — {region.subtitle} ({region.days_label})
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {(lessonsByRegion[region.id] || []).map((lesson) => {
                  const done = completedIds.has(lesson.id);
                  return (
                    <div
                      key={lesson.id}
                      className="flex items-center"
                      style={{ gap: 8, fontSize: 13 }}
                    >
                      <div
                        className="flex items-center justify-center"
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: 4,
                          border: done
                            ? "1px solid var(--color-accent)"
                            : "1px solid var(--color-border-strong)",
                          background: done
                            ? "var(--color-accent)"
                            : "transparent",
                          flexShrink: 0,
                        }}
                      >
                        {done && (
                          <svg
                            width="9"
                            height="9"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="#FFFFFF"
                            strokeWidth={4}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                      <span
                        style={{
                          color: done
                            ? "var(--color-text-tertiary)"
                            : "var(--color-text-primary)",
                          textDecoration: done ? "line-through" : "none",
                          letterSpacing: "-0.005em",
                        }}
                      >
                        Day {lesson.day}: {lesson.title}
                      </span>
                      <span
                        style={{
                          color: "var(--color-text-tertiary)",
                          fontSize: 12,
                        }}
                      >
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

      <div
        className="surface-resting"
        style={{
          background: "var(--color-bg-card)",
          borderRadius: 12,
          padding: 20,
          marginBottom: 16,
        }}
      >
        <h2
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "var(--color-text-primary)",
            letterSpacing: "-0.011em",
            marginBottom: 14,
          }}
        >
          Discount
        </h2>
        <p
          style={{
            fontSize: 12,
            color: "var(--color-text-secondary)",
            marginBottom: 12,
          }}
        >
          Gate lesson (l18): {gateCompleted ? "completed" : "not yet"}
        </p>
        {discountRequest ? (
          <DiscountStatusPill
            status={discountRequest.status}
            promoCode={discountRequest.promo_code ?? undefined}
          />
        ) : (
          <span style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>
            No application submitted
          </span>
        )}

        <div
          style={{
            marginTop: 16,
            paddingTop: 16,
            borderTop: "1px solid var(--color-border)",
          }}
        >
          <label className="flex items-start cursor-pointer" style={{ gap: 12 }}>
            <input
              type="checkbox"
              checked={student.ad_submissions_verified ?? false}
              onChange={async (e) => {
                const verified = e.target.checked;
                const prev = student.ad_submissions_verified ?? false;
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
                  setStudent({ ...student, ad_submissions_verified: prev });
                }
              }}
              className="rounded accent-[var(--color-accent)]"
              style={{ marginTop: 2 }}
            />
            <div>
              <p
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: "var(--color-text-primary)",
                  letterSpacing: "-0.005em",
                }}
              >
                Ad submissions verified
              </p>
              <p
                style={{
                  fontSize: 12,
                  color: "var(--color-text-tertiary)",
                  marginTop: 2,
                }}
              >
                Tick this once you&rsquo;ve confirmed the student submitted
                all action items in the Discord ad-review channel. Required
                for discount approval.
              </p>
            </div>
          </label>
        </div>
      </div>

      {/* Quick DM templates */}
      <div
        className="surface-resting"
        style={{
          background: "var(--color-bg-card)",
          borderRadius: 12,
          padding: 20,
        }}
      >
        <h2
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "var(--color-text-primary)",
            letterSpacing: "-0.011em",
            marginBottom: 12,
          }}
        >
          Quick DM templates
        </h2>
        <div className="flex flex-wrap" style={{ gap: 6 }}>
          {dmTemplates.map((tmpl) => (
            <button
              key={tmpl.label}
              onClick={() => navigator.clipboard.writeText(tmpl.text)}
              style={{
                padding: "5px 12px",
                borderRadius: 7,
                border: "none",
                background: "var(--color-bg-elevated)",
                color: "var(--color-text-secondary)",
                fontSize: 13,
                fontWeight: 500,
                letterSpacing: "-0.005em",
                cursor: "pointer",
                transition:
                  "all 150ms cubic-bezier(0.25,0.1,0.25,1)",
              }}
            >
              {tmpl.label}
            </button>
          ))}
        </div>
        <p
          style={{
            fontSize: 11,
            color: "var(--color-text-tertiary)",
            marginTop: 10,
          }}
        >
          Click to copy message to clipboard
        </p>
      </div>
    </div>
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
        borderRadius: 12,
        padding: 16,
      }}
    >
      <p
        style={{
          fontSize: 11,
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
          fontSize: 22,
          fontWeight: 600,
          color: accent
            ? "var(--color-accent-dark)"
            : "var(--color-text-primary)",
          marginTop: 4,
          letterSpacing: "-0.022em",
          lineHeight: 1.05,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </p>
    </div>
  );
}

function SyncStat({
  label,
  value,
  accent = false,
  warn = false,
}: {
  label: string;
  value: number | string | null | undefined;
  accent?: boolean;
  warn?: boolean;
}) {
  const color = warn
    ? "var(--color-warning)"
    : accent
      ? "var(--color-accent-dark)"
      : "var(--color-text-primary)";
  return (
    <div>
      <p
        style={{
          fontSize: 11,
          fontWeight: 500,
          color: "var(--color-text-tertiary)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          marginBottom: 4,
        }}
      >
        {label}
      </p>
      <p
        style={{
          fontSize: 18,
          fontWeight: 600,
          color,
          letterSpacing: "-0.018em",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value ?? "—"}
      </p>
    </div>
  );
}

function DiscountStatusPill({
  status,
  promoCode,
}: {
  status: string;
  promoCode?: string;
}) {
  const tone =
    status === "approved"
      ? { color: "var(--color-success)", bg: "rgba(46,139,87,0.10)" }
      : status === "pending"
        ? { color: "var(--color-warning)", bg: "rgba(212,162,76,0.12)" }
        : { color: "var(--color-danger)", bg: "rgba(200,74,74,0.10)" };
  return (
    <span
      style={{
        display: "inline-block",
        padding: "4px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 500,
        color: tone.color,
        background: tone.bg,
        letterSpacing: "-0.005em",
        textTransform: "capitalize",
      }}
    >
      {status}
      {promoCode && ` · ${promoCode}`}
    </span>
  );
}
