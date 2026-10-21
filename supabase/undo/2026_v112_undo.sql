-- ============================================================
-- UNDO for v112 (supabase/migrations/2026_v112_new_achievements.sql)
--
-- NOT A MIGRATION. A file in supabase/undo/ is never run in sequence with
-- supabase/migrations/. This one is run by hand, and only to take v112 back.
--
-- WHAT IT DOES, in one transaction
--   1. Locks achievements, student_achievements and
--      student_lesson_completions, as v112 does, waiting 5 seconds at most.
--   2. Checks it can: archive_v112.runs is there. Without it v112 is not in
--      place: it changes nothing and says so.
--   3. Puts the catalog back from archive_v112.achievements, as it was before
--      v112's first run: the rows v112 deleted (Region Sweep, Two Weeks
--      Strong) and every column of the others (their words, names, tiers
--      and order).
--   4. Puts back every badge row v112 took away (archive_v112.student_achievements),
--      with its own unlocked_at. A row taken away twice (taken, earned again,
--      taken again by a later paste) comes back once, at its first time.
--   5. Makes achievement_unlock_stats again as it was before v112's first
--      run, from archive_v112.view_before (its query, options and comment),
--      and keeps it from anon as v78 does.
--   6. Keeps every value of student_lesson_completions.completed_at_real in
--      archive_v112.completed_at_real (row id, student, lesson, value), then
--      drops the column.
--   7. Renames archive_v112 to archive_v112_undone_<yyyymmdd_hh24mi>, in
--      UTC, so v112 can run again.
--   8. Checks its own result, commits, and shows one row.
--
-- WHAT IT DOES NOT PUT BACK, stated plainly
--   * A badge row whose student was deleted since: counted in student_gone.
--   * A badge row the student holds again now (earned again since v112): the
--     row of now stays, counted in held_again.
--   * A badge row whose badge is in neither the catalog nor its copy (v112
--     never takes one away like that; counted in badge_gone).
--   * completed_at_real: its values stay in the renamed archive only. The
--     deployed code writes and reads the column best-effort, so with it gone
--     those writes and reads fail (logged) and no lesson counts toward
--     Triple Threat until v112 runs again, which judges the rows anew.
--
-- WHEN IT REFUSES, changing nothing (every message ends "Nothing was changed.")
--   * archive_v112.runs is there but the catalog's copy, the view's copy or
--     the table of badge rows is missing.
--   * A schema already has the renamed name (two undos in one minute): wait
--     a minute and run it again.
--   * Its own check after the change fails.
--
-- WHEN THE TABLES ARE BUSY
--   Another session holding one of the three tables for more than 5 seconds
--   stops it with "Another session held a table the v112 undo changes for
--   more than 5 seconds (...). Nothing was changed. Paste it again in a
--   minute."
--
-- Safe to run again: with no archive_v112.runs it changes nothing and says so.
-- ============================================================

begin;

set local search_path = public;
set local lock_timeout = '5s';

do $lock$
declare
  v_list text;
begin
  select string_agg(format('public.%I', t), ', ' order by o) into v_list
    from unnest(array['achievements', 'student_achievements', 'student_lesson_completions'])
         with ordinality as x(t, o)
   where to_regclass('public.' || t) is not null;
  if v_list is not null then
    execute 'lock table ' || v_list || ' in access exclusive mode';
  end if;
exception when lock_not_available or deadlock_detected then
  raise exception 'Another session held a table the v112 undo changes for more than 5 seconds (%), so the undo did not start. Nothing was changed. Paste it again in a minute.', sqlerrm
    using errcode = sqlstate;
end
$lock$;

-- ─────────────── 1 and 2. Is v112 in place, and is its archive whole? ───────────────

do $state$
declare
  v_name    text := 'archive_v112_undone_' || to_char(now() at time zone 'UTC', 'YYYYMMDD_HH24MI');
  v_missing text;
begin
  perform set_config('v112undo.counts', '', false);
  perform set_config('v112undo.renamed', '', false);
  if to_regclass('archive_v112.runs') is null then
    perform set_config('v112undo.state', 'absent', false);
    return;
  end if;
  select string_agg(t, ', ' order by t) into v_missing
    from unnest(array['archive_v112.achievements', 'archive_v112.view_before', 'archive_v112.student_achievements']) as t
   where to_regclass(t) is null;
  if v_missing is not null then
    raise exception 'archive_v112.runs is here but % is missing, so v112 cannot be put back from it. Nothing was changed.', v_missing;
  end if;
  if to_regnamespace(v_name) is not null then
    raise exception 'The schema % exists already. Wait a minute and run this again. Nothing was changed.', v_name;
  end if;
  perform set_config('v112undo.state', 'undoing', false);
  perform set_config('v112undo.name', v_name, false);
end
$state$;

-- ─────────────── 3 to 7 ───────────────

do $undo$
declare
  v_name    text;
  v_cols    text;
  v_set     text;
  v_catalog bigint;
  v_back    bigint;
  v_gone    bigint;
  v_again   bigint;
  v_nobadge bigint;
  v_flags   bigint := 0;
  v_view    record;
begin
  if current_setting('v112undo.state') <> 'undoing' then return; end if;
  v_name := current_setting('v112undo.name');

  -- 3. The catalog: the copy's own columns, so nothing is retyped.
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position),
         string_agg(format('%1$I = a.%1$I', column_name), ', ' order by ordinal_position) filter (where column_name <> 'id')
    into v_cols, v_set
    from information_schema.columns where table_schema = 'archive_v112' and table_name = 'achievements';
  execute format('insert into public.achievements (%s) select %s from archive_v112.achievements a
                   where not exists (select 1 from public.achievements x where x.id = a.id)', v_cols, v_cols);
  get diagnostics v_catalog = row_count;
  execute format('update public.achievements p set %s from archive_v112.achievements a where a.id = p.id', v_set);

  -- 4. The badges, each (student, badge) once, at its first time.
  create temporary table v112_back on commit drop as
    select distinct on (student_id, achievement_id) student_id, achievement_id, unlocked_at
      from archive_v112.student_achievements
     order by student_id, achievement_id, unlocked_at;
  select count(*) filter (where not exists (select 1 from public.students s where s.id = b.student_id)),
         count(*) filter (where exists (select 1 from public.students s where s.id = b.student_id)
                            and not exists (select 1 from public.achievements x where x.id = b.achievement_id)),
         count(*) filter (where exists (select 1 from public.students s where s.id = b.student_id)
                            and exists (select 1 from public.achievements x where x.id = b.achievement_id)
                            and exists (select 1 from public.student_achievements h
                                         where h.student_id = b.student_id and h.achievement_id = b.achievement_id))
    into v_gone, v_nobadge, v_again
    from v112_back b;
  insert into public.student_achievements (student_id, achievement_id, unlocked_at)
  select b.student_id, b.achievement_id, b.unlocked_at
    from v112_back b
   where exists (select 1 from public.students s where s.id = b.student_id)
     and exists (select 1 from public.achievements x where x.id = b.achievement_id)
     and not exists (select 1 from public.student_achievements h
                      where h.student_id = b.student_id and h.achievement_id = b.achievement_id);
  get diagnostics v_back = row_count;

  -- 5. The view as it was, from Postgres's own statement of it.
  select definition, options, comment into v_view from archive_v112.view_before;
  execute format('create or replace view public.achievement_unlock_stats with (%s) as %s',
                 coalesce(nullif(array_to_string(v_view.options, ', '), ''), 'security_invoker = false'),
                 v_view.definition);
  execute format('comment on view public.achievement_unlock_stats is %L', v_view.comment);
  revoke select on public.achievement_unlock_stats from anon;

  -- 6. completed_at_real, kept, then dropped.
  if exists (select 1 from information_schema.columns where table_schema = 'public'
               and table_name = 'student_lesson_completions' and column_name = 'completed_at_real') then
    execute 'create table archive_v112.completed_at_real as
               select id, student_id, lesson_id, completed_at_real
                 from public.student_lesson_completions where completed_at_real is not null';
    execute 'select count(*) from archive_v112.completed_at_real' into v_flags;
    revoke all on archive_v112.completed_at_real from public, anon, authenticated, service_role;
    alter table public.student_lesson_completions drop column completed_at_real;
  end if;

  -- 7. The archive renamed.
  execute format('alter schema archive_v112 rename to %I', v_name);

  perform set_config('v112undo.counts', concat_ws(',', v_back, v_gone, v_again, v_nobadge, v_catalog, v_flags), false);
  perform set_config('v112undo.renamed', v_name, false);
end
$undo$;

-- ─────────────── 8. The result is checked before it is kept ───────────────

do $check$
declare
  v_name text := current_setting('v112undo.renamed');
  v_n    bigint;
  v_def  text;
begin
  if current_setting('v112undo.state') <> 'undoing' then return; end if;
  if to_regnamespace('archive_v112') is not null or to_regnamespace(v_name) is null then
    raise exception 'The archive was not renamed to %. Nothing was changed.', v_name;
  end if;
  execute format('select count(*) from %I.achievements a
                   where not exists (select 1 from public.achievements x where x.id = a.id)', v_name) into v_n;
  if v_n <> 0 then
    raise exception '% badges of the catalog''s copy are not back. Nothing was changed.', v_n;
  end if;
  execute format('select definition from %I.view_before', v_name) into v_def;
  if pg_get_viewdef('public.achievement_unlock_stats'::regclass, true) is distinct from v_def then
    raise exception 'achievement_unlock_stats is not back as it was before v112. Nothing was changed.';
  end if;
  if has_table_privilege('anon', 'public.achievement_unlock_stats', 'select') then
    raise exception 'A visitor (anon) can read achievement_unlock_stats after the undo. Nothing was changed.';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public'
               and table_name = 'student_lesson_completions' and column_name = 'completed_at_real') then
    raise exception 'student_lesson_completions.completed_at_real is still there. Nothing was changed.';
  end if;
end
$check$;

commit;

select case current_setting('v112undo.state', true)
         when 'undoing' then 'v112 is undone: ' || split_part(current_setting('v112undo.counts', true), ',', 1)
                             || ' badge rows are back and the catalog has '
                             || (select count(*) from public.achievements) || ' badges again. The archive is now '
                             || current_setting('v112undo.renamed', true) || '.'
         else 'v112 is not in place (there is no archive_v112.runs). This run changed nothing.'
       end as v112_undo,
       nullif(split_part(current_setting('v112undo.counts', true), ',', 1), '')::int as badges_back,
       nullif(split_part(current_setting('v112undo.counts', true), ',', 2), '')::int as student_gone,
       nullif(split_part(current_setting('v112undo.counts', true), ',', 3), '')::int as held_again,
       nullif(split_part(current_setting('v112undo.counts', true), ',', 4), '')::int as badge_gone,
       nullif(split_part(current_setting('v112undo.counts', true), ',', 5), '')::int as catalog_rows_back,
       nullif(split_part(current_setting('v112undo.counts', true), ',', 6), '')::int as completed_at_real_kept,
       nullif(current_setting('v112undo.renamed', true), '') as archive_renamed_to;
-- EXPECT: one row, "v112 is undone: N badge rows are back and the catalog has
-- 10 badges again. The archive is now archive_v112_undone_<time>.", then the
-- counts: student_gone, held_again and badge_gone are the rows left as they
-- are now, and why; catalog_rows_back is 2 (Region Sweep and Two Weeks
-- Strong); completed_at_real_kept the rows whose value is kept in the renamed
-- archive. A second paste says "v112 is not in place" and changes nothing;
-- v112 can then run again. If the file stopped with a message ending "Nothing
-- was changed.", it is true: the whole file is one transaction.
