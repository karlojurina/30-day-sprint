-- ============================================================
-- V2: Month-in-review — frozen Day 28 snapshot per student
-- ============================================================

create table if not exists month_reviews (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid not null references students(id) on delete cascade unique,
  snapshot_data jsonb not null,       -- frozen stats object
  generated_at  timestamptz not null default now()
);

alter table month_reviews enable row level security;
create policy "Students can read own review"
  on month_reviews for select
  using (student_id in (select id from students where supabase_user_id = auth.uid()));
create policy "Team can read all reviews"
  on month_reviews for select
  using (public.current_user_is_team());
