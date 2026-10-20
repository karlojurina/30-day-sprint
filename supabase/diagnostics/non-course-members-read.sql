-- ============================================================
-- Students the app lets in, counted per Whop plan (login-1, 2026-10-20).
--
-- Paste the whole file into the Supabase SQL editor and run it. Read only:
-- one select, it changes no table and locks nothing. Only counts come out,
-- next to the plan the rows carry: no name, email or id of any student.
--
-- WHY. Until the fix of login-1 the Whop webhook wrote 'active' for a
-- membership of any product of the company, and the login lets an 'active'
-- or 'past_due' row in without asking Whop. So someone who holds only a
-- product WHOP_PRODUCT_ID does not name (a one-time product, say) could
-- have a row that opens the whole course. This counts those rows.
--
-- HOW IT TELLS THEM APART. The Whop sync (sync-whop, every 2 hours)
-- rewrites the row of everyone Whop lists under the course products in
-- WHOP_PRODUCT_ID, and every rewrite moves the row's updated_at (the
-- students_updated_at trigger). An active or past_due row older than the
-- start of the last successful sync was not rewritten by it: Whop did not
-- list that person under the course.
--
-- THE COLUMNS
--   plan               the rows' whop_plan_id, (none) when they have none
--   status             active or past_due
--   students           rows with that plan and status
--   not_in_last_sync   of those, rows older than the last successful sync:
--                      no course membership when it ran. The test accounts,
--                      and the rows a membership of another product made.
--   last_sync          when that sync started, in UTC
--
-- EXPECT not_in_last_sync at 0, apart from the test accounts in
-- WHOP_BYPASS_USER_IDS and WHOP_BYPASS_EMAILS, which get in without a
-- course membership on purpose. A row the webhook wrote may have no plan:
-- the webhook reads plan_id, and Whop's documented payload names the plan
-- as plan.id. Any write moves updated_at too (a login, a finished lesson),
-- so someone who holds only another product and was active after the last
-- sync counts under students but not under not_in_last_sync: that column
-- is a floor. Run it right after a sync has finished, when the gap is
-- smallest.
-- ============================================================

with last_sync as (
  select max(started_at) as at
    from public.cron_runs
   where route_name = 'sync-whop'
     and status = 'success'
)
select coalesce(s.whop_plan_id, '(none)') as plan,
       s.membership_status as status,
       count(*) as students,
       count(*) filter (where s.updated_at < l.at) as not_in_last_sync,
       coalesce(to_char(l.at at time zone 'utc', 'YYYY-MM-DD HH24:MI') || ' UTC',
                'no successful sync on record: not_in_last_sync means nothing') as last_sync
  from public.students s
 cross join last_sync l
 where s.membership_status in ('active', 'past_due')
 group by s.whop_plan_id, s.membership_status, l.at
 order by not_in_last_sync desc, students desc, plan, status;
-- EXPECT one row per plan and status; not_in_last_sync 0 on every plan
-- except a handful for the test accounts.
