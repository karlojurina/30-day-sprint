-- v6 wiring preflight (2026-10-07). READ-ONLY: one SELECT, no writes, no locks.
--
-- Why: the PRD for putting the v6 world map into /world rests on facts about
-- production that only the log records, and the log disagrees with itself
-- (project_log.md says v98 is still waiting; the memory note says v92-v98 are
-- applied; nothing says v99 was). Run this once in the Supabase SQL editor and
-- paste the whole result table back. Validated against the PGlite harness
-- before it was handed over.
--
-- Rows 9 and 10 are the two facts the design turns on: whether any completion
-- can point at a staging lesson id, and which table the heartbeat checks.

select 1 as "#",
       'v98 applied: student_current_region filters counts_toward_progress' as "check",
       (pg_get_viewdef('public.student_current_region'::regclass) ilike '%counts_toward_progress%')::text as value
union all
select 2, 'v99 applied: regions_next rows with a landmark_label / all rows',
       (select count(*) filter (where landmark_label is not null) || ' / ' || count(*) from regions_next)
union all
select 3, 'regions_next: id=name|landmark|rail_at',
       (select string_agg(id || '=' || name || '|' || coalesce(landmark_label, '-') || '|' || coalesce(rail_at::text, '-'),
                          '; ' order by order_num)
          from regions_next)
union all
select 4, 'lessons_next per area: rows/counting/actions/with_video/with_duration',
       (select string_agg(region_id || ':' || n || '/' || c || '/' || a || '/' || v || '/' || d, '; ' order by region_id)
          from (select region_id,
                       count(*)                                           as n,
                       count(*) filter (where counts_toward_progress)     as c,
                       count(*) filter (where requires_action)            as a,
                       count(*) filter (where bunny_video_id is not null) as v,
                       count(*) filter (where duration_seconds is not null) as d
                  from lessons_next
                 group by region_id) t)
union all
select 5, 'lessons_next titles still placeholders (rows with " · lesson ")',
       (select count(*)::text from lessons_next where title like '% · lesson %')
union all
select 6, 'live catalog: lessons / regions',
       (select (select count(*) from lessons) || ' / ' || (select count(*) from regions))
union all
select 7, 'test lesson(s) on the live table: id|type|duration_seconds',
       (select coalesce(string_agg(id || '|' || type || '|' || coalesce(duration_seconds::text, '-'), '; ' order by id), 'none')
          from lessons
         where bunny_video_id is not null)
union all
select 8, 'student_lesson_watch: rows / students / rows past the threshold',
       (select count(*) || ' / ' || count(distinct student_id) || ' / ' || count(*) filter (where threshold_met_at is not null)
          from student_lesson_watch)
union all
select 9, 'completions that point at a staging lesson id (expected 0)',
       (select count(*)::text from student_lesson_completions where lesson_id ~ '^a[1-8]l[0-9]{2}$')
union all
select 10, 'heartbeat validates against: lessons or lessons_next',
       (select case when pg_get_functiondef(p.oid) ilike '%lessons_next%' then 'lessons_next' else 'lessons' end
          from pg_proc p
         where p.proname = 'record_lesson_heartbeat'
         limit 1)
order by 1;
