-- ============================================================
-- The first-paid fix: where students.first_paid_at stands, and what the 30%
-- makes of it. Read only, counts only.
--
-- Paste into the Supabase SQL editor on production right before the repair's
-- write (POST /api/admin/first-paid-repair, {"mode":"write"}) and again right
-- after it. One result table. It changes nothing.
--
-- Since the fix first_paid_at is the student's first real Whop payment
-- (src/lib/first-payment.ts). The 30% reads it (discountWindow in
-- src/lib/world/discount.ts): empty, or before 1 October 2026 in Croatia
-- (30 September 22:00 UTC), closed; from then until the launch (9 October in
-- Croatia, 8 October 22:00 UTC), open until the end of 23 October; from the
-- launch on, 14 days (14 x 24 hours) from the payment.
--
-- Compare the two runs with the write's answer: line b's empty count drops
-- by moves.from_empty; line c drops by thirty.opens_was_before_oct_1 and
-- rises by thirty.closes and by the empty rows filled with a date before
-- 1 October; line e rises by thirty.to_after_launch, less
-- thirty.to_before_launch, plus the empty rows filled with a date from the
-- launch on. A first payment that moves within a minute changes no line.
-- ============================================================

with cut as (
  select timestamptz '2026-09-30 22:00:00+00'     as oct_1,    -- DISCOUNT_ELIGIBLE_FROM
         timestamptz '2026-10-08 22:00:00+00'     as launch,   -- DISCOUNT_LAUNCH_DATE
         timestamptz '2026-10-23 21:59:59.999+00' as shared    -- DISCOUNT_SHARED_DEADLINE
),
s as (   -- every student the repair reads: a Whop id, any status
  select st.membership_status in ('active', 'past_due') as member,
         st.first_paid_at as paid
    from public.students st
   where st.whop_user_id is not null
),
thirty as (   -- the 30% today, as discountWindow and discountState read the date (before any request)
  select s.member,
         case
           when s.paid is null then 'closed, no first payment'
           when s.paid < c.oct_1 then 'closed, first paid before 1 October'
           when s.paid < c.launch then
             case when now() <= c.shared then 'open, until the end of 23 October (paid 1 to 8 October)'
                  else 'ended, the 23 October deadline passed' end
           when now() <= s.paid + interval '336 hours' then 'open, 14 days from the payment'
           else 'ended, their 14 days passed'
         end as state
    from s cross join cut c
)
select 'a. students with a Whop id: all / active or past_due' as what,
       count(*)::text || ' / ' || count(*) filter (where member)::text as found
  from s
union all
select 'b. first_paid_at set / empty (all)',
       count(*) filter (where paid is not null)::text || ' / ' || count(*) filter (where paid is null)::text
  from s
union all
select 'c. first paid before 1 October 2026, Croatia: all / active or past_due',
       count(*) filter (where paid < c.oct_1)::text || ' / ' || count(*) filter (where paid < c.oct_1 and member)::text
  from s cross join cut c
union all
select 'd. first paid 1 to 8 October, before the launch: all / active or past_due',
       count(*) filter (where paid >= c.oct_1 and paid < c.launch)::text || ' / '
       || count(*) filter (where paid >= c.oct_1 and paid < c.launch and member)::text
  from s cross join cut c
union all
select 'e. first paid on or after the 9 October launch: all / active or past_due',
       count(*) filter (where paid >= c.launch)::text || ' / ' || count(*) filter (where paid >= c.launch and member)::text
  from s cross join cut c
union all
select 'f. the 30% today, active or past_due: ' || state,
       count(*)::text
  from thirty
 where member
 group by state
order by 1;
