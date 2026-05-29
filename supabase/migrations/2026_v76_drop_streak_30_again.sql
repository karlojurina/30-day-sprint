-- v76 — Re-drop `streak_30` achievement.
--
-- v56 (2026-05-23) already dropped this from the catalog, but the
-- delete was a hard `delete from achievements where id = 'streak_30'`
-- and Karlo's production DB still shows "🔥 Full Sprint - Reach a
-- 30-day streak." as of 2026-05-30. Either v56 wasn't run on prod
-- or the row was reinserted by re-running the v53 catalog seed.
--
-- This migration is intentionally a no-op if the row is already
-- gone, so safe to re-run. The CASCADE FK on student_achievements
-- (from v53) cleans up any existing unlock rows automatically.
--
-- Idempotent.

delete from achievements where id = 'streak_30';

-- Verification (run after):
--   select id, name from achievements where id = 'streak_30';  -- 0 rows
