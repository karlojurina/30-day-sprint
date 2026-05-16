/**
 * Whop community sync — shared implementation used by both the
 * /api/admin/sync-whop button and the /api/cron/sync-whop daily cron.
 *
 * Behavior per Karlo (2026-05-17):
 *   - Imported members not in our DB get a row with supabase_user_id = null.
 *     The OAuth callback later fills supabase_user_id when the student
 *     logs into our platform for the first time.
 *   - Existing students get their membership_status + email + name
 *     refreshed from Whop. We don't overwrite our locally-set
 *     last_active_at / joined_at if they're already set.
 *   - Reports a summary (inserted / updated / skipped) so we can show
 *     it in the UI.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchAllMemberships,
  mapStatus,
  toIso,
  type WhopMembershipRow,
} from "@/lib/whop-members";

export interface SyncResult {
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
  /** Whop membership_status -> count, for debugging. */
  status_breakdown: Record<string, number>;
  errors: number;
}

export async function runWhopCommunitySync(
  supabase: SupabaseClient,
): Promise<SyncResult> {
  const result: SyncResult = {
    fetched: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    status_breakdown: {},
    errors: 0,
  };

  const members = await fetchAllMemberships();
  result.fetched = members.length;
  if (members.length === 0) return result;

  // Tally status before write so failed writes don't skew the breakdown.
  for (const m of members) {
    const s = mapStatus(m);
    result.status_breakdown[s] = (result.status_breakdown[s] ?? 0) + 1;
  }

  // Pull existing rows in one query to decide insert-vs-update + to
  // preserve fields we don't want to overwrite.
  const userIds = members.map((m) => m.user_id).filter(Boolean) as string[];
  const { data: existingRows } = await supabase
    .from("students")
    .select("whop_user_id, email, name, joined_at, last_active_at, discord_user_id")
    .in("whop_user_id", userIds);
  const existing = new Map(
    (existingRows ?? []).map((r) => [r.whop_user_id as string, r]),
  );

  for (const m of members) {
    if (!m.user_id) {
      result.skipped++;
      continue;
    }
    const cur = existing.get(m.user_id);
    const joinedAt = toIso(m.created_at) ?? new Date().toISOString();
    const status = mapStatus(m);
    const discordId =
      m.discord?.id ?? m.discord_user_id ?? null;
    const discordUsername = m.discord?.username ?? null;
    const name = m.username ?? cur?.name ?? null;
    const email = m.email ?? cur?.email ?? null;

    if (cur) {
      // Update existing row. Preserve our locally-set joined_at +
      // last_active_at (don't overwrite — they were set by OAuth or
      // user activity).
      const update: Record<string, unknown> = {
        whop_membership_id: m.id,
        membership_status: status,
        email,
        name,
      };
      if (!cur.discord_user_id && discordId) update.discord_user_id = discordId;
      if (discordUsername) update.discord_username = discordUsername;
      const { error } = await supabase
        .from("students")
        .update(update)
        .eq("whop_user_id", m.user_id);
      if (error) {
        console.error(
          `[whop-sync] update failed for ${m.user_id}:`,
          error.message,
        );
        result.errors++;
      } else {
        result.updated++;
      }
    } else {
      // Insert. supabase_user_id stays null until OAuth fills it.
      const { error } = await supabase.from("students").insert({
        whop_user_id: m.user_id,
        whop_membership_id: m.id,
        membership_status: status,
        email,
        name,
        joined_at: joinedAt,
        last_active_at: joinedAt,
        discord_user_id: discordId,
        discord_username: discordUsername,
      });
      if (error) {
        console.error(
          `[whop-sync] insert failed for ${m.user_id}:`,
          error.message,
        );
        result.errors++;
      } else {
        result.inserted++;
      }
    }
  }

  return result;
}
