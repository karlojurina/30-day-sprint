/**
 * Made-up data for the dev admin pages under /dev/admin (admin rebuild PRD,
 * section 9). Development only: the pages that import this call notFound()
 * anywhere else.
 *
 * MADE-UP PEOPLE ONLY. This repository is public: every student, team
 * member, Discord id, link and code below is invented.
 *
 * THE 30% PAGE (/dev/admin/discounts). The fixture is a small database
 * (people, their videos and hand-ins, their requests, the team's messages),
 * and every load runs the real buildThirtyView over it
 * (src/lib/admin/thirty-view.ts), the builder behind GET /api/admin/thirty.
 * So the verdicts, counts and deadlines on the dev page are the student
 * app's own rule, not text typed here. The decision buttons change that
 * database the way the routes do, so a click and the reload after it show
 * what the team would see.
 *
 *   ?state=full | empty | loading | error   (default full)
 *          partial    full, plus a student whose progress cannot be read
 *          novideos   full, with the course's videos unreadable
 *   ?conflict=1   approve, reject and mark-applied answer as if another team
 *                 member decided the request first: approve and reject with
 *                 lane G1's 409 and its sentence, mark-applied with its 400
 *   ?reload=fail  the first read of the list works, every later one fails
 *
 * The page's clock is FIXTURE_NOW, so every date and "days left" reads the
 * same on every run.
 *
 * Today's fixtures went with Today (admin rebuild 2, D2). The people below
 * who are on no tab (Can still earn, which the page no longer shows) still
 * feed the answer's canStillEarn, as the route's answer still carries it.
 */

import { buildThirtyView } from "@/lib/admin/thirty-view";
import type { ThirtyView } from "@/lib/admin/thirty-view";
import type {
  ThirtyAnswer,
  ThirtyCompletion,
  ThirtyContact,
  ThirtyData,
  ThirtyLesson,
  ThirtyQuestion,
  ThirtyRequest,
  ThirtyStudent,
} from "@/lib/admin/thirty-data";
import type { Answer, ThirtyTransport } from "@/lib/admin/admin-transport";
import { DISCOUNT_ELIGIBLE_FROM } from "@/lib/world/discount";
import type { CatalogLessonRow, DiscountReads, VideoRow } from "@/lib/world/discount-server";

/** Tue 20 Oct 2026, 10:30 in Croatia: the moment every dev load is read at. */
export const FIXTURE_NOW = "2026-10-20T08:30:00.000Z";
/** The course switch (v104), as admin_config holds it. */
const RESET_AT = "2026-10-19T14:33:00.000Z";
/** The videos, loaded the morning of the switch. */
const LOADED = "2026-10-19T10:00:00.000Z";
/** The first Whop backfill after the switch. */
const FROM_WHOP = "2026-10-19T16:00:00.000Z";

const MONTHLY = "plan_4ZrwR4PmBsVsx";
const YEARLY = "plan_VFDntXQf9cYMo";
const OTHER = "plan_dev_other";

/** The team member the dev pages act as. */
const ME = "tm-robin";
const TEAM = new Map([
  ["tm-robin", "Robin Hale"],
  ["tm-jamie", "Jamie Rowe"],
]);

// ── The course: 61 videos up to the checkpoint, two of them action items, and
// one action item with no video after it. Titles are made up.
const ACTION_TITLES: Record<string, string> = {
  v20: "Find three ads that sell",
  v40: "Write five hooks",
  s01: "Send your first edit",
};
const LESSONS: ThirtyLesson[] = [
  ...Array.from({ length: 61 }, (_, i): ThirtyLesson => {
    const id = `v${String(i + 1).padStart(2, "0")}`;
    return {
      id,
      type: "watch",
      counts_toward_progress: true,
      is_gate: i === 60,
      duration_seconds: 240 + ((i * 97) % 540),
      title: ACTION_TITLES[id] ?? `Video ${i + 1}`,
      requires_action: id in ACTION_TITLES,
    };
  }),
  {
    id: "s01",
    type: "setup",
    counts_toward_progress: true,
    is_gate: false,
    duration_seconds: null,
    title: ACTION_TITLES.s01,
    requires_action: true,
  },
];
const REQUIRED = LESSONS.filter((l) => l.type === "watch").map((l) => l.id);
const VIDEOS: VideoRow[] = REQUIRED.map((lesson_id) => ({ lesson_id, created_at: LOADED }));
const LESSON_READ: CatalogLessonRow[] = LESSONS.map(({ id, type, counts_toward_progress, is_gate, duration_seconds }) => ({
  id,
  type,
  counts_toward_progress,
  is_gate,
  duration_seconds,
}));

const QUESTIONS: ThirtyQuestion[] = [
  { id: "q1", order_num: 1, question_text: "How likely are you to recommend the course to a friend, from 0 to 10?", question_type: "scale" },
  { id: "q2", order_num: 2, question_text: "Where did you first hear about the course?", question_type: "multi_choice" },
  { id: "q3", order_num: 3, question_text: "What should the course add?", question_type: "open_text" },
];

// ── The made-up database ────────────────────────────────────────────────────
interface Person {
  id: string;
  name: string;
  discordUserId?: string;
  discordUsername?: string;
  plan: string | null;
  status?: string;
  exempt?: boolean;
  paid: string | null;
  /** The last Whop backfill. Left out: one after the switch. null: none ever. */
  synced?: string | null;
  /** The first `done` of the 61 videos were finished at `doneAt`. */
  done?: number;
  doneAt?: string;
  /** Action items handed in, or started and not handed in. */
  handIns?: Record<string, { handedIn: boolean; link?: string }>;
  /** Their completions cannot be read (a timed-out batch). */
  readFails?: boolean;
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
  answers?: Record<string, string | number>;
}

interface Contact {
  studentId: string;
  scenarioId: string;
  completedAt: string;
  completedBy: string;
  outcome?: "replied" | "no_reply" | null;
}

/** A task in the Tasks queue (stalled.* and nolessons.*, as the crons open them). */
interface QueueTask {
  id: string;
  studentId: string;
  scenarioId: string;
  summary: string | null;
  createdAt: string;
  status: "open" | "completed";
  completedAt?: string | null;
  completedBy?: string | null;
}

interface FixtureDb {
  people: Person[];
  asks: Ask[];
  contacts: Contact[];
  queue: QueueTask[];
}

function fullDb(): FixtureDb {
  return {
    people: [
      // To decide: the rule says yes.
      {
        id: "p-maya", name: "Maya Lindqvist", discordUserId: "100000000000000101", discordUsername: "maya.lq",
        plan: MONTHLY, paid: "2026-10-01T09:00:00.000Z", done: 61,
        handIns: {
          v20: { handedIn: true, link: "https://discord.com/channels/100000000000000001/100000000000000002/100000000000000003" },
          v40: { handedIn: false },
        },
      },
      // To decide: the rule says yes, on a yearly plan, reached by @name only.
      {
        id: "p-jonah", name: "Jonah Pereira", discordUsername: "jonah_p", plan: YEARLY,
        paid: "2026-10-12T15:00:00.000Z", done: 61, doneAt: "2026-10-19T20:00:00.000Z",
        handIns: { v20: { handedIn: true, link: "https://discord.com/channels/100000000000000001/100000000000000002/100000000000000004" } },
      },
      // To decide: 4 videos missing, payment failed, no Whop backfill since the switch, no Discord.
      { id: "p-priya", name: "Priya Raman", plan: MONTHLY, status: "past_due", paid: "2026-10-03T08:00:00.000Z", done: 57, synced: "2026-10-18T10:00:00.000Z" },
      // To decide: asked on the old course, before the switch.
      { id: "p-sofia", name: "Sofia Marin", discordUsername: "sofia.marin", plan: MONTHLY, paid: "2026-10-05T10:00:00.000Z", done: 40 },
      // To decide: first payment before 1 October.
      { id: "p-leo", name: "Leo Hartmann", discordUserId: "100000000000000105", plan: OTHER, status: "canceled", paid: "2026-09-15T10:00:00.000Z", done: 61 },
      // To decide: a second request after a rejected one (and a long name).
      {
        id: "p-max", name: "Maximilian Featherstonehaugh-Smythe", discordUsername: "max.fs", plan: MONTHLY,
        paid: "2026-10-09T10:00:00.000Z", done: 61, doneAt: "2026-10-17T09:00:00.000Z",
      },
      // Approved.
      { id: "p-ethan", name: "Ethan Cole", discordUserId: "100000000000000107", discordUsername: "ethan.cole", plan: MONTHLY, paid: "2026-10-02T09:00:00.000Z", done: 61 },
      { id: "p-nora", name: "Nora Brandt", discordUsername: "nora.b", plan: YEARLY, paid: "2026-10-10T12:00:00.000Z", done: 61 },
      // Code added in Whop.
      { id: "p-omar", name: "Omar Haddad", discordUserId: "100000000000000109", plan: MONTHLY, paid: "2026-10-01T12:00:00.000Z", done: 61 },
      { id: "p-lena", name: "Lena Vogel", discordUsername: "lena.v", plan: MONTHLY, status: "past_due", paid: "2026-10-04T08:00:00.000Z", done: 61 },
      // Rejected.
      { id: "p-ruby", name: "Ruby Okafor", discordUsername: "ruby.ok", plan: MONTHLY, paid: "2026-10-11T09:00:00.000Z", done: 30 },
      { id: "p-felix", name: "Felix Moreau", plan: MONTHLY, paid: "2026-10-06T09:00:00.000Z", done: 20 },
      // Can still earn: every video done; locked with videos left; no Whop backfill; payment failed; yearly.
      { id: "p-iris", name: "Iris Kowalski", discordUserId: "100000000000000113", plan: MONTHLY, paid: "2026-10-14T09:00:00.000Z", done: 61, doneAt: "2026-10-19T21:00:00.000Z" },
      { id: "p-theo", name: "Theo Marsh", discordUsername: "theo.marsh", plan: MONTHLY, paid: "2026-10-02T14:00:00.000Z", done: 50 },
      { id: "p-dana", name: "Dana Whitfield", plan: MONTHLY, paid: "2026-10-07T09:00:00.000Z", done: 12, synced: null },
      { id: "p-sam", name: "Sam Taylor", discordUsername: "samtaylor", plan: MONTHLY, status: "past_due", paid: "2026-10-15T09:00:00.000Z", done: 5 },
      { id: "p-zoe", name: "Zoe Achterberg", discordUserId: "100000000000000117", plan: YEARLY, paid: "2026-10-11T08:00:00.000Z", done: 30 },
      // Can still earn, with no video watched yet and the queue's nolessons.day7 task open.
      { id: "p-ava", name: "Ava Lindgren", discordUsername: "ava.lind", plan: MONTHLY, paid: "2026-10-13T10:00:00.000Z", done: 0 },
      // Never listed: exempt from messages, and a canceled member.
      { id: "p-kai", name: "Kai Lund", plan: MONTHLY, exempt: true, paid: "2026-10-03T09:00:00.000Z", done: 10 },
      { id: "p-mia", name: "Mia Novak", plan: MONTHLY, status: "canceled", paid: "2026-10-12T09:00:00.000Z", done: 10 },
    ],
    asks: [
      { id: "r-maya", studentId: "p-maya", status: "pending", createdAt: "2026-10-19T18:00:00.000Z", answers: { q1: 9, q2: "A friend", q3: "More examples of hooks for beauty brands." } },
      { id: "r-jonah", studentId: "p-jonah", status: "pending", createdAt: "2026-10-20T06:00:00.000Z", answers: { q1: 7, q3: "Nothing, it was great." } },
      { id: "r-priya", studentId: "p-priya", status: "pending", createdAt: "2026-10-20T07:10:00.000Z" },
      { id: "r-sofia", studentId: "p-sofia", status: "pending", createdAt: "2026-10-16T12:00:00.000Z", answers: { q1: 8 } },
      { id: "r-leo", studentId: "p-leo", status: "pending", createdAt: "2026-10-14T09:00:00.000Z" },
      {
        id: "r-max-1", studentId: "p-max", status: "rejected", createdAt: "2026-10-17T10:00:00.000Z",
        reviewedAt: "2026-10-17T15:00:00.000Z", reviewedBy: "tm-robin", reason: "Two accounts on one card.",
      },
      { id: "r-max-2", studentId: "p-max", status: "pending", createdAt: "2026-10-20T06:30:00.000Z" },
      {
        id: "r-ethan", studentId: "p-ethan", status: "approved", createdAt: "2026-10-17T08:00:00.000Z",
        reviewedAt: "2026-10-18T09:00:00.000Z", reviewedBy: "tm-robin", promoCode: "ECOM30-3F9A21", answers: { q1: 10, q2: "YouTube" },
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
    ],
    contacts: [
      { studentId: "p-iris", scenarioId: "support.30ready", completedAt: "2026-10-19T19:00:00.000Z", completedBy: "tm-robin" },
      { studentId: "p-theo", scenarioId: "nolessons.day3", completedAt: "2026-10-16T09:00:00.000Z", completedBy: "tm-jamie", outcome: "replied" },
      { studentId: "p-sam", scenarioId: "stalled.discord.day3", completedAt: "2026-10-18T09:00:00.000Z", completedBy: "tm-robin", outcome: "no_reply" },
    ],
    queue: [
      {
        id: "q-ava", studentId: "p-ava", scenarioId: "nolessons.day7", summary: "Logged in, no lesson on the new course yet (Day 7)",
        createdAt: "2026-10-20T06:00:00.000Z", status: "open",
      },
    ],
  };
}

function emptyDb(): FixtureDb {
  return { people: [], asks: [], contacts: [], queue: [] };
}

/** The full fixture plus one student whose progress cannot be read, with a request waiting. */
function partialDb(): FixtureDb {
  const db = fullDb();
  db.people.push({ id: "p-nina", name: "Nina Petrova", discordUsername: "nina.p", plan: MONTHLY, paid: "2026-10-08T09:00:00.000Z", done: 61, readFails: true });
  db.asks.push({ id: "r-nina", studentId: "p-nina", status: "pending", createdAt: "2026-10-20T07:40:00.000Z" });
  return db;
}

const READ_FAILED = { message: "canceling statement due to statement timeout" };

/** The completion rows of the videos a person finished and the action items they started, as the table holds them. */
function completionsOf(p: Person): ThirtyCompletion[] {
  const rows = new Map<string, ThirtyCompletion>();
  for (const lesson_id of REQUIRED.slice(0, p.done ?? 0)) {
    rows.set(lesson_id, {
      student_id: p.id,
      lesson_id,
      completed_at: p.doneAt ?? FROM_WHOP,
      action_completed_at: null,
      skipped_at: null,
      discord_message_link: null,
    });
  }
  for (const [lesson_id, h] of Object.entries(p.handIns ?? {})) {
    const row: ThirtyCompletion = rows.get(lesson_id) ?? {
      student_id: p.id,
      lesson_id,
      completed_at: null,
      action_completed_at: null,
      skipped_at: null,
      discord_message_link: null,
    };
    row.action_completed_at = h.handedIn ? FROM_WHOP : null;
    row.discord_message_link = h.link ?? null;
    rows.set(lesson_id, row);
  }
  return [...rows.values()];
}

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * The made-up database in the shape loadThirtyData hands buildThirtyView:
 * each person's five reads included. A failed read is that read's
 * `{ data: null, error }`, as the loader hands it on: `videosFail` for the
 * catalog's videos (everyone's), `readFails` for one person's completions.
 */
function toData(db: FixtureDb, videosFail = false): ThirtyData {
  const videoRead = videosFail ? { data: null, error: READ_FAILED } : { data: VIDEOS, error: null };
  const requests: ThirtyRequest[] = db.asks.map((a) => ({
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
  const students: ThirtyStudent[] = db.people
    .map((p) => ({
      id: p.id,
      name: p.name,
      email: `${p.id}@example.com`,
      discord_user_id: p.discordUserId ?? null,
      discord_username: p.discordUsername ?? null,
      whop_plan_id: p.plan,
      membership_status: p.status ?? "active",
      csm_exempt: p.exempt ?? false,
      first_paid_at: p.paid,
    }))
    .sort(byId);

  const reads = new Map<string, DiscountReads>();
  const completions = new Map<string, ThirtyCompletion[] | null>();
  const lastSyncAt = new Map<string, string | null>();
  for (const p of db.people) {
    // Without the videos the loader reads no completion for anyone.
    const rows = p.readFails || videosFail ? null : completionsOf(p);
    completions.set(p.id, rows);
    if (p.synced !== null) lastSyncAt.set(p.id, p.synced ?? FROM_WHOP);
    reads.set(p.id, {
      student: { data: { first_paid_at: p.paid }, error: null },
      lessons: { data: LESSON_READ, error: null },
      videos: videoRead,
      completions: rows
        ? { data: rows.map((c) => ({ lesson_id: c.lesson_id, completed_at: c.completed_at })), error: null }
        : { data: null, error: READ_FAILED },
      requests: {
        data: requests
          .filter((r) => r.student_id === p.id)
          .map((r) => ({
            id: r.id,
            status: r.status,
            created_at: r.created_at,
            promo_code: r.promo_code ?? null,
            rejection_reason: r.rejection_reason ?? null,
          })),
        error: null,
      },
    });
  }

  const answers = new Map<string, ThirtyAnswer[]>();
  for (const a of db.asks) {
    const list: ThirtyAnswer[] = Object.entries(a.answers ?? {}).map(([question_id, value]) => ({
      id: `${a.id}-${question_id}`,
      discount_request_id: a.id,
      question_id,
      answer_scale: typeof value === "number" ? value : null,
      answer_choice: typeof value === "string" && question_id === "q2" ? value : null,
      answer_text: typeof value === "string" && question_id !== "q2" ? value : null,
    }));
    if (list.length) answers.set(a.id, list);
  }

  const contacts = new Map<string, ThirtyContact[]>();
  for (const c of db.contacts) {
    const row: ThirtyContact = {
      student_id: c.studentId,
      scenario_id: c.scenarioId,
      completed_at: c.completedAt,
      completed_by: c.completedBy,
      outcome: c.outcome ?? null,
    };
    contacts.set(c.studentId, [...(contacts.get(c.studentId) ?? []), row]);
  }

  return {
    catalog: { data: LESSONS, error: null },
    videos: videoRead,
    students,
    reads,
    completions,
    // The page lists every pending request and the rest from 1 October on, as loadThirtyData reads them.
    requests: requests.filter((r) => r.status === "pending" || r.created_at >= DISCOUNT_ELIGIBLE_FROM).sort(byId),
    questions: QUESTIONS,
    answers,
    team: TEAM,
    lastSyncAt,
    contacts,
    openTasks: new Map(
      db.people.map((p) => [
        p.id,
        db.queue
          .filter((t) => t.studentId === p.id && t.status === "open")
          .map((t) => ({
            id: t.id,
            student_id: t.studentId,
            scenario_id: t.scenarioId,
            template_id: `tpl-${t.scenarioId}`,
            behavior_summary: t.summary,
            created_at: t.createdAt,
          })),
      ]),
    ),
  };
}

// ── The stand-in for the server ─────────────────────────────────────────────
export type FixtureState = "full" | "empty" | "loading" | "error" | "partial" | "novideos";

const STATES: FixtureState[] = ["full", "empty", "loading", "error", "partial", "novideos"];

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
  const view = (): ThirtyView => buildThirtyView(toData(db, opts.state === "novideos"), new Date(FIXTURE_NOW), RESET_AT);
  const ask = (id: string) => db.asks.find((a) => a.id === id);
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
