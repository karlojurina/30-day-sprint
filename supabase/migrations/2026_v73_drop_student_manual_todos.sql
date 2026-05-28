-- ============================================================
-- v73: Drop student_manual_todos.
--
-- The RegionTodoWidget (v66+) is removed in v72.3. With it goes
-- the manual_todo todo kind and the table that backed it. Nothing
-- in the app reads or writes student_manual_todos anymore.
--
-- The companion deletes on the application side:
--   - src/components/map/RegionTodoWidget.tsx (file deleted)
--   - src/app/api/student/toggle-manual-todo/route.ts (file deleted)
--   - src/app/api/student/data/route.ts (select removed)
--   - src/contexts/StudentContext.tsx (state + mutator removed)
--   - src/components/mockup/MapMockup.tsx (widget unmounted)
--
-- Idempotent.
-- ============================================================

drop table if exists student_manual_todos;
