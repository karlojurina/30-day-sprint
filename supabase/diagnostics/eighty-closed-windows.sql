-- ============================================================
-- The 80% rule and the windows of the 30% that had closed by then
-- (2026-10-26): where the owner's call leaves each student, counted on this
-- database.
--
-- READ ONLY: one select. It changes no row and locks nothing. Paste it into
-- the SQL editor on the database the app reads (after the course switch)
-- and read the five lines. Run it again right after the 80% build goes live:
-- lines d and e grow with every window that closes before then.
--
-- THE OWNER'S CALL (2026-10-26). "They have to watch 80% of the 61 videos,
-- or whatever amount of videos we have, until the end of video ads 2." Asked
-- whether a window that closed before that day could still apply, judged at
-- its deadline by the 80% (A), or whether the 80% counts from that day, those
-- windows staying closed and the map never telling them a rule their window
-- did not have (B): "B and 80% of the first 61 videos, not all videos." So
-- from 00:00 on 26 October in Croatia (2026-10-25 23:00 UTC) a window asks for
-- 80% of the videos, and a window that ended before then keeps every video
-- (src/lib/world/discount.ts DISCOUNT_EIGHTY_FROM and videosNeededFor; the
-- approval and the 30% page judge its requests by every video). The 80% build
-- goes live after that day, so a window that closed in between had the 80%
-- by the owner's call while production still asked for every video: what
-- those students get (lines d and e) is the owner's call too.
--
-- THE RULE, as the app has it (src/lib/world/discount.ts and
-- discount-server.ts, held to it by
-- supabase/migration-tests/eighty-closed-windows.test.mjs, which runs
-- approvalVerdict itself on every pending request it lists):
--   the videos: the counting watch lessons up to and including the gate
--     lesson, in course order, that have a lesson_videos row (61 today);
--     80% of them rounded up (49 of 61);
--   the window: a first payment from 1 October (2026-09-30 22:00 UTC) until
--     the launch (2026-10-08 22:00 UTC) closes at the end of 23 October in
--     Croatia (2026-10-23 21:59:59.999 UTC); one from the launch on, 14 days
--     after it; one before 1 October, or none, never opened;
--   in time: a video whose completed_at is at or before the window's end;
--   the request that decides what the map shows (requestCounts): the newest
--     made from the launch on, or made before it and not rejected by a
--     student of the shared window;
--   what the 30% page lists: every request made from 1 October, counted by
--     the map or not.
--
-- THE LINES, each a student count, how many of them hold an active or
-- past_due membership, the first and the last deadline among them (in
-- Croatia), and every student with their own deadline, oldest first (line c
-- names each pending request too). Every line is students whose window has
-- closed, with at least 80% of the videos by their deadline but not every
-- one.
--   a  deadline before 26 October, no request on the map and none pending
--      on the 30% page: closed, and it stays so (the owner's B).
--   b  the same, their request rejected: it stays so.
--   c  deadline before 26 October, a pending request the 30% page lists,
--      judged as the approve route judges it: by the videos loaded when the
--      request was made (at the switch, for one made before it), at least
--      80% of them done by the deadline and not every one, the request made
--      no more than 5 minutes after the deadline, beside no other counted
--      request that was rejected, approved or applied, and with no stored
--      coupon row for the membership on file refusing it first (a coupon, or
--      no real payment, which the 30% page shows first). The branch before
--      the review of 2026-10-26 approved these at the 80%; the normal
--      Approve refuses them now (every video), so the team rejects them, or a
--      founder or an admin presses Approve anyway.
--   d  deadline from 26 October on, no request on the map and none pending:
--      the 80% was theirs by the owner's call, and a student whose deadline
--      passes before the 80% build goes live sees no Apply at 80%. Read each
--      deadline against the moment the build is live: the earlier ones are
--      owed the owner's answer.
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
  switch as (select (select value from public.admin_config where key = 'curriculum_reset_at')::timestamptz as at),
  paid as (
    select s.id, s.membership_status, s.first_paid_at, s.whop_membership_id,
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
           w.ends_at < timestamptz '2026-10-25 23:00:00+00' as before_rule,
           (select count(distinct c.lesson_id)
              from public.student_lesson_completions c
             where c.student_id = w.id
               and c.completed_at is not null
               and c.completed_at <= w.ends_at
               and c.lesson_id in (select id from counted))::int as in_time
      from windows w
     where w.ends_at < now()),
  -- The pending requests the 30% page lists: any made from 1 October, counted by the map or not.
  listed as (
    select r.id as request_id, r.student_id, r.created_at
      from public.discount_requests r
      join closed c on c.id = r.student_id
     where r.status = 'pending'
       and r.created_at >= timestamptz '2026-09-30 22:00:00+00'),
  deciding as (
    select distinct on (r.student_id) r.student_id, r.status
      from public.discount_requests r
      join closed c on c.id = r.student_id
     where r.created_at >= timestamptz '2026-10-08 22:00:00+00'
        or (r.status <> 'rejected' and c.shared)
     order by r.student_id, r.created_at desc, r.id desc),
  -- Lines a, b, d and e: no pending request listed, 80% or more of today's videos in time and not every one.
  by_student as (
    select c.id, c.membership_status, c.ends_at, c.before_rule, d.status, null::uuid as request_id
      from closed c
      left join deciding d on d.student_id = c.id
     where (select needed from bar) > 0
       and c.in_time >= (select needed from bar)
       and c.in_time < (select total from bar)
       and not exists (select 1 from listed l where l.student_id = c.id)),
  -- Line c: every listed pending request of a window that ended before the rule, with the moment its videos are
  -- counted at (approvalVerdict's videosAsOf: the switch for a request made before it, else the request's own).
  judged as (
    select l.request_id, l.student_id, l.created_at, c.membership_status, c.ends_at, c.shared, c.whop_membership_id,
           case when (select at from switch) > l.created_at then (select at from switch) else l.created_at end as as_of
      from listed l
      join closed c on c.id = l.student_id
     where c.before_rule),
  judged_counts as (
    select j.*,
           (select count(*)
              from counted k
             where not exists (select 1 from public.lesson_videos v where v.lesson_id = k.id and v.created_at > j.as_of))::int as total,
           (select count(distinct x.lesson_id)
              from public.student_lesson_completions x
             where x.student_id = j.student_id
               and x.completed_at is not null
               and x.completed_at <= j.ends_at
               and x.lesson_id in (select k.id
                                     from counted k
                                    where not exists (select 1 from public.lesson_videos v where v.lesson_id = k.id and v.created_at > j.as_of)))::int as in_time
      from judged j),
  by_request as (
    select j.student_id as id, j.membership_status, j.ends_at, true as before_rule, 'pending'::text as status, j.request_id
      from judged_counts j
     where j.total > 0
       and j.in_time >= (j.total * 80 + 99) / 100
       and j.in_time < j.total
       -- not made more than 5 minutes after the deadline (madeOutsideApply's late request)
       and j.created_at <= j.ends_at + interval '5 minutes'
       -- beside no other counted request that was rejected, approved or applied (madeOutsideApply's other request)
       and not exists (
             select 1
               from public.discount_requests o
              where o.student_id = j.student_id
                and o.id <> j.request_id
                and o.status in ('rejected', 'approved', 'applied')
                and (o.created_at >= timestamptz '2026-10-08 22:00:00+00' or (o.status <> 'rejected' and j.shared)))
       -- no stored coupon row for the membership on file refusing it first: a coupon, or no real payment
       -- (storedRowApplies: with no membership id on file, the student's row counts)
       and not exists (
             select 1
               from public.student_membership_discounts m
              where m.student_id = j.student_id
                and (j.whop_membership_id is null or j.whop_membership_id !~ '^mem_\w+$' or m.whop_membership_id = j.whop_membership_id)
                and (m.discounted or (m.promo_code_id is null and m.renewal_price is null)))),
  reached as (
    select * from by_student
    union all
    select * from by_request),
  lines (line, what, before_rule, status, by_request) as (
    values
      ('a', 'deadline before 26 Oct, 80% or more in time but not every video, no request: closed and stays so (the owner''s B)', true, null, false),
      ('b', 'deadline before 26 Oct, 80% or more in time but not every video, request rejected: stays so', true, 'rejected', false),
      ('c', 'deadline before 26 Oct, a pending request at 80% or more of its videos in time but not every one: the normal Approve refuses it now', true, 'pending', true),
      ('d', 'deadline from 26 Oct on, 80% or more in time but not every video, no request: those closing before the build is live are owed the owner''s answer', false, null, false),
      ('e', 'deadline from 26 Oct on, 80% or more in time but not every video, request rejected: the same as d', false, 'rejected', false))
select l.line,
       l.what,
       count(distinct r.id)                                                                   as students,
       count(distinct r.id) filter (where r.membership_status in ('active', 'past_due'))      as active_or_past_due,
       to_char(min(r.ends_at) at time zone 'Europe/Zagreb', 'YYYY-MM-DD HH24:MI')             as first_deadline,
       to_char(max(r.ends_at) at time zone 'Europe/Zagreb', 'YYYY-MM-DD HH24:MI')             as last_deadline,
       string_agg(to_char(r.ends_at at time zone 'Europe/Zagreb', 'YYYY-MM-DD HH24:MI') || ' ' || r.id::text
                    || coalesce(' request ' || r.request_id::text, ''),
                  ', ' order by r.ends_at, r.id, r.request_id)                                as deadlines_and_ids
  from lines l
  left join reached r
    on r.before_rule = l.before_rule
   and r.status is not distinct from l.status
   and (r.request_id is not null) = l.by_request
 group by l.line, l.what
 order by l.line;
