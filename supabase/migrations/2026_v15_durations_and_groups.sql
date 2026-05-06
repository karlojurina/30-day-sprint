-- ============================================================
-- v15: Real video durations + lesson groups + skip support
--
-- Three concerns in one migration so the app can ship the
-- "Editing Breakdowns" group node + accurate runtime + skip-vs-watch
-- in a single deploy.
--
-- Changes:
--
-- 1. Update video durations on R1 + R2 (mandatory + breakdowns) using
--    the actual lengths read off Whop. Three durations are not yet
--    known and stay as-is until Karlo reads them off Whop:
--      - l019 (UGC)
--      - l020 (Action Item: UGC Ad)
--      - l042 (Video Editing Breakdown: Part 5 — VSL Ad)
--    R3 + R4 also unchanged in this pass (pending restructure).
--
-- 2. Add `skipped_at timestamptz` to student_lesson_completions. A row
--    exists when the student either watched OR skipped. We tell the
--    two apart by which timestamp is set:
--      - completed_at set, skipped_at null  → watched (counts toward path)
--      - completed_at null, skipped_at set  → skipped (still counts toward path,
--                                            but flagged as un-watched in journal)
--    Both states unlock the next checkpoint. The student gets to keep
--    moving without being forced through 6+ hours of optional content.
--
-- 3. Add `lesson_group_id text` to lessons. Lessons sharing a
--    group_id collapse into a single map node. The grouped lessons
--    render inside the group sheet with per-part Watch/Skip buttons.
--    Right now the only group is `editing_breakdowns` covering
--    l032 + l033 + l035..l039 + l041 + l042 (9 lessons).
--
-- ============================================================

-- ─────────────── 1. Duration updates ───────────────

-- Use minutes as the source of truth in the duration_label string.
-- '13m' '17m 30s' '24m' etc. Pages format the label as-is.

-- R1 — known durations
update lessons set duration_label = '0m'      where id = 'l001'; -- action setup, 0
update lessons set duration_label = '13m'     where id = 'l002';
update lessons set duration_label = '17m 30s' where id = 'l003';
update lessons set duration_label = '27m 40s' where id = 'l004';
update lessons set duration_label = '11m 10s' where id = 'l005';
update lessons set duration_label = '13m 20s' where id = 'l007';
update lessons set duration_label = '6m'      where id = 'l008';
update lessons set duration_label = '16m'     where id = 'l009';
update lessons set duration_label = '6m'      where id = 'l010';
update lessons set duration_label = '12m'     where id = 'l011';
update lessons set duration_label = '8m'      where id = 'l013';
update lessons set duration_label = '24m'     where id = 'l014';
update lessons set duration_label = '3m'      where id = 'l015';
update lessons set duration_label = '14m'     where id = 'l016';
update lessons set duration_label = '13m'     where id = 'l017';
update lessons set duration_label = '9m'      where id = 'l018';
-- l019 + l020 unchanged — pending durations from Whop

-- R2 — mandatory (non-breakdown)
update lessons set duration_label = '16m'     where id = 'l021';
update lessons set duration_label = '9m'      where id = 'l022';
update lessons set duration_label = '9m'      where id = 'l023';
update lessons set duration_label = '3m'      where id = 'l024';
update lessons set duration_label = '17m'     where id = 'l025';
update lessons set duration_label = '12m'     where id = 'l026';
update lessons set duration_label = '7m'      where id = 'l027';
update lessons set duration_label = '20m'     where id = 'l028';
update lessons set duration_label = '30m'     where id = 'l029';
update lessons set duration_label = '10m'     where id = 'l030';
update lessons set duration_label = '42m'     where id = 'l031';

-- R2 — Editing Breakdowns group (optional — students can skip)
update lessons set duration_label = '2m'      where id = 'l032';
update lessons set duration_label = '54m'     where id = 'l033';
update lessons set duration_label = '1h 25m'  where id = 'l035';
update lessons set duration_label = '1h 20m'  where id = 'l036';
update lessons set duration_label = '50m'     where id = 'l037';
update lessons set duration_label = '38m'     where id = 'l038';
update lessons set duration_label = '20m'     where id = 'l039';
update lessons set duration_label = '52m'     where id = 'l041';
-- l042 unchanged — pending duration from Whop

-- ─────────────── 2. skipped_at column ───────────────

alter table student_lesson_completions
  add column if not exists skipped_at timestamptz;

-- A completion row must have at least one of completed_at or skipped_at.
-- We don't enforce this with a CHECK because the existing rows pre-date
-- the column and have completed_at always set; new skip rows will
-- always set skipped_at. App code is the source of truth.

create index if not exists idx_lesson_completions_skipped
  on student_lesson_completions(skipped_at)
  where skipped_at is not null;

-- ─────────────── 3. lesson_group_id ───────────────

alter table lessons
  add column if not exists lesson_group_id text;

create index if not exists idx_lessons_group_id
  on lessons(lesson_group_id)
  where lesson_group_id is not null;

-- Tag the 9 editing breakdown lessons. They all live on R2 days 11–14.
update lessons
set lesson_group_id = 'editing_breakdowns'
where id in ('l032', 'l033', 'l035', 'l036', 'l037', 'l038', 'l039', 'l041', 'l042');

-- ─────────────── Verification ───────────────
-- select region_id, count(*), sum(
--   case when duration_label ~ '^\d+h' then
--     (regexp_match(duration_label, '(\d+)h'))[1]::int * 60 +
--     coalesce((regexp_match(duration_label, '(\d+)m'))[1]::int, 0)
--   else
--     coalesce((regexp_match(duration_label, '(\d+)m'))[1]::int, 0)
--   end
-- ) as total_minutes
-- from lessons group by region_id order by 1;
--
-- select id, lesson_group_id from lessons where lesson_group_id is not null
--   order by day, sort_order;
--
-- select count(*) filter (where completed_at is not null) as watched,
--        count(*) filter (where skipped_at is not null) as skipped
-- from student_lesson_completions;
