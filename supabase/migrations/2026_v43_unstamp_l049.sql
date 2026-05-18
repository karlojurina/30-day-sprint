-- ============================================================
-- v43: Remove discount association from l049 (Action Item: Static Ads).
--
-- l049 used to carry is_gate = true because the discount-claim
-- moment was historically wired to that lesson. With v2 the actual
-- discount widget lives on the secondary end-marker at the end of
-- R2, not on the l049 lesson itself. The orphan is_gate flag was
-- still causing:
--   - the "DISCOUNT" pill in the RegionSidePanel lesson list
--   - the big "DISCOUNT APPROVED" / "DISCOUNT PENDING" panel
--     inside the l049 lesson sheet
--   - the discount-gate visual in MapCanvas (legacy renderer)
--
-- Setting is_gate = false drops all three. The discount widget on
-- R2 stays exactly as it is (it's gated by region, not by this
-- column).
--
-- Also asserts whop_lesson_id (the briefing video) is the right
-- one. Should already be lesn_36aPWrKA4T2Brrv0Ugs0lE from v20/v24,
-- but rewriting here so the migration is the source of truth.
-- Drops the "this is the moment the 30% discount unlocks" line
-- from description for the same reason.
--
-- Idempotent.
-- ============================================================

update lessons
set
  is_gate = false,
  description = 'Ship a static ad. Submit to #ad-review.',
  whop_lesson_id = 'lesn_36aPWrKA4T2Brrv0Ugs0lE'
where id = 'l049';

-- Sanity check (commented):
-- select id, is_gate, whop_lesson_id, description from lessons where id = 'l049';
-- -- expect: is_gate = false, whop_lesson_id = 'lesn_36aPWrKA4T2Brrv0Ugs0lE'.
