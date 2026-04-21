-- ============================================================
-- V3: Seed 4 regions + 33 lessons
-- Run AFTER 2026_v3_expedition_restructure.sql
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- Regions
-- ────────────────────────────────────────────────────────────
insert into regions (id, order_num, name, subtitle, tagline, terrain, days_label, day_start, day_end, is_discount_gate) values
  ('r1', 1, 'Base Camp',    'Foundations',          'Get your bearings. Learn the fundamentals.', 'shore',     'Days 1–8',   1,  8,  false),
  ('r2', 2, 'Creative Lab', 'First Ads',            'Build and ship your first ads.',             'forest',    'Days 9–15',  9,  15, true),
  ('r3', 3, 'Test Track',   'Strategy + Editing',   'Sharpen the stack. Think like a director.',  'mountains', 'Days 16–23', 16, 23, false),
  ('r4', 4, 'The Market',   'Bounties + Scale',     'Real briefs. Real money. Real work.',        'city',      'Days 24–30', 24, 30, false);

-- ────────────────────────────────────────────────────────────
-- R1 — Base Camp (Days 1–8) · 10 lessons
-- ────────────────────────────────────────────────────────────
insert into lessons (id, region_id, day, type, title, description, duration_label, is_gate, is_boss, sort_order) values
('l1',  'r1', 1,  'setup',  'Connect your Whop account',                 'One-click auth. Do this once and you''re in.', '2m',  false, false, 1),
('l2',  'r1', 1,  'watch',  'Welcome to the Sprint',                     'Karlo walks you through the 30-day plan.',     '8m',  false, false, 2),
('l3',  'r1', 2,  'action', 'Pick your niche',                           'Write down the product or niche you want to create ads for.', '15m', false, false, 1),
('l4',  'r1', 2,  'watch',  'Why great ads sell',                        'The psychology of a winning ad, in plain English.', '12m', false, false, 2),
('l5',  'r1', 3,  'watch',  'The Hook, the Problem, the Solution',       'The loop behind 90% of ads that work.',        '14m', false, false, 1),
('l6',  'r1', 4,  'watch',  'Anatomy of a hook',                         'Stopping the scroll in the first 1.5 seconds.', '11m', false, false, 1),
('l7',  'r1', 5,  'watch',  'Finding winning ad inspiration',            'Where to look, what to save, how to steal like an artist.', '10m', false, false, 1),
('l8',  'r1', 6,  'action', 'Build a swipe file of 10 ads',              'Drop them in Discord #swipe-file. Quality over speed.', '30m', false, false, 1),
('l9',  'r1', 7,  'watch',  'Brand voice 101',                           'Why your niche has a voice, and how to hear it.', '9m',  false, false, 1),
('l10', 'r1', 8,  'action', 'Write your niche brief',                    'One page. Audience, promise, tone. Pinned to your notebook.', '20m', false, false, 1);

-- ────────────────────────────────────────────────────────────
-- R2 — Creative Lab (Days 9–15) · 8 lessons · ends with DISCOUNT GATE
-- ────────────────────────────────────────────────────────────
insert into lessons (id, region_id, day, type, title, description, duration_label, is_gate, is_boss, sort_order) values
('l11', 'r2', 9,  'watch',  'Scripting your first ad',                   'Templates, live examples, common mistakes.',   '18m', false, false, 1),
('l12', 'r2', 10, 'watch',  'UGC vs. scripted — when to use what',       'A quick mental model for choosing format.',     '10m', false, false, 1),
('l13', 'r2', 10, 'action', 'Storyboard Ad #1',                          'Sketch it on paper first. Post in #storyboards.', '25m', false, false, 2),
('l14', 'r2', 11, 'watch',  'Shooting on your phone',                    'Framing, light, audio. No gear required.',      '14m', false, false, 1),
('l15', 'r2', 12, 'action', 'Ship Ad #1',                                'Write, shoot, export. Post to #ad-review.',     '2h',  false, false, 1),
('l16', 'r2', 13, 'watch',  'Writing a second angle',                    'One product, three angles. Pick the strongest.', '12m', false, false, 1),
('l17', 'r2', 14, 'action', 'Storyboard Ad #2',                          'Different format this time. Same rigor.',       '25m', false, false, 1),
('l18', 'r2', 15, 'action', 'Ship Ad #2 — Discount unlocked',            'Post to #ad-review. This one unlocks your 30% off.', '2h', true, false, 1);

-- ────────────────────────────────────────────────────────────
-- R3 — Test Track (Days 16–23) · 8 lessons
-- ────────────────────────────────────────────────────────────
insert into lessons (id, region_id, day, type, title, description, duration_label, is_gate, is_boss, sort_order) values
('l19', 'r3', 16, 'watch',  'CapCut part 1 — cuts, zooms, b-roll',       'The building blocks of an edit.',               '22m', false, false, 1),
('l20', 'r3', 17, 'watch',  'CapCut part 2 — captions & pacing',         'Where bad ads go to become good ones.',         '18m', false, false, 1),
('l21', 'r3', 18, 'watch',  'Sound design — music, SFX, voice',          'The layer 90% of creators ignore.',             '12m', false, false, 1),
('l22', 'r3', 19, 'action', 'Remake Ad #1 with what you learned',        'Post the before/after. Show the work.',         '1h',  false, false, 1),
('l23', 'r3', 20, 'watch',  'Thinking in angles',                        'How creative directors decompose any brief.',   '15m', false, false, 1),
('l24', 'r3', 21, 'watch',  'Reading ad performance data',               'ROAS, CTR, hook rate — what matters and why.',  '20m', false, false, 1),
('l25', 'r3', 22, 'action', 'Brief decomposition drill',                 'Given a fake brief, write 3 distinct ad angles.', '30m', false, false, 1),
('l26', 'r3', 23, 'watch',  'How winning ads get measured',              'The metrics that separate hobbyists from pros.', '14m', false, false, 1);

-- ────────────────────────────────────────────────────────────
-- R4 — The Market (Days 24–30) · 7 lessons · ends with BOSS
-- ────────────────────────────────────────────────────────────
insert into lessons (id, region_id, day, type, title, description, duration_label, is_gate, is_boss, sort_order) values
('l27', 'r4', 24, 'watch',  'How to apply for work',                     'DM templates, portfolios, rates, red flags.',   '10m', false, false, 1),
('l28', 'r4', 25, 'action', 'Build your portfolio doc',                  'Assembled from your Week 1–2 ads. Make it proud.', '45m', false, false, 1),
('l29', 'r4', 26, 'action', 'Apply to 3 job-board posts',                'Post your applications. Karma says they reply.', '30m', false, false, 1),
('l30', 'r4', 27, 'watch',  'What is a bounty?',                         'The real-money side of EcomTalent.',            '8m',  false, false, 1),
('l31', 'r4', 28, 'watch',  'How winning bounty entries think',          'Case studies of bounties that got picked.',     '12m', false, false, 1),
('l32', 'r4', 29, 'action', 'Submit your first bounty',                  'A real client brief. Real spend if you''re selected.', '3h', false, false, 1),
('l33', 'r4', 30, 'action', 'The Final Reflection',                      'Prove you earned the title. Answer five questions.', '15m', false, true, 1);
