-- ============================================================
-- PRD 1 · POST-CHECKS for migrations v92–v95
--
-- Run this AFTER all four files have been applied. Read-only: it writes
-- nothing and locks nothing, so it is safe to run any time, repeatedly.
--
-- WHY THIS EXISTS. "The migration ran without an error" and "the migration
-- was correct" are different claims. v92 rewrote two views and a function
-- that every admin number is computed from; a file that executes cleanly can
-- still have quietly moved a student's progress. This checks the second claim.
--
-- Read the VERDICT column. Anything that is not PASS or INFO needs attention
-- before more work lands on top.
-- ============================================================

with checks(n, check_name, expected, actual) as (

-- ─────────────── v92 · the predicate + the lessons v2 columns ───────────────
select 1, 'v92 · exactly one lesson is excluded from progress', '1',
  (select count(*)::text from lessons where not counts_toward_progress)
union all
select 2, 'v92 · ...and it is l057 (bounty access)', 'l057',
  coalesce((select string_agg(id, ',' order by id) from lessons where not counts_toward_progress), '(none)')
union all
select 3, 'v92 · feature_key bounty_access holder', 'l057',
  coalesce((select string_agg(id, ',') from lessons where feature_key = 'bounty_access'), '(none)')
union all
select 4, 'v92 · feature_key playbook_unlock holder', 'l078',
  coalesce((select string_agg(id, ',') from lessons where feature_key = 'playbook_unlock'), '(none)')
union all
select 5, 'v92 · all six v2 columns exist on lessons', '6',
  (select count(*)::text from information_schema.columns
    where table_schema='public' and table_name='lessons'
      and column_name in ('counts_toward_progress','feature_key','bunny_video_id',
                          'duration_seconds','video_ready_at','updated_at'))
union all
-- THE TRAP. CREATE OR REPLACE VIEW cannot change a column's type, so these two
-- views need OPPOSITE treatment. If either of the next three rows is wrong, a
-- later migration will abort and some admin number is already lying.
select 6, 'v92 · TYPE TRAP · student_progress_counts.completed_count', 'integer',
  coalesce((select data_type from information_schema.columns
    where table_name='student_progress_counts' and column_name='completed_count'), '(missing)')
union all
select 7, 'v92 · student_progress_counts is security_invoker=on', 'security_invoker=on',
  coalesce((select array_to_string(reloptions, ',') from pg_class where relname='student_progress_counts'), '(none)')
union all
select 8, 'v92 · student_current_region is security_invoker=on', 'security_invoker=on',
  coalesce((select array_to_string(reloptions, ',') from pg_class where relname='student_current_region'), '(none)')
union all
select 9, 'v92 · predicate is STABLE, not IMMUTABLE (timezone-dependent)', 's',
  coalesce((select provolatile::text from pg_proc where proname='lesson_is_complete'), '(missing)')
union all
select 10, 'v92 · snapshots gained total_lessons', '1',
  (select count(*)::text from information_schema.columns
    where table_name='daily_progress_snapshots' and column_name='total_lessons')
union all
select 11, 'v92 · updated_at trigger on lessons', '1',
  (select count(*)::text from pg_trigger where tgname='trg_lessons_updated_at' and not tgisinternal)
union all
-- v78 hardening must have survived the view replace.
select 12, 'v92 · anon CANNOT read student_progress_counts', 'false',
  has_table_privilege('anon','public.student_progress_counts','select')::text
union all
select 13, 'v92 · authenticated CAN read student_progress_counts', 'true',
  has_table_privilege('authenticated','public.student_progress_counts','select')::text
union all
select 14, 'v92 · anon CANNOT read student_current_region', 'false',
  has_table_privilege('anon','public.student_current_region','select')::text

-- ─────────────── v93 · watch telemetry ───────────────
union all
select 20, 'v93 · student_lesson_watch exists', '1',
  (select count(*)::text from information_schema.tables
    where table_schema='public' and table_name='student_lesson_watch')
union all
select 21, 'v93 · it has exactly 2 policies', '2',
  (select count(*)::text from pg_policies where tablename='student_lesson_watch')
union all
-- The ABSENCE of a write policy is the security model. If this is not 0, a
-- student can forge watch rows from the browser console.
select 22, 'v93 · SECURITY · zero write policies (no client write path)', '0',
  (select count(*)::text from pg_policies where tablename='student_lesson_watch' and cmd <> 'SELECT')
union all
select 23, 'v93 · RLS is enabled on it', 'true',
  coalesce((select relrowsecurity::text from pg_class where relname='student_lesson_watch'), '(missing)')
union all
select 24, 'v93 · TYPE TRAP · achievement_unlock_stats.unlocked_count', 'bigint',
  coalesce((select data_type from information_schema.columns
    where table_name='achievement_unlock_stats' and column_name='unlocked_count'), '(missing)')
union all
select 25, 'v93 · TYPE TRAP · achievement_unlock_stats.total_count', 'bigint',
  coalesce((select data_type from information_schema.columns
    where table_name='achievement_unlock_stats' and column_name='total_count'), '(missing)')
union all
select 26, 'v93 · achievement_unlock_stats keeps security_invoker=false (deliberate, see v78)', 'security_invoker=false',
  coalesce((select array_to_string(reloptions, ',') from pg_class where relname='achievement_unlock_stats'), '(none)')
union all
select 27, 'v93 · SECURITY · anon CANNOT execute the heartbeat RPC', 'false',
  has_function_privilege('anon','public.record_lesson_heartbeat(text,numeric,numeric,numeric,boolean)','execute')::text
union all
select 28, 'v93 · authenticated CAN execute it', 'true',
  has_function_privilege('authenticated','public.record_lesson_heartbeat(text,numeric,numeric,numeric,boolean)','execute')::text

-- ─────────────── v94 · the staging catalog ───────────────
union all
select 40, 'v94 · 8 areas', '8', (select count(*)::text from regions_next)
union all
select 41, 'v94 · 145 lessons', '145', (select count(*)::text from lessons_next)
union all
select 42, 'v94 · 144 count toward progress', '144',
  (select count(*)::text from lessons_next where counts_toward_progress)
union all
select 43, 'v94 · area sizes', '8,10,22,22,25,22,22,14',
  (select string_agg(c::text, ',' order by o)
     from (select r.order_num o, count(l.id) c from regions_next r
             join lessons_next l on l.region_id = r.id group by r.order_num) t)
union all
select 44, 'v94 · exactly one discount gate', 'a5l25',
  coalesce((select string_agg(id, ',') from lessons_next where is_gate), '(none)')
union all
select 45, 'v94 · 9 action items', '9',
  (select count(*)::text from lessons_next where requires_action)
union all
select 46, 'v94 · every action item has a brief', '0',
  (select count(*)::text from lessons_next where requires_action and action_brief is null)
union all
select 47, 'v94 · global sort_order is 1..145, contiguous, unique', '1|145|145',
  (select min(sort_order)||'|'||max(sort_order)||'|'||count(distinct sort_order) from lessons_next)
union all
select 48, 'v94 · the Ad Bounty pond', 'a7l22|setup|false',
  coalesce((select id||'|'||type||'|'||counts_toward_progress::text
              from lessons_next where feature_key='bounty_access'), '(none)')

-- ─────────────── v95 · the one deadline ───────────────
union all
select 60, 'v95 · discount_window_days is set', '14',
  coalesce((select value from admin_config where key='discount_window_days'), '(missing)')
union all
select 61, 'v95 · discount_requests.gate_lesson_id exists and is nullable', 'text|YES',
  coalesce((select data_type||'|'||is_nullable from information_schema.columns
    where table_name='discount_requests' and column_name='gate_lesson_id'), '(missing)')

-- ─────────────── THE LIVE APP MUST NOT HAVE MOVED ───────────────
union all
select 80, 'LIVE · lessons table still has its 65 rows', '65',
  (select count(*)::text from lessons)
union all
select 81, 'LIVE · regions table still has its 4 rows', '4',
  (select count(*)::text from regions)
union all
select 82, 'LIVE · no lesson_next row leaked into the live catalog', '0',
  (select count(*)::text from lessons where id like 'a_l%')

-- ─────────────── INFORMATIONAL · read these, they are not pass/fail ───────────────
union all
select 90, 'INFO · students with progress (was 1,241 before v92 — must match)', 'INFO',
  (select count(*)::text from student_progress_counts)
union all
select 91, 'INFO · students with a current region', 'INFO',
  (select count(*)::text from student_current_region)
union all
-- Decision D1's population, made visible. These students have completed l057
-- (bounty access) and nothing else that counts. If v92 had added the
-- counts_toward_progress filter to student_current_region, every one of them
-- would have silently dropped out of the admin region lists. A number > 0 here
-- is the evidence that leaving the filter off was the right call.
select 92, 'INFO · D1 population: in current_region but NOT in progress_counts (expected > 0)', 'INFO',
  (select count(*)::text from student_current_region r
    where not exists (select 1 from student_progress_counts c where c.student_id = r.student_id))
union all
select 93, 'INFO · max completed_count (must be <= 64, >64 means the denominator broke)', 'INFO',
  coalesce((select max(completed_count)::text from student_progress_counts), '0')
union all
select 94, 'INFO · watch rows so far (0 until the player ships)', 'INFO',
  (select count(*)::text from student_lesson_watch)
)
select
  n as "#",
  check_name as "check",
  expected,
  actual,
  case
    when expected = 'INFO' then 'INFO'
    when expected = actual then 'PASS'
    else '*** FAIL ***'
  end as verdict
from checks
order by n;


-- ============================================================
-- OPTIONAL SECOND STEP — this one WRITES, so it is separate.
--
-- Re-runs the snapshot builder for the last two days and shows that the
-- numbers are unchanged and that total_lessons is now recorded. It deletes
-- and reinserts only those two dates, and it is what the Refresh button on
-- /admin already does, so it is safe — but run it deliberately, not by
-- accident.
--
--   select public.rebuild_daily_snapshots(current_date - 1, current_date);
--   -- EXPECT: 2
--
--   select snapshot_date, active_students, total_completions,
--          avg_progress, total_lessons
--     from daily_progress_snapshots
--    order by snapshot_date desc limit 5;
--   -- EXPECT: total_lessons = 64 on the two rebuilt rows, null on older ones,
--   --         and avg_progress in the same range it has been all week.
-- ============================================================
