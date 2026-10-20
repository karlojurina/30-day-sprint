"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Button, Card, EmptyState, Pill, T } from "@/components/admin/ui";
import {
  CopyButton,
  DiscordReach,
  ListHeader,
  ListPage,
  LoadError,
  MembershipPill,
  NoticeStack,
  STALE_TEXT,
  SkeletonRows,
  TAP,
  WhopNotPulled,
  firstName,
  lastContactText,
  pressPill,
  timeLeftText,
} from "@/components/admin/list-parts";
import type { Notice } from "@/components/admin/list-parts";
import { adminTransport } from "@/lib/admin/admin-transport";
import type { Answer, ThirtyTransport, UndoResult } from "@/lib/admin/admin-transport";
import { clockLabel, dayLabel, deadlineLabel } from "@/lib/admin/croatia-dates";
import { MARKED_OTHERWISE } from "@/lib/admin/support-list";
import { aboutHoursWords, thirtyReasonText } from "@/lib/admin/thirty-view";
import type {
  Facts,
  StudentBrief,
  TeamRef,
  ThirtyEarnRow,
  ThirtyRequestRow,
  ThirtyView as ThirtyPayload,
  Verdict,
} from "@/lib/admin/thirty-view";
import { DISCOUNT_ELIGIBLE_FROM, DISCOUNT_LAUNCH_DATE, requestCounts } from "@/lib/world/discount";

/**
 * The 30% page, /admin/discounts (admin rebuild PRD, work item 3, calls C9
 * to C11 and C16).
 *
 * Five tabs: To decide (every pending request, oldest first), Can still
 * earn (members who can still finish in time), Approved (the code is made),
 * Code added in Whop (the code is on the membership) and Rejected. Every row
 * comes from GET /api/admin/thirty, which runs the student app's own rule;
 * this file only shows it and sends the team's decisions to the existing
 * routes.
 *
 * A pending request shows the approve route's verdict beside Approve, which
 * opens exactly when the rule says yes. "Approve anyway" asks once more,
 * inline, then sends the approval with `override`, which skips the 30% rule
 * (C9). Since 2026-10-20 a row has no "Ads verified" tick and no action
 * items' hand-ins (C10 kept them as the tick's evidence): Lovro dropped the
 * ads check from approving, since the 30% already asks for 61 videos.
 *
 * What a decision did shows in a fixed place at the bottom of the window
 * (NoticeStack, list-parts.tsx), where it is seen however far down the row
 * was: a success hides itself after 15 seconds, a refusal stays until it is
 * dismissed, and a Whop code in either can be copied from it. Mark messaged
 * on Can still earn closes the student's open tasks in the Tasks queue with
 * it (C5), and its notice offers Undo. When the list cannot be read again
 * after a change, a second line says so and the row just decided keeps its
 * buttons off until a read works.
 *
 * The address: ?student=<id> keeps every tab to that student (the student
 * page links here, C16), ?tab= picks the tab.
 *
 * The calls go through `transport` (src/lib/admin/admin-transport.ts), so
 * the dev page /dev/admin/discounts renders this same component with
 * made-up data and no login.
 */

type TabKey = "decide" | "earn" | "approved" | "code-added" | "rejected";

const TAB_ORDER: TabKey[] = ["decide", "earn", "approved", "code-added", "rejected"];
const TAB_LABEL: Record<TabKey, string> = {
  decide: "To decide",
  earn: "Can still earn",
  approved: "Approved",
  "code-added": "Code added in Whop",
  rejected: "Rejected",
};
const TAB_STATUS: Record<Exclude<TabKey, "earn">, ThirtyRequestRow["status"]> = {
  decide: "pending",
  approved: "approved",
  "code-added": "applied",
  rejected: "rejected",
};

const FROM_DAY = dayLabel(DISCOUNT_ELIGIBLE_FROM);
const LAUNCH_DAY = dayLabel(DISCOUNT_LAUNCH_DATE);

const TAB_NOTE: Record<TabKey, string> = {
  decide:
    "Requests waiting for a decision, whatever their date, oldest first. Approve creates the student's Whop code.",
  earn: `Members who first paid from ${FROM_DAY}, still have a membership, and can still finish before their deadline. Soonest deadline first.`,
  approved: "The code is made. Add it to the student's membership in Whop, then press Mark code added.",
  "code-added": `The code is on the student's membership. Requests from ${FROM_DAY} on, newest first.`,
  rejected: `Requests from ${FROM_DAY} on, newest first.`,
};

const TAB_EMPTY: Record<TabKey, string> = {
  decide: "No request is waiting for a decision.",
  earn: "Nobody can still earn the 30% right now.",
  approved: "No code is waiting to be added in Whop.",
  "code-added": "No code has been added in Whop yet.",
  rejected: "No request has been rejected.",
};

/** Can still earn has nobody to show, and some members could not be read: "nobody" would not be true. */
const EARN_UNREAD = "Nobody to show until the list can be read. Press Refresh.";

/** The id of the "may be out of date" line among the notices. */
const STALE_ID = -1;

/** A Whop code in a sentence: the approve route's 409 names the code that must be deleted in Whop. */
const WHOP_CODE = /\bECOM30-[A-Z0-9]{4,}\b/;

function parseTab(value: string | null): TabKey | null {
  return TAB_ORDER.find((t) => t === value) ?? null;
}

type Loaded = { kind: "loading" } | { kind: "error"; error: string } | { kind: "ready"; data: ThirtyPayload };

/** What a row's button hands back: null when it went through, else a sentence to show on the row. */
type RowResult = Promise<string | null>;

/** The last button's notice, with the ids its Undo takes back after Mark messaged. */
type PageNotice = Omit<Notice, "id" | "action"> & { undo?: { ids: string[]; name: string } };

function studentName(s: StudentBrief): string {
  return s.name?.trim() || s.email || "No name on file";
}

/** " by Robin", or nothing when the member is unknown. */
function byWhom(ref: TeamRef | null): string {
  const n = firstName(ref?.name);
  return n ? ` by ${n}` : "";
}

/**
 * The page's own words for a decision the route refused (section 8: this
 * build handles the routes' 400 and 409 answers in plain words). A 409 is
 * the route's sentence as it is: lane G1 wrote those for the team, and the
 * approve route's names the Whop code to delete. The approve route's 400s
 * name a button this page does not have, so they get the page's words; the
 * row's verdict then says why.
 */
function decisionError(kind: "approve" | "reject" | "applied", r: { status: number; error: string }): string {
  if (r.status === 409) return r.error;
  if (r.status === 404) return "This request no longer exists.";
  if (kind === "approve" && r.status === 400) {
    if (/already processed/i.test(r.error)) return "This request was already decided.";
    return "Not approved: the 30% rule says no for this request now. Its row shows why.";
  }
  if (kind === "applied" && r.status === 400) return "This request is no longer approved, so the code was not marked as added.";
  if (kind === "reject" && r.status >= 500) return "Couldn't save the rejection. Try again.";
  if (kind === "applied" && r.status >= 500) return "Couldn't mark the code as added. Try again.";
  return r.error;
}

/** A refusal that means the list is out of date: show it in the notices and read the list again. */
function listIsStale(kind: "approve" | "reject" | "applied", status: number): boolean {
  return status === 409 || status === 404 || (status === 400 && kind !== "reject");
}

/** One sentence for an Undo whose entries did not all go through. */
function undoFailures(results: UndoResult[]): string | null {
  const bad = results.filter((r) => !r.ok);
  if (bad.length === 0) return null;
  const first = bad[0].error ?? "It could not be undone.";
  return bad.length === 1 ? first : `${bad.length} entries were not undone. The first: ${first}`;
}

const byAsked = (a: ThirtyRequestRow, b: ThirtyRequestRow) =>
  Date.parse(a.askedAt) - Date.parse(b.askedAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function ThirtyView({ transport = adminTransport }: { transport?: ThirtyTransport }) {
  const params = useSearchParams();
  const pathname = usePathname();
  const student = params.get("student") || null;
  const urlTab = parseTab(params.get("tab"));

  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [reloading, setReloading] = useState(false);
  const [retrying, setRetrying] = useState(false);
  /** What the last button did, or what went wrong. A new notice gets a new id, so its own 15 seconds start. */
  const [notice, setNotice] = useState<(PageNotice & { id: number }) | null>(null);
  /** The list could not be read again after a change: what it shows may be out of date. */
  const [stale, setStale] = useState(false);
  /** The rows changed since the last read that worked (request ids, and student ids on Can still earn): their buttons stay off until a read works. */
  const [locked, setLocked] = useState<ReadonlySet<string>>(() => new Set());
  const [undoing, setUndoing] = useState(false);
  const [pickedTab, setPickedTab] = useState<TabKey | null>(null);
  const seq = useRef(0);

  const show = useCallback((n: PageNotice) => setNotice((prev) => ({ ...n, id: (prev?.id ?? 0) + 1 })), []);

  /** One read of the list. Null when a newer read started meanwhile: that one's answer wins. */
  const fetchList = useCallback(async (): Promise<Answer<ThirtyPayload> | null> => {
    const mine = ++seq.current;
    const r = await transport.loadThirty();
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
    // What the last button did stays as it was, in its own notice (an approval's code, say); one more line says the list may be out of date.
    setStale(true);
  }, [fetchList]);

  async function retry() {
    setRetrying(true);
    const r = await fetchList();
    setRetrying(false);
    if (!r) return;
    setLoaded(r.ok ? { kind: "ready", data: r.data } : { kind: "error", error: r.error });
  }

  function lock(key: string) {
    setLocked((cur) => new Set(cur).add(key));
  }

  /** Puts `params` in the address without loading anything. */
  function setAddress(next: URLSearchParams) {
    const q = next.toString();
    window.history.replaceState(null, "", q ? `${pathname}?${q}` : pathname);
  }

  function chooseTab(t: TabKey) {
    setPickedTab(t);
    const next = new URLSearchParams(params.toString());
    next.set("tab", t);
    setAddress(next);
  }

  function showEveryone(current: TabKey) {
    setPickedTab(current);
    const next = new URLSearchParams(params.toString());
    next.delete("student");
    next.set("tab", current);
    setAddress(next);
  }

  async function refused(kind: "approve" | "reject" | "applied", row: ThirtyRequestRow, r: { status: number; error: string }): RowResult {
    const text = decisionError(kind, r);
    if (!listIsStale(kind, r.status)) return text;
    // A code made in Whop for a request someone else decided must be deleted there: it stays here until dismissed, copyable.
    const code = text.match(WHOP_CODE)?.[0];
    show({ tone: "danger", text: `${studentName(row.student)}: ${text}`, ...(code ? { copy: { label: "Copy code", text: code } } : {}) });
    await reload();
    return null;
  }

  async function approve(row: ThirtyRequestRow, override: boolean): RowResult {
    const r = await transport.approve(row.id, override);
    if (!r.ok) return refused("approve", row, r);
    lock(row.id);
    const name = studentName(row.student);
    const code = r.data.promoCode;
    show({
      tone: "success",
      text: code ? `Approved ${name}. The code ${code} is on the Approved tab.` : `Approved ${name}. The code is on the Approved tab.`,
      ...(code ? { copy: { label: "Copy code", text: code } } : {}),
    });
    await reload();
    return null;
  }

  async function reject(row: ThirtyRequestRow, reason: string | null): RowResult {
    const r = await transport.reject(row.id, reason);
    if (!r.ok) return refused("reject", row, r);
    lock(row.id);
    show({ tone: "success", text: `Rejected the request from ${studentName(row.student)}.` });
    await reload();
    return null;
  }

  async function markApplied(row: ThirtyRequestRow): RowResult {
    const r = await transport.markApplied(row.id);
    if (!r.ok) return refused("applied", row, r);
    lock(row.id);
    show({ tone: "success", text: `Marked the code as added in Whop for ${studentName(row.student)}.` });
    await reload();
    return null;
  }

  async function markMessaged(row: ThirtyEarnRow): RowResult {
    const kind = row.state === "ready" ? "thirty_ready" : "thirty_closing";
    const name = studentName(row.student);
    const r = await transport.mark({
      studentId: row.student.id,
      action: "messaged",
      headlineKind: kind,
      reasonsText: thirtyReasonText(kind, row.facts),
      // The student's open tasks in the Tasks queue close with the mark (C5): nobody sends the queue's message after this one.
      openTaskIds: row.openTasks.map((t) => t.id),
    });
    if (!r.ok) {
      // A second mark that says the other thing, or a refusal that is not about the list: on the row.
      if (r.code === MARKED_OTHERWISE || !(r.status === 400 || r.status === 404 || r.status === 409)) return r.error;
      show({ tone: "danger", text: `${name}: ${r.error}` });
      await reload();
      return null;
    }
    lock(row.student.id);
    const ids = [r.data.supportId, ...r.data.movedIds].filter((x): x is string => typeof x === "string");
    show({ tone: "success", text: `Marked ${name} as messaged.`, ...(ids.length ? { undo: { ids, name } } : {}) });
    await reload();
    return null;
  }

  /** The Undo in Mark messaged's notice: the record and the queue tasks it closed, as Today's Undo. */
  async function undoFromNotice({ ids, name }: { ids: string[]; name: string }) {
    setUndoing(true);
    const r = await transport.undo(ids);
    setUndoing(false);
    if (!r.ok) {
      show({ tone: "danger", text: `${name}: ${r.error}` });
      return;
    }
    const problem = undoFailures(r.data.results);
    show(
      problem
        ? { tone: "danger", text: `${name}: ${problem}` }
        : { tone: "success", text: `Undone. ${name} is no longer marked as messaged.` },
    );
    await reload();
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
      title="30% off"
      description="Every request for the 30%, and who can still earn it before their deadline."
      meta={meta}
      action={action}
    />
  );

  if (loaded.kind === "loading") {
    return (
      <ListPage>
        {header("Loading")}
        <SkeletonRows rows={4} label="Loading the 30% list" />
      </ListPage>
    );
  }

  if (loaded.kind === "error") {
    return (
      <ListPage>
        {header(null)}
        <LoadError title="Couldn't load the 30% list." detail={loaded.error} onRetry={retry} busy={retrying} />
      </ListPage>
    );
  }

  const data = loaded.data;
  const requests = student ? data.requests.filter((r) => r.student.id === student) : data.requests;
  const earn = student ? data.canStillEarn.filter((e) => e.student.id === student) : data.canStillEarn;
  const byStatus = (status: ThirtyRequestRow["status"]) => requests.filter((r) => r.status === status);
  const lists = {
    // The longest wait first: the answer reads newest first, as the decided tabs show it.
    decide: [...byStatus(TAB_STATUS.decide)].sort(byAsked),
    approved: byStatus(TAB_STATUS.approved),
    "code-added": byStatus(TAB_STATUS["code-added"]),
    rejected: byStatus(TAB_STATUS.rejected),
  };
  const count = (t: TabKey) => (t === "earn" ? earn.length : lists[t].length);
  // With one student and no tab asked for, open the first tab that has them.
  const tab: TabKey =
    pickedTab ?? urlTab ?? (student ? (TAB_ORDER.find((t) => count(t) > 0) ?? "decide") : "decide");
  const studentShown = requests[0]?.student ?? earn[0]?.student ?? null;
  const emptyTitle = student
    ? "This student has nothing on this tab."
    : tab === "earn" && data.unchecked > 0
      ? EARN_UNREAD
      : TAB_EMPTY[tab];

  return (
    <ListPage>
      {header(
        reloading ? `Updated ${clockLabel(data.generatedAt)} · Updating` : `Updated ${clockLabel(data.generatedAt)}`,
        <Button variant="raised" size="md" busy={reloading} onClick={() => void reload()}>
          Refresh
        </Button>,
      )}

      <NoticeStack notices={notices} onClose={closeNotice} onAction={undoNotice} />

      {data.requiredCount === null && (
        <Warning>
          Couldn&apos;t read the course&apos;s videos, so no request has a verdict and no video count is shown. Press
          Refresh to try again.
        </Warning>
      )}

      {student && (
        <div
          className="flex flex-wrap items-center"
          style={{
            gap: 10,
            marginBottom: 16,
            padding: "10px 12px 10px 14px",
            borderRadius: "var(--radius-control)",
            border: "1px solid var(--color-border)",
            background: "var(--color-bg-card)",
          }}
        >
          <p style={{ ...T.body, flex: "1 1 220px" }}>
            {studentShown
              ? `Showing ${studentName(studentShown)} only.`
              : "Showing one student only. They have no 30% request and are not on Can still earn."}
          </p>
          <Button variant="raised" size="md" onClick={() => showEveryone(tab)}>
            Show everyone
          </Button>
        </div>
      )}

      <TabStrip
        tabs={TAB_ORDER.map((t) => ({ value: t, label: TAB_LABEL[t], count: count(t) }))}
        value={tab}
        onChange={chooseTab}
      />
      <p style={{ ...T.bodyDim, lineHeight: 1.5, marginBottom: 16 }}>{TAB_NOTE[tab]}</p>

      {tab === "earn" && data.unchecked > 0 && (
        <Warning>
          {data.unchecked === 1
            ? "1 member is left out of this list because their progress couldn't be read."
            : `${data.unchecked} members are left out of this list because their progress couldn't be read.`}{" "}
          Press Refresh to try again.
        </Warning>
      )}

      {count(tab) === 0 ? (
        <Card>
          <EmptyState title={emptyTitle} />
        </Card>
      ) : (
        <Card padding={0}>
          {tab === "earn"
            ? earn.map((row) => (
                <EarnRow
                  key={row.student.id}
                  row={row}
                  now={data.generatedAt}
                  locked={locked.has(row.student.id)}
                  stale={stale}
                  onMarkMessaged={markMessaged}
                />
              ))
            : lists[tab].map((row) =>
                row.status === "pending" ? (
                  <PendingRow
                    key={row.id}
                    row={row}
                    questions={data.questions}
                    locked={locked.has(row.id)}
                    stale={stale}
                    onApprove={approve}
                    onReject={reject}
                  />
                ) : (
                  <DecidedRow
                    key={row.id}
                    row={row}
                    questions={data.questions}
                    locked={locked.has(row.id)}
                    stale={stale}
                    onMarkApplied={markApplied}
                  />
                ),
              )}
        </Card>
      )}
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

/** The line a row shows when it was just decided and the list could not be read again. */
const SAVED_STALE = "Saved. Press Refresh to see this row as it is now.";

/**
 * The five tabs as pills that wrap onto a second line on a phone, so every
 * tab is in view and none is cut mid-word. Each is 44px tall; its count is
 * 12px.
 */
function TabStrip({
  tabs,
  value,
  onChange,
}: {
  tabs: Array<{ value: TabKey; label: string; count: number }>;
  value: TabKey;
  onChange: (t: TabKey) => void;
}) {
  return (
    <div role="tablist" aria-label="Lists" className="flex flex-wrap" style={{ gap: 8, marginBottom: 12 }}>
      {tabs.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.value)}
            style={{ ...pressPill(active), padding: "0 12px" }}
          >
            {t.label}
            <span style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-secondary)" }}>{t.count}</span>
          </button>
        );
      })}
    </div>
  );
}

/** A lasting problem with the whole list, above it. A status, not an alert: it stays while the list is open. */
function Warning({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="status"
      style={{
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        marginBottom: 16,
        padding: "10px 14px",
        borderRadius: "var(--radius-control)",
        background: "var(--color-bg-elevated)",
        border: "1px solid var(--color-border)",
      }}
    >
      <Dot color="var(--color-warning)" />
      <p style={{ ...T.body, lineHeight: 1.5 }}>{children}</p>
    </div>
  );
}

function Dot({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      style={{ flex: "none", width: 8, height: 8, marginTop: 6, borderRadius: 999, background: color }}
    />
  );
}

/** Name (to the student page, C10), @name, plan, membership, and C7's way to reach them. */
function StudentHead({
  student,
  extra,
  actions,
}: {
  student: StudentBrief;
  extra?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between" style={{ gap: 10 }}>
      <div className="flex flex-wrap items-center" style={{ gap: "6px 8px", minWidth: 0, flex: "1 1 240px" }}>
        <Link
          href={`/admin/students/${encodeURIComponent(student.id)}`}
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
          {studentName(student)}
        </Link>
        {student.discord.username && (
          <span style={{ ...T.bodyDim, overflowWrap: "anywhere" }}>@{student.discord.username.replace(/^@/, "")}</span>
        )}
        <Pill tone="neutral">{student.plan}</Pill>
        <MembershipPill status={student.status} />
        {extra}
      </div>
      <div className="flex flex-wrap items-center" style={{ gap: 8 }}>
        <DiscordReach discord={student.discord} />
        {actions}
      </div>
    </div>
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

function videosPart(f: Facts): string {
  if (f.videosDone == null || f.videosTotal == null) return "Videos: couldn't read";
  return `Videos ${f.videosDone} of ${f.videosTotal}${f.countedByDeadline ? " done by the deadline" : ""}`;
}

/** "Paid Thu 1 Oct" · "Deadline Fri 23 Oct, 23:59 (Croatia time)" · "Videos 57 of 61" · "Asked Fri 16 Oct". */
function requestFacts(row: ThirtyRequestRow): string[] {
  return [
    row.facts.firstPaidAt ? `Paid ${dayLabel(row.facts.firstPaidAt)}` : "No first payment on file",
    row.facts.deadline ? `Deadline ${deadlineLabel(row.facts.deadline)}` : "No 30% deadline",
    videosPart(row.facts),
    `Asked ${dayLabel(row.askedAt)}`,
  ];
}

/** The verdict's colour: green yes, red when the rule says no, grey for no verdict. */
function verdictColor(v: Verdict): string {
  if (v.ok) return "var(--color-success)";
  if (v.reason === "read-failed" || v.reason === "unknown") return "var(--color-neutral)";
  return "var(--color-danger)";
}

/** A pending request: the facts, the verdict beside Approve, Approve anyway, Reject, the survey answers. */
function PendingRow({
  row,
  questions,
  locked,
  stale,
  onApprove,
  onReject,
}: {
  row: ThirtyRequestRow;
  questions: ThirtyPayload["questions"];
  /** Decided since the last read that worked: its buttons stay off until a read works. */
  locked: boolean;
  stale: boolean;
  onApprove: (row: ThirtyRequestRow, override: boolean) => RowResult;
  onReject: (row: ThirtyRequestRow, reason: string | null) => RowResult;
}) {
  const [busy, setBusy] = useState<null | "approve" | "override" | "reject">(null);
  const [confirm, setConfirm] = useState<null | "override" | "reject">(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const reasonId = useId();
  const verdict: Verdict = row.verdict ?? {
    ok: false,
    reason: "unknown",
    text: "The rule could not judge this request. Judge it by hand.",
    oldCourse: false,
  };
  const off = busy !== null || locked;

  async function run(what: NonNullable<typeof busy>, fn: () => RowResult) {
    setBusy(what);
    setError(null);
    const e = await fn();
    setBusy(null);
    if (e) setError(e);
    else setConfirm(null);
  }

  // A rejection the app counts: the student's map shows it and offers no new request (discount.ts, requestCounts).
  const rejectionCounts = requestCounts({ status: "rejected", created_at: row.askedAt }, row.facts.firstPaidAt);

  return (
    <div className="list-row" style={ROW}>
      <StudentHead student={row.student} extra={!row.student.whopPulled ? <WhopNotPulled /> : null} />
      <FactsLine parts={requestFacts(row)} />

      <div className="flex flex-wrap items-center" style={{ gap: 10 }}>
        <Button
          variant="raised"
          size="md"
          disabled={!verdict.ok || locked || (busy !== null && busy !== "approve")}
          busy={busy === "approve"}
          onClick={() => void run("approve", () => onApprove(row, false))}
        >
          Approve
        </Button>
        <p style={{ display: "flex", gap: 8, alignItems: "flex-start", flex: "1 1 240px", minWidth: 0 }}>
          <Dot color={verdictColor(verdict)} />
          <span style={{ ...T.body, lineHeight: 1.5 }}>{verdict.text}</span>
        </p>
        <div className="flex flex-wrap" style={{ gap: 8 }}>
          {!verdict.ok && (
            <Button
              variant="raised"
              size="md"
              disabled={off}
              onClick={() => setConfirm((c) => (c === "override" ? null : "override"))}
            >
              Approve anyway
            </Button>
          )}
          <Button
            variant="raised"
            size="md"
            disabled={off}
            onClick={() => setConfirm((c) => (c === "reject" ? null : "reject"))}
          >
            Reject
          </Button>
        </div>
      </div>

      {locked && stale && <p style={{ ...T.bodyDim, lineHeight: 1.5 }}>{SAVED_STALE}</p>}

      {confirm === "override" && (
        <div style={PANEL}>
          <p style={{ ...T.body, lineHeight: 1.5 }}>
            Approve anyway skips the 30% rule and creates the student&apos;s Whop code now.
          </p>
          <div className="flex flex-wrap" style={{ gap: 8 }}>
            <Button
              variant="raised"
              size="md"
              disabled={locked}
              busy={busy === "override"}
              onClick={() => void run("override", () => onApprove(row, true))}
            >
              Yes, create the code
            </Button>
            <Button variant="ghost" size="md" disabled={busy !== null} onClick={() => setConfirm(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {confirm === "reject" && (
        <div style={PANEL}>
          <label htmlFor={reasonId} style={{ ...T.body, fontWeight: 600 }}>
            Reason (optional)
          </label>
          <input
            id={reasonId}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setConfirm(null);
            }}
            maxLength={500}
            autoFocus
            placeholder="For example: not every video was done by the deadline"
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
          <p style={{ ...T.bodyDim, lineHeight: 1.5 }}>
            {rejectionCounts
              ? "The student sees this reason on their map, and cannot ask for the 30% again."
              : row.facts.window
                ? `This request was made before ${LAUNCH_DAY}, so the student can still ask again from the app.`
                : "The student may see this reason."}
          </p>
          <div className="flex flex-wrap" style={{ gap: 8 }}>
            <Button
              variant="raised"
              size="md"
              disabled={locked}
              busy={busy === "reject"}
              onClick={() => void run("reject", () => onReject(row, reason.trim() || null))}
            >
              Reject the request
            </Button>
            <Button variant="ghost" size="md" disabled={busy !== null} onClick={() => setConfirm(null)}>
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

      <Answers answers={row.answers} questions={questions} />
    </div>
  );
}

/** The survey answers, folded. Nothing when the request came with none. */
function Answers({
  answers,
  questions,
}: {
  answers: ThirtyRequestRow["answers"];
  questions: ThirtyPayload["questions"];
}) {
  if (answers.length === 0) return null;
  const text = new Map(questions.map((q) => [q.id, q.text] as const));
  // A block, not PANEL's flex column: a closed <details> would keep the gap under its summary.
  return (
    <details style={{ ...PANEL, display: "block" }}>
      <summary style={{ ...T.body, fontWeight: 600, cursor: "pointer" }}>Survey answers ({answers.length})</summary>
      <dl style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
        {answers.map((a) => (
          <div key={a.questionId}>
            <dt style={{ ...T.bodyDim, lineHeight: 1.5 }}>{text.get(a.questionId) ?? "A question no longer in the survey"}</dt>
            <dd style={{ ...T.body, lineHeight: 1.5, marginTop: 2, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {a.answer === null ? "No answer" : String(a.answer)}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

/** The code, and a button that copies it. */
function CodeWithCopy({ code }: { code: string }) {
  return (
    <span className="flex flex-wrap items-center" style={{ gap: 8 }}>
      <code
        style={{
          fontFamily: "var(--font-jetbrains-mono), ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 13,
          padding: "6px 10px",
          borderRadius: "var(--radius-chip)",
          background: "var(--color-bg-elevated)",
          border: "1px solid var(--color-border)",
          color: "var(--color-text-primary)",
          letterSpacing: "0.02em",
        }}
      >
        {code}
      </code>
      <CopyButton text={code} label="Copy" />
    </span>
  );
}

/** An approved, added or rejected request (C11's words). */
function DecidedRow({
  row,
  questions,
  locked,
  stale,
  onMarkApplied,
}: {
  row: ThirtyRequestRow;
  questions: ThirtyPayload["questions"];
  locked: boolean;
  stale: boolean;
  onMarkApplied: (row: ThirtyRequestRow) => RowResult;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reviewed = row.reviewedAt ? ` ${dayLabel(row.reviewedAt)}` : "";
  const decided =
    row.status === "rejected"
      ? [`Rejected${reviewed}${byWhom(row.reviewedBy)}`]
      : [
          `Approved${reviewed}${byWhom(row.reviewedBy)}`,
          ...(row.status === "applied"
            ? [`Code added${row.appliedAt ? ` ${dayLabel(row.appliedAt)}` : ""}${byWhom(row.appliedBy)}`]
            : []),
        ];

  return (
    <div className="list-row" style={ROW}>
      <StudentHead student={row.student} />
      <FactsLine parts={requestFacts(row)} />
      <p style={{ ...T.body, lineHeight: 1.5 }}>{decided.join(" · ")}</p>

      {row.status === "rejected" && (
        <p style={{ ...T.bodyDim, lineHeight: 1.5, overflowWrap: "anywhere" }}>
          {row.rejectionReason ? `Reason: ${row.rejectionReason}` : "No reason given."}
        </p>
      )}

      {row.promoCode && row.status !== "rejected" && (
        <div className="flex flex-wrap items-center" style={{ gap: 10 }}>
          <CodeWithCopy code={row.promoCode} />
          {row.status === "approved" && (
            <Button
              variant="raised"
              size="md"
              busy={busy}
              disabled={locked}
              onClick={async () => {
                setBusy(true);
                setError(null);
                const e = await onMarkApplied(row);
                setBusy(false);
                if (e) setError(e);
              }}
            >
              Mark code added
            </Button>
          )}
        </div>
      )}
      {/* The tab's note says what to do with a code; a row says it only when there is none. */}
      {row.status === "approved" && !row.promoCode && (
        <p style={{ ...T.bodyDim, lineHeight: 1.5 }}>
          This approved request has no code on file. Check it in Whop before marking anything.
        </p>
      )}

      {locked && stale && <p style={{ ...T.bodyDim, lineHeight: 1.5 }}>{SAVED_STALE}</p>}

      {error && (
        <p role="alert" style={ERROR_TEXT}>
          {error}
        </p>
      )}

      <Answers answers={row.answers} questions={questions} />
    </div>
  );
}

/** A member who can still earn the 30%: deadline, videos left, last contact (C12), their open queue tasks, and Mark messaged. */
function EarnRow({
  row,
  now,
  locked,
  stale,
  onMarkMessaged,
}: {
  row: ThirtyEarnRow;
  now: string;
  locked: boolean;
  stale: boolean;
  onMarkMessaged: (row: ThirtyEarnRow) => RowResult;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const f = row.facts;
  const left = timeLeftText(f.deadline, now);
  const total = f.videosTotal ?? 0;
  const done = f.videosDone ?? 0;
  const hours = aboutHoursWords(f.secondsLeft);
  const videos =
    row.state === "ready"
      ? `All ${total} videos done. Can apply for the 30% now.`
      : `${done} of ${total} videos done, ${total - done} left${hours ? ` (${hours})` : ""}`;

  return (
    <div className="list-row" style={ROW}>
      <StudentHead
        student={row.student}
        extra={
          <>
            {row.state === "ready" && <Pill tone="success">Can apply now</Pill>}
            {!row.student.whopPulled && <WhopNotPulled />}
          </>
        }
        actions={
          <Button
            variant="raised"
            size="md"
            busy={busy}
            disabled={locked}
            onClick={async () => {
              setBusy(true);
              setError(null);
              const e = await onMarkMessaged(row);
              setBusy(false);
              if (e) setError(e);
            }}
          >
            Mark messaged
          </Button>
        }
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <p style={{ ...T.body, lineHeight: 1.5 }}>
          {f.deadline ? `Deadline ${deadlineLabel(f.deadline)}${left ? `, ${left}` : ""}` : "No 30% deadline"}
        </p>
        <p style={{ ...T.body, lineHeight: 1.5 }}>{videos}</p>
        <p style={{ ...T.bodyDim, lineHeight: 1.5 }}>{lastContactText(row.lastContact)}</p>
        {row.openTasks.map((t) => (
          <p key={t.id} style={{ ...T.bodyDim, lineHeight: 1.5 }}>
            {`Also open in the Tasks queue since ${dayLabel(t.createdAt)}. Marking this row closes it too.`}
          </p>
        ))}
      </div>
      {locked && stale && <p style={{ ...T.bodyDim, lineHeight: 1.5 }}>{SAVED_STALE}</p>}
      {error && (
        <p role="alert" style={ERROR_TEXT}>
          {error}
        </p>
      )}
    </div>
  );
}
