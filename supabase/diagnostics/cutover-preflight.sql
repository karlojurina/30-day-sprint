-- ============================================================
-- Before the course switch: what 2026_v104_course_switch.sql will find, and
-- what it will do, read from the live database.
--
-- Run it after v101 (the current one) and v103, and before v104 (the PRD's
-- ship order, step 5). Paste the result back. Read only: one select, it
-- changes no table and locks nothing. It also runs after the switch, where
-- most counts read 0.
--
-- READ IT BY PART
--   a. keys       Every key that points at lessons or regions, with its
--                 name and what it does on delete. The switch expects
--                 exactly six (expect column). Then what the switch relaxes
--                 for the new course, and any not-null column with no default
--                 the copy would leave empty (expect: none).
--   b. templates  Every active template the switch turns off, with the
--                 conditions that make it. Show this list to Astrid and Karlo.
--   c. archive    Rows the switch copies into archive_v1, per table. The
--                 watch and video rows count only lessons the new course does
--                 not have.
--   d. playbook   Graduates the switch stamps (by l078, by 80%), and students
--                 whose first login it fills in.
--   e. csm        Open tasks and alerts the switch dismisses, and the
--                 no_login_5d alerts it leaves open.
--   f. staging    The new course in lessons_next: rows, counting, the gate,
--                 Whop lesson ids present and distinct, placeholder titles.
--   g. ready      Whether v103 ran, whether archive_v1 or the switch's row
--                 already exist.
--
-- The switch's final table repeats the counts of b, d and e. They should
-- match what this said, give or take what happened in between.
-- ============================================================

with
  six (pair) as (values ('lessons.region_id'), ('student_lesson_completions.lesson_id'),
                        ('lesson_notes.lesson_id'), ('student_lesson_ratings.lesson_id'),
                        ('quizzes.region_id'), ('student_region_quiz.region_id')),
  fk as (
    select c.conrelid::regclass::text || '.' || a.attname as pair, c.conname,
           case c.confdeltype when 'c' then 'cascade' when 'r' then 'restrict' when 'a' then 'no action'
                              when 'n' then 'set null' when 'd' then 'set default' end as on_delete
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
     where c.contype = 'f' and c.confrelid in ('public.lessons'::regclass, 'public.regions'::regclass)),
  -- what step 6 of the switch drops, and what the copy leaves empty
  relaxed as (
    select cl.relname || '.' || a.attname as col, a.attnotnull as not_null, a.atthasdef as has_default
      from pg_attribute a join pg_class cl on cl.oid = a.attrelid
     where not a.attisdropped and a.attnum > 0
       and ((a.attrelid = 'public.lessons'::regclass and a.attname = 'day')
         or (a.attrelid = 'public.regions'::regclass
             and a.attname in ('subtitle', 'tagline', 'terrain', 'days_label', 'day_start', 'day_end')))),
  checks as (
    select cl.relname as tbl, c.conname, pg_get_constraintdef(c.oid) as def
      from pg_constraint c join pg_class cl on cl.oid = c.conrelid
     where c.contype = 'c'
       and ((c.conrelid = 'public.lessons'::regclass
             and (select attnum from pg_attribute where attrelid = c.conrelid and attname = 'day') = any (c.conkey))
         or (c.conrelid = 'public.regions'::regclass
             and (select attnum from pg_attribute where attrelid = c.conrelid and attname = 'terrain') = any (c.conkey)))),
  unfilled as (
    select cl.relname || '.' || a.attname as col
      from pg_attribute a join pg_class cl on cl.oid = a.attrelid
     where a.attrelid in ('public.lessons'::regclass, 'public.regions'::regclass)
       and a.attnum > 0 and not a.attisdropped and a.attnotnull and not a.atthasdef
       and not (cl.relname = 'lessons' and a.attname in ('id', 'region_id', 'type', 'title', 'description',
                 'sort_order', 'requires_action', 'action_brief', 'is_optional', 'is_gate', 'lesson_group_id',
                 'discord_channel', 'counts_toward_progress', 'feature_key', 'bunny_video_id', 'duration_seconds',
                 'video_ready_at', 'whop_lesson_id', 'created_at', 'updated_at', 'day'))
       and not (cl.relname = 'regions' and a.attname in ('id', 'order_num', 'name', 'subtitle', 'tagline',
                 'terrain', 'landmark_label', 'rail_at', 'quiz_format', 'is_discount_gate', 'created_at',
                 'days_label', 'day_start', 'day_end'))),
  -- the templates step 4 turns off, with the conditions that make it
  tmpl as (
    select t.scenario_id, t.title,
           (select string_agg(e::text, ' and ')
              from jsonb_array_elements(case when jsonb_typeof(t.trigger_config -> 'all') = 'array'
                                             then t.trigger_config -> 'all' else '[]'::jsonb end) e
             where e ? 'lesson_id' or e ? 'region'
                or e ->> 'metric' in ('progress_ratio', 'progress_label', 'region_pace')) as why,
           t.id
      from public.templates t
     where t.is_active),
  off as (select * from tmpl where why is not null),
  -- step 3's graduates and first logins, the same rule
  done as (
    select c.student_id, l.feature_key
      from public.student_lesson_completions c
      join public.lessons l on l.id = c.lesson_id
     where public.lesson_is_complete(l.requires_action, c.completed_at, c.action_completed_at, c.skipped_at)),
  by_l078 as (select distinct student_id from done where feature_key = 'playbook_unlock'),
  by_80 as (
    select student_id from done group by student_id
    having count(*) >= ceil(0.8 * (select count(*) from public.lessons where counts_toward_progress))),
  grads as (select student_id from by_l078 union select student_id from by_80),
  milestone as (
    select m.student_id, m.first_sprint_login_at, to_jsonb(m) ->> 'playbook_unlocked_at' as stamped
      from public.student_milestones m),
  staging as (
    select count(*)::int                                                               as n,
           count(*) filter (where counts_toward_progress)::int                         as counting,
           coalesce(string_agg(id, ', ' order by id) filter (where is_gate), 'none')   as gates,
           count(*) filter (where to_jsonb(l) ->> 'whop_lesson_id' is not null)::int   as with_whop,
           count(distinct to_jsonb(l) ->> 'whop_lesson_id')::int                       as distinct_whop,
           count(*) filter (where title like '% · lesson %')::int                      as placeholders,
           count(*) filter (where id !~ '^a[1-8]l[0-9]{2}$')::int                      as odd_ids
      from public.lessons_next l)
select part, item, found, expect
  from (
    -- a. keys
    select 1 as o, 'a. keys' as part, fk.pair as item, fk.conname || ' (on delete ' || fk.on_delete || ')' as found,
           case when fk.pair in (select pair from six) then 'one of the six'
                else 'NOT one of the six: the switch will refuse' end as expect
      from fk
    union all
    select 2, 'a. keys', 'keys into lessons and regions',
           (select count(*)::text from fk) || ', of them the six: ' || (select count(*) from fk where pair in (select pair from six)),
           '6, of them the six: 6'
    union all
    select 3, 'a. keys', 'relaxed by the switch: ' || col || ' not null',
           case when not_null then 'yes' else 'no' end || case when has_default then ', with a default' else ', no default' end,
           'dropped by the switch when yes'
      from relaxed
    union all
    select 4, 'a. keys', 'relaxed by the switch: check ' || conname || ' on ' || tbl, def, 'dropped by the switch'
      from checks
    union all
    select 5, 'a. keys', 'not-null columns the copy leaves empty',
           coalesce((select string_agg(col, ', ' order by col) from unfilled), 'none'),
           'none (else the switch refuses)'
    -- b. templates
    union all
    select 10, 'b. templates', scenario_id || ': ' || title, why, 'turned off by the switch' from off
    union all
    select 11, 'b. templates', 'templates the switch turns off', (select count(*)::text from off), 'the switch''s templates_deactivated'
    -- c. archive
    union all
    select 20, 'c. archive', x.t, x.n::text, 'rows copied into archive_v1'
      from (values
        ('regions',                    (select count(*) from public.regions)),
        ('lessons',                    (select count(*) from public.lessons)),
        ('student_lesson_completions', (select count(*) from public.student_lesson_completions)),
        ('lesson_notes',               (select count(*) from public.lesson_notes)),
        ('student_lesson_ratings',     (select count(*) from public.student_lesson_ratings)),
        ('quizzes',                    (select count(*) from public.quizzes)),
        ('quiz_questions',             (select count(*) from public.quiz_questions)),
        ('student_quiz_attempts',      (select count(*) from public.student_quiz_attempts)),
        ('student_region_quiz',        (select count(*) from public.student_region_quiz)),
        ('student_achievements',       (select count(*) from public.student_achievements)),
        ('achievements',               (select count(*) from public.achievements)),
        ('student_milestones',         (select count(*) from public.student_milestones)),
        ('student_lesson_watch (old lessons)',
           (select count(*) from public.student_lesson_watch where lesson_id not in (select id from public.lessons_next))),
        ('lesson_videos (old lessons)',
           (select count(*) from public.lesson_videos where lesson_id not in (select id from public.lessons_next)))
      ) as x(t, n)
    -- d. playbook
    union all
    select 30, 'd. playbook', 'graduates the switch stamps',
           (select count(*)::text from grads g where not exists
              (select 1 from milestone m where m.student_id = g.student_id and m.stamped is not null)),
           'the switch''s graduates_stamped'
    union all
    select 31, 'd. playbook', '...of them by l078 (the Playbook lesson)', (select count(*)::text from by_l078), 'info'
    union all
    select 32, 'd. playbook', '...of them by 80% of the counting lessons, with no wait',
           (select count(*)::text from by_80), 'info'
    union all
    select 33, 'd. playbook', 'first logins the switch fills in',
           (select count(distinct c.student_id)::text from public.student_lesson_completions c
             where coalesce(c.completed_at, c.skipped_at, c.action_completed_at) is not null
               and not exists (select 1 from milestone m where m.student_id = c.student_id and m.first_sprint_login_at is not null)),
           'the switch''s logins_backfilled'
    -- e. csm
    union all
    select 40, 'e. csm', 'open tasks: ' || g.what, g.n::text, 'dismissed by the switch'
      from (select case when k.scenario_id like 'nolessons.%' then 'nolessons.*'
                        when k.scenario_id like 'noship.%'    then 'noship.*'
                        when k.scenario_id like 'pace.%'      then 'pace.*'
                        else k.scenario_id || ' (its template is turned off)' end as what, count(*) as n
              from public.tasks k
             where k.status = 'open'
               and (k.scenario_id like 'nolessons.%' or k.scenario_id like 'noship.%' or k.scenario_id like 'pace.%'
                    or k.template_id in (select id from off))
             group by 1) g
    union all
    select 41, 'e. csm', 'open tasks the switch dismisses',
           (select count(*)::text from public.tasks k
             where k.status = 'open'
               and (k.scenario_id like 'nolessons.%' or k.scenario_id like 'noship.%' or k.scenario_id like 'pace.%'
                    or k.template_id in (select id from off))),
           'the switch''s tasks_dismissed'
    union all
    select 42, 'e. csm', 'open alerts: ' || a, n::text,
           case when a = 'no_login_5d' then 'left open by the switch' else 'dismissed by the switch' end
      from (select alert_type as a, count(*) as n from public.disengagement_alerts
             where not is_dismissed and alert_type in ('no_tasks_7d', 'no_lessons_3d', 'no_login_5d')
             group by alert_type) x
    union all
    select 43, 'e. csm', 'open alerts the switch dismisses',
           (select count(*)::text from public.disengagement_alerts
             where not is_dismissed and alert_type in ('no_tasks_7d', 'no_lessons_3d')),
           'the switch''s alerts_dismissed'
    -- f. staging
    union all
    select 50, 'f. staging', 'lessons in lessons_next', n::text, '141' from staging
    union all
    select 51, 'f. staging', 'counting toward progress', counting::text, '140' from staging
    union all
    select 52, 'f. staging', 'the gate', gates, 'a4l17' from staging
    union all
    select 53, 'f. staging', 'with a Whop lesson id / distinct', with_whop || ' / ' || distinct_whop, '141 / 141' from staging
    union all
    select 54, 'f. staging', 'placeholder titles / ids not like a3l07', placeholders || ' / ' || odd_ids, '0 / 0' from staging
    union all
    select 55, 'f. staging', 'areas in regions_next',
           (select string_agg(id || ':' || order_num, ', ' order by order_num) from public.regions_next),
           'a1:1, a2:2, a3:3, a4:4, a5:5, a6:6, a7:7, a8:8'
    -- g. ready
    union all
    select 60, 'g. ready', 'v103 ran (the column, the two area columns, the view, the floor)',
           case when exists (select 1 from information_schema.columns where table_schema = 'public'
                               and table_name = 'student_milestones' and column_name = 'playbook_unlocked_at')
                 and (select count(*) = 2 from information_schema.columns where table_schema = 'public'
                        and table_name = 'regions' and column_name in ('landmark_label', 'rail_at'))
                 and to_regclass('public.student_last_counted_completion') is not null
                 and exists (select 1 from pg_trigger where tgname = 'trg_daily_snapshots_reset_floor' and not tgisinternal)
                then 'yes' else 'no' end,
           'yes'
    union all
    select 61, 'g. ready', 'lesson_videos (v100)', case when to_regclass('public.lesson_videos') is null then 'no' else 'yes' end, 'yes'
    union all
    select 62, 'g. ready', 'schema archive_v1', case when to_regnamespace('archive_v1') is null then 'absent' else 'PRESENT' end,
           'absent before the switch'
    union all
    select 63, 'g. ready', 'admin_config curriculum_reset_at',
           coalesce((select value from public.admin_config where key = 'curriculum_reset_at'), 'absent'),
           'absent before the switch'
  ) t
 order by o, part, item;
