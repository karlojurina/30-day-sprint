-- ============================================================
-- V2: Hidden rewards (loot drops) — surprise unlocks
-- ============================================================

create table if not exists hidden_rewards (
  id            text primary key,
  trigger_type  text not null,       -- 'task_count', 'streak_length', 'specific_task', 'quiz_perfect', 'notes_count', 'speed_bonus'
  trigger_value jsonb not null,      -- {"count": 5} or {"task_id": "w4_t2"} or {"streak": 7}
  reward_type   text not null,       -- 'personal_note', 'exclusive_resource', 'secret_task', 'early_access', 'shoutout'
  title         text not null,
  description   text not null,
  content       text,                -- the actual reward content (note text, resource URL, etc.)
  icon_path     text,                -- optional SVG path for the reward icon
  sort_order    int  not null default 0,
  created_at    timestamptz not null default now()
);

create table if not exists student_rewards (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references students(id) on delete cascade,
  reward_id   text not null references hidden_rewards(id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  seen        boolean not null default false,
  unique(student_id, reward_id)
);

create index idx_student_rewards_student on student_rewards(student_id);

alter table hidden_rewards enable row level security;
create policy "Authenticated can read rewards"
  on hidden_rewards for select
  using (auth.uid() is not null);

alter table student_rewards enable row level security;
create policy "Students can manage own rewards"
  on student_rewards for all
  using (student_id in (select id from students where supabase_user_id = auth.uid()));
create policy "Team can read all student rewards"
  on student_rewards for select
  using (public.current_user_is_team());
