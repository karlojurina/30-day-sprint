-- ============================================================
-- V5: Whop sync diagnostic column
-- Stores the list of Whop lesson IDs fetched during the last sync
-- that did NOT match any lesson in our lessons table — so Karlo can
-- see which Whop lessons still need a mapping and run a simple
-- UPDATE to fix them.
-- ============================================================

alter table students
  add column if not exists whop_last_sync_unmatched jsonb;

alter table students
  add column if not exists whop_last_sync_fetched_count int;

alter table students
  add column if not exists whop_last_sync_matched_count int;
