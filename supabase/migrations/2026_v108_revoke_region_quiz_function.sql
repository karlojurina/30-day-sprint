-- ============================================================
-- v108: only the server can call increment_region_quiz_attempts.
--
-- From the bug hunt of 19 October (_admin/prds/night-2026-10-19,
-- finding cron-3).
--
-- THE BACK DOOR IT CLOSES
--   increment_region_quiz_attempts(uuid, text) (v55) is security definer
--   and creates or raises student_region_quiz.quiz_attempts for whatever
--   student id it is handed. It never checks who is calling. No file ever
--   took EXECUTE away from it, so it kept the grant every new function
--   gets (to public, which anon and authenticated inherit, plus the API
--   roles' own grants on Supabase). Anyone holding the app's public key
--   could write any student's quiz row with one call, no login needed:
--   POST /rest/v1/rpc/increment_region_quiz_attempts. v96's header says
--   it fails closed without a session; it does not.
--   Nothing in the app calls it any more, and the new map never reads
--   student_region_quiz, so no student has seen an effect.
--
-- WHAT THIS FILE DOES, in one transaction
--   1. If the function is not there, there is nothing to close: it changes
--      nothing and says so.
--   2. Takes EXECUTE away from public, anon and authenticated, and gives it
--      to service_role, so the service role keeps what it had: on Supabase
--      it holds its own grant, which stays; on plain Postgres it held
--      EXECUTE through public, and now holds it directly.
--   3. Checks its own result, commits, and shows one row.
--
-- WHAT STAYS
--   The function, its body, its owner and its comment, every row of
--   student_region_quiz, and every other grant and policy. The owner (the
--   SQL editor) keeps EXECUTE.
--
-- WHEN IT REFUSES, changing nothing (every message ends "Nothing was changed.")
--   * The role anon, authenticated or service_role is missing.
--   * After the change a visitor or a student could still call it, or the
--     service role could not.
--
-- UNDO: supabase/undo/2026_v108_undo.sql puts back the grants v55 left,
-- exactly. It reopens the back door.
--
-- Re-runnable: run again, it finds the grants as it leaves them, changes
-- nothing, and says so. One transaction: a stop anywhere changes nothing.
-- ============================================================

begin;

set local lock_timeout = '5s';

-- ─────────────── 1 to 3. Who may call it ───────────────

do $v108$
declare
  v_fn      regprocedure := to_regprocedure('public.increment_region_quiz_attempts(uuid, text)');
  v_missing text;
  v_before  text;
  v_after   text;
begin
  perform set_config('v108.did', 'missing', false);
  if v_fn is null then
    return;
  end if;
  select string_agg(r, ', ' order by r) into v_missing
    from unnest(array['anon', 'authenticated', 'service_role']) as x(r)
   where not exists (select 1 from pg_roles where rolname = x.r);
  if v_missing is not null then
    raise exception 'These roles are missing: %. Nothing was changed.', v_missing;
  end if;

  select coalesce(p.proacl::text, '') into v_before from pg_proc p where p.oid = v_fn;

  revoke all on function public.increment_region_quiz_attempts(uuid, text) from public, anon, authenticated;
  grant execute on function public.increment_region_quiz_attempts(uuid, text) to service_role;

  if has_function_privilege('anon', v_fn, 'execute') or has_function_privilege('authenticated', v_fn, 'execute') then
    raise exception 'A visitor or a student can still call increment_region_quiz_attempts after this file. Nothing was changed.';
  end if;
  if not has_function_privilege('service_role', v_fn, 'execute') then
    raise exception 'The service role cannot call increment_region_quiz_attempts after this file. Nothing was changed.';
  end if;

  select coalesce(p.proacl::text, '') into v_after from pg_proc p where p.oid = v_fn;
  perform set_config('v108.did', case when v_after = v_before then 'there' else 'now' end, false);
end
$v108$;

commit;

-- ─────────────── What is there now ───────────────

select case current_setting('v108.did', true)
         when 'now'   then 'v108 ran now: only the server can call increment_region_quiz_attempts. A visitor and a student are refused.'
         when 'there' then 'v108 was already in place. This run changed nothing.'
         else 'increment_region_quiz_attempts does not exist, so there was nothing to close. This run changed nothing.'
       end as v108,
       has_function_privilege('anon', to_regprocedure('public.increment_region_quiz_attempts(uuid, text)'), 'execute') as visitor_can,
       has_function_privilege('authenticated', to_regprocedure('public.increment_region_quiz_attempts(uuid, text)'), 'execute') as student_can,
       has_function_privilege('service_role', to_regprocedure('public.increment_region_quiz_attempts(uuid, text)'), 'execute') as server_can;
-- EXPECT on production, first run: one row, "v108 ran now: ...", then
-- visitor_can false, student_can false, server_can true. A second paste
-- says "v108 was already in place." If the file stopped with a message
-- ending "Nothing was changed.", it is true: the whole file is one
-- transaction. A stop on "canceling statement due to lock timeout"
-- (SQLSTATE 55P03) is the same: nothing was changed. Paste it again in a
-- minute.
