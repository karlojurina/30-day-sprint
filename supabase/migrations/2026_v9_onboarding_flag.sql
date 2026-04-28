-- ============================================================
-- v9: Onboarding completion flag
--
-- Tracks whether a student has gone through the first-time onboarding
-- flow. Null = never seen → modal fires on next dashboard visit.
-- Timestamp = completed (or skipped) → modal stays dismissed.
-- ============================================================

alter table students
  add column if not exists onboarding_completed_at timestamptz;
