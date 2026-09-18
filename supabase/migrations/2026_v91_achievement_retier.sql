-- v91 — Re-tier the achievement board against what students actually hold.
--
-- The tiers were set at v53 by guesswork, before any data existed. Measured
-- 2026-09-18, after v90 fixed the denominator and the backfill paid off the
-- 634 badges the evaluation leak had swallowed:
--
--   Triple Threat  was RARE   and held by 91.6% of students
--   Region Sweep   was RARE   and held by 82.7%
--   Foundation Set was COMMON and held by 20.5%
--   Habit Builder  was COMMON and held by 13.1%
--
-- "Rare" meaning "nearly everyone has it" drains the word of meaning, and
-- the two genuinely selective commons were doing the opposite.
--
-- New tiers, from the live unlock rate (holders / 738 app users who joined
-- since launch), at a clean 4/4/4/4:
--
--   COMMON     First Steps 98.1 · Triple Threat 91.6 · Region Sweep 82.7
--              · Took the Shot 24.7
--   UNCOMMON   Through the Gate 21.7 · Foundation Set 20.5
--              · Summit Reached 14.0 · Habit Builder 13.1
--   RARE       Past the Halfway 11.1 · Almost There 6.9
--              · Discount Earned 5.7 · Two Weeks Strong 3.9
--   LEGENDARY  Perfectionist 4.2 · Ahead of Schedule 4.2
--              · Speedrunner 1.6 · Unbroken 0.0
--
-- ONE DELIBERATE DEPARTURE FROM THE DATA. Two Weeks Strong (3.9%) is rarer
-- than Perfectionist and Ahead of Schedule (both 4.2%) yet sits one tier
-- below them. Legendary should mean HARDEST, not rarest, and those two
-- diverge here: almost nobody sustains a 14-day streak, but sustaining one
-- is not harder than finishing the entire sprint. Keeping it data-pure would
-- also break the theme — all four legendaries are now "finish" achievements:
-- finish perfectly, finish early, finish very early, finish without breaking.
-- Streaks cap at Rare by design.
--
-- sort_order is renumbered too, not cosmetically: the modal fetches the
-- catalog with .order("sort_order") and then groups by rarity
-- (AchievementsButton.tsx:62-65), so leaving v53's numbering would scatter
-- each tier's contents in an order that no longer means anything. Now 1..16
-- by descending unlock rate, so every tier reads most-common-first.
--
-- Also here: First Steps said "Watch your first lesson" while the rule counts
-- a lesson as done if it was watched OR SKIPPED — so skipping one earned a
-- badge for watching. Same class as the two descriptions v90 corrected.
--
-- No rule logic changes. No student gains or loses a badge. This migration
-- only relabels what students already hold.
--
-- Idempotent: plain updates keyed by id.

update achievements set rarity = 'common',    sort_order =  1 where id = 'first_lesson';
update achievements set rarity = 'common',    sort_order =  2 where id = 'triple_play';
update achievements set rarity = 'common',    sort_order =  3 where id = 'region_sweep';
update achievements set rarity = 'common',    sort_order =  4 where id = 'first_action_shipped';

update achievements set rarity = 'uncommon',  sort_order =  5 where id = 'bounty_access_claimed';
update achievements set rarity = 'uncommon',  sort_order =  6 where id = 'r1_clear';
update achievements set rarity = 'uncommon',  sort_order =  7 where id = 'r4_clear';
update achievements set rarity = 'uncommon',  sort_order =  8 where id = 'streak_7';

update achievements set rarity = 'rare',      sort_order =  9 where id = 'r2_clear';
update achievements set rarity = 'rare',      sort_order = 10 where id = 'r3_clear';
update achievements set rarity = 'rare',      sort_order = 11 where id = 'discount_earned';
update achievements set rarity = 'rare',      sort_order = 12 where id = 'streak_14';

update achievements set rarity = 'legendary', sort_order = 13 where id = 'perfect_run';
update achievements set rarity = 'legendary', sort_order = 14 where id = 'early_finisher';
update achievements set rarity = 'legendary', sort_order = 15 where id = 'speedrun';
update achievements set rarity = 'legendary', sort_order = 16 where id = 'unbroken';

-- "Watch" was never what the rule checked.
update achievements
   set description = 'Complete your first lesson.'
 where id = 'first_lesson';

-- Verification: expect 4 rows, each with count 4, and 16 distinct sort_orders.
-- select rarity, count(*) from achievements group by rarity;
-- select count(distinct sort_order), count(*) from achievements;
