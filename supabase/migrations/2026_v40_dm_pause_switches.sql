-- ============================================================
-- v40: DM pause switches — kill switches for every automated
-- Discord send.
--
-- Why: we're not in production yet but the day28-dm cron fired a
-- real summary into the team channel (May 18). Need a fast way to
-- pause everything from the admin UI without touching env vars.
--
-- Lives in admin_config (key-value table) so the existing config
-- read/write paths work. Toggle UI is at /admin/discord.
--
-- Default for every switch: "false" (paused). Karlo flips them on
-- when the platform actually launches.
--
-- Switch semantics:
--   • dms_master_enabled              — global kill switch. If false,
--                                       no automated Discord send happens
--                                       regardless of the per-message toggles.
--   • day28_dm_enabled                — Day-28 student summary DM cron.
--   • engagement_alerts_enabled       — check-engagement cron's daily
--                                       team-channel alert embed.
--   • csm_task_summary_enabled        — check-csm-tasks cron's daily
--                                       team-channel "N new tasks" post.
--                                       (Task generation itself is not
--                                       gated — those land in /admin/tasks
--                                       and don't get sent anywhere.)
--
-- The /api/admin/preview-day28-dm endpoint is NOT gated — manual
-- previews always work so the team can keep testing formatting.
--
-- Idempotent. Safe to re-run.
-- ============================================================

insert into admin_config (key, value, description) values
  ('dms_master_enabled', 'false',
   'Global kill switch for every automated Discord send. When false, no cron sends. Flip from /admin/discord.'),
  ('day28_dm_enabled', 'false',
   'Day-28 student summary DM (cron at 09:30 UTC). Only fires when this AND master are true.'),
  ('engagement_alerts_enabled', 'false',
   'Daily disengagement alert embed posted to the team channel (cron at 09:00 UTC). Only fires when this AND master are true.'),
  ('csm_task_summary_enabled', 'false',
   'Daily "Astrid Task Queue update" embed posted to the team channel after the CSM cron runs. Only the embed is gated — task generation always runs.')
on conflict (key) do nothing;
