/**
 * Made-up data for the dev pages of admin rebuild 2's lane WI-5 and WI-6:
 * /dev/admin/tasks, /dev/admin/tasks/insights, /dev/admin/students,
 * /dev/admin/students/[id] and /dev/admin/journey. Development only: the
 * layout of /dev/admin calls notFound() anywhere else.
 *
 * MADE-UP PEOPLE ONLY. This repository is public: every student, team
 * member, username, link and code below is invented.
 *
 * The student pages run the REAL builders (buildStudentsList,
 * buildStudentDetail, buildJourney) over made-up reads, so what the dev pages
 * show is the pages' own rules, not text typed here. The Tasks page's
 * stand-in answers in GET /api/admin/tasks's shape, with the reset's line
 * drawn as the route draws it, and its buttons change that data the way the
 * routes do, so a click and the read after it show what the team would see.
 * The insights are the route's answer, typed here: they are computed on the
 * server from tables these pages never read.
 *
 *   ?state=full | empty | loading | error | partial   (default full)
 *   ?reset=none     the tasks reset has not run (Tasks and its insights)
 *   ?reload=fail    the first read works, every later one fails
 *   ?at=later       the journey read on 12 November, when weeks 3 and 4 and
 *                   Month 2+ fill up
 *
 * Every page reads at NOW, so every date, day and "ago" is the same on every
 * run.
 */

import type { Answer } from "@/lib/admin/admin-transport";
import type { InsightsTransport, PeopleTransport, TasksTransport } from "@/lib/admin/people-transport";
import type { CourseActivity } from "@/lib/useJourneyPaceCounts";
import type { OutreachInsights } from "@/lib/outreach-insights";
import { buildStudentsList, type ListStudent, type StudentsListReads } from "@/lib/admin/students-list";
import { buildStudentDetail, type DetailLesson, type DetailStudent, type StudentDetailReads } from "@/lib/admin/student-detail";
import { buildJourney, type JourneyReads, type JourneyStudent } from "@/lib/admin/journey-board";
import { isAfterTasksReset } from "@/lib/admin/tasks-reset";
import type { TaskRow, TasksAnswer, TaskStudent, TaskTemplate } from "@/lib/admin/tasks-view";
import type { Read } from "@/lib/admin/people-common";

/** The calls a dev page made, for world-tests to read (window.__peopleCalls). */
export type PeopleCall = { name: string; args: unknown[] };

declare global {
  interface Window {
    __peopleCalls?: PeopleCall[];
  }
}

/** Wed 21 Oct 2026, 10:30 in Croatia: the moment every dev page is read at. */
export const PEOPLE_NOW = "2026-10-21T08:30:00.000Z";
/** Thu 12 Nov 2026, 11:00 in Croatia: the journey's ?at=later. */
const LATER = "2026-11-12T10:00:00.000Z";
/** The course switch (v104), as admin_config holds it. */
const SWITCH_AT = "2026-10-19T14:33:33.972Z";
/** The tasks reset (v109): Tue 20 Oct, 09:00 in Croatia. */
const TASKS_RESET_AT = "2026-10-20T07:00:00.000Z";

export type PeopleState = "full" | "empty" | "loading" | "error" | "partial";
const STATES: PeopleState[] = ["full", "empty", "loading", "error", "partial"];
export function parsePeopleState(value: string | null): PeopleState {
  return STATES.find((s) => s === value) ?? "full";
}

const READ_FAILED = "canceling statement due to statement timeout";
const later = <T>(answer: Answer<T>, ms = 250) => new Promise<Answer<T>>((resolve) => setTimeout(() => resolve(answer), ms));
const never = <T>() => new Promise<Answer<T>>(() => {});
const okAnswer = <T>(data: T): Answer<T> => ({ ok: true, status: 200, data });
const errAnswer = <T>(error: string): Answer<T> => ({ ok: false, status: 500, error });

// ── The course: 8 areas of 3 lessons, one of them an action item, and one
// lesson outside progress. Titles are made up.
const AREAS = [
  ["a1", "Foundations"],
  ["a2", "Research"],
  ["a3", "Hooks"],
  ["a4", "Scripts"],
  ["a5", "Editing"],
  ["a6", "Statics"],
  ["a7", "Clients"],
  ["a8", "Scale"],
] as const;
const REGIONS = AREAS.map(([id, name], i) => ({ id, name, order_num: i + 1 }));
const LESSONS: DetailLesson[] = [
  ...AREAS.flatMap(([area, name]) =>
    [1, 2, 3].map(
      (n): DetailLesson => ({
        id: `${area}l0${n}`,
        region_id: area,
        title: n === 3 ? `${name}: hand in your work` : `${name}, part ${n}`,
        type: n === 3 ? "action" : "watch",
        requires_action: n === 3,
        counts_toward_progress: true,
      }),
    ),
  ),
  { id: "a8l99", region_id: "a8", title: "Bonus call recording", type: "watch", requires_action: false, counts_toward_progress: false },
];
const COUNTING = LESSONS.filter((l) => l.counts_toward_progress !== false).length;

// ── The made-up students ────────────────────────────────────────────────────
interface Person {
  id: string;
  name: string | null;
  email: string;
  username?: string;
  status: "active" | "past_due" | "canceled" | "expired";
  paid: string;
  lastActive?: string | null;
  canceling?: string;
  /** Lessons done, in the course's order (the first N counting lessons). */
  done: number;
  /** The last counted lesson, after the switch. */
  lastLesson?: string;
  exempt?: boolean;
  adVerified?: boolean;
  /** The latest 30% request. */
  request?: { status: string; code?: string; at: string };
  streak?: { current: number; last: string };
  /** The last Whop sync: before the switch (stale), after it, or none. */
  sync?: { at: string; fetched: number; matched: number; unmatched?: string[]; error?: string } | null;
  noWhopMembership?: boolean;
}

const PEOPLE: Person[] = [
  {
    id: "p-maya", name: "Maya Lindqvist", email: "maya@example.com", username: "maya.lq", status: "active",
    paid: "2026-10-19T09:00:00.000Z", lastActive: "2026-10-21T07:50:00.000Z", done: 9, lastLesson: "2026-10-21T07:40:00.000Z",
    request: { status: "pending", at: "2026-10-20T18:00:00.000Z" }, streak: { current: 3, last: "2026-10-21" },
    sync: { at: "2026-10-21T06:00:00.000Z", fetched: 12, matched: 12 }, adVerified: true,
  },
  {
    id: "p-jonah", name: "Jonah Pereira", email: "jonah@example.com", username: "jonah_p", status: "active",
    paid: "2026-10-14T15:00:00.000Z", lastActive: "2026-10-17T10:00:00.000Z", done: 5, lastLesson: "2026-10-17T09:00:00.000Z",
    request: { status: "approved", code: "ECOM30-7B20C4", at: "2026-10-19T19:00:00.000Z" }, streak: { current: 0, last: "2026-10-17" },
    sync: { at: "2026-10-18T10:00:00.000Z", fetched: 6, matched: 5, unmatched: ["les_madeup0001"] },
  },
  {
    id: "p-priya", name: "Priya Raman", email: "priya@example.com", status: "past_due",
    paid: "2026-10-10T08:00:00.000Z", lastActive: "2026-10-11T09:00:00.000Z", done: 1, lastLesson: "2026-10-11T08:00:00.000Z",
    sync: null,
  },
  {
    id: "p-sofia", name: "Sofia Marin", email: "sofia@example.com", username: "sofia.marin", status: "active",
    paid: "2026-10-12T10:00:00.000Z", lastActive: "2026-10-20T12:00:00.000Z", done: 0,
    canceling: "2026-10-19T08:00:00.000Z", sync: { at: "2026-10-20T06:00:00.000Z", fetched: 3, matched: 0, error: "Whop returned 3 interactions but 0 marked completed" },
  },
  {
    id: "p-ethan", name: "Ethan Cole", email: "ethan@example.com", username: "ethan.cole", status: "canceled",
    paid: "2026-10-11T09:00:00.000Z", lastActive: "2026-10-13T09:00:00.000Z", done: 2, lastLesson: "2026-10-12T09:00:00.000Z",
    request: { status: "rejected", at: "2026-10-12T10:00:00.000Z" },
  },
  {
    id: "p-nora", name: "Nora Brandt", email: "nora@example.com", username: "nora.b", status: "active",
    paid: "2026-10-20T12:00:00.000Z", lastActive: null, done: 0,
  },
  {
    id: "p-omar", name: "Omar Haddad", email: "omar@example.com", status: "active",
    paid: "2026-10-16T12:00:00.000Z", lastActive: "2026-10-19T20:00:00.000Z", done: 4, lastLesson: "2026-10-16T20:00:00.000Z",
    request: { status: "applied", code: "ECOM30-A1D9E0", at: "2026-10-18T08:00:00.000Z" },
  },
  {
    id: "p-maximilian", name: "Maximilian Featherstonehaugh-Smythe", email: "max.featherstonehaugh.smythe@example.com",
    username: "max.featherstonehaugh", status: "active", paid: "2026-10-09T10:00:00.000Z", lastActive: "2026-10-21T06:00:00.000Z",
    done: 14, lastLesson: "2026-10-21T05:30:00.000Z", streak: { current: 6, last: "2026-10-21" },
  },
  // Before the launch: on All students, never on the journey.
  {
    id: "p-leo", name: "Leo Hartmann", email: "leo@example.com", username: "leo.h", status: "active",
    paid: "2026-09-15T10:00:00.000Z", lastActive: "2026-10-20T10:00:00.000Z", done: 11, lastLesson: "2026-10-20T09:00:00.000Z",
    request: { status: "pending", at: "2026-10-14T09:00:00.000Z" },
  },
  {
    id: "p-ruby", name: "Ruby Okafor", email: "ruby@example.com", username: "ruby.ok", status: "canceled",
    paid: "2026-06-02T09:00:00.000Z", lastActive: "2026-07-10T09:00:00.000Z", done: 0,
  },
  {
    id: "p-felix", name: "Felix Moreau", email: "felix@example.com", status: "expired",
    paid: "2026-05-28T09:00:00.000Z", lastActive: "2026-06-20T09:00:00.000Z", done: 0,
  },
  {
    id: "p-iris", name: null, email: "iris.k@example.com", status: "active",
    paid: "2026-08-01T09:00:00.000Z", lastActive: "2026-10-15T09:00:00.000Z", done: 3, lastLesson: "2026-10-12T09:00:00.000Z", exempt: true,
  },
  // Paid since the launch, but no Whop membership on file: never on the journey.
  {
    id: "p-theo", name: "Theo Marsh", email: "theo@example.com", status: "active",
    paid: "2026-10-18T09:00:00.000Z", lastActive: "2026-10-19T09:00:00.000Z", done: 0, noWhopMembership: true,
  },
];

/** The journey's ?at=later: more students, paid in September and October, read on 12 November. */
const LATER_PEOPLE: Person[] = [
  ...PEOPLE,
  { id: "p-dana", name: "Dana Whitfield", email: "dana@example.com", status: "active", paid: "2026-10-22T09:00:00.000Z", lastActive: "2026-11-11T09:00:00.000Z", done: 10, lastLesson: "2026-11-11T09:00:00.000Z" },
  { id: "p-sam", name: "Sam Taylor", email: "sam@example.com", status: "past_due", paid: "2026-10-28T09:00:00.000Z", lastActive: "2026-11-01T09:00:00.000Z", done: 2, lastLesson: "2026-11-01T09:00:00.000Z" },
  { id: "p-zoe", name: "Zoe Achterberg", email: "zoe@example.com", status: "active", paid: "2026-11-05T09:00:00.000Z", lastActive: "2026-11-12T08:00:00.000Z", done: 6, lastLesson: "2026-11-12T08:00:00.000Z" },
];

function listStudent(p: Person): ListStudent {
  return {
    id: p.id,
    name: p.name,
    email: p.email,
    discord_username: p.username ?? null,
    membership_status: p.status,
    first_paid_at: p.paid,
    last_active_at: p.lastActive ?? null,
  };
}

function completionsOf(p: Person) {
  const counting = LESSONS.filter((l) => l.counts_toward_progress !== false).slice(0, p.done);
  return counting.map((l) => ({
    lesson_id: l.id,
    completed_at: p.lastLesson ?? SWITCH_AT,
    action_completed_at: l.requires_action ? (p.lastLesson ?? SWITCH_AT) : null,
    skipped_at: null,
    discord_message_link: l.requires_action ? `https://discord.com/channels/100000000000000001/100000000000000002/1000000000000${p.done}0${l.id.length}` : null,
  }));
}

/** The area of the furthest counted lesson, as student_current_region gives it. */
function areaOf(p: Person): string | null {
  if (p.done === 0) return null;
  const counting = LESSONS.filter((l) => l.counts_toward_progress !== false);
  return counting[p.done - 1]?.region_id ?? null;
}

function courseOf(people: Person[], failed: boolean): CourseActivity {
  if (failed) return { ok: false, error: `admin_config.curriculum_reset_at could not be read: ${READ_FAILED}` };
  return {
    ok: true,
    resetAt: SWITCH_AT,
    lastByStudent: new Map(people.filter((p) => p.lastLesson).map((p) => [p.id, p.lastLesson as string])),
  };
}

const ok = <T>(data: T): Read<T> => ({ ok: true, data });
const bad = <T>(): Read<T> => ({ ok: false, error: READ_FAILED });

/**
 * The student pages' stand-in. full: everyone above. partial: the progress,
 * the course and (on a student's page) every read but the student's own
 * fail, so every block says it could not load. empty: nobody. loading:
 * no answer ever. error: the students' read fails.
 */
export function fixturePeopleTransport(opts: { state: PeopleState; reloadFails?: boolean; later?: boolean }): PeopleTransport & {
  calls: Array<{ name: string; args: unknown[] }>;
} {
  const calls: Array<{ name: string; args: unknown[] }> = [];
  const people = opts.state === "empty" ? [] : opts.later ? LATER_PEOPLE : PEOPLE;
  const now = opts.later ? LATER : PEOPLE_NOW;
  const partial = opts.state === "partial";
  const flags = new Map(people.map((p) => [p.id, { exempt: p.exempt ?? false, ad: p.adVerified ?? false }]));
  let served = 0;
  const failNow = () => opts.state === "error" || (opts.reloadFails === true && served > 0);

  return {
    calls,

    loadStudents() {
      calls.push({ name: "loadStudents", args: [] });
      if (opts.state === "loading") return never();
      if (failNow()) return later(errAnswer(`Couldn't load the students (${READ_FAILED}).`));
      served++;
      const reads: StudentsListReads & { students: { ok: true; data: ListStudent[] } } = {
        students: { ok: true, data: people.map(listStudent) },
        progress: partial ? bad() : ok(people.filter((p) => p.done > 0).map((p) => ({ student_id: p.id, completed_count: p.done }))),
        countingLessons: ok(COUNTING),
      };
      return later(okAnswer(buildStudentsList(reads, courseOf(people, partial), now)));
    },

    loadStudent(studentId) {
      calls.push({ name: "loadStudent", args: [studentId] });
      if (opts.state === "loading") return never();
      if (failNow()) return later(errAnswer(`Couldn't load this student (${READ_FAILED}).`));
      served++;
      const p = people.find((x) => x.id === studentId);
      if (!p) return later(okAnswer(null));
      const f = flags.get(p.id) ?? { exempt: false, ad: false };
      const reads: StudentDetailReads & { student: { ok: true; data: DetailStudent } } = {
        student: {
          ok: true,
          data: {
            id: p.id,
            name: p.name,
            email: p.email,
            discord_username: p.username ?? null,
            membership_status: p.status,
            first_paid_at: p.paid,
            joined_at: p.paid,
            last_active_at: p.lastActive ?? null,
            cancel_scheduled_at: p.canceling ?? null,
            csm_exempt: f.exempt,
            ad_submissions_verified: f.ad,
          },
        },
        regions: ok(REGIONS),
        lessons: ok(LESSONS),
        completions: partial ? bad() : ok(completionsOf(p)),
        discount: partial ? bad() : ok(p.request ? { status: p.request.status, promo_code: p.request.code ?? null, created_at: p.request.at } : null),
        streak: partial ? bad() : ok(p.streak ? { current_streak: p.streak.current, last_streak_date: p.streak.last } : null),
        sync: partial
          ? bad()
          : ok(
              p.sync
                ? {
                    last_sync_at: p.sync.at,
                    last_sync_error: p.sync.error ?? null,
                    last_sync_error_at: p.sync.error ? p.sync.at : null,
                    last_sync_unmatched: p.sync.unmatched ?? [],
                    last_sync_fetched: p.sync.fetched,
                    last_sync_matched: p.sync.matched,
                  }
                : null,
            ),
      };
      return later(okAnswer(buildStudentDetail(reads, courseOf(people, partial), now)));
    },

    loadJourney() {
      calls.push({ name: "loadJourney", args: [] });
      if (opts.state === "loading") return never();
      if (failNow()) return later(errAnswer(`Couldn't load the students on the journey (${READ_FAILED}).`));
      served++;
      // The reader's own filters, applied here as the database applies them.
      const onBoard = people.filter(
        (p) => !p.noWhopMembership && ["active", "past_due", "canceled"].includes(p.status) && p.paid >= "2026-10-08T22:00:00.000Z",
      );
      const students: JourneyStudent[] = onBoard.map((p) => ({
        id: p.id,
        name: p.name,
        email: p.email,
        membership_status: p.status,
        first_paid_at: p.paid,
        last_active_at: p.lastActive ?? null,
        cancel_scheduled_at: p.canceling ?? null,
      }));
      const reads: JourneyReads & { students: { ok: true; data: JourneyStudent[] } } = {
        students: { ok: true, data: students },
        progress: partial ? bad() : ok(onBoard.filter((p) => p.done > 0).map((p) => ({ student_id: p.id, completed_count: p.done }))),
        currentArea: partial ? bad() : ok(onBoard.flatMap((p) => (areaOf(p) ? [{ student_id: p.id, current_region: areaOf(p) as string }] : []))),
        areas: ok(REGIONS),
        countingLessons: ok(COUNTING),
      };
      return later(okAnswer(buildJourney(reads, courseOf(people, partial), now)));
    },

    setExempt(studentId, exempt) {
      calls.push({ name: "setExempt", args: [studentId, exempt] });
      const f = flags.get(studentId);
      if (!f) return later(errAnswer("Couldn't save it: the change was not allowed."));
      f.exempt = exempt;
      return later(okAnswer(null));
    },

    setAdVerified(studentId, verified) {
      calls.push({ name: "setAdVerified", args: [studentId, verified] });
      const f = flags.get(studentId);
      if (!f) return later(errAnswer("Student not found"));
      f.ad = verified;
      return later(okAnswer(null));
    },
  };
}

// ── The Tasks page ──────────────────────────────────────────────────────────

const TEMPLATES: Record<string, TaskTemplate> = {
  "stalled.discord.day3": {
    scenario_id: "stalled.discord.day3", bucket: "at_risk", week: "D03", is_admin_only: false,
    title: "Not logged in by day 3",
    body: "Hey {firstName}, it's Astrid from the team. Saw you haven't opened the app yet. Here is the link: {programLink}",
  },
  "stalled.discord.day7": {
    scenario_id: "stalled.discord.day7", bucket: "cancel_path", week: "D07", is_admin_only: false,
    title: "Not logged in by day 7",
    body: "Hey {firstName}, a week in and the app is still waiting for you. Want a hand getting started? {programLink}",
  },
  "nolessons.day3": {
    scenario_id: "nolessons.day3", bucket: "at_risk", week: "D03", is_admin_only: false,
    title: "No lesson by day 3",
    body: "Hey {firstName}, the first lesson takes 6 minutes. Start here and tell me how it lands: {programLink}",
  },
  "C-42c1aa": {
    scenario_id: "C-42c1aa", bucket: "cancel_path", week: null, is_admin_only: false,
    title: "Is cancelling",
    body: "Hey {firstName}, saw you clicked cancel. Anything we could have done better? Join us in Discord too: {discordInvite}",
  },
  "welcome.d1": {
    scenario_id: "welcome.d1", bucket: "event", week: "D01", is_admin_only: false,
    title: "Welcome",
    body: "Hey {firstName}, welcome in. Your first step is here: {programLink}",
  },
  "W2.6": {
    scenario_id: "W2.6", bucket: "admin", week: null, is_admin_only: true,
    title: "Review a 30% request", body: "",
  },
};

function taskStudent(p: Person): TaskStudent {
  return {
    id: p.id,
    name: p.name,
    email: p.email,
    discord_username: p.username ?? null,
    membership_status: p.status,
    first_paid_at: p.paid,
    joined_at: p.paid,
    cancel_scheduled_at: p.canceling ?? null,
  };
}

const person = (id: string) => PEOPLE.find((p) => p.id === id) as Person;

function task(
  id: string,
  studentId: string,
  scenario: string,
  status: TaskRow["status"],
  createdAt: string,
  extra: Partial<TaskRow> = {},
): TaskRow {
  return {
    id,
    student_id: studentId,
    scenario_id: scenario,
    status,
    behavior_summary: null,
    created_at: createdAt,
    completed_at: null,
    dismissed_at: null,
    dismissed_by: null,
    notes: null,
    outcome: null,
    student: taskStudent(person(studentId)),
    template: TEMPLATES[scenario] ?? null,
    ...extra,
  };
}

/** The queue as the database holds it: after the reset, and before it (dismissed by the reset, sent, dismissed). */
function allTasks(): TaskRow[] {
  return [
    // After the reset (Tue 20 Oct, 09:00).
    task("t-01", "p-sofia", "C-42c1aa", "open", "2026-10-20T09:15:00.000Z", { behavior_summary: "Clicked cancel on Mon 19 Oct, still has access" }),
    task("t-02", "p-priya", "stalled.discord.day7", "open", "2026-10-20T09:20:00.000Z", { behavior_summary: "Never logged in (day 11)" }),
    task("t-03", "p-nora", "stalled.discord.day3", "open", "2026-10-21T07:15:00.000Z", { behavior_summary: "Never logged in (day 2)" }),
    task("t-04", "p-omar", "nolessons.day3", "open", "2026-10-20T11:15:00.000Z", { behavior_summary: "Logged in, no lesson on the new course yet (day 3)" }),
    task("t-05", "p-maya", "W2.6", "open", "2026-10-20T18:01:00.000Z", { behavior_summary: "Asked for the 30% on Tue 20 Oct" }),
    task("t-06", "p-maximilian", "welcome.d1", "open", "2026-10-21T08:00:00.000Z"),
    task("t-07", "p-jonah", "nolessons.day3", "completed", "2026-10-20T09:15:00.000Z", {
      completed_at: "2026-10-21T07:00:00.000Z", outcome: "replied",
    }),
    task("t-08", "p-leo", "stalled.discord.day3", "completed", "2026-10-20T09:15:00.000Z", { completed_at: "2026-10-20T13:00:00.000Z" }),
    task("t-09", "p-ethan", "nolessons.day3", "dismissed", "2026-10-20T09:15:00.000Z", {
      dismissed_at: "2026-10-20T15:00:00.000Z", dismissed_by: "tm-robin", notes: "Already replied in Discord",
    }),
    task("t-10", "p-ruby", "stalled.discord.day3", "dismissed", "2026-10-20T11:15:00.000Z", {
      dismissed_at: "2026-10-20T13:15:00.000Z", notes: "Auto-dismissed: student no longer in eligible pool.",
    }),
    // Before the reset.
    task("t-21", "p-leo", "stalled.discord.day7", "dismissed", "2026-10-18T09:20:00.000Z", {
      dismissed_at: TASKS_RESET_AT, notes: " [reset for the new program]",
    }),
    task("t-22", "p-jonah", "stalled.discord.day3", "dismissed", "2026-10-17T09:20:00.000Z", {
      dismissed_at: TASKS_RESET_AT, notes: "checked twice [reset for the new program]",
    }),
    task("t-23", "p-ethan", "nolessons.day3", "completed", "2026-10-12T09:15:00.000Z", { completed_at: "2026-10-12T15:00:00.000Z", outcome: "no_reply" }),
    task("t-24", "p-felix", "stalled.discord.day3", "dismissed", "2026-06-01T09:15:00.000Z", {
      dismissed_at: "2026-06-01T12:00:00.000Z", dismissed_by: "tm-jamie", notes: "Refunded",
    }),
  ];
}

/** GET /api/admin/tasks?status=all over `rows`: the reset's line, the search, the counts. */
function tasksAnswer(rows: TaskRow[], resetAt: string | null, search: string): TasksAnswer {
  const q = search.trim().toLowerCase();
  const found = rows.filter(
    (r) =>
      !q ||
      [r.student?.name, r.student?.email, r.student?.discord_username].some((v) => (v ?? "").toLowerCase().includes(q)),
  );
  const lists = found.filter((r) => isAfterTasksReset(r.created_at, resetAt));
  const archived = resetAt
    ? found.filter((r) => !isAfterTasksReset(r.created_at, resetAt)).sort((a, b) => b.created_at.localeCompare(a.created_at))
    : [];
  const count = (s: TaskRow["status"]) => lists.filter((r) => r.status === s).length;
  return {
    tasks: lists,
    archived,
    counts: { open: count("open"), completed: count("completed"), dismissed: count("dismissed"), archived: archived.length },
    resetAt,
    links: { program_login_link: "https://app.example.com/login", discord_invite_link: "" },
    generatedAt: PEOPLE_NOW,
  };
}

/** The Tasks page's stand-in. Its buttons change the rows as the routes do, a minute later each. */
export function fixtureTasksTransport(opts: {
  state: PeopleState;
  reset: boolean;
  reloadFails?: boolean;
}): TasksTransport & { calls: Array<{ name: string; args: unknown[] }> } {
  const calls: Array<{ name: string; args: unknown[] }> = [];
  const rows = opts.state === "empty" ? [] : allTasks();
  const resetAt = opts.reset ? TASKS_RESET_AT : null;
  let served = 0;
  let minute = 0;
  const at = () => new Date(Date.parse(PEOPLE_NOW) + 60_000 * ++minute).toISOString();
  const find = (id: string) => rows.find((r) => r.id === id);

  return {
    calls,
    loadTasks(search) {
      calls.push({ name: "loadTasks", args: [search] });
      if (opts.state === "loading") return never();
      if (opts.state === "error" || (opts.reloadFails && served > 0)) {
        return later(errAnswer("canceling statement due to statement timeout"));
      }
      served++;
      return later(okAnswer(tasksAnswer(rows, resetAt, search)));
    },
    transition(taskId, to, notes) {
      calls.push({ name: "transition", args: [taskId, to, notes] });
      const r = find(taskId);
      if (!r) return later(errAnswer("Task not found"));
      if (to === "completed") Object.assign(r, { status: "completed", completed_at: at() });
      else if (to === "dismissed") Object.assign(r, { status: "dismissed", dismissed_at: at(), dismissed_by: "tm-robin", notes: notes ?? null });
      else Object.assign(r, { status: "open", completed_at: null, dismissed_at: null, dismissed_by: null, notes: null, outcome: null });
      return later(okAnswer(null));
    },
    setOutcome(taskId, outcome) {
      calls.push({ name: "setOutcome", args: [taskId, outcome] });
      const r = find(taskId);
      if (!r) return later(errAnswer("Task not found"));
      if (r.status !== "completed") return later({ ok: false, status: 400, error: "Only a sent task can have a reply marked." });
      r.outcome = outcome;
      return later(okAnswer(null));
    },
    runChecks(full) {
      calls.push({ name: "runChecks", args: [full] });
      return later(okAnswer({ created: 0, text: full ? "Checked everything: Whop 1031 members, 0 new tasks, 0 alerts." : "Checked the tasks: 0 new tasks." }), 600);
    },
  };
}

// ── Outreach insights: the route's answer, made up ──────────────────────────

function insightsOf(resetAt: string | null, empty: boolean): OutreachInsights {
  const row = (id: string, title: string, bucket: string, family: OutreachInsights["templates"][number]["family"], label: string, n: Partial<OutreachInsights["templates"][number]>) => ({
    template_id: id, scenario_id: id, title, bucket, family, success_label: label,
    created: 0, open: 0, sent: 0, dismissed: 0, dismissed_auto: 0, replied: 0, no_reply: 0, unmarked: 0,
    success_eligible: 0, success: 0, median_time_to_send_ms: null, graded_on_old_course: 0, ...n,
  });
  const templates = empty
    ? []
    : [
        row("tpl-stalled-3", "Not logged in by day 3", "at_risk", "stalled", "logged in within 72h", {
          created: 14, open: 4, sent: 9, replied: 3, no_reply: 4, unmarked: 2, success_eligible: 9, success: 4, median_time_to_send_ms: 5 * 3_600_000,
        }),
        row("tpl-nolessons-3", "No lesson by day 3", "at_risk", "nolessons", "started a lesson within 72h", {
          created: 8, open: 2, sent: 6, replied: 2, no_reply: 1, unmarked: 3, success_eligible: 6, success: 2, median_time_to_send_ms: 26 * 3_600_000,
        }),
        row("tpl-cancel", "Is cancelling", "cancel_path", "canceling", "still a member, cancel withdrawn", {
          created: 3, open: 1, sent: 2, replied: 1, no_reply: 1, success_eligible: 2, success: 1, median_time_to_send_ms: 50 * 60_000,
        }),
        row("tpl-welcome", "Welcome", "event", "event", "not graded", { created: 5, open: 1, sent: 4, unmarked: 4, median_time_to_send_ms: 3 * 86_400_000 }),
      ];
  const sum = (k: keyof (typeof templates)[number]) => templates.reduce((n, t) => n + (t[k] as number), 0);
  return {
    totals: {
      students_reached: empty ? 0 : 17,
      created: sum("created"),
      open: sum("open"),
      sent: sum("sent"),
      dismissed: 0,
      dismissed_auto: 0,
      replied: sum("replied"),
      no_reply: sum("no_reply"),
      unmarked: sum("unmarked"),
      saves: empty ? 0 : 1,
      saves_eligible: empty ? 0 : 2,
      success: empty ? 0 : 6,
      success_eligible: empty ? 0 : 15,
      median_time_to_send_ms: empty ? null : 5 * 3_600_000,
      graded_on_old_course: resetAt || empty ? 0 : 7,
    },
    templates,
    info: { admin_only_tasks: 1, untemplated_tasks: 0 },
    since: null,
    reset_at: SWITCH_AT,
    tasks_floor: resetAt,
    computed_at: PEOPLE_NOW,
  };
}

export function fixtureInsightsTransport(opts: { state: PeopleState; reset: boolean }): InsightsTransport & {
  calls: Array<{ name: string; args: unknown[] }>;
} {
  const calls: Array<{ name: string; args: unknown[] }> = [];
  return {
    calls,
    loadInsights(sinceIso) {
      calls.push({ name: "loadInsights", args: [sinceIso] });
      if (opts.state === "loading") return never();
      if (opts.state === "error") return later(errAnswer("Couldn't read when the tasks were reset (admin_config.tasks_reset_at): canceling statement due to statement timeout"));
      return later(okAnswer({ ...insightsOf(opts.reset ? TASKS_RESET_AT : null, opts.state === "empty"), since: sinceIso }));
    },
  };
}
