-- ============================================================
-- v22: Relax completed_at on student_lesson_completions to NULLABLE.
--
-- The original schema (from before the skip feature existed) declared
-- completed_at NOT NULL. v15 added skipped_at but forgot to relax
-- completed_at, so legitimate skip-INSERTs (where completed_at is
-- null and skipped_at is the timestamp) get rejected with:
--   "null value in column completed_at of relation
--    student_lesson_completions violates not-null constraint"
--
-- A row can now legitimately have any of:
--   completed_at SET, skipped_at NULL                → watched
--   completed_at NULL, skipped_at SET                → skipped
--   completed_at SET, action_completed_at SET (compound) → fully done
--
-- App code is the source of truth for valid combinations.
-- ============================================================

alter table student_lesson_completions
  alter column completed_at drop not null;

-- Verification:
--   select column_name, is_nullable from information_schema.columns
--   where table_name = 'student_lesson_completions' and column_name = 'completed_at';
--   -- expect: is_nullable = 'YES'
