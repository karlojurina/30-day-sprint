/**
 * The first-paid repair (the first-paid fix, 2026-10-20): every student's
 * first_paid_at set to their first real Whop payment, once, run from
 * POST /api/admin/first-paid-repair.
 *
 * Why it exists: until the fix first_paid_at came from Whop membership dates
 * (the sync's earliest membership created_at, the webhook's and the login's
 * joined_at), so a free member who bought later carried the free date: a
 * student who bought on 14 October was told his first payment was before
 * 1 October. The live writers now only fill an empty first_paid_at from the
 * first real payment (src/lib/first-payment.ts), and none of them moves a
 * stored one, so the wrong dates already stored need this pass.
 *
 * ONE CALL. Whop first: every paid payment of the account in one walk
 * (walkFirstPayments, at most 4 requests a second). No page starts after
 * 240 s and none is waited on past 285 s. A walk that does not reach its last
 * page answers ok: false, kind walk_incomplete, and writes nothing: no
 * repair is made from part of Whop's payments. Then every student row with a
 * whop_user_id, read after the walk so the values the write guards on are
 * fresh.
 *
 * THE PLAN, per student:
 *   - a first payment at another time than the one stored (compared as
 *     times, not strings): changed to it. Counted by direction (later,
 *     earlier, from empty) and by how far it moves, by what it does to the 30%
 *     (discount.ts's dates: 1 October and the 9 October launch, Croatia, both
 *     ways), by whether one of the student's 30% requests starts or stops
 *     counting (requestCounts), and by whether the new date opens the 30% to
 *     a student holding a live request that does not count under it;
 *   - a first payment at the stored time: unchanged;
 *   - no first payment (a free member, a seat given away, a comp): counted,
 *     split by whether a date is stored, and left exactly as it is. Never
 *     emptied.
 *
 * MODES. dry: the counts, nothing written. snapshot: the same reads, and
 * [student id, first_paid_at] for every row the write would change, saved to
 * bulk_ops/ before the write. write: each change written with its guard (the
 * row must still hold the value read: .eq on it, or .is null), 8 at a time,
 * none started after 280 s; the answer carries the change log
 * [student id, old, new] of the rows it wrote. A row changed meanwhile is
 * counted and left. A second write right after the first changes nothing.
 *
 * No answer names a student, an email or a Whop id: student ids only. The
 * walk's map is keyed by Whop ids and stays in here.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { walkFirstPayments, type FirstPaymentWalk, type PaymentReadFail } from "@/lib/first-payment";
import { fetchAllRowsPaginated } from "@/lib/supabase-pagination";
import { DISCOUNT_ELIGIBLE_FROM, DISCOUNT_LAUNCH_DATE, discountWindow, requestCounts } from "@/lib/world/discount";

/** No page of the walk starts after this. */
export const REPAIR_WALK_BUDGET_MS = 240_000;
/** No page of the walk is waited on past this, so the call answers before maxDuration (300 s). */
export const REPAIR_READ_LIMIT_MS = 285_000;
/** No write starts after this. */
export const REPAIR_WRITE_LIMIT_MS = 280_000;
const WRITES_AT_ONCE = 8;
/** Student ids per `.in()` filter, so the request's address stays short. */
const IDS_PER_READ = 100;
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

export type RepairMode = "dry" | "snapshot" | "write";

export interface RepairStudent {
  id: string;
  whop_user_id: string;
  first_paid_at: string | null;
}

/** One row the write changes: the value read, and the first payment it gets. */
export interface RepairChange {
  id: string;
  from: string | null;
  to: string;
}

interface MoveCount {
  all: number;
  under_a_minute: number;
  a_day_or_more: number;
}

export interface RepairPlan {
  changes: RepairChange[];
  students: {
    with_whop_id: number;
    payment_found: number;
    unchanged: number;
    to_change: number;
    /** Left as they are. */
    no_payment: { date_stored: number; empty: number };
  };
  moves: { later: MoveCount; earlier: MoveCount; from_empty: number };
  thirty: {
    /** A date before 1 October (Croatia) moves to on or after it: the 30% opens. */
    opens_was_before_oct_1: number;
    /** No date stored, and the first payment is on or after 1 October: the 30% opens. */
    opens_was_empty: number;
    /** A date on or after 1 October moves before it: the 30% closes. */
    closes: number;
    /** A date before the 9 October launch moves to on or after it: 14 days of their own, no longer the shared deadline or closed. */
    to_after_launch: number;
    /** A date on or after the launch moves before it. */
    to_before_launch: number;
  };
}

/** A stored time as a number; NaN for none, or one that does not read. */
const timeOf = (iso: string | null): number => (iso ? Date.parse(iso) : NaN);

/** The plan for these students against the first payments of the walk. Changes nothing. */
export function planFirstPaidRepair(
  students: readonly RepairStudent[],
  firstByUser: ReadonlyMap<string, string>,
): RepairPlan {
  const eligibleFrom = Date.parse(DISCOUNT_ELIGIBLE_FROM);
  const launch = Date.parse(DISCOUNT_LAUNCH_DATE);
  const plan: RepairPlan = {
    changes: [],
    students: {
      with_whop_id: students.length,
      payment_found: 0,
      unchanged: 0,
      to_change: 0,
      no_payment: { date_stored: 0, empty: 0 },
    },
    moves: {
      later: { all: 0, under_a_minute: 0, a_day_or_more: 0 },
      earlier: { all: 0, under_a_minute: 0, a_day_or_more: 0 },
      from_empty: 0,
    },
    thirty: { opens_was_before_oct_1: 0, opens_was_empty: 0, closes: 0, to_after_launch: 0, to_before_launch: 0 },
  };
  for (const s of students) {
    const paid = firstByUser.get(s.whop_user_id);
    if (!paid) {
      if (s.first_paid_at) plan.students.no_payment.date_stored += 1;
      else plan.students.no_payment.empty += 1;
      continue;
    }
    plan.students.payment_found += 1;
    const before = timeOf(s.first_paid_at);
    const after = Date.parse(paid);
    if (before === after) {
      plan.students.unchanged += 1;
      continue;
    }
    plan.students.to_change += 1;
    plan.changes.push({ id: s.id, from: s.first_paid_at, to: paid });
    if (!Number.isFinite(before)) {
      plan.moves.from_empty += 1;
      if (after >= eligibleFrom) plan.thirty.opens_was_empty += 1;
      continue;
    }
    const move = after > before ? plan.moves.later : plan.moves.earlier;
    const gap = Math.abs(after - before);
    move.all += 1;
    if (gap < MINUTE_MS) move.under_a_minute += 1;
    if (gap >= DAY_MS) move.a_day_or_more += 1;
    if (before < eligibleFrom && after >= eligibleFrom) plan.thirty.opens_was_before_oct_1 += 1;
    if (before >= eligibleFrom && after < eligibleFrom) plan.thirty.closes += 1;
    if (before < launch && after >= launch) plan.thirty.to_after_launch += 1;
    if (before >= launch && after < launch) plan.thirty.to_before_launch += 1;
  }
  return plan;
}

export interface RepairRequest {
  student_id: string;
  status: string;
  created_at: string;
}

/**
 * Of the changes, what the new date does to the students' 30% requests:
 *   requests_change: a request starts or stops counting (requestCounts);
 *   open_with_old_request: the new date opens the 30% (discountWindow not
 *     closed) while the student holds a pending, approved or applied request
 *     that does not count under it. The map then ignores that request and
 *     can offer Apply, though one 30% was already asked for or given.
 */
export function countRequestEffects(
  changes: readonly RepairChange[],
  requests: readonly RepairRequest[],
): { requests_change: number; open_with_old_request: number } {
  const byStudent = new Map<string, RepairRequest[]>();
  for (const r of requests) {
    const list = byStudent.get(r.student_id) ?? [];
    list.push(r);
    byStudent.set(r.student_id, list);
  }
  const live = new Set(["pending", "approved", "applied"]);
  const counts = { requests_change: 0, open_with_old_request: 0 };
  for (const c of changes) {
    const theirs = byStudent.get(c.id) ?? [];
    if (theirs.some((r) => requestCounts(r, c.from) !== requestCounts(r, c.to))) counts.requests_change += 1;
    if (!("closed" in discountWindow(c.to)) && theirs.some((r) => live.has(r.status) && !requestCounts(r, c.to))) {
      counts.open_with_old_request += 1;
    }
  }
  return counts;
}

/** Every student with a Whop id, past PostgREST's 1,000-row cap. Throws on a failed read. */
export async function readRepairStudents(supabase: SupabaseClient): Promise<RepairStudent[]> {
  const { data, error } = await fetchAllRowsPaginated<RepairStudent>(() =>
    supabase
      .from("students")
      .select("id, whop_user_id, first_paid_at")
      .not("whop_user_id", "is", null)
      .order("id", { ascending: true }),
  );
  if (error) throw new Error(`students read failed: ${error.message}`);
  return data;
}

/** The 30% requests of these students, every page of every chunk. Throws on a failed read. */
async function readRequests(supabase: SupabaseClient, studentIds: string[]): Promise<RepairRequest[]> {
  const all: RepairRequest[] = [];
  for (let i = 0; i < studentIds.length; i += IDS_PER_READ) {
    const chunk = studentIds.slice(i, i + IDS_PER_READ);
    const { data, error } = await fetchAllRowsPaginated<RepairRequest>(() =>
      supabase
        .from("discount_requests")
        .select("student_id, status, created_at")
        .in("student_id", chunk)
        .order("id", { ascending: true }),
    );
    if (error) throw new Error(`discount_requests read failed: ${error.message}`);
    all.push(...data);
  }
  return all;
}

/** The walk as an answer shows it: counts only, never its map. */
function shownWalk(walk: FirstPaymentWalk, durationMs: number): Record<string, unknown> {
  return {
    complete: walk.complete,
    stopped_because: walk.stoppedBecause,
    pages: walk.pages,
    requests: walk.requests,
    retried_429: walk.retried429,
    duration_ms: durationMs,
    payments: { seen: walk.counts.seen, kept: walk.counts.kept, skipped: walk.counts.skipped },
    users_with_a_payment: walk.firstByUser.size,
  };
}

/** What an answer with kind walk_incomplete says, in words a person reads. */
function walkSentence(stopped: "done" | PaymentReadFail): string {
  const nothing = "Nothing was written: no repair is made from part of Whop's payments.";
  if (stopped === "time_budget") {
    return `Whop's payments could not all be read in 240 seconds. ${nothing} Run it again; if it stops here every time, tell Claude.`;
  }
  if (stopped === "rate_limited") {
    return `Whop kept answering "too many requests" after two waits. ${nothing} Try again in a few minutes.`;
  }
  if (stopped === "http_401_403") {
    return `Whop refused the key (401 or 403): it may have lost its permission to read payments. ${nothing}`;
  }
  return `The read of Whop's payments stopped (${stopped}). ${nothing} Tell Claude before running it again.`;
}

/** Runs `work` on each item, `size` at a time, starting none once `stop()` says so. Answers how many were started. */
async function eachInPool<T>(
  items: readonly T[],
  size: number,
  stop: () => boolean,
  work: (item: T) => Promise<void>,
): Promise<number> {
  let next = 0;
  const lane = async () => {
    while (next < items.length && !stop()) {
      const item = items[next];
      next += 1;
      await work(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, lane));
  return next;
}

/**
 * One call of the repair. The answer is counts only (and, for a snapshot, the
 * rows it would change; for a write, the change log of the rows it wrote).
 */
export async function runFirstPaidRepair(
  supabase: SupabaseClient,
  { mode, startedAtMs }: { mode: RepairMode; startedAtMs: number },
): Promise<Record<string, unknown>> {
  const head = { mode, run_started_at: new Date(startedAtMs).toISOString() };

  const walk = await walkFirstPayments({
    startBy: startedAtMs + REPAIR_WALK_BUDGET_MS,
    answerBy: startedAtMs + REPAIR_READ_LIMIT_MS,
  });
  const walkShown = shownWalk(walk, Date.now() - startedAtMs);
  if (!walk.complete) {
    console.error(`[first-paid-repair] mode=${mode} the walk stopped (${walk.stoppedBecause}) after ${walk.pages} pages; nothing written`);
    return { ok: false, ...head, kind: "walk_incomplete", error: walkSentence(walk.stoppedBecause), walk: walkShown };
  }

  let students: RepairStudent[];
  try {
    students = await readRepairStudents(supabase);
  } catch (e) {
    console.error(`[first-paid-repair] ${e instanceof Error ? e.message : String(e)}`);
    return {
      ok: false,
      ...head,
      kind: "students_read_failed",
      error: "The students could not be read. Nothing was written. Try again.",
      walk: walkShown,
    };
  }
  const takenAt = new Date().toISOString();
  const plan = planFirstPaidRepair(students, walk.firstByUser);

  if (mode === "snapshot") {
    return {
      ok: true,
      ...head,
      taken_at: takenAt,
      walk: walkShown,
      counts: { rows: plan.changes.length },
      columns: ["student_id", "first_paid_at"],
      rows: plan.changes.map((c) => [c.id, c.from]),
    };
  }

  let requestEffects: ReturnType<typeof countRequestEffects>;
  try {
    requestEffects = countRequestEffects(plan.changes, await readRequests(supabase, plan.changes.map((c) => c.id)));
  } catch (e) {
    console.error(`[first-paid-repair] ${e instanceof Error ? e.message : String(e)}`);
    return {
      ok: false,
      ...head,
      kind: "requests_read_failed",
      error: "The 30% requests could not be read. Nothing was written. Try again.",
      walk: walkShown,
    };
  }
  const counts = {
    walk: walkShown,
    students: plan.students,
    moves: plan.moves,
    thirty: { ...plan.thirty, ...requestEffects },
  };

  if (mode === "dry") {
    console.info(`[first-paid-repair] mode=dry to_change=${plan.changes.length}`);
    return { ok: true, ...head, ...counts };
  }

  // Write: each change only while the row still holds the value read.
  const written: Array<[string, string | null, string]> = [];
  let changedMeanwhile = 0;
  let writeFailed = 0;
  const started = await eachInPool(
    plan.changes,
    WRITES_AT_ONCE,
    () => Date.now() - startedAtMs > REPAIR_WRITE_LIMIT_MS,
    async (c) => {
      try {
        const update = supabase.from("students").update({ first_paid_at: c.to }).eq("id", c.id);
        const guarded = c.from === null ? update.is("first_paid_at", null) : update.eq("first_paid_at", c.from);
        const { data, error } = await guarded.select("id");
        if (error) {
          writeFailed += 1;
          console.error(`[first-paid-repair] student=${c.id} write failed: ${error.message}`);
        } else if (!data || data.length === 0) {
          changedMeanwhile += 1;
        } else {
          written.push([c.id, c.from, c.to]);
        }
      } catch (e) {
        writeFailed += 1;
        console.error(`[first-paid-repair] student=${c.id} write threw: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );
  const notStarted = plan.changes.length - started;
  written.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  console.info(
    `[first-paid-repair] mode=write to_change=${plan.changes.length} written=${written.length} ` +
      `changed_meanwhile=${changedMeanwhile} write_failed=${writeFailed} not_started=${notStarted}`,
  );

  const result = {
    written: written.length,
    changed_meanwhile: changedMeanwhile,
    write_failed: writeFailed,
    not_started: notStarted,
    changes: written,
  };
  if (notStarted > 0 || writeFailed > 0) {
    const error = notStarted > 0
      ? `${notStarted} rows were not written before the time ran out. The rows written stand; run write again to finish (it reads Whop again and writes only the rows still different).`
      : `${writeFailed} rows could not be written. The rows written stand; run write again to finish (it reads Whop again and writes only the rows still different).`;
    return {
      ok: false,
      ...head,
      kind: notStarted > 0 ? "write_incomplete" : "write_failed",
      error,
      ...counts,
      ...result,
    };
  }
  return { ok: true, ...head, ...counts, ...result };
}
