-- ============================================================
-- v18: Fix R3 Whop lesson ID mappings after the v17 rename + make
--      "Action Item: Static Ads" a compound (2-part) action.
--
-- Problem: v17 renamed R3 lesson slots but kept the existing
--          whop_lesson_id values, which point at the OLD strategy
--          lesson videos that Whop has since replaced under the
--          same lesn IDs. l045 + l046 were action items in v4 so
--          they had NULL whop_lesson_id — after v17 they became
--          watch lessons but their links are still null, hence
--          Whop's "content will be added soon" message.
--
-- Karlo's confirmed links:
--   "The Art Of 1 Frame"            → lesn_5R9qygV5GLrWm8SxXsVsMm
--   "Static Ad Safezone Guidelines" → lesn_2XPI7WaFzI6YIrJW8fRXHX
--
-- These IDs are currently on l047 + l048. Move them to l045 + l046
-- and clear the originals (the videos for l047 "My Tech Stack" and
-- l048 "Static Ad Templates" still need Whop IDs — TODO once Karlo
-- pastes those URLs).
--
-- Compound action item — l049 ("Action Item: Static Ads") needs the
-- same 2-part pattern as l018 (Organic Ads), l020 (UGC), l022 (VSL),
-- l024 (High-Prod): watch the briefing video + manually mark "I
-- shipped the ad". requires_action=true + an action_brief makes
-- the LessonSheet render both halves.
-- ============================================================

-- ─── Move Whop IDs from l047/l048 → l045/l046 ───

update lessons set whop_lesson_id = 'lesn_5R9qygV5GLrWm8SxXsVsMm'
  where id = 'l045';

update lessons set whop_lesson_id = 'lesn_2XPI7WaFzI6YIrJW8fRXHX'
  where id = 'l046';

-- Clear the originals so the same Whop lesson doesn't auto-complete
-- two of our lessons at once via watch-sync.
update lessons set whop_lesson_id = null where id = 'l047';
update lessons set whop_lesson_id = null where id = 'l048';

-- ─── l049 compound action item ───

update lessons set
  requires_action = true,
  action_brief = 'Make + ship a static ad based on the briefing video. Submit to #ad-review on Discord. The team manually reviews each submission before approving the 30% discount, so make it count.'
where id = 'l049';

-- ─── Verification ───
-- select id, title, type, requires_action, is_gate, whop_lesson_id
-- from lessons where region_id = 'r3'
-- order by day, sort_order;
--
-- Expect:
--   l045 watch, has whop link lesn_5R9qygV5G…
--   l046 watch, has whop link lesn_2XPI7Wa…
--   l047 watch, whop_lesson_id NULL (needs new ID from Karlo)
--   l048 watch, whop_lesson_id NULL (needs new ID from Karlo)
--   l049 action, requires_action=true, is_gate=true, action_brief set
--   l050-l056 unchanged
