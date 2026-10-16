-- ============================================================
-- UNDO for v106 (supabase/migrations/2026_v106_one_pending_discount_request.sql)
--
-- NOT A MIGRATION. A file in supabase/undo/ is never run in sequence with
-- supabase/migrations/. This one is run by hand, and only to take v106 back.
--
-- WHAT IT DOES
--   Drops the unique index discount_requests_one_pending_per_student. A
--   student can then have two pending discount requests again (T-057). No
--   row changes.
--
-- WHEN THE TABLE IS BUSY
--   Dropping the index waits for discount_requests, 5 seconds at most. When
--   another session holds it longer, the file stops with "canceling
--   statement due to lock timeout" (SQLSTATE 55P03). Nothing was changed.
--   Paste it again in a minute.
--
-- Safe to run again: a second run finds no index and changes nothing. v106
-- can run again after it.
-- ============================================================

begin;

set local lock_timeout = '5s';

drop index if exists public.discount_requests_one_pending_per_student;

commit;

select to_regclass('public.discount_requests_one_pending_per_student') is null as index_gone;
-- EXPECT one row: index_gone true.
