-- ============================================================
-- v69: Set regions.quiz_format for R2, R3, R4.
--
-- Brief v2 ships 3 new content drops + 2 new format components:
--   r2 -> stack_builder (18 cards)
--   r3 -> stack_builder (18 cards, same component, different content)
--   r4 -> vault_tumblers (15 cards, fixed 1->15 order, 5 dials)
--
-- v54 already added the quiz_format column and set r1 = swipe_cards.
-- This migration just populates the other 3 rows so the Onward gate
-- routing fires the correct format component for each region.
--
-- Idempotent.
-- ============================================================

update regions set quiz_format = 'stack_builder'  where id = 'r2' and quiz_format is null;
update regions set quiz_format = 'stack_builder'  where id = 'r3' and quiz_format is null;
update regions set quiz_format = 'vault_tumblers' where id = 'r4' and quiz_format is null;

-- Sanity check (commented):
-- select id, name, quiz_format from regions order by order_num;
-- -- expect: r1 swipe_cards, r2 stack_builder, r3 stack_builder, r4 vault_tumblers
