-- ============================================================
-- UNDO for v108 (supabase/migrations/2026_v108_revoke_region_quiz_function.sql)
--
-- NOT A MIGRATION. A file in supabase/undo/ is never run in sequence with
-- supabase/migrations/. This one is run by hand, and only to take v108 back.
--
-- WHAT IT DOES
--   Puts back the grants on increment_region_quiz_attempts exactly as v55
--   left them. v55 wrote no grant: the function got the ones every new
--   function gets in this database (Postgres's grant to public and, on
--   Supabase, the API roles' own). CREATE OR REPLACE keeps a function's
--   grants, so the undo drops the function and makes it again from v55's
--   own text, copied below unchanged, with its comment: it comes back with
--   v55's body, owner (the role running this file, as v55's was) and
--   grants. No row changes. Nothing in the database calls the function, so
--   nothing depends on it; were anything to, the drop would stop and change
--   nothing.
--
--   It reopens the back door v108 closed: anyone holding the app's public
--   key can again write any student's quiz row with one call.
--
--   Run it where v108 found no function, and it makes v55's function.
--
-- WHEN THE FUNCTION IS BUSY
--   It waits 5 seconds at most for anything it touches. A stop on
--   "canceling statement due to lock timeout" (SQLSTATE 55P03) changed
--   nothing. Paste it again in a minute.
--
-- Safe to run again: a second run makes the same function with the same
-- grants. v108 can run again after it.
-- ============================================================

begin;

set local lock_timeout = '5s';

drop function if exists public.increment_region_quiz_attempts(uuid, text);

-- v55's function and comment, copied from
-- supabase/migrations/2026_v55_audit_security_cleanup.sql, section 2,
-- unchanged.
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

commit;

select has_function_privilege('anon', 'public.increment_region_quiz_attempts(uuid, text)', 'execute') as visitor_can,
       has_function_privilege('authenticated', 'public.increment_region_quiz_attempts(uuid, text)', 'execute') as student_can,
       has_function_privilege('service_role', 'public.increment_region_quiz_attempts(uuid, text)', 'execute') as server_can;
-- EXPECT one row: visitor_can true, student_can true, server_can true, as
-- before v108.
