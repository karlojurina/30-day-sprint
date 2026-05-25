-- ============================================================
-- v66: student_manual_todos - generic honor-system todo state.
--
-- The RegionTodoWidget today supports two todo kinds:
--   1. watch_lessons_in_region (auto-tracked via completions)
--   2. action_shipped (tied to a specific lesson's
--      action_completed_at)
--
-- R3 + R4 don't have enough lesson-tied action items to reach
-- "3 todos per region" cleanly, and some future todos won't
-- map to a lesson at all (e.g. community actions, deliverables
-- like the Growth Guide). This table backs a new third kind:
-- manual_todo - one row per (student, todo_key), completed_at
-- set when the student taps "Mark done."
--
-- Why a separate table:
--   - Per CLAUDE.md "table-level bounded contexts": don't pile
--     unrelated state into students/student_milestones.
--   - Scales without schema changes: new manual todos = new
--     row, no migration.
--   - todo_key is a stable string registered in the widget; the
--     widget owns the label, this table just owns "did they
--     mark it done."
--
-- Idempotent.
-- ============================================================

create table if not exists student_manual_todos (
  student_id    uuid not null references students(id) on delete cascade,
  todo_key      text not null,
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (student_id, todo_key)
);

create index if not exists idx_student_manual_todos_student
  on student_manual_todos(student_id);

comment on table student_manual_todos is
  'Honor-system region todos that aren''t tied to a specific lesson. todo_key is a stable string the widget registers (e.g. r3_third_placeholder). completed_at null = not done. v66.';

-- RLS ------------------------------------------------------------
alter table student_manual_todos enable row level security;

drop policy if exists "student_manual_todos: student reads own" on student_manual_todos;
create policy "student_manual_todos: student reads own"
on student_manual_todos for select
using (
  student_id in (
    select id from students where supabase_user_id = auth.uid()
  )
);

drop policy if exists "student_manual_todos: student writes own" on student_manual_todos;
create policy "student_manual_todos: student writes own"
on student_manual_todos for all
using (
  student_id in (
    select id from students where supabase_user_id = auth.uid()
  )
)
with check (
  student_id in (
    select id from students where supabase_user_id = auth.uid()
  )
);

drop policy if exists "student_manual_todos: team reads all" on student_manual_todos;
create policy "student_manual_todos: team reads all"
on student_manual_todos for select
using (exists (select 1 from team_members where id = auth.uid()));
