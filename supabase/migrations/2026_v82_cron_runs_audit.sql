-- ============================================================
-- v82: cron_runs audit table.
--
-- Logs every cron invocation (both successful and failed) so we can
-- answer two questions separately:
--   1. Did Vercel fire the cron at all? (= row exists for that time)
--   2. Did the work succeed? (= row.status = 'success')
--
-- Without this, when the dashboard looks stale, we can't tell
-- whether Vercel never scheduled the cron, scheduled but 401'd on
-- auth (the CRON_SECRET-drift incident), or fired successfully but
-- the work itself errored. The cron_runs table separates those.
--
-- See src/lib/cron-auth.ts (logCronStart, logCronFinish) for the
-- write path. Each cron writes one row on entry and updates it on
-- exit. Best-effort writes — never throw — so audit failures don't
-- break business logic.
--
-- Idempotent (CREATE TABLE IF NOT EXISTS).
-- ============================================================

create table if not exists cron_runs (
  id              uuid primary key default gen_random_uuid(),
  route_name      text not null,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  auth_status     text not null,        -- 'ok' | 'no_secret_configured' | 'missing_header' | 'mismatch'
  status          text not null,        -- 'running' | 'success' | 'failed' | 'auth_failed'
  error_message   text,
  rows_affected   int
);

create index if not exists idx_cron_runs_route_started
  on cron_runs(route_name, started_at desc);

create index if not exists idx_cron_runs_started_at
  on cron_runs(started_at desc);

alter table cron_runs enable row level security;

drop policy if exists "Team reads cron_runs" on cron_runs;
create policy "Team reads cron_runs"
  on cron_runs for select
  using (
    exists (
      select 1 from team_members
      where team_members.id = auth.uid()
    )
  );

-- Service role writes (cron handlers). Bypasses RLS via the service
-- key in createServiceClient(), so no explicit insert policy needed.

comment on table cron_runs is
  'Audit log for cron invocations. Written by src/lib/cron-auth.ts; queried for "did Vercel fire?" diagnostics.';
