-- ============================================================
-- v104 — the cutover, part 2 of 2: THE SWITCH. Every student moves from the
--        old course (4 regions, lessons l001 to l078) to the new one (8
--        areas, 141 lessons), and the old progress goes into an archive.
--
-- Part of the cutover PRD (_admin/prds/cutover/cutover_prd.md, section 9.B).
-- Run it on the evening, in the order of the PRD's ship order: the Vercel
-- values first, then this file, then the redeploy at once.
--
-- WHAT THIS FILE DOES, in one transaction
--   First it locks every table it writes or alters (the 18 in "The lock"
--   below), so no student's write can land between the archive copy and
--   the wipe. Until the commit, every read and write of those tables by the
--   app waits (a few seconds); a request that waits past its own statement
--   timeout fails.
--   0. Looks for admin_config['curriculum_reset_at']. When it is there the
--      switch has already happened: every step below is skipped and the
--      final table says "The switch is already in place since <time>."
--   1. Checks that it is starting from the state it was written for, and
--      refuses with a sentence otherwise (see WHEN IT REFUSES).
--   2. Makes the schema archive_v1, with no access for anon, authenticated
--      or service_role, and copies into it every row of: regions, lessons,
--      student_lesson_completions, lesson_notes, student_lesson_ratings,
--      quizzes, quiz_questions, student_quiz_attempts, student_region_quiz,
--      student_achievements, achievements, student_milestones; and the rows
--      of student_lesson_watch and lesson_videos whose lesson is not in the
--      new course. archive_v1.meta records the moment, who ran it and how
--      many rows each copy holds.
--   3. Stamps the Playbook for every graduate of the old course (call C8):
--      a done l078 (the lesson holding playbook_unlock), or done lessons
--      numbering at least 80% of the old course's counting lessons, with no
--      30-day wait. student_milestones.playbook_unlocked_at = the moment.
--      Students with a completion and no first_sprint_login_at get the
--      earliest time on their completions. Each student touched is listed in
--      archive_v1.stamps.
--   4. Tidies the CSM queue (call C9). Templates whose trigger names a
--      lesson, an area, or progress_ratio / progress_label / region_pace are
--      deactivated. Open tasks of nolessons.*, noship.*, pace.* and of those
--      templates are dismissed, with a note. Open alerts no_tasks_7d and
--      no_lessons_3d are dismissed; no_login_5d stays. Each row changed is
--      listed in archive_v1.csm_changes with a copy of how it was.
--   5. Empties the progress tables, children first, never by cascade, and
--      takes away the six badges tied to the old regions or the 30-day clock
--      (call C3) and the watch and video rows of old lessons (call C11).
--   6. Records the six keys into lessons and regions, then drops them;
--      deletes the old catalog; records and drops what would refuse the new
--      one (lessons.day's not-null and check, regions' not-nulls and the
--      terrain check).
--   7. Copies regions_next and lessons_next into regions and lessons, Whop
--      lesson ids, lengths, texts, gate and feature keys included. Puts the
--      six keys back as ON DELETE RESTRICT under names of their own, and adds
--      a unique index on lessons.whop_lesson_id.
--   8. Writes admin_config['curriculum_reset_at'] = the moment, in UTC, like
--      2026-10-20T18:25:00.000Z. The app reads the switch from that row.
--   9. Checks its own result, then commits, then shows one table.
--
-- WHEN IT REFUSES, changing nothing (every message ends "Nothing was changed.")
--   * v103 has not run, or v100 has not (no lesson_videos).
--   * A table the switch touches is missing.
--   * The schema archive_v1 exists: an earlier switch's archive is still
--     there. The undo renames it; a leftover one is checked and renamed or
--     dropped by hand.
--   * lessons already holds a lesson of the new course, or has no l078.
--   * regions_next is not exactly a1 to a8 with order_num 1 to 8.
--   * lessons_next has fewer than 100 or more than 200 lessons, an id not
--     shaped like a3l07, a placeholder title, not exactly one gate, no
--     whop_lesson_id column, a lesson without a Whop lesson id, or one Whop
--     lesson id on two lessons.
--   * The keys that point at lessons or regions are not exactly these six:
--     lessons.region_id, student_lesson_completions.lesson_id,
--     lesson_notes.lesson_id, student_lesson_ratings.lesson_id,
--     quizzes.region_id, student_region_quiz.region_id. The message lists
--     the ones found.
--   * A column the copy needs is missing on either side, or lessons or
--     regions has a not-null column with no default that the copy leaves
--     empty. (Added by the builder: without it such a column fails the copy
--     with Postgres's own words. Same outcome, nothing changed.)
--
-- WHEN THE TABLES ARE BUSY
--   * Another session holds one of the 18 tables for more than 5 seconds,
--     or the wait for it ends in a deadlock: "Another session held a table
--     the switch changes for more than 5 seconds (...). Nothing was
--     changed. Paste it again in a minute."
--   * The same wait later in the file shows Postgres's own words, "canceling
--     statement due to lock timeout" (SQLSTATE 55P03). Nothing was changed.
--     Paste it again in a minute.
--
-- OPERATIONAL CONSEQUENCES, stated plainly
--   1. Every student starts the new course with nothing done. Lessons they
--      watched on Whop's new course come back at their next visit (the Whop
--      sync), and new ones at once (the webhook). Their streaks, notes of
--      the day, DM history and discount requests are not touched (call C10).
--   2. Every badge is gone from every student (archived). Six badges no
--      longer exist; every other one can be earned again.
--   3. Graduates keep the Playbook. The final table counts them; compare it
--      with the preflight's count before reading on.
--   4. The CSM queue loses its open course-bound tasks and two kinds of
--      alert, each with a note. The deactivated templates are listed by
--      supabase/diagnostics/cutover-preflight.sql; they stay off until the
--      team rewrites them.
--   5. The keys into lessons and regions become ON DELETE RESTRICT: no delete
--      of a lesson or an area can erase progress again. A lesson with any
--      completion, note or rating cannot be deleted at all.
--   6. From the moment it commits until the redeploy is Ready, the build
--      running on Vercel still has the old values. No cron runs in that
--      window if the PRD's time is kept, and the old discount check refuses.
--   7. lessons_next and regions_next are kept and still read by the two
--      private loads. v101 refuses to run after this file (it would change
--      only the staging tables).
--   8. daily_progress_snapshots: from now on no row dated before today (UTC)
--      can be rewritten (the floor of v103). Today's row, computed tonight,
--      shows the drop. That is real.
--
-- UNDO: supabase/undo/2026_v104_undo.sql. It puts the old course and every
-- archived row back, moves anything done on the new course into archive_v2,
-- and renames archive_v1.
--
-- Re-runnable: run again after it worked, it changes nothing and says so.
-- One transaction: a raise anywhere undoes everything above it.
-- ============================================================

begin;

-- pg_get_constraintdef writes a table without its schema when the schema is
-- on the search path. The undo re-adds the keys from what is recorded here,
-- so both run with the same path.
set local search_path = public;

-- ─────────────── The lock ───────────────
--
-- Under READ COMMITTED every statement below sees what other sessions have
-- committed by then. A completion the Whop webhook commits after the archive
-- copy (step 2) and before the wipe (step 5) would be deleted without ever
-- being archived, and step 9 could not tell. So, before anything is read,
-- every table this file writes or alters is locked in the strongest mode:
-- no other session reads or writes them until the commit, and no statement
-- below has to upgrade a weaker lock (the upgrade is where two sessions
-- deadlock). Parents first, then the rows students write. A table that does
-- not exist is left to step 1, which names it.
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
  raise exception 'Another session held a table the switch changes for more than 5 seconds (%), so the switch did not start. Nothing was changed. Paste it again in a minute.', sqlerrm
    using errcode = sqlstate;
end
$lock$;

-- ─────────────── 0. Already switched? ───────────────
--
-- The answer is kept in a session setting for the steps below and for the
-- final table. 'switching' means this run makes the switch.

do $state$
declare
  v_at text;
begin
  select value into v_at from public.admin_config where key = 'curriculum_reset_at';
  perform set_config('cutover.v104',
                     case when v_at is null then 'switching' else 'in place since ' || v_at end, false);
end
$state$;

-- ─────────────── 1. The starting point is the one this file was written for ───────────────

do $guard$
declare
  c_tables constant text[] := array['templates', 'tasks', 'disengagement_alerts', 'quizzes', 'quiz_questions',
    'student_quiz_attempts', 'student_region_quiz', 'lesson_notes', 'student_lesson_ratings',
    'student_lesson_watch', 'student_lesson_completions', 'student_achievements', 'achievements',
    'student_milestones', 'lessons', 'regions', 'lessons_next', 'regions_next', 'admin_config'];
  c_keys constant text := 'lesson_notes.lesson_id, lessons.region_id, quizzes.region_id, '
    || 'student_lesson_completions.lesson_id, student_lesson_ratings.lesson_id, student_region_quiz.region_id';
  -- The columns step 7 copies, and the not-nulls step 6 drops.
  c_lesson_cols constant text[] := array['id', 'region_id', 'type', 'title', 'description', 'sort_order',
    'requires_action', 'action_brief', 'is_optional', 'is_gate', 'lesson_group_id', 'discord_channel',
    'counts_toward_progress', 'feature_key', 'bunny_video_id', 'duration_seconds', 'video_ready_at',
    'whop_lesson_id', 'created_at', 'updated_at'];
  c_region_cols constant text[] := array['id', 'order_num', 'name', 'subtitle', 'tagline', 'terrain',
    'landmark_label', 'rail_at', 'quiz_format', 'is_discount_gate', 'created_at'];
  c_lesson_relaxed constant text[] := array['day'];
  c_region_relaxed constant text[] := array['subtitle', 'tagline', 'terrain', 'days_label', 'day_start', 'day_end'];
  v_found text;
  v_n     bigint;
begin
  if current_setting('cutover.v104') <> 'switching' then return; end if;

  -- v103 and v100
  select string_agg(x.what, ', ') into v_found
    from (values
      ('student_milestones.playbook_unlocked_at',
         exists (select 1 from information_schema.columns where table_schema = 'public'
                   and table_name = 'student_milestones' and column_name = 'playbook_unlocked_at')),
      ('regions.landmark_label and regions.rail_at',
         (select count(*) = 2 from information_schema.columns where table_schema = 'public'
            and table_name = 'regions' and column_name in ('landmark_label', 'rail_at'))),
      ('the view student_last_counted_completion',
         to_regclass('public.student_last_counted_completion') is not null),
      ('the trigger trg_daily_snapshots_reset_floor',
         exists (select 1 from pg_trigger where not tgisinternal and tgname = 'trg_daily_snapshots_reset_floor'
                   and tgrelid = to_regclass('public.daily_progress_snapshots')))
    ) as x(what, there)
   where not x.there;
  if v_found is not null then
    raise exception 'Migration 2026_v103_cutover_expand.sql has not run here: % missing. Run it first, then this file. Nothing was changed.', v_found;
  end if;
  if to_regclass('public.lesson_videos') is null then
    raise exception 'public.lesson_videos does not exist. Run migration 2026_v100_lesson_videos_and_speed.sql first. Nothing was changed.';
  end if;

  select string_agg(t, ', ') into v_found from unnest(c_tables) as t where to_regclass('public.' || t) is null;
  if v_found is not null then
    raise exception 'These tables do not exist: %. The switch archives or changes each of them. Nothing was changed.', v_found;
  end if;

  if to_regnamespace('archive_v1') is not null then
    raise exception 'An archive from an earlier switch is still here (schema archive_v1); the undo renames it. Check it, rename or drop it, then run this again. Nothing was changed.';
  end if;

  -- The live catalog holds the old course
  select string_agg(id, ', ' order by id) into v_found from public.lessons where id like 'a%';
  if v_found is not null then
    raise exception 'public.lessons already holds lessons of the new course (%). This file expects the old course there. Nothing was changed.', v_found;
  end if;
  if not exists (select 1 from public.lessons where id = 'l078') then
    raise exception 'public.lessons has no l078, the last lesson of the old course. This file expects the old course there. Nothing was changed.';
  end if;

  -- The staging catalog holds the new course
  select string_agg(id || ':' || order_num, ', ' order by order_num, id) into v_found from public.regions_next;
  if v_found is distinct from 'a1:1, a2:2, a3:3, a4:4, a5:5, a6:6, a7:7, a8:8' then
    raise exception 'public.regions_next must hold exactly the areas a1 to a8 with order_num 1 to 8, and it holds: %. Nothing was changed.', coalesce(v_found, 'no rows');
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
                   and table_name = 'lessons_next' and column_name = 'whop_lesson_id') then
    raise exception 'public.lessons_next has no whop_lesson_id column. Run the current supabase/migrations/2026_v101_course_catalog.sql first. Nothing was changed.';
  end if;
  select count(*) into v_n from public.lessons_next;
  if v_n not between 100 and 200 then
    raise exception 'public.lessons_next holds % lessons. The new course has between 100 and 200. Nothing was changed.', v_n;
  end if;
  select string_agg(id, ', ' order by id) into v_found from public.lessons_next where id !~ '^a[1-8]l[0-9]{2}$';
  if v_found is not null then
    raise exception 'public.lessons_next holds ids that are not course lesson ids (like a3l07): %. Nothing was changed.', v_found;
  end if;
  select string_agg(id, ', ' order by id) into v_found
    from public.lessons_next where region_id not in (select id from public.regions_next);
  if v_found is not null then
    raise exception 'These lessons of public.lessons_next sit in no area of public.regions_next: %. Nothing was changed.', v_found;
  end if;
  select count(*) into v_n from public.lessons_next where title like '% · lesson %';
  if v_n > 0 then
    raise exception 'public.lessons_next still holds % placeholder lessons (titled like "Fundamentals · lesson 3"). Run the current supabase/migrations/2026_v101_course_catalog.sql first. Nothing was changed.', v_n;
  end if;
  select string_agg(id, ', ' order by id) into v_found from public.lessons_next where is_gate;
  if v_found is null or v_found like '%,%' then
    raise exception 'public.lessons_next must mark exactly one lesson as the gate, and it marks: %. Nothing was changed.', coalesce(v_found, 'none');
  end if;
  select string_agg(id, ', ' order by id) into v_found from public.lessons_next where whop_lesson_id is null;
  if v_found is not null then
    raise exception 'These lessons of public.lessons_next have no Whop lesson id: %. The Whop sync finds a lesson by it. Nothing was changed.', v_found;
  end if;
  select string_agg(w, ', ' order by w) into v_found
    from (select whop_lesson_id as w from public.lessons_next group by whop_lesson_id having count(*) > 1) d;
  if v_found is not null then
    raise exception 'These Whop lesson ids are on more than one lesson of public.lessons_next: %. A Whop lesson belongs to one lesson. Nothing was changed.', v_found;
  end if;

  -- The keys into the catalog are the six this file puts back
  select string_agg(k, ', ' order by k collate "C") into v_found
    from (select c.conrelid::regclass::text || '.' || a.attname as k
            from pg_constraint c
            join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
           where c.contype = 'f'
             and c.confrelid in ('public.lessons'::regclass, 'public.regions'::regclass)) f;
  if v_found is distinct from c_keys then
    raise exception 'The keys that point at lessons or regions must be exactly these six: %. Found: %. The switch drops and re-adds each of them by name; a key it does not know would block the switch or lose its rows. Nothing was changed.', c_keys, coalesce(v_found, 'none');
  end if;

  -- Every column the copy names is on both sides
  select string_agg(x, ', ' order by x) into v_found from (
      select 'lessons.' || c as x from unnest(c_lesson_cols) c
       where not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'lessons' and column_name = c)
      union all
      select 'lessons_next.' || c from unnest(c_lesson_cols) c
       where not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'lessons_next' and column_name = c)
      union all
      select 'regions.' || c from unnest(c_region_cols) c
       where not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'regions' and column_name = c)
      union all
      select 'regions_next.' || c from unnest(c_region_cols) c
       where not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'regions_next' and column_name = c)
    ) m;
  if v_found is not null then
    raise exception 'The copy needs these columns and they are missing: %. Nothing was changed.', v_found;
  end if;

  -- A not-null column with no default that the copy leaves empty would fail it
  select string_agg(cl.relname || '.' || a.attname, ', ' order by cl.relname, a.attname) into v_found
    from pg_attribute a
    join pg_class cl on cl.oid = a.attrelid
   where a.attrelid in ('public.lessons'::regclass, 'public.regions'::regclass)
     and a.attnum > 0 and not a.attisdropped and a.attnotnull and not a.atthasdef
     and not (cl.relname = 'lessons' and a.attname = any (c_lesson_cols || c_lesson_relaxed))
     and not (cl.relname = 'regions' and a.attname = any (c_region_cols || c_region_relaxed));
  if v_found is not null then
    raise exception 'These columns refuse an empty value, have no default, and the copy does not fill them: %. The new course has nothing to put there. Nothing was changed.', v_found;
  end if;
end
$guard$;

-- ─────────────── 2. The archive ───────────────
--
-- Every table is copied whole, with its columns and no constraints. The
-- counts go into archive_v1.meta from the live tables, before the copy, and
-- step 9 checks every copy against them.

do $archive$
declare
  c_whole constant text[] := array['regions', 'lessons', 'student_lesson_completions', 'lesson_notes',
    'student_lesson_ratings', 'quizzes', 'quiz_questions', 'student_quiz_attempts', 'student_region_quiz',
    'student_achievements', 'achievements', 'student_milestones'];
  t        text;
  v_n      bigint;
  v_counts jsonb := '{}'::jsonb;
begin
  if current_setting('cutover.v104') <> 'switching' then return; end if;

  create schema archive_v1;
  revoke all on schema archive_v1 from public, anon, authenticated, service_role;

  foreach t in array c_whole loop
    execute format('select count(*) from public.%I', t) into v_n;
    v_counts := v_counts || jsonb_build_object(t, v_n);
    execute format('create table archive_v1.%I as table public.%I', t, t);
  end loop;

  -- Watch and video rows only on lessons the new course does not have (C11).
  select count(*) into v_n from public.student_lesson_watch
   where lesson_id not in (select id from public.lessons_next);
  v_counts := v_counts || jsonb_build_object('student_lesson_watch', v_n);
  create table archive_v1.student_lesson_watch as
    select w.* from public.student_lesson_watch w
     where w.lesson_id not in (select id from public.lessons_next);

  select count(*) into v_n from public.lesson_videos
   where lesson_id not in (select id from public.lessons_next);
  v_counts := v_counts || jsonb_build_object('lesson_videos', v_n);
  create table archive_v1.lesson_videos as
    select v.* from public.lesson_videos v
     where v.lesson_id not in (select id from public.lessons_next);

  -- The record of the switch itself.
  create table archive_v1.meta (reset_at timestamptz not null, ran_by text not null, counts jsonb not null);
  insert into archive_v1.meta values (now(), current_user, v_counts);

  create table archive_v1.stamps (
    student_id      uuid primary key,
    row_existed     boolean not null,
    set_playbook    boolean not null,
    set_first_login boolean not null);
  -- before: the row as it was, so the undo can put back exactly that.
  -- (The PRD lists kind and id. The copy is the builder's addition.)
  create table archive_v1.csm_changes (kind text not null, id text not null, before jsonb not null,
                                       primary key (kind, id));
  create table archive_v1.constraints (table_name text not null, conname text not null, definition text not null);
  create table archive_v1.not_nulls (table_name text not null, column_name text not null);

  -- Nobody but the owner reads the archive.
  revoke all on all tables in schema archive_v1 from public, anon, authenticated, service_role;
end
$archive$;

-- ─────────────── 3. The Playbook, and the first login ───────────────
--
-- A graduate: a done row on the lesson holding playbook_unlock (l078), or done
-- rows on any lessons numbering at least ceil(0.8 x the counting lessons).
-- The Playbook page divides every done lesson, l057 included, by the counting
-- lessons, so every done lesson is counted here too, and no 30-day wait.
-- "Done" is lesson_is_complete(), the one definition (v92).

do $stamps$
begin
  if current_setting('cutover.v104') <> 'switching' then return; end if;

  with done as (
    select c.student_id, l.feature_key
      from public.student_lesson_completions c
      join public.lessons l on l.id = c.lesson_id
     where public.lesson_is_complete(l.requires_action, c.completed_at, c.action_completed_at, c.skipped_at)
  ),
  graduates as (
    select student_id from done where feature_key = 'playbook_unlock'
    union
    select student_id from done group by student_id
    having count(*) >= ceil(0.8 * (select count(*) from public.lessons where counts_toward_progress))
  ),
  first_seen as (
    select student_id, min(least(completed_at, skipped_at, action_completed_at)) as at
      from public.student_lesson_completions
     group by student_id
  ),
  touched as (
    select s.id as student_id,
           (m.student_id is not null)                                                      as row_existed,
           (g.student_id is not null and m.playbook_unlocked_at is null)                   as set_playbook,
           (f.at is not null and m.first_sprint_login_at is null)                          as set_first_login
      from public.students s
      left join public.student_milestones m on m.student_id = s.id
      left join graduates g on g.student_id = s.id
      left join first_seen f on f.student_id = s.id
  )
  insert into archive_v1.stamps (student_id, row_existed, set_playbook, set_first_login)
  select student_id, row_existed, set_playbook, set_first_login
    from touched where set_playbook or set_first_login;

  insert into public.student_milestones (student_id)
  select student_id from archive_v1.stamps where not row_existed;

  update public.student_milestones m
     set playbook_unlocked_at = now()
    from archive_v1.stamps s
   where s.student_id = m.student_id and s.set_playbook;

  update public.student_milestones m
     set first_sprint_login_at = f.at
    from archive_v1.stamps s,
         (select student_id, min(least(completed_at, skipped_at, action_completed_at)) as at
            from public.student_lesson_completions group by student_id) f
   where s.student_id = m.student_id and f.student_id = m.student_id and s.set_first_login;
end
$stamps$;

-- ─────────────── 4. The CSM queue ───────────────

do $csm$
begin
  if current_setting('cutover.v104') <> 'switching' then return; end if;

  -- Templates whose trigger names a lesson, an area, or one of the three
  -- metrics that read the old course's shape.
  insert into archive_v1.csm_changes (kind, id, before)
  select 'template', t.id::text, to_jsonb(t)
    from public.templates t
   where t.is_active
     and jsonb_typeof(t.trigger_config -> 'all') = 'array'
     and exists (select 1 from jsonb_array_elements(t.trigger_config -> 'all') e
                  where e ? 'lesson_id' or e ? 'region'
                     or e ->> 'metric' in ('progress_ratio', 'progress_label', 'region_pace'));
  update public.templates t
     set is_active = false
    from archive_v1.csm_changes c
   where c.kind = 'template' and c.id = t.id::text;

  insert into archive_v1.csm_changes (kind, id, before)
  select 'task', k.id::text, to_jsonb(k)
    from public.tasks k
   where k.status = 'open'
     and (k.scenario_id like 'nolessons.%' or k.scenario_id like 'noship.%' or k.scenario_id like 'pace.%'
          or k.template_id::text in (select id from archive_v1.csm_changes where kind = 'template'));
  update public.tasks k
     set status = 'dismissed',
         dismissed_at = now(),
         notes = concat_ws(E'\n', k.notes, 'Dismissed by the course switch: the old course''s progress was reset.')
    from archive_v1.csm_changes c
   where c.kind = 'task' and c.id = k.id::text;

  insert into archive_v1.csm_changes (kind, id, before)
  select 'alert', a.id::text, to_jsonb(a)
    from public.disengagement_alerts a
   where not a.is_dismissed and a.alert_type in ('no_tasks_7d', 'no_lessons_3d');
  update public.disengagement_alerts a
     set is_dismissed = true,
         dismissed_at = now()
    from archive_v1.csm_changes c
   where c.kind = 'alert' and c.id = a.id::text;
end
$csm$;

-- ─────────────── 5. The wipe: children first, never by cascade ───────────────

do $wipe$
begin
  if current_setting('cutover.v104') <> 'switching' then return; end if;

  delete from public.student_quiz_attempts;
  delete from public.quiz_questions;
  delete from public.quizzes;
  delete from public.student_region_quiz;
  delete from public.student_lesson_ratings;
  delete from public.lesson_notes;
  delete from public.student_lesson_completions;
  delete from public.student_achievements;
  delete from public.achievements
   where id in ('r1_clear', 'r2_clear', 'r3_clear', 'r4_clear', 'early_finisher', 'speedrun');
  delete from public.student_lesson_watch where lesson_id not in (select id from public.lessons_next);
  delete from public.lesson_videos        where lesson_id not in (select id from public.lessons_next);
end
$wipe$;

-- ─────────────── 6. The old catalog out ───────────────
--
-- Each key and each relaxed constraint is written into the archive as
-- Postgres states it, then dropped. The undo puts back exactly those texts.

do $out$
declare
  r record;
begin
  if current_setting('cutover.v104') <> 'switching' then return; end if;

  -- The six keys
  insert into archive_v1.constraints (table_name, conname, definition)
  select cl.relname, c.conname, pg_get_constraintdef(c.oid)
    from pg_constraint c join pg_class cl on cl.oid = c.conrelid
   where c.contype = 'f' and c.confrelid in ('public.lessons'::regclass, 'public.regions'::regclass);
  for r in select table_name, conname from archive_v1.constraints loop
    execute format('alter table public.%I drop constraint %I', r.table_name, r.conname);
  end loop;

  delete from public.lessons;
  delete from public.regions;

  -- Not-nulls the new course cannot fill
  insert into archive_v1.not_nulls (table_name, column_name)
  select cl.relname, a.attname
    from pg_attribute a join pg_class cl on cl.oid = a.attrelid
   where a.attnotnull and not a.attisdropped
     and ((a.attrelid = 'public.lessons'::regclass and a.attname = 'day')
       or (a.attrelid = 'public.regions'::regclass
           and a.attname in ('subtitle', 'tagline', 'terrain', 'days_label', 'day_start', 'day_end')));
  for r in select table_name, column_name from archive_v1.not_nulls loop
    execute format('alter table public.%I alter column %I drop not null', r.table_name, r.column_name);
  end loop;

  -- Checks on lessons.day and regions.terrain: the old course's 30 days and
  -- its four terrains. Found by the column they hold, never by name.
  for r in
    select cl.relname as table_name, c.conname, pg_get_constraintdef(c.oid) as definition
      from pg_constraint c join pg_class cl on cl.oid = c.conrelid
     where c.contype = 'c'
       and ((c.conrelid = 'public.lessons'::regclass
             and (select attnum from pg_attribute where attrelid = c.conrelid and attname = 'day') = any (c.conkey))
         or (c.conrelid = 'public.regions'::regclass
             and (select attnum from pg_attribute where attrelid = c.conrelid and attname = 'terrain') = any (c.conkey)))
  loop
    insert into archive_v1.constraints (table_name, conname, definition) values (r.table_name, r.conname, r.definition);
    execute format('alter table public.%I drop constraint %I', r.table_name, r.conname);
  end loop;
end
$out$;

-- ─────────────── 7. The new catalog in ───────────────

do $copy$
begin
  if current_setting('cutover.v104') <> 'switching' then return; end if;

  insert into public.regions (id, order_num, name, subtitle, tagline, terrain, landmark_label, rail_at,
                              quiz_format, is_discount_gate, created_at)
  select id, order_num, name, subtitle, tagline, terrain, landmark_label, rail_at,
         quiz_format, is_discount_gate, created_at
    from public.regions_next;

  insert into public.lessons (id, region_id, type, title, description, sort_order, requires_action, action_brief,
                              is_optional, is_gate, lesson_group_id, discord_channel, counts_toward_progress,
                              feature_key, bunny_video_id, duration_seconds, video_ready_at, whop_lesson_id,
                              created_at, updated_at)
  select id, region_id, type, title, description, sort_order, requires_action, action_brief,
         is_optional, is_gate, lesson_group_id, discord_channel, counts_toward_progress,
         feature_key, bunny_video_id, duration_seconds, video_ready_at, whop_lesson_id,
         created_at, updated_at
    from public.lessons_next;

  -- The six keys, back as RESTRICT under names of their own.
  alter table public.lessons
    add constraint fk_lessons_region_id foreign key (region_id) references public.regions (id) on delete restrict;
  alter table public.student_lesson_completions
    add constraint fk_student_lesson_completions_lesson_id foreign key (lesson_id) references public.lessons (id) on delete restrict;
  alter table public.lesson_notes
    add constraint fk_lesson_notes_lesson_id foreign key (lesson_id) references public.lessons (id) on delete restrict;
  alter table public.student_lesson_ratings
    add constraint fk_student_lesson_ratings_lesson_id foreign key (lesson_id) references public.lessons (id) on delete restrict;
  alter table public.quizzes
    add constraint fk_quizzes_region_id foreign key (region_id) references public.regions (id) on delete restrict;
  alter table public.student_region_quiz
    add constraint fk_student_region_quiz_region_id foreign key (region_id) references public.regions (id) on delete restrict;

  -- One Whop lesson belongs to one lesson. The webhook asks for one row.
  create unique index if not exists lessons_whop_lesson_id_key
    on public.lessons (whop_lesson_id) where whop_lesson_id is not null;
end
$copy$;

-- ─────────────── 8. The moment ───────────────

do $moment$
begin
  if current_setting('cutover.v104') <> 'switching' then return; end if;

  insert into public.admin_config (key, value, description)
  values ('curriculum_reset_at',
          to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'Set by migration 2026_v104 at the course switch. The CSM, achievements, admin pages and snapshots count from it. Do not edit; the undo of v104 removes it.');
end
$moment$;

-- ─────────────── 9. The result is checked before it is kept ───────────────
--
-- Any line that does not hold raises, and the raise undoes everything above.

do $check$
declare
  c_wiped constant text[] := array['student_quiz_attempts', 'quiz_questions', 'quizzes', 'student_region_quiz',
    'student_lesson_ratings', 'lesson_notes', 'student_lesson_completions', 'student_achievements'];
  c_keys constant text[] := array['fk_lessons_region_id', 'fk_student_lesson_completions_lesson_id',
    'fk_lesson_notes_lesson_id', 'fk_student_lesson_ratings_lesson_id', 'fk_quizzes_region_id',
    'fk_student_region_quiz_region_id'];
  t       text;
  v_n     bigint;
  v_want  bigint;
  v_found text;
  v_meta  record;
begin
  if current_setting('cutover.v104') <> 'switching' then return; end if;

  select count(*) into v_n from (
    (select id, order_num, name, subtitle, tagline, terrain, landmark_label, rail_at, quiz_format, is_discount_gate, created_at
       from public.regions
     except
     select id, order_num, name, subtitle, tagline, terrain, landmark_label, rail_at, quiz_format, is_discount_gate, created_at
       from public.regions_next)
    union all
    (select id, order_num, name, subtitle, tagline, terrain, landmark_label, rail_at, quiz_format, is_discount_gate, created_at
       from public.regions_next
     except
     select id, order_num, name, subtitle, tagline, terrain, landmark_label, rail_at, quiz_format, is_discount_gate, created_at
       from public.regions)) d;
  if v_n <> 0 then
    raise exception 'regions and regions_next differ on % row(s) after the copy. Nothing was changed.', v_n;
  end if;

  select count(*) into v_n from (
    (select id, region_id, type, title, description, sort_order, requires_action, action_brief, is_optional, is_gate,
            lesson_group_id, discord_channel, counts_toward_progress, feature_key, bunny_video_id, duration_seconds,
            video_ready_at, whop_lesson_id, created_at, updated_at
       from public.lessons
     except
     select id, region_id, type, title, description, sort_order, requires_action, action_brief, is_optional, is_gate,
            lesson_group_id, discord_channel, counts_toward_progress, feature_key, bunny_video_id, duration_seconds,
            video_ready_at, whop_lesson_id, created_at, updated_at
       from public.lessons_next)
    union all
    (select id, region_id, type, title, description, sort_order, requires_action, action_brief, is_optional, is_gate,
            lesson_group_id, discord_channel, counts_toward_progress, feature_key, bunny_video_id, duration_seconds,
            video_ready_at, whop_lesson_id, created_at, updated_at
       from public.lessons_next
     except
     select id, region_id, type, title, description, sort_order, requires_action, action_brief, is_optional, is_gate,
            lesson_group_id, discord_channel, counts_toward_progress, feature_key, bunny_video_id, duration_seconds,
            video_ready_at, whop_lesson_id, created_at, updated_at
       from public.lessons)) d;
  if v_n <> 0 then
    raise exception 'lessons and lessons_next differ on % row(s) after the copy. Nothing was changed.', v_n;
  end if;

  foreach t in array c_wiped loop
    execute format('select count(*) from public.%I', t) into v_n;
    if v_n <> 0 then
      raise exception 'public.% still holds % row(s) after the wipe. Nothing was changed.', t, v_n;
    end if;
  end loop;
  select string_agg(id, ', ') into v_found from public.achievements
   where id in ('r1_clear', 'r2_clear', 'r3_clear', 'r4_clear', 'early_finisher', 'speedrun');
  if v_found is not null then
    raise exception 'These retired badges are still in achievements: %. Nothing was changed.', v_found;
  end if;
  select count(*) into v_n from public.student_lesson_watch where lesson_id not in (select id from public.lessons);
  if v_n <> 0 then
    raise exception '% watch row(s) still sit on lessons the new course does not have. Nothing was changed.', v_n;
  end if;
  select count(*) into v_n from public.lesson_videos where lesson_id not in (select id from public.lessons);
  if v_n <> 0 then
    raise exception '% video row(s) still sit on lessons the new course does not have. Nothing was changed.', v_n;
  end if;

  select * into v_meta from archive_v1.meta;
  for t in select jsonb_object_keys(v_meta.counts) loop
    execute format('select count(*) from archive_v1.%I', t) into v_n;
    if v_n <> (v_meta.counts ->> t)::bigint then
      raise exception 'archive_v1.% holds % row(s), and the live table held %. Nothing was changed.', t, v_n, v_meta.counts ->> t;
    end if;
  end loop;

  select count(*) into v_n from pg_constraint
   where contype = 'f' and conname = any (c_keys) and confdeltype = 'r'
     and confrelid in ('public.lessons'::regclass, 'public.regions'::regclass);
  select count(*) into v_want from pg_constraint
   where contype = 'f' and confrelid in ('public.lessons'::regclass, 'public.regions'::regclass);
  if v_n <> 6 or v_want <> 6 then
    raise exception '% of the six keys are in place as RESTRICT, and % keys point at lessons or regions. Both must be 6. Nothing was changed.', v_n, v_want;
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'lessons'
                   and indexname = 'lessons_whop_lesson_id_key'
                   and indexdef ilike '%unique%(whop_lesson_id)%where (whop_lesson_id is not null)%') then
    raise exception 'The unique index lessons_whop_lesson_id_key is not in place. Nothing was changed.';
  end if;

  -- Every graduate in the archive now holds the Playbook, counted again from
  -- the archive itself.
  select count(*) into v_n from (
    select c.student_id
      from archive_v1.student_lesson_completions c
      join archive_v1.lessons l on l.id = c.lesson_id
     where public.lesson_is_complete(l.requires_action, c.completed_at, c.action_completed_at, c.skipped_at)
     group by c.student_id
    having count(*) >= ceil(0.8 * (select count(*) from archive_v1.lessons where counts_toward_progress))
        or bool_or(l.feature_key = 'playbook_unlock')) g
   where not exists (select 1 from public.student_milestones m
                      where m.student_id = g.student_id and m.playbook_unlocked_at is not null);
  if v_n <> 0 then
    raise exception '% graduate(s) of the old course would be left without the Playbook. Nothing was changed.', v_n;
  end if;

  if not exists (select 1 from public.admin_config
                  where key = 'curriculum_reset_at'
                    and value = to_char(v_meta.reset_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) then
    raise exception 'admin_config curriculum_reset_at is missing or disagrees with archive_v1.meta. Nothing was changed.';
  end if;
end
$check$;

commit;

-- ─────────────── What the live catalog holds now ───────────────
--
-- The table the SQL editor shows. The first row says whether this run made
-- the switch. Then one row per area and a total, then what the switch did,
-- one figure per row in the value column.

with
  run as (select coalesce(current_setting('cutover.v104', true), '') as said),
  meta as (select reset_at, counts from archive_v1.meta),
  areas as (
    select r.order_num as place, r.id as line, r.name,
           count(l.id)::int                                                   as lessons,
           count(l.id) filter (where l.counts_toward_progress)::int           as counting,
           count(l.id) filter (where l.requires_action)::int                  as action_items,
           count(l.id) filter (where exists (select 1 from public.lesson_videos v where v.lesson_id = l.id))::int as with_video,
           count(l.id) filter (where l.whop_lesson_id is not null)::int       as with_whop_id
      from public.regions r left join public.lessons l on l.region_id = r.id
     group by r.order_num, r.id, r.name)
select line, name, lessons, counting, action_items, with_video, with_whop_id, value
  from (
    select 0 as place, 'switch' as line, null::text as name, null::int as lessons, null::int as counting,
           null::int as action_items, null::int as with_video, null::int as with_whop_id,
           case when (select said from run) = 'switching'
                then 'The switch ran now, at ' || (select value from public.admin_config where key = 'curriculum_reset_at') || '.'
                else 'The switch is already in place since '
                     || coalesce((select value from public.admin_config where key = 'curriculum_reset_at'), 'an unknown time')
                     || '. This run changed nothing.' end as value
    union all
    select place, line, name, lessons, counting, action_items, with_video, with_whop_id, null from areas
    union all
    select 100, 'total', 'the whole course', sum(lessons)::int, sum(counting)::int, sum(action_items)::int,
           sum(with_video)::int, sum(with_whop_id)::int, null from areas
    union all
    select 100 + n, item, null, null, null, null, null, null, value
      from (values
        (1,  'reset_at',              (select to_char(reset_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') from meta)),
        (2,  'archived_completions',  (select counts ->> 'student_lesson_completions' from meta)),
        (3,  'archived_notes',        (select counts ->> 'lesson_notes' from meta)),
        (4,  'archived_ratings',      (select counts ->> 'student_lesson_ratings' from meta)),
        (5,  'archived_badges',       (select counts ->> 'student_achievements' from meta)),
        (6,  'graduates_stamped',     (select count(*)::text from archive_v1.stamps where set_playbook)),
        (7,  'logins_backfilled',     (select count(*)::text from archive_v1.stamps where set_first_login)),
        (8,  'tasks_dismissed',       (select count(*)::text from archive_v1.csm_changes where kind = 'task')),
        (9,  'alerts_dismissed',      (select count(*)::text from archive_v1.csm_changes where kind = 'alert')),
        (10, 'templates_deactivated', (select count(*)::text from archive_v1.csm_changes where kind = 'template'))
      ) as s(n, item, value)
  ) t
 order by place;
-- EXPECT 20 rows:
--   switch     "The switch ran now, at <time>." (or "already in place since")
--   a1 .. a8   lessons 8, 11, 25, 17, 26, 22, 19, 13; counting the same
--              except a7 (18); with_whop_id equal to lessons on every row;
--              with_video the number of lessons whose video is loaded
--   total      141 lessons, 140 counting, 10 action items, 141 with_whop_id
--   then reset_at and nine counts. graduates_stamped and logins_backfilled
--   should match the preflight's (d) rows, tasks_dismissed and
--   alerts_dismissed its (e) rows, templates_deactivated its (b) count.
-- If the file stopped with a message saying "Nothing was changed.", it is
-- true: the whole file is one transaction. A stop on "canceling statement
-- due to lock timeout" (SQLSTATE 55P03) or "deadlock detected" (40P01) is
-- the same: nothing was changed. Paste it again in a minute.
