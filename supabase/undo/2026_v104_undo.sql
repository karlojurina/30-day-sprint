-- ============================================================
-- UNDO for v104 (supabase/migrations/2026_v104_course_switch.sql)
--
-- NOT A MIGRATION. A file in supabase/undo/ is never run in sequence with
-- supabase/migrations/. This one is run by hand, and only to take the course
-- switch back. Then, in Vercel, take the evening's values back and redeploy
-- (the PRD's ship order, "Rollback").
--
-- WHAT IT DOES, in one transaction
--   First it locks every table it writes or alters (the 18 in "The lock"
--   below), so nothing a student does lands between a copy and its delete.
--   Until the commit, every read and write of those tables by the app waits
--   (a few seconds); a request that waits past its own statement timeout
--   fails.
--   1. Checks it can: the switch is in place (admin_config holds
--      curriculum_reset_at), archive_v1 holds the switch's record and agrees
--      with that row, archive_v2 does not exist yet, and the keys into lessons
--      and regions are still the six the switch made.
--   2. Makes the schema archive_v2 (no access for anon, authenticated or
--      service_role) and MOVES into it every row now in
--      student_lesson_completions, lesson_notes, student_lesson_ratings,
--      student_region_quiz, quizzes, quiz_questions, student_quiz_attempts,
--      student_achievements and student_lesson_watch. All of them were made
--      on the new course after the switch: nothing is deleted that is not
--      kept there.
--   3. Drops the six keys the switch made and its unique index on
--      lessons.whop_lesson_id, empties lessons and regions, and puts the old
--      course back from archive_v1, column for column.
--   4. Puts back every not-null and every check the switch recorded, then
--      the six retired badges, every progress row, and the watch and video
--      rows of old lessons, parents before children.
--   5. Re-adds the six keys under the names and with the definitions the
--      switch recorded from production's own catalogue. Nothing is retyped.
--   6. Takes back a Playbook stamp the switch set (only while it still holds
--      the value the switch wrote).
--   7. Takes back the CSM changes, from the copy of each row kept in
--      archive_v1.csm_changes: templates active again (those still off),
--      alerts open again, tasks open again where no open task exists now for
--      the same student and scenario. A reopened task's notes go back to the
--      copy only while they are still exactly what the switch wrote (the
--      copy's notes and the switch's line). When someone changed them since,
--      they stay as the team left them and are counted (task_notes_kept);
--      the copy stays in the renamed archive's csm_changes.
--   8. Deletes admin_config['curriculum_reset_at'] and renames archive_v1
--      to archive_v1_undone_<yyyymmdd_hh24mi>, in UTC.
--   9. Checks its own result, commits, and shows one row.
--
-- WHAT IT DOES NOT PUT BACK, stated plainly
--   * A row of an archived student who no longer exists in students: it
--     stays in the renamed archive and is counted in the result
--     (not_restored_student_gone).
--   * A video row of an old lesson whose video id now sits on another
--     lesson: it stays in the renamed archive and is counted
--     (not_restored_video_taken).
--   * templates.updated_at: the trigger on templates stamps every update, so
--     a template switched back on shows the time of this undo.
--   * student_milestones.first_sprint_login_at where the switch filled it in
--     (archive_v1.stamps.set_first_login), and the student_milestones row
--     the switch created to hold it. That stamp is the student's earliest
--     completion, a true date on which they used the app, and the app never
--     rewrites it once set (the Whop login stamps it only while empty). It
--     stays after the undo.
--   * The notes of a reopened task that someone changed after the switch:
--     they stay as written, the switch's line included (see 7).
--   * Anything done on the new course: it is in archive_v2, not in the live
--     tables. Tasks the CSM created after the switch, discount requests,
--     streaks and snapshot rows are left as they are.
--   * A watch row on a new-course lesson made before the switch. None can
--     exist (v100 refuses a heartbeat on a lesson not in lessons), so every
--     watch row present now is treated as made after the switch.
--
-- WHEN IT REFUSES, changing nothing (every message ends "Nothing was changed.")
--   * No curriculum_reset_at: the switch is not in place.
--   * archive_v1.meta is missing, or its moment differs from that row.
--   * The schema archive_v2 exists: an earlier undo's record of new-course
--     progress. Check it, rename or drop it, then run this again.
--   * The keys into lessons or regions are not the six the switch made.
--
-- WHEN THE TABLES ARE BUSY
--   * Another session holds one of the 18 tables for more than 5 seconds,
--     or the wait for it ends in a deadlock: "Another session held a table
--     the undo changes for more than 5 seconds (...). Nothing was changed.
--     Paste it again in a minute."
--   * The same wait later in the file shows Postgres's own words, "canceling
--     statement due to lock timeout" (SQLSTATE 55P03). Nothing was changed.
--     Paste it again in a minute.
--
-- After it, the switch can run again (it archives afresh into a new
-- archive_v1). v103's undo can run once this has.
--
-- Safe to run again: a second run finds no curriculum_reset_at and refuses.
-- ============================================================

begin;

-- The switch recorded its key definitions under this search path.
set local search_path = public;

-- ─────────────── The lock ───────────────
--
-- Under READ COMMITTED every statement below sees what other sessions have
-- committed by then. A completion committed after step 2 copies a table
-- into archive_v2 and before it deletes from it would be deleted and kept
-- nowhere. So, before anything is read, every table this file writes or
-- alters is locked in the strongest mode until the commit, the same 18 the
-- switch locks, parents first. A table that does not exist is left alone.
--
-- Each lock waits at most 5 seconds. When one is held longer, or the wait
-- ends in a deadlock, the file stops with the sentence below. A lock wait
-- later in the file stops with Postgres's own words (SQLSTATE 55P03,
-- "canceling statement due to lock timeout"). Either way nothing was
-- changed: paste it again in a minute.

set local lock_timeout = '5s';

do $lock$
declare
  c_tables constant text[] := array['admin_config', 'regions', 'lessons', 'lesson_videos', 'achievements',
    'quizzes', 'quiz_questions', 'templates', 'student_milestones', 'student_lesson_completions',
    'student_lesson_watch', 'lesson_notes', 'student_lesson_ratings', 'student_quiz_attempts',
    'student_region_quiz', 'student_achievements', 'tasks', 'disengagement_alerts'];
  v_list text;
begin
  select string_agg(format('public.%I', t), ', ' order by o) into v_list
    from unnest(c_tables) with ordinality as x(t, o)
   where to_regclass('public.' || t) is not null;
  if v_list is not null then
    execute 'lock table ' || v_list || ' in access exclusive mode';
  end if;
exception when lock_not_available or deadlock_detected then
  raise exception 'Another session held a table the undo changes for more than 5 seconds (%), so the undo did not start. Nothing was changed. Paste it again in a minute.', sqlerrm
    using errcode = sqlstate;
end
$lock$;

-- ─────────────── 1. It can be undone ───────────────

do $guard$
declare
  c_needed constant text[] := array['meta', 'regions', 'lessons', 'student_lesson_completions', 'lesson_notes',
    'student_lesson_ratings', 'quizzes', 'quiz_questions', 'student_quiz_attempts', 'student_region_quiz',
    'student_achievements', 'achievements', 'student_milestones', 'student_lesson_watch', 'lesson_videos',
    'stamps', 'csm_changes', 'constraints', 'not_nulls'];
  c_keys constant text := 'fk_lesson_notes_lesson_id, fk_lessons_region_id, fk_quizzes_region_id, '
    || 'fk_student_lesson_completions_lesson_id, fk_student_lesson_ratings_lesson_id, fk_student_region_quiz_region_id';
  v_at    text;
  v_meta  timestamptz;
  v_found text;
begin
  select value into v_at from public.admin_config where key = 'curriculum_reset_at';
  if v_at is null then
    raise exception 'admin_config holds no curriculum_reset_at: the course switch is not in place, so there is nothing to undo. Nothing was changed.';
  end if;
  if to_regclass('archive_v1.meta') is null then
    raise exception 'The switch is in place since %, and archive_v1.meta is missing. Without the archive the old course cannot be put back. Nothing was changed.', v_at;
  end if;
  select string_agg(t, ', ') into v_found from unnest(c_needed) as t where to_regclass('archive_v1.' || t) is null;
  if v_found is not null then
    raise exception 'archive_v1 is missing: %. Nothing was changed.', v_found;
  end if;
  select reset_at into v_meta from archive_v1.meta;
  if to_char(v_meta at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') is distinct from v_at then
    raise exception 'archive_v1.meta says the switch ran at %, and admin_config says %. They must agree. Nothing was changed.', v_meta, v_at;
  end if;
  if to_regnamespace('archive_v2') is not null then
    raise exception 'The schema archive_v2 exists: the record of new-course progress from an earlier undo. Check it, rename or drop it, then run this again. Nothing was changed.';
  end if;
  if to_regnamespace('archive_v1_undone_' || to_char(now() at time zone 'UTC', 'YYYYMMDD_HH24MI')) is not null then
    raise exception 'The schema archive_v1_undone_% exists already. Wait a minute and run this again. Nothing was changed.', to_char(now() at time zone 'UTC', 'YYYYMMDD_HH24MI');
  end if;
  select string_agg(conname, ', ' order by conname collate "C") into v_found
    from pg_constraint
   where contype = 'f' and confrelid in ('public.lessons'::regclass, 'public.regions'::regclass);
  if v_found is distinct from c_keys then
    raise exception 'The keys that point at lessons or regions must be the six the switch made: %. Found: %. A key added since would block the undo or lose its rows. Nothing was changed.', c_keys, coalesce(v_found, 'none');
  end if;
end
$guard$;

-- ─────────────── 2. Progress on the new course moves to archive_v2 ───────────────

do $move$
declare
  -- Children first, so each delete leaves no row pointing at a deleted one.
  c_moved constant text[] := array['student_quiz_attempts', 'quiz_questions', 'quizzes', 'student_region_quiz',
    'student_lesson_ratings', 'lesson_notes', 'student_lesson_completions', 'student_achievements',
    'student_lesson_watch'];
  t        text;
  v_n      bigint;
  v_counts jsonb := '{}'::jsonb;
begin
  create schema archive_v2;
  revoke all on schema archive_v2 from public, anon, authenticated, service_role;
  foreach t in array c_moved loop
    execute format('create table archive_v2.%I as table public.%I', t, t);
    execute format('delete from public.%I', t);
    get diagnostics v_n = row_count;
    v_counts := v_counts || jsonb_build_object(t, v_n);
  end loop;
  create table archive_v2.meta (undone_at timestamptz not null, ran_by text not null,
                                switch_of timestamptz not null, counts jsonb not null);
  insert into archive_v2.meta select now(), current_user, m.reset_at, v_counts from archive_v1.meta m;
  revoke all on all tables in schema archive_v2 from public, anon, authenticated, service_role;
  perform set_config('cutover.undo_moved', v_counts::text, false);
end
$move$;

-- ─────────────── 3. The new catalog out, the old one back ───────────────

alter table public.lessons                    drop constraint if exists fk_lessons_region_id;
alter table public.student_lesson_completions drop constraint if exists fk_student_lesson_completions_lesson_id;
alter table public.lesson_notes               drop constraint if exists fk_lesson_notes_lesson_id;
alter table public.student_lesson_ratings     drop constraint if exists fk_student_lesson_ratings_lesson_id;
alter table public.quizzes                    drop constraint if exists fk_quizzes_region_id;
alter table public.student_region_quiz        drop constraint if exists fk_student_region_quiz_region_id;
drop index if exists public.lessons_whop_lesson_id_key;

delete from public.lessons;
delete from public.regions;

-- ─────────────── 4. The old rows back, parents before children ───────────────
--
-- Every insert names the archive's own columns, so a column the live table
-- gained since the switch takes its default. A row whose student no longer
-- exists, or an old video whose id another lesson now holds, stays in the
-- archive and is counted.

do $restore$
declare
  -- table, and the rows of it that may come back
  c_back constant text[][] := array[
    ['regions',                    'true'],
    ['lessons',                    'true'],
    ['achievements',               'a.id in (''r1_clear'', ''r2_clear'', ''r3_clear'', ''r4_clear'', ''early_finisher'', ''speedrun'') and not exists (select 1 from public.achievements x where x.id = a.id)'],
    ['student_lesson_completions', 'a.student_id in (select id from public.students)'],
    ['lesson_notes',               'a.student_id in (select id from public.students)'],
    ['student_lesson_ratings',     'a.student_id in (select id from public.students)'],
    ['quizzes',                    'true'],
    ['quiz_questions',             'true'],
    ['student_quiz_attempts',      'a.student_id in (select id from public.students)'],
    ['student_region_quiz',        'a.student_id in (select id from public.students)'],
    ['student_achievements',       'a.student_id in (select id from public.students)'],
    ['student_lesson_watch',       'a.student_id in (select id from public.students)'],
    ['lesson_videos',              'not exists (select 1 from public.lesson_videos x where x.tella_video_id = a.tella_video_id or x.lesson_id = a.lesson_id)']];
  r        record;
  i        int;
  t        text;
  v_cols   text;
  v_n      bigint;
  v_all    bigint;
  v_back   jsonb := '{}'::jsonb;
  v_gone   bigint := 0;
  v_taken  bigint := 0;
begin
  for i in 1 .. array_length(c_back, 1) loop
    t := c_back[i][1];
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into v_cols
      from information_schema.columns where table_schema = 'archive_v1' and table_name = t;
    execute format('insert into public.%I (%s) select %s from archive_v1.%I a where %s', t, v_cols, v_cols, t, c_back[i][2]);
    get diagnostics v_n = row_count;
    v_back := v_back || jsonb_build_object(t, v_n);
    if t <> 'achievements' then
      execute format('select count(*) from archive_v1.%I', t) into v_all;
      if t = 'lesson_videos' then v_taken := v_taken + (v_all - v_n);
      else v_gone := v_gone + (v_all - v_n);
      end if;
    end if;

    -- Once the catalog is back, the constraints the new course could not
    -- meet go back on, exactly as the switch recorded them.
    if t = 'lessons' then
      for r in select table_name, column_name from archive_v1.not_nulls loop
        execute format('alter table public.%I alter column %I set not null', r.table_name, r.column_name);
      end loop;
      for r in select table_name, conname, definition from archive_v1.constraints where definition not like 'FOREIGN KEY%' loop
        execute format('alter table public.%I add constraint %I %s', r.table_name, r.conname, r.definition);
      end loop;
    end if;
  end loop;

  -- The six keys, under their recorded names and definitions.
  for r in select table_name, conname, definition from archive_v1.constraints where definition like 'FOREIGN KEY%' loop
    execute format('alter table public.%I add constraint %I %s', r.table_name, r.conname, r.definition);
  end loop;

  perform set_config('cutover.undo_back', (v_back || jsonb_build_object(
    'not_restored_student_gone', v_gone, 'not_restored_video_taken', v_taken))::text, false);
end
$restore$;

-- ─────────────── 5. The stamps and the CSM changes taken back ───────────────

do $revert$
declare
  -- The line v104 step 4 appends to each task it dismisses, word for word.
  c_note     constant text := 'Dismissed by the course switch: the old course''s progress was reset.';
  v_reset    timestamptz;
  v_playbook bigint;
  v_tmpl     bigint;
  v_alerts   bigint;
  v_tasks    bigint;
  v_notes    bigint;
  v_kept     bigint;
begin
  select reset_at into v_reset from archive_v1.meta;

  update public.student_milestones m
     set playbook_unlocked_at = null
    from archive_v1.stamps s
   where s.student_id = m.student_id and s.set_playbook and m.playbook_unlocked_at = v_reset;
  get diagnostics v_playbook = row_count;

  -- The first login the switch filled in stays, and with it any row the
  -- switch created to hold it (every such row holds one). See the header.

  update public.templates t
     set is_active = true
    from archive_v1.csm_changes c
   where c.kind = 'template' and c.id = t.id::text and not t.is_active;
  get diagnostics v_tmpl = row_count;

  update public.disengagement_alerts a
     set is_dismissed = b.is_dismissed, dismissed_at = b.dismissed_at, dismissed_by = b.dismissed_by
    from archive_v1.csm_changes c
    cross join lateral jsonb_populate_record(null::public.disengagement_alerts, c.before) b
   where c.kind = 'alert' and c.id = a.id::text and a.is_dismissed and a.dismissed_at = v_reset;
  get diagnostics v_alerts = row_count;

  -- The notes go back to the copy only while they are still exactly what the
  -- switch wrote (its concat_ws, the same expression). Notes the team changed
  -- since stay as they are: putting the copy back would erase their words,
  -- and appending it would repeat the old text the edit usually kept.
  select count(*) into v_kept from archive_v1.csm_changes where kind = 'task';
  with reopened as (
    update public.tasks k
       set status = b.status, dismissed_at = b.dismissed_at, dismissed_by = b.dismissed_by,
           notes = case when k.notes is not distinct from concat_ws(E'\n', b.notes, c_note) then b.notes else k.notes end
      from archive_v1.csm_changes c
      cross join lateral jsonb_populate_record(null::public.tasks, c.before) b
     where c.kind = 'task' and c.id = k.id::text
       and k.status = 'dismissed' and k.dismissed_at = v_reset
       and not exists (select 1 from public.tasks o
                        where o.status = 'open' and o.student_id = k.student_id and o.scenario_id = k.scenario_id)
    returning k.notes is distinct from b.notes as notes_kept)
  select count(*), count(*) filter (where notes_kept) into v_tasks, v_notes from reopened;

  perform set_config('cutover.undo_revert', jsonb_build_object(
    'playbook_stamps_cleared', v_playbook, 'templates_reactivated', v_tmpl, 'alerts_reopened', v_alerts,
    'tasks_reopened', v_tasks, 'task_notes_kept', v_notes, 'tasks_left_dismissed', v_kept - v_tasks)::text, false);
end
$revert$;

-- ─────────────── 6. The moment out, the archive renamed ───────────────

do $close$
declare
  v_name text := 'archive_v1_undone_' || to_char(now() at time zone 'UTC', 'YYYYMMDD_HH24MI');
begin
  delete from public.admin_config where key = 'curriculum_reset_at';
  execute format('alter schema archive_v1 rename to %I', v_name);
  perform set_config('cutover.undo_archive', v_name, false);
end
$close$;

-- ─────────────── 7. The result is checked before it is kept ───────────────

do $check$
declare
  v_arch  text := current_setting('cutover.undo_archive');
  v_back  jsonb := current_setting('cutover.undo_back')::jsonb;
  r       record;
  v_n     bigint;
  v_want  bigint;
  v_found text;
begin
  if exists (select 1 from public.admin_config where key = 'curriculum_reset_at') then
    raise exception 'curriculum_reset_at is still in admin_config. Nothing was changed.';
  end if;
  if exists (select 1 from public.lessons where id like 'a%') or not exists (select 1 from public.lessons where id = 'l078') then
    raise exception 'public.lessons does not hold the old course after the undo. Nothing was changed.';
  end if;
  foreach v_found in array array['regions', 'lessons'] loop
    execute format('select count(*) from public.%I', v_found) into v_n;
    execute format('select count(*) from %I.%I', v_arch, v_found) into v_want;
    if v_n <> v_want then
      raise exception 'public.% holds % rows after the undo, and the archive % rows. Nothing was changed.', v_found, v_n, v_want;
    end if;
  end loop;
  for r in execute format('select table_name, conname, definition from %I.constraints', v_arch) loop
    if not exists (select 1 from pg_constraint c join pg_class cl on cl.oid = c.conrelid
                    where cl.relname = r.table_name and c.connamespace = 'public'::regnamespace
                      and c.conname = r.conname and pg_get_constraintdef(c.oid) = r.definition) then
      raise exception 'The constraint % on % did not come back as recorded. Nothing was changed.', r.conname, r.table_name;
    end if;
  end loop;
  for r in execute format('select table_name, column_name from %I.not_nulls', v_arch) loop
    if not exists (select 1 from pg_attribute where attrelid = ('public.' || quote_ident(r.table_name))::regclass
                     and attname = r.column_name and attnotnull) then
      raise exception '%.% did not get its not-null back. Nothing was changed.', r.table_name, r.column_name;
    end if;
  end loop;
  if exists (select 1 from pg_constraint where conname like 'fk\_%' and contype = 'f'
               and confrelid in ('public.lessons'::regclass, 'public.regions'::regclass))
     or to_regclass('public.lessons_whop_lesson_id_key') is not null then
    raise exception 'A key or the index the switch made is still in place. Nothing was changed.';
  end if;
  if to_regnamespace('archive_v1') is not null or to_regnamespace(v_arch) is null then
    raise exception 'archive_v1 was not renamed to %. Nothing was changed.', v_arch;
  end if;
end
$check$;

commit;

-- ─────────────── What the undo did ───────────────

with
  moved  as (select coalesce(current_setting('cutover.undo_moved', true), '')  as j),
  back   as (select coalesce(current_setting('cutover.undo_back', true), '')   as j),
  revert as (select coalesce(current_setting('cutover.undo_revert', true), '') as j)
select
  case when (select j from back) = '' then 'This select ran on its own; run the whole file to see what it did.'
       else 'The switch is taken back. The old course is live again.' end          as undone,
  nullif(current_setting('cutover.undo_archive', true), '')                       as archive_renamed_to,
  (select nullif(j, '')::jsonb ->> 'student_lesson_completions' from moved)::int  as moved_completions,
  (select nullif(j, '')::jsonb ->> 'lesson_notes' from moved)::int                as moved_notes,
  (select nullif(j, '')::jsonb ->> 'student_achievements' from moved)::int        as moved_badges,
  (select nullif(j, '')::jsonb ->> 'student_lesson_watch' from moved)::int        as moved_watch_rows,
  (select nullif(j, '')::jsonb ->> 'student_lesson_completions' from back)::int   as restored_completions,
  (select nullif(j, '')::jsonb ->> 'lesson_notes' from back)::int                 as restored_notes,
  (select nullif(j, '')::jsonb ->> 'student_achievements' from back)::int         as restored_badges,
  (select nullif(j, '')::jsonb ->> 'not_restored_student_gone' from back)::int    as not_restored_student_gone,
  (select nullif(j, '')::jsonb ->> 'not_restored_video_taken' from back)::int     as not_restored_video_taken,
  (select nullif(j, '')::jsonb ->> 'playbook_stamps_cleared' from revert)::int    as playbook_stamps_cleared,
  (select nullif(j, '')::jsonb ->> 'templates_reactivated' from revert)::int      as templates_reactivated,
  (select nullif(j, '')::jsonb ->> 'tasks_reopened' from revert)::int             as tasks_reopened,
  (select nullif(j, '')::jsonb ->> 'task_notes_kept' from revert)::int            as task_notes_kept,
  (select nullif(j, '')::jsonb ->> 'tasks_left_dismissed' from revert)::int       as tasks_left_dismissed,
  (select nullif(j, '')::jsonb ->> 'alerts_reopened' from revert)::int            as alerts_reopened;
-- EXPECT one row: "The switch is taken back.", the new name of the archive,
-- what moved to archive_v2 and what came back from the archive. The two
-- not_restored counts should be 0; anything else is in the renamed archive.
-- tasks_left_dismissed counts tasks the switch dismissed that stay dismissed
-- because an open task now exists for the same student and scenario.
-- task_notes_kept counts reopened tasks whose notes the team changed after
-- the switch; they keep the team's notes.
-- Then, in Vercel: take back NEXT_PUBLIC_STUDENT_HOME, NEXT_PUBLIC_WORLD_LIVE
-- and CATALOG_SHAPE, put WHOP_COURSE_ID back, and redeploy.
-- If the file stopped with a message saying "Nothing was changed.", it is
-- true: the whole file is one transaction. A stop on "canceling statement
-- due to lock timeout" (SQLSTATE 55P03) or "deadlock detected" (40P01) is
-- the same: nothing was changed. Paste it again in a minute.
