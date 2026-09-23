-- ============================================================
-- Stamp ONE real lesson with the Bunny test video.
--
-- WHY. The end-to-end proof (W8) has to run on a row in `lessons`, not in
-- `lessons_next`, because student_lesson_completions.lesson_id has a foreign
-- key to `lessons` (v3:60). A completion can only ever be written for a lesson
-- that exists there, so the chain — play -> heartbeat -> 95% -> completion ->
-- streak -> achievements -> CSM re-evaluation — can only be proven on a real
-- row. This is that row.
--
-- IS THIS SAFE ON THE LIVE APP? Yes, and it is worth knowing why rather than
-- taking my word:
--   * Nothing on /dashboard reads `bunny_video_id`. LessonSheet.tsx opens
--     whop.com from `whop_lesson_id`; the Bunny player is not on that page.
--   * `duration_seconds` is new in v92 and has no readers on /dashboard.
--   * The lesson's `type`, `title`, `region_id` and `sort_order` are untouched,
--     so the map does not move and nobody's progress changes.
-- It is a no-op for all ~845 students until /world ships.
--
-- HOW TO UNDO: the last statement in this file, commented out.
-- ============================================================

-- ─── STEP 1 · pick a lesson ───────────────────────────────────────────
-- Watch lessons, with how many students have finished each. Pick one with a
-- LOW count — something late in the course that few people have reached — so
-- the test row sits somewhere nobody is currently working.

select
  l.id,
  l.region_id,
  l.day,
  l.title,
  count(c.student_id) as students_completed
from lessons l
left join student_lesson_completions c
       on c.lesson_id = l.id
      and c.completed_at is not null
where l.type = 'watch'
group by l.id, l.region_id, l.day, l.title, l.sort_order
order by students_completed asc, l.sort_order desc
limit 15;


-- ─── STEP 2 · stamp it ────────────────────────────────────────────────
-- Replace 'lXXX' with the id you picked, then run.
--
-- 09ff6d92-... is the Bunny test video in library 759916. 753 is its real
-- length in seconds (753.321333, verified 2026-09-22), and duration_seconds
-- is REQUIRED for completion since v97 — a lesson with a video but no
-- duration can no longer be completed by anyone, deliberately.
--
--   update lessons
--      set bunny_video_id = '09ff6d92-1312-4b96-bc3b-75b5edbcab34',
--          duration_seconds = 753,
--          video_ready_at = now()
--    where id = 'lXXX';
--
--   -- confirm:
--   select id, title, type, bunny_video_id, duration_seconds, video_ready_at
--     from lessons where bunny_video_id is not null;
--   -- EXPECT: exactly one row, the lesson you picked.


-- ─── UNDO, if you want the row back to normal ─────────────────────────
--
--   update lessons
--      set bunny_video_id = null, duration_seconds = null, video_ready_at = null
--    where id = 'lXXX';
