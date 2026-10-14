-- ============================================================
-- v103 — the cutover, part 1 of 2: what the new code needs before the
--        switch, added beside what exists. Nothing a student sees changes.
--
-- Part of the cutover PRD (_admin/prds/cutover/cutover_prd.md, section 9.B,
-- call C1). Part 2 is 2026_v104_course_switch.sql, run on the evening.
--
-- WHAT THIS FILE DOES
--   1. student_milestones.playbook_unlocked_at (timestamptz, empty). The
--      switch stamps it for every graduate so the reset cannot take the
--      Playbook away (call C8).
--   2. regions.landmark_label (text) and regions.rail_at (numeric), both
--      empty. regions_next has them (v94, v99); the switch copies them into
--      the live table, which must have the columns first.
--   3. The view student_last_counted_completion (student_id,
--      last_completed_at): the latest completed_at of each student's done
--      lessons that count toward progress. The admin pages' activity pills
--      and the CSM read it (call C4). Hardened like its sister view
--      student_progress_counts (v78): security_invoker on, authenticated may
--      read it, anon may not.
--   4. A floor under daily_progress_snapshots: the trigger
--      trg_daily_snapshots_reset_floor and its function
--      daily_snapshots_reset_floor(). Once admin_config holds
--      curriculum_reset_at, no row dated before the switch day can be
--      deleted, changed or written. Those rows were computed from progress
--      the switch archives, so recomputing one would put a number near 0
--      on a day that had real progress.
--   5. Checks that the four are there, and ends with one row that says so.
--
-- OPERATIONAL CONSEQUENCES, stated plainly
--   1. Before the switch the floor does nothing: it finds no
--      curriculum_reset_at and lets every write through. The snapshot cron
--      and both refresh buttons work exactly as before.
--   2. After the switch, a refresh or rebuild that reaches back before the
--      switch day fails with 22023 and the sentence below, and writes
--      nothing. The callers clamp their range at the switch day (cutover WI-6),
--      so in normal use nothing reaches the floor.
--   3. The floor also covers a row that does not exist yet: a missing day
--      before the switch cannot be filled in afterwards, because there is
--      nothing left to compute it from. (The PRD named delete and update;
--      insert is added for the same reason. See the trigger in section 4.)
--   4. A curriculum_reset_at that is not a time Postgres can read makes every
--      write to daily_progress_snapshots fail until the row is fixed. Only
--      the switch writes that row, in the format 2026-10-20T18:25:00.000Z.
--
-- UNDO: supabase/undo/2026_v103_undo.sql. It refuses while the switch is in
-- place (curriculum_reset_at exists): run the undo of v104 first.
--
-- Re-runnable: every statement checks before it adds or replaces. A second
-- run changes no object and no row. Wrapped in a transaction, so it either
-- finishes or changes nothing.
-- ============================================================

begin;

-- ─────────────── 1. The Playbook stamp ───────────────

alter table public.student_milestones
  add column if not exists playbook_unlocked_at timestamptz;

comment on column public.student_milestones.playbook_unlocked_at is
  'Set by the course switch (v104) for every student who had earned the Playbook on the old course, so the reset does not lock them out. Never written by the app. v103.';

-- ─────────────── 2. The two area columns the copy needs ───────────────

alter table public.regions
  add column if not exists landmark_label text,
  add column if not exists rail_at numeric;

-- ─────────────── 3. A student's last counted lesson ───────────────
--
-- The same lessons and the same "done" as student_progress_counts (v92):
-- counts_toward_progress, and lesson_is_complete() as the one definition of
-- done. One more condition: completed_at is set. A lesson that was only
-- skipped is done, but it is not activity, and a compound lesson with its
-- second half still open is not done. Either one gives a student no row
-- here, as the PRD's tests expect.

create or replace view public.student_last_counted_completion as
select c.student_id,
       max(c.completed_at) as last_completed_at
  from public.student_lesson_completions c
  join public.lessons l on l.id = c.lesson_id
 where l.counts_toward_progress
   and c.completed_at is not null
   and public.lesson_is_complete(l.requires_action, c.completed_at, c.action_completed_at, c.skipped_at)
 group by c.student_id;

alter view public.student_last_counted_completion set (security_invoker = on);
grant select on public.student_last_counted_completion to authenticated;
revoke select on public.student_last_counted_completion from anon;

-- ─────────────── 4. The floor under the snapshot history ───────────────

create or replace function public.daily_snapshots_reset_floor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_value text;
  v_floor date;
  v_day   date;
begin
  select value into v_value from public.admin_config where key = 'curriculum_reset_at';
  if v_value is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  v_floor := (v_value::timestamptz at time zone 'UTC')::date;

  -- Each operation reads only the row it has: an insert has no old row and
  -- a delete no new one. An update is held to both dates.
  if tg_op = 'DELETE' then
    if old.snapshot_date < v_floor then v_day := old.snapshot_date; end if;
  elsif tg_op = 'INSERT' then
    if new.snapshot_date < v_floor then v_day := new.snapshot_date; end if;
  else
    if old.snapshot_date < v_floor then v_day := old.snapshot_date;
    elsif new.snapshot_date < v_floor then v_day := new.snapshot_date;
    end if;
  end if;

  if v_day is not null then
    if tg_op = 'INSERT' then
      raise exception 'daily_progress_snapshots: % is before the course switch of %. A row for it would be computed from progress that is now archived. Nothing was changed.', v_day, v_floor
        using errcode = '22023';
    end if;
    raise exception 'daily_progress_snapshots: the row for % is from before the course switch of %. It was computed from progress that is now archived and cannot be recomputed. Nothing was changed.', v_day, v_floor
      using errcode = '22023';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists trg_daily_snapshots_reset_floor on public.daily_progress_snapshots;
create trigger trg_daily_snapshots_reset_floor
  before insert or update or delete on public.daily_progress_snapshots
  for each row execute function public.daily_snapshots_reset_floor();

-- ─────────────── 5. The four are there ───────────────

do $check$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'student_milestones'
                    and column_name = 'playbook_unlocked_at') then
    raise exception 'student_milestones.playbook_unlocked_at is missing after this file. Nothing was changed.';
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'regions'
         and column_name in ('landmark_label', 'rail_at')) <> 2 then
    raise exception 'regions.landmark_label or regions.rail_at is missing after this file. Nothing was changed.';
  end if;
  if to_regclass('public.student_last_counted_completion') is null then
    raise exception 'The view student_last_counted_completion is missing after this file. Nothing was changed.';
  end if;
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.daily_progress_snapshots'::regclass
                    and tgname = 'trg_daily_snapshots_reset_floor' and not tgisinternal) then
    raise exception 'The trigger trg_daily_snapshots_reset_floor is missing after this file. Nothing was changed.';
  end if;
end
$check$;

commit;

-- ─────────────── What is there now ───────────────

select
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'student_milestones'
             and column_name = 'playbook_unlocked_at')                            as playbook_column,
  (select count(*) = 2 from information_schema.columns
    where table_schema = 'public' and table_name = 'regions'
      and column_name in ('landmark_label', 'rail_at'))                           as area_columns,
  to_regclass('public.student_last_counted_completion') is not null               as last_counted_view,
  (select coalesce(reloptions::text like '%security_invoker=on%', false)
     from pg_class where oid = 'public.student_last_counted_completion'::regclass) as view_security_invoker,
  exists (select 1 from pg_trigger
           where tgrelid = 'public.daily_progress_snapshots'::regclass
             and tgname = 'trg_daily_snapshots_reset_floor' and not tgisinternal)  as snapshot_floor,
  coalesce((select value from public.admin_config where key = 'curriculum_reset_at'),
           'not yet: the switch has not run')                                      as switch;
-- EXPECT one row: the first five columns true, and switch reading
--   "not yet: the switch has not run" until v104 has run.
-- If the file stopped with a message ending "Nothing was changed.", it is
-- true: the whole file is one transaction.
