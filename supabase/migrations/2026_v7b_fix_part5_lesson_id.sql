-- ============================================================
-- v7b: Fix l042 (Part 5 — VSL Ad) whop_lesson_id
--
-- The DB row had a placeholder value `lesn_ABCxyz` instead of the
-- real Whop lesson ID. Restore the original from the v4 seed so
-- watch sync can match it.
-- ============================================================

update lessons
set whop_lesson_id = 'lesn_3qOYK6JVED9N8QkJZ8o3Hb'
where id = 'l042';

-- Sanity check — surface any other lessons whose whop_lesson_id looks
-- like a placeholder (lesn_ABC..., lesn_xxx..., or anything containing
-- repeated letter patterns we'd never see in a real Whop ID).
-- Run this manually to verify nothing else needs cleanup:
--
--   select id, title, whop_lesson_id from lessons
--   where whop_lesson_id ilike 'lesn_abc%'
--      or whop_lesson_id ilike 'lesn_xxx%'
--      or whop_lesson_id ilike 'lesn_test%'
--      or whop_lesson_id ilike 'lesn_placeholder%';
