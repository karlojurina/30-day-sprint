-- ============================================================
-- UNDO for v109 (supabase/migrations/2026_v109_tasks_reset.sql)
--
-- NOT A MIGRATION. A file in supabase/undo/ is never run in sequence with
-- supabase/migrations/. This one is run by hand, and only to take the tasks
-- reset back.
--
-- WHAT IT DOES, in one transaction
--   1. Locks tasks against writes, as v109 does, waiting 5 seconds at most.
--   2. Checks it can: admin_config holds tasks_reset_at, and
--      archive_tasks.reset_2026_10 holds the reset's copy, every row with
--      that moment. With no tasks_reset_at the reset is not in place: it
--      changes nothing and says so.
--   3. Puts each reset task back from the copy (status, dismissed_at,
--      dismissed_by and notes as they were), where the task is still exactly
--      as the reset left it and no open task exists now for the same student
--      and scenario.
--   4. Deletes admin_config['tasks_reset_at'] and renames the copy to
--      archive_tasks.reset_2026_10_undone_<yyyymmdd_hh24mi>, in UTC, so v109
--      can run again.
--   5. Checks its own result, commits, and shows one row.
--
-- WHAT IT DOES NOT PUT BACK, stated plainly
--   * A reset task the team changed since (moved back to To do, or
--     dismissed again with their own reason): it stays as the team left it,
--     counted in changed_since.
--   * A reset task whose student has an open task of the same scenario now,
--     because a cron opened it again after the reset: one student cannot
--     hold two open tasks of one scenario (idx_tasks_unique_open), so it
--     stays dismissed and the newer one stays on To do, counted in
--     newer_open_task.
--   * A reset task whose student was deleted since (tasks go with their
--     student): counted in student_gone.
--   * Tasks created after the reset: they stay as they are.
--   The renamed copy keeps every row, those above included.
--
-- WHEN IT REFUSES, changing nothing (every message ends "Nothing was changed.")
--   * admin_config holds tasks_reset_at but the copy is missing, or a row
--     of the copy carries another moment.
--   * A copy already has the renamed name (two undos in one minute): wait a
--     minute and run it again.
--   * Its own check after the change fails.
--
-- WHEN THE TABLE IS BUSY
--   Another session holding tasks for more than 5 seconds stops the file
--   with "Another session held the tasks table for more than 5 seconds
--   (...). Nothing was changed. Paste it again in a minute."
--
-- Safe to run again: with no tasks_reset_at it changes nothing and says so.
-- ============================================================

begin;

set local lock_timeout = '5s';

do $lock$
begin
  lock table public.tasks in share row exclusive mode;
exception when lock_not_available or deadlock_detected then
  raise exception 'Another session held the tasks table for more than 5 seconds (%), so the undo did not start. Nothing was changed. Paste it again in a minute.', sqlerrm
    using errcode = sqlstate;
end
$lock$;

-- ─────────────── 1 and 2. Is the reset in place, and is its copy there? ───────────────

do $state$
declare
  v_at   text;
  v_name text := 'reset_2026_10_undone_' || to_char(now() at time zone 'UTC', 'YYYYMMDD_HH24MI');
  v_bad  bigint;
begin
  select value into v_at from public.admin_config where key = 'tasks_reset_at';
  perform set_config('v109undo.counts', '', false);
  perform set_config('v109undo.renamed', '', false);
  if v_at is null then
    perform set_config('v109undo.state', 'absent', false);
    return;
  end if;
  if to_regclass('archive_tasks.reset_2026_10') is null then
    raise exception 'admin_config holds tasks_reset_at (%), but archive_tasks.reset_2026_10 is missing, so nothing can be put back from it. Nothing was changed.', v_at;
  end if;
  select count(*) into v_bad
    from archive_tasks.reset_2026_10
   where to_char(reset_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') <> v_at;
  if v_bad > 0 then
    raise exception 'Rows of archive_tasks.reset_2026_10 from another moment than tasks_reset_at (%): %. Nothing was changed.', v_at, v_bad;
  end if;
  if to_regclass(format('archive_tasks.%I', v_name)) is not null then
    raise exception 'The table archive_tasks.% exists already. Wait a minute and run this again. Nothing was changed.', v_name;
  end if;
  perform set_config('v109undo.state', 'undoing', false);
  perform set_config('v109undo.name', v_name, false);
end
$state$;

-- ─────────────── 3 and 4. The tasks back, the moment out, the copy renamed ───────────────

do $undo$
declare
  v_name     text;
  v_copy     bigint;
  v_asleft   bigint;
  v_newer    bigint;
  v_changed  bigint;
  v_gone     bigint;
  v_reopened bigint;
begin
  if current_setting('v109undo.state') <> 'undoing' then return; end if;
  v_name := current_setting('v109undo.name');

  -- Each task of the copy, before anything moves: still as the reset left
  -- it (and of those, the ones behind a newer open task), changed by the
  -- team since, or gone with its student.
  select count(*),
         count(*) filter (where t.id is not null and t.status = 'dismissed' and t.dismissed_at = a.reset_at
                            and t.dismissed_by is null
                            and t.notes is not distinct from coalesce(a.notes, '') || ' [reset for the new program]'),
         count(*) filter (where t.id is not null and t.status = 'dismissed' and t.dismissed_at = a.reset_at
                            and t.dismissed_by is null
                            and t.notes is not distinct from coalesce(a.notes, '') || ' [reset for the new program]'
                            and exists (select 1 from public.tasks o
                                         where o.status = 'open' and o.student_id = t.student_id
                                           and o.scenario_id = t.scenario_id)),
         count(*) filter (where t.id is null)
    into v_copy, v_asleft, v_newer, v_gone
    from archive_tasks.reset_2026_10 a
    left join public.tasks t on t.id = a.id;
  v_changed := v_copy - v_asleft - v_gone;

  update public.tasks t
     set status = a.status, dismissed_at = a.dismissed_at, dismissed_by = a.dismissed_by, notes = a.notes
    from archive_tasks.reset_2026_10 a
   where a.id = t.id
     and t.status = 'dismissed' and t.dismissed_at = a.reset_at and t.dismissed_by is null
     and t.notes is not distinct from coalesce(a.notes, '') || ' [reset for the new program]'
     and not exists (select 1 from public.tasks o
                      where o.status = 'open' and o.student_id = t.student_id and o.scenario_id = t.scenario_id);
  get diagnostics v_reopened = row_count;

  if v_reopened <> v_asleft - v_newer then
    raise exception '% reset tasks could be put back, but % were. Nothing was changed.', v_asleft - v_newer, v_reopened;
  end if;

  delete from public.admin_config where key = 'tasks_reset_at';
  execute format('alter table archive_tasks.reset_2026_10 rename to %I', v_name);

  perform set_config('v109undo.counts', concat_ws(',', v_copy, v_reopened, v_changed, v_newer, v_gone), false);
  perform set_config('v109undo.renamed', 'archive_tasks.' || v_name, false);
end
$undo$;

-- ─────────────── 5. The result is checked before it is kept ───────────────

do $check$
begin
  if current_setting('v109undo.state') <> 'undoing' then return; end if;
  if exists (select 1 from public.admin_config where key = 'tasks_reset_at') then
    raise exception 'admin_config still holds tasks_reset_at after the undo. Nothing was changed.';
  end if;
  if to_regclass('archive_tasks.reset_2026_10') is not null
     or to_regclass(current_setting('v109undo.renamed')) is null then
    raise exception 'The copy was not renamed to %. Nothing was changed.', current_setting('v109undo.renamed');
  end if;
end
$check$;

commit;

select case current_setting('v109undo.state', true)
         when 'undoing' then 'The tasks reset is undone: ' || split_part(current_setting('v109undo.counts', true), ',', 2)
                             || ' tasks are open again. The copy is now ' || current_setting('v109undo.renamed', true) || '.'
         else 'The tasks reset is not in place (admin_config has no tasks_reset_at). This run changed nothing.'
       end as v109_undo,
       nullif(split_part(current_setting('v109undo.counts', true), ',', 2), '')::int as tasks_reopened,
       nullif(split_part(current_setting('v109undo.counts', true), ',', 3), '')::int as changed_since,
       nullif(split_part(current_setting('v109undo.counts', true), ',', 4), '')::int as newer_open_task,
       nullif(split_part(current_setting('v109undo.counts', true), ',', 5), '')::int as student_gone,
       nullif(current_setting('v109undo.renamed', true), '') as copy_renamed_to;
-- EXPECT: one row, "The tasks reset is undone: N tasks are open again. The
-- copy is now archive_tasks.reset_2026_10_undone_<time>.", then the counts:
-- changed_since, newer_open_task and student_gone are the reset tasks kept
-- as they are now, and why. A second paste says "The tasks reset is not in
-- place" and changes nothing; v109 can then run again.
