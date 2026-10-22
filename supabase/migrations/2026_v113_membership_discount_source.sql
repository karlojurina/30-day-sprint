-- ============================================================
-- v113: student_membership_discounts.source and source_checked_at, THE
-- RULE STAMP (T-122, the coupon check answers every student; branch
-- night/admin3, 2026-10-21; the stamp since T-122's fifth fix round,
-- 2026-10-22, before this file was pasted anywhere).
--
-- THE PROBLEM
--   The coupon check (src/lib/membership-discount.ts) answered only from the
--   Whop membership on file. The first live dry run of its cron (production,
--   2026-10-21, read only) could not read 46 of 290 students: 22 hold a
--   payment's id where the membership's belongs, and 24 memberships came
--   back with no plan or no renewal price. The check now judges every
--   student by the owner's rule: a code on any course membership found
--   through the student's Whop user or on any course payment, a discount a
--   payment shows, then the price of their first real payment. When Whop
--   gives no answer, the request routes and the approve route fall back to
--   the stored row, and a stored "no coupon" may answer only when this rule
--   wrote it: the rule production's cron runs now wrote "no coupon" for
--   students who came in on a code, and so did the builds of T-122's
--   earlier rounds.
--
-- WHAT THIS FILE DOES, in one transaction
--   1. Adds `source` to student_membership_discounts: the rule's version and
--      the step that answered, 'r5-membership' (the membership on file),
--      'r5-user' (a course membership found through the student's Whop
--      user) or 'r5-payment' (a course payment). Empty on the rows written
--      before, and on a "no coupon" the check judged without the user's
--      list of memberships (it can miss a code on a second, canceled or
--      expired membership), which the fallback never answers with.
--   2. Adds `source_checked_at`: the checked_at of the write that set
--      `source`. A build from before T-122 writes neither column, so its
--      write over a row keeps the stamp with a new checked_at, and the
--      check then sees the two differ and does not answer with that row.
--   3. Holds `source` to those three words or empty. The builds of T-122's
--      earlier rounds wrote 'membership', 'user' or 'payment': the check
--      refuses those, so their writes fail (they log the failure and keep
--      their own live answer) and they can store no "no coupon" at all.
--      Should a database hold any such word already (a dev database that had
--      an earlier copy of this file), it is emptied first, so the check can
--      be added; on production the column is new and nothing is emptied.
--   4. Shows what it made.
--
-- WHAT CHANGES FOR ANYONE
--   Nothing anyone sees. The cron and the discount routes fill the columns
--   from their next write. Until this file is pasted they write each row
--   without them (they notice the missing column and write again), so the
--   app works with or without v113; without it no stored "no coupon"
--   answers when Whop gives none, so those students read "We couldn't check
--   your membership just now" and the normal Approve is refused until Whop
--   answers.
--
-- PASTE IT AFTER the build of T-122's fifth fix round is deployed (CONTEXT.md,
-- the coupon check's "Before /ship"), then run the cron in write mode until
-- `left` is 0, before anyone approves.
--
-- WHEN THE TABLE IS BUSY
--   It waits 5 seconds at most for any lock. A stop on "canceling statement
--   due to lock timeout" (SQLSTATE 55P03) changed nothing. Paste it again in
--   a minute.
--
-- NEEDS v111 (the table). Without it the first statement stops the file
-- (relation does not exist, 42P01) and nothing is changed.
--
-- UNDO: supabase/undo/2026_v113_undo.sql drops both columns.
--
-- Re-runnable: a second run finds the columns and the check as they are and
-- changes nothing.
-- ============================================================

begin;

set local lock_timeout = '5s';

alter table public.student_membership_discounts
  add column if not exists source text;

alter table public.student_membership_discounts
  add column if not exists source_checked_at timestamptz;

alter table public.student_membership_discounts
  drop constraint if exists student_membership_discounts_source_check;

-- An earlier round's word is no stamp of this rule: emptied, with its time, before the check goes on.
update public.student_membership_discounts
   set source = null,
       source_checked_at = null
 where source is not null
   and source not in ('r5-membership', 'r5-user', 'r5-payment');

alter table public.student_membership_discounts
  add constraint student_membership_discounts_source_check
  check (source is null or source in ('r5-membership', 'r5-user', 'r5-payment'));

comment on column public.student_membership_discounts.source is
  'T-122 (v113): the rule''s version and the step that answered. r5-membership = the Whop membership on file; r5-user = a course membership found through the student''s Whop user; r5-payment = a course payment (a code on it, a discount it shows, or the price of the first real one). Empty on rows written before v113, and on a no coupon judged without the user''s list of memberships, which the stored fallback never answers with. A stored no coupon answers for a Whop that gives none only when this column carries the current version and source_checked_at is checked_at.';

comment on column public.student_membership_discounts.source_checked_at is
  'T-122 (v113): the checked_at of the write that set source. A build that writes no source and writes over the row changes checked_at alone, so the two differ and the row is no answer for the stored fallback.';

commit;

select (select data_type
          from information_schema.columns
         where table_schema = 'public'
           and table_name = 'student_membership_discounts'
           and column_name = 'source') as source_type,
       (select data_type
          from information_schema.columns
         where table_schema = 'public'
           and table_name = 'student_membership_discounts'
           and column_name = 'source_checked_at') as source_checked_at_type,
       (select count(*)::int
          from pg_constraint
         where conrelid = 'public.student_membership_discounts'::regclass
           and conname = 'student_membership_discounts_source_check') as source_checks,
       (select count(*)::int from public.student_membership_discounts) as rows_now,
       (select count(*)::int from public.student_membership_discounts where source is null) as rows_without_source;
-- EXPECT one row: source_type text, source_checked_at_type timestamp with
-- time zone, source_checks 1, and on the first run rows_without_source
-- equal to rows_now (every row was written before v113).
