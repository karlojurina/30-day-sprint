
import type { SupabaseClient } from "@supabase/supabase-js";

export type DmToggleKey =
  | "dms_master_enabled"
  | "day28_dm_enabled"
  | "engagement_alerts_enabled"
  | "csm_task_summary_enabled";

export async function isDmEnabled(
  supabase: SupabaseClient,
  key: Exclude<DmToggleKey, "dms_master_enabled">,
): Promise<boolean> {
  return (await readDmEnabled(supabase, key)).enabled;
}

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
