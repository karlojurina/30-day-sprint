-- v86 — stats_saved_views: saved tile layouts for the founder-only
-- /admin/stats revenue surface.
--
-- WHY A NEW TABLE AND NOT admin_config. admin_config was the obvious
-- reuse candidate (key/value, already has a GET+PUT route, writes
-- already gated to founder/admin) and was REJECTED for two reasons:
--   1. Its read policy is `public.current_user_is_team()` — role-blind.
--      Every CSM can SELECT it.
--   2. /admin/settings does an UNFILTERED `.select("*")` with the
--      BROWSER anon client and renders every returned row as an
--      editable <input type="text">. A saved-views JSON blob would
--      appear as a stray editable text field on the CSM's settings
--      page — readable AND corruptible.
-- Its PUT also cannot INSERT (it does .update().eq(key)), so the row
-- would have to be seeded here anyway.
--
-- REVENUE VISIBILITY IS NOT A ROLE. `team_members.role` is mutable:
-- PATCH /api/admin/team-members/[id] lets any founder grant
-- role='founder' to anyone. So this table gates on the immutable
-- auth.users id, via current_user_is_stats_owner() below. That
-- function is ALSO the correct predicate to copy for any future
-- revenue-bearing table — every other policy in this schema is
-- role-blind, so without this there is nothing right to copy.
--
-- No revenue is stored here or anywhere else. This table holds only
-- which metrics the founder wants on screen and how they are arranged.
--
-- Idempotent. Apply after 2026_v85_task_outcomes.sql.


-- ─────────────── 1. the revenue-visibility predicate ───────────────

create or replace function public.current_user_is_stats_owner()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select auth.uid() = '2ba35d07-fdf3-41ee-87c2-4fa2e7711dfb'::uuid
$$;

comment on function public.current_user_is_stats_owner() is
  'Revenue-visibility predicate for /admin/stats. Keys on the IMMUTABLE auth.users id (jurinakarlo2@gmail.com), NOT on team_members.role — role is mutable via PATCH /api/admin/team-members/[id]. Copy this, never current_user_is_team(), for any table that holds or describes revenue.';

grant execute on function public.current_user_is_stats_owner() to authenticated;


-- ─────────────── 2. stats_saved_views ───────────────

create table if not exists stats_saved_views (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references team_members(id),
  name        text not null,
  layout      jsonb not null default '{}'::jsonb,
  status      text not null default 'active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  archived_at timestamptz
);

comment on table stats_saved_views is
  'Saved tile layouts for the founder-only /admin/stats page. One row per named view. layout is jsonb (NOT text) so a corrupt payload is rejected by Postgres at write time rather than surfacing as a render crash. Readable and writable ONLY by current_user_is_stats_owner().';

comment on column stats_saved_views.layout is
  'jsonb: { metrics: [{ key: string, product: string | null }], granularity: "day"|"week"|"month", range: string }. Validated against src/lib/whop-stats-catalog.ts on read; falls back to the default layout if it does not parse.';

comment on column stats_saved_views.status is
  'active | archived. Views are archived, never deleted, so a layout that broke the page can still be inspected.';

-- Postgres has no IF NOT EXISTS for constraints — guard on pg_constraint.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'stats_saved_views_status_chk'
  ) then
    alter table stats_saved_views
      add constraint stats_saved_views_status_chk
      check (status in ('active', 'archived'));
  end if;
end $$;

create index if not exists stats_saved_views_owner_idx
  on stats_saved_views(owner_id, status);

alter table stats_saved_views enable row level security;

-- Single FOR ALL policy: the stats owner is the only reader and the
-- only writer. Deliberately NOT current_user_is_team() — see header.
drop policy if exists "Stats owner reads saved views" on stats_saved_views;
drop policy if exists "Stats owner manages saved views" on stats_saved_views;
create policy "Stats owner manages saved views"
  on stats_saved_views for all
  using (public.current_user_is_stats_owner())
  with check (public.current_user_is_stats_owner());
