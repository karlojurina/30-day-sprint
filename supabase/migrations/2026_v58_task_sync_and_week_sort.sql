-- ============================================================
-- v58: Sync existing task rows to the new template names + re-bucket
-- the `week` column so /admin/templates can sort by day.
--
-- Two changes:
--
-- 1. Sync tasks.scenario_id from the current template name where
--    the task points at a template (via template_id) but its
--    scenario_id field is stale from before v57 renamed things.
--    E.g. an old task with scenario_id='NA-A.3' whose template_id
--    points at the row that's now `stalled.discord.day7` gets
--    updated to match.
--
-- 2. Rewrite templates.week as a zero-padded day prefix (D01, D03,
--    D05, D07, D10, D14, D21, M2) so the admin UI's
--    week-alphabetical sort renders them in actual day order
--    instead of mixed W1/W2/X/D1 jumble.
--
-- Idempotent.
-- ============================================================

-- 1. Sync tasks.scenario_id from current template names -----------------
-- Wherever a task's template_id still points to a real template,
-- copy the template's current scenario_id onto the task. This
-- catches everything pre-v57 (NA-A.x, NA-B.x, ZL.x, WNS.x, B.x,
-- D1, M2.1) and brings them into the new naming convention.
--
-- Tasks whose template_id is NULL (legacy W-series deleted in v57)
-- keep their historical scenario_id - it's the only record of what
-- they were.
-- tasks has no updated_at column (only created_at / completed_at /
-- dismissed_at), so only set scenario_id here.
update tasks t
set scenario_id = tpl.scenario_id
from templates tpl
where t.template_id = tpl.id
  and t.scenario_id is distinct from tpl.scenario_id;

-- 2. Day-sorted week labels --------------------------------------------
-- Pad to 2 digits so D01 / D03 / D05 / D07 / D10 / D14 / D21 sort
-- correctly. M2 sorts last via the M prefix.
update templates set week = 'D01' where scenario_id = 'welcome.day1';

update templates set week = 'D03' where scenario_id in (
  'stalled.discord.day3', 'stalled.whop.day3', 'nolessons.day3'
);

update templates set week = 'D05' where scenario_id in (
  'stalled.discord.day5', 'stalled.whop.day5'
);

update templates set week = 'D07' where scenario_id in (
  'stalled.discord.day7', 'stalled.whop.day7',
  'nolessons.day7', 'noship.r1.day7', 'pace.day7'
);

update templates set week = 'D10' where scenario_id in (
  'stalled.discord.day10', 'stalled.whop.day10'
);

update templates set week = 'D14' where scenario_id in (
  'nolessons.day14', 'noship.r2.day14', 'pace.day14'
);

update templates set week = 'D21' where scenario_id = 'pace.day21';

update templates set week = 'M2'  where scenario_id = 'month2.entry';
