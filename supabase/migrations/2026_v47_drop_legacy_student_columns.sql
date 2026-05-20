-- ============================================================
-- v47: Drop the legacy state columns from students that were
-- split into sibling tables by v46.
--
-- Run this AFTER v46 has been applied AND after the v46/v47 code
-- ship is deployed. If you run this before the code updates,
-- the running app will throw "column does not exist" errors on
-- routes that still read these columns.
--
-- Columns dropped (now living in sibling tables):
--   → student_streaks      : current_streak, longest_streak, last_streak_date
--   → student_milestones   : onboarding_completed_at, first_sprint_login_at,
--                            bounty_access_claimed_at, sprint_completed_at,
--                            first_client_landed_at, playbook_welcome_seen_at
--   → student_whop_sync    : whop_access_token, whop_refresh_token,
--                            last_watch_sync_at, whop_last_sync_error,
--                            whop_last_sync_error_at, whop_last_sync_unmatched,
--                            whop_last_sync_fetched_count,
--                            whop_last_sync_matched_count
--   → student_celebrations : last_streak_milestone_shown,
--                            month_review_seen_at, celebrated_region_ids
--   → student_dm_log       : day28_dm_sent_at
--
-- Kept on students (identity / admin-flag / true single-row fields):
--   id, supabase_user_id, whop_user_id, whop_membership_id,
--   email, name, discord_username, discord_user_id, avatar_url,
--   membership_status, joined_at, last_active_at, current_title,
--   ad_submissions_verified, ad_submissions_verified_at,
--   ad_submissions_verified_by, csm_exempt, created_at, updated_at.
--
-- Idempotent (each DROP uses IF EXISTS).
-- ============================================================

-- student_streaks
alter table students drop column if exists current_streak;
alter table students drop column if exists longest_streak;
alter table students drop column if exists last_streak_date;

-- student_milestones
alter table students drop column if exists onboarding_completed_at;
alter table students drop column if exists first_sprint_login_at;
alter table students drop column if exists bounty_access_claimed_at;
alter table students drop column if exists sprint_completed_at;
alter table students drop column if exists first_client_landed_at;
alter table students drop column if exists playbook_welcome_seen_at;

-- student_whop_sync
alter table students drop column if exists whop_access_token;
alter table students drop column if exists whop_refresh_token;
alter table students drop column if exists last_watch_sync_at;
alter table students drop column if exists whop_last_sync_error;
alter table students drop column if exists whop_last_sync_error_at;
alter table students drop column if exists whop_last_sync_unmatched;
alter table students drop column if exists whop_last_sync_fetched_count;
alter table students drop column if exists whop_last_sync_matched_count;

-- student_celebrations
alter table students drop column if exists last_streak_milestone_shown;
alter table students drop column if exists month_review_seen_at;
alter table students drop column if exists celebrated_region_ids;

-- student_dm_log
alter table students drop column if exists day28_dm_sent_at;

-- Drop indexes that targeted dropped columns (Postgres drops them
-- automatically when their column goes, but make this explicit for
-- the reader).
-- (No standalone indexes to drop — none were created on the moved cols.)

-- Sanity check (commented):
-- \d students
-- -- expect: identity + admin-flag columns only.
