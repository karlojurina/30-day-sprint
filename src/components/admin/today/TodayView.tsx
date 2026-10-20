"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button, Card, EmptyState, Pill, T } from "@/components/admin/ui";
import {
  CopyButton,
  DiscordReach,
  ListHeader,
  ListPage,
  LoadError,
  NoticeStack,
  STALE_TEXT,
  SkeletonRows,
  TAP,
  WhopNotPulled,
  firstName,
  lastContactText,
  pressPill,
} from "@/components/admin/list-parts";
import type { Notice } from "@/components/admin/list-parts";
import { adminTransport } from "@/lib/admin/admin-transport";
import type { Answer, MarkAnswer, TodayTransport, UndoResult } from "@/lib/admin/admin-transport";
import { clockLabel, dayLabel, dayTimeLabel } from "@/lib/admin/croatia-dates";
import {
  DEFAULT_FILTER,
  MARKED_OTHERWISE,
  REASON_LABEL,
  REASON_ORDER,
  SUPPORT_SCENARIO,
  UNDO_MINUTES,
  chipCounts,
  heroCount,
  stoppedLabel,
  visibleRows,
} from "@/lib/admin/support-list";
import type {
  ComputedKind,
  HandledRow,
  PlanFilter,
  ReasonKind,
  RowFilter,
  SupportReason,
  SupportRow,
  TodayView as TodayPayload,
} from "@/lib/admin/support-list";
import type { LastContact } from "@/lib/admin/thirty-view";

/**
 * Today, /admin/today (admin rebuild PRD, work item 4, calls C3 to C8 and
 * C12 to C15): every student who needs a message, why, how to reach them
 * and what to send.
 *
 *   - the header: the title with Refresh beside it, how many students to
 *     message (the one hero number, C13) and "Updated HH:MM"
 *   - a chip per reason with its count (one sideways row on a phone), the
 *     plan filter (Monthly and Yearly by default, All plans adds the rest)
 *     and a search (name, email, @discord); the counts follow them, each
 *     student once under their headline
 *   - one row per student: the headline reason, the others as chips, the
 *     course facts, the last message sent (C12), C7's way to reach them, the
 *     message to copy (C6), Mark messaged and Not needed (C5), which also
 *     close the row's open tasks in the Tasks queue
 *   - C14's folded group: Stopped and Not started students with no Whop
 *     backfill since the switch, outside the hero number
 *   - Handled, folded: what was done in the last 7 days, with Replied / No
 *     reply and, on the reader's own entries for 15 minutes, Undo
 *
 * What a button did shows in a fixed place at the bottom of the window
 * (NoticeStack, list-parts.tsx), with Undo after a mark. When the list
 * cannot be read again after a change, a second line says it may be out of
 * date, and the row that was just marked keeps its buttons off until a read
 * works.
 *
 * Every row comes from GET /api/admin/today, which decides who is on the
 * list (src/lib/admin/support-list.ts); this file shows it and sends the
 * team's clicks. The calls go through `transport`
 * (src/lib/admin/admin-transport.ts), so the dev page /dev/admin/today
 * renders this same component with made-up data and no login.
 */

type Loaded = { kind: "loading" } | { kind: "error"; error: string } | { kind: "ready"; data: TodayPayload };

/** What a row's button hands back: null when it went through, else a sentence to show on the row. */
type RowResult = Promise<string | null>;

/** The last button's notice, with the ids its Undo takes back (a mark's record and the queue tasks it closed). */
type PageNotice = Omit<Notice, "id" | "action"> & { undo?: { ids: string[]; name: string } };

/** The colour of a reason's dot. The words always say it too. */
const REASON_TONE: Record<ReasonKind, string> = {
  cancelling: "var(--color-danger)",
  past_due: "var(--color-warning)",
  thirty_closing: "var(--color-warning)",
  thirty_ready: "var(--color-success)",
  stopped: "var(--color-warning)",
  not_started: "var(--color-neutral)",
  never_opened: "var(--color-neutral)",
  open_task: "var(--color-accent-dark)",
};

/** The id of the "may be out of date" line among the notices. */
const STALE_ID = -1;

function studentName(row: { name: string | null; email?: string | null }): string {
  return row.name?.trim() || row.email || "No name on file";
}

/** C12, with the read's own limit: Today reads the last 30 days of messages. */
function contactText(contact: LastContact | null): string {
  return contact ? lastContactText(contact) : "No message in the last 30 days";
}

/** The variables a message still names, as renderTemplate leaves them: {firstName}. */
function placeholders(text: string | null): string[] {
  if (!text) return [];
  return [...new Set([...text.matchAll(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g)].map((m) => m[1]))];
}

/**
 * The page's own words for a mark the route refused. The mark route's
 * sentences are plain and are shown as they are; the rest are this file's.
 */
function markError(r: { status: number; error: string }): string {
  if (r.status === 404) return "This student is no longer in the database.";
  if (r.status >= 500 && !r.error) return "Couldn't save the mark. Try again.";
  return r.error;
}

/** A refusal that means the list is out of date: show it in the notices and read the list again. */
function markIsStale(status: number): boolean {
  return status === 400 || status === 404 || status === 409;
}

/** One sentence for an Undo whose entries did not all go through. */
function undoFailures(results: UndoResult[]): string | null {
  const bad = results.filter((r) => !r.ok);
  if (bad.length === 0) return null;
  const first = bad[0].error ?? "It could not be undone.";
  return bad.length === 1 ? first : `${bad.length} entries were not undone. The first: ${first}`;
}

export function TodayView({ transport = adminTransport }: { transport?: TodayTransport }) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [reloading, setReloading] = useState(false);
  const [retrying, setRetrying] = useState(false);
  /** What the last button did, or what went wrong. A new notice gets a new id, so its own 15 seconds start. */
  const [notice, setNotice] = useState<(PageNotice & { id: number }) | null>(null);
  /** The list could not be read again after a change: what it shows may be out of date. */
  const [stale, setStale] = useState(false);
  /** The rows changed since the last read that worked, by student: their buttons stay off until a read works. */
  const [locked, setLocked] = useState<ReadonlySet<string>>(() => new Set());
  const [undoing, setUndoing] = useState(false);
  const [filter, setFilter] = useState<RowFilter>(DEFAULT_FILTER);
  const seq = useRef(0);

  const show = useCallback((n: PageNotice) => setNotice((prev) => ({ ...n, id: (prev?.id ?? 0) + 1 })), []);

  /** One read of the list. Null when a newer read started meanwhile: that one's answer wins. */
  const fetchList = useCallback(async (): Promise<Answer<TodayPayload> | null> => {
    const mine = ++seq.current;
    const r = await transport.loadToday();
    return mine === seq.current ? r : null;
  }, [transport]);

  useEffect(() => {
    let alive = true;
    void fetchList().then((r) => {
      if (!alive || !r) return;
      setLoaded(r.ok ? { kind: "ready", data: r.data } : { kind: "error", error: r.error });
    });
    return () => {
      alive = false;
    };
  }, [fetchList]);

  const reload = useCallback(async () => {
    setReloading(true);
    const r = await fetchList();
    if (!r) return;
    setReloading(false);
    if (r.ok) {
      setLoaded({ kind: "ready", data: r.data });
      setStale(false);
      setLocked(new Set());
      return;
    }
    // What the last button did stays as it was, in its own notice; one more line says the list may be out of date.
    setStale(true);
  }, [fetchList]);

  async function retry() {
    setRetrying(true);
    const r = await fetchList();
    setRetrying(false);
    if (!r) return;
    setLoaded(r.ok ? { kind: "ready", data: r.data } : { kind: "error", error: r.error });
  }

  function lock(studentId: string) {
    setLocked((cur) => new Set(cur).add(studentId));
  }

  async function mark(row: SupportRow, action: "messaged" | "not_needed", note?: string): RowResult {
    const name = studentName(row);
    const r: Answer<MarkAnswer> = await transport.mark({
      studentId: row.studentId,
      action,
      headlineKind: row.reasons[0].kind,
      reasonsText: row.reasons.map((x) => x.text).join(" · "),
      ...(note ? { note } : {}),
      openTaskIds: row.openTasks.map((t) => t.id),
    });
    if (!r.ok) {
      const text = markError(r);
      // A second mark that says the other thing: nothing was saved, and the row is where it was asked.
      if (r.code === MARKED_OTHERWISE || !markIsStale(r.status)) return text;
      show({ tone: "danger", text: `${name}: ${text}` });
      await reload();
      return null;
    }
    lock(row.studentId);
    const ids = [r.data.supportId, ...r.data.movedIds].filter((x): x is string => typeof x === "string");
    show({
      tone: "success",
      text: action === "messaged" ? `Marked ${name} as messaged.` : `Marked ${name} as not needed.`,
      ...(ids.length ? { undo: { ids, name } } : {}),
    });
    await reload();
    return null;
  }

  async function undo(ids: string[], name: string): RowResult {
    const r = await transport.undo(ids);
    if (!r.ok) return r.error;
    const problem = undoFailures(r.data.results);
    show(
      problem
        ? { tone: "danger", text: `${name}: ${problem}` }
        : { tone: "success", text: `Undone. ${name} is back on the list if a reason still applies.` },
    );
    await reload();
    return null;
  }

  /** The Undo in a mark's notice. */
  async function undoFromNotice(mark: { ids: string[]; name: string }) {
    setUndoing(true);
    const problem = await undo(mark.ids, mark.name);
    setUndoing(false);
    if (problem) show({ tone: "danger", text: `${mark.name}: ${problem}` });
  }

  async function setOutcome(entries: HandledRow[], outcome: "replied" | "no_reply" | null): RowResult {
    for (const e of entries) {
      const r = await transport.setOutcome(e.taskId, outcome);
      if (!r.ok) {
        if (r.status === 401 || r.status === 403) return r.error;
        return r.status === 404
          ? "This message is no longer marked as sent, so the reply was not saved."
          : "Couldn't save the reply. Try again.";
      }
    }
    await reload();
    return null;
  }

  function closeNotice(id: number) {
    if (id === STALE_ID) {
      setStale(false);
      return;
    }
    setNotice((cur) => (cur && cur.id === id ? null : cur));
  }

  const notices: Notice[] = [];
  if (notice) {
    const { undo: mark, ...shown } = notice;
    notices.push(mark ? { ...shown, action: { label: "Undo", busy: undoing } } : shown);
  }
  if (stale) notices.push({ id: STALE_ID, tone: "warning", text: STALE_TEXT });
  /** The Undo of the notice `id`, if it is still the one shown. */
  const undoNotice = (id: number) => {
    if (notice && notice.id === id && notice.undo) void undoFromNotice(notice.undo);
  };

  const header = (meta: React.ReactNode, action?: React.ReactNode) => (
    <ListHeader
      title="Today"
      description="Every student who needs a message, why, and how to reach them."
      meta={meta}
      action={action}
    />
  );

  if (loaded.kind === "loading") {
    return (
      <ListPage>
        {header("Loading")}
        <SkeletonRows rows={5} label="Loading the students who need a message" />
      </ListPage>
    );
  }

  if (loaded.kind === "error") {
    return (
      <ListPage>
        {header(null)}
        <LoadError title="Couldn't load Today's list." detail={loaded.error} onRetry={retry} busy={retrying} />
      </ListPage>
    );
  }

  const data = loaded.data;
  const { main, whopNotPulled } = visibleRows(data.rows, filter);
  const hero = heroCount(data.rows, filter);
  const chips = chipCounts(data.rows, filter);
  const allCount = REASON_ORDER.reduce((sum, k) => sum + chips[k], 0);
  const anyMain = data.rows.some((r) => r.group === "main");
  const filtered = filter.search.trim() !== "" || filter.kind !== null;
  const otherPlans =
    filter.plan === "monthly-yearly"
      ? data.rows.filter((r) => r.plan === "Other plan" && r.group === "main").length
      : 0;
  // One entry per mark: its record and the queue tasks it closed share a group key.
  const handledGroups = groupHandled(data.handled);

  return (
    <ListPage>
      {header(
        reloading ? `Updated ${clockLabel(data.generatedAt)} · Updating` : `Updated ${clockLabel(data.generatedAt)}`,
        <Button variant="raised" size="md" busy={reloading} onClick={() => void reload()}>
          Refresh
        </Button>,
      )}

      <NoticeStack notices={notices} onClose={closeNotice} onAction={undoNotice} />

      <div className="flex flex-wrap items-baseline mb-3 sm:mb-5" style={{ gap: "4px 12px" }}>
        <span
          style={{
            fontSize: 40,
            fontWeight: 600,
            letterSpacing: "-0.03em",
            lineHeight: 1,
            color: "var(--color-text-primary)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {hero}
        </span>
        <span style={{ ...T.body, fontSize: 15 }}>{hero === 1 ? "student to message" : "students to message"}</span>
      </div>

      {/* On a phone the chips are one row that scrolls sideways in its own box; wider, they wrap. */}
      <div
        role="group"
        aria-label="Reasons"
        className="flex flex-nowrap overflow-x-auto sm:flex-wrap sm:overflow-x-visible mb-3"
        style={{ gap: 8 }}
      >
        <ReasonChip label="All" count={allCount} pressed={filter.kind === null} onClick={() => setFilter({ ...filter, kind: null })} />
        {REASON_ORDER.filter((k) => chips[k] > 0 || filter.kind === k).map((k) => (
          <ReasonChip
            key={k}
            label={REASON_LABEL[k]}
            count={chips[k]}
            dot={REASON_TONE[k]}
            pressed={filter.kind === k}
            onClick={() => setFilter({ ...filter, kind: filter.kind === k ? null : k })}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center" style={{ gap: 10, marginBottom: otherPlans > 0 ? 8 : 20 }}>
        <PlanToggle value={filter.plan} onChange={(plan) => setFilter({ ...filter, plan })} />
        <SearchBox value={filter.search} onChange={(search) => setFilter({ ...filter, search })} />
      </div>
      {otherPlans > 0 && (
        <p style={{ ...T.bodyDim, marginBottom: 12 }}>
          {otherPlans === 1
            ? "1 student on another plan is hidden. Choose All plans to see them."
            : `${otherPlans} students on other plans are hidden. Choose All plans to see them.`}
        </p>
      )}

      {!anyMain ? (
        <Card>
          <EmptyState title="Nobody needs a message right now." />
        </Card>
      ) : main.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center" style={{ gap: 12, padding: "36px 16px" }}>
            <p style={{ ...T.body, color: "var(--color-text-secondary)" }}>
              {filtered ? "No student matches the search and the filter." : "Nobody on these plans needs a message right now."}
            </p>
            <Button variant="raised" size="md" onClick={() => setFilter(DEFAULT_FILTER)}>
              Show everyone
            </Button>
          </div>
        </Card>
      ) : (
        <Card padding={0}>
          {main.map((row) => (
            <TodayRow
              key={row.studentId}
              row={row}
              lessonsTotal={data.lessonsTotal}
              locked={locked.has(row.studentId)}
              stale={stale}
              onMark={mark}
            />
          ))}
        </Card>
      )}

      {whopNotPulled.length > 0 && (
        <Folded
          title={`Whop progress not pulled yet (${whopNotPulled.length})`}
          note="Their Whop progress has not been copied into the app since the course switch, so lessons they watched on Whop do not count yet. They stay here, outside the number above, until it is copied."
        >
          <Card padding={0}>
            {whopNotPulled.map((row) => (
              <TodayRow
                key={row.studentId}
                row={row}
                lessonsTotal={data.lessonsTotal}
                locked={locked.has(row.studentId)}
                stale={stale}
                onMark={mark}
              />
            ))}
          </Card>
        </Folded>
      )}

      <Folded
        title={`Handled in the last 7 days (${handledGroups.length})`}
        note={`Every task completed or dismissed in the last 7 days, newest first. Undo works on your own marks for ${UNDO_MINUTES} minutes.`}
      >
        {handledGroups.length === 0 ? (
          <Card>
            <EmptyState title="Nothing was handled in the last 7 days." />
          </Card>
        ) : (
          <Card padding={0}>
            {handledGroups.map((g) => (
              <HandledGroup key={g.key} entries={g.entries} onUndo={undo} onOutcome={setOutcome} />
            ))}
          </Card>
        )}
      </Folded>
    </ListPage>
  );
}

/* ─── Pieces ─── */

const ROW: React.CSSProperties = {
  flexDirection: "column",
  alignItems: "stretch",
  gap: 12,
  padding: 16,
};

/** A student's row: ROW, with 10px between its parts on a phone (12px wider), so the first row fits the first screen. */
const STUDENT_ROW: React.CSSProperties = { flexDirection: "column", alignItems: "stretch", padding: 16 };

const PANEL: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  padding: 12,
  borderRadius: "var(--radius-control)",
  background: "var(--color-bg-elevated)",
  border: "1px solid var(--color-border)",
};

const ERROR_TEXT: React.CSSProperties = {
  ...T.body,
  lineHeight: 1.5,
  overflowWrap: "anywhere",
};

function Dot({ color, top = 6 }: { color: string; top?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{ flex: "none", width: 8, height: 8, marginTop: top, borderRadius: 999, background: color }}
    />
  );
}

/** A reason filter: a raised pill with the reason and its count; pressed in Airy Blue. */
function ReasonChip({
  label,
  count,
  dot,
  pressed,
  onClick,
}: {
  label: string;
  count: number;
  dot?: string;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" aria-pressed={pressed} onClick={onClick} style={pressPill(pressed)}>
      {dot && <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: dot }} />}
      {label}
      <span style={{ color: "var(--color-text-secondary)", fontWeight: 500 }}>{count}</span>
    </button>
  );
}

/** Monthly and Yearly (the default) or All plans (C3): two pills, one pressed. */
function PlanToggle({ value, onChange }: { value: PlanFilter; onChange: (v: PlanFilter) => void }) {
  const options: Array<{ value: PlanFilter; label: string }> = [
    { value: "monthly-yearly", label: "Monthly and Yearly" },
    { value: "all", label: "All plans" },
  ];
  return (
    <div role="group" aria-label="Plans" className="flex" style={{ gap: 8 }}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)} style={pressPill(o.value === value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <div style={{ flex: "1 1 220px", minWidth: 0, maxWidth: 420 }}>
      <label htmlFor={id} className="sr-only">
        Search by name, email or Discord name
      </label>
      <input
        id={id}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search name, email or @discord"
        autoComplete="off"
        style={{
          width: "100%",
          height: TAP,
          padding: "0 12px",
          // 16px: a phone's browser zooms the page into a smaller field.
          fontSize: 16,
          borderRadius: "var(--radius-control)",
          border: "1px solid var(--color-border-strong)",
          background: "var(--color-bg-card)",
          color: "var(--color-text-primary)",
        }}
      />
    </div>
  );
}

/** A folded section below the list. */
function Folded({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <details style={{ marginTop: 24 }}>
      <summary style={{ ...T.cardTitle, cursor: "pointer", padding: "11px 0", minHeight: TAP }}>{title}</summary>
      <p style={{ ...T.bodyDim, lineHeight: 1.5, margin: "4px 0 12px" }}>{note}</p>
      {children}
    </details>
  );
}

/** Facts in one line, a dot between them; it wraps on a phone. */
function FactsLine({ parts }: { parts: string[] }) {
  return (
    <p style={{ ...T.bodyDim, lineHeight: 1.6 }}>
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && <span aria-hidden="true"> · </span>}
          {p}
        </span>
      ))}
    </p>
  );
}

/** "Course day 4" · "12 of 140 lessons" · "In <area>" · "Last lesson Fri 16 Oct" · "Paid Thu 1 Oct" (C8). */
function rowFacts(row: SupportRow, lessonsTotal: number): string[] {
  const parts = [
    `Course day ${row.courseDay}`,
    `${row.lessonsDone} of ${lessonsTotal} lessons`,
    ...(row.area ? [`In ${row.area.name}`] : []),
    row.lastLessonAt ? `Last lesson ${dayLabel(row.lastLessonAt)}` : "No lesson yet",
    ...(row.firstPaidAt ? [`Paid ${dayLabel(row.firstPaidAt)}`] : []),
  ];
  // Where the 30% stands when no 30% reason says it already.
  const t = row.thirty;
  const said = row.reasons.some((r) => r.kind === "thirty_closing" || r.kind === "thirty_ready");
  if (t && (t.state === "locked" || t.state === "ready") && !said && t.videosTotal != null && t.deadline) {
    parts.push(`30%: ${t.videosDone ?? 0} of ${t.videosTotal} videos, deadline ${dayLabel(t.deadline)}`);
  }
  return parts;
}

/** The headline: its words, and Slipping or Stalled for a Stopped student. */
function Headline({ reason }: { reason: SupportReason }) {
  return (
    <div className="flex flex-wrap items-center" style={{ gap: "6px 10px" }}>
      <p style={{ display: "flex", gap: 8, alignItems: "flex-start", minWidth: 0 }}>
        <Dot color={REASON_TONE[reason.kind]} top={7} />
        <span
          style={{
            fontSize: 15,
            fontWeight: 600,
            lineHeight: 1.45,
            color: "var(--color-text-primary)",
            overflowWrap: "anywhere",
          }}
        >
          {reason.text}
        </span>
      </p>
      {reason.kind === "stopped" && reason.waitDays != null && (
        <Pill tone={stoppedLabel(reason.waitDays) === "Stalled" ? "danger" : "warning"}>
          {stoppedLabel(reason.waitDays)}
        </Pill>
      )}
    </div>
  );
}

/** The other reasons, as chips that wrap. */
function OtherReasons({ reasons }: { reasons: SupportReason[] }) {
  if (reasons.length === 0) return null;
  return (
    <ul className="flex flex-wrap" style={{ gap: 6 }} aria-label="Other reasons">
      {reasons.map((r, i) => (
        <li
          key={`${r.kind}-${i}`}
          style={{
            display: "inline-flex",
            alignItems: "flex-start",
            gap: 6,
            padding: "3px 10px",
            borderRadius: "var(--radius-pill)",
            background: "var(--color-bg-elevated)",
            border: "1px solid var(--color-border)",
            fontSize: 12,
            lineHeight: 1.5,
            color: "var(--color-text-primary)",
            maxWidth: "100%",
            overflowWrap: "anywhere",
          }}
        >
          <Dot color={REASON_TONE[r.kind]} top={5} />
          <span>{r.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** One student: why, the facts, the last message, the message to copy, and the marks. */
function TodayRow({
  row,
  lessonsTotal,
  locked,
  stale,
  onMark,
}: {
  row: SupportRow;
  lessonsTotal: number;
  /** Marked since the last read that worked: the marks stay off until a read works. */
  locked: boolean;
  /** The last read after a change failed. */
  stale: boolean;
  onMark: (row: SupportRow, action: "messaged" | "not_needed", note?: string) => RowResult;
}) {
  const [busy, setBusy] = useState<null | "messaged" | "not_needed">(null);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const noteId = useId();
  const headline = row.reasons[0];
  const fromQueue = row.openTasks.find((t) => t.message) ?? null;
  const message = fromQueue?.message ?? row.supportMessage;
  const unresolved = fromQueue ? fromQueue.unresolved : placeholders(row.supportMessage);
  // The queue tasks a mark closes, when the headline is not already one of them.
  const queueNotes = headline.kind === "open_task" ? [] : row.openTasks;
  const off = busy !== null || locked;

  async function run(action: "messaged" | "not_needed") {
    setBusy(action);
    setError(null);
    const e = await onMark(row, action, action === "not_needed" ? note.trim() : undefined);
    setBusy(null);
    if (e) setError(e);
    else setAsking(false);
  }

  return (
    <div className="list-row gap-2.5 sm:gap-3" style={STUDENT_ROW}>
      <div className="flex flex-wrap items-center" style={{ gap: "6px 8px", minWidth: 0 }}>
        <Link
          href={`/admin/students/${encodeURIComponent(row.studentId)}`}
          style={{
            fontSize: 15,
            fontWeight: 600,
            letterSpacing: "-0.011em",
            color: "var(--color-text-primary)",
            textDecoration: "underline",
            textDecorationColor: "var(--color-border-strong)",
            textUnderlineOffset: 3,
            overflowWrap: "anywhere",
          }}
        >
          {studentName(row)}
        </Link>
        {row.discord.username && (
          <span style={{ ...T.bodyDim, overflowWrap: "anywhere" }}>@{row.discord.username.replace(/^@/, "")}</span>
        )}
        <Pill tone="neutral">{row.plan}</Pill>
        {!row.whopPulled && <WhopNotPulled />}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Headline reason={headline} />
        <OtherReasons reasons={row.reasons.slice(1)} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <FactsLine parts={rowFacts(row, lessonsTotal)} />
        <p style={{ ...T.bodyDim, lineHeight: 1.5 }}>{contactText(row.lastContact)}</p>
        {/* The headline says why today; the task's own summary is from the day the queue opened it, so it is not repeated. */}
        {queueNotes.map((t) => (
          <p key={t.id} style={{ ...T.bodyDim, lineHeight: 1.5, overflowWrap: "anywhere" }}>
            {`Also open in the Tasks queue since ${dayLabel(t.createdAt)}. Marking this row closes it too.`}
          </p>
        ))}
      </div>

      {message ? (
        // A block, not PANEL's flex column: a closed <details> would keep the gap under its summary.
        <details style={{ ...PANEL, display: "block" }}>
          <summary style={{ ...T.body, fontWeight: 600, cursor: "pointer" }}>
            {fromQueue ? "Message from the Tasks queue" : "Message for this reason"}
          </summary>
          <p style={{ ...T.body, lineHeight: 1.55, marginTop: 10, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {message}
          </p>
        </details>
      ) : (
        <p style={{ ...T.bodyDim, lineHeight: 1.5 }}>No saved message for this reason yet. Write your own.</p>
      )}
      {message && unresolved.length > 0 && (
        <p style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <Dot color="var(--color-warning)" />
          <span style={{ ...T.body, lineHeight: 1.5 }}>
            {`The message still has ${unresolved.map((u) => `{${u}}`).join(", ")} in it. Fill it in after you paste it.`}
          </span>
        </p>
      )}

      <div className="flex flex-wrap items-center" style={{ gap: 8 }}>
        <DiscordReach discord={row.discord} />
        {message && <CopyButton text={message} label="Copy message" />}
        <Button
          variant="raised"
          size="md"
          busy={busy === "messaged"}
          disabled={locked || (busy !== null && busy !== "messaged")}
          onClick={() => void run("messaged")}
        >
          Mark messaged
        </Button>
        <Button
          variant="raised"
          size="md"
          disabled={off}
          onClick={() => {
            setError(null);
            setAsking((a) => !a);
          }}
        >
          Not needed
        </Button>
      </div>

      {locked && stale && (
        <p style={{ ...T.bodyDim, lineHeight: 1.5 }}>Saved. Press Refresh to see this row as it is now.</p>
      )}

      {asking && (
        <div style={PANEL}>
          <label htmlFor={noteId} style={{ ...T.body, fontWeight: 600 }}>
            Why no message is needed
          </label>
          <input
            id={noteId}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setAsking(false);
              if (e.key === "Enter" && note.trim() && !off) void run("not_needed");
            }}
            maxLength={500}
            autoFocus
            placeholder="For example: we spoke on a call today"
            style={{
              width: "100%",
              height: TAP,
              padding: "0 12px",
              fontSize: 16,
              borderRadius: "var(--radius-control)",
              border: "1px solid var(--color-border-strong)",
              background: "var(--color-bg-card)",
              color: "var(--color-text-primary)",
            }}
          />
          <p style={{ ...T.bodyDim, lineHeight: 1.5 }}>
            {note.trim()
              ? "The reason is saved with the mark and shown under Handled."
              : "Write a reason to save. It is saved with the mark and shown under Handled."}
          </p>
          <div className="flex flex-wrap" style={{ gap: 8 }}>
            <Button
              variant="raised"
              size="md"
              // Off while Mark messaged is on its way too: one mark per row at a time.
              disabled={!note.trim() || locked || (busy !== null && busy !== "not_needed")}
              busy={busy === "not_needed"}
              onClick={() => void run("not_needed")}
            >
              Save as not needed
            </Button>
            <Button variant="ghost" size="md" disabled={busy !== null} onClick={() => setAsking(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" style={ERROR_TEXT}>
          {error}
        </p>
      )}
    </div>
  );
}

/** Handled entries side by side by their group key: one mark, or one closing by the app. */
function groupHandled(rows: HandledRow[]): Array<{ key: string; entries: HandledRow[] }> {
  const groups = new Map<string, HandledRow[]>();
  for (const r of rows) {
    const list = groups.get(r.groupKey);
    if (list) list.push(r);
    else groups.set(r.groupKey, [r]);
  }
  return [...groups].map(([key, entries]) => ({ key, entries }));
}

/**
 * A Handled entry in words. A mark's record shows the reasons it recorded,
 * whose first is the headline's own sentence ("Payment failed", "30% closes
 * Fri 23 Oct ..."), so the reason's short name is shown only when the record
 * has no words. A queue task shows its own summary, or no more than where it
 * came from.
 */
function entryText(e: HandledRow): string {
  const kind = (Object.keys(SUPPORT_SCENARIO) as ComputedKind[]).find((k) => SUPPORT_SCENARIO[k] === e.scenarioId);
  const summary = e.summary?.trim() || null;
  if (kind) return summary ?? REASON_LABEL[kind];
  return summary ? `From the Tasks queue: ${summary}` : "From the Tasks queue";
}

/** One mark (its record and the queue tasks it closed), or one closing by the app. */
function HandledGroup({
  entries,
  onUndo,
  onOutcome,
}: {
  entries: HandledRow[];
  onUndo: (ids: string[], name: string) => RowResult;
  onOutcome: (entries: HandledRow[], outcome: "replied" | "no_reply" | null) => RowResult;
}) {
  const [busy, setBusy] = useState<null | "undo" | "replied" | "no_reply">(null);
  const [error, setError] = useState<string | null>(null);
  const head = entries[0];
  const students = [...new Set(entries.map((e) => e.studentId))];
  const one = students.length === 1;
  const name = one ? head.name?.trim() || "A student no longer listed" : `${students.length} students`;
  const done = head.status === "completed" ? "Messaged" : "Marked not needed";
  const who = head.by ? `by ${firstName(head.by.name) ?? "a team member"}` : "by the app";
  const sent = entries.filter((e) => e.status === "completed");
  const outcome = sent[0]?.outcome ?? null;
  const canUndo = entries.every((e) => e.undoable);
  const note = entries.find((e) => e.note)?.note ?? null;

  async function run(what: NonNullable<typeof busy>, fn: () => RowResult) {
    setBusy(what);
    setError(null);
    const e = await fn();
    setBusy(null);
    if (e) setError(e);
  }

  return (
    <div className="list-row" style={{ ...ROW, gap: 8 }}>
      <div className="flex flex-wrap items-baseline" style={{ gap: "4px 10px" }}>
        {one ? (
          <Link
            href={`/admin/students/${encodeURIComponent(head.studentId)}`}
            style={{
              ...T.cardTitle,
              textDecoration: "underline",
              textDecorationColor: "var(--color-border-strong)",
              textUnderlineOffset: 3,
              overflowWrap: "anywhere",
            }}
          >
            {name}
          </Link>
        ) : (
          <span style={T.cardTitle}>{name}</span>
        )}
        <span style={T.body}>{head.by ? done : head.status === "completed" ? "Completed" : "Closed"}</span>
        <span style={T.bodyDim}>{`${dayTimeLabel(head.at)} ${who}`}</span>
      </div>

      <ul style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {entries.map((e) => (
          <li key={e.taskId} style={{ ...T.bodyDim, lineHeight: 1.5, overflowWrap: "anywhere" }}>
            {!one && `${e.name?.trim() || "A student no longer listed"}: `}
            {entryText(e)}
          </li>
        ))}
      </ul>
      {note && (
        <p style={{ ...T.body, lineHeight: 1.5, overflowWrap: "anywhere" }}>
          {head.status === "dismissed" ? `Reason: ${note}` : `Note: ${note}`}
        </p>
      )}

      {(sent.length > 0 && head.by) || canUndo ? (
        <div className="flex flex-wrap items-center" style={{ gap: 8 }}>
          {sent.length > 0 && head.by && (
            <>
              <OutcomeButton
                label="Replied"
                pressed={outcome === "replied"}
                busy={busy === "replied"}
                disabled={busy !== null}
                onClick={() => void run("replied", () => onOutcome(sent, outcome === "replied" ? null : "replied"))}
              />
              <OutcomeButton
                label="No reply"
                pressed={outcome === "no_reply"}
                busy={busy === "no_reply"}
                disabled={busy !== null}
                onClick={() => void run("no_reply", () => onOutcome(sent, outcome === "no_reply" ? null : "no_reply"))}
              />
            </>
          )}
          {canUndo && (
            <Button
              variant="raised"
              size="md"
              busy={busy === "undo"}
              disabled={busy !== null && busy !== "undo"}
              onClick={() => void run("undo", () => onUndo(entries.map((e) => e.taskId), name))}
            >
              Undo
            </Button>
          )}
        </div>
      ) : null}

      {error && (
        <p role="alert" style={ERROR_TEXT}>
          {error}
        </p>
      )}
    </div>
  );
}

/** Replied or No reply: pressed when it is the saved answer; pressing it again clears it. */
function OutcomeButton({
  label,
  pressed,
  busy,
  disabled,
  onClick,
}: {
  label: string;
  pressed: boolean;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      style={{
        ...pressPill(pressed),
        padding: "0 16px",
        fontWeight: 600,
        cursor: busy ? "wait" : disabled ? "not-allowed" : "pointer",
        opacity: busy ? 0.6 : disabled ? 0.4 : 1,
      }}
    >
      {pressed && <span aria-hidden="true">✓</span>}
      {label}
    </button>
  );
}
