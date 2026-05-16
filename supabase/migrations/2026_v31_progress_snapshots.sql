-- ============================================================
-- v31: Daily average-progress snapshots.
--
-- Tracks the average completion-% across active students once per
-- day so the admin dashboard can show a trend instead of a single
-- snapshot. Karlo wants to see whether the average is climbing or
-- sliding over time.
--
-- Written by a nightly cron (/api/cron/snapshot-progress at 00:30 UTC).
-- Backfilled at migration time for the last 14 days using existing
-- completion timestamps so the sparkline isn't empty on day one.
-- ============================================================


-- ─────────────── 1. Table ───────────────

create table if not exists daily_progress_snapshots (
  snapshot_date    date primary key,
  active_students  int not null,
  total_completions int not null,
  avg_progress     numeric(5,2) not null,  -- 0.00 – 100.00
  created_at       timestamptz not null default now()
);

create index if not exists idx_daily_progress_date
  on daily_progress_snapshots(snapshot_date desc);

alter table daily_progress_snapshots enable row level security;

drop policy if exists "Team reads daily progress snapshots"
  on daily_progress_snapshots;
create policy "Team reads daily progress snapshots"
  on daily_progress_snapshots for select
  using (public.current_user_is_team());


-- ─────────────── 2. Backfill last 14 days ───────────────
--   "Active on day D" approximated as: currently active AND joined_at <= D.
--   We don't have membership history (only current status), so this
--   slightly over-counts students who churned during the window.
--   Good enough for a trend chart; the cron writes accurate snapshots
--   going forward.

with days as (
  select (current_date - i)::date as day
  from generate_series(0, 13) as g(i)
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
    ) as active_students,
    (
      select count(*) from student_lesson_completions slc
      join students s on s.id = slc.student_id
      where s.membership_status = 'active'
        and s.joined_at::date <= d.day
        and slc.completed_at is not null
        and slc.completed_at::date <= d.day
    ) as total_completions
  from days d cross join totals t
)
insert into daily_progress_snapshots
  (snapshot_date, active_students, total_completions, avg_progress)
select
  pd.day,
  pd.active_students,
  pd.total_completions,
  case
    when pd.active_students > 0 and pd.total_lessons > 0 then
      round(
        (pd.total_completions::numeric / (pd.active_students * pd.total_lessons)) * 100,
        2
      )
    else 0
  end
from per_day pd
on conflict (snapshot_date) do nothing;
