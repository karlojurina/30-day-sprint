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
  StudentStreaks,
  StudentWhopSync,
} from "@/types/database";
import { getDayNumber } from "@/types/database";
import { LESSON_TYPE_LABELS, progressPercent } from "@/lib/constants";
import Link from "next/link";
import {
  AdminPage,
  Section,
  Card,
  Stat,
  Pill,
  PacePill,
  Avatar,
  T,
  type PillTone,
} from "@/components/admin/ui";
import { buildPaceSummary } from "@/lib/csm-triggers";
import type { RegionId } from "@/types/database";

export default function StudentDetailPage() {
  const params = useParams();
  const studentId = params.id as string;
  const supabase = createClient();

  const [student, setStudent] = useState<Student | null>(null);
  const [regions, setRegions] = useState<Region[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [completions, setCompletions] = useState<StudentLessonCompletion[]>([]);
  const [discountRequest, setDiscountRequest] = useState<DiscountRequest | null>(null);
  // v46 — per-function sibling tables joined into the admin detail view.
  const [streaks, setStreaks] = useState<StudentStreaks | null>(null);
  const [whopSync, setWhopSync] = useState<StudentWhopSync | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchStudent() {
      const [
        studentRes,
        regionsRes,
        lessonsRes,
        completionsRes,
        discountRes,
        streaksRes,
        whopSyncRes,
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
        supabase
          .from("student_streaks")
          .select("*")
          .eq("student_id", studentId)
          .maybeSingle(),
        supabase
          .from("student_whop_sync")
          .select("*")
          .eq("student_id", studentId)
          .maybeSingle(),
      ]);

      if (studentRes.data) setStudent(studentRes.data);
      if (regionsRes.data) setRegions(regionsRes.data);
      if (lessonsRes.data) setLessons(lessonsRes.data);
      if (completionsRes.data) setCompletions(completionsRes.data);
      if (discountRes.data) setDiscountRequest(discountRes.data);
      if (streaksRes.data) setStreaks(streaksRes.data as StudentStreaks);
      if (whopSyncRes.data) setWhopSync(whopSyncRes.data as StudentWhopSync);
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

  // Highest region with any completion — drives the region-pace pill.
  const lessonRegion = new Map(lessons.map((l) => [l.id, l.region_id]));
  const REGION_ORDER: RegionId[] = ["r1", "r2", "r3", "r4"];
  let currentRegion: RegionId = "r1";
  for (const lessonId of completedIds) {
    const rid = lessonRegion.get(lessonId) as RegionId | undefined;
    if (rid && REGION_ORDER.indexOf(rid) > REGION_ORDER.indexOf(currentRegion)) {
      currentRegion = rid;
    }
  }
  const pace = buildPaceSummary(
    student.joined_at,
    completedIds.size,
    lessons.length,
    currentRegion,
  );

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
    <AdminPage>
      {/* Header — back button + name + membership pill in line */}
      <div
        className="flex items-center gap-3 flex-wrap"
        style={{ marginBottom: 24 }}
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
          }}
        >
          <svg
            width="18"
            height="18"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <Avatar src={student.avatar_url} name={student.name} size={36} />
        <div className="flex-1 min-w-0">
          <h1
            style={{
              ...T.display,
              fontSize: 24,
              letterSpacing: "-0.022em",
            }}
          >
            {student.name || "Student"}
          </h1>
          <p style={{ ...T.meta, marginTop: 2 }}>
            {student.email ?? "—"} · Day {dayNumber}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Pill tone={statusTone(student.membership_status)}>
            <span style={{ textTransform: "capitalize" }}>
              {student.membership_status.replace("_", " ")}
            </span>
          </Pill>
          <PacePill label={pace.progressLabel} />
          {pace.regionPace !== "on_pace" && (
            <Pill tone={pace.regionPace === "behind" ? "warning" : "accent"}>
              <span>
                Region{" "}
                {pace.regionPace === "behind"
                  ? `behind · in ${pace.currentRegion.toUpperCase()}, expected ${pace.expectedRegion.toUpperCase()}`
                  : `ahead · in ${pace.currentRegion.toUpperCase()}, expected ${pace.expectedRegion.toUpperCase()}`}
              </span>
            </Pill>
          )}
        </div>
      </div>

      {/* Stat row */}
      <div
        className="grid grid-cols-2 lg:grid-cols-4"
        style={{ gap: 12, marginBottom: 16 }}
      >
        <Stat label="Progress" value={`${overallPercent}%`} tone="accent" />
        <Stat label="Streak" value={`${streaks?.current_streak ?? 0}d`} />
        <Stat
          label="Joined"
          value={new Date(student.joined_at).toLocaleDateString()}
        />
        <Stat
          label="Last active"
          value={new Date(student.last_active_at).toLocaleDateString()}
        />
      </div>

      {/* CSM exempt — flip to hide a dummy / team test account from
          task generation + Day-28 DM. */}
      <Card
        padding={14}
        style={{
          marginBottom: 32,
          background: student.csm_exempt
            ? "rgba(212,162,76,0.10)"
            : "var(--color-bg-card)",
        }}
      >
        <label
          className="flex items-center"
          style={{ gap: 10, cursor: "pointer" }}
        >
          <input
            type="checkbox"
            checked={student.csm_exempt}
            onChange={async (e) => {
              const next = e.currentTarget.checked;
              const { error } = await supabase
                .from("students")
                .update({ csm_exempt: next })
                .eq("id", student.id);
              if (!error) setStudent({ ...student, csm_exempt: next });
            }}
          />
          <span style={T.bodyDim}>
            <strong style={{ color: "var(--color-text-primary)" }}>
              Exempt from CSM
            </strong>
            {" — "}
            {student.csm_exempt
              ? "Hidden from task queue + skipped by Day-28 DM."
              : "Mark this account as a team test / dummy."}
          </span>
        </label>
      </Card>

      {/* Whop sync diagnostic */}
      <Section
        eyebrow="Whop sync"
        action={
          whopSync?.last_sync_at ? (
            <span style={T.meta}>
              Last synced{" "}
              {new Date(whopSync.last_sync_at).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          ) : undefined
        }
      >
        <Card padding={20}>
          <div
            className="grid grid-cols-3"
            style={{ gap: 16, marginBottom: 14 }}
          >
            <SyncStat label="Fetched" value={whopSync?.last_sync_fetched ?? null} />
            <SyncStat
              label="Matched"
              value={whopSync?.last_sync_matched ?? null}
              accent
            />
            <SyncStat
              label="Unmatched"
              value={whopSync?.last_sync_unmatched?.length ?? 0}
              warn={(whopSync?.last_sync_unmatched?.length ?? 0) > 0}
            />
          </div>

          {whopSync?.last_sync_error && (
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
              <strong>Last error:</strong> {whopSync.last_sync_error}
            </div>
          )}

          {whopSync?.last_sync_unmatched &&
            whopSync.last_sync_unmatched.length > 0 && (
              <div>
                <p style={{ ...T.bodyDim, fontSize: 12, marginBottom: 8 }}>
                  These Whop lesson IDs were fetched from this student&apos;s
                  watch history but don&apos;t match any lesson in our DB.
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
                  {whopSync.last_sync_unmatched.map((id) => (
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

          {whopSync && whopSync.last_sync_unmatched?.length === 0 && (
            <p style={{ fontSize: 12, color: "var(--color-success)" }}>
              All Whop lessons this student has watched are mapped. ✓
            </p>
          )}
        </Card>
      </Section>

      {/* Lesson grid by region */}
      <Section eyebrow="Lesson progress">
        <Card padding={20}>
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {regions.map((region) => (
              <div key={region.id}>
                <p style={{ ...T.bodyDim, fontSize: 12, marginBottom: 8 }}>
                  {region.name} — {region.subtitle} ({region.days_label})
                </p>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
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
                              ? "1px solid var(--color-accent-dark)"
                              : "1px solid var(--color-border-strong)",
                            background: done
                              ? "var(--color-accent-dark)"
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
                        <span style={T.meta}>
                          ({LESSON_TYPE_LABELS[lesson.type]})
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </Section>

      <Section eyebrow="Discount">
        <Card padding={20}>
          <p style={{ ...T.bodyDim, fontSize: 12, marginBottom: 12 }}>
            Gate lesson (l18): {gateCompleted ? "completed" : "not yet"}
          </p>
          {discountRequest ? (
            <DiscountStatusPill
              status={discountRequest.status}
              promoCode={discountRequest.promo_code ?? undefined}
            />
          ) : (
            <span style={T.meta}>No application submitted</span>
          )}

          <div
            style={{
              marginTop: 16,
              paddingTop: 16,
              borderTop: "1px solid var(--color-border)",
            }}
          >
            <label
              className="flex items-start cursor-pointer"
              style={{ gap: 12 }}
            >
              <input
                type="checkbox"
                checked={student.ad_submissions_verified ?? false}
                onChange={async (e) => {
                  const verified = e.target.checked;
                  const prev = student.ad_submissions_verified ?? false;
                  setStudent({
                    ...student,
                    ad_submissions_verified: verified,
                  });
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
                    body: JSON.stringify({
                      studentId: student.id,
                      verified,
                    }),
                  });
                  if (!res.ok) {
                    setStudent({
                      ...student,
                      ad_submissions_verified: prev,
                    });
                  }
                }}
                style={{ marginTop: 2 }}
              />
              <div>
                <p style={{ ...T.body, fontWeight: 500 }}>
                  Ad submissions verified
                </p>
                <p style={{ ...T.meta, marginTop: 2 }}>
                  Tick this once you&rsquo;ve confirmed the student submitted
                  all action items in the Discord ad-review channel. Required
                  for discount approval.
                </p>
              </div>
            </label>
          </div>
        </Card>
      </Section>

      <Section eyebrow="Quick DM templates">
        <Card padding={20}>
          <div className="flex flex-wrap" style={{ gap: 8 }}>
            {dmTemplates.map((tmpl) => (
              <button
                key={tmpl.label}
                onClick={() => navigator.clipboard.writeText(tmpl.text)}
                style={{
                  padding: "6px 14px",
                  borderRadius: 8,
                  border: "1px solid var(--color-border)",
                  background: "var(--color-bg-elevated)",
                  color: "var(--color-text-primary)",
                  fontSize: 13,
                  fontWeight: 500,
                  letterSpacing: "-0.005em",
                  cursor: "pointer",
                }}
              >
                {tmpl.label}
              </button>
            ))}
          </div>
          <p style={{ ...T.meta, marginTop: 10 }}>
            Click to copy message to clipboard
          </p>
        </Card>
      </Section>
    </AdminPage>
  );
}

function statusTone(status: Student["membership_status"]): PillTone {
  if (status === "active") return "success";
  if (status === "canceled") return "danger";
  if (status === "past_due") return "warning";
  return "neutral";
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
  const tone: PillTone =
    status === "approved"
      ? "success"
      : status === "pending"
        ? "warning"
        : "danger";
  return (
    <Pill tone={tone}>
      <span style={{ textTransform: "capitalize" }}>
        {status}
        {promoCode && ` · ${promoCode}`}
      </span>
    </Pill>
  );
}
