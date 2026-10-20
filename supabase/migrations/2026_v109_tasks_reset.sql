-- ============================================================
-- v109: the Tasks queue starts fresh for the new program.
--
-- Admin rebuild 2, decision D7 (_admin/prds/admin-rebuild-2/
-- admin_rebuild_2_prd.md). Lovro pastes it in the SQL editor.
--
-- WHY
--   On 20 October the queue still held 95 open tasks from before the new
--   program (stalled.discord.day3/5/7/10 and one custom template), and the
--   Sent and Dismissed tabs every task since May. The team starts the new
--   program on an empty To do, with the old tasks kept.
--
-- WHAT THIS FILE DOES, in one transaction
--   1. Locks tasks against writes for the moment it runs (share row
--      exclusive: reads go on, a cron's insert or a team member's click
--      waits), so no task is added or closed between the copy and the
--      dismissal. It waits 5 seconds at most for the lock.
--   2. Looks for admin_config['tasks_reset_at']. When it is there the reset
--      has already run: nothing below runs, and the last row says so.
--   3. Makes the schema archive_tasks if it is not there (no access for
--      anon, authenticated or service_role), and the table
--      archive_tasks.reset_2026_10: a copy of every task that is open at the
--      run, every column as it was, with reset_at, the run's moment.
--   4. Sets those tasks to dismissed: dismissed_at = the run's moment,
--      dismissed_by = null (no team member did it), and
--      notes = coalesce(notes, '') || ' [reset for the new program]'.
--   5. Writes (upserts) admin_config['tasks_reset_at'] = the run's moment, in UTC, like
--      2026-10-20T21:30:00.000Z. The Tasks page, its insights and the
--      Dashboard count tasks created from that moment on; the Tasks page
--      shows older ones on its Archived tab, read only.
--   6. Checks its own result, commits, and shows one row.
--
-- WHAT STAYS
--   Every Sent and Dismissed task, as it is. No task is deleted.
--   The crons are not changed, so the queue refills where a rule still
--   holds: within 2 hours check-na-tasks opens stalled.* again for every
--   student who has not logged in and is on a tier day (it never reads
--   tasks), and check-csm-tasks opens nolessons.* and the custom templates
--   whose conditions still match (it skips a student only on an open or
--   sent task of the scenario, never a dismissed one). Those tasks are new,
--   created after the reset, so they land on To do.
--
-- WHEN IT REFUSES, changing nothing (every message ends "Nothing was changed.")
--   * The table archive_tasks.reset_2026_10 exists but admin_config has no
--     tasks_reset_at: a copy from an earlier reset is still there. Check
--     it, rename or drop it, then run this again.
--   * Its own check after the change fails (an open task left, a copy that
--     does not match the tasks it dismissed).
--
-- WHEN THE TABLE IS BUSY
--   Another session holding tasks for more than 5 seconds stops the file
--   with "Another session held the tasks table for more than 5 seconds
--   (...). Nothing was changed. Paste it again in a minute."
--
-- UNDO: supabase/undo/2026_v109_undo.sql opens the reset tasks again from
-- the copy, deletes tasks_reset_at and renames the copy.
--
-- Re-runnable: run again, it finds tasks_reset_at, changes nothing and says
-- so. One transaction: a stop anywhere changes nothing.
-- ============================================================

begin;

set local lock_timeout = '5s';

-- ─────────────── 1. The lock ───────────────

do $lock$
begin
  lock table public.tasks in share row exclusive mode;
exception when lock_not_available or deadlock_detected then
  raise exception 'Another session held the tasks table for more than 5 seconds (%), so the reset did not start. Nothing was changed. Paste it again in a minute.', sqlerrm
    using errcode = sqlstate;
end
$lock$;

-- ─────────────── 2. Already reset? ───────────────
--
-- The answer is kept in a session setting for the steps below and for the
-- last row. 'resetting' means this run makes the reset.

do $state$
declare
  v_at text;
begin
  select value into v_at from public.admin_config where key = 'tasks_reset_at';
  if v_at is null and to_regclass('archive_tasks.reset_2026_10') is not null then
    raise exception 'The table archive_tasks.reset_2026_10 exists, but admin_config has no tasks_reset_at: a copy from an earlier reset is still there. Check it, rename or drop it, then run this again. Nothing was changed.';
  end if;
  perform set_config('v109.state', case when v_at is null then 'resetting' else 'done' end, false);
end
$state$;

-- ─────────────── 3 to 5. The copy, the dismissal, the moment ───────────────

do $reset$
declare
  v_open   bigint;
  v_copied bigint;
  v_closed bigint;
begin
  if current_setting('v109.state') <> 'resetting' then return; end if;

  select count(*) into v_open from public.tasks where status = 'open';

  create schema if not exists archive_tasks;
  revoke all on schema archive_tasks from public, anon, authenticated, service_role;

  create table archive_tasks.reset_2026_10 as
    select now() as reset_at, t.*
      from public.tasks t
     where t.status = 'open';
  alter table archive_tasks.reset_2026_10 add primary key (id);
  -- Nobody but the owner reads the copy.
  revoke all on all tables in schema archive_tasks from public, anon, authenticated, service_role;
  select count(*) into v_copied from archive_tasks.reset_2026_10;

  update public.tasks t
     set status = 'dismissed',
         dismissed_at = now(),
         dismissed_by = null,
         notes = coalesce(t.notes, '') || ' [reset for the new program]'
    from archive_tasks.reset_2026_10 a
   where a.id = t.id;
  get diagnostics v_closed = row_count;

  -- An upsert: step 2 found no row, and the lock keeps a second run out,
  -- so it inserts; were a row written by hand meanwhile, this run's moment
  -- still wins, the one the copy and the dismissals carry.
  insert into public.admin_config (key, value, description)
  values ('tasks_reset_at',
          to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'Set by migration 2026_v109, the tasks reset. The Tasks page, its insights and the Dashboard count tasks created from this moment on; older ones are on the Archived tab. Do not edit; the undo of v109 removes it.')
  on conflict (key) do update
     set value = excluded.value, description = excluded.description, updated_at = now(), updated_by = null;

  perform set_config('v109.counts', v_open || ',' || v_copied || ',' || v_closed, false);
end
$reset$;

-- ─────────────── 6. The result is checked before it is kept ───────────────
--
-- Any line that does not hold raises, and the raise undoes everything above.

do $check$
declare
  v_counts text[];
  v_bad    bigint;
begin
  if current_setting('v109.state') <> 'resetting' then return; end if;
  v_counts := string_to_array(current_setting('v109.counts'), ',');

  if v_counts[1] <> v_counts[2] or v_counts[2] <> v_counts[3] then
    raise exception 'The reset found % open tasks, copied % and dismissed %. Nothing was changed.', v_counts[1], v_counts[2], v_counts[3];
  end if;
  if exists (select 1 from public.tasks where status = 'open') then
    raise exception 'A task is still open after the reset. Nothing was changed.';
  end if;
  select count(*) into v_bad
    from archive_tasks.reset_2026_10 a
    join public.tasks t on t.id = a.id
   where a.status <> 'open' or a.reset_at <> now()
      or t.status <> 'dismissed' or t.dismissed_at <> now() or t.dismissed_by is not null
      or t.notes is distinct from coalesce(a.notes, '') || ' [reset for the new program]';
  if v_bad > 0 then
    raise exception '% reset tasks do not match their copy. Nothing was changed.', v_bad;
  end if;
  if (select value from public.admin_config where key = 'tasks_reset_at')
     is distinct from to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') then
    raise exception 'admin_config tasks_reset_at does not hold the moment of this run. Nothing was changed.';
  end if;
  if has_table_privilege('authenticated', 'archive_tasks.reset_2026_10', 'select')
     or has_table_privilege('service_role', 'archive_tasks.reset_2026_10', 'select') then
    raise exception 'The copy of the reset tasks can be read by the app. Nothing was changed.';
  end if;
end
$check$;

-- How many tasks the copy holds, for the last row. The copy is read by name
-- only when it is there: a row naming a table that is gone would fail.
do $tell$
declare
  v_n bigint;
begin
  if to_regclass('archive_tasks.reset_2026_10') is not null then
    execute 'select count(*) from archive_tasks.reset_2026_10' into v_n;
  end if;
  perform set_config('v109.copy', coalesce(v_n::text, ''), false);
end
$tell$;

commit;

-- ─────────────── What is there now ───────────────

select case current_setting('v109.state', true)
         when 'resetting' then 'The tasks reset ran now, at '
                               || (select value from public.admin_config where key = 'tasks_reset_at')
                               || ': ' || split_part(current_setting('v109.counts', true), ',', 1)
                               || ' open tasks were copied to archive_tasks.reset_2026_10 and dismissed.'
         else 'The tasks reset already ran, at '
              || coalesce((select value from public.admin_config where key = 'tasks_reset_at'), 'an unknown time')
              || '. This run changed nothing.'
       end as v109,
       (select value from public.admin_config where key = 'tasks_reset_at') as tasks_reset_at,
       nullif(current_setting('v109.copy', true), '')::int as tasks_in_the_copy,
       (select count(*) from public.tasks where status = 'open')::int as open_now;
-- EXPECT on production, first run: one row, "The tasks reset ran now, at
-- <time>: 95 open tasks were copied to archive_tasks.reset_2026_10 and
-- dismissed." (the number is the open tasks at that moment), the same time
-- in tasks_reset_at, tasks_in_the_copy equal to that number, open_now 0. A
-- second paste says "The tasks reset already ran" and changes nothing.
-- open_now grows again as the crons run (every 2 hours). If the file
-- stopped with a message ending "Nothing was changed.", it is true: the
-- whole file is one transaction. A stop on "canceling statement due to lock
-- timeout" (SQLSTATE 55P03) is the same: nothing was changed. Paste it again
-- in a minute.
