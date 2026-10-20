-- ============================================================
-- v110: students read their own lesson ratings and no longer write them.
--       Only the server writes them, through POST /api/student/rate-lesson.
--
-- Admin rebuild 2, D10 (_admin/prds/admin-rebuild-2/admin_rebuild_2_prd.md).
-- The live read of 20 October (live_read.json) shows the four policies v75
-- made, the two below among them, and 0 ratings.
--
-- THE BACK DOOR IT CLOSES
--   v75 gave a signed-in student two write policies on
--   student_lesson_ratings: "students_insert_own_ratings" (INSERT) and
--   "students_update_own_ratings" (UPDATE), each for their own rows. A
--   student holds a real database session in the browser, so with the app's
--   public key they could rate any lesson, finished or not, setup steps and
--   the Ad Bounty lesson included, with a comment of any length, past every
--   check the route makes. v105 closed the same kind of door on three other
--   tables and left this one.
--
-- NOTHING IN THE APP NEEDS THEM. The one writer is POST
-- /api/student/rate-lesson, which uses the service role (row level security
-- does not apply to it). The student app reads ratings only through GET
-- /api/student/data (the service role too), and the team's page through GET
-- /api/admin/lesson-feedback (the same). Checked with git grep on
-- night/a2-feedback, 20 October: no browser code writes the table.
--
-- WHAT THIS FILE DOES, in one transaction
--   1. Locks student_lesson_ratings, waiting 5 seconds at most, so nothing
--      writes a rating between the check and the drops.
--   2. Checks it can (WHEN IT REFUSES below).
--   3. Drops the two policies, where they are.
--   4. Checks its own result: no policy left on the table writes, for anyone.
--      Commits, and shows one row per policy.
--
-- WHAT STAYS
--   "students_select_own_ratings": a student reads their own ratings.
--   "team_select_all_ratings": the team reads every rating.
--   The table, its rows, its keys, its trigger and every grant.
--
-- WHEN IT REFUSES, changing nothing (every message ends "Nothing was changed.")
--   * student_lesson_ratings is missing, or has row level security off.
--   * After the drops another policy still writes to the table (INSERT,
--     UPDATE, DELETE or ALL), under a name this file does not know. It names
--     it: look at it before going on.
--
-- WHEN THE TABLE IS BUSY
--   Another session holds student_lesson_ratings for more than 5 seconds:
--   "Another session held student_lesson_ratings for more than 5 seconds
--   (...), so v110 did not start. Nothing was changed. Paste it again in a
--   minute."
--
-- UNDO: supabase/undo/2026_v110_undo.sql puts the two policies back as v75
-- wrote them. It opens the back door again.
--
-- Re-runnable: run again, it finds nothing to drop, changes nothing, and says
-- so. One transaction: a stop anywhere changes nothing.
-- ============================================================

begin;

set local lock_timeout = '5s';

-- ─────────────── 1. The lock ───────────────

do $lock$
begin
  perform set_config('v110.dropped', '0', false);
  if to_regclass('public.student_lesson_ratings') is not null then
    lock table public.student_lesson_ratings in access exclusive mode;
  end if;
exception when lock_not_available or deadlock_detected then
  raise exception 'Another session held student_lesson_ratings for more than 5 seconds (%), so v110 did not start. Nothing was changed. Paste it again in a minute.', sqlerrm
    using errcode = sqlstate;
end
$lock$;

-- ─────────────── 2 to 4. The two write policies go ───────────────

do $v110$
declare
  v_rls     boolean;
  v_left    text;
  v_dropped int := 0;
begin
  select c.relrowsecurity into v_rls
    from pg_class c
   where c.oid = to_regclass('public.student_lesson_ratings');
  if v_rls is null then
    raise exception 'student_lesson_ratings is missing, so there is nothing for v110 to close. Nothing was changed.';
  end if;
  if not v_rls then
    raise exception 'Row level security is off on student_lesson_ratings, so no policy limits what a student does there, and this file was written for it on. Look at it before going on. Nothing was changed.';
  end if;

  if exists (select 1 from pg_policies
              where schemaname = 'public' and tablename = 'student_lesson_ratings'
                and policyname = 'students_insert_own_ratings') then
    drop policy "students_insert_own_ratings" on public.student_lesson_ratings;
    v_dropped := v_dropped + 1;
  end if;
  if exists (select 1 from pg_policies
              where schemaname = 'public' and tablename = 'student_lesson_ratings'
                and policyname = 'students_update_own_ratings') then
    drop policy "students_update_own_ratings" on public.student_lesson_ratings;
    v_dropped := v_dropped + 1;
  end if;

  select string_agg(format('"%s" (%s)', policyname, cmd), ', ' order by policyname) into v_left
    from pg_policies
   where schemaname = 'public' and tablename = 'student_lesson_ratings'
     and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL');
  if v_left is not null then
    raise exception 'These policies still write to student_lesson_ratings after this file: %. v110 knows only the two v75 made. Look at them before going on. Nothing was changed.', v_left;
  end if;

  perform set_config('v110.dropped', v_dropped::text, false);
end
$v110$;

commit;

-- ─────────────── What is there now ───────────────
--
-- The first row says what this run did, then one row per policy left on the
-- table.

select v110, policy, command, roles, "using", "check"
  from (
    select 0 as o, null::text as n,
           case when current_setting('v110.dropped', true) <> '0'
                then 'v110 ran now: ' || current_setting('v110.dropped', true)
                     || ' dropped. Students read their own ratings and write none; the server writes them.'
                else 'v110 was already in place. This run changed nothing.' end as v110,
           null::text as policy, null::text as command, null::text as roles,
           null::text as "using", null::text as "check"
    union all
    select 1, p.policyname::text, 'kept', p.policyname::text, p.cmd, p.roles::text, p.qual, p.with_check
      from pg_policies p
     where p.schemaname = 'public' and p.tablename = 'student_lesson_ratings'
  ) x
 order by o, n;
-- EXPECT on production, first run: "v110 ran now: 2 dropped. ...", then two
-- rows, both kept and both SELECT: students_select_own_ratings and
-- team_select_all_ratings. A second paste says "v110 was already in place."
-- If the file stopped with a message ending "Nothing was changed.", it is
-- true: the whole file is one transaction. A stop on "canceling statement due
-- to lock timeout" (SQLSTATE 55P03) or "deadlock detected" (40P01) is the
-- same: nothing was changed. Paste it again in a minute.
