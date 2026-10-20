/**
 * The reads behind the admin's 30% page (GET /api/admin/thirty): every
 * request for the 30% made from 1 October (DISCOUNT_ELIGIBLE_FROM), the
 * students holding them, the rule's reads for each of those students, and
 * the coupons stored for them (admin rebuild 2, D4 and D5). Older requests
 * stay in the database and are not listed.
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
 * and the decided requests are two reads; the decided ones are read after the
 * pending ones, so a request decided in between is on both (and kept once, as
 * decided) and never on neither.
 *
 * A read that fails is never an empty list. A failed read the rule needs (the
 * catalog, the videos, a batch of completions or of requests) becomes that
 * read's `{ data: null, error }` for every student it covers, so the rule
 * refuses to judge them exactly as it would refuse one student
 * (factsFromReads). The stored coupons are the same: a failed read is
 * `coupons: { data: null, error }`, and the page says it could not read them
 * (the approve route asks Whop itself). Any other failed read (the listed
 * requests and the students holding them, the team's names, the Whop sync)
 * fails the whole load, so the page shows an error instead of a list with
 * people missing.
 *
 * Server only. lesson_videos is readable by the service role alone: any other
 * client sees no videos and no error, and the rule would then close the offer
 * for everyone. Hand this the service-role client requireTeam gives a route.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { LESSONS_TABLE } from "./stub-server.ts";
import { fetchAllRowsPaginated } from "./supabase-pagination.ts";
import { DISCOUNT_ELIGIBLE_FROM, requiredLessons } from "./discount.ts";
import type { DiscountRequestRow } from "./discount.ts";
import { LESSON_COLUMNS, REQUEST_COLUMNS, VIDEO_COLUMNS, toDiscountLessons } from "./discount-server.ts";
import type { CatalogLessonRow, CompletionRow, DiscountReads, Read, VideoRow } from "./discount-server.ts";

/** A student as the 30% page shows them. */
export interface ThirtyStudent {
  id: string;
  name: string | null;
  email: string | null;
  /** Shown as @username; it can hold a Whop username. */
  discord_username: string | null;
  membership_status: string;
  first_paid_at: string | null;
  /** The membership a stored coupon must have been read from (membership-discount.ts storedRowApplies). */
  whop_membership_id: string | null;
}
export const STUDENT_COLUMNS = "id, name, email, discord_username, membership_status, first_paid_at, whop_membership_id";

/** A listed request: what the rule reads, plus whose it is and who decided it. */
export interface ThirtyRequest extends DiscountRequestRow {
  student_id: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  applied_at: string | null;
  applied_by: string | null;
}
export const LISTED_REQUEST_COLUMNS = `${REQUEST_COLUMNS}, student_id, reviewed_at, reviewed_by, applied_at, applied_by`;

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
  /** The listed requests: every one made from DISCOUNT_ELIGIBLE_FROM on, whatever its status, by id. */
  requests: ThirtyRequest[];
  /** Per team member id: their name (team_members.full_name). */
  team: Map<string, string>;
  /** Per student id: the last Whop backfill (student_whop_sync.last_sync_at), absent when none ran. */
  lastSyncAt: Map<string, string | null>;
  /** Per student id: their stored coupon row, when there is one; null data when the read failed. */
  coupons: Read<Map<string, ThirtyCouponRow>>;
}

export type ThirtyLoad = { ok: true; data: ThirtyData } | { ok: false; failed: string[] };

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

export async function loadThirtyData(db: SupabaseClient): Promise<ThirtyLoad> {
  // The pending requests, then the decided ones, both made from
  // DISCOUNT_ELIGIBLE_FROM on: a request decided in between is on both lists
  // (kept once below, as decided), never on neither.
  const pendingRead = paged<ThirtyRequest>(() =>
    db
      .from("discount_requests")
      .select(LISTED_REQUEST_COLUMNS)
      .eq("status", "pending")
      .gte("created_at", DISCOUNT_ELIGIBLE_FROM)
      .order("id"),
  );
  const decidedRead = pendingRead.then(() =>
    paged<ThirtyRequest>(() =>
      db
        .from("discount_requests")
        .select(LISTED_REQUEST_COLUMNS)
        .neq("status", "pending")
        .gte("created_at", DISCOUNT_ELIGIBLE_FROM)
        .order("id"),
    ),
  );
  // Everything that does not depend on who is listed, at once.
  const [catalog, videos, pending, decided, team] = await Promise.all([
    paged<CatalogLessonRow>(() => db.from(LESSONS_TABLE).select(LESSON_COLUMNS).order("sort_order").order("id")),
    paged<VideoRow>(() => db.from("lesson_videos").select(VIDEO_COLUMNS).order("lesson_id")),
    pendingRead,
    decidedRead,
    paged<{ id: string; full_name: string | null }>(() => db.from("team_members").select("id, full_name").order("id")),
  ]);
  const failed: string[] = [];
  if (!pending.data) failed.push(failure("discount_requests (pending)", pending));
  if (!decided.data) failed.push(failure("discount_requests (decided)", decided));
  if (!team.data) failed.push(failure("team_members", team));
  if (failed.length) return { ok: false, failed };

  // One row per request. A request decided between the two reads is on both,
  // and its decided row, read second, is the newer.
  const byRequest = new Map<string, ThirtyRequest>();
  for (const r of pending.data!) byRequest.set(r.id, r);
  for (const r of decided.data!) byRequest.set(r.id, r);
  const requests = [...byRequest.values()].sort(byIdOrder);

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
      team: new Map(team.data!.map((m) => [m.id, m.full_name ?? ""] as const)),
      lastSyncAt,
      coupons,
    },
  };
}
