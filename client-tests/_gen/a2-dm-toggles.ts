/**
 * Read the automated-Discord-send toggles.
 *
 * All toggles live in admin_config (one row per switch, value =
 * "true" / "false" text). The team sets them through PUT
 * /api/admin/config (src/lib/admin/config-keys.ts, admin rebuild 2,
 * D6); the cron routes call isDmEnabled() to short-circuit before
 * sending.
 *
 * Seeded by migration 2026_v40_dm_pause_switches.sql — every
 * switch defaults to "false" so nothing fires until Karlo opts in.
 *
 * readAllDmToggles, the reader of all 4 that the Discord test page used,
 * went in admin rebuild 2's render review fix round: nothing called it once
 * that page was removed. The Templates page's Message settings read the 4
 * with the 2 links (readMessageSettings, src/lib/admin/templates-data.ts).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** Stable keys. Adding a new switch? Update this union + a migration's
 *  INSERT + CONFIG_SWITCH_KEYS in src/lib/admin/config-keys.ts. */
export type DmToggleKey =
  | "dms_master_enabled"
  | "day28_dm_enabled"
  | "engagement_alerts_enabled"
  | "csm_task_summary_enabled";

/**
 * Returns true only when BOTH the master switch and the per-message
 * switch are enabled. Either being false / missing returns false —
 * fail closed so a misconfigured row can never accidentally send.
 * A failed read is false too; a caller that must tell it apart from
 * "off" uses readDmEnabled.
 */
export async function isDmEnabled(
  supabase: SupabaseClient,
  key: Exclude<DmToggleKey, "dms_master_enabled">,
): Promise<boolean> {
  return (await readDmEnabled(supabase, key)).enabled;
}

/**
 * isDmEnabled's answer with the read's error (2026-10-20, cron-1).
 * check-engagement reads it before inserting its alerts and stops on an
 * error: taken as "off", a failed read would insert the alerts unposted,
 * and an open alert is never posted again.
 */
export async function readDmEnabled(
  supabase: SupabaseClient,
  key: Exclude<DmToggleKey, "dms_master_enabled">,
): Promise<{ enabled: boolean; error: string | null }> {
  const { data, error } = await supabase
    .from("admin_config")
    .select("key, value")
    .in("key", ["dms_master_enabled", key]);
  if (error) return { enabled: false, error: error.message };
  const byKey = new Map<string, string>(
    (data ?? []).map((r) => [r.key as string, r.value as string]),
  );
  return {
    enabled:
      byKey.get("dms_master_enabled") === "true" && byKey.get(key) === "true",
    error: null,
  };
}
