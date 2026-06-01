-- ============================================================
-- v77: Cohort-scoped snapshots, canceled_at tracking, sync audit.
--
-- Three problems fixed:
--
-- 1) daily_progress_snapshots had ONE set of counts (active_count /
--    joined_count / churned_count) that included every student in
--    the DB — legacy customers + launch-cohort students mixed
--    together. /admin/students hides legacy via
--    ADMIN_STUDENT_JOIN_CUTOFF, so the dashboard sparkline numbers
--    didn't reconcile with what the team saw in the list. We now
--    write both: legacy-inclusive (unchanged column names) AND
--    cohort-only (`*_cohort` columns). The admin scope toggle picks
--    which one to read.
--
-- 2) `churned_count` was computed as
--      `membership_status = 'canceled' AND updated_at::date = today`.
--    But the nightly Whop sync updates `membership_status` (and
--    therefore fires the students_updated_at trigger) on every
--    existing row, every night — so every already-canceled student
--    got counted as "churned today" every day. New column
--    `students.canceled_at` is set by the webhook + sync runner ONLY
--    on the transition INTO canceled, giving us a clean
--    "actually-churned-this-day" signal.
--
-- 3) There's no record of whether the nightly sync-whop cron ran or
--    succeeded. If it failed, the next snapshot cron 30 minutes
--    later quietly produced wrong numbers. New `sync_runs` table
--    captures one row per sync attempt with status, counts, and any
--    error message so we can audit "did sync run last night?" from
--    a DB query.
--
-- Idempotent. Safe to re-run.
-- ============================================================


-- ─────────────── 1. daily_progress_snapshots: cohort columns ───────────────

alter table daily_progress_snapshots
  add column if not exists active_count_cohort  int,
  add column if not exists joined_count_cohort  int,
  add column if not exists churned_count_cohort int,
  add column if not exists avg_progress_cohort  numeric(5,2);


-- ─────────────── 2. students.canceled_at ───────────────
--
-- Set by webhook handlers (membership.deactivated /
-- membership.went_invalid) and the Whop sync runner ONLY on the
-- transition into a canceled status. Stays null for active /
-- past_due / never-canceled students.
--
-- Backfill for existing canceled rows: approximate with updated_at
-- since we have no real transition history. Going forward the
-- timestamp is authoritative.

alter table students
  add column if not exists canceled_at timestamptz;

update students
  set canceled_at = updated_at
  where membership_status in ('canceled', 'expired')
    and canceled_at is null;

create index if not exists idx_students_canceled_at
  on students(canceled_at)
  where canceled_at is not null;


-- ─────────────── 3. sync_runs audit table ───────────────

create table if not exists sync_runs (
  id          uuid primary key default gen_random_uuid(),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  source      text not null,        -- 'cron' | 'admin-button'
  status      text not null,        -- 'success' | 'failed' | 'running'
  fetched     int  not null default 0,
  inserted    int  not null default 0,
  updated     int  not null default 0,
  skipped     int  not null default 0,
  errors      int  not null default 0,
  error_message text,
  duration_ms int
);

create index if not exists idx_sync_runs_started_at
  on sync_runs(started_at desc);

alter table sync_runs enable row level security;

drop policy if exists "Team reads sync_runs" on sync_runs;
create policy "Team reads sync_runs"
  on sync_runs for select
  using (public.current_user_is_team());


-- ─────────────── 4. Backfill cohort columns for existing snapshots ───────────────
--
-- Approximations match v32 backfill: we don't have real membership
-- history, so "active on day D" = students currently active AND
-- joined_at <= D. Filtered by ADMIN_STUDENT_JOIN_CUTOFF for the
-- cohort-scoped columns. Going forward the snapshot cron writes
-- these accurately.
--
-- LAUNCH_DATE / ADMIN_STUDENT_JOIN_CUTOFF = 2026-05-25 is hardcoded
-- here so this migration is self-contained (no application-side
-- constants accessible from SQL). If you ever move the cutoff,
-- re-run /api/admin/rebuild-snapshots to recompute these columns.

with days as (
  select snapshot_date as day from daily_progress_snapshots
)
update daily_progress_snapshots dps
set
  active_count_cohort = sub.active_count_cohort,
  joined_count_cohort = sub.joined_count_cohort,
  churned_count_cohort = sub.churned_count_cohort
from (
  select
    d.day,
    (
      select count(*) from students s
      where s.membership_status in ('active', 'past_due')
        and s.joined_at::date <= d.day
        and s.joined_at >= timestamptz '2026-05-25 00:00:00+00'
    )::int as active_count_cohort,
    (
      select count(*) from students s
      where s.joined_at::date = d.day
        and s.joined_at >= timestamptz '2026-05-25 00:00:00+00'
    )::int as joined_count_cohort,
    (
      select count(*) from students s
      where s.canceled_at::date = d.day
        and s.joined_at >= timestamptz '2026-05-25 00:00:00+00'
    )::int as churned_count_cohort
  from days d
) sub
where dps.snapshot_date = sub.day
  and dps.active_count_cohort is null;


-- ─────────────── 5. Replace rebuild_daily_snapshots RPC ───────────────
--
-- New rules vs v36:
--   * "active" = membership_status IN ('active','past_due') (was
--     just 'active'). Past-due users still have access via Whop's
--     payment-retry grace window.
--   * Writes both column families: all-students AND cohort-only.
--   * churned_count uses canceled_at (set on transition) instead of
--     updated_at (touched on every sync run).
--
-- Same atomic-DELETE-then-INSERT pattern. Idempotent.

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
begin
  delete from daily_progress_snapshots where snapshot_date >= p_start_date;

  with days as (
    select d::date as day
    from generate_series(p_start_date, current_date, interval '1 day') as d
  ),
  totals as (
    -- Exclude l057 (bounty onboarding) so the avg-progress
    -- denominator matches the 64-lesson sprint count.
    select count(*)::int as n from lessons where id <> 'l057'
  ),
  per_day as (
    select
      d.day,
      coalesce(t.n, 1) as total_lessons,

      -- ALL-students set
      (
        select count(*) from students s
        where s.membership_status in ('active', 'past_due')
          and s.joined_at::date <= d.day
      )::int as active_count,
      (
        select count(*) from students s
        where s.joined_at::date = d.day
      )::int as joined_count,
      (
        select count(*) from students s
        where s.canceled_at::date = d.day
      )::int as churned_count,
      (
        select count(*) from student_lesson_completions slc
        join students s on s.id = slc.student_id
        where s.membership_status in ('active', 'past_due')
          and s.joined_at::date <= d.day
          and slc.completed_at is not null
          and slc.completed_at::date <= d.day
          and (slc.lesson_id <> 'l057' or slc.lesson_id is null)
      )::int as total_completions,

      -- COHORT-only set (joined >= ADMIN_STUDENT_JOIN_CUTOFF)
      (
        select count(*) from students s
        where s.membership_status in ('active', 'past_due')
          and s.joined_at::date <= d.day
          and s.joined_at >= v_cohort_cutoff
      )::int as active_count_cohort,
      (
        select count(*) from students s
        where s.joined_at::date = d.day
          and s.joined_at >= v_cohort_cutoff
      )::int as joined_count_cohort,
      (
        select count(*) from students s
        where s.canceled_at::date = d.day
          and s.joined_at >= v_cohort_cutoff
      )::int as churned_count_cohort,
      (
        select count(*) from student_lesson_completions slc
        join students s on s.id = slc.student_id
        where s.membership_status in ('active', 'past_due')
          and s.joined_at::date <= d.day
          and s.joined_at >= v_cohort_cutoff
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
