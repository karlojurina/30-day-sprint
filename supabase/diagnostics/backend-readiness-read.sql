-- ============================================================
-- The backend readiness read: one paste, read only.
--
-- From the backend audit of 15 October
-- (_admin/prds/map-review-2026-10-15/backend_readiness.md, "The read for
-- step 2"). The query below is the audit's, character for character. It
-- was run on an offline Postgres built the way the migration harness
-- builds one (section 25 of supabase/migration-tests/run.mjs runs it
-- again); production's tables have not seen it.
--
-- READ ONLY. One select: it changes no row, no table and no setting. Paste
-- it into the Supabase SQL editor on production and paste the result back.
--
-- WHEN
--   * Before 2026_v105_close_student_write_policies.sql: part a decides it.
--   * Right after v105: part a shows the student write rows gone.
--   * Again before the switch (the audit's steps 11 and 13).
--
-- READ IT BY PART (the first column, "part")
--   a. policy    Every policy on student_lesson_completions,
--                discount_requests and student_achievements, as
--                table · policy · command, then its roles, using and check.
--                Want: students only read, plus the team's own policies.
--                Before v105 expect three student write rows, which v105
--                closes: "Students can manage own lesson completions" (ALL),
--                "Students can create discount requests" (INSERT) and
--                "student_achievements: student writes own" (INSERT).
--                A student INSERT, UPDATE, DELETE or ALL row under any
--                other name: stop and ask, v105 does not drop it.
--   b. template  The CSM templates W2.2, W2.6 and X.1 that the app's event
--                hooks need (src/lib/csm-events.ts). Want all three
--                MISSING (v57 deleted them). X.1 present: open no_login_5d
--                alerts (part c) turn into "came back" tasks on students'
--                first new lessons, so csm-events.ts gets fixed before the
--                switch.
--   c. open alerts  Open disengagement alerts, a count per type. The
--                no_login_5d ones stay open through the switch.
--   d. plan of students who paid since 9 Oct  A count per Whop plan. Want
--                one row, the plan the app counts as paying. Another plan,
--                or "(none)": those buyers are missing from every admin
--                number and CSM pool (the audit's Decision 9).
--   e. members who paid before 25 May  Paying members no admin page shows,
--                a count per membership status. Nothing to fix before the
--                switch; the count says how big that blind spot is.
--   f. watch rows recorded by the app  0 means no watch inside the app has
--                ever been recorded on production.
--   g. course videos with no length  Want 0. A lesson with a video and no
--                length can never be finished.
--   h. setting   Want discount_window_days present (a setting nothing
--                reads) and curriculum_reset_at ABSENT. curriculum_reset_at
--                present before the switch: stop, the app would act as if
--                the switch had happened.
--   i. students who paid since 9 Oct  Five numbers: all / with any
--                completion / Whop fetched > 0 / Whop matched > 0 / open
--                nolessons task. Fetched near 0 for most: they watch the
--                new course on Whop and the app can't see it until the
--                switch. Fetched above 0 with matched 0: WHOP_COURSE_ID
--                probably names the new course already, or those students
--                opened old-course lessons on Whop and finished none (a
--                student page tells them apart: the error "N interactions
--                but 0 marked completed" is the second case). Open
--                nolessons tasks: those students are being told they
--                haven't started.
--
-- A part with nothing to show has no row: c, d and e on a quiet database,
-- h when neither setting exists. Rows come sorted by part, then item.
-- ============================================================

-- Read only. One result table. Paste into the Supabase SQL editor (production).
select 'a. policy' as part,
       tablename || ' · ' || policyname || ' · ' || cmd as item,
       'roles ' || roles::text || ' · using ' || coalesce(qual, '-') || ' · check ' || coalesce(with_check, '-') as detail
  from pg_policies
 where schemaname = 'public'
   and tablename in ('student_lesson_completions', 'discount_requests', 'student_achievements')
union all
select 'b. template', s.id,
       coalesce((select case when t.is_active then 'exists, active' else 'exists, inactive' end
                   from public.templates t
                  where t.scenario_id = s.id), 'MISSING')
  from (values ('W2.2'), ('W2.6'), ('X.1')) as s(id)
union all
select 'c. open alerts', alert_type, count(*)::text
  from public.disengagement_alerts
 where not is_dismissed
 group by alert_type
union all
select 'd. plan of students who paid since 9 Oct', coalesce(whop_plan_id, '(none)'), count(*)::text
  from public.students
 where first_paid_at >= '2026-10-08T22:00:00Z'
 group by whop_plan_id
union all
select 'e. members who paid before 25 May', membership_status, count(*)::text
  from public.students
 where first_paid_at < '2026-05-25T00:00:00Z'
   and membership_status in ('active', 'past_due')
 group by membership_status
union all
select 'f. watch rows recorded by the app', 'student_lesson_watch', count(*)::text
  from public.student_lesson_watch
union all
select 'g. course videos with no length', 'lesson_videos on a lessons_next row with no duration', count(*)::text
  from public.lesson_videos v
  join public.lessons_next l on l.id = v.lesson_id
 where l.duration_seconds is null
union all
select 'h. setting', key, value
  from public.admin_config
 where key in ('discount_window_days', 'curriculum_reset_at')
union all
select 'i. students who paid since 9 Oct',
       'all / with any completion / Whop fetched > 0 / Whop matched > 0 / open nolessons task',
       count(*)::text || ' / '
       || count(*) filter (where exists (select 1 from public.student_lesson_completions c where c.student_id = s.id))::text || ' / '
       || count(*) filter (where exists (select 1 from public.student_whop_sync w where w.student_id = s.id and coalesce(w.last_sync_fetched, 0) > 0))::text || ' / '
       || count(*) filter (where exists (select 1 from public.student_whop_sync w where w.student_id = s.id and coalesce(w.last_sync_matched, 0) > 0))::text || ' / '
       || count(*) filter (where exists (select 1 from public.tasks t where t.student_id = s.id and t.status = 'open' and t.scenario_id like 'nolessons.%'))::text
  from public.students s
 where s.first_paid_at >= '2026-10-08T22:00:00Z'
order by 1, 2;
