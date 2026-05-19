-- ============================================================
-- v44: Track whether a student has ever logged into the sprint app.
--
-- The students table is created by the Whop webhook on
-- membership.activated, which means a row can exist for a student
-- who bought the program but has never clicked through to authenticate
-- in this app. last_active_at defaults to now() at insert time, so
-- it can't be used to distinguish "has logged in" from "row just got
-- created by the webhook."
--
-- Adds first_sprint_login_at — nullable timestamptz, stamped on the
-- first successful Whop OAuth callback in this app, never overwritten
-- after that. Powers the new "Has logged into the app" trigger
-- condition the CSM templates surface (v44, "logged into the app").
--
-- Idempotent.
-- ============================================================

alter table students
  add column if not exists first_sprint_login_at timestamptz;

comment on column students.first_sprint_login_at is
  'Set the first time the student authenticates into the sprint app via Whop OAuth. Null = never showed up. Never overwritten.';

-- Sanity check (commented):
-- select id, name, joined_at, first_sprint_login_at from students
--   where first_sprint_login_at is null
--   order by joined_at desc limit 20;
