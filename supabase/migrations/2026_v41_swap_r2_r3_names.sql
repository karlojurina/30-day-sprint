-- ============================================================
-- v41: Swap R2 ↔ R3 names.
--
-- Karlo's content-fit call: R2's lesson content is closer to
-- "production" (making ads — VSL, High-prod, editing breakdowns,
-- AI tools) and R3's content is closer to "strategy" (static ads,
-- market awareness, sophistication, creative strategy workflow).
-- The v14 rename had them inverted relative to the content. Fix.
--
-- Only the `name` column flips. Subtitle / tagline / days_label /
-- terrain / lesson assignments stay put — this is purely a label
-- correction.
--
-- Idempotent. Safe to re-run.
-- ============================================================

update regions set name = 'Production' where id = 'r2';
update regions set name = 'Strategy'   where id = 'r3';
