-- ============================================================
-- Before v114 (supabase/migrations/2026_v114_video_ads_ii_action_items.sql):
-- what the paste changes for students, counted on this database.
--
-- READ ONLY: one select. It changes no row and locks nothing. Paste it into
-- the SQL editor before v114, on the database v114 is for (after the course
-- switch), and read the five lines.
--
-- It reads every student's lessons twice, with Video Ads II's four editing
-- breakdowns (a4l02 to a4l05) as plain videos ("before") and as action items
-- ("after"), every other lesson as public.lessons holds it, so it gives the
-- same answer before v114 and after it. Done is lesson_is_complete (v92), as
-- every count; the Playbook's rule is isPlaybookUnlocked (src/lib/progress.ts):
-- the stamp, or the last counting lesson done, or 30 days since the first
-- payment (else the join; with neither, the app reads 1 January 1970) with
-- done lessons at 80% or more of the counting lessons (every done lesson
-- counted, a non-counting one too).
--
-- THE LINES
--   a  students with a lesson v114 reopens: one of the four with its video
--      watched, not handed in and not skipped. Each such lesson counts as
--      not done from the paste on, until it is handed in.
--   b  those lessons, all students together.
--   c  students whose Playbook v114 closes: open before, closed after. They
--      hold it by the 80% rule alone and fall under 80%. ids: their student
--      ids. NOT 0 IS A DECISION FOR THE OWNER, before the paste: paste anyway
--      (each opens it again by handing in enough of the four), or first
--      stamp them with the block at the foot, a write on their rows that
--      needs his word.
--   d  students under 30 days whose Playbook would have opened on day 30
--      with the lessons they have done, and after v114 does not: it opens
--      once they hand in enough of the four.
--   e  active CSM templates with a condition on Video Ads II's completion
--      (region_complete or region_completion_pct on a4). From the paste on
--      they read the four open until handed in: for a student with one of
--      them watched and not handed in, Video Ads II reads not complete and
--      its share lower. Such a template can then match other students than
--      before: fewer on "is complete" or "at least", more on "is not
--      complete" or "at most". ids: their scenario ids. A condition on one
--      of the four by name reads the same at the paste: lesson_watched does
--      not change, and lesson_shipped stays false until a hand-in.
--
-- EXPECT: five rows, a to e, each with a count. Before the switch the four
-- are not in public.lessons, so a to d read 0 (and v114 refuses there).
-- ============================================================

with
  four (id) as (values ('a4l02'), ('a4l03'), ('a4l04'), ('a4l05')),
  counting as (select count(*)::numeric as n from public.lessons where counts_toward_progress),
  unlock as (
    select coalesce(
             (select id from public.lessons where feature_key = 'playbook_unlock' order by sort_order limit 1),
             (select id from public.lessons where counts_toward_progress order by sort_order desc limit 1)) as id),
  marks as (
    select c.student_id, c.lesson_id,
           public.lesson_is_complete(case when f.id is null then l.requires_action else false end,
                                     c.completed_at, c.action_completed_at, c.skipped_at) as done_before,
           public.lesson_is_complete(case when f.id is null then l.requires_action else true end,
                                     c.completed_at, c.action_completed_at, c.skipped_at) as done_after
      from public.student_lesson_completions c
      join public.lessons l on l.id = c.lesson_id
      left join four f on f.id = c.lesson_id),
  per as (
    select m.student_id,
           count(*) filter (where m.done_before)                                  as done_before,
           count(*) filter (where m.done_after)                                   as done_after,
           count(*) filter (where m.done_before and not m.done_after)             as reopened,
           coalesce(bool_or(m.done_before and m.lesson_id = (select id from unlock)), false) as unlock_before,
           coalesce(bool_or(m.done_after and m.lesson_id = (select id from unlock)), false)  as unlock_after
      from marks m
     group by m.student_id),
  gate as (
    select p.student_id, p.reopened,
           ms.playbook_unlocked_at is not null                                                      as stamped,
           coalesce(s.first_paid_at, s.joined_at, timestamptz 'epoch') <= now() - interval '30 days' as thirty,
           p.unlock_before, p.unlock_after,
           (select n from counting) > 0 and p.done_before >= 0.8 * (select n from counting)       as share_before,
           (select n from counting) > 0 and p.done_after >= 0.8 * (select n from counting)        as share_after
      from per p
      join public.students s on s.id = p.student_id
      left join public.student_milestones ms on ms.student_id = p.student_id),
  playbook as (
    select g.student_id,
           g.thirty,
           g.stamped or g.unlock_before or (g.thirty and g.share_before) as open_before,
           g.stamped or g.unlock_after  or (g.thirty and g.share_after)  as open_after,
           g.stamped or g.unlock_before or g.share_before                as at_thirty_before,
           g.stamped or g.unlock_after  or g.share_after                 as at_thirty_after
      from gate g),
  templates as (
    select t.scenario_id
      from public.templates t
     where t.is_active
       and jsonb_typeof(t.trigger_config -> 'all') = 'array'
       and exists (select 1 from jsonb_array_elements(t.trigger_config -> 'all') e
                    where e ->> 'metric' in ('region_complete', 'region_completion_pct')
                      and e ->> 'region' = 'a4'))
select line, what, found, ids
  from (
    select 'a' as line, 'students with a lesson v114 reopens (one of the four watched, not handed in)' as what,
           (select count(*) from per where reopened > 0)::text as found, null::text as ids
    union all
    select 'b', 'lessons it reopens, all students together',
           (select coalesce(sum(reopened), 0) from per)::text, null
    union all
    select 'c', 'students whose Playbook it closes (30 days or more, by the 80% rule alone, under 80% after)',
           count(*)::text, string_agg(student_id::text, ', ' order by student_id)
      from playbook where thirty and open_before and not open_after
    union all
    select 'd', 'students under 30 days whose Playbook would have opened on day 30 and now waits for the four',
           count(*)::text, string_agg(student_id::text, ', ' order by student_id)
      from playbook where not thirty and at_thirty_before and not at_thirty_after
    union all
    select 'e', 'active CSM templates with region_complete or region_completion_pct on a4',
           count(*)::text, string_agg(scenario_id, ', ' order by scenario_id)
      from templates
  ) x
 order by line;

-- OPTIONAL, ON THE OWNER'S WORD ONLY: stamp the Playbook for line c's students
--   So v114 takes it from none of them. It stamps
--   student_milestones.playbook_unlocked_at with now() for exactly the
--   students line c counts, by the same rule, keeps a stamp that is already
--   there, and touches no other student and no other column (a student with
--   no milestone row gets one, as the switch's stamp did). Keep line c's ids
--   from before it: they are the students it stamped. Take the two dashes
--   off each line below, run those lines alone, then this file again: line
--   c then reads 0.
--
--    with
--      four (id) as (values ('a4l02'), ('a4l03'), ('a4l04'), ('a4l05')),
--      counting as (select count(*)::numeric as n from public.lessons where counts_toward_progress),
--      unlock as (
--        select coalesce(
--                 (select id from public.lessons where feature_key = 'playbook_unlock' order by sort_order limit 1),
--                 (select id from public.lessons where counts_toward_progress order by sort_order desc limit 1)) as id),
--      marks as (
--        select c.student_id, c.lesson_id,
--               public.lesson_is_complete(case when f.id is null then l.requires_action else false end,
--                                         c.completed_at, c.action_completed_at, c.skipped_at) as done_before,
--               public.lesson_is_complete(case when f.id is null then l.requires_action else true end,
--                                         c.completed_at, c.action_completed_at, c.skipped_at) as done_after
--          from public.student_lesson_completions c
--          join public.lessons l on l.id = c.lesson_id
--          left join four f on f.id = c.lesson_id),
--      per as (
--        select m.student_id,
--               count(*) filter (where m.done_before) as done_before,
--               count(*) filter (where m.done_after)  as done_after,
--               coalesce(bool_or(m.done_before and m.lesson_id = (select id from unlock)), false) as unlock_before,
--               coalesce(bool_or(m.done_after and m.lesson_id = (select id from unlock)), false)  as unlock_after
--          from marks m
--         group by m.student_id),
--      closing as (
--        select p.student_id
--          from per p
--          join public.students s on s.id = p.student_id
--          left join public.student_milestones ms on ms.student_id = p.student_id
--         where ms.playbook_unlocked_at is null
--           and coalesce(s.first_paid_at, s.joined_at, timestamptz 'epoch') <= now() - interval '30 days'
--           and (p.unlock_before or ((select n from counting) > 0 and p.done_before >= 0.8 * (select n from counting)))
--           and not (p.unlock_after or ((select n from counting) > 0 and p.done_after >= 0.8 * (select n from counting))))
--    insert into public.student_milestones (student_id, playbook_unlocked_at)
--    select student_id, now() from closing
--    on conflict (student_id) do update
--      set playbook_unlocked_at = coalesce(public.student_milestones.playbook_unlocked_at, excluded.playbook_unlocked_at);
