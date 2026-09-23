-- ============================================================
-- v96 — SECURITY: lock down rebuild_daily_snapshots
--
-- ⚠ FIX FOR A LIVE, PRE-EXISTING VULNERABILITY. Run this promptly.
--
-- WHAT IS WRONG RIGHT NOW
--   public.rebuild_daily_snapshots(date, date) is SECURITY DEFINER and its
--   first act is an unconditional DELETE over a caller-supplied date range.
--   It has been granted to `authenticated` since v36 and re-granted by every
--   version since (v77, v79, v80, v81, v89, and v92). It has NEVER been
--   revoked from PUBLIC, so the Postgres default EXECUTE grant still stands
--   and the `anon` role inherits it.
--
--   That means: anyone holding the public anon key — which ships to every
--   browser in NEXT_PUBLIC_SUPABASE_ANON_KEY, with no login at all — can POST
--   to /rest/v1/rpc/rebuild_daily_snapshots with p_start_date '2026-01-01'
--   and permanently destroy 66 days of collected point-in-time analytics.
--   Every one of the ~845 logged-in students can do the same, explicitly.
--
--   This was NOT introduced by v92; v92 inherited the grant line from v89.
--   It is fixed here because it is real, it is live, and it is now known.
--
-- WHAT THIS CHANGES
--   1. Revokes EXECUTE from public, anon and authenticated; grants it to
--      service_role only. Verified safe: all three callers already use the
--      service-role key (admin-auth.ts:54 builds its client from
--      SUPABASE_SERVICE_ROLE_KEY; cron/snapshot-progress:116 uses
--      createServiceClient()). Nothing legitimate loses access.
--   2. Adds a 30-day floor INSIDE the function, so even a service-role caller
--      — a mis-clicked Refresh, a future script — cannot reach back into
--      collected history. Defence in depth: the revoke is the fix, this is the
--      seatbelt.
--
--   The function body is otherwise byte-identical to v92's.
--
-- WHY NOT ALSO THE OTHER SECURITY DEFINER FUNCTIONS
--   Five others exist. record_lesson_heartbeat already revokes public+anon
--   (v93). submit_discount_with_feedback and increment_region_quiz_attempts
--   genuinely need `authenticated` and fail closed without a session.
--   current_user_is_team() and current_user_is_stats_owner() are called from
--   INSIDE RLS policies, where revoking a role's EXECUTE turns a "no rows"
--   result into a hard error for that role — so they are deliberately left
--   alone rather than guessed at. Run diagnostics/security-definer-grants.sql
--   against production to see the real grants before touching any of them.
--
-- Idempotent. Wrapped in a transaction.
-- ============================================================

begin;

create or replace function public.rebuild_daily_snapshots(
  p_start_date date default current_date - 2,
  p_end_date   date default current_date
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows int;
  -- Keep in step with PAYING_WHOP_PLAN_IDS in src/lib/constants.ts AND
  -- supabase/diagnostics/admin-health.sql.
  v_paying_plans text[] := array['plan_4ZrwR4PmBsVsx'];
  v_cohort_cutoff timestamptz := '2026-05-25 00:00:00+00'::timestamptz;
  v_end date := least(p_end_date, current_date);
begin
  -- ── v96 GUARD ──────────────────────────────────────────────────────
  -- A hard floor on how far back a single call may reach.
  --
  -- 194 days (2026-01-01 to 2026-07-13) still carry a back-projected
  -- survivorship curve from the pre-v89 body. The 66 days from 2026-07-14
  -- onward are GENUINE point-in-time rows the nightly cron collected one at a
  -- time, and they cannot be recomputed from anything. Until now they were
  -- protected by nothing but the fact that no one had called this with a wide
  -- range since 2026-07-13 — a comment in two route files, and hope.
  --
  -- Every legitimate caller asks for 1-2 days: cron/snapshot-progress:299
  -- (now-1d), admin/rebuild-snapshots:32 (now-2d), admin/refresh-everything:102
  -- (now-2d). A 30-day floor breaks none of them.
  --
  -- RAISES rather than silently clamping. A quietly narrowed range would make
  -- this return a plausible row count for work it did not do, which is the
  -- exact failure mode this project keeps hitting.
  if p_start_date < current_date - 30 then
    raise exception
      'rebuild_daily_snapshots: refusing to rebuild from % — more than 30 days back. '
      'Days before that are collected point-in-time history that cannot be '
      'recomputed. Widening this is a deliberate, backed-up one-off: edit the '
      'guard, run it, put the guard back.', p_start_date
      using errcode = '22023';
  end if;

  if p_start_date > v_end then
    return 0;
  end if;

  -- Bounded on BOTH sides (v89). v81 deleted everything forward from
  -- p_start_date, which is what put 66 days of history at risk.
  delete from daily_progress_snapshots
   where snapshot_date >= p_start_date
     and snapshot_date <= v_end;

  with days as (
    select generate_series(p_start_date, v_end, interval '1 day')::date as day
  ),
  totals as (
    select (select count(*) from lessons where counts_toward_progress)::int as total_lessons
  ),
  per_day as (
    select
      d.day,
      t.total_lessons,
      (
        select count(*) from students s
        where s.first_paid_at::date <= d.day
          and (s.canceled_at is null or s.canceled_at::date > d.day)
          and s.whop_plan_id = any(v_paying_plans)
      )::int as active_count,
      (
        select count(*) from students s
        where s.first_paid_at::date = d.day
          and s.whop_plan_id = any(v_paying_plans)
      )::int as joined_count,
      (
        select count(*) from students s
        where s.canceled_at::date = d.day
          and s.whop_plan_id = any(v_paying_plans)
      )::int as churned_count,
      (
        select count(*) from student_lesson_completions slc
        join students s on s.id = slc.student_id
        join lessons l on l.id = slc.lesson_id
        where s.first_paid_at::date <= d.day
          and (s.canceled_at is null or s.canceled_at::date > d.day)
          and s.whop_plan_id = any(v_paying_plans)
          and l.counts_toward_progress
          and lesson_is_complete(l.requires_action, slc.completed_at,
                                 slc.action_completed_at, slc.skipped_at, d.day)
      )::int as total_completions,
      (
        select count(*) from students s
        where s.first_paid_at::date <= d.day
          and (s.canceled_at is null or s.canceled_at::date > d.day)
          and s.first_paid_at >= v_cohort_cutoff
          and s.whop_plan_id = any(v_paying_plans)
      )::int as active_count_cohort,
      (
        select count(*) from students s
        where s.first_paid_at::date = d.day
          and s.first_paid_at >= v_cohort_cutoff
          and s.whop_plan_id = any(v_paying_plans)
      )::int as joined_count_cohort,
      (
        select count(*) from students s
        where s.canceled_at::date = d.day
          and s.first_paid_at >= v_cohort_cutoff
          and s.whop_plan_id = any(v_paying_plans)
      )::int as churned_count_cohort,
      (
        select count(*) from student_lesson_completions slc
        join students s on s.id = slc.student_id
        join lessons l on l.id = slc.lesson_id
        where s.first_paid_at::date <= d.day
          and (s.canceled_at is null or s.canceled_at::date > d.day)
          and s.first_paid_at >= v_cohort_cutoff
          and s.whop_plan_id = any(v_paying_plans)
          and l.counts_toward_progress
          and lesson_is_complete(l.requires_action, slc.completed_at,
                                 slc.action_completed_at, slc.skipped_at, d.day)
      )::int as total_completions_cohort
    from days d cross join totals t
  )
  insert into daily_progress_snapshots
    (snapshot_date,
     active_students, total_completions, avg_progress,
     active_count, joined_count, churned_count,
     active_count_cohort, joined_count_cohort, churned_count_cohort,
     avg_progress_cohort,
     total_lessons)
  select
    pd.day,
    pd.active_count,
    pd.total_completions,
    case
      when pd.active_count > 0 and pd.total_lessons > 0 then
        round((pd.total_completions::numeric /
               (pd.active_count * pd.total_lessons)) * 100, 2)
      else 0
    end,
    pd.active_count,
    pd.joined_count,
    pd.churned_count,
    pd.active_count_cohort,
    pd.joined_count_cohort,
    pd.churned_count_cohort,
    case
      when pd.active_count_cohort > 0 and pd.total_lessons > 0 then
        round((pd.total_completions_cohort::numeric /
               (pd.active_count_cohort * pd.total_lessons)) * 100, 2)
      else 0
    end,
    pd.total_lessons
  from per_day pd;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

-- ─────────────── The actual fix ───────────────
--
-- CREATE OR REPLACE FUNCTION preserves existing privileges, so the replace
-- above did NOT remove anything. These four lines are what closes the hole.

revoke all on function public.rebuild_daily_snapshots(date, date) from public;
revoke all on function public.rebuild_daily_snapshots(date, date) from anon;
revoke all on function public.rebuild_daily_snapshots(date, date) from authenticated;
grant execute on function public.rebuild_daily_snapshots(date, date) to service_role;

comment on function public.rebuild_daily_snapshots(date, date) is
  'Rebuilds daily_progress_snapshots for a bounded date range. SECURITY '
  'DEFINER and DESTRUCTIVE: it deletes the range before re-deriving it. '
  'service_role ONLY (v96) — it was reachable by anon and by every student '
  'from v36 until then. Refuses any range starting more than 30 days back.';

commit;

-- ============================================================
-- POST-CHECKS — paste the output back.
-- ============================================================
--
-- 1. THE FIX. All three must be false, the last must be true:
--    select
--      has_function_privilege('anon',
--        'public.rebuild_daily_snapshots(date,date)','execute')          as anon_can,
--      has_function_privilege('authenticated',
--        'public.rebuild_daily_snapshots(date,date)','execute')          as student_can,
--      has_function_privilege('service_role',
--        'public.rebuild_daily_snapshots(date,date)','execute')          as service_can;
--    EXPECT: false, false, true
--
-- 2. The old single-argument version really is gone (v89 dropped it; if it
--    came back it would carry the old UNBOUNDED delete and its own grants):
--    select proname, pg_get_function_identity_arguments(oid)
--      from pg_proc where proname = 'rebuild_daily_snapshots';
--    EXPECT: exactly ONE row, arguments "p_start_date date, p_end_date date"
--
-- 3. It still works for the callers that matter (this WRITES two days):
--    select public.rebuild_daily_snapshots(current_date - 1, current_date);
--    EXPECT: 2
--    (Run in the SQL editor, which is service_role. If you are ever prompted
--     that permission is denied, that is check 1 working.)
--
-- 4. The guard refuses a wide range:
--    select public.rebuild_daily_snapshots('2026-01-01'::date, current_date);
--    EXPECT: ERROR "refusing to rebuild from 2026-01-01 — more than 30 days back"
--    THIS IS THE IMPORTANT ONE. Before v96 that call would have silently
--    destroyed 66 days of collected history.
--
-- 5. Nothing was lost by running this:
--    select count(*), min(snapshot_date), max(snapshot_date)
--      from daily_progress_snapshots;
--    EXPECT: the same count and the same min date as before v96.
-- ============================================================
