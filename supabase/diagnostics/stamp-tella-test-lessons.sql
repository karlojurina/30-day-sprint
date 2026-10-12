-- ============================================================
-- Stamp the two Tella test videos onto TWO live lessons. It picks the lessons
-- itself.
--
-- BEFORE YOU RUN IT: paste the two test video ids over the two placeholders
-- just under this header, inside the quotes. Nothing else in the file needs
-- editing. If a placeholder is left as it is, the file stops with a message
-- and changes nothing.
--
-- ⚠ Paste the ids in the SQL editor only. Never save this file with an id in
--   it: the repository is public and a Tella id is the video's address.
--
-- WHAT IT DOES. Every change happens inside one block, so it either finishes
-- or changes nothing.
--   1. Takes back any earlier run of itself. The lessons holding those two
--      videos get their duration_seconds put back and their lesson_videos
--      rows deleted, the same way unstamp-tella-test-lessons.sql does it.
--   2. Picks the two watch lessons FEWEST students have completed, breaking
--      ties toward the end of the course, so the test rows land where nobody
--      is working. Same ordering as stamp-test-lesson.sql.
--      If a lesson it picked already has a video that is not one of your two
--      test videos, it STOPS and changes nothing. It never replaces a video
--      it did not put there.
--   3. Sets their duration_seconds to 67, the length of both test videos, and
--      writes their lesson_videos rows: the first id on the first lesson.
--   4. Ends with a select of the two lessons and the path that opens each one
--      in the app. The result never shows a video id, and neither do this
--      file's own error messages.
--
-- ⚠ LOOK AT old_watch_rows IN THE RESULT. It should be 0 on both rows. If it
--   is not, that lesson was watched before (the Bunny player's test lesson
--   can be one of the two). An old watch row keeps its furthest point, its
--   seconds and its 95% stamp, and an old completion stays a completion, so
--   the lesson can show as done before you press play. Clear your own rows
--   first with the optional block at the foot of the unstamp file.
--
-- SAFE ON THE LIVE APP.
--   * Nothing on /dashboard reads lesson_videos or duration_seconds.
--   * A lesson's real length is longer than 67 s. That only matters to the
--     new player, and no student can reach the new player yet.
--   * The lesson's type, title, region and order are untouched, so the map
--     does not move and nobody's progress changes.
--
-- SAFE TO RUN AGAIN. With the same two ids it lands on the same two lessons,
-- as long as the same two are still the least completed. Your own test
-- completion counts as a completion, so after you finish a test lesson a
-- second run can move to another lesson. The lesson it leaves is put back
-- first, and the final select says so.
--   * To switch to two other test videos, take the old ones back first: the
--     unstamp file, with the OLD ids. If you skip that, this file sees the
--     old pair as videos it did not put there, and stops.
--
-- TO TAKE IT BACK: unstamp-tella-test-lessons.sql, with the same two ids.
-- Needs migration 2026_v100_lesson_videos_and_speed.sql to have run.
-- ============================================================

do $stamp$
declare
  -- ▼▼▼ PASTE THE TWO TEST VIDEO IDS OVER THE TWO PLACEHOLDERS ▼▼▼
  v_video_1 text := 'REPLACE_WITH_TEST_VIDEO_ID_1';
  v_video_2 text := 'REPLACE_WITH_TEST_VIDEO_ID_2';
  -- ▲▲▲ nothing below this line needs editing ▲▲▲

  -- Both test videos are 67.262 s long.
  c_test_seconds constant int := 67;
  -- The Bunny test stamp stamp-test-lesson.sql left on one lesson. A lesson
  -- that still carries it had duration_seconds = 753 before this file touched
  -- it, so 753 is what it gets back. Every other lesson had none.
  c_bunny_test_video constant text := '09ff6d92-1312-4b96-bc3b-75b5edbcab34';
  c_bunny_seconds    constant int  := 753;

  v_earlier  text[];
  v_lessons  text[];
  v_occupied text[];
begin
  v_video_1 := btrim(v_video_1, E' \t\r\n');
  v_video_2 := btrim(v_video_2, E' \t\r\n');

  -- 0. Refuse to run half edited. No message repeats what was pasted.
  if v_video_1 ~ 'REPLACE_WITH' then
    raise exception 'Placeholder 1 was not replaced. Paste the first test video id over it and run the file again. Nothing was changed.';
  end if;
  if v_video_2 ~ 'REPLACE_WITH' then
    raise exception 'Placeholder 2 was not replaced. Paste the second test video id over it and run the file again. Nothing was changed.';
  end if;
  if v_video_1 !~ '^vid_[a-z0-9]{10,64}$' then
    raise exception 'What was pasted over placeholder 1 is not a Tella video id. An id is vid_ followed by 10 to 64 lower-case letters and digits: no link, no spaces. Nothing was changed.';
  end if;
  if v_video_2 !~ '^vid_[a-z0-9]{10,64}$' then
    raise exception 'What was pasted over placeholder 2 is not a Tella video id. An id is vid_ followed by 10 to 64 lower-case letters and digits: no link, no spaces. Nothing was changed.';
  end if;
  if v_video_1 = v_video_2 then
    raise exception 'Both placeholders hold the same video id. Each test lesson needs a video of its own. Nothing was changed.';
  end if;
  if to_regclass('public.lesson_videos') is null then
    raise exception 'public.lesson_videos does not exist. Run migration 2026_v100_lesson_videos_and_speed.sql first. Nothing was changed.';
  end if;

  -- 1. Take back any earlier run of this file.
  select array_agg(v.lesson_id order by v.lesson_id)
    into v_earlier
    from public.lesson_videos v
   where v.tella_video_id in (v_video_1, v_video_2);

  if v_earlier is not null then
    update public.lessons l
       set duration_seconds = case when l.bunny_video_id = c_bunny_test_video
                                   then c_bunny_seconds end
     where l.id = any (v_earlier);

    delete from public.lesson_videos v
     where v.tella_video_id in (v_video_1, v_video_2);
  end if;

  -- 2. The two watch lessons fewest students have completed.
  select array_agg(p.id order by p.place)
    into v_lessons
    from (
      select l.id,
             row_number() over (
               order by count(c.student_id) asc, l.sort_order desc, l.id desc
             ) as place
        from public.lessons l
        left join public.student_lesson_completions c
               on c.lesson_id = l.id and c.completed_at is not null
       where l.type = 'watch'
       group by l.id, l.sort_order
       order by count(c.student_id) asc, l.sort_order desc, l.id desc
       limit 2
    ) p;

  if coalesce(array_length(v_lessons, 1), 0) < 2 then
    raise exception 'Fewer than two watch lessons exist, so there is nothing to stamp. Nothing was changed.';
  end if;

  -- Step 1 removed this file's own rows. A row still sitting on a picked
  -- lesson therefore holds some OTHER video, and a lesson_videos row is the
  -- only record of which video belongs to which lesson. Stop. The raise also
  -- undoes step 1, so nothing at all is changed. The message names the lesson
  -- and never a video.
  select array_agg(v.lesson_id order by v.lesson_id)
    into v_occupied
    from public.lesson_videos v
   where v.lesson_id = any (v_lessons);

  if v_occupied is not null then
    raise exception '% a video that is not one of your two test videos: a real lesson video, or a test video from another pair. This file does not replace a video it did not put there. If it is an old test video, run unstamp-tella-test-lessons.sql with the OLD ids first. Nothing was changed.',
      case when array_length(v_occupied, 1) = 1
           then 'Lesson ' || v_occupied[1] || ' already has'
           else 'Lessons ' || array_to_string(v_occupied, ' and ') || ' already have'
      end;
  end if;

  -- 3. Stamp them. REQUIRED: since v97 a lesson with a video and no
  --    duration_seconds cannot be completed by anyone.
  update public.lessons
     set duration_seconds = c_test_seconds
   where id = any (v_lessons);

  insert into public.lesson_videos (lesson_id, tella_video_id)
  values (v_lessons[1], v_video_1),
         (v_lessons[2], v_video_2);

  -- 4. Hand the LESSON ids to the select below. The video ids stay in here.
  perform set_config('tella_kit.stamped', array_to_string(v_lessons, ','), false);
  perform set_config('tella_kit.earlier', coalesce(array_to_string(v_earlier, ', '), ''), false);
end
$stamp$;

-- What it stamped. Note the two paths: they are what you open in the app.
select t.place::int                              as test_lesson,
       l.id                                      as lesson_id,
       l.region_id,
       l.title,
       l.duration_seconds                        as duration_now,
       '/world/' || l.region_id || '/' || l.id   as open_in_the_app,
       (select count(*)::int from public.student_lesson_watch w
         where w.lesson_id = l.id)               as old_watch_rows,
       case when coalesce(current_setting('tella_kit.earlier', true), '') = ''
            then 'nothing was stamped before this run'
            else 'an earlier run was taken back first: '
                 || current_setting('tella_kit.earlier', true)
       end                                       as before_this_run
  from unnest(string_to_array(current_setting('tella_kit.stamped', true), ','))
       with ordinality as t(lesson_id, place)
  join public.lessons l on l.id = t.lesson_id
 order by t.place;
-- EXPECT: two rows, duration_now = 67 and old_watch_rows = 0 on both. Row 1
-- plays the first video, row 2 the second.
--
-- If the block above ran without an error and this result is empty, the two
-- statements did not share a session. The stamp still happened. This lists
-- every live lesson that has a video row:
--   select l.id, l.region_id, l.title, l.duration_seconds
--     from public.lesson_videos v join public.lessons l on l.id = v.lesson_id;
