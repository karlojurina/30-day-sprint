-- ============================================================
-- UNDO for v111 (supabase/migrations/2026_v111_student_membership_discounts.sql)
--
-- NOT A MIGRATION. A file in supabase/undo/ is never run in sequence with
-- supabase/migrations/. This one is run by hand, and only to take v111 back.
--
-- WHAT IT DOES
--   Drops student_membership_discounts, its policy and its rows. Nothing
--   else in the database points at it.
--
-- WHAT CHANGES FOR ANYONE
--   The map stops telling a student that a discount is already on their
--   membership (/api/student/data reads no row and logs the failed read),
--   and the admin's 30% page says it could not read the coupons. The request
--   and approve routes still ask Whop themselves, so a student with such a
--   discount is still refused while Whop answers. The cron route
--   refresh-membership-discounts fails on its first write until v111 is
--   pasted again; remove its entry from vercel.json if v111 is to stay out.
--
-- WHEN THE TABLE IS BUSY
--   It waits 5 seconds at most. A stop on "canceling statement due to lock
--   timeout" (SQLSTATE 55P03) changed nothing. Paste it again in a minute.
--
-- Safe to run again: with the table gone it changes nothing. v111 can run
-- again after it (the cron fills the table again within 2 hours).
-- ============================================================

begin;

set local lock_timeout = '5s';

drop table if exists public.student_membership_discounts;

commit;

select to_regclass('public.student_membership_discounts') as table_left;
-- EXPECT one row: table_left null.
