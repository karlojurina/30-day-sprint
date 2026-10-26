/**
 * Made-up data for the dev admin pages under /dev/admin (admin rebuild PRD,
 * section 9). Development only: the pages that import this call notFound()
 * anywhere else.
 *
 * MADE-UP PEOPLE ONLY. This repository is public: every student, team
 * member, Whop id, code and link below is invented.
 *
 * THE 30% PAGE (/dev/admin/discounts; admin rebuild 2, D4 and D5). The
 * fixture is a small database (people, their videos, their requests, the
 * coupon stored for their Whop membership and what Whop would say now), and
 * every load runs the real buildThirtyView over it
 * (src/lib/admin/thirty-view.ts), the builder behind GET /api/admin/thirty.
 * So the verdicts, counts and coupons on the dev page are the student app's
 * own rule, not text typed here. The decision buttons change that database
 * the way the routes do, so a click and the reload after it show what the
 * team would see: Approve refuses a student whose membership has a discount
 * on its next renewal with the approve route's own sentence and code
 * "has-discount" (with `override` too), and stores what it read, as the
 * route does (checkMembershipDiscount); Approve anyway on the coupon's row
 * (`overrideCoupon`, a founder's or an admin's, the owner's review of
 * 2026-10-21) passes it. A refusal of the rule carries code "rule", as the
 * route's does, and a csm's override is refused as the route refuses it.
 *
 *   ?state=full | empty | loading | error   (default full)
 *          partial    full, plus a student whose progress cannot be read
 *          novideos   full, with the course's videos unreadable
 *          nocoupons  full, with the stored coupons unreadable and Whop
 *                     giving no answer about the Approved rows' coupons
 *          owncode    full, with the team's own 30% codes already added in
 *                     Whop for the two Approved rows (Mark code applied not
 *                     pressed yet): Ethan's named ECOM30-3F9A21, Nora's with
 *                     no name read, only the request's own Whop promo id. No
 *                     coupon warning on either (the render review's fix round)
 *          stalecoupon  full, with the forever 10% taken off Tara's
 *                     membership in Whop since the cron stored it: her row
 *                     still offers only Reject, and Check Whop again finds no
 *                     discount, so the rule decides her row and Approve is
 *                     back (the render review's second round)
 *          nopayment  full, with Whop showing no real payment from two
 *                     students who watched enough (the review of 2026-10-26,
 *                     the owner's applicant who "never paid"): Jonah's stored
 *                     row says so, so his verdict does and he has no Approve;
 *                     Maya's stored row is a clean one and Whop says so only
 *                     now, so her Approve is refused with code "rule", the
 *                     answer stored, and her row then reads the same. Approve
 *                     anyway passes both
 *
 * The Approved rows' coupon is what Whop says now (liveCoupons, as
 * GET /api/admin/thirty asks it): Ethan was approved before the coupon rule
 * with nothing stored, and Whop names the forever 10%; for Nora Whop gives
 * no answer, and the stored row stands in, with its date. Check Whop again
 * (POST /api/admin/thirty/check-coupon) reads Whop the way the approve route
 * does here, and stores what it read.
 *   ?conflict=1   approve, reject and mark-applied answer as if another team
 *                 member decided the request first: approve and reject with
 *                 lane G1's 409 and its sentence, mark-applied with its 400
 *   ?reload=fail  the first read of the list works, every later one fails
 *   ?whop=down    Check Whop again gets no answer from Whop: the route's 502
 *                 and its sentence, and nothing changes
 *
 * The page's clock is FIXTURE_NOW, so every date reads the same on every run.
 *
 * The 80% rule (the owner, 2026-10-26: 49 of the 61 videos): Jonah has
 * watched 49, the least that meets it, and Priya 48, one short. Copy Discord
 * ID and Copy username (the same day; "Copy ID" and "Copy @" until its
 * review): Maya has both an id and a username, Hugo a username only, Leo and
 * Omar an id only, Priya neither (her row says so in a line), and Lena's
 * username is stored with its own "@" (copied with one). Every Discord id is
 * invented.
 */

import { buildThirtyView } from "@/lib/admin/thirty-view";
import type { ThirtyView } from "@/lib/admin/thirty-view";
import type { LiveCoupon, ThirtyCouponRow, ThirtyData, ThirtyRequest, ThirtyStudent } from "@/lib/admin/thirty-data";
import type { Answer, ThirtyTransport } from "@/lib/admin/admin-transport";
import { DISCOUNT_ELIGIBLE_FROM } from "@/lib/world/discount";
import { NO_REAL_PAYMENT_APPROVAL, couponApprovalRefusal } from "@/lib/world/discount-server";
import { rowShowsNoRealPayment } from "@/lib/membership-discount";
import type { CatalogLessonRow, CompletionRow, DiscountReads, VideoRow } from "@/lib/world/discount-server";

/** Tue 20 Oct 2026, 10:30 in Croatia: the moment every dev load is read at. */
export const FIXTURE_NOW = "2026-10-20T08:30:00.000Z";
/** The course switch (v104), as admin_config holds it. */
const RESET_AT = "2026-10-19T14:33:00.000Z";
/** The videos, loaded the morning of the switch. */
const LOADED = "2026-10-19T10:00:00.000Z";
/** The first Whop backfill after the switch. */
const FROM_WHOP = "2026-10-19T16:00:00.000Z";
/** The last cron run of the coupons, 10:40 in Croatia the day before. */
const COUPONS_READ = "2026-10-19T08:40:00.000Z";

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
 * code: the rule's "no real payment" answer (NO_PAYMENT).
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
  /** What Whop says about the membership now, when it is not what is stored: the approve route reads it, and the page for an Approved row. */
  live?: Membership;
  /** Whop gives no answer about their membership now (the page's read for an Approved row). */
  liveFails?: boolean;
}

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
  /** The Whop promo id of promoCode, as the approve route stores it (whop_promo_id). */
  promoId?: string | null;
  reason?: string | null;
}

interface FixtureDb {
  people: Person[];
  asks: Ask[];
}

/** The forever 10% code a partner's members are on: renews at 87.30 on the 97.00 plan. */
const EVOLVE: Membership = { code: "evolve10", renewal: 87.3, plan: 97 };
/** A one-month code that is used up: the id stays on the membership, and it renews at full price. */
const USED_UP: Membership = { code: "welcome50", renewal: 97, plan: 97 };
/** No code: the cron read the membership and found nothing. */
const CLEAN: Membership = { code: null, renewal: 97, plan: 97 };
/**
 * Whop shows no real payment (the review of 2026-10-26): no course membership with a price and no paid course
 * payment, which the rule stores as a row with no code and no price (membership-discount.ts rowShowsNoRealPayment).
 */
const NO_PAYMENT: Membership = { code: null, renewal: null, plan: null };

function fullDb(): FixtureDb {
  return {
    people: [
      // Applied: the rule says yes.
      { id: "p-maya", name: "Maya Lindqvist", username: "maya.lq", discordId: "100000000000000101", paid: "2026-10-01T09:00:00.000Z", done: 61, stored: USED_UP },
      // Applied: 49 of the 61 watched, the least the 80% takes (2026-10-26).
      { id: "p-jonah", name: "Jonah Pereira", username: "jonah_p", discordId: "100000000000000102", paid: "2026-10-12T15:00:00.000Z", done: 49, doneAt: "2026-10-19T20:00:00.000Z", stored: CLEAN },
      // Applied: 48 of the 61, one short of the 80%, payment failed, no Whop backfill since the switch; no Discord on file.
      { id: "p-priya", name: "Priya Raman", status: "past_due", paid: "2026-10-03T08:00:00.000Z", done: 48, synced: "2026-10-18T10:00:00.000Z", stored: CLEAN },
      // Applied: asked on the old course, before the switch.
      { id: "p-sofia", name: "Sofia Marin", username: "sofia.marin", discordId: "100000000000000104", paid: "2026-10-05T10:00:00.000Z", done: 40, stored: CLEAN },
      // Applied: first payment before 1 October; canceled, so the cron never checked the coupon. A Discord id, no username.
      { id: "p-leo", name: "Leo Hartmann", status: "canceled", discordId: "100000000000000105", paid: "2026-09-15T10:00:00.000Z", done: 61 },
      // Applied: a second request after a rejected one (and a long name).
      { id: "p-max", name: "Maximilian Featherstonehaugh-Smythe", username: "max.fs", discordId: "100000000000000106", paid: "2026-10-09T10:00:00.000Z", done: 61, doneAt: "2026-10-17T09:00:00.000Z", stored: CLEAN },
      // Applied: every video done, and the forever 10% on the membership: the coupon decides (D5).
      { id: "p-tara", name: "Tara Quinn", username: "tara.q", discordId: "100000000000000107", paid: "2026-10-10T09:00:00.000Z", done: 61, stored: EVOLVE },
      // Applied: every video done, nothing stored yet, and Whop says now that a code applies: Approve is refused. A username, no Discord id.
      { id: "p-hugo", name: "Hugo Lindahl", username: "hugo.l", paid: "2026-10-11T09:00:00.000Z", done: 61, live: EVOLVE },
      // Approved before the coupon rule, so nothing was ever stored for him: Whop says now the forever 10% is on the membership.
      { id: "p-ethan", name: "Ethan Cole", username: "ethan.cole", discordId: "100000000000000109", paid: "2026-10-02T09:00:00.000Z", done: 61, live: EVOLVE },
      // Approved, the forever 10% stored by the cron, and Whop gives no answer now: the stored row is shown, with its date.
      { id: "p-nora", name: "Nora Brandt", username: "nora.b", discordId: "100000000000000110", paid: "2026-10-10T12:00:00.000Z", done: 61, stored: EVOLVE, liveFails: true },
      // Code Applied. Omar: a Discord id, no username. Lena: her username stored with its "@".
      { id: "p-omar", name: "Omar Haddad", discordId: "100000000000000111", paid: "2026-10-01T12:00:00.000Z", done: 61 },
      { id: "p-lena", name: "Lena Vogel", username: "@lena.v", discordId: "100000000000000112", status: "past_due", paid: "2026-10-04T08:00:00.000Z", done: 61 },
      // Rejected.
      { id: "p-ruby", name: "Ruby Okafor", username: "ruby.ok", paid: "2026-10-11T09:00:00.000Z", done: 30 },
      { id: "p-felix", name: "Felix Moreau", paid: "2026-10-06T09:00:00.000Z", done: 20 },
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
      {
        id: "r-ethan", studentId: "p-ethan", status: "approved", createdAt: "2026-10-17T08:00:00.000Z",
        reviewedAt: "2026-10-18T09:00:00.000Z", reviewedBy: "tm-robin", promoCode: "ECOM30-3F9A21", promoId: promoIdOf("ECOM30-3F9A21"),
      },
      {
        id: "r-nora", studentId: "p-nora", status: "approved", createdAt: "2026-10-19T19:00:00.000Z",
        reviewedAt: "2026-10-20T07:45:00.000Z", reviewedBy: "tm-jamie", promoCode: "ECOM30-7B20C4", promoId: promoIdOf("ECOM30-7B20C4"),
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
  };
}

function emptyDb(): FixtureDb {
  return { people: [], asks: [] };
}

/**
 * The full fixture, with the team's own 30% codes already on the two Approved
 * memberships in Whop (added there, Mark code applied not pressed yet):
 * Ethan's read with its name, Nora's with only its Whop promo id, the
 * request's own whop_promo_id.
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
 * The full fixture, with Whop showing no real payment from Jonah (stored) and
 * from Maya (only now, so her stored row is still a clean one): the review of
 * 2026-10-26.
 */
function noPaymentDb(): FixtureDb {
  const db = fullDb();
  db.people.find((p) => p.id === "p-jonah")!.stored = NO_PAYMENT;
  db.people.find((p) => p.id === "p-maya")!.live = NO_PAYMENT;
  return db;
}

/** The full fixture plus one student whose progress cannot be read, with a request waiting. */
function partialDb(): FixtureDb {
  const db = fullDb();
  db.people.push({ id: "p-nina", name: "Nina Petrova", username: "nina.p", paid: "2026-10-08T09:00:00.000Z", done: 61, readFails: true });
  db.asks.push({ id: "r-nina", studentId: "p-nina", status: "pending", createdAt: "2026-10-20T07:40:00.000Z" });
  return db;
}

const READ_FAILED = { message: "canceling statement due to statement timeout" };

/** The completion rows of the videos a person finished. */
function completionsOf(p: Person): CompletionRow[] {
  return REQUIRED.slice(0, p.done ?? 0).map((lesson_id) => ({ lesson_id, completed_at: p.doneAt ?? FROM_WHOP }));
}

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const membershipOf = (p: Person) => `mem_dev${p.id.replace(/[^a-z]/g, "")}`;

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

/**
 * The made-up database in the shape loadThirtyData hands buildThirtyView:
 * the requests from 1 October, the students holding them, each one's five
 * reads, and the stored coupons. A failed read is that read's
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
  // The page lists the requests from 1 October, as loadThirtyData reads them.
  const requests = all.filter((r) => r.created_at >= DISCOUNT_ELIGIBLE_FROM).sort(byId);
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

  return {
    catalog: { data: LESSONS, error: null },
    videos: videoRead,
    students,
    reads,
    requests,
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
  | "nopayment";

const STATES: FixtureState[] = ["full", "empty", "loading", "error", "partial", "novideos", "nocoupons", "owncode", "stalecoupon", "nopayment"];

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
  name: "loadThirty" | "approve" | "reject" | "markApplied" | "checkCoupon";
  args: unknown[];
}

/** A made-up code in the approve route's shape, ECOM30- and six characters, the same for the same student. */
function codeFor(studentId: string): string {
  let h = 7;
  for (const ch of studentId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `ECOM30-${h.toString(16).toUpperCase().padStart(6, "0").slice(-6)}`;
}

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
  /** Whose page (?role=): the stand-in refuses a csm's override, as the approve route does. */
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
            : opts.state === "nopayment"
              ? noPaymentDb()
              : fullDb();
  const calls: FixtureCall[] = [];
  let minute = 0;
  let served = false;
  /** Each change happens a minute after the last, from FIXTURE_NOW. */
  const at = () => new Date(Date.parse(FIXTURE_NOW) + 60_000 * ++minute).toISOString();
  const later = <T>(answer: Answer<T>) => new Promise<Answer<T>>((resolve) => setTimeout(() => resolve(answer), 300));
  const view = (): ThirtyView =>
    buildThirtyView(
      toData(db, { videosFail: opts.state === "novideos", couponsFail: opts.state === "nocoupons" }),
      new Date(FIXTURE_NOW),
      RESET_AT,
      liveCoupons(db, opts.state === "nocoupons"),
    );
  const ask = (id: string) => db.asks.find((a) => a.id === id);
  const person = (id: string) => db.people.find((p) => p.id === id);
  const notFound = { ok: false as const, status: 404, error: "Request not found" };

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
        return later<{ promoCode: string | null }>({ ok: false, status: 403, error: "Your team account can't do this." });
      }
      const a = ask(id);
      if (!a) return later<{ promoCode: string | null }>(notFound);
      if (opts.conflict) {
        // Another team member rejected it while Whop made the code: lane G1's 409.
        const code = codeFor(a.studentId);
        Object.assign(a, { status: "rejected", reviewedAt: at(), reviewedBy: "tm-jamie", reason: "Decided by another team member." });
        return later<{ promoCode: string | null }>({
          ok: false,
          status: 409,
          error: `The Whop code ${code} was created, but this request had already been decided, so the code must be deleted in Whop.`,
        });
      }
      if (a.status !== "pending") return later<{ promoCode: string | null }>({ ok: false, status: 400, error: "Request already processed" });
      // D5, as the route: Whop now (the stored row when Whop says nothing new), stored, then refused, with `override`
      // too. Approve anyway on the coupon's row (`overrideCoupon`) does not ask Whop at all. Then, as the route since
      // 2026-10-26, Whop showing no real payment refuses the normal Approve with code "rule".
      const p = person(a.studentId);
      const now = p?.live ?? p?.stored;
      if (p && now && !overrideCoupon) {
        p.stored = now;
        const row = couponRow(p, now, at());
        if (row.discounted) {
          return later<{ promoCode: string | null }>({
            ok: false,
            status: 400,
            error: couponApprovalRefusal(row.promo_code),
            code: "has-discount",
          });
        }
        if (rowShowsNoRealPayment(row) && !override) {
          return later<{ promoCode: string | null }>({ ok: false, status: 400, error: NO_REAL_PAYMENT_APPROVAL, code: "rule" });
        }
      }
      if (!override) {
        if (opts.courseChanged) {
          return later<{ promoCode: string | null }>({ ok: false, status: 409, error: COURSE_CHANGED, code: "rule" });
        }
        const verdict = view().requests.find((r) => r.id === id)?.verdict;
        if (!verdict?.ok) {
          return later<{ promoCode: string | null }>({ ok: false, status: 400, error: "Cannot approve: the rule says no.", code: "rule" });
        }
      }
      Object.assign(a, { status: "approved", promoCode: codeFor(a.studentId), promoId: promoIdOf(codeFor(a.studentId)), reviewedAt: at(), reviewedBy: ME });
      return later({ ok: true, status: 200, data: { promoCode: a.promoCode ?? null } });
    },

    reject(id, reason) {
      calls.push({ name: "reject", args: [id, reason] });
      const a = ask(id);
      if (!a) return later<null>(notFound);
      if (opts.conflict) {
        // Another team member approved it first.
        Object.assign(a, { status: "approved", promoCode: codeFor(a.studentId), reviewedAt: at(), reviewedBy: "tm-jamie" });
        return later<null>({ ok: false, status: 409, error: "This request was already decided." });
      }
      if (a.status !== "pending") return later<null>({ ok: false, status: 409, error: "This request was already decided." });
      Object.assign(a, { status: "rejected", reason, reviewedAt: at(), reviewedBy: ME });
      return later<null>({ ok: true, status: 200, data: null });
    },

    markApplied(id) {
      calls.push({ name: "markApplied", args: [id] });
      const a = ask(id);
      if (!a) return later<null>(notFound);
      if (opts.conflict) {
        Object.assign(a, { status: "applied", appliedAt: at(), appliedBy: "tm-jamie" });
        return later<null>({ ok: false, status: 400, error: 'Only an approved request can be marked applied. This one is "applied".' });
      }
      if (a.status !== "approved") {
        return later<null>({ ok: false, status: 400, error: `Only an approved request can be marked applied. This one is "${a.status}".` });
      }
      Object.assign(a, { status: "applied", appliedAt: at(), appliedBy: ME });
      return later<null>({ ok: true, status: 200, data: null });
    },

    checkCoupon(id) {
      calls.push({ name: "checkCoupon", args: [id] });
      type Checked = { discounted: boolean; code: string | null };
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
      return later<Checked>({ ok: true, status: 200, data: { discounted: row.discounted, code: row.promo_code ?? row.promo_code_id } });
    },
  };
}
