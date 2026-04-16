-- ============================================================
-- Fix: "infinite recursion detected in policy for relation team_members"
--
-- The original schema had an RLS policy on team_members that referenced
-- team_members itself (self-referencing EXISTS). When combined with
-- policies on students/etc. that also check team_members, Postgres
-- cannot resolve which RLS to apply first → infinite recursion.
--
-- Fix: replace the team_members self-check with a SECURITY DEFINER
-- helper function that bypasses RLS when looking up team membership.
-- The existing helper public.current_user_is_team() already exists in
-- schema.sql — we repoint all policies to use it.
-- ============================================================

-- Drop and recreate the helper to guarantee it's security-definer + stable
create or replace function public.current_user_is_team()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from public.team_members where id = auth.uid())
$$;

-- Re-point every policy that was using a self-referencing EXISTS subquery

-- team_members: team can read team_members
drop policy if exists "Team can read team_members" on team_members;
create policy "Team can read team_members"
  on team_members for select
  using (public.current_user_is_team());

-- students
drop policy if exists "Team can read all students" on students;
create policy "Team can read all students"
  on students for select
  using (public.current_user_is_team());

drop policy if exists "Team can update students" on students;
create policy "Team can update students"
  on students for update
  using (public.current_user_is_team());

-- student_task_completions
drop policy if exists "Team can read all completions" on student_task_completions;
create policy "Team can read all completions"
  on student_task_completions for select
  using (public.current_user_is_team());

-- daily_notes
drop policy if exists "Team can read all notes" on daily_notes;
create policy "Team can read all notes"
  on daily_notes for select
  using (public.current_user_is_team());

-- discount_requests
drop policy if exists "Team can manage all discount requests" on discount_requests;
create policy "Team can manage all discount requests"
  on discount_requests for all
  using (public.current_user_is_team());

-- disengagement_alerts
drop policy if exists "Team can manage alerts" on disengagement_alerts;
create policy "Team can manage alerts"
  on disengagement_alerts for all
  using (public.current_user_is_team());

-- The "Users can read own team_members row" policy stays as-is (id = auth.uid())
-- since it doesn't trigger recursion.
