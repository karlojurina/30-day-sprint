-- ============================================================
-- EcomTalent Student Platform — Database Schema
-- Run in Supabase Dashboard > SQL Editor > New Query
-- ============================================================

-- 1. TEAM MEMBERS
create table if not exists team_members (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  full_name  text not null,
  role       text not null default 'csm' check (role in ('founder', 'csm', 'admin')),
  created_at timestamptz not null default now()
);

-- 2. STUDENTS
create table if not exists students (
  id                 uuid primary key default gen_random_uuid(),
  supabase_user_id   uuid unique references auth.users(id) on delete set null,
  whop_user_id       text unique not null,
  whop_membership_id text unique,
  email              text,
  name               text,
  discord_username   text,
  avatar_url         text,
  membership_status  text not null default 'active' check (membership_status in ('active', 'canceled', 'past_due', 'expired')),
  joined_at          timestamptz not null default now(),
  last_active_at     timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- 3. TASKS (master list — seeded once, never modified by users)
create table if not exists tasks (
  id                   text primary key,
  week                 int not null check (week between 1 and 4),
  sort_order           int not null,
  title                text not null,
  description          text,
  task_type            text not null check (task_type in ('setup', 'watch', 'action')),
  is_activation_point  boolean not null default false,
  activation_point_id  text check (activation_point_id in ('AP1', 'AP2', 'AP3')),
  is_discount_required boolean not null default false,
  created_at           timestamptz not null default now()
);

-- 4. STUDENT TASK COMPLETIONS
create table if not exists student_task_completions (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references students(id) on delete cascade,
  task_id      text not null references tasks(id) on delete cascade,
  completed_at timestamptz not null default now(),
  unique(student_id, task_id)
);

-- 5. DAILY NOTES
create table if not exists daily_notes (
  id         uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  note_date  date not null default current_date,
  content    text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(student_id, note_date)
);

-- 6. DISCOUNT REQUESTS
create table if not exists discount_requests (
  id               uuid primary key default gen_random_uuid(),
  student_id       uuid not null references students(id) on delete cascade,
  status           text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  promo_code       text,
  whop_promo_id    text,
  reviewed_by      uuid references team_members(id),
  reviewed_at      timestamptz,
  rejection_reason text,
  created_at       timestamptz not null default now()
);

-- 7. DISENGAGEMENT ALERTS
create table if not exists disengagement_alerts (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references students(id) on delete cascade,
  alert_type   text not null check (alert_type in ('no_tasks_7d', 'no_activation_14d', 'no_login_5d', 'week2_no_start')),
  message      text not null,
  is_dismissed boolean not null default false,
  dismissed_by uuid references team_members(id),
  dismissed_at timestamptz,
  created_at   timestamptz not null default now()
);

-- ============================================================
-- INDEXES
-- ============================================================
create index idx_students_whop_user on students(whop_user_id);
create index idx_students_supabase_user on students(supabase_user_id);
create index idx_students_membership_status on students(membership_status);
create index idx_students_last_active on students(last_active_at);
create index idx_completions_student on student_task_completions(student_id);
create index idx_completions_task on student_task_completions(task_id);
create index idx_notes_student_date on daily_notes(student_id, note_date);
create index idx_discount_requests_status on discount_requests(status);
create index idx_alerts_dismissed on disengagement_alerts(is_dismissed);
create index idx_alerts_student on disengagement_alerts(student_id);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

-- Team members: only team can read
alter table team_members enable row level security;
create policy "Team can read team_members"
  on team_members for select
  using (exists (select 1 from team_members tm where tm.id = auth.uid()));

-- Students: own row + team reads all
alter table students enable row level security;
create policy "Students can read own record"
  on students for select
  using (supabase_user_id = auth.uid());
create policy "Team can read all students"
  on students for select
  using (exists (select 1 from team_members where id = auth.uid()));
create policy "Team can update students"
  on students for update
  using (exists (select 1 from team_members where id = auth.uid()));

-- Tasks: readable by all authenticated users
alter table tasks enable row level security;
create policy "Authenticated users can read tasks"
  on tasks for select
  using (auth.uid() is not null);

-- Student task completions: own data + team reads
alter table student_task_completions enable row level security;
create policy "Students can manage own completions"
  on student_task_completions for all
  using (student_id in (select id from students where supabase_user_id = auth.uid()));
create policy "Team can read all completions"
  on student_task_completions for select
  using (exists (select 1 from team_members where id = auth.uid()));

-- Daily notes: own data + team reads
alter table daily_notes enable row level security;
create policy "Students can manage own notes"
  on daily_notes for all
  using (student_id in (select id from students where supabase_user_id = auth.uid()));
create policy "Team can read all notes"
  on daily_notes for select
  using (exists (select 1 from team_members where id = auth.uid()));

-- Discount requests: students read/create own, team manages all
alter table discount_requests enable row level security;
create policy "Students can read own discount requests"
  on discount_requests for select
  using (student_id in (select id from students where supabase_user_id = auth.uid()));
create policy "Students can create discount requests"
  on discount_requests for insert
  with check (student_id in (select id from students where supabase_user_id = auth.uid()));
create policy "Team can manage all discount requests"
  on discount_requests for all
  using (exists (select 1 from team_members where id = auth.uid()));

-- Disengagement alerts: team only
alter table disengagement_alerts enable row level security;
create policy "Team can manage alerts"
  on disengagement_alerts for all
  using (exists (select 1 from team_members where id = auth.uid()));

-- ============================================================
-- V2 TABLES
-- ============================================================

-- 8. LESSON NOTES (per-task notes for each student)
create table if not exists lesson_notes (
  id         uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  task_id    text not null references tasks(id) on delete cascade,
  content    text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(student_id, task_id)
);

-- 9. QUIZZES (one per checkpoint)
create table if not exists quizzes (
  id              text primary key,
  checkpoint_id   text not null references checkpoints(id) on delete cascade,
  title           text not null,
  passing_percent int  not null default 70,
  sort_order      int  not null default 1,
  created_at      timestamptz not null default now()
);

-- 10. QUIZ QUESTIONS
create table if not exists quiz_questions (
  id            uuid primary key default gen_random_uuid(),
  quiz_id       text not null references quizzes(id) on delete cascade,
  sort_order    int  not null,
  question      text not null,
  options       jsonb not null,
  correct_index int   not null,
  explanation   text,
  created_at    timestamptz not null default now()
);

-- 11. STUDENT QUIZ ATTEMPTS
create table if not exists student_quiz_attempts (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references students(id) on delete cascade,
  quiz_id      text not null references quizzes(id) on delete cascade,
  score        int     not null,
  total        int     not null,
  passed       boolean not null,
  answers      jsonb   not null,
  completed_at timestamptz not null default now()
);

-- 12. HIDDEN REWARDS
create table if not exists hidden_rewards (
  id            text primary key,
  trigger_type  text not null,
  trigger_value jsonb not null,
  reward_type   text not null,
  title         text not null,
  description   text not null,
  content       text,
  icon_path     text,
  sort_order    int  not null default 0,
  created_at    timestamptz not null default now()
);

-- 13. STUDENT REWARDS (unlocked loot drops)
create table if not exists student_rewards (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references students(id) on delete cascade,
  reward_id   text not null references hidden_rewards(id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  seen        boolean not null default false,
  unique(student_id, reward_id)
);

-- 14. MONTH REVIEWS (Day 28 frozen snapshot)
create table if not exists month_reviews (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid not null references students(id) on delete cascade unique,
  snapshot_data jsonb not null,
  generated_at  timestamptz not null default now()
);

-- ============================================================
-- V2 INDEXES
-- ============================================================
create index idx_lesson_notes_student    on lesson_notes(student_id);
create index idx_lesson_notes_task       on lesson_notes(task_id);
create index idx_quiz_questions_quiz     on quiz_questions(quiz_id);
create index idx_quiz_attempts_student   on student_quiz_attempts(student_id);
create index idx_quiz_attempts_quiz      on student_quiz_attempts(quiz_id);
create index idx_student_rewards_student on student_rewards(student_id);

-- ============================================================
-- V2 ROW LEVEL SECURITY
-- ============================================================
alter table lesson_notes enable row level security;
create policy "Students can manage own lesson notes"
  on lesson_notes for all
  using (student_id in (select id from students where supabase_user_id = auth.uid()));
create policy "Team can read all lesson notes"
  on lesson_notes for select
  using (public.current_user_is_team());

alter table quizzes enable row level security;
create policy "Authenticated can read quizzes"
  on quizzes for select using (auth.uid() is not null);

alter table quiz_questions enable row level security;
create policy "Authenticated can read quiz questions"
  on quiz_questions for select using (auth.uid() is not null);

alter table student_quiz_attempts enable row level security;
create policy "Students can manage own quiz attempts"
  on student_quiz_attempts for all
  using (student_id in (select id from students where supabase_user_id = auth.uid()));
create policy "Team can read all quiz attempts"
  on student_quiz_attempts for select
  using (public.current_user_is_team());

alter table hidden_rewards enable row level security;
create policy "Authenticated can read rewards"
  on hidden_rewards for select using (auth.uid() is not null);

alter table student_rewards enable row level security;
create policy "Students can manage own rewards"
  on student_rewards for all
  using (student_id in (select id from students where supabase_user_id = auth.uid()));
create policy "Team can read all student rewards"
  on student_rewards for select
  using (public.current_user_is_team());

alter table month_reviews enable row level security;
create policy "Students can read own review"
  on month_reviews for select
  using (student_id in (select id from students where supabase_user_id = auth.uid()));
create policy "Team can read all reviews"
  on month_reviews for select
  using (public.current_user_is_team());

-- ============================================================
-- TRIGGERS
-- ============================================================

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger students_updated_at
  before update on students
  for each row execute function public.set_updated_at();

create trigger daily_notes_updated_at
  before update on daily_notes
  for each row execute function public.set_updated_at();

create trigger lesson_notes_updated_at
  before update on lesson_notes
  for each row execute function public.set_updated_at();

-- ============================================================
-- HELPER FUNCTION
-- ============================================================

create or replace function public.current_user_is_team()
returns boolean
language sql
security definer
stable
as $$
  select exists (select 1 from public.team_members where id = auth.uid())
$$;
