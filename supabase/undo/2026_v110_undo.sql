-- ============================================================
-- UNDO for v110 (supabase/migrations/2026_v110_lesson_ratings_route_only.sql)
--
-- NOT A MIGRATION. A file in supabase/undo/ is never run in sequence with
-- supabase/migrations/. This one is run by hand, and only to take v110 back.
--
-- WHAT IT DOES
--   Puts back the two write policies v110 dropped from
--   student_lesson_ratings, exactly as v75 wrote them: its text below is
--   copied from supabase/migrations/2026_v75_lesson_ratings.sql unchanged,
--   each policy's drop-if-exists with it. A signed-in student can then again
--   insert and update their own ratings with their own session, past the
--   route's checks: it reopens the back door v110 closed. No row changes, and
--   the two read policies are left as they are.
--
-- WHEN THE TABLE IS BUSY
--   It waits 5 seconds at most for the table. A stop on "canceling statement
--   due to lock timeout" (SQLSTATE 55P03) changed nothing. Paste it again in
--   a minute.
--
-- Safe to run again: a second run makes the same two policies. v110 can run
-- again after it.
-- ============================================================

begin;

set local lock_timeout = '5s';

-- v75's two write policies, copied from
-- supabase/migrations/2026_v75_lesson_ratings.sql, unchanged.
drop policy if exists "students_insert_own_ratings"
  on student_lesson_ratings;
create policy "students_insert_own_ratings"
  on student_lesson_ratings
  for insert to authenticated
  with check (
    student_id in (
      select id from students where supabase_user_id = auth.uid()
    )
  );

drop policy if exists "students_update_own_ratings"
  on student_lesson_ratings;
create policy "students_update_own_ratings"
  on student_lesson_ratings
  for update to authenticated
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

commit;

select p.policyname::text as policy, p.cmd as command, p.roles::text as roles, p.qual as "using", p.with_check as "check"
  from pg_policies p
 where p.schemaname = 'public' and p.tablename = 'student_lesson_ratings'
 order by 1;
-- EXPECT four rows, as before v110: students_insert_own_ratings INSERT,
-- students_select_own_ratings SELECT, students_update_own_ratings UPDATE and
-- team_select_all_ratings SELECT.
