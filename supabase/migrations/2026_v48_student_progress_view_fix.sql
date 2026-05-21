-- ============================================================
-- v48: Fix student_progress_counts to match the canonical
-- "is this lesson complete?" formula.
--
-- The old view (v37) was COUNT(*) from student_lesson_completions
-- grouped by student. It over-counted: any row in the completions
-- table (action-only, skipped-only, partially complete) added 1 to
-- the count. Admin surfaces (students list, dashboard) read from
-- this view and so showed inflated percentages.
--
-- Canonical "complete" definition — mirrored exactly in
-- src/lib/progress.ts:
--
--   A row counts toward progress when AT LEAST ONE of:
--     1. skipped_at IS NOT NULL                        (skipped → path advances)
--     2. lessons.requires_action = false               (plain watch)
--          AND completed_at IS NOT NULL
--     3. lessons.requires_action = true                (compound: watch + ship)
--          AND completed_at IS NOT NULL
--          AND action_completed_at IS NOT NULL
--
-- Idempotent (CREATE OR REPLACE).
-- ============================================================

create or replace view public.student_progress_counts as
select
  c.student_id,
  count(*)::int as completed_count
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
group by c.student_id;

grant select on public.student_progress_counts to authenticated;
grant select on public.student_progress_counts to anon;

-- Sanity check (commented):
-- select student_id, completed_count
-- from public.student_progress_counts
-- order by completed_count desc
-- limit 10;
-- -- expect: counts no higher than the total lesson count, and
-- -- matching what the student dashboard shows for each row.
