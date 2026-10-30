/**
 * The team's DM queue: the one rule both task crons (check-na-tasks and
 * check-csm-tasks) check right before a task goes on To do.
 *
 * A student never gets a task for a message they already had (the owner,
 * 29 Oct 2026: "We're going to have to figure out how to not have
 * duplicates"). They had it when a task of the same message is:
 *   - open: it is on To do already;
 *   - completed: the team sent it;
 *   - dismissed by a team member (dismissed_by set): the team decided it.
 * A task the app dismissed (a cron's auto-dismiss, a supersession) or a bulk
 * reset dismissed (v109, the reset of 2026-10-30) has dismissed_by null and
 * does not count: the reset relies on the crons filling To do again where a
 * rule still holds.
 *
 * Before this, check-na-tasks read no tasks at all and the alert path of
 * check-csm-tasks read none either, so a task the team marked sent came back
 * at the next run while the student was still on that day (production, 29
 * Oct: 150 of the 378 students sent a stalled DM had 5 or more, where the
 * series has 4 days at most).
 *
 * The same message: since messages_v4.sql (pasted 2026-10-30) the day-3
 * "hasn't started" text is one text for stalled.discord.day3,
 * stalled.whop.day3 and nolessons.day3, and the day-7 text one for the three
 * day-7 scenarios. A student who had the day-3 text on Whop before they
 * signed in has had nolessons.day3's text too, and one who joined Discord
 * after it has had stalled.discord.day3's. Every other scenario is its own
 * message.
 *
 * One message may come again (the owner, 2026-10-30): the stopped-watching
 * DM, whose two versions (lapse.30 while the 30% is still in reach,
 * lapse.plain otherwise) are one message. It goes once per break, and at most
 * STOPPED_WATCHING_MAX times in all: a student had it when they had a task of
 * either version since their last finished lesson (a new break needs a lesson
 * finished after the last one), or had it STOPPED_WATCHING_MAX times. The 30%
 * closing DM (thirty.closing) had in a break takes its place: "If #7 is due
 * for the student in the same run, only #7 goes." Had means the same here as
 * everywhere: open, sent, or dismissed by a team member. Every other message,
 * thirty.closing included, still goes once ever.
 */

/** The one note for a student who never signed in to the app but watches lessons on Whop (check-na-tasks queues it). */
export const WHOP_WATCHER = "whop.watcher";

/** The stopped-watching DM while the 30% is still open and in reach (lapse A; check-csm-tasks 2d queues it). */
export const LAPSE_THIRTY = "lapse.30";
/** The stopped-watching DM otherwise (lapse B). */
export const LAPSE_PLAIN = "lapse.plain";
/** The stopped-watching DM's two versions: one message, the only one that may come again. */
export const STOPPED_WATCHING: readonly string[] = [LAPSE_THIRTY, LAPSE_PLAIN];
/** How many times a student may have the stopped-watching DM, counting both versions (the owner: at most 2 in month 1, the only month it goes in). */
export const STOPPED_WATCHING_MAX = 2;
/** The 30% closing DM, 2 days or less before the student's 2 weeks end (check-csm-tasks 2d queues it). */
export const THIRTY_CLOSING = "thirty.closing";

/** Scenarios whose templates send one and the same text (messages_v4.sql), and the stopped-watching DM's two versions. */
const SAME_MESSAGE: ReadonlyArray<ReadonlyArray<string>> = [
  ["stalled.discord.day3", "stalled.whop.day3", "nolessons.day3"],
  ["stalled.discord.day7", "stalled.whop.day7", "nolessons.day7"],
  STOPPED_WATCHING,
];

/** Every scenario that sends the same message as `scenarioId`, itself included. */
export function sameMessage(scenarioId: string): readonly string[] {
  return SAME_MESSAGE.find((group) => group.includes(scenarioId)) ?? [scenarioId];
}

/** A task as the rule reads it. */
export interface QueueTask {
  student_id: string;
  scenario_id: string;
  status: string;
  dismissed_by: string | null;
  /** When the task was made: read only for the stopped-watching DM's break. Left out or not a date: as if made now. */
  created_at?: string | null;
}

/** Whether `task` means its student had its message: open, sent, or dismissed by a team member. */
export function countsAsHad(task: Pick<QueueTask, "status" | "dismissed_by">): boolean {
  return (
    task.status === "open" ||
    task.status === "completed" ||
    (task.status === "dismissed" && task.dismissed_by != null)
  );
}

/**
 * The same tasks as a PostgREST filter, for a read's `.or()`: open or sent,
 * or with a team member on its dismissal. A task with dismissed_by set is
 * dismissed (the routes that reopen or send one clear it).
 */
export const HAD_TASKS_FILTER = "status.in.(open,completed),dismissed_by.not.is.null";

/**
 * The messages each student had, from their tasks. `has` answers before a
 * task is made; `add` records one made in the same run, so a second
 * candidate of the same message is not made beside it.
 *
 * `lastLessonAt` says when a student last finished a lesson, for the
 * stopped-watching DM's break (check-csm-tasks hands it the snapshot's;
 * check-na-tasks, which never sends that DM, leaves it out). A task of that
 * DM, or a thirty.closing, made at or after that moment is in the same break;
 * with no lesson finished, every one is.
 */
export function messagesHad(
  tasks: Iterable<QueueTask>,
  lastLessonAt: (studentId: string) => string | null = () => null,
): {
  has: (studentId: string, scenarioId: string) => boolean;
  add: (studentId: string, scenarioId: string) => void;
} {
  const had = new Set<string>();
  // Per student: how many stopped-watching DMs they had, and when each of
  // those and each thirty.closing they had was made.
  const stoppedCount = new Map<string, number>();
  const breakMarks = new Map<string, number[]>();
  const mark = (studentId: string, at: number) =>
    breakMarks.set(studentId, [...(breakMarks.get(studentId) ?? []), at]);
  const madeAt = (createdAt: string | null | undefined) => {
    const t = Date.parse(createdAt ?? "");
    return Number.isFinite(t) ? t : Date.now();
  };
  const keys = (studentId: string, scenarioId: string) =>
    sameMessage(scenarioId).map((s) => `${studentId}|${s}`);
  for (const t of tasks) {
    if (!countsAsHad(t)) continue;
    had.add(`${t.student_id}|${t.scenario_id}`);
    if (STOPPED_WATCHING.includes(t.scenario_id)) {
      stoppedCount.set(t.student_id, (stoppedCount.get(t.student_id) ?? 0) + 1);
    }
    if (STOPPED_WATCHING.includes(t.scenario_id) || t.scenario_id === THIRTY_CLOSING) {
      mark(t.student_id, madeAt(t.created_at));
    }
  }
  return {
    has: (studentId, scenarioId) => {
      if (!STOPPED_WATCHING.includes(scenarioId)) {
        return keys(studentId, scenarioId).some((k) => had.has(k));
      }
      if ((stoppedCount.get(studentId) ?? 0) >= STOPPED_WATCHING_MAX) return true;
      const last = Date.parse(lastLessonAt(studentId) ?? "");
      const marks = breakMarks.get(studentId) ?? [];
      return Number.isFinite(last) ? marks.some((m) => m >= last) : marks.length > 0;
    },
    add: (studentId, scenarioId) => {
      had.add(`${studentId}|${scenarioId}`);
      if (STOPPED_WATCHING.includes(scenarioId)) {
        stoppedCount.set(studentId, (stoppedCount.get(studentId) ?? 0) + 1);
      }
      if (STOPPED_WATCHING.includes(scenarioId) || scenarioId === THIRTY_CLOSING) {
        mark(studentId, Date.now());
      }
    },
  };
}

/** A discount request in one of these means the student applied for the 30% (the database refuses another while one exists). */
export const THIRTY_APPLIED_STATUSES: readonly string[] = ["pending", "approved", "applied"];
