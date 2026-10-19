-- ============================================================
-- T-089, the Whop catch-up: did it work? Read only, counts only.
--
-- Paste into the Supabase SQL editor on production after the write passes.
-- Put the run_started_at of the FIRST write response on the line marked
-- HERE (UTC, as the response gives it). One result table. It changes nothing.
--
-- Expect: c, e, f, i and j read 0 (c may hold members who joined after the
-- run began). g reads above 0: the catch-up's rows carry Whop's times, most
-- of them before the switch. h's second number reads 0.
-- ============================================================

with run as (
  select timestamptz '2026-10-20 07:00:00+00' as started_at          -- HERE
),
run_day as (   -- the start of the run's day, UTC (the streak's day)
  select date_trunc('day', started_at at time zone 'UTC') at time zone 'UTC' as at from run
),
sw as (
  select value::timestamptz as at
    from public.admin_config
   where key = 'curriculum_reset_at'
),
members as (
  select s.id, s.membership_status, s.whop_plan_id, s.first_paid_at, s.csm_exempt
    from public.students s
   where s.membership_status in ('active', 'past_due')
),
-- The pool check-csm-tasks and check-engagement read: active, on the paying
-- plan, first paid in the last 30 days and from 28 May, not exempt
-- (src/app/api/cron/check-csm-tasks/route.ts:144-155, src/lib/constants.ts:52-54).
pool as (
  select m.id
    from members m
   where m.membership_status = 'active'
     and m.csm_exempt = false
     and m.whop_plan_id = 'plan_4ZrwR4PmBsVsx'
     and m.first_paid_at >= greatest(timestamptz '2026-05-28 00:00:00+00', now() - interval '30 days')
),
sync as (
  select w.student_id, w.last_sync_at, w.last_sync_error, w.last_sync_error_at,
         coalesce(w.last_sync_fetched, 0) as fetched,
         coalesce(w.last_sync_matched, 0) as matched,
         coalesce(cardinality(w.last_sync_unmatched), 0) as unmatched
    from public.student_whop_sync w
    join members m on m.id = w.student_id
),
watched as (
  select c.student_id,
         count(*) as lessons,
         count(*) filter (where c.completed_at < (select at from sw)) as before_switch
    from public.student_lesson_completions c
    join members m on m.id = c.student_id
   where c.completed_at is not null
   group by c.student_id
),
work_today as (   -- a lesson or an action item finished on the run's day or later
  select distinct c.student_id
    from public.student_lesson_completions c
   where c.completed_at >= (select at from run_day)
      or c.action_completed_at >= (select at from run_day)
)
select 'a. active members (active or past_due)' as what,
       count(*)::text as found
  from members
union all
select 'b. of them, read from Whop since the run began',
       count(*)::text
  from sync
 where last_sync_at >= (select started_at from run)
union all
select 'c. of them, not read since the run began (expect 0, or members who joined after it)',
       count(*)::text
  from members m
  left join sync s on s.student_id = m.id
 where s.last_sync_at is null
    or s.last_sync_at < (select started_at from run)
union all
select 'd. a Whop read failure on a sync row since the run began (the catch-up writes none, so these are logins and visits)',
       count(*)::text
  from sync
 where last_sync_error_at >= (select started_at from run)
   and last_sync_error is not null
   and last_sync_error !~ '^Whop returned [0-9]+ interactions but 0 marked completed$'
union all
select 'e. Whop says they finished lessons, the app holds none of them (expect 0)',
       count(*)::text
  from sync s
  left join watched w on w.student_id = s.student_id
 where s.matched > 0
   and w.student_id is null
union all
select 'f. Whop lessons that match no lesson of the course, in reads since the run began (expect 0)',
       coalesce(sum(unmatched), 0)::text
  from sync
 where last_sync_at >= (select started_at from run)
union all
select 'g. watched lessons dated before the switch, and the students holding them',
       (select coalesce(sum(before_switch), 0) from watched)::text || ' lessons, '
       || (select count(*) from watched where before_switch > 0)::text || ' students'
union all
select 'h. the CSM pool, logged in, still 0 lessons: all / finished lessons on Whop (expect 0) / opened on Whop, finished none / not read since the run',
       count(*)::text || ' / '
       || count(*) filter (where s.matched > 0)::text || ' / '
       || count(*) filter (where s.matched = 0 and s.fetched > 0)::text || ' / '
       || count(*) filter (where s.student_id is null or s.last_sync_at < (select started_at from run))::text
  from pool p
  join public.student_milestones ms
    on ms.student_id = p.id and ms.first_sprint_login_at is not null
  left join watched w on w.student_id = p.id
  left join sync s on s.student_id = p.id
 where w.student_id is null
union all
select 'i. streak rows changed since the run began with no lesson or action item finished that day (expect 0)',
       count(*)::text
  from public.student_streaks st
  join members m on m.id = st.student_id
 where st.updated_at >= (select started_at from run)
   and st.student_id not in (select student_id from work_today)
union all
select 'j. "came back" (X.1) tasks created since the run began (expect 0)',
       count(*)::text
  from public.tasks t
 where t.scenario_id = 'X.1'
   and t.created_at >= (select started_at from run)
order by 1;
