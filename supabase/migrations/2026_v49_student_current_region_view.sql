-- ============================================================
-- v49: student_current_region view.
--
-- Why: the /admin/journey page (kanban) was pulling raw rows from
-- student_lesson_completions client-side to derive each student's
-- "current region" (highest region they have any completed lesson
-- in). That query hits PostgREST's default 1000-row cap once the
-- platform has > ~15 active students (66 lessons each), silently
-- truncating the result. The same 1000-cap bug v37 fixed for the
-- completion COUNT showed up again for region derivation.
--
-- This view returns one row per student with their highest-region
-- with a completion. Server-aggregated → no row cap risk.
--
-- Canonical "complete" definition — must stay in lock-step with
-- src/lib/progress.ts AND with the student_progress_counts view
-- (v48). When the formula changes, update all three.
--
--   skipped_at IS NOT NULL
--   OR (lessons.requires_action = false AND completed_at IS NOT NULL)
--   OR (lessons.requires_action = true AND completed_at IS NOT NULL
--        AND action_completed_at IS NOT NULL)
--
-- region_id is text ('r1' .. 'r4'), so `order by region_id desc`
-- picks the highest region naturally (r4 > r3 > r2 > r1
-- alphabetically). DISTINCT ON (student_id) keeps the first row
-- per student.
--
-- Idempotent (CREATE OR REPLACE).
-- ============================================================

create or replace view public.student_current_region as
select distinct on (c.student_id)
  c.student_id,
  l.region_id as current_region
from public.student_lesson_completions c
join public.lessons l on l.id = c.lesson_id
where
  c.skipped_at is not null
  or (l.requires_action = false and c.completed_at is not null)
  or (
    l.requires_action = true
    and c.completed_at is not null
    and c.action_completed_at is not null
  )
order by c.student_id, l.region_id desc;

grant select on public.student_current_region to authenticated;
grant select on public.student_current_region to anon;

-- Sanity check (commented):
-- select student_id, current_region
-- from public.student_current_region
-- limit 10;
-- -- expect: one row per student that has at least one completed
-- -- lesson; current_region is r1..r4.
