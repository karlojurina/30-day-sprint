-- ============================================================
-- UNDO for v113 (supabase/migrations/2026_v113_membership_discount_source.sql)
--
-- NOT A MIGRATION. A file in supabase/undo/ is never run in sequence with
-- supabase/migrations/. This one is run by hand, and only to take v113 back.
--
-- WHAT IT DOES
--   Drops student_membership_discounts.source and source_checked_at, and
--   with source its check. Every row and every other column stay as they
--   are.
--
-- WHAT CHANGES FOR ANYONE
--   The cron and the discount routes notice the missing columns at their
--   next write and write each row without them, as before v113; the record
--   of which step answered is gone, and with it every stored "no coupon"
--   the fallback could answer with: when Whop gives no answer, a student
--   whose stored row says no coupon reads "We couldn't check your
--   membership just now" and the normal Approve is refused, until Whop
--   answers or v113 is pasted again and the cron has written the rows.
--
-- WHEN THE TABLE IS BUSY
--   It waits 5 seconds at most. A stop on "canceling statement due to lock
--   timeout" (SQLSTATE 55P03) changed nothing. Paste it again in a minute.
--
-- Safe to run again: with the columns gone it changes nothing, and with the
-- table gone too (v111's undo) it changes nothing. v113 can run again after
-- it.
-- ============================================================

begin;

set local lock_timeout = '5s';

alter table if exists public.student_membership_discounts
  drop column if exists source;

alter table if exists public.student_membership_discounts
  drop column if exists source_checked_at;

commit;

select (select count(*)::int
          from information_schema.columns
         where table_schema = 'public'
           and table_name = 'student_membership_discounts'
           and column_name in ('source', 'source_checked_at')) as source_left;
-- EXPECT one row: source_left 0.
