-- ============================================================================
-- v87 — ETfB Brand Owners
--
-- Records which BRAND OWNER a free team checkout link belongs to. That single
-- fact does not exist anywhere else: Whop knows the plans, the memberships and
-- the money, but not the owner→link relationship, which today lives only in a
-- free-text `internal_notes` field on the plan.
--
-- Everything else (owners, seats, subscription state, cycle-end dates) is read
-- LIVE from Whop at request time and is deliberately NOT cached here — a copy
-- would drift, and Whop already exposes seat counts (`stock`, `member_count`).
--
-- BOUNDARY: brand owners are NOT students.
--   * students.whop_user_id is UNIQUE, so a person who is both a student and a
--     brand owner collapses into a single row with a single membership.
--   * tasks.student_id is `uuid not null references students(id)`, so the CSM
--     queue cannot hold brand-owner work either.
-- Both tables below therefore key on the Whop user id as TEXT, with no foreign
-- key into students. This is deliberate, not an oversight.
--
-- RLS: current_user_is_team() for read AND write, matching the `tasks`
-- precedent. Deliberately NOT the founder/admin pattern used by templates and
-- admin_config, and NOT current_user_is_stats_owner() — both would lock out the
-- CSM whose job this tool is.
--
-- Idempotent. Safe to re-run.
-- ============================================================================

-- ─────────────── 1. etfb_team_links ───────────────
-- One row per free team checkout link (a Whop plan under the Apex product).

create table if not exists etfb_team_links (
  plan_id                 text primary key,              -- Whop plan id = the link
  owner_whop_user_id      text,                          -- null only while status='needs_owner'/'archived'/'out_of_scope'
  owner_name              text,                          -- display snapshot; Whop remains source of truth
  owner_email             text,                          -- display snapshot
  status                  text not null default 'active'
    check (status in ('active', 'needs_owner', 'archived', 'out_of_scope', 'error')),
  attribution_method      text not null
    check (attribution_method in (
      'minted_by_app',            -- created by this app; owner known by construction
      'whop_username_label',      -- imported: Whop username found in internal_notes
      'discord_handle_label',     -- imported: Discord handle found in internal_notes
      'owner_redeemed_own_link',  -- imported: exactly one paid ETfB owner among the seat holders
      'exact_owner_name',         -- imported: exact unique name match against brand owners — NEEDS CONFIRMING
      'manual',                   -- assigned by a human
      'out_of_scope'              -- not a team link at all (Evolve partner link)
    )),
  attribution_confidence  text not null
    check (attribution_confidence in ('certain', 'confirm', 'manual')),
  note                    text,
  minted_by               uuid references team_members(id),
  created_at              timestamptz not null default now(),
  imported_at             timestamptz,
  confirmed_at            timestamptz,
  confirmed_by            uuid references team_members(id),
  archived_at             timestamptz,
  errored_at              timestamptz,
  updated_at              timestamptz not null default now()
);

-- IDEMPOTENCY GUARANTEE. One active link per owner. Without this a double-click
-- or a retried request mints a second Whop plan, the owner's team splits across
-- two links, and a later revocation silently misses half of them. Two owners in
-- production already have duplicate waitlist plans
-- from manual work, which is precisely this failure by hand.
create unique index if not exists etfb_team_links_one_active_per_owner
  on etfb_team_links (owner_whop_user_id)
  where status = 'active' and owner_whop_user_id is not null;

create index if not exists etfb_team_links_status_idx on etfb_team_links (status);
create index if not exists etfb_team_links_owner_idx  on etfb_team_links (owner_whop_user_id);

-- ─────────────── 2. etfb_seat_decisions ───────────────
-- A human override on ONE seat. Per-seat, never per-link: plan_P9yx1m1HdHfMt
-- holds 29 seats on a 10-seat plan and they do not all belong to that link's
-- owner, so a link-level decision would be wrong by construction.
--
-- Absence of a row is the normal case. A seat that has been revoked in Whop
-- simply stops being valid and drops out of the live read, so "done" needs no
-- row here.

create table if not exists etfb_seat_decisions (
  membership_id  text primary key,                       -- Whop membership id = the seat
  plan_id        text not null references etfb_team_links(plan_id) on delete cascade,
  decision       text not null
    check (decision in (
      'keep',      -- leave this person alone regardless of owner state
      'snoozed',   -- hide until snooze_until
      'revoked'    -- written only by a future revoke button; v1 never writes this
    )),
  reason         text,
  snooze_until   timestamptz,
  decided_by     uuid not null references team_members(id),
  decided_at     timestamptz not null default now(),
  revoked_at     timestamptz,
  revoke_error   text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists etfb_seat_decisions_plan_idx on etfb_seat_decisions (plan_id);

-- ─────────────── 3. RLS ───────────────

alter table etfb_team_links     enable row level security;
alter table etfb_seat_decisions enable row level security;

drop policy if exists "Team reads etfb_team_links"  on etfb_team_links;
drop policy if exists "Team writes etfb_team_links" on etfb_team_links;
create policy "Team reads etfb_team_links"
  on etfb_team_links for select using (current_user_is_team());
create policy "Team writes etfb_team_links"
  on etfb_team_links for all using (current_user_is_team()) with check (current_user_is_team());

drop policy if exists "Team reads etfb_seat_decisions"  on etfb_seat_decisions;
drop policy if exists "Team writes etfb_seat_decisions" on etfb_seat_decisions;
create policy "Team reads etfb_seat_decisions"
  on etfb_seat_decisions for select using (current_user_is_team());
create policy "Team writes etfb_seat_decisions"
  on etfb_seat_decisions for all using (current_user_is_team()) with check (current_user_is_team());

-- ─────────────── 4. updated_at ───────────────

create or replace function public.etfb_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists etfb_team_links_touch on etfb_team_links;
create trigger etfb_team_links_touch before update on etfb_team_links
  for each row execute function public.etfb_touch_updated_at();

drop trigger if exists etfb_seat_decisions_touch on etfb_seat_decisions;
create trigger etfb_seat_decisions_touch before update on etfb_seat_decisions
  for each row execute function public.etfb_touch_updated_at();

-- ─────────────── 5. Seed: the 118 links that already exist in Whop ───────────────
-- The seed was generated from live Whop data on 2026-09-10, reviewed by Lovro,
-- and ran in production with this file the same day. Its 118 rows hold real
-- brand owners' names, email addresses and Whop user ids, and this repository
-- is public, so on 2026-10-17 the rows were taken out of this file. Lovro keeps
-- the rows as they ran outside the repository, with the ETfB build's notes.
-- Re-running this file changes nothing in production: the rows are there, and
-- the insert skipped any plan_id already present. A database built from these
-- files has an empty etfb_team_links until that kept copy runs after this file.
--
-- `imported_at` was stamped on every seeded row, so an imported link stays
-- distinguishable from an app-minted one forever.
--
-- Where one owner ended up with two links (the team minted a replacement by
-- hand and never retired the old one), the link holding the most seats stayed
-- 'active' and the other was archived with a note. This is the same invariant
-- etfb_team_links_one_active_per_owner enforces going forward.
