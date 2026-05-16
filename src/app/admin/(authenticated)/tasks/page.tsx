"use client";

/**
 * /admin/tasks — Astrid's task Kanban.
 *
 * Three columns mapping to tasks.status:
 *   To do      → status = 'open'
 *   Sent       → status = 'completed'
 *   Dismissed  → status = 'dismissed'
 *
 * Cards stay minimal — name, day, Discord handle, scenario title.
 * Click anywhere on the card body to open the detail modal (full
 * template body + behavior summary + action buttons). All status
 * transitions are manual: Copy DM is clipboard-only and does not
 * change column. "Mark sent" / "Dismiss" / "Move to To do" do.
 *
 * Refresh is manual via the button at the top.
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
        | "trigger_description"
        | "intent"
      > & { id?: string })
    | null;
};

type ColumnKey = "open" | "completed" | "dismissed";

const COLUMNS: Array<{ key: ColumnKey; label: string }> = [
  { key: "open", label: "To do" },
  { key: "completed", label: "Sent" },
  { key: "dismissed", label: "Dismissed" },
];

type AdminConfig =
  | Partial<
      Record<
        | "astrid_booking_link"
        | "program_login_link"
        | "karlo_walkthrough_video_link",
        string | null
      >
    >
  | undefined;

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
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [dismissModal, setDismissModal] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [dismissNote, setDismissNote] = useState("");
  const [config, setConfig] = useState<AdminConfig>(undefined);

  const fetchTasks = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        const params = new URLSearchParams();
        params.set("status", "all");
        if (bucketFilter) params.set("bucket", bucketFilter);
        if (studentSearch.trim()) params.set("student", studentSearch.trim());
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

  // Group + sort.
  const grouped = useMemo(() => {
    const buckets: Record<ColumnKey, TaskRow[]> = {
      open: [],
      completed: [],
      dismissed: [],
    };
    for (const r of rows) {
      if (r.status === "open") buckets.open.push(r);
      else if (r.status === "completed") buckets.completed.push(r);
      else if (r.status === "dismissed") buckets.dismissed.push(r);
    }
    buckets.open.sort((a, b) => {
      const pa = BUCKET_PRIORITY[a.template?.bucket ?? ""] ?? 99;
      const pb = BUCKET_PRIORITY[b.template?.bucket ?? ""] ?? 99;
      if (pa !== pb) return pa - pb;
      return (
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    });
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

  const openTask = useMemo(
    () => rows.find((r) => r.id === openTaskId) ?? null,
    [rows, openTaskId],
  );

  async function copyDMOnly(row: TaskRow) {
    if (!row.template || !row.student) return;
    const { body } = renderTemplate(row.template.body, {
      student: { name: row.student.name, joined_at: row.student.joined_at },
      config,
    });
    try {
      await navigator.clipboard.writeText(body);
      setToast(
        `DM copied for ${row.student.name?.split(" ")[0] ?? "task"}. Send it, then click "Mark sent" to move it.`,
      );
      setTimeout(() => setToast(null), 3000);
    } catch {
      setError("Couldn't access the clipboard.");
    }
  }

  async function transitionTask(rowId: string, to: ColumnKey, notes?: string) {
    setBusyId(rowId);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`/api/admin/tasks/${rowId}/transition`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ to, notes }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
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
      setError("Add a short reason.");
      return;
    }
    await transitionTask(dismissModal.id, "dismissed", note);
    setDismissModal(null);
    setDismissNote("");
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
            Click a card for the full template + student detail. Copy DM
            to clipboard, send it in Discord, then click <em>Mark sent</em>.
            {teamMember?.full_name
              ? ` Signed in as ${teamMember.full_name}.`
              : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={() => fetchTasks(true)}
          disabled={refreshing}
          style={refreshBtn(refreshing)}
        >
          {refreshing ? "Refreshing…" : "↻ Refresh"}
        </button>
      </div>

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
                    column={col.key}
                    busy={busyId === row.id}
                    onOpen={() => setOpenTaskId(row.id)}
                    onCopy={() => copyDMOnly(row)}
                    onMarkSent={() => transitionTask(row.id, "completed")}
                    onReopen={() => transitionTask(row.id, "open")}
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
        <div style={toastStyle()}>{toast}</div>
      )}

      {/* Detail modal */}
      {openTask && (
        <TaskDetailModal
          row={openTask}
          config={config}
          busy={busyId === openTask.id}
          onClose={() => setOpenTaskId(null)}
          onCopy={() => copyDMOnly(openTask)}
          onMarkSent={async () => {
            await transitionTask(openTask.id, "completed");
            setOpenTaskId(null);
          }}
          onReopen={async () => {
            await transitionTask(openTask.id, "open");
            setOpenTaskId(null);
          }}
          onDismiss={() =>
            setDismissModal({
              id: openTask.id,
              name: openTask.student?.name ?? "this student",
            })
          }
        />
      )}

      {/* Dismiss modal */}
      {dismissModal && (
        <DismissModal
          name={dismissModal.name}
          value={dismissNote}
          onChange={setDismissNote}
          onClose={() => {
            setDismissModal(null);
            setDismissNote("");
          }}
          onSubmit={() => void submitDismiss()}
          busy={busyId === dismissModal.id}
        />
      )}
    </div>
  );
}

/* ───────── Column ───────── */

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
      ? "Nothing waiting."
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

/* ───────── Card ───────── */

function TaskCard({
  row,
  column,
  busy,
  onOpen,
  onCopy,
  onMarkSent,
  onReopen,
  onDismiss,
}: {
  row: TaskRow;
  column: ColumnKey;
  busy: boolean;
  onOpen: () => void;
  onCopy: () => void;
  onMarkSent: () => void;
  onReopen: () => void;
  onDismiss: () => void;
}) {
  const { student, template } = row;
  const isAdminOnly = template?.is_admin_only === true;
  const dayNumber = student ? getDayNumber(student.joined_at) : null;
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
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      style={{
        background: "var(--color-bg-elevated)",
        border: "1px solid var(--color-border)",
        borderRadius: 8,
        padding: 10,
        cursor: "pointer",
      }}
    >
      {/* Header — avatar + name */}
      <div className="flex items-center gap-2 mb-1">
        <div
          style={{
            width: 24,
            height: 24,
            borderRadius: "50%",
            flexShrink: 0,
            background: student?.avatar_url
              ? `url(${student.avatar_url}) center/cover`
              : "rgba(140,140,130,0.18)",
          }}
        />
        <strong
          className="truncate flex-1"
          style={{
            color: "var(--color-text-primary)",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {student?.name ?? "—"}
        </strong>
        {dayNumber !== null && (
          <span
            style={{
              fontSize: 10,
              color: "var(--color-text-tertiary)",
              fontVariantNumeric: "tabular-nums",
              flexShrink: 0,
            }}
          >
            Day {dayNumber}
          </span>
        )}
      </div>

      {/* Discord username with label */}
      <p
        style={{
          fontSize: 11,
          color: "var(--color-text-secondary)",
          marginBottom: 6,
        }}
      >
        <span style={{ color: "var(--color-text-tertiary)" }}>
          Discord:{" "}
        </span>
        {student?.discord_username ? (
          <span
            style={{
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontWeight: 600,
              color: "#7d8be8",
            }}
          >
            @{student.discord_username}
          </span>
        ) : (
          <span style={{ color: "var(--color-warning)", fontStyle: "italic" }}>
            not connected
          </span>
        )}
      </p>

      {/* Scenario title */}
      <div
        className="flex items-baseline gap-2"
        style={{ fontSize: 12 }}
      >
        <span style={{ color: bucketColor, fontSize: 13 }}>{glyph}</span>
        <span
          style={{
            color: "var(--color-text-primary)",
            fontWeight: 500,
            lineHeight: 1.35,
          }}
        >
          {template?.title ?? "(template not found)"}
        </span>
      </div>

      {/* Actions row */}
      <div
        className="flex gap-1.5 mt-2 flex-wrap"
        onClick={(e) => e.stopPropagation()}
      >
        {column === "open" && !isAdminOnly && (
          <>
            <button onClick={onCopy} style={primaryBtn(busy)}>
              Copy DM
            </button>
            <button onClick={onMarkSent} style={ghostBtn()} disabled={busy}>
              Mark sent
            </button>
            <button onClick={onDismiss} style={ghostBtn()} disabled={busy}>
              Dismiss
            </button>
          </>
        )}
        {column === "open" && isAdminOnly && (
          <a
            href="/admin/discounts"
            onClick={(e) => e.stopPropagation()}
            style={primaryBtn(false)}
          >
            Open discount →
          </a>
        )}
        {(column === "completed" || column === "dismissed") && (
          <button onClick={onReopen} style={ghostBtn()} disabled={busy}>
            Move to To do
          </button>
        )}
      </div>

      {column === "completed" && (
        <p style={metaStyle()}>Sent {relTime(row.completed_at)}</p>
      )}
      {column === "dismissed" && (
        <p style={metaStyle()} title={row.notes ?? ""}>
          Dismissed {relTime(row.dismissed_at)}
          {row.notes ? ` — ${row.notes.slice(0, 50)}` : ""}
        </p>
      )}
    </div>
  );
}

/* ───────── Detail modal ───────── */

function TaskDetailModal({
  row,
  config,
  busy,
  onClose,
  onCopy,
  onMarkSent,
  onReopen,
  onDismiss,
}: {
  row: TaskRow;
  config: AdminConfig;
  busy: boolean;
  onClose: () => void;
  onCopy: () => void;
  onMarkSent: () => void;
  onReopen: () => void;
  onDismiss: () => void;
}) {
  const { student, template } = row;
  const dayNumber = student ? getDayNumber(student.joined_at) : null;
  const preview =
    template && student && !template.is_admin_only
      ? renderTemplate(template.body, {
          student: { name: student.name, joined_at: student.joined_at },
          config,
        })
      : null;
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
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 100,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--color-bg-card)",
          border: "1px solid var(--color-border-hover)",
          borderRadius: 12,
          width: "100%",
          maxWidth: 580,
          maxHeight: "85vh",
          overflow: "auto",
          padding: 22,
        }}
      >
        {/* Student header */}
        <div className="flex items-center gap-3 mb-4">
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              flexShrink: 0,
              background: student?.avatar_url
                ? `url(${student.avatar_url}) center/cover`
                : "rgba(140,140,130,0.18)",
            }}
          />
          <div className="flex-1 min-w-0">
            <h2
              style={{
                fontSize: 16,
                fontWeight: 600,
                color: "var(--color-text-primary)",
                letterSpacing: "-0.014em",
              }}
            >
              {student?.name ?? "—"}
            </h2>
            <p
              style={{
                fontSize: 12,
                color: "var(--color-text-tertiary)",
                marginTop: 2,
              }}
            >
              {dayNumber !== null ? `Day ${dayNumber} · ` : ""}
              {student?.membership_status ?? "—"}
              {student?.email ? ` · ${student.email}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              fontSize: 22,
              color: "var(--color-text-tertiary)",
              padding: 0,
              width: 28,
              height: 28,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {/* Discord username row */}
        <div
          className="mb-4 p-3 rounded"
          style={{
            background: "var(--color-fill-secondary)",
            fontSize: 13,
          }}
        >
          <span style={{ color: "var(--color-text-tertiary)" }}>
            Discord username:{" "}
          </span>
          {student?.discord_username ? (
            <span
              style={{
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                color: "#7d8be8",
                fontWeight: 600,
              }}
            >
              @{student.discord_username}
            </span>
          ) : (
            <span
              style={{
                color: "var(--color-warning)",
                fontStyle: "italic",
              }}
            >
              not connected
            </span>
          )}
        </div>

        {/* Scenario block */}
        <div className="mb-4">
          <div className="flex items-baseline gap-2 mb-1">
            <span style={{ color: bucketColor, fontSize: 16 }}>{glyph}</span>
            <h3
              style={{
                fontSize: 15,
                fontWeight: 600,
                color: "var(--color-text-primary)",
                letterSpacing: "-0.012em",
              }}
            >
              {template?.title ?? "—"}
            </h3>
          </div>
          {template?.trigger_description && (
            <p
              style={{
                fontSize: 12,
                color: "var(--color-text-tertiary)",
                marginBottom: 4,
              }}
            >
              <strong style={{ color: "var(--color-text-secondary)" }}>
                Trigger:
              </strong>{" "}
              {template.trigger_description}
            </p>
          )}
          {row.behavior_summary && (
            <p
              style={{
                fontSize: 12,
                color: "var(--color-text-secondary)",
                marginTop: 4,
                lineHeight: 1.5,
              }}
            >
              <strong style={{ color: "var(--color-text-tertiary)" }}>
                Why this fired:
              </strong>{" "}
              {row.behavior_summary}
            </p>
          )}
        </div>

        {/* Rendered DM body */}
        {preview && (
          <div
            className="mb-4 p-3 rounded"
            style={{
              background: "var(--color-bg-primary)",
              border: "1px solid var(--color-border)",
              fontSize: 13,
              lineHeight: 1.55,
              whiteSpace: "pre-wrap",
              color: "var(--color-text-primary)",
              maxHeight: 280,
              overflow: "auto",
            }}
          >
            <div
              style={{
                fontSize: 10,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "var(--color-text-tertiary)",
                marginBottom: 6,
              }}
            >
              DM body (rendered for this student)
            </div>
            {preview.body}
            {preview.unresolved.length > 0 && (
              <p
                style={{
                  marginTop: 8,
                  fontSize: 11,
                  color: "var(--color-warning)",
                }}
              >
                ⚠ Unresolved placeholders:{" "}
                {preview.unresolved.map((v) => `{${v}}`).join(", ")}
              </p>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 flex-wrap">
          {row.status === "open" && !template?.is_admin_only && (
            <>
              <button onClick={onCopy} style={primaryBtn(busy)}>
                Copy DM
              </button>
              <button onClick={onMarkSent} disabled={busy} style={ghostBtn()}>
                Mark sent
              </button>
              <button onClick={onDismiss} disabled={busy} style={ghostBtn()}>
                Dismiss
              </button>
            </>
          )}
          {row.status === "open" && template?.is_admin_only && (
            <a href="/admin/discounts" style={primaryBtn(false)}>
              Open discount queue →
            </a>
          )}
          {row.status !== "open" && (
            <button onClick={onReopen} disabled={busy} style={ghostBtn()}>
              Move to To do
            </button>
          )}
          <div className="flex-1" />
          {student?.id && (
            <a
              href={`/admin/students`}
              onClick={(e) => e.stopPropagation()}
              style={{
                fontSize: 12,
                color: "var(--color-text-tertiary)",
                textDecoration: "underline",
                alignSelf: "center",
              }}
            >
              Open student detail →
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

/* ───────── Dismiss modal ───────── */

function DismissModal({
  name,
  value,
  onChange,
  onClose,
  onSubmit,
  busy,
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  onClose: () => void;
  onSubmit: () => void;
  busy: boolean;
}) {
  return (
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
        zIndex: 110,
      }}
      onClick={onClose}
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
          Dismiss task for {name}?
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
          value={value}
          placeholder="e.g. Already replied to Astrid in Discord"
          onChange={(e) => onChange(e.target.value)}
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
          <button onClick={onClose} style={ghostBtn()}>
            Cancel
          </button>
          <button
            onClick={onSubmit}
            disabled={busy}
            style={{
              ...primaryBtn(busy),
              background: "var(--color-danger)",
            }}
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───────── Helpers ───────── */

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

function refreshBtn(busy: boolean): React.CSSProperties {
  return {
    padding: "8px 14px",
    fontSize: 12,
    fontWeight: 600,
    borderRadius: 8,
    background: "var(--color-bg-elevated)",
    border: "1px solid var(--color-border)",
    color: "var(--color-text-primary)",
    cursor: busy ? "wait" : "pointer",
    opacity: busy ? 0.6 : 1,
  };
}

function primaryBtn(busy: boolean): React.CSSProperties {
  return {
    padding: "5px 10px",
    fontSize: 11,
    fontWeight: 600,
    borderRadius: 6,
    background: "var(--color-accent)",
    border: "1px solid var(--color-border)",
    color: "var(--color-text-on-accent, #fff)",
    cursor: busy ? "wait" : "pointer",
    opacity: busy ? 0.6 : 1,
    textDecoration: "none",
    display: "inline-block",
  };
}

function ghostBtn(): React.CSSProperties {
  return {
    padding: "5px 10px",
    fontSize: 11,
    fontWeight: 500,
    borderRadius: 6,
    background: "transparent",
    border: "1px solid var(--color-border)",
    color: "var(--color-text-secondary)",
    cursor: "pointer",
  };
}

function metaStyle(): React.CSSProperties {
  return {
    fontSize: 10,
    color: "var(--color-text-tertiary)",
    marginTop: 6,
  };
}

function toastStyle(): React.CSSProperties {
  return {
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
    maxWidth: 380,
  };
}
