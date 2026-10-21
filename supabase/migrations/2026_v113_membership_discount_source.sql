-- ============================================================
-- v113: student_membership_discounts.source (T-122, the coupon check
-- answers every student; branch night/admin3, 2026-10-21).
--
-- THE PROBLEM
--   The coupon check (src/lib/membership-discount.ts) answered only from the
--   Whop membership on file. The first live dry run of its cron (production,
--   2026-10-21, read only) could not read 46 of 290 students: 22 hold a
--   payment's id where the membership's belongs, and 24 memberships came
--   back with no plan or no renewal price. The check now finds the
--   membership through the student's Whop user, or judges the student's
--   latest real payment (a total under 97.00 is a discount, the owner's rule
--   of thumb), and the stored row did not say which of those answered.
--
-- WHAT THIS FILE DOES, in one transaction
--   1. Adds `source` to student_membership_discounts, the step that
--      answered: 'membership' (the membership on file, by the rule: a promo
--      code and a renewal_price under the plan's), 'user' (the course
--      membership found through the student's Whop user, by the same rule)
--      or 'payment' (the latest real payment: renewal_price then holds its
--      total and plan_renewal_price the 97.00 it was held against, both empty
--      when there was no real payment). Empty on the rows written before,
--      all of them read from the membership on file.
--   2. A check holds it to those three words, or empty.
--   3. Shows what it made.
--
-- WHAT CHANGES FOR ANYONE
--   Nothing anyone sees. The cron and the discount routes fill the column
--   from their next write. Until this file is pasted they write each row
--   without it (they notice the missing column and write again), so the app
--   works with or without v113; only the record of which step answered is
--   missing.
--
-- WHEN THE TABLE IS BUSY
--   It waits 5 seconds at most for any lock. A stop on "canceling statement
--   due to lock timeout" (SQLSTATE 55P03) changed nothing. Paste it again in
--   a minute.
--
-- NEEDS v111 (the table). Without it the first statement stops the file
-- (relation does not exist, 42P01) and nothing is changed.
--
-- UNDO: supabase/undo/2026_v113_undo.sql drops the column.
--
-- Re-runnable: a second run finds the column and its check as they are and
-- changes nothing.
-- ============================================================

begin;

set local lock_timeout = '5s';

alter table public.student_membership_discounts
  add column if not exists source text;

alter table public.student_membership_discounts
  drop constraint if exists student_membership_discounts_source_check;
alter table public.student_membership_discounts
  add constraint student_membership_discounts_source_check
  check (source is null or source in ('membership', 'user', 'payment'));

comment on column public.student_membership_discounts.source is
  'T-122 (v113): the step that answered. membership = the Whop membership on file, by the rule (a promo code and a renewal_price under the plan''s); user = the course membership found through the student''s Whop user, by the same rule; payment = the latest real payment, a total under 97.00 being a discount (renewal_price holds that total and plan_renewal_price the 97.00, both empty with no real payment). Empty on rows written before v113, all read from the membership on file.';

commit;

select (select data_type
          from information_schema.columns
         where table_schema = 'public'
           and table_name = 'student_membership_discounts'
           and column_name = 'source') as source_type,
       (select count(*)::int
          from pg_constraint
         where conrelid = 'public.student_membership_discounts'::regclass
           and conname = 'student_membership_discounts_source_check') as source_checks,
       (select count(*)::int from public.student_membership_discounts) as rows_now,
       (select count(*)::int from public.student_membership_discounts where source is null) as rows_without_source;
-- EXPECT one row: source_type text, source_checks 1, and on the first run
-- rows_without_source equal to rows_now (every row was written before v113).
