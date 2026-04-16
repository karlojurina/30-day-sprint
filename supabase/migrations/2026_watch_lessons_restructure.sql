-- ============================================================
-- Restructure watch tasks to match Whop course lessons 1:1
-- Run AFTER 2026_checkpoints_seed.sql
--
-- Changes:
--   1. Delete the 7 generic "module" watch tasks (their completions cascade)
--   2. Insert 46 per-lesson watch tasks with whop_lesson_id mapped
--   3. Reassign action tasks: cleaner titles + shorter descriptions
--      (watching is now tracked separately per lesson)
--   4. Move the discount gate from 'first_ads' to 'skill_stack'
-- ============================================================

-- 1. Delete the generic module-level watch tasks
delete from tasks
where id in ('w1_t4','w1_t5','w1_t6','w2_t1','w2_t2','w3_t2','w3_t3');

-- 2. Insert 46 per-lesson watch tasks
insert into tasks
  (id, week, sort_order, title, description, task_type, is_activation_point, activation_point_id, is_discount_required, checkpoint_id, whop_lesson_id)
values
  -- Week 1 → Foundations (22 lessons)
  -- Introduction module (4)
  ('w1_l01', 1,  1, 'My Goal Is To Change Your Life',          null, 'watch', true, 'AP1', true, 'foundations', 'lesn_xhGjKPzSKp9CR'),
  ('w1_l02', 1,  2, 'How You Will Turn Into a Top 5%',          null, 'watch', true, 'AP1', true, 'foundations', 'lesn_WpuJEzhzEIA8j'),
  ('w1_l03', 1,  3, 'Proof This Works & What You Can Expect',   null, 'watch', true, 'AP1', true, 'foundations', 'lesn_f4di74GSrRiI1'),
  ('w1_l04', 1,  4, 'Your First 30 Days Here (The Game Plan)',  null, 'watch', true, 'AP1', true, 'foundations', 'lesn_O4gxxr5BN3ue4'),

  -- Fundamentals module (7)
  ('w1_l05', 1,  5, 'Course Overview',                          null, 'watch', true, 'AP1', true, 'foundations', 'lesn_2h4QgdX98DlYrJ4AT2lscb'),
  ('w1_l06', 1,  6, 'How Do Ads Work?',                         null, 'watch', true, 'AP1', true, 'foundations', 'lesn_5fM86GlyyNIRVLV0ehSr78'),
  ('w1_l07', 1,  7, 'Direct Response Advertising',              null, 'watch', true, 'AP1', true, 'foundations', 'lesn_52iRhAVKqhXlPbhwVw5YC4'),
  ('w1_l08', 1,  8, 'Understanding Your Customer',              null, 'watch', true, 'AP1', true, 'foundations', 'lesn_4tWgAr5nJ7PrYnwO6ISblF'),
  ('w1_l09', 1,  9, 'Buying Psychology',                        null, 'watch', true, 'AP1', true, 'foundations', 'lesn_1BVzev36uX83RDDg9DJac6'),
  ('w1_l10', 1, 10, 'Ad Creation Process',                      null, 'watch', true, 'AP1', true, 'foundations', 'lesn_6s59AQwlE84oF70joDf45p'),
  ('w1_l11', 1, 11, 'Ad Inspiration System',                    null, 'watch', true, 'AP1', true, 'foundations', 'lesn_736H8p27WGlSaXuCNLpYhW'),

  -- Video Ads Master — first part (11)
  ('w1_l12', 1, 12, 'Video Ads Master — Introduction',          null, 'watch', true, 'AP1', true, 'foundations', 'lesn_70r8gguLZGN3ktIG0UD3ai'),
  ('w1_l13', 1, 13, 'Organic Ads',                              null, 'watch', true, 'AP1', true, 'foundations', 'lesn_fWllPolk7xNvEvCSbDMRN'),
  ('w1_l14', 1, 14, 'Video Ad Safezone Guidelines',             null, 'watch', true, 'AP1', true, 'foundations', 'lesn_4PRV9HnnfTeuS1D1HopqIU'),
  ('w1_l15', 1, 15, 'Action Item: Organic Ads',                 null, 'watch', true, 'AP2', true, 'foundations', 'lesn_5gOd8MUOpnZIJ1dKaTPZyj'),
  ('w1_l16', 1, 16, 'UGC',                                      null, 'watch', true, 'AP1', true, 'foundations', 'lesn_5BXQf2CF3FOs12oxrbgC2g'),
  ('w1_l17', 1, 17, 'Action Item: UGC Ad',                      null, 'watch', true, 'AP2', true, 'foundations', 'lesn_1b1vQbBN6UkYnXy3kRob8C'),
  ('w1_l18', 1, 18, 'VSLs',                                     null, 'watch', true, 'AP1', true, 'foundations', 'lesn_36NrAAFA16GROkHMsTOnzB'),
  ('w1_l19', 1, 19, 'Action Item: VSL Ad',                      null, 'watch', true, 'AP2', true, 'foundations', 'lesn_5UU2bLbPz1eS0yeEYbBJCJ'),
  ('w1_l20', 1, 20, 'High-Production Ads',                      null, 'watch', true, 'AP1', true, 'foundations', 'lesn_6hZ3RjC9qJRvcVXdnODoJS'),
  ('w1_l21', 1, 21, 'Action Item: High-Production Ad',          null, 'watch', true, 'AP2', true, 'foundations', 'lesn_1FfxedDhmYefKyfWjxD0I2'),
  ('w1_l22', 1, 22, 'Video Hooks',                              null, 'watch', true, 'AP1', true, 'foundations', 'lesn_3W5cGvFEtXlNs3aLWESqn0'),

  -- Week 2 → Skill Stack (15 lessons)
  -- Rest of Video Ads Master (6)
  ('w2_l01', 2,  1, 'Mr. Beast Retention Techniques',           null, 'watch', true, 'AP1', false, 'skill_stack', 'lesn_78xs6wJNFhR1bkVceZVMnb'),
  ('w2_l02', 2,  2, 'Asset Management',                         null, 'watch', true, 'AP1', false, 'skill_stack', 'lesn_eE7vFkIkG4sKtc4C8l6LJ'),
  ('w2_l03', 2,  3, 'Music & SFX',                              null, 'watch', true, 'AP1', false, 'skill_stack', 'lesn_vxqavqdgjfY2RnR1qRZVE'),
  ('w2_l04', 2,  4, 'My Tech Stack For Editing Video Ads',      null, 'watch', true, 'AP1', false, 'skill_stack', 'lesn_1gYce1osj9tiXf91n96jj1'),
  ('w2_l05', 2,  5, 'AI Content Upscaling',                     null, 'watch', true, 'AP1', false, 'skill_stack', 'lesn_6M0y6m9HLKiMA9qSHcPHlB'),
  ('w2_l06', 2,  6, 'AI Voiceovers',                            null, 'watch', true, 'AP1', false, 'skill_stack', 'lesn_fzf7ofSUpwoN6HQH78jSA'),

  -- Video Editing Breakdowns (9)
  ('w2_l07', 2,  7, 'Editing Breakdowns — Intro',               null, 'watch', true, 'AP1', false, 'skill_stack', 'lesn_9jREItCoLou8qRLcR0L2e'),
  ('w2_l08', 2,  8, 'LIVE Example: Editing a Video Ad',         null, 'watch', true, 'AP1', false, 'skill_stack', 'lesn_5kPtUCuM6bDzrwVK6MMqdh'),
  ('w2_l09', 2,  9, 'Video Editing Breakdown: Part 1',          null, 'watch', true, 'AP1', false, 'skill_stack', 'lesn_4UynCyTEU6KW8GwUfaqi9g'),
  ('w2_l10', 2, 10, 'Video Editing Breakdown: Part 1 (cont.)',  null, 'watch', true, 'AP1', false, 'skill_stack', 'lesn_51aB9Fcc8FuBCHHdtat4yj'),
  ('w2_l11', 2, 11, 'Video Editing Breakdown: Part 1 (final)',  null, 'watch', true, 'AP1', false, 'skill_stack', 'lesn_5vqKOZleTI55JmXBEqMS4O'),
  ('w2_l12', 2, 12, 'Video Editing Breakdown: Part 2',          null, 'watch', true, 'AP1', false, 'skill_stack', 'lesn_3pX4auFhFbE42Mh5bK0MS2'),
  ('w2_l13', 2, 13, 'Video Editing Breakdown: Part 3',          null, 'watch', true, 'AP1', false, 'skill_stack', 'lesn_1NMftXxnOzrFaCMSiNvUjZ'),
  ('w2_l14', 2, 14, 'Video Editing Breakdown: Part 4',          null, 'watch', true, 'AP1', false, 'skill_stack', 'lesn_5YEHQKJNWCgwPmcsSAyg77'),
  ('w2_l15', 2, 15, 'Video Editing Breakdown: Part 5',          null, 'watch', true, 'AP1', false, 'skill_stack', 'lesn_3qOYK6JVED9N8QkJZ8o3Hb'),

  -- Week 3 → Strategy (9 lessons — titles are placeholders; rename in Supabase when ready)
  ('w3_l01', 3, 1, 'Strategy Lesson 1', null, 'watch', true, 'AP1', false, 'strategy', 'lesn_5R9qygV5GLrWm8SxXsVsMm'),
  ('w3_l02', 3, 2, 'Strategy Lesson 2', null, 'watch', true, 'AP1', false, 'strategy', 'lesn_2XPI7WaFzI6YIrJW8fRXHX'),
  ('w3_l03', 3, 3, 'Strategy Lesson 3', null, 'watch', true, 'AP1', false, 'strategy', 'lesn_5HT44WU6d8paaIERpt1lEP'),
  ('w3_l04', 3, 4, 'Strategy Lesson 4', null, 'watch', true, 'AP1', false, 'strategy', 'lesn_7Gm3cibPk7yES3VTuANtAA'),
  ('w3_l05', 3, 5, 'Strategy Lesson 5', null, 'watch', true, 'AP1', false, 'strategy', 'lesn_36aPWrKA4T2Brrv0Ugs0lE'),
  ('w3_l06', 3, 6, 'Strategy Lesson 6', null, 'watch', true, 'AP1', false, 'strategy', 'lesn_4CsHnaOijIPBBj1nWS2x3x'),
  ('w3_l07', 3, 7, 'Strategy Lesson 7', null, 'watch', true, 'AP1', false, 'strategy', 'lesn_6XiqGGfhwMcCwPkOAFYFeu'),
  ('w3_l08', 3, 8, 'Strategy Lesson 8', null, 'watch', true, 'AP1', false, 'strategy', 'lesn_50HddY7hENGJdAbLFB5G0w'),
  ('w3_l09', 3, 9, 'Strategy Lesson 9', null, 'watch', true, 'AP1', false, 'strategy', 'lesn_3oQNmkAwT7M1yQ0AL1jXND');

-- 3. Simplify action-task titles + descriptions (watching is tracked elsewhere now)
update tasks set sort_order = 100, title = 'Ship Your Organic Ad',
                 description = 'Make an organic ad based on the module. Submit to #ad-review and tag the coach. Target: Day 3-4.'
where id = 'w1_t7';

update tasks set sort_order = 101, title = 'Ship Your UGC Ad',
                 description = 'Make a UGC ad based on the module. Submit to #ad-review. Back to back with Organic — don''t wait.'
where id = 'w1_t8';

update tasks set sort_order = 100, title = 'Ship Your High-Production Ad',
                 description = 'Make a high-production ad. Submit to #ad-review. This is where you learn to make brands look premium.'
where id = 'w2_t3';

update tasks set sort_order = 101, title = 'Ship Your VSL',
                 description = 'Make a VSL — hardest and most time-consuming to edit, but highest earning potential. Submit to #ad-review.'
where id = 'w2_t4';

update tasks set sort_order = 102, title = 'Engage With All #ad-review Feedback',
                 description = 'Go back through every piece of feedback you''ve gotten. Reply, ask questions, note what you''re changing, and make your ads better.'
where id = 'w2_t5';

update tasks set sort_order = 103, title = 'Ship Your Static Ad',
                 description = 'Make a static ad. Static + video skills together make you significantly more valuable to brands. Skill stacking.'
where id = 'w3_t1';

-- 4. Move the discount gate from first_ads to skill_stack
update checkpoints set is_discount_gate = false where id = 'first_ads';
update checkpoints set is_discount_gate = true  where id = 'skill_stack';

-- Verification queries (run manually after):
--   select count(*) from tasks;
--     -- expect 62 (23 original - 7 deleted + 46 inserted)
--   select checkpoint_id, count(*) from tasks group by checkpoint_id order by 1;
--     -- onboarding=3, foundations=22, first_ads=2, skill_stack=19, strategy=9, job_board=1, ad_bounties=6
--   select id from tasks where whop_lesson_id is null and task_type = 'watch';
--     -- expect 0
--   select id, title, is_discount_gate from checkpoints order by sort_order;
--     -- only 'skill_stack' should have is_discount_gate = true
