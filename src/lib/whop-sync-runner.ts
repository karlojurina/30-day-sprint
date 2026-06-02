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
    const userIds = members.map((m) => m.user).filter(Boolean) as string[];
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

    // Build the full set of upsert rows in one pass (no DB calls
    // here — just computation). v75.14.5 batches the writes to
    // avoid 2,766 sequential round-trips that blow Vercel's 60s
    // function timeout.
    const upsertRows: Record<string, unknown>[] = [];

    for (const m of members) {
      if (!m.user) {
        result.skipped++;
        continue;
      }
      const cur = existing.get(m.user);
      const joinedAt = toIso(m.created_at) ?? new Date().toISOString();
      const status = mapStatus(m);
      const discordId = m.discord?.id ?? m.discord_user_id ?? null;
      const discordUsername = m.discord?.username ?? null;
      // Whop's v2 memberships response has no top-level username/name
      // field — the user is just an ID string. The student's display
      // name comes from the OAuth callback (userInfo.name on first
      // login), not from the sync. Preserve cur.name if it exists.
      const name = cur?.name ?? null;
      const email = m.email ?? cur?.email ?? null;
      const planId = m.plan ?? null;

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

      // canceled_at handling. Three sources, in priority order:
      //   1. Real-time transition observed: stamp now() (most accurate)
      //   2. Whop's renewal_period_end / expires_at IF in the past —
      //      a reasonable proxy for "when their access actually ended"
      //   3. NULL — we don't know when they canceled; better to
      //      omit than to lie
      //
      // v75.16.1 fix: previous code took renewal_period_end at face
      // value, which is a FUTURE date for canceled members whose paid
      // cycle hasn't ended yet on Whop's calendar. That created 165
      // rows with future canceled_at values, polluting the churn
      // chart with "people who will churn next month" — semantically
      // wrong. pastProxyOrNull rejects future dates and returns null
      // so they don't contribute to any day's churn count.
      const whopEndIso = pastProxyOrNull(
        toIso(m.renewal_period_end ?? m.expires_at),
      );
      const wasTerminal = cur
        ? TERMINAL_STATUSES.has((cur.membership_status ?? "").toLowerCase())
        : false;
      const isTerminal = TERMINAL_STATUSES.has(status);
      let canceledAtUpdate: string | null | undefined;
      if (cur) {
        if (!wasTerminal && isTerminal) {
          // Genuine transition observed this sync — stamp now()
          // (real-time event, most accurate).
          canceledAtUpdate = new Date().toISOString();
        } else if (wasTerminal && !isTerminal) {
          // Re-activation — clear the stamp.
          canceledAtUpdate = null;
        } else if (
          wasTerminal &&
          isTerminal &&
          !cur.canceled_at &&
          whopEndIso
        ) {
          // Existing terminal row with no historical date AND Whop
          // gave us a useful proxy — fill it in. Lets us recover
          // historical churn dates without a hard backfill.
          canceledAtUpdate = whopEndIso;
        } else {
          canceledAtUpdate = undefined; // don't touch
        }
      } else {
        // Inserting fresh: use Whop's end-of-cycle proxy if terminal,
        // else null. NEVER stamp now() on insert — we don't know
        // when this member actually canceled.
        canceledAtUpdate = isTerminal ? (whopEndIso ?? null) : null;
      }

      const row: Record<string, unknown> = {
        whop_user_id: m.user,
        whop_membership_id: m.id,
        membership_status: status,
        email,
        name,
      };

      // INSERT-only fields (don't overwrite local values on existing rows)
      if (!cur) {
        row.joined_at = joinedAt;
        row.last_active_at = joinedAt;
      }

      // Conditional fields — only include when we have a fresh value
      // we want to persist.
      if (!cur || (!cur.discord_user_id && discordId)) {
        if (discordId) row.discord_user_id = discordId;
      }
      if (discordUsername) row.discord_username = discordUsername;
      if (canceledAtUpdate !== undefined) row.canceled_at = canceledAtUpdate;
      // Refresh plan_id when Whop returns one. Preserve last-known
      // when Whop didn't send it (don't include the key at all).
      if (planId) row.whop_plan_id = planId;
      else if (!cur) row.whop_plan_id = null; // explicit null on insert

      upsertRows.push(row);
      if (cur) result.updated++;
      else result.inserted++;
    }

    // Batch-upsert in chunks of 500 (Supabase REST handles up to 1000
    // per request; 500 is a safe middle that keeps each request fast).
    const BATCH_SIZE = 500;
    for (let i = 0; i < upsertRows.length; i += BATCH_SIZE) {
      const batch = upsertRows.slice(i, i + BATCH_SIZE);
      const { error } = await supabase
        .from("students")
        .upsert(batch, { onConflict: "whop_user_id" });
      if (error) {
        console.error(
          `[whop-sync] batch upsert ${i / BATCH_SIZE + 1} failed:`,
          error.message,
        );
        result.errors += batch.length;
        // Don't credit the inserted/updated counters for failed
        // batches. Decrement by the chunk size.
        result.inserted = Math.max(0, result.inserted - batch.length);
        result.updated = Math.max(0, result.updated);
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

/**
 * Returns the ISO string ONLY if it represents a past timestamp.
 * Returns null for future timestamps, null inputs, or unparseable
 * inputs. Used to filter Whop's `renewal_period_end` (which is a
 * future date for members still inside their paid cycle) before
 * stamping it as `canceled_at` — a member's cancellation date
 * cannot be in the future.
 */
function pastProxyOrNull(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (isNaN(t)) return null;
  return t <= Date.now() ? iso : null;
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
