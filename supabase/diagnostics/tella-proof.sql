-- ============================================================
-- Did the watching count? Read-only. Nothing to edit, run it as it is.
--
-- One row for every watch row in the database, newest first, next to the
-- completion it led to.
--
--   furthest_seconds         the furthest point the player reached
--   really_watched_seconds   the seconds really played (skipped parts are not
--                            in it)
--   lesson_seconds           lessons.duration_seconds as it is NOW
--   furthest_pct             needs 95 for the database to stamp
--                            threshold_met_at
--   watched_pct              needs 80 for the lesson to be marked complete
--                            (80 is the app's default; the WATCH_PLAYED_FLOOR
--                            setting can move it)
--   counted                  true when the lesson is marked complete
--
-- WHOSE ROWS. No student is shown. Until the new player is open to students,
-- student_lesson_watch is expected to hold only your own test rows. If it
-- ever holds rows from more than one account, this select cannot tell them
-- apart.
--
-- TWO THINGS THAT CAN MISLEAD.
--   * Run it BEFORE unstamp-tella-test-lessons.sql. The two percentages are
--     measured against the lesson's duration as it is now, and the unstamp
--     puts that back to empty or to 753.
--   * counted proves the watching only when first_played_at and completed_at
--     are both from this test. An older date on either means the watch row
--     or the completion was already there (the Bunny player's test lesson
--     can be one of the two test lessons). The seconds then include the
--     older watching, and a lesson that was already complete is counted
--     before you press play.
-- ============================================================

select
  w.lesson_id,
  w.max_position_seconds                                                   as furthest_seconds,
  w.watched_seconds                                                        as really_watched_seconds,
  l.duration_seconds                                                       as lesson_seconds,
  round(100 * w.max_position_seconds / nullif(l.duration_seconds, 0), 1)   as furthest_pct,
  round(100 * w.watched_seconds      / nullif(l.duration_seconds, 0), 1)   as watched_pct,
  w.heartbeat_count                                                        as heartbeats,
  w.first_played_at,
  w.last_heartbeat_at,
  w.threshold_met_at,
  c.completed_at,
  (c.completed_at is not null)                                             as counted
from public.student_lesson_watch w
left join public.lessons l
       on l.id = w.lesson_id
left join public.student_lesson_completions c
       on c.student_id = w.student_id
      and c.lesson_id  = w.lesson_id
order by w.last_heartbeat_at desc;
-- EXPECT after watching a test lesson to the end: one row for it,
-- furthest_pct at 95 or more, watched_pct at 80 or more, counted = true.
