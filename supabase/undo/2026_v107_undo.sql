-- ============================================================
-- UNDO for v107 (supabase/migrations/2026_v107_feedback_function_server_only.sql)
--
-- NOT A MIGRATION. A file in supabase/undo/ is never run in sequence with
-- supabase/migrations/. This one is run by hand, and only to take v107 back.
--
-- WHAT IT DOES
--   Puts back submit_discount_with_feedback exactly as v29 wrote it, and
--   v29's grant to authenticated. A student's own session (and a team
--   member's) can call it again, and it refuses the service role. The
--   service role keeps EXECUTE, which does nothing against v29's own
--   check. anon and public stay without it; v29 refused a call with no
--   session anyway. No row changes.
--
-- ONLY WITH THE OLD ROUTE
--   From world-engine on, /api/discounts/submit-feedback calls the function
--   with its service-role client, which v29's function refuses. With that
--   code live, every student who sends the questions form after this undo
--   reads "Something went wrong saving that. Try again, or ask the team in
--   Discord." Run it only together with going back to code that calls the
--   function with the student's own session (main before Monday's merge).
--
--   It reopens the back door v107 closed: a logged-in student can make a
--   pending request with one call, past the route's checks of the first
--   payment, the deadline and the videos.
--
-- WHEN THE FUNCTION IS BUSY
--   It waits 5 seconds at most for anything it touches. A stop on
--   "canceling statement due to lock timeout" (SQLSTATE 55P03) changed
--   nothing. Paste it again in a minute.
--
-- Safe to run again: a second run writes the same function and grant.
-- v107 can run again after it.
-- ============================================================

begin;

set local lock_timeout = '5s';

-- v29's function and grant, copied from
-- supabase/migrations/2026_v29_discount_feedback.sql, section 4, unchanged.
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
  v_caller_uid uuid := auth.uid();
  v_is_team    boolean := public.current_user_is_team();
  v_owner_uid  uuid;
  v_existing   uuid;
  v_answer     jsonb;
begin
  -- Authorization: caller must be the student themselves OR a team member.
  select supabase_user_id into v_owner_uid
    from students where id = p_student_id;

  if not v_is_team and (v_caller_uid is null or v_caller_uid <> v_owner_uid) then
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

grant execute on function public.submit_discount_with_feedback(uuid, jsonb) to authenticated;

commit;

select has_function_privilege('authenticated', 'public.submit_discount_with_feedback(uuid, jsonb)', 'execute') as student_can,
       position('auth.role()' in (select prosrc from pg_proc
                                   where oid = 'public.submit_discount_with_feedback(uuid, jsonb)'::regprocedure)) = 0 as v29_body;
-- EXPECT one row: student_can true, v29_body true.
