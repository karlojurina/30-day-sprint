-- ============================================================
-- Phase B: Seed 7 checkpoints and map the existing 23 tasks
-- Run AFTER 2026_checkpoints.sql
-- ============================================================

-- 1. Insert the 7 checkpoints
insert into checkpoints (id, sort_order, title, subtitle, theme_key, is_discount_gate) values
  ('onboarding',  1, 'Onboarding',  'Get your bearings.',               'onboarding',  false),
  ('foundations', 2, 'Foundations', 'Learn the fundamentals.',          'foundations', false),
  ('first_ads',   3, 'First Ads',   'Ship two real ads.',               'first_ads',   true),
  ('skill_stack', 4, 'Skill Stack', 'Widen your toolkit.',              'skill_stack', false),
  ('strategy',    5, 'Strategy',    'Think like a creative director.',  'strategy',    false),
  ('job_board',   6, 'Job Board',   'Start applying.',                  'job_board',   false),
  ('ad_bounties', 7, 'Ad Bounties', 'Real briefs. Real spend.',         'ad_bounties', false)
on conflict (id) do nothing;

-- 2. Map the 23 existing tasks to their checkpoints
update tasks set checkpoint_id = 'onboarding'  where id in ('w1_t1','w1_t2','w1_t3');
update tasks set checkpoint_id = 'foundations' where id in ('w1_t4','w1_t5','w1_t6','w2_t1','w2_t2');
update tasks set checkpoint_id = 'first_ads'   where id in ('w1_t7','w1_t8');
update tasks set checkpoint_id = 'skill_stack' where id in ('w2_t3','w2_t4','w2_t5','w3_t1');
update tasks set checkpoint_id = 'strategy'    where id in ('w3_t2','w3_t3');
update tasks set checkpoint_id = 'job_board'   where id in ('w3_t4');
update tasks set checkpoint_id = 'ad_bounties' where id in ('w4_t1','w4_t2','w4_t3','w4_t4','w4_t5','w4_t6');

-- 3. Enforce NOT NULL now that every task has a checkpoint
-- (If this fails, run: select id from tasks where checkpoint_id is null;  to find the gap)
alter table tasks alter column checkpoint_id set not null;

-- Verification queries (run manually after):
--   select count(*) from tasks where checkpoint_id is null;                -- expect 0
--   select checkpoint_id, count(*) from tasks group by checkpoint_id;      -- expect 7 rows summing to 23
--   select count(*) from student_task_completions;                         -- should match pre-migration count
