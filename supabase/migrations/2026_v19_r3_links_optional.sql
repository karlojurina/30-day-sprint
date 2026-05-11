-- ============================================================
-- v19: Finish R3 Whop links + add is_optional column
--
-- Karlo pasted the remaining Whop URLs for R3 lessons. Map:
--   l047  My Tech Stack For Doing Static Ads → lesn_5HT44WU6…
--   l048  Static Ad Templates + LIVE Example  → lesn_7Gm3cibPk…
--   l049  Action Item: Static Ads (briefing)  → lesn_36aPWrKA4…
--   l050  The Karlo Method                    → lesn_4CsHnaOij…
--   l051  Become an Affiliate                 → lesn_6XiqGGfh…
--   l052  Private Marketplace Cheat           → lesn_50HddY7h…
--   l053  Ad Bounties (Insane Passive Income) → lesn_3oQNmkAw…
--
-- Plus: l050 + l051 are not mandatory. New `is_optional` boolean
-- column tells the LessonSheet to render a "Skip" button alongside
-- the normal Watch / Mark complete options. Skipping marks the
-- lesson via the existing skipped_at column, so path advancement
-- works naturally (completedLessonIds includes skipped rows).
-- ============================================================

-- ─── New column ───

alter table lessons
  add column if not exists is_optional boolean not null default false;

-- ─── Whop link updates (l047 → l053) ───

update lessons set whop_lesson_id = 'lesn_5HT44WU6d8paaIERpt1lEP'
  where id = 'l047';

update lessons set whop_lesson_id = 'lesn_7Gm3cibPk7yES3VTuANtAA'
  where id = 'l048';

-- l049 is a compound action item — whop_lesson_id is the BRIEFING
-- video the student watches before shipping. The action half is the
-- manual "I shipped the ad" checkbox in the lesson sheet.
update lessons set whop_lesson_id = 'lesn_36aPWrKA4T2Brrv0Ugs0lE'
  where id = 'l049';

update lessons set
  whop_lesson_id = 'lesn_4CsHnaOijIPBBj1nWS2x3x',
  is_optional = true
where id = 'l050';

update lessons set
  whop_lesson_id = 'lesn_6XiqGGfhwMcCwPkOAFYFeu',
  is_optional = true
where id = 'l051';

update lessons set whop_lesson_id = 'lesn_50HddY7hENGJdAbLFB5G0w'
  where id = 'l052';

update lessons set whop_lesson_id = 'lesn_3oQNmkAwT7M1yQ0AL1jXND'
  where id = 'l053';

-- ─── Verification ───
-- select id, day, sort_order, type, requires_action, is_optional,
--        is_gate, duration_label, whop_lesson_id, title
-- from lessons where region_id = 'r3'
-- order by day, sort_order;
--
-- Expect all 12 R3 lessons to have whop_lesson_id set.
-- l049 should have requires_action=true and is_gate=true.
-- l050 + l051 should have is_optional=true.
