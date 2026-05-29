-- v74 — Rewrite action-item lesson descriptions in Karlo's voice +
-- promote l049 to compound (it had whop_lesson_id but type='action',
-- which hid the video link in the LessonSheet).
--
-- Karlo flagged these during the second pre-launch sweep:
--   • "make an organic style ad ... based on what you watched" — wrong,
--     it's based on the brief, not the watched video.
--   • "Make a UGC-style ad: hold the camera yourself" — we never ask
--     students to film. They build ads from the brief.
--   • Static Ads description mentioned the 30% discount, which is
--     load-bearing on l046/l049 GATE copy but doesn't belong in the
--     action description.
--   • l049 lesson sheet missing the video play button because
--     `type='action'` falls outside the LessonSheet's `showWatchCard`
--     branch (compound = type='watch' + requires_action=true).
--
-- Idempotent. All these lessons exist post-v20 / v24.

-- l018 — Action Item: Organic Ads (R1, compound).
update lessons set
  description =
    'Make ads based on the brief. Organic style means it should feel '
    || 'natural — like the person in the video filmed it themselves. '
    || 'Unpolished, simple, no studio. Submit to #ad-review.',
  action_brief =
    'Make an organic-style ad based on the brief. Feels like content, '
    || 'not a polished spot. Submit to #ad-review.'
where id = 'l018';

-- l020 — Action Item: UGC Ad (R1, compound).
update lessons set
  description =
    'Make ads based on the brief. UGC style — feels like a real customer '
    || 'talking to camera. Authentic, low-production, conversational. '
    || 'Submit to #ad-review.',
  action_brief =
    'Make a UGC-style ad based on the brief. Authentic, low-production. '
    || 'Submit to #ad-review.'
where id = 'l020';

-- l022 — Action Item: VSL Ad (R2, compound).
update lessons set
  description =
    'Make ads based on the brief. This is a VSL — Video Sales Letter, '
    || 'long-form. Problem, agitation, solution. Submit to #ad-review.',
  action_brief =
    'Make a VSL ad based on the brief. Long-form: problem → agitation → '
    || 'solution. Submit to #ad-review.'
where id = 'l022';

-- l024 — Action Item: High-Production Ad (R2, compound).
update lessons set
  description =
    'Make ads based on the brief. High production means proper lighting, '
    || 'sound, and edit. Make the brand look premium. Submit to #ad-review.',
  action_brief =
    'Ship a high-production ad based on the brief. Submit to #ad-review.'
where id = 'l024';

-- l049 — Action Item: Static Ads (R3, DISCOUNT GATE).
-- (1) Rewrite the copy (drop the 30%-discount mention from the
--     description; keep the gate behaviour elsewhere).
-- (2) Promote from type='action' to compound (watch + requires_action)
--     so the LessonSheet renders the play button. The lesson has had
--     whop_lesson_id since v20 — the type was the only thing hiding it.
update lessons set
  type = 'watch',
  requires_action = true,
  description =
    'Make ads based on the brief. Static means image only — no video. '
    || 'Submit to #ad-review.',
  action_brief =
    'Ship a static image ad based on the brief. Submit to #ad-review.'
where id = 'l049';

-- Quick verification (run by hand after deploy):
--   select id, type, requires_action, title from lessons where id in
--     ('l018','l020','l022','l024','l049') order by id;
