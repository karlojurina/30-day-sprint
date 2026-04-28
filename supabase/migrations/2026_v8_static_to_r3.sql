-- ============================================================
-- v8: Move static ad + engage-feedback from R2 → R3
--
-- Per user 2026-04-28: the discount gate is the TRANSITION moment
-- after "Video Editing Breakdown: Part 5 — VSL Ad" (l042), and the
-- static ad belongs to R3, not R2.
--
-- Changes:
-- 1. Move l045 (Engage With #ad-review Feedback) → R3, day 15, sort 1
-- 2. Move l046 (Ship Your Static Ad) → R3, day 15, sort 2
--    (l046 keeps is_gate=true so the LessonSheet "Claim discount" CTA
--     still fires when the student opens it; discount eligibility is
--     R1+R2 complete which is achieved before reaching l046 in R3)
-- 3. Adjust region day ranges: R2 ends at 14, R3 starts at 15
-- ============================================================

update lessons set region_id = 'r3', day = 15, sort_order = 1 where id = 'l045';
update lessons set region_id = 'r3', day = 15, sort_order = 2 where id = 'l046';

update regions set day_end   = 14 where id = 'r2';
update regions set day_start = 15 where id = 'r3';

-- Verification:
--   select region_id, count(*) from lessons group by region_id order by 1;
--   -- Expect r1=20, r2=20, r3=12, r4=7
--   select id, region_id, day, sort_order from lessons
--   where id in ('l042','l045','l046','l047');
--   -- l042: r2/14   l045: r3/15/1   l046: r3/15/2   l047: r3/16/1
