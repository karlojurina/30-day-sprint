-- v75 — student lesson ratings (5 stars + optional comment).
--
-- One row per (student, lesson). Students can rate once and update
-- later. The rating UI appears in the LessonSheet after a lesson is
-- marked complete. The team sees aggregates + every comment with
-- student attribution on /admin/lessons.
--
-- Schema:
--   id           uuid PK
--   student_id   uuid → students.id (cascade)
--   lesson_id    text → lessons.id  (cascade)
--   stars        int   1-5 (CHECK enforced)
--   comment      text  nullable
--   created_at   timestamptz now()
--   updated_at   timestamptz now() (touched on upsert)
--   UNIQUE(student_id, lesson_id)
--
-- RLS:
--   Students can SELECT / INSERT / UPDATE their own row only.
--   Team can SELECT all (read-only — no admin-side editing).
--
-- Idempotent.

create table if not exists student_lesson_ratings (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references students(id) on delete cascade,
  lesson_id   text not null references lessons(id)  on delete cascade,
  stars       int  not null check (stars between 1 and 5),
  comment     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (student_id, lesson_id)
);

create index if not exists student_lesson_ratings_lesson_idx
  on student_lesson_ratings (lesson_id);

create index if not exists student_lesson_ratings_student_idx
  on student_lesson_ratings (student_id);

-- Touch updated_at on update.
create or replace function bump_student_lesson_ratings_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_bump_student_lesson_ratings_updated_at
  on student_lesson_ratings;
create trigger trg_bump_student_lesson_ratings_updated_at
  before update on student_lesson_ratings
  for each row execute function bump_student_lesson_ratings_updated_at();

-- RLS.
alter table student_lesson_ratings enable row level security;

drop policy if exists "students_select_own_ratings"
  on student_lesson_ratings;
create policy "students_select_own_ratings"
  on student_lesson_ratings
  for select to authenticated
  using (
    student_id in (
      select id from students where supabase_user_id = auth.uid()
    )
  );

drop policy if exists "students_insert_own_ratings"
  on student_lesson_ratings;
create policy "students_insert_own_ratings"
  on student_lesson_ratings
  for insert to authenticated
  with check (
    student_id in (
      select id from students where supabase_user_id = auth.uid()
    )
  );

drop policy if exists "students_update_own_ratings"
  on student_lesson_ratings;
create policy "students_update_own_ratings"
  on student_lesson_ratings
  for update to authenticated
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

drop policy if exists "team_select_all_ratings"
  on student_lesson_ratings;
create policy "team_select_all_ratings"
  on student_lesson_ratings
  for select to authenticated
  using (
    auth.uid() in (select id from team_members)
  );

-- Quick verification:
--   select count(*) from student_lesson_ratings;
--   select lesson_id, round(avg(stars)::numeric, 2), count(*)
--     from student_lesson_ratings group by lesson_id order by 2;
