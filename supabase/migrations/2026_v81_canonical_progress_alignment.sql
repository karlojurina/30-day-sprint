-- ============================================================
-- v81: Align student_progress_counts view + rebuild_daily_snapshots
-- RPC on the canonical isLessonComplete formula AND l057 exclusion.
--
-- Karlo's "no single source of truth" complaint, traced to:
--   1. View counted l057 (bounty onboarding) toward sprint progress
--      — but admin surfaces use a 64-lesson denominator that
--      EXCLUDES l057. Per-student progress could exceed 100%.
--   2. snapshot-progress cron counted raw "completed_at IS NOT NULL"
--      rows — under-counts skipped lessons, over-counts compound
--      lessons that were watched but not shipped.
--   3. rebuild_daily_snapshots RPC used the same raw count. Same
--      date, same data, hitting Refresh on /admin produced a
--      different number than the nightly cron because the formulas
--      diverged. Karlo: "How is hitting Refresh changing the number?"
--
-- This migration makes the view, the RPC, AND the cron (via the
-- code change shipping alongside this) all use the SAME canonical
-- formula AND the same l057 exclusion.
--
-- Canonical "complete" — single source of truth, mirrored exactly
-- in src/lib/progress.ts isLessonComplete():
--
--   A completion row counts when AT LEAST ONE of:
--     1. skipped_at IS NOT NULL                          (skipped → path advances)
--     2. requires_action = false AND completed_at        (watch-only lesson watched)
--     3. requires_action = true AND completed_at
--        AND action_completed_at                          (compound: watch + ship)
--
-- l057 (bounty-onboarding lesson) is excluded from the numerator
-- because the platform's "sprint progress %" denominator is 64
-- (l057 is bonus, not sprint content).
--
-- Idempotent (CREATE OR REPLACE for both view and function).
-- ============================================================

-- ─────────────── 1. Update student_progress_counts view ───────────────

create or replace view public.student_progress_counts as
select
  c.student_id,
  count(*)::int as completed_count
from public.student_lesson_completions c
join public.lessons l on l.id = c.lesson_id
where
  -- v81: l057 is bounty onboarding, NOT part of the 64-lesson
  -- sprint denominator. Excluding it from the numerator keeps
  -- progress % at or below 100 for every student.
  l.id <> 'l057'
  and (
    c.skipped_at is not null
    or (l.requires_action = false and c.completed_at is not null)
    or (
      l.requires_action = true
      and c.completed_at is not null
      and c.action_completed_at is not null
    )
  )
group by c.student_id;

-- v75.28: re-assert v78's security_invoker=on hardening at the point
-- of view (re-)definition. Postgres preserves view options across
-- CREATE OR REPLACE in current versions, but stating it explicitly
-- here prevents a fresh-DB rebuild that runs v81 without v78 from
-- silently landing the pre-v78 RLS-bypass vulnerability.
alter view public.student_progress_counts set (security_invoker = on);

-- v75.28: do NOT re-grant to anon. v78 deliberately REVOKED this
-- grant after Supabase Advisor flagged it CRITICAL — anon role with
-- view access could read every student's completion counts.
-- authenticated is sufficient; the dashboard reads as a team member.
grant select on public.student_progress_counts to authenticated;

-- ─────────────── 2. Update rebuild_daily_snapshots RPC ───────────────
--
-- Both total_completions and total_completions_cohort now use the
-- canonical formula above + l057 exclusion. The active_count etc.
-- columns are unchanged.

create or replace function public.rebuild_daily_snapshots(
  p_start_date date default '2026-01-01'::date
)
returns int
language plpgsql
security definer
-- v75.28: restore explicit search_path that v80 had. Without it,
-- security definer + unqualified table references hits the
-- 'Function Search Path Mutable' anti-pattern Supabase Advisor
-- flags. Locks lookup to the public schema.
set search_path = public
as $$
declare
  v_rows int;
  v_paying_plans text[] := array['plan_4ZrwR4PmBsVsx', 'plan_fMMqxAljrzu75'];
  v_cohort_cutoff timestamptz := '2026-05-25 00:00:00+00'::timestamptz;
begin
  -- Wipe everything from start_date forward so this is idempotent
  -- and a re-run gives the same result as a fresh run.
  delete from daily_progress_snapshots where snapshot_date >= p_start_date;

  with days as (
    select generate_series(
      p_start_date,
      current_date,
      interval '1 day'
    )::date as day
  ),
  totals as (
    select (select count(*) from lessons where id <> 'l057')::int as total_lessons
  ),
  per_day as (
    select
      d.day,
      t.total_lessons,
      -- ALL paying members active on this day
      (
        select count(*) from students s
        where s.membership_status in ('active', 'past_due')
          and s.joined_at::date <= d.day
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
      -- total_completions: canonical formula, l057 excluded, date-bounded.
      (
        select count(*) from student_lesson_completions slc
        join students s on s.id = slc.student_id
        join lessons l on l.id = slc.lesson_id
        where s.membership_status in ('active', 'past_due')
          and s.joined_at::date <= d.day
          and s.whop_plan_id = any(v_paying_plans)
          and l.id <> 'l057'
          and (
            (slc.skipped_at is not null and slc.skipped_at::date <= d.day)
            or (l.requires_action = false
                and slc.completed_at is not null
                and slc.completed_at::date <= d.day)
            or (l.requires_action = true
                and slc.completed_at is not null
                and slc.action_completed_at is not null
                and slc.completed_at::date <= d.day
                and slc.action_completed_at::date <= d.day)
          )
      )::int as total_completions,

      -- COHORT paying members (first_paid_at >= launch cutoff).
      -- v75.28: NO joined_at fallback. NULL first_paid_at → excluded.
      -- Matches isInLaunchCohort in src/lib/admin/metrics-definitions.ts.
      (
        select count(*) from students s
        where s.membership_status in ('active', 'past_due')
          and s.joined_at::date <= d.day
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
      -- total_completions_cohort: same canonical+l057 formula,
      -- additionally filtered by first_paid_at >= cohort cutoff.
      (
        select count(*) from student_lesson_completions slc
        join students s on s.id = slc.student_id
        join lessons l on l.id = slc.lesson_id
        where s.membership_status in ('active', 'past_due')
          and s.joined_at::date <= d.day
          and s.first_paid_at >= v_cohort_cutoff
          and s.whop_plan_id = any(v_paying_plans)
          and l.id <> 'l057'
          and (
            (slc.skipped_at is not null and slc.skipped_at::date <= d.day)
            or (l.requires_action = false
                and slc.completed_at is not null
                and slc.completed_at::date <= d.day)
            or (l.requires_action = true
                and slc.completed_at is not null
                and slc.action_completed_at is not null
                and slc.completed_at::date <= d.day
                and slc.action_completed_at::date <= d.day)
          )
      )::int as total_completions_cohort
    from days d cross join totals t
  )
  insert into daily_progress_snapshots
    (snapshot_date,
     active_students, total_completions, avg_progress,
     active_count, joined_count, churned_count,
     active_count_cohort, joined_count_cohort, churned_count_cohort,
     avg_progress_cohort)
  select
    pd.day,
    pd.active_count,
    pd.total_completions,
    case
      when pd.active_count > 0 and pd.total_lessons > 0 then
        round(
          (pd.total_completions::numeric /
           (pd.active_count * pd.total_lessons)) * 100,
          2
        )
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
        round(
          (pd.total_completions_cohort::numeric /
           (pd.active_count_cohort * pd.total_lessons)) * 100,
          2
        )
      else 0
    end
  from per_day pd;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

grant execute on function public.rebuild_daily_snapshots(date) to authenticated;
grant execute on function public.rebuild_daily_snapshots(date) to service_role;

-- Sanity check (commented):
-- After this migration runs, the dashboard's live "Avg progress"
-- (computed from sum(completed_count) from student_progress_counts
-- divided by active_count × 64) MUST match the snapshot row's
-- avg_progress for today. They both use the canonical formula now.
