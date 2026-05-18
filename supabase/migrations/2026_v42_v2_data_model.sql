-- ============================================================
-- v42: v2 data model — bounty access claim, sprint completion,
-- first-client landed flag, and the new playbook_nodes table that
-- powers Map 2.
--
-- Per lovro-brief-v2/01-data-model.md (16-05-2026).
--
-- Three nullable timestamp fields on students drive the three
-- event-triggered moments in v2:
--   • bounty_access_claimed_at  — l057 click ("Claim Bounty Access")
--   • sprint_completed_at       — l058 → "Finish Program" click
--                                 (also: flips Map 2 on as the
--                                 default surface for the student)
--   • first_client_landed_at    — Map 2 milestone self-report
--
-- Plus playbook_welcome_seen_at to track the one-time intro
-- overlay that fires the first time a student lands on Map 2.
--
-- The playbook_nodes table is a 4-row content table that drives
-- the Map 2 hub. Seeded with placeholder subtitles + TODO(karlo)
-- doc bodies — Karlo writes the final copy via direct edits.
--
-- All adds are additive + nullable. No backfill needed; existing
-- students get NULL for all four new columns.
--
-- Idempotent. Safe to re-run.
-- ============================================================

-- ─────────────── 1. Students fields ───────────────

alter table students
  add column if not exists bounty_access_claimed_at  timestamptz,
  add column if not exists sprint_completed_at       timestamptz,
  add column if not exists first_client_landed_at    timestamptz,
  add column if not exists playbook_welcome_seen_at  timestamptz;

-- ─────────────── 2. playbook_nodes table ───────────────

create table if not exists playbook_nodes (
  id            varchar(32) primary key,
  position      smallint    not null,
  title         varchar(80) not null,
  subtitle      varchar(160),
  doc_content   text        not null default '',
  video_url     varchar(255),
  is_milestone  boolean     not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- If the previous run of this migration created the table with the
-- original varchar(16) id column (the brief's spec was too tight —
-- pb_land_first_client is 20 chars), widen it. No-op when the
-- column is already the larger type.
alter table playbook_nodes
  alter column id type varchar(32);

alter table playbook_nodes enable row level security;

-- Anyone authenticated can read the playbook content. Students
-- need this on Map 2; team needs it on any admin surface that
-- previews the hub.
drop policy if exists "Anyone authenticated reads playbook_nodes" on playbook_nodes;
create policy "Anyone authenticated reads playbook_nodes"
  on playbook_nodes for select
  using (auth.uid() is not null);

-- Writes locked to team members. Uses the existing
-- public.current_user_is_team() helper introduced for the
-- v1 CSM tables.
drop policy if exists "Team writes playbook_nodes" on playbook_nodes;
create policy "Team writes playbook_nodes"
  on playbook_nodes for all
  using (public.current_user_is_team())
  with check (public.current_user_is_team());

-- ─────────────── 3. Seed the 4 nodes ───────────────
--
-- Subtitles are placeholder copy in Karlo's voice register
-- (banned words avoided per context/promise-and-voice.md).
-- doc_content is a TODO(karlo) marker — the real bodies land
-- when Karlo writes them. Map 2 will render the placeholder
-- in the sheet body until then; it's not user-shipped copy.

insert into playbook_nodes (id, position, title, subtitle, doc_content, is_milestone) values
  ('pb_submit_bounties', 1,
   'Submit Ad Bounties',
   'Real briefs, real money — bounty by bounty.',
   'TODO(karlo): doc body — how to find a bounty brief, build the ad, submit it, what to expect on the result.',
   false),
  ('pb_build_portfolio', 2,
   'Build a Dialed Portfolio',
   'Every ad you ship is the resume that gets you hired.',
   'TODO(karlo): doc body — how to assemble a portfolio from the bounties you''re shipping, what brands actually look at.',
   false),
  ('pb_apply_job_board', 3,
   'Apply to the Job Board',
   'Brands looking for marketers are already inside.',
   'TODO(karlo): doc body — how to find the listings, how to apply, what makes an application land.',
   false),
  ('pb_land_first_client', 4,
   'Land Your First Client',
   'The biggest moment in the playbook.',
   'TODO(karlo): doc body — what "landed" actually means, what to do the day you get there.',
   true)
on conflict (id) do nothing;

-- ─────────────── 4. Sanity checks (commented) ───────────────
-- select column_name from information_schema.columns
--   where table_name = 'students' and column_name like '%client%'
--      or column_name like '%bounty%' or column_name like '%sprint%'
--      or column_name like '%playbook%';
-- select id, position, title, is_milestone from playbook_nodes order by position;
-- -- expect 4 rows, pb_land_first_client.is_milestone = true.
