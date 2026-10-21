/**
 * The 30% page's answer (GET /api/admin/thirty), built from loadThirtyData's
 * reads by the student app's own rule. Pure: no database, no clock of its
 * own; the route hands it the moment and the course switch's date.
 *
 * Admin rebuild 2 (D4): the page lists every request from 1 October in four
 * tabs (Applied = pending, Approved, Rejected, Code Applied = applied), each
 * row with the student, the date applied, a verdict line on a pending one,
 * the coupon and the decision. Can still earn, the plan, the last contact,
 * the action items and the survey answers went with it, and in the review's
 * fix round the words they were shown in (the C4 reasons, the hours left).
 *
 * A pending request is judged the way POST /api/discounts/approve judges it
 * (D5 first, then the rule):
 *   1. the coupon: the student's stored membership row says a discount is on
 *      the next renewal (student_membership_discounts, for the membership the
 *      student has now). The approve route refuses that with no override,
 *      in the same words (couponApprovalRefusal).
 *   2. the rule on the new course: approvalVerdict, then
 *      explainOldCourseRequest for a request made before the switch. The page
 *      shows its own fixed sentence for each answer (VERDICT_TEXT): the
 *      route's error texts name a button the page no longer has.
 *
 * The numbers on a pending row are the ones Approve judged: the videos
 * loaded after the request (after the switch, for one made before it) are
 * not asked for, only videos done by the deadline count, and once the
 * deadline has passed the count says so (`countedByDeadline`).
 *
 * The coupon of a decided row (the render review's fix round): once the team
 * adds the 30% code in Whop, Whop shows it on the membership as a discount on
 * the next renewal. That code is the team's own (isThirtyCode: an ECOM30
 * code, or the request's own whop_promo_id), so the coupon carries `ours`
 * and the Approved and Code Applied rows never warn about it (couponWarns).
 * An Applied row the coupon refuses offers only Reject, with its reason
 * filled in (COUPON_REJECT_REASON: the map's own sentence to the student,
 * since the student reads the reason there), and since the render review's
 * second round "Check Whop again" (POST /api/admin/thirty/check-coupon),
 * which stores Whop's answer now: with the coupon gone, the next read judges
 * the row by the rule again.
 */

import {
  DISCOUNT_ELIGIBLE_FROM,
  DISCOUNT_SHARED_DEADLINE,
  MEMBERSHIP_DISCOUNT_LINE,
  discountEndsAt,
  discountState,
  discountWindow,
  requiredLessons,
} from "@/lib/world/discount";
import type { DiscountLesson, DiscountState, DiscountWindow } from "@/lib/world/discount";
import {
  approvalVerdict,
  couponApprovalRefusal,
  explainOldCourseRequest,
  factsFromReads,
  toDiscountLessons,
  videoDoneIds,
} from "@/lib/world/discount-server";
import type { ApprovalRefusal, ApprovalVerdict, DiscountFacts, DiscountReads, VideoRow } from "@/lib/world/discount-server";
import { isMembershipId } from "@/lib/membership-discount";
import { dayLabel } from "./croatia-dates";
import type { LiveCoupon, ThirtyCouponRow, ThirtyData, ThirtyStudent } from "./thirty-data";

/** A team member as a row names them. `name` is null when the id is no longer a team member. */
export interface TeamRef {
  id: string;
  name: string | null;
}

export interface StudentBrief {
  id: string;
  name: string | null;
  email: string | null;
  /** students.discord_username, shown as @username (it can hold a Whop username). */
  username: string | null;
  /** membership_status: active, past_due, canceled or expired. */
  status: string;
  /** A Whop backfill ran since the switch (student_whop_sync.last_sync_at at or after curriculum_reset_at). */
  whopPulled: boolean;
}

/**
 * Where a student stands. The three counts are null when the student's
 * progress could not be read (the verdict says so); the first payment and the
 * deadline come from the student's row and are always there.
 */
export interface Facts {
  firstPaidAt: string | null;
  /** "shared": the end of Fri 23 Oct, Croatia time. "own": 14 days from the first payment. Null when the offer is closed to them. */
  window: DiscountWindow | null;
  deadline: string | null;
  deadlinePassed: boolean;
  videosDone: number | null;
  videosTotal: number | null;
  /** Only videos done by the deadline are counted, and the deadline has passed: show the count as "done by the deadline". */
  countedByDeadline: boolean;
  /** The length of the videos still to watch, in seconds. */
  secondsLeft: number | null;
}

/**
 * Why a request may not be approved. ApprovalRefusal's reasons are the
 * rule's; "has-discount": a discount is already on the student's next Whop
 * renewal (D5, no override); "read-failed": the student's progress could not
 * be read; "unknown": the rule gave no reason (it cannot, today).
 */
export type VerdictReason = ApprovalRefusal | "has-discount" | "read-failed" | "unknown";

export interface Verdict {
  /** Approve would approve it now. */
  ok: boolean;
  /** Null when ok. */
  reason: VerdictReason | null;
  /** One of VERDICT_TEXT's sentences, or the coupon's (couponApprovalRefusal). */
  text: string;
  /** Asked on the old course, before the switch, and refused over its videos (explainOldCourseRequest). */
  oldCourse: boolean;
}

/**
 * The student's Whop membership as last read (student_membership_discounts),
 * for the membership they have now. `code` is the code's name, or its Whop
 * promo id when the name could not be read; null with no code.
 */
export interface Coupon {
  code: string | null;
  /** The code's Whop promo id, null with no code. */
  promoCodeId: string | null;
  /** A discount is on the next renewal: no 30% (D5). */
  discounted: boolean;
  /**
   * The code is the request's own 30% code (isThirtyCode): the team added it
   * in Whop. An Approved or Code Applied row never warns about it. Always
   * false on an Applied row, where the coupon decides as the approve route
   * decides (any discount on the next renewal refuses).
   */
  ours: boolean;
  renewalPrice: number | null;
  planRenewalPrice: number | null;
  checkedAt: string;
}

/**
 * Where a row's coupon comes from (the review's fix round):
 *   live         Whop answered now (an Approved row)
 *   stored       the stored row for the membership the student has now
 *   not-checked  no stored row applies to this membership yet: never
 *                checked, or a membership changed since (an Applied row
 *                says so; Approve asks Whop first)
 *   no-membership  the student's Whop id is missing or is not a
 *                membership's (the webhook has stored a payment's id
 *                there): neither the cron nor Approve can ask Whop, so
 *                nothing blocks the 30% and the row says to check Whop
 *   failed       Whop gave no answer now and nothing is stored (an Approved row)
 *   unread       the stored coupons could not be read at all (couponsUnread)
 */
export type CouponCheck = "live" | "stored" | "not-checked" | "no-membership" | "failed" | "unread";

export interface ThirtyRequestRow {
  id: string;
  status: "pending" | "approved" | "rejected" | "applied";
  askedAt: string;
  reviewedAt: string | null;
  reviewedBy: TeamRef | null;
  appliedAt: string | null;
  appliedBy: TeamRef | null;
  /** The 30% code Approve made (ECOM30-...). */
  promoCode: string | null;
  rejectionReason: string | null;
  student: StudentBrief;
  /** Pending rows only: what the verdict judged. */
  facts: Facts | null;
  /** Pending rows only. */
  verdict: Verdict | null;
  /** The coupon (Whop's answer now on an Approved row, else the stored one), or null when none is known for this membership. */
  coupon: Coupon | null;
  /** Where `coupon` comes from, or why there is none. */
  couponCheck: CouponCheck;
}

export interface ThirtyView {
  generatedAt: string;
  sharedDeadline: string;
  /** The first request date the page lists (DISCOUNT_ELIGIBLE_FROM). */
  listedFrom: string;
  /** The videos the offer asks for today, or null when the catalog or the videos could not be read. */
  requiredCount: number | null;
  /** The stored coupons could not be read: no row shows one, and the approve route still asks Whop. */
  couponsUnread: boolean;
  /** Every listed request, oldest first (the date applied, then the id): each tab keeps this order. */
  requests: ThirtyRequestRow[];
}

const ELIGIBLE_DAY = dayLabel(DISCOUNT_ELIGIBLE_FROM);

/** The sentences the page shows for a verdict. Plain words, no em dash: the team reads them as they are. */
export const VERDICT_TEXT = {
  yes: "Every video up to the checkpoint was done in time.",
  lockedOpen: "Not every video up to the checkpoint is done yet.",
  lockedClosed: "Not every video up to the checkpoint was done by the deadline.",
  beforeLaunch: `The first payment was before ${ELIGIBLE_DAY}, so this student cannot earn the 30%.`,
  noPayment: "There is no first payment on file for this student, so the rule cannot judge this request.",
  noGate: "The course has no checkpoint lesson with a video, so nobody can earn the 30% right now.",
  oldCourse: "Asked on the old course, before the switch.",
  oldCourseNoGate:
    "Asked on the old course, before the switch, when no video up to the checkpoint was loaded yet. Judge it by hand.",
  lateRequest: "This request was made after the student's deadline, later than the app's Apply allows.",
  anotherRequest: "This student already had a request decided, and the app takes no new one after that.",
  readFailed: "Couldn't read this student's progress, so there is no verdict. Press Refresh to try again.",
  unknown: "The rule could not judge this request. Judge it by hand.",
} as const;

/** A Whop backfill ran since the switch. Before the switch any backfill counts. */
export function whopPulled(lastSyncAt: string | null | undefined, resetAt: string | null): boolean {
  if (!lastSyncAt) return false;
  const t = Date.parse(lastSyncAt);
  if (!Number.isFinite(t)) return false;
  if (resetAt == null) return true;
  return t >= Date.parse(resetAt);
}

/** A stored price as a number: Postgres numeric reaches the page as a string or a number. */
function priceOf(value: number | string | null | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * The stored coupon for the membership the student has now, or null. A row
 * read from another membership says nothing about this one
 * (membership-discount.ts storedRowApplies).
 */
export function couponOf(row: ThirtyCouponRow | undefined, student: Pick<ThirtyStudent, "whop_membership_id">): Coupon | null {
  if (!row || !row.whop_membership_id || row.whop_membership_id !== student.whop_membership_id) return null;
  return {
    code: row.promo_code ?? row.promo_code_id ?? null,
    promoCodeId: row.promo_code_id ?? null,
    discounted: row.discounted === true,
    ours: false,
    renewalPrice: priceOf(row.renewal_price),
    planRenewalPrice: priceOf(row.plan_renewal_price),
    checkedAt: row.checked_at,
  };
}

/** The 30% codes: Approve makes ECOM30- and 6 characters of the student's id (the approve route); any ECOM30 code is the team's. */
const THIRTY_CODE = /^ECOM30/i;

/**
 * Is the code on the membership the team's own 30% code for this request (the
 * render review's fix round)? An ECOM30 code, by its name; or the request's
 * own Whop promo id (the name may not have been read, and then the coupon's
 * `code` is the id); or the very code the request holds.
 */
export function isThirtyCode(
  coupon: Pick<Coupon, "code" | "promoCodeId">,
  request: { promo_code?: string | null; whop_promo_id?: string | null },
): boolean {
  if (coupon.code && THIRTY_CODE.test(coupon.code)) return true;
  if (request.whop_promo_id && coupon.promoCodeId === request.whop_promo_id) return true;
  return Boolean(request.promo_code && coupon.code && coupon.code.toUpperCase() === request.promo_code.toUpperCase());
}

/**
 * An Approved row's warning: a discount on the next renewal that is not the
 * request's own 30% code. The team checks Whop before adding the code, since
 * adding it would replace that discount. No other tab warns.
 */
export function couponWarns(row: Pick<ThirtyRequestRow, "status" | "coupon">): boolean {
  return row.status === "approved" && row.coupon !== null && row.coupon.discounted && !row.coupon.ours;
}

/**
 * The reason an Applied row refused by the coupon starts its Reject with (the
 * render review's fix round). The student reads a rejection's reason on
 * their map's 30% panel, so since its second round this is the map's own
 * sentence for a discount already on the account, the owner's words
 * (MEMBERSHIP_DISCOUNT_LINE): spoken to the student, naming no code. It was
 * "Already has a discount on their membership (evolve10)", the team's words
 * about the student. The team can still change it before sending; the code
 * stays on the row's verdict line for the team.
 */
export const COUPON_REJECT_REASON = MEMBERSHIP_DISCOUNT_LINE;

/** The first payment and the deadline, with no counts: the progress could not be read. */
function factsWithoutProgress(firstPaidAt: string | null, now: Date): Facts {
  const w = discountWindow(firstPaidAt);
  const deadline = "closed" in w ? null : w.endsAt.toISOString();
  return {
    firstPaidAt,
    window: "closed" in w ? null : w.window,
    deadline,
    deadlinePassed: deadline != null && now.getTime() > Date.parse(deadline),
    videosDone: null,
    videosTotal: null,
    countedByDeadline: false,
    secondsLeft: null,
  };
}

/** The counts over the lessons the offer asks for (`lessons`, as discount.ts reads them) and the videos `done`. */
function countFacts(
  firstPaidAt: string | null,
  lessons: readonly DiscountLesson[],
  done: ReadonlySet<string>,
  now: Date,
  countedByDeadline: boolean,
): Facts {
  const required = requiredLessons(lessons);
  const left = required.filter((l) => !done.has(l.id));
  return {
    ...factsWithoutProgress(firstPaidAt, now),
    videosDone: required.length - left.length,
    videosTotal: required.length,
    countedByDeadline,
    secondsLeft: left.reduce((sum, l) => sum + (l.duration_seconds ?? 0), 0),
  };
}

/**
 * The 30% as the student app computes it: the request routes' discountState
 * call (decideDiscountRequest), every video done up to now, every request of
 * the student. Null when a read failed.
 */
export function studentAppView(reads: DiscountReads, now: Date): { state: DiscountState; facts: Facts } | null {
  const f = factsFromReads(reads);
  if (!f.ok) return null;
  const { firstPaidAt, lessons, completions, requests } = f.facts;
  const done = videoDoneIds(completions);
  return {
    state: discountState({ now, firstPaidAt, lessons, videoDoneIds: done, requests }),
    facts: countFacts(firstPaidAt, lessons, done, now, false),
  };
}

/**
 * What approvalVerdict judged a request by, rebuilt from the same reads: the
 * lessons with the videos loaded after the request (or after the switch, for
 * a request made before it) left out, and the videos done by the deadline.
 * These lines repeat approvalVerdict's own (discount-server.ts); the test
 * fails if the two ever part, because the verdict must say yes exactly when
 * this count is full.
 */
function judgedFacts(f: DiscountFacts, videos: readonly VideoRow[], now: Date, askedAt: string, resetAt: string | null): Facts {
  const asked = Date.parse(askedAt);
  const reset = resetAt == null ? NaN : Date.parse(resetAt);
  const videosAsOf = Number.isFinite(asked) && Number.isFinite(reset) && reset > asked ? reset : asked;
  const loadedLater = new Set(
    Number.isFinite(videosAsOf)
      ? videos.filter((v) => v.created_at != null && Date.parse(v.created_at) > videosAsOf).map((v) => v.lesson_id)
      : [],
  );
  const lessons = f.lessons.map((l) => (loadedLater.has(l.id) ? { ...l, has_video: false } : l));
  const endsAt = discountEndsAt(f.firstPaidAt);
  const done = videoDoneIds(f.completions, endsAt ?? undefined);
  return countFacts(f.firstPaidAt, lessons, done, now, endsAt != null && now.getTime() > endsAt.getTime());
}

function refusalText(reason: VerdictReason, oldCourse: boolean, deadlinePassed: boolean): string {
  let text: string;
  switch (reason) {
    case "locked":
      text = deadlinePassed ? VERDICT_TEXT.lockedClosed : VERDICT_TEXT.lockedOpen;
      break;
    case "no-gate":
      if (oldCourse) return VERDICT_TEXT.oldCourseNoGate;
      text = VERDICT_TEXT.noGate;
      break;
    case "before-launch":
      text = VERDICT_TEXT.beforeLaunch;
      break;
    case "no-payment":
      text = VERDICT_TEXT.noPayment;
      break;
    case "late-request":
      text = VERDICT_TEXT.lateRequest;
      break;
    case "another-request":
      text = VERDICT_TEXT.anotherRequest;
      break;
    case "read-failed":
      text = VERDICT_TEXT.readFailed;
      break;
    default:
      text = VERDICT_TEXT.unknown;
  }
  return oldCourse ? `${VERDICT_TEXT.oldCourse} ${text}` : text;
}

/** The approve route's answer as the page shows it. */
function toVerdict(raw: ApprovalVerdict, explained: ApprovalVerdict, deadlinePassed: boolean): Verdict {
  if (explained.ok) return { ok: true, reason: null, text: VERDICT_TEXT.yes, oldCourse: false };
  if (explained.status === 500) {
    return { ok: false, reason: "read-failed", text: VERDICT_TEXT.readFailed, oldCourse: false };
  }
  const oldCourse = !raw.ok && explained.error !== raw.error;
  const reason: VerdictReason = explained.reason ?? "unknown";
  return { ok: false, reason, text: refusalText(reason, oldCourse, deadlinePassed), oldCourse };
}

/**
 * A pending request as the rule judges it now (C9): approvalVerdict, then
 * explainOldCourseRequest for a refusal of one made before the switch. The
 * facts are the ones the verdict judged. The coupon comes before it
 * (buildThirtyView).
 */
export function judgeRequest(
  reads: DiscountReads,
  now: Date,
  request: { id: string; created_at: string },
  resetAt: string | null,
): { verdict: Verdict; facts: Facts } {
  const raw = approvalVerdict(reads, now, request.created_at, request.id, resetAt);
  const explained = !raw.ok && raw.status === 400 ? explainOldCourseRequest(raw, request.created_at, resetAt) : raw;
  const f = factsFromReads(reads);
  const facts = f.ok
    ? judgedFacts(f.facts, reads.videos.data!, now, request.created_at, resetAt)
    : factsWithoutProgress(reads.student.data?.first_paid_at ?? null, now);
  return { verdict: toVerdict(raw, explained, facts.deadlinePassed), facts };
}

/** The verdict for a student whose membership already has a discount on its next renewal: the approve route's words, no override. */
export function couponVerdict(coupon: Coupon): Verdict {
  return { ok: false, reason: "has-discount", text: couponApprovalRefusal(coupon.code), oldCourse: false };
}

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * The page's answer. `live`: Whop's answers now for the students holding an
 * approved request (readApprovedCoupons); an Approved row shows that coupon,
 * or the stored one when Whop said nothing, or that it could not check.
 */
export function buildThirtyView(
  data: ThirtyData,
  now: Date,
  resetAt: string | null,
  live?: ReadonlyMap<string, LiveCoupon>,
): ThirtyView {
  const students = new Map(data.students.map((s) => [s.id, s] as const));
  const ref = (id: string | null): TeamRef | null => (id ? { id, name: data.team.get(id) ?? null } : null);
  const brief = (s: ThirtyStudent): StudentBrief => ({
    id: s.id,
    name: s.name ?? null,
    email: s.email ?? null,
    username: s.discord_username ?? null,
    status: s.membership_status,
    whopPulled: whopPulled(data.lastSyncAt.get(s.id), resetAt),
  });

  const requests = [...data.requests]
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || byId(a, b))
    .map((r): ThirtyRequestRow => {
      // loadThirtyData reads every student holding a listed request, or fails.
      const s = students.get(r.student_id)!;
      const stored = couponOf(data.coupons.data?.get(s.id), s);
      // Whop is asked by membership id only: with no id, or a payment's, nothing can be checked.
      const askable = isMembershipId(s.whop_membership_id);
      let coupon = stored;
      let couponCheck: CouponCheck =
        data.coupons.data === null ? "unread" : stored ? "stored" : askable ? "not-checked" : "no-membership";
      if (r.status === "approved" && live) {
        const answer = live.get(s.id);
        const fresh = answer?.ok ? couponOf(answer.row, s) : null;
        if (fresh) {
          coupon = fresh;
          couponCheck = "live";
        } else if (!stored) {
          couponCheck = askable ? "failed" : "no-membership";
        }
      }
      // The team's own 30% code on the membership, on a decided row: theirs, never a warning.
      if (coupon && (r.status === "approved" || r.status === "applied") && isThirtyCode(coupon, r)) {
        coupon = { ...coupon, ours: true };
      }
      let facts: Facts | null = null;
      let verdict: Verdict | null = null;
      if (r.status === "pending") {
        const judged = judgeRequest(data.reads.get(s.id)!, now, r, resetAt);
        facts = judged.facts;
        // D5 first: a discount on the next renewal decides, whatever the rule says.
        verdict = coupon?.discounted ? couponVerdict(coupon) : judged.verdict;
      }
      return {
        id: r.id,
        status: r.status,
        askedAt: r.created_at,
        reviewedAt: r.reviewed_at ?? null,
        reviewedBy: ref(r.reviewed_by ?? null),
        appliedAt: r.applied_at ?? null,
        appliedBy: ref(r.applied_by ?? null),
        promoCode: r.promo_code ?? null,
        rejectionReason: r.rejection_reason ?? null,
        student: brief(s),
        facts,
        verdict,
        coupon,
        couponCheck,
      };
    });

  return {
    generatedAt: now.toISOString(),
    sharedDeadline: DISCOUNT_SHARED_DEADLINE,
    listedFrom: DISCOUNT_ELIGIBLE_FROM,
    requiredCount:
      data.catalog.data && data.videos.data
        ? requiredLessons(toDiscountLessons(data.catalog.data, new Set(data.videos.data.map((v) => v.lesson_id)))).length
        : null,
    couponsUnread: data.coupons.data === null,
    requests,
  };
}
