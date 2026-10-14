-- ============================================================
-- UNDO for v103 (supabase/migrations/2026_v103_cutover_expand.sql)
--
-- NOT A MIGRATION. A file in supabase/undo/ is never run in sequence with
-- supabase/migrations/. This one is run by hand, and only to take v103 back.
--
-- ⚠ IT REFUSES WHILE THE SWITCH IS IN PLACE, that is while admin_config
--   holds curriculum_reset_at. The live course then needs these objects.
--   Run supabase/undo/2026_v104_undo.sql first; it removes that row.
--
-- WHAT IT DOES, once the switch is not in place
--   1. Drops the trigger trg_daily_snapshots_reset_floor and its function
--      daily_snapshots_reset_floor().
--   2. Drops the view student_last_counted_completion.
--   3. Drops student_milestones.playbook_unlocked_at, regions.landmark_label
--      and regions.rail_at.
--
-- WHAT YOU LOSE
--   Whatever those three columns hold. After an undo of v104 the switch's
--   own stamps are already cleared; a stamp put on by hand (the statement at
--   the foot of supabase/diagnostics/cutover-postcheck.sql) goes with the
--   column. On the old course no code reads it. The code merged for the
--   cutover (WI-1 to WI-10) reads the view and the column: take this back
--   only together with putting the app back on a build from before it.
--
-- Safe to run again: a second run finds nothing to drop and ends in the same
-- state. v103 can be run again after it.
-- ============================================================

begin;

-- ─────────────── 0. Refuse while the switch is in place ───────────────

do $guard$
declare
  v_at text;
begin
  select value into v_at from public.admin_config where key = 'curriculum_reset_at';
  if v_at is not null then
    raise exception 'The course switch is in place since % (admin_config curriculum_reset_at), and the live course needs what v103 added. Run the undo of v104 first. Nothing was changed.', v_at;
  end if;
end
$guard$;

-- ─────────────── 1. The floor ───────────────

drop trigger if exists trg_daily_snapshots_reset_floor on public.daily_progress_snapshots;
drop function if exists public.daily_snapshots_reset_floor();

-- ─────────────── 2. The view ───────────────

drop view if exists public.student_last_counted_completion;

-- ─────────────── 3. The three columns ───────────────

alter table public.student_milestones drop column if exists playbook_unlocked_at;
alter table public.regions
  drop column if exists landmark_label,
  drop column if exists rail_at;

commit;

-- ─────────────── What is left ───────────────

select
  not exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'student_milestones'
                 and column_name = 'playbook_unlocked_at')                as playbook_column_gone,
  not exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'regions'
                 and column_name in ('landmark_label', 'rail_at'))        as area_columns_gone,
  to_regclass('public.student_last_counted_completion') is null           as view_gone,
  not exists (select 1 from pg_proc where proname = 'daily_snapshots_reset_floor') as floor_gone;
-- EXPECT one row, every column true.
-- If the file stopped with "Run the undo of v104 first", nothing was changed.
