-- ============================================================
-- Did the lessons finished on Whop reach the app? Read only, for one
-- account.
--
-- Put the test account's email (the one it signs in to Whop with) on the
-- line marked HERE, then paste the whole file into the Supabase SQL editor
-- on production. One result table. It changes nothing.
--
-- WHY A LESSON FINISHED ON WHOP SHOWED NOTHING ON THE PREVIEW (Lovro's
-- review, 19 October). The preview reads the new course from lessons_next,
-- on production's database. Both ways a lesson finished on Whop reaches the
-- app look it up in `lessons` by its Whop lesson id: the webhook
-- (src/app/api/webhooks/whop/route.ts) and the check at login and on every
-- visit, the backfill (src/app/api/student/_lib/watch-sync.ts). Until v104
-- runs, `lessons` holds the old course, and a completion can only be
-- written for a lesson in `lessons` (its foreign key). So a new-course
-- lesson finished on Whop is recorded nowhere yet: the check keeps its Whop
-- id as unmatched (part d), and the webhook logs "no lesson mapped to
-- whop_lesson_id=..." and answers 200, so Whop never sends it again. v104
-- copies the new course, Whop lesson ids included, into `lessons`; no code
-- changes. Section 28 of supabase/migration-tests/run.mjs runs this file
-- before and after v104.
--
-- WHEN
--   * Before v104: parts c and d say whether Whop's side works.
--   * The switch evening, after v104 and after the redeploy that carries
--     the new course's WHOP_COURSE_ID is Ready, doors still closed:
--       1. Close every tab of the app. Finish a short lesson (A) on Whop
--          with the test account, wait a minute, run this. Part e shows A
--          "later than the last check": with no tab open only the webhook
--          can have written it.
--       2. Open /world, finish lesson B on Whop in another tab, switch
--          back: B lights. Run this again: part c reads matched above 0 and
--          unmatched 0, and part e holds B and the lessons the account
--          finished on Whop before the switch.
--
-- READ IT BY PART (the first column)
--   a. live course   Which course `lessons` holds, and when the switch ran
--                    (Croatia time).
--   b. account       The student the email finds. "none": fix the email.
--                    Two or more: write the whole address; c to e stay
--                    empty until it finds one.
--   c. last check    When the check last ran for this account (Croatia
--                    time), then what Whop gave it.
--                    - "Whop sent 0": the course that WHOP_COURSE_ID names,
--                      on the deployment the account opened, holds nothing
--                      for it. If it finished lessons of the new course,
--                      that value names another course.
--                    - "note ...: Whop returned N interactions but 0 marked
--                      completed": the lessons are open on Whop, not
--                      finished. Finish them on Whop.
--                    - "error ...": the check failed after the time shown.
--                      "Whop user_id filter ignored": stop, tell Claude.
--                    - "before the switch": part d is that check's list.
--                    - "never": the account has not opened the app.
--   d. unmatched     Each Whop lesson that check got and found no lesson
--                    for. "new course a1l01 · title": Whop's side works and
--                    only the switch was missing. The same from a check
--                    after the switch: stop, tell Claude. "not in the new
--                    course": a lesson of another course.
--   e. done in the app  Each lesson this account has a completion for, in
--                    course order, with its time. "later than the last
--                    check": the webhook wrote it, or a watch in the app.
--
-- A part with nothing to show has no row. Rows come sorted by part, then
-- item.
-- ============================================================

with found as (
  select s.id, s.email, s.membership_status
    from public.students s
   where s.email ilike '%REPLACE_WITH_THE_TEST_ACCOUNTS_EMAIL%'   -- HERE
),
me as (
  select * from found where (select count(*) from found) = 1
),
the_switch as (
  select value::timestamptz as ran_at
    from public.admin_config
   where key = 'curriculum_reset_at'
),
sw as (
  select w.*, (select ran_at from the_switch) as switched_at
    from me
    join public.student_whop_sync w on w.student_id = me.id
)
select 'a. live course' as part,
       case when bool_or(l.id ~ '^a[1-8]l[0-9]{2}$') then 'the new course' else 'the old course' end as item,
       count(*)::text || ' lessons, ' || count(l.whop_lesson_id)::text || ' with a Whop lesson id'
       || coalesce((select ' · the switch ran ' || to_char(ran_at at time zone 'Europe/Zagreb', 'Dy DD Mon HH24:MI') from the_switch),
                   ' · the switch has not run') as detail
  from public.lessons l
union all
select 'b. account', f.email,
       'student ' || f.id::text || ' · ' || coalesce(f.membership_status, 'no status')
       || case when (select count(*) from found) > 1
               then ' · one of ' || (select count(*) from found)::text || ', write the whole address'
               else '' end
  from found f
union all
select 'b. account', 'none', 'No student has an email like the one on the line marked HERE.'
 where not exists (select 1 from found)
union all
select 'c. last check',
       coalesce(to_char(w.last_sync_at at time zone 'Europe/Zagreb', 'Dy DD Mon HH24:MI:SS'), 'no time'),
       'Whop sent ' || coalesce(w.last_sync_fetched::text, '-')
       || ' · matched ' || coalesce(w.last_sync_matched::text, '-')
       || ' · unmatched ' || coalesce(cardinality(w.last_sync_unmatched), 0)::text
       || case when w.last_sync_at < w.switched_at then ' · before the switch' else '' end
       || coalesce(' · '
                   || case when w.last_sync_at is null or w.last_sync_error_at > w.last_sync_at then 'error ' else 'note ' end
                   || coalesce(to_char(w.last_sync_error_at at time zone 'Europe/Zagreb', 'Dy DD Mon HH24:MI:SS'), '')
                   || ': ' || w.last_sync_error, '')
  from sw w
union all
select 'c. last check', 'never', 'No check has run for this account.'
 where exists (select 1 from me)
   and not exists (select 1 from sw)
union all
select 'd. unmatched', u.whop_lesson_id,
       coalesce('new course ' || n.id || ' · ' || n.title, 'not in the new course')
  from sw w
 cross join lateral unnest(w.last_sync_unmatched) as u(whop_lesson_id)
  left join public.lessons_next n on n.whop_lesson_id = u.whop_lesson_id
union all
select 'e. done in the app', c.lesson_id || ' · ' || coalesce(l.title, '?'),
       case when c.completed_at is not null
            then 'watched ' || to_char(c.completed_at at time zone 'Europe/Zagreb', 'Dy DD Mon HH24:MI:SS')
            when c.skipped_at is not null then 'skipped'
            else 'action only' end
       || case when c.completed_at is not null
                and (w.last_sync_at is null or c.completed_at > w.last_sync_at + interval '5 seconds')
               then ' · later than the last check' else '' end
  from me
  join public.student_lesson_completions c on c.student_id = me.id
  left join public.lessons l on l.id = c.lesson_id
  left join sw w on true
order by 1, 2;
