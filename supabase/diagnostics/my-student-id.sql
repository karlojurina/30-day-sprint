-- Your student id, for NEXT_PUBLIC_WORLD_PREVIEW_IDS.
--
-- /world is closed to everyone until an id is listed there, so this is the
-- one value that opens it — for you and nobody else.
--
-- Replace the email with the one you log into the app with (the Whop account,
-- not necessarily your usual address).

select
  s.id            as student_id,
  s.email,
  s.membership_status,
  s.whop_plan_id,
  (select count(*) from student_lesson_completions c where c.student_id = s.id) as completions
from students s
where s.email ilike '%REPLACE_WITH_YOUR_EMAIL%';

-- Not sure which account is yours? This lists the team's:
--   select s.id, s.email, s.membership_status
--     from students s
--    where s.email in (select email from team_members)
--    order by s.email;
