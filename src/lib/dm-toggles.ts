/**
 * Read + write the automated-Discord-send toggles.
 *
 * All toggles live in admin_config (one row per switch, value =
 * "true" / "false" text). UI flips them at /admin/discord; the
 * cron routes call isDmEnabled() to short-circuit before sending.
 *
 * Seeded by migration 2026_v40_dm_pause_switches.sql — every
 * switch defaults to "false" so nothing fires until Karlo opts in.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** Stable keys. Adding a new switch? Update this union + the v40
 *  migration's INSERT + the /admin/discord settings UI. */
export type DmToggleKey =
  | "dms_master_enabled"
  | "day28_dm_enabled"
  | "engagement_alerts_enabled"
  | "csm_task_summary_enabled";

const ALL_KEYS: DmToggleKey[] = [
  "dms_master_enabled",
  "day28_dm_enabled",
  "engagement_alerts_enabled",
  "csm_task_summary_enabled",
];

/**
 * Returns true only when BOTH the master switch and the per-message
 * switch are enabled. Either being false / missing returns false —
 * fail closed so a misconfigured row can never accidentally send.
 */
export async function isDmEnabled(
  supabase: SupabaseClient,
  key: Exclude<DmToggleKey, "dms_master_enabled">,
): Promise<boolean> {
  const { data } = await supabase
    .from("admin_config")
    .select("key, value")
    .in("key", ["dms_master_enabled", key]);
  const byKey = new Map<string, string>(
    (data ?? []).map((r) => [r.key as string, r.value as string]),
  );
  return (
    byKey.get("dms_master_enabled") === "true" && byKey.get(key) === "true"
  );
}

/** Loads every switch's current value. Used by the settings UI. */
export async function readAllDmToggles(
  supabase: SupabaseClient,
): Promise<Record<DmToggleKey, boolean>> {
  const { data } = await supabase
    .from("admin_config")
    .select("key, value")
    .in("key", ALL_KEYS);
  const byKey = new Map<string, string>(
    (data ?? []).map((r) => [r.key as string, r.value as string]),
  );
  const out: Partial<Record<DmToggleKey, boolean>> = {};
  for (const k of ALL_KEYS) out[k] = byKey.get(k) === "true";
  return out as Record<DmToggleKey, boolean>;
}

/** Writes a single toggle. UI is the only caller. */
export async function writeDmToggle(
  supabase: SupabaseClient,
  key: DmToggleKey,
  value: boolean,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from("admin_config")
    .update({ value: value ? "true" : "false" })
    .eq("key", key);
  return { error: error?.message ?? null };
}
