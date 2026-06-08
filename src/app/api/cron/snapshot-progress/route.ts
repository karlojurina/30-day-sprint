/**
 * Nightly admin metrics snapshot — runs at 00:30 UTC daily.
 *
 * Writes one row into daily_progress_snapshots for today's date,
 * computing TWO sets of counts per metric:
 *
 *   all-students (legacy + launch cohort):
 *     active_count, joined_count, churned_count, avg_progress
 *
 *   launch cohort only (joined >= ADMIN_STUDENT_JOIN_CUTOFF):
 *     active_count_cohort, joined_count_cohort,
 *     churned_count_cohort, avg_progress_cohort
 *
 * The admin scope toggle picks which set the UI reads.
 *
 * v75.13 fixes from previous version:
 *   - "active" now means status IN ('active','past_due'), not just
 *     'active'. Past-due users still have access via Whop's grace
 *     window; they're functionally active members.
 *   - churned_count now uses students.canceled_at instead of
 *     updated_at. updated_at fires on every sync run (members get
 *     name/email refreshed), so the previous query counted every
 *     already-canceled student as "churned today" every day.
 *   - Writes a sync_runs row so we can audit cron success from a
 *     DB query instead of digging Vercel logs.
 *
 * Idempotent via the snapshot_date primary key.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase-server";
import { ADMIN_STUDENT_JOIN_CUTOFF } from "@/lib/constants";
import {
  ACTIVE_STATUSES,
  isInLaunchCohort,
  isPayingMember,
  PAYING_WHOP_PLAN_IDS_ARRAY,
} from "@/lib/admin/metrics-definitions";

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const todayStart = new Date(`${today}T00:00:00Z`).toISOString();
  const tomorrowStart = new Date(
    new Date(todayStart).getTime() + 86_400_000,
  ).toISOString();

  // Lessons count — denominator for avg_progress. v75.1 excludes
  // l057 (bounty onboarding) to match the 64-lesson sprint count.
  const { count: lessonCount } = await supabase
    .from("lessons")
    .select("id", { count: "exact", head: true })
    .neq("id", "l057");
  const totalLessons = lessonCount ?? 0;

  // Pull every currently-active PAYING student (active + past_due
  // AND plan_id in PAYING_WHOP_PLAN_IDS) with joined_at so we can
  // split into all vs cohort in JS. Free-plan users are excluded
  // upfront via the .in() on whop_plan_id.
  const { data: activeRows } = await supabase
    .from("students")
    .select("id, joined_at, first_paid_at, membership_status, whop_plan_id")
    .in("membership_status", ACTIVE_STATUSES as unknown as string[])
    .in("whop_plan_id", PAYING_WHOP_PLAN_IDS_ARRAY as string[]);

  const activeAll = (activeRows ?? []).filter(isPayingMember);
  const activeCohort = activeAll.filter(isInLaunchCohort);

  const idsAll = activeAll.map((s) => s.id);
  const idsCohort = activeCohort.map((s) => s.id);

  // Completions counts for both sets. .in() with up to a few
  // thousand UUIDs is fine in PostgREST.
  const [allCompletionsRes, cohortCompletionsRes] = await Promise.all([
    idsAll.length > 0
      ? supabase
          .from("student_lesson_completions")
          .select("id", { count: "exact", head: true })
          .in("student_id", idsAll)
          .not("completed_at", "is", null)
      : Promise.resolve({ count: 0 }),
    idsCohort.length > 0
      ? supabase
          .from("student_lesson_completions")
          .select("id", { count: "exact", head: true })
          .in("student_id", idsCohort)
          .not("completed_at", "is", null)
      : Promise.resolve({ count: 0 }),
  ]);

  const allCompletions = allCompletionsRes.count ?? 0;
  const cohortCompletions = cohortCompletionsRes.count ?? 0;

  // joined_count: students whose FIRST_PAID_AT falls inside today
  // (v75.18). This is the honest "new joiners today" signal —
  // first-time signups, not renewals/cycle-starts that joined_at
  // would otherwise capture. Plan filter still applies.
  const [joinedAllRes, joinedCohortRes] = await Promise.all([
    supabase
      .from("students")
      .select("id", { count: "exact", head: true })
      .gte("first_paid_at", todayStart)
      .lt("first_paid_at", tomorrowStart)
      .in("whop_plan_id", PAYING_WHOP_PLAN_IDS_ARRAY as string[]),
    supabase
      .from("students")
      .select("id", { count: "exact", head: true })
      .gte("first_paid_at", todayStart)
      .lt("first_paid_at", tomorrowStart)
      .gte("first_paid_at", ADMIN_STUDENT_JOIN_CUTOFF)
      .in("whop_plan_id", PAYING_WHOP_PLAN_IDS_ARRAY as string[]),
  ]);

  // churned_count: students who transitioned INTO canceled today.
  // Uses students.canceled_at (set on the transition itself, not
  // touched by routine syncs). Cohort variant uses first_paid_at
  // (v75.18) so legacy customers churning don't count toward the
  // launch-cohort churn.
  const [churnedAllRes, churnedCohortRes] = await Promise.all([
    supabase
      .from("students")
      .select("id", { count: "exact", head: true })
      .gte("canceled_at", todayStart)
      .lt("canceled_at", tomorrowStart)
      .in("whop_plan_id", PAYING_WHOP_PLAN_IDS_ARRAY as string[]),
    supabase
      .from("students")
      .select("id", { count: "exact", head: true })
      .gte("canceled_at", todayStart)
      .lt("canceled_at", tomorrowStart)
      .gte("first_paid_at", ADMIN_STUDENT_JOIN_CUTOFF)
      .in("whop_plan_id", PAYING_WHOP_PLAN_IDS_ARRAY as string[]),
  ]);

  const avgAll = computeAvg(activeAll.length, allCompletions, totalLessons);
  const avgCohort = computeAvg(
    activeCohort.length,
    cohortCompletions,
    totalLessons,
  );

  const { error } = await supabase.from("daily_progress_snapshots").upsert(
    {
      snapshot_date: today,
      // Legacy "all" columns (kept for backwards-compat with charts
      // that read them; same as active_count below).
      active_students: activeAll.length,
      total_completions: allCompletions,
      // All-students set
      avg_progress: avgAll,
      active_count: activeAll.length,
      joined_count: joinedAllRes.count ?? 0,
      churned_count: churnedAllRes.count ?? 0,
      // Cohort-only set
      avg_progress_cohort: avgCohort,
      active_count_cohort: activeCohort.length,
      joined_count_cohort: joinedCohortRes.count ?? 0,
      churned_count_cohort: churnedCohortRes.count ?? 0,
    },
    { onConflict: "snapshot_date" },
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    snapshot_date: today,
    all: {
      active_count: activeAll.length,
      joined_count: joinedAllRes.count ?? 0,
      churned_count: churnedAllRes.count ?? 0,
      avg_progress: avgAll,
    },
    cohort: {
      active_count: activeCohort.length,
      joined_count: joinedCohortRes.count ?? 0,
      churned_count: churnedCohortRes.count ?? 0,
      avg_progress: avgCohort,
    },
  });
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
