"use client";

/**
 * /admin/tasks — Astrid's task queue (v3: priority-first).
 *
 * Design intent (vs. v2's age grouping):
 *
 *   • Priority is the primary axis. Open tasks group into tiers:
 *     Canceling (student clicked cancel, still has access — computed
 *     from the student row via isCanceling, NOT from the template, so
 *     any open task for a canceling student pins to the top) →
 *     Cancel path → At risk → Events & wins. Age grouping
 *     (Today / This week / Older) remains only on Sent / Dismissed.
 *
 *   • Oldest first within each tier, with a "waiting Nd" chip that
 *     warms at 2d and burns at 4d — neglected tasks surface instead
 *     of sinking, and nothing rots silently into auto-dismiss.
 *
 *   • Cards decide without the modal: behavior summary ("why this
 *     fired") + @discord / No-Discord chip + Canceling / Past-due
 *     pills live on the card. The modal keeps the full DM preview.
 *
 *   • Queue health strip under the tabs: open count by tier, oldest
 *     waiting, sent today.
 *
 * Workflow stays the same: Copy DM → send in Discord → Mark sent.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { createClient } from "@/lib/supabase-browser";
import type { Student, Task, TaskOutcome, Template } from "@/types/database";
import { getDayNumber } from "@/types/database";
import {
  BUCKET_GLYPH,
  BUCKET_PRIORITY,
  stripBucketGlyph,
  loadAdminConfig,
  renderTemplate,
} from "@/lib/templates";
import {
  AdminPage,
  PageHeader,
  Section,
  Card,
  Button,
  IconButton,
  Avatar,
  Pill,
  Tabs,
  Modal,
  Toast,
  EmptyState,
  T,
} from "@/components/admin/ui";
import { isCanceling } from "@/lib/admin/metrics-definitions";

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

type StatusKey = "open" | "completed" | "dismissed";

type AdminConfig =
  | Partial<
      Record<
        | "program_login_link"
        | "discord_invite_link",
        string | null
      >
    >
  | undefined;

const BUCKET_LABEL: Record<string, string> = {
  at_risk: "At risk",
  cancel_path: "Cancel path",
  crushing: "Crushing",
  event: "Event",
  admin: "Admin",
};

/** Map bucket → pill tone for the small badge in the detail modal. */
function bucketTone(b?: string) {
  if (b === "at_risk") return "warning" as const;
  if (b === "cancel_path") return "danger" as const;
  if (b === "crushing") return "accent" as const;
  return "neutral" as const;
}

/** Bucket → tiny monochrome leading dot color on each task card. */
function bucketDot(b?: string) {
  if (b === "at_risk") return "var(--color-warning)";
  if (b === "cancel_path") return "var(--color-danger)";
  if (b === "crushing") return "var(--color-accent-dark)";
  if (b === "event") return "var(--color-text-secondary)";
  return "var(--color-text-tertiary)";
}

/**
 * Bucket a timestamp into "today" / "this_week" / "older". Used only
 * on the Sent / Dismissed tabs, where recency IS the right grouping.
 */
function urgencyOf(createdAt: string): "today" | "this_week" | "older" {
  const ageMs = Date.now() - new Date(createdAt).getTime();
  const days = ageMs / 86_400_000;
  if (days < 1) return "today";
  if (days < 7) return "this_week";
  return "older";
}

/**
 * Priority tier for the open queue. Canceling comes from the STUDENT
 * (cancel_scheduled_at + still active), not the template — a student
 * who clicks cancel while holding any open task jumps to the top.
 */
type Tier = "canceling" | "cancel_path" | "at_risk" | "other";

const TIER_ORDER: Tier[] = ["canceling", "cancel_path", "at_risk", "other"];

const TIER_LABEL: Record<Tier, string> = {
  canceling: "Canceling · save first",
  cancel_path: "Cancel path",
  at_risk: "At risk",
  other: "Events & wins",
};

function tierOf(row: TaskRow): Tier {
  if (row.student && isCanceling(row.student)) return "canceling";
  const b = row.template?.bucket;
  if (b === "cancel_path") return "cancel_path";
  if (b === "at_risk") return "at_risk";
  return "other";
}

/** "waiting 3h/3d" chip — warms at 2 days in queue, burns at 4. */
function waitingLabel(createdAt: string): {
  text: string;
  color: string;
} {
  const ms = Date.now() - new Date(createdAt).getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days < 1) {
    const h = Math.max(1, Math.floor(ms / 3_600_000));
    return { text: `waiting ${h}h`, color: "var(--color-text-tertiary)" };
  }
  return {
    text: `waiting ${days}d`,
    color:
      days >= 4
        ? "var(--color-danger)"
        : days >= 2
          ? "var(--color-warning)"
          : "var(--color-text-tertiary)",
  };
}

/** Whole days since the sync first observed the scheduled cancel. */
function daysSince(iso: string): number {
  return Math.max(
    0,
    Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000),
  );
}

export default function AdminTasksKanban() {
  const supabase = createClient();
  const { teamMember } = useAuth();

  const [rows, setRows] = useState<TaskRow[]>([]);
  const [status, setStatus] = useState<StatusKey>("open");
  const [studentSearch, setStudentSearch] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [generating, setGenerating] = useState(false);
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

  // v75.3 - "Generate now" is now visible to every team role
  // (was founder/admin only). The run-task-crons API already lets
  // any team member trigger it; the button just gates the UI.
  // Karlo's call: CSMs need it as much as Astrid does.

  const fetchTasks = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const token = session?.access_token;
        // Pull all statuses in one round-trip so the tabs can show
        // their counts without re-fetching when the user switches.
        const params = new URLSearchParams();
        params.set("status", "all");
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
    [studentSearch, supabase],
  );

  // v75.22 - one-button full refresh. Hits /api/admin/refresh-everything
  // which syncs Whop, rebuilds snapshots, and re-runs all three CSM
  // crons (auto-dismiss orphans + create new). Takes ~2 minutes.
  // Replaces the v59-era run-task-crons trigger.
  const generateTasksNow = useCallback(async () => {
    setGenerating(true);
    setError(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch("/api/admin/refresh-everything", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const payload = (await res.json()) as {
        sync?: { fetched?: number; updated?: number; inserted?: number };
        csm_tasks?: { tasks_created?: number };
        na_tasks?: { created?: number };
        engagement?: { alerts?: number };
      };
      const csmN = payload.csm_tasks?.tasks_created ?? 0;
      const naN = payload.na_tasks?.created ?? 0;
      const alerts = payload.engagement?.alerts ?? 0;
      const fetched = payload.sync?.fetched ?? 0;
      setToast(
        `Refreshed everything · Whop ${fetched} members · +${csmN + naN} tasks · ${alerts} alerts.`,
      );
      // Refresh the queue so any dismissed/new rows show up.
      await fetchTasks(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setGenerating(false);
  }, [supabase, fetchTasks]);

  useEffect(() => {
    void fetchTasks(false);
  }, [fetchTasks]);

  useEffect(() => {
    void (async () => {
      const c = await loadAdminConfig(supabase);
      setConfig(c);
    })();
  }, [supabase]);

  // Tab counts come from the unfiltered (by status) rows.
  const counts = useMemo(() => {
    return rows.reduce(
      (acc, r) => {
        if (r.status === "open") acc.open++;
        else if (r.status === "completed") acc.completed++;
        else if (r.status === "dismissed") acc.dismissed++;
        return acc;
      },
      { open: 0, completed: 0, dismissed: 0 },
    );
  }, [rows]);

  /**
   * Open tab: tasks grouped into priority tiers (canceling first),
   * OLDEST first within each tier so long-waiting tasks surface.
   * Ties inside "Events & wins" keep the old bucket order.
   */
  const openTiers = useMemo(() => {
    const tiers: Record<Tier, TaskRow[]> = {
      canceling: [],
      cancel_path: [],
      at_risk: [],
      other: [],
    };
    for (const r of rows) {
      if (r.status !== "open") continue;
      tiers[tierOf(r)].push(r);
    }
    for (const tier of TIER_ORDER) {
      tiers[tier].sort((a, b) => {
        if (tier === "other") {
          const pa = BUCKET_PRIORITY[a.template?.bucket ?? ""] ?? 99;
          const pb = BUCKET_PRIORITY[b.template?.bucket ?? ""] ?? 99;
          if (pa !== pb) return pa - pb;
        }
        return (
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
      });
    }
    return tiers;
  }, [rows]);

  /**
   * Sent / Dismissed tabs keep the v2 recency grouping — for history,
   * "when did this happen" is the right mental model.
   */
  const historyGroups = useMemo(() => {
    const groups: Record<"today" | "this_week" | "older", TaskRow[]> = {
      today: [],
      this_week: [],
      older: [],
    };
    if (status === "open") return groups;
    for (const r of rows) {
      if (r.status !== status) continue;
      const sortKey =
        status === "completed"
          ? r.completed_at ?? r.created_at
          : r.dismissed_at ?? r.created_at;
      groups[urgencyOf(sortKey)].push(r);
    }
    for (const g of Object.values(groups)) {
      g.sort((a, b) => {
        const ta =
          status === "completed"
            ? a.completed_at ?? a.created_at
            : a.dismissed_at ?? a.created_at;
        const tb =
          status === "completed"
            ? b.completed_at ?? b.created_at
            : b.dismissed_at ?? b.created_at;
        return new Date(tb).getTime() - new Date(ta).getTime();
      });
    }
    return groups;
  }, [rows, status]);

  /** Queue health: open by tier, oldest wait, sent today. */
  const health = useMemo(() => {
    const open = rows.filter((r) => r.status === "open");
    let oldestDays = 0;
    for (const r of open) {
      const d = Math.floor(
        (Date.now() - new Date(r.created_at).getTime()) / 86_400_000,
      );
      if (d > oldestDays) oldestDays = d;
    }
    const today = new Date().toDateString();
    const sentToday = rows.filter(
      (r) =>
        r.status === "completed" &&
        r.completed_at &&
        new Date(r.completed_at).toDateString() === today,
    ).length;
    return {
      open: open.length,
      canceling: open.filter((r) => tierOf(r) === "canceling").length,
      cancelPath: open.filter((r) => tierOf(r) === "cancel_path").length,
      atRisk: open.filter((r) => tierOf(r) === "at_risk").length,
      oldestDays,
      sentToday,
    };
  }, [rows]);

  const openTask = useMemo(
    () => rows.find((r) => r.id === openTaskId) ?? null,
    [rows, openTaskId],
  );

  const isQueueEmpty =
    status === "open"
      ? TIER_ORDER.every((t) => openTiers[t].length === 0)
      : historyGroups.today.length === 0 &&
        historyGroups.this_week.length === 0 &&
        historyGroups.older.length === 0;

  const renderRow = (row: TaskRow) => (
    <TaskRow
      key={row.id}
      row={row}
      status={status}
      busy={busyId === row.id}
      onOpen={() => setOpenTaskId(row.id)}
      onCopy={() => copyDMOnly(row)}
      onMarkSent={() => transitionTask(row.id, "completed")}
      onReopen={() => transitionTask(row.id, "open")}
      onOutcome={(next) => void setTaskOutcome(row.id, next)}
      onDismiss={() =>
        setDismissModal({
          id: row.id,
          name: row.student?.name ?? "this student",
        })
      }
    />
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
        `DM copied for ${row.student.name?.split(" ")[0] ?? "task"}. Send it, then click Mark sent.`,
      );
      setTimeout(() => setToast(null), 3000);
    } catch {
      setError("Couldn't access the clipboard.");
    }
  }

  async function transitionTask(rowId: string, to: StatusKey, notes?: string) {
    setBusyId(rowId);
    setError(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
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

  /**
   * Phase 0 — one-tap reply tracking on sent tasks. Tapping the active
   * outcome again clears it (handled by the caller passing null).
   */
  async function setTaskOutcome(rowId: string, outcome: TaskOutcome | null) {
    setBusyId(rowId);
    setError(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`/api/admin/tasks/${rowId}/outcome`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ outcome }),
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
    <AdminPage>
      <PageHeader
        title="Task queue"
        description={
          teamMember?.full_name
            ? `Signed in as ${teamMember.full_name}. Copy a DM, send it in Discord, then mark it sent.`
            : "Copy a DM, send it in Discord, then mark it sent."
        }
        actions={
          // v75.23: one button only. The old "↻ Refresh" (just
          // refetch the queue without a Whop sync) was redundant and
          // misleading — Karlo couldn't tell which one to click.
          <Button
            variant="subtle"
            size="md"
            busy={generating || refreshing}
            onClick={() => void generateTasksNow()}
            title="Sync Whop, rebuild snapshots, re-evaluate all tasks (auto-dismiss stale + create new). ~2 min."
          >
            {generating || refreshing ? "Refreshing…" : "↻ Refresh"}
          </Button>
        }
      />

      {/* Status tabs — primary mental model for what to look at next. */}
      <div
        className="flex items-center justify-between gap-3 flex-wrap"
        style={{ marginBottom: 24 }}
      >
        <Tabs
          value={status}
          onChange={setStatus}
          tabs={[
            { value: "open", label: "To do", count: counts.open },
            { value: "completed", label: "Sent", count: counts.completed },
            {
              value: "dismissed",
              label: "Dismissed",
              count: counts.dismissed,
            },
          ]}
        />
        <input
          type="text"
          placeholder="Search name / email / @discord"
          value={studentSearch}
          onChange={(e) => setStudentSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void fetchTasks(true)}
          style={{
            padding: "8px 12px",
            fontSize: 13,
            background: "var(--color-bg-card)",
            border: "1px solid var(--color-border)",
            borderRadius: 10,
            color: "var(--color-text-primary)",
            outline: "none",
            minWidth: 260,
            letterSpacing: "-0.005em",
          }}
        />
      </div>

      {/* Queue health — the "am I done for today?" line. */}
      {!loading && rows.length > 0 && (
        <p
          style={{
            ...T.meta,
            marginBottom: 20,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <span style={{ fontWeight: 600 }}>{health.open} open</span>
          {health.canceling > 0 && (
            <span style={{ color: "var(--color-danger)", fontWeight: 600 }}>
              {" · "}
              {health.canceling} canceling
            </span>
          )}
          {health.cancelPath > 0 && (
            <span>
              {" · "}
              {health.cancelPath} cancel path
            </span>
          )}
          {health.atRisk > 0 && (
            <span>
              {" · "}
              {health.atRisk} at risk
            </span>
          )}
          {health.oldestDays >= 1 && (
            <span
              style={
                health.oldestDays >= 4
                  ? { color: "var(--color-warning)" }
                  : undefined
              }
            >
              {" · "}oldest waiting {health.oldestDays}d
            </span>
          )}
          <span>
            {" · "}
            {health.sentToday} sent today
          </span>
        </p>
      )}

      {error && (
        <div
          style={{
            background: "rgba(200,74,74,0.10)",
            border: "1px solid rgba(200,74,74,0.30)",
            borderRadius: 10,
            padding: "10px 14px",
            fontSize: 13,
            color: "var(--color-danger)",
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      {loading ? (
        <LoadingPulse />
      ) : (
        <>
          {status === "open"
            ? TIER_ORDER.map((tier) => {
                const items = openTiers[tier];
                if (items.length === 0) return null;
                return (
                  <Section
                    key={tier}
                    eyebrow={TIER_LABEL[tier]}
                    count={items.length}
                  >
                    <div className="flex flex-col" style={{ gap: 8 }}>
                      {items.map(renderRow)}
                    </div>
                  </Section>
                );
              })
            : (["today", "this_week", "older"] as const).map((group) => {
                const items = historyGroups[group];
                if (items.length === 0) return null;
                return (
                  <Section
                    key={group}
                    eyebrow={groupLabel(group)}
                    count={items.length}
                  >
                    <div className="flex flex-col" style={{ gap: 8 }}>
                      {items.map(renderRow)}
                    </div>
                  </Section>
                );
              })}
          {isQueueEmpty && (
            <Card>
              <EmptyState
                title={emptyLabel(status)}
                description={emptyDescription(status)}
              />
            </Card>
          )}
        </>
      )}

      {toast && <Toast message={toast} />}

      <Modal open={Boolean(openTask)} onClose={() => setOpenTaskId(null)}>
        {openTask && (
          <TaskDetail
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
      </Modal>

      <Modal
        open={Boolean(dismissModal)}
        onClose={() => {
          setDismissModal(null);
          setDismissNote("");
        }}
        maxWidth={460}
      >
        {dismissModal && (
          <>
            <h3 style={{ ...T.heading, marginBottom: 4 }}>
              Dismiss task for {dismissModal.name}?
            </h3>
            <p style={{ ...T.bodyDim, marginBottom: 16 }}>
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
                padding: "10px 12px",
                fontSize: 13,
                background: "var(--color-bg-primary)",
                border: "1px solid var(--color-border)",
                borderRadius: 8,
                color: "var(--color-text-primary)",
                resize: "vertical",
                marginBottom: 16,
                letterSpacing: "-0.005em",
              }}
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="md"
                onClick={() => {
                  setDismissModal(null);
                  setDismissNote("");
                }}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                size="md"
                busy={busyId === dismissModal.id}
                onClick={() => void submitDismiss()}
              >
                Dismiss
              </Button>
            </div>
          </>
        )}
      </Modal>
    </AdminPage>
  );
}

/* ─────────── Single task row ─────────── */

function TaskRow({
  row,
  status,
  busy,
  onOpen,
  onCopy,
  onMarkSent,
  onReopen,
  onOutcome,
  onDismiss,
}: {
  row: TaskRow;
  status: StatusKey;
  busy: boolean;
  onOpen: () => void;
  onCopy: () => void;
  onMarkSent: () => void;
  onReopen: () => void;
  onOutcome: (next: TaskOutcome | null) => void;
  onDismiss: () => void;
}) {
  const { student, template } = row;
  const isAdminOnly = template?.is_admin_only === true;
  // v75.18: anchor day on first_paid_at (original signup), fallback to joined_at.
  const day = student ? getDayNumber(student.first_paid_at ?? student.joined_at) : null;
  const dotColor = bucketDot(template?.bucket);
  const cancelingStudent = Boolean(student && isCanceling(student));
  const pastDue = student?.membership_status === "past_due";
  const wait = status === "open" ? waitingLabel(row.created_at) : null;
  // "Why this fired" is the decision fuel; template title is the fallback
  // for tasks whose cron didn't write a behavior summary.
  const why =
    row.behavior_summary ??
    (template?.title ? stripBucketGlyph(template.title) : "(no template)");

  return (
    <Card
      padding={0}
      style={
        cancelingStudent
          ? { borderLeft: "2px solid var(--color-danger)" }
          : undefined
      }
    >
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
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 16px",
          cursor: "pointer",
        }}
      >
        {/* bucket dot — meaning-bearing color, very small */}
        <span
          aria-hidden="true"
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: dotColor,
            flexShrink: 0,
          }}
        />
        <Avatar src={student?.avatar_url} name={student?.name} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <strong style={T.cardTitle} className="truncate">
              {student?.name ?? "—"}
            </strong>
            {day !== null && (
              <span style={T.meta}>Day {day}</span>
            )}
            {cancelingStudent && (
              <Pill tone="danger">
                Canceling
                {student?.cancel_scheduled_at
                  ? ` · ${daysSince(student.cancel_scheduled_at)}d`
                  : ""}
              </Pill>
            )}
            {pastDue && !cancelingStudent && (
              <Pill tone="warning">Past due</Pill>
            )}
            {!student?.discord_username && !isAdminOnly && (
              <Pill tone="warning">No Discord</Pill>
            )}
          </div>
          <p
            className="truncate"
            style={{
              ...T.bodyDim,
              fontSize: 12,
              marginTop: 2,
            }}
          >
            {student?.discord_username && (
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  color: "var(--color-text-tertiary)",
                }}
              >
                @{student.discord_username}
                {" · "}
              </span>
            )}
            {why}
          </p>
        </div>
        {wait && (
          <span
            style={{
              fontSize: 11,
              color: wait.color,
              flexShrink: 0,
              fontVariantNumeric: "tabular-nums",
              letterSpacing: "-0.005em",
            }}
          >
            {wait.text}
          </span>
        )}
        <div
          className="flex items-center gap-2"
          onClick={(e) => e.stopPropagation()}
        >
          {status === "open" && !isAdminOnly && (
            <>
              <Button variant="primary" busy={busy} onClick={onCopy}>
                Copy DM
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={onMarkSent}
                title="Mark sent"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M5 13l4 4L19 7" />
                </svg>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={onDismiss}
                title="Dismiss"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </Button>
            </>
          )}
          {status === "open" && isAdminOnly && (
            <Button variant="primary" href="/admin/discounts">
              Open discount →
            </Button>
          )}
          {status === "completed" && (
            <>
              <Button
                variant={row.outcome === "replied" ? "primary" : "ghost"}
                size="sm"
                busy={busy}
                onClick={() =>
                  onOutcome(row.outcome === "replied" ? null : "replied")
                }
                title="Student replied to the DM (tap again to clear)"
              >
                Replied
              </Button>
              <Button
                variant={row.outcome === "no_reply" ? "primary" : "ghost"}
                size="sm"
                busy={busy}
                onClick={() =>
                  onOutcome(row.outcome === "no_reply" ? null : "no_reply")
                }
                title="No response to the DM (tap again to clear)"
              >
                No reply
              </Button>
            </>
          )}
          {status !== "open" && (
            <Button variant="ghost" busy={busy} onClick={onReopen}>
              Move to To do
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

/* ─────────── Detail modal body ─────────── */

function TaskDetail({
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
  // v75.18: anchor day on first_paid_at (original signup), fallback to joined_at.
  const day = student ? getDayNumber(student.first_paid_at ?? student.joined_at) : null;
  const preview =
    template && student && !template.is_admin_only
      ? renderTemplate(template.body, {
          student: { name: student.name, joined_at: student.joined_at },
          config,
        })
      : null;

  return (
    <>
      {/* Header */}
      <div className="flex items-start gap-3" style={{ marginBottom: 20 }}>
        <Avatar src={student?.avatar_url} name={student?.name} size={44} />
        <div className="flex-1 min-w-0">
          <h2 style={{ ...T.heading, marginBottom: 4 }}>
            {student?.name ?? "—"}
          </h2>
          <p style={T.meta}>
            {day !== null ? `Day ${day} · ` : ""}
            {student?.membership_status ?? "—"}
            {student?.email ? ` · ${student.email}` : ""}
          </p>
        </div>
        <IconButton label="Close" onClick={onClose}>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </IconButton>
      </div>

      {/* Discord username, only thing they need handy to send the DM */}
      <div
        style={{
          padding: "10px 14px",
          background: "var(--color-fill-secondary)",
          borderRadius: 8,
          fontSize: 13,
          marginBottom: 20,
          letterSpacing: "-0.005em",
        }}
      >
        <span style={{ color: "var(--color-text-tertiary)" }}>
          Discord:{" "}
        </span>
        {student?.discord_username ? (
          <span
            style={{
              fontFamily: "var(--font-mono)",
              color: "var(--color-text-primary)",
              fontWeight: 600,
            }}
          >
            @{student.discord_username}
          </span>
        ) : (
          <span style={{ color: "var(--color-warning)", fontStyle: "italic" }}>
            not connected
          </span>
        )}
      </div>

      {/* Scenario */}
      <div style={{ marginBottom: 20 }}>
        <div
          className="flex items-baseline gap-2 flex-wrap"
          style={{ marginBottom: 6 }}
        >
          {template?.bucket && (
            <Pill tone={bucketTone(template.bucket)}>
              {BUCKET_LABEL[template.bucket] ?? template.bucket}
            </Pill>
          )}
          <h3 style={T.cardTitle}>
            {template?.title ? stripBucketGlyph(template.title) : "—"}
          </h3>
        </div>
        {row.behavior_summary && (
          <p style={{ ...T.bodyDim, fontSize: 13, lineHeight: 1.5 }}>
            <span style={{ color: "var(--color-text-tertiary)" }}>
              Why this fired:{" "}
            </span>
            {row.behavior_summary}
          </p>
        )}
        {template?.trigger_description && !row.behavior_summary && (
          <p style={{ ...T.bodyDim, fontSize: 13, lineHeight: 1.5 }}>
            <span style={{ color: "var(--color-text-tertiary)" }}>
              Trigger:{" "}
            </span>
            {template.trigger_description}
          </p>
        )}
      </div>

      {/* Rendered DM */}
      {preview && (
        <div
          style={{
            background: "var(--color-bg-primary)",
            border: "1px solid var(--color-border)",
            borderRadius: 10,
            padding: "14px 16px",
            fontSize: 13,
            lineHeight: 1.55,
            whiteSpace: "pre-wrap",
            color: "var(--color-text-primary)",
            maxHeight: 280,
            overflow: "auto",
            marginBottom: 20,
            letterSpacing: "-0.005em",
          }}
        >
          <div
            style={{
              ...T.eyebrow,
              marginBottom: 8,
            }}
          >
            DM body
          </div>
          {preview.body}
          {preview.unresolved.length > 0 && (
            <p
              style={{
                marginTop: 10,
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
      <div className="flex gap-2 flex-wrap items-center">
        {row.status === "open" && !template?.is_admin_only && (
          <>
            <Button variant="primary" size="md" busy={busy} onClick={onCopy}>
              Copy DM
            </Button>
            <Button variant="ghost" size="md" busy={busy} onClick={onMarkSent}>
              Mark sent
            </Button>
            <Button variant="ghost" size="md" busy={busy} onClick={onDismiss}>
              Dismiss
            </Button>
          </>
        )}
        {row.status === "open" && template?.is_admin_only && (
          <Button variant="primary" size="md" href="/admin/discounts">
            Open discount queue →
          </Button>
        )}
        {row.status !== "open" && (
          <Button variant="ghost" size="md" busy={busy} onClick={onReopen}>
            Move to To do
          </Button>
        )}
        <div className="flex-1" />
        {student?.id && (
          <Button
            variant="ghost"
            size="md"
            href={`/admin/students/${student.id}`}
          >
            Open student detail →
          </Button>
        )}
      </div>
    </>
  );
}

/* ─────────── Misc ─────────── */

function LoadingPulse() {
  return (
    <div className="flex items-center justify-center" style={{ padding: 64 }}>
      <div
        className="rounded-full animate-spin"
        style={{
          width: 22,
          height: 22,
          border: "2px solid var(--color-accent-dark)",
          borderTopColor: "transparent",
        }}
      />
    </div>
  );
}

function groupLabel(g: "today" | "this_week" | "older") {
  if (g === "today") return "Today";
  if (g === "this_week") return "This week";
  return "Older";
}

function emptyLabel(s: StatusKey) {
  if (s === "open") return "Inbox zero.";
  if (s === "completed") return "Nothing sent yet.";
  return "Nothing dismissed.";
}

function emptyDescription(s: StatusKey) {
  if (s === "open") return "New tasks land here when the daily cron fires.";
  if (s === "completed")
    return "When you mark a task sent it moves here for the record.";
  return "Tasks you dismiss with a reason live here.";
}

// Silence unused-import warning — BUCKET_GLYPH is still exported for
// other surfaces (templates page legend); we don't render the glyph
// on cards any more, but importing keeps the module bundle consistent.
void BUCKET_GLYPH;
