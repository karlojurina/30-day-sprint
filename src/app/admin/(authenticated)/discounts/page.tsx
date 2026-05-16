"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import type {
  DiscountRequest,
  Student,
  StudentLessonCompletion,
  Lesson,
} from "@/types/database";
import { useAuth } from "@/contexts/AuthContext";
import Link from "next/link";

type RequestWithStudent = DiscountRequest & { student: Student };
type FilterValue = "pending" | "approved" | "applied" | "rejected" | "all";

interface ActionSubmission {
  lessonId: string;
  title: string;
  shipped: boolean;
  link: string | null;
}

export default function DiscountsPage() {
  const [requests, setRequests] = useState<RequestWithStudent[]>([]);
  const [filter, setFilter] = useState<FilterValue>("pending");
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  // Per-student action submissions (lesson_id → link). Only fetched
  // for students whose request is currently rendered, so we don't pull
  // the whole completions table on every visit.
  const [submissionsByStudent, setSubmissionsByStudent] = useState<
    Record<string, ActionSubmission[]>
  >({});
  const supabase = createClient();
  const { teamMember } = useAuth();

  useEffect(() => {
    fetchRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  async function fetchRequests() {
    setLoading(true);
    let query = supabase
      .from("discount_requests")
      .select("*, student:students(*)")
      .order("created_at", { ascending: false });

    if (filter !== "all") {
      query = query.eq("status", filter);
    }

    const { data } = await query;
    const rows = (data as RequestWithStudent[]) || [];
    setRequests(rows);
    setLoading(false);

    // Bulk-fetch action submissions for these students.
    const studentIds = rows.map((r) => r.student_id).filter(Boolean);
    if (studentIds.length > 0) {
      const [lessonsRes, completionsRes] = await Promise.all([
        supabase
          .from("lessons")
          .select("id, title, requires_action, type")
          .or("requires_action.eq.true,type.eq.action"),
        supabase
          .from("student_lesson_completions")
          .select("student_id, lesson_id, completed_at, action_completed_at, discord_message_link")
          .in("student_id", studentIds),
      ]);
      const actionLessons = (lessonsRes.data ?? []) as Array<
        Pick<Lesson, "id" | "title" | "requires_action" | "type">
      >;
      const allComps = (completionsRes.data ?? []) as Array<
        Pick<
          StudentLessonCompletion,
          "student_id" | "lesson_id" | "completed_at" | "action_completed_at" | "discord_message_link"
        >
      >;
      const map: Record<string, ActionSubmission[]> = {};
      for (const sid of studentIds) map[sid] = [];
      for (const lesson of actionLessons) {
        for (const sid of studentIds) {
          const c = allComps.find(
            (x) => x.student_id === sid && x.lesson_id === lesson.id,
          );
          const shipped = lesson.requires_action
            ? Boolean(c?.action_completed_at)
            : Boolean(c?.completed_at);
          if (!c && !shipped) continue;
          map[sid].push({
            lessonId: lesson.id,
            title: lesson.title,
            shipped,
            link: c?.discord_message_link ?? null,
          });
        }
      }
      setSubmissionsByStudent(map);
    } else {
      setSubmissionsByStudent({});
    }
  }

  async function handleApprove(requestId: string) {
    setProcessing(requestId);
    try {
      const res = await fetch("/api/discounts/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId,
          reviewerId: teamMember?.id,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        fetchRequests();
      } else {
        alert(`Approve failed: ${data.error || "Unknown error"}`);
      }
    } catch (err) {
      alert(`Approve failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    setProcessing(null);
  }

  async function handleMarkApplied(requestId: string) {
    setProcessing(requestId);
    try {
      const res = await fetch("/api/discounts/mark-applied", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId,
          appliedBy: teamMember?.id,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        fetchRequests();
      } else {
        alert(`Mark applied failed: ${data.error || "Unknown error"}`);
      }
    } catch (err) {
      alert(`Mark applied failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    setProcessing(null);
  }

  async function handleReject(requestId: string) {
    const reason = prompt("Rejection reason (optional):");
    setProcessing(requestId);

    const { error } = await supabase
      .from("discount_requests")
      .update({
        status: "rejected",
        reviewed_by: teamMember?.id,
        reviewed_at: new Date().toISOString(),
        rejection_reason: reason || null,
      })
      .eq("id", requestId);

    if (!error) {
      fetchRequests();
    }

    setProcessing(null);
  }

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode((c) => (c === code ? null : c)), 1500);
    } catch {
      // ignore
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div
          className="rounded-full animate-spin"
          style={{
            width: 24,
            height: 24,
            border: "2px solid var(--color-accent)",
            borderTopColor: "transparent",
          }}
        />
      </div>
    );
  }

  return (
    <div
      className="px-12 pt-12 pb-16"
      style={{ maxWidth: 1180, margin: "0 auto" }}
    >
      <header style={{ marginBottom: 24 }}>
        <h1
          style={{
            fontSize: 32,
            fontWeight: 600,
            letterSpacing: "-0.025em",
            lineHeight: 1.15,
            color: "var(--color-text-primary)",
          }}
        >
          Discount applications
        </h1>
        <p
          style={{
            fontSize: 14,
            color: "var(--color-text-secondary)",
            marginTop: 4,
            letterSpacing: "-0.005em",
          }}
        >
          Review applications. Approval requires the student&rsquo;s ad
          submissions to be verified on their detail page first. Approve
          generates the Whop promo code; copy it, attach it to the student&rsquo;s
          subscription in the Whop dashboard, then click <em>Mark applied</em>.
        </p>
      </header>

      {/* Segmented filter */}
      <div
        style={{
          display: "inline-flex",
          background: "var(--color-bg-elevated)",
          borderRadius: 10,
          padding: 3,
          marginBottom: 24,
          gap: 1,
        }}
      >
        {(["pending", "approved", "applied", "rejected", "all"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: "5px 12px",
              borderRadius: 7,
              border: "none",
              background: filter === f ? "var(--color-bg-card)" : "transparent",
              color:
                filter === f
                  ? "var(--color-text-primary)"
                  : "var(--color-text-secondary)",
              fontSize: 13,
              fontWeight: filter === f ? 600 : 500,
              letterSpacing: "-0.005em",
              textTransform: "capitalize",
              cursor: "pointer",
              boxShadow:
                filter === f
                  ? "0 1px 2px rgba(20,20,24,0.06), 0 0 0 0.5px rgba(20,20,24,0.04)"
                  : "none",
              transition:
                "background 150ms cubic-bezier(0.25,0.1,0.25,1), color 150ms cubic-bezier(0.25,0.1,0.25,1)",
            }}
          >
            {f}
          </button>
        ))}
      </div>

      {requests.length === 0 ? (
        <div
          className="surface-resting"
          style={{
            background: "var(--color-bg-card)",
            borderRadius: 12,
            padding: 48,
            textAlign: "center",
            fontSize: 14,
            color: "var(--color-text-secondary)",
          }}
        >
          No {filter === "all" ? "" : filter} applications.
        </div>
      ) : (
        <div
          className="surface-resting"
          style={{
            background: "var(--color-bg-card)",
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          {requests.map((req) => (
            <div
              key={req.id}
              className="list-row"
              style={{
                padding: "16px",
                alignItems: "flex-start",
                gap: 12,
                flexDirection: "column",
              }}
            >
              <div className="flex items-start justify-between w-full">
                <div className="min-w-0">
                  <Link
                    href={`/admin/students/${req.student_id}`}
                    style={{
                      fontSize: 14,
                      fontWeight: 500,
                      color: "var(--color-text-primary)",
                      letterSpacing: "-0.011em",
                      textDecoration: "none",
                    }}
                  >
                    {req.student?.name || "Unknown"}
                  </Link>
                  <p
                    style={{
                      fontSize: 12,
                      color: "var(--color-text-secondary)",
                      marginTop: 2,
                    }}
                  >
                    Applied {new Date(req.created_at).toLocaleDateString()}
                    {req.applied_at && (
                      <>
                        {" · "}
                        Applied {new Date(req.applied_at).toLocaleDateString()}
                      </>
                    )}
                  </p>
                </div>
                <StatusPill status={req.status} />
              </div>

              {req.promo_code && (
                <div className="flex items-center gap-2 w-full" style={{ flexWrap: "wrap" }}>
                  <code
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 13,
                      color: req.status === "applied" ? "var(--color-text-secondary)" : "var(--color-success)",
                      background:
                        req.status === "applied"
                          ? "var(--color-bg-elevated)"
                          : "rgba(46,139,87,0.10)",
                      padding: "6px 10px",
                      borderRadius: 8,
                      fontWeight: 600,
                      letterSpacing: "0.01em",
                    }}
                  >
                    {req.promo_code}
                  </code>
                  <button
                    onClick={() => copyCode(req.promo_code!)}
                    style={{
                      padding: "5px 10px",
                      borderRadius: 7,
                      border: "1px solid var(--color-border)",
                      background: "transparent",
                      color: "var(--color-text-secondary)",
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: "pointer",
                    }}
                  >
                    {copiedCode === req.promo_code ? "Copied" : "Copy"}
                  </button>
                  {req.status === "approved" && (
                    <span
                      style={{
                        fontSize: 12,
                        color: "var(--color-text-secondary)",
                      }}
                    >
                      Attach this to the student&rsquo;s subscription in Whop, then mark applied →
                    </span>
                  )}
                </div>
              )}

              {req.rejection_reason && (
                <p
                  style={{
                    fontSize: 12,
                    color: "var(--color-danger)",
                  }}
                >
                  Reason: {req.rejection_reason}
                </p>
              )}

              {req.status === "pending" &&
                (submissionsByStudent[req.student_id]?.length ?? 0) > 0 && (
                  <div
                    style={{
                      padding: 10,
                      borderRadius: 8,
                      background: "var(--color-fill-secondary)",
                      marginBottom: 8,
                    }}
                  >
                    <p
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        color: "var(--color-text-tertiary)",
                        marginBottom: 6,
                      }}
                    >
                      Action submissions
                    </p>
                    <div className="flex flex-col gap-1">
                      {submissionsByStudent[req.student_id]!.map((s) => (
                        <div
                          key={s.lessonId}
                          className="flex items-center gap-2"
                          style={{ fontSize: 12 }}
                        >
                          <span
                            style={{
                              fontFamily:
                                "ui-monospace, SFMono-Regular, Menlo, monospace",
                              color: "var(--color-text-tertiary)",
                              minWidth: 36,
                            }}
                          >
                            {s.lessonId}
                          </span>
                          <span
                            style={{
                              flex: 1,
                              color: s.shipped
                                ? "var(--color-text-primary)"
                                : "var(--color-text-tertiary)",
                            }}
                          >
                            {s.title}
                          </span>
                          {s.link ? (
                            <a
                              href={s.link}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{
                                fontSize: 11,
                                padding: "2px 8px",
                                borderRadius: 4,
                                background: "rgba(88,101,242,0.12)",
                                color: "#7d8be8",
                                textDecoration: "none",
                                fontWeight: 600,
                              }}
                            >
                              🔗 link
                            </a>
                          ) : s.shipped ? (
                            <span
                              style={{
                                fontSize: 11,
                                color: "var(--color-text-tertiary)",
                                fontStyle: "italic",
                              }}
                            >
                              no link
                            </span>
                          ) : (
                            <span
                              style={{
                                fontSize: 11,
                                color: "var(--color-text-tertiary)",
                              }}
                            >
                              not shipped
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              {req.status === "pending" && (
                <div className="flex gap-2">
                  <button
                    onClick={() => handleApprove(req.id)}
                    disabled={processing === req.id}
                    style={primaryBtnStyle(processing === req.id)}
                  >
                    {processing === req.id ? "Generating code…" : "Approve & generate code"}
                  </button>
                  <button
                    onClick={() => handleReject(req.id)}
                    disabled={processing === req.id}
                    style={secondaryBtnStyle(processing === req.id)}
                  >
                    Reject
                  </button>
                </div>
              )}

              {req.status === "approved" && (
                <div className="flex gap-2">
                  <button
                    onClick={() => handleMarkApplied(req.id)}
                    disabled={processing === req.id}
                    style={primaryBtnStyle(processing === req.id)}
                  >
                    {processing === req.id ? "Marking…" : "Mark applied"}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function primaryBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "6px 14px",
    borderRadius: 8,
    border: "none",
    background: "var(--color-accent)",
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: 600,
    letterSpacing: "-0.005em",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.6 : 1,
    transition: "all 150ms cubic-bezier(0.25,0.1,0.25,1)",
  };
}

function secondaryBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "6px 14px",
    borderRadius: 8,
    border: "1px solid var(--color-border)",
    background: "transparent",
    color: "var(--color-text-secondary)",
    fontSize: 13,
    fontWeight: 500,
    letterSpacing: "-0.005em",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.6 : 1,
    transition: "all 150ms cubic-bezier(0.25,0.1,0.25,1)",
  };
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "applied"
      ? { color: "var(--color-text-secondary)", bg: "var(--color-bg-elevated)" }
      : status === "approved"
        ? { color: "var(--color-success)", bg: "rgba(46,139,87,0.10)" }
        : status === "pending"
          ? { color: "var(--color-warning)", bg: "rgba(212,162,76,0.12)" }
          : { color: "var(--color-danger)", bg: "rgba(200,74,74,0.10)" };
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 500,
        color: tone.color,
        background: tone.bg,
        letterSpacing: "-0.005em",
        textTransform: "capitalize",
      }}
    >
      {status}
    </span>
  );
}
