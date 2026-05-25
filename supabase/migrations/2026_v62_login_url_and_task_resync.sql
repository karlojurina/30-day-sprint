-- ============================================================
-- v62: Fix login URL across the platform + dismiss bogus tasks
-- so the next cron pass regenerates a clean queue.
--
-- BACKGROUND
-- ----------
-- Two problems addressed here:
--
-- 1. admin_config.program_login_link was seeded as
--    https://sprint.ecomtalent.com/login back in v27. That host
--    doesn't exist. The real student URL is the Vercel deploy at
--    https://30-day-sprint-smkv.vercel.app/login.
--    Every CSM template injects this URL via the {programLink}
--    variable, so every DM that went out before this migration
--    pointed students at a dead URL.
--
-- 2. The CSM cron's "activated student" triggers (nolessons.*,
--    noship.*, pace.*) used to gate on students.joined_at, which
--    the Whop webhook sets when a membership.activated event
--    arrives - regardless of whether the student ever opened our
--    app. The result: paying members who never logged in got DOUBLE
--    flagged - once correctly by the NA pipeline (stalled.*) and
--    once incorrectly by the activated pipeline (nolessons.*,
--    pace.*).
--
--    The accompanying code change adds a first_sprint_login_at
--    guard to every built-in activated trigger so the activated
--    pipeline no longer overlaps with NA. This migration cleans up
--    the open tasks generated under the old logic so we don't have
--    to manually triage them.
--
-- WHAT THIS DOES
-- --------------
--   * Updates admin_config.program_login_link to the Vercel URL.
--   * Auto-dismisses every OPEN task whose scenario is in the
--     activated set AND whose student has no first_sprint_login_at.
--     Adds a clear notes line so the trail is visible in
--     /admin/tasks history.
--
-- After this runs: trigger /admin/tasks "Generate now" (or wait
-- for the next 09:15 UTC cron) and the queue rebuilds correctly:
--   - never-logged-in students: only stalled.* tasks
--   - logged-in students: nolessons / noship / pace as earned
--
-- Idempotent.
-- ============================================================

-- ─── 1. Login URL ───
update admin_config
set value = 'https://30-day-sprint-smkv.vercel.app/login',
    updated_at = now()
where key = 'program_login_link'
  and value <> 'https://30-day-sprint-smkv.vercel.app/login';

-- ─── 2. Auto-dismiss bogus open tasks ───
-- Activated-pipeline scenarios that should require a real app
-- login. The NA pipeline (stalled.*) keeps its own task slot for
-- the same students.
update tasks t
set status = 'dismissed',
    dismissed_at = now(),
    notes = coalesce(notes, '') ||
            case when notes is null or notes = '' then '' else E'\n' end ||
            '[v62 auto-dismiss] Student never opened the sprint app ' ||
            '(first_sprint_login_at is null). Activated-pipeline scenarios ' ||
            'now require login; this task was generated under the old ' ||
            'joined_at-only logic.'
where t.status = 'open'
  and t.scenario_id in (
    'nolessons.day3', 'nolessons.day7', 'nolessons.day14',
    'noship.r1.day7', 'noship.r2.day14',
    'pace.day7', 'pace.day14', 'pace.day21'
  )
  and not exists (
    select 1
    from student_milestones m
    where m.student_id = t.student_id
      and m.first_sprint_login_at is not null
  );
