-- ============================================================
-- v116: discount_request_events, the history of every 30% request, and
--       four columns on discount_requests for the automatic 30% (T-137,
--       the 30% applies itself; branch night/thirty-auto, 2026-10-26).
--
-- THE PROBLEM
--   Nothing in the database records the history of a 30% request. A row of
--   discount_requests holds its status now and the team member who last
--   decided it, and every step before is lost. The build this file belongs
--   to makes the student's code and attaches it to their Whop membership by
--   itself: from the request routes when the student applies, from a job
--   every 10 minutes, and from the team's buttons. Several actors then move
--   a request, and a failed attempt has to say why. The app also needs a
--   claim on the row, so exactly one actor makes a request's code, and a
--   way to say who is writing, so the history can name them.
--
-- WHAT THIS FILE DOES, in one transaction
--   1. Locks discount_requests in ACCESS EXCLUSIVE mode (and
--      discount_request_events too when an earlier run made it), each lock
--      waiting 5 seconds at most.
--   2. Checks it can (WHEN IT REFUSES below).
--   3. Adds four columns to discount_requests, empty on every row:
--      * audit_actor, audit_correlation_id and audit_team_member_id say who
--        is writing. The app sets them with each write that changes the
--        status or the code; the trigger reads them and empties them, so
--        they are always empty at rest. No check or key on them: the
--        trigger guards them.
--      * promo_claimed_at: when the app claimed the request to make its
--        code (set with the claim, emptied when the claim is let go).
--   4. Makes discount_request_events: one row per change of a request,
--      kept for the life of the request (it goes when the request or the
--      student goes, on delete cascade).
--      * event: requested, code_made, applied, rejected, reopened or
--        code_changed (the trigger's); attempt_failed, one per failed
--        attempt with its reason, or override, for an Approve anyway (the
--        app's).
--      * actor: student, auto (the request routes), job (the 10-minute
--        job), team, or sql (any other writer: the SQL editor, or a server
--        write naming no actor). team_member_id names the team member.
--      * correlation_id ties the events of one action together; detail
--        holds the code and, for a failure, its step and Whop's words.
--      * An index on (request_id, created_at desc): a request's newest
--        events first.
--   5. Row level security on it with one policy: a team member reads every
--      row (current_user_is_team(), as on discount_requests). A visitor
--      gets no privilege and a signed-in user select alone (the policy then
--      shows a team member every row and a student none). Only the service
--      role, which skips row level security, writes: the app's
--      attempt_failed and override events. TRUNCATE is taken away too,
--      which row level security does not cover.
--   6. The function discount_request_history() and the trigger of the same
--      name, before every insert or update of discount_requests, row by
--      row:
--      * an audit_actor other than student, auto, job or team stops the
--        write: "audit_actor ... is not one of student, auto, job, team.
--        Nothing was changed.";
--      * the actor: the service role's write is its audit_actor, or student
--        for an insert and sql for an update naming none; a signed-in
--        session's write is team, naming the session's own user
--        (auth.uid()) whatever member it sends; any other write (the SQL
--        editor) is sql. A team write by the service role names
--        audit_team_member_id, else applied_by when the new status is
--        applied, else reviewed_by. No other actor names a team member;
--      * the event: an insert is requested (its correlation the request's
--        own id when none is sent); a change of status is code_made
--        (approved), applied, rejected or reopened (back to pending), with
--        both statuses and the code; a change of the code alone
--        (promo_code or whop_promo_id) is code_changed, with the code
--        before and after. Any other write records nothing;
--      * an event that cannot be written never stops the request's own
--        write: the trigger raises a warning instead, and
--        supabase/diagnostics/thirty-waiting.sql part c lists the request.
--        A write that is refused (a second pending request, a status the
--        check refuses) takes its event back with it;
--      * it empties the three audit columns.
--   7. Checks its own result, commits, and shows one row.
--
-- WHAT CHANGES FOR ANYONE
--   Nothing anyone sees. From the paste on, every new request and every
--   change of a request's status or code is recorded. The build from before
--   this one writes no audit column and keeps working: its requests are
--   recorded as the student's, and its team writes (Approve, Reject, Mark
--   code applied) as sql, their team member being the row's reviewed_by or
--   applied_by. Paste it before the build that writes the columns goes
--   live: without it that build makes no code by itself, its Approve
--   answers "The 30% update isn't finished on the database (v116)." and its
--   job's runs fail. A student still reads their own requests, the four
--   new columns with them (the audit columns always empty); the history is
--   the team's.
--
-- WHEN IT REFUSES, changing nothing (every message ends "Nothing was changed.")
--   * public.discount_requests, public.students or public.team_members is
--     missing.
--   * discount_requests is not as v21 leaves it: a column the trigger reads
--     (student_id, status, promo_code, whop_promo_id, reviewed_by,
--     applied_at, applied_by) is missing, or no check on its status takes
--     exactly pending, approved, rejected and applied.
--   * auth.role() or auth.uid() is missing (the trigger reads them to know
--     who writes), or public.current_user_is_team() is (the policy reads
--     it).
--   * The role anon, authenticated or service_role is missing.
--   * A table discount_request_events exists with other columns than this
--     file makes.
--   * Its own check after the change fails.
--
-- WHEN THE TABLE IS BUSY
--   Another session holding discount_requests (or discount_request_events)
--   for more than 5 seconds stops it with "Another session held
--   public.discount_requests for more than 5 seconds (...), so v116 did not
--   start. Nothing was changed. Paste it again in a minute." While it runs
--   (well under a second) reads and writes of discount_requests wait for
--   the moment the lock is held: a student's map and Apply, and the team's
--   30% page, answer that much later. A stop on "canceling statement due to
--   lock timeout" (SQLSTATE 55P03) or "deadlock detected" (40P01) changed
--   nothing either: paste it again in a minute.
--
-- UNDO: supabase/undo/2026_v116_undo.sql. Redeploy the build from before
-- this one first, then run it: it drops the trigger, its function and the
-- four columns (the code of this build writes them), and keeps the history
-- under another name.
--
-- Re-runnable: a second run finds everything as this file leaves it,
-- changes nothing, and says so. One transaction: a stop anywhere changes
-- nothing.
-- ============================================================

-- ─────────────── 0. What the row at the end reads ───────────────
--
-- Outside the transaction, so a refusal does not roll it back: run statement
-- by statement (psql), the row after a refusal says "did not finish" instead
-- of an earlier run's words.

select set_config('v116.before', '', false), set_config('v116.did', '', false), set_config('v116.events', '', false);

begin;

set local search_path = public;
set local lock_timeout = '5s';

-- ─────────────── 1. The lock ───────────────
--
-- Before anything is read. Adding a column and a trigger take
-- discount_requests' strongest lock anyway: taken first, nothing below waits
-- half way.

do $lock$
declare
  v_table text := 'public.discount_requests';
begin
  if to_regclass('public.discount_requests') is not null then
    lock table public.discount_requests in access exclusive mode;
  end if;
  v_table := 'public.discount_request_events';
  if to_regclass('public.discount_request_events') is not null then
    lock table public.discount_request_events in access exclusive mode;
  end if;
exception when lock_not_available or deadlock_detected then
  raise exception 'Another session held % for more than 5 seconds (%), so v116 did not start. Nothing was changed. Paste it again in a minute.', v_table, sqlerrm
    using errcode = sqlstate;
end
$lock$;

-- ─────────────── 2. It can ───────────────

do $guard$
declare
  v_missing text;
  v_columns text;
begin
  select string_agg(t, ', ' order by o) into v_missing
    from unnest(array['discount_requests', 'students', 'team_members']) with ordinality as x(t, o)
   where to_regclass('public.' || t) is null;
  if v_missing is not null then
    raise exception 'v116 needs these tables and they are missing: %. Nothing was changed.', v_missing;
  end if;

  -- v21's shape: the columns the trigger reads, and the four statuses.
  select string_agg(x.c, ', ' order by x.o) into v_missing
    from unnest(array['student_id', 'status', 'promo_code', 'whop_promo_id', 'reviewed_by', 'applied_at', 'applied_by'])
         with ordinality as x(c, o)
   where not exists (select 1 from pg_attribute a
                      where a.attrelid = 'public.discount_requests'::regclass
                        and a.attname = x.c and a.attnum > 0 and not a.attisdropped);
  if v_missing is not null then
    raise exception 'discount_requests is not as v21 leaves it: these columns are missing: %. Nothing was changed.', v_missing;
  end if;
  if not exists (
    select 1
      from pg_constraint c
     where c.conrelid = 'public.discount_requests'::regclass
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) ~ '\mstatus\M'
       and (select array_agg(distinct m[1] order by m[1])
              from regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') as m)
           = array['applied', 'approved', 'pending', 'rejected']) then
    raise exception 'discount_requests is not as v21 leaves it: no check on its status takes exactly pending, approved, rejected and applied. Nothing was changed.';
  end if;

  if to_regprocedure('auth.role()') is null then
    raise exception 'auth.role() does not exist, and the trigger this file makes reads it to know the server is writing. Nothing was changed.';
  end if;
  if to_regprocedure('auth.uid()') is null then
    raise exception 'auth.uid() does not exist, and the trigger this file makes reads it to name a signed-in team member. Nothing was changed.';
  end if;
  if to_regprocedure('public.current_user_is_team()') is null then
    raise exception 'public.current_user_is_team() does not exist, and the policy on discount_request_events reads it, as the team''s policy on discount_requests does. Nothing was changed.';
  end if;
  select string_agg(r, ', ' order by r) into v_missing
    from unnest(array['anon', 'authenticated', 'service_role']) as x(r)
   where not exists (select 1 from pg_roles where rolname = x.r);
  if v_missing is not null then
    raise exception 'These roles are missing: %. Nothing was changed.', v_missing;
  end if;

  -- A table of this name that is not this file's.
  if to_regclass('public.discount_request_events') is not null then
    select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || case when a.attnotnull then ' not null' else '' end,
                      ', ' order by a.attnum)
      into v_columns
      from pg_attribute a
     where a.attrelid = 'public.discount_request_events'::regclass and a.attnum > 0 and not a.attisdropped;
    if v_columns is distinct from 'id bigint not null, request_id uuid not null, student_id uuid not null, event text not null, '
                                   'from_status text, to_status text, actor text not null, team_member_id uuid, correlation_id uuid, '
                                   'reason text, detail jsonb not null, created_at timestamp with time zone not null' then
      raise exception 'A table discount_request_events exists and is not the one this file makes (its columns: %). Nothing was changed.', v_columns;
    end if;
  end if;

  -- What is there now, to tell a first run from a second one.
  perform set_config('v116.before', md5(concat_ws('|',
    (select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod), ', ' order by a.attname)
       from pg_attribute a
      where a.attrelid = 'public.discount_requests'::regclass and a.attnum > 0 and not a.attisdropped
        and a.attname in ('audit_actor', 'audit_correlation_id', 'audit_team_member_id', 'promo_claimed_at')),
    to_regclass('public.discount_request_events')::text,
    to_regclass('public.discount_request_events_request_idx')::text,
    (select c.relrowsecurity::text || ' ' || coalesce(c.relacl::text, '') from pg_class c where c.oid = to_regclass('public.discount_request_events')),
    (select string_agg(p.policyname || ' ' || p.cmd || ' ' || p.roles::text || ' ' || coalesce(p.qual, ''), ', ')
       from pg_policies p where p.schemaname = 'public' and p.tablename = 'discount_request_events'),
    (select md5(p.prosrc || '|' || p.prosecdef || '|' || coalesce(array_to_string(p.proconfig, ','), ''))
       from pg_proc p where p.oid = to_regprocedure('public.discount_request_history()')),
    (select string_agg(pg_get_triggerdef(t.oid), ', ')
       from pg_trigger t where t.tgrelid = 'public.discount_requests'::regclass and t.tgname = 'discount_request_history'))), false);
end
$guard$;

-- ─────────────── 3. The four columns ───────────────

alter table public.discount_requests
  add column if not exists audit_actor text,
  add column if not exists audit_correlation_id uuid,
  add column if not exists audit_team_member_id uuid,
  add column if not exists promo_claimed_at timestamptz;

comment on column public.discount_requests.audit_actor is
  'v116: who is writing the row now: student, auto (the request routes), job (the 10-minute job) or team. The app sets it with a write that changes the status or the code; the trigger discount_request_history records it in discount_request_events and empties it, so it is always empty at rest. Any other value stops the write.';
comment on column public.discount_requests.audit_correlation_id is
  'v116: ties the events of one action together. Set with a write, emptied by the trigger discount_request_history.';
comment on column public.discount_requests.audit_team_member_id is
  'v116: the team member acting, on a team write the service role makes. Set with a write, emptied by the trigger discount_request_history. A signed-in session is always recorded as its own user.';
comment on column public.discount_requests.promo_claimed_at is
  'v116: when the app claimed the request to make its code (promo_code set, whop_promo_id not yet), so one actor makes it. Emptied when the claim is let go.';

-- ─────────────── 4. The history ───────────────

-- The three lists (event, actor, reason) are the app's own: src/lib/thirty-words.ts
-- holds THIRTY_EVENTS, THIRTY_ACTORS and ThirtyReason, and a client test holds
-- them equal to the lists on these lines.
create table if not exists public.discount_request_events (
  id             bigint generated always as identity primary key,
  request_id     uuid not null references public.discount_requests(id) on delete cascade deferrable initially deferred,
  student_id     uuid not null references public.students(id) on delete cascade,
  event          text not null check (event in ('requested','code_made','applied','rejected','reopened','code_changed','attempt_failed','override')),
  from_status    text,
  to_status      text,
  actor          text not null check (actor in ('student','auto','job','team','sql')),
  team_member_id uuid references public.team_members(id),
  correlation_id uuid,
  reason         text check (reason is null or reason in ('check_refused','no_membership','membership_not_active','membership_has_code','whop_no_answer','key_not_allowed','code_not_made','apply_refused','landed_elsewhere','write_failed','old_code','code_unknown')),
  detail         jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

create index if not exists discount_request_events_request_idx
  on public.discount_request_events (request_id, created_at desc);

comment on table public.discount_request_events is
  'v116: the history of every 30% request, one row per change. requested, code_made, applied, rejected, reopened and code_changed come from the trigger discount_request_history; attempt_failed (with its reason) and override from the app. Never updated or deleted by the app: a row goes with its request or its student. The team reads; the service role writes.';

-- ─────────────── 5. Who reads and writes it ───────────────

alter table public.discount_request_events enable row level security;

drop policy if exists "Team can read discount request events" on public.discount_request_events;
create policy "Team can read discount request events"
  on public.discount_request_events for select
  to authenticated
  using (public.current_user_is_team());

-- Supabase hands every new table in public to its API roles. Row level
-- security already refuses them every write here (no write policy), and a
-- visitor every read (no policy for anon); taking the privileges away too
-- covers TRUNCATE, which row level security does not (as v111 does).
revoke all on public.discount_request_events from anon;
revoke insert, update, delete, truncate, references, trigger on public.discount_request_events from authenticated;
grant select on public.discount_request_events to authenticated;

-- ─────────────── 6. The trigger ───────────────
--
-- The body is the one proved case by case on 2026-10-26, word for word
-- (_admin/prds/thirty-automatic/thirty_automatic_prd.md, V14, and its
-- probes/trigger_probe.mjs); supabase/migration-tests/v116.test.mjs runs
-- every case again on this file.

create or replace function public.discount_request_history() returns trigger language plpgsql security definer set search_path = public as $$
declare v_role text := coalesce(auth.role(), ''); v_actor text; v_team uuid; v_event text;
begin
  if new.audit_actor is not null and new.audit_actor not in ('student','auto','job','team') then
    raise exception 'audit_actor % is not one of student, auto, job, team. Nothing was changed.', new.audit_actor;
  end if;
  if v_role = 'service_role' then
    v_actor := coalesce(new.audit_actor, case when tg_op = 'INSERT' then 'student' else 'sql' end);
  elsif v_role = 'authenticated' then
    v_actor := 'team'; v_team := auth.uid();
  else
    v_actor := 'sql';
  end if;
  if v_actor = 'team' and v_role <> 'authenticated' then
    v_team := coalesce(new.audit_team_member_id, case when new.status = 'applied' then new.applied_by else new.reviewed_by end);
  end if;
  begin
    if tg_op = 'INSERT' then
      insert into discount_request_events(request_id, student_id, event, to_status, actor, team_member_id, correlation_id)
      values (new.id, new.student_id, 'requested', new.status, v_actor, v_team, coalesce(new.audit_correlation_id, new.id));
    elsif old.status is distinct from new.status then
      v_event := case new.status when 'approved' then 'code_made' when 'applied' then 'applied' when 'rejected' then 'rejected' else 'reopened' end;
      insert into discount_request_events(request_id, student_id, event, from_status, to_status, actor, team_member_id, correlation_id, detail)
      values (new.id, new.student_id, v_event, old.status, new.status, v_actor, v_team, new.audit_correlation_id,
              jsonb_build_object('promo_code', new.promo_code, 'whop_promo_id', new.whop_promo_id));
    elsif old.promo_code is distinct from new.promo_code or old.whop_promo_id is distinct from new.whop_promo_id then
      insert into discount_request_events(request_id, student_id, event, from_status, to_status, actor, team_member_id, correlation_id, detail)
      values (new.id, new.student_id, 'code_changed', old.status, new.status, v_actor, v_team, new.audit_correlation_id,
              jsonb_build_object('from', jsonb_build_object('promo_code', old.promo_code, 'whop_promo_id', old.whop_promo_id),
                                 'to', jsonb_build_object('promo_code', new.promo_code, 'whop_promo_id', new.whop_promo_id)));
    end if;
  exception when others then
    raise warning 'discount_request_history: no event for request % (%: %)', new.id, sqlstate, sqlerrm;
  end;
  new.audit_actor := null; new.audit_correlation_id := null; new.audit_team_member_id := null;
  return new;
end $$;

comment on function public.discount_request_history() is
  'v116: records each insert and each change of status or code of discount_requests in discount_request_events, with the actor and the team member, then empties the three audit columns. An event that cannot be written raises a warning and never stops the write.';

create or replace trigger discount_request_history
  before insert or update on public.discount_requests
  for each row execute function public.discount_request_history();

-- ─────────────── 7. The result is the one intended ───────────────

do $check$
declare
  v_now text;
begin
  if (select count(*) from pg_attribute a
       where a.attrelid = 'public.discount_requests'::regclass and a.attnum > 0 and not a.attisdropped
         and (a.attname, format_type(a.atttypid, a.atttypmod)) in (('audit_actor', 'text'), ('audit_correlation_id', 'uuid'),
                                                                  ('audit_team_member_id', 'uuid'),
                                                                  ('promo_claimed_at', 'timestamp with time zone'))) <> 4 then
    raise exception 'After v116 discount_requests does not have its four columns with their types. Nothing was changed.';
  end if;
  if not exists (select 1 from pg_trigger t
                  where t.tgrelid = 'public.discount_requests'::regclass and t.tgname = 'discount_request_history'
                    and t.tgenabled <> 'D'
                    and t.tgfoid = to_regprocedure('public.discount_request_history()')) then
    raise exception 'After v116 the trigger discount_request_history is not on discount_requests, or it is switched off. Nothing was changed.';
  end if;
  if not (select p.prosecdef from pg_proc p where p.oid = to_regprocedure('public.discount_request_history()')) then
    raise exception 'After v116 discount_request_history() is not security definer, so a team session could not write its events. Nothing was changed.';
  end if;
  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.discount_request_events'::regclass)
     or (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'discount_request_events') <> 1 then
    raise exception 'After v116 discount_request_events does not have row level security on with its one policy. Nothing was changed.';
  end if;
  if has_table_privilege('anon', 'public.discount_request_events', 'select')
     or has_table_privilege('anon', 'public.discount_request_events', 'insert')
     or has_table_privilege('authenticated', 'public.discount_request_events', 'insert')
     or has_table_privilege('authenticated', 'public.discount_request_events', 'update')
     or has_table_privilege('authenticated', 'public.discount_request_events', 'delete')
     or has_table_privilege('authenticated', 'public.discount_request_events', 'truncate')
     or not has_table_privilege('authenticated', 'public.discount_request_events', 'select') then
    raise exception 'After v116 a visitor or a signed-in user can do more with discount_request_events than read under its policy. Nothing was changed.';
  end if;
  if exists (select 1 from public.discount_requests
              where audit_actor is not null or audit_correlation_id is not null or audit_team_member_id is not null) then
    raise exception 'After v116 a request holds an audit column, which the trigger keeps empty at rest. Nothing was changed.';
  end if;

  v_now := md5(concat_ws('|',
    (select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod), ', ' order by a.attname)
       from pg_attribute a
      where a.attrelid = 'public.discount_requests'::regclass and a.attnum > 0 and not a.attisdropped
        and a.attname in ('audit_actor', 'audit_correlation_id', 'audit_team_member_id', 'promo_claimed_at')),
    to_regclass('public.discount_request_events')::text,
    to_regclass('public.discount_request_events_request_idx')::text,
    (select c.relrowsecurity::text || ' ' || coalesce(c.relacl::text, '') from pg_class c where c.oid = to_regclass('public.discount_request_events')),
    (select string_agg(p.policyname || ' ' || p.cmd || ' ' || p.roles::text || ' ' || coalesce(p.qual, ''), ', ')
       from pg_policies p where p.schemaname = 'public' and p.tablename = 'discount_request_events'),
    (select md5(p.prosrc || '|' || p.prosecdef || '|' || coalesce(array_to_string(p.proconfig, ','), ''))
       from pg_proc p where p.oid = to_regprocedure('public.discount_request_history()')),
    (select string_agg(pg_get_triggerdef(t.oid), ', ')
       from pg_trigger t where t.tgrelid = 'public.discount_requests'::regclass and t.tgname = 'discount_request_history')));
  perform set_config('v116.did', case when v_now = current_setting('v116.before', true) then 'there' else 'now' end, false);
  perform set_config('v116.events', (select count(*) from public.discount_request_events)::text, false);
end
$check$;

commit;

-- ─────────────── What is there now ───────────────

select case current_setting('v116.did', true)
         when 'now'   then 'v116 ran now: discount_requests has its four columns, and every change of a request is recorded in discount_request_events from here on.'
         when 'there' then 'v116 was already in place. This run changed nothing.'
         else 'v116 did not finish in this session. Nothing was changed.'
       end as v116,
       (select count(*)::int
          from information_schema.columns
         where table_schema = 'public'
           and table_name = 'discount_requests'
           and column_name in ('audit_actor', 'audit_correlation_id', 'audit_team_member_id', 'promo_claimed_at')) as new_columns,
       to_regclass('public.discount_request_events') is not null as events_table,
       (select count(*)::int
          from pg_trigger
         where tgrelid = to_regclass('public.discount_requests')
           and tgname = 'discount_request_history') as trigger_on_requests,
       nullif(current_setting('v116.events', true), '')::int as events_now,
       (select relrowsecurity from pg_class where oid = to_regclass('public.discount_request_events')) as row_level_security,
       (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'discount_request_events') as policies,
       has_table_privilege('anon', to_regclass('public.discount_request_events'), 'select') as visitor_can_read,
       has_table_privilege('authenticated', to_regclass('public.discount_request_events'), 'insert') as signed_in_can_insert,
       has_table_privilege('authenticated', to_regclass('public.discount_request_events'), 'select') as signed_in_can_select;
-- EXPECT one row. The first run: "v116 ran now: ...", new_columns 4,
-- events_table true, trigger_on_requests 1, events_now 0, then
-- row_level_security true, policies 1, visitor_can_read false,
-- signed_in_can_insert false, signed_in_can_select true (the policy then
-- lets only a team member see rows). A second paste: "v116 was already in
-- place. This run changed nothing." and the same values, events_now the
-- events recorded since. If the file stopped with a message ending
-- "Nothing was changed.", it is true: everything after the first select is
-- one transaction, and that select only empties this session's three
-- settings.
