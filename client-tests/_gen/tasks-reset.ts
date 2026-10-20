/**
 * The tasks reset (admin rebuild 2, D7; migration 2026_v109), as the admin
 * reads it.
 *
 * v109 writes admin_config['tasks_reset_at'] in the transaction that copies
 * every open task into archive_tasks.reset_2026_10 and dismisses it; its undo
 * deletes the row. No row: the reset has not run, and every task is listed as
 * before. A row: the Tasks page, its insights and the Dashboard count only
 * the tasks created on or after it, and the Tasks page shows the older ones
 * on its Archived tab, read only.
 *
 *   TASKS_RESET_KEY    the admin_config key
 *   getTasksResetAt    reads it; throws on a failed read or a value that is not a date
 *   readTasksConfig    the reset and the two links a DM may print, in one read
 *   checkTasksResetAt  the value as written, or a throw
 *   isAfterTasksReset  a task's created_at is on or after the reset (no reset: always)
 *
 * No React, no Next. The routes hand it their own client.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export const TASKS_RESET_KEY = "tasks_reset_at";

/** The two links a DM template may print ({programLink}, {discordInvite}). */
export const DM_LINK_KEYS = ["program_login_link", "discord_invite_link"] as const;

export type DmLinks = Record<(typeof DM_LINK_KEYS)[number], string>;

/**
 * A date and time with its zone, as v109 writes it (2026-10-20T21:30:00.000Z).
 * A time with no zone is refused: a server reads it as UTC and a browser as
 * local time, and the two would draw the line at different moments.
 */
const RESET_FORMAT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** The value as v109 wrote it, or a throw: a broken row would hide or show the wrong tasks. */
export function checkTasksResetAt(value: string): string {
  if (!RESET_FORMAT.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(
      `admin_config.${TASKS_RESET_KEY} holds ${JSON.stringify(value)}, which is not a date and time with its zone ` +
        `(like 2026-10-20T21:30:00.000Z). Fix the row; the Tasks page cannot tell new tasks from old ones until then.`,
    );
  }
  return value;
}

/**
 * When the tasks were reset, or null before v109 ran.
 *
 * Throws on a failed read, never answers null for one: null means "list
 * every task", and a failed read that said so would put the old queue back
 * on the page as if it were new.
 */
export async function getTasksResetAt(supabase: SupabaseClient): Promise<string | null> {
  const { data, error } = await supabase
    .from("admin_config")
    .select("value")
    .eq("key", TASKS_RESET_KEY)
    .maybeSingle();
  if (error) {
    throw new Error(`Couldn't read when the tasks were reset (admin_config.${TASKS_RESET_KEY}): ${error.message}`);
  }
  if (!data) return null;
  return checkTasksResetAt((data as { value: string }).value);
}

/**
 * The reset and the two links, in one read, for the Tasks page: the reset
 * draws the line between the lists and the Archived tab, the links go into
 * the DMs it copies. A link that is not set is "" (renderTemplate then
 * leaves its placeholder in the DM and names it). Throws as getTasksResetAt.
 */
export async function readTasksConfig(
  supabase: SupabaseClient,
): Promise<{ resetAt: string | null; links: DmLinks }> {
  const { data, error } = await supabase
    .from("admin_config")
    .select("key, value")
    .in("key", [TASKS_RESET_KEY, ...DM_LINK_KEYS]);
  if (error) {
    throw new Error(`Couldn't read when the tasks were reset (admin_config.${TASKS_RESET_KEY}): ${error.message}`);
  }
  const value = new Map(((data ?? []) as Array<{ key: string; value: string | null }>).map((r) => [r.key, r.value]));
  const reset = value.get(TASKS_RESET_KEY);
  return {
    resetAt: reset == null ? null : checkTasksResetAt(reset),
    links: {
      program_login_link: value.get("program_login_link") ?? "",
      discord_invite_link: value.get("discord_invite_link") ?? "",
    },
  };
}

/** Is a task on the lists (created on or after the reset), or on the Archived tab? With no reset, every task is on the lists. */
export function isAfterTasksReset(createdAt: string, resetAt: string | null): boolean {
  if (resetAt == null) return true;
  return Date.parse(createdAt) >= Date.parse(resetAt);
}
