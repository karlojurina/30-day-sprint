-- ============================================================
-- v54: Region-end quiz gate (lovro-brief-region-quiz, 23-05-2026).
--
-- Adds a quiz gate between regions. When a student finishes 100%
-- of a region's lessons and clicks Onward, a per-region quiz
-- modal fires. Passing the quiz unlocks the next region. R1 uses
-- the Swipe Cards format; R2-4 will adopt different formats once
-- Karlo writes the content for them.
--
-- Schema:
--   regions.quiz_format        - which mini-game wrapper to mount
--                                 ('swipe_cards' | 'stack_builder' |
--                                  'tier_ranking' | 'vault_tumblers' |
--                                  null). Null = no quiz gate.
--   student_region_quiz        - per-student-per-region row.
--                                 quiz_passed_at gates whether the
--                                 Onward button shows the quiz or
--                                 jumps straight to next region.
--                                 quiz_attempts increments every
--                                 time the student opens the modal.
--
-- Per CLAUDE.md "table-level bounded contexts": NEW table for
-- region quiz state rather than piling onto student_milestones.
-- Each region row is independent; this isn't a journey timestamp.
--
-- Idempotent.
-- ============================================================

-- 1. regions.quiz_format -------------------------------------------------
alter table regions
  add column if not exists quiz_format text;

-- Region 1 gets the Swipe Cards format. Other regions stay null for
-- now (no quiz gate fires); Karlo will set them once content lands.
update regions
set quiz_format = 'swipe_cards'
where id = 'r1' and quiz_format is null;

comment on column regions.quiz_format is
  'Which quiz mini-game wrapper to mount on the Onward button. Null = no quiz gate (Onward jumps straight). v54.';

-- 2. student_region_quiz -------------------------------------------------
create table if not exists student_region_quiz (
  student_id       uuid not null references students(id) on delete cascade,
  region_id        text not null references regions(id) on delete cascade,
  quiz_passed_at   timestamptz,
  quiz_attempts    int not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  primary key (student_id, region_id)
);

create index if not exists idx_student_region_quiz_passed
  on student_region_quiz(student_id, quiz_passed_at);

comment on table student_region_quiz is
  'One row per (student, region). quiz_passed_at != null = student cleared the region quiz and Onward jumps straight. quiz_attempts tracks how many times the modal opened (for engagement insight).';

-- 3. RLS -----------------------------------------------------------------
alter table student_region_quiz enable row level security;

drop policy if exists "student_region_quiz: student reads own" on student_region_quiz;
create policy "student_region_quiz: student reads own"
on student_region_quiz for select
using (
  student_id in (
    select id from students where supabase_user_id = auth.uid()
  )
);

drop policy if exists "student_region_quiz: team reads all" on student_region_quiz;
create policy "student_region_quiz: team reads all"
on student_region_quiz for select
using (exists (select 1 from team_members where id = auth.uid()));
