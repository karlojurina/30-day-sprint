-- ============================================================
-- The 80% rule and the windows that closed before it (2026-10-26):
-- who it would reach back to, counted on this database.
--
-- READ ONLY: one select. It changes no row and locks nothing. Paste it into
-- the SQL editor on the database the app reads (after the course switch)
-- and read the five lines.
--
-- WHY. The owner, 2026-10-26: "They have to watch 80% of the 61 videos, or
-- whatever amount of videos we have, until the end of video ads 2." The app
-- asked for every video until that build, so a student whose window closed
-- before it with 49 to 60 watched in time could not apply, and today has no
-- Apply either (the window is closed). Whether the 80% reaches back to them
-- is the owner's call. Until he makes it the map's closed line tells them the
-- rule their window had, every video (checkpointView.ts expiredRuleLine,
-- discount.ts DISCOUNT_EIGHTY_FROM), and nothing else changes for them.
-- These lines are how many he would be deciding for.
--
-- THE RULE, as the app has it (src/lib/world/discount.ts, held to it by
-- supabase/migration-tests/eighty-closed-windows.test.mjs):
--   the videos: the counting watch lessons up to and including the gate
--     lesson, in course order, that have a lesson_videos row (61 today);
--     80% of them rounded up is needed (49 of 61);
--   the window: a first payment from 1 October (2026-09-30 22:00 UTC) until
--     the launch (2026-10-08 22:00 UTC) closes at the end of 23 October in
--     Croatia (2026-10-23 21:59:59.999 UTC); one from the launch on, 14 days
--     after it; one before 1 October, or none, never opened;
--   in time: a video whose completed_at is at or before the window's end;
--   the request that decides (requestCounts): the newest one made from the
--     launch on, or made before it and not rejected by a student of the
--     shared window.
--
-- THE LINES, each a student count, how many of them hold an active or
-- past_due membership, the first and the last deadline among them, and
-- their student ids. Every line is students whose window has closed, who
-- had at least 80% of the videos by their deadline but not every one.
--   a  deadline before 26 October (Croatia), no request: they met the 80% in
--      time while the app asked for every video, and never applied. A yes
--      from the owner reaches them.
--   b  the same, their request rejected (the team, under every video).
--   c  the same, their request still pending: the 30% page judges it by the
--      80% today, so the normal Approve passes it.
--   d  deadline on or after 26 October, no request. Until the 80% build
--      went live the app asked these for every video too; one whose window
--      closed after it could have applied. Read the deadlines against the
--      day the build went live.
--   e  the same as d, their request rejected.
--
-- EXPECT: five rows, a to e. Before the switch the catalog has no gate in
-- public.lessons, so every line reads 0.
-- ============================================================

with
  gate as (select min(sort_order) as at from public.lessons where is_gate),
  counted as (
    select l.id
      from public.lessons l
     where l.sort_order <= (select at from gate)
       and l.type = 'watch'
       and l.counts_toward_progress
       and exists (select 1 from public.lesson_videos v where v.lesson_id = l.id)),
  bar as (
    select count(*)::int                    as total,
           ((count(*) * 80 + 99) / 100)::int as needed
      from counted),
  paid as (
    select s.id, s.membership_status, s.first_paid_at,
           s.first_paid_at < timestamptz '2026-10-08 22:00:00+00' as shared
      from public.students s
     where s.first_paid_at >= timestamptz '2026-09-30 22:00:00+00'),
  windows as (
    select p.*,
           case when p.shared then timestamptz '2026-10-23 21:59:59.999+00'
                -- 14 days as 336 hours: '14 days' would follow the session's clocks across the change of 25 October.
                else p.first_paid_at + interval '336 hours' end as ends_at
      from paid p),
  closed as (
    select w.*,
           (select count(distinct c.lesson_id)
              from public.student_lesson_completions c
             where c.student_id = w.id
               and c.completed_at is not null
               and c.completed_at <= w.ends_at
               and c.lesson_id in (select id from counted))::int as in_time
      from windows w
     where w.ends_at < now()),
  deciding as (
    select distinct on (r.student_id) r.student_id, r.status
      from public.discount_requests r
      join closed c on c.id = r.student_id
     where r.created_at >= timestamptz '2026-10-08 22:00:00+00'
        or (r.status <> 'rejected' and c.shared)
     order by r.student_id, r.created_at desc, r.id desc),
  reached as (
    select c.id, c.membership_status, c.ends_at,
           c.ends_at < timestamptz '2026-10-25 23:00:00+00' as before_rule,
           d.status
      from closed c
      left join deciding d on d.student_id = c.id
     where (select needed from bar) > 0
       and c.in_time >= (select needed from bar)
       and c.in_time < (select total from bar)),
  lines (line, what, before_rule, status) as (
    values
      ('a', 'deadline before 26 Oct, 80% or more in time but not every video, no request', true, null),
      ('b', 'deadline before 26 Oct, 80% or more in time but not every video, request rejected', true, 'rejected'),
      ('c', 'deadline before 26 Oct, 80% or more in time but not every video, request pending (Approve passes it today)', true, 'pending'),
      ('d', 'deadline from 26 Oct on, 80% or more in time but not every video, no request', false, null),
      ('e', 'deadline from 26 Oct on, 80% or more in time but not every video, request rejected', false, 'rejected'))
select l.line,
       l.what,
       count(r.id)                                                                   as students,
       count(r.id) filter (where r.membership_status in ('active', 'past_due'))       as active_or_past_due,
       to_char(min(r.ends_at) at time zone 'Europe/Zagreb', 'YYYY-MM-DD HH24:MI')    as first_deadline,
       to_char(max(r.ends_at) at time zone 'Europe/Zagreb', 'YYYY-MM-DD HH24:MI')    as last_deadline,
       string_agg(r.id::text, ', ' order by r.id)                                    as ids
  from lines l
  left join reached r
    on r.before_rule = l.before_rule
   and r.status is not distinct from l.status
 group by l.line, l.what
 order by l.line;
