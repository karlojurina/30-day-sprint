"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button, Card, EmptyState, Modal, Pill, T } from "@/components/admin/ui";
import type { PillTone } from "@/components/admin/ui";
import { ListHeader, ListPage, LoadError, NoticeStack, STALE_TEXT, SkeletonRows, TAP } from "@/components/admin/list-parts";
import type { Notice } from "@/components/admin/list-parts";
import { FactsLine, SearchField, STATUS_WORDS, TabStrip, Warning } from "@/components/admin/people-parts";
import { TextLink } from "@/components/admin/review-parts";
import { useAuth } from "@/contexts/AuthContext";
import type { Answer } from "@/lib/admin/admin-transport";
import { clockLabel, dayTimeLabel } from "@/lib/admin/croatia-dates";
import { tasksTransport, type TasksTransport } from "@/lib/admin/people-transport";
import {
  HISTORY_LABEL,
  TAB_LABEL,
  TIER_LABEL,
  TIER_ORDER,
  closedLine,
  historyGroups,
  openTiers,
  queueHealth,
  tabsFor,
  taskStudentName,
  tierOf,
  waitingText,
  type HistoryGroup,
  type TaskRow,
  type TaskTab,
  type TasksAnswer,
} from "@/lib/admin/tasks-view";
import { isCanceling } from "@/lib/admin/metrics-definitions";
import { BUCKET_LABEL, renderTemplate, stripBucketGlyph } from "@/lib/templates";
import { dayNumber } from "@/lib/admin/people-common";
import type { TeamMember } from "@/types/database";

/**
 * The Tasks page, /admin/tasks (admin rebuild 2, D7), in the brand kit's
 * dark look: the CSM's queue. Copy a DM, send it in Discord, then mark it
 * sent.
 *
 * THE RESET. Once v109 ran (admin_config.tasks_reset_at), To do, Sent and
 * Dismissed hold only the tasks made since then, and an Archived tab holds
 * every older one, read only: no Copy DM, no Mark sent, no Move to To do.
 * GET /api/admin/tasks draws that line in the database (route.ts); this page
 * shows what it answers. Before v109 there is no Archived tab.
 *
 * To do is in tiers (canceling first, from the student; then cancel path,
 * at risk, events and wins), the longest wait first in each. Sent and
 * Dismissed are newest first, grouped by when they were closed, each row
 * saying how and when. Every count is the route's exact count; a list cut
 * at 500 says so.
 *
 * "Run task checks" runs the task checks (founders and admins: the Whop
 * sync and the snapshots too, about 2 minutes), then reads the list again;
 * "Refresh" on the other pages only reads again, so this one is named for
 * what it does. "Outreach insights" in the header opens
 * /admin/tasks/insights (the pills that did were the status tabs' twins).
 * What a button did, or why it failed, shows at the bottom of the window
 * (NoticeStack).
 *
 * The calls go through `transport` (people-transport.ts), so the dev page
 * /dev/admin/tasks renders this same view with made-up data and no login.
 */

type Loaded = { kind: "loading" } | { kind: "error"; error: string } | { kind: "ready"; data: TasksAnswer };

const TAB_EMPTY: Record<TaskTab, { title: string; description: string }> = {
  open: { title: "Nothing to do.", description: "New tasks land here when the task checks run: every 2 hours, or on Run task checks." },
  completed: { title: "Nothing sent yet.", description: "A task marked sent moves here, for the record." },
  dismissed: { title: "Nothing dismissed.", description: "A task dismissed with a reason, or by the checks, moves here." },
  archived: { title: "Nothing from before the reset.", description: "" },
};

const BUCKET_TONE: Record<string, PillTone> = {
  at_risk: "warning",
  cancel_path: "danger",
  crushing: "accent",
};

/**
 * The left edge of a To do row: red for canceling (the save comes first),
 * orange for cancel path and at risk. Colour on an edge only; the tier's
 * name is above the list.
 */
function edgeOf(row: TaskRow): string | null {
  const tier = tierOf(row);
  if (tier === "canceling") return "var(--color-danger)";
  if (tier === "cancel_path" || tier === "at_risk") return "var(--color-warning)";
  return null;
}

/** "Why this fired", or the template's title when the check wrote none. */
function whyOf(row: TaskRow): string {
  return row.behavior_summary?.trim() || (row.template?.title ? stripBucketGlyph(row.template.title) : "No template");
}

function tabNote(tab: TaskTab, resetAt: string | null): string {
  const since = resetAt ? ` made since the reset on ${dayTimeLabel(resetAt)} (Croatia time)` : "";
  if (tab === "open") return `Open tasks${since}, canceling first, then the longest wait first.`;
  if (tab === "completed") return `Tasks${since}${since ? " and" : ""} marked sent, newest first. Mark whether the student replied.`;
  if (tab === "dismissed") return `Tasks${since}${since ? " and" : ""} dismissed by the team or by the checks, newest first.`;
  return `Tasks made before the reset on ${dayTimeLabel(resetAt)} (Croatia time), newest first. Read only: they cannot be sent, dismissed or moved back.`;
}

export function TasksView({
  transport = tasksTransport,
  role,
  initialTab = "open",
}: {
  transport?: TasksTransport;
  /** The member's role; read from the login when not given (the dev page gives one). */
  role?: TeamMember["role"] | null;
  initialTab?: TaskTab;
}) {
  const auth = useAuth();
  const myRole = role !== undefined ? role : (auth.teamMember?.role ?? null);
  const fullChecks = myRole === "founder" || myRole === "admin";

  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [tab, setTab] = useState<TaskTab>(initialTab);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [reloading, setReloading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [stale, setStale] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState<TaskRow | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const seq = useRef(0);
  const noticeSeq = useRef(0);
  const everRead = useRef(false);

  const show = useCallback((n: Omit<Notice, "id">) => setNotice({ ...n, id: ++noticeSeq.current }), []);

  /** One read of the list. Null when a newer read started meanwhile: that one's answer wins. */
  const fetchTasks = useCallback(
    async (q: string): Promise<Answer<TasksAnswer> | null> => {
      const mine = ++seq.current;
      const r = await transport.loadTasks(q);
      return mine === seq.current ? r : null;
    },
    [transport],
  );

  /**
   * What a read shows. A first read that fails is the page's error, with
   * Retry; a later one keeps the list as it was and says it may be out of
   * date.
   */
  const apply = useCallback((r: Answer<TasksAnswer>) => {
    if (r.ok) {
      everRead.current = true;
      setLoaded({ kind: "ready", data: r.data });
      setStale(false);
    } else if (everRead.current) {
      setStale(true);
    } else {
      setLoaded({ kind: "error", error: r.error });
    }
  }, []);

  const read = useCallback(
    async (q: string) => {
      const r = await fetchTasks(q);
      if (r) apply(r);
    },
    [fetchTasks, apply],
  );

  // The search goes to the route a moment after the typing stops.
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    let alive = true;
    void fetchTasks(query).then((r) => {
      if (alive && r) apply(r);
    });
    return () => {
      alive = false;
    };
  }, [fetchTasks, apply, query]);

  async function reload() {
    setReloading(true);
    await read(query);
    setReloading(false);
  }

  async function runChecks() {
    setChecking(true);
    const r = await transport.runChecks(fullChecks);
    if (r.ok) show({ tone: "success", text: r.data.text });
    else show({ tone: "danger", text: r.error });
    await read(query);
    setChecking(false);
  }

  /**
   * One button's call: its notice, then the list read again. `closed` runs
   * as soon as the call went through (a dialog closes then, not after the
   * read), so nothing it covered waits on the read.
   */
  async function act(row: TaskRow, fn: () => Promise<Answer<null>>, done: string, closed?: () => void): Promise<boolean> {
    setBusyId(row.id);
    const r = await fn();
    if (r.ok) {
      closed?.();
      show({ tone: "success", text: done });
      await read(query);
    } else {
      show({ tone: "danger", text: `${taskStudentName(row)}: ${r.error}` });
    }
    setBusyId(null);
    return r.ok;
  }

  async function copyDm(row: TaskRow, links: TasksAnswer["links"]) {
    if (!row.template || !row.student) return;
    const { body } = renderTemplate(row.template.body, {
      student: { name: row.student.name, joined_at: row.student.joined_at },
      config: links,
    });
    try {
      await navigator.clipboard.writeText(body);
      show({ tone: "success", text: `DM copied for ${taskStudentName(row)}. Send it in Discord, then press Mark sent.` });
    } catch {
      show({ tone: "danger", text: "Couldn't copy the DM. Open the task and copy it from there." });
    }
  }

  const notices: Notice[] = [];
  if (notice) notices.push(notice);
  if (stale) notices.push({ id: -1, tone: "warning", text: STALE_TEXT });

  const header = (data: TasksAnswer | null) => (
    <ListHeader
      title="Tasks"
      description="Copy a DM, send it in Discord, then mark it sent."
      meta={data ? `Updated ${clockLabel(data.generatedAt)}${reloading || checking ? " · Updating" : ""}` : "Loading"}
      actions={[
        <TextLink key="insights" href="/admin/tasks/insights">
          Outreach insights <span aria-hidden="true">→</span>
        </TextLink>,
        <Button
          key="checks"
          variant="raised"
          size="md"
          busy={checking}
          onClick={() => void runChecks()}
          title={
            fullChecks
              ? "Syncs Whop, rebuilds the snapshots and runs the task checks, then reads the list again. Takes about 2 minutes."
              : "Runs the task checks, then reads the list again. Takes under a minute."
          }
        >
          {checking ? (fullChecks ? "Running the checks, about 2 minutes" : "Running the checks") : "Run task checks"}
        </Button>,
      ]}
    />
  );

  // While the list loads or failed, the tabs keep their place, with no counts (the review's fix round).
  const blankTabs = (
    <TabStrip
      label="Task lists"
      tabs={(["open", "completed", "dismissed"] as TaskTab[]).map((t) => ({ value: t, label: TAB_LABEL[t] }))}
      value={tab === "archived" ? "open" : tab}
      onChange={() => {}}
    />
  );
  if (loaded.kind === "loading") {
    return (
      <ListPage>
        {header(null)}
        {blankTabs}
        <SkeletonRows rows={4} label="Loading the tasks" />
      </ListPage>
    );
  }
  if (loaded.kind === "error") {
    return (
      <ListPage>
        {header(null)}
        {blankTabs}
        <LoadError title="Couldn't load the tasks." detail={loaded.error} onRetry={() => void reload()} busy={reloading} />
        <NoticeStack notices={notices} onClose={() => setNotice(null)} />
      </ListPage>
    );
  }

  const data = loaded.data;
  const tabs = tabsFor(data);
  const current: TaskTab = tabs.some((t) => t.value === tab) ? tab : "open";
  const health = queueHealth(data.tasks, data.generatedAt);
  const openRow = openId ? ([...data.tasks, ...data.archived].find((r) => r.id === openId) ?? null) : null;
  const shownOf = (t: TaskTab) => (t === "archived" ? data.archived.length : data.tasks.filter((r) => r.status === t).length);

  const rowFor = (row: TaskRow, archived: boolean) => (
    <TaskItem
      key={row.id}
      row={row}
      archived={archived}
      now={data.generatedAt}
      busy={busyId === row.id}
      onOpen={() => setOpenId(row.id)}
      onCopy={() => void copyDm(row, data.links)}
      onMarkSent={() => void act(row, () => transport.transition(row.id, "completed"), `Marked the DM to ${taskStudentName(row)} as sent.`)}
      onDismiss={() => setDismissing(row)}
      onReopen={() => void act(row, () => transport.transition(row.id, "open"), `Moved the task for ${taskStudentName(row)} back to To do.`)}
      onOutcome={(o) =>
        void act(
          row,
          () => transport.setOutcome(row.id, o),
          o === "replied" ? `${taskStudentName(row)} replied.` : o === "no_reply" ? `No reply from ${taskStudentName(row)}.` : "Cleared the reply.",
        )
      }
    />
  );

  let list: React.ReactNode;
  if (current === "open") {
    const tiers = openTiers(data.tasks);
    list = TIER_ORDER.filter((t) => tiers[t].length > 0).map((t) => (
      <Group key={t} label={TIER_LABEL[t]} count={tiers[t].length}>
        {tiers[t].map((r) => rowFor(r, false))}
      </Group>
    ));
  } else if (current === "archived") {
    list =
      data.archived.length > 0 ? (
        <Group label="Before the reset" count={data.counts.archived}>
          {data.archived.map((r) => rowFor(r, true))}
        </Group>
      ) : null;
  } else {
    const groups = historyGroups(data.tasks, current, data.generatedAt);
    list = (["today", "this_week", "older"] as HistoryGroup[])
      .filter((g) => groups[g].length > 0)
      .map((g) => (
        <Group key={g} label={HISTORY_LABEL[g]} count={groups[g].length}>
          {groups[g].map((r) => rowFor(r, false))}
        </Group>
      ));
  }
  const shown = shownOf(current);
  const empty = TAB_EMPTY[current];

  return (
    <ListPage>
      {header(data)}
      <NoticeStack notices={notices} onClose={(id) => (id === -1 ? setStale(false) : setNotice(null))} />

      <TabStrip label="Task lists" tabs={tabs} value={current} onChange={setTab} />
      <p style={{ ...T.bodyDim, lineHeight: 1.5, marginBottom: 12 }}>{tabNote(current, data.resetAt)}</p>

      <div style={{ marginBottom: 12, maxWidth: 420 }}>
        <SearchField
          label="Search the tasks by student"
          placeholder="Search by name, email or username"
          value={search}
          onChange={setSearch}
          onEnter={() => setQuery(search.trim())}
        />
      </div>

      {current === "open" && health.open > 0 && (
        <p style={{ ...T.bodyDim, fontSize: 12, marginBottom: 16, fontVariantNumeric: "tabular-nums" }}>
          <span style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>{health.open} open</span>
          {health.canceling > 0 && ` · ${health.canceling} canceling`}
          {health.cancelPath > 0 && ` · ${health.cancelPath} cancel path`}
          {health.atRisk > 0 && ` · ${health.atRisk} at risk`}
          {health.oldestDays >= 1 && ` · oldest waiting ${health.oldestDays} ${health.oldestDays === 1 ? "day" : "days"}`}
          {` · ${health.sentToday} sent today`}
        </p>
      )}

      {/* Only when a DM on To do prints the invite: 4 of the Whop DMs do. */}
      {data.links.discord_invite_link === "" &&
        current === "open" &&
        data.tasks.some((r) => r.status === "open" && r.template?.body.includes("{discordInvite}")) && (
        <Warning>
          The Discord invite link is empty, so a DM that prints it keeps the words {"{discordInvite}"}. Set it on the
          Templates page.
        </Warning>
      )}

      {shown === 0 ? (
        <Card>
          <EmptyState title={query ? "No task matches this search." : empty.title} description={query ? undefined : empty.description || undefined} />
        </Card>
      ) : (
        list
      )}
      {current !== "open" && shown > 0 && shown < data.counts[current] && (
        <p style={{ ...T.bodyDim, fontSize: 12, marginTop: 4 }}>
          Showing the newest {shown} of {data.counts[current]}.
        </p>
      )}

      <Modal open={Boolean(openRow)} onClose={() => setOpenId(null)}>
        {openRow && (
          <TaskDetail
            row={openRow}
            archived={data.archived.includes(openRow)}
            links={data.links}
            now={data.generatedAt}
            busy={busyId === openRow.id}
            onClose={() => setOpenId(null)}
            onCopy={() => void copyDm(openRow, data.links)}
            onMarkSent={() =>
              void act(openRow, () => transport.transition(openRow.id, "completed"), `Marked the DM to ${taskStudentName(openRow)} as sent.`, () =>
                setOpenId(null),
              )
            }
            onDismiss={() => {
              setDismissing(openRow);
              setOpenId(null);
            }}
            onReopen={() =>
              void act(openRow, () => transport.transition(openRow.id, "open"), `Moved the task for ${taskStudentName(openRow)} back to To do.`, () =>
                setOpenId(null),
              )
            }
          />
        )}
      </Modal>

      <Modal open={Boolean(dismissing)} onClose={() => setDismissing(null)} maxWidth={480}>
        {dismissing && (
          <DismissPanel
            row={dismissing}
            busy={busyId === dismissing.id}
            onCancel={() => setDismissing(null)}
            onDismiss={(reason) =>
              void act(dismissing, () => transport.transition(dismissing.id, "dismissed", reason), `Dismissed the task for ${taskStudentName(dismissing)}.`, () =>
                setDismissing(null),
              )
            }
          />
        )}
      </Modal>
    </ListPage>
  );
}

/** A tier or a time group: its name and count, then its rows on one card. */
function Group({ label, count, children }: { label: string; count: number; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 24 }}>
      <h2 className="flex items-baseline" style={{ gap: 8, marginBottom: 8 }}>
        <span style={{ ...T.eyebrow, fontSize: 12 }}>{label}</span>
        <span style={{ fontSize: 12, color: "var(--color-text-secondary)", fontVariantNumeric: "tabular-nums" }}>{count}</span>
      </h2>
      <Card padding={0}>{children}</Card>
    </section>
  );
}

/** Canceling (for how many days), payment failed, no Discord: the pills a row carries. */
function StudentPills({ row, now }: { row: TaskRow; now: string }) {
  const s = row.student;
  const canceling = Boolean(s && isCanceling(s));
  const days = s?.cancel_scheduled_at
    ? Math.max(0, Math.floor((Date.parse(now) - Date.parse(s.cancel_scheduled_at)) / 86_400_000))
    : null;
  return (
    <>
      {canceling && <Pill tone="danger">{days != null ? `Canceling, ${days} ${days === 1 ? "day" : "days"}` : "Canceling"}</Pill>}
      {!canceling && s?.membership_status === "past_due" && <Pill tone="warning">Payment failed</Pill>}
      {!s?.discord_username && row.template?.is_admin_only !== true && <Pill tone="warning">No Discord</Pill>}
    </>
  );
}

function TaskItem({
  row,
  archived,
  now,
  busy,
  onOpen,
  onCopy,
  onMarkSent,
  onDismiss,
  onReopen,
  onOutcome,
}: {
  row: TaskRow;
  archived: boolean;
  now: string;
  busy: boolean;
  onOpen: () => void;
  onCopy: () => void;
  onMarkSent: () => void;
  onDismiss: () => void;
  onReopen: () => void;
  onOutcome: (o: "replied" | "no_reply" | null) => void;
}) {
  const day = row.student ? dayNumber(row.student.first_paid_at ?? row.student.joined_at, Date.parse(now)) : null;
  const adminOnly = row.template?.is_admin_only === true;
  const edge = !archived && row.status === "open" ? edgeOf(row) : null;
  const wait = !archived && row.status === "open" ? waitingText(row.created_at, now) : null;
  return (
    <div
      className="list-row"
      style={{
        flexDirection: "column",
        alignItems: "stretch",
        gap: 8,
        padding: "12px 16px",
        boxShadow: edge ? `inset 3px 0 0 ${edge}` : undefined,
      }}
    >
      <div className="flex flex-wrap items-center" style={{ gap: "4px 10px" }}>
        <button
          type="button"
          onClick={onOpen}
          style={{
            minHeight: TAP,
            display: "inline-flex",
            alignItems: "center",
            padding: 0,
            border: "none",
            background: "transparent",
            cursor: "pointer",
            fontSize: 15,
            fontWeight: 600,
            letterSpacing: "-0.011em",
            color: "var(--color-text-primary)",
            textDecoration: "underline",
            textDecorationColor: "var(--color-border-strong)",
            textUnderlineOffset: 3,
            textAlign: "left",
            overflowWrap: "anywhere",
          }}
        >
          {taskStudentName(row)}
        </button>
        {day != null && <span style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>Day {day}</span>}
        {archived && <Pill tone="neutral">{row.status === "completed" ? "Sent" : row.status === "dismissed" ? "Dismissed" : "Open"}</Pill>}
        {!archived && <StudentPills row={row} now={now} />}
        {wait && (
          <span
            style={{
              marginLeft: "auto",
              fontSize: 12,
              fontWeight: wait.level === "calm" ? 400 : 600,
              color: wait.level === "urgent" ? "var(--color-warning)" : wait.level === "warn" ? "var(--color-text-primary)" : "var(--color-text-secondary)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {wait.text}
          </span>
        )}
      </div>
      <FactsLine
        parts={[row.student?.discord_username ? `@${row.student.discord_username.replace(/^@/, "")}` : null, whyOf(row)]}
        style={{ overflowWrap: "anywhere" }}
      />
      {(archived || row.status !== "open") && <p style={{ ...T.bodyDim, fontSize: 12, lineHeight: 1.5, overflowWrap: "anywhere" }}>{closedLine(row)}</p>}

      {!archived && (
        <div className="flex flex-wrap items-center" style={{ gap: 8 }}>
          {row.status === "open" && !adminOnly && (
            <>
              <Button variant="raised" size="md" disabled={busy} onClick={onCopy}>
                Copy DM
              </Button>
              <Button variant="raised" size="md" busy={busy} onClick={onMarkSent}>
                Mark sent
              </Button>
              <Button variant="ghost" size="md" disabled={busy} onClick={onDismiss}>
                Dismiss
              </Button>
            </>
          )}
          {row.status === "open" && adminOnly && (
            <Link
              href="/admin/discounts"
              style={{
                display: "inline-flex",
                alignItems: "center",
                minHeight: TAP,
                padding: "0 16px",
                borderRadius: "var(--radius-pill)",
                border: "1px solid var(--color-border)",
                background: "var(--color-bg-elevated)",
                color: "var(--color-text-primary)",
                fontSize: 13,
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              Open the 30% page
            </Link>
          )}
          {row.status === "completed" && (
            <>
              <OutcomeButton active={row.outcome === "replied"} busy={busy} onClick={() => onOutcome(row.outcome === "replied" ? null : "replied")}>
                Replied
              </OutcomeButton>
              <OutcomeButton active={row.outcome === "no_reply"} busy={busy} onClick={() => onOutcome(row.outcome === "no_reply" ? null : "no_reply")}>
                No reply
              </OutcomeButton>
            </>
          )}
          {row.status !== "open" && (
            <Button variant="ghost" size="md" disabled={busy} onClick={onReopen}>
              Move to To do
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** Replied or No reply: pressed when it is the outcome marked; pressing it again clears it. */
function OutcomeButton({ active, busy, onClick, children }: { active: boolean; busy: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={busy}
      onClick={onClick}
      title={active ? "Pressed: press again to clear it" : undefined}
      style={{
        display: "inline-flex",
        alignItems: "center",
        minHeight: TAP,
        padding: "0 16px",
        borderRadius: "var(--radius-pill)",
        border: `1px solid ${active ? "var(--color-accent-dark)" : "var(--color-border)"}`,
        background: active ? "var(--color-accent-glow)" : "var(--color-bg-elevated)",
        color: "var(--color-text-primary)",
        fontSize: 13,
        fontWeight: active ? 600 : 500,
        cursor: busy ? "wait" : "pointer",
        opacity: busy ? 0.6 : 1,
      }}
    >
      {children}
    </button>
  );
}

function TaskDetail({
  row,
  archived,
  links,
  now,
  busy,
  onClose,
  onCopy,
  onMarkSent,
  onDismiss,
  onReopen,
}: {
  row: TaskRow;
  archived: boolean;
  links: TasksAnswer["links"];
  now: string;
  busy: boolean;
  onClose: () => void;
  onCopy: () => void;
  onMarkSent: () => void;
  onDismiss: () => void;
  onReopen: () => void;
}) {
  const s = row.student;
  const t = row.template;
  const day = s ? dayNumber(s.first_paid_at ?? s.joined_at, Date.parse(now)) : null;
  const preview = t && s && !t.is_admin_only ? renderTemplate(t.body, { student: { name: s.name, joined_at: s.joined_at }, config: links }) : null;
  const headingId = useId();
  return (
    <div aria-labelledby={headingId} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="flex items-start justify-between" style={{ gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <h2 id={headingId} style={{ ...T.heading, overflowWrap: "anywhere" }}>
            {taskStudentName(row)}
          </h2>
          <FactsLine
            parts={[day != null ? `Day ${day}` : null, s?.membership_status ? (STATUS_WORDS[s.membership_status] ?? s.membership_status) : null, s?.email]}
            style={{ marginTop: 2, overflowWrap: "anywhere" }}
          />
        </div>
        <Button variant="ghost" size="md" onClick={onClose}>
          Close
        </Button>
      </div>

      <p style={{ ...T.body, padding: "10px 14px", borderRadius: "var(--radius-control)", background: "var(--color-bg-elevated)", border: "1px solid var(--color-border)" }}>
        <span style={{ color: "var(--color-text-secondary)" }}>Username: </span>
        {s?.discord_username ? (
          <span style={{ fontWeight: 600 }}>@{s.discord_username.replace(/^@/, "")}</span>
        ) : (
          <span style={{ color: "var(--color-text-secondary)" }}>none on file</span>
        )}
      </p>

      <div>
        <div className="flex flex-wrap items-center" style={{ gap: 8, marginBottom: 6 }}>
          {t?.bucket && <Pill tone={BUCKET_TONE[t.bucket] ?? "neutral"}>{BUCKET_LABEL[t.bucket] ?? t.bucket}</Pill>}
          <h3 style={T.cardTitle}>{t?.title ? stripBucketGlyph(t.title) : "No template"}</h3>
        </div>
        {row.behavior_summary && (
          <p style={{ ...T.bodyDim, lineHeight: 1.5 }}>Why it fired: {row.behavior_summary}</p>
        )}
        {(archived || row.status !== "open") && <p style={{ ...T.bodyDim, lineHeight: 1.5, marginTop: 4 }}>{closedLine(row)}</p>}
      </div>

      {preview && (
        <div
          style={{
            padding: "14px 16px",
            borderRadius: "var(--radius-control)",
            background: "var(--color-bg-primary)",
            border: "1px solid var(--color-border)",
            maxHeight: 280,
            overflow: "auto",
          }}
        >
          <p style={{ ...T.eyebrow, fontSize: 12, marginBottom: 8 }}>The DM</p>
          <p style={{ ...T.body, lineHeight: 1.55, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{preview.body}</p>
          {preview.unresolved.length > 0 && (
            <p style={{ ...T.body, marginTop: 10, color: "var(--color-warning)" }}>
              Not filled in: {preview.unresolved.map((v) => `{${v}}`).join(", ")}
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center" style={{ gap: 8 }}>
        {!archived && row.status === "open" && !t?.is_admin_only && (
          <>
            <Button variant="raised" size="md" disabled={busy} onClick={onCopy}>
              Copy DM
            </Button>
            <Button variant="raised" size="md" busy={busy} onClick={onMarkSent}>
              Mark sent
            </Button>
            <Button variant="ghost" size="md" disabled={busy} onClick={onDismiss}>
              Dismiss
            </Button>
          </>
        )}
        {!archived && row.status !== "open" && (
          <Button variant="ghost" size="md" busy={busy} onClick={onReopen}>
            Move to To do
          </Button>
        )}
        {s?.id && (
          <Link
            href={`/admin/students/${encodeURIComponent(s.id)}`}
            style={{ display: "inline-flex", alignItems: "center", minHeight: TAP, padding: "0 4px", color: "var(--color-accent-dark)", fontSize: 13, fontWeight: 600 }}
          >
            Open the student
          </Link>
        )}
      </div>
    </div>
  );
}

function DismissPanel({
  row,
  busy,
  onCancel,
  onDismiss,
}: {
  row: TaskRow;
  busy: boolean;
  onCancel: () => void;
  onDismiss: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [missing, setMissing] = useState(false);
  const id = useId();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h2 style={T.heading}>Dismiss the task for {taskStudentName(row)}?</h2>
      <label htmlFor={id} style={{ ...T.bodyDim, lineHeight: 1.5 }}>
        A short reason. It helps tune the checks.
      </label>
      <textarea
        id={id}
        autoFocus
        rows={3}
        value={reason}
        maxLength={500}
        placeholder="For example: already replied in Discord"
        onChange={(e) => {
          setReason(e.target.value);
          setMissing(false);
        }}
        style={{
          width: "100%",
          padding: "10px 12px",
          fontSize: 16,
          borderRadius: "var(--radius-control)",
          border: "1px solid var(--color-border-strong)",
          background: "var(--color-bg-primary)",
          color: "var(--color-text-primary)",
          resize: "vertical",
        }}
      />
      {missing && (
        <p role="alert" style={T.body}>
          Add a short reason first.
        </p>
      )}
      <div className="flex flex-wrap justify-end" style={{ gap: 8 }}>
        <Button variant="ghost" size="md" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="danger"
          size="md"
          busy={busy}
          onClick={() => {
            if (!reason.trim()) {
              setMissing(true);
              return;
            }
            onDismiss(reason.trim());
          }}
        >
          Dismiss the task
        </Button>
      </div>
    </div>
  );
}

