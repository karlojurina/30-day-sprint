-- v84 (v76 feature) — canceling_snapshots: daily history of the
-- "Canceling" population (cancel_scheduled_at stamped, still
-- active/past_due, paying plan, launch cohort).
--
-- DELIBERATELY A SEPARATE TABLE, not a column on
-- daily_progress_snapshots: rebuild_daily_snapshots() (v81) does
-- DELETE + re-INSERT on that table, and canceling is point-in-time
-- state that CANNOT be recomputed for past dates — a column there
-- would be wiped to NULL on every "Refresh everything" click. This
-- table is only ever written by the snapshot-progress cron and is
-- invisible to the rebuild RPC, so history survives rebuilds.
--
-- History starts accruing from the day this ships; the dashboard
-- tile renders missing dates as 0.
--
-- Idempotent. Apply after 2026_v83_cancel_scheduled_at.sql.

create table if not exists canceling_snapshots (
  snapshot_date           date primary key,
  canceling_count_cohort  int  not null default 0,
  created_at              timestamptz not null default now()
);

comment on table canceling_snapshots is
  'One row per day: how many launch-cohort paying students were in Whop''s "Canceling" state (cancel_scheduled_at set, still active) at snapshot time. Written by /api/cron/snapshot-progress. Separate from daily_progress_snapshots because the rebuild RPC deletes+reinserts that table and point-in-time canceling state cannot be recomputed.';

alter table canceling_snapshots enable row level security;

drop policy if exists "Team reads canceling snapshots" on canceling_snapshots;
create policy "Team reads canceling snapshots"
  on canceling_snapshots for select
  using (public.current_user_is_team());
