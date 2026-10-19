/**
 * The on/off switch on /admin/templates (templates.is_active): where the page
 * shows it, and the line it shows instead where the switch would not work.
 *
 * Four places make a template's tasks, and only the first two read the switch:
 *   - check-csm-tasks, step 2b: a template's own conditions (trigger_config),
 *     only while the template is on;
 *   - check-na-tasks: stalled.discord.dayN and stalled.whop.dayN, only while
 *     the template is on;
 *   - check-csm-tasks, steps 1 and 2a: the built-in rules of csm-triggers.ts
 *     (`triggers`) and the alerts mapped to them. They find the template by
 *     its scenario, on or off, and a built-in that has conditions and is off
 *     goes back to its built-in rule;
 *   - csm-events.ts: W2.2, W2.6 and X.1, on a student's action, also by
 *     scenario alone. v57 deleted all three and the page cannot make them
 *     again, but a row put back by hand would be read.
 * So the page shows the switch for every template except those of the last
 * two kinds, and says instead, in one line, that its tasks are made whether
 * it is on or off. On the new course the built-in rules noship.* and pace.*
 * never fire and no alert maps to them (cutover C5): they make no task of
 * their own there, and their switch works, turning their conditions on and
 * off.
 *
 * Making the crons read the switch for the built-ins would change which tasks
 * are made, so it is a change of its own.
 *
 * Turn on also waits while the template's saved conditions read something the
 * live course does not have: a lesson or an area it does not have (an action
 * item, for "shipped"), or, once the course is new, one of the three metrics
 * that measure pace on the old 30-day plan. These are the conditions v104
 * turned templates off for, held against the live course, so a template
 * rewritten for it can go back on. On the new course "is not shipped" or "is
 * not complete" on an old lesson or area is true for every student, so such
 * a template would make a task for each of them, and the cron's auto-dismiss
 * keeps reading its conditions after it is turned off again, so those tasks
 * would stay open.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { triggers } from "./csm-triggers.ts";
import { getCurriculumResetAt } from "./curriculum-reset.ts";
import type { Condition, Template, TriggerConfig } from "./types-erased.ts";

/** The scenarios csm-events.ts makes tasks for, finding the template by scenario alone. */
export const EVENT_HOOK_SCENARIOS: ReadonlySet<string> = new Set([
  "W2.2",
  "W2.6",
  "X.1",
]);

/**
 * The built-in rules that stop on the new course: each returns null once
 * courseIsNew, and no alert maps to them there. The client test runs every
 * rule and every alert on both courses to hold this list to the code.
 */
export const OLD_COURSE_ONLY_RULES: ReadonlySet<string> = new Set([
  "noship.r1.day7",
  "noship.r2.day14",
  "pace.day7",
  "pace.day14",
  "pace.day21",
]);

/** The scenario of every built-in rule. */
const BUILT_IN_RULES: ReadonlySet<string> = new Set(Object.keys(triggers));

/** The live course, as the switch needs it. */
export interface LiveCourse {
  /** True once admin_config.curriculum_reset_at exists. */
  courseIsNew: boolean;
  /** Every area id in `regions`. */
  regions: ReadonlySet<string>;
  /** Every lesson id in `lessons`. */
  lessons: ReadonlySet<string>;
  /** The lessons with an action item (requires_action). */
  actionLessons: ReadonlySet<string>;
}

/** The page's read of the live course: the course, or why it could not be read. */
export interface LiveRead {
  course: LiveCourse | null;
  error: string | null;
}

/** Reads the live course with the team member's client. Throws when it cannot. */
export async function readLiveCourse(
  supabase: SupabaseClient,
): Promise<LiveCourse> {
  const [resetAt, regionsRes, lessonsRes] = await Promise.all([
    getCurriculumResetAt(supabase),
    supabase.from("regions").select("id"),
    supabase.from("lessons").select("id, requires_action"),
  ]);
  if (regionsRes.error) {
    throw new Error(`the areas could not be read: ${regionsRes.error.message}`);
  }
  if (lessonsRes.error) {
    throw new Error(`the lessons could not be read: ${lessonsRes.error.message}`);
  }
  const regions = (regionsRes.data ?? []) as Array<{ id: string }>;
  const lessons = (lessonsRes.data ?? []) as Array<{
    id: string;
    requires_action: boolean;
  }>;
  // An empty read would call every lesson and area "not in the course".
  if (regions.length === 0 || lessons.length === 0) {
    throw new Error("the areas or the lessons came back empty");
  }
  return {
    courseIsNew: resetAt != null,
    regions: new Set(regions.map((r) => r.id)),
    lessons: new Set(lessons.map((l) => l.id)),
    actionLessons: new Set(
      lessons.filter((l) => l.requires_action).map((l) => l.id),
    ),
  };
}

/** The metrics that measure pace on the old course's 30-day plan; on the new course they never match. */
const CLOCK_METRICS: ReadonlySet<string> = new Set([
  "progress_ratio",
  "progress_label",
  "region_pace",
]);

function conditionsOf(config: TriggerConfig | null): Condition[] {
  const all = config?.all;
  return Array.isArray(all) ? all : [];
}

/** A condition that names a lesson or an area, or measures the old 30-day pace: v104's test. */
function readsCourse(c: Condition): boolean {
  return "lesson_id" in c || "region" in c || CLOCK_METRICS.has(c.metric);
}

/**
 * The conditions of `config` that the live course cannot answer: a lesson or
 * an area it does not have (for "shipped", a lesson with an action item), or
 * a clock metric once the course is new.
 */
export function offCourseConditions(
  config: TriggerConfig | null,
  course: LiveCourse,
): Condition[] {
  return conditionsOf(config).filter(
    (c) =>
      (CLOCK_METRICS.has(c.metric) && course.courseIsNew) ||
      ("region" in c && !course.regions.has(c.region)) ||
      ("lesson_id" in c &&
        !(c.metric === "lesson_shipped"
          ? course.actionLessons
          : course.lessons
        ).has(c.lesson_id)),
  );
}

/** What a template's row shows about on and off. */
export type OnOffView =
  /** No switch: one line on what makes its tasks whatever the switch says. */
  | { kind: "none"; line: string }
  /** The switch, and why Turn on waits (null when it does not). */
  | { kind: "switch"; on: boolean; line: string; turnOnWaits: string | null };

export const TASK_CHECK_LINE =
  "The task check that runs every 2 hours makes this template's tasks whether it is on or off, so it has no on/off switch here.";
export const STUDENT_ACTION_LINE =
  "A student's action makes this template's tasks whether it is on or off, so it has no on/off switch here.";

/**
 * The switch of template `t`, from the page's read of the live course and
 * whether the row has unsaved changes.
 */
export function onOffView(
  t: Pick<Template, "scenario_id" | "is_active" | "trigger_config">,
  live: LiveRead,
  dirty: boolean,
): OnOffView {
  if (EVENT_HOOK_SCENARIOS.has(t.scenario_id)) {
    return { kind: "none", line: STUDENT_ACTION_LINE };
  }
  if (BUILT_IN_RULES.has(t.scenario_id)) {
    if (!OLD_COURSE_ONLY_RULES.has(t.scenario_id)) {
      return { kind: "none", line: TASK_CHECK_LINE };
    }
    if (!live.course) {
      return {
        kind: "none",
        line: `This template's on/off switch is hidden because the course could not be read (${unread(live)}).`,
      };
    }
    if (!live.course.courseIsNew) return { kind: "none", line: TASK_CHECK_LINE };
  }
  if (t.is_active) {
    return { kind: "switch", on: true, line: "This template is on.", turnOnWaits: null };
  }
  return {
    kind: "switch",
    on: false,
    line: "This template is off.",
    turnOnWaits: turnOnWaits(t, live, dirty),
  };
}

/** Why Turn on waits for a template that is off, or null when it can go on. */
function turnOnWaits(
  t: Pick<Template, "trigger_config">,
  live: LiveRead,
  dirty: boolean,
): string | null {
  // Turning a template on waits for its unsaved changes, so it never goes
  // live on the conditions being replaced.
  if (dirty) return "Save your changes first, then turn it on.";
  // Nor on saved conditions that read a course that is not live.
  if (!conditionsOf(t.trigger_config).some(readsCourse)) return null;
  if (!live.course) {
    return `The course could not be read, so this template cannot be turned on yet (${unread(live)}).`;
  }
  const off = offCourseConditions(t.trigger_config, live.course);
  if (off.length === 0) return null;
  const { lessons, courseIsNew } = live.course;
  // "Shipped" on a lesson the course has, but with no action item, is never true.
  if (
    off.every(
      (c) =>
        "lesson_id" in c &&
        c.metric === "lesson_shipped" &&
        lessons.has(c.lesson_id),
    )
  ) {
    return "This template asks whether a lesson with no action item was shipped, which is never true. Rewrite it, save, then turn it on.";
  }
  return courseIsNew
    ? "This template's conditions still name the old course. Rewrite them, save, then turn it on."
    : "This template's conditions name a lesson or area that is not in the course. Rewrite them, save, then turn it on.";
}

function unread(live: LiveRead): string {
  return live.error ?? "it has not been read yet";
}
