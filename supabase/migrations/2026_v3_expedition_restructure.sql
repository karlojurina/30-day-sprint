-- ============================================================
-- V3: Expedition Map restructure
--
-- Replaces the 7-checkpoint / 23-task / week-based model with
-- a 4-region / 33-lesson / day-based model driven by the new
-- Expedition Map design.
--
-- Changes:
--   - New `regions` table (replaces `checkpoints`)
--   - New `lessons` table (replaces `tasks`) with `day` column
--   - `lesson_notes` and `student_task_completions` re-point to lessons
--   - Drops: hidden_rewards, student_rewards (not used in v3 design)
--   - Keeps: streak/title columns, quizzes, lesson_notes, month_reviews
--
-- The 5-title system replaces 7:
--   recruit (0) → explorer (1) → ad_creator (2) → strategist (3) → et_pro (4)
-- ============================================================

-- -----------------------------------------------------------
-- 1. New regions table
-- -----------------------------------------------------------
create table if not exists regions (
  id         text primary key,              -- 'r1' | 'r2' | 'r3' | 'r4'
  order_num  int  not null unique,          -- 1 | 2 | 3 | 4
  name       text not null,
  subtitle   text not null,
  tagline    text not null,
  terrain    text not null check (terrain in ('shore', 'forest', 'mountains', 'city')),
  days_label text not null,                 -- "Days 1–8"
  day_start  int  not null,
  day_end    int  not null,
  is_discount_gate boolean not null default false,
  created_at timestamptz not null default now()
);

alter table regions enable row level security;
create policy "Authenticated can read regions"
  on regions for select using (auth.uid() is not null);

-- -----------------------------------------------------------
-- 2. New lessons table
-- -----------------------------------------------------------
create table if not exists lessons (
  id             text primary key,          -- 'l1', 'l2', ..., 'l33'
  region_id      text not null references regions(id) on delete cascade,
  day            int  not null check (day between 1 and 30),
  type           text not null check (type in ('watch', 'action', 'setup')),
  title          text not null,
  description    text,
  duration_label text,                      -- display string, e.g. "14m"
  is_gate        boolean not null default false,  -- l18 = discount unlock
  is_boss        boolean not null default false,  -- l33 = final reflection
  whop_lesson_id text,                      -- for watch-sync matching
  discord_channel text,                     -- display label for Discord pointer
  sort_order     int not null default 0,    -- order within a day when multiple
  created_at     timestamptz not null default now()
);

create index idx_lessons_region on lessons(region_id);
create index idx_lessons_day    on lessons(day);
create index idx_lessons_whop   on lessons(whop_lesson_id);

alter table lessons enable row level security;
create policy "Authenticated can read lessons"
  on lessons for select using (auth.uid() is not null);

-- -----------------------------------------------------------
-- 3. Student lesson completions (replaces student_task_completions)
-- -----------------------------------------------------------
create table if not exists student_lesson_completions (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references students(id) on delete cascade,
  lesson_id    text not null references lessons(id) on delete cascade,
  completed_at timestamptz not null default now(),
  unique(student_id, lesson_id)
);

create index idx_lesson_completions_student on student_lesson_completions(student_id);
create index idx_lesson_completions_lesson  on student_lesson_completions(lesson_id);

alter table student_lesson_completions enable row level security;
create policy "Students can manage own lesson completions"
  on student_lesson_completions for all
  using (student_id in (select id from students where supabase_user_id = auth.uid()));
create policy "Team can read all lesson completions"
  on student_lesson_completions for select
  using (public.current_user_is_team());

-- -----------------------------------------------------------
-- 4. Update lesson_notes to point at lessons (if still text-keyed same pattern, no change needed)
-- NOTE: lesson_notes.task_id was text referencing tasks(id).
-- The IDs are different (l1 vs w1_t1), so we need to restructure.
-- -----------------------------------------------------------

-- Drop existing lesson_notes rows (fresh start under new lesson IDs)
truncate table lesson_notes;

-- Drop old FK and rename column to lesson_id
alter table lesson_notes drop constraint if exists lesson_notes_task_id_fkey;
alter table lesson_notes rename column task_id to lesson_id;
alter table lesson_notes
  add constraint lesson_notes_lesson_id_fkey
  foreign key (lesson_id) references lessons(id) on delete cascade;

-- -----------------------------------------------------------
-- 5. Update quizzes to point at regions (instead of checkpoints)
-- -----------------------------------------------------------
-- CASCADE clears quiz_questions + student_quiz_attempts in one shot
truncate table quizzes cascade;

alter table quizzes drop constraint if exists quizzes_checkpoint_id_fkey;
alter table quizzes rename column checkpoint_id to region_id;
alter table quizzes
  add constraint quizzes_region_id_fkey
  foreign key (region_id) references regions(id) on delete cascade;

-- -----------------------------------------------------------
-- 6. Update students.current_title to the new 5-title system
-- -----------------------------------------------------------
-- Drop the old constraint, add the new one
alter table students drop constraint if exists students_current_title_check;
alter table students
  add constraint students_current_title_check
  check (current_title in (
    'recruit', 'explorer', 'ad_creator', 'strategist', 'et_pro'
  ));

-- Reset any existing titles to recruit (safe since we're restructuring)
update students set current_title = 'recruit' where current_title not in (
  'recruit', 'explorer', 'ad_creator', 'strategist', 'et_pro'
);

-- -----------------------------------------------------------
-- 7. Drop hidden rewards (not used in v3)
-- -----------------------------------------------------------
drop table if exists student_rewards cascade;
drop table if exists hidden_rewards cascade;

-- -----------------------------------------------------------
-- 8. Drop old task-based tables (no longer used)
-- -----------------------------------------------------------
-- Keep the old tables for now in case we need to reference them,
-- but mark them as deprecated via a rename. Actually — clean cut.
drop table if exists student_task_completions cascade;
drop table if exists tasks cascade;
drop table if exists checkpoints cascade;
