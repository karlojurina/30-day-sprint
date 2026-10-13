-- ============================================================
-- The course in the staging catalog, and its videos: one table that says
-- where things stand.
--
-- Run it after 2026_v101_course_catalog.sql, and again after
-- load-lesson-videos.sql. Read only: it changes no table and locks nothing,
-- so it is safe to run any time, repeatedly.
--
-- WHAT IT SHOWS
--   One row per area of the staging catalog (regions_next, lessons_next) and
--   a total: how many lessons, how many count toward progress, how many are
--   action items, how many have a video row, how many have a length.
--   Then four checks. On those rows the number found is in the rows column,
--   and each should read 0:
--     placeholder_titles
--         lessons still titled like v94's seed ("Fundamentals · lesson 3").
--     video_rows_on_unknown_lessons
--         rows of lesson_videos whose lesson is in neither catalog. Nothing
--         can play them.
--     watch_lessons_with_video_and_no_length
--         watch lessons, in either catalog, that have a video row and no
--         duration_seconds. Nobody can complete such a lesson (v100,
--         consequence 2).
--     video_rows_on_lessons_that_are_not_watch
--         video rows whose lesson, in either catalog, has another type than
--         watch. The lesson page never plays them.
--
-- Read the VERDICT column. INFO is a number to read. PASS is a check that
-- holds. Anything else needs a look.
--
-- WHAT TO EXPECT
--   After v101:      rows 8, 11, 25, 17, 26, 22, 19, 13 and 141 in total,
--                    with_video and with_length 0, four times PASS.
--   After the load:  with_video and with_length equal on every row, at the
--                    number of lessons that have a video, four times PASS.
--
-- HOW IT READS lesson_videos
--   Only when the table exists, so the file also runs where migration
--   2026_v100 has not. The block below reads the LESSON ids out of the table
--   and hands them to the select in a session setting. A video id is never
--   read, and none can appear in the result.
--   If the block and the select did not share a session, the select says so
--   in its verdict column. It does not report 0 videos.
--   The select takes what the block read only when that is under five
--   minutes old. Pasted and run in one go, it is this run's. Sent statement
--   by statement on a session that is used again, the select alone can show
--   the lessons an earlier run read less than five minutes before.
-- ============================================================

do $read$
declare
  v_lessons text;
begin
  if to_regclass('public.lesson_videos') is null then
    perform set_config('course_check.videos', 'absent', false);
    perform set_config('course_check.video_lessons', '', false);
  else
    execute 'select string_agg(lesson_id, '','') from public.lesson_videos' into v_lessons;
    perform set_config('course_check.videos', 'read', false);
    perform set_config('course_check.video_lessons', coalesce(v_lessons, ''), false);
  end if;
  -- When this was read. The select takes the two settings above only when
  -- this is under five minutes old, so a value left on the connection long
  -- ago is not taken for this run's.
  perform set_config('course_check.read_at', clock_timestamp()::text, false);
end
$read$;

with video as (
  -- 'read', 'absent', or 'not handed over' when the block above did not
  -- reach this select.
  select case when coalesce(nullif(current_setting('course_check.read_at', true), ''), '2000-01-01')::timestamptz
                   > clock_timestamp() - interval '5 minutes'
              then coalesce(nullif(current_setting('course_check.videos', true), ''), 'not handed over')
              else 'not handed over'
         end as state,
         coalesce(string_to_array(nullif(current_setting('course_check.video_lessons', true), ''), ','),
                  '{}'::text[]) as lesson_ids
),
areas as (
  select r.order_num                                                    as place,
         r.id                                                           as item,
         r.name                                                         as name,
         count(l.id)::int                                               as rows,
         count(l.id) filter (where l.counts_toward_progress)::int       as counting,
         count(l.id) filter (where l.requires_action)::int              as action_items,
         case when v.state = 'read'
              then count(l.id) filter (where l.id = any (v.lesson_ids))::int
         end                                                            as with_video,
         count(l.id) filter (where l.duration_seconds is not null)::int as with_length
    from public.regions_next r
    cross join video v
    left join public.lessons_next l on l.region_id = r.id
   group by r.order_num, r.id, r.name, v.state, v.lesson_ids
),
not_checked as (
  select case v.state
           when 'read' then null
           when 'absent' then 'NOT CHECKED: public.lesson_videos does not exist. Migration 2026_v100 has not run.'
           else 'NOT CHECKED: the block at the top of this file did not reach this select. Run the whole file in one go.'
         end as why
    from video v
),
checks as (
  select 2001 as place, 'placeholder_titles' as item,
         'lessons still titled like the placeholder seed' as name,
         (select count(*)::int from public.lessons_next where title like '% · lesson %') as found,
         null::text as why
  union all
  select 2002, 'video_rows_on_unknown_lessons',
         'video rows whose lesson is in neither catalog',
         case when n.why is null then
           (select count(*)::int
              from video v, unnest(v.lesson_ids) as x(id)
             where not exists (select 1 from public.lessons_next l where l.id = x.id)
               and not exists (select 1 from public.lessons l where l.id = x.id))
         end,
         n.why
    from not_checked n
  union all
  select 2003, 'watch_lessons_with_video_and_no_length',
         'watch lessons with a video row and no duration_seconds',
         case when n.why is null then
           (select count(distinct w.id)::int
              from video v,
                   (select id from public.lessons_next where type = 'watch' and duration_seconds is null
                    union all
                    select id from public.lessons where type = 'watch' and duration_seconds is null) w
             where w.id = any (v.lesson_ids))
         end,
         n.why
    from not_checked n
  union all
  select 2004, 'video_rows_on_lessons_that_are_not_watch',
         'video rows on a lesson that is not a watch lesson',
         case when n.why is null then
           (select count(distinct w.id)::int
              from video v,
                   (select id from public.lessons_next where type <> 'watch'
                    union all
                    select id from public.lessons where type <> 'watch') w
             where w.id = any (v.lesson_ids))
         end,
         n.why
    from not_checked n
)
select t.item, t.name, t.rows, t.counting, t.action_items, t.with_video, t.with_length, t.verdict
  from (
    select a.place, a.item, a.name, a.rows, a.counting, a.action_items, a.with_video, a.with_length,
           'INFO' as verdict
      from areas a
    union all
    select 1000, 'total', 'the whole course',
           sum(a.rows)::int, sum(a.counting)::int, sum(a.action_items)::int,
           sum(a.with_video)::int, sum(a.with_length)::int,
           'INFO'
      from areas a
    union all
    select c.place, c.item, c.name, c.found, null, null, null, null,
           case when c.why is not null then c.why
                when c.found = 0 then 'PASS'
                else 'LOOK: expected 0'
           end
      from checks c
  ) t
 order by t.place;
-- EXPECT: 13 rows. Rows 1 to 9 are INFO. The last four are PASS.
