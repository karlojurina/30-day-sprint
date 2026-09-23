-- ============================================================
-- Decision D1, tested properly.
--
-- WHY THIS FILE EXISTS. prd1-postchecks.sql row 92 asked the WRONG QUESTION.
-- It counted students who appear in student_current_region but NOT in
-- student_progress_counts — i.e. who would vanish from the view entirely. It
-- returned 0, which proves only that every student with an l057 completion
-- also completed something else that counts.
--
-- That was never the risk. D1's risk is a student whose current_region VALUE
-- moves: someone who finished lessons in r1-r3 and also claimed l057 (which
-- lives in r4) shows current_region = 'r4' today. Add the
-- counts_toward_progress filter and they would show 'r3' instead. They appear
-- in BOTH views either way, so row 92 is blind to them.
--
-- This query compares the actual view against what it WOULD return with the
-- filter applied, and reports every student whose region would move.
--
-- Read-only. Safe to run any time.
-- ============================================================

with filtered as (
  -- Exactly student_current_region's definition, plus the one filter D1
  -- decided NOT to add.
  select distinct on (c.student_id)
    c.student_id,
    l.region_id as would_be_region
  from public.student_lesson_completions c
  join public.lessons l on l.id = c.lesson_id
  join public.regions r on r.id = l.region_id
  where l.counts_toward_progress
    and public.lesson_is_complete(
          l.requires_action, c.completed_at, c.action_completed_at, c.skipped_at)
  order by c.student_id, r.order_num desc
),
shifted as (
  select
    cur.student_id,
    cur.current_region as region_today,
    f.would_be_region
  from public.student_current_region cur
  left join filtered f on f.student_id = cur.student_id
  where f.would_be_region is distinct from cur.current_region
)
select
  'D1 · students whose current_region WOULD move under the filter' as check_name,
  count(*)::text                                                   as affected_students,
  coalesce(string_agg(distinct region_today || ' -> ' ||
           coalesce(would_be_region, '(dropped from the view)'), ', '), '(none)') as shifts,
  case
    when count(*) = 0
      then 'D1 was unnecessary — the filter would have changed nothing. Harmless, but the PRD''s original "population of zero" was right and my correction was not.'
    else 'D1 was correct — adding the filter would have silently moved these students in every admin region list.'
  end as verdict
from shifted;


-- ── The same question, broken down, if the count above is not zero ──
--
-- with filtered as ( ...same CTE... )
-- select cur.current_region as region_today,
--        coalesce(f.would_be_region, '(dropped)') as would_be,
--        count(*) as students
--   from student_current_region cur
--   left join filtered f on f.student_id = cur.student_id
--  where f.would_be_region is distinct from cur.current_region
--  group by 1, 2
--  order by 3 desc;


-- ── Context worth having either way ──
--
-- How many students have completed l057 at all, and how many of them have
-- ANY other r4 completion? That is the population D1 was reasoning about.
--
-- select
--   count(*) filter (where has_l057)                        as claimed_bounty,
--   count(*) filter (where has_l057 and not has_other_r4)   as l057_is_their_only_r4
-- from (
--   select c.student_id,
--          bool_or(c.lesson_id = 'l057') as has_l057,
--          bool_or(l.region_id = 'r4' and c.lesson_id <> 'l057') as has_other_r4
--     from student_lesson_completions c
--     join lessons l on l.id = c.lesson_id
--    group by c.student_id
-- ) t;
