-- ============================================================
-- After the course switch: does what 2026_v104_course_switch.sql left still
-- hold, and what has happened since.
--
-- Run it right after the switch (the PRD's ship order, step 13), the next
-- morning (step 15), and through the first week. Paste the result back.
-- Read only: it changes no table and locks nothing. Before the switch it
-- runs too, and says so on every row it cannot check.
--
-- READ THE VERDICT COLUMN
--   PASS          a check that holds.
--   LOOK          a check that does not. The found and expect columns say
--                 what it saw.
--   INFO          a number to read: what happened since the switch.
--   NOT SWITCHED  the switch has not run here.
--   NOT CHECKED   the select ran without the block above it (see below).
--
-- THE CHECKS (PASS on each, every time it runs)
--   the switch's row and archive_v1.meta agree on the moment; the areas and
--   lessons equal the staging catalog; the six keys are RESTRICT and no other
--   key points at lessons or regions; the unique index on
--   lessons.whop_lesson_id; every copy in archive_v1 holds the count meta
--   recorded; no graduate of the old course is without the Playbook; no
--   retired badge is back; no course task or course alert from before the
--   switch is open again; the snapshot floor is in place.
--
-- WHAT HAPPENED SINCE (INFO)
--   open tasks created since the switch, per scenario (none of nolessons,
--   noship or pace can appear before course day 3); watch rows with a
--   heartbeat since the switch; completions since the switch; Whop syncs since
--   the switch with what they fetched, matched and could not match.
--
-- HOW IT READS archive_v1
--   Only when it exists, in the block below, which hands what it read to the
--   select in session settings. The select takes them only when they are
--   under five minutes old, so pasted and run in one go it is this run's.
--
-- AT THE FOOT: the one statement that stamps the Playbook for a named
-- student by hand, for a graduate the switch's rule missed. Commented out.
-- ============================================================

do $read$
declare
  v_meta     record;
  t          text;
  v_n        bigint;
  v_bad      text;
  v_left     bigint;
begin
  perform set_config('cutover_check.read_at', clock_timestamp()::text, false);
  if to_regclass('archive_v1.meta') is null then
    perform set_config('cutover_check.archive', 'absent', false);
    perform set_config('cutover_check.reset_at', '', false);
    perform set_config('cutover_check.mismatch', '', false);
    perform set_config('cutover_check.no_playbook', '', false);
    return;
  end if;

  select reset_at, counts into v_meta from archive_v1.meta;
  for t in select jsonb_object_keys(v_meta.counts) order by 1 loop
    if to_regclass('archive_v1.' || quote_ident(t)) is null then
      v_bad := concat_ws(', ', v_bad, t || ' missing');
    else
      execute format('select count(*) from archive_v1.%I', t) into v_n;
      if v_n <> (v_meta.counts ->> t)::bigint then
        v_bad := concat_ws(', ', v_bad, format('%s holds %s, meta says %s', t, v_n, v_meta.counts ->> t));
      end if;
    end if;
  end loop;

  -- The switch's own rule, counted again from the archive.
  execute $q$
    select count(*) from (
      select c.student_id
        from archive_v1.student_lesson_completions c
        join archive_v1.lessons l on l.id = c.lesson_id
       where public.lesson_is_complete(l.requires_action, c.completed_at, c.action_completed_at, c.skipped_at)
       group by c.student_id
      having count(*) >= ceil(0.8 * (select count(*) from archive_v1.lessons where counts_toward_progress))
          or bool_or(l.feature_key = 'playbook_unlock')) g
     where not exists (select 1 from public.student_milestones m
                        where m.student_id = g.student_id and m.playbook_unlocked_at is not null)
  $q$ into v_left;

  perform set_config('cutover_check.archive', 'present', false);
  perform set_config('cutover_check.reset_at', to_char(v_meta.reset_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), false);
  perform set_config('cutover_check.mismatch', coalesce(v_bad, 'none'), false);
  perform set_config('cutover_check.no_playbook', v_left::text, false);
end
$read$;

with
  fresh as (
    select coalesce(current_setting('cutover_check.read_at', true), '') <> ''
       and current_setting('cutover_check.read_at', true)::timestamptz > clock_timestamp() - interval '5 minutes' as ok),
  arch as (
    select case when not (select ok from fresh) then 'unread'
                else current_setting('cutover_check.archive', true) end as state,
           nullif(current_setting('cutover_check.reset_at', true), '')  as meta_at,
           nullif(current_setting('cutover_check.mismatch', true), '')  as mismatch,
           nullif(current_setting('cutover_check.no_playbook', true), '') as no_playbook),
  k as (select value as at, value::timestamptz as ts from public.admin_config where key = 'curriculum_reset_at'),
  live as (
    select (select string_agg(id, ', ' order by order_num) from public.regions)                  as areas,
           (select string_agg(id, ', ' order by order_num) from public.regions_next)             as areas_next,
           (select count(*) from public.lessons)                                                 as n,
           (select count(*) from public.lessons where counts_toward_progress)                    as counting,
           (select count(*) from public.lessons where whop_lesson_id is not null)                as whop,
           (select count(distinct whop_lesson_id) from public.lessons)                           as whop_distinct,
           (select count(*) from public.lessons_next)                                            as n_next,
           (select count(*) from public.lessons_next where counts_toward_progress)               as counting_next),
  lesson_diff as (
    select count(*) as n from (
      (select id, region_id, type, title, description, sort_order, requires_action, action_brief, is_optional, is_gate,
              lesson_group_id, discord_channel, counts_toward_progress, feature_key, whop_lesson_id
         from public.lessons
       except
       select id, region_id, type, title, description, sort_order, requires_action, action_brief, is_optional, is_gate,
              lesson_group_id, discord_channel, counts_toward_progress, feature_key, to_jsonb(n) ->> 'whop_lesson_id'
         from public.lessons_next n)
      union all
      (select id, region_id, type, title, description, sort_order, requires_action, action_brief, is_optional, is_gate,
              lesson_group_id, discord_channel, counts_toward_progress, feature_key, to_jsonb(n) ->> 'whop_lesson_id'
         from public.lessons_next n
       except
       select id, region_id, type, title, description, sort_order, requires_action, action_brief, is_optional, is_gate,
              lesson_group_id, discord_channel, counts_toward_progress, feature_key, whop_lesson_id
         from public.lessons)) d),
  keys as (
    select count(*) filter (where conname in ('fk_lessons_region_id', 'fk_student_lesson_completions_lesson_id',
                                              'fk_lesson_notes_lesson_id', 'fk_student_lesson_ratings_lesson_id',
                                              'fk_quizzes_region_id', 'fk_student_region_quiz_region_id')
                              and confdeltype = 'r') as six,
           count(*) as every
      from pg_constraint
     where contype = 'f' and confrelid in ('public.lessons'::regclass, 'public.regions'::regclass)),
  checks (o, part, item, found, expect, pass) as (
    select 1, 'switch', 'curriculum_reset_at, and archive_v1.meta',
           coalesce((select at from k), 'absent') || ' / ' || coalesce((select meta_at from arch), (select state from arch)),
           'the same moment twice',
           (select at from k) is not null and (select at from k) = (select meta_at from arch)
    union all
    select 2, 'catalog', 'areas in regions', (select areas from live), (select areas_next from live),
           (select areas from live) is not distinct from (select areas_next from live)
    union all
    select 3, 'catalog', 'lessons, counting, with a Whop id, distinct Whop ids',
           (select n || ', ' || counting || ', ' || whop || ', ' || whop_distinct from live),
           (select n_next || ', ' || counting_next || ', ' || n_next || ', ' || n_next from live),
           (select n = n_next and counting = counting_next and whop = n_next and whop_distinct = n_next from live)
    union all
    select 4, 'catalog', 'lessons that differ from lessons_next (catalog columns)', (select n::text from lesson_diff), '0',
           (select n = 0 from lesson_diff)
    union all
    select 5, 'keys', 'the six RESTRICT keys / every key into lessons or regions',
           (select six || ' / ' || every from keys), '6 / 6', (select six = 6 and every = 6 from keys)
    union all
    select 6, 'keys', 'unique index lessons_whop_lesson_id_key',
           case when exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'lessons_whop_lesson_id_key'
                               and indexdef ilike '%unique%(whop_lesson_id)%') then 'yes' else 'no' end, 'yes',
           exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'lessons_whop_lesson_id_key'
                     and indexdef ilike '%unique%(whop_lesson_id)%')
    union all
    select 7, 'archive', 'copies in archive_v1 that differ from meta', coalesce((select mismatch from arch), 'not read'), 'none',
           (select mismatch from arch) = 'none'
    union all
    select 8, 'archive', 'graduates of the old course without the Playbook', coalesce((select no_playbook from arch), 'not read'), '0',
           (select no_playbook from arch) = '0'
    union all
    select 9, 'badges', 'retired badges in achievements',
           (select count(*)::text from public.achievements
             where id in ('r1_clear', 'r2_clear', 'r3_clear', 'r4_clear', 'early_finisher', 'speedrun')), '0',
           (select count(*) = 0 from public.achievements
             where id in ('r1_clear', 'r2_clear', 'r3_clear', 'r4_clear', 'early_finisher', 'speedrun'))
    union all
    select 10, 'csm', 'open nolessons, noship, pace tasks created before the switch',
           (select count(*)::text from public.tasks
             where status = 'open' and created_at < (select ts from k)
               and (scenario_id like 'nolessons.%' or scenario_id like 'noship.%' or scenario_id like 'pace.%')), '0',
           (select count(*) = 0 from public.tasks
             where status = 'open' and created_at < (select ts from k)
               and (scenario_id like 'nolessons.%' or scenario_id like 'noship.%' or scenario_id like 'pace.%'))
    union all
    select 11, 'csm', 'open no_tasks_7d, no_lessons_3d alerts created before the switch',
           (select count(*)::text from public.disengagement_alerts
             where not is_dismissed and created_at < (select ts from k) and alert_type in ('no_tasks_7d', 'no_lessons_3d')), '0',
           (select count(*) = 0 from public.disengagement_alerts
             where not is_dismissed and created_at < (select ts from k) and alert_type in ('no_tasks_7d', 'no_lessons_3d'))
    union all
    select 12, 'snapshots', 'the floor (trg_daily_snapshots_reset_floor)',
           case when exists (select 1 from pg_trigger where tgname = 'trg_daily_snapshots_reset_floor' and not tgisinternal)
                then 'yes' else 'no' end, 'yes',
           exists (select 1 from pg_trigger where tgname = 'trg_daily_snapshots_reset_floor' and not tgisinternal)),
  since (o, part, item, found) as (
    select 20, 'since the switch', 'open tasks created since: ' || scenario_id, count(*)::text
      from public.tasks where status = 'open' and created_at >= (select ts from k)
     group by scenario_id
    union all
    select 21, 'since the switch', 'open tasks created since, in all',
           (select count(*)::text from public.tasks where status = 'open' and created_at >= (select ts from k))
    union all
    select 22, 'since the switch', 'watch rows with a heartbeat since / of them past 95%',
           (select count(*) || ' / ' || count(*) filter (where threshold_met_at is not null)
              from public.student_lesson_watch where last_heartbeat_at >= (select ts from k))
    union all
    select 23, 'since the switch', 'completions since (any of its three times after the switch)',
           (select count(*)::text from public.student_lesson_completions
             where greatest(completed_at, skipped_at, action_completed_at) >= (select ts from k))
    union all
    select 24, 'since the switch', 'completion rows in all', (select count(*)::text from public.student_lesson_completions)
    union all
    select 25, 'since the switch', 'Whop syncs since: students / fetched / matched / could not match',
           (select count(*) || ' / ' || coalesce(sum(last_sync_fetched), 0) || ' / ' || coalesce(sum(last_sync_matched), 0)
                   || ' / ' || coalesce(sum(cardinality(last_sync_unmatched)), 0)
              from public.student_whop_sync where last_sync_at >= (select ts from k)))
select part, item, found, expect, verdict
  from (
    select o, part, item, found, expect,
           case when (select state from arch) = 'unread' then 'NOT CHECKED: run the whole file, the block at the top first'
                when (select at from k) is null then 'NOT SWITCHED'
                when pass then 'PASS' else 'LOOK' end as verdict
      from checks
    union all
    select o, part, item, found, null,
           case when (select at from k) is null then 'NOT SWITCHED' else 'INFO' end
      from since
  ) t
 order by o, item;
-- EXPECT after the switch: PASS on rows 1 to 12, then the INFO rows. Right
-- after the switch the INFO counts are near 0. No open task of nolessons,
-- noship or pace can appear before course day 3.
-- Before the switch: NOT SWITCHED on every row.

-- OPTIONAL: stamp the Playbook for one named student by hand
--   For a graduate the switch's rule missed. Put the student's id (from
--   students.id) in place of the placeholder, take the two dashes off each
--   line below, and run those lines alone. It keeps a stamp that is already
--   there and never touches another student.
--
--    insert into public.student_milestones (student_id, playbook_unlocked_at)
--    values ('REPLACE_WITH_STUDENT_ID', now())
--    on conflict (student_id) do update
--      set playbook_unlocked_at = coalesce(public.student_milestones.playbook_unlocked_at, excluded.playbook_unlocked_at);
