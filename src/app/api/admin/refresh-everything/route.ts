/**
 * POST /api/admin/refresh-everything
 *
 * One-button full refresh: pull latest from Whop, rebuild the
 * daily-progress snapshot history, and re-run all three CSM crons
 * (check-csm-tasks, check-engagement, check-na-tasks) so the queue
 * reflects everyone's current state.
 *
 * Karlo's call (v75.22): "I want it to be one refresh button and
 * it does everything. Checks for updates, checks if the tasks need
 * to be switched, checks if tasks need to be created, etc."
 *
 * Used by the unified Refresh button on /admin (dashboard) and
 * /admin/tasks. Replaces the older /api/admin/sync-whop +
 * /api/admin/rebuild-snapshots + /api/admin/run-task-crons trio.
 * Those endpoints stay alive in case anything still depends on
 * them, but the UI now points here.
 *
 * Sequence (~110-130s total):
 *   1. sync-whop                    ~80s — pulls Whop memberships,
 *                                          populates first_paid_at +
 *                                          canceled_at transitions
 *   2. rebuild_daily_snapshots      ~10s — recomputes daily metric
 *                                          history with current logic
 *   3. check-engagement (parallel)   ~5s — emits churn-risk alerts
 *   4. check-csm-tasks  (parallel)  ~10s — auto-dismisses orphans +
 *                                          creates new pace/stalled/
 *                                          nolessons tasks
 *   5. check-na-tasks   (parallel)   ~5s — NA nudges
 *
 * 3-5 run in parallel after sync+rebuild settle (their inputs are
 * the freshly-synced students/snapshots).
 *
 * Founder + admin only.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireTeam, isAuthFailure } from "@/lib/admin-auth";

// Full pipeline can take 100-130s. 300s is Vercel Pro's max.
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const auth = await requireTeam(request);
  if (isAuthFailure(auth)) return auth.error;

  if (
    auth.teamMember.role !== "founder" &&
    auth.teamMember.role !== "admin"
  ) {
    return NextResponse.json(
      { error: "Founder or admin role required" },
      { status: 403 },
    );
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET env var not set" },
      { status: 500 },
    );
  }

  const baseUrl = new URL(request.url).origin;
  const authHeaders = { Authorization: `Bearer ${cronSecret}` };
  const t0 = Date.now();
  const summary: Record<string, unknown> = {};

  // ─── Step 1: sync Whop ────────────────────────────────────
  const syncStart = Date.now();
  try {
    const res = await fetch(`${baseUrl}/api/cron/sync-whop`, {
      headers: authHeaders,
    });
    summary.sync = res.ok
      ? await res.json().catch(() => ({ error: "non-JSON response" }))
      : { error: `HTTP ${res.status}` };
  } catch (e) {
    summary.sync = {
      error: e instanceof Error ? e.message : String(e),
    };
  }
  summary.sync_duration_ms = Date.now() - syncStart;

  // ─── Step 2: rebuild snapshots ────────────────────────────
  // rebuild_daily_snapshots is a SECURITY DEFINER RPC; calling via
  // the service-role client (auth.supabase here is service-role for
  // a team member) executes with the function owner's permissions.
  const rebuildStart = Date.now();
  try {
    const { error } = await auth.supabase.rpc("rebuild_daily_snapshots", {
      p_start_date: "2026-01-01",
    });
    summary.rebuild = error ? { error: error.message } : { ok: true };
  } catch (e) {
    summary.rebuild = {
      error: e instanceof Error ? e.message : String(e),
    };
  }
  summary.rebuild_duration_ms = Date.now() - rebuildStart;

  // ─── Step 3-5: three CSM crons in parallel ────────────────
  // These all read from the freshly synced students table; running
  // them in parallel is fine — they don't depend on each other.
  const cronsStart = Date.now();
  const [engagementRes, csmRes, naRes] = await Promise.allSettled([
    fetch(`${baseUrl}/api/cron/check-engagement`, { headers: authHeaders }),
    fetch(`${baseUrl}/api/cron/check-csm-tasks`, { headers: authHeaders }),
    fetch(`${baseUrl}/api/cron/check-na-tasks`, { headers: authHeaders }),
  ]);

  async function unwrap(
    r: PromiseSettledResult<Response>,
    label: string,
  ): Promise<unknown> {
    if (r.status === "rejected")
      return {
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      };
    if (!r.value.ok) return { error: `${label} HTTP ${r.value.status}` };
    return r.value.json().catch(() => ({ error: "non-JSON response" }));
  }

  summary.engagement = await unwrap(engagementRes, "check-engagement");
  summary.csm_tasks = await unwrap(csmRes, "check-csm-tasks");
  summary.na_tasks = await unwrap(naRes, "check-na-tasks");
  summary.crons_duration_ms = Date.now() - cronsStart;
  summary.total_duration_ms = Date.now() - t0;

  return NextResponse.json({ ok: true, ...summary });
}
