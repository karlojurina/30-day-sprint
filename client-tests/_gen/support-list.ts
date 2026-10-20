/**
 * Today's list (GET /api/admin/today): every student who needs a message,
 * why, how to reach them and what to send (admin rebuild PRD, calls C3 to C8,
 * C12 and C14). Pure: no database and no clock of its own. today-data.ts reads
 * everything and the route hands this file the moment.
 *
 * WHO IS ON IT (C3). Members whose membership is active or past due, who have
 * a Whop membership and are not exempt from messages, on any plan and at any
 * tenure. The loader asks the database for exactly them; this file applies
 * the same rule again, so a row that slips through a read never shows.
 *
 * WHY (C4). Each student gets every reason that applies, most urgent first;
 * the first is the row's headline and the rest are chips:
 *
 *   cancelling      "Clicked cancel 2 days ago"
 *   past_due        "Payment failed"
 *   thirty_closing  "30% closes Fri 23 Oct, 23:59: 4 videos left (about 1 h)"
 *                   (videos left, deadline within 3 days)
 *   thirty_ready    "Can apply for the 30% now, until Fri 23 Oct, 23:59"
 *   stopped         "No lesson for 5 days" (a counted lesson, then none for
 *                   3 days or more: Slipping up to 7, Stalled after)
 *   not_started     "No lesson on the new course yet (course day 4)"
 *   never_opened    "Paid 6 days ago, never opened the app" (whole days)
 *   open_task       the queue task's own summary, when nothing above applies
 *
 * The thresholds are the app's own: activityLabel (curriculum-reset.ts),
 * nolessons.day3 and the never-logged-in cron's day 3. An app heartbeat in the
 * last 3 days holds back Stopped and Not started, and a student who has done
 * every counted lesson is never Stopped (there is nothing left to stop on).
 * Not started is for a student who opened the app; one who never did is
 * Never opened, which leaves out the members the never-logged-in sequence
 * marked high churn risk at its day 10. Never opened starts on the cron's day
 * 3 (sprintDayNumber's count, a day number), and its sentence says the whole
 * days since the first payment, as "Clicked cancel" and "No lesson for" do.
 * The 30% is the student app's own rule (studentAppView in thirty-view.ts, as
 * Can still earn reads it).
 *
 * ALREADY HANDLED (C5). A row whose headline was messaged, or marked not
 * needed, recently stays hidden: while a support record of that reason, or a
 * queue task of its family (stalled.* for Never opened, nolessons.* for Not
 * started) closed by the team, is newer than 7 days (Stopped, Not started,
 * Never opened), 3 days (Cancelling, Payment failed) or 2 days (the 30%). A
 * counted lesson after the record ends a Stopped wait, a different headline
 * shows the row, and an open queue task always shows it.
 *
 * WHAT TO SEND (C6). A row with an open queue task copies that task's
 * template. Otherwise the headline copies the active template whose scenario
 * is its support.<kind>, when one exists. Otherwise there is no text.
 *
 * Also here: the last message the team marked as sent (C12), the Whop
 * backfill check (C14: no backfill since the switch puts a Stopped or Not
 * started row in a folded group of its own), the Handled list of the last 7
 * days, and the filter and counts the page shows (C13), so the page and the
 * tests count the same way.
 */

import { activityLabel, courseAnchorIso, daysOnCourse } from "./curriculum-reset.ts";
import { isCanceling } from "./metrics-definitions.ts";
import { renderTemplate } from "./templates.ts";
import type { TemplateRenderInputs } from "./templates.ts";
import { requiredLessons } from "./discount.ts";
import type { DiscountState, DiscountWindow } from "./discount.ts";
import { factsFromReads } from "./discount-server.ts";
import type { DiscountReads } from "./discount-server.ts";
import { planLabel } from "./plans.ts";
import type { PlanLabel } from "./plans.ts";
import { studentAppView, thirtyReasonText, whopPulled } from "./thirty-view.ts";
import type { LastContact, TeamRef } from "./thirty-view.ts";
import type { ThirtyData } from "./thirty-data.ts";

const DAY_MS = 86_400_000;

/** The reasons, most urgent first (C4). */
export const REASON_ORDER = [
  "cancelling",
  "past_due",
  "thirty_closing",
  "thirty_ready",
  "stopped",
  "not_started",
  "never_opened",
  "open_task",
] as const;

export type ReasonKind = (typeof REASON_ORDER)[number];

/** The reasons the app computes. An open task is the queue's own. */
export type ComputedKind = Exclude<ReasonKind, "open_task">;

/** The short name of each reason, for the chips and the Handled list. */
export const REASON_LABEL: Record<ReasonKind, string> = {
  cancelling: "Cancelling",
  past_due: "Payment failed",
  thirty_closing: "30% closing",
  thirty_ready: "30% ready",
  stopped: "Stopped",
  not_started: "Not started",
  never_opened: "Never opened",
  open_task: "Open task",
};

/** The scenario of the record a mark writes for a computed headline (C5). */
export const SUPPORT_SCENARIO: Record<ComputedKind, string> = {
  cancelling: "support.cancel",
  past_due: "support.pastdue",
  thirty_closing: "support.30close",
  thirty_ready: "support.30ready",
  stopped: "support.stopped",
  not_started: "support.nostart",
  never_opened: "support.noopen",
};

/** How long a handled headline stays hidden, in days (C5). */
export const COOLDOWN_DAYS: Record<ComputedKind, number> = {
  cancelling: 3,
  past_due: 3,
  thirty_closing: 2,
  thirty_ready: 2,
  stopped: 7,
  not_started: 7,
  never_opened: 7,
};

/** The queue task families whose sends count as handling a computed headline (C5). */
const CRON_FAMILY: Partial<Record<ComputedKind, string>> = {
  never_opened: "stalled.",
  not_started: "nolessons.",
};

/** An app heartbeat this recent holds back Stopped and Not started (C4). */
export const HEARTBEAT_HOLD_DAYS = 3;
/** A 30% deadline this close makes "videos left" a reason (C4). */
export const THIRTY_CLOSING_DAYS = 3;
/** Course day (and days since the first payment) from which Not started and Never opened apply (C4). */
export const FIRST_REASON_DAY = 3;
/** Handled lists what was done in this many days (C12). */
export const HANDLED_DAYS = 7;
/** A member can undo their own mark for this long (C5, C12). */
export const UNDO_MINUTES = 15;
/**
 * The `code` of the mark route's 409 when a second mark within 2 minutes says
 * the other thing (Messaged, then Not needed): nothing was saved, and the
 * page shows the sentence on the row instead of reading the list again.
 */
export const MARKED_OTHERWISE = "marked-otherwise";

export function isReasonKind(value: unknown): value is ReasonKind {
  return typeof value === "string" && (REASON_ORDER as readonly string[]).includes(value);
}

const RANK: Record<ReasonKind, number> = Object.fromEntries(REASON_ORDER.map((k, i) => [k, i + 1])) as Record<
  ReasonKind,
  number
>;

// ── What the builder reads ───────────────────────────────────────────────────

/** A student as today-data.ts reads them. */
export interface SupportStudent {
  id: string;
  name: string | null;
  email: string | null;
  discord_user_id: string | null;
  discord_username: string | null;
  whop_plan_id: string | null;
  whop_membership_id: string | null;
  membership_status: string;
  cancel_scheduled_at: string | null;
  first_paid_at: string | null;
  joined_at: string | null;
  csm_exempt: boolean | null;
  high_churn_risk: boolean | null;
}

/** The `tasks` columns Today and the mark route read. */
export const TASK_COLUMNS =
  "id, student_id, scenario_id, template_id, status, behavior_summary, created_at, completed_at, completed_by, dismissed_at, dismissed_by, notes, outcome";

/** A `tasks` row: a queue task, or a support record written by a mark. */
export interface SupportTask {
  id: string;
  student_id: string;
  scenario_id: string;
  template_id: string | null;
  status: string;
  behavior_summary: string | null;
  created_at: string;
  completed_at: string | null;
  completed_by: string | null;
  dismissed_at: string | null;
  dismissed_by: string | null;
  notes: string | null;
  outcome: string | null;
}

export interface SupportTemplate {
  id: string;
  scenario_id: string | null;
  title: string | null;
  body: string | null;
  is_active: boolean | null;
}

export interface SupportInput {
  /** admin_config.curriculum_reset_at: the course switch, or null while the old course is live. */
  resetAt: string | null;
  /** The team member reading the list: Handled offers Undo on their own entries. */
  callerId: string;
  /** Lessons that count toward progress. */
  lessonsTotal: number;
  /** The members C3 lists (the builder applies the rule again). */
  students: SupportStudent[];
  /** student_progress_counts.completed_count, by student. */
  progress: ReadonlyMap<string, number>;
  /** student_last_counted_completion.last_completed_at, by student. */
  lastLesson: ReadonlyMap<string, string>;
  /** student_current_region.current_region (an area id), by student. */
  currentArea: ReadonlyMap<string, string>;
  /** regions: area id to name. */
  areas: ReadonlyMap<string, string>;
  /** Students with student_milestones.first_sprint_login_at set: they opened the app. */
  firstLogin: ReadonlySet<string>;
  /** student_whop_sync.last_sync_at, by student (absent when no backfill ever ran). */
  lastSyncAt: ReadonlyMap<string, string | null>;
  /** The newest student_lesson_watch.last_heartbeat_at of the last 3 days, by student. */
  lastHeartbeat: ReadonlyMap<string, string>;
  /** Every open task, and the completed and dismissed ones of the last 30 days. */
  tasks: SupportTask[];
  /** Every template (an open task copies its own, active or not; a computed headline only an active support.<kind>). */
  templates: SupportTemplate[];
  /** Team member id to full name. */
  team: ReadonlyMap<string, string>;
  /** Student id to name, for Handled rows of students who are not on the list. */
  names: ReadonlyMap<string, string | null>;
  /** admin_config's links, for the templates' variables. */
  config: TemplateRenderInputs["config"];
  /** loadThirtyData's answer: the 30% of every member who can earn it. */
  thirty: ThirtyData;
}

// ── What it answers (section 8) ──────────────────────────────────────────────

export interface SupportReason {
  kind: ReasonKind;
  /** C4's words. */
  text: string;
  rank: number;
  /** How long the student has had this reason, in whole days; null when unknown (Payment failed has no date). */
  waitDays: number | null;
}

export interface SupportOpenTask {
  id: string;
  scenarioId: string;
  summary: string | null;
  createdAt: string;
  /** The task's template, filled in for the student; null when the task has none. */
  message: string | null;
  /** Variables the template names that could not be filled in. */
  unresolved: string[];
}

export interface SupportThirty {
  /** discountState's kind: locked, ready, expired, pending ... */
  state: DiscountState["kind"];
  window: DiscountWindow | null;
  deadline: string | null;
  videosDone: number | null;
  videosTotal: number | null;
  secondsLeft: number | null;
}

export interface SupportRow {
  studentId: string;
  name: string | null;
  email: string | null;
  discord: { userId: string | null; username: string | null };
  plan: PlanLabel;
  status: "active" | "past_due";
  /** When the student clicked cancel in Whop, while the membership is still running; else null. */
  cancelClickedAt: string | null;
  /** C8: counted from the later of the first payment and the switch, as the crons count. */
  courseDay: number;
  firstPaidAt: string | null;
  lessonsDone: number;
  area: { id: string; name: string } | null;
  lastLessonAt: string | null;
  lastHeartbeatAt: string | null;
  /** C14: a Whop backfill ran since the switch. */
  whopPulled: boolean;
  /** C14: "whop-not-pulled" for a Stopped or Not started headline with no backfill since the switch. */
  group: "main" | "whop-not-pulled";
  thirty: SupportThirty | null;
  /** Most urgent first: index 0 is the headline. */
  reasons: SupportReason[];
  openTasks: SupportOpenTask[];
  /** The headline's support.<kind> template, filled in, when no open task brings a message; else null. */
  supportMessage: string | null;
  /** C12: the newest message the team marked as sent (the last 30 days are read). */
  lastContact: LastContact | null;
}

export interface HandledRow {
  taskId: string;
  studentId: string;
  name: string | null;
  scenarioId: string;
  status: "completed" | "dismissed";
  at: string;
  /** Null when the app closed the task itself. */
  by: TeamRef | null;
  note: string | null;
  outcome: "replied" | "no_reply" | null;
  /** The task's behavior_summary: for a support record, every reason the row had. */
  summary: string | null;
  /** "<by>|<at>": one mark's support record and the queue tasks it closed share it. */
  groupKey: string;
  /** Closed by the reader less than 15 minutes ago. */
  undoable: boolean;
}

/** GET /api/admin/today's answer. */
export interface TodayView {
  generatedAt: string;
  resetAt: string | null;
  lessonsTotal: number;
  rows: SupportRow[];
  handled: HandledRow[];
}

// ── Small rules ──────────────────────────────────────────────────────────────

/** C3's population: active or past due, with a Whop membership, not exempt. */
export function inTodayPopulation(
  s: Pick<SupportStudent, "membership_status" | "whop_membership_id" | "csm_exempt">,
): boolean {
  if (s.membership_status !== "active" && s.membership_status !== "past_due") return false;
  if (!s.whop_membership_id) return false;
  return s.csm_exempt !== true;
}

/** A record a mark wrote: a support.* scenario and no template. */
export function isSupportRecord(t: Pick<SupportTask, "scenario_id" | "template_id">): boolean {
  return typeof t.scenario_id === "string" && t.scenario_id.startsWith("support.") && t.template_id == null;
}

/** When a task was completed or dismissed. */
export function closedAt(t: Pick<SupportTask, "status" | "completed_at" | "dismissed_at">): string | null {
  if (t.status === "completed") return t.completed_at ?? null;
  if (t.status === "dismissed") return t.dismissed_at ?? null;
  return null;
}

/** Who completed or dismissed a task. */
export function closedBy(t: Pick<SupportTask, "status" | "completed_by" | "dismissed_by">): string | null {
  if (t.status === "completed") return t.completed_by ?? null;
  if (t.status === "dismissed") return t.dismissed_by ?? null;
  return null;
}

/** Whole days from `iso` to `nowMs`, never below 0; null for no date or one that does not parse. */
function wholeDaysSince(iso: string | null | undefined, nowMs: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((nowMs - t) / DAY_MS));
}

/** C4's words for Cancelling: "Clicked cancel 2 days ago". */
export function cancelText(days: number | null): string {
  if (days == null) return "Clicked cancel";
  if (days === 0) return "Clicked cancel less than 1 day ago";
  return `Clicked cancel ${days} ${days === 1 ? "day" : "days"} ago`;
}

/** C4's words for Never opened, with the whole days since the first payment: "Paid 6 days ago, never opened the app". */
export function neverOpenedText(days: number): string {
  if (days <= 0) return "Paid less than 1 day ago, never opened the app";
  return `Paid ${days} ${days === 1 ? "day" : "days"} ago, never opened the app`;
}

/** "Slipping" for 3 to 7 days without a lesson, "Stalled" after (activityLabel's words). */
export function stoppedLabel(days: number): "Slipping" | "Stalled" {
  return days <= 7 ? "Slipping" : "Stalled";
}

/** The day the student finished the last of the videos the 30% asks for, or null. */
function readySince(reads: DiscountReads): string | null {
  const f = factsFromReads(reads);
  if (!f.ok) return null;
  const asked = new Set(requiredLessons(f.facts.lessons).map((l) => l.id));
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const c of f.facts.completions) {
    if (!asked.has(c.lesson_id) || !c.completed_at) continue;
    const t = Date.parse(c.completed_at);
    if (Number.isFinite(t) && t > bestMs) {
      best = c.completed_at;
      bestMs = t;
    }
  }
  return best;
}

/**
 * C5: the headline was handled recently, so the row stays hidden. Only the
 * team's closings count: a support record of the headline's reason, or a
 * queue task of its family, completed or dismissed by a team member.
 */
function handledRecently(
  kind: ComputedKind,
  mine: readonly SupportTask[],
  lastLessonAt: string | null,
  nowMs: number,
): boolean {
  const since = nowMs - COOLDOWN_DAYS[kind] * DAY_MS;
  const scenario = SUPPORT_SCENARIO[kind];
  const family = CRON_FAMILY[kind];
  const lessonMs = lastLessonAt ? Date.parse(lastLessonAt) : NaN;
  return mine.some((t) => {
    const at = closedAt(t);
    if (!at || !closedBy(t)) return false;
    const atMs = Date.parse(at);
    if (!Number.isFinite(atMs) || atMs <= since) return false;
    const matches = isSupportRecord(t)
      ? t.scenario_id === scenario
      : family !== undefined && t.scenario_id.startsWith(family);
    if (!matches) return false;
    // A counted lesson after the record: the student moved, so a new stop is new.
    if (kind === "stopped" && Number.isFinite(lessonMs) && lessonMs > atMs) return false;
    return true;
  });
}

/** The newest completed task: the last message the team marked as sent (C12). */
function lastContactOf(rows: readonly SupportTask[], team: ReadonlyMap<string, string>): LastContact | null {
  let best: SupportTask | null = null;
  let bestMs = -Infinity;
  for (const r of rows) {
    if (r.status !== "completed" || !r.completed_at) continue;
    const t = Date.parse(r.completed_at);
    if (Number.isFinite(t) && t > bestMs) {
      best = r;
      bestMs = t;
    }
  }
  if (!best || !best.completed_at) return null;
  return {
    at: best.completed_at,
    by: best.completed_by ? { id: best.completed_by, name: team.get(best.completed_by) ?? null } : null,
    scenarioId: best.scenario_id,
    outcome: best.outcome === "replied" || best.outcome === "no_reply" ? best.outcome : null,
  };
}

/** A template's body filled in for the student, or null when it has no words. */
function fill(
  body: string | null | undefined,
  s: SupportStudent,
  config: SupportInput["config"],
): { body: string; unresolved: string[] } | null {
  if (!body || !body.trim()) return null;
  return renderTemplate(body, { student: { name: s.name, joined_at: s.joined_at ?? s.first_paid_at ?? "" }, config });
}

const byText = (a: string | null, b: string | null) => (a ?? "").localeCompare(b ?? "");
const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// ── The builder ──────────────────────────────────────────────────────────────

export function buildSupportRows(input: SupportInput, now: Date): { rows: SupportRow[]; handled: HandledRow[] } {
  const nowMs = now.getTime();

  const tasksByStudent = new Map<string, SupportTask[]>();
  for (const t of input.tasks) {
    const list = tasksByStudent.get(t.student_id);
    if (list) list.push(t);
    else tasksByStudent.set(t.student_id, [t]);
  }
  const templateById = new Map(input.templates.map((t) => [t.id, t] as const));
  const supportTemplate = new Map<string, SupportTemplate>();
  for (const t of input.templates) {
    if (t.is_active === true && t.scenario_id && t.scenario_id.startsWith("support.")) supportTemplate.set(t.scenario_id, t);
  }

  const rows: SupportRow[] = [];
  const listed = new Set<string>();
  for (const s of input.students) {
    if (!inTodayPopulation(s) || listed.has(s.id)) continue;
    listed.add(s.id);
    const mine = tasksByStudent.get(s.id) ?? [];
    const open = mine
      .filter((t) => t.status === "open" && !isSupportRecord(t))
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || byId(a.id, b.id));

    const reasons: SupportReason[] = [];
    const add = (kind: ReasonKind, text: string, waitDays: number | null) =>
      reasons.push({ kind, text, rank: RANK[kind], waitDays });

    const canceling = isCanceling(s);
    if (canceling) {
      const days = wholeDaysSince(s.cancel_scheduled_at, nowMs);
      add("cancelling", cancelText(days), days);
    }
    if (s.membership_status === "past_due") add("past_due", "Payment failed", null);

    // The 30%, as the student app computes it for a member who can still earn it.
    const reads = input.thirty.reads.get(s.id);
    const app = reads ? studentAppView(reads, now) : null;
    if (app && app.state.kind === "locked" && app.facts.deadline) {
      const deadlineMs = Date.parse(app.facts.deadline);
      if (deadlineMs - nowMs <= THIRTY_CLOSING_DAYS * DAY_MS) {
        const closingFrom = deadlineMs - THIRTY_CLOSING_DAYS * DAY_MS;
        add("thirty_closing", thirtyReasonText("thirty_closing", app.facts), Math.max(0, Math.floor((nowMs - closingFrom) / DAY_MS)));
      }
    } else if (app && app.state.kind === "ready" && reads) {
      add("thirty_ready", thirtyReasonText("thirty_ready", app.facts), wholeDaysSince(readySince(reads), nowMs));
    }

    // The course.
    const lastLessonAt = input.lastLesson.get(s.id) ?? null;
    const heartbeat = input.lastHeartbeat.get(s.id) ?? null;
    const heartbeatMs = heartbeat ? Date.parse(heartbeat) : NaN;
    const heldBack = Number.isFinite(heartbeatMs) && heartbeatMs >= nowMs - HEARTBEAT_HOLD_DAYS * DAY_MS;
    const openedApp = input.firstLogin.has(s.id);
    const joinedAt = s.joined_at ?? s.first_paid_at ?? now.toISOString();
    const courseDay = daysOnCourse(courseAnchorIso(s.first_paid_at, joinedAt, input.resetAt), nowMs);
    if (!heldBack) {
      if (lastLessonAt) {
        // Every counted lesson done: nothing is left to stop on, however long ago the last one was.
        const finished = input.lessonsTotal > 0 && (input.progress.get(s.id) ?? 0) >= input.lessonsTotal;
        const label = activityLabel(lastLessonAt, nowMs);
        if (!finished && (label === "slipping" || label === "stalled")) {
          const days = Math.floor((nowMs - Date.parse(lastLessonAt)) / DAY_MS);
          add("stopped", `No lesson for ${days} days`, days);
        }
      } else if (openedApp && courseDay >= FIRST_REASON_DAY) {
        add("not_started", `No lesson on the new course yet (course day ${courseDay})`, courseDay);
      }
    }
    if (!openedApp && s.high_churn_risk !== true) {
      // From the never-logged-in cron's day 3: sprintDayNumber's count (a day
      // number, whole days rounded up, at least 1), handed the moment. The
      // sentence says the whole days that have passed, as the other reasons do.
      const paidFrom = s.first_paid_at ?? joinedAt;
      if (daysOnCourse(paidFrom, nowMs) >= FIRST_REASON_DAY) {
        const days = wholeDaysSince(paidFrom, nowMs) ?? 0;
        add("never_opened", neverOpenedText(days), days);
      }
    }

    // An open queue task is the headline only when nothing above applies.
    if (reasons.length === 0) {
      for (const t of open) {
        add("open_task", t.behavior_summary?.trim() || "Open task in the Tasks queue", wholeDaysSince(t.created_at, nowMs));
      }
    }
    if (reasons.length === 0) continue;
    reasons.sort((a, b) => a.rank - b.rank);
    const headline = reasons[0];

    if (open.length === 0 && headline.kind !== "open_task" && handledRecently(headline.kind, mine, lastLessonAt, nowMs)) {
      continue;
    }

    const openTasks: SupportOpenTask[] = open.map((t) => {
      const tpl = t.template_id ? templateById.get(t.template_id) : undefined;
      const filled = tpl ? fill(tpl.body, s, input.config) : null;
      return {
        id: t.id,
        scenarioId: t.scenario_id,
        summary: t.behavior_summary ?? null,
        createdAt: t.created_at,
        message: filled ? filled.body : null,
        unresolved: filled ? filled.unresolved : [],
      };
    });
    let supportMessage: string | null = null;
    if (headline.kind !== "open_task" && !openTasks.some((t) => t.message)) {
      supportMessage = fill(supportTemplate.get(SUPPORT_SCENARIO[headline.kind])?.body, s, input.config)?.body ?? null;
    }

    const pulled = whopPulled(input.lastSyncAt.get(s.id), input.resetAt);
    const areaId = input.currentArea.get(s.id) ?? null;
    rows.push({
      studentId: s.id,
      name: s.name ?? null,
      email: s.email ?? null,
      discord: { userId: s.discord_user_id ?? null, username: s.discord_username ?? null },
      plan: planLabel(s.whop_plan_id),
      status: s.membership_status as "active" | "past_due",
      cancelClickedAt: canceling ? (s.cancel_scheduled_at ?? null) : null,
      courseDay,
      firstPaidAt: s.first_paid_at ?? null,
      lessonsDone: input.progress.get(s.id) ?? 0,
      area: areaId ? { id: areaId, name: input.areas.get(areaId) ?? areaId } : null,
      lastLessonAt,
      lastHeartbeatAt: heartbeat,
      whopPulled: pulled,
      group: !pulled && (headline.kind === "stopped" || headline.kind === "not_started") ? "whop-not-pulled" : "main",
      thirty: app
        ? {
            state: app.state.kind,
            window: app.facts.window,
            deadline: app.facts.deadline,
            videosDone: app.facts.videosDone,
            videosTotal: app.facts.videosTotal,
            secondsLeft: app.facts.secondsLeft,
          }
        : null,
      reasons,
      openTasks,
      supportMessage,
      lastContact: lastContactOf(mine, input.team),
    });
  }

  // The most urgent headline first; inside a reason, the longest wait first.
  rows.sort((a, b) => {
    const x = a.reasons[0];
    const y = b.reasons[0];
    return (
      x.rank - y.rank ||
      (y.waitDays ?? -1) - (x.waitDays ?? -1) ||
      byText(a.name, b.name) ||
      byId(a.studentId, b.studentId)
    );
  });

  // Handled: everything the team (or the app) completed or dismissed in the last 7 days.
  const names = new Map<string, string | null>(input.names);
  for (const s of input.students) names.set(s.id, s.name ?? null);
  const handledSince = nowMs - HANDLED_DAYS * DAY_MS;
  const handled: HandledRow[] = [];
  for (const t of input.tasks) {
    const at = closedAt(t);
    if (!at) continue;
    const atMs = Date.parse(at);
    if (!Number.isFinite(atMs) || atMs <= handledSince) continue;
    const by = closedBy(t);
    handled.push({
      taskId: t.id,
      studentId: t.student_id,
      name: names.get(t.student_id) ?? null,
      scenarioId: t.scenario_id,
      status: t.status as "completed" | "dismissed",
      at,
      by: by ? { id: by, name: input.team.get(by) ?? null } : null,
      note: t.notes ?? null,
      outcome: t.outcome === "replied" || t.outcome === "no_reply" ? t.outcome : null,
      summary: t.behavior_summary ?? null,
      groupKey: `${by ?? ""}|${at}`,
      undoable: by !== null && by === input.callerId && nowMs - atMs < UNDO_MINUTES * 60_000,
    });
  }
  // Newest first, and a mark's record and the tasks it closed side by side, the record first.
  handled.sort(
    (a, b) =>
      Date.parse(b.at) - Date.parse(a.at) ||
      byId(a.groupKey, b.groupKey) ||
      Number(isSupportScenario(b.scenarioId)) - Number(isSupportScenario(a.scenarioId)) ||
      byId(a.taskId, b.taskId),
  );

  return { rows, handled };
}

function isSupportScenario(scenarioId: string): boolean {
  return scenarioId.startsWith("support.");
}

// ── The page's filter and counts (C13) ───────────────────────────────────────

/** "Monthly and Yearly" (the default) or every plan. */
export type PlanFilter = "monthly-yearly" | "all";

export interface RowFilter {
  plan: PlanFilter;
  /** Name, email or @discord, any case. */
  search: string;
  /** A chip: only rows with this headline. Null for every reason. */
  kind: ReasonKind | null;
}

export const DEFAULT_FILTER: RowFilter = { plan: "monthly-yearly", search: "", kind: null };

/** The row passes the plan filter and the search. */
export function matchesPlanAndSearch(row: SupportRow, f: Pick<RowFilter, "plan" | "search">): boolean {
  if (f.plan === "monthly-yearly" && row.plan === "Other plan") return false;
  // "@name" finds the Discord name with or without its @ (written [@]: the test build refuses an "@" before a "/").
  const q = f.search.trim().toLowerCase().replace(/^[@]+/, "");
  if (!q) return true;
  const fields = [row.name, row.email, row.discord.username?.replace(/^[@]+/, "")];
  return fields.some((v) => typeof v === "string" && v.toLowerCase().includes(q));
}

/** The rows the page shows: the main list, and C14's folded group. */
export function visibleRows(rows: readonly SupportRow[], f: RowFilter): { main: SupportRow[]; whopNotPulled: SupportRow[] } {
  const shown = rows.filter((r) => matchesPlanAndSearch(r, f) && (f.kind === null || r.reasons[0]?.kind === f.kind));
  return {
    main: shown.filter((r) => r.group === "main"),
    whopNotPulled: shown.filter((r) => r.group === "whop-not-pulled"),
  };
}

/** The hero number: the students to message in the main list as the page shows it, each once. C14's group is outside it. */
export function heroCount(rows: readonly SupportRow[], f: RowFilter): number {
  return visibleRows(rows, f).main.length;
}

/** The chips: how many students in the main list have each headline, under the plan filter and the search. */
export function chipCounts(rows: readonly SupportRow[], f: Pick<RowFilter, "plan" | "search">): Record<ReasonKind, number> {
  const counts = Object.fromEntries(REASON_ORDER.map((k) => [k, 0])) as Record<ReasonKind, number>;
  for (const r of rows) {
    if (r.group !== "main" || !matchesPlanAndSearch(r, f)) continue;
    const kind = r.reasons[0]?.kind;
    if (kind) counts[kind]++;
  }
  return counts;
}
