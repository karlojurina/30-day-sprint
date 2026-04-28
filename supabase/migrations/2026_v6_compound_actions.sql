-- ============================================================
-- v6: Compound action lessons + Region 1/2 boundary fix
--
-- Changes:
-- 1. Add `requires_action` boolean + `action_brief` text to lessons
-- 2. Add `action_completed_at` to student_lesson_completions
-- 3. Mark the 4 briefing lessons (Organic, UGC, VSL, High-Prod) as
--    compound — each requires BOTH watching the briefing AND shipping
--    the ad.
-- 4. Delete the 4 redundant "Ship Your X" lessons (their function moves
--    to the compound briefing lessons' action half).
-- 5. Move VSLs / VSL Action / High-Prod / High-Prod Action / Hooks from
--    Region 1 to Region 2 — Region 2 now starts at VSLs.
-- 6. Adjust region day_start/day_end to match the new boundary.
-- ============================================================

-- 1. Schema additions
alter table lessons
  add column if not exists requires_action boolean not null default false,
  add column if not exists action_brief text;

alter table student_lesson_completions
  add column if not exists action_completed_at timestamptz;

create index if not exists idx_lessons_requires_action
  on lessons(requires_action) where requires_action = true;

-- 2. Mark the 4 briefing lessons as compound + give them action briefs
update lessons
set
  requires_action = true,
  description = 'Watch the briefing video, then ship the ad. Both required to mark this complete.',
  action_brief = 'Make an organic-style ad based on what you watched. Lo-fi, "feels like content" feel — not a polished spot. Submit to #ad-review on Discord and tag the coach. Target: Day 3-4.'
where id = 'l018';

update lessons
set
  requires_action = true,
  description = 'Watch the briefing, then ship a UGC ad. Both required.',
  action_brief = 'Make a UGC-style ad. Hold the camera yourself, talk to it, focus on conversion. Submit to #ad-review on Discord. Back-to-back with your organic — don''t wait.'
where id = 'l020';

update lessons
set
  requires_action = true,
  description = 'Watch the briefing, then ship a VSL. Both required.',
  action_brief = 'Script + record + edit a VSL. Long-form, problem→agitation→solution. Hardest format, highest earning potential. Submit to #ad-review.'
where id = 'l022';

update lessons
set
  requires_action = true,
  description = 'Watch the briefing, then ship a high-production ad. Both required.',
  action_brief = 'Plan + shoot + edit a high-production ad with proper lighting and sound. This is where you learn to make brands look premium. Submit to #ad-review.'
where id = 'l024';

-- 3. Delete the 4 redundant "Ship Your X" lessons. Cascades remove any
--    test completions tied to them. (Real students re-ship via the
--    compound lessons' action sub-task.)
delete from student_lesson_completions
  where lesson_id in ('l034','l040','l043','l044');
delete from lessons
  where id in ('l034','l040','l043','l044');

-- 4. Move VSLs cluster from R1 → R2. They keep their IDs but shift
--    region + day so Region 1 ends after Action Item: UGC Ad (l020).
update lessons set region_id = 'r2', day = 8 where id = 'l021'; -- VSLs
update lessons set region_id = 'r2', day = 8 where id = 'l022'; -- Action Item: VSL Ad (compound)
update lessons set region_id = 'r2', day = 8 where id = 'l023'; -- High-Production Ads
update lessons set region_id = 'r2', day = 8 where id = 'l024'; -- Action Item: High-Production Ad (compound)
update lessons set region_id = 'r2', day = 8 where id = 'l025'; -- Video Hooks

-- 5. Shrink R1 to days 1-7 and expand R2 to days 8-15
update regions set day_end   = 7 where id = 'r1';
update regions set day_start = 8 where id = 'r2';

-- 6. Sort_order within day=8 in R2: l021..l025 should come BEFORE the
--    existing day-9+ lessons. Keep their original relative order
--    (they were 21..25 in R1).
update lessons set sort_order = 1 where id = 'l021';
update lessons set sort_order = 2 where id = 'l022';
update lessons set sort_order = 3 where id = 'l023';
update lessons set sort_order = 4 where id = 'l024';
update lessons set sort_order = 5 where id = 'l025';

-- ============================================================
-- Verification (run manually):
--   select count(*) from lessons;                                          -- expect 59 (was 63 - 4 deletes)
--   select region_id, count(*) from lessons group by region_id order by 1; -- r1=20, r2=22, r3=10, r4=7
--   select id, title, requires_action from lessons where requires_action;  -- expect l018, l020, l022, l024
--   select id, day_start, day_end from regions order by order_num;         -- r1: 1-7, r2: 8-15, r3: 16-23, r4: 24-30
-- ============================================================
