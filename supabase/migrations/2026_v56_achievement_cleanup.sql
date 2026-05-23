-- ============================================================
-- v56: Achievement catalog cleanup (2026-05-23).
--
-- Two changes:
--
-- 1. Drop `streak_30` from the catalog. Karlo's call - it
--    overlapped with `unbroken` (the legendary 30-day-from-Day-1
--    streak) and added a "rare" tier achievement that wasn't
--    differentiated enough. The unbroken legendary stays.
--
-- 2. Shorten every description to one tight sentence. Karlo
--    wants tile copy to be glanceable: name + minimum text.
--    Examples he sent:
--      "Get approved for Bounty Access. The Playbook unlocks
--       for you." -> "Get approved for Bounties."
--      "Finish Region 4 before Day 21." -> "Finish Region 4
--       in 21 days."
--
-- Idempotent.
-- ============================================================

-- 1. Drop streak_30 ------------------------------------------------------
-- ON DELETE CASCADE on student_achievements (from v53) cleans up any
-- existing unlock rows for that achievement automatically.
delete from achievements where id = 'streak_30';

-- 2. Tighten descriptions ------------------------------------------------
-- Each line below is the new description for that achievement. The
-- names + icons + rarity + sort_order stay the same.
update achievements set description = 'Watch your first lesson.'
  where id = 'first_lesson';

update achievements set description = 'Ship your first action item.'
  where id = 'first_action_shipped';

update achievements set description = 'Reach a 7-day streak.'
  where id = 'streak_7';

update achievements set description = 'Finish Region 1.'
  where id = 'r1_clear';

update achievements set description = 'Finish Region 2.'
  where id = 'r2_clear';

update achievements set description = 'Earn the 30% off month two.'
  where id = 'discount_earned';

update achievements set description = 'Reach a 14-day streak.'
  where id = 'streak_14';

update achievements set description = 'Finish Region 3.'
  where id = 'r3_clear';

update achievements set description = 'Finish Region 4.'
  where id = 'r4_clear';

update achievements set description = 'Get approved for Bounties.'
  where id = 'bounty_access_claimed';

update achievements set description = 'Complete 3 lessons in a day.'
  where id = 'triple_play';

update achievements set description = 'Clear a region in a day.'
  where id = 'region_sweep';

update achievements set description = 'Finish Region 4 in 21 days.'
  where id = 'early_finisher';

update achievements set description = 'Finish Region 4 in 14 days.'
  where id = 'speedrun';

update achievements set description = 'Hit a 30-day streak from Day 1.'
  where id = 'unbroken';

update achievements set description = 'Finish with zero skipped lessons.'
  where id = 'perfect_run';
