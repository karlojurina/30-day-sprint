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
  fetchEarliestMembershipDateForUser,
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
  /** v75.53: active paying rows whose NULL first_paid_at this run
   *  recovered via the cross-product lookup (the leak fix). */
  first_paid_recovered: number;
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
    first_paid_recovered: 0,
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
      first_paid_at: string | null;
      // v75.46: track per-user so we don't re-stamp on every sync
      // (preserve the ORIGINAL cancel-click timestamp).
      cancel_scheduled_at: string | null;
    };
    // v75.16.3 — batch the .in() filter. PostgREST's URL-length cap
    // silently truncates .in() at ~1000 items, which meant existing
    // rows for ~1300 of our 2300 Whop members weren't being returned.
    // Those members looked "new" to the loop, so transition detection
    // (was active last sync, now canceled) never fired for them and
    // canceled_at stayed null. Symptom: dashboard showed 0 churned
    // even when real cancellations happened.
    const EXISTING_FETCH_BATCH = 500;
    const existingRows: ExistingRow[] = [];
    for (let i = 0; i < userIds.length; i += EXISTING_FETCH_BATCH) {
      const chunk = userIds.slice(i, i + EXISTING_FETCH_BATCH);
      const { data, error } = await supabase
        .from("students")
        .select(
          "whop_user_id, email, name, joined_at, last_active_at, discord_user_id, membership_status, canceled_at, whop_plan_id, first_paid_at, cancel_scheduled_at",
        )
        .in("whop_user_id", chunk)
        .returns<ExistingRow[]>();
      // v75.32: surface batch errors. Previously a silent failure on
      // a batch meant those user_ids were missing from `existing`,
      // got treated as new on the next iteration, and transition
      // detection (active → canceled) didn't fire for them →
      // canceled_at stayed NULL → churn count under-reported.
      if (error) {
        console.error(
          `[whop-sync] existing-row fetch failed for batch ${i}-${i + chunk.length}: ${error.message}`,
        );
        throw new Error(
          `Existing-row pre-fetch failed at batch ${i}: ${error.message}. Aborting sync so we don't write stale state.`,
        );
      }
      if (data) existingRows.push(...data);
    }
    const existing = new Map(
      existingRows.map((r) => [r.whop_user_id, r]),
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

    // v75.53: active paying students whose first_paid_at would be left
    // NULL this run (the product-scoped fetch can't see their
    // membership). Recovered after the upsert via a bounded
    // cross-product lookup — see the recovery pass below.
    const recoveryCandidates: Array<{ whopUserId: string; joinedAt: string }> =
      [];

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

      // canceled_at handling. Three sources by priority:
      //   1. Genuine transition observed this sync (was active last
      //      time, now terminal) → stamp now() (real-time event)
      //   2. Webhook fires on deactivation → stamps now() at webhook
      //      time (most accurate, handled in src/app/api/webhooks/whop/)
      //   3. Historical backfill: existing terminal row with no
      //      canceled_at AND Whop's renewal_period_end is in the past →
      //      stamp that (approximate "when access ended" — off by up
      //      to 30 days from actual decision but it's all we have)
      //
      // Future-dated renewal_period_end is ALWAYS rejected via
      // pastProxyOrNull (a canceled_at can't be in the future).
      //
      // v75.16.4 — restored the past-only backfill that v75.16.2
      // had removed. Karlo wants past churn data; the cycle-end
      // approximation is the only practical option since Whop's API
      // doesn't expose the actual cancellation decision timestamp.
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
          // Genuine transition observed this sync — stamp now().
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
          // Backfill: historical terminal row with no canceled_at and
          // Whop gave us a past cycle-end date. Approximate but useful.
          canceledAtUpdate = whopEndIso;
        } else {
          canceledAtUpdate = undefined; // same bucket with date — don't touch
        }
      } else {
        // Inserting fresh: use cycle-end approximation if terminal,
        // else null. Future cycle-end → null (don't stamp future).
        canceledAtUpdate = isTerminal ? whopEndIso : null;
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

      // v75.46: cancel_scheduled_at — Whop's "Canceling" state.
      // When status is active/past_due AND Whop reports
      // cancel_at_period_end=true, the student clicked cancel but
      // still has access through the end of the cycle. This is the
      // earliest churn signal we have.
      //
      // Rules:
      //   * Existing row + currently "Canceling" + no prior stamp →
      //     stamp now() (preserves the cancel-click moment)
      //   * Existing row + currently "Canceling" + already stamped →
      //     don't re-stamp (preserve original timestamp)
      //   * Existing row + NOT "Canceling" (re-activated OR went
      //     terminal) → clear to null
      //   * New row + "Canceling" at insert time → stamp now()
      //   * New row + not Canceling → null
      //
      // Don't stamp when isTerminal=true: canceled_at takes over.
      const isCancelingNow =
        !isTerminal && m.cancel_at_period_end === true;
      let cancelScheduledAtUpdate: string | null | undefined;
      if (cur) {
        if (isCancelingNow && !cur.cancel_scheduled_at) {
          cancelScheduledAtUpdate = new Date().toISOString();
        } else if (!isCancelingNow && cur.cancel_scheduled_at) {
          cancelScheduledAtUpdate = null;
        } else {
          cancelScheduledAtUpdate = undefined; // no change
        }
      } else {
        cancelScheduledAtUpdate = isCancelingNow
          ? new Date().toISOString()
          : null;
      }
      if (cancelScheduledAtUpdate !== undefined)
        row.cancel_scheduled_at = cancelScheduledAtUpdate;
      // Refresh plan_id when Whop returns one. Preserve last-known
      // when Whop didn't send it (don't include the key at all).
      if (planId) row.whop_plan_id = planId;
      else if (!cur) row.whop_plan_id = null; // explicit null on insert

      // first_paid_at (v75.18): the earliest membership.created_at
      // across ALL of this user's memberships. Computed by
      // fetchAllMemberships and attached as m._firstPaidAt.
      //
      // - INSERT: set whatever we computed (could be null if Whop's
      //   dates were unparseable; preserves invariant "we tried")
      // - UPDATE: only overwrite if the row's current value is null
      //   OR we found an EARLIER date than what's stored. Stable
      //   "first paid" semantic — we never push it forward in time.
      const firstPaidIso = m._firstPaidAt ?? null;
      if (!cur) {
        row.first_paid_at = firstPaidIso;
      } else if (firstPaidIso) {
        if (!cur.first_paid_at) {
          row.first_paid_at = firstPaidIso;
        } else if (firstPaidIso < cur.first_paid_at) {
          row.first_paid_at = firstPaidIso;
        }
      }

      // v75.53: if this active paying student would be left with a NULL
      // first_paid_at — no _firstPaidAt from the product-scoped fetch
      // AND nothing already stored — queue a cross-product recovery
      // lookup for after the upsert. effectivePlan falls back to the
      // stored plan when Whop omits it this run. Limitation: students on
      // a paid plan NOT in PAYING_WHOP_PLAN_IDS are treated as
      // non-paying platform-wide (see the UNKNOWN_PLAN_ID warning above)
      // and are intentionally NOT recovered until the plan is allowlisted.
      const effectivePlan = planId ?? cur?.whop_plan_id ?? null;
      if (
        !firstPaidIso &&
        (status === "active" || status === "past_due") &&
        effectivePlan != null &&
        PAYING_WHOP_PLAN_IDS.has(effectivePlan) &&
        (!cur || !cur.first_paid_at)
      ) {
        recoveryCandidates.push({ whopUserId: m.user, joinedAt });
      }

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

    // ─── first_paid_at recovery (v75.53) ──────────────────────
    // The product-scoped fetch above can't see memberships under
    // products outside WHOP_PRODUCT_ID, so _firstPaidAt is null for
    // those users and first_paid_at would stay NULL — making active
    // paying students invisible to every cohort surface AND uncovered
    // by the CSM crons (the leak behind the 91 NULL rows found
    // 2026-06-11). For the bounded set left NULL this run, do the
    // per-user cross-product lookup to recover the true earliest date.
    // Capped + throttled so it can't approach maxDuration; the daily
    // inflow is a handful, and /api/admin/backfill-first-paid-at clears
    // any large backlog in one pass.
    const FIRST_PAID_RECOVERY_CAP = 25;
    // Leave headroom under maxDuration=300s: the main sync above can
    // already run long on heavy days, so bail out of the recovery loop
    // rather than risk the function timing out mid-pass.
    const RECOVERY_DEADLINE_MS = 240_000;
    if (result.errors > 0) {
      // A batch upsert failed this run, so some candidate rows are in
      // partial/unknown state (a new insert may not exist; an existing
      // row's status update may have failed). Skip recovery entirely —
      // writing first_paid_at against that is unsafe. The candidates
      // re-detect and recover on the next clean sync.
      if (recoveryCandidates.length > 0) {
        console.warn(
          `[whop-sync] skipping first_paid recovery (${recoveryCandidates.length} candidates) ` +
            `because ${result.errors} upsert row(s) failed this run; recover on next clean sync.`,
        );
      }
    } else {
      let processed = 0;
      for (const cand of recoveryCandidates.slice(0, FIRST_PAID_RECOVERY_CAP)) {
        if (Date.now() - t0 > RECOVERY_DEADLINE_MS) break;
        processed++;
        try {
          const { firstPaidIso: recovered } =
            await fetchEarliestMembershipDateForUser(cand.whopUserId);
          // Fall back to joined_at (their first touchpoint) when Whop has
          // no parseable membership date — better than leaving NULL. Note:
          // for a brand-new row whose Whop created_at was unparseable,
          // joinedAt is effectively now() (see the joinedAt assignment).
          const valueToWrite = recovered ?? cand.joinedAt;
          // .is("first_paid_at", null) preserves the "first paid never
          // moves" invariant (only fills a NULL, never overwrites).
          // .select() returns the rows actually changed so we count ONLY
          // real fills — a no-op update (row gone, or filled by a racing
          // writer) doesn't inflate first_paid_recovered.
          const { data, error } = await supabase
            .from("students")
            .update({ first_paid_at: valueToWrite })
            .eq("whop_user_id", cand.whopUserId)
            .is("first_paid_at", null)
            .select("whop_user_id");
          if (!error && data && data.length > 0) result.first_paid_recovered++;
        } catch (e) {
          console.warn(
            `[whop-sync] first_paid recovery failed for ${cand.whopUserId}: ${
              e instanceof Error ? e.message : String(e)
            }`,
          );
        }
        // Pace under Whop's ~10 req/sec cap (whopFetchWithRetry also backs
        // off on 429, but pacing avoids triggering it in the first place).
        await new Promise((r) => setTimeout(r, 200));
      }
      if (recoveryCandidates.length > processed) {
        console.warn(
          `[whop-sync] first_paid recovery processed ${processed}/${recoveryCandidates.length} ` +
            `(cap ${FIRST_PAID_RECOVERY_CAP} / ${RECOVERY_DEADLINE_MS}ms budget); ` +
            `remainder drains next run, or run /api/admin/backfill-first-paid-at.`,
        );
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
 * inputs. Used to filter Whop's `renewal_period_end` (future for
 * members still inside their paid cycle) before stamping it as
 * canceled_at — a cancellation date cannot be in the future.
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
