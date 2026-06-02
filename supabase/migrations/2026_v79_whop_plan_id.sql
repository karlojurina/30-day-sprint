-- ============================================================
-- v79: Identify free-plan users + remove them from operational
-- surfaces (CSM tasks, day-28 DM, dashboard counts, students list).
--
-- Background: free Whop plans (plan_t4VXohAMYT669 et al) produce
-- valid memberships that grant platform access but should NOT
-- trigger any operational outreach. We didn't store which Whop
-- plan a member was on, so the crons + admin surfaces had no way
-- to filter them. They were getting CSM tasks generated for them
-- and would have received day-28 DMs.
--
-- Allowlist design (chosen over blocklist): the application reads
-- PAYING_WHOP_PLAN_IDS from constants.ts. Members on a plan NOT in
-- that set are treated as non-paying — invisible to admin, but
-- they keep full student-side access (login, dashboard, lessons,
-- achievements). New free / promo / partner plans default to
-- non-paying without requiring a code change; new PAID plans need
-- to be added to the constant (the sync runner logs unknown
-- plan IDs so we notice).
--
-- This migration:
--   1) Adds students.whop_plan_id (nullable text)
--   2) Replaces rebuild_daily_snapshots() to also filter by
--      paying plans in every count
--
-- Plan-id population happens at the application layer (webhook +
-- sync runner + OAuth callback self-heal). Karlo runs the dashboard
-- ↻ Refresh button after applying this migration to backfill the
-- column for every existing student.
--
-- Idempotent. Safe to re-run.
-- ============================================================


-- ─────────────── 1. students.whop_plan_id ───────────────

alter table students
  add column if not exists whop_plan_id text;

-- Sparse index — most rows will be populated, but the queries that
-- benefit (operational crons, snapshot cron) always filter to active
-- members first, so we don't need a covering index.
create index if not exists idx_students_whop_plan_id
  on students(whop_plan_id)
  where whop_plan_id is not null;


-- ─────────────── 2. Replace rebuild_daily_snapshots() ───────────────
--
-- Adds a paying-plan filter to every count in the RPC. The plan IDs
-- are hardcoded here AND in src/lib/constants.ts (PAYING_WHOP_PLAN_IDS)
-- because we can't import TS constants from SQL. If you change the
-- TS constant, also update this list and re-run rebuild_daily_snapshots()
-- to recompute history.

create or replace function public.rebuild_daily_snapshots(
  p_start_date date default date '2026-01-01'
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows int := 0;
  v_cohort_cutoff timestamptz := timestamptz '2026-05-25 00:00:00+00';
  v_paying_plans text[] := array[
    'plan_4ZrwR4PmBsVsx',
    'plan_fMMqxAljrzu75'
  ];
begin
  delete from daily_progress_snapshots where snapshot_date >= p_start_date;

  with days as (
    select d::date as day
    from generate_series(p_start_date, current_date, interval '1 day') as d
  ),
  totals as (
    select count(*)::int as n from lessons where id <> 'l057'
  ),
  per_day as (
    select
      d.day,
      coalesce(t.n, 1) as total_lessons,

      -- ALL paying members (cohort + legacy)
      (
        select count(*) from students s
        where s.membership_status in ('active', 'past_due')
          and s.joined_at::date <= d.day
          and s.whop_plan_id = any(v_paying_plans)
      )::int as active_count,
      (
        select count(*) from students s
        where s.joined_at::date = d.day
          and s.whop_plan_id = any(v_paying_plans)
      )::int as joined_count,
      (
        select count(*) from students s
        where s.canceled_at::date = d.day
          and s.whop_plan_id = any(v_paying_plans)
      )::int as churned_count,
      (
        select count(*) from student_lesson_completions slc
        join students s on s.id = slc.student_id
        where s.membership_status in ('active', 'past_due')
          and s.joined_at::date <= d.day
          and s.whop_plan_id = any(v_paying_plans)
          and slc.completed_at is not null
          and slc.completed_at::date <= d.day
          and (slc.lesson_id <> 'l057' or slc.lesson_id is null)
      )::int as total_completions,

      -- COHORT paying members (joined >= ADMIN_STUDENT_JOIN_CUTOFF)
      (
        select count(*) from students s
        where s.membership_status in ('active', 'past_due')
          and s.joined_at::date <= d.day
          and s.joined_at >= v_cohort_cutoff
          and s.whop_plan_id = any(v_paying_plans)
      )::int as active_count_cohort,
      (
        select count(*) from students s
        where s.joined_at::date = d.day
          and s.joined_at >= v_cohort_cutoff
          and s.whop_plan_id = any(v_paying_plans)
      )::int as joined_count_cohort,
      (
        select count(*) from students s
        where s.canceled_at::date = d.day
          and s.joined_at >= v_cohort_cutoff
          and s.whop_plan_id = any(v_paying_plans)
      )::int as churned_count_cohort,
      (
        select count(*) from student_lesson_completions slc
        join students s on s.id = slc.student_id
        where s.membership_status in ('active', 'past_due')
          and s.joined_at::date <= d.day
          and s.joined_at >= v_cohort_cutoff
          and s.whop_plan_id = any(v_paying_plans)
          and slc.completed_at is not null
          and slc.completed_at::date <= d.day
          and (slc.lesson_id <> 'l057' or slc.lesson_id is null)
      )::int as total_completions_cohort
    from days d cross join totals t
  )
  insert into daily_progress_snapshots
    (snapshot_date,
     active_students, total_completions, avg_progress,
     active_count, joined_count, churned_count,
     active_count_cohort, joined_count_cohort, churned_count_cohort,
     avg_progress_cohort)
  select
    pd.day,
    pd.active_count,
    pd.total_completions,
    case
      when pd.active_count > 0 and pd.total_lessons > 0 then
        round(
          (pd.total_completions::numeric /
           (pd.active_count * pd.total_lessons)) * 100,
          2
        )
      else 0
    end,
    pd.active_count,
    pd.joined_count,
    pd.churned_count,
    pd.active_count_cohort,
    pd.joined_count_cohort,
    pd.churned_count_cohort,
    case
      when pd.active_count_cohort > 0 and pd.total_lessons > 0 then
        round(
          (pd.total_completions_cohort::numeric /
           (pd.active_count_cohort * pd.total_lessons)) * 100,
          2
        )
      else 0
    end
  from per_day pd;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

grant execute on function public.rebuild_daily_snapshots(date) to authenticated;
