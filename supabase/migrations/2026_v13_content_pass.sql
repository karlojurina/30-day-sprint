-- ============================================================
-- v13: Content pass — Region 1 cleanup + Region 2 video disclaimer
--
-- Changes per Karlo's review of the live product:
--
-- Region 1:
--   - l001 (Join Discord) — append the optional "say hi" hint
--   - l006 (Set Up Weekly Calls) — DELETE entirely (out of scope)
--   - l012 (Post Your Discord Intro) — DELETE entirely
--   - l018 (Action Item: Organic Ads) — better description
--   - l020 (Action Item: UGC Ad) — better description
--
-- Region 2:
--   - l032 (Editing Breakdowns Intro) — prepend the "optional but
--     extremely important" disclaimer so students don't skip without
--     understanding the cost.
--
-- Deleted rows are mirrored into a `lessons_archive` table first so
-- we can recover the content if Karlo changes his mind. Cascade on
-- student_lesson_completions removes any progress students had on
-- the deleted lessons (acceptable — those tasks no longer exist).
-- ============================================================

-- 1. Archive table (idempotent — only created once)
create table if not exists lessons_archive as
  select * from lessons where 1 = 0;

alter table lessons_archive
  add column if not exists archived_at timestamptz default now();

alter table lessons_archive
  add column if not exists archived_reason text;

-- 2. Snapshot the rows we're about to delete
insert into lessons_archive
  select l.*, now() as archived_at, 'v13 content pass' as archived_reason
  from lessons l
  where l.id in ('l006', 'l012')
  on conflict do nothing;

-- 3. Delete the two retired tasks
delete from lessons where id in ('l006', 'l012');

-- 4. l001 — append optional intro hint
update lessons
set description = 'Join the EcomTalent Discord, verify via Whop, and say hi in #general. (Optional: introduce yourself in the chat — share your niche, your goal, or just a wave.)'
where id = 'l001';

-- 5. l018 — Action Item: Organic Ads — better description
-- TODO(Karlo): final copy review
update lessons
set description = 'Now apply what you''ve learned. Pick a product (yours, a friend''s, or a public brand you admire) and create one organic-style ad — feels-like-content, no obvious sales pitch. Submit it to #ad-review with a one-line note about who it''s targeting and what reaction you expect. The team reviews everything.'
where id = 'l018';

-- 6. l020 — Action Item: UGC Ad — better description
-- TODO(Karlo): final copy review
update lessons
set description = 'Make a UGC-style ad: lo-fi, authentic, like a real customer talking to camera. Use your phone — no studio. Aim for 15–30 seconds. Submit to #ad-review with a note on the angle you''re testing. Reviewing your own ad against the briefing is half the learning.'
where id = 'l020';

-- 7. l032 — Editing Breakdowns Intro — prepend the disclaimer
update lessons
set description = 'IMPORTANT: the breakdowns that follow are technically optional, but they''re the saucy, lengthy parts of the program — a couple of hours total across all parts. If you''re aiming for momentum and want to skip them for now to keep moving, you can — but you''ll definitely need to come back later, because this is where the craft lives.

' || 'Why we study edits frame-by-frame. What you''ll get out of the breakdowns.'
where id = 'l032';
