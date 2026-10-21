-- ============================================================
-- UNDO for v113 (supabase/migrations/2026_v113_membership_discount_source.sql)
--
-- NOT A MIGRATION. A file in supabase/undo/ is never run in sequence with
-- supabase/migrations/. This one is run by hand, and only to take v113 back.
--
-- WHAT IT DOES
--   Drops student_membership_discounts.source and its check. Every row and
--   every other column stay as they are.
--
-- WHAT CHANGES FOR ANYONE
--   Nothing anyone sees. The cron and the discount routes notice the missing
--   column at their next write and write each row without it, as before
--   v113; the record of which step answered (the membership on file, the
--   membership found through the Whop user, or the latest real payment) is
--   gone.
--
-- WHEN THE TABLE IS BUSY
--   It waits 5 seconds at most. A stop on "canceling statement due to lock
--   timeout" (SQLSTATE 55P03) changed nothing. Paste it again in a minute.
--
-- Safe to run again: with the column gone it changes nothing, and with the
-- table gone too (v111's undo) it changes nothing. v113 can run again after
-- it.
-- ============================================================

begin;

set local lock_timeout = '5s';

alter table if exists public.student_membership_discounts
  drop column if exists source;

commit;

select (select count(*)::int
          from information_schema.columns
         where table_schema = 'public'
           and table_name = 'student_membership_discounts'
           and column_name = 'source') as source_left;
-- EXPECT one row: source_left 0.
