-- ============================================================
-- The admin's numbers after the course switch, worked out here from the
-- live tables, next to the snapshot rows the trend lines read.
--
-- Paste the whole file into the Supabase SQL editor and run it. Read only:
-- one select, it changes no table and locks nothing. It needs v103 (the view
-- student_last_counted_completion), which production has had since before
-- the switch; with v103 and without v104 it says NOT SWITCHED.
--
-- WHERE EACH ADMIN NUMBER COMES FROM
--   /admin "Avg progress", the big number   live: student_progress_counts
--                                           over the active launch cohort,
--                                           divided by the counting lessons
--   /admin the little line and the arrow    daily_progress_snapshots, one row
--   under each trend tile                   a day
--   /admin/insights/progress, the figure    the newest snapshot row
--   on each chart card
--   Activity cards, Students, Journey       live
--
-- Today's snapshot row (UTC) is written by the 00:30 UTC run, so on the
-- switch day the row from that run still holds the old course's average
-- until something rebuilds it. Two things rebuild it: the Refresh button
-- on /admin (founders and admins; its message then says "Snapshots
-- rebuilt"), or the next 00:30 UTC run. Rows dated before the switch day
-- are frozen by the floor trigger and keep the old course's numbers: the
-- drop on the switch day is real (cutover PRD, C7).
--
-- READ THE VERDICT COLUMN
--   PASS          holds.
--   LOOK          does not: the found and expect columns say what it saw.
--   INFO          a number to read, and where the admin shows it.
--   NOT YET       nothing to judge yet (a cron that has not had its turn).
--   NOT SWITCHED  the switch has not run here.
--
-- Keep the plan id and the two dates in step with src/lib/constants.ts
-- (PAYING_WHOP_PLAN_IDS, ADMIN_STUDENT_JOIN_CUTOFF, TASKS_STUDENT_JOIN_CUTOFF),
-- as supabase/diagnostics/admin-health.sql does.
-- ============================================================

with
  k as (
    select value as at, value::timestamptz as ts
      from public.admin_config where key = 'curriculum_reset_at'),
  today as (select (now() at time zone 'utc')::date as d),
  -- The dashboard's "active": students on a paying plan, active or past due,
  -- first paid on or after the launch, with a Whop membership
  -- (src/app/admin/(authenticated)/page.tsx, isPayingMember). The Activity
  -- cards count the same students (useJourneyPaceCounts).
  cohort as (
    select s.id, s.last_active_at
      from public.students s
     where s.whop_membership_id is not null
       and s.membership_status in ('active', 'past_due')
       and s.whop_plan_id in ('plan_4ZrwR4PmBsVsx')
       and s.first_paid_at >= timestamptz '2026-05-25 00:00:00+00'),
  counting as (select count(*) as n from public.lessons where counts_toward_progress),
  done as (
    select coalesce(sum(p.completed_count), 0) as lessons,
           count(*) filter (where p.completed_count > 0) as students
      from public.student_progress_counts p
      join cohort c on c.id = p.student_id),
  live as (
    select (select count(*) from cohort) as active,
           (select lessons from done) as lessons_done,
           (select students from done) as students_with_one,
           (select n from counting) as counting,
           case when (select count(*) from cohort) > 0 and (select n from counting) > 0
                then (select lessons from done)::numeric
                     / ((select count(*) from cohort) * (select n from counting)) * 100
           end as avg_exact),
  -- activityLabel() in src/lib/curriculum-reset.ts: whole days since the
  -- last counted lesson, under 3 moving, 3 to 7 slipping, over 7 stalled.
  act as (
    select count(*) filter (where v.last_completed_at is null) as not_started,
           count(*) filter (where now() - v.last_completed_at < interval '3 days') as moving,
           count(*) filter (where now() - v.last_completed_at >= interval '3 days'
                              and now() - v.last_completed_at < interval '8 days') as slipping,
           count(*) filter (where now() - v.last_completed_at >= interval '8 days') as stalled
      from cohort c
      left join public.student_last_counted_completion v on v.student_id = c.id),
  snap as (
    select snapshot_date, coalesce(avg_progress_cohort, avg_progress) as avg,
           active_count_cohort, total_lessons, created_at
      from public.daily_progress_snapshots),
  snap_today as (select * from snap where snapshot_date = (select d from today)),
  snap_yesterday as (select * from snap where snapshot_date = (select d from today) - 1),
  snap_newest as (select * from snap order by snapshot_date desc limit 1),
  -- Every cron the admin depends on, its runs since the switch (cron_runs,
  -- written by src/lib/cron-auth.ts). The Refresh button's runs count too.
  expected (route, schedule) as (
    values ('sync-whop', 'every 2 hours at :00 UTC'),
           ('check-engagement', 'every 2 hours at :10 UTC'),
           ('check-csm-tasks', 'every 2 hours at :15 UTC'),
           ('check-na-tasks', 'every 2 hours at :20 UTC'),
           ('snapshot-progress', 'daily at 00:30 UTC')),
  runs as (
    select r.route_name,
           count(*) as n,
           count(*) filter (where r.status = 'success') as ok,
           count(*) filter (where r.status in ('failed', 'auth_failed')) as bad,
           (array_agg(r.status order by r.started_at desc))[1] as last_status,
           max(r.started_at) as last_at,
           (array_agg(r.error_message order by r.started_at desc))[1] as last_error
      from public.cron_runs r
     where r.started_at >= (select ts from k)
     group by r.route_name),
  rows_out (o, part, item, found, expect, verdict) as (
    select 1, 'switch', 'the moment of the course switch',
           coalesce((select at from k), 'absent'), 'written by v104',
           case when (select at from k) is null then 'NOT SWITCHED' else 'PASS' end
    union all
    select 2, 'lessons', 'lessons that count toward progress: every average divides by this',
           (select n::text from counting), '140',
           case when (select at from k) is null then 'NOT SWITCHED'
                when (select n from counting) = 140 then 'PASS' else 'LOOK' end
    union all
    select 3, 'dashboard', 'active members of the launch cohort',
           (select active::text from live), 'the big number on "Active on platform"', 'INFO'
    union all
    select 4, 'dashboard', 'counted lessons those members have done',
           (select lessons_done::text from live), 'the top half of the average', 'INFO'
    union all
    select 5, 'dashboard', 'Avg progress, live, whole number',
           coalesce(round((select avg_exact from live))::text || '%', 'no active member'),
           'the big number on the "Avg progress" tile', 'INFO'
    union all
    select 6, 'dashboard', 'Avg progress, live, 2 decimals',
           coalesce(round((select avg_exact from live), 2)::text || '%', 'no active member'),
           'what a rebuild of today''s snapshot writes (within about a point)', 'INFO'
    union all
    select 7, 'dashboard', 'open tasks',
           (select count(*)::text from public.tasks t join public.students s on s.id = t.student_id
             where t.status = 'open' and not s.csm_exempt
               and s.first_paid_at >= timestamptz '2026-05-28 00:00:00+00'),
           'the "Open tasks" tile', 'INFO'
    union all
    select 8, 'dashboard', 'pending discount requests',
           (select count(*)::text from public.discount_requests where status = 'pending'),
           'the "Pending discounts" tile', 'INFO'
    union all
    select 10, 'students', 'active members with at least 1 counted lesson',
           (select students_with_one || ' of ' || active from live),
           'the rest show 0% on Students and Journey', 'INFO'
    union all
    select 11, 'students', 'activity: not started / moving / slipping / stalled',
           (select not_started || ' / ' || moving || ' / ' || slipping || ' / ' || stalled from act),
           'the Activity cards on Insights and Journey, the pills on Students', 'INFO'
    union all
    select 12, 'students', 'active members seen since the switch (login or lesson)',
           (select count(*)::text from cohort where last_active_at >= (select ts from k)),
           'the "Last active" column; those arrived, with or without a lesson', 'INFO'
    union all
    select 13, 'students', 'every student with a counted lesson, any plan or status',
           (select count(*)::text from public.student_progress_counts),
           'includes members outside the launch cohort', 'INFO'
    union all
    select 14, 'students', 'lesson completion rows in all',
           (select count(*)::text from public.student_lesson_completions),
           'the switch emptied this table: every row came after it', 'INFO'
    union all
    -- /admin/not-activated's own filter (no team test accounts, no one the
    -- Day-10 tier already marked), before its cohort and tier pickers.
    select 15, 'not activated', 'paid, active, never logged in to the app',
           (select count(*)::text from public.students s
             where s.membership_status = 'active' and not s.high_churn_risk and not s.csm_exempt
               and s.whop_plan_id in ('plan_4ZrwR4PmBsVsx')
               and s.first_paid_at >= timestamptz '2026-05-25 00:00:00+00'
               and not exists (select 1 from public.student_milestones m
                                where m.student_id = s.id and m.first_sprint_login_at is not null)),
           'the Total tile on /admin/not-activated; far more there means its read of first logins failed', 'INFO'
    union all
    select 20, 'snapshot', 'today''s row, ' || (select d::text from today) || ' (UTC)',
           coalesce((select 'avg ' || avg || '% · active ' || coalesce(active_count_cohort::text, '?')
                            || ' · over ' || coalesce(total_lessons::text, '?') || ' lessons · computed '
                            || to_char(created_at at time zone 'utc', 'YYYY-MM-DD HH24:MI') || ' UTC'
                       from snap_today), 'no row'),
           'computed after the switch, over 140 lessons',
           case when (select at from k) is null then 'NOT SWITCHED'
                when not exists (select 1 from snap_today) then 'LOOK: no row yet. Press Refresh on /admin, or wait for 00:30 UTC'
                when (select created_at from snap_today) < (select ts from k)
                  then 'LOOK: computed before the switch, the old course. Press Refresh on /admin, or wait for 00:30 UTC'
                else 'PASS' end
    union all
    select 21, 'snapshot', 'yesterday''s row, ' || ((select d from today) - 1)::text || ' (UTC)',
           coalesce((select 'avg ' || avg || '% · active ' || coalesce(active_count_cohort::text, '?')
                            || ' · over ' || coalesce(total_lessons::text, '?') || ' lessons'
                       from snap_yesterday), 'no row'),
           'before the switch day: the old course, frozen by the floor and kept', 'INFO'
    union all
    select 22, 'insights', 'the "Avg progress" figure on Insights: the newest row',
           coalesce((select avg || '% on ' || snapshot_date from snap_newest), 'no row'),
           'within 1 point of "Avg progress, live, 2 decimals"',
           case when (select at from k) is null then 'NOT SWITCHED'
                when not exists (select 1 from snap_newest) or (select avg_exact from live) is null then 'LOOK'
                when abs((select avg from snap_newest) - (select avg_exact from live)) <= 1 then 'PASS'
                else 'LOOK: the snapshot is behind. Press Refresh on /admin, or wait for 00:30 UTC' end
    union all
    select 30 + row_number() over (order by e.route), 'crons', e.route || ' since the switch',
           case when r.n is null then 'no run'
                else r.n || ' runs, ' || r.ok || ' ok, ' || r.bad || ' failed; last ' || r.last_status || ' at '
                     || to_char(r.last_at at time zone 'utc', 'HH24:MI') || ' UTC'
                     || coalesce(': ' || left(r.last_error, 160), '') end,
           e.schedule,
           case when (select at from k) is null then 'NOT SWITCHED'
                -- Its first turn: the 00:30 UTC after the switch, with an hour to finish.
                when r.n is null and e.route = 'snapshot-progress'
                     and now() at time zone 'utc'
                         < date_trunc('day', (select ts from k) at time zone 'utc') + interval '1 day 90 minutes'
                  then 'NOT YET: its first run is at 00:30 UTC'
                when r.n is null and now() - (select ts from k) < interval '2 hours 30 minutes' then 'NOT YET'
                when r.n is null then 'LOOK: no run since the switch'
                when r.last_status = 'success' then 'PASS'
                when r.last_status = 'running' and r.last_at > now() - interval '10 minutes' then 'NOT YET: running now'
                else 'LOOK' end
      from expected e left join runs r on r.route_name = e.route
    union all
    select 40, 'settings', 'program login link: the {programLink} in task messages',
           coalesce((select value from public.admin_config where key = 'program_login_link'), 'absent'),
           'the address students log in at today', 'INFO')
select part, item, found, expect, verdict
  from rows_out
 order by o;
-- EXPECT after the switch, 23 rows: PASS on the switch and on the 140
-- lessons; the INFO rows near 0 on the first evening and growing as students
-- arrive; today's snapshot row and the Insights figure LOOK until today's row
-- is rebuilt (Refresh on /admin, or 00:30 UTC), then PASS; each cron PASS once
-- it has had its turn. With v103 and before the switch: NOT SWITCHED.
