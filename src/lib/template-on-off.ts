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
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { triggers } from "@/lib/csm-triggers";
import { getCurriculumResetAt } from "@/lib/curriculum-reset";
import type { Template } from "@/types/database";

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
  return { courseIsNew: (await getCurriculumResetAt(supabase)) != null };
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
    turnOnWaits: turnOnWaits(dirty),
  };
}

/** Why Turn on waits for a template that is off, or null when it can go on. */
function turnOnWaits(dirty: boolean): string | null {
  // Turning a template on waits for its unsaved changes, so it never goes
  // live on the conditions being replaced.
  if (dirty) return "Save your changes first, then turn it on.";
  return null;
}

function unread(live: LiveRead): string {
  return live.error ?? "it has not been read yet";
}
