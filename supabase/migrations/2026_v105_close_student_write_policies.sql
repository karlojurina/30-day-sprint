-- ============================================================
-- v105: students read their own lesson completions, discount requests and
--       badges, and no longer write them. Only the server writes them.
--
-- From the backend audit of 15 October
-- (_admin/prds/map-review-2026-10-15/backend_readiness.md, section 5 items
-- 1, 2 and 27; section 6 step 3). Paste the read first
-- (supabase/diagnostics/backend-readiness-read.sql): its part a shows the
-- policies this file drops. If part a shows a student INSERT, UPDATE,
-- DELETE or ALL policy under a name not listed here, this file leaves it:
-- stop and ask. It does not depend on the course switch and can run on any
-- day, before or after it.
--
-- THE BACK DOORS IT CLOSES
--   A logged-in student holds a real database session in the browser
--   (src/app/auth/complete/page.tsx), so with the app's public key they can
--   do whatever a policy allows, past every check the server makes.
--   1. student_lesson_completions, "Students can manage own lesson
--      completions" (v3), FOR ALL: insert, change or delete their own rows,
--      with any completed_at. That skips the 95% / 80% watch rule, meets
--      the 30%'s videos inside the 14 days (approval reads the same column)
--      and opens the Playbook and every badge.
--   2. discount_requests, "Students can create discount requests"
--      (schema.sql): a request with any status, "approved" included. The map
--      then shows approved, the celebration plays and the Discount Earned
--      badge is awarded.
--   3. student_achievements, "student_achievements: student writes own"
--      (v55): badge rows of their choosing, which skew the shares every
--      student sees in the corner's list.
--
-- NOTHING IN THE APP NEEDS THEM. Every write to the three tables goes
-- through the server with the service role, which row level security does
-- not apply to, or through the feedback form's function
-- submit_discount_with_feedback (v29), which runs as its owner. Checked with
-- git grep on world-engine and on main (what production runs) on
-- 16 October: the browser only reads these tables, so production's old
-- dashboard does not notice either.
--
-- WHAT THIS FILE DOES, in one transaction
--   1. Locks the three tables, waiting 5 seconds at most, so the policies it
--      records are exactly the ones it drops.
--   2. Checks it can (WHEN IT REFUSES below).
--   3. Records each policy it drops as production's own catalogue states it
--      (command, roles, using, check, comment) in v105_record.policies. The
--      schema v105_record gives anon, authenticated and service_role no
--      access. The undo puts the policies back from there: nothing is
--      retyped.
--   4. Drops them: the three above, and "Students manage own lesson
--      completions", the migration harness's spelling of the first, wherever
--      a database has it.
--   5. Adds "Students can read own lesson completions": FOR SELECT, with the
--      same using as the policy it replaces, so a student reads the same
--      rows as before.
--   6. Checks its own result, commits, and shows one row per policy.
--
-- WHAT STAYS
--   Students read their own completions, discount requests and badges as
--   before. The team's policies are not touched. The server and the crons
--   write as before. The feedback form still creates a request (step 2
--   checks that its function does not need the insert policy).
--
-- WHEN IT REFUSES, changing nothing (every message ends "Nothing was changed.")
--   * One of the three tables is missing, or has row level security off.
--   * A policy named "Students can read own lesson completions" exists and
--     this file did not make it.
--   * The feedback form's function would stop working without the insert
--     policy: it is not security definer, or row level security applies to
--     its owner on discount_requests.
--
-- WHEN THE TABLES ARE BUSY
--   Another session holds one of the three tables for more than 5 seconds:
--   "Another session held a table v105 changes for more than 5 seconds
--   (...), so v105 did not start. Nothing was changed. Paste it again in a
--   minute." While the file runs (well under a second) the app's reads and
--   writes of the three tables wait for it.
--
-- UNDO: supabase/undo/2026_v105_undo.sql. It removes the policy this file
-- added and puts back every policy it dropped, exactly as recorded. It
-- opens the back doors again.
--
-- Re-runnable: run again, it finds nothing to drop or add, changes nothing,
-- and says so. One transaction: a stop anywhere changes nothing.
-- ============================================================

begin;

-- The record keeps each using and check as Postgres writes them under this
-- path, and the undo reads them back under the same one.
set local search_path = public;

-- ─────────────── The lock ───────────────
--
-- Dropping or adding a policy takes its table's strongest lock. Taking the
-- three first, in one statement, means no statement below waits half way,
-- and no other session changes a policy between the record and the drop. A
-- table that does not exist is left to step 1, which names it.

set local lock_timeout = '5s';

do $lock$
declare
  v_list text;
begin
  perform set_config('v105.dropped', '0', false);
  perform set_config('v105.added', 'no', false);
  select string_agg(format('public.%I', t), ', ' order by o) into v_list
    from unnest(array['student_lesson_completions', 'discount_requests', 'student_achievements'])
         with ordinality as x(t, o)
   where to_regclass('public.' || t) is not null;
  if v_list is not null then
    execute 'lock table ' || v_list || ' in access exclusive mode';
  end if;
exception when lock_not_available or deadlock_detected then
  raise exception 'Another session held a table v105 changes for more than 5 seconds (%), so v105 did not start. Nothing was changed. Paste it again in a minute.', sqlerrm
    using errcode = sqlstate;
end
$lock$;

-- ─────────────── 1. It can ───────────────

do $guard$
declare
  v_found text;
  v_fn    record;
begin
  select string_agg(t, ', ' order by o) into v_found
    from unnest(array['student_lesson_completions', 'discount_requests', 'student_achievements'])
         with ordinality as x(t, o)
   where to_regclass('public.' || t) is null;
  if v_found is not null then
    raise exception 'v105 needs these tables and they are missing: %. Nothing was changed.', v_found;
  end if;

  select string_agg(relname::text, ', ' order by relname) into v_found
    from pg_class
   where oid in ('public.student_lesson_completions'::regclass, 'public.discount_requests'::regclass,
                 'public.student_achievements'::regclass)
     and not relrowsecurity;
  if v_found is not null then
    raise exception 'Row level security is off on %, so no policy limits what a student does there, and this file was written for it on. Look at it before going on. Nothing was changed.', v_found;
  end if;

  if to_regclass('v105_record.policies') is null
     and exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'student_lesson_completions'
                    and policyname = 'Students can read own lesson completions') then
    raise exception 'A policy named "Students can read own lesson completions" is already on student_lesson_completions, and v105 did not make it. Nothing was changed.';
  end if;

  -- The feedback form creates its request through
  -- submit_discount_with_feedback (v29), called with the student's own
  -- session. Without the insert policy that still works when the function is
  -- security definer and its owner is a superuser, bypasses row level
  -- security, or owns discount_requests with row level security not forced.
  select p.prosecdef, r.rolname, r.rolsuper, r.rolbypassrls,
         p.proowner = c.relowner as owns_table, c.relforcerowsecurity
    into v_fn
    from pg_proc p
    join pg_roles r on r.oid = p.proowner
    cross join pg_class c
   where p.oid = to_regprocedure('public.submit_discount_with_feedback(uuid, jsonb)')
     and c.oid = 'public.discount_requests'::regclass;
  if found then
    if not v_fn.prosecdef then
      raise exception 'submit_discount_with_feedback is not security definer, so the feedback form creates its request with the student''s own rights and needs the insert policy this file drops. Nothing was changed.';
    end if;
    if not (v_fn.rolsuper or v_fn.rolbypassrls or (v_fn.owns_table and not v_fn.relforcerowsecurity)) then
      raise exception 'submit_discount_with_feedback runs as %, and row level security applies to that role on discount_requests, so the feedback form would stop working without the insert policy this file drops. Nothing was changed.', v_fn.rolname;
    end if;
  end if;
end
$guard$;

-- ─────────────── 2. The record ───────────────

create schema if not exists v105_record;
revoke all on schema v105_record from public, anon, authenticated, service_role;

create table if not exists v105_record.policies (
  tablename   name        not null,
  policyname  name        not null,
  permissive  text        not null,
  roles       name[]      not null,
  cmd         text        not null,
  qual        text,
  with_check  text,
  description text,
  dropped_at  timestamptz not null default now(),
  primary key (tablename, policyname)
);
revoke all on all tables in schema v105_record from public, anon, authenticated, service_role;

comment on table v105_record.policies is
  'The policies 2026_v105_close_student_write_policies.sql dropped, as the catalogue stated them. supabase/undo/2026_v105_undo.sql puts them back from here, then drops this schema.';

-- The four names, here and nowhere else. A policy recorded on an earlier run
-- keeps its first record.
insert into v105_record.policies (tablename, policyname, permissive, roles, cmd, qual, with_check, description)
select p.tablename, p.policyname, p.permissive, p.roles, p.cmd, p.qual, p.with_check,
       obj_description(pol.oid, 'pg_policy')
  from pg_policies p
  join pg_policy pol on pol.polrelid = format('public.%I', p.tablename)::regclass
                    and pol.polname = p.policyname
  join (values ('student_lesson_completions', 'Students can manage own lesson completions'),
               ('student_lesson_completions', 'Students manage own lesson completions'),
               ('discount_requests',          'Students can create discount requests'),
               ('student_achievements',       'student_achievements: student writes own')) as d(t, n)
    on p.tablename = d.t and p.policyname = d.n
 where p.schemaname = 'public'
on conflict (tablename, policyname) do nothing;

-- ─────────────── 3. The drops ───────────────
--
-- Every recorded policy that is on its table now: on a first run, what step
-- 2 just recorded; on a later run, nothing, or one put back by hand since.

do $drop$
declare
  r record;
  n int := 0;
begin
  for r in
    select k.tablename, k.policyname
      from v105_record.policies k
      join pg_policies p on p.schemaname = 'public' and p.tablename = k.tablename and p.policyname = k.policyname
     order by k.tablename, k.policyname
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
    n := n + 1;
  end loop;
  perform set_config('v105.dropped', n::text, false);
end
$drop$;

-- ─────────────── 4. Students read their own completions ───────────────

do $read$
begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'student_lesson_completions'
                    and policyname = 'Students can read own lesson completions') then
    create policy "Students can read own lesson completions"
      on public.student_lesson_completions for select
      using (student_id in (select id from public.students where supabase_user_id = auth.uid()));
    perform set_config('v105.added', 'yes', false);
  end if;
end
$read$;

-- ─────────────── 5. The result is the one intended ───────────────

do $check$
declare
  v_found text;
begin
  select string_agg(format('"%s" on %s', p.policyname, p.tablename), ', ' order by p.tablename, p.policyname) into v_found
    from pg_policies p
    join (values ('student_lesson_completions', 'Students can manage own lesson completions'),
                 ('student_lesson_completions', 'Students manage own lesson completions'),
                 ('discount_requests',          'Students can create discount requests'),
                 ('student_achievements',       'student_achievements: student writes own')) as d(t, n)
      on p.tablename = d.t and p.policyname = d.n
   where p.schemaname = 'public';
  if v_found is not null then
    raise exception 'These policies are still there after this file: %. Nothing was changed.', v_found;
  end if;

  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'student_lesson_completions'
                    and policyname = 'Students can read own lesson completions' and cmd = 'SELECT') then
    raise exception 'The policy "Students can read own lesson completions" is missing after this file, or does more than read. Nothing was changed.';
  end if;
end
$check$;

commit;

-- ─────────────── What is there now ───────────────
--
-- The first row says what this run did. Then one row per policy on the
-- three tables, and the ones v105 dropped, from its record.

select v105, "table", policy, command, roles, "using", "check"
  from (
    select 0 as o, null::text as t, null::text as n,
           case when current_setting('v105.dropped', true) <> '0' or current_setting('v105.added', true) = 'yes'
                then 'v105 ran now: ' || current_setting('v105.dropped', true)
                     || ' dropped (kept in v105_record.policies), '
                     || case when current_setting('v105.added', true) = 'yes' then '1' else '0' end || ' added.'
                else 'v105 was already in place. This run changed nothing.' end as v105,
           null::text as "table", null::text as policy, null::text as command, null::text as roles,
           null::text as "using", null::text as "check"
    union all
    select 1, p.tablename::text, p.policyname::text,
           case when p.tablename = 'student_lesson_completions' and p.policyname = 'Students can read own lesson completions'
                then 'added by v105' else 'kept' end,
           p.tablename::text, p.policyname::text, p.cmd, p.roles::text, p.qual, p.with_check
      from pg_policies p
     where p.schemaname = 'public'
       and p.tablename in ('student_lesson_completions', 'discount_requests', 'student_achievements')
    union all
    select 1, k.tablename::text, k.policyname::text, 'dropped by v105',
           k.tablename::text, k.policyname::text, k.cmd, k.roles::text, k.qual, k.with_check
      from v105_record.policies k
  ) x
 order by o, t, n;
-- EXPECT on production, first run:
--   v105 ran now: 3 dropped (kept in v105_record.policies), 1 added.
--   student_lesson_completions: "Students can manage own lesson completions"
--     ALL, dropped; "Students can read own lesson completions" SELECT, added;
--     "Team can read all lesson completions" SELECT, kept.
--   discount_requests: "Students can create discount requests" INSERT,
--     dropped; "Students can read own discount requests" SELECT and "Team
--     can manage all discount requests" ALL (team only), kept.
--   student_achievements: "student_achievements: student writes own" INSERT,
--     dropped; "student reads own" and "team reads all", both SELECT, kept.
-- Then paste the read again: part a has no student INSERT or ALL row left.
-- If the file stopped with a message ending "Nothing was changed.", it is
-- true: the whole file is one transaction. A stop on "canceling statement
-- due to lock timeout" (SQLSTATE 55P03) or "deadlock detected" (40P01) is
-- the same: nothing was changed. Paste it again in a minute.
