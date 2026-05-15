"use client";

/**
 * /admin/tasks — Astrid's task queue.
 *
 * - List of open tasks (filterable). At-risk + cancel-path bubble to the
 *   top via BUCKET_PRIORITY.
 * - Each row shows: real name, Discord username (prominent), day, scenario
 *   title, concrete behavior summary, template preview, Copy DM / Dismiss.
 * - Copy DM grabs the rendered body, copies to clipboard, marks completed.
 * - Dismiss requires a free-text reason (audited via tasks.notes).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { createClient } from "@/lib/supabase-browser";
import type { Student, Task, Template } from "@/types/database";
import { getDayNumber } from "@/types/database";
import {
  BUCKET_GLYPH,
  BUCKET_LABEL,
  BUCKET_PRIORITY,
  loadAdminConfig,
  renderTemplate,
} from "@/lib/templates";

type TaskRow = Task & {
  student: Student | null;
  template:
    | (Pick<
        Template,
        | "scenario_id"
        | "bucket"
        | "week"
        | "title"
        | "body"
        | "is_admin_only"
        | "variables"
        | "word_count"
      > & { id?: string })
    | null;
};

type StatusFilter = "open" | "completed" | "dismissed" | "all";

export default function AdminTasksPage() {
  const supabase = createClient();
  const { teamMember } = useAuth();

  const [rows, setRows] = useState<TaskRow[]>([]);
  const [filter, setFilter] = useState<StatusFilter>("open");
  const [bucketFilter, setBucketFilter] = useState<string>("");
  const [weekFilter, setWeekFilter] = useState<string>("");
  const [studentSearch, setStudentSearch] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [dismissModal, setDismissModal] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [dismissNote, setDismissNote] = useState("");
  const [config, setConfig] = useState<
    | Partial<
        Record<
          | "astrid_booking_link"
          | "program_login_link"
          | "karlo_walkthrough_video_link",
          string | null
        >
      >
    | undefined
  >(undefined);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const params = new URLSearchParams();
      params.set("status", filter);
      if (bucketFilter) params.set("bucket", bucketFilter);
      if (weekFilter) params.set("week", weekFilter);
      if (studentSearch.trim()) params.set("student", studentSearch.trim());

      const res = await fetch(`/api/admin/tasks?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const { tasks } = await res.json();
      setRows(tasks as TaskRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }, [filter, bucketFilter, weekFilter, studentSearch, supabase]);

  useEffect(() => {
    void fetchTasks();
  }, [fetchTasks]);

  useEffect(() => {
    void (async () => {
      const c = await loadAdminConfig(supabase);
      setConfig(c);
    })();
  }, [supabase]);

  // Sort: bucket priority first, then created_at desc.
  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const pa = BUCKET_PRIORITY[a.template?.bucket ?? ""] ?? 99;
      const pb = BUCKET_PRIORITY[b.template?.bucket ?? ""] ?? 99;
      if (pa !== pb) return pa - pb;
      return (
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    });
  }, [rows]);

  // Counts (status totals, for the header)
  const counts = useMemo(() => {
    let open = 0,
      done = 0,
      dismissed = 0;
    for (const r of rows) {
      if (r.status === "open") open++;
      else if (r.status === "completed") done++;
      else if (r.status === "dismissed") dismissed++;
    }
    return { open, done, dismissed };
  }, [rows]);

  async function copyTask(row: TaskRow) {
    if (!row.template || !row.student) return;
    setBusyId(row.id);
    setError(null);
    try {
      const { body } = renderTemplate(row.template.body, {
        student: {
          name: row.student.name,
          joined_at: row.student.joined_at,
        },
        config,
      });
      await navigator.clipboard.writeText(body);

      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`/api/admin/tasks/${row.id}/copy`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      setToast(
        `DM copied — ${row.student.name?.split(" ")[0] ?? "task"}'s task closed.`,
      );
      setTimeout(() => setToast(null), 2500);
      await fetchTasks();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusyId(null);
  }

  async function submitDismiss() {
    if (!dismissModal) return;
    const note = dismissNote.trim();
    if (!note) {
      setError("Please add a short reason — it helps us tune the triggers.");
      return;
    }
    setBusyId(dismissModal.id);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`/api/admin/tasks/${dismissModal.id}/dismiss`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ notes: note }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      setDismissModal(null);
      setDismissNote("");
      await fetchTasks();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusyId(null);
  }

  return (
    <div className="p-8 max-w-6xl">
      <h1
        style={{
          fontSize: 24,
          fontWeight: 700,
          letterSpacing: "-0.022em",
          color: "var(--color-text-primary)",
          marginBottom: 4,
        }}
      >
        Tasks Queue
      </h1>
      <p
        style={{
          fontSize: 13,
          color: "var(--color-text-tertiary)",
          marginBottom: 16,
        }}
      >
        Auto-created when the platform detects scenario triggers. Copy →
        paste into Discord → task closes.
        {teamMember?.full_name ? ` Signed in as ${teamMember.full_name}.` : ""}
      </p>

      {/* Counts */}
      <div
        className="flex gap-4 mb-4"
        style={{ fontSize: 13, color: "var(--color-text-secondary)" }}
      >
        <span>
          Open:{" "}
          <strong style={{ color: "var(--color-text-primary)" }}>
            {counts.open}
          </strong>
        </span>
        <span>·</span>
        <span>
          Completed: <strong>{counts.done}</strong>
        </span>
        <span>·</span>
        <span>
          Dismissed: <strong>{counts.dismissed}</strong>
        </span>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-6 flex-wrap items-center">
        <select
          value={bucketFilter}
          onChange={(e) => setBucketFilter(e.target.value)}
          style={selectStyle()}
        >
          <option value="">All buckets</option>
          <option value="at_risk">⚠ At risk</option>
          <option value="cancel_path">✗ Cancel path</option>
          <option value="crushing">★ Crushing</option>
          <option value="event">⚡ Event</option>
          <option value="admin">⚙ Admin</option>
          <option value="on_track">✓ On track</option>
        </select>
        <select
          value={weekFilter}
          onChange={(e) => setWeekFilter(e.target.value)}
          style={selectStyle()}
        >
          <option value="">All weeks</option>
          <option value="D1">Day 1 SOP</option>
          <option value="W1">Week 1</option>
          <option value="W2">Week 2</option>
          <option value="W3">Week 3</option>
          <option value="W4">Week 4</option>
          <option value="X">Cross-week</option>
        </select>
        <input
          type="text"
          placeholder="Search student name / email / @discord"
          value={studentSearch}
          onChange={(e) => setStudentSearch(e.target.value)}
          style={{ ...selectStyle(), minWidth: 280 }}
        />
        <div className="flex gap-1 ml-auto">
          {(["open", "completed", "dismissed", "all"] as StatusFilter[]).map(
            (s) => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                style={{
                  padding: "6px 12px",
                  fontSize: 12,
                  fontWeight: filter === s ? 600 : 500,
                  borderRadius: 6,
                  background:
                    filter === s
                      ? "var(--color-bg-elevated)"
                      : "transparent",
                  border:
                    filter === s
                      ? "1px solid var(--color-accent-dark)"
                      : "1px solid var(--color-border)",
                  color:
                    filter === s
                      ? "var(--color-text-primary)"
                      : "var(--color-text-tertiary)",
                  cursor: "pointer",
                  textTransform: "capitalize",
                }}
              >
                {s}
              </button>
            ),
          )}
        </div>
      </div>

      {error && (
        <div
          className="mb-4 p-3 rounded"
          style={{
            background: "rgba(200,74,74,0.10)",
            border: "1px solid rgba(200,74,74,0.30)",
            fontSize: 13,
            color: "var(--color-danger)",
          }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
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
      ) : sorted.length === 0 ? (
        <EmptyState filter={filter} />
      ) : (
        <div className="flex flex-col gap-3">
          {sorted.map((row) => (
            <TaskCard
              key={row.id}
              row={row}
              busy={busyId === row.id}
              config={config}
              onCopy={() => copyTask(row)}
              onDismiss={() =>
                setDismissModal({
                  id: row.id,
                  name: row.student?.name ?? "this student",
                })
              }
            />
          ))}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            right: 24,
            padding: "10px 14px",
            borderRadius: 8,
            background: "var(--color-bg-elevated)",
            border: "1px solid var(--color-accent-dark)",
            color: "var(--color-text-primary)",
            fontSize: 13,
            boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
            zIndex: 1000,
          }}
        >
          {toast}
        </div>
      )}

      {/* Dismiss modal */}
      {dismissModal && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
          }}
          onClick={() => setDismissModal(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--color-bg-elevated)",
              border: "1px solid var(--color-border)",
              borderRadius: 10,
              padding: 20,
              width: "100%",
              maxWidth: 460,
            }}
          >
            <h3
              style={{
                fontSize: 16,
                fontWeight: 600,
                color: "var(--color-text-primary)",
                marginBottom: 4,
              }}
            >
              Dismiss task for {dismissModal.name}?
            </h3>
            <p
              style={{
                fontSize: 12,
                color: "var(--color-text-tertiary)",
                marginBottom: 12,
              }}
            >
              A short reason helps us tune the triggers over time.
            </p>
            <textarea
              autoFocus
              rows={3}
              value={dismissNote}
              placeholder="e.g. Already replied to Astrid in Discord"
              onChange={(e) => setDismissNote(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 10px",
                fontSize: 13,
                background: "var(--color-bg-primary)",
                border: "1px solid var(--color-border)",
                borderRadius: 6,
                color: "var(--color-text-primary)",
                resize: "vertical",
              }}
            />
            <div className="flex gap-2 justify-end mt-4">
              <button
                onClick={() => {
                  setDismissModal(null);
                  setDismissNote("");
                }}
                style={ghostBtnStyle()}
              >
                Cancel
              </button>
              <button
                onClick={() => void submitDismiss()}
                disabled={busyId === dismissModal.id}
                style={{
                  ...primaryBtnStyle(),
                  background: "var(--color-danger)",
                  opacity: busyId === dismissModal.id ? 0.6 : 1,
                }}
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TaskCard({
  row,
  busy,
  config,
  onCopy,
  onDismiss,
}: {
  row: TaskRow;
  busy: boolean;
  config:
    | Partial<
        Record<
          | "astrid_booking_link"
          | "program_login_link"
          | "karlo_walkthrough_video_link",
          string | null
        >
      >
    | undefined;
  onCopy: () => void;
  onDismiss: () => void;
}) {
  const { student, template } = row;
  const isAdminOnly = template?.is_admin_only === true;
  const dayNumber = student ? getDayNumber(student.joined_at) : null;

  const preview =
    template && student && !isAdminOnly
      ? renderTemplate(template.body, {
          student: { name: student.name, joined_at: student.joined_at },
          config,
        })
      : null;
  const firstLine =
    preview?.body.split("\n").find((l) => l.trim().length > 0) ?? "";
  const truncated =
    firstLine.length > 90 ? `${firstLine.slice(0, 87)}…` : firstLine;

  const glyph = template ? BUCKET_GLYPH[template.bucket] ?? "·" : "·";
  const bucketColor =
    template?.bucket === "at_risk"
      ? "var(--color-warning)"
      : template?.bucket === "cancel_path"
        ? "var(--color-danger)"
        : template?.bucket === "crushing"
          ? "var(--color-accent)"
          : "var(--color-text-tertiary)";

  return (
    <div
      className="p-4 rounded"
      style={{
        background: "var(--color-bg-elevated)",
        border: "1px solid var(--color-border)",
        opacity: row.status === "open" ? 1 : 0.55,
      }}
    >
      <div className="flex items-start gap-3 mb-2">
        {/* Avatar */}
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: "50%",
            background: student?.avatar_url
              ? `url(${student.avatar_url}) center/cover`
              : "rgba(140,140,130,0.18)",
            flexShrink: 0,
          }}
        />

        <div className="flex-1 min-w-0">
          <div
            className="flex items-center gap-2 flex-wrap"
            style={{ fontSize: 14 }}
          >
            <strong
              style={{
                color: "var(--color-text-primary)",
                fontWeight: 600,
              }}
            >
              {student?.name ?? "—"}
            </strong>
            {student?.discord_username ? (
              <span
                style={{
                  fontSize: 11,
                  padding: "2px 8px",
                  borderRadius: 4,
                  background: "rgba(88,101,242,0.14)",
                  color: "#7d8be8",
                  fontFamily:
                    "ui-monospace, SFMono-Regular, Menlo, monospace",
                  fontWeight: 600,
                }}
              >
                @{student.discord_username}
              </span>
            ) : (
              <span
                style={{
                  fontSize: 11,
                  padding: "2px 8px",
                  borderRadius: 4,
                  background: "rgba(212,162,76,0.10)",
                  color: "var(--color-warning)",
                  fontWeight: 500,
                }}
              >
                Discord ⚠ not connected
              </span>
            )}
            {dayNumber !== null && (
              <span
                style={{
                  fontSize: 12,
                  color: "var(--color-text-tertiary)",
                }}
              >
                Day {dayNumber}
              </span>
            )}
            <span
              style={{
                fontSize: 11,
                padding: "2px 8px",
                borderRadius: 4,
                background:
                  student?.membership_status === "canceled"
                    ? "rgba(200,74,74,0.12)"
                    : "rgba(70,180,120,0.12)",
                color:
                  student?.membership_status === "canceled"
                    ? "var(--color-danger)"
                    : "#5bb88e",
                textTransform: "capitalize",
              }}
            >
              {student?.membership_status ?? "—"}
            </span>
          </div>

          {/* Bucket + scenario title */}
          <div
            className="flex items-center gap-2 mt-1"
            style={{ fontSize: 13 }}
          >
            <span style={{ color: bucketColor, fontSize: 14 }}>{glyph}</span>
            <span
              style={{
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: 11,
                color: "var(--color-text-tertiary)",
              }}
            >
              {row.scenario_id}
            </span>
            <span
              style={{
                color: "var(--color-text-secondary)",
                fontWeight: 500,
              }}
            >
              {template?.title ?? "(template not found)"}
            </span>
            {template &&
              BUCKET_LABEL[template.bucket] && (
                <span
                  style={{
                    fontSize: 11,
                    color: "var(--color-text-tertiary)",
                  }}
                >
                  · {BUCKET_LABEL[template.bucket]}
                </span>
              )}
          </div>
        </div>
      </div>

      {/* Behavior summary */}
      {row.behavior_summary && (
        <div
          className="mb-2 p-2 rounded"
          style={{
            background: "var(--color-bg-primary)",
            border: "1px solid var(--color-border)",
            fontSize: 12,
            color: "var(--color-text-secondary)",
            lineHeight: 1.45,
          }}
        >
          <span
            style={{
              fontSize: 10,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--color-text-tertiary)",
            }}
          >
            Why this fired
          </span>
          <div style={{ marginTop: 2 }}>{row.behavior_summary}</div>
        </div>
      )}

      {/* Template preview (non-admin) */}
      {!isAdminOnly && truncated && (
        <p
          style={{
            fontSize: 12,
            color: "var(--color-text-tertiary)",
            fontStyle: "italic",
            marginBottom: 8,
          }}
        >
          “{truncated}”
        </p>
      )}

      {/* Actions */}
      {row.status === "open" && (
        <div className="flex gap-2 mt-2 flex-wrap">
          {isAdminOnly ? (
            <a
              href="/admin/discounts"
              style={primaryBtnStyle()}
            >
              Open discount request →
            </a>
          ) : (
            <button
              onClick={onCopy}
              disabled={busy}
              style={{
                ...primaryBtnStyle(),
                opacity: busy ? 0.6 : 1,
                cursor: busy ? "wait" : "pointer",
              }}
            >
              {busy ? "Copying…" : "Copy DM to clipboard"}
            </button>
          )}
          <button onClick={onDismiss} style={ghostBtnStyle()}>
            Dismiss
          </button>
        </div>
      )}

      {row.status === "completed" && (
        <p style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
          Closed{" "}
          {row.completed_at
            ? new Date(row.completed_at).toLocaleString()
            : ""}
        </p>
      )}
      {row.status === "dismissed" && (
        <p style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
          Dismissed{" "}
          {row.dismissed_at
            ? new Date(row.dismissed_at).toLocaleString()
            : ""}
          {row.notes ? ` — ${row.notes}` : ""}
        </p>
      )}
    </div>
  );
}

function EmptyState({ filter }: { filter: StatusFilter }) {
  return (
    <div
      className="p-12 text-center rounded"
      style={{
        background: "var(--color-bg-elevated)",
        border: "1px solid var(--color-border)",
        color: "var(--color-text-tertiary)",
      }}
    >
      <div style={{ fontSize: 32, marginBottom: 8 }}>🌱</div>
      <p style={{ fontSize: 14 }}>
        {filter === "open"
          ? "No open tasks. All students are on track."
          : `No ${filter} tasks.`}
      </p>
      <p style={{ fontSize: 12, marginTop: 4 }}>
        Check back after the next cron run (09:15 UTC daily).
      </p>
    </div>
  );
}

function selectStyle(): React.CSSProperties {
  return {
    padding: "6px 10px",
    fontSize: 13,
    background: "var(--color-bg-elevated)",
    border: "1px solid var(--color-border)",
    borderRadius: 6,
    color: "var(--color-text-primary)",
  };
}

function primaryBtnStyle(): React.CSSProperties {
  return {
    padding: "8px 14px",
    fontSize: 12,
    fontWeight: 600,
    borderRadius: 6,
    background: "var(--color-accent)",
    border: "1px solid var(--color-border)",
    color: "var(--color-text-on-accent, #fff)",
    cursor: "pointer",
    textDecoration: "none",
    display: "inline-block",
  };
}

function ghostBtnStyle(): React.CSSProperties {
  return {
    padding: "8px 12px",
    fontSize: 12,
    fontWeight: 500,
    borderRadius: 6,
    background: "transparent",
    border: "1px solid var(--color-border)",
    color: "var(--color-text-secondary)",
    cursor: "pointer",
  };
}
