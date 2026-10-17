-- ============================================================
-- v107: only the server calls the feedback form's database function.
--
-- From the release review of 17 October
-- (_admin/prds/map-review-2026-10-15/decisions.md, "Release integration,
-- 2026-10-17", the backend words builder's fix round).
--
-- THE BACK DOOR IT CLOSES
--   submit_discount_with_feedback (v29) writes a discount request and the
--   answers to the questions in one transaction. v29 grants it to
--   authenticated, and it checks only that the caller is the student (or a
--   team member) and that the student has no pending, approved or applied
--   request. It never looks at the first payment, the deadline or the
--   videos: POST /api/discounts/submit-feedback checks those before it calls
--   the function. A logged-in student holds a real database session in the
--   browser (src/app/auth/complete/page.tsx), so with the app's public key
--   they can call it straight (POST /rest/v1/rpc/submit_discount_with_feedback)
--   and make a pending request past every check the route makes, and past
--   the closed doors, which guard only the app's own routes (T-078). v105
--   left it open on purpose, because the route called it with the student's
--   own session.
--
-- WHAT THIS FILE DOES, in one transaction
--   1. Checks it can (WHEN IT REFUSES below).
--   2. Replaces the function. Its name, arguments, result, security definer,
--      search_path and owner stay, and so do the duplicate check and the
--      inserts, word for word. In place of v29's check of who is calling, it
--      refuses every call that is not the service role's (auth.role(), read
--      from the request's own token) with v29's sentence, "Not authorized to
--      submit feedback for this student".
--   3. Takes EXECUTE away from public, anon and authenticated, and gives it
--      to service_role. A student's call is then refused before the function
--      runs (permission denied, 42501). Step 2 is the seatbelt, should a
--      later file grant it again, as every version of rebuild_daily_snapshots
--      did until v96.
--   4. Checks its own result, commits, and shows one row.
--
-- WITH WHICH CODE: paste it on Monday, after the merge into main
--   From world-engine on (17 October) the route calls the function with its
--   service-role client and the student id it took from the student's
--   token. Before this file, v29's own check refuses that call; after it,
--   main's route, which calls with the student's session, is refused. Either
--   way the student reads "Something went wrong saving that. Try again, or
--   ask the team in Discord." and Vercel's log shows the database's
--   sentence. So it goes in between the merge into main and opening the
--   doors, while STUDENT_APP_CLOSED keeps every student out: a listed test
--   account is the only one who could meet the gap.
--
-- WHAT STAYS
--   The plain Apply (POST /api/discounts/request) writes with the service
--   role and never calls this function. The team's discount routes, the
--   tables and their policies are not touched. The owner keeps EXECUTE, but
--   a call from the SQL editor carries no request token, so the function
--   refuses it too: only the route's calls go through.
--
-- WHEN IT REFUSES, changing nothing (every message ends "Nothing was changed.")
--   * public.submit_discount_with_feedback(uuid, jsonb) is missing.
--   * auth.role() is missing (the function reads it to know the server is
--     calling).
--   * The role anon, authenticated or service_role is missing.
--
-- UNDO: supabase/undo/2026_v107_undo.sql puts back v29's function and its
-- grant to authenticated. It reopens the back door, and with world-engine's
-- route live it breaks the questions form; its header says when to use it.
--
-- Re-runnable: run again, it finds the function as it leaves it, changes
-- nothing, and says so. One transaction: a stop anywhere changes nothing.
-- ============================================================

begin;

set local lock_timeout = '5s';

-- ─────────────── 1. It can ───────────────

do $guard$
declare
  v_fn regprocedure := to_regprocedure('public.submit_discount_with_feedback(uuid, jsonb)');
  v_missing text;
begin
  perform set_config('v107.before', '', false);
  perform set_config('v107.did', '', false);
  if v_fn is null then
    raise exception 'public.submit_discount_with_feedback(uuid, jsonb) does not exist, so there is nothing to give to the server alone (v29 makes it). Nothing was changed.';
  end if;
  if to_regprocedure('auth.role()') is null then
    raise exception 'auth.role() does not exist, and the function this file writes reads it to know the server is calling. Nothing was changed.';
  end if;
  select string_agg(r, ', ' order by r) into v_missing
    from unnest(array['anon', 'authenticated', 'service_role']) as x(r)
   where not exists (select 1 from pg_roles where rolname = x.r);
  if v_missing is not null then
    raise exception 'These roles are missing: %. Nothing was changed.', v_missing;
  end if;
  -- What the function is now, to tell a first run from a second one.
  perform set_config('v107.before', (
    select md5(p.prosrc || '|' || p.prosecdef || '|' || coalesce(array_to_string(p.proconfig, ','), '')
               || '|' || coalesce(p.proacl::text, ''))
      from pg_proc p where p.oid = v_fn), false);
end
$guard$;

-- ─────────────── 2. The function, for the server only ───────────────

create or replace function public.submit_discount_with_feedback(
  p_student_id uuid,
  p_answers    jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_request_id uuid;
  v_existing   uuid;
  v_answer     jsonb;
begin
  -- v107: only the server calls this. POST /api/discounts/submit-feedback
  -- calls it with its service-role client and the student id it took from
  -- the student's own token, after it checked the first payment, the
  -- deadline and the videos. A call from a student's own session would skip
  -- all three.
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Not authorized to submit feedback for this student';
  end if;

  -- Duplicate check — refuse if any non-rejected request already exists.
  select id into v_existing
    from discount_requests
   where student_id = p_student_id
     and status in ('pending','approved','applied')
   limit 1;
  if v_existing is not null then
    raise exception 'A discount request already exists for this student';
  end if;

  -- Create the request.
  insert into discount_requests (student_id)
    values (p_student_id)
    returning id into v_request_id;

  -- Persist every supplied answer.
  for v_answer in select * from jsonb_array_elements(coalesce(p_answers, '[]'::jsonb))
  loop
    insert into discount_feedback_responses
      (discount_request_id, question_id, answer_scale, answer_choice, answer_text)
    values (
      v_request_id,
      (v_answer->>'question_id')::uuid,
      nullif(v_answer->>'answer_scale','')::int,
      nullif(v_answer->>'answer_choice',''),
      nullif(v_answer->>'answer_text','')
    );
  end loop;

  return v_request_id;
end;
$func$;

-- ─────────────── 3. Who may call it ───────────────

revoke all on function public.submit_discount_with_feedback(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.submit_discount_with_feedback(uuid, jsonb) to service_role;

-- ─────────────── 4. The result is the one intended ───────────────

do $check$
declare
  v_fn  regprocedure := to_regprocedure('public.submit_discount_with_feedback(uuid, jsonb)');
  v_now text;
  v_def boolean;
begin
  if has_function_privilege('anon', v_fn, 'execute') or has_function_privilege('authenticated', v_fn, 'execute') then
    raise exception 'A student, or a visitor with no login, can still call submit_discount_with_feedback after this file. Nothing was changed.';
  end if;
  if not has_function_privilege('service_role', v_fn, 'execute') then
    raise exception 'The service role cannot call submit_discount_with_feedback after this file, so the questions form would stop working. Nothing was changed.';
  end if;
  select p.prosecdef,
         md5(p.prosrc || '|' || p.prosecdef || '|' || coalesce(array_to_string(p.proconfig, ','), '')
             || '|' || coalesce(p.proacl::text, ''))
    into v_def, v_now
    from pg_proc p where p.oid = v_fn;
  if not v_def then
    raise exception 'submit_discount_with_feedback is not security definer after this file, so it could not write the request. Nothing was changed.';
  end if;
  perform set_config('v107.did', case when v_now = current_setting('v107.before', true) then 'there' else 'now' end, false);
end
$check$;

commit;

-- ─────────────── What is there now ───────────────

select case current_setting('v107.did', true)
         when 'now' then 'v107 ran now: only the server can call submit_discount_with_feedback. A student''s own session is refused.'
         else 'v107 was already in place. This run changed nothing.'
       end as v107,
       has_function_privilege('anon', 'public.submit_discount_with_feedback(uuid, jsonb)', 'execute') as visitor_can,
       has_function_privilege('authenticated', 'public.submit_discount_with_feedback(uuid, jsonb)', 'execute') as student_can,
       has_function_privilege('service_role', 'public.submit_discount_with_feedback(uuid, jsonb)', 'execute') as server_can;
-- EXPECT on production, first run: one row, "v107 ran now: ...", then
-- visitor_can false, student_can false, server_can true. A second paste
-- says "v107 was already in place." If the file stopped with a message
-- ending "Nothing was changed.", it is true: the whole file is one
-- transaction. A stop on "canceling statement due to lock timeout"
-- (SQLSTATE 55P03) is the same: nothing was changed. Paste it again in a
-- minute.
