
import type { SupabaseClient } from "@supabase/supabase-js";

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
