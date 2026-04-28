-- ============================================================
-- v10: Celebration state flags
--
-- Tracks which celebration moments have been shown to a student so
-- they don't re-fire on reload. Also extends disengagement_alerts
-- with a tighter "no_lessons_3d" alert type for Phase 3 cron.
-- ============================================================

-- Streak milestone — last day count we showed a toast for. 0 = none.
-- 7 / 14 / 30 represent the milestones reached. We compare current
-- streak to this value — if current > stored AND current passes a
-- milestone, fire the toast and bump the stored value.
alter table students
  add column if not exists last_streak_milestone_shown int not null default 0;

-- Month review (graduation modal) — null = unseen, timestamp = dismissed
alter table students
  add column if not exists month_review_seen_at timestamptz;

-- Day-28 Discord DM — null = not sent, timestamp = sent
alter table students
  add column if not exists day28_dm_sent_at timestamptz;

-- Per-region celebration — JSONB array of region IDs that have already
-- been "celebrated" (modal shown). Avoids re-firing on reload after
-- the student dismisses it.
alter table students
  add column if not exists celebrated_region_ids jsonb not null default '[]'::jsonb;

-- Discord user id (sometimes obtainable from Whop OAuth — populated
-- opportunistically; the day-28 DM cron uses it as the target). May be
-- null for many students; the cron has a fallback to channel mention.
alter table students
  add column if not exists discord_user_id text;

-- Extend disengagement_alerts.alert_type to allow 'no_lessons_3d'.
-- The column is text with a CHECK constraint per the original schema —
-- update it.
alter table disengagement_alerts
  drop constraint if exists disengagement_alerts_alert_type_check;
alter table disengagement_alerts
  add constraint disengagement_alerts_alert_type_check
  check (
    alert_type in (
      'no_tasks_7d',
      'no_lessons_3d',
      'no_activation_14d',
      'no_login_5d',
      'week2_no_start'
    )
  );
