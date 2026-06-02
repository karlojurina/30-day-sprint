/**
 * Whop community sync — shared implementation used by both the
 * /api/admin/sync-whop button and the /api/cron/sync-whop daily cron.
 *
 * Behavior:
 *   - Imported members not in our DB get a row with supabase_user_id = null.
 *     The OAuth callback later fills supabase_user_id when the student
 *     logs into our platform for the first time.
 *   - Existing students get their membership_status + email + name
 *     refreshed from Whop. We don't overwrite our locally-set
 *     last_active_at / joined_at if they're already set.
 *   - Tracks the canceled_at transition: when a row transitions INTO
 *     canceled/expired we stamp canceled_at = now(); when a row
 *     transitions OUT (re-activation) we clear it. This is what the
 *     snapshot cron's churned_count reads, so it has to be accurate.
 *   - Writes one row into sync_runs at the end (success or failure)
 *     so we can audit cron runs from a DB query.
 *
 * Reports a summary (inserted / updated / skipped) for the UI.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchAllMemberships,
  mapStatus,
  toIso,
} from "@/lib/whop-members";
import { PAYING_WHOP_PLAN_IDS } from "@/lib/constants";

export interface SyncResult {
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
  /** Whop membership_status -> count, for debugging. */
  status_breakdown: Record<string, number>;
  errors: number;
}

export type SyncSource = "cron" | "admin-button";

export async function runWhopCommunitySync(
  supabase: SupabaseClient,
  source: SyncSource = "admin-button",
): Promise<SyncResult> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const result: SyncResult = {
    fetched: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    status_breakdown: {},
    errors: 0,
  };

  let errorMessage: string | null = null;

  try {
    const members = await fetchAllMemberships();
    result.fetched = members.length;
    if (members.length === 0) {
      await logSyncRun(supabase, source, startedAt, t0, "success", result);
      return result;
    }

    // Tally status before write so failed writes don't skew the breakdown.
    for (const m of members) {
      const s = mapStatus(m);
      result.status_breakdown[s] = (result.status_breakdown[s] ?? 0) + 1;
    }

    // Pull existing rows in one query to decide insert-vs-update + to
    // preserve fields we don't want to overwrite + to detect
    // status transitions for canceled_at stamping.
    const userIds = members.map((m) => m.user_id).filter(Boolean) as string[];
    type ExistingRow = {
      whop_user_id: string;
      email: string | null;
      name: string | null;
      joined_at: string | null;
      last_active_at: string | null;
      discord_user_id: string | null;
      membership_status: string | null;
      canceled_at: string | null;
      whop_plan_id: string | null;
    };
    const { data: existingRows } = await supabase
      .from("students")
      .select("whop_user_id, email, name, joined_at, last_active_at, discord_user_id, membership_status, canceled_at, whop_plan_id")
      .in("whop_user_id", userIds)
      .returns<ExistingRow[]>();
    const existing = new Map(
      (existingRows ?? []).map((r) => [r.whop_user_id, r]),
    );

    const TERMINAL_STATUSES = new Set(["canceled", "expired"]);
    // Track unique unknown plan IDs so we don't spam the log. One
    // warning per plan_id per sync run is enough — Karlo can grep
    // Vercel logs for the marker if he adds a new paid plan and
    // forgets to update PAYING_WHOP_PLAN_IDS.
    const unknownPlanWarnings = new Set<string>();

    for (const m of members) {
      if (!m.user_id) {
        result.skipped++;
        continue;
      }
      const cur = existing.get(m.user_id);
      const joinedAt = toIso(m.created_at) ?? new Date().toISOString();
      const status = mapStatus(m);
      const discordId = m.discord?.id ?? m.discord_user_id ?? null;
      const discordUsername = m.discord?.username ?? null;
      const name = m.username ?? cur?.name ?? null;
      const email = m.email ?? cur?.email ?? null;
      const planId = m.plan_id ?? null;

      // Surface unknown plan IDs so we notice if a new paid plan
      // gets added in Whop without an allowlist update. Only warn
      // for ACTIVE memberships — canceled/expired members on
      // unknown plans don't matter operationally.
      if (
        planId &&
        !PAYING_WHOP_PLAN_IDS.has(planId) &&
        !unknownPlanWarnings.has(planId) &&
        (status === "active" || status === "past_due")
      ) {
        unknownPlanWarnings.add(planId);
        console.warn(
          `[whop-sync] UNKNOWN_PLAN_ID '${planId}' seen on active member — ` +
            `currently treated as non-paying (no CSM tasks, no day-28 DM, ` +
            `not counted in dashboard). If this is a new PAID plan, add it ` +
            `to PAYING_WHOP_PLAN_IDS in src/lib/constants.ts AND to the ` +
            `v_paying_plans array in rebuild_daily_snapshots() RPC.`,
        );
      }

      if (cur) {
        // Detect status transition for canceled_at stamping. Three cases:
        //   - was non-terminal, now terminal → stamp canceled_at = now()
        //   - was terminal, now non-terminal → clear canceled_at (re-active)
        //   - same bucket → leave canceled_at alone
        const wasTerminal = TERMINAL_STATUSES.has(
          (cur.membership_status ?? "").toLowerCase(),
        );
        const isTerminal = TERMINAL_STATUSES.has(status);
        let canceledAtUpdate: string | null | undefined = undefined; // undefined = don't touch
        if (!wasTerminal && isTerminal) {
          canceledAtUpdate = new Date().toISOString();
        } else if (wasTerminal && !isTerminal) {
          canceledAtUpdate = null;
        }

        const update: Record<string, unknown> = {
          whop_membership_id: m.id,
          membership_status: status,
          email,
          name,
        };
        if (!cur.discord_user_id && discordId) update.discord_user_id = discordId;
        if (discordUsername) update.discord_username = discordUsername;
        if (canceledAtUpdate !== undefined) update.canceled_at = canceledAtUpdate;
        // Refresh whop_plan_id when Whop returns one. Don't overwrite
        // an existing plan_id with null (preserve last-known on rows
        // where Whop didn't return the field this sync).
        if (planId) update.whop_plan_id = planId;

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
        // canceled_at = now() if we're inserting an already-terminal
        // member (rare — usually means we missed their original
        // activation webhook and they've since canceled).
        const isTerminal = TERMINAL_STATUSES.has(status);
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
          canceled_at: isTerminal ? new Date().toISOString() : null,
          whop_plan_id: planId,
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

    await logSyncRun(supabase, source, startedAt, t0, "success", result);
    return result;
  } catch (e) {
    errorMessage = e instanceof Error ? e.message : String(e);
    console.error("[whop-sync] threw:", errorMessage);
    await logSyncRun(
      supabase,
      source,
      startedAt,
      t0,
      "failed",
      result,
      errorMessage,
    );
    throw e;
  }
}

async function logSyncRun(
  supabase: SupabaseClient,
  source: SyncSource,
  startedAt: string,
  t0: number,
  status: "success" | "failed",
  result: SyncResult,
  errorMessage?: string | null,
): Promise<void> {
  try {
    await supabase.from("sync_runs").insert({
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      source,
      status,
      fetched: result.fetched,
      inserted: result.inserted,
      updated: result.updated,
      skipped: result.skipped,
      errors: result.errors,
      error_message: errorMessage ?? null,
      duration_ms: Date.now() - t0,
    });
  } catch (e) {
    // Audit-log failures must NEVER kill the sync. Just log them.
    console.error(
      "[whop-sync] sync_runs insert failed:",
      e instanceof Error ? e.message : String(e),
    );
  }
}
