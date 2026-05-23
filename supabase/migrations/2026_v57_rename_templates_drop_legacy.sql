-- ============================================================
-- v57: Rename templates to descriptive scenario_ids + drop the
-- 18 legacy W-series rows that v52 marked inactive.
--
-- Naming convention: {situation}.{sub}.{day}
--   situation  = welcome | stalled | nolessons | noship | pace | month2
--   sub        = (cohort or region, where applicable)
--   day        = day{N} or `entry` for one-shot events
--
-- Example: stalled.discord.day10 = "student stalled (paid but no
-- dashboard login), Discord channel, fires day 10."
--
-- This migration:
--   1. Widens `scenario_id` from varchar(16) to varchar(48) on
--      both `templates` and `tasks`. The old 16-char cap was
--      tight enough for D1/NA-A.1 but blows up on the new
--      descriptive slugs (stalled.discord.day10 = 21 chars).
--   2. Deletes the 18 inactive legacy rows (W1.1, W1.2, W1.3,
--      W2.*, W3.*, W4.*, X.1). tasks.template_id is ON DELETE
--      SET NULL (per v27), so any historical task rows
--      referencing these get their template_id nulled - no FK
--      errors, no data loss.
--   3. Renames the 18 active rows to the new convention + cleans
--      up their titles.
--
-- After this migration the templates table is exactly 18 rows
-- matching brief v3 1:1.
--
-- Idempotent on re-run via guard checks (where new id exists).
-- ============================================================

-- 0. Widen scenario_id ------------------------------------------------
-- ALTER COLUMN TYPE to varchar(48) is no-op when the column is
-- already at that size, so safe to re-run.
alter table templates alter column scenario_id type varchar(48);
alter table tasks     alter column scenario_id type varchar(48);

-- 1. Drop the legacy inactive rows --------------------------------------
delete from templates
where scenario_id in (
  'W1.1','W1.2','W1.3','W1.4',
  'W2.1','W2.2','W2.3','W2.4','W2.5','W2.6','W2.7',
  'W3.1','W3.2','W3.3',
  'W4.1','W4.2','W4.3','W4.4',
  'X.1'
);

-- 2. Rename the 18 active rows ------------------------------------------
-- Use individual updates rather than a temp table so the renames are
-- explicit and grep-able. Each update is no-op if the new id already
-- exists (idempotent re-run safety via NOT EXISTS guard).

update templates
set scenario_id = 'welcome.day1', title = 'Welcome (Day 1)', updated_at = now()
where scenario_id = 'D1'
  and not exists (select 1 from templates t where t.scenario_id = 'welcome.day1');

update templates
set scenario_id = 'stalled.discord.day3', title = 'Stalled student (Discord) - Day 3', updated_at = now()
where scenario_id = 'NA-A.1'
  and not exists (select 1 from templates t where t.scenario_id = 'stalled.discord.day3');

update templates
set scenario_id = 'stalled.discord.day5', title = 'Stalled student (Discord) - Day 5', updated_at = now()
where scenario_id = 'NA-A.2'
  and not exists (select 1 from templates t where t.scenario_id = 'stalled.discord.day5');

update templates
set scenario_id = 'stalled.discord.day7', title = 'Stalled student (Discord) - Day 7', updated_at = now()
where scenario_id = 'NA-A.3'
  and not exists (select 1 from templates t where t.scenario_id = 'stalled.discord.day7');

update templates
set scenario_id = 'stalled.discord.day10', title = 'Stalled student (Discord) - Day 10 final', updated_at = now()
where scenario_id = 'NA-A.4'
  and not exists (select 1 from templates t where t.scenario_id = 'stalled.discord.day10');

update templates
set scenario_id = 'stalled.whop.day3', title = 'Stalled student (Whop, no Discord) - Day 3', updated_at = now()
where scenario_id = 'NA-B.1'
  and not exists (select 1 from templates t where t.scenario_id = 'stalled.whop.day3');

update templates
set scenario_id = 'stalled.whop.day5', title = 'Stalled student (Whop, no Discord) - Day 5', updated_at = now()
where scenario_id = 'NA-B.2'
  and not exists (select 1 from templates t where t.scenario_id = 'stalled.whop.day5');

update templates
set scenario_id = 'stalled.whop.day7', title = 'Stalled student (Whop, no Discord) - Day 7', updated_at = now()
where scenario_id = 'NA-B.3'
  and not exists (select 1 from templates t where t.scenario_id = 'stalled.whop.day7');

update templates
set scenario_id = 'stalled.whop.day10', title = 'Stalled student (Whop, no Discord) - Day 10 final', updated_at = now()
where scenario_id = 'NA-B.4'
  and not exists (select 1 from templates t where t.scenario_id = 'stalled.whop.day10');

update templates
set scenario_id = 'nolessons.day3', title = 'Activated, no lessons watched - Day 3', updated_at = now()
where scenario_id = 'ZL.1'
  and not exists (select 1 from templates t where t.scenario_id = 'nolessons.day3');

update templates
set scenario_id = 'nolessons.day7', title = 'Activated, no lessons watched - Day 7', updated_at = now()
where scenario_id = 'ZL.2'
  and not exists (select 1 from templates t where t.scenario_id = 'nolessons.day7');

update templates
set scenario_id = 'nolessons.day14', title = 'Activated, no lessons watched - Day 14', updated_at = now()
where scenario_id = 'ZL.3'
  and not exists (select 1 from templates t where t.scenario_id = 'nolessons.day14');

update templates
set scenario_id = 'noship.r1.day7', title = 'R1 actions not shipped - Day 7 (Golf voice)', updated_at = now()
where scenario_id = 'WNS.1'
  and not exists (select 1 from templates t where t.scenario_id = 'noship.r1.day7');

update templates
set scenario_id = 'noship.r2.day14', title = 'R2 actions not shipped - Day 14', updated_at = now()
where scenario_id = 'WNS.2'
  and not exists (select 1 from templates t where t.scenario_id = 'noship.r2.day14');

update templates
set scenario_id = 'pace.day7', title = 'Behind on pace - Day 7', updated_at = now()
where scenario_id = 'B.1'
  and not exists (select 1 from templates t where t.scenario_id = 'pace.day7');

update templates
set scenario_id = 'pace.day14', title = 'Behind on pace - Day 14 (discount slipped)', updated_at = now()
where scenario_id = 'B.2'
  and not exists (select 1 from templates t where t.scenario_id = 'pace.day14');

update templates
set scenario_id = 'pace.day21', title = 'Behind on pace - Day 21 (last push)', updated_at = now()
where scenario_id = 'B.3'
  and not exists (select 1 from templates t where t.scenario_id = 'pace.day21');

update templates
set scenario_id = 'month2.entry', title = 'Month 2 entry (Spencer math + Playbook)', updated_at = now()
where scenario_id = 'M2.1'
  and not exists (select 1 from templates t where t.scenario_id = 'month2.entry');
