-- ============================================================
-- Phase B: Checkpoints data layer + watch-sync prep columns
-- Run AFTER schema.sql + seed.sql, then run 2026_checkpoints_seed.sql
-- ============================================================

-- 1. Checkpoints table
create table if not exists checkpoints (
  id               text primary key,
  sort_order       int not null unique,
  title            text not null,
  subtitle         text,
  theme_key        text not null,
  is_discount_gate boolean not null default false,
  created_at       timestamptz not null default now()
);

alter table checkpoints enable row level security;

drop policy if exists "Authenticated can read checkpoints" on checkpoints;
create policy "Authenticated can read checkpoints"
  on checkpoints for select
  using (auth.uid() is not null);

-- 2. Tasks now reference a checkpoint
alter table tasks add column if not exists checkpoint_id text references checkpoints(id);
create index if not exists idx_tasks_checkpoint on tasks(checkpoint_id);

-- 3. Watch tracking extensions (Phase D prep — safe to land here)
alter table tasks add column if not exists whop_lesson_id text;
create index if not exists idx_tasks_whop_lesson on tasks(whop_lesson_id);

alter table students add column if not exists whop_refresh_token text;
alter table students add column if not exists last_watch_sync_at timestamptz;
