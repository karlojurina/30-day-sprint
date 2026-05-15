-- ============================================================
-- v25: Drop l063 ("The Final Reflection")
--
-- Karlo decided the Final Reflection action item is not pulling its
-- weight. Removing the lesson + its completion cascade. With l063
-- gone, no lesson has is_boss = true; the GraduationModal trigger
-- is being moved to "all-lessons-complete" instead of relying on
-- a single boss lesson, so this is safe.
--
-- After this, R4 has 20 lessons (was 21). Total: 70.
--
-- Idempotent.
-- ============================================================

delete from student_lesson_completions where lesson_id = 'l063';
delete from lessons where id = 'l063';

-- Sanity checks (uncomment to verify in SQL editor):
-- select count(*) from lessons;                               -- expect 70
-- select count(*) from lessons where region_id = 'r4';        -- expect 20
-- select count(*) from lessons where is_boss = true;          -- expect 0
-- select count(*) from lessons where id = 'l063';             -- expect 0
