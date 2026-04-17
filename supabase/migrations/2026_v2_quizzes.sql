-- ============================================================
-- V2: Section quizzes — quiz per checkpoint, multiple choice
-- ============================================================

create table if not exists quizzes (
  id              text primary key,
  checkpoint_id   text not null references checkpoints(id) on delete cascade,
  title           text not null,
  passing_percent int  not null default 70,
  sort_order      int  not null default 1,
  created_at      timestamptz not null default now()
);

create table if not exists quiz_questions (
  id            uuid primary key default gen_random_uuid(),
  quiz_id       text not null references quizzes(id) on delete cascade,
  sort_order    int  not null,
  question      text not null,
  options       jsonb not null,      -- ["option A", "option B", "option C", "option D"]
  correct_index int   not null,      -- 0-based index into options array
  explanation   text,                -- shown after answering
  created_at    timestamptz not null default now()
);

create table if not exists student_quiz_attempts (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references students(id) on delete cascade,
  quiz_id      text not null references quizzes(id) on delete cascade,
  score        int     not null,     -- number of correct answers
  total        int     not null,     -- total questions
  passed       boolean not null,
  answers      jsonb   not null,     -- [{questionId, selectedIndex, correct}]
  completed_at timestamptz not null default now()
);

create index idx_quiz_questions_quiz    on quiz_questions(quiz_id);
create index idx_quiz_attempts_student  on student_quiz_attempts(student_id);
create index idx_quiz_attempts_quiz     on student_quiz_attempts(quiz_id);

-- RLS
alter table quizzes enable row level security;
create policy "Authenticated can read quizzes"
  on quizzes for select
  using (auth.uid() is not null);

alter table quiz_questions enable row level security;
create policy "Authenticated can read quiz questions"
  on quiz_questions for select
  using (auth.uid() is not null);

alter table student_quiz_attempts enable row level security;
create policy "Students can manage own quiz attempts"
  on student_quiz_attempts for all
  using (student_id in (select id from students where supabase_user_id = auth.uid()));
create policy "Team can read all quiz attempts"
  on student_quiz_attempts for select
  using (public.current_user_is_team());
