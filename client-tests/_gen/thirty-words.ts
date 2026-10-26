/**
 * The 30% that applies itself (T-137): the history's three lists and the
 * team's words for a request the app could not finish.
 *
 * No imports at all, and nothing here may import server code: the shared step
 * (thirty-apply.ts), the 30% page's builder (thirty-view.ts) and the 30% page
 * itself (ThirtyView.tsx, a client component) all read this file.
 *
 * THE LISTS are v116's check lists, word for word and in the same order
 * (supabase/migrations/2026_v116_discount_request_history.sql, the create
 * table of discount_request_events, one list per line). thirty-apply.test.mjs
 * parses the migration and holds them equal, so a value the app writes is
 * one the database takes.
 *
 * THE WORDS (thirtyWords): a request's Why line on the 30% page and the
 * notices after Approve and Try again. First what went wrong, by the reason
 * and its step; then what happens next, chosen by who will act: the app (an
 * approved row, a claimed row, a pending row under 48 hours) or the team (the
 * app paused, an unclaimed pending row 48 hours or older). A reason the job
 * does not retry, or one whose own words already say what to do, adds no
 * second line.
 */

/** v116's `event` check. */
export const THIRTY_EVENTS = [
  "requested",
  "code_made",
  "applied",
  "rejected",
  "reopened",
  "code_changed",
  "attempt_failed",
  "override",
] as const;
export type ThirtyEvent = (typeof THIRTY_EVENTS)[number];

/** v116's `actor` check: the student's Apply, the app in that request, the job, the team, the SQL editor. */
export const THIRTY_ACTORS = ["student", "auto", "job", "team", "sql"] as const;
export type ThirtyActor = (typeof THIRTY_ACTORS)[number];

/** v116's `reason` check: why an attempt failed (an attempt_failed event's reason). */
export const THIRTY_REASONS = [
  "check_refused",
  "no_membership",
  "membership_not_active",
  "membership_has_code",
  "whop_no_answer",
  "key_not_allowed",
  "code_not_made",
  "apply_refused",
  "landed_elsewhere",
  "write_failed",
  "old_code",
  "code_unknown",
] as const;
export type ThirtyReason = (typeof THIRTY_REASONS)[number];

/** The job makes a new code only for a request made in the last 48 hours (R1). */
export const JOB_NEW_CODE_WINDOW_MS = 48 * 60 * 60 * 1000;
const JOB_NEW_CODE_WINDOW_HOURS = JOB_NEW_CODE_WINDOW_MS / 3_600_000;

/**
 * What the words need to know about the request and its last failure.
 * `claimed` comes from the row itself (a promo_code with no whop_promo_id),
 * never from a failure's code. `code` is the request's code as the sentence
 * names it; `product` the title of the product a code landed on; `message`
 * Whop's words, or a check's own sentence for check_refused; `confirmed`
 * whether Whop showed a code attached after a reject (attach_after_reject).
 */
export interface ThirtyWordsContext {
  /** Hours since the student applied. */
  ageHours: number;
  /** The request's status now. */
  status: string;
  /** THIRTY_AUTO_APPLY is off. */
  paused?: boolean;
  claimed?: boolean;
  code?: string | null;
  product?: string | null;
  membershipStatus?: string | null;
  message?: string | null;
  confirmed?: boolean | null;
}

/** The ending of each landed_elsewhere sentence: only the team can move a code on Whop. */
const FIX_IN_WHOP = "Fix it in Whop, then tell the owner so the app records it.";

/** What went wrong, in the team's words. Empty for no failure. */
function whatWentWrong(reason: ThirtyReason | null, step: string | null, c: ThirtyWordsContext): string {
  const code = c.code ?? "the code";
  switch (reason) {
    case null:
      return "";
    case "no_membership":
      return "Whop shows no paid course membership to put the code on.";
    case "membership_not_active":
      return c.membershipStatus === "trialing"
        ? "Their membership is a trial on Whop. The app leaves trials to the team: Approve or Try again puts the code on."
        : `Their membership is ${c.membershipStatus ?? "not active"} on Whop, so the code can't go on yet.`;
    case "membership_has_code":
      return "Their membership already has another code on Whop.";
    case "key_not_allowed":
      return "Whop refused the app's key. It needs member:manage.";
    case "code_not_made":
      return c.message ? `Whop wouldn't make the code: ${c.message}` : "Whop wouldn't make the code.";
    case "apply_refused":
      return c.message ? `Whop wouldn't take the code: ${c.message}` : "Whop wouldn't take the code.";
    case "landed_elsewhere": {
      const where =
        step === "other_person"
          ? `Whop shows ${code} on someone else's membership.`
          : step === "other_product"
            ? c.product
              ? `Whop shows ${code} on their ${c.product} membership, not the course.`
              : `Whop shows ${code} on their membership of another product.`
            : step === "free"
              ? `Whop shows ${code} on their free membership.`
              : `Whop shows ${code} on another membership.`;
      return `${where} ${FIX_IN_WHOP}`;
    }
    case "write_failed":
      if (step === "decided_meanwhile") return `Whop made ${code}, but the request had changed. Delete ${code} in Whop.`;
      if (step === "attach_after_reject") {
        return c.confirmed === false
          ? `Whop may have attached ${code} after the request was rejected. Check their membership in Whop.`
          : `Whop attached ${code} after the request was rejected. It can only come off in Whop.`;
      }
      return `Whop made ${code}, but saving it failed.`;
    case "old_code":
      return "This code was made before the app attached codes itself. Press Try again to attach it, or attach it in Whop.";
    case "code_unknown":
      return `This request has a code with no Whop id, so the app can't check it. Check ${code} in Whop, then tell the owner so the app records it.`;
    case "check_refused":
      return c.message ?? "";
    case "whop_no_answer":
      if (step === "coupon_stored") return "Whop's coupon check didn't answer.";
      if (step === "where_filter" || step === "where_no_ids") return `The app can't tell whose membership ${code} is on. Check it in Whop.`;
      return "Whop didn't answer.";
  }
}

/**
 * The reasons whose own words are the whole story: a hold (the team's call),
 * a code on the wrong membership, the two where steps, and write_failed but
 * for a save that failed after Whop made the code. They add no second line.
 */
function addsNothing(reason: ThirtyReason, step: string | null, c: ThirtyWordsContext): boolean {
  switch (reason) {
    case "check_refused":
    case "code_unknown":
    case "old_code":
    case "landed_elsewhere":
      return true;
    case "membership_not_active":
      return c.membershipStatus === "trialing";
    case "whop_no_answer":
      return step === "where_filter" || step === "where_no_ids";
    case "write_failed":
      return step !== "approved_write_error";
    default:
      return false;
  }
}

/** The reasons the job tries again on its next runs (R1, §9.3). */
function jobRetries(reason: ThirtyReason, step: string | null, c: ThirtyWordsContext): boolean {
  switch (reason) {
    case "whop_no_answer":
      return step !== "where_filter" && step !== "where_no_ids";
    case "key_not_allowed":
    case "membership_has_code":
    case "no_membership":
    case "apply_refused":
      return true;
    case "membership_not_active":
      return c.membershipStatus !== "trialing";
    case "write_failed":
      return step === "approved_write_error";
    case "code_not_made":
      return c.status === "pending" && c.ageHours < JOB_NEW_CODE_WINDOW_HOURS;
    default:
      return false;
  }
}

/** What happens next, by who will act; null for nothing to add. */
function whatHappensNext(reason: ThirtyReason | null, step: string | null, c: ThirtyWordsContext): string | null {
  if (reason !== null && addsNothing(reason, step, c)) return null;
  const pending = c.status === "pending";
  const approved = c.status === "approved";
  if (!pending && !approved) return null;
  if (c.paused) return approved ? "The app is paused. Press Try again or reject it." : "The app is paused. Approve or reject it.";
  // The job still works it: an approved row, a claimed row, a pending row under 48 hours.
  const claimed = pending && c.claimed === true;
  if (approved || claimed || c.ageHours < JOB_NEW_CODE_WINDOW_HOURS) {
    if (reason === null) return "The app hasn't tried yet.";
    return jobRetries(reason, step, c) ? "The app tries again." : null;
  }
  return "The app only tries requests from the last 2 days. Approve or reject it.";
}

/**
 * A request's Why line: what went wrong (`reason` and its `step`, null for no
 * failure yet) and what happens next. One string, the two parts joined by a
 * space; empty when neither says anything.
 */
export function thirtyWords(reason: ThirtyReason | null, step: string | null, ctx: ThirtyWordsContext): string {
  return [whatWentWrong(reason, step, ctx), whatHappensNext(reason, step, ctx)].filter((s) => s !== null && s !== "").join(" ");
}
