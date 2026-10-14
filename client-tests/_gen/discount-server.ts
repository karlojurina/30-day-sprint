/**
 * The server half of the early-finish discount, for the new course.
 *
 * `discount.ts` decides where a student stands. This file feeds it from the
 * database and turns its answer into what a route sends back:
 *
 *   loadDiscountReads      the five reads, in parallel, never throwing
 *   factsFromReads         those reads as discount.ts's input, or which failed
 *   decideDiscountRequest  POST /api/discounts/request: grant only on `ready`
 *   approvalVerdict        POST /api/discounts/approve: was every video done
 *                          inside the 14 days
 *
 * Everything fails closed. A read that errors, or comes back empty where a
 * row must exist, means no request and no approval: a believable "you're not
 * ready" or "approved" built on half the data is the failure this project
 * keeps hitting, and an error is the outcome somebody notices.
 *
 * No React, no Next. Only the loader touches the database, through the client
 * it is handed, so the routes stay a thin shell around these functions.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DISCOUNT_LAUNCH_DATE,
  DISCOUNT_PERCENT,
  DISCOUNT_WINDOW_DAYS,
  discountEndsAt,
  discountState,
} from "./discount.ts";
import type { DiscountLesson, DiscountRequestRow, DiscountState } from "./discount.ts";

/** One catalog lesson as the loader selects it. */
export interface CatalogLessonRow {
  id: string;
  type: string;
  counts_toward_progress: boolean | null;
  is_gate: boolean | null;
  duration_seconds: number | null;
}

/** One `student_lesson_completions` row as the loader selects it. */
export interface CompletionRow {
  lesson_id: string;
  completed_at: string | null;
}

/** What a Supabase read hands back, reduced to the two fields read here. */
export interface Read<T> {
  data: T | null;
  error: { message: string } | null;
}

export interface DiscountReads {
  student: Read<{ first_paid_at: string | null }>;
  lessons: Read<CatalogLessonRow[]>;
  videos: Read<{ lesson_id: string }[]>;
  completions: Read<CompletionRow[]>;
  requests: Read<DiscountRequestRow[]>;
}

export interface DiscountFacts {
  firstPaidAt: string | null;
  lessons: DiscountLesson[];
  completions: CompletionRow[];
  requests: DiscountRequestRow[];
}

export const LESSON_COLUMNS = "id, type, counts_toward_progress, is_gate, duration_seconds";
export const REQUEST_COLUMNS = "id, status, created_at, promo_code, rejection_reason";

/**
 * The five reads the discount needs. `lessonsTable` is LESSONS_TABLE from
 * catalog-tables.ts, handed in so this file reads no environment.
 *
 * `lesson_videos` has row level security and no policy: only a service-role
 * client sees its rows. Any other client gets an empty list and no error, so
 * a route must hand this a service-role client. Only `lesson_id` is selected:
 * the row also carries the Tella id, which never leaves the server.
 */
export async function loadDiscountReads(
  db: SupabaseClient,
  studentId: string,
  lessonsTable: string,
): Promise<DiscountReads> {
  const guard = async <T>(read: PromiseLike<Read<T>>): Promise<Read<T>> => {
    try {
      const r = await read;
      return { data: r.data ?? null, error: r.error ? { message: r.error.message } : null };
    } catch (e) {
      return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
    }
  };
  const [student, lessons, videos, completions, requests] = await Promise.all([
    guard<{ first_paid_at: string | null }>(
      db.from("students").select("first_paid_at").eq("id", studentId).single(),
    ),
    guard<CatalogLessonRow[]>(db.from(lessonsTable).select(LESSON_COLUMNS).order("sort_order")),
    guard<{ lesson_id: string }[]>(db.from("lesson_videos").select("lesson_id")),
    guard<CompletionRow[]>(
      db.from("student_lesson_completions").select("lesson_id, completed_at").eq("student_id", studentId),
    ),
    guard<DiscountRequestRow[]>(
      db.from("discount_requests").select(REQUEST_COLUMNS).eq("student_id", studentId),
    ),
  ]);
  return { student, lessons, videos, completions, requests };
}

/** The catalog's rows as discount.ts's lessons. A lesson has a video when `lesson_videos` has its row, as in /api/student/data. */
export function toDiscountLessons(
  rows: readonly CatalogLessonRow[],
  videoLessonIds: ReadonlySet<string>,
): DiscountLesson[] {
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    // The column is NOT NULL; a null would mean a broken read, and asking for
    // the lesson is the side that grants nothing by mistake.
    counts_toward_progress: r.counts_toward_progress !== false,
    is_gate: r.is_gate === true,
    has_video: videoLessonIds.has(r.id),
    duration_seconds: r.duration_seconds ?? null,
  }));
}

/**
 * The lessons whose video is done: `completed_at` set. With `until`, only
 * those done at or before it; a date that does not parse is not done.
 */
export function videoDoneIds(rows: readonly CompletionRow[], until?: Date): Set<string> {
  const done = new Set<string>();
  for (const r of rows) {
    if (!r.completed_at) continue;
    if (until) {
      const t = Date.parse(r.completed_at);
      if (!Number.isFinite(t) || t > until.getTime()) continue;
    }
    done.add(r.lesson_id);
  }
  return done;
}

/** The reads as discount.ts's input, or the reads that failed. */
export function factsFromReads(
  reads: DiscountReads,
): { ok: true; facts: DiscountFacts } | { ok: false; failed: string[] } {
  const failed: string[] = [];
  const check = (name: string, r: Read<unknown>) => {
    if (r.error) failed.push(`${name}: ${r.error.message}`);
    else if (r.data == null) failed.push(`${name}: no data`);
  };
  check("students", reads.student);
  check("lessons", reads.lessons);
  check("lesson_videos", reads.videos);
  check("student_lesson_completions", reads.completions);
  check("discount_requests", reads.requests);
  // An empty catalog is a broken deployment, never a course with no gate.
  if (!failed.length && reads.lessons.data!.length === 0) failed.push("lessons: the catalog is empty");
  if (failed.length) return { ok: false, failed };

  const videoIds = new Set(reads.videos.data!.map((v) => v.lesson_id));
  return {
    ok: true,
    facts: {
      firstPaidAt: reads.student.data!.first_paid_at ?? null,
      lessons: toDiscountLessons(reads.lessons.data!, videoIds),
      completions: reads.completions.data!,
      requests: reads.requests.data!,
    },
  };
}

const LAUNCH_DAY = new Date(DISCOUNT_LAUNCH_DATE).toLocaleDateString("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/** "about 3.5 hours of video", "about 40 minutes of video", or "" for nothing known. */
function videoTime(seconds: number): string {
  if (seconds <= 0) return "";
  if (seconds < 3600) return `about ${Math.max(1, Math.round(seconds / 60))} minutes of video`;
  return `about ${Math.round(seconds / 360) / 10} hours of video`;
}

/** What the student reads when the request is refused, one plain sentence or two. */
export function discountRefusalMessage(state: DiscountState): string {
  switch (state.kind) {
    case "locked": {
      const n = state.lessonsLeft;
      const time = videoTime(state.secondsLeft);
      return (
        `You have ${n} ${n === 1 ? "lesson" : "lessons"} left to watch before the discount checkpoint` +
        `${time ? `, ${time}` : ""}. Finish ${n === 1 ? "it" : "them"} within your ${DISCOUNT_WINDOW_DAYS} days and apply again.`
      );
    }
    case "expired":
      return (
        `Your ${DISCOUNT_WINDOW_DAYS} days for the discount are over. The ${DISCOUNT_PERCENT}% is for students ` +
        `who reach the checkpoint within ${DISCOUNT_WINDOW_DAYS} days of their first payment.`
      );
    case "not-eligible":
      if (state.reason === "before-launch") {
        return (
          `The ${DISCOUNT_PERCENT}% discount is for students who joined on or after ${LAUNCH_DAY}, ` +
          `when the new course launched. Your first payment was before that.`
        );
      }
      if (state.reason === "no-payment") {
        return (
          `We can't find your first payment yet, so we can't check your ${DISCOUNT_WINDOW_DAYS} days. ` +
          `Contact support and we'll sort it out within 24h.`
        );
      }
      return "The discount can't be applied for right now. Contact support and we'll sort it out.";
    case "pending":
      return "You already applied for the discount. We're reviewing it.";
    case "approved":
      return "Your discount is already approved.";
    case "applied":
      return "Your discount is already on your membership.";
    case "rejected":
      return "Your discount request was already reviewed, and it wasn't approved.";
    case "ready":
      return "";
  }
}

export type RequestDecision =
  | { grant: true }
  | {
      grant: false;
      status: number;
      state: DiscountState["kind"] | "read-failed";
      error: string;
      /** For the server log, never the student. */
      log?: string;
    };

/** POST /api/discounts/request on the new course: grant only when discount.ts says `ready`. */
export function decideDiscountRequest(reads: DiscountReads, now: Date): RequestDecision {
  const f = factsFromReads(reads);
  if (!f.ok) {
    return {
      grant: false,
      status: 500,
      state: "read-failed",
      error: "We couldn't check your progress just now, so nothing was sent. Try again in a minute.",
      log: `nothing granted, a read failed: ${f.failed.join("; ")}`,
    };
  }
  const { firstPaidAt, lessons, completions, requests } = f.facts;
  const state = discountState({ now, firstPaidAt, lessons, videoDoneIds: videoDoneIds(completions), requests });
  if (state.kind === "ready") return { grant: true };
  return {
    grant: false,
    status: 400,
    state: state.kind,
    error: discountRefusalMessage(state),
    ...(state.kind === "not-eligible" && state.reason === "no-gate"
      ? { log: "nothing granted: the catalog has no gate lesson (is_gate), or no lesson up to it has a video, so the offer is closed" }
      : {}),
  };
}

export type ApprovalVerdict =
  | { ok: true }
  | { ok: false; status: number; error: string; log?: string };

/**
 * POST /api/discounts/approve on the new course: the request route's rule,
 * judged at the end of the window. Every video it asks for must have been
 * done by the day the 14 days ran out, so a request may be approved late and a
 * video watched after the window does not count. The student's own requests
 * are left out (the one being approved would otherwise decide the answer).
 */
export function approvalVerdict(reads: DiscountReads, now: Date): ApprovalVerdict {
  const f = factsFromReads(reads);
  if (!f.ok) {
    return {
      ok: false,
      status: 500,
      error: "Couldn't read the student's progress, so nothing was approved. Try again.",
      log: `nothing approved, a read failed: ${f.failed.join("; ")}`,
    };
  }
  const { firstPaidAt, lessons, completions } = f.facts;
  const endsAt = discountEndsAt(firstPaidAt);
  const at = endsAt && now.getTime() > endsAt.getTime() ? endsAt : now;
  const state = discountState({
    now: at,
    firstPaidAt,
    lessons,
    videoDoneIds: videoDoneIds(completions, endsAt ?? undefined),
    requests: [],
  });
  switch (state.kind) {
    case "ready":
      return { ok: true };
    case "locked":
      return {
        ok: false,
        status: 400,
        error:
          `Student has not watched every video up to the discount checkpoint inside the ${DISCOUNT_WINDOW_DAYS} days: ` +
          `${state.lessonsLeft} of ${state.lessonsTotal} still missing.`,
      };
    case "not-eligible":
      if (state.reason === "no-payment") {
        // The old route's words for the same gate.
        return {
          ok: false,
          status: 400,
          error:
            "Cannot approve: student has no first_paid_at on file. Run the Whop sync (Refresh on /admin) to backfill, then retry. If still NULL, this student's Whop membership history needs manual review.",
        };
      }
      if (state.reason === "before-launch") {
        return {
          ok: false,
          status: 400,
          error: `Cannot approve: the student's first payment (${firstPaidAt}) is before ${LAUNCH_DAY}, when the new course launched.`,
        };
      }
      return {
        ok: false,
        status: 400,
        error:
          "Cannot approve: the course has no discount gate lesson (is_gate), or no lesson up to it has a video, so nobody can qualify. Check the catalog and lesson_videos.",
        log: "nothing approved: the catalog has no gate lesson, or no video up to it",
      };
    default:
      // Unreachable with no requests and the clock held inside the window.
      return { ok: false, status: 400, error: `Cannot approve: the discount state is ${state.kind}.` };
  }
}
