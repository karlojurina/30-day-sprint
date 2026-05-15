-- ============================================================
-- v20: CANONICAL LESSON STATE
--
-- Idempotent rebuild of the `lessons` table to match the agreed
-- 30-day curriculum as of 2026-05-12. Safe to run any number of
-- times against any starting state — every row is upserted, every
-- deleted lesson is purged, every flag is explicitly set.
--
-- Why this exists:
--   Migration history v4 → v19 was incremental. If any single
--   migration was skipped (or the DB was bootstrapped from an
--   older snapshot), the table can end up in a stale state where:
--     * the discount gate is on the wrong lesson (l046 instead of l049)
--     * deleted lessons (l006, l012, l034, l040, l043, l044) still exist
--     * l054 + l055 share whop_lesson_ids with l052 + l053 (a real bug
--       from v19 — watch-sync would mark two lessons complete at once)
--
-- This file is the single source of truth. Run it; the table will
-- match the live app exactly.
--
-- It does NOT touch student_lesson_completions, daily_notes,
-- discount_requests, or anything other than `lessons` + `regions`.
--
-- Run order in the SQL editor: paste the whole file, hit run.
-- ============================================================


-- ─────────────── 0. Make sure all columns exist ───────────────
-- (No-op if the column already exists. Lets this file run against
-- a DB that hasn't seen the column-adding migrations yet.)

alter table lessons
  add column if not exists requires_action boolean not null default false;

alter table lessons
  add column if not exists action_brief text;

alter table lessons
  add column if not exists lesson_group_id text;

alter table lessons
  add column if not exists is_optional boolean not null default false;


-- ─────────────── 1. Regions (final state) ───────────────
-- r1: days 1–7    Foundation
-- r2: days 8–14   Strategy
-- r3: days 15–23  Production  (contains the discount gate on day 17)
-- r4: days 24–30  Gate of Possibilities

update regions set
  name      = 'Foundation',
  subtitle  = 'Foundations',
  tagline   = 'Get your bearings. Learn the fundamentals.',
  day_start = 1,
  day_end   = 7
where id = 'r1';

update regions set
  name      = 'Strategy',
  subtitle  = 'First Ads',
  tagline   = 'Build and ship your first ads.',
  day_start = 8,
  day_end   = 14
where id = 'r2';

update regions set
  name      = 'Production',
  subtitle  = 'Strategy + Editing',
  tagline   = 'Sharpen the stack. Think like a director.',
  day_start = 15,
  day_end   = 23
where id = 'r3';

update regions set
  name      = 'Gate of Possibilities',
  subtitle  = 'Bounties + Scale',
  tagline   = 'Real briefs. Real money. The doors that open from here.',
  day_start = 24,
  day_end   = 30
where id = 'r4';


-- ─────────────── 2. Remove retired lessons ───────────────
-- v6 deleted l034, l040, l043, l044 (the four redundant "Ship Your X"
-- action lessons — folded into the compound briefing lessons).
-- v13 deleted l006 (Weekly Calls setup) and l012 (Discord Intro action).
-- Cascades on student_lesson_completions handle FK cleanup.

delete from student_lesson_completions
  where lesson_id in ('l006','l012','l034','l040','l043','l044');

delete from lessons
  where id in ('l006','l012','l034','l040','l043','l044');


-- ─────────────── 3. Canonical lesson rows ───────────────
-- 57 total: R1=18, R2=20, R3=12, R4=7
--
-- Every column is set explicitly. is_gate is false on every row
-- EXCEPT l049 (the only true gate). is_boss is true only on l063.
-- is_optional is true on l050 + l051. requires_action is true on
-- the 5 compound action items (l018, l020, l022, l024, l049).
-- lesson_group_id is 'editing_breakdowns' on the 9 grouped R2 lessons.


-- ─── R1 — Foundation (Days 1–7) — 18 lessons ───

insert into lessons (
  id, region_id, day, sort_order, type, title, description,
  duration_label, whop_lesson_id, discord_channel,
  is_gate, is_boss, is_optional, requires_action, action_brief, lesson_group_id
) values
  ('l001','r1',1,1,'setup',
   'Join Discord + Confirm Access',
   'Join the EcomTalent Discord, verify via Whop, and say hi in #general. (Optional: introduce yourself in the chat — share your niche, your goal, or just a wave.)',
   '0m', null, 'general',
   false, false, false, false, null, null),

  ('l002','r1',1,2,'watch',
   'My Goal Is To Change Your Life',
   'Karlo welcomes you. The intent of the program, what changes, what doesn''t.',
   '13m', 'lesn_xhGjKPzSKp9CR', null,
   false, false, false, false, null, null),

  ('l003','r1',1,3,'watch',
   'How You Will Turn Into a Top 5%',
   'The mindset and habits that separate students who make it from those who don''t.',
   '17m 30s', 'lesn_WpuJEzhzEIA8j', null,
   false, false, false, false, null, null),

  ('l004','r1',2,1,'watch',
   'Proof This Works & What You Can Expect',
   'Case studies, realistic expectations, timelines for your first wins.',
   '27m 40s', 'lesn_f4di74GSrRiI1', null,
   false, false, false, false, null, null),

  ('l005','r1',2,2,'watch',
   'Your First 30 Days Here (The Game Plan)',
   'The full 30-day plan laid out. This is your map.',
   '11m 10s', 'lesn_O4gxxr5BN3ue4', null,
   false, false, false, false, null, null),

  ('l007','r1',3,1,'watch',
   'Course Overview',
   'A bird''s eye view of every module, so you know what''s coming.',
   '13m 20s', 'lesn_2h4QgdX98DlYrJ4AT2lscb', null,
   false, false, false, false, null, null),

  ('l008','r1',3,2,'watch',
   'How Do Ads Work?',
   'The actual mechanics of paid ads — delivery, auctions, what the algorithm wants.',
   '6m', 'lesn_5fM86GlyyNIRVLV0ehSr78', null,
   false, false, false, false, null, null),

  ('l009','r1',3,3,'watch',
   'Direct Response Advertising',
   'What DR is, why it''s 99% of what brands pay for, how it''s measured.',
   '16m', 'lesn_52iRhAVKqhXlPbhwVw5YC4', null,
   false, false, false, false, null, null),

  ('l010','r1',4,1,'watch',
   'Understanding Your Customer',
   'The single most important skill. If you can''t see the customer, you can''t sell to them.',
   '6m', 'lesn_4tWgAr5nJ7PrYnwO6ISblF', null,
   false, false, false, false, null, null),

  ('l011','r1',4,2,'watch',
   'Buying Psychology',
   'The triggers and patterns behind every purchase decision.',
   '12m', 'lesn_1BVzev36uX83RDDg9DJac6', null,
   false, false, false, false, null, null),

  ('l013','r1',5,1,'watch',
   'Ad Creation Process',
   'The step-by-step process to go from idea to shipped ad, every time.',
   '8m', 'lesn_6s59AQwlE84oF70joDf45p', null,
   false, false, false, false, null, null),

  ('l014','r1',5,2,'watch',
   'Ad Inspiration System',
   'Where to look, what to save, how to steal like an artist.',
   '24m', 'lesn_736H8p27WGlSaXuCNLpYhW', null,
   false, false, false, false, null, null),

  ('l015','r1',5,3,'watch',
   'Video Ads Master — Introduction',
   'What makes a video ad work in 2025. The formats, the rules, the pitfalls.',
   '3m', 'lesn_70r8gguLZGN3ktIG0UD3ai', null,
   false, false, false, false, null, null),

  ('l016','r1',6,1,'watch',
   'Organic Ads',
   'The "feels like content" format. When it works, when it doesn''t.',
   '14m', 'lesn_fWllPolk7xNvEvCSbDMRN', null,
   false, false, false, false, null, null),

  ('l017','r1',6,2,'watch',
   'Video Ad Safezone Guidelines',
   'What placements require, so your ad isn''t cropped into oblivion.',
   '13m', 'lesn_4PRV9HnnfTeuS1D1HopqIU', null,
   false, false, false, false, null, null),

  ('l018','r1',7,1,'watch',
   'Action Item: Organic Ads',
   'Now apply what you''ve learned. Pick a product (yours, a friend''s, or a public brand you admire) and create one organic-style ad — feels-like-content, no obvious sales pitch. Submit it to #ad-review with a one-line note about who it''s targeting and what reaction you expect. The team reviews everything.',
   '9m', 'lesn_5gOd8MUOpnZIJ1dKaTPZyj', 'ad-review',
   false, false, false, true,
   'Make an organic-style ad based on what you watched. Lo-fi, "feels like content" feel — not a polished spot. Submit to #ad-review on Discord and tag the coach. Target: Day 3-4.',
   null),

  ('l019','r1',7,2,'watch',
   'UGC',
   'User-Generated Content style. Lo-fi, high-converting, authentic.',
   '11m', 'lesn_5BXQf2CF3FOs12oxrbgC2g', null,
   false, false, false, false, null, null),

  ('l020','r1',7,3,'watch',
   'Action Item: UGC Ad',
   'Make a UGC-style ad: lo-fi, authentic, like a real customer talking to camera. Use your phone — no studio. Aim for 15–30 seconds. Submit to #ad-review with a note on the angle you''re testing. Reviewing your own ad against the briefing is half the learning.',
   '7m', 'lesn_1b1vQbBN6UkYnXy3kRob8C', 'ad-review',
   false, false, false, true,
   'Make a UGC-style ad. Hold the camera yourself, talk to it, focus on conversion. Submit to #ad-review on Discord. Back-to-back with your organic — don''t wait.',
   null)
on conflict (id) do update set
  region_id       = excluded.region_id,
  day             = excluded.day,
  sort_order      = excluded.sort_order,
  type            = excluded.type,
  title           = excluded.title,
  description     = excluded.description,
  duration_label  = excluded.duration_label,
  whop_lesson_id  = excluded.whop_lesson_id,
  discord_channel = excluded.discord_channel,
  is_gate         = excluded.is_gate,
  is_boss         = excluded.is_boss,
  is_optional     = excluded.is_optional,
  requires_action = excluded.requires_action,
  action_brief    = excluded.action_brief,
  lesson_group_id = excluded.lesson_group_id;


-- ─── R2 — Strategy (Days 8–14) — 20 lessons ───

insert into lessons (
  id, region_id, day, sort_order, type, title, description,
  duration_label, whop_lesson_id, discord_channel,
  is_gate, is_boss, is_optional, requires_action, action_brief, lesson_group_id
) values
  ('l021','r2',8,1,'watch',
   'VSLs',
   'Video Sales Letters — long-form, problem-agitation-solution format.',
   '16m', 'lesn_36NrAAFA16GROkHMsTOnzB', null,
   false, false, false, false, null, null),

  ('l022','r2',8,2,'watch',
   'Action Item: VSL Ad',
   'Watch the briefing, then ship a VSL. Both required.',
   '9m', 'lesn_5UU2bLbPz1eS0yeEYbBJCJ', 'ad-review',
   false, false, false, true,
   'Script + record + edit a VSL. Long-form, problem→agitation→solution. Hardest format, highest earning potential. Submit to #ad-review.',
   null),

  ('l023','r2',8,3,'watch',
   'High-Production Ads',
   'Studio lighting, real set, polished edit — when to reach for it.',
   '9m', 'lesn_6hZ3RjC9qJRvcVXdnODoJS', null,
   false, false, false, false, null, null),

  ('l024','r2',8,4,'watch',
   'Action Item: High-Production Ad',
   'Watch the briefing, then ship a high-production ad. Both required.',
   '3m', 'lesn_1FfxedDhmYefKyfWjxD0I2', 'ad-review',
   false, false, false, true,
   'Plan + shoot + edit a high-production ad with proper lighting and sound. This is where you learn to make brands look premium. Submit to #ad-review.',
   null),

  ('l025','r2',8,5,'watch',
   'Video Hooks',
   'Anatomy of a hook. Stopping the scroll in 1.5 seconds.',
   '17m', 'lesn_3W5cGvFEtXlNs3aLWESqn0', null,
   false, false, false, false, null, null),

  ('l026','r2',9,1,'watch',
   'Mr. Beast Retention Techniques',
   'The pacing tricks the best creators use to keep eyes glued.',
   '12m', 'lesn_78xs6wJNFhR1bkVceZVMnb', null,
   false, false, false, false, null, null),

  ('l027','r2',9,2,'watch',
   'Asset Management',
   'Organize clips, fonts, music, templates so you can work fast.',
   '7m', 'lesn_eE7vFkIkG4sKtc4C8l6LJ', null,
   false, false, false, false, null, null),

  ('l028','r2',9,3,'watch',
   'Music & SFX',
   'Where to find them legally, how to layer them so they add instead of distract.',
   '20m', 'lesn_vxqavqdgjfY2RnR1qRZVE', null,
   false, false, false, false, null, null),

  ('l029','r2',10,1,'watch',
   'My Tech Stack For Editing Video Ads',
   'Karlo''s exact editing setup. Apps, plugins, workflow.',
   '30m', 'lesn_1gYce1osj9tiXf91n96jj1', null,
   false, false, false, false, null, null),

  ('l030','r2',10,2,'watch',
   'AI Content Upscaling',
   'Turn low-res footage into usable ad footage with AI tools.',
   '10m', 'lesn_6M0y6m9HLKiMA9qSHcPHlB', null,
   false, false, false, false, null, null),

  ('l031','r2',10,3,'watch',
   'AI Voiceovers',
   'When to use AI voice, when not to, what tools actually sound human.',
   '42m', 'lesn_fzf7ofSUpwoN6HQH78jSA', null,
   false, false, false, false, null, null),

  ('l032','r2',11,1,'watch',
   'Editing Breakdowns — Intro',
   'IMPORTANT: the breakdowns that follow are technically optional, but they''re the saucy, lengthy parts of the program — a couple of hours total across all parts. If you''re aiming for momentum and want to skip them for now to keep moving, you can — but you''ll definitely need to come back later, because this is where the craft lives.

Why we study edits frame-by-frame. What you''ll get out of the breakdowns.',
   '2m', 'lesn_9jREItCoLou8qRLcR0L2e', null,
   false, false, false, false, null, 'editing_breakdowns'),

  ('l033','r2',11,2,'watch',
   'LIVE Example: Editing a Video Ad',
   'Watch Karlo edit a real ad from scratch in one sitting.',
   '54m', 'lesn_5kPtUCuM6bDzrwVK6MMqdh', null,
   false, false, false, false, null, 'editing_breakdowns'),

  ('l035','r2',12,1,'watch',
   'Video Editing Breakdown: Part 1',
   'Part 1 of a four-part deep dive on ad editing.',
   '1h 25m', 'lesn_4UynCyTEU6KW8GwUfaqi9g', null,
   false, false, false, false, null, 'editing_breakdowns'),

  ('l036','r2',12,2,'watch',
   'Video Editing Breakdown: Part 1 (cont.)',
   'Continuation of Part 1 — focus on cuts and pacing.',
   '1h 20m', 'lesn_51aB9Fcc8FuBCHHdtat4yj', null,
   false, false, false, false, null, 'editing_breakdowns'),

  ('l037','r2',12,3,'watch',
   'Video Editing Breakdown: Part 1 (final)',
   'Finishing Part 1 — sound design and final polish.',
   '50m', 'lesn_5vqKOZleTI55JmXBEqMS4O', null,
   false, false, false, false, null, 'editing_breakdowns'),

  ('l038','r2',13,1,'watch',
   'Video Editing Breakdown: Part 2',
   'Part 2 — a different ad format, different challenges.',
   '38m', 'lesn_3pX4auFhFbE42Mh5bK0MS2', null,
   false, false, false, false, null, 'editing_breakdowns'),

  ('l039','r2',13,2,'watch',
   'Video Editing Breakdown: Part 3',
   'Part 3 — breaking down a top-performing UGC ad.',
   '20m', 'lesn_1NMftXxnOzrFaCMSiNvUjZ', null,
   false, false, false, false, null, 'editing_breakdowns'),

  ('l041','r2',14,1,'watch',
   'Video Editing Breakdown: Part 4',
   'Part 4 — editing a high-production ad.',
   '52m', 'lesn_5YEHQKJNWCgwPmcsSAyg77', null,
   false, false, false, false, null, 'editing_breakdowns'),

  ('l042','r2',14,2,'watch',
   'Video Editing Breakdown: Part 5 — VSL Ad',
   'Part 5 — editing a VSL. The hardest format, highest payoff.',
   '22m', 'lesn_3qOYK6JVED9N8QkJZ8o3Hb', null,
   false, false, false, false, null, 'editing_breakdowns')
on conflict (id) do update set
  region_id       = excluded.region_id,
  day             = excluded.day,
  sort_order      = excluded.sort_order,
  type            = excluded.type,
  title           = excluded.title,
  description     = excluded.description,
  duration_label  = excluded.duration_label,
  whop_lesson_id  = excluded.whop_lesson_id,
  discord_channel = excluded.discord_channel,
  is_gate         = excluded.is_gate,
  is_boss         = excluded.is_boss,
  is_optional     = excluded.is_optional,
  requires_action = excluded.requires_action,
  action_brief    = excluded.action_brief,
  lesson_group_id = excluded.lesson_group_id;


-- ─── R3 — Production (Days 15–23) — 12 lessons ───
--    Static Ads (5) + Money Making (4) + Creative Strategy (3)
--    THE DISCOUNT GATE IS l049 (day 17). is_gate = true ONLY here.

insert into lessons (
  id, region_id, day, sort_order, type, title, description,
  duration_label, whop_lesson_id, discord_channel,
  is_gate, is_boss, is_optional, requires_action, action_brief, lesson_group_id
) values
  ('l045','r3',15,1,'watch',
   'The Art Of 1 Frame',
   'How to make a single static frame do the work of a 30-second ad.',
   '29m', 'lesn_5R9qygV5GLrWm8SxXsVsMm', null,
   false, false, false, false, null, null),

  ('l046','r3',15,2,'watch',
   'Static Ad Safezone Guidelines',
   'Where your eye + thumb naturally land. Design inside the safe zones.',
   '3m', 'lesn_2XPI7WaFzI6YIrJW8fRXHX', null,
   false, false, false, false, null, null),

  ('l047','r3',16,1,'watch',
   'My Tech Stack For Doing Static Ads',
   'The exact apps + plugins Karlo uses for every static.',
   '15m', 'lesn_5HT44WU6d8paaIERpt1lEP', null,
   false, false, false, false, null, null),

  ('l048','r3',16,2,'watch',
   'Static Ad Templates + LIVE Example',
   'Walk-through of the template files + a live build of one ad.',
   '13m', 'lesn_7Gm3cibPk7yES3VTuANtAA', null,
   false, false, false, false, null, null),

  -- ★ THE DISCOUNT GATE ★
  ('l049','r3',17,1,'action',
   'Action Item: Static Ads',
   'Ship a static ad. Submit to #ad-review. This is the moment the 30% discount unlocks.',
   '8m', 'lesn_36aPWrKA4T2Brrv0Ugs0lE', 'ad-review',
   true,  false, false, true,
   'Make + ship a static ad based on the briefing video. Submit to #ad-review on Discord. The team manually reviews each submission before approving the 30% discount, so make it count.',
   null),

  ('l050','r3',18,1,'watch',
   '"The Karlo Method"',
   'The income system Karlo built to make money outside of bounties.',
   '1h 5m', 'lesn_4CsHnaOijIPBBj1nWS2x3x', null,
   false, false, true, false, null, null),

  ('l051','r3',18,2,'watch',
   'Become an Affiliate',
   'How affiliate income works + how to set it up for yourself.',
   '14m', 'lesn_6XiqGGfhwMcCwPkOAFYFeu', null,
   false, false, true, false, null, null),

  ('l052','r3',19,1,'watch',
   'Private Marketplace Cheat',
   'Inside access to the private marketplace + how to use it.',
   '21m', 'lesn_50HddY7hENGJdAbLFB5G0w', null,
   false, false, false, false, null, null),

  ('l053','r3',20,1,'watch',
   'Ad Bounties (Insane Passive Income)',
   'Deep dive on the bounty system + the income it produces.',
   '1h 42m', 'lesn_3oQNmkAwT7M1yQ0AL1jXND', null,
   false, false, false, false, null, null),

  -- Creative Strategy (days 21–23). Whop lesson IDs intentionally NULL —
  -- v17 renamed these slots to real Creative Strategy lessons but the
  -- old IDs (lesn_50HddY7… / lesn_3oQNmkAw…) collided with l052 + l053
  -- after v19. Setting NULL is the correct state until Karlo pastes
  -- the real Whop URLs for these three videos.
  ('l054','r3',21,1,'watch',
   'Overview (Creative Strategy Workflow)',
   'How a winning creative strategy actually gets built from scratch.',
   '34m', null, null,
   false, false, false, false, null, null),

  ('l055','r3',22,1,'watch',
   'Market Awareness',
   'The 5 levels of market awareness + how to recognize each in your niche.',
   '24m', null, null,
   false, false, false, false, null, null),

  ('l056','r3',23,1,'watch',
   'Market Sophistication',
   'The 5 levels of market sophistication + how they shape the angle.',
   '18m', null, null,
   false, false, false, false, null, null)
on conflict (id) do update set
  region_id       = excluded.region_id,
  day             = excluded.day,
  sort_order      = excluded.sort_order,
  type            = excluded.type,
  title           = excluded.title,
  description     = excluded.description,
  duration_label  = excluded.duration_label,
  whop_lesson_id  = excluded.whop_lesson_id,
  discord_channel = excluded.discord_channel,
  is_gate         = excluded.is_gate,
  is_boss         = excluded.is_boss,
  is_optional     = excluded.is_optional,
  requires_action = excluded.requires_action,
  action_brief    = excluded.action_brief,
  lesson_group_id = excluded.lesson_group_id;


-- ─── R4 — Gate of Possibilities (Days 24–30) — 7 lessons ───
--    Ad Bounty onboarding + 3 bounty submissions + performance check
--    + weekly call + final reflection (the BOSS).

insert into lessons (
  id, region_id, day, sort_order, type, title, description,
  duration_label, whop_lesson_id, discord_channel,
  is_gate, is_boss, is_optional, requires_action, action_brief, lesson_group_id
) values
  ('l057','r4',24,1,'setup',
   'Complete Ad Bounty Onboarding',
   'Read the bounty brief process. Understand how submissions are judged.',
   '20m', null, 'bounties',
   false, false, false, false, null, null),

  ('l058','r4',25,1,'action',
   'Submit Your First Ad Bounty',
   'Pick a bounty brief. Build it. Submit it. Your first real client work.',
   '3h', null, 'bounties',
   false, false, false, false, null, null),

  ('l059','r4',26,1,'action',
   'Submit Ad Bounty #2',
   'Different brief, different format. Stack up the portfolio.',
   '3h', null, 'bounties',
   false, false, false, false, null, null),

  ('l060','r4',27,1,'action',
   'Submit Ad Bounty #3',
   'Third bounty. Iterate on what''s working from feedback on 1 and 2.',
   '3h', null, 'bounties',
   false, false, false, false, null, null),

  ('l061','r4',28,1,'action',
   'Check Ad Performance Dashboard',
   'See the real numbers your submitted ads produced. This is the scoreboard.',
   '15m', null, null,
   false, false, false, false, null, null),

  ('l062','r4',29,1,'action',
   'Attend Weekly Call',
   'Live weekly call. Bring a question, bring your screen, bring your work.',
   '1h', null, null,
   false, false, false, false, null, null),

  -- ★ THE BOSS — final reflection on day 30 ★
  ('l063','r4',30,1,'action',
   'The Final Reflection',
   'Write down what you learned, what you''ll do next, what you wish you knew on day 1. This is the boss.',
   '20m', null, null,
   false, true,  false, false, null, null)
on conflict (id) do update set
  region_id       = excluded.region_id,
  day             = excluded.day,
  sort_order      = excluded.sort_order,
  type            = excluded.type,
  title           = excluded.title,
  description     = excluded.description,
  duration_label  = excluded.duration_label,
  whop_lesson_id  = excluded.whop_lesson_id,
  discord_channel = excluded.discord_channel,
  is_gate         = excluded.is_gate,
  is_boss         = excluded.is_boss,
  is_optional     = excluded.is_optional,
  requires_action = excluded.requires_action,
  action_brief    = excluded.action_brief,
  lesson_group_id = excluded.lesson_group_id;


-- ─────────────── 4. Sanity-check the result ───────────────
-- The output of these queries should match the comments verbatim.
-- If anything is off, the table is not in canonical state.

-- A) Lesson counts per region
--    expect: r1=18, r2=20, r3=12, r4=7  (total 57)
-- select region_id, count(*) from lessons group by region_id order by region_id;

-- B) The discount gate
--    expect: exactly ONE row, l049, day 17, region r3
-- select id, region_id, day, title, is_gate from lessons where is_gate = true;

-- C) The boss
--    expect: exactly ONE row, l063, day 30, region r4
-- select id, region_id, day, title, is_boss from lessons where is_boss = true;

-- D) Compound action items (require both watch + ship)
--    expect: exactly 5 rows — l018, l020, l022, l024, l049
-- select id, title, requires_action from lessons where requires_action = true order by id;

-- E) Optional lessons (Skip button visible)
--    expect: exactly 2 rows — l050, l051
-- select id, title, is_optional from lessons where is_optional = true order by id;

-- F) Editing breakdowns group
--    expect: exactly 9 rows — l032, l033, l035, l036, l037, l038, l039, l041, l042
-- select id, title from lessons where lesson_group_id = 'editing_breakdowns' order by day, sort_order;

-- G) No duplicate Whop lesson IDs (catches the v19-style bug)
--    expect: ZERO rows
-- select whop_lesson_id, count(*) from lessons
-- where whop_lesson_id is not null
-- group by whop_lesson_id having count(*) > 1;

-- H) Lessons still missing a Whop link
--    expect: every setup/action lesson + l054, l055, l056
-- select id, type, title from lessons where whop_lesson_id is null order by day, sort_order;
