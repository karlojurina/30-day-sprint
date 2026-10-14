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

-- v46:33-42 + v51:38-41, in part. updated_at and intro_video_threshold_met are
-- here for the cutover (v104): a row the switch creates must be told apart
-- from one a student has touched since, and production's rows carry a
-- not-null boolean and a stamp the switch never writes.
create table student_milestones (
  student_id uuid primary key references students(id) on delete cascade,
  first_sprint_login_at timestamptz,
  first_dashboard_login_at timestamptz,
  updated_at timestamptz not null default now(),
  intro_video_threshold_met boolean not null default false
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

-- ════════ The cutover (v103, v104): what the switch touches ════════
-- Shapes from the migrations that create them, named on each table. Every
-- key keeps the Postgres default name, as in production: v104 looks the keys
-- up in the catalogue and never by a name it assumes. With these, exactly
-- six keys point at lessons or regions, the six of the cutover PRD.

-- regions.quiz_format (v54:29-30, added by alter, so it sits last)
alter table regions add column quiz_format text;

-- The Whop sync's non-unique index on lessons.whop_lesson_id (v3:61)
create index idx_lessons_whop on lessons(whop_lesson_id);

-- lesson_notes (v2_lesson_notes + v3:96-103: task_id renamed to lesson_id,
-- its key re-added under the default name)
create table lesson_notes (
  id         uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  lesson_id  text not null references lessons(id) on delete cascade,
  content    text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, lesson_id)
);
create trigger lesson_notes_updated_at before update on lesson_notes
  for each row execute function public.set_updated_at();

-- student_lesson_ratings (v75:24-33)
create table student_lesson_ratings (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references students(id) on delete cascade,
  lesson_id   text not null references lessons(id) on delete cascade,
  stars       int  not null check (stars between 1 and 5),
  comment     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (student_id, lesson_id)
);

-- quizzes, quiz_questions, student_quiz_attempts (v2_quizzes + v3:108-115:
-- checkpoint_id renamed to region_id, its key re-added under the default name)
create table quizzes (
  id              text primary key,
  region_id       text not null references regions(id) on delete cascade,
  title           text not null,
  passing_percent int  not null default 70,
  sort_order      int  not null default 1,
  created_at      timestamptz not null default now()
);
create table quiz_questions (
  id            uuid primary key default gen_random_uuid(),
  quiz_id       text not null references quizzes(id) on delete cascade,
  sort_order    int  not null,
  question      text not null,
  options       jsonb not null,
  correct_index int   not null,
  explanation   text,
  created_at    timestamptz not null default now()
);
create table student_quiz_attempts (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references students(id) on delete cascade,
  quiz_id      text not null references quizzes(id) on delete cascade,
  score        int     not null,
  total        int     not null,
  passed       boolean not null,
  answers      jsonb   not null,
  completed_at timestamptz not null default now()
);

-- student_region_quiz (v54:44-52 + v65:35-58)
create table student_region_quiz (
  student_id       uuid not null references students(id) on delete cascade,
  region_id        text not null references regions(id) on delete cascade,
  quiz_passed_at   timestamptz,
  quiz_attempts    int not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  primary key (student_id, region_id),
  best_score_pct   int,
  last_score_pct   int,
  last_attempt_at  timestamptz,
  constraint student_region_quiz_best_score_pct_range check (best_score_pct is null or (best_score_pct between 0 and 100)),
  constraint student_region_quiz_last_score_pct_range check (last_score_pct is null or (last_score_pct between 0 and 100))
);

-- templates (v27:53-69 + v34:26-49 + v57:35, scenario_id widened to 48)
create table templates (
  id                  uuid primary key default gen_random_uuid(),
  scenario_id         varchar(48) not null unique,
  bucket              varchar(16) not null,
  week                varchar(8),
  title               varchar(160) not null,
  trigger_description text not null,
  intent              text,
  tone                text,
  variables           jsonb not null default '[]'::jsonb,
  body                text not null default '',
  word_count          int,
  is_active           boolean not null default true,
  is_admin_only       boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  is_custom           boolean not null default false,
  trigger_config      jsonb,
  constraint templates_trigger_config_shape_chk check (
    trigger_config is null
    or (jsonb_typeof(trigger_config) = 'object' and jsonb_typeof(trigger_config -> 'all') = 'array'))
);
create trigger trg_templates_updated_at before update on templates
  for each row execute function public.set_updated_at();

-- tasks (v27:103-116 + v57:36 + v85:13-16)
create table tasks (
  id                uuid primary key default gen_random_uuid(),
  student_id        uuid not null references students(id) on delete cascade,
  scenario_id       varchar(48) not null,
  template_id       uuid references templates(id) on delete set null,
  status            varchar(16) not null default 'open',
  behavior_summary  text,
  created_at        timestamptz not null default now(),
  completed_at      timestamptz,
  completed_by      uuid references team_members(id),
  dismissed_at      timestamptz,
  dismissed_by      uuid references team_members(id),
  notes             text,
  outcome           text check (outcome in ('replied', 'no_reply')),
  outcome_at        timestamptz,
  outcome_by        uuid
);

-- disengagement_alerts (schema.sql:80-89, with v10:39-51's widened check)
create table disengagement_alerts (
  id           uuid primary key default gen_random_uuid(),
  student_id   uuid not null references students(id) on delete cascade,
  alert_type   text not null,
  message      text not null,
  is_dismissed boolean not null default false,
  dismissed_by uuid references team_members(id),
  dismissed_at timestamptz,
  created_at   timestamptz not null default now(),
  constraint disengagement_alerts_alert_type_check check (alert_type in
    ('no_tasks_7d', 'no_lessons_3d', 'no_activation_14d', 'no_login_5d', 'week2_no_start'))
);

-- student_whop_sync (v46:60-71). Not touched by the switch; the postcheck
-- reads its fetched and matched counts. The two token columns are never read.
create table student_whop_sync (
  student_id            uuid primary key references students(id) on delete cascade,
  access_token          text,
  refresh_token         text,
  last_sync_at          timestamptz,
  last_sync_error       text,
  last_sync_error_at    timestamptz,
  last_sync_unmatched   text[],
  last_sync_fetched     int,
  last_sync_matched     int,
  updated_at            timestamptz not null default now()
);
