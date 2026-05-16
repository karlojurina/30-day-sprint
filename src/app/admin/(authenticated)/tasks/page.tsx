"use client";

/**
 * /admin/tasks — Astrid's task Kanban.
 *
 * Three columns mapping to the existing tasks.status states:
 *   To do      → status = 'open'      (cron fired, need to send)
 *   Sent       → status = 'completed' (Astrid copied + presumably sent the DM)
 *   Dismissed  → status = 'dismissed' (Astrid decided no action)
 *
 * Refresh is manual via the button at the top (per Karlo 2026-05-16 —
 * cheap, ok for testing).
 *
 * Replaces the old list view at this URL.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { createClient } from "@/lib/supabase-browser";
import type { Student, Task, Template } from "@/types/database";
import { getDayNumber } from "@/types/database";
import {
  BUCKET_GLYPH,
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

type ColumnKey = "open" | "completed" | "dismissed";

const COLUMNS: Array<{ key: ColumnKey; label: string }> = [
  { key: "open", label: "To do" },
  { key: "completed", label: "Sent" },
  { key: "dismissed", label: "Dismissed" },
];

export default function AdminTasksKanban() {
  const supabase = createClient();
  const { teamMember } = useAuth();

  const [rows, setRows] = useState<TaskRow[]>([]);
  const [bucketFilter, setBucketFilter] = useState<string>("");
  const [studentSearch, setStudentSearch] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
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

  const fetchTasks = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        const params = new URLSearchParams();
        // Pull every status — we split into columns client-side.
        params.set("status", "all");
        if (bucketFilter) params.set("bucket", bucketFilter);
        if (studentSearch.trim()) params.set("student", studentSearch.trim());
        // Limit each render to a sane batch.
        params.set("limit", "500");

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
      setRefreshing(false);
    },
    [bucketFilter, studentSearch, supabase],
  );

  useEffect(() => {
    void fetchTasks(false);
  }, [fetchTasks]);

  useEffect(() => {
    void (async () => {
      const c = await loadAdminConfig(supabase);
      setConfig(c);
    })();
  }, [supabase]);

  // Split rows into columns and sort within each.
  const grouped = useMemo(() => {
    const buckets: Record<ColumnKey, TaskRow[]> = {
      open: [],
      completed: [],
      dismissed: [],
    };
    for (const r of rows) {
      const col = (
        r.status === "open"
          ? "open"
          : r.status === "completed"
            ? "completed"
            : r.status === "dismissed"
              ? "dismissed"
              : null
      ) as ColumnKey | null;
      if (col) buckets[col].push(r);
    }
    buckets.open.sort((a, b) => {
      const pa = BUCKET_PRIORITY[a.template?.bucket ?? ""] ?? 99;
      const pb = BUCKET_PRIORITY[b.template?.bucket ?? ""] ?? 99;
      if (pa !== pb) return pa - pb;
      return (
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    });
    // Sent + Dismissed: most-recent-first.
    buckets.completed.sort(
      (a, b) =>
        new Date(b.completed_at ?? b.created_at).getTime() -
        new Date(a.completed_at ?? a.created_at).getTime(),
    );
    buckets.dismissed.sort(
      (a, b) =>
        new Date(b.dismissed_at ?? b.created_at).getTime() -
        new Date(a.dismissed_at ?? a.created_at).getTime(),
    );
    return buckets;
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
        `DM copied for ${row.student.name?.split(" ")[0] ?? "task"} → moved to Sent.`,
      );
      setTimeout(() => setToast(null), 2500);
      await fetchTasks(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusyId(null);
  }

  async function submitDismiss() {
    if (!dismissModal) return;
    const note = dismissNote.trim();
    if (!note) {
      setError("Add a short reason — helps us tune the triggers.");
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
      await fetchTasks(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusyId(null);
  }

  return (
    <div className="p-6 lg:p-8">
      <div className="flex items-baseline justify-between gap-4 flex-wrap mb-2">
        <div>
          <h1
            style={{
              fontSize: 24,
              fontWeight: 700,
              letterSpacing: "-0.022em",
              color: "var(--color-text-primary)",
            }}
          >
            Task queue
          </h1>
          <p
            style={{
              fontSize: 13,
              color: "var(--color-text-tertiary)",
              marginTop: 2,
            }}
          >
            Auto-created from student behavior. Copy → paste in Discord →
            card moves to <em>Sent</em>.
            {teamMember?.full_name
              ? ` Signed in as ${teamMember.full_name}.`
              : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={() => fetchTasks(true)}
          disabled={refreshing}
          style={{
            padding: "8px 14px",
            fontSize: 12,
            fontWeight: 600,
            borderRadius: 8,
            background: "var(--color-bg-elevated)",
            border: "1px solid var(--color-border)",
            color: "var(--color-text-primary)",
            cursor: refreshing ? "wait" : "pointer",
            opacity: refreshing ? 0.6 : 1,
          }}
        >
          {refreshing ? "Refreshing…" : "↻ Refresh"}
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-5 flex-wrap items-center">
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
        </select>
        <input
          type="text"
          placeholder="Search name / email / @discord"
          value={studentSearch}
          onChange={(e) => setStudentSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void fetchTasks(true)}
          style={{ ...selectStyle(), minWidth: 240 }}
        />
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
      ) : (
        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}
        >
          {COLUMNS.map((col) => (
            <Column
              key={col.key}
              label={col.label}
              count={grouped[col.key].length}
              tone={col.key}
            >
              {grouped[col.key].length === 0 ? (
                <EmptyColumn col={col.key} />
              ) : (
                grouped[col.key].map((row) => (
                  <TaskCard
                    key={row.id}
                    row={row}
                    busy={busyId === row.id}
                    config={config}
                    compact={col.key !== "open"}
                    onCopy={() => copyTask(row)}
                    onDismiss={() =>
                      setDismissModal({
                        id: row.id,
                        name: row.student?.name ?? "this student",
                      })
                    }
                  />
                ))
              )}
            </Column>
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
              A short reason helps tune the triggers over time.
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

function Column({
  label,
  count,
  tone,
  children,
}: {
  label: string;
  count: number;
  tone: ColumnKey;
  children: React.ReactNode;
}) {
  const accent =
    tone === "open"
      ? "var(--color-warning)"
      : tone === "completed"
        ? "var(--color-accent-dark)"
        : "var(--color-text-tertiary)";
  return (
    <section
      style={{
        background: "var(--color-bg-card)",
        border: "1px solid var(--color-border)",
        borderRadius: 12,
        padding: 12,
        minHeight: 280,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <header
        className="flex items-baseline justify-between"
        style={{ paddingBottom: 8, borderBottom: "1px solid var(--color-border)" }}
      >
        <p
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: accent,
          }}
        >
          {label}
        </p>
        <span
          style={{
            fontSize: 11,
            color: "var(--color-text-tertiary)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {count}
        </span>
      </header>
      <div className="flex flex-col gap-2 overflow-y-auto" style={{ maxHeight: "70vh" }}>
        {children}
      </div>
    </section>
  );
}

function EmptyColumn({ col }: { col: ColumnKey }) {
  const msg =
    col === "open"
      ? "No tasks waiting. All students on track."
      : col === "completed"
        ? "Nothing sent yet."
        : "Nothing dismissed.";
  return (
    <div
      style={{
        padding: 24,
        textAlign: "center",
        fontSize: 12,
        color: "var(--color-text-tertiary)",
        fontStyle: "italic",
      }}
    >
      {msg}
    </div>
  );
}

function TaskCard({
  row,
  busy,
  config,
  compact,
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
  compact: boolean;
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
    firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine;

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
      className="rounded"
      style={{
        background: "var(--color-bg-elevated)",
        border: "1px solid var(--color-border)",
        padding: 10,
      }}
    >
      {/* Header row */}
      <div className="flex items-start gap-2 mb-1">
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            flexShrink: 0,
            background: student?.avatar_url
              ? `url(${student.avatar_url}) center/cover`
              : "rgba(140,140,130,0.18)",
          }}
        />
        <div className="flex-1 min-w-0">
          <div
            className="flex items-center gap-1.5 flex-wrap"
            style={{ fontSize: 13 }}
          >
            <strong
              className="truncate"
              style={{
                color: "var(--color-text-primary)",
                fontWeight: 600,
              }}
            >
              {student?.name ?? "—"}
            </strong>
            {dayNumber !== null && (
              <span
                style={{
                  fontSize: 11,
                  color: "var(--color-text-tertiary)",
                }}
              >
                · Day {dayNumber}
              </span>
            )}
          </div>
          {student?.discord_username ? (
            <span
              style={{
                fontSize: 10,
                padding: "1px 6px",
                borderRadius: 4,
                background: "rgba(88,101,242,0.14)",
                color: "#7d8be8",
                fontFamily:
                  "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontWeight: 600,
                display: "inline-block",
                marginTop: 2,
              }}
            >
              @{student.discord_username}
            </span>
          ) : (
            <span
              style={{
                fontSize: 10,
                padding: "1px 6px",
                borderRadius: 4,
                background: "rgba(212,162,76,0.10)",
                color: "var(--color-warning)",
                fontWeight: 500,
                display: "inline-block",
                marginTop: 2,
              }}
            >
              Discord ⚠ not connected
            </span>
          )}
        </div>
      </div>

      {/* Scenario title */}
      <div
        className="flex items-baseline gap-2 mt-2"
        style={{ fontSize: 12 }}
      >
        <span style={{ color: bucketColor, fontSize: 13 }}>{glyph}</span>
        <span
          style={{
            color: "var(--color-text-secondary)",
            fontWeight: 500,
            lineHeight: 1.35,
          }}
        >
          {template?.title ?? "(template not found)"}
        </span>
      </div>

      {/* Behavior summary */}
      {!compact && row.behavior_summary && (
        <p
          className="mt-1.5"
          style={{
            fontSize: 11,
            color: "var(--color-text-secondary)",
            lineHeight: 1.45,
          }}
        >
          {row.behavior_summary}
        </p>
      )}

      {/* Template preview (only for To do) */}
      {!compact && !isAdminOnly && truncated && (
        <p
          style={{
            fontSize: 11,
            color: "var(--color-text-tertiary)",
            fontStyle: "italic",
            marginTop: 6,
          }}
        >
          “{truncated}”
        </p>
      )}

      {/* Actions */}
      {row.status === "open" && (
        <div className="flex gap-1.5 mt-2 flex-wrap">
          {isAdminOnly ? (
            <a href="/admin/discounts" style={primaryBtnStyle()}>
              Open discount →
            </a>
          ) : (
            <button
              onClick={onCopy}
              disabled={busy}
              style={{
                ...primaryBtnStyle(),
                opacity: busy ? 0.6 : 1,
                cursor: busy ? "wait" : "pointer",
                fontSize: 11,
                padding: "5px 9px",
              }}
            >
              {busy ? "…" : "Copy DM"}
            </button>
          )}
          <button
            onClick={onDismiss}
            style={{ ...ghostBtnStyle(), fontSize: 11, padding: "5px 9px" }}
          >
            Dismiss
          </button>
        </div>
      )}

      {row.status === "completed" && (
        <p
          style={{
            fontSize: 10,
            color: "var(--color-text-tertiary)",
            marginTop: 6,
          }}
        >
          Sent {relTime(row.completed_at)}
        </p>
      )}
      {row.status === "dismissed" && (
        <p
          style={{
            fontSize: 10,
            color: "var(--color-text-tertiary)",
            marginTop: 6,
          }}
          title={row.notes ?? ""}
        >
          Dismissed {relTime(row.dismissed_at)}
          {row.notes ? ` — ${row.notes.slice(0, 60)}` : ""}
        </p>
      )}
    </div>
  );
}

function relTime(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "just now";
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
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
