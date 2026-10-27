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
} from "@/components/admin/list-parts";
import type { Notice } from "@/components/admin/list-parts";
import { StudentName } from "@/components/admin/student-name";
import { adminTransport } from "@/lib/admin/admin-transport";
import type { Answer, ApproveAnswer, ThirtyTransport } from "@/lib/admin/admin-transport";
import { clockLabel, dayLabel } from "@/lib/admin/croatia-dates";
import { COUPON_REJECT_REASON, anywaySkip, approveAnywayText, couponWarns, studentCopies, videoLine } from "@/lib/admin/thirty-view";
import type {
  StudentBrief,
  TeamRef,
  ThirtyRequestRow,
  ThirtyView as ThirtyPayload,
  Verdict,
} from "@/lib/admin/thirty-view";
import { thirtyWords } from "@/lib/thirty-words";
import { couponApprovalRefusal } from "@/lib/world/discount-server";
import { DISCOUNT_LAUNCH_DATE, requestCounts } from "@/lib/world/discount";

/**
 * The 30% page, /admin/discounts (admin rebuild 2, D4 and D5; the 30% that
 * applies itself, T-137, R4).
 *
 * The 30% goes on by itself: a student's Apply claims the request, makes the
 * code and puts it on their Whop membership, and a job every 10 minutes
 * finishes what the moment could not. So the page is one list of the
 * requests the app could not finish, oldest first (GET /api/admin/thirty):
 * from 1 October, still pending or approved 30 minutes after the student
 * applied, and any request whose newest event is a write_failed from the last
 * 30 days, whatever its status. The four tabs (Applied, Approved, Rejected,
 * Code Applied) and the nav's "30% off" went; an old ?tab= link opens the
 * list. Every row carries a Why line (thirtyWords, built by thirty-view.ts):
 * what went wrong, and what happens next, by who will act. With
 * THIRTY_AUTO_APPLY off, a line under the header says the automatic part is
 * paused, and every Why line names the team.
 *
 * A row's top line is the student: their name (to the student page),
 * @username (student-name.tsx, the one name part of every admin page) and
 * whether the membership is active. Then the dates, the verdict and the Why
 * line, the coupon, and the actions, on the right from 768px wide and under
 * the words on a phone (RowSplit):
 *   pending   Approve, Approve anyway and Reject, as before the 30% applied
 *             itself (Approve now makes the code and puts it on). A pending
 *             row whose code may exist (a claimed name, or a code reopened by
 *             hand) shows Reject to a founder or an admin alone: the reject
 *             route asks Whop where its code is first, and refuses a csm.
 *   approved  Try again (every role): the approve route asks Whop where the
 *             code is, puts it on the student's own membership, and marks the
 *             request applied once Whop shows it there (it replaced Mark code
 *             applied). Reject (a founder or an admin), confirmed first: the
 *             code stays usable at checkout until someone switches it off in
 *             Whop. The coupon warning and the copy buttons as before.
 *   rejected or applied, listed for a write_failed: the words and the copy
 *             buttons only, since only Whop can change what happened.
 *
 * The verdict line's count (the 80% rule, the owner's of 2026-10-26): how
 * many of the videos up to the checkpoint were watched (by the deadline, once
 * it has passed) and what the window needs, "48 of 61 videos by the deadline ·
 * 49 needed for 80%"; the verdict says yes from there (thirty-view.ts). A
 * deadline before 26 October asks for every video (the owner's B of the same
 * day): its verdict and count say so ("61 needed, every video for a deadline
 * before Mon 26 Oct"), and so does the reason Reject suggests.
 *
 * COPY DISCORD ID AND COPY USERNAME (the owner, 2026-10-26: "We have 'Copy
 * the code,' which is very good, and then 'Copy Discord username' or 'their
 * ID' or whatever. I think ID might be best"): on every pending row, and
 * beside "Copy code" on every row that has a code, Copy Discord ID copies
 * the student's Discord user id, and Copy username the username on file
 * with one "@" in front whether or not the stored one has it. The username
 * is the student's Whop username after every Whop sign-in and every
 * payment, and their Discord one only once the 2-hour sync wrote it since,
 * so the button never says Discord and its tip says so (the review of the
 * same day: it read "Copy @", and "Copy ID" beside it). One with nothing on
 * file is greyed with a plain tip; with neither, one short line stands in
 * their place, since a phone shows no tip (thirty-view.ts studentCopies).
 * The code's button says "Copy code" since then (it said "Copy").
 *
 * A row whose stored coupon row says Whop does not show both a paid course
 * plan and a course payment that went through for the student (the owner's
 * rule of 2026-10-26; Whop showing no real payment from the review of that
 * day until his answers) gets that as its verdict in the page's own words
 * ("The 30% needs a paid course plan and a payment that went through, and Whop
 * doesn't show both for this student."), with no Approve (Approve anyway skips
 * it as it skips the rule) and with "Check Whop again", as the coupon's row
 * has it. A plain Approve the route refuses for it shows the page's own
 * sentence, and the list read again shows the verdict, the route having
 * stored what Whop said (naming the membership on file, so it counts for it:
 * membership-discount.ts).
 *
 * APPROVE ANYWAY (the owner's review, 2026-10-21: approving past any check).
 * A founder or an admin (`canApproveAnyway`; the
 * approve route refuses a csm's override too) gets "Approve anyway", a small
 * link, on every pending row a check refuses: the rule's verdict, the
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
 * app's own rule and asks Whop now about the approved rows' coupons; this
 * file only shows them and sends the team's decisions to the existing
 * routes. A pending row the rule says yes to, whose membership has no
 * stored check, says "Coupon not checked yet" (a row refused for another
 * reason does not); an approved row says when Whop could not be asked. The
 * team's own 30% code on a membership (an ECOM30 code, or the request's own
 * Whop promo id: thirty-view.ts, Coupon.ours) is never warned about. When the
 * stored coupons cannot be read at all, the rows show no coupon and the page
 * says nothing more (the owner's review: the sentence above the list went).
 *
 * Buttons (the brand kit: one ink primary at most, verbs that say what
 * happens): Approve, Try again and Refresh are raised; Reject is ghost, the
 * "no" of the row, as Dismiss is on Tasks, and raised on the coupon's row,
 * where it is the one decision; "Reject the request", which the student
 * cannot undo by asking again, is the danger button.
 *
 * What a press did shows in a fixed place at the bottom of the window
 * (NoticeStack, list-parts.tsx), where it is seen however far down the row
 * was, in the words of the PRD's tables (§9.4): a success hides itself after
 * 15 seconds; a refusal, and a notice that leaves the team something to do in
 * Whop (a code made but not on the membership yet, a code left usable at
 * checkout), stays until it is dismissed; a Whop code in any of them can be
 * copied from it. When the list cannot be read again after a change, a
 * second line says so and the row just decided keeps its buttons off until a
 * read works.
 *
 * The address: ?student=<id> keeps the list to that student (the student
 * page links here); ?tab= from before the one list is ignored.
 *
 * The calls go through `transport` (src/lib/admin/admin-transport.ts), so
 * the dev page /dev/admin/discounts renders this same component with
 * made-up data and no login.
 */

/** The header's line (R4): the page lists only what the app could not finish. */
const HEADER_LINE = "The 30% goes on automatically. These are the requests the app couldn't finish, oldest first.";
/** Under the header while THIRTY_AUTO_APPLY pauses the automatic part (R7). */
export const PAUSED_LINE = "The automatic 30% is paused (THIRTY_AUTO_APPLY is off). Requests wait here for the team.";
const EMPTY = "Nothing needs a hand.";
const EMPTY_STUDENT = "Nothing of theirs needs a hand.";

/** Reject's confirm on an approved row (§9.6): the code made stays usable. */
const staysUsable = (code: string) => `The code ${code} stays usable at checkout until someone switches it off in Whop.`;

/** The id of the "may be out of date" line among the notices. */
const STALE_ID = -1;

/** A Whop code in a sentence: the approve route's 409s name the code to delete, or the one Whop attached. */
const WHOP_CODE = /\bECOM30-[A-Z0-9]{4,}\b/;

const LAUNCH_DAY = dayLabel(DISCOUNT_LAUNCH_DATE);

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

/** What a row's button asked: Approve (and Try again, the same route), Reject, or "check" (Check Whop again). */
type RowCall = "approve" | "reject" | "check";

/**
 * How Approve asks: "plain" runs every check; Approve anyway skips the 30%
 * rule ("rule", the route's `override`), or on a row the coupon refuses the
 * coupon check and the rule ("coupon", `overrideCoupon` too).
 */
type ApproveHow = "plain" | "rule" | "coupon";

/**
 * The page's own words for a call the route refused. A 409 is the route's
 * sentence as it is (it names the Whop code to delete, the code Whop
 * attached after a reject, or why a Reject did not go through), and so is
 * the coupon's refusal (it names the code on the membership). The approve
 * route's other 400s name a button this page does not have, so they get the
 * page's words; the row's verdict then says why. Reject's 503 ("Couldn't ask
 * Whop") is the route's sentence too; a failure of the server is the page's
 * "Couldn't save the rejection." Check Whop again's refusals are its route's
 * sentences.
 */
function decisionError(kind: RowCall, r: Refusal): string {
  if (r.status === 409) return r.error;
  if (r.status === 404) return "This request no longer exists.";
  if (kind === "approve" && r.status === 400) {
    if (r.code === "has-discount") return r.error;
    if (/already processed/i.test(r.error)) return "This request was already decided.";
    return "Not approved: the 30% rule says no for this request now. Its row shows why.";
  }
  if (kind === "reject" && r.status >= 500 && r.status !== 503) return "Couldn't save the rejection. Try again.";
  return r.error;
}

/** A refusal that means the list is out of date: show it in the notices and read the list again. */
function listIsStale(kind: RowCall, status: number): boolean {
  return status === 409 || status === 404 || (status === 400 && kind === "approve");
}

/**
 * The notice after Approve or Try again went through (2xx), in the words of
 * the approve table (PRD §9.4): the code on the membership; made but not on
 * it yet, and why; Whop silent while making it; or no code made yet, and why.
 * The why is thirtyWords for the answer's reason, the row's age and the
 * switch, as the row's Why line says it.
 */
export function approveNotice(row: ThirtyRequestRow, answer: ApproveAnswer, tryAgain: boolean, paused: boolean): PageNotice {
  const name = studentName(row.student);
  const code = answer.promoCode ?? row.promoCode;
  const named = code ?? "the code";
  const copy = code ? { copy: { label: "Copy code", text: code } } : {};
  const why = () =>
    thirtyWords(answer.reason, answer.step, {
      ageHours: row.ageHours,
      status: answer.status ?? row.status,
      paused,
      claimed: answer.status === "pending" && answer.promoCode !== null,
      code,
      membershipStatus: answer.membershipStatus,
      message: answer.message,
    });
  const said = (head: string) => [head, why()].filter((s) => s !== "").join(" ");
  if (answer.status === "applied") {
    return { tone: "success", text: tryAgain ? `${name}: the code ${named} is on their membership.` : `Approved ${name}. The code ${named} is on their membership.`, ...copy };
  }
  if (answer.status === "approved") {
    return { tone: "warning", text: said(`${name}: the code ${named} is made but not on their membership yet.`), ...copy };
  }
  if (answer.status === "pending" && (answer.step === "create" || answer.step === "create_no_id")) {
    return {
      tone: "warning",
      text: `${name}: Whop didn't answer while making ${named}. Press Approve again in 5 minutes to look for it on Whop now; otherwise the app looks within the hour.`,
      ...copy,
    };
  }
  return { tone: "warning", text: said(`${name}: no code was made yet.`) };
}

export function ThirtyView({
  transport = adminTransport,
  canApproveAnyway = false,
}: {
  transport?: ThirtyTransport;
  /**
   * A founder or an admin: Approve anyway on every pending row a check
   * refuses (the approve route allows no one else), and Reject on a row whose
   * code may exist (the reject route allows no one else).
   */
  canApproveAnyway?: boolean;
}) {
  const params = useSearchParams();
  const pathname = usePathname();
  const student = params.get("student") || null;

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

  /** The list for everyone: the student filter goes from the address, nothing is loaded. */
  function showEveryone() {
    const next = new URLSearchParams(params.toString());
    next.delete("student");
    const q = next.toString();
    window.history.replaceState(null, "", q ? `${pathname}?${q}` : pathname);
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

  const paused = loaded.kind === "ready" ? loaded.data.paused : false;

  /**
   * Approve, or Approve anyway (`how`). A refusal of a check (the route's
   * code "rule": the rule said no, or a check could not run, as the 409
   * "The course changed and this check cannot run") stays on the row in the
   * route's words or the page's, and is remembered, so a founder or an admin
   * gets Approve anyway there even where the list's verdict says yes; the
   * list is read again, since its verdict may have changed. What went through
   * is said in the approve table's words (approveNotice).
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
    show(approveNotice(row, r.data, false, paused));
    await reload();
    return null;
  }

  /** Try again on an approved row: the approve route asks Whop where the code is, puts it on, and marks it applied. */
  async function tryAgain(row: ThirtyRequestRow): RowResult {
    const r = await transport.approve(row.id, false, false);
    if (!r.ok) return refused("approve", row, r);
    lock(row.id);
    show(approveNotice(row, r.data, true, paused));
    await reload();
    return null;
  }

  /**
   * Reject. What it did is said in the reject table's words (PRD §9.4): no
   * code made; a code left usable at checkout, made and on nobody's
   * membership; or a code Whop may have made, which the app could not ask
   * about. The last two stay until dismissed, with the code to copy.
   */
  async function reject(row: ThirtyRequestRow, reason: string | null): RowResult {
    const r = await transport.reject(row.id, reason);
    if (!r.ok) return refused("reject", row, r);
    lock(row.id);
    const code = r.data.code ?? row.promoCode ?? "the code";
    const copy = r.data.code ? { copy: { label: "Copy code", text: r.data.code } } : {};
    if (r.data.codeState === "usable") {
      show({ tone: "warning", text: `Rejected. ${staysUsable(code)}`, ...copy });
    } else if (r.data.codeState === "may_exist") {
      show({ tone: "warning", text: `Rejected. Whop may have made ${code}: look for it in Whop's promo codes and switch it off if it's there.`, ...copy });
    } else {
      show({ tone: "success", text: `Rejected the request from ${studentName(row.student)}.` });
    }
    await reload();
    return null;
  }

  /**
   * Check Whop again, on a row the stored coupon refuses, and since the review
   * of 2026-10-26 on one whose stored row says the student is unpaid (since
   * the owner's answers of that day: no paid course plan and payment that
   * went through; no real payment until then): Whop now for that student,
   * stored by the route, then the list read again, which judges the row by
   * what was stored. Nothing is decided, so the row is not locked. Whop giving
   * no answer is the route's sentence on the row.
   */
  async function checkCoupon(row: ThirtyRequestRow): RowResult {
    const r = await transport.checkCoupon(row.id);
    if (!r.ok) return refused("check", row, r);
    const name = studentName(row.student);
    const wasCoupon = row.verdict?.reason === "has-discount";
    const code = r.data.code ? ` (${r.data.code})` : "";
    show({
      tone: "success",
      text: r.data.discounted
        ? `Whop ${wasCoupon ? "still shows" : "shows"} a discount on ${name}'s membership${code}.`
        : r.data.unpaid
          ? wasCoupon
            ? `Whop shows no discount on ${name}'s membership now, and doesn't show both a paid course plan and a payment that went through.`
            : `Whop still doesn't show both a paid course plan and a payment that went through for ${name}.`
          : wasCoupon
            ? `Whop shows no discount on ${name}'s membership now. The 30% rule decides this request again.`
            : // What is known for sure: a payment that went through. The plan can be one Whop gives no price for, where
              // the payment decides (membership-discount.ts, THE PAID PLAN AND THE PAYMENT; the review of 2026-10-26).
              `Whop shows a payment that went through for ${name} now. The 30% rule decides this request again.`,
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
    <ListHeader title="30% off" description={HEADER_LINE} meta={meta} action={action} />
  );

  if (loaded.kind === "loading") {
    return (
      <ListPage>
        {header("Loading", <RefreshButton onPress={() => {}} busy disabled />)}
        <SkeletonRows rows={4} label="Loading the 30% list" />
      </ListPage>
    );
  }

  if (loaded.kind === "error") {
    return (
      <ListPage>
        {header(<FailedMeta />, <RefreshButton onPress={() => void retry()} busy={retrying} />)}
        <LoadError title="Couldn't load the 30% list." detail={loaded.error} onRetry={retry} busy={retrying} />
      </ListPage>
    );
  }

  const data = loaded.data;
  // The answer is oldest first already.
  const rows = student ? data.requests.filter((r) => r.student.id === student) : data.requests;
  const studentShown = rows[0]?.student ?? null;

  return (
    <ListPage>
      {header(
        reloading ? `Updated ${clockLabel(data.generatedAt)} · Updating` : `Updated ${clockLabel(data.generatedAt)}`,
        <RefreshButton onPress={() => void reload()} busy={reloading} />,
      )}

      <NoticeStack notices={notices} onClose={closeNotice} />

      {data.paused && (
        <Warning data-paused="">
          {PAUSED_LINE}
        </Warning>
      )}

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
            {studentShown ? `Showing ${studentName(studentShown)} only.` : "Showing one student only."}
          </p>
          <Button variant="raised" size="md" onClick={showEveryone}>
            Show everyone
          </Button>
        </div>
      )}

      {rows.length === 0 ? (
        <Card>
          <EmptyState title={student ? EMPTY_STUDENT : EMPTY} />
        </Card>
      ) : (
        <Card padding={0}>
          {rows.map((row) =>
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
            ) : row.status === "approved" ? (
              <ApprovedRow
                key={row.id}
                row={row}
                locked={locked.has(row.id)}
                stale={stale}
                canReject={canApproveAnyway}
                onTryAgain={tryAgain}
                onReject={reject}
              />
            ) : (
              <DecidedRow key={row.id} row={row} />
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

/** The reason field of a Reject panel: 16px, so a phone's browser does not zoom the page into it. */
const REASON_INPUT: React.CSSProperties = {
  width: "100%",
  height: TAP,
  padding: "0 12px",
  fontSize: 16,
  borderRadius: "var(--radius-control)",
  border: "1px solid var(--color-border-strong)",
  background: "var(--color-bg-card)",
  color: "var(--color-text-primary)",
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

/** A lasting problem with the whole list, above it. A status, not an alert: it stays while the list is open. */
function Warning({ children, ...data }: { children: React.ReactNode; "data-paused"?: string }) {
  return (
    <div
      role="status"
      {...data}
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

/**
 * A row's Why line (thirty-view.ts whyLine, thirtyWords): what went wrong and
 * what happens next. Its dot is the warning colour when an attempt failed,
 * grey while nothing has been tried.
 */
function WhyLine({ row }: { row: ThirtyRequestRow }) {
  if (!row.why) return null;
  return (
    <p data-why={row.lastFailure?.reason ?? "none"} style={{ display: "flex", gap: 8, alignItems: "flex-start", minWidth: 0 }}>
      <Dot color={row.lastFailure ? "var(--color-warning)" : "var(--color-neutral)"} />
      <span style={{ ...T.body, lineHeight: 1.5, overflowWrap: "anywhere" }}>{row.why}</span>
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
 * Copy Discord ID, then Copy username (thirty-view.ts studentCopies): the
 * student's Discord user id, and the username on file with one "@" in front,
 * its tip saying it can be their Whop username. Each greyed, its tip saying
 * what is missing, when the student has none on file; with neither, one
 * short line in their place. With a username and no Discord ID a short line
 * beside them says the username may be their Whop one (the review of
 * 2026-10-26: a phone shows no tip).
 */
function StudentCopies({ student }: { student: StudentBrief }) {
  const { id, username, none, note } = studentCopies(student);
  if (none) {
    return (
      <span data-no-discord="" style={{ ...T.bodyDim, lineHeight: 1.5 }}>
        {none}
      </span>
    );
  }
  return (
    <>
      <CopyButton text={id.text} label="Copy Discord ID" unavailable={id.unavailable ?? undefined} tip={id.tip ?? undefined} />
      <CopyButton text={username.text} label="Copy username" unavailable={username.unavailable ?? undefined} tip={username.tip ?? undefined} />
      {note && (
        <span data-username-note="" style={{ ...T.bodyDim, lineHeight: 1.5 }}>
          {note}
        </span>
      )}
    </>
  );
}

/**
 * A pending row: the date applied, the verdict line, the Why line, and the
 * actions on the right (RowSplit): Approve and Reject. A row the coupon
 * refuses has no Approve: Reject is raised, its reason starts filled in (the
 * render review's fix round), and "Check Whop again" stands beside it (its
 * second round). For a founder or an admin, "Approve anyway" stands in
 * Approve's place on every row a check refuses, the coupon's too, and after
 * a refusal the route answered (the owner's review, 2026-10-21). A row whose
 * code may exist (a claimed name, or a code reopened by hand) has Reject for
 * a founder or an admin alone, as the reject route allows (T-137).
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
  // Check Whop again on the coupon's row and, since the review of 2026-10-26, on an unpaid one.
  const recheck = coupon || verdict.reason === "unpaid";
  const skip = anywaySkip(verdict, refusal);
  const canOverride = canApproveAnyway && skip !== null;
  // A code may exist (a claim, or a code reopened by hand): the reject route asks Whop first, and a csm may not (T-137).
  const codeMayExist = row.promoCode !== null || row.whopPromoId !== null;
  const canReject = !codeMayExist || canApproveAnyway;
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
      {/* Small links, as tall as Reject: "Check Whop again" on the coupon's row and on the unpaid one, then,
          for a founder or an admin, "Approve anyway" wherever a check refuses (the coupon's row too). Approve is on
          where the verdict says yes and no Approve anyway stands in its place. */}
      {recheck && (
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
      {canReject && (
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
      )}
    </>
  );

  return (
    <div className="list-row" style={ROW} data-row-status="pending">
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
            <WhyLine row={row} />
            {/* Only beside the rule's yes: a row refused for another reason has nothing Approve would do. */}
            {row.couponCheck === "not-checked" && verdict.ok && (
              <p style={{ display: "flex", gap: 8, alignItems: "flex-start" }} data-coupon="not-checked">
                <Dot color="var(--color-neutral)" />
                <span style={{ ...T.bodyDim, lineHeight: 1.5 }}>Coupon not checked yet. Approve asks Whop first.</span>
              </p>
            )}
            {/* Copy Discord ID and Copy username, to find the student on Discord (the owner, 2026-10-26). No Copy
                code: a pending request's code name is a claim whose code may not exist (as on the student's page). */}
            <span className="flex flex-wrap items-center" style={{ gap: 8 }} data-discord-copies="">
              <StudentCopies student={row.student} />
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

      {confirm === "reject" && canReject && (
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
            placeholder={
              // A deadline before 26 October asks for every video (thirty-view.ts Facts.everyVideo, the owner's B).
              row.facts?.everyVideo
                ? "For example: not every video was watched by the deadline"
                : "For example: fewer than 80% of the videos were watched by the deadline"
            }
            style={REASON_INPUT}
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

/** The 30% code, the button that copies it, and beside it Copy Discord ID and Copy username (2026-10-26). */
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
      <StudentCopies student={student} />
    </span>
  );
}

/** "Applied Mon 19 Oct · Approved Tue 20 Oct by Robin" and, for an applied or rejected row, its decision. */
function datesOf(row: ThirtyRequestRow): string[] {
  const reviewed = row.reviewedAt ? ` ${dayLabel(row.reviewedAt)}` : "";
  const parts = [`Applied ${dayLabel(row.askedAt)}`];
  if (row.status === "rejected") parts.push(`Rejected${reviewed}${byWhom(row.reviewedBy)}`);
  else {
    parts.push(`Approved${reviewed}${byWhom(row.reviewedBy)}`);
    if (row.status === "applied") {
      parts.push(`Code applied${row.appliedAt ? ` ${dayLabel(row.appliedAt)}` : ""}${byWhom(row.appliedBy)}`);
    }
  }
  return parts;
}

/**
 * An approved row: the dates and who decided, the code with its copy
 * buttons, the coupon warning, the Why line, and on the right (RowSplit) Try
 * again (every role) and Reject (a founder or an admin, confirmed first). The
 * coupon warning is an approved row's only: a discount on the next renewal
 * that is not the request's own 30% code (couponWarns, thirty-view.ts). The
 * team's own ECOM30 code is never warned about (the render review's fix round).
 */
function ApprovedRow({
  row,
  locked,
  stale,
  canReject,
  onTryAgain,
  onReject,
}: {
  row: ThirtyRequestRow;
  locked: boolean;
  stale: boolean;
  /** A founder or an admin: the reject route allows no one else on a request whose code exists. */
  canReject: boolean;
  onTryAgain: (row: ThirtyRequestRow) => RowResult;
  onReject: (row: ThirtyRequestRow, reason: string | null) => RowResult;
}) {
  const [busy, setBusy] = useState<null | "again" | "reject">(null);
  const [confirm, setConfirm] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const reasonId = useId();
  // A code on the membership that still discounts the next renewal (Whop's answer now, or the stored one when Whop
  // said nothing): putting the 30% code on would replace it, so the team checks Whop first. A request approved before
  // the coupon rule has no stored row, which is why the page asks Whop about the approved rows itself.
  const approved = row.status === "approved";
  const coupon = couponWarns(row) ? row.coupon : null;
  const unchecked = approved && !row.coupon && (row.couponCheck === "failed" || row.couponCheck === "no-membership");
  const off = busy !== null || locked;
  const rejectionCounts = requestCounts({ status: "rejected", created_at: row.askedAt }, null);

  async function run(what: NonNullable<typeof busy>, fn: () => RowResult) {
    setBusy(what);
    setError(null);
    const e = await fn();
    setBusy(null);
    if (e) setError(e);
    else setConfirm(false);
  }

  return (
    <div className="list-row" style={ROW} data-row-status="approved">
      <RowSplit
        main={
          <>
            <StudentHead student={row.student} />
            <DotLine parts={datesOf(row)} />

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
            <WhyLine row={row} />

            {row.promoCode ? (
              <CodeWithCopy code={row.promoCode} student={row.student} />
            ) : (
              <p style={{ ...T.bodyDim, lineHeight: 1.5 }}>This approved request has no code on file. Check it in Whop.</p>
            )}

            {locked && stale && <p style={{ ...T.bodyDim, lineHeight: 1.5 }}>{SAVED_STALE}</p>}
          </>
        }
        actions={
          <>
            <Button variant="raised" size="md" busy={busy === "again"} disabled={locked || (busy !== null && busy !== "again")} onClick={() => void run("again", () => onTryAgain(row))}>
              Try again
            </Button>
            {canReject && (
              <Button variant="ghost" size="md" disabled={off} expanded={confirm} onClick={() => setConfirm((c) => !c)}>
                Reject
              </Button>
            )}
          </>
        }
      />

      {confirm && canReject && (
        <div style={PANEL}>
          {/* Asked first (§9.6): a code made stays usable at checkout until someone switches it off in Whop. */}
          <p data-reject-confirm="" style={{ ...T.body, lineHeight: 1.5 }}>
            {staysUsable(row.promoCode ?? "the code")}
          </p>
          <label htmlFor={reasonId} style={{ ...T.body, fontWeight: 600 }}>
            Reason (optional)
          </label>
          <input
            id={reasonId}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setConfirm(false);
            }}
            maxLength={500}
            autoFocus
            placeholder="For example: two accounts on one card"
            style={REASON_INPUT}
          />
          <p style={{ ...T.bodyDim, lineHeight: 1.5 }}>
            {rejectionCounts ? "The student sees this reason on their map, and cannot ask for the 30% again." : "The student may see this reason."}
          </p>
          <div className="flex flex-wrap" style={{ gap: 8 }}>
            <Button variant="danger" size="md" disabled={locked} busy={busy === "reject"} onClick={() => void run("reject", () => onReject(row, reason.trim() || null))}>
              Reject the request
            </Button>
            <Button variant="ghost" size="md" disabled={busy !== null} onClick={() => setConfirm(false)}>
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

/**
 * A rejected or applied row, listed because its newest event is a
 * write_failed from the last 30 days: the dates, the reason it was rejected,
 * its Why line (Whop made or attached a code the app could not record), and
 * the code with its copy buttons. Nothing to press: only Whop can change it.
 */
function DecidedRow({ row }: { row: ThirtyRequestRow }) {
  const code = row.lastFailure?.code ?? row.promoCode;
  return (
    <div className="list-row" style={ROW} data-row-status={row.status}>
      <RowSplit
        main={
          <>
            <StudentHead student={row.student} />
            <DotLine parts={datesOf(row)} />
            {row.status === "rejected" && (
              <p style={{ ...T.bodyDim, lineHeight: 1.5, overflowWrap: "anywhere" }}>
                {row.rejectionReason ? `Reason: ${row.rejectionReason}` : "No reason given."}
              </p>
            )}
            <WhyLine row={row} />
            {code && <CodeWithCopy code={code} student={row.student} />}
          </>
        }
      />
    </div>
  );
}
