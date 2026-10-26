/**
 * The 30% that applies itself (T-137): the one step that puts a student's 30%
 * on Whop, shared by the request routes (the student's Apply), the job
 * (GET /api/cron/apply-thirty, every 10 minutes) and the team's Approve and
 * Try again, so the rules live in one place.
 *
 *   thirtyApprovalChecks  the approve route's checks, moved here: the coupon,
 *                         the paid plan and the payment, the 30% rule. The
 *                         route and the job run them before a fresh code.
 *   putThirtyOn           claims the request, makes its code, attaches it
 *                         to the student's course membership and marks the
 *                         request applied once Whop names the code there.
 *   settleClaim           a claim whose answer was lost: is its code on Whop?
 *   whereIsCode           whose membership holds a code, if any.
 *   thirtyCodeName        a new code's name: ECOM30- and 6 random characters.
 *   thirtyAutoApplyPaused THIRTY_AUTO_APPLY, the switch the request routes and
 *                         the job read before they put the 30% on.
 *
 * THE CLAIM. A code is made by one actor only. The request is claimed first
 * (promo_code set to the new name, promo_claimed_at to now, only while it is
 * pending and holds no code), and only the claim's holder asks Whop to make
 * it. A claim under 5 minutes old is someone's work in progress and is left
 * alone. An older one lost its answer: its code is looked for on Whop by its
 * name (settleClaim) before anything new is made, and released only as it
 * was read.
 *
 * NOTHING IS MARKED APPLIED unless Whop names the request's own code id (a
 * non-null whop_promo_id starting promo_) on the student's own membership:
 * the attach's answer, or Whop's list of the memberships holding the code
 * (whereIsCode). Every write that changes status, promo_code or
 * whop_promo_id carries the audit columns v116's trigger turns into an event
 * (audit_actor, audit_correlation_id, and for the team audit_team_member_id),
 * and every failed attempt inserts an attempt_failed event with its reason.
 * A value read as NULL is matched with .is(), never .eq().
 *
 * WHAT IS LEFT TO THE TEAM, never done by the app on its own (auto, job):
 * a trial, a request reopened by hand whose code is on nobody's membership, a
 * code with no Whop id, a code with the old per-student name, a student who
 * already holds a 30% that went through, a coupon answer that is not Whop's
 * own now. The team's Approve and Try again go past the trial and the old
 * name.
 *
 * Never throws for Whop: every Whop answer becomes an outcome. It throws only
 * for a database read or write the design gives no outcome for (the row or
 * the student unreadable, a claim or an applied write refused by the
 * database), and when the deployment names no course product, so the caller
 * logs it and the request stays for the job or the team. PRD:
 * _admin/prds/thirty-automatic/thirty_automatic_prd.md in the workspace, §8,
 * §9.2 and §9.3.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { randomInt, randomUUID } from "crypto";
import { DISCOUNT_WINDOW_DAYS } from "./constants.ts";
import { CATALOG_IS_V2, LESSONS_TABLE } from "./stub-server.ts";
import { getCurriculumResetAt } from "./curriculum-reset.ts";
import { WhopCallError, createWhopPromoCode } from "./stub-admin.ts";
import {
  MEMBERSHIP_DISCOUNTS_TABLE,
  applyWhopPromoCode,
  checkMembershipDiscount,
  courseProductIds,
  findMembershipsWithCode,
  findThirtyCodeByName,
  idOf,
  isMembershipId,
  newReadContext,
  readMembershipForApply,
  teamThirtyCodeFor,
  type CouponCheck,
  type WhopReadContext,
} from "./membership-discount.ts";
import {
  REQUEST_COLUMNS,
  UNPAID_APPROVAL,
  approvalVerdict,
  couponApprovalRefusal,
  couponUncheckedApprovalRefusal,
  explainOldCourseRequest,
  holdsAnotherThirty,
  loadDiscountReads,
} from "./discount-server.ts";
import type { DiscountRequestRow } from "./discount.ts";
import type { ThirtyReason } from "./thirty-words.ts";

/** A claim younger than this is another actor's work in progress: left alone (§6). */
export const CLAIM_IN_PROGRESS_MS = 300_000;

/**
 * The switch (R7): THIRTY_AUTO_APPLY set to off, false, 0 or no (any case,
 * spaces around it ignored) pauses the automatic part, the 30% put on in the
 * student's own request and the job; unset, or anything else, it runs. The
 * team's Approve, Try again and Reject work either way.
 */
export function thirtyAutoApplyPaused(value: string | undefined = process.env.THIRTY_AUTO_APPLY): boolean {
  return value !== undefined && ["off", "false", "0", "no"].includes(value.trim().toLowerCase());
}
/** A lost claim's code is looked for among the codes made from this long before the claim. */
const CLAIM_LOOKBACK_MS = 5 * 60_000;
/** With less than this left before the deadline, no Whop call starts. */
const LAST_CALL_MS = 2_000;
/** A Whop call waits at most this long, and stops a second before the deadline. */
const CALL_MS = 8_000;
/** The statuses a membership takes a code in. A membership set to cancel at the end of its period is still active (R3). */
const ATTACHABLE = new Set(["active", "trialing", "canceling"]);
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * A new code's name (R2): ECOM30- and 6 characters of CODE_ALPHABET (no 0, 1,
 * I or O), each by crypto.randomInt(32). Every code has its own: Whop lets
 * two codes share a name and attaches by name, so a name made per student
 * (teamThirtyCodeFor, until this build) could pick the wrong one.
 */
export function thirtyCodeName(): string {
  let name = "ECOM30-";
  for (let i = 0; i < 6; i++) name += CODE_ALPHABET[randomInt(32)];
  return name;
}

/** Whop's id for a code the app made: a non-null whop_promo_id starting promo_. */
const isOurId = (id: string | null | undefined): id is string => typeof id === "string" && id.startsWith("promo_");
/** A renewal price of exactly 0, in cents. */
const isZero = (price: number) => Math.round(price * 100) === 0;
/** Whop's words as an event stores them: at most 300 characters. */
const cut = (s: string | null) => (s !== null && s.length > 300 ? s.slice(0, 300) : s);

// ── The approve route's checks ───────────────────────────────────────────────

/**
 * The refusals Approve anyway skips with `override`: the 30% rule said no, or
 * a read it needs failed, the coupon check gave no answer, and Whop does not
 * show both a paid course plan and a course payment that went through
 * (UNPAID_APPROVAL).
 */
const RULE = { code: "rule" } as const;

/** The checks' answer: go on, with the coupon check's answer (null when Approve anyway skipped it), or the route's refusal. */
export type ApprovalChecks =
  | { ok: true; coupon: CouponCheck | null }
  | { ok: false; status: number; body: { error: string; code?: "rule" | "has-discount" } };

/**
 * POST /api/discounts/approve's checks, moved here from the route as they
 * were, so the job runs the same ones before it makes a new code (§9.3). The
 * route's comments on each check stay with it below. `request` is the
 * pending request being approved; the route reads it and refuses one that is
 * missing or already decided before this runs. `store` is handed to the
 * coupon check (false: Whop's answer is not stored, the job's dry run).
 * `teamMemberId` is named in the Approve anyway log line. The answer is the
 * route's own: every refusal's status and body as the route answered them.
 */
export async function thirtyApprovalChecks(
  db: SupabaseClient,
  request: { id: string; student_id: string; created_at: string },
  opts: { override?: boolean; overrideCoupon?: boolean; store?: boolean; teamMemberId?: string | null },
): Promise<ApprovalChecks> {
  const override = opts.override === true;
  const overrideCoupon = opts.overrideCoupon === true;
  const requestId = request.id;

  const { data: studentRow } = await db
    .from("students")
    .select("id, joined_at, first_paid_at")
    .eq("id", request.student_id)
    .single();

  if (!studentRow) {
    return { ok: false, status: 404, body: { error: "Student not found" } };
  }

  // D5: a discount already on the next renewal, before the rule and before
  // `override`. No Whop code is made for this student, unless a founder or an
  // admin pressed Approve anyway on the row the coupon refuses
  // (`overrideCoupon`): then Whop is not asked at all. A check that gave no
  // answer is remembered, and refuses the normal Approve after the rule.
  let couponUnchecked: { liveFail: string | null } | null = null;
  // No paid course plan and payment that went through (the owner, 2026-10-26): no 30%, unless Approve anyway skips it.
  let unpaid = false;
  let coupon: CouponCheck | null = null;
  if (!overrideCoupon) {
    coupon = await checkMembershipDiscount(db, request.student_id, { store: opts.store });
    if (coupon.discounted) {
      return { ok: false, status: 400, body: { error: couponApprovalRefusal(coupon.code), code: "has-discount" } };
    }
    if (coupon.source === "none") couponUnchecked = { liveFail: coupon.liveFail };
    unpaid = coupon.unpaid;
  }
  if (unpaid && !override) {
    console.warn(
      `[discount approve] request ${requestId}: nothing approved, Whop does not show both a paid course plan and a course payment that went through for the student`,
    );
    return { ok: false, status: 400, body: { error: UNPAID_APPROVAL, ...RULE } };
  }

  if (CATALOG_IS_V2) {
    // The new course: the request route's rule (src/lib/world/discount.ts),
    // judged at the end of the student's window (their 14 days, or 23
    // October for a first payment before the launch). `override` skips it,
    // as it skips every gate of the old rule below.
    if (!override) {
      const reads = await loadDiscountReads(db, request.student_id, LESSONS_TABLE);
      // The course switch: a request made before it is judged by the videos
      // the new course had at the switch, and a refusal of it over the videos
      // says it was made on the old course. The date can change the verdict,
      // so a failed read of it approves nothing.
      let resetAt: string | null;
      try {
        resetAt = await getCurriculumResetAt(db);
      } catch (e) {
        console.error(
          `[discount approve] request ${requestId}: nothing approved, the course switch could not be read: ${e instanceof Error ? e.message : String(e)}`,
        );
        return {
          ok: false,
          status: 500,
          body: { error: "Couldn't read the course switch date, so nothing was approved. Try again.", ...RULE },
        };
      }
      // The request's id too: approvalVerdict also refuses a request the
      // app's Apply could not have made (late, or after another counted one).
      let verdict = approvalVerdict(reads, new Date(), request.created_at, request.id, resetAt);
      if (!verdict.ok && verdict.status === 400) {
        // A request made before the switch, refused over its videos, gets a
        // refusal that says so; one refused over the first payment keeps its
        // words.
        verdict = explainOldCourseRequest(verdict, request.created_at, resetAt);
      }
      if (!verdict.ok) {
        if (verdict.log) console.error(`[discount approve] request ${requestId}: ${verdict.log}`);
        return { ok: false, status: verdict.status, body: { error: verdict.error, ...RULE } };
      }
    }
  } else {
    // v75.20: anchor on first_paid_at (original signup), not joined_at
    // (current cycle start). Returning customers can't get a fresh
    // 14-day discount window from a renewal.
    // v75.26: NULL first_paid_at → block at the FINAL approval gate.
    // This is the last line of defense if the request/feedback gates
    // were somehow bypassed. The admin must manually verify the
    // student's signup history and backfill first_paid_at before
    // approving.
    if (!override && !studentRow.first_paid_at) {
      return {
        ok: false,
        status: 400,
        body: {
          error:
            "Cannot approve: student has no first_paid_at on file. Run the Whop sync (Refresh on /admin) to backfill, then retry. If still NULL, this student's Whop membership history needs manual review.",
          ...RULE,
        },
      };
    }
    // `?? 0` only matters under override (first_paid_at can be null then);
    // the resulting deadline is unused because the window check below is
    // also override-gated.
    const joinedAt = new Date(studentRow.first_paid_at ?? 0);
    const deadline = new Date(joinedAt.getTime() + DISCOUNT_WINDOW_DAYS * 86_400_000);

    // Eligibility re-check (server-side, same rule as /api/discounts/request):
    //   - Compound action items (requires_action=true): need BOTH
    //     completed_at AND action_completed_at.
    //   - Other lessons: completed_at OR skipped_at counts as done.
    const [{ data: requiredLessons }, { data: completions }] = await Promise.all([
      db.from("lessons").select("id, requires_action").in("region_id", ["r1", "r2"]),
      db
        .from("student_lesson_completions")
        .select("lesson_id, completed_at, action_completed_at, skipped_at")
        .eq("student_id", request.student_id),
    ]);

    const required = requiredLessons ?? [];
    // Fails closed (cutover PRD, C22, WI-9), as the request route does: an
    // empty r1 + r2 list means the new course's data met a build without
    // CATALOG_SHAPE=v2, or the read failed, and every check below would pass.
    // "Generate anyway" skips the checks, as it does today.
    if (!override && required.length === 0) {
      return {
        ok: false,
        status: 409,
        body: { error: "The course changed and this check cannot run. Nothing was approved.", ...RULE },
      };
    }
    const completionMap = new Map<
      string,
      {
        completed_at: string | null;
        action_completed_at: string | null;
        skipped_at: string | null;
      }
    >();
    for (const c of completions ?? []) {
      completionMap.set(c.lesson_id, {
        completed_at: c.completed_at,
        action_completed_at: c.action_completed_at,
        skipped_at: c.skipped_at,
      });
    }

    let latestCompletion = joinedAt;
    for (const lesson of required) {
      const c = completionMap.get(lesson.id);
      const watchDone = c?.completed_at != null;
      const actionDone = c?.action_completed_at != null;
      const skipped = c?.skipped_at != null;
      const fullyDone = lesson.requires_action ? watchDone && actionDone : watchDone || skipped;
      if (!override && !fullyDone) {
        return {
          ok: false,
          status: 400,
          body: { error: "Student has not completed all required R1 + R2 lessons", ...RULE },
        };
      }
      for (const ts of [c?.completed_at, c?.action_completed_at, c?.skipped_at]) {
        if (ts) {
          const d = new Date(ts);
          if (d > latestCompletion) latestCompletion = d;
        }
      }
    }

    if (!override && latestCompletion > deadline) {
      return {
        ok: false,
        status: 400,
        body: { error: "Student finished R1 + R2 after the discount window closed", ...RULE },
      };
    }
  }

  // T-122's fourth fix round: the coupon check gave no answer (Whop down or
  // refusing, nothing stored that answers), so the normal Approve makes no
  // code for a student who may hold a coupon. Approve anyway (`override`)
  // still goes on, its log line saying the check gave no answer.
  if (couponUnchecked !== null && !override) {
    console.warn(
      `[discount approve] request ${requestId}: nothing approved, the coupon check gave no answer (${couponUnchecked.liveFail ?? "no answer"})`,
    );
    return { ok: false, status: 503, body: { error: couponUncheckedApprovalRefusal(couponUnchecked.liveFail), ...RULE } };
  }

  if (override || overrideCoupon) {
    const skipped = [
      override ? "Eligibility gates skipped." : null,
      overrideCoupon ? "The coupon check skipped." : null,
      couponUnchecked !== null ? "The coupon check gave no answer." : null,
      unpaid ? "Whop does not show both a paid course plan and a course payment that went through." : null,
    ]
      .filter(Boolean)
      .join(" ");
    console.warn(
      `[discount approve] OVERRIDE by team member ${opts.teamMemberId}, request ${requestId}, student ${request.student_id}. ${skipped}`,
    );
  }

  return { ok: true, coupon };
}

// ── The student, and where a code sits ──────────────────────────────────────

/** A student as the step reads them: the Whop user, the two membership ids on file, the first payment. */
export interface ThirtyStudent {
  id: string;
  whopUserId: string | null;
  /** students.whop_membership_id: kept current by the webhook (it can hold a pay_ id). */
  membershipOnFile: string | null;
  /** student_membership_discounts.whop_membership_id: the membership the coupon check last settled on. */
  membershipStored: string | null;
  firstPaidAt: string | null;
}

/** The student and their stored coupon row's membership. Throws when either read fails, or the student is not there. */
export async function readThirtyStudent(db: SupabaseClient, studentId: string): Promise<ThirtyStudent> {
  const [s, d] = await Promise.all([
    db.from("students").select("whop_user_id, whop_membership_id, first_paid_at").eq("id", studentId).maybeSingle(),
    db.from(MEMBERSHIP_DISCOUNTS_TABLE).select("whop_membership_id").eq("student_id", studentId).maybeSingle(),
  ]);
  if (s.error || !s.data) {
    throw new Error(`[thirty apply] student ${studentId} could not be read${s.error ? `: ${s.error.message}` : " (no row)"}`);
  }
  if (d.error) throw new Error(`[thirty apply] student ${studentId}'s stored coupon row could not be read: ${d.error.message}`);
  const student = s.data as { whop_user_id: string | null; whop_membership_id: string | null; first_paid_at: string | null };
  const stored = d.data as { whop_membership_id: string | null } | null;
  return {
    id: studentId,
    whopUserId: student.whop_user_id ?? null,
    membershipOnFile: student.whop_membership_id ?? null,
    membershipStored: stored?.whop_membership_id ?? null,
    firstPaidAt: student.first_paid_at ?? null,
  };
}

/**
 * Where a code sits, by Whop's list of the memberships holding it
 * (findMembershipsWithCode): on the student's own course membership
 * (`on_theirs`), on no membership (`nowhere`), on another one (`elsewhere`,
 * its step saying which), or it cannot be told (`unknown`).
 */
export type WhereAnswer =
  | { where: "on_theirs"; membershipId: string }
  | { where: "nowhere" }
  | { where: "elsewhere"; step: "free" | "other_product" | "other_person"; membershipId: string; product: string | null }
  | { where: "unknown"; step: "where" | "where_filter" | "where_no_ids"; fail: string | null };

/**
 * Whose membership holds `promoId` (§9.3). A row naming another code means
 * Whop ignored the filter (`unknown`, where_filter). A row is the student's
 * when both user ids are there and equal; when either is missing (a business
 * buyer has none), when its id is one of the student's membership ids on file
 * (`mem_` ids only); with nothing to compare, `unknown` (where_no_ids). The
 * student's row of the course (a row naming no product counts as the
 * course's) is `on_theirs`, unless it renews at exactly 0 (`elsewhere`,
 * free); a null renewal price is a membership that will not renew, set to
 * cancel among them, still theirs (R3). Their row of another product is
 * `elsewhere` (other_product), another person's `elsewhere` (other_person). A
 * row on theirs wins; a row that cannot be compared comes before one that is
 * elsewhere. A failed read, or no course product named, is `unknown` (where).
 */
export async function whereIsCode(promoId: string, student: ThirtyStudent, ctx: WhopReadContext): Promise<WhereAnswer> {
  const course = courseProductIds();
  if (course.size === 0) return { where: "unknown", step: "where", fail: "no_course_product" };
  const r = await findMembershipsWithCode(promoId, ctx);
  if (!r.ok) return { where: "unknown", step: "where", fail: r.fail };
  if (r.memberships.length === 0) return { where: "nowhere" };
  if (r.memberships.some((m) => m.promoCodeId !== promoId)) return { where: "unknown", step: "where_filter", fail: null };
  const ownIds = [student.membershipOnFile, student.membershipStored].filter((id): id is string => isMembershipId(id));
  let cannotTell = false;
  let elsewhere: Extract<WhereAnswer, { where: "elsewhere" }> | null = null;
  for (const m of r.memberships) {
    let theirs: boolean;
    if (m.userId !== null && student.whopUserId !== null) theirs = m.userId === student.whopUserId;
    else if (ownIds.length > 0) theirs = ownIds.includes(m.id);
    else {
      cannotTell = true;
      continue;
    }
    const step = !theirs
      ? "other_person"
      : m.productId !== null && !course.has(m.productId)
        ? "other_product"
        : m.renewalPrice !== null && isZero(m.renewalPrice)
          ? "free"
          : null;
    if (step === null) return { where: "on_theirs", membershipId: m.id };
    elsewhere ??= { where: "elsewhere", step, membershipId: m.id, product: m.productTitle };
  }
  if (cannotTell) return { where: "unknown", step: "where_no_ids", fail: null };
  return elsewhere ?? { where: "unknown", step: "where", fail: null };
}

/**
 * A lost claim (a code name with no Whop id, 5 minutes old or more, or with
 * no claim time): is its code on Whop? Looks it up by name among the codes
 * made from 5 minutes before the claim (findThirtyCodeByName). A read only:
 * the writes that follow stay with putThirtyOn and Reject. `db` is the
 * caller's client, unused by the read itself.
 */
export async function settleClaim(
  db: SupabaseClient,
  row: { promo_code: string; promo_claimed_at: string | null; created_at: string },
  ctx: WhopReadContext,
): Promise<{ found: string } | { notFound: true } | { failed: string }> {
  const claimed = row.promo_claimed_at === null ? NaN : Date.parse(row.promo_claimed_at);
  const from = Number.isFinite(claimed) ? claimed : Date.parse(row.created_at);
  if (!Number.isFinite(from)) return { failed: "no_claim_time" };
  const r = await findThirtyCodeByName(row.promo_code, new Date(from - CLAIM_LOOKBACK_MS).toISOString(), ctx);
  if (!r.ok) return { failed: r.fail };
  return r.id !== null ? { found: r.id } : { notFound: true };
}

// ── The step ─────────────────────────────────────────────────────────────────

/** The request as the step reads it. `audit_actor` is read so a database without v116 answers 42703 before anything is done. */
const ROW_COLUMNS = "id, student_id, status, promo_code, promo_claimed_at, whop_promo_id, created_at, audit_actor";
type Status = "pending" | "approved" | "rejected" | "applied";
interface RequestRow {
  id: string;
  student_id: string;
  status: Status;
  promo_code: string | null;
  promo_claimed_at: string | null;
  whop_promo_id: string | null;
  created_at: string;
}

/**
 * A request's shape (§6), which putThirtyOn and Reject branch on. Pending:
 * `reopened` (a Whop id on it: reopened by hand), `unclaimed` (no code
 * name), `in_progress` (a name and a claim under 5 minutes old), `settling`
 * (a name, its claim 5 minutes old or more, or no claim time). Approved:
 * `approved` (our id), `code_unknown` (no Whop id the app can ask about).
 * Applied and rejected: `decided`.
 */
export type RequestShape = "unclaimed" | "in_progress" | "settling" | "reopened" | "approved" | "code_unknown" | "decided";

export function requestShape(
  row: { status: string; promo_code: string | null; promo_claimed_at: string | null; whop_promo_id: string | null },
  nowMs: number,
): RequestShape {
  if (row.status === "applied" || row.status === "rejected") return "decided";
  if (row.status === "approved") return isOurId(row.whop_promo_id) ? "approved" : "code_unknown";
  if (row.whop_promo_id !== null) return "reopened";
  if (row.promo_code === null) return "unclaimed";
  const claimed = row.promo_claimed_at === null ? NaN : Date.parse(row.promo_claimed_at);
  return Number.isFinite(claimed) && nowMs - claimed < CLAIM_IN_PROGRESS_MS ? "in_progress" : "settling";
}

/** Who acts: the app in the student's request (auto), the job, or a team member. */
export type ThirtyActorOption = { kind: "auto" } | { kind: "job" } | { kind: "team"; teamMemberId: string };

export interface PutThirtyOnOptions {
  actor: ThirtyActorOption;
  /** One uuid per action, on every write's audit_correlation_id and every event. */
  correlationId: string;
  /** Where to attach first: the coupon check's membership. */
  membershipId?: string | null;
  /** Where the coupon check's answer came from: only Whop's own answer now (`live`) lets the app make a code. */
  couponSource?: CouponCheck["source"];
  /** Every Whop call ends by this moment (milliseconds since the epoch). */
  deadlineMs: number;
  /** Try again: attach a code with the old per-student name. */
  allowOldName?: boolean;
  /** Whether a new code may be made (default true; the job passes "made in the last 48 hours"). */
  allowNewCode?: boolean;
  /** The job: Approve's checks, run before a fresh code (a refusal's sentence is its body.error). */
  freshChecks?: () => ReturnType<typeof thirtyApprovalChecks>;
  /** Read only: nothing claimed, made, attached, stored or recorded. */
  dry?: boolean;
}

export type ThirtyOutcome =
  | "applied"
  | "waiting"
  | "unchanged"
  | "claimed_elsewhere"
  | "decided_meanwhile"
  | "ended_rejected"
  | "write_error"
  | "not_ready"
  | "planned";

export interface ThirtyResult {
  /** The request's status when the step ended (null: the row could not be read, or is gone). */
  status: Status | null;
  outcome: ThirtyOutcome;
  /** The request's code as this attempt knows it: its name, and its Whop id. */
  promoCode: string | null;
  whopPromoId: string | null;
  /** Why it is still waiting (an attempt_failed event's reason), and the step that said so. */
  reason: ThirtyReason | null;
  step: string | null;
  /** Whop's words, a check's sentence, or why a read failed. */
  message: string | null;
  membershipStatus: string | null;
  /** Dry run: what a real run would do. */
  would?: "mark_applied" | "claim_and_make" | "attach" | "settle_claim";
  /** Dry run on a lost claim: whether its code was found on Whop. */
  found?: boolean;
  /** attach_after_reject: whether Whop showed the code attached. */
  confirmed?: boolean;
}

type Failure = {
  step?: string | null;
  http?: number | null;
  message?: string | null;
  membershipStatus?: string | null;
  product?: string | null;
  /** The code the event and the answer name, when it is not the row's (a name released, a code made but not saved). */
  code?: string | null;
  whopPromoId?: string | null;
  /** More for the event's detail. */
  extra?: Record<string, unknown>;
  outcome?: ThirtyOutcome;
  confirmed?: boolean;
};

/** The membership the code goes on, as Whop read it. */
type Target = { id: string; status: string | null; promoCodeId: string | null; renewalPrice: number | null };

const ANOTHER_THIRTY = "This student already has a 30% request that went through.";

/** Approve's exact body for a new code (POST /promo_codes): 30% off one month, used once. */
function thirtyCodeBody(code: string) {
  // Optional plan scoping. If WHOP_DISCOUNT_PLAN_IDS is set, the code only
  // works on those plans (comma-separated plan ids); unset, Whop's default
  // is every plan on the company.
  const planIds = process.env.WHOP_DISCOUNT_PLAN_IDS?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    code,
    amount_off: 30,
    promo_type: "percentage" as const,
    base_currency: "usd",
    new_users_only: false,
    one_per_customer: true,
    stock: 1,
    promo_duration_months: 1,
    ...(planIds && planIds.length > 0 ? { plan_ids: planIds } : {}),
  };
}

/**
 * Puts the 30% on for one request (§9.3): read and sort it; hold for the team
 * what the app leaves to them; ask Whop where its code is (approved, a hand
 * reopen, a lost claim's code found) and where to attach it; claim it and
 * make its code (pending); attach the code (approved with our id); mark it
 * applied once Whop names the code on the student's own membership. Every
 * Whop call ends by `opts.deadlineMs`: under 2 seconds left, none starts
 * (whop_no_answer, step deadline), and each waits min(time left less 1
 * second, 8 seconds). Each failure inserts one attempt_failed event (never in
 * a dry run); an event that cannot be written is logged and stops nothing.
 */
export async function putThirtyOn(db: SupabaseClient, requestId: string, opts: PutThirtyOnOptions): Promise<ThirtyResult> {
  const team = opts.actor.kind === "team" ? opts.actor.teamMemberId : null;
  // The app on its own (the student's Apply, the job): what it leaves to the team is held.
  const byApp = opts.actor.kind !== "team";
  const audit = { audit_actor: opts.actor.kind, audit_correlation_id: opts.correlationId, audit_team_member_id: team };
  const ctx = newReadContext(process.env.WHOP_API_KEY ?? "");
  /** How long the next Whop call may take, or null when under 2 seconds are left. */
  const callLimit = (): number | null => {
    const left = opts.deadlineMs - Date.now();
    return left < LAST_CALL_MS ? null : Math.min(left - 1_000, CALL_MS);
  };
  /** The read context, limited to `ms` from now. */
  const readsFor = (ms: number): WhopReadContext => {
    const until = Date.now() + ms;
    ctx.startBy = until;
    ctx.answerBy = until;
    return ctx;
  };

  // 0. Read and sort. A database without v116 has no audit_actor: nothing is done, and nothing asked of Whop.
  const read = await db.from("discount_requests").select(ROW_COLUMNS).eq("id", requestId).maybeSingle();
  if (read.error) {
    if (read.error.code === "42703") {
      return { status: null, outcome: "not_ready", promoCode: null, whopPromoId: null, reason: null, step: null, message: read.error.message, membershipStatus: null };
    }
    throw new Error(`[thirty apply] request ${requestId} could not be read: ${read.error.message}`);
  }
  if (!read.data) {
    return { status: null, outcome: "unchanged", promoCode: null, whopPromoId: null, reason: null, step: null, message: null, membershipStatus: null };
  }
  let row = read.data as RequestRow;

  const answer = (outcome: ThirtyOutcome, more: Partial<ThirtyResult> = {}): ThirtyResult => ({
    status: row.status,
    outcome,
    promoCode: row.promo_code,
    whopPromoId: row.whop_promo_id,
    reason: null,
    step: null,
    message: null,
    membershipStatus: null,
    ...more,
  });

  /** The row as the database has it now. */
  const reread = async (): Promise<RequestRow> => {
    const again = await db.from("discount_requests").select(ROW_COLUMNS).eq("id", row.id).maybeSingle();
    if (again.error || !again.data) {
      throw new Error(`[thirty apply] request ${row.id} could not be read again${again.error ? `: ${again.error.message}` : " (no row)"}`);
    }
    row = again.data as RequestRow;
    return row;
  };

  /** A failed attempt: its event (never in a dry run), and the answer with its reason. */
  const fail = async (reason: ThirtyReason, f: Failure = {}): Promise<ThirtyResult> => {
    const code = f.code !== undefined ? f.code : row.promo_code;
    if (!opts.dry) {
      const detail = {
        step: f.step ?? null,
        http: f.http ?? null,
        message: cut(f.message ?? null),
        membership_status: f.membershipStatus ?? null,
        code,
        product: f.product ?? null,
        ...f.extra,
      };
      try {
        const { error } = await db.from("discount_request_events").insert({
          request_id: row.id,
          student_id: row.student_id,
          event: "attempt_failed",
          actor: opts.actor.kind,
          team_member_id: team,
          correlation_id: opts.correlationId,
          reason,
          detail,
        });
        if (error) console.error(`[thirty apply] request ${row.id}: the ${reason} event was not written: ${error.message}`);
      } catch (e) {
        console.error(`[thirty apply] request ${row.id}: the ${reason} event was not written: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return answer(f.outcome ?? "waiting", {
      promoCode: code,
      whopPromoId: f.whopPromoId !== undefined ? f.whopPromoId : row.whop_promo_id,
      reason,
      step: f.step ?? null,
      message: f.message ?? null,
      membershipStatus: f.membershipStatus ?? null,
      ...(f.confirmed !== undefined ? { confirmed: f.confirmed } : {}),
    });
  };

  if (row.status === "applied" || row.status === "rejected") return answer("unchanged");
  const shape = requestShape(row, Date.now());

  // 1. Held for the team: a claim in progress is someone else's (the team is told so); a code with no Whop id is
  // never asked about, whoever presses (Try again included).
  if (shape === "in_progress") return byApp ? answer("waiting") : answer("claimed_elsewhere");
  if (shape === "code_unknown") return fail("code_unknown");

  if (courseProductIds().size === 0) {
    throw new Error("[thirty apply] WHOP_PRODUCT_ID names no course product, so no membership can be judged; nothing was done");
  }
  const student = await readThirtyStudent(db, row.student_id);

  /** whereIsCode inside the deadline. */
  const where = async (promoId: string): Promise<WhereAnswer | { where: "unknown"; step: "deadline"; fail: null }> => {
    const ms = callLimit();
    if (ms === null) return { where: "unknown", step: "deadline", fail: null };
    return whereIsCode(promoId, student, readsFor(ms));
  };
  /** A code elsewhere, or no telling where: the reason, and the step that said so. */
  const whereFailed = (w: Exclude<Awaited<ReturnType<typeof where>>, { where: "on_theirs" } | { where: "nowhere" }>) =>
    w.where === "elsewhere"
      ? fail("landed_elsewhere", { step: w.step, product: w.product, extra: { membership: w.membershipId } })
      : fail("whop_no_answer", { step: w.step, message: w.fail });

  /**
   * Applied: only while the row is still approved with our id. 0 rows: a
   * rejection that landed meanwhile is recorded (attach_after_reject), any
   * other state answered as it is.
   */
  const markApplied = async (): Promise<ThirtyResult> => {
    const ours = row.whop_promo_id as string;
    const { data, error } = await db
      .from("discount_requests")
      .update({ status: "applied", applied_at: new Date().toISOString(), applied_by: team, ...audit })
      .eq("id", row.id)
      .eq("status", "approved")
      .eq("whop_promo_id", ours)
      .select("id");
    if (error) throw new Error(`[thirty apply] request ${row.id}: Whop shows ${row.promo_code} on the student's membership, but saving applied failed: ${error.message}`);
    if (data && data.length > 0) {
      row = { ...row, status: "applied" };
      return answer("applied");
    }
    const now = await reread();
    if (now.status === "rejected") return endedRejected(true);
    return answer(now.status === "applied" ? "applied" : "unchanged");
  };

  /** Whop holds the code on their membership (or may), and the request was rejected meanwhile: only Whop can take it off. */
  const endedRejected = (confirmed: boolean): Promise<ThirtyResult> => {
    console.error(
      `[thirty apply] request ${row.id}: Whop ${confirmed ? "attached" : "may have attached"} ${row.promo_code} after the request was rejected. It can only come off in Whop.`,
    );
    return fail("write_failed", { step: "attach_after_reject", outcome: "ended_rejected", extra: { confirmed }, confirmed });
  };

  /**
   * 2, where to attach: the candidates in order, each `mem_` one read
   * (readMembershipForApply), passed over for another product, a renewal of
   * exactly 0 or a status that takes no code; the first that fits and renews
   * above 0, else the first that fits. `order`: an approved row prefers the
   * membership on file (the stored one is frozen once a student is
   * approved), a code made in this attempt the stored one (the coupon check
   * just wrote it).
   */
  const whereToAttach = async (first: string | null, order: "approved" | "fresh"): Promise<Target | ThirtyResult> => {
    const course = courseProductIds();
    const ids =
      order === "approved"
        ? [first, student.membershipOnFile, student.membershipStored]
        : [first, student.membershipStored, student.membershipOnFile];
    const tried: Array<{ membership: string; why: string }> = [];
    const fits: Target[] = [];
    // The first course membership passed over for its status alone.
    let notActive: { status: string | null } | null = null;
    for (const id of [...new Set(ids)]) {
      if (id === null || id === undefined) continue;
      if (!isMembershipId(id)) {
        tried.push({ membership: id, why: "not_a_membership" });
        continue;
      }
      const ms = callLimit();
      if (ms === null) return fail("whop_no_answer", { step: "deadline", extra: { candidates: tried } });
      const m = await readMembershipForApply(id, readsFor(ms));
      if (!m.ok) {
        if (m.fail === "not_found" || m.fail === "http_4xx" || m.fail === "not_a_membership") {
          tried.push({ membership: id, why: m.fail });
          continue;
        }
        if (m.fail === "http_401_403") return fail("key_not_allowed", { step: "membership", message: m.fail, extra: { candidates: tried } });
        return fail("whop_no_answer", { step: "membership", message: m.fail, extra: { candidates: tried } });
      }
      if (m.productId !== null && !course.has(m.productId)) {
        tried.push({ membership: id, why: "other_product" });
        continue;
      }
      if (m.renewalPrice !== null && isZero(m.renewalPrice)) {
        tried.push({ membership: id, why: "free" });
        continue;
      }
      if (m.status === null || !ATTACHABLE.has(m.status.toLowerCase())) {
        tried.push({ membership: id, why: `status ${m.status ?? "unknown"}` });
        notActive ??= { status: m.status };
        continue;
      }
      tried.push({ membership: id, why: "fits" });
      fits.push({ id, status: m.status, promoCodeId: m.promoCodeId, renewalPrice: m.renewalPrice });
    }
    const used = fits.find((m) => m.renewalPrice !== null && m.renewalPrice > 0) ?? fits[0];
    if (!used) {
      return notActive
        ? fail("membership_not_active", { step: "membership", membershipStatus: notActive.status, extra: { candidates: tried } })
        : fail("no_membership", { step: "membership", extra: { candidates: tried } });
    }
    if (used.promoCodeId !== null && used.promoCodeId !== row.whop_promo_id) {
      return fail("membership_has_code", { step: "membership", membershipStatus: used.status, extra: { membership: used.id } });
    }
    // A trial is the team's call (R3): the app holds it, the team's Approve and Try again go on.
    if (byApp && used.status?.toLowerCase() === "trialing") {
      return fail("membership_not_active", { step: "membership", membershipStatus: used.status, extra: { membership: used.id } });
    }
    return used;
  };

  /**
   * 5. Attach, the row still approved with our id: a fresh Idempotency-Key
   * every attach. Our id in the answer: applied. Another id: the membership
   * had a code. A refusal: the key, or Whop's words. No code named, or no
   * telling what happened: Whop is asked where the code is, once.
   */
  const attach = async (target: Target): Promise<ThirtyResult> => {
    const now = await reread();
    if (now.status !== "approved" || !isOurId(now.whop_promo_id)) return answer("unchanged");
    if (row.promo_code === null) return fail("code_unknown", { step: "attach" });
    const ms = callLimit();
    if (ms === null) return fail("whop_no_answer", { step: "deadline", membershipStatus: target.status });
    const on = { membershipStatus: target.status, extra: { membership: target.id } };
    const a = await applyWhopPromoCode(target.id, row.promo_code, randomUUID(), ms);
    if (a.ok && a.promoCodeId === row.whop_promo_id) return markApplied();
    if (a.ok && a.promoCodeId !== null) return fail("membership_has_code", { step: "attach", http: 200, ...on });
    if (!a.ok && a.outcome === "refused") {
      return fail(a.http === 401 || a.http === 403 ? "key_not_allowed" : "apply_refused", { step: "attach", http: a.http, message: a.message, ...on });
    }
    const again = callLimit();
    if (again !== null) {
      const w = await whereIsCode(row.whop_promo_id as string, student, readsFor(again));
      if (w.where === "on_theirs") return markApplied();
    }
    const after = await reread();
    if (after.status === "rejected") return endedRejected(false);
    return fail("whop_no_answer", { step: again === null ? "deadline" : "attach", http: a.ok ? 200 : a.http, message: a.ok ? null : a.message, ...on });
  };

  /** 2, 4 and 5 for an approved row with our id: where the code is, where to attach, the old name, the attach. */
  const approvedFlow = async (): Promise<ThirtyResult> => {
    const w = await where(row.whop_promo_id as string);
    if (w.where === "on_theirs") return opts.dry ? answer("planned", { would: "mark_applied" }) : markApplied();
    if (w.where !== "nowhere") return whereFailed(w);
    return attachTo("approved");
  };

  /**
   * Where to attach, then the old name (4: a code named as Approve named it
   * until this build is left to the team; the app on its own never attaches
   * it, `allowOldName` aside), then the attach. The team attaches it with
   * Try again, or with Approve on a request reopened by hand.
   */
  const attachTo = async (order: "approved" | "fresh"): Promise<ThirtyResult> => {
    const target = await whereToAttach(opts.membershipId ?? null, order);
    if ("outcome" in target) return target;
    const old = row.promo_code !== null && row.promo_code.trim().toUpperCase() === teamThirtyCodeFor(row.student_id);
    if (old && byApp && !opts.allowOldName) return fail("old_code");
    if (opts.dry) return answer("planned", { would: "attach" });
    return attach(target);
  };

  /**
   * The approved write: the code exists. Only while the row is still pending
   * with this claim and no Whop id. 0 rows: going on when the row holds this
   * id, else the request was decided meanwhile (the code must be deleted in
   * Whop). A database error leaves the claim, for the job to settle.
   */
  const approvedWrite = async (name: string, id: string): Promise<true | ThirtyResult> => {
    const { data, error } = await db
      .from("discount_requests")
      .update({ status: "approved", whop_promo_id: id, reviewed_at: new Date().toISOString(), reviewed_by: team, ...audit })
      .eq("id", row.id)
      .eq("status", "pending")
      .eq("promo_code", name)
      .is("whop_promo_id", null)
      .select("id");
    if (error) {
      console.error(`[thirty apply] request ${row.id}: Whop made ${name} (${id}), but saving it failed: ${error.message}`);
      return fail("write_failed", {
        step: "approved_write_error",
        outcome: "write_error",
        message: error.message,
        code: name,
        whopPromoId: id,
        extra: { whop_promo_id: id },
      });
    }
    if (data && data.length > 0) {
      row = { ...row, status: "approved", whop_promo_id: id };
      return true;
    }
    const now = await reread();
    if (now.whop_promo_id === id) return true;
    console.error(
      `[thirty apply] request ${row.id}: Whop made ${name} (${id}), but the request had already been decided, so nothing was approved. Delete ${name} in Whop.`,
    );
    return fail("write_failed", {
      step: "decided_meanwhile",
      outcome: "decided_meanwhile",
      code: name,
      whopPromoId: id,
      extra: { whop_promo_id: id },
    });
  };

  /** A claim given back, only as it was read (.is() for a claim time read as NULL). Whether a row was released. */
  const release = async (name: string, claimedAt: string | null): Promise<boolean> => {
    let q = db
      .from("discount_requests")
      .update({ promo_code: null, promo_claimed_at: null, ...audit })
      .eq("id", row.id)
      .eq("status", "pending")
      .eq("promo_code", name)
      .is("whop_promo_id", null);
    q = claimedAt === null ? q.is("promo_claimed_at", null) : q.eq("promo_claimed_at", claimedAt);
    const { data, error } = await q.select("id");
    if (error) {
      console.error(`[thirty apply] request ${row.id}: the claim ${name} could not be given back: ${error.message}`);
      return false;
    }
    if (!data || data.length === 0) return false;
    row = { ...row, promo_code: null, promo_claimed_at: null };
    return true;
  };

  /** 3, unclaimed: claim, then make the code with Approve's body; then the approved write. */
  const claimAndMake = async (): Promise<true | ThirtyResult> => {
    if (callLimit() === null) return fail("whop_no_answer", { step: "deadline" });
    const name = thirtyCodeName();
    const claimedAt = new Date().toISOString();
    const claim = await db
      .from("discount_requests")
      .update({ promo_code: name, promo_claimed_at: claimedAt, ...audit })
      .eq("id", row.id)
      .eq("status", "pending")
      .is("promo_code", null)
      .select("id");
    if (claim.error) throw new Error(`[thirty apply] request ${row.id} could not be claimed: ${claim.error.message}`);
    if (!claim.data || claim.data.length === 0) {
      const now = await reread();
      return answer(now.status === "pending" && now.promo_code !== null ? "claimed_elsewhere" : "unchanged");
    }
    row = { ...row, promo_code: name, promo_claimed_at: claimedAt };
    const ms = callLimit();
    if (ms === null) {
      // Nothing was sent to Whop: the claim goes back.
      await release(name, claimedAt);
      return fail("whop_no_answer", { step: "deadline", extra: { code: name } });
    }
    let made: unknown;
    try {
      made = await createWhopPromoCode(thirtyCodeBody(name), { signal: AbortSignal.timeout(ms) });
    } catch (err) {
      const http = err instanceof WhopCallError ? err.status : null;
      const message = err instanceof Error ? err.message : String(err);
      if (http !== null && http >= 400 && http < 500) {
        // Whop refused: no code was made, so the claim goes back.
        await release(name, claimedAt);
        return fail("code_not_made", { step: "create", http, message, extra: { code: name } });
      }
      // No answer, or Whop failed: the code may exist, so the claim stays for a settle.
      return fail("whop_no_answer", { step: "create", http, message });
    }
    const id = idOf((made as { id?: unknown } | null)?.id);
    if (!isOurId(id)) return fail("whop_no_answer", { step: "create_no_id", http: 200 });
    return approvedWrite(name, id);
  };

  /**
   * A fresh code: an unclaimed row, or a lost claim after its release. The
   * app holds it unless it may make a new one, Approve's checks pass (the
   * job), the student holds no other 30% that went through and the coupon
   * answer is Whop's own now; then where to attach comes before the claim.
   * The team's Approve has run the checks itself: the code first, then where
   * to attach.
   */
  const freshCode = async (): Promise<ThirtyResult> => {
    if (!byApp) {
      if (opts.dry) return answer("planned", { would: "claim_and_make" });
      const made = await claimAndMake();
      if (made !== true) return made;
      return attachTo("fresh");
    }
    if (opts.allowNewCode === false) return answer("waiting");
    let couponSource = opts.couponSource;
    let membershipId = opts.membershipId ?? null;
    if (opts.freshChecks) {
      const checks = await opts.freshChecks();
      if (!checks.ok) return fail("check_refused", { message: checks.body.error });
      couponSource = checks.coupon?.source;
      membershipId = checks.coupon?.membershipId ?? null;
    }
    const others = await db.from("discount_requests").select(REQUEST_COLUMNS).eq("student_id", row.student_id);
    if (others.error) throw new Error(`[thirty apply] request ${row.id}: the student's requests could not be read: ${others.error.message}`);
    if (holdsAnotherThirty((others.data ?? []) as DiscountRequestRow[], student.firstPaidAt, row.id)) {
      return fail("check_refused", { message: ANOTHER_THIRTY });
    }
    if (couponSource !== "live") return fail("whop_no_answer", { step: "coupon_stored" });
    const target = await whereToAttach(membershipId, "fresh");
    if ("outcome" in target) return target;
    if (opts.dry) return answer("planned", { would: "claim_and_make" });
    const made = await claimAndMake();
    if (made !== true) return made;
    return attach(target);
  };

  /** Writes approved on a request reopened by hand, only as it was read; the team's write names the reviewer. */
  const approveReopened = async (asTeam: boolean): Promise<true | ThirtyResult> => {
    const set = asTeam
      ? { status: "approved", reviewed_at: new Date().toISOString(), reviewed_by: team, ...audit }
      : { status: "approved", ...audit };
    const { data, error } = await db
      .from("discount_requests")
      .update(set)
      .eq("id", row.id)
      .eq("status", "pending")
      .eq("whop_promo_id", row.whop_promo_id as string)
      .select("id");
    if (error) throw new Error(`[thirty apply] request ${row.id}: approving the request reopened by hand failed: ${error.message}`);
    if (!data || data.length === 0) {
      await reread();
      return answer("unchanged");
    }
    row = { ...row, status: "approved" };
    return true;
  };

  if (shape === "reopened") {
    const code = row.promo_code ?? (row.whop_promo_id as string);
    if (!byApp) {
      // The team: approved with the reviewer, then on as approved (where the code is first).
      if (opts.dry) return answer("planned", { would: "attach" });
      const approved = await approveReopened(true);
      if (approved !== true) return approved;
      return approvedFlow();
    }
    const w = await where(row.whop_promo_id as string);
    if (w.where === "on_theirs") {
      if (opts.dry) return answer("planned", { would: "mark_applied" });
      const approved = await approveReopened(false);
      if (approved !== true) return approved;
      return markApplied();
    }
    if (w.where === "nowhere") return fail("check_refused", { message: `Reopened by hand with ${code}. Approve attaches that code, or reject it.` });
    return whereFailed(w);
  }

  if (shape === "approved") return approvedFlow();

  if (shape === "settling") {
    const claimName = row.promo_code as string;
    const ms = callLimit();
    if (ms === null) return fail("whop_no_answer", { step: "deadline" });
    const s = await settleClaim(db, { promo_code: claimName, promo_claimed_at: row.promo_claimed_at, created_at: row.created_at }, readsFor(ms));
    if ("failed" in s) return fail("whop_no_answer", { step: "list", message: s.failed });
    if (opts.dry) return answer("planned", { would: "settle_claim", found: "found" in s });
    if ("found" in s) {
      const written = await approvedWrite(claimName, s.found);
      if (written !== true) return written;
      return approvedFlow();
    }
    if (!(await release(claimName, row.promo_claimed_at))) {
      const now = await reread();
      return answer(now.status === "pending" && now.promo_code !== null && now.promo_code !== claimName ? "claimed_elsewhere" : "unchanged");
    }
  }

  return freshCode();
}
