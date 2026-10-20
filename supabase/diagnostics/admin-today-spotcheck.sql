-- ============================================================
-- Today and the 30% page against the database: a spot check of 5
-- members picked at random. Read only.
--
-- For the admin rebuild's ship step (admin rebuild PRD, validation row
-- 15): the numbers on production equal the pages'. Paste the whole file
-- into the Supabase SQL editor on production. One result table, one row
-- per member. It changes nothing. Each run picks 5 others; run it again
-- for more.
--
-- ADMIN REBUILD 2 (2026-10-20) removed Today (/admin/today). Its columns
-- below (lessons, last_lesson, area) have no admin page to be read against
-- now; the 30% columns still read the 30% page until its rebuild (WI-3)
-- changes what a row shows. The population is still the one Today listed.
--
-- WHO. The members Today lists from (call C3): membership active or past
-- due, a Whop membership, not exempt from messages, any plan.
--
-- READ EACH COLUMN AGAINST THE PAGE. Each value is written the way the
-- page writes it, from the same views and the same 30% rule:
--   lessons        Today: "14 of 140 lessons". student_progress_counts,
--                  out of the lessons that count toward progress.
--   last_lesson    Today: "Last lesson Tue 27 Oct" (here with the time,
--                  Croatia time). student_last_counted_completion.
--   area           Today: "In Ad basics". student_current_region. "none":
--                  no counted lesson yet, and Today shows no area.
--   first_payment  Today and the 30% page: "Paid Sat 12 Sep".
--   videos_30      The 30% page: "Videos 57 of 61"; Today: "30%: 57 of 61
--                  videos". Out of the videos the 30% asks for, how many
--                  are done.
--   deadline_30    The 30% page: "Deadline Fri 23 Oct, 23:59 (Croatia
--                  time)". "No 30% deadline": the offer is not open to
--                  them.
--
-- WHERE TO LOOK. The 30% page: /admin/discounts?student=<student_id>. It
-- lists a member who asked for the 30% (Can still earn went with Today).
-- On To decide, a pending request's videos are the ones Approve judged: a
-- video loaded after the request is not asked for, and once the deadline has passed
-- only the videos done by it count, so that count can be lower than here.
--
-- THE 30% RULE, as src/lib/world/discount.ts holds it (every day begins at
-- midnight in Croatia):
--   * a first payment from Thu 1 Oct until the launch on Fri 9 Oct: one
--     deadline they all share, the end of Fri 23 Oct;
--   * a first payment from the launch on: 14 days from that payment;
--   * a first payment before 1 Oct, or none on file: no deadline.
-- The videos it asks for are the counting watch lessons, in course order,
-- up to and including the checkpoint lesson (is_gate), that have a video.
-- A video is done when the lesson's completion has completed_at set.
--
-- Section 29 of supabase/migration-tests/run.mjs runs this file after v104
-- and checks every column against the same facts worked out separately.
-- ============================================================

with picked as (
  select s.id, s.name, s.email, s.membership_status, s.whop_plan_id, s.first_paid_at
    from public.students s
   where s.membership_status in ('active', 'past_due')
     and s.whop_membership_id is not null
     and s.csm_exempt = false
   order by random()
   limit 5
),
counting as (
  select count(*) as n
    from public.lessons
   where counts_toward_progress
),
checkpoint as (
  -- The first checkpoint lesson in course order.
  select min(sort_order) as sort_order
    from public.lessons
   where is_gate is true
),
asked as (
  -- A lesson with no video yet cannot be watched, so it is not asked for.
  select l.id
    from public.lessons l
    join checkpoint g on l.sort_order <= g.sort_order
   where l.type = 'watch'
     and l.counts_toward_progress is not false
     and exists (select 1 from public.lesson_videos v where v.lesson_id = l.id)
)
select p.name,
       p.email,
       p.id as student_id,
       replace(p.membership_status, '_', ' ') || ', '
       || case when p.whop_plan_id = 'plan_4ZrwR4PmBsVsx' then 'Monthly'
               when p.whop_plan_id in ('plan_fMMqxAljrzu75', 'plan_VFDntXQf9cYMo') then 'Yearly'
               else 'Other plan' end as membership,
       coalesce(pc.completed_count, 0)::text || ' of ' || (select n from counting)::text || ' lessons' as lessons,
       coalesce(to_char(lc.last_completed_at at time zone 'Europe/Zagreb', 'Dy FMDD Mon, HH24:MI'), 'No lesson yet') as last_lesson,
       coalesce(r.name, cr.current_region, 'none') as area,
       coalesce(to_char(p.first_paid_at at time zone 'Europe/Zagreb', 'Dy FMDD Mon'), 'No first payment on file') as first_payment,
       (select count(distinct a.id)
          from asked a
          join public.student_lesson_completions c on c.lesson_id = a.id
         where c.student_id = p.id
           and c.completed_at is not null)::text
       || ' of ' || (select count(*) from asked)::text || ' videos' as videos_30,
       coalesce(to_char(dl.ends_at at time zone 'Europe/Zagreb', 'Dy FMDD Mon, HH24:MI') || ' (Croatia time)',
                'No 30% deadline') as deadline_30
  from picked p
  cross join lateral (
    select case
             when p.first_paid_at is null or p.first_paid_at < timestamptz '2026-09-30 22:00:00+00' then null
             when p.first_paid_at < timestamptz '2026-10-08 22:00:00+00' then timestamptz '2026-10-23 21:59:59.999+00'
             -- 14 days as 336 hours: an interval in days would follow the
             -- session's clock change of 25 October.
             else p.first_paid_at + interval '336 hours'
           end as ends_at
  ) dl
  left join public.student_progress_counts pc on pc.student_id = p.id
  left join public.student_last_counted_completion lc on lc.student_id = p.id
  left join public.student_current_region cr on cr.student_id = p.id
  left join public.regions r on r.id = cr.current_region
 order by p.name nulls last, p.email;
