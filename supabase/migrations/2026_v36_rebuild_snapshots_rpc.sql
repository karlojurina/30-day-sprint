-- ============================================================
-- v36: rebuild_daily_snapshots() — RPC the admin button calls
-- after a Whop community sync to recompute every snapshot row
-- from current students + completions data.
--
-- Same formulas as v33's INSERT, but this version DELETEs first so
-- old (pre-Whop-sync) snapshots get replaced with the corrected
-- counts. p_start_date is a parameter so we can bound the rebuild —
-- defaults to 2026-01-01 to cover the year-to-date trend.
--
-- Idempotent. Safe to re-run.
-- ============================================================

create or replace function public.rebuild_daily_snapshots(
  p_start_date date default date '2026-01-01'
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows int := 0;
begin
  -- Wipe + rebuild every row in the rebuild window.
  delete from daily_progress_snapshots where snapshot_date >= p_start_date;

  with days as (
    select d::date as day
    from generate_series(p_start_date, current_date, interval '1 day') as d
  ),
  totals as (
    select count(*)::int as n from lessons
  ),
  per_day as (
    select
      d.day,
      coalesce(t.n, 1) as total_lessons,
      (
        select count(*) from students s
        where s.membership_status = 'active'
          and s.joined_at::date <= d.day
      )::int as active_count,
      (
        select count(*) from students s
        where s.joined_at::date = d.day
      )::int as joined_count,
      (
        select count(*) from students s
        where s.membership_status = 'canceled'
          and s.updated_at::date = d.day
      )::int as churned_count,
      (
        select count(*) from student_lesson_completions slc
        join students s on s.id = slc.student_id
        where s.membership_status = 'active'
          and s.joined_at::date <= d.day
          and slc.completed_at is not null
          and slc.completed_at::date <= d.day
      )::int as total_completions
    from days d cross join totals t
  )
  insert into daily_progress_snapshots
    (snapshot_date, active_students, total_completions, avg_progress,
     active_count, joined_count, churned_count)
  select
    pd.day,
    pd.active_count,
    pd.total_completions,
    case
      when pd.active_count > 0 and pd.total_lessons > 0 then
        round(
          (pd.total_completions::numeric / (pd.active_count * pd.total_lessons)) * 100,
          2
        )
      else 0
    end,
    pd.active_count,
    pd.joined_count,
    pd.churned_count
  from per_day pd;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

grant execute on function public.rebuild_daily_snapshots(date) to authenticated;
