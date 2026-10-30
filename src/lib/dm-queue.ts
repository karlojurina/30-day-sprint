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
 */

/** The one note for a student who never signed in to the app but watches lessons on Whop (check-na-tasks queues it). */
export const WHOP_WATCHER = "whop.watcher";

/** Scenarios whose templates send one and the same text (messages_v4.sql). */
const SAME_MESSAGE: ReadonlyArray<ReadonlyArray<string>> = [
  ["stalled.discord.day3", "stalled.whop.day3", "nolessons.day3"],
  ["stalled.discord.day7", "stalled.whop.day7", "nolessons.day7"],
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
 */
export function messagesHad(tasks: Iterable<QueueTask>): {
  has: (studentId: string, scenarioId: string) => boolean;
  add: (studentId: string, scenarioId: string) => void;
} {
  const had = new Set<string>();
  const keys = (studentId: string, scenarioId: string) =>
    sameMessage(scenarioId).map((s) => `${studentId}|${s}`);
  for (const t of tasks) {
    if (countsAsHad(t)) had.add(`${t.student_id}|${t.scenario_id}`);
  }
  return {
    has: (studentId, scenarioId) => keys(studentId, scenarioId).some((k) => had.has(k)),
    add: (studentId, scenarioId) => {
      had.add(`${studentId}|${scenarioId}`);
    },
  };
}

/** A discount request in one of these means the student applied for the 30% (the database refuses another while one exists). */
export const THIRTY_APPLIED_STATUSES: readonly string[] = ["pending", "approved", "applied"];
