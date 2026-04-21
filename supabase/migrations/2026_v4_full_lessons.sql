-- ============================================================
-- V4: Full lesson restructure — every real Whop video + every
--     action item is its own node on the map.
--
-- Supersedes 2026_v3_expedition_seed.sql + 2026_v3_whop_lesson_ids.sql
-- (neither should be re-run — this migration replaces their data).
--
-- Layout:
--   R1 Base Camp (days 1-8):    25 items — onboarding + foundations
--   R2 Creative Lab (days 9-15): 21 items — skill stack + ship-ad actions
--                                           last item is the DISCOUNT GATE
--   R3 Test Track (days 16-23): 10 items — strategy + job-board
--   R4 The Market (days 24-30):  8 items — ad bounties + boss reflection
--
-- Total: 64 nodes across 4 regions.
-- ============================================================

-- Clear existing v3 lessons + all student completions (FK cascade handles it)
truncate table lessons cascade;

-- ============================================================
-- R1 — Base Camp (Days 1-8) — 25 items
--   Onboarding (3 actions/setup) + Foundations (22 videos)
-- ============================================================
insert into lessons
  (id, region_id, day, type, title, description, duration_label, is_gate, is_boss, whop_lesson_id, discord_channel, sort_order)
values
-- Day 1
('l001','r1',1,'setup', 'Join Discord + Confirm Access',
  'Join the EcomTalent Discord, verify via Whop, and say hi in #general.',
  '5m', false, false, null, 'general', 1),
('l002','r1',1,'watch', 'My Goal Is To Change Your Life',
  'Karlo welcomes you. The intent of the program, what changes, what doesn''t.',
  '7m', false, false, 'lesn_xhGjKPzSKp9CR', null, 2),
('l003','r1',1,'watch', 'How You Will Turn Into a Top 5%',
  'The mindset and habits that separate students who make it from those who don''t.',
  '10m', false, false, 'lesn_WpuJEzhzEIA8j', null, 3),

-- Day 2
('l004','r1',2,'watch', 'Proof This Works & What You Can Expect',
  'Case studies, realistic expectations, timelines for your first wins.',
  '8m', false, false, 'lesn_f4di74GSrRiI1', null, 1),
('l005','r1',2,'watch', 'Your First 30 Days Here (The Game Plan)',
  'The full 30-day plan laid out. This is your map.',
  '12m', false, false, 'lesn_O4gxxr5BN3ue4', null, 2),
('l006','r1',2,'setup', 'Set Up Weekly Calls',
  'Subscribe to the weekly call calendar invites. They''re live and interactive.',
  '3m', false, false, null, null, 3),

-- Day 3
('l007','r1',3,'watch', 'Course Overview',
  'A bird''s eye view of every module, so you know what''s coming.',
  '6m', false, false, 'lesn_2h4QgdX98DlYrJ4AT2lscb', null, 1),
('l008','r1',3,'watch', 'How Do Ads Work?',
  'The actual mechanics of paid ads — delivery, auctions, what the algorithm wants.',
  '12m', false, false, 'lesn_5fM86GlyyNIRVLV0ehSr78', null, 2),
('l009','r1',3,'watch', 'Direct Response Advertising',
  'What DR is, why it''s 99% of what brands pay for, how it''s measured.',
  '10m', false, false, 'lesn_52iRhAVKqhXlPbhwVw5YC4', null, 3),

-- Day 4
('l010','r1',4,'watch', 'Understanding Your Customer',
  'The single most important skill. If you can''t see the customer, you can''t sell to them.',
  '14m', false, false, 'lesn_4tWgAr5nJ7PrYnwO6ISblF', null, 1),
('l011','r1',4,'watch', 'Buying Psychology',
  'The triggers and patterns behind every purchase decision.',
  '16m', false, false, 'lesn_1BVzev36uX83RDDg9DJac6', null, 2),
('l012','r1',4,'action','Post Your Discord Intro',
  'Introduce yourself in #introductions. One paragraph: who, niche (if you have one), goal.',
  '10m', false, false, null, 'introductions', 3),

-- Day 5
('l013','r1',5,'watch', 'Ad Creation Process',
  'The step-by-step process to go from idea to shipped ad, every time.',
  '14m', false, false, 'lesn_6s59AQwlE84oF70joDf45p', null, 1),
('l014','r1',5,'watch', 'Ad Inspiration System',
  'Where to look, what to save, how to steal like an artist.',
  '11m', false, false, 'lesn_736H8p27WGlSaXuCNLpYhW', null, 2),
('l015','r1',5,'watch', 'Video Ads Master — Introduction',
  'What makes a video ad work in 2025. The formats, the rules, the pitfalls.',
  '9m', false, false, 'lesn_70r8gguLZGN3ktIG0UD3ai', null, 3),

-- Day 6
('l016','r1',6,'watch', 'Organic Ads',
  'The "feels like content" format. When it works, when it doesn''t.',
  '12m', false, false, 'lesn_fWllPolk7xNvEvCSbDMRN', null, 1),
('l017','r1',6,'watch', 'Video Ad Safezone Guidelines',
  'What placements require, so your ad isn''t cropped into oblivion.',
  '8m', false, false, 'lesn_4PRV9HnnfTeuS1D1HopqIU', null, 2),
('l018','r1',6,'watch', 'Action Item: Organic Ads',
  'The briefing video for your first organic-style ad assignment.',
  '6m', false, false, 'lesn_5gOd8MUOpnZIJ1dKaTPZyj', null, 3),

-- Day 7
('l019','r1',7,'watch', 'UGC',
  'User-Generated Content style. Lo-fi, high-converting, authentic.',
  '11m', false, false, 'lesn_5BXQf2CF3FOs12oxrbgC2g', null, 1),
('l020','r1',7,'watch', 'Action Item: UGC Ad',
  'Briefing video: make a UGC ad next. Here''s what good looks like.',
  '7m', false, false, 'lesn_1b1vQbBN6UkYnXy3kRob8C', null, 2),
('l021','r1',7,'watch', 'VSLs',
  'Video Sales Letters — long-form, problem-agitation-solution format.',
  '16m', false, false, 'lesn_36NrAAFA16GROkHMsTOnzB', null, 3),
('l022','r1',7,'watch', 'Action Item: VSL Ad',
  'Briefing video: when to build a VSL and how to script one.',
  '9m', false, false, 'lesn_5UU2bLbPz1eS0yeEYbBJCJ', null, 4),

-- Day 8
('l023','r1',8,'watch', 'High-Production Ads',
  'Studio lighting, real set, polished edit — when to reach for it.',
  '13m', false, false, 'lesn_6hZ3RjC9qJRvcVXdnODoJS', null, 1),
('l024','r1',8,'watch', 'Action Item: High-Production Ad',
  'Briefing video: plan a high-production ad for your portfolio.',
  '7m', false, false, 'lesn_1FfxedDhmYefKyfWjxD0I2', null, 2),
('l025','r1',8,'watch', 'Video Hooks',
  'Anatomy of a hook. Stopping the scroll in 1.5 seconds.',
  '14m', false, false, 'lesn_3W5cGvFEtXlNs3aLWESqn0', null, 3),

-- ============================================================
-- R2 — Creative Lab (Days 9-15) — 21 items
--   Skill Stack (15 videos) + Ship-Ad actions (5) + Engage feedback (1)
--   LAST ITEM = DISCOUNT GATE
-- ============================================================

-- Day 9
('l026','r2',9,'watch', 'Mr. Beast Retention Techniques',
  'The pacing tricks the best creators use to keep eyes glued.',
  '10m', false, false, 'lesn_78xs6wJNFhR1bkVceZVMnb', null, 1),
('l027','r2',9,'watch', 'Asset Management',
  'Organize clips, fonts, music, templates so you can work fast.',
  '7m', false, false, 'lesn_eE7vFkIkG4sKtc4C8l6LJ', null, 2),
('l028','r2',9,'watch', 'Music & SFX',
  'Where to find them legally, how to layer them so they add instead of distract.',
  '9m', false, false, 'lesn_vxqavqdgjfY2RnR1qRZVE', null, 3),

-- Day 10
('l029','r2',10,'watch','My Tech Stack For Editing Video Ads',
  'Karlo''s exact editing setup. Apps, plugins, workflow.',
  '11m', false, false, 'lesn_1gYce1osj9tiXf91n96jj1', null, 1),
('l030','r2',10,'watch','AI Content Upscaling',
  'Turn low-res footage into usable ad footage with AI tools.',
  '6m', false, false, 'lesn_6M0y6m9HLKiMA9qSHcPHlB', null, 2),
('l031','r2',10,'watch','AI Voiceovers',
  'When to use AI voice, when not to, what tools actually sound human.',
  '7m', false, false, 'lesn_fzf7ofSUpwoN6HQH78jSA', null, 3),

-- Day 11
('l032','r2',11,'watch','Editing Breakdowns — Intro',
  'Why we study edits frame-by-frame. What you''ll get out of the breakdowns.',
  '5m', false, false, 'lesn_9jREItCoLou8qRLcR0L2e', null, 1),
('l033','r2',11,'watch','LIVE Example: Editing a Video Ad',
  'Watch Karlo edit a real ad from scratch in one sitting.',
  '45m', false, false, 'lesn_5kPtUCuM6bDzrwVK6MMqdh', null, 2),
('l034','r2',11,'action','Ship Your Organic Ad',
  'Make an organic ad based on the module. Submit to #ad-review and tag the coach.',
  '2h', false, false, null, 'ad-review', 3),

-- Day 12
('l035','r2',12,'watch','Video Editing Breakdown: Part 1',
  'Part 1 of a four-part deep dive on ad editing.',
  '18m', false, false, 'lesn_4UynCyTEU6KW8GwUfaqi9g', null, 1),
('l036','r2',12,'watch','Video Editing Breakdown: Part 1 (cont.)',
  'Continuation of Part 1 — focus on cuts and pacing.',
  '14m', false, false, 'lesn_51aB9Fcc8FuBCHHdtat4yj', null, 2),
('l037','r2',12,'watch','Video Editing Breakdown: Part 1 (final)',
  'Finishing Part 1 — sound design and final polish.',
  '12m', false, false, 'lesn_5vqKOZleTI55JmXBEqMS4O', null, 3),

-- Day 13
('l038','r2',13,'watch','Video Editing Breakdown: Part 2',
  'Part 2 — a different ad format, different challenges.',
  '20m', false, false, 'lesn_3pX4auFhFbE42Mh5bK0MS2', null, 1),
('l039','r2',13,'watch','Video Editing Breakdown: Part 3',
  'Part 3 — breaking down a top-performing UGC ad.',
  '16m', false, false, 'lesn_1NMftXxnOzrFaCMSiNvUjZ', null, 2),
('l040','r2',13,'action','Ship Your UGC Ad',
  'Make a UGC ad based on the module. Submit to #ad-review.',
  '2h', false, false, null, 'ad-review', 3),

-- Day 14
('l041','r2',14,'watch','Video Editing Breakdown: Part 4',
  'Part 4 — editing a high-production ad.',
  '18m', false, false, 'lesn_5YEHQKJNWCgwPmcsSAyg77', null, 1),
('l042','r2',14,'watch','Video Editing Breakdown: Part 5',
  'Part 5 — editing a VSL. The hardest format, highest payoff.',
  '22m', false, false, 'lesn_3qOYK6JVED9N8QkJZ8o3Hb', null, 2),
('l043','r2',14,'action','Ship Your High-Production Ad',
  'Plan + shoot + edit a high-production ad. Submit to #ad-review.',
  '3h', false, false, null, 'ad-review', 3),

-- Day 15 — DISCOUNT GATE on the final action
('l044','r2',15,'action','Ship Your VSL',
  'Script + shoot + edit a VSL. Longest to make, highest earning potential.',
  '4h', false, false, null, 'ad-review', 1),
('l045','r2',15,'action','Engage With All #ad-review Feedback',
  'Go through every piece of feedback you''ve received. Reply, ask, iterate.',
  '1h', false, false, null, 'ad-review', 2),
('l046','r2',15,'action','Ship Your Static Ad — Discount unlocked',
  'Make a static ad. Static + video together makes you 2x more hireable. This is the gate.',
  '1h', true, false, null, 'ad-review', 3),

-- ============================================================
-- R3 — Test Track (Days 16-23) — 10 items
--   Strategy (9 videos) + Job Board action (1)
-- ============================================================

('l047','r3',16,'watch','Strategy Lesson 1',
  'The foundation of creative strategy: how to think about what to make next.',
  '12m', false, false, 'lesn_5R9qygV5GLrWm8SxXsVsMm', null, 1),
('l048','r3',16,'watch','Strategy Lesson 2',
  'Strategy part 2.',
  '10m', false, false, 'lesn_2XPI7WaFzI6YIrJW8fRXHX', null, 2),
('l049','r3',17,'watch','Strategy Lesson 3',
  'Strategy part 3.',
  '11m', false, false, 'lesn_5HT44WU6d8paaIERpt1lEP', null, 1),
('l050','r3',18,'watch','Strategy Lesson 4',
  'Strategy part 4.',
  '9m', false, false, 'lesn_7Gm3cibPk7yES3VTuANtAA', null, 1),
('l051','r3',19,'watch','Strategy Lesson 5',
  'Strategy part 5.',
  '13m', false, false, 'lesn_36aPWrKA4T2Brrv0Ugs0lE', null, 1),
('l052','r3',20,'watch','Strategy Lesson 6',
  'Strategy part 6.',
  '10m', false, false, 'lesn_4CsHnaOijIPBBj1nWS2x3x', null, 1),
('l053','r3',21,'watch','Strategy Lesson 7',
  'Strategy part 7.',
  '12m', false, false, 'lesn_6XiqGGfhwMcCwPkOAFYFeu', null, 1),
('l054','r3',22,'watch','Strategy Lesson 8',
  'Strategy part 8.',
  '11m', false, false, 'lesn_50HddY7hENGJdAbLFB5G0w', null, 1),
('l055','r3',23,'watch','Strategy Lesson 9',
  'Strategy part 9 — the capstone.',
  '14m', false, false, 'lesn_3oQNmkAwT7M1yQ0AL1jXND', null, 1),
('l056','r3',23,'action','Start Applying to Job Board',
  'Open the job board. Pick 3 posts that fit your niche. Apply.',
  '45m', false, false, null, 'jobs', 2),

-- ============================================================
-- R4 — The Market (Days 24-30) — 8 items
--   Ad Bounties (6) + Boss Reflection (1) + buffer
-- ============================================================

('l057','r4',24,'setup', 'Complete Ad Bounty Onboarding',
  'Read the bounty brief process. Understand how submissions are judged.',
  '20m', false, false, null, 'bounties', 1),
('l058','r4',25,'action','Submit Your First Ad Bounty',
  'Pick a bounty brief. Build it. Submit it. Your first real client work.',
  '3h', false, false, null, 'bounties', 1),
('l059','r4',26,'action','Submit Ad Bounty #2',
  'Different brief, different format. Stack up the portfolio.',
  '3h', false, false, null, 'bounties', 1),
('l060','r4',27,'action','Submit Ad Bounty #3',
  'Third bounty. Iterate on what''s working from feedback on 1 and 2.',
  '3h', false, false, null, 'bounties', 1),
('l061','r4',28,'action','Check Ad Performance Dashboard',
  'See the real numbers your submitted ads produced. This is the scoreboard.',
  '15m', false, false, null, null, 1),
('l062','r4',29,'action','Attend Weekly Call',
  'Live weekly call. Bring a question, bring your screen, bring your work.',
  '1h', false, false, null, null, 1),
('l063','r4',30,'action','The Final Reflection',
  'Write down what you learned, what you''ll do next, what you wish you knew on day 1. This is the boss.',
  '20m', false, true, null, null, 1);

-- Verification queries:
--   select region_id, count(*) from lessons group by region_id order by 1;
--   -- expect r1=25, r2=21, r3=10, r4=7
--   select count(*) from lessons where whop_lesson_id is not null;
--   -- expect 46
