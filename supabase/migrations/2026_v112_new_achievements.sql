-- ============================================================
-- v112: the badges for the new course. Eight stay, Region Sweep and Two
--       Weeks Strong go, Habit Builder counts only the new course's days,
--       Triple Threat counts only lessons really finished on one day, and
--       the share beside each badge divides by every active member.
--
-- The owner's decisions of 2026-10-21. The rules are in
-- src/lib/achievements.ts and src/lib/achievement-rules.ts, which this file
-- writes again in SQL to take away the badges that do not meet them;
-- supabase/migration-tests/v112.test.mjs holds the two to each other.
--
-- WHY
--   * Region Sweep and Two Weeks Strong are gone from the course (the owner).
--   * Habit Builder came back from old-course history: the streak and the
--     best streak were kept across the switch (2026-10-19), so a student
--     whose streak had reached 7 before it was handed the badge at their
--     first visit after it, announced as just earned. Nobody can have 7
--     streak days on the new course before 25 October.
--   * Triple Threat took the day from completed_at, and a login or visit sync
--     stamps every row it brings in from Whop with the sync's own time: three
--     lessons finished on Whop on three days, arriving in one sync, counted
--     as three in a day.
--   * The share counted students who paid since 25 May and had used the app.
--
-- WHAT THIS FILE DOES, in one transaction
--   1. Locks achievements, student_achievements and
--      student_lesson_completions (5 seconds at most), so no badge or lesson
--      row lands between a copy and a change.
--   2. Checks it can (WHEN IT REFUSES below).
--   3. First run only: makes the schema archive_v112 (no access for anon,
--      authenticated or service_role) with a copy of the catalog as it is,
--      the share's view as it is (its query, options and comment), a table
--      for every badge row a run takes away (with why and when) and a record
--      of the runs.
--   4. First run only, or when the column is missing: adds
--      student_lesson_completions.completed_at_real, true when completed_at
--      is the moment the lesson was really finished. From here on the app
--      writes it: the lesson page's player, Whop's event (the webhook) and
--      the Whop catch-up with Whop's own time; a login or visit sync never
--      does. For the rows already there it judges by the time itself: a
--      sync writes one time on every row it adds, so a completed_at that
--      another row of the same student also holds is a sync's (false), and
--      one no other row holds is a lesson finished on its own (true).
--   5. Rewrites the words of four badges:
--        Took the Shot     Complete your first action item.
--        Discount Earned   Get the 30% off your next month approved.
--        Perfectionist     Finish every lesson in the course.
--        Unbroken          Finish the whole course without breaking your streak.
--      First Steps, Triple Threat, Habit Builder and Through the Gate keep
--      theirs, and every badge keeps its name, tier and order.
--   6. Takes away Region Sweep and Two Weeks Strong: every holder's row is
--      copied into archive_v112.student_achievements, then deleted, then the
--      two catalog rows (holders first, never by cascade).
--   7. Habit Builder: takes away every Habit Builder row earned before the
--      switch's date plus 6 days, 00:00 UTC (the first moment a 7-day streak
--      counted from the switch's date can be reached). Copied first.
--   8. Triple Threat: takes away the badge from every holder with no 3
--      lessons really finished on one UTC day, the rule the app now uses
--      (a lesson's own time when completed_at_real; an action item at its
--      second half). Copied first.
--   9. achievement_unlock_stats divides by every active member: membership
--      active or past_due, not CSM exempt, not a team member (a team_members
--      row with their sign-in), whether or not they have opened the app. The
--      holders counted are the holders among them. Column types and
--      security_invoker=false as before (see v78, v90, v93).
--  10. Records the run, checks its own result, commits, and shows one table:
--      a first row saying what it did, then each badge (holders before,
--      taken away, holders now, share now), then the counts.
--
-- WHAT CHANGES FOR STUDENTS
--   The corner's list shows 8 badges. Students lose the badges above; a
--   student who earns Habit Builder or Triple Threat under the new rules gets
--   it at their next lesson or visit, announced then. Nobody is given a badge
--   by this file. The shares move: the denominator is every active member.
--
-- THE ORDER WITH THE DEPLOY
--   Deploy the code first, then paste this file. The code works without it
--   (it writes and reads completed_at_real best-effort, and until the column
--   is there no lesson counts toward Triple Threat), and from the deploy no
--   badge comes from old history. Pasted before the deploy, the old code
--   still running fails to insert any badge for a student who meets Region
--   Sweep's or Two Weeks Strong's old rule (the catalog rows are gone), and
--   still hands out Habit Builder and Triple Threat by the old rules; paste
--   this file again after the deploy and it takes those away too. Paste it
--   before 25 October either way: Habit Builder's cut can tell an old award
--   from a new one only for awards made before then.
--
-- WHEN IT REFUSES, changing nothing (every message ends "Nothing was changed.")
--   * A table it needs is missing.
--   * admin_config has no curriculum_reset_at (the switch has not run), or
--     it does not read as a time.
--   * One of the eight badges is missing from achievements, or achievements
--     holds a badge other than the eight and the two it takes away.
--   * The schema archive_v112 is there without its record of runs.
--   * Its own check after the change fails.
--
-- WHEN THE TABLES ARE BUSY
--   Another session holding one of the three tables for more than 5 seconds
--   stops it with "Another session held a table v112 changes for more than 5
--   seconds (...), so v112 did not start. Nothing was changed. Paste it again
--   in a minute." While it runs (well under a second) the app's reads and
--   writes of the three tables wait for it.
--
-- UNDO: supabase/undo/2026_v112_undo.sql puts the catalog and every badge row
-- back from the archive and the view back as it was, keeps the
-- completed_at_real values in the archive and drops the column, and renames
-- the archive. To undo the course switch (v104's undo) after this file, run
-- this undo first: v104's undo puts back archived rows of Region Sweep and
-- Two Weeks Strong, which need their catalog rows.
--
-- Re-runnable: a second paste takes away only what the rules above would
-- (nothing, right after the first), changes nothing else and says so.
-- ============================================================

begin;

set local search_path = public;
set local lock_timeout = '5s';

-- ─────────────── 1. The lock ───────────────
--
-- The three tables this file writes or alters, parents first, in the
-- strongest mode, before anything is read: no statement below has to upgrade
-- a weaker lock (the upgrade is where two sessions deadlock). A table that
-- does not exist is left to step 2, which names it.

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
  raise exception 'Another session held a table v112 changes for more than 5 seconds (%), so v112 did not start. Nothing was changed. Paste it again in a minute.', sqlerrm
    using errcode = sqlstate;
end
$lock$;

-- ─────────────── 2. It can ───────────────
--
-- What it finds is kept in session settings for the steps below and for the
-- table at the end. v112.state is 'first' (no record of an earlier run) or
-- 'again'.

do $guard$
declare
  c_keep constant text[] := array['first_lesson', 'first_action_shipped', 'bounty_access_claimed', 'triple_play',
    'streak_7', 'discount_earned', 'perfect_run', 'unbroken'];
  c_gone constant text[] := array['region_sweep', 'streak_14'];
  v_found text;
  v_reset text;
  v_at    timestamptz;
begin
  select string_agg(t, ', ' order by o) into v_found
    from unnest(array['achievements', 'student_achievements', 'student_lesson_completions', 'lessons',
                      'students', 'team_members', 'admin_config', 'achievement_unlock_stats'])
         with ordinality as x(t, o)
   where to_regclass('public.' || t) is null;
  if v_found is not null then
    raise exception 'v112 needs these tables and they are missing: %. Nothing was changed.', v_found;
  end if;

  select value into v_reset from public.admin_config where key = 'curriculum_reset_at';
  if v_reset is null then
    raise exception 'The course switch has not run here (admin_config has no curriculum_reset_at). v112 is for the new course: Habit Builder counts from the switch. Nothing was changed.';
  end if;
  begin
    v_at := v_reset::timestamptz;
  exception when others then
    raise exception 'admin_config curriculum_reset_at holds %, which is not a date and time. Nothing was changed.', v_reset;
  end;

  select string_agg(k, ', ' order by k) into v_found
    from unnest(c_keep) as k
   where not exists (select 1 from public.achievements a where a.id = k);
  if v_found is not null then
    raise exception 'These badges are missing from achievements: %. v112 keeps the eight and rewrites the words of four; it does not make one. Nothing was changed.', v_found;
  end if;
  select string_agg(id, ', ' order by id) into v_found
    from public.achievements where id <> all (c_keep || c_gone);
  if v_found is not null then
    raise exception 'achievements holds badges v112 does not know: %. v112 leaves exactly eight; look at these first. Nothing was changed.', v_found;
  end if;

  if to_regnamespace('archive_v112') is not null and to_regclass('archive_v112.runs') is null then
    raise exception 'The schema archive_v112 is here without its record of runs (archive_v112.runs). Check it, rename or drop it, then run this again. Nothing was changed.';
  end if;

  perform set_config('v112.state', case when to_regclass('archive_v112.runs') is null then 'first' else 'again' end, false);
  perform set_config('v112.ran_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), false);
  -- Habit Builder's cut: the switch's date (UTC) plus 6 days, at 00:00 UTC.
  perform set_config('v112.cut',
    to_char((((v_at at time zone 'UTC')::date + 6)::timestamp at time zone 'UTC') at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), false);
  perform set_config('v112.column_was_there',
    case when exists (select 1 from information_schema.columns where table_schema = 'public'
                        and table_name = 'student_lesson_completions' and column_name = 'completed_at_real')
         then 'yes' else 'no' end, false);
  perform set_config('v112.judged', '', false);
  perform set_config('v112.words', '0', false);
  perform set_config('v112.view_changed', 'no', false);

  -- Before anything moves: every badge's holders, and the share's denominator.
  perform set_config('v112.before', jsonb_build_object(
      'holders', coalesce((select jsonb_object_agg(a.id, (select count(*) from public.student_achievements sa
                                                           where sa.achievement_id = a.id))
                             from public.achievements a), '{}'::jsonb),
      'members', (select total_count from public.achievement_unlock_stats limit 1))::text, false);
  perform set_config('v112.removed', '{}', false);
end
$guard$;

-- ─────────────── 3. The archive (first run) ───────────────

do $archive$
begin
  if current_setting('v112.state') <> 'first' then return; end if;

  create schema archive_v112;
  revoke all on schema archive_v112 from public, anon, authenticated, service_role;

  -- One row per run that changed something: when, who, and its counts.
  create table archive_v112.runs (
    ran_at timestamptz primary key,
    ran_by text        not null,
    counts jsonb       not null);
  -- The catalog as it was before the first run, every column.
  create table archive_v112.achievements as table public.achievements;
  alter table archive_v112.achievements add primary key (id);
  -- The share's view as it was: its query as Postgres states it, its
  -- options and its comment. The undo makes it again from these.
  create table archive_v112.view_before as
    select pg_get_viewdef(c.oid, true) as definition,
           c.reloptions                as options,
           obj_description(c.oid, 'pg_class') as comment
      from pg_class c
     where c.oid = 'public.achievement_unlock_stats'::regclass;
  -- Every badge row a run takes away, as it was, with why and when.
  create table archive_v112.student_achievements (
    student_id     uuid        not null,
    achievement_id text        not null,
    unlocked_at    timestamptz not null,
    reason         text        not null,
    removed_at     timestamptz not null,
    primary key (student_id, achievement_id, removed_at));

  -- Nobody but the owner reads the archive.
  revoke all on all tables in schema archive_v112 from public, anon, authenticated, service_role;
end
$archive$;

-- ─────────────── 4. completed_at_real ───────────────
--
-- Added, and judged for the rows already there, on the first run or when the
-- column is missing. A later run never judges again: the rows written since
-- carry what their writer knew (null from a sync).

do $column$
begin
  if current_setting('v112.state') <> 'first' and current_setting('v112.column_was_there') = 'yes' then return; end if;
  alter table public.student_lesson_completions add column if not exists completed_at_real boolean;
  comment on column public.student_lesson_completions.completed_at_real is
    'v112: true when completed_at is the moment the lesson was really finished: the lesson page''s player (lesson-watched), Whop''s event (the webhook) or the Whop catch-up with Whop''s own time. Null or false when a login or visit sync stamped its own time. Triple Threat counts a lesson on its day only when this is true (src/lib/achievement-rules.ts). A writer that changes completed_at without knowing the real moment sets it back to null.';
end
$column$;

do $judge$
declare
  v_real   bigint;
  v_shared bigint;
  v_none   bigint;
begin
  if current_setting('v112.state') <> 'first' and current_setting('v112.column_was_there') = 'yes' then return; end if;

  -- A sync writes one time (its statement's now()) on every row it adds, so
  -- a time another row of the same student holds too is a sync's. A lesson
  -- finished on its own (the player, Whop's event, the catch-up's Whop time)
  -- has a time no other row holds. Rows a writer already marked keep it.
  update public.student_lesson_completions c
     set completed_at_real = not exists (
           select 1 from public.student_lesson_completions o
            where o.student_id = c.student_id and o.completed_at = c.completed_at and o.id <> c.id)
   where c.completed_at is not null and c.completed_at_real is null;

  select count(*) filter (where completed_at_real),
         count(*) filter (where completed_at is not null and not coalesce(completed_at_real, false)),
         count(*) filter (where completed_at is null)
    into v_real, v_shared, v_none
    from public.student_lesson_completions;
  perform set_config('v112.judged', jsonb_build_object('real', v_real, 'shared_time', v_shared, 'no_watch_time', v_none)::text, false);
end
$judge$;

-- ─────────────── 5. The words ───────────────

do $words$
declare
  v_n bigint := 0;
  v_k bigint;
  r   record;
begin
  for r in
    select * from (values
      ('first_action_shipped', 'Complete your first action item.'),
      ('discount_earned',      'Get the 30% off your next month approved.'),
      ('perfect_run',          'Finish every lesson in the course.'),
      ('unbroken',             'Finish the whole course without breaking your streak.')) as w(id, words)
  loop
    update public.achievements set description = r.words
     where id = r.id and description is distinct from r.words;
    get diagnostics v_k = row_count;
    v_n := v_n + v_k;
  end loop;
  perform set_config('v112.words', v_n::text, false);
end
$words$;

-- ─────────────── 6 to 8. The badges taken away ───────────────
--
-- Each row is copied with its reason and this run's moment, then deleted.

do $remove$
declare
  v_cut     timestamptz := current_setting('v112.cut')::timestamptz;
  v_removed jsonb := '{}'::jsonb;
  v_take    uuid[];
  v_copied  bigint;
  v_deleted bigint;
  r         record;
begin
  for r in
    select * from (values
      (1, 'region_sweep', 'Region Sweep is gone (v112)'),
      (2, 'streak_14',    'Two Weeks Strong is gone (v112)'),
      (3, 'streak_7',     'Habit Builder earned before a 7-day streak on the new course was possible'),
      (4, 'triple_play',  'Triple Threat without 3 lessons really finished on one day')) as x(n, id, reason)
    order by n
  loop
    if r.id in ('region_sweep', 'streak_14') then
      select coalesce(array_agg(student_id), '{}') into v_take
        from public.student_achievements where achievement_id = r.id;
    elsif r.id = 'streak_7' then
      select coalesce(array_agg(student_id), '{}') into v_take
        from public.student_achievements where achievement_id = 'streak_7' and unlocked_at < v_cut;
    else
      -- The rule of src/lib/achievement-rules.ts (finishedAt, then
      -- mostFinishedInOneDay), in SQL: each lesson's moment, then 3 lessons
      -- on one UTC day.
      select coalesce(array_agg(sa.student_id), '{}') into v_take
        from public.student_achievements sa
       where sa.achievement_id = 'triple_play'
         and sa.student_id not in (
           select f.student_id
             from (select c.student_id, c.lesson_id,
                          case
                            when c.completed_at is null then null
                            when not coalesce(l.requires_action, false)
                              then case when c.completed_at_real then c.completed_at end
                            when c.action_completed_at is null then null
                            when c.completed_at_real then greatest(c.completed_at, c.action_completed_at)
                            when c.completed_at <= c.action_completed_at then c.action_completed_at
                          end as finished_at
                     from public.student_lesson_completions c
                     join public.lessons l on l.id = c.lesson_id) f
            where f.finished_at is not null
            group by f.student_id, (f.finished_at at time zone 'UTC')::date
           having count(distinct f.lesson_id) >= 3);
    end if;

    insert into archive_v112.student_achievements (student_id, achievement_id, unlocked_at, reason, removed_at)
    select sa.student_id, sa.achievement_id, sa.unlocked_at, r.reason, now()
      from public.student_achievements sa
     where sa.achievement_id = r.id and sa.student_id = any (v_take);
    get diagnostics v_copied = row_count;

    delete from public.student_achievements sa
     where sa.achievement_id = r.id and sa.student_id = any (v_take);
    get diagnostics v_deleted = row_count;

    if v_copied <> v_deleted or v_deleted <> coalesce(array_length(v_take, 1), 0) then
      raise exception '% rows of % were to go, % were copied and % deleted. Nothing was changed.',
        coalesce(array_length(v_take, 1), 0), r.id, v_copied, v_deleted;
    end if;
    v_removed := v_removed || jsonb_build_object(r.id, v_deleted);
  end loop;

  delete from public.achievements where id in ('region_sweep', 'streak_14');
  perform set_config('v112.removed', v_removed::text, false);
end
$remove$;

-- ─────────────── 9. The share ───────────────
--
-- ⚠ The column types and the options are load-bearing, as v90 and v93 say:
--   the counts stay bigint with no cast (CREATE OR REPLACE VIEW cannot change
--   a type), security_invoker stays off (the share spans every student; a
--   student's own rights would see their own row alone), and the holders are
--   scoped in the JOIN, so a badge nobody holds still shows 0.

do $viewbefore$
begin
  perform set_config('v112.view_before', pg_get_viewdef('public.achievement_unlock_stats'::regclass, true), false);
end
$viewbefore$;

create or replace view public.achievement_unlock_stats
with (security_invoker = false) as
with eligible as (
  -- Every active member right now (v112): membership active or past_due, not
  -- CSM exempt, not a team member, whether or not they have opened the app.
  select s.id
  from public.students s
  where s.membership_status in ('active', 'past_due')
    and s.csm_exempt is not true
    and not exists (
      select 1 from public.team_members t
      where t.id = s.supabase_user_id
    )
),
denom as (
  select count(*) as n from eligible
)
select
  a.id,
  count(distinct sa.student_id)                   as unlocked_count,
  (select n from denom)                           as total_count,
  case
    when (select n from denom) = 0 then 0
    else round(
      100.0 * count(distinct sa.student_id)::numeric
        / (select n from denom)::numeric,
      1
    )
  end                                             as unlock_pct
from public.achievements a
left join public.student_achievements sa
       on sa.achievement_id = a.id
      and sa.student_id in (select id from eligible)
group by a.id;

-- v78 revoked this from anon; re-assert it so a replace can never widen it.
revoke select on public.achievement_unlock_stats from anon;

comment on view public.achievement_unlock_stats is
  'Per-achievement holders and the share of students holding each, shown beside each badge in the map''s corner list. Since v112 the denominator is every active member (membership active or past_due, not csm_exempt, not a team member), whether or not they have opened the app, and the holders are the holders among them. Intentionally runs with security_invoker=off so the aggregate spans all students; see the v78 header.';

do $viewafter$
begin
  if pg_get_viewdef('public.achievement_unlock_stats'::regclass, true) is distinct from current_setting('v112.view_before') then
    perform set_config('v112.view_changed', 'yes', false);
  end if;
end
$viewafter$;

-- ─────────────── 10. The record, then the check ───────────────

do $record$
declare
  v_removed jsonb := current_setting('v112.removed')::jsonb;
  v_total   bigint := (select coalesce(sum(value::bigint), 0) from jsonb_each_text(current_setting('v112.removed')::jsonb));
begin
  perform set_config('v112.removed_total', v_total::text, false);
  if current_setting('v112.state') = 'first' or v_total > 0 or current_setting('v112.words') <> '0'
     or current_setting('v112.view_changed') = 'yes' or current_setting('v112.judged') <> '' then
    insert into archive_v112.runs (ran_at, ran_by, counts)
    values (now(), current_user, jsonb_build_object(
      'state', current_setting('v112.state'),
      'before', current_setting('v112.before')::jsonb,
      'removed', v_removed,
      'words_changed', current_setting('v112.words')::bigint,
      'view_changed', current_setting('v112.view_changed') = 'yes',
      'judged', nullif(current_setting('v112.judged'), '')::jsonb,
      'habit_builder_cut', current_setting('v112.cut')));
    perform set_config('v112.changed', 'yes', false);
  else
    perform set_config('v112.changed', 'no', false);
  end if;
end
$record$;

do $check$
declare
  c_keep constant text[] := array['bounty_access_claimed', 'discount_earned', 'first_action_shipped', 'first_lesson',
    'perfect_run', 'streak_7', 'triple_play', 'unbroken'];
  v_found text;
  v_n     bigint;
begin
  select string_agg(id, ',' order by id collate "C") into v_found from public.achievements;
  if v_found is distinct from array_to_string(c_keep, ',') then
    raise exception 'achievements holds % after v112, and it must hold exactly the eight. Nothing was changed.', v_found;
  end if;

  select string_agg(id, ', ' order by id) into v_found
    from (values ('first_action_shipped', 'Complete your first action item.'),
                 ('discount_earned',      'Get the 30% off your next month approved.'),
                 ('perfect_run',          'Finish every lesson in the course.'),
                 ('unbroken',             'Finish the whole course without breaking your streak.')) as w(id, words)
   where not exists (select 1 from public.achievements a where a.id = w.id and a.description = w.words);
  if v_found is not null then
    raise exception 'The words of % are not the new ones after v112. Nothing was changed.', v_found;
  end if;

  select count(*) into v_n from public.student_achievements
   where achievement_id = 'streak_7' and unlocked_at < current_setting('v112.cut')::timestamptz;
  if v_n <> 0 then
    raise exception '% Habit Builder rows from before % are left. Nothing was changed.', v_n, current_setting('v112.cut');
  end if;

  select count(*) into v_n
    from public.student_achievements sa
   where sa.achievement_id = 'triple_play'
     and sa.student_id not in (
       select f.student_id
         from (select c.student_id, c.lesson_id,
                      case
                        when c.completed_at is null then null
                        when not coalesce(l.requires_action, false)
                          then case when c.completed_at_real then c.completed_at end
                        when c.action_completed_at is null then null
                        when c.completed_at_real then greatest(c.completed_at, c.action_completed_at)
                        when c.completed_at <= c.action_completed_at then c.action_completed_at
                      end as finished_at
                 from public.student_lesson_completions c
                 join public.lessons l on l.id = c.lesson_id) f
        where f.finished_at is not null
        group by f.student_id, (f.finished_at at time zone 'UTC')::date
       having count(distinct f.lesson_id) >= 3);
  if v_n <> 0 then
    raise exception '% Triple Threat holders without 3 lessons really finished on one day are left. Nothing was changed.', v_n;
  end if;

  select string_agg(column_name || ' ' || data_type, ', ' order by ordinal_position) into v_found
    from information_schema.columns where table_schema = 'public' and table_name = 'achievement_unlock_stats';
  if v_found is distinct from 'id text, unlocked_count bigint, total_count bigint, unlock_pct numeric' then
    raise exception 'achievement_unlock_stats has the columns % after v112. Nothing was changed.', v_found;
  end if;
  if not exists (select 1 from pg_class where oid = 'public.achievement_unlock_stats'::regclass
                   and 'security_invoker=false' = any (reloptions)) then
    raise exception 'achievement_unlock_stats lost security_invoker=false. Nothing was changed.';
  end if;
  if has_table_privilege('anon', 'public.achievement_unlock_stats', 'select') then
    raise exception 'A visitor (anon) can read achievement_unlock_stats after v112. Nothing was changed.';
  end if;

  if not exists (select 1 from information_schema.columns where table_schema = 'public'
                   and table_name = 'student_lesson_completions' and column_name = 'completed_at_real'
                   and data_type = 'boolean') then
    raise exception 'student_lesson_completions.completed_at_real is missing after v112. Nothing was changed.';
  end if;

  select string_agg(c.relname, ', ' order by c.relname) into v_found
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'archive_v112' and c.relkind = 'r'
     and (has_table_privilege('authenticated', c.oid, 'select') or has_table_privilege('service_role', c.oid, 'select'));
  if v_found is not null then
    raise exception 'The app can read archive_v112 (%). Nothing was changed.', v_found;
  end if;
end
$check$;

commit;

-- ─────────────── What is there now ───────────────
--
-- One table: the first row says what this run did, then one row per badge
-- (the eight, then the two taken away), then the counts.

with
  run as (
    select current_setting('v112.state', true)                          as state,
           current_setting('v112.ran_at', true)                         as ran_at,
           coalesce(current_setting('v112.changed', true), 'no')        as changed,
           coalesce(nullif(current_setting('v112.removed_total', true), ''), '0')::bigint as removed_total,
           nullif(current_setting('v112.before', true), '')::jsonb      as before,
           nullif(current_setting('v112.removed', true), '')::jsonb     as removed,
           nullif(current_setting('v112.judged', true), '')::jsonb      as judged,
           current_setting('v112.cut', true)                            as cut,
           (select to_char(min(ran_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') from archive_v112.runs) as first_ran_at),
  now_held as (
    select achievement_id as id, count(*) as n from public.student_achievements group by achievement_id),
  badges as (
    select 10 + a.sort_order as place, a.id, a.name,
           ((select before from run) -> 'holders' ->> a.id)::bigint    as before,
           coalesce(((select removed from run) ->> a.id)::bigint, 0)   as taken,
           coalesce((select n from now_held h where h.id = a.id), 0)   as held,
           s.unlock_pct
      from public.achievements a
      left join public.achievement_unlock_stats s on s.id = a.id
    union all
    select 1000 + row_number() over (order by g.id), g.id, g.name,
           ((select before from run) -> 'holders' ->> g.id)::bigint,
           coalesce(((select removed from run) ->> g.id)::bigint, 0),
           0, null
      from archive_v112.achievements g
     where g.id in ('region_sweep', 'streak_14'))
select line, badge, holders_before, taken_away, holders_now, share_now, value
  from (
    select 0 as place, 'v112' as line, null::text as badge, null::bigint as holders_before, null::bigint as taken_away,
           null::bigint as holders_now, null::text as share_now,
           case
             when (select state from run) = 'first'
               then 'v112 ran now, at ' || (select ran_at from run) || ': 8 badges left, '
                    || (select removed_total from run) || ' badge rows taken away (kept in archive_v112.student_achievements)'
                    || coalesce(', ' || ((select judged from run) ->> 'real') || ' lesson rows read as finished at their own time', '')
                    || '.'
             when (select changed from run) = 'yes'
               then 'v112 ran again, at ' || (select ran_at from run) || ' (first run ' || coalesce((select first_ran_at from run), 'unknown')
                    || '): ' || (select removed_total from run) || ' badge rows taken away (kept in archive_v112.student_achievements).'
             else 'v112 is in place since ' || coalesce((select first_ran_at from run), 'an unknown time') || '. This run changed nothing.'
           end as value
    union all
    select place, id, name, before, taken, held,
           case when place < 1000 then coalesce(unlock_pct::text || '%', '') end, null
      from badges
    union all
    select 2000 + n, item, null, null, null, null, null, v
      from (values
        (1, 'share_members_now',         (select total_count::text from public.achievement_unlock_stats limit 1)),
        (2, 'share_members_before',      (select (before ->> 'members') from run)),
        (3, 'habit_builder_counts_from', (select cut from run)),
        (4, 'lesson_rows_real_time',     (select judged ->> 'real' from run)),
        (5, 'lesson_rows_shared_time',   (select judged ->> 'shared_time' from run)),
        (6, 'lesson_rows_no_watch_time', (select judged ->> 'no_watch_time' from run)),
        (7, 'badge_rows_in_the_archive', (select count(*)::text from archive_v112.student_achievements))
      ) as c(n, item, v)
  ) t
 order by place, line;
-- EXPECT on production, first run: the first row "v112 ran now, at <time>:
-- 8 badges left, N badge rows taken away (kept in
-- archive_v112.student_achievements), M lesson rows read as finished at
-- their own time.", then the eight badges in their order (holders_before
-- from before the run, taken_away, holders_now, share_now), then Region
-- Sweep and Two Weeks Strong (holders_now 0: on 21 October 302 and 27
-- holders), then share_members_now (every active member), share_members_before
-- (the old count, 1,136 on 21 October), habit_builder_counts_from (the
-- switch's date plus 6 days), the three counts of lesson rows (first run
-- only) and the badge rows in the archive. Habit Builder's taken_away is every
-- holder on a paste before 25 October (67 on 21 October). A second paste says
-- "v112 is in place since <time>. This run changed nothing." If the file
-- stopped with a message ending "Nothing was changed.", it is true: the whole
-- file is one transaction. A stop on "canceling statement due to lock
-- timeout" (SQLSTATE 55P03) or "deadlock detected" (40P01) is the same:
-- nothing was changed. Paste it again in a minute.
