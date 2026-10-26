/**
 * The server half of the early-finish discount, for the new course.
 *
 * `discount.ts` decides where a student stands. This file feeds it from the
 * database and turns its answer into what a route sends back:
 *
 *   loadDiscountReads      the five reads, in parallel, never throwing
 *   factsFromReads         those reads as discount.ts's input, or which failed
 *   decideDiscountRequest  POST /api/discounts/request and
 *                          POST /api/discounts/submit-feedback: grant only on
 *                          `ready`
 *   approvalVerdict        POST /api/discounts/approve: were the videos the
 *                          window asks for done by the student's deadline
 *                          (discount.ts videosNeededFor: 80% of them, every
 *                          one for a deadline before 26 October), and could
 *                          the app's Apply have made the request
 *   secondPendingRequest   both routes that write a request, on either course:
 *                          a double submit the database refused (v106)
 *   SAVE_FAILED            those routes' answer to any other failed write
 *   membershipDiscountRefusal, couponApprovalRefusal
 *                          a discount already on the student's next Whop
 *                          renewal (admin rebuild 2, D5): the request routes'
 *                          refusal and the approve route's
 *   membershipUncheckedRefusal
 *                          the request routes' refusal when that check could
 *                          not run (the owner's review, 2026-10-21)
 *   unpaidRefusal, UNPAID_APPROVAL
 *                          Whop does not show both a paid course plan and a
 *                          course payment that went through (the coupon
 *                          check's unpaid, the owner's rule of 2026-10-26):
 *                          the request routes' refusal and the approve
 *                          route's
 *   holdsAnotherThirty     the 30% that applies itself (T-137): another
 *                          request of the student's went through, so the app
 *                          makes no code on its own
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
  DISCOUNT_EIGHTY_FROM,
  DISCOUNT_ELIGIBLE_FROM,
  DISCOUNT_PERCENT,
  DISCOUNT_SHARED_DEADLINE,
  DISCOUNT_VIDEO_SHARE,
  DISCOUNT_WINDOW_DAYS,
  MEMBERSHIP_DISCOUNT_LINE,
  PAID_PLAN_LINE,
  closedBeforeEighty,
  discountEndsAt,
  discountState,
  requestCounts,
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

/** One `lesson_videos` row as the loader selects it: never the Tella id. */
export interface VideoRow {
  lesson_id: string;
  /** When the video was loaded. The approval leaves out a video loaded after the request. */
  created_at?: string | null;
}

export interface DiscountReads {
  student: Read<{ first_paid_at: string | null }>;
  lessons: Read<CatalogLessonRow[]>;
  videos: Read<VideoRow[]>;
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
export const VIDEO_COLUMNS = "lesson_id, created_at";

/**
 * The five reads the discount needs. `lessonsTable` is LESSONS_TABLE from
 * catalog-tables.ts, handed in so this file reads no environment.
 *
 * `lesson_videos` has row level security and no policy: only a service-role
 * client sees its rows. Any other client gets an empty list and no error, so
 * a route must hand this a service-role client. Only `lesson_id` and
 * `created_at` are selected: the row also carries the Tella id, which never
 * leaves the server.
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
    guard<VideoRow[]>(db.from("lesson_videos").select(VIDEO_COLUMNS)),
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

// The rule's dates are midnight in Croatia (discount.ts), so the day is read
// there: in UTC the first one falls on the evening before. Since 2026-10-20
// only the team reads them (approvalVerdict): a student's refusal names no
// date (discountRefusalMessage).
/** "October 1, 2026": the earliest first payment that can earn it. */
const ELIGIBLE_DAY = new Date(DISCOUNT_ELIGIBLE_FROM).toLocaleDateString("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "Europe/Zagreb",
});
/** "October 23": the last day for a first payment before the launch. */
const SHARED_DEADLINE_DAY = new Date(DISCOUNT_SHARED_DEADLINE).toLocaleDateString("en-US", {
  month: "long",
  day: "numeric",
  timeZone: "Europe/Zagreb",
});
/** "October 26": the first day of the 80% rule; a deadline before it keeps every video (discount.ts videosNeededFor). */
const EIGHTY_DAY = new Date(DISCOUNT_EIGHTY_FROM).toLocaleDateString("en-US", {
  month: "long",
  day: "numeric",
  timeZone: "Europe/Zagreb",
});

/**
 * "about 3.5 hours of video", "about 1 hour of video", "about 40 minutes of
 * video", "about 1 minute of video", or "" for nothing known. One is said in
 * the singular (the review of 2026-10-26: "about 1 minutes" could be read).
 */
function videoTime(seconds: number): string {
  if (seconds <= 0) return "";
  if (seconds < 3600) {
    const minutes = Math.max(1, Math.round(seconds / 60));
    return `about ${minutes} ${minutes === 1 ? "minute" : "minutes"} of video`;
  }
  const hours = Math.round(seconds / 360) / 10;
  return `about ${hours} ${hours === 1 ? "hour" : "hours"} of video`;
}

/**
 * What a student with a request in review reads when they apply again. Since
 * the 30% applies itself (T-137, R6, the owner's words of 2026-10-26) it says
 * where the 30% will show, where it said "We're reviewing it."
 */
export const ALREADY_APPLIED = `You already applied for the discount. You'll see it here once the ${DISCOUNT_PERCENT}% is on your Whop subscription.`;

/**
 * What a student reads when saving the request fails for any other reason: a
 * foreign key, a value that is not a uuid, the database function's own
 * refusal, no connection. The route logs the real error; the database's words
 * never reach the student.
 */
export const SAVE_FAILED = "Something went wrong saving that. Try again, or ask the team in Discord.";

/** v106's index: at most one pending request per student. */
const ONE_PENDING_INDEX = "discount_requests_one_pending_per_student";

/**
 * The answer to a request the database refused as the student's second
 * pending one: SQLSTATE 23505 on v106's index, from two Apply clicks sent so
 * close together that both passed the route's checks before either was
 * written. The first request stands, so the student gets the answer for a
 * request already in review, never the database's words. Null for any other
 * error, which the route answers with SAVE_FAILED.
 */
export function secondPendingRequest(
  error: { code?: string | null; message?: string | null } | null | undefined,
): { error: string; state: "pending" } | null {
  if (error?.code !== "23505" || !error.message?.includes(ONE_PENDING_INDEX)) return null;
  return { error: ALREADY_APPLIED, state: "pending" };
}

/**
 * What the student reads when the request is refused, one plain sentence or
 * two. Since 2026-10-20 the panel states the rule in one line
 * (checkpointView.ts discountRule), so these say only the fact: no date, no
 * length of window, the same words for either window. One shows only when
 * the server disagrees with a panel that offered Apply (the deadline passed
 * with the tab open, a completion the server does not have): under Apply, or
 * on the questions' last step.
 *
 * Locked, since the 80% rule (2026-10-26): how many more videos the 80% needs
 * (state.lessonsLeft) and about how long the shortest of the videos not
 * watched take (state.secondsLeft, discount.ts shortestSeconds), since any
 * of them counts: "if you pick the shortest". With a length not known there
 * is no time. Until the review of the same day the time was the next ones in
 * course order, and until the rule it was every video left ("You have 3
 * videos left to watch"). A window that ends before the 80% rule still asks
 * for every video (discount.ts videosNeededFor, the owner's B), so a locked
 * state of one, which only a clock before 26 October can see, reads those
 * words: every video left is needed, so the time is all of them.
 */
export function discountRefusalMessage(state: DiscountState): string {
  switch (state.kind) {
    case "locked": {
      const n = state.lessonsLeft;
      const time = videoTime(state.secondsLeft);
      if (closedBeforeEighty(state.endsAt)) {
        return (
          `You have ${n} ${n === 1 ? "video" : "videos"} left to watch${time ? `, ${time}` : ""}. ` +
          `Finish ${n === 1 ? "it" : "them"} before your deadline and apply again.`
        );
      }
      return (
        `You need ${n} more ${n === 1 ? "video" : "videos"} to reach ${DISCOUNT_VIDEO_SHARE}%${time ? `, ${time} if you pick the shortest` : ""}. ` +
        `Watch ${n === 1 ? "it" : "them"} before your deadline and apply again.`
      );
    }
    case "expired":
      return `Your deadline for the ${DISCOUNT_PERCENT}% has passed.`;
    case "not-eligible":
      if (state.reason === "before-launch") return `Your 2 weeks for the ${DISCOUNT_PERCENT}% have passed.`;
      if (state.reason === "no-payment") return "We can't see your first payment yet. Tell the team and they'll sort it out.";
      if (state.reason === "has-discount") return MEMBERSHIP_DISCOUNT_LINE;
      if (state.reason === "unpaid") return PAID_PLAN_LINE;
      return "The discount can't be applied for right now. Contact support and we'll sort it out.";
    case "pending":
      return ALREADY_APPLIED;
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

/**
 * POST /api/discounts/request and POST /api/discounts/submit-feedback on the
 * new course: grant only when discount.ts says `ready`, which needs what the
 * window asks of the videos (videosNeededFor: 80% of them for every window
 * open today) inside an open window. A student with no first
 * payment on file has no window (discountWindow: "no-payment"; since the
 * first-paid fix of 2026-10-20 an empty first_paid_at means no real payment),
 * so is never ready: refused before anything is written, in the map's own
 * sentence ("We can't see your first payment yet. Tell the team and they'll
 * sort it out."), or as their request already made when one counts.
 */
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

/**
 * Both request routes on the new course, once decideDiscountRequest has
 * granted: the student already has a coupon (D5, src/lib/membership-discount.ts
 * checkMembershipDiscount: since T-122's third fix round a code other than
 * their own 30% on a course membership or payment, since its fifth a
 * discount a payment naming no code shows, or with neither a price under
 * 97.00), so nothing is written and the student reads the map's own line.
 */
export function membershipDiscountRefusal(): Extract<RequestDecision, { grant: false }> {
  const state: DiscountState = { kind: "not-eligible", reason: "has-discount" };
  return { grant: false, status: 400, state: state.kind, error: discountRefusalMessage(state) };
}

/** What the student reads when the coupon check could not run (membershipUncheckedRefusal), word for word. */
export const MEMBERSHIP_UNCHECKED = "We couldn't check your membership just now. Try again in a minute.";

/**
 * Both request routes on the new course, once decideDiscountRequest has
 * granted: the coupon check could not run (the owner's review, 2026-10-21:
 * applying fails closed, so a student whose membership may hold a code never
 * gets a request in). Whop gave no answer and nothing stored answers for the
 * membership the student has now (checkMembershipDiscount's source "none":
 * Whop down or refusing the key, no key or no course product on the
 * deployment, the student's row unreadable; and since T-122's third fix
 * round a stored "no coupon" that holds no source, which the rule before it
 * wrote, or any stored "no coupon" on a database without v113; since its
 * fifth one that does not carry the rule's stamp, or any stored "no coupon"
 * while the student's row cannot be read), so nothing is written and the
 * student is asked to try again. It used to let the
 * request through and leave the coupon to the approve route. Since T-122 a
 * Whop id on file that is missing, a payment's, or one Whop does not know is
 * no reason any more: the check finds the memberships through the student's
 * Whop user, and judges the student's course payments.
 */
export function membershipUncheckedRefusal(): Extract<RequestDecision, { grant: false }> {
  return { grant: false, status: 503, state: "read-failed", error: MEMBERSHIP_UNCHECKED };
}

/**
 * Both request routes on the new course, once decideDiscountRequest has
 * granted and the coupon check found no coupon: Whop does not show both a
 * real course payment and a course membership on a paid plan
 * (checkMembershipDiscount's unpaid, Whop's answer now or the one this rule
 * stored; membership-discount.ts, THE PAID PLAN AND THE PAYMENT). The owner,
 * 2026-10-26: "They shouldn't be able to apply. If they don't have a payment
 * and a paid plan - no applying to 30% off. Can't even give it to them so
 * there's no point." Such a student can still have a first_paid_at: one
 * written before the first-paid fix from a membership's creation (the repair
 * never empties it), one a payment for another product set (ETfB), or one a
 * payment refunded since set, so the rule's own "no-payment" never caught
 * them. Nothing is written, and the student reads the map's sentence for it,
 * one sentence for every case ("The 30% needs a paid course plan and a payment
 * that went through.", state not-eligible). Until that day the state was
 * "no-payment" and the sentence "We can't see your first payment yet. Tell
 * the team and they'll sort it out.", which was not true for a student who
 * had paid for another product; that sentence stays for an empty
 * first_paid_at alone.
 */
export function unpaidRefusal(): Extract<RequestDecision, { grant: false }> {
  const state: DiscountState = { kind: "not-eligible", reason: "unpaid" };
  return { grant: false, status: 400, state: state.kind, error: discountRefusalMessage(state) };
}

/**
 * The approve route's refusal of the normal Approve for that student, code
 * "rule", so a founder's or an admin's Approve anyway still passes it (the
 * route's `override`). The 30% page shows its own words for it and the row's
 * verdict says why (thirty-view.ts, "unpaid"). It said "Whop shows no real
 * payment from this student" until the owner's answers of 2026-10-26.
 */
export const UNPAID_APPROVAL =
  "Cannot approve: the 30% needs a paid course plan and a payment that went through, and Whop doesn't show both for this student.";

/**
 * The approve route's refusal for a student whose membership already has a
 * discount on its next renewal (D5), and the admin 30% page's verdict for
 * one. Since the owner's review (2026-10-21) a founder's or an admin's
 * "Approve anyway" on such a row passes it (the route's `overrideCoupon`);
 * nothing else does. `code` is the code's name, or its Whop promo id when the
 * name could not be read.
 */
export function couponApprovalRefusal(code: string | null): string {
  return `This student already has a discount on their membership (${code ?? "code not known"}).`;
}

/**
 * The approve route's refusal of the normal Approve when the coupon check
 * gave no answer (checkMembershipDiscount's source "none": Whop gave none and
 * nothing stored answers), in the team's words, by `liveFail`, the reason the
 * check could not answer (T-122's fourth fix round; until then the approval
 * went on, a code made for a student who might hold a coupon). A founder's or
 * an admin's Approve anyway still goes on: the page offers it on the refusal
 * (the route's code "rule").
 */
export function couponUncheckedApprovalRefusal(liveFail: string | null): string {
  switch (liveFail) {
    case "no_whop_user":
      return "The student's Whop account is not on file, so the coupon check couldn't run and nothing was approved. Check the coupon in Whop.";
    case "no_api_key":
      return "This deployment has no Whop key, so the coupon check couldn't run and nothing was approved.";
    case "no_course_product":
      return "This deployment doesn't name the course's Whop product, so the coupon check couldn't run and nothing was approved.";
    case "student_unread":
      return "Couldn't read this student's details, so the coupon check couldn't run and nothing was approved. Try again.";
    case "http_401_403":
      return "Whop refused this deployment's key, so the coupon check couldn't run and nothing was approved.";
    case "filter_ignored":
    case "bad_page":
    case "too_many_pages":
    case "bad_shape":
      return "Whop answered the coupon check in a way it can't read, so nothing was approved. Try again in a minute.";
    default:
      return "Whop gave no answer to the coupon check, so nothing was approved. Try again in a minute.";
  }
}

/**
 * Which state of the new rule refused a request: what explainOldCourseRequest
 * reads. "late-request" and "another-request" are madeOutsideApply's.
 */
export type ApprovalRefusal = "locked" | "before-launch" | "no-payment" | "no-gate" | "late-request" | "another-request";

export type ApprovalVerdict =
  | { ok: true }
  | { ok: false; status: number; error: string; log?: string; reason?: ApprovalRefusal };

/**
 * How long after a student's deadline a request made through the app can
 * still be stamped: a request route decides on its own clock, then inserts,
 * and the database stamps the insert with its own now(). Vercel stops a
 * function after 5 minutes at most, so nothing the app allowed in time is
 * written later than this.
 */
export const REQUEST_GRACE_MS = 5 * 60_000;

/**
 * POST /api/discounts/approve on the new course: a refusal for a request the
 * app's Apply could not have made, or null. Both request routes refuse an
 * application after the student's deadline, and one from a student who holds
 * another request that counts (discount.ts requestCounts) and was rejected,
 * approved or applied. The feedback form's database function checks neither,
 * and until v107 a student holding a session could call it straight (the
 * release review, 17 October). `asked` is the request's `created_at` in
 * milliseconds (NaN when it does not parse: then only the second check runs);
 * `requestId` is the request being approved, never counted as "another".
 */
function madeOutsideApply(
  requests: readonly DiscountRequestRow[],
  firstPaidAt: string | null,
  asked: number,
  endsAt: Date | null,
  requestId: string | undefined,
): ApprovalVerdict | null {
  if (endsAt && Number.isFinite(asked) && asked > endsAt.getTime() + REQUEST_GRACE_MS) {
    return {
      ok: false,
      status: 400,
      error:
        `Cannot approve: this request was made at ${new Date(asked).toISOString()}, after the student's deadline ` +
        `(${endsAt.toISOString()}), and the app refuses an application that late. Judge it by hand; Generate anyway skips the check.`,
      reason: "late-request",
    };
  }
  const other = requests
    .filter((r) => r.id !== requestId && r.status !== "pending" && requestCounts(r, firstPaidAt))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  if (!other) return null;
  const why =
    other.status === "rejected"
      ? "was rejected, and the app refuses a new application after a rejection"
      : other.status === "approved"
        ? `was already approved, and the ${DISCOUNT_PERCENT}% is one per student`
        : `is already on their membership, and the ${DISCOUNT_PERCENT}% is one per student`;
  return {
    ok: false,
    status: 400,
    error: `Cannot approve: this student's other request (made ${other.created_at}) ${why}. Judge it by hand; Generate anyway skips the check.`,
    reason: "another-request",
  };
}

/**
 * The 30% that applies itself (T-137, src/lib/thirty-apply.ts): whether the
 * student holds another request that counts (discount.ts requestCounts) and
 * went through, approved or applied. The app never makes a second code for
 * such a student on its own: the request waits for the team.
 * `requestId` is the request being worked, never counted as "another".
 * madeOutsideApply above stays as it is.
 */
export function holdsAnotherThirty(
  requests: readonly DiscountRequestRow[],
  firstPaidAt: string | null,
  requestId: string,
): boolean {
  return requests.some(
    (r) => r.id !== requestId && (r.status === "approved" || r.status === "applied") && requestCounts(r, firstPaidAt),
  );
}

/**
 * POST /api/discounts/approve on the new course: the request route's rule,
 * judged at the end of the window. What the window asks of the videos it
 * counts (discount.ts videosNeededFor, through discountState: 80% of them,
 * and every one for a window that ended before the 80% rule, the owner's B of
 * 2026-10-26; the branch before the review of that day judged those by the
 * 80% too, which reached back to windows the owner keeps closed)
 * must have been done by the student's deadline (14 days from a first payment
 * made on or after the launch, the end of 23 October for one from 1 October
 * until the launch: discount.ts discountWindow), so a request may be approved
 * late and a video watched after the deadline does not count, wherever it was
 * watched: a lesson finished on Whop carries the time the app recorded it. No
 * first payment on file (no real payment, since the first-paid fix) is no
 * window at all: refused, reason "no-payment", which only Approve anyway
 * skips. The student's own requests are left out (the one being approved
 * would otherwise decide the answer).
 *
 * `requestCreatedAt` is the `created_at` of the request being approved. A
 * video loaded after it is not asked for: the student applied with every
 * video that existed then done, and could not have watched one that did not.
 * What the student sees is unchanged. A request date that does not parse, or a
 * video with no date, asks for the video (the side that approves nothing by
 * mistake).
 *
 * `resetAt` is the course switch (`curriculum_reset_at`), or null before it.
 * A request made before the switch was made on the old course, when the app
 * showed none of the new course's videos, so the videos it is judged by are
 * the ones loaded by the switch, and the student still has until their
 * deadline to watch them. Without this every new-course video counted as
 * loaded after a request from the old dashboard, nothing was asked for, and
 * the approval read the same whether or not the student had finished (the
 * release review, 17 October).
 *
 * Where the rule would approve, it then refuses a request the app's Apply
 * could not have made (madeOutsideApply, 17 October): one made more than
 * REQUEST_GRACE_MS after the student's deadline, or one beside another of the
 * student's requests that counts and was rejected, approved or applied.
 * Every other answer keeps its words. `requestId` is the id of the request
 * being approved.
 */
export function approvalVerdict(
  reads: DiscountReads,
  now: Date,
  requestCreatedAt: string | null,
  requestId?: string,
  resetAt?: string | null,
): ApprovalVerdict {
  const f = factsFromReads(reads);
  if (!f.ok) {
    return {
      ok: false,
      status: 500,
      error: "Couldn't read the student's progress, so nothing was approved. Try again.",
      log: `nothing approved, a read failed: ${f.failed.join("; ")}`,
    };
  }
  const { firstPaidAt, completions } = f.facts;
  const asked = requestCreatedAt == null ? NaN : Date.parse(requestCreatedAt);
  // The videos the request is judged by: those loaded when it was made, or at
  // the switch for a request made before it (resetAt above).
  const reset = resetAt == null ? NaN : Date.parse(resetAt);
  const videosAsOf = Number.isFinite(asked) && Number.isFinite(reset) && reset > asked ? reset : asked;
  const loadedLater = new Set(
    Number.isFinite(videosAsOf)
      ? reads.videos.data!
          .filter((v) => v.created_at != null && Date.parse(v.created_at) > videosAsOf)
          .map((v) => v.lesson_id)
      : [],
  );
  const lessons = f.facts.lessons.map((l) => (loadedLater.has(l.id) ? { ...l, has_video: false } : l));
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
      return madeOutsideApply(f.facts.requests, firstPaidAt, asked, endsAt, requestId) ?? { ok: true };
    case "locked": {
      const by =
        state.window === "shared"
          ? `by the end of ${SHARED_DEADLINE_DAY} (Croatia time), the deadline for a first payment before the launch`
          : `inside the ${DISCOUNT_WINDOW_DAYS} days`;
      const counts = `${state.lessonsDone} of ${state.lessonsTotal} watched, ${state.lessonsNeeded} needed.`;
      // A window that ended before the 80% rule keeps every video (discount.ts videosNeededFor, the owner's B).
      return {
        ok: false,
        status: 400,
        error: closedBeforeEighty(state.endsAt)
          ? `Student has not watched every video up to the discount checkpoint ${by} (a deadline before ${EIGHTY_DAY} ` +
            `asks for every one; the ${DISCOUNT_VIDEO_SHARE}% counts from then on): ${counts}`
          : `Student has not watched ${DISCOUNT_VIDEO_SHARE}% of the videos up to the discount checkpoint ${by}: ${counts}`,
        reason: "locked",
      };
    }
    case "not-eligible":
      if (state.reason === "no-payment") {
        // The old route's words for the same gate.
        return {
          ok: false,
          status: 400,
          error:
            "Cannot approve: student has no first_paid_at on file. Run the Whop sync (Refresh on /admin) to backfill, then retry. If still NULL, this student's Whop membership history needs manual review.",
          reason: "no-payment",
        };
      }
      if (state.reason === "before-launch") {
        return {
          ok: false,
          status: 400,
          error: `Cannot approve: the student's first payment (${firstPaidAt}) is before ${ELIGIBLE_DAY}. Only a first payment from then on can earn the discount.`,
          reason: "before-launch",
        };
      }
      return {
        ok: false,
        status: 400,
        error:
          "Cannot approve: the course has no discount gate lesson (is_gate), or no lesson up to it has a video, so nobody can qualify. Check the catalog and lesson_videos.",
        log: "nothing approved: the catalog has no gate lesson, or no video up to it",
        reason: "no-gate",
      };
    default:
      // Unreachable with no requests and the clock held inside the window.
      return { ok: false, status: 400, error: `Cannot approve: the discount state is ${state.kind}.` };
  }
}

export const OLD_COURSE_REQUEST_REFUSAL =
  "This request was made on the old course, before the switch. Judge it by hand; Generate anyway skips the check.";

/**
 * POST /api/discounts/approve on the new course: a refusal of a request made
 * before the course switch (`curriculum_reset_at`), in words that say so,
 * when the refusal is about the videos. The old course's progress was
 * archived at the switch, and the request was judged by the new course's
 * videos as they stood at the switch (approvalVerdict's `resetAt`), so "D of
 * M watched, N needed" ("locked") keeps the new rule's words after the old-course
 * sentence, and "no video to check" ("no-gate") gets the sentence alone. A
 * first payment before 1 October, or none on
 * file, reads the same on either course, so those refusals keep their own
 * words. A verdict that approves, a failed read (500), no switch, or a date
 * that does not parse comes back as it went in.
 */
export function explainOldCourseRequest(
  verdict: ApprovalVerdict,
  requestCreatedAt: string,
  resetAt: string | null,
): ApprovalVerdict {
  if (verdict.ok || verdict.status !== 400 || resetAt == null) return verdict;
  if (verdict.reason !== "locked" && verdict.reason !== "no-gate") return verdict;
  const asked = Date.parse(requestCreatedAt);
  const reset = Date.parse(resetAt);
  if (!Number.isFinite(asked) || !Number.isFinite(reset) || asked >= reset) return verdict;
  return {
    ...verdict,
    error:
      verdict.reason === "locked"
        ? `${OLD_COURSE_REQUEST_REFUSAL} The new rule says: ${verdict.error}`
        : OLD_COURSE_REQUEST_REFUSAL,
  };
}
