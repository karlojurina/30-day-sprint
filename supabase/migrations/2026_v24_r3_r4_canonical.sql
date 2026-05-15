-- ============================================================
-- v24: CANONICAL R3 + R4 (post-redesign)
--
-- Karlo redesigned R3 and R4 on 2026-05-15. R1 and R2 are unchanged
-- from v20. This migration:
--   1. Deletes l051 ("Become an Affiliate") — dropped from the curriculum.
--   2. Moves l064 ("How To Do Deep Market Research (With AI)") from R4
--      into R3 (now the closer of R3, after the Creative Strategy trio).
--   3. Re-orders every R3 and R4 lesson via region_id + sort_order so
--      the dashboard renders them in the new canonical order.
--   4. Leaves the discount gate on l049 and the boss on l063.
--
-- New canonical ordering:
--
--   R3 — Production (12 lessons)
--     1.  l045  The Art Of 1 Frame
--     2.  l046  Static Ad Safezone Guidelines
--     3.  l047  My Tech Stack For Doing Static Ads
--     4.  l048  Static Ad Templates + LIVE Example
--     5.  l049  Action Item: Static Ads          ★ DISCOUNT GATE
--     6.  l050  "The Karlo Method"
--     7.  l052  Private Marketplace Cheat
--     8.  l053  Ad Bounties (Insane Passive Income)
--     9.  l054  Overview (Creative Strategy Workflow)
--    10.  l055  Market Awareness
--    11.  l056  Market Sophistication
--    12.  l064  How To Do Deep Market Research (With AI)
--
--   R4 — Gate of Possibilities (21 lessons)
--     1.  l065  How To Give Claude Access To Browse The Internet
--     2.  l066  How To Build "BRAND AI"
--     3.  l067  Setting Up Growth Guide + Explanation
--     4.  l068  Ad Ideas 101: IMITATION
--     5.  l069  Ad Ideas 101: IDEATION
--     6.  l070  Ad Ideas 101: ITERATION
--     7.  l071  How To Write Copy For Static Ads (With AI)
--     8.  l072  How To Write Scripts For Video Ads (With AI)
--     9.  l073  Prompt Engineering
--    10.  l074  The Feedback Loop (Ad Learnings)
--    11.  l075  Breaking Down Winning Ads: PART 1
--    12.  l076  How I Turned A Losing Ad Into A Winning Ad
--    13.  l077  How Our Brain Works
--    14.  l078  How I Approach Research / Coming Up With Ad Ideas
--    15.  l057  Complete Ad Bounty Onboarding
--    16.  l058  Submit Your First Ad Bounty
--    17.  l059  Submit Ad Bounty #2
--    18.  l060  Submit Ad Bounty #3
--    19.  l061  Check Ad Performance Dashboard
--    20.  l062  Attend Weekly Call
--    21.  l063  The Final Reflection                 ★ BOSS
--
-- The `day` column is still NOT NULL with check(day between 1 and 30),
-- so this migration spreads days across the R3 (15–23) and R4 (24–30)
-- windows. Day labels in the UI will be replaced with the checkpoint
-- model in a future migration — until then, sort_order is the
-- authoritative order. UI already sorts by (day, sort_order).
--
-- Idempotent — every row uses ON CONFLICT, deletes are id-targeted.
-- ============================================================


-- ─────────────── 1. Retire l051 ───────────────

delete from student_lesson_completions where lesson_id = 'l051';
delete from lessons where id = 'l051';


-- ─────────────── 2. R3 — Production (12 lessons) ───────────────

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
   false, false, false, false, null, null),

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

  ('l054','r3',21,1,'watch',
   'Overview (Creative Strategy Workflow)',
   'How a winning creative strategy actually gets built from scratch.',
   '34m', 'lesn_1dSTdXVrCqQT9f6wlgNIuz', null,
   false, false, false, false, null, null),

  ('l055','r3',22,1,'watch',
   'Market Awareness',
   'The 5 levels of market awareness + how to recognize each in your niche.',
   '24m', 'lesn_4gnuLlF8ORN8OhchFPvKjI', null,
   false, false, false, false, null, null),

  ('l056','r3',23,1,'watch',
   'Market Sophistication',
   'The 5 levels of market sophistication + how they shape the angle.',
   '18m', 'lesn_1XASLTKp63klKM5ZyRZuVQ', null,
   false, false, false, false, null, null),

  ('l064','r3',23,2,'watch',
   'How To Do Deep Market Research (With AI)',
   'Use AI to research customers, competitors, and angles at speed. The anchor lesson for the AI block.',
   '1h 11m', 'lesn_YAryyOfnxak3Mx99CogK5', null,
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


-- ─────────────── 3. R4 — Gate of Possibilities (21 lessons) ───────────────

insert into lessons (
  id, region_id, day, sort_order, type, title, description,
  duration_label, whop_lesson_id, discord_channel,
  is_gate, is_boss, is_optional, requires_action, action_brief, lesson_group_id
) values
  ('l065','r4',24,1,'watch',
   'How To Give Claude Access To Browse The Internet',
   'Set up Claude (claude.ai) so it can browse the web while you research. Short utility lesson.',
   '9m', 'lesn_3wsFwhzVleX6Ov2EjgVBtj', null,
   false, false, false, false, null, null),

  ('l066','r4',24,2,'watch',
   'How To Build "BRAND AI"',
   'Build a custom AI "brain" for each brand you work with, so every output stays on-brand.',
   '34m', 'lesn_787PwImKE3pE0RFeeTdWmZ', null,
   false, false, false, false, null, null),

  ('l067','r4',24,3,'watch',
   'Setting Up Growth Guide + Explanation',
   'Set up the Growth Guide doc that turns brand context into ad ideas.',
   '6m 47s', 'lesn_7zVohMI3bOlj3jYPCElIbH', null,
   false, false, false, false, null, null),

  ('l068','r4',25,1,'watch',
   'Ad Ideas 101: IMITATION',
   'Study winning ads and rebuild them in your own voice. Part 1 of the Ad Ideas 101 trilogy.',
   '31m 39s', 'lesn_5S3P36V1BEPZaaG0cDdind', null,
   false, false, false, false, null, null),

  ('l069','r4',25,2,'watch',
   'Ad Ideas 101: IDEATION',
   'Generate new ad concepts from first principles. Part 2 of the trilogy.',
   '41m', 'lesn_6fkjkgiDITXyGUy0clgqoW', null,
   false, false, false, false, null, null),

  ('l070','r4',25,3,'watch',
   'Ad Ideas 101: ITERATION',
   'Take what is working and push it further. Part 3 of the trilogy.',
   '14m 28s', 'lesn_W7SP1R0VHq9sOCXHJUztQ', null,
   false, false, false, false, null, null),

  ('l071','r4',26,1,'watch',
   'How To Write Copy For Static Ads (With AI)',
   'Write static ad copy with AI, in the brand''s tone.',
   '23m 57s', 'lesn_77FeRqEAVmZNIdidQGHANY', null,
   false, false, false, false, null, null),

  ('l072','r4',26,2,'watch',
   'How To Write Scripts For Video Ads (With AI)',
   'Write video ad scripts with AI, in the brand''s tone.',
   '23m 48s', 'lesn_4l7G9co8p2B7mhGyjHsp9l', null,
   false, false, false, false, null, null),

  ('l073','r4',26,3,'watch',
   'Prompt Engineering (How to communicate with AI)',
   'How to actually communicate with AI so it produces useful work instead of generic output.',
   '33m 56s', 'lesn_5Ou5AChQpLaB5a4TtKlHJE', null,
   false, false, false, false, null, null),

  ('l074','r4',27,1,'watch',
   'The Feedback Loop (Ad Learnings)',
   'Turn ad results back into the next round of better ads.',
   '19m 24s', 'lesn_3aRJDypYaxZkvMy0MH3kvc', null,
   false, false, false, false, null, null),

  ('l075','r4',27,2,'watch',
   'Breaking Down Winning Ads: PART 1',
   'Frame-by-frame analysis of ads that win. First in a series.',
   '22m 20s', 'lesn_2y522txfWzhKd9fuFFU9oG', null,
   false, false, false, false, null, null),

  ('l076','r4',27,3,'watch',
   'How I Turned A Losing Ad Into A Winning Ad',
   'Walkthrough of taking a losing ad and turning it into a winning one.',
   '55m 42s', 'lesn_6j3WiSRVEVnJtriVYIctCO', null,
   false, false, false, false, null, null),

  ('l077','r4',28,1,'watch',
   'How Our Brain Works',
   'The cognitive principles behind why ads land — what your brain is actually responding to.',
   null, 'lesn_31GlKNwmZ4O53hdUe1EgcX', null,
   false, false, false, false, null, null),

  ('l078','r4',28,2,'watch',
   'How I Approach Research / Coming Up With Ad Ideas',
   'Karlo''s personal research process for generating ad ideas from scratch.',
   null, 'lesn_6vYbh7SckffXdLurCPty4o', null,
   false, false, false, false, null, null),

  ('l057','r4',28,3,'setup',
   'Complete Ad Bounty Onboarding',
   'Read the bounty brief process. Understand how submissions are judged.',
   '20m', null, 'bounties',
   false, false, false, false, null, null),

  ('l058','r4',29,1,'action',
   'Submit Your First Ad Bounty',
   'Pick a bounty brief. Build it. Submit it. Your first real client work.',
   '3h', null, 'bounties',
   false, false, false, false, null, null),

  ('l059','r4',29,2,'action',
   'Submit Ad Bounty #2',
   'Different brief, different format. Stack up the portfolio.',
   '3h', null, 'bounties',
   false, false, false, false, null, null),

  ('l060','r4',29,3,'action',
   'Submit Ad Bounty #3',
   'Third bounty. Iterate on what''s working from feedback on 1 and 2.',
   '3h', null, 'bounties',
   false, false, false, false, null, null),

  ('l061','r4',30,1,'action',
   'Check Ad Performance Dashboard',
   'See the real numbers your submitted ads produced. This is the scoreboard.',
   '15m', null, null,
   false, false, false, false, null, null),

  ('l062','r4',30,2,'action',
   'Attend Weekly Call',
   'Live weekly call. Bring a question, bring your screen, bring your work.',
   '1h', null, null,
   false, false, false, false, null, null),

  -- ★ THE BOSS ★
  ('l063','r4',30,3,'action',
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


-- ─────────────── 4. Sanity checks ───────────────

-- A) Region counts — expect r1=18, r2=20, r3=12, r4=21 (total 71)
-- select region_id, count(*) from lessons group by region_id order by region_id;

-- B) Discount gate — expect exactly l049
-- select id, title from lessons where is_gate;

-- C) Boss — expect exactly l063
-- select id, title from lessons where is_boss;

-- D) l051 fully removed
-- select count(*) from lessons where id = 'l051';

-- E) l064 lives in R3 now
-- select region_id, day, sort_order from lessons where id = 'l064';

-- F) New R3 order (12 rows in this exact sequence)
-- select id, sort_order, day, title from lessons
-- where region_id = 'r3' order by day, sort_order;

-- G) New R4 order (21 rows, content first then bounty arc, l063 last)
-- select id, sort_order, day, title from lessons
-- where region_id = 'r4' order by day, sort_order;
