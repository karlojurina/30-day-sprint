-- ============================================================
-- v92 — ONE progress predicate + the lessons v2 columns
--
-- Part of PRD 1 (the engine) for the course rebuild.
-- PRD: _admin/prds/rebuild-engine/rebuild_engine_prd.md
--
-- WHAT THIS DOES
--   1. Adds six additive, nullable/defaulted columns to `lessons` that the
--      new /world route needs (Bunny video id, duration, a progress-exclusion
--      flag and a role key).
--   2. Replaces FOUR hand-copied SQL versions of `isLessonComplete`
--      (src/lib/progress.ts:42-55) with ONE function, so the cutover has one
--      place to change instead of four.
--   3. Replaces every hardcoded 'l057' literal with the new
--      `lessons.counts_toward_progress` flag.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
--   Nothing is dropped. `day`, `duration_label`, `whop_lesson_id` and
--   `is_boss` stay until a later cleanup migration, AFTER the app has no
--   readers left (expand-and-contract).
--
-- SAFE TO RUN WHILE /dashboard IS LIVE.
--   Every output below is behaviour-identical to today for the current
--   catalog. `counts_toward_progress` is set false on l057 in this same
--   file, so `where counts_toward_progress` == the old `where id <> 'l057'`.
--
-- ⚠ THE TRAP THIS FILE IS WRITTEN AROUND — verified against production
--   on 2026-09-23. `CREATE OR REPLACE VIEW` CANNOT change a column's type,
--   and the two views need OPPOSITE treatment:
--     student_progress_counts.completed_count  is  integer  -> KEEP ::int
--     achievement_unlock_stats.unlocked_count  is  bigint   -> NEVER cast
--   Getting either wrong aborts the whole file. achievement_unlock_stats is
--   not touched here (see v93); student_progress_counts keeps its cast below.
--
-- Wrapped in an explicit transaction: the Supabase SQL editor runs a pasted
-- file as one request, but stating it makes a first-run failure leave the
-- database EXACTLY as it was. Fix and re-run; nothing is half-applied.
--
-- Idempotent: if not exists / create or replace / guarded do-blocks.
-- ============================================================

begin;

-- ─────────────── 1. lessons v2 columns (additive) ───────────────

alter table public.lessons
  -- Replaces the 'l057' literal that is copied into 4 SQL objects and 8 TS
  -- files. A lesson that does not count toward the progress denominator
  -- (today: bounty onboarding) sets this false.
  add column if not exists counts_toward_progress boolean not null default true,
  -- Replaces `lesson.id === 'l057'` / PLAYBOOK_UNLOCK_LESSON_ID style
  -- literals with a role lookup, so PRD 2 can move these roles by data.
  add column if not exists feature_key text,
  -- Bunny Stream video GUID. Null = no video recorded yet (the normal state
  -- for months while the course is being filmed).
  add column if not exists bunny_video_id text,
  -- Real runtime in seconds. `duration_label` is a display string ("14m")
  -- and cannot be used for the 95% watched threshold.
  add column if not exists duration_seconds int,
  -- Stamped when Bunny reports the encode finished. GUID set + this null
  -- means "still encoding".
  add column if not exists video_ready_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

-- One video per lesson, and one holder per role. Partial so the many NULLs
-- do not collide (the SQL equivalent of v20's duplicate-whop-id check).
create unique index if not exists lessons_bunny_video_id_key
  on public.lessons (bunny_video_id) where bunny_video_id is not null;

create unique index if not exists lessons_feature_key_key
  on public.lessons (feature_key) where feature_key is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'lessons_duration_seconds_positive_chk'
  ) then
    alter table public.lessons
      add constraint lessons_duration_seconds_positive_chk
      check (duration_seconds is null or duration_seconds > 0);
  end if;
end $$;

-- Reuses the existing helper (verified present in production 2026-09-23),
-- same pattern as the templates and lesson_notes triggers.
drop trigger if exists trg_lessons_updated_at on public.lessons;
create trigger trg_lessons_updated_at
  before update on public.lessons
  for each row execute function public.set_updated_at();

-- ─────────────── 2. Seed the new flags from today's literals ───────────────

-- l057 is bounty onboarding, excluded from the 64-lesson denominator since
-- v81. This line is what makes `where counts_toward_progress` below exactly
-- equal to the old `where l.id <> 'l057'`.
update public.lessons
   set counts_toward_progress = false
 where id = 'l057' and counts_toward_progress is distinct from false;

update public.lessons
   set feature_key = 'bounty_access'
 where id = 'l057' and feature_key is distinct from 'bounty_access';

update public.lessons
   set feature_key = 'playbook_unlock'
 where id = 'l078' and feature_key is distinct from 'playbook_unlock';

-- ─────────────── 3. THE one progress predicate ───────────────
--
-- The SQL twin of isLessonComplete() in src/lib/progress.ts:42-55.
-- Until now this formula was hand-copied into student_progress_counts (v81),
-- student_current_region (v49) and rebuild_daily_snapshots TWICE (v89) — four
-- copies that had already drifted (v49 never excluded l057).
--
-- p_as_of null  -> the live formula ("is it done now?")
-- p_as_of date  -> the date-bounded formula the snapshot RPC needs
--                  ("was it done as of that day?")
--
-- STABLE, not IMMUTABLE: timestamptz::date depends on the session TimeZone,
-- so the result is not constant across settings. Marking it immutable would
-- let the planner cache wrong answers.

create or replace function public.lesson_is_complete(
  p_requires_action     boolean,
  p_completed_at        timestamptz,
  p_action_completed_at timestamptz,
  p_skipped_at          timestamptz,
  p_as_of               date default null
)
returns boolean
language sql
stable
as $$
  select case when p_as_of is null then
      -- Live: skipped counts as done; compound lessons need BOTH halves.
      p_skipped_at is not null
      or (p_requires_action = false and p_completed_at is not null)
      or (p_requires_action = true
          and p_completed_at is not null
          and p_action_completed_at is not null)
    else
      -- Point in time: every stamp must also predate the day in question.
      (p_skipped_at is not null and p_skipped_at::date <= p_as_of)
      or (p_requires_action = false
          and p_completed_at is not null
          and p_completed_at::date <= p_as_of)
      or (p_requires_action = true
          and p_completed_at is not null
          and p_action_completed_at is not null
          and p_completed_at::date <= p_as_of
          and p_action_completed_at::date <= p_as_of)
  end;
$$;

comment on function public.lesson_is_complete(boolean, timestamptz, timestamptz, timestamptz, date)
  is 'Canonical "is this lesson done?" predicate. SQL twin of isLessonComplete() in src/lib/progress.ts. Changing one without the other is a bug.';

-- ─────────────── 4. student_progress_counts ───────────────
--
-- ⚠ completed_count is `integer` in production. The ::int cast below is
--   LOAD-BEARING — remove it and count() returns bigint and CREATE OR
--   REPLACE VIEW fails, aborting this whole migration.

create or replace view public.student_progress_counts as
select
  c.student_id,
  count(*)::int as completed_count
from public.student_lesson_completions c
join public.lessons l on l.id = c.lesson_id
where l.counts_toward_progress          -- was: l.id <> 'l057'
  and public.lesson_is_complete(
        l.requires_action, c.completed_at, c.action_completed_at, c.skipped_at)
group by c.student_id;

-- Re-assert v78's hardening at the point of definition, exactly as v81 did:
-- a fresh-DB rebuild that ran this file without v78 would otherwise land the
-- pre-v78 RLS-bypass. Do NOT grant to anon — v78 revoked it after Supabase
-- Advisor flagged it CRITICAL.
alter view public.student_progress_counts set (security_invoker = on);
grant select on public.student_progress_counts to authenticated;
revoke select on public.student_progress_counts from anon;

-- ─────────────── 5. student_current_region ───────────────
--
-- TWO changes, both behaviour-preserving TODAY:
--
-- (a) Orders by regions.order_num instead of region_id text. v49's header
--     admits it relied on 'r4' > 'r3' sorting alphabetically. That breaks the
--     moment an area id has two digits ('a10' < 'a9'), which is exactly what
--     the 8-area catalog introduces. r1..r4 sort identically either way, so
--     this changes nothing today and is correct after cutover.
--
-- (b) Uses the shared predicate.
--
--     The new join is SAFE under this view's `security_invoker = on` (set by
--     v78): `regions` has RLS enabled (v3:36) with policy "Authenticated can
--     read regions" USING (auth.uid() is not null) — the same shape as the
--     `lessons` policy v78 already verified this view's other join against.
--     Team and student callers both read every region row; service_role
--     bypasses RLS. So the join cannot silently drop students.
--
-- DELIBERATELY NOT CHANGED: this view still counts l057, unlike
-- student_progress_counts. The two have diverged since v81 and it is
-- tempting to "fix" here — but l057 is the bounty-access claim, and the
-- students who claim it without finishing other r4 lessons would silently
-- drop a region in every admin list. That is a live-numbers change with no
-- engine benefit. It stays a cutover decision.

create or replace view public.student_current_region as
select distinct on (c.student_id)
  c.student_id,
  l.region_id as current_region
from public.student_lesson_completions c
join public.lessons l on l.id = c.lesson_id
join public.regions r on r.id = l.region_id
where public.lesson_is_complete(
        l.requires_action, c.completed_at, c.action_completed_at, c.skipped_at)
order by c.student_id, r.order_num desc;

alter view public.student_current_region set (security_invoker = on);
grant select on public.student_current_region to authenticated;
-- v49 granted anon; v78's hardening intent says otherwise. Stated explicitly.
revoke select on public.student_current_region from anon;

-- ─────────────── 6. daily_progress_snapshots + the RPC ───────────────

-- Makes each snapshot row self-describing. Without it, the 64 -> ~145 lesson
-- change makes every historical avg_progress silently incomparable with no
-- record of why.
alter table public.daily_progress_snapshots
  add column if not exists total_lessons int;

comment on column public.daily_progress_snapshots.total_lessons
  is 'Denominator used for avg_progress on this date. Written by rebuild_daily_snapshots from v92. Rows written before v92 are null.';

-- Body is v89 verbatim except: the three 'l057' literals become
-- counts_toward_progress, the two copied predicates become
-- lesson_is_complete(..., d.day), and total_lessons is now persisted.
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

grant execute on function public.rebuild_daily_snapshots(date, date) to authenticated;

commit;

-- ============================================================
-- POST-CHECKS — run these after the file, paste the output back.
-- ============================================================
--
-- 1. Exactly one lesson excluded, and the two roles are stamped:
--    select id, counts_toward_progress, feature_key
--      from lessons where not counts_toward_progress or feature_key is not null;
--    EXPECT: l057 (false, bounty_access), l078 (true, playbook_unlock)
--
-- 2. Types unchanged (this is the one that would have aborted the file):
--    select table_name, column_name, data_type from information_schema.columns
--     where table_name in ('student_progress_counts','student_current_region')
--     order by table_name, ordinal_position;
--    EXPECT: completed_count integer, current_region text
--
-- 3. The views still return the same population:
--    select count(*) from student_progress_counts;   -- EXPECT 1241
--    select count(*) from student_current_region;    -- EXPECT unchanged
--
-- 4. The RPC still runs and now records its denominator:
--    select rebuild_daily_snapshots(current_date - 1, current_date);  -- EXPECT 2
--    select snapshot_date, avg_progress, total_lessons
--      from daily_progress_snapshots order by snapshot_date desc limit 3;
--    EXPECT total_lessons = 64 on the two rebuilt rows, null on older ones.
-- ============================================================
