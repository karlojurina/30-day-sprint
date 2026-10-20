import type { DmToggleKey } from "@/lib/dm-toggles";

/**
 * The admin_config rows the team may change (admin rebuild 2, D6): the 2
 * links the message templates fill in and the 4 switches of the automated
 * Discord posts. PUT /api/admin/config writes these and refuses every other
 * key, so the course switch's date, the old discount window and any row a
 * migration adds later are never changed from the admin.
 *
 * The Settings page, which listed every row as a text field, is gone; the
 * Templates page's Message settings panel edits these 6 through the route.
 */

/** The links the templates fill in: {programLink} and {discordInvite}. An empty Discord link is allowed: it is the live value. */
export const CONFIG_LINK_KEYS = ["program_login_link", "discord_invite_link"] as const;

/**
 * The switches the crons read (src/lib/dm-toggles.ts). Only the exact text
 * "true" turns one on, so a switch takes "true" or "false" and nothing else.
 */
export const CONFIG_SWITCH_KEYS = [
  "dms_master_enabled",
  "day28_dm_enabled",
  "engagement_alerts_enabled",
  "csm_task_summary_enabled",
] as const satisfies readonly DmToggleKey[];

export const EDITABLE_CONFIG_KEYS = [...CONFIG_LINK_KEYS, ...CONFIG_SWITCH_KEYS] as const;

export type EditableConfigKey = (typeof EDITABLE_CONFIG_KEYS)[number];

export function isEditableConfigKey(key: string): key is EditableConfigKey {
  return (EDITABLE_CONFIG_KEYS as readonly string[]).includes(key);
}

/** Null when PUT /api/admin/config may write `value` to `key`, else the sentence of its 400. */
export function configWriteError(key: string, value: unknown): string | null {
  if (!isEditableConfigKey(key)) {
    return "Only the 2 message links and the 4 Discord switches can be changed here.";
  }
  if (typeof value !== "string") return "The new value must be text.";
  if ((CONFIG_SWITCH_KEYS as readonly string[]).includes(key) && value !== "true" && value !== "false") {
    return 'A Discord switch is either "true" or "false".';
  }
  return null;
}
