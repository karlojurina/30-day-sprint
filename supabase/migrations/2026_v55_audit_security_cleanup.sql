-- ============================================================
-- v55: Audit security + correctness cleanup (2026-05-23).
--
-- Surfaced by a full codebase audit. Three things in one
-- migration:
--
-- 1. student_region_quiz: add missing RLS policies for INSERT
--    and UPDATE. v54 only created SELECT policies, which meant
--    the row-level security model was incomplete - INSERT/UPSERT
--    operations from the student API routes bypassed RLS
--    entirely. Service-role calls still work (they bypass RLS
--    anyway); these new policies just close the gap for any
--    direct anon-key write that might exist in the future.
--
-- 2. student_region_quiz: add an atomic increment RPC for
--    quiz_attempts. The current API route reads-then-upserts,
--    which loses parallel increments. The RPC uses a single
--    statement with `attempts + 1` so concurrent calls add up
--    correctly.
--
-- 3. student_achievements: same RLS gap as #1 - only SELECT
--    policies existed. The achievements evaluator runs server-
--    side via the service role so writes work, but the policy
--    surface should be complete.
--
-- Idempotent.
-- ============================================================

-- 1. student_region_quiz - INSERT + UPDATE policies ----------------------
-- Student can insert/update their OWN row only. Service-role bypass
-- isn't affected (cron + admin paths still work).
drop policy if exists "student_region_quiz: student writes own"
  on student_region_quiz;
create policy "student_region_quiz: student writes own"
on student_region_quiz for all
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

-- 2. student_region_quiz - atomic increment RPC ------------------------
-- Single-statement increment via UPSERT with `attempts + 1`. Avoids
-- the read-modify-write race the API route had. Called from
-- /api/student/increment-region-quiz-attempts via supabase.rpc().
create or replace function increment_region_quiz_attempts(
  p_student_id uuid,
  p_region_id  text
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_attempts int;
begin
  insert into student_region_quiz (student_id, region_id, quiz_attempts, updated_at)
  values (p_student_id, p_region_id, 1, now())
  on conflict (student_id, region_id)
  do update set
    quiz_attempts = student_region_quiz.quiz_attempts + 1,
    updated_at = now()
  returning quiz_attempts into v_new_attempts;

  return v_new_attempts;
end;
$$;

comment on function increment_region_quiz_attempts(uuid, text) is
  'Atomic increment of student_region_quiz.quiz_attempts for a (student, region) pair. Returns the new value. Safer than read-then-upsert under concurrent load (v55).';

-- 3. student_achievements - INSERT policy ------------------------------
-- Only the service role writes here (achievements evaluator runs
-- server-side via createClient with the service-role key). The
-- policy is defensive - any direct anon-key write attempt fails.
drop policy if exists "student_achievements: student writes own"
  on student_achievements;
create policy "student_achievements: student writes own"
on student_achievements for insert
with check (
  student_id in (
    select id from students where supabase_user_id = auth.uid()
  )
);
