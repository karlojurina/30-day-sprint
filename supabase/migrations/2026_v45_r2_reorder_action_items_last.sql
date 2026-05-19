-- ============================================================
-- v45: Reorder R2 so the VSL + High-Production block (l021-l024,
-- which contains the two R2 action items) sits AFTER the
-- Video Hooks → Retention → Asset / Music → Tech Stack / AI →
-- Editing-Breakdowns-Intro block (l025-l032).
--
-- Karlo wants students to watch through the editing/craft theory
-- BEFORE shipping the VSL and high-production ads, instead of the
-- other way around. The two action items (l022, l024) end up at
-- the tail of the main R2 flow, just before the deep editing
-- breakdowns (l033, l035-l042).
--
-- Lessons are sorted by (day asc, sort_order asc). We compact the
-- relevant slice into day 8 with a clean 1..12 sort_order so the
-- new order is unambiguous and easy to read on the map and side
-- panel. R2 lessons past l032 (l033, l035-l042) keep their
-- existing day/sort_order — they're optional editing breakdowns
-- and stay where they were.
--
-- Final R2 order after this migration:
--    1. l025  Video Hooks
--    2. l026  Mr. Beast Retention Techniques
--    3. l027  Asset Management
--    4. l028  Music & SFX
--    5. l029  My Tech Stack For Editing Video Ads
--    6. l030  AI Content Upscaling
--    7. l031  AI Voiceovers
--    8. l032  Editing Breakdowns — Intro
--    9. l021  VSLs
--   10. l022  Action Item: VSL Ad         ★ action item
--   11. l023  High-Production Ads
--   12. l024  Action Item: High-Production Ad   ★ action item
--   ...      l033, l035-l042 (deep editing breakdowns, unchanged)
--
-- Idempotent.
-- ============================================================

update lessons set day = 8, sort_order =  1 where id = 'l025';
update lessons set day = 8, sort_order =  2 where id = 'l026';
update lessons set day = 8, sort_order =  3 where id = 'l027';
update lessons set day = 8, sort_order =  4 where id = 'l028';
update lessons set day = 8, sort_order =  5 where id = 'l029';
update lessons set day = 8, sort_order =  6 where id = 'l030';
update lessons set day = 8, sort_order =  7 where id = 'l031';
update lessons set day = 8, sort_order =  8 where id = 'l032';
update lessons set day = 8, sort_order =  9 where id = 'l021';
update lessons set day = 8, sort_order = 10 where id = 'l022';
update lessons set day = 8, sort_order = 11 where id = 'l023';
update lessons set day = 8, sort_order = 12 where id = 'l024';

-- Sanity check (commented):
-- select id, title, day, sort_order from lessons
--   where region_id = 'r2' and id in
--     ('l021','l022','l023','l024','l025','l026','l027','l028',
--      'l029','l030','l031','l032')
--   order by day, sort_order;
-- -- expect 12 rows in the order: l025, l026, l027, l028, l029, l030,
-- -- l031, l032, l021, l022, l023, l024.
