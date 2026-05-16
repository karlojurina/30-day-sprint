-- ============================================================
-- v33: Extend snapshot backfill back to January 1, 2026.
--
-- v31 + v32 only seeded the last 14 days. Karlo wants Insights
-- charts to show trends from Jan 1 onwards. This migration
-- recomputes daily_progress_snapshots for every date in
-- [2026-01-01, today], inserting only rows that don't already
-- exist (so v31/v32 data + any cron-written rows are preserved).
--
-- Calculation reference:
--   active_count   = count(students) where membership_status='active'
--                    AND joined_at::date <= D
--   joined_count   = count(students) where joined_at::date = D
--   churned_count  = count(students) where membership_status='canceled'
--                    AND updated_at::date = D
--   total_completions = count(student_lesson_completions) for active
--                       students whose completed_at <= D
--   avg_progress   = total_completions / (active_count × total_lessons) × 100
--
-- Same approximations as v31/v32 apply (no membership history;
-- updated_at proxies for status-change date).
-- ============================================================

with days as (
  select d::date as day
  from generate_series(
    date '2026-01-01',
    current_date,
    interval '1 day'
  ) as d
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
  pd.active_count,            -- legacy "active_students" column
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
from per_day pd
on conflict (snapshot_date) do nothing;

-- Sanity check (uncomment to verify in SQL editor):
-- select count(*) as days_seeded,
--        min(snapshot_date) as earliest,
--        max(snapshot_date) as latest
-- from daily_progress_snapshots;
