-- ============================================================
-- v29: Discount feedback form (6 questions on the discount Apply flow)
--
-- Spec: lovro-brief/05-discount-feedback-form.md.
--
-- Two new tables plus an RPC function that atomically inserts the
-- discount_requests row + N response rows in a single transaction so a
-- partial failure can't leave an orphaned request without feedback.
--
-- Idempotent — re-running adds nothing on top of existing rows.
-- ============================================================


-- ─────────────── 1. Question definitions ───────────────

create table if not exists discount_feedback_questions (
  id            uuid primary key default gen_random_uuid(),
  order_num     int  not null,
  question_text text not null,
  question_type varchar(16) not null check (
    question_type in ('scale','multi_choice','open_text')
  ),
  options       jsonb,
  scale_min     int,
  scale_max     int,
  is_required   boolean not null default false,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

create index if not exists idx_dfq_active_order
  on discount_feedback_questions(is_active, order_num);

alter table discount_feedback_questions enable row level security;

drop policy if exists "Team reads feedback questions" on discount_feedback_questions;
create policy "Team reads feedback questions"
  on discount_feedback_questions for select
  using (public.current_user_is_team());

-- Students need to read the question definitions to render the form.
drop policy if exists "Students read active feedback questions"
  on discount_feedback_questions;
create policy "Students read active feedback questions"
  on discount_feedback_questions for select
  using (is_active = true and auth.uid() is not null);

drop policy if exists "Founders/admins write feedback questions"
  on discount_feedback_questions;
create policy "Founders/admins write feedback questions"
  on discount_feedback_questions for all
  using (exists (
    select 1 from team_members
    where id = auth.uid() and role in ('founder','admin')
  ))
  with check (exists (
    select 1 from team_members
    where id = auth.uid() and role in ('founder','admin')
  ));


-- ─────────────── 2. Responses ───────────────

create table if not exists discount_feedback_responses (
  id                  uuid primary key default gen_random_uuid(),
  discount_request_id uuid not null
    references discount_requests(id) on delete cascade,
  question_id         uuid not null
    references discount_feedback_questions(id),
  answer_scale        int,
  answer_choice       text,
  answer_text         text,
  created_at          timestamptz not null default now()
);

create index if not exists idx_dfr_request
  on discount_feedback_responses(discount_request_id);
create index if not exists idx_dfr_question
  on discount_feedback_responses(question_id);

alter table discount_feedback_responses enable row level security;

drop policy if exists "Team reads feedback responses"
  on discount_feedback_responses;
create policy "Team reads feedback responses"
  on discount_feedback_responses for select
  using (public.current_user_is_team());

-- Inserts happen exclusively through the RPC function which runs with
-- security definer privileges — no direct INSERT policy for students.

-- ─────────────── 3. Seed the 6 questions ───────────────

insert into discount_feedback_questions
  (order_num, question_text, question_type, options, scale_min, scale_max, is_required)
values
  (1,
   'On a scale of 1-10, how likely are you to recommend EcomTalent to a friend?',
   'scale', null, 1, 10, true),
  (2,
   'Has the pace of the program felt right?',
   'multi_choice',
   '["Way too fast","A bit too fast","Just right","A bit too slow","Way too slow"]'::jsonb,
   null, null, true),
  (3,
   'How would you rate the feedback you''ve gotten from the coaches on your ads?',
   'multi_choice',
   '["Haven''t gotten feedback yet","Not helpful","Somewhat helpful","Very helpful","Game-changing"]'::jsonb,
   null, null, true),
  (4,
   'What''s been your biggest win in the program so far?',
   'open_text', null, null, null, false),
  (5,
   'What''s been the most frustrating or confusing part?',
   'open_text', null, null, null, false),
  (6,
   'If you could change ONE thing about the program, what would it be?',
   'open_text', null, null, null, false)
on conflict do nothing;


-- ─────────────── 4. Atomic submit function ───────────────
-- Inserts the discount_requests row + every response in one transaction.
-- Called from the student-facing submit endpoint via supabase.rpc.
-- Returns the inserted request id.
--
-- The student's auth.uid() must match the student row's
-- supabase_user_id, OR the caller must be a team member.
--
-- answers is a jsonb array of objects:
--   [{ "question_id": "...", "answer_scale": 8 },
--    { "question_id": "...", "answer_choice": "Just right" },
--    { "question_id": "...", "answer_text": "..." }]
--
-- Each row gets exactly one of (scale | choice | text) populated.

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
