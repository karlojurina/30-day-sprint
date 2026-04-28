-- ============================================================
-- v7: Rebalance R1 day 7 + clarify Part 5 (VSL Ad) title
--
-- 1. Move l018 (Action Item: Organic Ads) from day 6 → day 7 so the
--    R1 distribution becomes 3-3-3-3-3-2-3 instead of 3-3-3-3-3-3-2.
--    This pairs the organic ad submission with the UGC submission on
--    day 7, which reads better narratively.
--
-- 2. Rename l042 from "Video Editing Breakdown: Part 5" to
--    "Video Editing Breakdown: Part 5 — VSL Ad" so it's clear which
--    ad type the breakdown covers.
-- ============================================================

-- 1. Day shift for l018
update lessons set day = 7, sort_order = 1 where id = 'l018';

-- Adjust day-7 sort orders so l018 comes before l019/l020
update lessons set sort_order = 2 where id = 'l019';
update lessons set sort_order = 3 where id = 'l020';

-- Adjust remaining day-6 sort orders (only l016, l017 left there)
update lessons set sort_order = 1 where id = 'l016';
update lessons set sort_order = 2 where id = 'l017';

-- 2. Rename Part 5
update lessons
set title = 'Video Editing Breakdown: Part 5 — VSL Ad'
where id = 'l042';

-- ============================================================
-- Verification:
--   select id, day, sort_order, title from lessons
--   where region_id = 'r1' order by day, sort_order;
--   -- Day 6 should have 2 lessons (l016, l017)
--   -- Day 7 should have 3 lessons (l018, l019, l020)
--
--   select id, title from lessons where id = 'l042';
--   -- Should be "Video Editing Breakdown: Part 5 — VSL Ad"
-- ============================================================
