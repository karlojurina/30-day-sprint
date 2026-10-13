-- ============================================================
-- Connect the course's videos to its lessons: one lesson_videos row for
-- every lesson that has a video, and that lesson's length.
--
-- THIS FILE IS A TEMPLATE. It holds no video id and it must never hold one
-- here: the repository is public and a Tella id is the video's address. The
-- Tella tool (clients/ecom-university/tools/tella/, outside this repository)
-- writes a filled copy into its own private folder. That copy is the file to
-- paste into the SQL editor. Never save a filled copy inside the repository.
--
-- THE ONE LINE THAT CHANGES
--   Under "insert into _load values" stands one placeholder line. The tool
--   puts the rows in its place, one per lesson, the last one closed with a
--   semicolon:
--     ('a1l01', '<video id>', 756),
--     ('a1l02', '<video id>', 431);
--   That is: the lesson id, the Tella video id, the length in whole seconds.
--   A Tella video id is vid_ followed by 10 to 64 lower-case letters and
--   digits: no link, no spaces, no capitals.
--
-- WHAT IT DOES
--   The list is the whole truth about the course's videos. After this file
--   lesson_videos and the lengths say exactly what the list says, for the
--   lessons of the course. Every change happens in one transaction, so the
--   file either finishes or changes nothing.
--   1. Checks the list. See WHEN IT REFUSES.
--   2. Deletes the video row of every course lesson that is not in the list.
--   3. Writes the row of every lesson in the list. A row that already holds
--      the same video is not touched at all. A new row, and a row whose video
--      changed, start as 'unchecked' with no detail, so the next lock check
--      judges the video that is really there.
--   4. Sets duration_seconds on every listed lesson, in lessons_next and in
--      lessons, and empties it on every other watch lesson of the course. A
--      course lesson has a length exactly when it has a video.
--   5. Ends with a table: what this run did, then one row per area of the
--      staging catalog. It shows numbers only, never an id of a lesson or of
--      a video.
--
-- WHAT COUNTS AS A COURSE LESSON
--   An id shaped like a3l07: a, the area 1 to 8, l, two digits. A row of
--   lesson_videos on any other id, such as a test stamp on the live lesson
--   l004, is never read and never written, and neither is that lesson's
--   length.
--
-- WHEN IT REFUSES, changing nothing
--   * the placeholder line is still there;
--   * lesson_videos does not exist (migration 2026_v100 has not run);
--   * lessons_next still holds v94's placeholder lessons (migration
--     2026_v101 has not run). A placeholder has the same id as a real
--     lesson, so the videos would land on "Fundamentals · lesson 3";
--   * a lesson id in the list is not a course lesson id;
--   * a video id in the list is not shaped like a Tella video id;
--   * a lesson is in the list twice, or a video is;
--   * a length is empty, 0 or below;
--   * a lesson in the list is in neither catalog, or is not a watch lesson;
--   * a video in the list already sits on a lesson outside the course. That
--     is a test stamp, and unstamp-tella-test-lessons.sql takes it off.
--   No message repeats a video id. A message says WHICH lessons only when
--   their ids are shaped like course lesson ids: at most 10 of them, then
--   "and N more". Anything else found in the lesson column is counted and
--   never repeated, because a video id may have been pasted there.
--
-- SAFE TO RUN AGAIN. With the same list a second run changes nothing: no
-- row, no lock_status, no updated_at.
--
-- BEFORE THE CUTOVER a video row on a staging lesson plays on a deployment
-- that reads the staging catalog, and watching it is not counted yet (v100,
-- consequence 4).
--
-- Needs migrations 2026_v100_lesson_videos_and_speed.sql and
-- 2026_v101_course_catalog.sql to have run.
-- ============================================================

begin;

create temp table _load (lesson_id text, tella_video_id text, seconds int) on commit drop;

-- ▼▼▼ THE ROWS GO HERE, IN PLACE OF THE ONE LINE UNDER "values" ▼▼▼
insert into _load values
  ('REPLACE_WITH_ROWS', 'REPLACE_WITH_ROWS', 0);
-- ▲▲▲ nothing below this line changes ▲▲▲

do $load$
declare
  c_course constant text := '^a[1-8]l[0-9]{2}$';
  c_video  constant text := '^vid_[a-z0-9]{10,64}$';

  v_n       bigint;
  v_ids     text[];
  v_which   text;
  v_stamped text;
  v_loaded  bigint;
  v_new     bigint;
  v_changed bigint;
  v_removed bigint;
begin
  -- ─────────────── The list is checked before anything is written ───────────────
  -- A message never repeats a video id, and never a lesson id of the wrong
  -- shape. See the header.

  if exists (select 1 from _load n
              where n.lesson_id ~ 'REPLACE_WITH' or n.tella_video_id ~ 'REPLACE_WITH') then
    raise exception 'The placeholder line was not replaced with the rows. This file is the template: the file to run is the filled copy the Tella tool writes. Nothing was changed.';
  end if;

  if to_regclass('public.lesson_videos') is null then
    raise exception 'public.lesson_videos does not exist. Run migration 2026_v100 first: 2026_v100_lesson_videos_and_speed.sql. Nothing was changed.';
  end if;

  if exists (select 1 from public.lessons_next l where l.title like '% · lesson %') then
    raise exception 'The course catalog is still the placeholder one: public.lessons_next holds lessons titled like the seed of v94. Run migration 2026_v101_course_catalog.sql first. Nothing was changed.';
  end if;

  select count(*) into v_n from _load n
   where n.lesson_id is null or n.lesson_id !~ c_course;
  if v_n > 0 then
    raise exception '% row(s) of the list have a lesson id that is not a course lesson id. A course lesson id is a, the area 1 to 8, l and two digits, as in a3l07. Nothing was changed.', v_n;
  end if;

  select count(*) into v_n from _load n
   where n.tella_video_id is null or n.tella_video_id !~ c_video;
  if v_n > 0 then
    raise exception '% row(s) of the list have a video id that is not shaped like a Tella video id. The header of this file describes the shape: no link, no spaces, no capitals. Nothing was changed.', v_n;
  end if;

  -- From here on every lesson id of the list has the shape of a course
  -- lesson id, so a message may say which lessons it means. The filter on
  -- c_course is kept all the same: what does not match is never named.
  select count(*), array_agg(twice.lesson_id order by twice.lesson_id) filter (where twice.lesson_id ~ c_course)
    into v_n, v_ids
    from (select n.lesson_id from _load n group by n.lesson_id having count(*) > 1) twice;
  if v_n > 0 then
    v_which := coalesce(array_to_string(v_ids[1:10], ', '), 'none that can be named')
               || case when cardinality(v_ids) > 10 then ' and ' || (cardinality(v_ids) - 10) || ' more' else '' end;
    raise exception '% lesson(s) are in the list more than once: %. A lesson has one video. Nothing was changed.', v_n, v_which;
  end if;

  select count(*) into v_n
    from (select n.tella_video_id from _load n group by n.tella_video_id having count(*) > 1) twice;
  if v_n > 0 then
    raise exception '% video(s) are in the list more than once. A video belongs to one lesson. Nothing was changed.', v_n;
  end if;

  select count(*) into v_n from _load n
   where n.seconds is null or n.seconds <= 0;
  if v_n > 0 then
    raise exception '% row(s) of the list have a length that is empty, 0 or below. A length is a whole number of seconds above 0. Nothing was changed.', v_n;
  end if;

  select count(*), array_agg(n.lesson_id order by n.lesson_id) filter (where n.lesson_id ~ c_course)
    into v_n, v_ids
    from _load n
   where not exists (select 1 from public.lessons_next l where l.id = n.lesson_id)
     and not exists (select 1 from public.lessons l where l.id = n.lesson_id);
  if v_n > 0 then
    v_which := coalesce(array_to_string(v_ids[1:10], ', '), 'none that can be named')
               || case when cardinality(v_ids) > 10 then ' and ' || (cardinality(v_ids) - 10) || ' more' else '' end;
    raise exception '% lesson(s) of the list are in neither public.lessons_next nor public.lessons: %. The list was written from another catalog than the one this database holds. Run migration 2026_v101_course_catalog.sql, or have the tool write the list again. Nothing was changed.', v_n, v_which;
  end if;

  select count(*), array_agg(n.lesson_id order by n.lesson_id) filter (where n.lesson_id ~ c_course)
    into v_n, v_ids
    from _load n
   where exists (select 1 from public.lessons_next l where l.id = n.lesson_id and l.type <> 'watch')
      or exists (select 1 from public.lessons l where l.id = n.lesson_id and l.type <> 'watch');
  if v_n > 0 then
    v_which := coalesce(array_to_string(v_ids[1:10], ', '), 'none that can be named')
               || case when cardinality(v_ids) > 10 then ' and ' || (cardinality(v_ids) - 10) || ' more' else '' end;
    raise exception '% lesson(s) of the list are not watch lessons: %. Only a watch lesson can hold a video. Nothing was changed.', v_n, v_which;
  end if;

  -- A video of the list that sits on a lesson outside the course. The lesson
  -- named here comes out of lesson_videos, and it is a live lesson.
  select count(*), string_agg(v.lesson_id, ', ' order by v.lesson_id)
    into v_n, v_stamped
    from public.lesson_videos v
    join _load n on n.tella_video_id = v.tella_video_id
   where v.lesson_id !~ c_course;
  if v_n > 0 then
    raise exception '% video(s) of the list already sit on a lesson outside the course: %. That is a test stamp on a live lesson: unstamp it first, with supabase/diagnostics/unstamp-tella-test-lessons.sql, and run this file again. Nothing was changed.', v_n, v_stamped;
  end if;

  -- ─────────────── What this run is about to do, counted before it does it ───────────────

  select count(*),
         count(*) filter (where v.lesson_id is null),
         count(*) filter (where v.lesson_id is not null and v.tella_video_id <> n.tella_video_id)
    into v_loaded, v_new, v_changed
    from _load n
    left join public.lesson_videos v on v.lesson_id = n.lesson_id;

  select count(*) into v_removed
    from public.lesson_videos v
   where v.lesson_id ~ c_course
     and not exists (select 1 from _load n where n.lesson_id = v.lesson_id);

  -- ─────────────── The sync, over course lessons only ───────────────

  -- Course lessons that are no longer in the list lose their row.
  delete from public.lesson_videos v
   where v.lesson_id ~ c_course
     and not exists (select 1 from _load n where n.lesson_id = v.lesson_id);

  -- A video the list now gives to another lesson leaves the lesson it was on.
  -- Without this the insert below would meet the rule "one lesson per video".
  delete from public.lesson_videos v
   using _load n
   where v.lesson_id ~ c_course
     and n.tella_video_id = v.tella_video_id
     and n.lesson_id <> v.lesson_id;

  -- The rows of the list. The WHERE leaves a row alone when it already holds
  -- the same video, so its lock_status and its updated_at stay as they are.
  insert into public.lesson_videos as v (lesson_id, tella_video_id)
  select n.lesson_id, n.tella_video_id from _load n
  on conflict (lesson_id) do update
    set tella_video_id  = excluded.tella_video_id,
        lock_status     = 'unchecked',
        lock_detail     = null,
        lock_checked_at = null,
        updated_at      = now()
  where v.tella_video_id is distinct from excluded.tella_video_id;

  -- The lengths. REQUIRED: a lesson with a video and no duration_seconds
  -- cannot be completed by anyone (v100, consequence 2).
  update public.lessons_next l
     set duration_seconds = n.seconds
    from _load n
   where l.id = n.lesson_id
     and l.duration_seconds is distinct from n.seconds;

  update public.lessons l
     set duration_seconds = n.seconds
    from _load n
   where l.id = n.lesson_id
     and l.duration_seconds is distinct from n.seconds;

  -- A watch lesson of the course that has no video has no length.
  update public.lessons_next l
     set duration_seconds = null
   where l.id ~ c_course
     and l.type = 'watch'
     and l.duration_seconds is not null
     and not exists (select 1 from _load n where n.lesson_id = l.id);

  update public.lessons l
     set duration_seconds = null
   where l.id ~ c_course
     and l.type = 'watch'
     and l.duration_seconds is not null
     and not exists (select 1 from _load n where n.lesson_id = l.id);

  -- Hand the four numbers to the select below. _load is gone after the
  -- commit, and the numbers hold no id.
  perform set_config('course_load.did', v_loaded || ',' || v_new || ',' || v_changed || ',' || v_removed, false);
  perform set_config('course_load.at', clock_timestamp()::text, false);
end
$load$;

commit;

-- What it did. This is the table the SQL editor shows.
with did as (
  -- The four numbers of this run. They are read only when the block above
  -- set them in the last five minutes, so numbers left on the connection by
  -- an earlier run are never shown as this run's.
  select string_to_array(current_setting('course_load.did', true), ',') as n
   where coalesce(nullif(current_setting('course_load.at', true), ''), '2000-01-01')::timestamptz
         > clock_timestamp() - interval '5 minutes'
),
areas as (
  select r.order_num                                                    as place,
         r.id                                                           as line,
         r.name                                                         as name,
         count(l.id)::int                                               as lessons,
         count(v.lesson_id)::int                                        as with_video,
         count(l.id) filter (where l.duration_seconds is not null)::int as with_length
    from public.regions_next r
    left join public.lessons_next l on l.region_id = r.id
    left join public.lesson_videos v on v.lesson_id = l.id
   group by r.order_num, r.id, r.name
)
select t.line, t.name, t.loaded, t.new_rows, t.changed_videos, t.removed_rows,
       t.lessons, t.with_video, t.with_length
  from (
    select 0 as place, 'this run' as line, 'the whole course' as name,
           (select d.n[1]::int from did d) as loaded,
           (select d.n[2]::int from did d) as new_rows,
           (select d.n[3]::int from did d) as changed_videos,
           (select d.n[4]::int from did d) as removed_rows,
           sum(a.lessons)::int             as lessons,
           sum(a.with_video)::int          as with_video,
           sum(a.with_length)::int         as with_length
      from areas a
    union all
    select a.place, a.line, a.name, null, null, null, null,
           a.lessons, a.with_video, a.with_length
      from areas a
  ) t
 order by t.place;
-- EXPECT: 9 rows. On the first row, loaded is the number of rows in the list
-- and with_video and with_length both equal it. On every row with_video
-- equals with_length. A second run of the same file shows new_rows 0,
-- changed_videos 0 and removed_rows 0.
--
-- If the file ran without an error and the first row shows no numbers under
-- loaded, the block and this select did not share a session. The load still
-- happened: with_video and with_length say so.
