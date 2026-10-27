/**
 * Made-up data for the dev admin pages under /dev/admin (admin rebuild PRD,
 * section 9). Development only: the pages that import this call notFound()
 * anywhere else.
 *
 * MADE-UP PEOPLE ONLY. This repository is public: every student, team
 * member, Whop id, code and link below is invented.
 *
 * THE 30% PAGE (/dev/admin/discounts; admin rebuild 2, D4 and D5; the 30%
 * that applies itself, T-137, R4). The fixture is a small database (people,
 * their videos, their requests, each request's history of events, the coupon
 * stored for their Whop membership and what Whop would say now), and every
 * load runs the real buildThirtyView over it (src/lib/admin/thirty-view.ts),
 * the builder behind GET /api/admin/thirty, with the list chosen as
 * readNeedsHand chooses it (thirty-data.ts): from 1 October, pending or
 * approved 30 minutes after the student applied, or with a write_failed as
 * the request's newest event in the last 30 days. So the verdicts, counts,
 * coupons and Why lines on the dev page are the student app's own rule and
 * the team's own words (thirtyWords), not text typed here. The decision
 * buttons change that database the way the routes do, so a click and the
 * reload after it show what the team would see: Approve refuses a student
 * whose membership has a discount on its next renewal with the approve
 * route's own sentence and code "has-discount" (with `override` too), and
 * stores what it read, as the route does (checkMembershipDiscount); Approve
 * anyway on the coupon's row (`overrideCoupon`, a founder's or an admin's,
 * the owner's review of 2026-10-21) passes it. A refusal of the rule carries
 * code "rule", as the route's does, and a csm's override is refused as the
 * route refuses it. What passes the checks is applied: the code made and put
 * on the membership, as the route does since the 30% applies itself, and the
 * request leaves the list. Try again on an approved row applies it too.
 * Reject follows the route's table: a request with no code is rejected; an
 * approved one is rejected with its code left usable; one whose code has no
 * Whop id with the code that may exist; a csm is refused on a request whose
 * code may exist. A request can carry its own answer to a press (`press`),
 * for each line of the approve and reject tables (PRD §9.4).
 *
 *   ?state=full | empty | loading | error   (default full)
 *          partial    full, plus a student whose progress cannot be read
 *          novideos   full, with the course's videos unreadable
 *          nocoupons  full, with the stored coupons unreadable and Whop
 *                     giving no answer about the approved rows' coupons
 *          owncode    full, with the team's own 30% codes already on the two
 *                     approved memberships in Whop: Ethan's named
 *                     ECOM30-3F9A21, Nora's with no name read, only the
 *                     request's own Whop promo id. No coupon warning on
 *                     either (the render review's fix round)
 *          stalecoupon  full, with the forever 10% taken off Tara's
 *                     membership in Whop since the cron stored it: her row
 *                     still offers only Reject, and Check Whop again finds no
 *                     discount, so the rule decides her row and Approve is
 *                     back (the render review's second round)
 *          unpaid     full, with Whop showing no paid course plan and
 *                     payment that went through for two students who watched
 *                     enough (the owner's rule of 2026-10-26: "If they don't
 *                     have a payment and a paid plan - no applying to 30%
 *                     off"; ?state=nopayment, Whop showing no real payment,
 *                     from the review of that day until his answers): Jonah's
 *                     stored row says so, so his verdict does and he has no
 *                     Approve; Maya's stored row is a clean one and Whop says
 *                     so only now, so her Approve is refused with code
 *                     "rule", the answer stored, and her row then reads the
 *                     same. Approve anyway passes both. Sofia's stored row
 *                     says so too, but Whop shows her paid now (the review
 *                     of 2026-10-26): Check Whop again says "Whop shows a
 *                     payment that went through for Sofia Marin now." and
 *                     the rule decides her row again
 *          paused     full, with THIRTY_AUTO_APPLY off (R7): the page says
 *                     the automatic part is paused, and every Why line names
 *                     the team
 *          reasons    every other reason and step a request can wait for
 *                     (the newest attempt_failed of each), on pending,
 *                     claimed, reopened, approved, rejected and applied
 *                     rows, each with its Why line; and the rows whose
 *                     Approve, Try again or Reject answers each line of the
 *                     approve and reject tables (`press`)
 *
 * The full list: eight pending requests (Leo and Sofia older than 2 days,
 * Maya untried, the rest with a failure each), Ethan's and Nora's approved
 * ones, and Iris's request rejected while Whop attached its code. Max's
 * rejected first request, Omar's and Lena's applied ones, Ruby's and Felix's
 * rejected ones, Zoe's request made 20 minutes ago and Vera's from September
 * are on no list; so is Kai's applied request, whose write_failed was
 * followed by its applied event.
 *
 * The approved rows' coupon is what Whop says now (liveCoupons, as
 * GET /api/admin/thirty asks it): Ethan was approved before the coupon rule
 * with nothing stored, and Whop names the forever 10%; for Nora Whop gives
 * no answer, and the stored row stands in, with its date. Check Whop again
 * (POST /api/admin/thirty/check-coupon) reads Whop the way the approve route
 * does here, and stores what it read.
 *   ?conflict=1   approve and reject answer as if another team member decided
 *                 the request first: approve with the route's 409 and its
 *                 sentence (the code must be deleted in Whop), reject with
 *                 its 409 "This request was already decided."
 *   ?reload=fail  the first read of the list works, every later one fails
 *   ?whop=down    Check Whop again gets no answer from Whop: the route's 502
 *                 and its sentence, and nothing changes
 *
 * The page's clock is FIXTURE_NOW, so every date reads the same on every run.
 *
 * The 80% rule (the owner, 2026-10-26: 49 of the 61 videos): Jonah has
 * watched 49, the least that meets it, and Priya 48, one short; their windows
 * end after the rule began (26 and 27 October). The other windows end before
 * it, the shared one among them, so they keep every video (the owner's B of
 * the same day): Maya's yes and Sofia's not yet say every video, with "61
 * needed, every video for a deadline before Mon 26 Oct". Copy Discord
 * ID and Copy username (the same day; "Copy ID" and "Copy @" until its
 * review): Maya has both an id and a username, Hugo and Iris a username
 * only, Leo an id only, Priya neither (her row says so in a line), and Iris's
 * username is stored with its own "@" (copied with one). Every Discord id is
 * invented.
 */

import { buildThirtyView } from "@/lib/admin/thirty-view";
import type { ThirtyView } from "@/lib/admin/thirty-view";
import type { LiveCoupon, ThirtyCouponRow, ThirtyData, ThirtyFailureEvent, ThirtyRequest, ThirtyStudent } from "@/lib/admin/thirty-data";
import type { Answer, ApproveAnswer, RejectAnswer, ThirtyTransport } from "@/lib/admin/admin-transport";
import type { ThirtyReason } from "@/lib/thirty-words";
import { DISCOUNT_ELIGIBLE_FROM } from "@/lib/world/discount";
import { UNPAID_APPROVAL, couponApprovalRefusal } from "@/lib/world/discount-server";
import { rowShowsUnpaid } from "@/lib/membership-discount";
import type { CatalogLessonRow, CompletionRow, DiscountReads, VideoRow } from "@/lib/world/discount-server";

/** Tue 20 Oct 2026, 10:30 in Croatia: the moment every dev load is read at. */
export const FIXTURE_NOW = "2026-10-20T08:30:00.000Z";
const NOW_MS = Date.parse(FIXTURE_NOW);
/** The course switch (v104), as admin_config holds it. */
const RESET_AT = "2026-10-19T14:33:00.000Z";
/** The videos, loaded the morning of the switch. */
const LOADED = "2026-10-19T10:00:00.000Z";
/** The first Whop backfill after the switch. */
const FROM_WHOP = "2026-10-19T16:00:00.000Z";
/** The last cron run of the coupons, 10:40 in Croatia the day before. */
const COUPONS_READ = "2026-10-19T08:40:00.000Z";
/** The list's two windows, as readNeedsHand reads them (thirty-data.ts NEEDS_HAND_AFTER_MS, WRITE_FAILED_LISTED_MS). */
const NEEDS_HAND_AFTER_MS = 30 * 60_000;
const WRITE_FAILED_LISTED_MS = 30 * 86_400_000;

/** The team member the dev pages act as. */
const ME = "tm-robin";
const TEAM = new Map([
  ["tm-robin", "Robin Hale"],
  ["tm-jamie", "Jamie Rowe"],
]);

// ── The course: 61 videos up to the checkpoint. Lengths are made up.
const LESSONS: CatalogLessonRow[] = Array.from({ length: 61 }, (_, i): CatalogLessonRow => ({
  id: `v${String(i + 1).padStart(2, "0")}`,
  type: "watch",
  counts_toward_progress: true,
  is_gate: i === 60,
  duration_seconds: 240 + ((i * 97) % 540),
}));
const REQUIRED = LESSONS.map((l) => l.id);
const VIDEOS: VideoRow[] = REQUIRED.map((lesson_id) => ({ lesson_id, created_at: LOADED }));

// ── The made-up database ────────────────────────────────────────────────────
/**
 * A Whop membership as the coupon rule reads it: a code, the next renewal's price and the plan's. No prices and no
 * code: the rule's unpaid answer (UNPAID).
 */
interface Membership {
  /** The code's name; null with no code, or when its name could not be read (then `promoId` is the code). */
  code: string | null;
  /** The code's Whop promo id, when it is not promoIdOf(code). */
  promoId?: string | null;
  renewal: number | null;
  plan: number | null;
}

/** A made-up Whop promo id for a code: "promo_dev" and the code's letters and digits. */
const promoIdOf = (code: string) => `promo_dev${code.toLowerCase().replace(/[^a-z0-9]/g, "")}`;

interface Person {
  id: string;
  name: string;
  username?: string;
  /** students.discord_user_id, made up. Left out: none on file. */
  discordId?: string;
  status?: string;
  paid: string | null;
  /** The last Whop backfill. Left out: one after the switch. null: none ever. */
  synced?: string | null;
  /** The first `done` of the 61 videos were finished at `doneAt`. */
  done?: number;
  doneAt?: string;
  /** Their completions cannot be read (a timed-out batch). */
  readFails?: boolean;
  /** The coupon stored for their membership (student_membership_discounts), when the cron has read it. */
  stored?: Membership;
  /** What Whop says about the membership now, when it is not what is stored: the approve route reads it, and the page for an approved row. */
  live?: Membership;
  /** Whop gives no answer about their membership now (the page's read for an approved row). */
  liveFails?: boolean;
}

/** What Approve or Try again answers for a request that carries its own answer (PRD §9.4's approve table). */
type ApprovePress =
  /** Through, the code on the membership. */
  | { kind: "applied" }
  /** Through to approved, the code made but not on the membership: why (an attempt_failed). */
  | { kind: "approved"; reason: ThirtyReason; step?: string; membershipStatus?: string; message?: string }
  /** Still pending: why (an attempt_failed), and for a claim the code's name. */
  | { kind: "pending"; reason: ThirtyReason; step?: string; message?: string; claim?: string }
  /** The route's refusal, as it answers it. */
  | { kind: "refused"; status: number; error: string };

/** What Reject answers for a request that carries its own answer (PRD §9.4's reject table). */
type RejectPress = { kind: "rejected"; codeState: RejectAnswer["codeState"] } | { kind: "refused"; status: number; error: string };

interface Ask {
  id: string;
  studentId: string;
  status: ThirtyRequest["status"];
  createdAt: string;
  reviewedAt?: string | null;
  reviewedBy?: string | null;
  appliedAt?: string | null;
  appliedBy?: string | null;
  promoCode?: string | null;
  /** The Whop promo id of promoCode, as the shared step stores it (whop_promo_id). */
  promoId?: string | null;
  reason?: string | null;
  /** What a press answers, when it is not what the routes answer for the row as it is. */
  press?: { approve?: ApprovePress; reject?: RejectPress };
}

/**
 * A request's event (discount_request_events, v116), as the fixture keeps
 * them: the trigger's events (requested, code_made, applied, rejected) and
 * the app's attempt_failed, with what its detail holds.
 */
interface Happening {
  askId: string;
  event: "requested" | "code_made" | "applied" | "rejected" | "reopened" | "code_changed" | "attempt_failed" | "override";
  at: string;
  reason?: ThirtyReason;
  step?: string;
  message?: string;
  membershipStatus?: string;
  code?: string;
  product?: string;
  confirmed?: boolean;
}

interface FixtureDb {
  people: Person[];
  asks: Ask[];
  events: Happening[];
}

/** The forever 10% code a partner's members are on: renews at 87.30 on the 97.00 plan. */
const EVOLVE: Membership = { code: "evolve10", renewal: 87.3, plan: 97 };
/** A one-month code that is used up: the id stays on the membership, and it renews at full price. */
const USED_UP: Membership = { code: "welcome50", renewal: 97, plan: 97 };
/** No code: the cron read the membership and found nothing. */
const CLEAN: Membership = { code: null, renewal: 97, plan: 97 };
/**
 * Unpaid (the owner's rule of 2026-10-26): Whop does not show both a paid course plan and a course payment that went
 * through, which the rule stores as a row with no code and no price (membership-discount.ts rowShowsUnpaid), naming
 * the membership on file, so it counts while that stays on file (storedRowApplies), as couponRow stores it.
 */
const UNPAID: Membership = { code: null, renewal: null, plan: null };

/** A moment `minutes` before FIXTURE_NOW. */
const ago = (minutes: number) => new Date(NOW_MS - minutes * 60_000).toISOString();

/** What the job records when Approve's checks refuse before a new code: their sentence (the approve route's). */
const PRIYA_RULE = "Student has not watched 80% of the videos up to the discount checkpoint inside the 14 days: 48 of 61 watched, 49 needed.";

function fullDb(): FixtureDb {
  return {
    people: [
      // Pending: the rule says yes; never tried yet.
      { id: "p-maya", name: "Maya Lindqvist", username: "maya.lq", discordId: "100000000000000101", paid: "2026-10-01T09:00:00.000Z", done: 61, stored: USED_UP },
      // Pending: 49 of the 61 watched, the least the 80% takes (2026-10-26); Whop shows no paid course membership.
      { id: "p-jonah", name: "Jonah Pereira", username: "jonah_p", discordId: "100000000000000102", paid: "2026-10-12T15:00:00.000Z", done: 49, doneAt: "2026-10-19T20:00:00.000Z", stored: CLEAN },
      // Pending: 48 of the 61, one short of the 80% (her window ends 27 October), payment failed, no Whop backfill since
      // the switch; no Discord on file. The job's checks refused her.
      { id: "p-priya", name: "Priya Raman", status: "past_due", paid: "2026-10-13T08:00:00.000Z", done: 48, synced: "2026-10-18T10:00:00.000Z", stored: CLEAN },
      // Pending: asked on the old course, before the switch, over 2 days ago; the coupon check gave no answer then.
      { id: "p-sofia", name: "Sofia Marin", username: "sofia.marin", discordId: "100000000000000104", paid: "2026-10-05T10:00:00.000Z", done: 40, stored: CLEAN },
      // Pending, over 2 days: first payment before 1 October; canceled, so the cron never checked the coupon. A Discord id, no username.
      { id: "p-leo", name: "Leo Hartmann", status: "canceled", discordId: "100000000000000105", paid: "2026-09-15T10:00:00.000Z", done: 61 },
      // Pending: a second request after a rejected one (and a long name); the membership's payment failed.
      { id: "p-max", name: "Maximilian Featherstonehaugh-Smythe", username: "max.fs", discordId: "100000000000000106", paid: "2026-10-09T10:00:00.000Z", done: 61, doneAt: "2026-10-17T09:00:00.000Z", stored: CLEAN },
      // Pending: every video done, and the forever 10% on the membership: the coupon decides (D5); the job's checks said so.
      { id: "p-tara", name: "Tara Quinn", username: "tara.q", discordId: "100000000000000107", paid: "2026-10-10T09:00:00.000Z", done: 61, stored: EVOLVE },
      // Pending: every video done, nothing stored yet, and Whop says now that a code applies: Approve is refused. A username, no Discord id.
      { id: "p-hugo", name: "Hugo Lindahl", username: "hugo.l", paid: "2026-10-11T09:00:00.000Z", done: 61, live: EVOLVE },
      // Approved before the coupon rule, so nothing was ever stored for him: Whop says now the forever 10% is on the membership.
      { id: "p-ethan", name: "Ethan Cole", username: "ethan.cole", discordId: "100000000000000109", paid: "2026-10-02T09:00:00.000Z", done: 61, live: EVOLVE },
      // Approved, the forever 10% stored by the cron, and Whop gives no answer now: the stored row is shown, with its date.
      { id: "p-nora", name: "Nora Brandt", username: "nora.b", discordId: "100000000000000110", paid: "2026-10-10T12:00:00.000Z", done: 61, stored: EVOLVE, liveFails: true },
      // Rejected while Whop attached the code: listed for its write_failed. Her username is stored with its "@" (copied
      // with one), and she has no Discord id: beside Copy code, Copy Discord ID greyed with its tip.
      { id: "p-iris", name: "Iris Novak", username: "@iris.n", paid: "2026-10-08T09:00:00.000Z", done: 61, stored: CLEAN },
      // Applied: on no list. Omar: a Discord id, no username. Lena: her username stored with its "@".
      { id: "p-omar", name: "Omar Haddad", discordId: "100000000000000111", paid: "2026-10-01T12:00:00.000Z", done: 61 },
      { id: "p-lena", name: "Lena Vogel", username: "@lena.v", discordId: "100000000000000112", status: "past_due", paid: "2026-10-04T08:00:00.000Z", done: 61 },
      // Applied after a write_failed (saving the code failed, the job then recorded it): the newest event is the applied one.
      { id: "p-kai", name: "Kai Lindgren", username: "kai.l", paid: "2026-10-07T09:00:00.000Z", done: 61 },
      // Rejected: on no list.
      { id: "p-ruby", name: "Ruby Okafor", username: "ruby.ok", paid: "2026-10-11T09:00:00.000Z", done: 30 },
      { id: "p-felix", name: "Felix Moreau", paid: "2026-10-06T09:00:00.000Z", done: 20 },
      // Pending, made 20 minutes ago: the app's own tries come first, so not listed yet.
      { id: "p-zoe", name: "Zoe Hartley", username: "zoe.h", paid: "2026-10-14T09:00:00.000Z", done: 61, stored: CLEAN },
      // Never listed: their only request is from September, before the page's first day.
      { id: "p-vera", name: "Vera Holm", username: "vera.h", paid: "2026-09-02T09:00:00.000Z", done: 0 },
    ],
    asks: [
      { id: "r-leo", studentId: "p-leo", status: "pending", createdAt: "2026-10-14T09:00:00.000Z" },
      { id: "r-sofia", studentId: "p-sofia", status: "pending", createdAt: "2026-10-16T12:00:00.000Z" },
      { id: "r-tara", studentId: "p-tara", status: "pending", createdAt: "2026-10-18T10:00:00.000Z" },
      { id: "r-hugo", studentId: "p-hugo", status: "pending", createdAt: "2026-10-19T09:00:00.000Z" },
      { id: "r-maya", studentId: "p-maya", status: "pending", createdAt: "2026-10-19T18:00:00.000Z" },
      { id: "r-jonah", studentId: "p-jonah", status: "pending", createdAt: "2026-10-20T06:00:00.000Z" },
      {
        id: "r-max-1", studentId: "p-max", status: "rejected", createdAt: "2026-10-17T10:00:00.000Z",
        reviewedAt: "2026-10-17T15:00:00.000Z", reviewedBy: "tm-robin", reason: "Two accounts on one card.",
      },
      { id: "r-max-2", studentId: "p-max", status: "pending", createdAt: "2026-10-20T06:30:00.000Z" },
      { id: "r-priya", studentId: "p-priya", status: "pending", createdAt: "2026-10-20T07:10:00.000Z" },
      { id: "r-zoe", studentId: "p-zoe", status: "pending", createdAt: ago(20) },
      {
        id: "r-ethan", studentId: "p-ethan", status: "approved", createdAt: "2026-10-17T08:00:00.000Z",
        reviewedAt: "2026-10-18T09:00:00.000Z", reviewedBy: "tm-robin", promoCode: "ECOM30-3F9A21", promoId: promoIdOf("ECOM30-3F9A21"),
      },
      {
        id: "r-nora", studentId: "p-nora", status: "approved", createdAt: "2026-10-19T19:00:00.000Z",
        reviewedAt: "2026-10-20T07:45:00.000Z", reviewedBy: "tm-jamie", promoCode: "ECOM30-7B20C4", promoId: promoIdOf("ECOM30-7B20C4"),
      },
      {
        id: "r-iris", studentId: "p-iris", status: "rejected", createdAt: "2026-10-19T11:00:00.000Z",
        reviewedAt: "2026-10-20T07:00:00.000Z", reviewedBy: "tm-jamie", reason: "Two accounts on one card.",
        promoCode: "ECOM30-Q8M3TZ", promoId: promoIdOf("ECOM30-Q8M3TZ"),
      },
      {
        id: "r-omar", studentId: "p-omar", status: "applied", createdAt: "2026-10-13T08:00:00.000Z",
        reviewedAt: "2026-10-14T09:00:00.000Z", reviewedBy: "tm-robin", appliedAt: "2026-10-15T10:00:00.000Z", appliedBy: "tm-jamie",
        promoCode: "ECOM30-A1D9E0", promoId: promoIdOf("ECOM30-A1D9E0"),
      },
      {
        id: "r-lena", studentId: "p-lena", status: "applied", createdAt: "2026-10-15T08:00:00.000Z",
        reviewedAt: "2026-10-16T09:00:00.000Z", reviewedBy: "tm-jamie", appliedAt: "2026-10-17T10:00:00.000Z", appliedBy: "tm-jamie",
        promoCode: "ECOM30-C55E10", promoId: promoIdOf("ECOM30-C55E10"),
      },
      {
        id: "r-kai", studentId: "p-kai", status: "applied", createdAt: "2026-10-19T12:00:00.000Z",
        reviewedAt: "2026-10-19T12:10:00.000Z", appliedAt: "2026-10-19T12:10:00.000Z",
        promoCode: "ECOM30-H4T9WV", promoId: promoIdOf("ECOM30-H4T9WV"),
      },
      {
        id: "r-ruby", studentId: "p-ruby", status: "rejected", createdAt: "2026-10-14T10:00:00.000Z",
        reviewedAt: "2026-10-15T09:00:00.000Z", reviewedBy: "tm-robin", reason: "The ads were not handed in.",
      },
      { id: "r-felix", studentId: "p-felix", status: "rejected", createdAt: "2026-10-16T09:00:00.000Z", reviewedAt: "2026-10-17T09:00:00.000Z" },
      {
        id: "r-vera", studentId: "p-vera", status: "applied", createdAt: "2026-09-20T09:00:00.000Z",
        reviewedAt: "2026-09-21T09:00:00.000Z", reviewedBy: "tm-jamie", appliedAt: "2026-09-22T09:00:00.000Z", appliedBy: "tm-jamie",
        promoCode: "ECOM30-90AB12",
      },
    ],
    events: [
      // Sofia's Apply: the coupon check gave no answer, so the app made nothing; her 2 days ended since.
      { askId: "r-sofia", event: "attempt_failed", at: "2026-10-16T12:00:20.000Z", reason: "whop_no_answer", step: "coupon_stored" },
      // Tara: the job ran Approve's checks before a new code, and the coupon refused.
      { askId: "r-tara", event: "attempt_failed", at: ago(17), reason: "check_refused", message: couponApprovalRefusal("evolve10") },
      // Hugo: the coupon check gave no answer at his Apply, then in the job's runs.
      { askId: "r-hugo", event: "attempt_failed", at: ago(47), reason: "whop_no_answer", step: "coupon_stored" },
      // Jonah: no paid course membership to put the code on.
      { askId: "r-jonah", event: "attempt_failed", at: ago(7), reason: "no_membership", step: "membership" },
      // Max: his course membership's payment failed.
      { askId: "r-max-2", event: "attempt_failed", at: ago(27), reason: "membership_not_active", step: "membership", membershipStatus: "past_due" },
      // Priya: the job's checks refused her, in the approve route's words.
      { askId: "r-priya", event: "attempt_failed", at: ago(37), reason: "check_refused", message: PRIYA_RULE },
      // Ethan: Whop took no code, the membership holding another one.
      { askId: "r-ethan", event: "attempt_failed", at: ago(27), reason: "membership_has_code", step: "attach", code: "ECOM30-3F9A21" },
      // Nora: Whop gave no answer to the attach.
      { askId: "r-nora", event: "attempt_failed", at: ago(7), reason: "whop_no_answer", step: "attach", code: "ECOM30-7B20C4" },
      // Iris: rejected while Whop attached the code, and Whop showed it attached.
      { askId: "r-iris", event: "rejected", at: "2026-10-20T07:00:00.000Z" },
      { askId: "r-iris", event: "attempt_failed", at: "2026-10-20T07:00:05.000Z", reason: "write_failed", step: "attach_after_reject", code: "ECOM30-Q8M3TZ", confirmed: true },
      // Kai: the code was made but saving it failed; the job then recorded it and put it on.
      { askId: "r-kai", event: "attempt_failed", at: "2026-10-19T12:00:15.000Z", reason: "write_failed", step: "approved_write_error", code: "ECOM30-H4T9WV" },
      { askId: "r-kai", event: "code_made", at: "2026-10-19T12:10:00.000Z" },
      { askId: "r-kai", event: "applied", at: "2026-10-19T12:10:01.000Z" },
    ],
  };
}

function emptyDb(): FixtureDb {
  return { people: [], asks: [], events: [] };
}

/**
 * The full fixture, with the team's own 30% codes already on the two approved
 * memberships in Whop: Ethan's read with its name, Nora's with only its Whop
 * promo id, the request's own whop_promo_id.
 */
function ownCodeDb(): FixtureDb {
  const db = fullDb();
  const ethan = db.people.find((p) => p.id === "p-ethan")!;
  const nora = db.people.find((p) => p.id === "p-nora")!;
  ethan.live = { code: "ECOM30-3F9A21", renewal: 67.9, plan: 97 };
  nora.live = { code: null, promoId: promoIdOf("ECOM30-7B20C4"), renewal: 67.9, plan: 97 };
  nora.liveFails = false;
  return db;
}

/**
 * The full fixture, with the forever 10% taken off Tara's membership in Whop
 * since the cron read it: the stored row still says evolve10, Whop now says
 * no code (the render review's second round).
 */
function staleCouponDb(): FixtureDb {
  const db = fullDb();
  db.people.find((p) => p.id === "p-tara")!.live = CLEAN;
  return db;
}

/**
 * The full fixture, with Whop showing no paid course plan and payment that
 * went through for Jonah (stored) and for Maya (only now, so her stored row is
 * still a clean one): the owner's rule of 2026-10-26. Sofia's stored row says
 * the same, and Whop shows her paid now (the review of that day: Check Whop
 * again's notice names the payment alone).
 */
function unpaidDb(): FixtureDb {
  const db = fullDb();
  db.people.find((p) => p.id === "p-jonah")!.stored = UNPAID;
  db.people.find((p) => p.id === "p-maya")!.live = UNPAID;
  const sofia = db.people.find((p) => p.id === "p-sofia")!;
  sofia.stored = UNPAID;
  sofia.live = CLEAN;
  return db;
}

/** The full fixture plus one student whose progress cannot be read, with a request waiting. */
function partialDb(): FixtureDb {
  const db = fullDb();
  db.people.push({ id: "p-nina", name: "Nina Petrova", username: "nina.p", paid: "2026-10-08T09:00:00.000Z", done: 61, readFails: true });
  db.asks.push({ id: "r-nina", studentId: "p-nina", status: "pending", createdAt: "2026-10-20T07:40:00.000Z" });
  return db;
}

/**
 * Every other reason and step a request waits for (the newest attempt_failed
 * of each), one request each, and the requests whose Approve, Try again or
 * Reject answers each line of the approve and reject tables (`press`). Made
 * up: the people are named by what their row shows.
 */
function reasonsDb(): FixtureDb {
  const people: Person[] = [];
  const asks: Ask[] = [];
  const events: Happening[] = [];
  let n = 0;
  /** One request: a made-up student (every video done, a clean coupon), the request and its newest failure. */
  const add = (
    name: string,
    ask: Omit<Ask, "id" | "studentId" | "createdAt"> & { minutes?: number },
    failure?: Omit<Happening, "askId" | "event" | "at">,
    person: Partial<Person> = {},
  ) => {
    n += 1;
    const id = `r-x${String(n).padStart(2, "0")}`;
    const studentId = `p-x${String(n).padStart(2, "0")}`;
    people.push({ id: studentId, name, discordId: `1000000000000002${String(n).padStart(2, "0")}`, paid: "2026-10-12T09:00:00.000Z", done: 61, stored: CLEAN, ...person });
    const { minutes = 120, ...rest } = ask;
    asks.push({ id, studentId, createdAt: ago(minutes), ...rest });
    if (failure) events.push({ askId: id, event: "attempt_failed", at: ago(Math.min(minutes, 60) - 5), ...failure });
    return id;
  };
  const code = (k: string) => `ECOM30-${k}`;
  const ours = (k: string) => ({ promoCode: code(k), promoId: promoIdOf(code(k)) });
  const approvedAt = { reviewedAt: ago(90) };

  // ── Pending, the app's own holds and Whop's answers ──
  add("Trial Holder", { status: "pending" }, { reason: "membership_not_active", step: "membership", membershipStatus: "trialing" });
  add("Other Code", { status: "pending" }, { reason: "membership_has_code", step: "membership", membershipStatus: "active" });
  add("Key Refused", { status: "pending" }, { reason: "key_not_allowed", step: "membership", message: "http_401_403" });
  add("Membership Unread", { status: "pending" }, { reason: "whop_no_answer", step: "membership", message: "timeout" });
  add("Code Refused", { status: "pending" }, { reason: "code_not_made", step: "create", message: "A promo code needs a plan on this company." });
  add("Code Refused Late", { status: "pending", minutes: 60 * 50 }, { reason: "code_not_made", step: "create", message: "A promo code needs a plan on this company." });
  add("Create Silent", { status: "pending", promoCode: code("C7R4TE") }, { reason: "whop_no_answer", step: "create", code: code("C7R4TE") });
  add("Create No Id", { status: "pending", promoCode: code("N0ID7X") }, { reason: "whop_no_answer", step: "create_no_id", code: code("N0ID7X") });
  add("Lookup Failed", { status: "pending", promoCode: code("L1ST8Q") }, { reason: "whop_no_answer", step: "list", message: "bad_page", code: code("L1ST8Q") });
  add("Save Failed", { status: "pending", promoCode: code("S4VE9P") }, { reason: "write_failed", step: "approved_write_error", code: code("S4VE9P") });
  add("Out Of Time", { status: "pending" }, { reason: "whop_no_answer", step: "deadline" });
  add("Reopened Hand", { status: "pending", ...ours("R3OP2N") }, { reason: "check_refused", message: `Reopened by hand with ${code("R3OP2N")}. Approve attaches that code, or reject it.`, code: code("R3OP2N") });
  add("Old Claim", { status: "pending", minutes: 60 * 60, promoCode: code("0LDC7M") }, { reason: "whop_no_answer", step: "create", code: code("0LDC7M") });

  // ── Approved ──
  add("Approved Untried", { status: "approved", ...approvedAt, ...ours("UNTR1D") });
  add("Apply Refused", { status: "approved", ...approvedAt, ...ours("APR3FD") }, { reason: "apply_refused", step: "attach", message: "This membership cannot take a promo code." });
  add("Attach Key Refused", { status: "approved", ...approvedAt, ...ours("K3YATT") }, { reason: "key_not_allowed", step: "attach", message: "Unauthorized" });
  add("Someone Else", { status: "approved", ...approvedAt, ...ours("0THRPR") }, { reason: "landed_elsewhere", step: "other_person", code: code("0THRPR") });
  add("Other Product", { status: "approved", ...approvedAt, ...ours("PR0DCT") }, { reason: "landed_elsewhere", step: "other_product", code: code("PR0DCT"), product: "Agency Starter Kit" });
  add("Other Product Unnamed", { status: "approved", ...approvedAt, ...ours("PR0D2X") }, { reason: "landed_elsewhere", step: "other_product", code: code("PR0D2X") });
  add("Free Membership", { status: "approved", ...approvedAt, ...ours("FR33MB") }, { reason: "landed_elsewhere", step: "free", code: code("FR33MB") });
  add("Filter Ignored", { status: "approved", ...approvedAt, ...ours("F1LTR9") }, { reason: "whop_no_answer", step: "where_filter", code: code("F1LTR9") });
  add("No Ids", { status: "approved", ...approvedAt, ...ours("N01DS4") }, { reason: "whop_no_answer", step: "where_no_ids", code: code("N01DS4") });
  {
    // The old per-student name: ECOM30- and the first 6 characters of the student's id, as Approve made it before.
    const id = add("Old Name", { status: "approved", ...approvedAt }, { reason: "old_code" });
    const a = asks.find((x) => x.id === id)!;
    a.promoCode = code(a.studentId.slice(0, 6).toUpperCase());
    a.promoId = promoIdOf(a.promoCode);
  }
  add("No Whop Id", { status: "approved", ...approvedAt, promoCode: code("UNKN0W") }, { reason: "code_unknown", code: code("UNKN0W") });
  add("Approved Trial", { status: "approved", ...approvedAt, ...ours("TR1AL5") }, { reason: "membership_not_active", step: "membership", membershipStatus: "trialing" });
  add("Approved Canceled", { status: "approved", ...approvedAt, ...ours("CANC3L") }, { reason: "membership_not_active", step: "membership", membershipStatus: "canceled" });

  // ── Rejected and applied, listed for a write_failed ──
  {
    const id = add("Decided Meanwhile", { status: "rejected", reviewedAt: ago(70), reviewedBy: "tm-jamie" });
    events.push({ askId: id, event: "rejected", at: ago(70) }, { askId: id, event: "attempt_failed", at: ago(69), reason: "write_failed", step: "decided_meanwhile", code: code("D3C1DD") });
  }
  {
    const id = add("Maybe Attached", { status: "rejected", reviewedAt: ago(70), reviewedBy: "tm-robin", ...ours("MAYB3A") });
    events.push({ askId: id, event: "rejected", at: ago(70) }, { askId: id, event: "attempt_failed", at: ago(69), reason: "write_failed", step: "attach_after_reject", code: code("MAYB3A"), confirmed: false });
  }
  {
    const id = add("Applied Meanwhile", { status: "applied", reviewedAt: ago(70), appliedAt: ago(70), ...ours("HAND5X") });
    events.push({ askId: id, event: "applied", at: ago(70) }, { askId: id, event: "attempt_failed", at: ago(69), reason: "write_failed", step: "decided_meanwhile", code: code("EXTR4C") });
  }

  // ── The presses: one request for each answer of the approve and reject tables (PRD §9.4) ──
  const press = (name: string, status: "pending" | "approved", p: Ask["press"], more: Partial<Ask> = {}) =>
    add(name, { status, ...(status === "approved" ? { ...approvedAt, ...ours(`P${String(n + 1).padStart(5, "0")}`) } : {}), ...more, press: p });
  press("Approve Made Not On", "pending", { approve: { kind: "approved", reason: "membership_has_code", step: "attach", membershipStatus: "active" } });
  press("Approve Create Silent", "pending", { approve: { kind: "pending", reason: "whop_no_answer", step: "create", claim: code("CR8SLN") } });
  press("Approve No Code Yet", "pending", { approve: { kind: "pending", reason: "whop_no_answer", step: "deadline" } });
  press("Approve Whop Refused", "pending", { approve: { kind: "refused", status: 502, error: "Couldn't create the promo code on Whop. The request is still pending. Details: A promo code needs a plan on this company." } });
  press("Approve In Progress", "pending", { approve: { kind: "refused", status: 409, error: "The app is making this code right now. Refresh in a few minutes." } });
  press("Approve After Reject", "pending", { approve: { kind: "refused", status: 409, error: `Whop attached ${code("ATR3J7")} after the request was rejected. It can only come off in Whop.` } });
  press("Approve Maybe After Reject", "pending", { approve: { kind: "refused", status: 409, error: `Whop may have attached ${code("MATR3J")} after the request was rejected. Check their membership in Whop.` } });
  press("Approve Save Failed", "pending", { approve: { kind: "refused", status: 500, error: `Whop made ${code("SVF41L")}, but saving it failed. The app picks it up on its next try; leave it in Whop.` } });
  press("Approve Not Ready", "pending", { approve: { kind: "refused", status: 503, error: "The 30% update isn't finished on the database (v116). Nothing was made." } });
  press("Approve Already Decided", "pending", { approve: { kind: "refused", status: 400, error: "Request already processed" } });
  press("Try Again Not On", "approved", { approve: { kind: "approved", reason: "whop_no_answer", step: "attach" } });
  press("Reject Usable", "approved", { reject: { kind: "rejected", codeState: "usable" } });
  press("Reject In Progress", "pending", { reject: { kind: "refused", status: 409, error: "The app is making this code right now. Try again in a few minutes." } }, { promoCode: code("1NPR0G") });
  press("Reject On Theirs", "approved", { reject: { kind: "refused", status: 409, error: "The code is already on their membership, so the 30% is theirs. Press Try again to mark it applied." } });
  press("Reject Claim On Theirs", "pending", { reject: { kind: "refused", status: 409, error: "The code is already on their membership, so the 30% is theirs. The app marks it applied within the hour." } }, { promoCode: code("CL41MT") });
  press("Reject Elsewhere", "approved", { reject: { kind: "refused", status: 409, error: `Whop shows ${code("ELS3WH")} on someone else's membership. Fix it in Whop, then tell the owner so the app records it.` } });
  press("Reject Cannot Tell", "approved", { reject: { kind: "refused", status: 409, error: `The app can't tell whose membership ${code("CNTT3L")} is on. Check it in Whop.` } });
  press("Reject Changed", "approved", { reject: { kind: "refused", status: 409, error: "This request changed meanwhile. Refresh the list." } });
  press("Reject Whop Silent", "approved", { reject: { kind: "refused", status: 503, error: "Couldn't ask Whop. Try again." } });
  press("Reject Lookup Silent", "pending", { reject: { kind: "refused", status: 503, error: "Couldn't ask Whop about this code. Try again." } }, { promoCode: code("L00KUP") });
  return { people, asks, events };
}

const READ_FAILED = { message: "canceling statement due to statement timeout" };

/** The completion rows of the videos a person finished. */
function completionsOf(p: Person): CompletionRow[] {
  return REQUIRED.slice(0, p.done ?? 0).map((lesson_id) => ({ lesson_id, completed_at: p.doneAt ?? FROM_WHOP }));
}

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const membershipOf = (p: Person) => `mem_dev${p.id.replace(/[^a-z0-9]/g, "")}`;

function couponRow(p: Person, m: Membership, checkedAt: string): ThirtyCouponRow {
  const promoId = m.promoId !== undefined ? m.promoId : m.code ? promoIdOf(m.code) : null;
  return {
    student_id: p.id,
    whop_membership_id: membershipOf(p),
    promo_code_id: promoId,
    promo_code: m.code,
    renewal_price: m.renewal,
    plan_renewal_price: m.plan,
    // THE RULE (membership-discount.ts): a code on the membership, and a next renewal below the plan's.
    discounted: promoId !== null && m.renewal !== null && m.plan !== null && Math.round(m.renewal * 100) < Math.round(m.plan * 100),
    checked_at: checkedAt,
  };
}

/** A request's events, newest last (the later moment, then the later one added). */
const eventsOf = (db: FixtureDb, askId: string) =>
  db.events
    .map((e, i) => ({ e, i }))
    .filter((x) => x.e.askId === askId)
    .sort((a, b) => Date.parse(a.e.at) - Date.parse(b.e.at) || a.i - b.i)
    .map((x) => x.e);

/**
 * The made-up database in the shape loadThirtyData hands buildThirtyView:
 * the requests that need a hand (as readNeedsHand chooses them), the students
 * holding them, each one's five reads, the stored coupons and each listed
 * request's newest attempt_failed. A failed read is that read's
 * `{ data: null, error }`, as the loader hands it on.
 */
function toData(db: FixtureDb, opts: { videosFail?: boolean; couponsFail?: boolean } = {}): ThirtyData {
  const videoRead = opts.videosFail ? { data: null, error: READ_FAILED } : { data: VIDEOS, error: null };
  const all: ThirtyRequest[] = db.asks.map((a) => ({
    id: a.id,
    student_id: a.studentId,
    status: a.status,
    created_at: a.createdAt,
    promo_code: a.promoCode ?? null,
    rejection_reason: a.reason ?? null,
    reviewed_at: a.reviewedAt ?? null,
    reviewed_by: a.reviewedBy ?? null,
    applied_at: a.appliedAt ?? null,
    applied_by: a.appliedBy ?? null,
    whop_promo_id: a.promoId ?? null,
  }));
  // The list, as readNeedsHand reads it: from 1 October, pending or approved 30 minutes after the student applied;
  // and any request whose newest event is a write_failed from the last 30 days.
  const waiting = (r: ThirtyRequest) =>
    (r.status === "pending" || r.status === "approved") && r.created_at >= DISCOUNT_ELIGIBLE_FROM && Date.parse(r.created_at) <= NOW_MS - NEEDS_HAND_AFTER_MS;
  const wroteLast = (r: ThirtyRequest) => {
    const newest = eventsOf(db, r.id).at(-1);
    return newest?.event === "attempt_failed" && newest.reason === "write_failed" && Date.parse(newest.at) >= NOW_MS - WRITE_FAILED_LISTED_MS;
  };
  const requests = all.filter((r) => waiting(r) || wroteLast(r)).sort(byId);
  const holders = new Set(requests.map((r) => r.student_id));
  const people = db.people.filter((p) => holders.has(p.id));
  const students: ThirtyStudent[] = people
    .map((p) => ({
      id: p.id,
      name: p.name,
      email: `${p.id}@example.com`,
      discord_username: p.username ?? null,
      discord_user_id: p.discordId ?? null,
      membership_status: p.status ?? "active",
      first_paid_at: p.paid,
      whop_membership_id: membershipOf(p),
    }))
    .sort(byId);

  const reads = new Map<string, DiscountReads>();
  const lastSyncAt = new Map<string, string | null>();
  const coupons = new Map<string, ThirtyCouponRow>();
  for (const p of people) {
    if (p.synced !== null) lastSyncAt.set(p.id, p.synced ?? FROM_WHOP);
    if (p.stored) coupons.set(p.id, couponRow(p, p.stored, COUPONS_READ));
    // Without the videos the loader reads no completion for anyone.
    const rows = p.readFails || opts.videosFail ? null : completionsOf(p);
    reads.set(p.id, {
      student: { data: { first_paid_at: p.paid }, error: null },
      lessons: { data: LESSONS, error: null },
      videos: videoRead,
      completions: rows ? { data: rows, error: null } : { data: null, error: READ_FAILED },
      requests: {
        data: all
          .filter((r) => r.student_id === p.id)
          .map((r) => ({ id: r.id, status: r.status, created_at: r.created_at, promo_code: r.promo_code ?? null, rejection_reason: r.rejection_reason ?? null })),
        error: null,
      },
    });
  }

  // Each listed request's newest attempt_failed, with the detail the shared step writes.
  const failures = new Map<string, ThirtyFailureEvent>();
  for (const r of requests) {
    const e = eventsOf(db, r.id).filter((x) => x.event === "attempt_failed").at(-1);
    if (!e) continue;
    failures.set(r.id, {
      request_id: r.id,
      reason: e.reason ?? null,
      created_at: e.at,
      detail: {
        step: e.step ?? null,
        http: null,
        message: e.message ?? null,
        membership_status: e.membershipStatus ?? null,
        code: e.code ?? r.promo_code ?? null,
        product: e.product ?? null,
        ...(e.confirmed !== undefined ? { confirmed: e.confirmed } : {}),
      },
    });
  }

  return {
    catalog: { data: LESSONS, error: null },
    videos: videoRead,
    students,
    reads,
    requests,
    failures,
    team: TEAM,
    lastSyncAt,
    coupons: opts.couponsFail ? { data: null, error: READ_FAILED } : { data: coupons, error: null },
  };
}

/**
 * What Whop says now about each approved student's membership, as
 * GET /api/admin/thirty reads it (readApprovedCoupons): their `live`
 * membership, else the stored one, else none; nothing when `liveFails`, and
 * nothing for anyone when the coupons cannot be read (nocoupons).
 */
function liveCoupons(db: FixtureDb, failAll: boolean): Map<string, LiveCoupon> {
  const out = new Map<string, LiveCoupon>();
  for (const a of db.asks.filter((x) => x.status === "approved")) {
    const p = db.people.find((x) => x.id === a.studentId);
    if (!p) continue;
    if (failAll || p.liveFails) out.set(p.id, { ok: false, fail: "http_other" });
    else out.set(p.id, { ok: true, row: couponRow(p, p.live ?? p.stored ?? CLEAN, FIXTURE_NOW) });
  }
  return out;
}

// ── The stand-in for the server ─────────────────────────────────────────────
export type FixtureState =
  | "full"
  | "empty"
  | "loading"
  | "error"
  | "partial"
  | "novideos"
  | "nocoupons"
  | "owncode"
  | "stalecoupon"
  | "unpaid"
  | "paused"
  | "reasons";

const STATES: FixtureState[] = ["full", "empty", "loading", "error", "partial", "novideos", "nocoupons", "owncode", "stalecoupon", "unpaid", "paused", "reasons"];

export function parseFixtureState(value: string | null): FixtureState {
  return STATES.find((s) => s === value) ?? "full";
}

/** Whose page the dev page draws: Approve anyway is a founder's or an admin's. Default admin (Robin Hale, tm-robin, the member the decisions record). */
export type FixtureRole = "admin" | "founder" | "csm";
const ROLES: FixtureRole[] = ["admin", "founder", "csm"];
export function parseFixtureRole(value: string | null): FixtureRole {
  return ROLES.find((r) => r === value) ?? "admin";
}

/** The old course's refusal of an approval it cannot check (the approve route's 409 with no v2 catalog shape). */
const COURSE_CHANGED = "The course changed and this check cannot run. Nothing was approved.";

/** One call the page made, for world-tests to read (window.__adminCalls on the dev page). */
export interface FixtureCall {
  name: "loadThirty" | "approve" | "reject" | "checkCoupon";
  args: unknown[];
}

/** A made-up code in the shape the app makes, ECOM30- and six characters, the same for the same student. */
function codeFor(studentId: string): string {
  let h = 7;
  for (const ch of studentId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `ECOM30-${h.toString(16).toUpperCase().padStart(6, "0").slice(-6)}`;
}

/** The approve route's 200 body, as the transport hands it to the page. */
const approveAnswer = (a: Ask, more: Partial<ApproveAnswer> = {}): ApproveAnswer => ({
  promoCode: a.promoCode ?? null,
  status: a.status,
  reason: null,
  step: null,
  membershipStatus: null,
  message: null,
  ...more,
});

/**
 * The 30% page's transport, answered from the made-up database. Each answer
 * comes a moment later, as a real one would, so the busy states show.
 */
export function fixtureThirtyTransport(opts: {
  state: FixtureState;
  conflict: boolean;
  reloadFails?: boolean;
  /** Check Whop again gets no answer from Whop (?whop=down). */
  whopDown?: boolean;
  /** A plain Approve answers the old course's 409 with code "rule" (?approve=coursechanged). */
  courseChanged?: boolean;
  /** Whose page (?role=): the stand-in refuses a csm's override, and a csm's Reject of a code that may exist, as the routes do. */
  role?: FixtureRole;
}): ThirtyTransport & { calls: FixtureCall[] } {
  const db =
    opts.state === "empty"
      ? emptyDb()
      : opts.state === "partial"
        ? partialDb()
        : opts.state === "owncode"
          ? ownCodeDb()
          : opts.state === "stalecoupon"
            ? staleCouponDb()
            : opts.state === "unpaid"
              ? unpaidDb()
              : opts.state === "reasons"
                ? reasonsDb()
                : fullDb();
  const calls: FixtureCall[] = [];
  let minute = 0;
  let served = false;
  /** Each change happens a minute after the last, from FIXTURE_NOW. */
  const at = () => new Date(NOW_MS + 60_000 * ++minute).toISOString();
  const later = <T>(answer: Answer<T>) => new Promise<Answer<T>>((resolve) => setTimeout(() => resolve(answer), 300));
  const view = (): ThirtyView =>
    buildThirtyView(
      toData(db, { videosFail: opts.state === "novideos", couponsFail: opts.state === "nocoupons" }),
      new Date(FIXTURE_NOW),
      RESET_AT,
      liveCoupons(db, opts.state === "nocoupons"),
      opts.state === "paused",
    );
  const ask = (id: string) => db.asks.find((a) => a.id === id);
  const person = (id: string) => db.people.find((p) => p.id === id);
  const notFound = { ok: false as const, status: 404, error: "Request not found" };
  /** The code made and put on the membership, as the shared step does: approved, then applied. */
  const applyNow = (a: Ask) => {
    const when = at();
    if (!a.promoCode) a.promoCode = codeFor(a.studentId);
    if (!a.promoId) a.promoId = promoIdOf(a.promoCode);
    if (a.status === "pending") Object.assign(a, { reviewedAt: when, reviewedBy: ME });
    Object.assign(a, { status: "applied", appliedAt: when, appliedBy: ME });
    db.events.push({ askId: a.id, event: "code_made", at: when }, { askId: a.id, event: "applied", at: when });
  };
  /** A failed attempt in the request's history, as the shared step records it. */
  const failed = (a: Ask, f: { reason: ThirtyReason; step?: string; membershipStatus?: string; message?: string }) =>
    db.events.push({ askId: a.id, event: "attempt_failed", at: at(), ...f, code: a.promoCode ?? undefined });

  return {
    calls,

    loadThirty() {
      calls.push({ name: "loadThirty", args: [] });
      if (opts.state === "loading") return new Promise<Answer<ThirtyView>>(() => {});
      // "Later": once a read has been served, however many first reads the page made.
      if (opts.state === "error" || (opts.reloadFails && served)) {
        return later<ThirtyView>({
          ok: false,
          status: 500,
          error: "Couldn't read everything the 30% list needs, so nothing is shown. Try again.",
        });
      }
      const answer = later<ThirtyView>({ ok: true, status: 200, data: view() });
      void answer.then(() => {
        served = true;
      });
      return answer;
    },

    approve(id, override, overrideCoupon) {
      calls.push({ name: "approve", args: [id, override, overrideCoupon] });
      // Approve anyway is a founder's or an admin's: the route's 403, in the transport's words for it.
      if ((override || overrideCoupon) && opts.role === "csm") {
        return later<ApproveAnswer>({ ok: false, status: 403, error: "Your team account can't do this." });
      }
      const a = ask(id);
      if (!a) return later<ApproveAnswer>(notFound);
      if (opts.conflict) {
        // Another team member rejected it while Whop made the code: the route's 409 (decided_meanwhile).
        const code = codeFor(a.studentId);
        Object.assign(a, { status: "rejected", reviewedAt: at(), reviewedBy: "tm-jamie", reason: "Decided by another team member." });
        db.events.push({ askId: a.id, event: "rejected", at: at() });
        return later<ApproveAnswer>({
          ok: false,
          status: 409,
          error: `The Whop code ${code} was created, but this request had already been decided, so the code must be deleted in Whop.`,
        });
      }
      const p = a.press?.approve;
      if (p?.kind === "refused") return later<ApproveAnswer>({ ok: false, status: p.status, error: p.error });
      if (a.status === "approved") {
        // Try again: no checks; where the code is, then on, then applied (or why not). What the step cannot change
        // comes back as it was: a code with no Whop id, a code on someone else's membership, no telling whose.
        const last = eventsOf(db, a.id).filter((e) => e.event === "attempt_failed").at(-1);
        const stuck =
          p?.kind === "approved"
            ? p
            : !a.promoId
              ? { reason: "code_unknown" as const }
              : last && (last.reason === "landed_elsewhere" || (last.reason === "whop_no_answer" && (last.step === "where_filter" || last.step === "where_no_ids")))
                ? { reason: last.reason, step: last.step }
                : null;
        if (stuck) {
          failed(a, stuck);
          return later({
            ok: true,
            status: 200,
            data: approveAnswer(a, {
              reason: stuck.reason,
              step: "step" in stuck ? (stuck.step ?? null) : null,
              membershipStatus: "membershipStatus" in stuck ? (stuck.membershipStatus ?? null) : null,
              message: "message" in stuck ? (stuck.message ?? null) : null,
            }),
          });
        }
        applyNow(a);
        return later({ ok: true, status: 200, data: approveAnswer(a) });
      }
      if (a.status !== "pending") return later<ApproveAnswer>({ ok: false, status: 400, error: "Request already processed" });
      // D5, as the route: Whop now (the stored row when Whop says nothing new), stored, then refused, with `override`
      // too. Approve anyway on the coupon's row (`overrideCoupon`) does not ask Whop at all. Then, as the route since
      // 2026-10-26, no paid course plan and payment that went through refuses the normal Approve with code "rule".
      const pp = person(a.studentId);
      const now = pp?.live ?? pp?.stored;
      if (pp && now && !overrideCoupon) {
        pp.stored = now;
        const row = couponRow(pp, now, at());
        if (row.discounted) {
          return later<ApproveAnswer>({
            ok: false,
            status: 400,
            error: couponApprovalRefusal(row.promo_code),
            code: "has-discount",
          });
        }
        if (rowShowsUnpaid(row) && !override) {
          return later<ApproveAnswer>({ ok: false, status: 400, error: UNPAID_APPROVAL, code: "rule" });
        }
      }
      if (!override) {
        if (opts.courseChanged) {
          return later<ApproveAnswer>({ ok: false, status: 409, error: COURSE_CHANGED, code: "rule" });
        }
        const verdict = view().requests.find((r) => r.id === id)?.verdict;
        if (!verdict?.ok) {
          return later<ApproveAnswer>({ ok: false, status: 400, error: "Cannot approve: the rule says no.", code: "rule" });
        }
      }
      if (p?.kind === "approved") {
        // Made and approved, not on the membership yet.
        a.promoCode = a.promoCode ?? codeFor(a.studentId);
        Object.assign(a, { status: "approved", promoId: promoIdOf(a.promoCode), reviewedAt: at(), reviewedBy: ME });
        db.events.push({ askId: a.id, event: "code_made", at: at() });
        failed(a, p);
        return later({ ok: true, status: 200, data: approveAnswer(a, { reason: p.reason, step: p.step ?? null, membershipStatus: p.membershipStatus ?? null, message: p.message ?? null }) });
      }
      if (p?.kind === "pending") {
        // Nothing made yet, or a claim whose create Whop never answered.
        if (p.claim) a.promoCode = p.claim;
        failed(a, p);
        return later({ ok: true, status: 200, data: approveAnswer(a, { reason: p.reason, step: p.step ?? null, message: p.message ?? null }) });
      }
      applyNow(a);
      return later({ ok: true, status: 200, data: approveAnswer(a) });
    },

    reject(id, reason) {
      calls.push({ name: "reject", args: [id, reason] });
      const a = ask(id);
      if (!a) return later<RejectAnswer>(notFound);
      if (opts.conflict) {
        // Another team member approved it first, and the code is on.
        Object.assign(a, { status: "approved", promoCode: codeFor(a.studentId), promoId: promoIdOf(codeFor(a.studentId)), reviewedAt: at(), reviewedBy: "tm-jamie" });
        return later<RejectAnswer>({ ok: false, status: 409, error: "This request was already decided." });
      }
      if (a.status !== "pending" && a.status !== "approved") return later<RejectAnswer>({ ok: false, status: 409, error: "This request was already decided." });
      // A request whose code may exist is a founder's or an admin's to reject (the reject route's 403, in the transport's words).
      const mayExist = a.promoCode != null || a.promoId != null;
      if (mayExist && opts.role === "csm") return later<RejectAnswer>({ ok: false, status: 403, error: "Your team account can't do this." });
      const p = a.press?.reject;
      if (p?.kind === "refused") return later<RejectAnswer>({ ok: false, status: p.status, error: p.error });
      // As the route: no code, rejected; a code with no Whop id, one that may exist; a code made, left usable at checkout.
      const codeState: RejectAnswer["codeState"] =
        p?.kind === "rejected" ? p.codeState : a.status === "approved" ? (a.promoId ? "usable" : "may_exist") : a.promoId ? "usable" : null;
      const code = codeState ? (a.promoCode ?? null) : null;
      // A claim never made is given back with the rejection.
      if (a.status === "pending" && !a.promoId) a.promoCode = null;
      Object.assign(a, { status: "rejected", reason, reviewedAt: at(), reviewedBy: ME });
      db.events.push({ askId: a.id, event: "rejected", at: at() });
      return later<RejectAnswer>({ ok: true, status: 200, data: { code, codeState } });
    },

    checkCoupon(id) {
      calls.push({ name: "checkCoupon", args: [id] });
      type Checked = { discounted: boolean; code: string | null; unpaid: boolean };
      const a = ask(id);
      const p = a ? person(a.studentId) : undefined;
      if (!a || !p) return later<Checked>(notFound);
      if (a.status !== "pending") return later<Checked>({ ok: false, status: 409, error: "This request was already decided." });
      if (opts.whopDown) {
        return later<Checked>({ ok: false, status: 502, error: "Whop gave no answer, so nothing changed. Try again in a minute." });
      }
      // As the route: Whop now (the stored row when Whop says nothing new), and what it read stored.
      const now = p.live ?? p.stored ?? CLEAN;
      p.stored = now;
      const row = couponRow(p, now, at());
      return later<Checked>({
        ok: true,
        status: 200,
        data: { discounted: row.discounted, code: row.promo_code ?? row.promo_code_id, unpaid: rowShowsUnpaid(row) },
      });
    },
  };
}
