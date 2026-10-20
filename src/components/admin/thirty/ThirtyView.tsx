"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Button, Card, EmptyState, T } from "@/components/admin/ui";
import {
  CopyButton,
  ListHeader,
  ListPage,
  LoadError,
  MembershipPill,
  NoticeStack,
  STALE_TEXT,
  SkeletonRows,
  TAP,
  firstName,
  pressPill,
} from "@/components/admin/list-parts";
import type { Notice } from "@/components/admin/list-parts";
import { adminTransport } from "@/lib/admin/admin-transport";
import type { Answer, ThirtyTransport } from "@/lib/admin/admin-transport";
import { clockLabel, dayLabel } from "@/lib/admin/croatia-dates";
import type {
  StudentBrief,
  TeamRef,
  ThirtyRequestRow,
  ThirtyView as ThirtyPayload,
  Verdict,
} from "@/lib/admin/thirty-view";
import { couponApprovalRefusal } from "@/lib/world/discount-server";
import { DISCOUNT_ELIGIBLE_FROM, DISCOUNT_LAUNCH_DATE, requestCounts } from "@/lib/world/discount";

/**
 * The 30% page, /admin/discounts (admin rebuild 2, D4 and D5).
 *
 * Four tabs, each with its count, every row oldest first: Applied (the
 * requests waiting for a decision, status pending), Approved (the code is
 * made), Rejected, and Code Applied (the code is on the membership, status
 * applied). Requests from 1 October on (DISCOUNT_ELIGIBLE_FROM); older ones
 * stay in the database.
 *
 * A row's top line is the student: their name (to the student page),
 * @username and whether the membership is active. Then only the date
 * applied, the verdict line (meets the rule, or why not), the coupon, and the
 * actions: Approve and Reject (with a reason) on Applied, Mark code applied
 * on Approved. "Approve anyway" is a small link after a refusal, never after
 * the coupon's: a student whose Whop membership already has a discount on its
 * next renewal gets no 30%, and the approve route refuses it with no override
 * (D5). The verdicts, the counts and the coupons come from GET
 * /api/admin/thirty, which runs the student app's own rule; this file only
 * shows them and sends the team's decisions to the existing routes.
 *
 * What a decision did shows in a fixed place at the bottom of the window
 * (NoticeStack, list-parts.tsx), where it is seen however far down the row
 * was: a success hides itself after 15 seconds, a refusal stays until it is
 * dismissed, and a Whop code in either can be copied from it. When the list
 * cannot be read again after a change, a second line says so and the row
 * just decided keeps its buttons off until a read works.
 *
 * The address: ?student=<id> keeps every tab to that student (the student
 * page links here), ?tab= picks the tab (applied, approved, rejected,
 * code-applied; the old decide and code-added still open theirs).
 *
 * The calls go through `transport` (src/lib/admin/admin-transport.ts), so
 * the dev page /dev/admin/discounts renders this same component with
 * made-up data and no login.
 */

type TabKey = "applied" | "approved" | "rejected" | "code-applied";

const TAB_ORDER: TabKey[] = ["applied", "approved", "rejected", "code-applied"];
const TAB_LABEL: Record<TabKey, string> = {
  applied: "Applied",
  approved: "Approved",
  rejected: "Rejected",
  "code-applied": "Code Applied",
};
const TAB_STATUS: Record<TabKey, ThirtyRequestRow["status"]> = {
  applied: "pending",
  approved: "approved",
  rejected: "rejected",
  "code-applied": "applied",
};
/** The tab names before admin rebuild 2, so an old link still opens its tab. */
const OLD_TAB: Record<string, TabKey> = { decide: "applied", "code-added": "code-applied" };

const FROM_DAY = dayLabel(DISCOUNT_ELIGIBLE_FROM);
const LAUNCH_DAY = dayLabel(DISCOUNT_LAUNCH_DATE);

/** One line under the tabs where the team has something to do. */
const TAB_NOTE: Partial<Record<TabKey, string>> = {
  applied: "Approve creates the student's Whop code.",
  approved: "Add the code to the student's membership in Whop, then press Mark code applied.",
};

const TAB_EMPTY: Record<TabKey, string> = {
  applied: "No request is waiting for a decision.",
  approved: "No code is waiting to be applied in Whop.",
  rejected: "No request has been rejected.",
  "code-applied": "No code has been applied in Whop yet.",
};

/** The id of the "may be out of date" line among the notices. */
const STALE_ID = -1;

/** A Whop code in a sentence: the approve route's 409 names the code that must be deleted in Whop. */
const WHOP_CODE = /\bECOM30-[A-Z0-9]{4,}\b/;

function parseTab(value: string | null): TabKey | null {
  if (value && value in OLD_TAB) return OLD_TAB[value];
  return TAB_ORDER.find((t) => t === value) ?? null;
}

type Loaded = { kind: "loading" } | { kind: "error"; error: string } | { kind: "ready"; data: ThirtyPayload };

/** What a row's button hands back: null when it went through, else a sentence to show on the row. */
type RowResult = Promise<string | null>;

/** The last button's notice. */
type PageNotice = Omit<Notice, "id" | "action">;

type Refusal = Extract<Answer<unknown>, { ok: false }>;

function studentName(s: StudentBrief): string {
  return s.name?.trim() || s.email || "No name on file";
}

/** " by Robin", or nothing when the member is unknown. */
function byWhom(ref: TeamRef | null): string {
  const n = firstName(ref?.name);
  return n ? ` by ${n}` : "";
}

/**
 * The page's own words for a decision the route refused. A 409 is the
 * route's sentence as it is (it names the Whop code to delete), and so is the
 * coupon's refusal (it names the code on the membership). The approve route's
 * other 400s name a button this page does not have, so they get the page's
 * words; the row's verdict then says why.
 */
function decisionError(kind: "approve" | "reject" | "applied", r: Refusal): string {
  if (r.status === 409) return r.error;
  if (r.status === 404) return "This request no longer exists.";
  if (kind === "approve" && r.status === 400) {
    if (r.code === "has-discount") return r.error;
    if (/already processed/i.test(r.error)) return "This request was already decided.";
    return "Not approved: the 30% rule says no for this request now. Its row shows why.";
  }
  if (kind === "applied" && r.status === 400) return "This request is no longer approved, so the code was not marked as applied.";
  if (kind === "reject" && r.status >= 500) return "Couldn't save the rejection. Try again.";
  if (kind === "applied" && r.status >= 500) return "Couldn't mark the code as applied. Try again.";
  return r.error;
}

/** A refusal that means the list is out of date: show it in the notices and read the list again. */
function listIsStale(kind: "approve" | "reject" | "applied", status: number): boolean {
  return status === 409 || status === 404 || (status === 400 && kind !== "reject");
}

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
  /** The requests changed since the last read that worked: their buttons stay off until a read works. */
  const [locked, setLocked] = useState<ReadonlySet<string>>(() => new Set());
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

  async function refused(kind: "approve" | "reject" | "applied", row: ThirtyRequestRow, r: Refusal): RowResult {
    const text = decisionError(kind, r);
    if (!listIsStale(kind, r.status)) return text;
    // A code made in Whop for a request someone else decided must be deleted there: it stays here until dismissed, copyable.
    const code = r.code === "has-discount" ? undefined : text.match(WHOP_CODE)?.[0];
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
    show({ tone: "success", text: `Marked the code as applied in Whop for ${studentName(row.student)}.` });
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
  if (notice) notices.push(notice);
  if (stale) notices.push({ id: STALE_ID, tone: "warning", text: STALE_TEXT });

  const header = (meta: React.ReactNode, action?: React.ReactNode) => (
    <ListHeader
      title="30% off"
      description={`Requests for the 30% from ${FROM_DAY}, oldest first.`}
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
  // The answer is oldest first already; every tab keeps that order.
  const requests = student ? data.requests.filter((r) => r.student.id === student) : data.requests;
  const lists = Object.fromEntries(
    TAB_ORDER.map((t) => [t, requests.filter((r) => r.status === TAB_STATUS[t])] as const),
  ) as Record<TabKey, ThirtyRequestRow[]>;
  const count = (t: TabKey) => lists[t].length;
  // With one student and no tab asked for, open the first tab that has them.
  const tab: TabKey =
    pickedTab ?? urlTab ?? (student ? (TAB_ORDER.find((t) => count(t) > 0) ?? "applied") : "applied");
  const studentShown = requests[0]?.student ?? null;
  const emptyTitle = student ? "This student has nothing on this tab." : TAB_EMPTY[tab];
  const note = TAB_NOTE[tab];

  return (
    <ListPage>
      {header(
        reloading ? `Updated ${clockLabel(data.generatedAt)} · Updating` : `Updated ${clockLabel(data.generatedAt)}`,
        <Button variant="raised" size="md" busy={reloading} onClick={() => void reload()}>
          Refresh
        </Button>,
      )}

      <NoticeStack notices={notices} onClose={closeNotice} />

      {data.requiredCount === null && (
        <Warning>
          Couldn&apos;t read the course&apos;s videos, so no request has a verdict. Press Refresh to try again.
        </Warning>
      )}
      {data.couponsUnread && (
        <Warning>
          Couldn&apos;t read the membership coupons, so no row shows one. Approve still asks Whop before it makes a code.
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
            {studentShown ? `Showing ${studentName(studentShown)} only.` : "Showing one student only. They have no 30% request."}
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
      {note && <p style={{ ...T.bodyDim, lineHeight: 1.5, marginBottom: 16 }}>{note}</p>}

      {count(tab) === 0 ? (
        <Card>
          <EmptyState title={emptyTitle} />
        </Card>
      ) : (
        <Card padding={0}>
          {lists[tab].map((row) =>
            row.status === "pending" ? (
              <PendingRow
                key={row.id}
                row={row}
                locked={locked.has(row.id)}
                stale={stale}
                onApprove={approve}
                onReject={reject}
              />
            ) : (
              <DecidedRow key={row.id} row={row} locked={locked.has(row.id)} stale={stale} onMarkApplied={markApplied} />
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
  gap: 10,
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

/**
 * "Approve anyway": a small text link, not a third pill beside Approve and
 * Reject. The text is 13px in Airy Blue (4.9:1 on a card at the lowest); the
 * box is the kit's 44px touch target.
 */
const SMALL_LINK: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: TAP,
  padding: "0 2px",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 500,
  color: "var(--color-accent-dark)",
  textDecoration: "underline",
  textDecorationColor: "rgba(147, 183, 213, 0.55)",
  textUnderlineOffset: 3,
  whiteSpace: "nowrap",
};

/** The line a row shows when it was just decided and the list could not be read again. */
const SAVED_STALE = "Saved. Press Refresh to see this row as it is now.";

/**
 * The four tabs as pills that wrap onto a second line on a phone, so every
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

/** The row's top line: the name (to the student page), @username, and whether the membership is active. */
function StudentHead({ student }: { student: StudentBrief }) {
  return (
    <div className="flex flex-wrap items-center" style={{ gap: "6px 8px", minWidth: 0 }}>
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
      {student.username && (
        <span style={{ ...T.bodyDim, overflowWrap: "anywhere" }}>@{student.username.replace(/^@/, "")}</span>
      )}
      <MembershipPill status={student.status} />
    </div>
  );
}

/** A line of parts with a dot between them; it wraps on a phone. */
function DotLine({ parts, dim = true }: { parts: string[]; dim?: boolean }) {
  return (
    <p style={{ ...(dim ? T.bodyDim : T.body), lineHeight: 1.6 }}>
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && <span aria-hidden="true"> · </span>}
          {p}
        </span>
      ))}
    </p>
  );
}

/** The verdict's colour: green yes, red when the rule or the coupon says no, grey for no verdict. */
function verdictColor(v: Verdict): string {
  if (v.ok) return "var(--color-success)";
  if (v.reason === "read-failed" || v.reason === "unknown") return "var(--color-neutral)";
  return "var(--color-danger)";
}

/** "57 of 61 videos" (and "by the deadline" once it has passed), and when Whop progress is not in yet. */
function verdictDetail(row: ThirtyRequestRow, v: Verdict): string[] {
  const f = row.facts;
  if (v.reason === "has-discount" || !f || f.videosDone == null || f.videosTotal == null) return [];
  const out = [`${f.videosDone} of ${f.videosTotal} videos${f.countedByDeadline ? " by the deadline" : ""}`];
  if (v.reason === "locked" && !row.student.whopPulled) out.push("Whop progress not pulled since the switch");
  return out;
}

/** An Applied row: the date applied, the verdict line, Approve and Reject, and Approve anyway after a refusal that is not the coupon's. */
function PendingRow({
  row,
  locked,
  stale,
  onApprove,
  onReject,
}: {
  row: ThirtyRequestRow;
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
  // D5: the coupon's refusal has no override, so no Approve anyway after it.
  const canOverride = !verdict.ok && verdict.reason !== "has-discount";
  const detail = verdictDetail(row, verdict);

  async function run(what: NonNullable<typeof busy>, fn: () => RowResult) {
    setBusy(what);
    setError(null);
    const e = await fn();
    setBusy(null);
    if (e) setError(e);
    else setConfirm(null);
  }

  // A rejection the app counts: the student's map shows it and offers no new request (discount.ts, requestCounts).
  const rejectionCounts = requestCounts({ status: "rejected", created_at: row.askedAt }, row.facts?.firstPaidAt ?? null);

  return (
    <div className="list-row" style={ROW}>
      <StudentHead student={row.student} />
      <DotLine parts={[`Applied ${dayLabel(row.askedAt)}`]} />

      {/* The verdict takes its own width, so "Approve anyway" sits right after it (under it on a phone). */}
      <div className="flex flex-wrap items-center" style={{ columnGap: 14, rowGap: 0 }} data-verdict={verdict.reason ?? "yes"}>
        <p style={{ display: "flex", gap: 8, alignItems: "flex-start", flex: "0 1 auto", minWidth: 0, padding: "4px 0" }}>
          <Dot color={verdictColor(verdict)} />
          <span style={{ ...T.body, lineHeight: 1.5 }}>
            {verdict.text}
            {detail.length > 0 && (
              <span style={{ color: "var(--color-text-secondary)" }}>
                {detail.map((d) => (
                  <span key={d}>
                    <span aria-hidden="true"> · </span>
                    {d}
                  </span>
                ))}
              </span>
            )}
          </span>
        </p>
        {canOverride && (
          <button
            type="button"
            style={{ ...SMALL_LINK, opacity: off ? 0.5 : 1, cursor: off ? "not-allowed" : "pointer" }}
            disabled={off}
            aria-expanded={confirm === "override"}
            onClick={() => setConfirm((c) => (c === "override" ? null : "override"))}
          >
            Approve anyway
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center" style={{ gap: 8 }}>
        <Button
          variant="raised"
          size="md"
          disabled={!verdict.ok || locked || (busy !== null && busy !== "approve")}
          busy={busy === "approve"}
          onClick={() => void run("approve", () => onApprove(row, false))}
        >
          Approve
        </Button>
        <Button
          variant="raised"
          size="md"
          disabled={off}
          onClick={() => setConfirm((c) => (c === "reject" ? null : "reject"))}
        >
          Reject
        </Button>
      </div>

      {locked && stale && <p style={{ ...T.bodyDim, lineHeight: 1.5 }}>{SAVED_STALE}</p>}

      {confirm === "override" && canOverride && (
        <div style={PANEL}>
          <p style={{ ...T.body, lineHeight: 1.5 }}>
            Approve anyway skips the 30% rule and creates the student&apos;s Whop code now. A discount already on the
            student&apos;s membership still stops it.
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
              : row.facts?.window
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
    </div>
  );
}

/** The 30% code, and a button that copies it. */
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

/** An Approved, Rejected or Code Applied row: the dates and who decided, the reason or the code, Mark code applied on Approved. */
function DecidedRow({
  row,
  locked,
  stale,
  onMarkApplied,
}: {
  row: ThirtyRequestRow;
  locked: boolean;
  stale: boolean;
  onMarkApplied: (row: ThirtyRequestRow) => RowResult;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reviewed = row.reviewedAt ? ` ${dayLabel(row.reviewedAt)}` : "";
  const parts = [`Applied ${dayLabel(row.askedAt)}`];
  if (row.status === "rejected") parts.push(`Rejected${reviewed}${byWhom(row.reviewedBy)}`);
  else {
    parts.push(`Approved${reviewed}${byWhom(row.reviewedBy)}`);
    if (row.status === "applied") {
      parts.push(`Code applied${row.appliedAt ? ` ${dayLabel(row.appliedAt)}` : ""}${byWhom(row.appliedBy)}`);
    }
  }
  // A code on the membership that still discounts the next renewal, on a request approved before the coupon rule:
  // adding the 30% code would replace it, so the team checks Whop first.
  const coupon = row.status === "approved" && row.coupon?.discounted ? row.coupon : null;

  return (
    <div className="list-row" style={ROW}>
      <StudentHead student={row.student} />
      <DotLine parts={parts} />

      {row.status === "rejected" && (
        <p style={{ ...T.bodyDim, lineHeight: 1.5, overflowWrap: "anywhere" }}>
          {row.rejectionReason ? `Reason: ${row.rejectionReason}` : "No reason given."}
        </p>
      )}

      {coupon && (
        <p style={{ display: "flex", gap: 8, alignItems: "flex-start" }} data-coupon="discounted">
          <Dot color="var(--color-warning)" />
          <span style={{ ...T.body, lineHeight: 1.5 }}>
            {couponApprovalRefusal(coupon.code)} Check Whop before you add the 30% code.
          </span>
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
              Mark code applied
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
    </div>
  );
}
