-- Minimal but FAITHFUL reproduction of the production preconditions that
-- v92/v93 touch. Table shapes lifted from v3 + v6 + v15 + v19 + v22 + v31 +
-- v32 + v77. The views and the snapshot RPC are extracted verbatim from the
-- real migration files by the runner, never retyped.

create role anon;
create role authenticated;
create role service_role;

create schema if not exists auth;
-- Test seam: the runner sets test.uid to impersonate a student.
create or replace function auth.uid() returns uuid as $$
  select nullif(current_setting('test.uid', true), '')::uuid;
$$ language sql stable;

create or replace function public.current_user_is_team() returns boolean as $$
  select coalesce(nullif(current_setting('test.is_team', true), '')::boolean, false);
$$ language sql stable;

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ── regions (v3) ──
create table regions (
  id         text primary key,
  order_num  int  not null unique,
  name       text not null,
  subtitle   text not null default '',
  tagline    text not null default '',
  terrain    text not null check (terrain in ('shore','forest','mountains','city')),
  days_label text not null default '',
  day_start  int  not null default 1,
  day_end    int  not null default 30,
  is_discount_gate boolean not null default false,
  created_at timestamptz not null default now()
);
alter table regions enable row level security;
create policy "Authenticated can read regions" on regions for select using (auth.uid() is not null);

-- ── lessons (v3 + v6 + v15 + v19) ──
create table lessons (
  id             text primary key,
  region_id      text not null references regions(id) on delete cascade,
  day            int  not null check (day between 1 and 30),
  type           text not null check (type in ('watch','action','setup')),
  title          text not null,
  description    text,
  duration_label text,
  is_gate        boolean not null default false,
  is_boss        boolean not null default false,
  whop_lesson_id text,
  discord_channel text,
  sort_order     int not null default 0,
  created_at     timestamptz not null default now(),
  requires_action boolean not null default false,
  action_brief   text,
  lesson_group_id text,
  is_optional    boolean not null default false
);
alter table lessons enable row level security;
create policy "Authenticated can read lessons" on lessons for select using (auth.uid() is not null);

-- ── students ──
create table students (
  id uuid primary key default gen_random_uuid(),
  supabase_user_id uuid unique,
  email text,
  csm_exempt boolean not null default false,
  first_paid_at timestamptz,
  canceled_at timestamptz,
  whop_plan_id text,
  membership_status text,
  updated_at timestamptz not null default now()
);

-- ── student_lesson_completions (v3 + v6 + v15 + v22) ──
create table student_lesson_completions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  lesson_id  text not null references lessons(id) on delete cascade,
  completed_at timestamptz default now(),
  action_completed_at timestamptz,
  skipped_at timestamptz,
  unique(student_id, lesson_id)
);
alter table student_lesson_completions enable row level security;
create policy "Students manage own lesson completions" on student_lesson_completions for all
  using (student_id in (select id from students where supabase_user_id = auth.uid()));
create policy "Team can read all lesson completions" on student_lesson_completions for select
  using (public.current_user_is_team());

create table student_milestones (
  student_id uuid primary key references students(id) on delete cascade,
  first_sprint_login_at timestamptz,
  first_dashboard_login_at timestamptz
);

create table achievements (
  id text primary key,
  name text not null default '',
  description text
);

create table student_achievements (
  student_id uuid not null references students(id) on delete cascade,
  achievement_id text not null references achievements(id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  primary key (student_id, achievement_id)
);

-- ── daily_progress_snapshots (v31 + v32 + v77) ──
create table daily_progress_snapshots (
  snapshot_date date primary key,
  active_students int not null,
  total_completions int not null,
  avg_progress numeric(5,2) not null,
  created_at timestamptz not null default now(),
  active_count int, joined_count int, churned_count int,
  active_count_cohort int, joined_count_cohort int, churned_count_cohort int,
  avg_progress_cohort numeric(5,2)
);

-- ── v27 admin_config + team_members, v20 discount_requests (v95 prereqs) ──
create table team_members (id uuid primary key default gen_random_uuid(), email text);
create table admin_config (
  key varchar(64) primary key,
  value text not null,
  description text,
  updated_at timestamptz not null default now(),
  updated_by uuid references team_members(id)
);
create table discount_requests (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  promo_code text, whop_promo_id text,
  reviewed_by uuid references team_members(id), reviewed_at timestamptz,
  rejection_reason text, created_at timestamptz not null default now()
);
