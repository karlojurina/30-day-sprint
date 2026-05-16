-- ============================================================
-- v32: Extend daily_progress_snapshots with cohort + flow stats.
--
-- Adds three columns so the Insights page can chart trends for
-- Active / Joined / Churned alongside Avg progress. The nightly cron
-- (/api/cron/snapshot-progress) writes all four columns going
-- forward; this migration backfills the last 14 days using existing
-- students.joined_at + students.updated_at + membership_status data.
--
-- Approximations:
--   "active_count" on day D    = students with membership_status='active'
--                                AND joined_at::date <= D
--                                (we don't have membership history, so
--                                 this slightly under-counts students
--                                 who were active on D but churned later)
--   "joined_count" on day D    = students with joined_at::date = D
--   "churned_count" on day D   = students with membership_status='canceled'
--                                AND updated_at::date = D
--                                (rough — updated_at also fires on other
--                                 column changes, but is the best proxy
--                                 we have without an audit log)
--
-- Idempotent; safe to re-run.
-- ============================================================

alter table daily_progress_snapshots
  add column if not exists active_count  int,
  add column if not exists joined_count  int,
  add column if not exists churned_count int;

-- Backfill last 14 days. Skips days that already have the new columns
-- populated (idempotent re-run).
with days as (
  select (current_date - i)::date as day
  from generate_series(0, 13) as g(i)
)
update daily_progress_snapshots dps
set
  active_count = sub.active_count,
  joined_count = sub.joined_count,
  churned_count = sub.churned_count
from (
  select
    d.day,
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
    )::int as churned_count
  from days d
) sub
where dps.snapshot_date = sub.day
  and dps.active_count is null;  -- only backfill rows that haven't been populated
