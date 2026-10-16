-- ============================================================
-- UNDO for v105 (supabase/migrations/2026_v105_close_student_write_policies.sql)
--
-- NOT A MIGRATION. A file in supabase/undo/ is never run in sequence with
-- supabase/migrations/. This one is run by hand, and only to take v105 back.
--
-- ⚠ IT OPENS THE BACK DOORS AGAIN. Afterwards a logged-in student can write
--   their own lesson completions, discount requests and badges straight into
--   the database, as before v105. Nothing in the app needs that.
--
-- WHAT IT DOES, in one transaction
--   1. Locks the three tables, waiting 5 seconds at most.
--   2. Checks it can (WHEN IT REFUSES below).
--   3. Drops "Students can read own lesson completions", the policy v105
--      added.
--   4. Puts back every policy in v105_record.policies from its record: its
--      name, table, permissive or restrictive, command, roles, using, check
--      and comment, as production's catalogue stated them when v105 ran.
--      Nothing is retyped. A policy already back with the same definition is
--      left as it is.
--   5. Checks that each one reads back exactly as recorded, then drops the
--      schema v105_record.
--   6. Commits and shows one row per policy on the three tables.
--
-- WHEN IT REFUSES, changing nothing (every message ends "Nothing was changed.")
--   * v105_record.policies is missing: v105 has not run here, or this undo
--     already ran.
--   * A table in the record is missing.
--   * A policy it would put back is on its table already, with another
--     definition. It names it.
--   * A policy does not read back exactly as recorded.
--
-- WHEN THE TABLES ARE BUSY
--   Another session holds one of the three tables for more than 5 seconds:
--   "Another session held a table the undo of v105 changes for more than 5
--   seconds (...), so the undo did not start. Nothing was changed. Paste it
--   again in a minute."
--
-- Safe to run again: a second run refuses (the record is gone) and changes
-- nothing. v105 can run again after it.
-- ============================================================

begin;

-- v105 recorded each using and check under this path; they are read back
-- under the same one.
set local search_path = public;

-- ─────────────── The lock ───────────────

set local lock_timeout = '5s';

do $lock$
declare
  v_list text;
begin
  select string_agg(format('public.%I', t), ', ' order by o) into v_list
    from unnest(array['student_lesson_completions', 'discount_requests', 'student_achievements'])
         with ordinality as x(t, o)
   where to_regclass('public.' || t) is not null;
  if v_list is not null then
    execute 'lock table ' || v_list || ' in access exclusive mode';
  end if;
exception when lock_not_available or deadlock_detected then
  raise exception 'Another session held a table the undo of v105 changes for more than 5 seconds (%), so the undo did not start. Nothing was changed. Paste it again in a minute.', sqlerrm
    using errcode = sqlstate;
end
$lock$;

-- ─────────────── 1. It can ───────────────

do $guard$
declare
  v_found text;
begin
  if to_regclass('v105_record.policies') is null then
    raise exception 'v105_record.policies is missing: v105 has not run here, or its undo already ran. There is nothing to put back. Nothing was changed.';
  end if;

  select string_agg(distinct k.tablename::text, ', ') into v_found
    from v105_record.policies k
   where to_regclass(format('public.%I', k.tablename)) is null;
  if v_found is not null then
    raise exception 'The record names tables that are missing: %. Nothing was changed.', v_found;
  end if;

  select string_agg(format('"%s" on %s', k.policyname, k.tablename), ', ' order by k.tablename, k.policyname) into v_found
    from v105_record.policies k
    join pg_policies p on p.schemaname = 'public' and p.tablename = k.tablename and p.policyname = k.policyname
   where (p.permissive, p.roles, p.cmd, p.qual, p.with_check)
         is distinct from (k.permissive, k.roles, k.cmd, k.qual, k.with_check);
  if v_found is not null then
    raise exception 'These policies are on their tables already, with a definition other than the one v105 recorded: %. Look at them first. Nothing was changed.', v_found;
  end if;
end
$guard$;

-- ─────────────── 2. Back as recorded ───────────────

do $restore$
declare
  r      record;
  v_back text := '';
  n_back int  := 0;
begin
  drop policy if exists "Students can read own lesson completions" on public.student_lesson_completions;

  for r in select * from v105_record.policies order by tablename, policyname loop
    -- Already back, with the same definition (step 1 refused any other).
    continue when exists (select 1 from pg_policies
                           where schemaname = 'public' and tablename = r.tablename and policyname = r.policyname);
    execute format('create policy %I on public.%I as %s for %s to %s%s%s',
                   r.policyname, r.tablename, r.permissive, r.cmd,
                   (select string_agg(case when u.x = 'public' then 'public' else quote_ident(u.x::text) end, ', ' order by u.o)
                      from unnest(r.roles) with ordinality as u(x, o)),
                   case when r.qual is not null then ' using (' || r.qual || ')' else '' end,
                   case when r.with_check is not null then ' with check (' || r.with_check || ')' else '' end);
    if r.description is not null then
      execute format('comment on policy %I on public.%I is %L', r.policyname, r.tablename, r.description);
    end if;
    n_back := n_back + 1;
    v_back := v_back || '|' || r.tablename || '.' || r.policyname;
  end loop;

  perform set_config('v105undo.back', n_back::text, false);
  perform set_config('v105undo.names', v_back || '|', false);
end
$restore$;

-- ─────────────── 3. Exactly as recorded ───────────────

do $check$
declare
  v_found text;
begin
  select string_agg(format('"%s" on %s', k.policyname, k.tablename), ', ' order by k.tablename, k.policyname) into v_found
    from v105_record.policies k
    left join pg_policies p on p.schemaname = 'public' and p.tablename = k.tablename and p.policyname = k.policyname
    left join pg_policy pol on pol.polrelid = format('public.%I', k.tablename)::regclass and pol.polname = k.policyname
   where p.policyname is null
      or (p.permissive, p.roles, p.cmd, p.qual, p.with_check)
         is distinct from (k.permissive, k.roles, k.cmd, k.qual, k.with_check)
      or obj_description(pol.oid, 'pg_policy') is distinct from k.description;
  if v_found is not null then
    raise exception 'These policies did not come back exactly as recorded: %. Nothing was changed.', v_found;
  end if;

  if exists (select 1 from pg_policies
              where schemaname = 'public' and tablename = 'student_lesson_completions'
                and policyname = 'Students can read own lesson completions') then
    raise exception 'The policy "Students can read own lesson completions" is still there. Nothing was changed.';
  end if;
end
$check$;

drop schema v105_record cascade;

commit;

-- ─────────────── What is there now ───────────────

select undo, "table", policy, command, roles, "using", "check"
  from (
    select 0 as o, null::text as t, null::text as n,
           'The undo of v105 ran now: ' || current_setting('v105undo.back', true)
           || ' put back, "Students can read own lesson completions" removed, v105_record dropped.' as undo,
           null::text as "table", null::text as policy, null::text as command, null::text as roles,
           null::text as "using", null::text as "check"
    union all
    select 1, p.tablename::text, p.policyname::text,
           case when position('|' || p.tablename || '.' || p.policyname || '|' in current_setting('v105undo.names', true)) > 0
                then 'put back' else 'kept' end,
           p.tablename::text, p.policyname::text, p.cmd, p.roles::text, p.qual, p.with_check
      from pg_policies p
     where p.schemaname = 'public'
       and p.tablename in ('student_lesson_completions', 'discount_requests', 'student_achievements')
  ) x
 order by o, t, n;
-- EXPECT on production: "The undo of v105 ran now: 3 put back, ...", then
--   the three student write policies marked "put back", read exactly as part
--   a of the read showed them before v105, and every other policy "kept".
-- If the file stopped with a message ending "Nothing was changed.", it is
-- true: the whole file is one transaction. A stop on "canceling statement
-- due to lock timeout" (SQLSTATE 55P03) or "deadlock detected" (40P01) is
-- the same: nothing was changed. Paste it again in a minute.
