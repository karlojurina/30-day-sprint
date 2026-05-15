-- ============================================================
-- v26: Drop the tail of the bounty arc
--
-- Karlo decided l059, l060, l061, l062 aren't pulling their weight.
-- Removing them leaves the R4 action thread as just:
--   l057  Complete Ad Bounty Onboarding   (setup)
--   l058  Submit Your First Ad Bounty     (action)
--
-- After this, R4 has 16 lessons (was 20). Total: 66.
--
-- Idempotent.
-- ============================================================

delete from student_lesson_completions
  where lesson_id in ('l059','l060','l061','l062');

delete from lessons
  where id in ('l059','l060','l061','l062');

-- Sanity checks (uncomment to verify in the SQL editor):
-- select count(*) from lessons;                                -- expect 66
-- select count(*) from lessons where region_id = 'r4';         -- expect 16
-- select count(*) from lessons
--   where id in ('l059','l060','l061','l062');                 -- expect 0
