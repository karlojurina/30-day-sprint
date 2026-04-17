-- ============================================================
-- V2: Lesson notes — per-task notes for each student
-- ============================================================

create table if not exists lesson_notes (
  id         uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  task_id    text not null references tasks(id) on delete cascade,
  content    text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(student_id, task_id)
);

create index idx_lesson_notes_student on lesson_notes(student_id);
create index idx_lesson_notes_task    on lesson_notes(task_id);

alter table lesson_notes enable row level security;

create policy "Students can manage own lesson notes"
  on lesson_notes for all
  using (student_id in (select id from students where supabase_user_id = auth.uid()));

create policy "Team can read all lesson notes"
  on lesson_notes for select
  using (public.current_user_is_team());

create trigger lesson_notes_updated_at
  before update on lesson_notes
  for each row execute function public.set_updated_at();
