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
 * TODAY (/dev/admin/today). The same idea: a small database of made-up
 * members, their course facts and their tasks in the queue, and every load
 * runs the real buildSupportRows over it (src/lib/admin/support-list.ts),
 * the builder behind GET /api/admin/today, with the 30% from the same
 * made-up course. Mark messaged, Not needed, Undo and Replied / No reply
 * change that database the way the routes do.
 *
 *   ?state=full | empty | loading | error   (default full)
 *
 * Today's clock starts at TODAY_FIXTURE_NOW, Wed 28 Oct: more than 7 days
 * after the course switch, so every reason shows, Stalled included. Each
 * change moves it a minute on, so a mark is undoable right after it.
 */

import { buildThirtyView } from "@/lib/admin/thirty-view";
import type { ThirtyView } from "@/lib/admin/thirty-view";
import { SUPPORT_SCENARIO, buildSupportRows } from "@/lib/admin/support-list";
import type { SupportInput, SupportStudent, SupportTask, SupportTemplate, TodayView } from "@/lib/admin/support-list";
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
import type {
  Answer,
  MarkAnswer,
  MarkBody,
  ReasonKind,
  ThirtyTransport,
  TodayTransport,
  UndoResult,
} from "@/lib/admin/admin-transport";
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
  adsVerified?: boolean;
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
  /** Set on a contact a mark wrote: its support record's id, for Undo. */
  id?: string;
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
      // To decide: the rule says yes and the ads are verified.
      {
        id: "p-maya", name: "Maya Lindqvist", discordUserId: "100000000000000101", discordUsername: "maya.lq",
        plan: MONTHLY, adsVerified: true, paid: "2026-10-01T09:00:00.000Z", done: 61,
        handIns: {
          v20: { handedIn: true, link: "https://discord.com/channels/100000000000000001/100000000000000002/100000000000000003" },
          v40: { handedIn: false },
        },
      },
      // To decide: the rule says yes, the ads are not verified.
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
        id: "p-max", name: "Maximilian Featherstonehaugh-Smythe", discordUsername: "max.fs", plan: MONTHLY, adsVerified: true,
        paid: "2026-10-09T10:00:00.000Z", done: 61, doneAt: "2026-10-17T09:00:00.000Z",
      },
      // Approved.
      { id: "p-ethan", name: "Ethan Cole", discordUserId: "100000000000000107", discordUsername: "ethan.cole", plan: MONTHLY, adsVerified: true, paid: "2026-10-02T09:00:00.000Z", done: 61 },
      { id: "p-nora", name: "Nora Brandt", discordUsername: "nora.b", plan: YEARLY, adsVerified: true, paid: "2026-10-10T12:00:00.000Z", done: 61 },
      // Code added in Whop.
      { id: "p-omar", name: "Omar Haddad", discordUserId: "100000000000000109", plan: MONTHLY, adsVerified: true, paid: "2026-10-01T12:00:00.000Z", done: 61 },
      { id: "p-lena", name: "Lena Vogel", discordUsername: "lena.v", plan: MONTHLY, status: "past_due", adsVerified: true, paid: "2026-10-04T08:00:00.000Z", done: 61 },
      // Rejected.
      { id: "p-ruby", name: "Ruby Okafor", discordUsername: "ruby.ok", plan: MONTHLY, paid: "2026-10-11T09:00:00.000Z", done: 30 },
      { id: "p-felix", name: "Felix Moreau", plan: MONTHLY, paid: "2026-10-06T09:00:00.000Z", done: 20 },
      // Can still earn: every video done; locked with videos left; no Whop backfill; payment failed; yearly.
      { id: "p-iris", name: "Iris Kowalski", discordUserId: "100000000000000113", plan: MONTHLY, paid: "2026-10-14T09:00:00.000Z", done: 61, doneAt: "2026-10-19T21:00:00.000Z" },
      { id: "p-theo", name: "Theo Marsh", discordUsername: "theo.marsh", plan: MONTHLY, paid: "2026-10-02T14:00:00.000Z", done: 50 },
      { id: "p-dana", name: "Dana Whitfield", plan: MONTHLY, paid: "2026-10-07T09:00:00.000Z", done: 12, synced: null },
      { id: "p-sam", name: "Sam Taylor", discordUsername: "samtaylor", plan: MONTHLY, status: "past_due", paid: "2026-10-15T09:00:00.000Z", done: 5 },
      { id: "p-zoe", name: "Zoe Achterberg", discordUserId: "100000000000000117", plan: YEARLY, paid: "2026-10-11T08:00:00.000Z", done: 30 },
      // Can still earn, with no video watched yet and the queue's nolessons.day7 task open: Mark messaged closes it.
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
      ad_submissions_verified: p.adsVerified ?? false,
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
  name: "loadThirty" | "approve" | "reject" | "markApplied" | "verifyAds" | "mark" | "loadToday" | "undo" | "setOutcome";
  args: unknown[];
}

/** The scenario of the record a mark makes for each computed headline (C5, support-list.ts). An open task's mark makes none. */
const SCENARIO_OF: Partial<Record<ReasonKind, string>> = SUPPORT_SCENARIO;

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
          return later<{ promoCode: string | null }>({
            ok: false,
            status: 400,
            error:
              verdict?.reason === "ads"
                ? "Ad submissions not verified yet. Tick the verification flag on the student's detail page first."
                : "Cannot approve: the rule says no.",
          });
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

    verifyAds(studentId, verified) {
      calls.push({ name: "verifyAds", args: [studentId, verified] });
      const p = db.people.find((x) => x.id === studentId);
      if (!p) return later<{ verified: boolean }>({ ok: false, status: 404, error: "Student not found" });
      p.adsVerified = verified;
      return later({ ok: true, status: 200, data: { verified } });
    },

    mark(body: MarkBody) {
      calls.push({ name: "mark", args: [body] });
      // As the route: every task named must be an open queue task of this student, or nothing is written.
      const open = db.queue.filter((t) => body.openTaskIds.includes(t.id) && t.studentId === body.studentId && t.status === "open");
      if (open.length !== body.openTaskIds.length) {
        return later<MarkAnswer>({
          ok: false,
          status: 400,
          error: "A task on this row is not an open task of this student in the Tasks queue, so nothing was saved. Reload the list.",
        });
      }
      const when = at();
      const scenarioId = SCENARIO_OF[body.headlineKind];
      const supportId = scenarioId ? `support-${minute}` : null;
      // A message marked as sent is a completed task: the row's last contact (C12).
      if (body.action === "messaged" && scenarioId) {
        db.contacts.push({ id: supportId ?? undefined, studentId: body.studentId, scenarioId, completedAt: when, completedBy: ME });
      }
      // The student's open queue tasks close with it, same member, same moment (C5).
      for (const t of open) Object.assign(t, { status: "completed", completedAt: when, completedBy: ME });
      return later<MarkAnswer>({
        ok: true,
        status: 201,
        data: { supportId, movedIds: open.map((t) => t.id), at: when },
      });
    },

    undo(ids: string[]) {
      calls.push({ name: "undo", args: [ids] });
      const results: UndoResult[] = ids.map((id) => {
        const contact = db.contacts.findIndex((c) => c.id === id);
        if (contact >= 0) {
          db.contacts.splice(contact, 1);
          return { id, ok: true, status: 200 };
        }
        const t = db.queue.find((x) => x.id === id && x.status === "completed" && x.completedBy === ME);
        if (!t) return { id, ok: false, status: 404, error: "Not found. It may have been undone already." };
        Object.assign(t, { status: "open", completedAt: null, completedBy: null });
        return { id, ok: true, status: 200 };
      });
      return later({ ok: true, status: 200, data: { results } });
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// TODAY (/dev/admin/today)
// ════════════════════════════════════════════════════════════════════════════

/** Wed 28 Oct 2026, 09:30 in Croatia: where Today's dev clock starts (the header says why). */
export const TODAY_FIXTURE_NOW = "2026-10-28T08:30:00.000Z";

const minutesBefore = (n: number) => new Date(Date.parse(TODAY_FIXTURE_NOW) - n * 60_000).toISOString();

/** The course's areas, made-up names. */
const AREAS = new Map([
  ["a1", "First steps"],
  ["a2", "Ad basics"],
  ["a3", "Hooks"],
  ["a4", "Editing"],
]);

interface TodayPerson {
  id: string;
  name: string;
  email?: string;
  discordUserId?: string;
  discordUsername?: string;
  plan: string | null;
  status?: string;
  /** When they clicked cancel in Whop. */
  cancelAt?: string;
  /** Left out: a Whop membership. false: none. */
  membership?: boolean;
  exempt?: boolean;
  highChurn?: boolean;
  paid: string;
  /** Their first app login; null: never. */
  openedApp: string | null;
  /** Counted lessons done, and the last one. */
  lessons?: number;
  lastLesson?: string;
  area?: string;
  /** The newest app heartbeat. */
  heartbeat?: string;
  /** The last Whop backfill. Left out: one after the switch. null: none ever. */
  synced?: string | null;
  /** The first `done` of the 30%'s 61 videos, finished at `doneAt`. */
  done?: number;
  doneAt?: string;
}

interface TodayDb {
  people: TodayPerson[];
  tasks: SupportTask[];
}

function task(t: Partial<SupportTask> & Pick<SupportTask, "id" | "student_id" | "scenario_id" | "status" | "created_at">): SupportTask {
  return {
    template_id: null,
    behavior_summary: null,
    completed_at: null,
    completed_by: null,
    dismissed_at: null,
    dismissed_by: null,
    notes: null,
    outcome: null,
    ...t,
  };
}

function todayFullDb(): TodayDb {
  return {
    people: [
      // Cancelling, and the payment failed too: the cancel is the headline, the payment a chip.
      {
        id: "t-mara", name: "Mara Quinn", discordUserId: "100000000000000201", discordUsername: "mara.q", plan: MONTHLY,
        status: "past_due", cancelAt: "2026-10-26T07:00:00.000Z", paid: "2026-09-12T09:00:00.000Z",
        openedApp: "2026-09-12T10:00:00.000Z", lessons: 14, lastLesson: "2026-10-27T18:00:00.000Z", area: "a2",
      },
      // Payment failed, on the yearly plan.
      {
        id: "t-owen", name: "Owen Pratt", discordUsername: "owenp", plan: YEARLY, status: "past_due",
        paid: "2026-08-03T09:00:00.000Z", openedApp: "2026-08-03T11:00:00.000Z", lessons: 30,
        lastLesson: "2026-10-27T09:00:00.000Z", area: "a3",
      },
      // The 30% closes tomorrow with 9 videos left, and no lesson for 3 days: two reasons.
      {
        id: "t-lina", name: "Lina Sorensen", discordUserId: "100000000000000203", plan: MONTHLY,
        paid: "2026-10-15T09:00:00.000Z", openedApp: "2026-10-15T09:30:00.000Z", lessons: 52,
        lastLesson: "2026-10-24T20:00:00.000Z", area: "a4", done: 52, doneAt: "2026-10-24T20:00:00.000Z",
      },
      // Every video done: can apply for the 30% now.
      {
        id: "t-ravi", name: "Ravi Menon", discordUsername: "ravi.m", plan: MONTHLY, paid: "2026-10-20T09:00:00.000Z",
        openedApp: "2026-10-20T09:10:00.000Z", lessons: 61, lastLesson: "2026-10-26T19:00:00.000Z", area: "a4",
        done: 61, doneAt: "2026-10-26T19:00:00.000Z",
      },
      // Stalled: no lesson since the evening of the switch.
      {
        id: "t-hugo", name: "Hugo Brandt", discordUsername: "hugo_b", plan: MONTHLY, paid: "2026-09-20T09:00:00.000Z",
        openedApp: "2026-09-20T10:00:00.000Z", lessons: 6, lastLesson: "2026-10-19T18:00:00.000Z", area: "a1",
      },
      // Slipping: no lesson for 5 days.
      {
        id: "t-nadia", name: "Nadia Kerr", discordUserId: "100000000000000206", plan: YEARLY, paid: "2026-07-14T09:00:00.000Z",
        openedApp: "2026-07-14T10:00:00.000Z", lessons: 22, lastLesson: "2026-10-23T07:00:00.000Z", area: "a2",
      },
      // Opened the app, no lesson on the new course; the queue's nolessons.day7 task is open, so the row copies its message.
      { id: "t-tom", name: "Tom Ashby", discordUsername: "tom.ashby", plan: MONTHLY, paid: "2026-10-01T09:00:00.000Z", openedApp: "2026-10-02T08:00:00.000Z" },
      // Never opened the app, no Whop backfill either; the queue's stalled.discord.day5 task is open.
      { id: "t-grace", name: "Grace Liu", discordUsername: "grace.liu", plan: MONTHLY, paid: "2026-10-22T09:00:00.000Z", openedApp: null, synced: null },
      // Only a task in the queue (the welcome), nothing the app computes: its template names {bookingLink}, which no longer exists.
      {
        id: "t-felix", name: "Felix Ward", discordUserId: "100000000000000209", plan: MONTHLY, paid: "2026-10-27T15:00:00.000Z",
        openedApp: "2026-10-27T15:05:00.000Z", lessons: 3, lastLesson: "2026-10-28T07:00:00.000Z", area: "a1", done: 3,
        doneAt: "2026-10-28T07:00:00.000Z",
      },
      // C14: no Whop backfill since the switch. Not started (a backfill the day before) and Stopped (none ever): the folded group.
      { id: "t-ivy", name: "Ivy Chen", discordUsername: "ivy.chen", plan: MONTHLY, paid: "2026-09-25T09:00:00.000Z", openedApp: "2026-09-25T10:00:00.000Z", synced: "2026-10-18T10:00:00.000Z" },
      {
        id: "t-sam", name: "Sam Ortiz", plan: YEARLY, paid: "2026-08-20T09:00:00.000Z", openedApp: "2026-08-20T10:00:00.000Z",
        lessons: 2, lastLesson: "2026-10-20T12:00:00.000Z", area: "a1", synced: null,
      },
      // Another plan: shown under All plans only.
      {
        id: "t-leo", name: "Leo Park", discordUsername: "leopark", plan: OTHER, paid: "2026-10-10T09:00:00.000Z",
        openedApp: "2026-10-10T09:30:00.000Z", lessons: 4, lastLesson: "2026-10-21T10:00:00.000Z", area: "a1", done: 4,
      },
      // A long name, email and Discord name, for a phone's width.
      {
        id: "t-max", name: "Maximiliana Featherstonehaugh-Wolstenholme",
        email: "maximiliana.featherstonehaugh.wolstenholme@example.com", discordUsername: "maximiliana.featherstonehaugh",
        plan: MONTHLY, paid: "2026-10-25T09:00:00.000Z", openedApp: null,
      },
      // Never on the list: exempt; canceled; high churn risk and never opened; a heartbeat yesterday; no Whop membership.
      { id: "t-kai", name: "Kai Moss", plan: MONTHLY, exempt: true, paid: "2026-10-02T09:00:00.000Z", openedApp: null },
      { id: "t-nina", name: "Nina Vale", plan: MONTHLY, status: "canceled", paid: "2026-09-02T09:00:00.000Z", openedApp: null },
      { id: "t-zed", name: "Zed Rowe", plan: MONTHLY, highChurn: true, paid: "2026-10-05T09:00:00.000Z", openedApp: null },
      {
        id: "t-ada", name: "Ada Finch", plan: MONTHLY, paid: "2026-09-10T09:00:00.000Z", openedApp: "2026-09-10T10:00:00.000Z",
        lessons: 9, lastLesson: "2026-10-22T09:00:00.000Z", heartbeat: "2026-10-27T20:00:00.000Z", area: "a2",
      },
      { id: "t-pat", name: "Pat Doyle", plan: MONTHLY, membership: false, paid: "2026-10-01T09:00:00.000Z", openedApp: null },
      // Handled, so hidden for now: Stopped and messaged on Mon 26 Oct (7 days); Not started and marked by
      // Robin 5 minutes ago (Undo brings her back); Cancelling and marked not needed an hour ago (3 days).
      {
        id: "t-bea", name: "Bea Holt", discordUserId: "100000000000000215", plan: MONTHLY, paid: "2026-09-05T09:00:00.000Z",
        openedApp: "2026-09-05T10:00:00.000Z", lessons: 11, lastLesson: "2026-10-21T09:00:00.000Z", area: "a2",
      },
      { id: "t-cora", name: "Cora Diaz", discordUsername: "cora.d", plan: MONTHLY, paid: "2026-09-28T09:00:00.000Z", openedApp: "2026-09-28T10:00:00.000Z" },
      {
        id: "t-eli", name: "Eli Moreno", plan: YEARLY, cancelAt: "2026-10-27T10:00:00.000Z", paid: "2026-06-01T09:00:00.000Z",
        openedApp: "2026-06-01T10:00:00.000Z", lessons: 40, lastLesson: "2026-10-27T12:00:00.000Z", area: "a3",
      },
    ],
    tasks: [
      // Open in the Tasks queue.
      task({
        id: "q-tom", student_id: "t-tom", scenario_id: "nolessons.day7", template_id: "tpl-nolessons7", status: "open",
        behavior_summary: "Logged in, no lesson on the new course yet (Day 7)", created_at: "2026-10-26T10:15:00.000Z",
      }),
      task({
        id: "q-grace", student_id: "t-grace", scenario_id: "stalled.discord.day5", template_id: "tpl-stalled5", status: "open",
        behavior_summary: "Paid 5 days ago, never logged in", created_at: "2026-10-27T10:20:00.000Z",
      }),
      task({
        id: "q-felix", student_id: "t-felix", scenario_id: "welcome.day1", template_id: "tpl-welcome", status: "open",
        behavior_summary: "Joined yesterday: send the welcome message", created_at: "2026-10-27T16:00:00.000Z",
      }),
      // Handled in the last 7 days.
      task({
        id: "h-bea", student_id: "t-bea", scenario_id: "support.stopped", status: "completed",
        behavior_summary: "No lesson for 5 days", created_at: "2026-10-26T09:00:00.000Z",
        completed_at: "2026-10-26T09:00:00.000Z", completed_by: "tm-jamie", outcome: "replied",
      }),
      task({
        id: "h-cora", student_id: "t-cora", scenario_id: "support.nostart", status: "completed",
        behavior_summary: "No lesson on the new course yet (course day 9)", created_at: minutesBefore(5),
        completed_at: minutesBefore(5), completed_by: ME,
      }),
      task({
        id: "h-cora-q", student_id: "t-cora", scenario_id: "nolessons.day7", template_id: "tpl-nolessons7", status: "completed",
        behavior_summary: "Logged in, no lesson on the new course yet (Day 7)", created_at: "2026-10-26T10:15:00.000Z",
        completed_at: minutesBefore(5), completed_by: ME,
      }),
      task({
        id: "h-eli", student_id: "t-eli", scenario_id: "support.cancel", status: "dismissed",
        behavior_summary: "Clicked cancel less than 1 day ago", created_at: minutesBefore(60),
        dismissed_at: minutesBefore(60), dismissed_by: ME, notes: "Spoke on a call, he is moving to the yearly plan.",
      }),
      task({
        id: "h-mara", student_id: "t-mara", scenario_id: "support.pastdue", status: "completed",
        behavior_summary: "Payment failed", created_at: "2026-10-24T08:00:00.000Z",
        completed_at: "2026-10-24T08:00:00.000Z", completed_by: "tm-jamie", outcome: "no_reply",
      }),
      task({
        id: "h-nina", student_id: "t-nina", scenario_id: "stalled.whop.day7", template_id: "tpl-stalled5", status: "completed",
        behavior_summary: "Paid 7 days ago, never logged in", created_at: "2026-10-20T10:00:00.000Z",
        completed_at: "2026-10-23T11:00:00.000Z", completed_by: "tm-jamie",
      }),
      // Closed by the app: a stage the next one replaced.
      task({
        id: "h-app-1", student_id: "t-tom", scenario_id: "nolessons.day3", template_id: "tpl-nolessons3", status: "dismissed",
        behavior_summary: "Logged in, no lesson on the new course yet (Day 3)", created_at: "2026-10-22T10:15:00.000Z",
        dismissed_at: "2026-10-26T10:15:00.000Z", notes: "Replaced by a later stage",
      }),
      task({
        id: "h-app-2", student_id: "t-ivy", scenario_id: "nolessons.day3", template_id: "tpl-nolessons3", status: "dismissed",
        behavior_summary: "Logged in, no lesson on the new course yet (Day 3)", created_at: "2026-10-22T10:15:00.000Z",
        dismissed_at: "2026-10-26T10:15:00.000Z", notes: "Replaced by a later stage",
      }),
    ],
  };
}

const TODAY_TEMPLATES: SupportTemplate[] = [
  {
    id: "tpl-nolessons7", scenario_id: "nolessons.day7", title: "No lesson yet, day 7", is_active: true,
    body: "Hey {firstName}, I noticed you haven't started the new course yet. The first lesson is short, about 6 minutes. Here is where you start: {programLink}",
  },
  {
    id: "tpl-nolessons3", scenario_id: "nolessons.day3", title: "No lesson yet, day 3", is_active: true,
    body: "Hey {firstName}, how is it going so far? If anything is unclear about where to start, tell me.",
  },
  {
    id: "tpl-stalled5", scenario_id: "stalled.discord.day5", title: "Never logged in, day 5", is_active: true,
    body: "Hey {firstName}, you joined a few days ago but haven't opened the app yet. Here is where you start: {programLink}",
  },
  {
    id: "tpl-welcome", scenario_id: "welcome.day1", title: "Welcome", is_active: true,
    body: "Welcome, {firstName}! Book your first call here: {bookingLink}",
  },
  {
    id: "tpl-support-cancel", scenario_id: "support.cancel", title: "Clicked cancel", is_active: true,
    body: "Hey {firstName}, I saw you clicked cancel. Was something not working for you? If you tell me what, I can try to fix it.",
  },
  {
    id: "tpl-support-30ready", scenario_id: "support.30ready", title: "Can apply for the 30%", is_active: true,
    body: "Hey {firstName}, you finished every video up to the checkpoint, so you can apply for the 30% now. Open the map and press Apply before your deadline.",
  },
];

/** The made-up database as loadTodayData hands it to buildSupportRows, the 30% included. */
function todayInput(db: TodayDb): SupportInput {
  const thirty = toData({
    queue: [],
    people: db.people.map((p) => ({
      id: p.id,
      name: p.name,
      discordUserId: p.discordUserId,
      discordUsername: p.discordUsername,
      plan: p.plan,
      status: p.status,
      exempt: p.exempt,
      paid: p.paid,
      synced: p.synced,
      done: p.done ?? 0,
      doneAt: p.doneAt,
    })),
    asks: [],
    contacts: [],
  });
  const students: SupportStudent[] = db.people.map((p) => ({
    id: p.id,
    name: p.name,
    email: p.email ?? `${p.id}@example.com`,
    discord_user_id: p.discordUserId ?? null,
    discord_username: p.discordUsername ?? null,
    whop_plan_id: p.plan,
    whop_membership_id: p.membership === false ? null : `mem_${p.id}`,
    membership_status: p.status ?? "active",
    cancel_scheduled_at: p.cancelAt ?? null,
    first_paid_at: p.paid,
    joined_at: p.paid,
    csm_exempt: p.exempt ?? false,
    high_churn_risk: p.highChurn ?? false,
  }));
  const map = <T>(pick: (p: TodayPerson) => T | undefined) =>
    new Map(db.people.flatMap((p) => (pick(p) === undefined ? [] : [[p.id, pick(p) as T] as const])));
  return {
    resetAt: RESET_AT,
    callerId: ME,
    lessonsTotal: 140,
    students,
    progress: map((p) => p.lessons),
    lastLesson: map((p) => p.lastLesson),
    currentArea: map((p) => p.area),
    areas: AREAS,
    firstLogin: new Set(db.people.filter((p) => p.openedApp !== null).map((p) => p.id)),
    lastSyncAt: thirty.lastSyncAt,
    lastHeartbeat: map((p) => p.heartbeat),
    tasks: db.tasks,
    templates: TODAY_TEMPLATES,
    team: TEAM,
    names: new Map(db.people.map((p) => [p.id, p.name] as const)),
    config: { program_login_link: "https://example.com/start", discord_invite_link: "" },
    thirty,
  };
}

/**
 * Today's transport, answered from the made-up database. Each answer comes a
 * moment later, as a real one would, so the busy states show.
 */
export function fixtureTodayTransport(opts: { state: FixtureState }): TodayTransport & { calls: FixtureCall[] } {
  const db: TodayDb = opts.state === "empty" ? { people: [], tasks: [] } : todayFullDb();
  const calls: FixtureCall[] = [];
  let minute = 0;
  let seq = 0;
  /** The dev clock: TODAY_FIXTURE_NOW, a minute on for each change. */
  const clock = () => new Date(Date.parse(TODAY_FIXTURE_NOW) + 60_000 * minute);
  const later = <T>(answer: Answer<T>) => new Promise<Answer<T>>((resolve) => setTimeout(() => resolve(answer), 300));
  const view = (): TodayView => {
    const now = clock();
    const { rows, handled } = buildSupportRows(todayInput(db), now);
    return { generatedAt: now.toISOString(), resetAt: RESET_AT, lessonsTotal: 140, rows, handled };
  };

  return {
    calls,

    loadToday() {
      calls.push({ name: "loadToday", args: [] });
      if (opts.state === "loading") return new Promise<Answer<TodayView>>(() => {});
      if (opts.state === "error") {
        return later<TodayView>({
          ok: false,
          status: 500,
          error: "Couldn't read everything Today needs, so nothing is shown. Try again.",
        });
      }
      return later<TodayView>({ ok: true, status: 200, data: view() });
    },

    mark(body: MarkBody) {
      calls.push({ name: "mark", args: [body] });
      minute++;
      const at = clock().toISOString();
      const done = body.action === "messaged";
      const closing = done
        ? { completed_at: at, completed_by: ME, dismissed_at: null, dismissed_by: null }
        : { dismissed_at: at, dismissed_by: ME, completed_at: null, completed_by: null };
      const open = db.tasks.filter((t) => body.openTaskIds.includes(t.id) && t.student_id === body.studentId && t.status === "open");
      if (open.length !== body.openTaskIds.length) {
        return later<MarkAnswer>({
          ok: false,
          status: 400,
          error: "A task on this row is not an open task of this student in the Tasks queue, so nothing was saved. Reload the list.",
        });
      }
      let supportId: string | null = null;
      if (body.headlineKind !== "open_task") {
        supportId = `s-${++seq}`;
        db.tasks.push(
          task({
            id: supportId,
            student_id: body.studentId,
            scenario_id: SUPPORT_SCENARIO[body.headlineKind],
            status: done ? "completed" : "dismissed",
            behavior_summary: body.reasonsText,
            created_at: at,
            notes: body.note ?? null,
            ...closing,
          }),
        );
      }
      for (const t of open) Object.assign(t, { status: done ? "completed" : "dismissed", ...closing, ...(body.note ? { notes: body.note } : {}) });
      return later<MarkAnswer>({ ok: true, status: 201, data: { supportId, movedIds: open.map((t) => t.id), at } });
    },

    undo(ids: string[]) {
      calls.push({ name: "undo", args: [ids] });
      const nowMs = clock().getTime();
      minute++;
      const results: UndoResult[] = ids.map((id) => {
        const t = db.tasks.find((x) => x.id === id);
        const at = t ? (t.status === "completed" ? t.completed_at : t.status === "dismissed" ? t.dismissed_at : null) : null;
        const by = t ? (t.status === "completed" ? t.completed_by : t.dismissed_by) : null;
        if (!t || !at) return { id, ok: false, status: 404, error: "Not found. It may have been undone already." };
        if (by !== ME) return { id, ok: false, status: 403, error: "Only the team member who marked it can undo it." };
        if (nowMs - Date.parse(at) > 15 * 60_000) {
          return { id, ok: false, status: 409, error: "It was marked more than 15 minutes ago, so it can't be undone here." };
        }
        if (t.scenario_id.startsWith("support.") && t.template_id === null) {
          db.tasks = db.tasks.filter((x) => x.id !== id);
          return { id, ok: true, status: 200 };
        }
        if (db.tasks.some((x) => x.status === "open" && x.student_id === t.student_id && x.scenario_id === t.scenario_id)) {
          return { id, ok: false, status: 409, error: "The Tasks queue has a newer open task of this kind for the student, so this one stays closed." };
        }
        Object.assign(t, { status: "open", completed_at: null, completed_by: null, dismissed_at: null, dismissed_by: null, notes: null });
        return { id, ok: true, status: 200 };
      });
      return later({ ok: true, status: 200, data: { results } });
    },

    setOutcome(taskId: string, outcome: "replied" | "no_reply" | null) {
      calls.push({ name: "setOutcome", args: [taskId, outcome] });
      const t = db.tasks.find((x) => x.id === taskId && x.status === "completed");
      if (!t) return later<null>({ ok: false, status: 404, error: "Task not found or not in Sent" });
      t.outcome = outcome;
      return later<null>({ ok: true, status: 200, data: null });
    },
  };
}
