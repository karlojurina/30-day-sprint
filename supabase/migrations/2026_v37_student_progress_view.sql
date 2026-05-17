-- ============================================================
-- v37: student_progress_counts view
--
-- Why: /admin/students and /admin/ (dashboard) need a per-student
-- lesson-completion count. They were doing
--   .from("student_lesson_completions").select("student_id")
-- which returns one row per completion. With ~700 students and ~66
-- lessons, that's tens of thousands of rows, well over PostgREST's
-- default 1000-row cap. Result: the list silently undercounts.
-- The detail page (which only ever queries one student) doesn't
-- hit the cap, so it shows the "correct" value.
--
-- Fix: a tiny grouped view. One row per student, count column
-- pre-aggregated by Postgres. Read returns ~700 rows total, well
-- under any cap.
--
-- Idempotent. Safe to re-run.
-- ============================================================

create or replace view public.student_progress_counts as
select
  student_id,
  count(*)::int as completed_count
from public.student_lesson_completions
group by student_id;

grant select on public.student_progress_counts to authenticated;
grant select on public.student_progress_counts to anon;
