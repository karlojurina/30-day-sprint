-- ============================================================
-- v51: Phase 1 foundation for the lovro-brief-v3 activation pivot.
--
-- Three things in one migration:
--
-- 1. Extend student_milestones with 3 new fields supporting the
--    intro-video-gate + Why You're Here panel from §02 of the
--    brief:
--      • intro_video_threshold_met       (bool)
--      • why_youre_here_panel_dismissed  (bool)
--      • first_dashboard_login_at        (timestamptz)
--
-- 2. Add high_churn_risk (bool) to the students table. Flag is
--    set by the NA cron (§03) when the Day-10 escalation fires;
--    its presence stops further NA pings. Lives on students
--    alongside csm_exempt + ad_submissions_verified because it's
--    identity-adjacent (risk classification of the membership),
--    not a milestone or a celebration.
--
-- 3. Collapse the D1.A + D1.B call/no-call branching templates
--    into a single D1 (§01 of the brief). Drops the now-orphaned
--    admin_config keys astrid_booking_link +
--    karlo_walkthrough_video_link. program_login_link stays - the
--    new D1 still uses {programLink}.
--
-- Per CLAUDE.md "table-level bounded contexts": NA cohort detection
-- needs no new columns - per the 23-05-2026 decision we derive
-- cohort entirely from existing signals (students.discord_username
-- presence + student_whop_sync.last_sync_fetched). No
-- onboarding_form_submitted, no form_data jsonb, no separate
-- onboarding-form webhook. The brief's original plan to add those
-- is superseded.
--
-- Idempotent.
-- ============================================================

-- 1. student_milestones extensions --------------------------------------
alter table student_milestones
  add column if not exists intro_video_threshold_met       boolean     not null default false,
  add column if not exists why_youre_here_panel_dismissed  boolean     not null default false,
  add column if not exists first_dashboard_login_at        timestamptz;

comment on column student_milestones.intro_video_threshold_met is
  'Set true when the student watches enough of the intro video (~65%) to unlock the Continue button. Sticky once set - re-watches do not flip it back.';
comment on column student_milestones.why_youre_here_panel_dismissed is
  'Set true when the student clicks Let''s go on the final WYH card. Sticky.';
comment on column student_milestones.first_dashboard_login_at is
  'First time the student loaded /dashboard (post-OAuth). Distinct from students.joined_at which fires at OAuth success. Used by the intro-video auto-play gate to know when to fire it.';

-- 2. students.high_churn_risk -------------------------------------------
alter table students
  add column if not exists high_churn_risk  boolean  not null default false;

comment on column students.high_churn_risk is
  'Set true by the NA cron when the Day-10 escalation tier fires. Subsequent NA cron passes skip this student. UI badge optional.';

-- 3. Template merge -----------------------------------------------------

-- Drop the orphaned admin_config keys first (no FK, just rows).
delete from admin_config
where key in ('astrid_booking_link', 'karlo_walkthrough_video_link');

-- Seed the new {discordInvite} key for Cohort B NA templates. Empty
-- by default - Karlo fills it in via /admin/settings. Templates that
-- reference {discordInvite} while it's empty will leave the
-- placeholder intact (renderTemplate's behavior) so Astrid notices.
insert into admin_config (key, value, description)
values (
  'discord_invite_link',
  '',
  'Discord server invite URL, used in Cohort B NA templates (NA-B.1-4). Empty until Karlo provides one.'
)
on conflict (key) do nothing;

-- Remove the old branching D1.A + D1.B. We delete (not update) so the
-- scenario_id history is clean and the new D1 is unambiguously the
-- single welcome template. Custom non-built-in templates referencing
-- D1.A/D1.B don't exist (built-ins were the only D1.* rows).
delete from templates
where scenario_id in ('D1.A', 'D1.B');

-- Insert the single D1 welcome from §1 of 04-template-copy.md. Body
-- is final (Karlo confirmed 23-05-2026). Tone + intent + variables
-- come straight from the brief.
insert into templates (
  scenario_id,
  bucket,
  week,
  title,
  body,
  trigger_description,
  intent,
  tone,
  variables,
  is_active,
  is_admin_only,
  is_custom
)
values (
  'D1',
  'event',
  'D1',
  'D1 - Welcome (Day 1 SOP)',
  E'Hey {firstName}! 🙌\n\nWelcome to ecomtalent - so happy you''re here. I''m Astrid, and I''ll be your point of contact while you''re with us.\n\nOne thing to do right now: open the 30-Day Sprint dashboard.\n\n👉 {programLink}\n\nThe first thing you''ll see inside is a quick video from Karlo himself - he walks you through what the next 30 days look like, why it''s set up the way it is, and how to grab the 30% off your second month. Watch it all the way through. It''ll save you a ton of confusion and make everything else click.\n\nAfter the video, you''ll land on the map and can start the first lesson whenever you''re ready.\n\nA couple things worth knowing as you get going:\n\n- The community is your first stop for questions. Tons of students going through the exact same things you are right now, and they jump in fast.\n- I''m here for anything bigger - DM me anytime.\n\nLet''s go 🚀',
  'Onboarding form submitted (team Discord channel ping + Notion row). Astrid sends manually within Day 1 SOP. Single template - the old call/no-call branching is gone (v3 brief, 22-05-2026).',
  'welcome',
  'warm',
  '["firstName","programLink"]'::jsonb,
  true,
  false,
  false
)
on conflict (scenario_id) do update
set title = excluded.title,
    body = excluded.body,
    bucket = excluded.bucket,
    week = excluded.week,
    trigger_description = excluded.trigger_description,
    intent = excluded.intent,
    tone = excluded.tone,
    variables = excluded.variables,
    is_active = excluded.is_active,
    is_admin_only = excluded.is_admin_only,
    is_custom = excluded.is_custom,
    updated_at = now();
