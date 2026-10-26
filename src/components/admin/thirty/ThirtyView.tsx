"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Button, Card, EmptyState, T } from "@/components/admin/ui";
import {
  CopyButton,
  FailedMeta,
  ListHeader,
  ListPage,
  LoadError,
  MembershipPill,
  NoticeStack,
  RowSplit,
  STALE_TEXT,
  SkeletonRows,
  TAP,
  firstName,
  pressPill,
} from "@/components/admin/list-parts";
import type { Notice } from "@/components/admin/list-parts";
import { StudentName } from "@/components/admin/student-name";
import { adminTransport } from "@/lib/admin/admin-transport";
import type { Answer, ThirtyTransport } from "@/lib/admin/admin-transport";
import { clockLabel, dayLabel } from "@/lib/admin/croatia-dates";
import { DISCOUNT_STATUS } from "@/lib/admin/discount-status";
import { COUPON_REJECT_REASON, anywaySkip, approveAnywayText, couponWarns, discordCopies, videoLine } from "@/lib/admin/thirty-view";
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
 * @username (student-name.tsx, the one name part of every admin page) and
 * whether the membership is active. Then only the date applied, the verdict
 * line (meets the rule, or why not), the coupon, and the actions, on the
 * right from 768px wide and under the words on a phone (RowSplit): Approve
 * and Reject (with a reason) on Applied, Mark code applied on Approved.
 *
 * The verdict line's count (the 80% rule, the owner's of 2026-10-26): how
 * many of the videos up to the checkpoint were watched (by the deadline, once
 * it has passed) and what the 80% needs, "48 of 61 videos by the deadline ·
 * 49 needed for 80%"; the verdict says yes from there (thirty-view.ts).
 *
 * COPY @ AND COPY ID (the owner, 2026-10-26: "We have 'Copy the code,' which
 * is very good, and then 'Copy Discord username' or 'their ID'"): on every
 * Applied row, and beside "Copy code" on every row that has a code, two
 * buttons copy the student's Discord username, with one "@" in front
 * whether or not the stored one has it, and their Discord user id. Each is
 * greyed, with a plain tip, when the student has none on file. The code's
 * button says "Copy code" since then (it said "Copy").
 *
 * APPROVE ANYWAY (the owner's review, 2026-10-21: approving past any check).
 * A founder or an admin (`canApproveAnyway`; the
 * approve route refuses a csm's override too) gets "Approve anyway", a small
 * link, on every Applied row a check refuses: the rule's verdict, the
 * coupon's, and a refusal the approve route answered when Approve was
 * pressed (its code "rule": the rule said no, or could not run, as "The
 * course changed and this check cannot run"). It asks once, inline, naming
 * what it skips, then creates the code: `override` skips the rule, and on a
 * row the coupon refuses `overrideCoupon` skips the coupon check as well. A
 * csm sees no Approve anyway: Reject, and Approve again after a refusal of
 * the route, which may have been a read that failed.
 *
 * A student whose Whop membership already has a discount on its next
 * renewal gets no 30% from Approve (D5). Such a row (the render review's fix
 * round) has no Approve: Reject is raised, its reason filled in with the
 * map's own sentence to the student ("You can't apply for this discount
 * because you already have a discount applied to your account.", since the
 * render review's second round: the student reads the reason on the map),
 * which the team can change before sending. It also has "Check Whop again",
 * a small link like Approve anyway: Whop is asked now for that one student
 * (POST /api/admin/thirty/check-coupon), the answer is stored, and the list
 * is read again, so a coupon taken off the membership since the stored read
 * brings Approve back. The verdicts, the counts
 * and the coupons come from GET /api/admin/thirty, which runs the student
 * app's own rule and asks Whop now about the Approved rows' coupons; this
 * file only shows them and sends the team's decisions to the existing
 * routes. An Applied row the rule says yes to, whose membership has no
 * stored check, says "Coupon not checked yet" (a row refused for another
 * reason does not); one whose Whop id is missing or is not a membership's
 * (Approve cannot ask Whop then, and nothing blocks the 30%) says to check
 * Whop by hand; an Approved row says when Whop could not be asked. The
 * team's own 30% code on a membership (an ECOM30 code, or the request's own
 * Whop promo id: thirty-view.ts, Coupon.ours) is never warned about. When the
 * stored coupons cannot be read at all, the rows show no coupon and the page
 * says nothing more (the owner's review: the sentence above the list went).
 *
 * Buttons (the brand kit: one ink primary at most, verbs that say what
 * happens): Approve, Mark code applied and Refresh are raised; Reject is
 * ghost, the "no" of the row, as Dismiss is on Tasks, and raised on the
 * coupon's row, where it is the one decision; "Reject the request", which
 * the student cannot undo by asking again, is the danger button.
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
const TAB_STATUS: Record<TabKey, ThirtyRequestRow["status"]> = {
  applied: "pending",
  approved: "approved",
  rejected: "rejected",
  "code-applied": "applied",
};
/** The tabs' names: the one map every admin page names the statuses by (discount-status.ts). */
const TAB_LABEL = Object.fromEntries(TAB_ORDER.map((t) => [t, DISCOUNT_STATUS[TAB_STATUS[t]].label])) as Record<TabKey, string>;
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

/** What a row's button asked: a decision, or "check" (Check Whop again). */
type RowCall = "approve" | "reject" | "applied" | "check";

/**
 * How Approve asks: "plain" runs every check; Approve anyway skips the 30%
 * rule ("rule", the route's `override`), or on a row the coupon refuses the
 * coupon check and the rule ("coupon", `overrideCoupon` too).
 */
type ApproveHow = "plain" | "rule" | "coupon";

/**
 * The page's own words for a call the route refused. A 409 is the route's
 * sentence as it is (it names the Whop code to delete), and so is the
 * coupon's refusal (it names the code on the membership). The approve route's
 * other 400s name a button this page does not have, so they get the page's
 * words; the row's verdict then says why. Check Whop again's refusals are
 * its route's sentences.
 */
function decisionError(kind: RowCall, r: Refusal): string {
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
function listIsStale(kind: RowCall, status: number): boolean {
  return status === 409 || status === 404 || (status === 400 && (kind === "approve" || kind === "applied"));
}

export function ThirtyView({
  transport = adminTransport,
  canApproveAnyway = false,
}: {
  transport?: ThirtyTransport;
  /** A founder or an admin: Approve anyway on every Applied row a check refuses (the approve route allows no one else). */
  canApproveAnyway?: boolean;
}) {
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
  /**
   * The rows whose Approve the route refused with code "rule" (the rule said
   * no, or a check could not run), with the sentence it said: Approve anyway
   * is offered on them whatever the list's verdict.
   */
  const [refusals, setRefusals] = useState<ReadonlyMap<string, string>>(() => new Map());
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

  async function refused(kind: RowCall, row: ThirtyRequestRow, r: Refusal): RowResult {
    const text = decisionError(kind, r);
    if (!listIsStale(kind, r.status)) return text;
    // A code made in Whop for a request someone else decided must be deleted there: it stays here until dismissed, copyable.
    const code = r.code === "has-discount" ? undefined : text.match(WHOP_CODE)?.[0];
    show({ tone: "danger", text: `${studentName(row.student)}: ${text}`, ...(code ? { copy: { label: "Copy code", text: code } } : {}) });
    await reload();
    return null;
  }

  /**
   * Approve, or Approve anyway (`how`). A refusal of a check (the route's
   * code "rule": the rule said no, or a check could not run, as the 409
   * "The course changed and this check cannot run") stays on the row in the
   * route's words or the page's, and is remembered, so a founder or an admin
   * gets Approve anyway there even where the list's verdict says yes; the
   * list is read again, since its verdict may have changed.
   */
  async function approve(row: ThirtyRequestRow, how: ApproveHow): RowResult {
    const r = await transport.approve(row.id, how !== "plain", how === "coupon");
    if (!r.ok && r.code === "rule") {
      const text = decisionError("approve", r);
      setRefusals((cur) => new Map(cur).set(row.id, text));
      await reload();
      return text;
    }
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

  /**
   * Check Whop again, on a row the stored coupon refuses: Whop now for that
   * student, stored by the route, then the list read again, which judges the
   * row by what was stored. Nothing is decided, so the row is not locked.
   * Whop giving no answer is the route's sentence on the row.
   */
  async function checkCoupon(row: ThirtyRequestRow): RowResult {
    const r = await transport.checkCoupon(row.id);
    if (!r.ok) return refused("check", row, r);
    const name = studentName(row.student);
    show({
      tone: "success",
      text: r.data.discounted
        ? `Whop still shows a discount on ${name}'s membership${r.data.code ? ` (${r.data.code})` : ""}.`
        : `Whop shows no discount on ${name}'s membership now. The 30% rule decides this request again.`,
    });
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

  // While the list loads or failed, the header keeps its Refresh and the tabs keep their place, with no counts.
  const blankTabs = (
    <TabStrip tabs={TAB_ORDER.map((t) => ({ value: t, label: TAB_LABEL[t], count: null }))} value={pickedTab ?? urlTab ?? "applied"} onChange={() => {}} disabled />
  );

  if (loaded.kind === "loading") {
    return (
      <ListPage>
        {header("Loading", <RefreshButton onPress={() => {}} busy disabled />)}
        {blankTabs}
        <SkeletonRows rows={4} label="Loading the 30% list" />
      </ListPage>
    );
  }

  if (loaded.kind === "error") {
    return (
      <ListPage>
        {header(<FailedMeta />, <RefreshButton onPress={() => void retry()} busy={retrying} />)}
        {blankTabs}
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
        <RefreshButton onPress={() => void reload()} busy={reloading} />,
      )}

      <NoticeStack notices={notices} onClose={closeNotice} />

      {data.requiredCount === null && (
        <Warning>
          Couldn&apos;t read the course&apos;s videos, so no request has a verdict. Press Refresh to try again.
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
                canApproveAnyway={canApproveAnyway}
                refusal={refusals.get(row.id) ?? null}
                onApprove={approve}
                onReject={reject}
                onCheck={checkCoupon}
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
 * "Approve anyway" and "Check Whop again": a small text link, not a third
 * pill beside Approve and Reject. The text is 13px in Airy Blue (4.9:1 on a
 * card at the lowest); the box is the kit's 44px touch target.
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

/** The header's Refresh: there while the list loads (busy, off) or failed (it retries), so the header never jumps. */
function RefreshButton({ onPress, busy, disabled = false }: { onPress: () => void; busy: boolean; disabled?: boolean }) {
  return (
    <Button variant="raised" size="md" busy={busy} disabled={disabled} onClick={onPress}>
      Refresh
    </Button>
  );
}

/**
 * The four tabs as pills, each 44px tall, its count 12px. Under 400px the
 * pills, their words and the gaps between them narrow (8px of padding, 12px
 * words, 4px apart: measured at 390px wide, the four take 357 of the 358px
 * the page has) so they fit on one line; on a narrower phone the row scrolls
 * sideways instead of wrapping onto a second. While the list loads or
 * failed, the tabs stay with no counts (`count` null) and do nothing.
 */
function TabStrip({
  tabs,
  value,
  onChange,
  disabled = false,
}: {
  tabs: Array<{ value: TabKey; label: string; count: number | null }>;
  value: TabKey;
  onChange: (t: TabKey) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="tablist"
      aria-label="Lists"
      className="flex flex-wrap gap-2 max-[399px]:flex-nowrap max-[399px]:overflow-x-auto max-[399px]:gap-1 max-[399px]:[--tab-pad:8px] max-[399px]:[--tab-gap:4px] max-[399px]:[--tab-font:12px]"
      style={{ marginBottom: 12 }}
    >
      {tabs.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={active}
            aria-disabled={disabled || undefined}
            onClick={() => {
              if (!disabled) onChange(t.value);
            }}
            style={{
              ...pressPill(active),
              padding: "0 var(--tab-pad, 12px)",
              gap: "var(--tab-gap, 8px)",
              fontSize: "var(--tab-font, 13px)",
              cursor: disabled ? "default" : "pointer",
            }}
          >
            {t.label}
            {t.count !== null && <span style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-secondary)" }}>{t.count}</span>}
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

/** The row's top line: the name (to the student page) with @username, as on every admin page, and whether the membership is active. */
function StudentHead({ student }: { student: StudentBrief }) {
  return (
    <div className="flex flex-wrap items-center" style={{ gap: "6px 8px", minWidth: 0 }}>
      <StudentName id={student.id} name={studentName(student)} username={student.username} />
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

/**
 * Copy @ and Copy ID (thirty-view.ts discordCopies): the student's Discord
 * username with one "@" in front, and their Discord user id; each greyed,
 * its tip saying what is missing, when the student has none on file.
 */
function DiscordCopies({ student }: { student: StudentBrief }) {
  const { at, id } = discordCopies(student);
  return (
    <>
      <CopyButton text={at.text} label="Copy @" unavailable={at.unavailable ?? undefined} />
      <CopyButton text={id.text} label="Copy ID" unavailable={id.unavailable ?? undefined} />
    </>
  );
}

/**
 * An Applied row: the date applied, the verdict line, and the actions on the
 * right (RowSplit): Approve and Reject. A row the coupon refuses has no
 * Approve: Reject is raised, its reason starts filled in (the render
 * review's fix round), and "Check Whop again" stands beside it (its second
 * round). For a founder or an admin, "Approve anyway" stands in Approve's
 * place on every row a check refuses, the coupon's too, and after a refusal
 * the route answered (the owner's review, 2026-10-21).
 */
function PendingRow({
  row,
  locked,
  stale,
  canApproveAnyway,
  refusal,
  onApprove,
  onReject,
  onCheck,
}: {
  row: ThirtyRequestRow;
  /** Decided since the last read that worked: its buttons stay off until a read works. */
  locked: boolean;
  stale: boolean;
  /** A founder or an admin. */
  canApproveAnyway: boolean;
  /** The approve route's refusal of this row's Approve (its code "rule"), in the words the row showed; null when none. */
  refusal: string | null;
  onApprove: (row: ThirtyRequestRow, how: ApproveHow) => RowResult;
  onReject: (row: ThirtyRequestRow, reason: string | null) => RowResult;
  /** Check Whop again: Whop now for this student, stored, then the list read again. */
  onCheck: (row: ThirtyRequestRow) => RowResult;
}) {
  const verdict: Verdict = row.verdict ?? {
    ok: false,
    reason: "unknown",
    text: "The rule could not judge this request. Judge it by hand.",
    oldCourse: false,
  };
  // D5: no Approve beside the coupon's verdict. Approve anyway passes it (the owner's review), naming it.
  const coupon = verdict.reason === "has-discount";
  const skip = anywaySkip(verdict, refusal);
  const canOverride = canApproveAnyway && skip !== null;
  const [busy, setBusy] = useState<null | "approve" | "override" | "reject" | "check">(null);
  const [confirm, setConfirm] = useState<null | "override" | "reject">(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const reasonId = useId();
  const off = busy !== null || locked;
  // The count and what the 80% needs (thirty-view.ts videoLine).
  const detail = videoLine(row, verdict);

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

  const actions = (
    <>
      {/* Small links, as tall as Reject: "Check Whop again" on the coupon's row, then, for a founder or an admin,
          "Approve anyway" wherever a check refuses (the coupon's row too). Approve is on where the verdict says yes
          and no Approve anyway stands in its place. */}
      {coupon && (
        <button
          type="button"
          data-check-whop=""
          style={{ ...SMALL_LINK, padding: "0 6px", opacity: off ? 0.5 : 1, cursor: busy === "check" ? "wait" : off ? "not-allowed" : "pointer" }}
          disabled={off}
          aria-busy={busy === "check" || undefined}
          onClick={() =>
            void run("check", async () => {
              const e = await onCheck(row);
              // The reason filled in for the coupon goes with the answer it was for; one the team wrote stays.
              if (!e) setReason((cur) => (cur === COUPON_REJECT_REASON ? "" : cur));
              return e;
            })
          }
        >
          {busy === "check" ? "Checking Whop" : "Check Whop again"}
        </button>
      )}
      {canOverride && (
        <button
          type="button"
          data-approve-anyway={skip ?? ""}
          style={{ ...SMALL_LINK, padding: "0 6px", opacity: off ? 0.5 : 1, cursor: off ? "not-allowed" : "pointer" }}
          disabled={off}
          aria-expanded={confirm === "override"}
          onClick={() => setConfirm((c) => (c === "override" ? null : "override"))}
        >
          Approve anyway
        </button>
      )}
      {!coupon && verdict.ok && !canOverride && (
        <Button
          variant="raised"
          size="md"
          disabled={locked || (busy !== null && busy !== "approve")}
          busy={busy === "approve"}
          onClick={() => void run("approve", () => onApprove(row, "plain"))}
        >
          Approve
        </Button>
      )}
      <Button
        variant={coupon ? "raised" : "ghost"}
        size="md"
        disabled={off}
        expanded={confirm === "reject"}
        onClick={() => {
          const opening = confirm !== "reject";
          setConfirm(opening ? "reject" : null);
          // The coupon's row: the reason starts as the map's own sentence to the student, who reads it there (the
          // team can change it). Filled when the panel opens, so a row the coupon refuses only after a reload
          // (Approve refused by Whop) gets it too.
          if (opening && coupon && !reason.trim()) setReason(COUPON_REJECT_REASON);
        }}
      >
        Reject
      </Button>
    </>
  );

  return (
    <div className="list-row" style={ROW}>
      <RowSplit
        main={
          <>
            <StudentHead student={row.student} />
            <DotLine parts={[`Applied ${dayLabel(row.askedAt)}`]} />

            <p style={{ display: "flex", gap: 8, alignItems: "flex-start", minWidth: 0 }} data-verdict={verdict.reason ?? "yes"}>
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
            {/* Only beside the rule's yes: a row refused for another reason has nothing Approve would do. */}
            {row.couponCheck === "not-checked" && verdict.ok && (
              <p style={{ display: "flex", gap: 8, alignItems: "flex-start" }} data-coupon="not-checked">
                <Dot color="var(--color-neutral)" />
                <span style={{ ...T.bodyDim, lineHeight: 1.5 }}>Coupon not checked yet. Approve asks Whop first.</span>
              </p>
            )}
            {/* Copy @ and Copy ID, to find the student on Discord (the owner, 2026-10-26). */}
            <span className="flex flex-wrap items-center" style={{ gap: 8 }} data-discord-copies="">
              <DiscordCopies student={row.student} />
            </span>
            {locked && stale && <p style={{ ...T.bodyDim, lineHeight: 1.5 }}>{SAVED_STALE}</p>}
          </>
        }
        actions={actions}
      />

      {confirm === "override" && canOverride && skip && (
        <div style={PANEL}>
          {/* Asked once, naming what it skips (the owner's review, 2026-10-21). */}
          <p data-approve-anyway-confirm="" style={{ ...T.body, lineHeight: 1.5 }}>
            {approveAnywayText(skip, verdict.text, refusal)}
          </p>
          <div className="flex flex-wrap" style={{ gap: 8 }}>
            <Button
              variant="raised"
              size="md"
              disabled={locked}
              busy={busy === "override"}
              onClick={() => void run("override", () => onApprove(row, skip === "coupon" ? "coupon" : "rule"))}
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
            placeholder="For example: fewer than 80% of the videos were watched by the deadline"
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
              variant="danger"
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

/** The 30% code, the button that copies it, and beside it Copy @ and Copy ID (2026-10-26). */
function CodeWithCopy({ code, student }: { code: string; student: StudentBrief }) {
  return (
    <span className="flex flex-wrap items-center" style={{ gap: 8 }} data-discord-copies="">
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
      <CopyButton text={code} label="Copy code" />
      <DiscordCopies student={student} />
    </span>
  );
}

/**
 * An Approved, Rejected or Code Applied row: the dates and who decided, the
 * reason or the code, and Mark code applied on the right of an Approved row
 * (RowSplit). The coupon warning is an Approved row's only: a discount on the
 * next renewal that is not the request's own 30% code (couponWarns,
 * thirty-view.ts). The team's ECOM30 code, added in Whop before Mark code
 * applied was pressed, is never warned about (the render review's fix round).
 */
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
  // A code on the membership that still discounts the next renewal (Whop's answer now, or the stored one when Whop
  // said nothing): adding the 30% code would replace it, so the team checks Whop first. A request approved before
  // the coupon rule has no stored row, which is why the page asks Whop about the Approved rows itself.
  const approved = row.status === "approved";
  const coupon = couponWarns(row) ? row.coupon : null;
  const unchecked = approved && !row.coupon && (row.couponCheck === "failed" || row.couponCheck === "no-membership");
  const canMark = approved && Boolean(row.promoCode);

  return (
    <div className="list-row" style={ROW}>
      <RowSplit
        main={
          <>
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
                  {row.couponCheck === "stored" && (
                    <span style={{ color: "var(--color-text-secondary)" }}> Whop gave no answer now; this is its answer of {dayLabel(coupon.checkedAt)}.</span>
                  )}
                </span>
              </p>
            )}
            {unchecked && (
              <p style={{ display: "flex", gap: 8, alignItems: "flex-start" }} data-coupon="unchecked">
                <Dot color="var(--color-neutral)" />
                <span style={{ ...T.body, lineHeight: 1.5 }}>
                  {row.couponCheck === "no-membership"
                    ? "Couldn't ask Whop about a coupon: the student's Whop membership is not on file."
                    : "Couldn't ask Whop about a coupon on this membership."}{" "}
                  Check Whop before you add the 30% code.
                </span>
              </p>
            )}

            {row.promoCode && row.status !== "rejected" && <CodeWithCopy code={row.promoCode} student={row.student} />}
            {/* The tab's note says what to do with a code; a row says it only when there is none. */}
            {approved && !row.promoCode && (
              <p style={{ ...T.bodyDim, lineHeight: 1.5 }}>
                This approved request has no code on file. Check it in Whop before marking anything.
              </p>
            )}

            {locked && stale && <p style={{ ...T.bodyDim, lineHeight: 1.5 }}>{SAVED_STALE}</p>}
          </>
        }
        actions={
          canMark ? (
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
          ) : undefined
        }
      />

      {error && (
        <p role="alert" style={ERROR_TEXT}>
          {error}
        </p>
      )}
    </div>
  );
}
