-- v89 — Make the daily snapshot history point-in-time, and make the
--       rebuild incapable of reaching past the range it was asked for.
--
-- THE BUG
-- -------
-- v81's rebuild computed each PAST day from each student's CURRENT state:
--
--   where s.membership_status in ('active', 'past_due')
--     and s.joined_at::date <= d.day
--
-- For a fixed set of currently-active students, count(joined_at <= d) only
-- grows with d. So active_count and active_count_cohort were monotone
-- non-decreasing BY CONSTRUCTION — the chart could not show churn, ever.
-- avg_progress inherited it: both its numerator and its denominator were
-- restricted to today's survivors, making the past a survivorship curve
-- that silently improves every time somebody cancels.
--
-- joined_count and churned_count were already honest: they key on
-- first_paid_at and canceled_at, which are dated.
--
-- THE FIX
-- -------
-- Active on day d = paid by d, and not yet cancelled as of d:
--
--   where s.first_paid_at::date <= d.day
--     and (s.canceled_at is null or s.canceled_at::date > d.day)
--
-- Entry now uses the same column as joined_count and exit the same column
-- as churned_count, which yields an exact, checkable invariant:
--
--   active(d) - active(d-1) = joined(d) - churned(d)     for every day
--
-- Verify that after running this. If it does not hold, do not keep this.
--
-- WHY p_end_date
-- --------------
-- Measured in production 2026-09-17: 194 rows covering 2026-01-01..2026-07-13
-- were written in ONE bulk operation on 2026-07-13 (the last successful
-- rebuild, so back-projected), while every date from 2026-07-14 onward was
-- written on its own day by the nightly cron — 66 days of GENUINE
-- point-in-time data. Those 66 days are better than anything this function
-- can reconstruct, because a reconstruction from canceled_at loses students
-- who cancelled and later re-subscribed (the login self-heal sets
-- canceled_at = null on re-activation). They survived only because this
-- function has not succeeded since 2026-07-13.
--
-- So the delete is now bounded on BOTH sides and callers pass a narrow
-- window. Repairing the old range is a deliberate, backed-up one-off:
--
--   select rebuild_daily_snapshots('2026-01-01', '2026-07-13');
--
-- NEVER call this with a range that covers collected history.
--
-- ALSO IN THIS MIGRATION
-- ----------------------
-- v_paying_plans drops plan_fMMqxAljrzu75 ($970/365d, 7 valid members).
-- Decision 2026-09-16: only the $97 monthly plan counts as paying. This
-- also removes the last annual plan from the Month-2 cohort, which makes
-- the hardcoded 30-day renewal cycle in metrics-definitions.ts correct
-- rather than a bug. Keep this array in step with PAYING_WHOP_PLAN_IDS in
-- src/lib/constants.ts AND the hardcoded list in
-- supabase/diagnostics/admin-health.sql.
--
-- Idempotent: create or replace.

create or replace function public.rebuild_daily_snapshots(
  p_start_date date default current_date - 2,
  p_end_date   date default current_date
)
returns int
language plpgsql
security definer
-- Locks lookup to the public schema (Supabase Advisor: Function Search
-- Path Mutable). Unchanged from v81.
set search_path = public
as $$
declare
  v_rows int;
  v_paying_plans text[] := array['plan_4ZrwR4PmBsVsx'];
  v_cohort_cutoff timestamptz := '2026-05-25 00:00:00+00'::timestamptz;
  v_end date := least(p_end_date, current_date);
begin
  if p_start_date > v_end then
    return 0;
  end if;

  -- Bounded on BOTH sides. v81 deleted everything from p_start_date
  -- forward, which is what put 66 days of collected history at risk.
  delete from daily_progress_snapshots
   where snapshot_date >= p_start_date
     and snapshot_date <= v_end;

  with days as (
    select generate_series(
      p_start_date,
      v_end,
      interval '1 day'
    )::date as day
  ),
  totals as (
    select (select count(*) from lessons where id <> 'l057')::int as total_lessons
  ),
  per_day as (
    select
      d.day,
      t.total_lessons,
      -- ALL paying members active on this day — POINT IN TIME.
      (
        select count(*) from students s
        where s.first_paid_at::date <= d.day
          and (s.canceled_at is null or s.canceled_at::date > d.day)
          and s.whop_plan_id = any(v_paying_plans)
      )::int as active_count,
      (
        select count(*) from students s
        where s.first_paid_at::date = d.day
          and s.whop_plan_id = any(v_paying_plans)
      )::int as joined_count,
      (
        select count(*) from students s
        where s.canceled_at::date = d.day
          and s.whop_plan_id = any(v_paying_plans)
      )::int as churned_count,
      -- total_completions: canonical formula, l057 excluded, date-bounded,
      -- and now scoped to who was actually active on the day.
      (
        select count(*) from student_lesson_completions slc
        join students s on s.id = slc.student_id
        join lessons l on l.id = slc.lesson_id
        where s.first_paid_at::date <= d.day
          and (s.canceled_at is null or s.canceled_at::date > d.day)
          and s.whop_plan_id = any(v_paying_plans)
          and l.id <> 'l057'
          and (
            (slc.skipped_at is not null and slc.skipped_at::date <= d.day)
            or (l.requires_action = false
                and slc.completed_at is not null
                and slc.completed_at::date <= d.day)
            or (l.requires_action = true
                and slc.completed_at is not null
                and slc.action_completed_at is not null
                and slc.completed_at::date <= d.day
                and slc.action_completed_at::date <= d.day)
          )
      )::int as total_completions,
      -- COHORT paying members active on this day — POINT IN TIME.
      (
        select count(*) from students s
        where s.first_paid_at::date <= d.day
          and (s.canceled_at is null or s.canceled_at::date > d.day)
          and s.first_paid_at >= v_cohort_cutoff
          and s.whop_plan_id = any(v_paying_plans)
      )::int as active_count_cohort,
      (
        select count(*) from students s
        where s.first_paid_at::date = d.day
          and s.first_paid_at >= v_cohort_cutoff
          and s.whop_plan_id = any(v_paying_plans)
      )::int as joined_count_cohort,
      (
        select count(*) from students s
        where s.canceled_at::date = d.day
          and s.first_paid_at >= v_cohort_cutoff
          and s.whop_plan_id = any(v_paying_plans)
      )::int as churned_count_cohort,
      (
        select count(*) from student_lesson_completions slc
        join students s on s.id = slc.student_id
        join lessons l on l.id = slc.lesson_id
        where s.first_paid_at::date <= d.day
          and (s.canceled_at is null or s.canceled_at::date > d.day)
          and s.first_paid_at >= v_cohort_cutoff
          and s.whop_plan_id = any(v_paying_plans)
          and l.id <> 'l057'
          and (
            (slc.skipped_at is not null and slc.skipped_at::date <= d.day)
            or (l.requires_action = false
                and slc.completed_at is not null
                and slc.completed_at::date <= d.day)
            or (l.requires_action = true
                and slc.completed_at is not null
                and slc.action_completed_at is not null
                and slc.completed_at::date <= d.day
                and slc.action_completed_at::date <= d.day)
          )
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

grant execute on function public.rebuild_daily_snapshots(date, date) to authenticated;
grant execute on function public.rebuild_daily_snapshots(date, date) to service_role;

-- v81's single-argument version would otherwise still exist and still
-- carry the old body and the unbounded delete.
drop function if exists public.rebuild_daily_snapshots(date);
