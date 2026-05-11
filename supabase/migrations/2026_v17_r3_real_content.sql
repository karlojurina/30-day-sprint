-- ============================================================
-- v17: Replace R3 placeholder lessons with the real Whop content.
--
-- Old R3:  Engage Feedback + Static Ad action + "Strategy Lesson 1–9"
--          + Job Board action  (12 lessons, mostly placeholder names)
--
-- New R3:  12 lessons in three blocks (per Karlo's Whop screenshots):
--            Static Ads         (5 lessons, days 15–17)
--            Money Making       (4 lessons, days 18–20)
--            Creative Strategy  (3 lessons, days 21–23)
--
-- Only title / description / duration_label / type / is_gate / day /
-- sort_order are changed. whop_lesson_id stays exactly as-is —
-- those links are already correct per Karlo (clicking a lesson on
-- the site plays the right Whop video). No deletes, so existing
-- student progress rows keep their FK and don't cascade-delete.
--
-- is_gate moves from l046 → l049 ("Action Item: Static Ads") so the
-- discount-claim CTA fires on the new "ship a static ad" moment,
-- not on a 3-minute safezone video. Update DISCOUNT_GATE_LESSON_ID
-- in src/lib/constants.ts to match.
-- ============================================================

-- ─────────────── Static Ads (days 15–17) ───────────────

update lessons set
  title = 'The Art Of 1 Frame',
  description = 'How to make a single static frame do the work of a 30-second ad.',
  duration_label = '29m',
  type = 'watch',
  is_gate = false,
  day = 15,
  sort_order = 1
where id = 'l045';

update lessons set
  title = 'Static Ad Safezone Guidelines',
  description = 'Where your eye + thumb naturally land. Design inside the safe zones.',
  duration_label = '3m',
  type = 'watch',
  is_gate = false,
  day = 15,
  sort_order = 2
where id = 'l046';

update lessons set
  title = 'My Tech Stack For Doing Static Ads',
  description = 'The exact apps + plugins Karlo uses for every static.',
  duration_label = '15m',
  type = 'watch',
  is_gate = false,
  day = 16,
  sort_order = 1
where id = 'l047';

update lessons set
  title = 'Static Ad Templates + LIVE Example',
  description = 'Walk-through of the template files + a live build of one ad.',
  duration_label = '13m',
  type = 'watch',
  is_gate = false,
  day = 16,
  sort_order = 2
where id = 'l048';

update lessons set
  title = 'Action Item: Static Ads',
  description = 'Ship a static ad. Submit to #ad-review. This is the moment the 30% discount unlocks.',
  duration_label = '8m',
  type = 'action',
  is_gate = true,
  day = 17,
  sort_order = 1
where id = 'l049';

-- ─────────────── Money Making Methods (days 18–20) ───────────────

update lessons set
  title = '"The Karlo Method"',
  description = 'The income system Karlo built to make money outside of bounties.',
  duration_label = '1h 5m',
  type = 'watch',
  is_gate = false,
  day = 18,
  sort_order = 1
where id = 'l050';

update lessons set
  title = 'Become an Affiliate',
  description = 'How affiliate income works + how to set it up for yourself.',
  duration_label = '14m',
  type = 'watch',
  is_gate = false,
  day = 18,
  sort_order = 2
where id = 'l051';

update lessons set
  title = 'Private Marketplace Cheat',
  description = 'Inside access to the private marketplace + how to use it.',
  duration_label = '21m',
  type = 'watch',
  is_gate = false,
  day = 19,
  sort_order = 1
where id = 'l052';

update lessons set
  title = 'Ad Bounties (Insane Passive Income)',
  description = 'Deep dive on the bounty system + the income it produces.',
  duration_label = '1h 42m',
  type = 'watch',
  is_gate = false,
  day = 20,
  sort_order = 1
where id = 'l053';

-- ─────────────── Creative Strategy (days 21–23) ───────────────

update lessons set
  title = 'Overview (Creative Strategy Workflow)',
  description = 'How a winning creative strategy actually gets built from scratch.',
  duration_label = '34m',
  type = 'watch',
  is_gate = false,
  day = 21,
  sort_order = 1
where id = 'l054';

update lessons set
  title = 'Market Awareness',
  description = 'The 5 levels of market awareness + how to recognize each in your niche.',
  duration_label = '24m',
  type = 'watch',
  is_gate = false,
  day = 22,
  sort_order = 1
where id = 'l055';

update lessons set
  title = 'Market Sophistication',
  description = 'The 5 levels of market sophistication + how they shape the angle.',
  duration_label = '18m',
  type = 'watch',
  is_gate = false,
  day = 23,
  sort_order = 1
where id = 'l056';

-- ─────────────── Verification queries ───────────────
-- select id, day, sort_order, type, is_gate, duration_label, title
-- from lessons where region_id = 'r3' order by day, sort_order;
-- -- expect: 12 rows, days 15→23, one is_gate=true on l049,
-- -- title strings = the new content above.
