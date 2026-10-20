/**
 * The 30% for every student at once: the reads behind the admin's 30% page
 * (GET /api/admin/thirty) and the 30% reasons on Today.
 *
 * The student app judges one student from five reads (loadDiscountReads in
 * discount-server.ts). Five reads for each of about 300 students would be
 * 1,500 round trips, so this file makes each read once for everyone and hands
 * every student the DiscountReads object loadDiscountReads would have made
 * for them. The rule itself (discount.ts and the pure half of
 * discount-server.ts) is called unchanged by thirty-view.ts, and
 * client-tests/thirty-view.test.mjs runs every fixture both ways.
 *
 * What each student gets, against loadDiscountReads:
 *   student      the same column (first_paid_at), from the students read
 *   lessons      the same rows and columns (LESSON_COLUMNS, by sort_order)
 *   videos       the same rows and columns (VIDEO_COLUMNS), by lesson_id
 *   completions  their rows on the lessons the offer asks for and on the
 *                action items; loadDiscountReads reads every lesson, and no
 *                other lesson can change the rule's answer
 *   requests     every request of theirs, whatever its date or status
 *                (REQUEST_COLUMNS), by id; loadDiscountReads has no order,
 *                and the rule sorts them by date itself
 *
 * Every read is in pages of 1000 (fetchAllRowsPaginated), ordered on a unique
 * key: PostgREST answers at most about 1000 rows, and pages read without a
 * stable order can repeat some rows and skip others. Lists of ids go in
 * batches of 100 (`.in()`), as outreach-insights.ts does, to keep the URL
 * short.
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
 * (factsFromReads). Any other failed read (who is in the offer, the listed
 * requests and the students holding them, the survey, the team's names, the
 * Whop sync, the last contacts, the open tasks in the Tasks queue) fails the
 * whole load, so the page shows an error instead of a list with people
 * missing.
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
import { canStillEarnCandidate } from "./thirty-view.ts";

/** A student as the 30% page shows them. */
export interface ThirtyStudent {
  id: string;
  name: string | null;
  email: string | null;
  discord_user_id: string | null;
  discord_username: string | null;
  whop_plan_id: string | null;
  membership_status: string;
  csm_exempt: boolean | null;
  ad_submissions_verified: boolean | null;
  first_paid_at: string | null;
}
export const STUDENT_COLUMNS =
  "id, name, email, discord_user_id, discord_username, whop_plan_id, membership_status, csm_exempt, ad_submissions_verified, first_paid_at";

/** A catalog lesson: what the rule reads, plus its title and whether it is an action item. */
export interface ThirtyLesson extends CatalogLessonRow {
  title: string | null;
  requires_action: boolean | null;
}
export const CATALOG_COLUMNS = `${LESSON_COLUMNS}, title, requires_action`;

/** A listed request: what the rule reads, plus whose it is and who decided it. */
export interface ThirtyRequest extends DiscountRequestRow {
  student_id: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  applied_at: string | null;
  applied_by: string | null;
}
export const LISTED_REQUEST_COLUMNS = `${REQUEST_COLUMNS}, student_id, reviewed_at, reviewed_by, applied_at, applied_by`;

/** A completion on a lesson the offer asks for, or on an action item. */
export interface ThirtyCompletion {
  student_id: string;
  lesson_id: string;
  completed_at: string | null;
  action_completed_at: string | null;
  skipped_at: string | null;
  discord_message_link: string | null;
}
export const COMPLETION_COLUMNS =
  "student_id, lesson_id, completed_at, action_completed_at, skipped_at, discord_message_link";

/** A survey question (discount_feedback_questions, v29). Its type says which answer column holds the answer. */
export interface ThirtyQuestion {
  id: string;
  order_num: number;
  question_text: string;
  question_type: string;
}

/** A survey answer (discount_feedback_responses, v29). */
export interface ThirtyAnswer {
  id: string;
  discount_request_id: string;
  question_id: string;
  answer_scale: number | null;
  answer_choice: string | null;
  answer_text: string | null;
}

/** A completed task: a message the team sent, from Today or from the Tasks queue. */
export interface ThirtyContact {
  student_id: string;
  scenario_id: string;
  completed_at: string | null;
  completed_by: string | null;
  outcome: string | null;
}

/**
 * An open task in the Tasks queue of a member who can still earn the 30%.
 * Mark messaged on the 30% page closes it with the same actor and moment, as
 * Today's mark does, so Tasks and Today never disagree about the student.
 */
export interface ThirtyOpenTask {
  id: string;
  student_id: string;
  scenario_id: string;
  template_id: string | null;
  behavior_summary: string | null;
  created_at: string;
}
export const OPEN_TASK_COLUMNS = "id, student_id, scenario_id, template_id, behavior_summary, created_at";

export interface ThirtyData {
  /** The catalog in course order, with titles and the action flag. Every student's `lessons` read is this one. */
  catalog: Read<ThirtyLesson[]>;
  /** lesson_videos (lesson_id and created_at only). Every student's `videos` read is this one. */
  videos: Read<VideoRow[]>;
  /** Every student with a first payment from DISCOUNT_ELIGIBLE_FROM, any status, plan or flag, and every student holding a listed request, by id. */
  students: ThirtyStudent[];
  /** Per student id: the five reads loadDiscountReads would have made for them. */
  reads: Map<string, DiscountReads>;
  /** Per student id: their completions on the lessons the offer asks for and on the action items, or null where that read failed. */
  completions: Map<string, ThirtyCompletion[] | null>;
  /** The listed requests: every pending one and every approved one, whatever their date, and the rest made from DISCOUNT_ELIGIBLE_FROM on, by id. */
  requests: ThirtyRequest[];
  /** The survey's questions, by order. */
  questions: ThirtyQuestion[];
  /** Per listed request id: its survey answers. */
  answers: Map<string, ThirtyAnswer[]>;
  /** Per team member id: their name (team_members.full_name). */
  team: Map<string, string>;
  /** Per student id: the last Whop backfill (student_whop_sync.last_sync_at), absent when none ran. */
  lastSyncAt: Map<string, string | null>;
  /** Per student id, for those who can still earn it (in the offer, active or past due, not exempt): their completed tasks. */
  contacts: Map<string, ThirtyContact[]>;
  /** Per student id, for the same members: their open tasks in the Tasks queue (never a support record, which is never open). */
  openTasks: Map<string, ThirtyOpenTask[]>;
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

export async function loadThirtyData(db: SupabaseClient): Promise<ThirtyLoad> {
  // The pending requests, then the decided ones: a request decided in between
  // is on both lists (kept once below, as decided), never on neither. The
  // decided ones are those made from DISCOUNT_ELIGIBLE_FROM on, plus every
  // approved one made before it: an approved request whose code was never
  // added in Whop must stay on the Approved tab whatever its date. Both
  // decided reads start after the pending one, so the later read wins.
  const pendingRead = paged<ThirtyRequest>(() =>
    db.from("discount_requests").select(LISTED_REQUEST_COLUMNS).eq("status", "pending").order("id"),
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
  const oldApprovedRead = pendingRead.then(() =>
    paged<ThirtyRequest>(() =>
      db
        .from("discount_requests")
        .select(LISTED_REQUEST_COLUMNS)
        .eq("status", "approved")
        .lt("created_at", DISCOUNT_ELIGIBLE_FROM)
        .order("id"),
    ),
  );
  // Everything that does not depend on who is listed, at once.
  const [catalog, videos, pending, decided, oldApproved, offer, questions, team] = await Promise.all([
    paged<ThirtyLesson>(() => db.from(LESSONS_TABLE).select(CATALOG_COLUMNS).order("sort_order").order("id")),
    paged<VideoRow>(() => db.from("lesson_videos").select(VIDEO_COLUMNS).order("lesson_id")),
    pendingRead,
    decidedRead,
    oldApprovedRead,
    paged<ThirtyStudent>(() =>
      db.from("students").select(STUDENT_COLUMNS).gte("first_paid_at", DISCOUNT_ELIGIBLE_FROM).order("id"),
    ),
    paged<ThirtyQuestion>(() =>
      db
        .from("discount_feedback_questions")
        .select("id, order_num, question_text, question_type")
        .order("order_num")
        .order("id"),
    ),
    paged<{ id: string; full_name: string | null }>(() => db.from("team_members").select("id, full_name").order("id")),
  ]);
  const failed: string[] = [];
  if (!pending.data) failed.push(failure("discount_requests (pending)", pending));
  if (!decided.data) failed.push(failure("discount_requests (decided)", decided));
  if (!oldApproved.data) failed.push(failure("discount_requests (approved before the offer)", oldApproved));
  if (!offer.data) failed.push(failure("students (first payment from 1 October)", offer));
  if (!questions.data) failed.push(failure("discount_feedback_questions", questions));
  if (!team.data) failed.push(failure("team_members", team));
  if (failed.length) return { ok: false, failed };

  // One row per request. A request decided between the two reads is on both,
  // and its decided row, read second, is the newer.
  const byRequest = new Map<string, ThirtyRequest>();
  for (const r of pending.data!) byRequest.set(r.id, r);
  for (const r of decided.data!) byRequest.set(r.id, r);
  for (const r of oldApproved.data!) byRequest.set(r.id, r);
  const requests = [...byRequest.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // The students holding a listed request who are not in the offer (a first
  // payment before 1 October, or none on file).
  const inOffer = new Set(offer.data!.map((s) => s.id));
  const holderIds = [...new Set(requests.map((r) => r.student_id))].filter((id) => !inOffer.has(id)).sort();
  let holders: ThirtyStudent[] = [];
  if (holderIds.length) {
    const read = await Promise.all(
      batches(holderIds).map((batch) =>
        paged<ThirtyStudent>(() => db.from("students").select(STUDENT_COLUMNS).in("id", batch).order("id")),
      ),
    );
    const bad = read.find((r) => !r.data);
    if (bad) return { ok: false, failed: [failure("students (holding a listed request)", bad)] };
    holders = read.flatMap((r) => r.data!);
    const found = new Set(holders.map((s) => s.id));
    const missing = holderIds.filter((id) => !found.has(id));
    if (missing.length) {
      return { ok: false, failed: [`students: ${missing.length} student(s) holding a listed request could not be found`] };
    }
  }
  // Each student once, whatever a read handed back twice.
  const students = [...new Map([...offer.data!, ...holders].map((s) => [s.id, s] as const)).values()].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  const ids = students.map((s) => s.id);

  // The lessons whose completions matter: those the offer asks for, by the
  // catalog and the videos as they stand (the approval asks for no lesson
  // outside them), and the action items, whose hand-ins the page shows.
  // Without the catalog or the videos the rule cannot judge anyone, so no
  // completion is read.
  const actionIds = (catalog.data ?? []).filter((l) => l.requires_action === true || l.type === "action").map((l) => l.id);
  const asked =
    catalog.data && videos.data
      ? requiredLessons(toDiscountLessons(catalog.data, new Set(videos.data.map((v) => v.lesson_id)))).map((l) => l.id)
      : null;
  const lessonIds = asked ? [...new Set([...asked, ...actionIds])].sort() : null;
  // Students per read of completions: as many as fit in one page, so each read
  // is one query (the header says why). 69 lessons today: 14 students a read.
  const perRead =
    lessonIds && lessonIds.length ? Math.max(1, Math.min(BATCH, BATCH)) : BATCH;

  // The last contact and the open tasks are shown on Can still earn rows only.
  const contactIds = students.filter(canStillEarnCandidate).map((s) => s.id);
  const requestIds = requests.map((r) => r.id);

  const [completionReads, requestReads, syncReads, answerReads, contactReads, openReads] = await Promise.all([
    lessonIds && lessonIds.length
      ? byBatch<ThirtyCompletion>(
          ids,
          (batch) =>
            db
              .from("student_lesson_completions")
              .select(COMPLETION_COLUMNS)
              .in("student_id", batch)
              .in("lesson_id", lessonIds)
              .order("student_id"),
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
      batches(requestIds).map((batch) =>
        paged<ThirtyAnswer>(() =>
          db
            .from("discount_feedback_responses")
            .select("id, discount_request_id, question_id, answer_scale, answer_choice, answer_text")
            .in("discount_request_id", batch)
            .order("id"),
        ),
      ),
    ),
    Promise.all(
      batches(contactIds).map((batch) =>
        paged<ThirtyContact>(() =>
          db
            .from("tasks")
            .select("student_id, scenario_id, completed_at, completed_by, outcome")
            .in("student_id", batch)
            .eq("status", "completed")
            .order("id"),
        ),
      ),
    ),
    Promise.all(
      batches(contactIds).map((batch) =>
        paged<ThirtyOpenTask>(() =>
          db.from("tasks").select(OPEN_TASK_COLUMNS).in("student_id", batch).eq("status", "open").order("id"),
        ),
      ),
    ),
  ]);
  for (const [name, list] of [
    ["student_whop_sync", syncReads],
    ["discount_feedback_responses", answerReads],
    ["tasks (completed)", contactReads],
    ["tasks (open)", openReads],
  ] as const) {
    const bad = list.find((r) => !r.data);
    if (bad) failed.push(failure(name, bad));
  }
  if (failed.length) return { ok: false, failed };

  // Every student's five reads. The catalog's extra columns are left out of
  // `lessons`, and each completion and request is cut down to the columns
  // loadDiscountReads selects.
  const lessonsRead: Read<CatalogLessonRow[]> = catalog.data
    ? {
        data: catalog.data.map((l) => ({
          id: l.id,
          type: l.type,
          counts_toward_progress: l.counts_toward_progress,
          is_gate: l.is_gate,
          duration_seconds: l.duration_seconds,
        })),
        error: null,
      }
    : { data: null, error: catalog.error };
  const notRead: Read<never> = {
    data: null,
    error: { message: "not read: without the catalog and lesson_videos there are no lessons to read completions for" },
  };
  const reads = new Map<string, DiscountReads>();
  const completions = new Map<string, ThirtyCompletion[] | null>();
  const grouped = new Map<Read<ThirtyCompletion[]>, Map<string, ThirtyCompletion[]>>();
  const groupedRequests = new Map<Read<Array<DiscountRequestRow & { student_id: string }>>, Map<string, DiscountRequestRow[]>>();
  for (const s of students) {
    let mine: Read<ThirtyCompletion[]>;
    if (completionReads === null) {
      // No lesson to ask for: with the catalog and the videos read, the
      // course has no lesson up to a gate and no action item, and every
      // student has no completion that matters. Without them, nothing was read.
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
    completions.set(s.id, mine.data);

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
      lessons: lessonsRead,
      videos: videos.data ? { data: videos.data, error: null } : { data: null, error: videos.error },
      completions: mine.data
        ? { data: mine.data.map((c): CompletionRow => ({ lesson_id: c.lesson_id, completed_at: c.completed_at })), error: null }
        : { data: null, error: mine.error },
      requests: myRequests,
    });
  }

  const lastSyncAt = new Map<string, string | null>();
  for (const r of syncReads) for (const row of r.data!) lastSyncAt.set(row.student_id, row.last_sync_at ?? null);

  return {
    ok: true,
    data: {
      catalog,
      videos,
      students,
      reads,
      completions,
      requests,
      questions: questions.data!,
      answers: groupBy(answerReads.flatMap((r) => r.data!), (a) => a.discount_request_id),
      team: new Map(team.data!.map((m) => [m.id, m.full_name ?? ""] as const)),
      lastSyncAt,
      contacts: groupBy(contactReads.flatMap((r) => r.data!), (c) => c.student_id),
      // A support record (support.*, no template) is never open; one would not be a queue task.
      openTasks: groupBy(
        openReads.flatMap((r) => r.data!).filter((t) => !(t.scenario_id.startsWith("support.") && t.template_id == null)),
        (t) => t.student_id,
      ),
    },
  };
}
