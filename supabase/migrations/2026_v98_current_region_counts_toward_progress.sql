-- ============================================================
-- v98 — student_current_region finally gets the progress filter
--
-- THIS REVERSES DECISION D1, because D1 was based on a number I made up.
--
-- WHAT I CLAIMED (project_log D1, 2026-09-23): that the PRD's "population of
-- zero" was wrong, that roughly 60 students hold bounty_access via l057
-- without other r4 completions, and that adding `counts_toward_progress` to
-- this view would silently move them down a region in every admin list. v92
-- therefore shipped WITHOUT the filter, diverging from the approved PRD.
--
-- WHAT THE DATABASE SAYS (diagnostics/d1-region-shift.sql, run 2026-09-24):
--
--     affected_students: 0        shifts: (none)
--
-- Zero. Not one student's region moves. The ~60 figure was never measured —
-- it came from a count of bounty_access_claimed, which is a different question
-- from "is l057 their highest-region completion". Every student who claimed
-- l057 has another r4 completion at least as far along. The PRD was right.
--
-- WHY ADD IT NOW RATHER THAN AT CUTOVER
--   1. It is provably a no-op today. The measurement above IS the safety case.
--   2. It stops being a no-op after cutover, and in the wrong direction. The
--      Ad Bounty pond (a7l22) is the new catalog's l057 — but it sits in
--      Creative Strategy, area 7 of 8, MID-course rather than at the end. A
--      student who claims the pond before finishing a6 would read "currently
--      in Creative Strategy" on every admin list while actually being an area
--      behind. The filter is what prevents that, and the new catalog makes the
--      case far more likely than the old one ever did.
--   3. Folding it into the cutover file would bury a behaviour change inside
--      the largest, riskiest migration of the project. Separate, measured, and
--      reversible is better.
--
--   It also ends a divergence: student_progress_counts has excluded l057 since
--   v81 while this view has not. One rule, both views.
--
-- ⚠ NOTE ON NUMBERING: the plan reserves v98 for `course_cutover`. This took
--   the number first; the cutover files are v99 / v100. Numbers are run order,
--   nothing more.
--
-- Idempotent. Byte-identical to v92's version apart from the added filter.
-- ============================================================

begin;

create or replace view public.student_current_region as
select distinct on (c.student_id)
  c.student_id,
  l.region_id as current_region
from public.student_lesson_completions c
join public.lessons l on l.id = c.lesson_id
join public.regions r on r.id = l.region_id
where l.counts_toward_progress          -- v98: the filter D1 wrongly withheld
  and public.lesson_is_complete(
        l.requires_action, c.completed_at, c.action_completed_at, c.skipped_at)
order by c.student_id, r.order_num desc;

-- Re-assert v78's hardening at the point of definition, as v92 did.
alter view public.student_current_region set (security_invoker = on);
grant select on public.student_current_region to authenticated;
revoke select on public.student_current_region from anon;

comment on view public.student_current_region is
  'Per-student highest-order region with at least one completion that COUNTS '
  'toward progress. v98 added the counts_toward_progress filter, measured to '
  'move zero students at the time — it exists for the new catalog, where the '
  'Ad Bounty pond sits mid-course rather than at the end.';

commit;

-- ============================================================
-- POST-CHECKS
-- ============================================================
--
-- 1. THE ONE THAT MATTERS — the row count must not have moved:
--    select count(*) from student_current_region;
--    EXPECT: 1243, exactly as before v98.
--
-- 2. Nobody's region moved either. Re-run diagnostics/d1-region-shift.sql:
--    EXPECT: affected_students 0, and now it is 0 because the view and the
--    filtered version are literally the same query.
--
-- 3. Types and hardening intact:
--    select column_name, data_type from information_schema.columns
--     where table_name = 'student_current_region';
--    EXPECT: student_id uuid, current_region text
--
--    select has_table_privilege('anon','public.student_current_region','select');
--    EXPECT: false
-- ============================================================
