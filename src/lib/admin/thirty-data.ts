/**
 * The reads behind the admin's 30% page (GET /api/admin/thirty): the requests
 * that need a hand, the students holding them, the rule's reads for each of
 * those students, the coupons stored for them (admin rebuild 2, D4 and D5),
 * and each listed request's newest failed attempt.
 *
 * THE LIST (the 30% that applies itself, T-137, R4: the 30% goes on by itself,
 * so the page lists only what the app could not finish). readNeedsHand reads
 * it, and the Dashboard's "30% needs a hand" counts the same reads
 * (src/app/admin/(authenticated)/page.tsx), so the tile and the page agree:
 *   - requests made from 1 October (DISCOUNT_ELIGIBLE_FROM) still pending or
 *     approved 30 minutes after the student applied (NEEDS_HAND_AFTER_MS), and
 *   - any request whose newest event (discount_request_events, v116) is a
 *     write_failed from the last 30 days (WRITE_FAILED_LISTED_MS), whatever
 *     its status: a code Whop made that the app could not record, one Whop
 *     attached after the request was rejected, another code of its name Whop
 *     put on the membership, or a code a Reject left usable at checkout (the
 *     build's review of 2026-10-27).
 * Applied and rejected requests are otherwise left out, as are requests from
 * before 1 October. loadThirtyData also reads each listed request's newest
 * attempt_failed event (`failures`, with how many it has), the Why line's
 * facts (thirty-view.ts).
 * Any of these reads that fails fails the whole load: a missing event would
 * leave a row off the list, or say "The app hasn't tried yet." of a request
 * it tried and could not finish.
 *
 * The student app judges one student from five reads (loadDiscountReads in
 * discount-server.ts). This file makes each read once for every listed
 * student and hands each the DiscountReads object loadDiscountReads would
 * have made for them. The rule itself (discount.ts and the pure half of
 * discount-server.ts) is called unchanged by thirty-view.ts, and
 * client-tests/thirty-view.test.mjs runs every fixture both ways.
 *
 * What each listed student gets, against loadDiscountReads:
 *   student      the same column (first_paid_at), from the students read
 *   lessons      the same rows and columns (LESSON_COLUMNS, by sort_order)
 *   videos       the same rows and columns (VIDEO_COLUMNS), by lesson_id
 *   completions  their rows on the lessons the offer asks for;
 *                loadDiscountReads reads every lesson, and no other lesson
 *                can change the rule's answer
 *   requests     every request of theirs, whatever its date or status
 *                (REQUEST_COLUMNS), by id; loadDiscountReads has no order,
 *                and the rule sorts them by date itself
 *
 * Every read is in pages of 1000 (fetchAllRowsPaginated), ordered on a unique
 * key: PostgREST answers at most about 1000 rows, and pages read without a
 * stable order can repeat some rows and skip others. Lists of ids go in
 * batches of 100 (`.in()`), to keep the URL short.
 *
 * ONE SNAPSHOT PER STUDENT. Pages read by offset are separate queries: a row
 * deleted while they are read shifts the later pages up, and one row of
 * another student is never read. The completions are the read that is both
 * long and written to while the page loads (skip-lesson, toggle-lesson and
 * mark-action-shipped delete rows), so each read of completions holds only as
 * many students as fit in one page (a student has at most one row per lesson,
 * unique(student_id, lesson_id)): every read is a single query. The pending
 * and the approved requests are two reads; the approved ones are read after
 * the pending ones, so a request approved in between is on both (and kept
 * once, as approved) and never on neither.
 *
 * A read that fails is never an empty list. A failed read the rule needs (the
 * catalog, the videos, a batch of completions or of requests) becomes that
 * read's `{ data: null, error }` for every student it covers, so the rule
 * refuses to judge them exactly as it would refuse one student
 * (factsFromReads). The stored coupons are the same: a failed read is
 * `coupons: { data: null, error }`, and the page says it could not read them
 * (the approve route asks Whop itself). Any other failed read (the listed
 * requests, their events and the students holding them, the team's names,
 * the Whop sync) fails the whole load, so the page shows an error instead of
 * a list with people missing.
 *
 * Server only, but for readNeedsHand. lesson_videos is readable by the
 * service role alone: any other client sees no videos and no error, and the
 * rule would then close the offer for everyone. Hand loadThirtyData the
 * service-role client requireTeam gives a route. readNeedsHand reads only
 * discount_requests and discount_request_events, which the team's own session
 * reads too (their RLS policies), so the Dashboard runs it in the browser.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { LESSONS_TABLE } from "@/lib/catalog-tables";
import { newReadContext, readMembershipDiscount, rowOf } from "@/lib/membership-discount";
import type { MembershipReadFail } from "@/lib/membership-discount";
import { fetchAllRowsPaginated } from "@/lib/supabase-pagination";
import { DISCOUNT_ELIGIBLE_FROM, requiredLessons } from "@/lib/world/discount";
import type { DiscountRequestRow } from "@/lib/world/discount";
import { LESSON_COLUMNS, REQUEST_COLUMNS, VIDEO_COLUMNS, toDiscountLessons } from "@/lib/world/discount-server";
import type { CatalogLessonRow, CompletionRow, DiscountReads, Read, VideoRow } from "@/lib/world/discount-server";

/** A student as the 30% page shows them. */
export interface ThirtyStudent {
  id: string;
  name: string | null;
  email: string | null;
  /**
   * Shown as @username: the student's Whop username after every Whop sign-in and every payment (the login and the
   * webhook write it), their Discord one only once the 2-hour sync wrote it since. The page's Copy username copies it.
   */
  discord_username: string | null;
  /** The student's Discord user id (the login writes it, the Whop sync fills an empty one): the page's Copy Discord ID copies it (2026-10-26). */
  discord_user_id: string | null;
  membership_status: string;
  first_paid_at: string | null;
  /** The membership a stored coupon must have been read from (membership-discount.ts storedRowApplies). */
  whop_membership_id: string | null;
}
export const STUDENT_COLUMNS =
  "id, name, email, discord_username, discord_user_id, membership_status, first_paid_at, whop_membership_id";

/** A listed request: what the rule reads, plus whose it is and who decided it. */
export interface ThirtyRequest extends DiscountRequestRow {
  student_id: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  applied_at: string | null;
  applied_by: string | null;
  /**
   * The Whop promo id of the request's 30% code, stored once Whop made it. A
   * coupon with this id on the membership is the request's own code: never
   * warned about (the render review's fix round). A pending request holding a
   * code name with no id is a claim (thirty-apply.ts): its code may exist.
   */
  whop_promo_id?: string | null;
}
export const LISTED_REQUEST_COLUMNS = `${REQUEST_COLUMNS}, student_id, reviewed_at, reviewed_by, applied_at, applied_by, whop_promo_id`;

/** A pending or approved request is listed once the student applied this long ago (R4): the app's own tries come first. */
export const NEEDS_HAND_AFTER_MS = 30 * 60_000;
/** A request whose newest event is a write_failed stays listed this long after it, whatever its status (R4). */
export const WRITE_FAILED_LISTED_MS = 30 * 86_400_000;

/**
 * A listed request's newest failed attempt: an attempt_failed event of v116's
 * history (discount_request_events), as written by the shared step
 * (thirty-apply.ts) or the job. `detail` holds the step, Whop's words, the
 * membership's status, the code, the product and, for a code attached after
 * a reject, whether Whop showed it attached.
 */
export interface ThirtyFailureEvent {
  request_id: string;
  reason: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
  /** How many attempt_failed events the request has, this one included (loadThirtyData sets it; a row as read has none). */
  count?: number;
}
export const FAILURE_EVENT_COLUMNS = "request_id, reason, detail, created_at, id";

/** The requests that need a hand (readNeedsHand), or the reads that failed. */
export type NeedsHandRead = { ok: true; requests: ThirtyRequest[] } | { ok: false; failed: string[] };

/** A completion on a lesson the offer asks for. */
export interface ThirtyCompletion {
  student_id: string;
  lesson_id: string;
  completed_at: string | null;
}
export const COMPLETION_COLUMNS = "student_id, lesson_id, completed_at";

/** A row of student_membership_discounts (v111), as the cron or a discount route stored it. */
export interface ThirtyCouponRow {
  student_id: string;
  whop_membership_id: string | null;
  promo_code_id: string | null;
  promo_code: string | null;
  renewal_price: number | string | null;
  plan_renewal_price: number | string | null;
  discounted: boolean;
  checked_at: string;
}
export const COUPON_COLUMNS =
  "student_id, whop_membership_id, promo_code_id, promo_code, renewal_price, plan_renewal_price, discounted, checked_at";

export interface ThirtyData {
  /** The catalog in course order. Every student's `lessons` read is this one. */
  catalog: Read<CatalogLessonRow[]>;
  /** lesson_videos (lesson_id and created_at only). Every student's `videos` read is this one. */
  videos: Read<VideoRow[]>;
  /** Every student holding a listed request, by id. */
  students: ThirtyStudent[];
  /** Per student id: the five reads loadDiscountReads would have made for them. */
  reads: Map<string, DiscountReads>;
  /** The listed requests, the ones that need a hand (readNeedsHand), by id. */
  requests: ThirtyRequest[];
  /** Per listed request id: its newest attempt_failed event; absent when it has none. */
  failures: Map<string, ThirtyFailureEvent>;
  /** Per team member id: their name (team_members.full_name). */
  team: Map<string, string>;
  /** Per student id: the last Whop backfill (student_whop_sync.last_sync_at), absent when none ran. */
  lastSyncAt: Map<string, string | null>;
  /** Per student id: their stored coupon row, when there is one; null data when the read failed. */
  coupons: Read<Map<string, ThirtyCouponRow>>;
}

export type ThirtyLoad = { ok: true; data: ThirtyData } | { ok: false; failed: string[] };

/**
 * What Whop says now about the membership of a student with an approved
 * request: the coupon the 30% code would replace on it (admin rebuild 2,
 * the review's fix round). The cron leaves those students out (D5's
 * population), and no route reads them again after the approval, so a
 * request approved before the coupon rule never had a stored row: the page
 * asks Whop for them itself, a handful each load. `fail` is why Whop said
 * nothing: a MembershipReadFail, or no membership id, or no API key.
 */
export type LiveCoupon = { ok: true; row: ThirtyCouponRow } | { ok: false; fail: MembershipReadFail | "no_membership" };

/** The live reads' limits, the request routes' own: no Whop request starts after 6 s, none is waited on past 8 s. */
const LIVE_START_BUDGET_MS = 6_000;
const LIVE_ANSWER_BUDGET_MS = 8_000;

/**
 * Whop now, for each student holding an approved request (readMembershipDiscount,
 * pinned and paced as the cron reads). Never throws; writes nothing: the
 * page shows the answer, and the request routes and the cron keep their own
 * rows. Without an API key every answer is { ok: false, fail: "no_api_key" }.
 */
export async function readApprovedCoupons(
  data: Pick<ThirtyData, "requests" | "students">,
  apiKey: string | null,
  nowMs: number = Date.now(),
): Promise<Map<string, LiveCoupon>> {
  const out = new Map<string, LiveCoupon>();
  const holders = new Set(data.requests.filter((r) => r.status === "approved").map((r) => r.student_id));
  const students = data.students.filter((s) => holders.has(s.id));
  if (students.length === 0) return out;
  const ctx = newReadContext(apiKey ?? "", nowMs + LIVE_START_BUDGET_MS, nowMs + LIVE_ANSWER_BUDGET_MS);
  for (const s of students) {
    if (!s.whop_membership_id) {
      out.set(s.id, { ok: false, fail: "no_membership" });
      continue;
    }
    try {
      const r = await readMembershipDiscount(s.whop_membership_id, ctx);
      out.set(s.id, r.ok ? { ok: true, row: rowOf(s.id, r.membership, new Date().toISOString()) } : { ok: false, fail: r.fail });
    } catch {
      out.set(s.id, { ok: false, fail: "network" });
    }
  }
  return out;
}

const BATCH = 100;
/** The most rows PostgREST answers for one query (max-rows on Supabase). */
const PAGE_ROWS = 1000;

/** One read in pages: every row, or the error and no rows. */
async function paged<T>(build: () => unknown): Promise<Read<T[]>> {
  const r = await fetchAllRowsPaginated<T>(build);
  return r.error ? { data: null, error: { message: r.error.message } } : { data: r.data, error: null };
}

function batches<T>(items: readonly T[], size = BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * One read per batch of ids (100, or `size`), each in pages, all at once.
 * Each id is handed the answer of the batch it was in, so a failed batch is
 * a failed read for exactly the ids it covered.
 */
async function byBatch<T>(
  ids: readonly string[],
  build: (batch: string[]) => unknown,
  size = BATCH,
): Promise<Map<string, Read<T[]>>> {
  const parts = batches(ids, size);
  const results = await Promise.all(parts.map((batch) => paged<T>(() => build(batch))));
  const out = new Map<string, Read<T[]>>();
  parts.forEach((batch, i) => {
    for (const id of batch) out.set(id, results[i]);
  });
  return out;
}

/** Rows of a read grouped by one of their columns. */
function groupBy<T>(rows: readonly T[], key: (r: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = out.get(k);
    if (list) list.push(r);
    else out.set(k, [r]);
  }
  return out;
}

const failure = (name: string, r: Read<unknown>) => `${name}: ${r.error?.message ?? "no data"}`;
const byIdOrder = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** An event as the write_failed read needs it: its request, kind and reason, and its place in time (created_at, then id). */
type EventStamp = { request_id: string; event: string; reason: string | null; created_at: string; id: number };

/** The newer of two events: the later created_at, the higher id on a tie (v116's identity, given in insert order). */
function newerOf(a: EventStamp, b: EventStamp): EventStamp {
  const ta = Date.parse(a.created_at);
  const tb = Date.parse(b.created_at);
  if (ta !== tb) return ta > tb ? a : b;
  return a.id >= b.id ? a : b;
}

/**
 * The requests that need a hand at `nowMs` (the header's THE LIST): the
 * pending ones made from 1 October at least 30 minutes ago, then the approved
 * ones (read after the pending ones, so a request approved in between is on
 * both and kept once, as approved, never on neither), and every request whose
 * newest event is a write_failed from the last 30 days. Each request once, by
 * id. The 30% page lists exactly these; the Dashboard's "30% needs a hand"
 * counts them. A read that fails is a failure, never fewer rows.
 */
export async function readNeedsHand(db: SupabaseClient, nowMs: number = Date.now()): Promise<NeedsHandRead> {
  const madeBy = new Date(nowMs - NEEDS_HAND_AFTER_MS).toISOString();
  const waiting = (status: "pending" | "approved") =>
    paged<ThirtyRequest>(() =>
      db
        .from("discount_requests")
        .select(LISTED_REQUEST_COLUMNS)
        .eq("status", status)
        .gte("created_at", DISCOUNT_ELIGIBLE_FROM)
        .lte("created_at", madeBy)
        .order("id"),
    );
  const pendingRead = waiting("pending");
  const approvedRead = pendingRead.then(() => waiting("approved"));
  const [pending, approved, wrote] = await Promise.all([pendingRead, approvedRead, readWriteFailed(db, nowMs)]);
  const failed: string[] = [];
  if (!pending.data) failed.push(failure("discount_requests (pending)", pending));
  if (!approved.data) failed.push(failure("discount_requests (approved)", approved));
  if (!wrote.ok) failed.push(...wrote.failed);
  if (failed.length) return { ok: false, failed };

  // One row per request: an approved row read after its pending one is the newer, a write_failed row is as read.
  const byRequest = new Map<string, ThirtyRequest>();
  for (const r of [...pending.data!, ...approved.data!, ...(wrote.ok ? wrote.requests : [])]) byRequest.set(r.id, r);
  return { ok: true, requests: [...byRequest.values()].sort(byIdOrder) };
}

/**
 * The requests whose newest event is a write_failed from the last 30 days:
 * the write_failed events of those days, then every event of their requests
 * from the same days (an event newer than the write_failed is among them),
 * then the requests whose newest is the write_failed itself.
 */
async function readWriteFailed(db: SupabaseClient, nowMs: number): Promise<NeedsHandRead> {
  const since = new Date(nowMs - WRITE_FAILED_LISTED_MS).toISOString();
  const wrote = await paged<{ request_id: string }>(() =>
    db
      .from("discount_request_events")
      .select("request_id, id")
      .eq("event", "attempt_failed")
      .eq("reason", "write_failed")
      .gte("created_at", since)
      .order("id"),
  );
  if (!wrote.data) return { ok: false, failed: [failure("discount_request_events (write_failed)", wrote)] };
  const candidates = [...new Set(wrote.data.map((e) => e.request_id))].sort();
  if (candidates.length === 0) return { ok: true, requests: [] };

  const events = await byBatch<EventStamp>(candidates, (batch) =>
    db
      .from("discount_request_events")
      .select("request_id, event, reason, created_at, id")
      .in("request_id", batch)
      .gte("created_at", since)
      .order("id"),
  );
  const newest = new Map<string, EventStamp>();
  for (const id of candidates) {
    const read = events.get(id)!;
    if (!read.data) return { ok: false, failed: [failure("discount_request_events (the newest of a write_failed request)", read)] };
    for (const e of read.data) {
      if (e.request_id !== id) continue;
      const had = newest.get(id);
      newest.set(id, had ? newerOf(had, e) : e);
    }
  }
  const listed = candidates.filter((id) => {
    const e = newest.get(id);
    return e !== undefined && e.event === "attempt_failed" && e.reason === "write_failed";
  });
  if (listed.length === 0) return { ok: true, requests: [] };

  const rows = await byBatch<ThirtyRequest>(listed, (batch) =>
    db.from("discount_requests").select(LISTED_REQUEST_COLUMNS).in("id", batch).order("id"),
  );
  const requests = new Map<string, ThirtyRequest>();
  for (const id of listed) {
    const read = rows.get(id)!;
    if (!read.data) return { ok: false, failed: [failure("discount_requests (with a write_failed)", read)] };
    for (const r of read.data) requests.set(r.id, r);
  }
  return { ok: true, requests: [...requests.values()] };
}

export async function loadThirtyData(db: SupabaseClient, nowMs: number = Date.now()): Promise<ThirtyLoad> {
  // Everything that does not depend on who is listed, at once.
  const [catalog, videos, listedRead, team] = await Promise.all([
    paged<CatalogLessonRow>(() => db.from(LESSONS_TABLE).select(LESSON_COLUMNS).order("sort_order").order("id")),
    paged<VideoRow>(() => db.from("lesson_videos").select(VIDEO_COLUMNS).order("lesson_id")),
    readNeedsHand(db, nowMs),
    paged<{ id: string; full_name: string | null }>(() => db.from("team_members").select("id, full_name").order("id")),
  ]);
  if (!listedRead.ok || !team.data) {
    return {
      ok: false,
      failed: [...(listedRead.ok ? [] : listedRead.failed), ...(team.data ? [] : [failure("team_members", team)])],
    };
  }
  const requests = listedRead.requests;

  // Each listed request's newest failed attempt (the Why line's facts): newest first, so a request's first row is its newest.
  const failureReads = await byBatch<ThirtyFailureEvent>(
    requests.map((r) => r.id),
    (batch) =>
      db
        .from("discount_request_events")
        .select(FAILURE_EVENT_COLUMNS)
        .eq("event", "attempt_failed")
        .in("request_id", batch)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false }),
  );
  const failures = new Map<string, ThirtyFailureEvent>();
  const groupedFailures = new Map<Read<ThirtyFailureEvent[]>, Map<string, ThirtyFailureEvent[]>>();
  for (const r of requests) {
    const read = failureReads.get(r.id)!;
    if (!read.data) return { ok: false, failed: [failure("discount_request_events (attempt_failed)", read)] };
    let byRequest = groupedFailures.get(read);
    if (!byRequest) groupedFailures.set(read, (byRequest = groupBy(read.data, (e) => e.request_id)));
    const mine = byRequest.get(r.id) ?? [];
    const newest = mine[0];
    if (newest) {
      // With how many failed: the job stops on some failures after JOB_GIVES_UP_AFTER, and the Why line says so.
      failures.set(r.id, { request_id: newest.request_id, reason: newest.reason ?? null, detail: newest.detail ?? null, created_at: newest.created_at, count: mine.length });
    }
  }

  // The students holding a listed request.
  const holderIds = [...new Set(requests.map((r) => r.student_id))].sort();
  let students: ThirtyStudent[] = [];
  if (holderIds.length) {
    const read = await Promise.all(
      batches(holderIds).map((batch) =>
        paged<ThirtyStudent>(() => db.from("students").select(STUDENT_COLUMNS).in("id", batch).order("id")),
      ),
    );
    const bad = read.find((r) => !r.data);
    if (bad) return { ok: false, failed: [failure("students (holding a listed request)", bad)] };
    // Each student once, whatever a read handed back twice.
    students = [...new Map(read.flatMap((r) => r.data!).map((s) => [s.id, s] as const)).values()].sort(byIdOrder);
    const found = new Set(students.map((s) => s.id));
    const missing = holderIds.filter((id) => !found.has(id));
    if (missing.length) {
      return { ok: false, failed: [`students: ${missing.length} student(s) holding a listed request could not be found`] };
    }
  }
  const ids = students.map((s) => s.id);

  // The lessons whose completions matter: those the offer asks for, by the
  // catalog and the videos as they stand (the approval asks for no lesson
  // outside them). Without the catalog or the videos the rule cannot judge
  // anyone, so no completion is read.
  const lessonIds =
    catalog.data && videos.data
      ? requiredLessons(toDiscountLessons(catalog.data, new Set(videos.data.map((v) => v.lesson_id)))).map((l) => l.id).sort()
      : null;
  // Students per read of completions: as many as fit in one page, so each read
  // is one query (the header says why). 61 lessons today: 16 students a read.
  const perRead =
    lessonIds && lessonIds.length ? Math.max(1, Math.min(BATCH, Math.floor((PAGE_ROWS - 1) / lessonIds.length))) : BATCH;

  const [completionReads, requestReads, syncReads, couponReads] = await Promise.all([
    lessonIds && lessonIds.length
      ? byBatch<ThirtyCompletion>(
          ids,
          (batch) =>
            db
              .from("student_lesson_completions")
              .select(COMPLETION_COLUMNS)
              .in("student_id", batch)
              .in("lesson_id", lessonIds)
              .order("student_id")
              .order("lesson_id"),
          perRead,
        )
      : Promise.resolve(null),
    byBatch<DiscountRequestRow & { student_id: string }>(ids, (batch) =>
      db.from("discount_requests").select(`${REQUEST_COLUMNS}, student_id`).in("student_id", batch).order("id"),
    ),
    Promise.all(
      batches(ids).map((batch) =>
        paged<{ student_id: string; last_sync_at: string | null }>(() =>
          db.from("student_whop_sync").select("student_id, last_sync_at").in("student_id", batch).order("student_id"),
        ),
      ),
    ),
    Promise.all(
      batches(ids).map((batch) =>
        paged<ThirtyCouponRow>(() =>
          db.from("student_membership_discounts").select(COUPON_COLUMNS).in("student_id", batch).order("student_id"),
        ),
      ),
    ),
  ]);
  const badSync = syncReads.find((r) => !r.data);
  if (badSync) return { ok: false, failed: [failure("student_whop_sync", badSync)] };

  // Every student's five reads. Each completion and request is cut down to
  // the columns loadDiscountReads selects.
  const notRead: Read<never> = {
    data: null,
    error: { message: "not read: without the catalog and lesson_videos there are no lessons to read completions for" },
  };
  const reads = new Map<string, DiscountReads>();
  const grouped = new Map<Read<ThirtyCompletion[]>, Map<string, ThirtyCompletion[]>>();
  const groupedRequests = new Map<Read<Array<DiscountRequestRow & { student_id: string }>>, Map<string, DiscountRequestRow[]>>();
  for (const s of students) {
    let mine: Read<ThirtyCompletion[]>;
    if (completionReads === null) {
      // No lesson to ask for: with the catalog and the videos read, the
      // course has no lesson up to a gate, and every student has no
      // completion that matters. Without them, nothing was read.
      mine = lessonIds ? { data: [], error: null } : notRead;
    } else {
      const batch = completionReads.get(s.id)!;
      if (batch.data) {
        let byStudent = grouped.get(batch);
        if (!byStudent) grouped.set(batch, (byStudent = groupBy(batch.data, (c) => c.student_id)));
        mine = { data: byStudent.get(s.id) ?? [], error: null };
      } else {
        mine = { data: null, error: batch.error };
      }
    }

    const reqBatch = requestReads.get(s.id)!;
    let myRequests: Read<DiscountRequestRow[]>;
    if (reqBatch.data) {
      let byStudent = groupedRequests.get(reqBatch);
      if (!byStudent) {
        byStudent = groupBy(reqBatch.data, (r) => r.student_id) as Map<string, DiscountRequestRow[]>;
        groupedRequests.set(reqBatch, byStudent);
      }
      myRequests = {
        data: (byStudent.get(s.id) ?? []).map((r) => ({
          id: r.id,
          status: r.status,
          created_at: r.created_at,
          promo_code: r.promo_code ?? null,
          rejection_reason: r.rejection_reason ?? null,
        })),
        error: null,
      };
    } else {
      myRequests = { data: null, error: reqBatch.error };
    }

    reads.set(s.id, {
      student: { data: { first_paid_at: s.first_paid_at ?? null }, error: null },
      lessons: catalog.data ? { data: catalog.data, error: null } : { data: null, error: catalog.error },
      videos: videos.data ? { data: videos.data, error: null } : { data: null, error: videos.error },
      completions: mine.data
        ? { data: mine.data.map((c): CompletionRow => ({ lesson_id: c.lesson_id, completed_at: c.completed_at })), error: null }
        : { data: null, error: mine.error },
      requests: myRequests,
    });
  }

  const lastSyncAt = new Map<string, string | null>();
  for (const r of syncReads) for (const row of r.data!) lastSyncAt.set(row.student_id, row.last_sync_at ?? null);

  const badCoupons = couponReads.find((r) => !r.data);
  const coupons: Read<Map<string, ThirtyCouponRow>> = badCoupons
    ? { data: null, error: badCoupons.error }
    : { data: new Map(couponReads.flatMap((r) => r.data!).map((c) => [c.student_id, c] as const)), error: null };

  return {
    ok: true,
    data: {
      catalog,
      videos,
      students,
      reads,
      requests,
      failures,
      team: new Map(team.data.map((m) => [m.id, m.full_name ?? ""] as const)),
      lastSyncAt,
      coupons,
    },
  };
}
