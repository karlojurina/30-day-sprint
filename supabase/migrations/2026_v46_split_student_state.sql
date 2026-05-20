-- ============================================================
-- v46: Split per-function student state out of the students table.
--
-- The students table had grown to ~35 columns covering streaks,
-- sprint milestones, Whop sync diagnostics, celebration flags, DM
-- logs, etc. Each of those is a separate function; piling them onto
-- a single row widens the contract every consumer has to handle.
--
-- This migration creates 5 sibling tables, one per function, each
-- with `student_id` as primary key (1-to-1 with students). The
-- moved columns are NOT dropped from students in this migration —
-- v47 handles that AFTER the code is updated. This keeps the
-- migration safe to run before the code change ships.
--
-- New tables:
--   student_milestones    — onboarding + sprint progression timestamps
--   student_streaks       — current/longest streak + last streak date
--   student_whop_sync     — Whop tokens + sync diagnostics
--   student_celebrations  — which celebrations have been shown
--   student_dm_log        — outbound DM-sent flags
--
-- Backfill from existing students rows is included (idempotent
-- via ON CONFLICT DO NOTHING).
--
-- See CLAUDE.md → "Table-level bounded contexts" for the principle.
-- See system_contracts.md for the per-table dependency map after
-- this migration lands.
--
-- Idempotent.
-- ============================================================

-- 1. student_milestones ---------------------------------------------------
create table if not exists student_milestones (
  student_id                 uuid primary key references students(id) on delete cascade,
  onboarding_completed_at    timestamptz,
  first_sprint_login_at      timestamptz,
  bounty_access_claimed_at   timestamptz,
  sprint_completed_at        timestamptz,
  first_client_landed_at     timestamptz,
  playbook_welcome_seen_at   timestamptz,
  updated_at                 timestamptz not null default now()
);

comment on table student_milestones is
  'One row per student. Onboarding + sprint-progression milestone timestamps. Each column = null means "not reached".';

-- 2. student_streaks ------------------------------------------------------
create table if not exists student_streaks (
  student_id        uuid primary key references students(id) on delete cascade,
  current_streak    int  not null default 0,
  longest_streak    int  not null default 0,
  last_streak_date  date,
  updated_at        timestamptz not null default now()
);

comment on table student_streaks is
  'One row per student. Streak counters + the date the current streak last advanced.';

-- 3. student_whop_sync ----------------------------------------------------
create table if not exists student_whop_sync (
  student_id            uuid primary key references students(id) on delete cascade,
  access_token          text,
  refresh_token         text,
  last_sync_at          timestamptz,
  last_sync_error       text,
  last_sync_error_at    timestamptz,
  last_sync_unmatched   text[],
  last_sync_fetched     int,
  last_sync_matched     int,
  updated_at            timestamptz not null default now()
);

comment on table student_whop_sync is
  'One row per student. Whop OAuth tokens + the per-student watch-history sync diagnostics. The students table no longer carries this state.';

-- 4. student_celebrations -------------------------------------------------
create table if not exists student_celebrations (
  student_id                     uuid primary key references students(id) on delete cascade,
  last_streak_milestone_shown    int        not null default 0,
  month_review_seen_at           timestamptz,
  celebrated_region_ids          text[]     not null default '{}',
  updated_at                     timestamptz not null default now()
);

comment on table student_celebrations is
  'One row per student. Tracks which celebration overlays have already been shown so we do not re-fire them.';

-- 5. student_dm_log -------------------------------------------------------
create table if not exists student_dm_log (
  student_id          uuid primary key references students(id) on delete cascade,
  day28_dm_sent_at    timestamptz,
  updated_at          timestamptz not null default now()
);

comment on table student_dm_log is
  'One row per student. Tracks which outbound DMs have already been sent. Add a column per DM type as new DM flows ship.';

-- ─── Backfill from students columns (if they still exist) ──────────────

do $$
begin
  -- Backfill student_milestones
  if exists (
    select 1 from information_schema.columns
    where table_name='students' and column_name='sprint_completed_at'
  ) then
    insert into student_milestones (
      student_id, onboarding_completed_at, first_sprint_login_at,
      bounty_access_claimed_at, sprint_completed_at,
      first_client_landed_at, playbook_welcome_seen_at
    )
    select
      id, onboarding_completed_at, first_sprint_login_at,
      bounty_access_claimed_at, sprint_completed_at,
      first_client_landed_at, playbook_welcome_seen_at
    from students
    on conflict (student_id) do nothing;
  end if;

  -- Backfill student_streaks
  if exists (
    select 1 from information_schema.columns
    where table_name='students' and column_name='current_streak'
  ) then
    insert into student_streaks (
      student_id, current_streak, longest_streak, last_streak_date
    )
    select
      id,
      coalesce(current_streak, 0),
      coalesce(longest_streak, 0),
      last_streak_date
    from students
    on conflict (student_id) do nothing;
  end if;

  -- Backfill student_whop_sync
  if exists (
    select 1 from information_schema.columns
    where table_name='students' and column_name='whop_access_token'
  ) then
    insert into student_whop_sync (
      student_id, access_token, refresh_token, last_sync_at,
      last_sync_error, last_sync_error_at, last_sync_unmatched,
      last_sync_fetched, last_sync_matched
    )
    select
      id, whop_access_token, whop_refresh_token, last_watch_sync_at,
      whop_last_sync_error, whop_last_sync_error_at, whop_last_sync_unmatched,
      whop_last_sync_fetched_count, whop_last_sync_matched_count
    from students
    on conflict (student_id) do nothing;
  end if;

  -- Backfill student_celebrations
  if exists (
    select 1 from information_schema.columns
    where table_name='students' and column_name='last_streak_milestone_shown'
  ) then
    insert into student_celebrations (
      student_id, last_streak_milestone_shown,
      month_review_seen_at, celebrated_region_ids
    )
    select
      id,
      coalesce(last_streak_milestone_shown, 0),
      month_review_seen_at,
      coalesce(celebrated_region_ids, '{}')
    from students
    on conflict (student_id) do nothing;
  end if;

  -- Backfill student_dm_log
  if exists (
    select 1 from information_schema.columns
    where table_name='students' and column_name='day28_dm_sent_at'
  ) then
    insert into student_dm_log (student_id, day28_dm_sent_at)
    select id, day28_dm_sent_at from students
    on conflict (student_id) do nothing;
  end if;
end $$;

-- ─── RLS policies ──────────────────────────────────────────────────────
-- Pattern: student can read own row; team_members can read all.
-- All writes go through API routes using the service role, which
-- bypasses RLS, so no INSERT/UPDATE policies are needed.

alter table student_milestones    enable row level security;
alter table student_streaks       enable row level security;
alter table student_whop_sync     enable row level security;
alter table student_celebrations  enable row level security;
alter table student_dm_log        enable row level security;

-- student_milestones
drop policy if exists "student_read_own_milestones" on student_milestones;
create policy "student_read_own_milestones" on student_milestones
  for select to authenticated
  using (student_id in (select id from students where supabase_user_id = auth.uid()));
drop policy if exists "team_read_milestones" on student_milestones;
create policy "team_read_milestones" on student_milestones
  for select to authenticated
  using (exists (select 1 from team_members where id = auth.uid()));

-- student_streaks
drop policy if exists "student_read_own_streaks" on student_streaks;
create policy "student_read_own_streaks" on student_streaks
  for select to authenticated
  using (student_id in (select id from students where supabase_user_id = auth.uid()));
drop policy if exists "team_read_streaks" on student_streaks;
create policy "team_read_streaks" on student_streaks
  for select to authenticated
  using (exists (select 1 from team_members where id = auth.uid()));

-- student_whop_sync (team-read only; tokens are sensitive)
drop policy if exists "team_read_whop_sync" on student_whop_sync;
create policy "team_read_whop_sync" on student_whop_sync
  for select to authenticated
  using (exists (select 1 from team_members where id = auth.uid()));

-- student_celebrations
drop policy if exists "student_read_own_celebrations" on student_celebrations;
create policy "student_read_own_celebrations" on student_celebrations
  for select to authenticated
  using (student_id in (select id from students where supabase_user_id = auth.uid()));
drop policy if exists "team_read_celebrations" on student_celebrations;
create policy "team_read_celebrations" on student_celebrations
  for select to authenticated
  using (exists (select 1 from team_members where id = auth.uid()));

-- student_dm_log (team-read only)
drop policy if exists "team_read_dm_log" on student_dm_log;
create policy "team_read_dm_log" on student_dm_log
  for select to authenticated
  using (exists (select 1 from team_members where id = auth.uid()));

-- Sanity check (commented):
-- select count(*) from student_milestones;
-- select count(*) from student_streaks;
-- select count(*) from student_whop_sync;
-- select count(*) from student_celebrations;
-- select count(*) from student_dm_log;
-- -- expect: same count as students table.
