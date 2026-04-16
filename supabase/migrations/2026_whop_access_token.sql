-- ============================================================
-- Phase 1: Store Whop access_token + sync error tracking
-- Enables existing students (who logged in before refresh-token
-- persistence shipped) to still run the manual sync, and surfaces
-- Whop API errors that were previously silently swallowed.
-- ============================================================

alter table students add column if not exists whop_access_token text;
alter table students add column if not exists whop_last_sync_error text;
alter table students add column if not exists whop_last_sync_error_at timestamptz;
