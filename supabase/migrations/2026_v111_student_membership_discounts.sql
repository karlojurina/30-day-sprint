-- ============================================================
-- v111: student_membership_discounts (admin rebuild 2, D5).
--
-- THE PROBLEM
--   A student whose Whop membership already has a code that discounts the
--   next renewal (the forever 10% "evolve10": 165 live memberships on
--   2026-10-20, all renewing at 87.30 on the 97.00 plan) could also get the
--   30%. The app stores no promo field, so nothing could tell.
--
-- WHAT THIS FILE DOES, in one transaction
--   1. Makes student_membership_discounts: one row per student, what Whop
--      said about their membership when it was last read. `discounted` is
--      true when the membership carries a promo code and renews below its
--      plan's renewal price (src/lib/membership-discount.ts). The row goes
--      with the student (on delete cascade).
--   2. Turns on row level security with one policy: a team member reads
--      every row (current_user_is_team(), as discount_requests and tasks).
--      No policy lets a student or a visitor read or write, and their write
--      privileges are taken away besides. The service role, which skips row
--      level security, is the only writer: the cron route
--      /api/cron/refresh-membership-discounts and the discount routes.
--   3. Shows what it made.
--
-- WHAT CHANGES FOR ANYONE
--   Nothing at once: the table starts empty. The first cron run fills it
--   (every 2 hours at minute 40), and from then on the map tells a student
--   with such a discount "You can't apply for this discount because you
--   already have a discount applied to your account." with no Apply, and
--   the admin's 30% page shows the code on their request. The request and
--   approve routes ask Whop themselves and work with or without this table.
--
-- WHEN THE TABLE IS BUSY
--   It waits 5 seconds at most for any lock. A stop on "canceling statement
--   due to lock timeout" (SQLSTATE 55P03) changed nothing. Paste it again in
--   a minute.
--
-- UNDO: supabase/undo/2026_v111_undo.sql drops the table.
--
-- Re-runnable: a second run finds the table and its policy as they are and
-- changes nothing.
-- ============================================================

begin;

set local lock_timeout = '5s';

create table if not exists public.student_membership_discounts (
  student_id          uuid primary key references public.students(id) on delete cascade,
  whop_membership_id  text,
  promo_code_id       text,
  promo_code          text,
  renewal_price       numeric,
  plan_renewal_price  numeric,
  discounted          boolean not null,
  checked_at          timestamptz not null
);

comment on table public.student_membership_discounts is
  'Admin rebuild 2, D5 (v111): what Whop said about each student''s membership when last read. discounted = a promo code on the membership and a renewal_price below the plan''s renewal price. Written by the service role only (the cron route refresh-membership-discounts and the discount routes); the team reads.';

alter table public.student_membership_discounts enable row level security;

drop policy if exists "Team reads membership discounts" on public.student_membership_discounts;
create policy "Team reads membership discounts"
  on public.student_membership_discounts for select
  to authenticated
  using (public.current_user_is_team());

-- Supabase hands every new table in public to its API roles. Row level
-- security already refuses them every write here (no write policy), and a
-- visitor every read (no policy for anon); taking the privileges away too
-- covers TRUNCATE, which row level security does not.
revoke all on public.student_membership_discounts from anon;
revoke insert, update, delete, truncate, references, trigger on public.student_membership_discounts from authenticated;
grant select on public.student_membership_discounts to authenticated;

commit;

select c.relrowsecurity as row_level_security,
       (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'student_membership_discounts') as policies,
       (select count(*) from public.student_membership_discounts) as rows_now,
       has_table_privilege('anon', 'public.student_membership_discounts', 'select') as visitor_can_read,
       has_table_privilege('authenticated', 'public.student_membership_discounts', 'insert') as signed_in_can_insert,
       has_table_privilege('authenticated', 'public.student_membership_discounts', 'select') as signed_in_can_select
from pg_class c
where c.oid = 'public.student_membership_discounts'::regclass;
-- EXPECT one row: row_level_security true, policies 1, rows_now 0 on the
-- first run (the cron's rows on a later one), visitor_can_read false,
-- signed_in_can_insert false, signed_in_can_select true (the policy then
-- lets only a team member see rows).
