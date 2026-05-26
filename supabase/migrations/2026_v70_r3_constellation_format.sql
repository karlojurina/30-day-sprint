-- ============================================================
-- v70: R3 quiz format swap - stack_builder -> constellation.
--
-- Karlo's feedback on v69: "we're not going to have regions 2
-- and 3 with the same style and the same format." Brief v2
-- specified R3 reusing R2's Stack Builder because the original
-- Tier Ranking format got killed, but Karlo wants R3 to have
-- its own visual identity.
--
-- New format: constellation. 18 stars arranged in a climbing
-- arc (low-left to high-right). Each correct answer ignites the
-- next star in sequence + draws a connecting line from the
-- previously-lit star. Wrong answers leave gaps in the chain -
-- the final constellation shape tells the score visually.
--
-- Mechanics identical to other formats: v65 drain-through,
-- 50% pass, same SwipeCardQuestion schema. Only the visual
-- wrapper differs.
--
-- Idempotent. Re-runnable safely.
-- ============================================================

update regions
set quiz_format = 'constellation'
where id = 'r3';

-- Sanity check (commented):
-- select id, name, quiz_format from regions order by order_num;
-- -- expect: r1 swipe_cards, r2 stack_builder, r3 constellation,
-- --         r4 vault_tumblers
