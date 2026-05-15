-- ============================================================
-- v23: CREATIVE STRATEGY LINKS + R4 EXTENSION
--
-- 1. Fill in Whop lesson IDs on l054, l055, l056 (R3 Creative Strategy
--    core trio — they were intentionally NULL in v20 awaiting links).
-- 2. Add 15 new R4 lessons (l064–l078): the rest of the Creative
--    Strategy module on Whop, including two new lessons Karlo added on
--    top of the original screenshot (l077 How Our Brain Works,
--    l078 How I Approach Research / Coming Up With Ad Ideas).
--
-- Day numbers in this file are placeholders. Karlo's plan is to replace
-- the day-based progression with a checkpoint model in a future
-- migration — until then, we keep `day` populated (NOT NULL + check
-- constraint between 1–30) and use sort_order to control display order.
--
-- Layout choice for R4: content lessons get sort_orders 1–3 within
-- each day; existing bounty/action lessons (l057–l063) get bumped to
-- sort_order 10+ on the same day. This keeps content before action in
-- the UI sort (a.day - b.day || a.sort_order - b.sort_order) without
-- moving any lesson to a different day.
--
-- Idempotent: every insert uses ON CONFLICT, every update is
-- whop_lesson_id-targeted and safe to re-run.
-- ============================================================


-- ─────────────── 1. R3 Creative Strategy — fill in links ───────────────

update lessons set whop_lesson_id = 'lesn_1dSTdXVrCqQT9f6wlgNIuz' where id = 'l054';
update lessons set whop_lesson_id = 'lesn_4gnuLlF8ORN8OhchFPvKjI' where id = 'l055';
update lessons set whop_lesson_id = 'lesn_1XASLTKp63klKM5ZyRZuVQ' where id = 'l056';


-- ─────────────── 2. R4 Creative Strategy extension — 15 new lessons ───────────────

insert into lessons (
  id, region_id, day, sort_order, type, title, description,
  duration_label, whop_lesson_id, discord_channel,
  is_gate, is_boss, is_optional, requires_action, action_brief, lesson_group_id
) values
  ('l064','r4',24,1,'watch',
   'How To Do Deep Market Research (With AI)',
   'Use AI to research customers, competitors, and angles at speed. The anchor lesson for the AI block.',
   '1h 11m', 'lesn_YAryyOfnxak3Mx99CogK5', null,
   false, false, false, false, null, null),

  ('l065','r4',24,2,'watch',
   'How To Give Claude Access To Browse The Internet',
   'Set up Claude (claude.ai) so it can browse the web while you research. Short utility lesson.',
   '9m', 'lesn_3wsFwhzVleX6Ov2EjgVBtj', null,
   false, false, false, false, null, null),

  ('l066','r4',25,1,'watch',
   'How To Build "BRAND AI"',
   'Build a custom AI "brain" for each brand you work with, so every output stays on-brand.',
   '34m', 'lesn_787PwImKE3pE0RFeeTdWmZ', null,
   false, false, false, false, null, null),

  ('l067','r4',25,2,'watch',
   'Setting Up Growth Guide + Explanation',
   'Set up the Growth Guide doc that turns brand context into ad ideas.',
   '6m 47s', 'lesn_7zVohMI3bOlj3jYPCElIbH', null,
   false, false, false, false, null, null),

  ('l068','r4',26,1,'watch',
   'Ad Ideas 101: IMITATION',
   'Study winning ads and rebuild them in your own voice. Part 1 of the Ad Ideas 101 trilogy.',
   '31m 39s', 'lesn_5S3P36V1BEPZaaG0cDdind', null,
   false, false, false, false, null, null),

  ('l069','r4',26,2,'watch',
   'Ad Ideas 101: IDEATION',
   'Generate new ad concepts from first principles. Part 2 of the trilogy.',
   '41m', 'lesn_6fkjkgiDITXyGUy0clgqoW', null,
   false, false, false, false, null, null),

  ('l070','r4',26,3,'watch',
   'Ad Ideas 101: ITERATION',
   'Take what is working and push it further. Part 3 of the trilogy.',
   '14m 28s', 'lesn_W7SP1R0VHq9sOCXHJUztQ', null,
   false, false, false, false, null, null),

  ('l071','r4',27,1,'watch',
   'How To Write Copy For Static Ads (With AI)',
   'Write static ad copy with AI, in the brand''s tone.',
   '23m 57s', 'lesn_77FeRqEAVmZNIdidQGHANY', null,
   false, false, false, false, null, null),

  ('l072','r4',27,2,'watch',
   'How To Write Scripts For Video Ads (With AI)',
   'Write video ad scripts with AI, in the brand''s tone.',
   '23m 48s', 'lesn_4l7G9co8p2B7mhGyjHsp9l', null,
   false, false, false, false, null, null),

  ('l073','r4',28,1,'watch',
   'Prompt Engineering (How to communicate with AI)',
   'How to actually communicate with AI so it produces useful work instead of generic output.',
   '33m 56s', 'lesn_5Ou5AChQpLaB5a4TtKlHJE', null,
   false, false, false, false, null, null),

  ('l074','r4',28,2,'watch',
   'The Feedback Loop (Ad Learnings)',
   'Turn ad results back into the next round of better ads.',
   '19m 24s', 'lesn_3aRJDypYaxZkvMy0MH3kvc', null,
   false, false, false, false, null, null),

  ('l075','r4',29,1,'watch',
   'Breaking Down Winning Ads: PART 1',
   'Frame-by-frame analysis of ads that win. First in a series.',
   '22m 20s', 'lesn_2y522txfWzhKd9fuFFU9oG', null,
   false, false, false, false, null, null),

  ('l076','r4',29,2,'watch',
   'How I Turned A Losing Ad Into A Winning Ad',
   'Walkthrough of taking a losing ad and turning it into a winning one.',
   '55m 42s', 'lesn_6j3WiSRVEVnJtriVYIctCO', null,
   false, false, false, false, null, null),

  ('l077','r4',30,1,'watch',
   'How Our Brain Works',
   'The cognitive principles behind why ads land — what your brain is actually responding to.',
   null, 'lesn_31GlKNwmZ4O53hdUe1EgcX', null,
   false, false, false, false, null, null),

  ('l078','r4',30,2,'watch',
   'How I Approach Research / Coming Up With Ad Ideas',
   'Karlo''s personal research process for generating ad ideas from scratch.',
   null, 'lesn_6vYbh7SckffXdLurCPty4o', null,
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


-- ─────────────── 3. Bump existing R4 bounty/action lessons to sort_order 10+ ───────────────
-- So that the new content lessons (sort 1–3) display before the action items
-- within each day. Days stay the same, only sort_order changes.

update lessons set sort_order = 10 where id = 'l057';  -- day 24, was sort 1
update lessons set sort_order = 10 where id = 'l058';  -- day 25, was sort 1
update lessons set sort_order = 10 where id = 'l059';  -- day 26, was sort 1
update lessons set sort_order = 10 where id = 'l060';  -- day 27, was sort 1
update lessons set sort_order = 10 where id = 'l061';  -- day 28, was sort 1
update lessons set sort_order = 10 where id = 'l062';  -- day 29, was sort 1
update lessons set sort_order = 10 where id = 'l063';  -- day 30, was sort 1


-- ─────────────── 4. Sanity-check ───────────────

-- A) R4 should now have 22 lessons (7 original + 15 new)
-- select count(*) from lessons where region_id = 'r4';

-- B) The three R3 Creative Strategy lessons should have non-null whop_lesson_ids
-- select id, title, whop_lesson_id from lessons where id in ('l054','l055','l056');

-- C) No duplicate Whop lesson IDs
-- select whop_lesson_id, count(*) from lessons
-- where whop_lesson_id is not null group by whop_lesson_id having count(*) > 1;

-- D) Lessons still missing a duration (expect l077, l078 — pending from Karlo)
-- select id, title, duration_label from lessons where duration_label is null;
