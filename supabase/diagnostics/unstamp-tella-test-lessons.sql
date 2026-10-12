-- ============================================================
-- Take the two Tella test videos back off the lessons
-- stamp-tella-test-lessons.sql put them on.
--
-- BEFORE YOU RUN IT: paste the same two test video ids over the two
-- placeholders just under this header, inside the quotes. If a placeholder is
-- left as it is, the file stops with a message and changes nothing.
--
-- ⚠ Paste the ids in the SQL editor only. Never save this file with an id in
--   it: the repository is public and a Tella id is the video's address.
--
-- WHAT IT DOES. Every change happens inside one block, so it either finishes
-- or changes nothing.
--   1. Finds the lessons whose lesson_videos row holds one of the two videos.
--      It finds them by the video, so it does not matter which lessons the
--      stamp picked.
--   2. Puts each lesson's duration_seconds back: to 753 when the lesson still
--      carries the Bunny test stamp (that is how stamp-test-lesson.sql left
--      it), to empty for any other lesson.
--   3. Deletes those lesson_videos rows.
--   4. Ends with a select of the lessons it put back.
--
-- WHAT IT LEAVES ALONE. Your test watch rows and your test completions stay.
-- tella-proof.sql still lists them afterwards, though its percentages are
-- then measured against the duration that was put back. The optional block at
-- the foot of this file removes them.
--
-- SAFE TO RUN AGAIN. A second run finds nothing, changes nothing, and its
-- result says so.
--
-- Run this before the cutover.
-- ============================================================

do $unstamp$
declare
  -- ▼▼▼ PASTE THE SAME TWO TEST VIDEO IDS OVER THE TWO PLACEHOLDERS ▼▼▼
  v_video_1 text := 'REPLACE_WITH_TEST_VIDEO_ID_1';
  v_video_2 text := 'REPLACE_WITH_TEST_VIDEO_ID_2';
  -- ▲▲▲ nothing below this line needs editing ▲▲▲

  -- The Bunny test stamp stamp-test-lesson.sql left on one lesson. A lesson
  -- that still carries it had duration_seconds = 753 before the Tella stamp.
  c_bunny_test_video constant text := '09ff6d92-1312-4b96-bc3b-75b5edbcab34';
  c_bunny_seconds    constant int  := 753;

  v_lessons text[];
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
    raise exception 'Both placeholders hold the same video id. Paste the two different ids the stamp was run with. Nothing was changed.';
  end if;
  if to_regclass('public.lesson_videos') is null then
    raise exception 'public.lesson_videos does not exist, so there is nothing to take back. Nothing was changed.';
  end if;

  -- 1. Which lessons hold the two videos.
  select array_agg(v.lesson_id order by v.lesson_id)
    into v_lessons
    from public.lesson_videos v
   where v.tella_video_id in (v_video_1, v_video_2);

  if v_lessons is not null then
    -- 2. The duration each lesson had before the stamp.
    update public.lessons l
       set duration_seconds = case when l.bunny_video_id = c_bunny_test_video
                                   then c_bunny_seconds end
     where l.id = any (v_lessons);

    -- 3. The rows themselves.
    delete from public.lesson_videos v
     where v.tella_video_id in (v_video_1, v_video_2);
  end if;

  -- 4. Hand the LESSON ids to the select below. The video ids stay in here.
  perform set_config('tella_kit.unstamped', coalesce(array_to_string(v_lessons, ','), ''), false);
end
$unstamp$;

-- What it put back.
with taken_back as (
  select t.lesson_id, l.region_id, l.title, l.duration_seconds
    from unnest(string_to_array(
           nullif(current_setting('tella_kit.unstamped', true), ''), ',')) as t(lesson_id)
    left join public.lessons l on l.id = t.lesson_id
)
select lesson_id,
       region_id,
       title,
       duration_seconds as duration_now,
       case when duration_seconds is null
            then 'video row deleted; duration put back to empty'
            else 'video row deleted; duration put back to ' || duration_seconds
                 || ' (the Bunny test stamp)'
       end as what_happened
  from taken_back
union all
select null, null, null, null,
       'Nothing to take back: no lesson holds either test video. Nothing was changed.'
 where not exists (select 1 from taken_back)
 order by 1;
-- EXPECT after a stamp: two rows. On a second run: one row saying there was
-- nothing to take back.

-- ============================================================
-- OPTIONAL: start the proof again from zero
--
-- Not run with the file. Use it when the stamp's result showed old watch rows
-- on a test lesson, or when you want to watch the same test lesson again as
-- if for the first time: a lesson that is already complete is not completed
-- a second time, and a watch row that already reached 95% keeps that stamp,
-- so a second watch proves nothing while they are there.
--
-- Paste the two statements into a new query, replace the three placeholders
-- (the two lesson ids from the stamp's result, and your student id from
-- my-student-id.sql), and run them.
--
-- ⚠ Keep the student_id line. These are live lessons. Without it the second
--   statement deletes every student's completion of them.
-- It removes the rows only. A streak day or an achievement your test
-- completion earned stays. And if you had finished one of these lessons for
-- real before the test, that completion goes too.
--
--    delete from public.student_lesson_watch
--     where lesson_id in ('REPLACE_WITH_LESSON_ID_1', 'REPLACE_WITH_LESSON_ID_2')
--       and student_id = 'REPLACE_WITH_YOUR_STUDENT_ID'::uuid;
--
--    delete from public.student_lesson_completions
--     where lesson_id in ('REPLACE_WITH_LESSON_ID_1', 'REPLACE_WITH_LESSON_ID_2')
--       and student_id = 'REPLACE_WITH_YOUR_STUDENT_ID'::uuid;
-- ============================================================
