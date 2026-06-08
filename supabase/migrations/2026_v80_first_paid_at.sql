-- ============================================================
-- v80: students.first_paid_at + rebuild_daily_snapshots RPC update.
--
-- students.first_paid_at = earliest membership.created_at across ALL
-- this user's Whop memberships under our product. Stable "when did
-- they originally join EcomTalent" — never moves on renewal.
--
-- joined_at  = current subscription cycle start (could be recent
--              even for a 6-month customer who just renewed)
-- first_paid_at = first-ever signup = "true Day 1"
--
-- Used by every "first-time joiner" check across the app:
--   * /admin/journey + /admin/students + /admin/not-activated
--     + /admin (dashboard) cohort scope
--   * check-csm-tasks / check-engagement / check-na-tasks crons
--   * day28-dm cron
--   * snapshot cron + rebuild_daily_snapshots RPC (cohort columns)
--   * discount-window eligibility
--   * sprint-day calculation
--
-- Populated by the Whop sync runner. The runner computes min(created_at)
-- across all of a user's memberships and writes it; never overwritten
-- after first set (unless we find an even earlier date).
--
-- Idempotent. Safe to re-run.
-- ============================================================


-- ─────────────── 1. students.first_paid_at ───────────────

alter table students
  add column if not exists first_paid_at timestamptz;

create index if not exists idx_students_first_paid_at
  on students(first_paid_at);

comment on column students.first_paid_at is
  'Earliest membership.created_at across all this user''s Whop '
  'memberships under our product. Stable "when did they originally '
  'join EcomTalent" — never moves on renewal. Used by every '
  '"first-time joiner" check (admin journey/tasks/NA, snapshot cohort '
  'columns, discount eligibility, sprint day count). Populated by the '
  'Whop sync runner; NULL until backfill.';


-- ─────────────── 2. Replace rebuild_daily_snapshots() RPC ───────────────
--
-- The cohort filters used to be `s.joined_at >= v_cohort_cutoff`.
-- After v75.18 they're `s.first_paid_at >= v_cohort_cutoff` so
-- returning customers with recent renewals but original signups
-- pre-launch are correctly excluded from the cohort. The all-students
-- columns (no cohort filter) are unchanged.

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
        -- "Joined today" = original signup today (first_paid_at),
        -- not cycle start. Excludes renewals from the daily count.
        select count(*) from students s
        where s.first_paid_at::date = d.day
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

      -- COHORT paying members (first_paid_at >= launch cutoff)
      (
        select count(*) from students s
        where s.membership_status in ('active', 'past_due')
          and s.joined_at::date <= d.day
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
        where s.membership_status in ('active', 'past_due')
          and s.joined_at::date <= d.day
          and s.first_paid_at >= v_cohort_cutoff
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
