/**
 * Nightly admin metrics snapshot — runs at 00:30 UTC daily.
 *
 * Writes daily_progress_snapshots rows for YESTERDAY (now complete)
 * AND TODAY (preliminary; will be overwritten tomorrow). Two upserts
 * per run.
 *
 * For each date, writes TWO sets of counts per metric:
 *
 *   all-students (legacy + launch cohort):
 *     active_count, joined_count, churned_count, avg_progress
 *
 *   launch cohort only (first_paid_at >= ADMIN_STUDENT_JOIN_CUTOFF):
 *     active_count_cohort, joined_count_cohort,
 *     churned_count_cohort, avg_progress_cohort
 *
 * The admin scope toggle picks which set the UI reads.
 *
 * ─── v75.28 changes ───────────────────────────────────────────
 *
 * (1) Yesterday + today: previously only wrote today. Cron fires
 *     at 00:30 UTC so "today" had only captured 30 min of joins/
 *     churns — most of yesterday's late activity never landed in
 *     any snapshot until the rebuild RPC was manually run.
 *
 * (2) Canonical completion formula: now reads from
 *     student_progress_counts view (canonical isLessonComplete
 *     + l057 excluded — see v81 migration) instead of raw
 *     completed_at IS NOT NULL rows. The cron, the rebuild RPC,
 *     and the view now produce identical numbers for the same
 *     inputs. Hitting Refresh no longer shifts the dashboard's
 *     avg_progress number.
 *
 * (3) Active fetch paginated: PostgREST's project max-rows cap
 *     (~1000) silently truncated the activeRows query. Past 1000
 *     paying members the active_count silently froze. Fixed via
 *     fetchAllRowsPaginated.
 *
 * (4) isInLaunchCohort no longer falls back to joined_at — NULL
 *     first_paid_at is now consistently excluded from the cohort
 *     across the cron, the helper, and the RPC. v75.26 ensures
 *     every new INSERT populates first_paid_at; legacy NULLs get
 *     backfilled by the nightly Whop sync.
 *
 * Idempotent via the snapshot_date primary key on both upserts.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { fetchAllRowsPaginated } from "@/lib/supabase-pagination";
import { ADMIN_STUDENT_JOIN_CUTOFF } from "@/lib/constants";
import {
  verifyCronAuth,
  cronUnauthorizedResponse,
  logCronStart,
  logCronFinish,
} from "@/lib/cron-auth";

const ROUTE_NAME = "snapshot-progress";

// v75.32: raised from Vercel's 60s default. The active fetch + view
// scan + 2x4 count queries can take 30-60s as the pool grows past
// a few thousand members; 300s is Vercel Pro's max.
export const maxDuration = 300;
import {
  ACTIVE_STATUSES,
  isInLaunchCohort,
  isPayingMember,
  PAYING_WHOP_PLAN_IDS_ARRAY,
} from "@/lib/admin/metrics-definitions";

type ActiveRow = {
  id: string;
  joined_at: string;
  first_paid_at: string | null;
  membership_status: string;
  whop_plan_id: string | null;
};

type ProgressCountRow = {
  student_id: string;
  completed_count: number;
};

interface DateWindow {
  /** YYYY-MM-DD */
  date: string;
  /** ISO timestamp at 00:00Z of `date` */
  start: string;
  /** ISO timestamp at 00:00Z of `date + 1 day` */
  end: string;
}

function dateWindow(daysAgo: number): DateWindow {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  const date = d.toISOString().slice(0, 10);
  const start = new Date(`${date}T00:00:00Z`).toISOString();
  const end = new Date(
    new Date(start).getTime() + 86_400_000,
  ).toISOString();
  return { date, start, end };
}

export async function GET(request: NextRequest) {
  // v75.37: shared cron auth + audit. See src/lib/cron-auth.ts.
  const auth = verifyCronAuth(request);
  if (!auth.ok) {
    await logCronStart(ROUTE_NAME, auth.reason);
    return cronUnauthorizedResponse(auth.reason);
  }
  const runId = await logCronStart(ROUTE_NAME, "ok");

  const supabase = createServiceClient();

  try {

  // Lessons count — denominator for avg_progress. v75.1 excludes
  // l057 (bounty onboarding) to match the 64-lesson sprint count.
  const { count: lessonCount } = await supabase
    .from("lessons")
    .select("id", { count: "exact", head: true })
    .neq("id", "l057");
  const totalLessons = lessonCount ?? 0;

  // Pull every currently-active PAYING student.
  //
  // v75.28: paginated via fetchAllRowsPaginated. The plain .select()
  // was silently capped at ~1000 rows by PostgREST's server-side
  // max-rows setting — once cohort grows past that, active_count
  // would freeze permanently. Same pattern we used in v75.27 for
  // admin surfaces.
  const { data: activeRows, error: activeErr } =
    await fetchAllRowsPaginated<ActiveRow>(() =>
      supabase
        .from("students")
        .select("id, joined_at, first_paid_at, membership_status, whop_plan_id")
        .in("membership_status", ACTIVE_STATUSES as unknown as string[])
        .in("whop_plan_id", PAYING_WHOP_PLAN_IDS_ARRAY as string[]),
    );

  if (activeErr) {
    await logCronFinish(runId, "failed", { error: activeErr.message });
    return NextResponse.json({ error: activeErr.message }, { status: 500 });
  }

  const activeAll = (activeRows ?? []).filter(isPayingMember);
  const activeCohort = activeAll.filter(isInLaunchCohort);

  const idsAll = new Set(activeAll.map((s) => s.id));
  const idsCohort = new Set(activeCohort.map((s) => s.id));

  // v75.28: read completions from student_progress_counts (canonical
  // isLessonComplete formula + l057 excluded — see v81 migration).
  // Previously counted raw `completed_at IS NOT NULL` rows, which
  // (a) over-counted compound lessons that were watched but not
  // shipped, (b) under-counted skipped lessons (canonical formula
  // counts skipped_at as done), (c) included l057 in numerator while
  // denominator excluded it. The view fixes all three.
  //
  // Paginated because the view also hits the row cap once cohort > 1000.
  //
  // v75.28: check the error. fetchAllRowsPaginated accumulates rows
  // until any page fails; a mid-pagination failure returns whatever
  // was already collected. Without this check, a view-permission
  // hiccup or RLS regression would write a partial completion sum as
  // the snapshot's total_completions, silently understating
  // avg_progress until the next manual rebuild.
  const { data: progressRows, error: progressErr } =
    await fetchAllRowsPaginated<ProgressCountRow>(() =>
      supabase
        .from("student_progress_counts")
        .select("student_id, completed_count"),
    );
  if (progressErr) {
    await logCronFinish(runId, "failed", { error: progressErr.message });
    return NextResponse.json({ error: progressErr.message }, { status: 500 });
  }

  let allCompletions = 0;
  let cohortCompletions = 0;
  for (const r of progressRows ?? []) {
    if (idsAll.has(r.student_id)) allCompletions += r.completed_count;
    if (idsCohort.has(r.student_id)) cohortCompletions += r.completed_count;
  }

  // v75.28: write TWO snapshots per run — yesterday (complete day
  // of join/churn activity, capturing what 00:30Z runs missed in the
  // old design) and today (preliminary; tomorrow's run replaces it).
  const yesterday = dateWindow(1);
  const today = dateWindow(0);

  // Per-day join/churn counts. joined_count uses first_paid_at::date
  // = the target day (honest "new joiners that day" signal, not the
  // joined_at-based "anyone whose cycle started" noise).
  async function joinChurnCounts(win: DateWindow) {
    const [joinAll, joinCohort, churnAll, churnCohort] = await Promise.all([
      supabase
        .from("students")
        .select("id", { count: "exact", head: true })
        .gte("first_paid_at", win.start)
        .lt("first_paid_at", win.end)
        .in("whop_plan_id", PAYING_WHOP_PLAN_IDS_ARRAY as string[]),
      supabase
        .from("students")
        .select("id", { count: "exact", head: true })
        .gte("first_paid_at", win.start)
        .lt("first_paid_at", win.end)
        // Cohort branch: same gate as isInLaunchCohort + RPC. v75.28:
        // applied explicitly (was implicit-on-post-cutoff-dates only;
        // brittle if cron ever extended to write older dates).
        .gte("first_paid_at", ADMIN_STUDENT_JOIN_CUTOFF)
        .in("whop_plan_id", PAYING_WHOP_PLAN_IDS_ARRAY as string[]),
      supabase
        .from("students")
        .select("id", { count: "exact", head: true })
        .gte("canceled_at", win.start)
        .lt("canceled_at", win.end)
        .in("whop_plan_id", PAYING_WHOP_PLAN_IDS_ARRAY as string[]),
      // Cohort churn = students churning today whose first_paid_at
      // is post-launch (cohort members only). Uses imported constant
      // for symmetry with the joined branch.
      supabase
        .from("students")
        .select("id", { count: "exact", head: true })
        .gte("canceled_at", win.start)
        .lt("canceled_at", win.end)
        .gte("first_paid_at", ADMIN_STUDENT_JOIN_CUTOFF)
        .in("whop_plan_id", PAYING_WHOP_PLAN_IDS_ARRAY as string[]),
    ]);
    return {
      joined_all: joinAll.count ?? 0,
      joined_cohort: joinCohort.count ?? 0,
      churned_all: churnAll.count ?? 0,
      churned_cohort: churnCohort.count ?? 0,
    };
  }

  const [yesterdayCounts, todayCounts] = await Promise.all([
    joinChurnCounts(yesterday),
    joinChurnCounts(today),
  ]);

  const avgAll = computeAvg(activeAll.length, allCompletions, totalLessons);
  const avgCohort = computeAvg(
    activeCohort.length,
    cohortCompletions,
    totalLessons,
  );

  // Note on the "active_count" semantic for yesterday's row:
  // active_count reflects who is ACTIVE RIGHT NOW (when the cron ran),
  // not who was active at end-of-yesterday. That's a small inaccuracy
  // (a student who churned in the last 30 minutes is excluded from
  // both rows). Acceptable until we add a transitions log. Same
  // semantic as the pre-v75.28 cron, just now applied to two dates.

  const upsertBoth = await Promise.all([
    supabase.from("daily_progress_snapshots").upsert(
      {
        snapshot_date: yesterday.date,
        active_students: activeAll.length,
        total_completions: allCompletions,
        avg_progress: avgAll,
        active_count: activeAll.length,
        joined_count: yesterdayCounts.joined_all,
        churned_count: yesterdayCounts.churned_all,
        avg_progress_cohort: avgCohort,
        active_count_cohort: activeCohort.length,
        joined_count_cohort: yesterdayCounts.joined_cohort,
        churned_count_cohort: yesterdayCounts.churned_cohort,
      },
      { onConflict: "snapshot_date" },
    ),
    supabase.from("daily_progress_snapshots").upsert(
      {
        snapshot_date: today.date,
        active_students: activeAll.length,
        total_completions: allCompletions,
        avg_progress: avgAll,
        active_count: activeAll.length,
        joined_count: todayCounts.joined_all,
        churned_count: todayCounts.churned_all,
        avg_progress_cohort: avgCohort,
        active_count_cohort: activeCohort.length,
        joined_count_cohort: todayCounts.joined_cohort,
        churned_count_cohort: todayCounts.churned_cohort,
      },
      { onConflict: "snapshot_date" },
    ),
  ]);

  const upsertErr = upsertBoth.find((r) => r.error)?.error;
  if (upsertErr) {
    await logCronFinish(runId, "failed", { error: upsertErr.message });
    return NextResponse.json({ error: upsertErr.message }, { status: 500 });
  }

    await logCronFinish(runId, "success", {
      rowsAffected: activeAll.length,
    });
    return NextResponse.json({
      yesterday: yesterday.date,
      today: today.date,
      all: {
        active_count: activeAll.length,
        joined_count_today: todayCounts.joined_all,
        joined_count_yesterday: yesterdayCounts.joined_all,
        churned_count_today: todayCounts.churned_all,
        churned_count_yesterday: yesterdayCounts.churned_all,
        avg_progress: avgAll,
      },
      cohort: {
        active_count: activeCohort.length,
        joined_count_today: todayCounts.joined_cohort,
        joined_count_yesterday: yesterdayCounts.joined_cohort,
        churned_count_today: todayCounts.churned_cohort,
        churned_count_yesterday: yesterdayCounts.churned_cohort,
        avg_progress: avgCohort,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logCronFinish(runId, "failed", { error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

function computeAvg(
  students: number,
  completions: number,
  totalLessons: number,
): number {
  if (students <= 0 || totalLessons <= 0) return 0;
  return (
    Math.round(((completions / (students * totalLessons)) * 100) * 100) / 100
  );
}
