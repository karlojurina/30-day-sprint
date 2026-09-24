-- ============================================================
-- Stamp the Bunny test video onto ONE lesson. Self-selecting — run it as is.
--
-- Picks the watch lesson FEWEST students have completed, breaking ties toward
-- the end of the course, so the test row lands where nobody is working.
--
-- Safe on the live app: nothing on /dashboard reads bunny_video_id (LessonSheet
-- opens whop.com from whop_lesson_id) and duration_seconds has no readers
-- there. Invisible to all ~845 students until /world ships.
--
-- Idempotent: clears any previous stamp first, so re-running cannot collide
-- with the partial unique index on bunny_video_id.
-- ============================================================

begin;

update public.lessons
   set bunny_video_id = null, duration_seconds = null, video_ready_at = null
 where bunny_video_id = '09ff6d92-1312-4b96-bc3b-75b5edbcab34';

update public.lessons
   set bunny_video_id  = '09ff6d92-1312-4b96-bc3b-75b5edbcab34',
       -- 753.321333s, measured off the real player 2026-09-22. REQUIRED:
       -- since v97 a lesson with a video but no duration cannot be completed
       -- by anyone, because the client is no longer allowed to supply the
       -- denominator for the 95% check.
       duration_seconds = 753,
       video_ready_at   = now()
 where id = (
   select l.id
     from public.lessons l
     left join public.student_lesson_completions c
            on c.lesson_id = l.id and c.completed_at is not null
    where l.type = 'watch'
    group by l.id, l.sort_order
    order by count(c.student_id) asc, l.sort_order desc, l.id desc
    limit 1
 );

commit;

-- What it picked:
select id, region_id, day, title, type, bunny_video_id, duration_seconds
  from public.lessons
 where bunny_video_id is not null;
-- EXPECT: exactly one row.

-- ── UNDO ──
--   update public.lessons
--      set bunny_video_id = null, duration_seconds = null, video_ready_at = null
--    where bunny_video_id = '09ff6d92-1312-4b96-bc3b-75b5edbcab34';
