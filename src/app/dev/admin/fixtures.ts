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
 * "has-discount", override or not, and stores what it read, as the route
 * does (checkMembershipDiscount).
 *
 *   ?state=full | empty | loading | error   (default full)
 *          partial    full, plus a student whose progress cannot be read
 *          novideos   full, with the course's videos unreadable
 *          nocoupons  full, with the stored coupons unreadable
 *   ?conflict=1   approve, reject and mark-applied answer as if another team
 *                 member decided the request first: approve and reject with
 *                 lane G1's 409 and its sentence, mark-applied with its 400
 *   ?reload=fail  the first read of the list works, every later one fails
 *
 * The page's clock is FIXTURE_NOW, so every date reads the same on every run.
 */

import { buildThirtyView } from "@/lib/admin/thirty-view";
import type { ThirtyView } from "@/lib/admin/thirty-view";
import type { ThirtyCouponRow, ThirtyData, ThirtyRequest, ThirtyStudent } from "@/lib/admin/thirty-data";
import type { Answer, ThirtyTransport } from "@/lib/admin/admin-transport";
import { DISCOUNT_ELIGIBLE_FROM } from "@/lib/world/discount";
import { couponApprovalRefusal } from "@/lib/world/discount-server";
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
/** A Whop membership as the coupon rule reads it: a code, the next renewal's price and the plan's. */
interface Membership {
  code: string | null;
  renewal: number;
  plan: number;
}

interface Person {
  id: string;
  name: string;
  username?: string;
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
  /** What Whop says about the membership now, when it is not what is stored: the approve route reads it. */
  live?: Membership;
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

function fullDb(): FixtureDb {
  return {
    people: [
      // Applied: the rule says yes.
      { id: "p-maya", name: "Maya Lindqvist", username: "maya.lq", paid: "2026-10-01T09:00:00.000Z", done: 61, stored: USED_UP },
      { id: "p-jonah", name: "Jonah Pereira", username: "jonah_p", paid: "2026-10-12T15:00:00.000Z", done: 61, doneAt: "2026-10-19T20:00:00.000Z" },
      // Applied: 4 videos missing, payment failed, no Whop backfill since the switch.
      { id: "p-priya", name: "Priya Raman", status: "past_due", paid: "2026-10-03T08:00:00.000Z", done: 57, synced: "2026-10-18T10:00:00.000Z" },
      // Applied: asked on the old course, before the switch.
      { id: "p-sofia", name: "Sofia Marin", username: "sofia.marin", paid: "2026-10-05T10:00:00.000Z", done: 40 },
      // Applied: first payment before 1 October.
      { id: "p-leo", name: "Leo Hartmann", status: "canceled", paid: "2026-09-15T10:00:00.000Z", done: 61 },
      // Applied: a second request after a rejected one (and a long name).
      { id: "p-max", name: "Maximilian Featherstonehaugh-Smythe", username: "max.fs", paid: "2026-10-09T10:00:00.000Z", done: 61, doneAt: "2026-10-17T09:00:00.000Z" },
      // Applied: every video done, and the forever 10% on the membership: the coupon decides (D5).
      { id: "p-tara", name: "Tara Quinn", username: "tara.q", paid: "2026-10-10T09:00:00.000Z", done: 61, stored: EVOLVE },
      // Applied: every video done, nothing stored yet, and Whop says now that a code applies: Approve is refused.
      { id: "p-hugo", name: "Hugo Lindahl", username: "hugo.l", paid: "2026-10-11T09:00:00.000Z", done: 61, live: EVOLVE },
      // Approved: one with the forever 10% on the membership (approved before the coupon rule).
      { id: "p-ethan", name: "Ethan Cole", username: "ethan.cole", paid: "2026-10-02T09:00:00.000Z", done: 61 },
      { id: "p-nora", name: "Nora Brandt", username: "nora.b", paid: "2026-10-10T12:00:00.000Z", done: 61, stored: EVOLVE },
      // Code Applied.
      { id: "p-omar", name: "Omar Haddad", paid: "2026-10-01T12:00:00.000Z", done: 61 },
      { id: "p-lena", name: "Lena Vogel", username: "lena.v", status: "past_due", paid: "2026-10-04T08:00:00.000Z", done: 61 },
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
        reviewedAt: "2026-10-18T09:00:00.000Z", reviewedBy: "tm-robin", promoCode: "ECOM30-3F9A21",
      },
      {
        id: "r-nora", studentId: "p-nora", status: "approved", createdAt: "2026-10-19T19:00:00.000Z",
        reviewedAt: "2026-10-20T07:45:00.000Z", reviewedBy: "tm-jamie", promoCode: "ECOM30-7B20C4",
      },
      {
        id: "r-omar", studentId: "p-omar", status: "applied", createdAt: "2026-10-13T08:00:00.000Z",
        reviewedAt: "2026-10-14T09:00:00.000Z", reviewedBy: "tm-robin", appliedAt: "2026-10-15T10:00:00.000Z", appliedBy: "tm-jamie",
        promoCode: "ECOM30-A1D9E0",
      },
      {
        id: "r-lena", studentId: "p-lena", status: "applied", createdAt: "2026-10-15T08:00:00.000Z",
        reviewedAt: "2026-10-16T09:00:00.000Z", reviewedBy: "tm-jamie", appliedAt: "2026-10-17T10:00:00.000Z", appliedBy: "tm-jamie",
        promoCode: "ECOM30-C55E10",
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
  return {
    student_id: p.id,
    whop_membership_id: membershipOf(p),
    promo_code_id: m.code ? `promo_dev${m.code}` : null,
    promo_code: m.code,
    renewal_price: m.renewal,
    plan_renewal_price: m.plan,
    discounted: m.code !== null && Math.round(m.renewal * 100) < Math.round(m.plan * 100),
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

// ── The stand-in for the server ─────────────────────────────────────────────
export type FixtureState = "full" | "empty" | "loading" | "error" | "partial" | "novideos" | "nocoupons";

const STATES: FixtureState[] = ["full", "empty", "loading", "error", "partial", "novideos", "nocoupons"];

export function parseFixtureState(value: string | null): FixtureState {
  return STATES.find((s) => s === value) ?? "full";
}

/** One call the page made, for world-tests to read (window.__adminCalls on the dev page). */
export interface FixtureCall {
  name: "loadThirty" | "approve" | "reject" | "markApplied";
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
}): ThirtyTransport & { calls: FixtureCall[] } {
  const db = opts.state === "empty" ? emptyDb() : opts.state === "partial" ? partialDb() : fullDb();
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

    approve(id, override) {
      calls.push({ name: "approve", args: [id, override] });
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
      // D5, as the route: Whop now (the stored row when Whop says nothing new), stored, then refused with no override.
      const p = person(a.studentId);
      const now = p?.live ?? p?.stored;
      if (p && now) {
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
      }
      if (!override) {
        const verdict = view().requests.find((r) => r.id === id)?.verdict;
        if (!verdict?.ok) {
          return later<{ promoCode: string | null }>({ ok: false, status: 400, error: "Cannot approve: the rule says no." });
        }
      }
      Object.assign(a, { status: "approved", promoCode: codeFor(a.studentId), reviewedAt: at(), reviewedBy: ME });
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
  };
}
