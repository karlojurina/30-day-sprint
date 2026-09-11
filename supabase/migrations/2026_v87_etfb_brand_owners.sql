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
-- production (liaoant18888, michael51ce) already have duplicate waitlist plans
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
-- Generated from live Whop data 2026-09-10, reviewed by Lovro against
-- ~/Downloads/etfb-cleanup-2026-09-10/OLD_LINKS_MAPPED.csv.
--
-- `imported_at` is stamped on every seeded row, so an imported link stays
-- distinguishable from an app-minted one forever.
--
-- Where one owner ended up with two links (it happens — the team minted a
-- replacement by hand and never retired the old one), the link holding the
-- most seats stays 'active' and the other is archived with a note. This is the
-- same invariant etfb_team_links_one_active_per_owner enforces going forward.

insert into etfb_team_links
  (plan_id, owner_whop_user_id, owner_name, owner_email, status,
   attribution_method, attribution_confidence, note, imported_at)
values
  ('plan_RWZt6MAT8T6gS', null, null, null, 'archived', 'manual', 'certain', 'imported 2026-09-10; never redeemed; label ''''', now()),
  ('plan_t4VXohAMYT669', null, null, null, 'out_of_scope', 'out_of_scope', 'certain', 'Evolve partner link — NOT a team seat link, never revoke', now()),
  ('plan_5WZyYigDI7HgB', null, null, null, 'archived', 'manual', 'certain', 'test link — confirmed by Lovro 2026-09-10', now()),
  ('plan_W7jZXgtUAnBJB', 'user_pp7nEot4Vy6Km', 'Alex Birch', 'alex@honestfba.com', 'archived', 'exact_owner_name', 'confirm', 'imported 2026-09-10; label was ''Alex Birch'' — DUPLICATE of plan_P9yx1m1HdHfMt for the same owner; archived so one active link per owner holds', now()),
  ('plan_qFZ0ouSjpzZg7', 'user_ZVNz46TmWGnIJ', 'Uzi Dan Pagirsky', 'uzi@magicfp.com', 'active', 'exact_owner_name', 'confirm', 'imported 2026-09-10; label was ''Uzi Dan Pagirsky''', now()),
  ('plan_P9yx1m1HdHfMt', 'user_pp7nEot4Vy6Km', 'Alex Birch', 'alex@honestfba.com', 'active', 'exact_owner_name', 'confirm', 'imported 2026-09-10; label was ''Alex Birch''', now()),
  ('plan_Z5Q0zq7doUI8H', 'user_BXGhtz3qvrwIb', 'Ashish Sardjoe', 'as.striveenterprise@gmail.com', 'active', 'manual', 'certain', 'identified by Lovro 2026-09-10', now()),
  ('plan_HojJOiMximgpU', 'user_m6g5ququawkZR', 'Leo', 'leoyankovbusiness@protonmail.com', 'active', 'owner_redeemed_own_link', 'certain', 'imported 2026-09-10; label was ''Leo''', now()),
  ('plan_M9QwmyNynKjoQ', null, null, null, 'archived', 'manual', 'certain', 'imported 2026-09-10; never redeemed; label ''Sepehr1x''', now()),
  ('plan_nMoysXDDNVFX5', 'user_hDxV2SFCFl2DV', 'Carl Andersson', 'carlctha@gmail.com', 'active', 'exact_owner_name', 'confirm', 'imported 2026-09-10; label was ''Carl Andersson''', now()),
  ('plan_VtwSdF0ili4RR', 'user_iJxpsRV9m7X7s', 'F Juch', 'fgjuch@gmail.com', 'active', 'exact_owner_name', 'confirm', 'imported 2026-09-10; label was ''F Juch''', now()),
  ('plan_lAAuIB5R9olNq', 'user_y8GO8m8xD0E8w', '', 'jordanbazouzi@nu-reach.com', 'active', 'owner_redeemed_own_link', 'certain', 'imported 2026-09-10; label was ''Jordan''', now()),
  ('plan_ILH9iXEY59nXv', 'user_B2FtnzhMRJaR3', 'Logen Boyce', 'logenboycebusiness@gmail.com', 'active', 'owner_redeemed_own_link', 'certain', 'imported 2026-09-10; label was ''Logen Boyce''', now()),
  ('plan_ZUqUmieMhc3Jt', 'user_sbfmZgi89ds8N', 'Will Curry', 'wcurry08@gmail.com', 'active', 'exact_owner_name', 'confirm', 'imported 2026-09-10; label was ''Will Curry''', now()),
  ('plan_uq3mHMao2PdJd', 'user_4uzIy5IyKfVAX', 'Danial Lee', 'danialecom22@gmail.com', 'active', 'exact_owner_name', 'confirm', 'imported 2026-09-10; label was ''Danial Lee''', now()),
  ('plan_WWe9isrBcd1yC', 'user_qsPJVoFywcJoG', 'Richard', 'richvnguyen79@gmail.com', 'active', 'exact_owner_name', 'confirm', 'imported 2026-09-10; label was ''Richard''', now()),
  ('plan_KOLapcFxPXnAJ', null, null, null, 'archived', 'manual', 'certain', 'imported 2026-09-10; never redeemed; label ''Niko Goricki''', now()),
  ('plan_MHrMF9QLJFRlT', 'user_OgCOCFyrHqMQ6', 'Sebastian Bohren', 'sebastian.ecombiz@gmail.com', 'active', 'exact_owner_name', 'confirm', 'imported 2026-09-10; label was ''Sebastian Bohren''', now()),
  ('plan_kh0Fwr3Gzqd7V', 'user_bt5Sl9Ogr8yzg', 'Teoh', 'teohbusiness@gmail.com', 'active', 'owner_redeemed_own_link', 'certain', 'imported 2026-09-10; label was ''Teoh''', now()),
  ('plan_4T2BdebR7kjOr', 'user_Q9qmEJH7YG4da', 'b', 'karim@functionretail.com', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''Karimee''', now()),
  ('plan_MbIUokwVaRdvI', 'user_QzTM2EekXlidy', 'Jacob Love', 'jacobtylove@gmail.com', 'active', 'exact_owner_name', 'confirm', 'imported 2026-09-10; label was ''Jacob Love''', now()),
  ('plan_WqeQb3grh85IA', 'user_pLgHvLWaD6Xin', 'Josiah Lively', 'livelyjosiah@gmail.com', 'active', 'owner_redeemed_own_link', 'certain', 'imported 2026-09-10; label was ''Josiah Lively''', now()),
  ('plan_X7Ct1PSsPacD5', 'user_x4bnJkKkLBUQM', 'Tommy Broughton', 'tommyjxb@gmail.com', 'active', 'exact_owner_name', 'confirm', 'imported 2026-09-10; label was ''Tommy Broughton''', now()),
  ('plan_hzTkvJG5W89D0', 'user_IaqwTXuEp3z3k', 'Brooks Orradre', 'btorradre@gmail.com', 'active', 'exact_owner_name', 'confirm', 'imported 2026-09-10; label was ''Brooks Orradre''', now()),
  ('plan_fNQM9Wynz4aLJ', 'user_PuEK0A5x4wCaq', '', 'brandscaler88@gmail.com', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''Brandscalerf0''', now()),
  ('plan_0Tr7x6QQfTl48', 'user_PRWnkqZzrRoEr', 'Aaronkim', 'aaronkim5050@gmail.com', 'active', 'discord_handle_label', 'certain', 'imported 2026-09-10; label was ''Aaronkim''', now()),
  ('plan_AhU9edhIcpdwM', null, null, null, 'archived', 'manual', 'certain', 'imported 2026-09-10; never redeemed; label ''Jurgis Macys''', now()),
  ('plan_ADzbRgoxjJzli', 'user_gEj62wMDWVtlD', 'SerlinoLab', 'marketing@serlinolab.com', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''SerlinoLab''', now()),
  ('plan_PkrT0TVbHq3jd', 'user_JNVWGz1hD2hLp', 'Joey D', 'joey@lejardinswitzerland.com', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''perkycoconut''', now()),
  ('plan_p838QTD59Lmz1', null, null, null, 'archived', 'manual', 'certain', 'imported 2026-09-10; never redeemed; label ''Austinm Salzillo''', now()),
  ('plan_9eRq0claiXmyw', 'user_vPbumWM6D6Uh5', 'Tim Nguyen', 'timm.nguyenn@hotmail.com', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''TimmNguyenn''', now()),
  ('plan_TahqfxtXVC6fp', 'user_w2GrMxz44cOeo', 'Nardom', 'maksimovichleonardo@gmail.com', 'active', 'exact_owner_name', 'confirm', 'imported 2026-09-10; label was ''Nardom''', now()),
  ('plan_XyKcDksXcVjsd', 'user_EQnajbudzhrzj', 'Joran Luth', 'joran@lthholding.nl', 'active', 'exact_owner_name', 'confirm', 'imported 2026-09-10; label was ''Joran Luth''', now()),
  ('plan_DqkGno35H293i', 'user_bfp8s8qY1yl4v', '', 'primedigitaltradinglimited@gmail.com', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''drierpolice''', now()),
  ('plan_33EqEnMPh7VKK', null, null, null, 'archived', 'manual', 'certain', 'imported 2026-09-10; never redeemed; label ''Cris Scott''', now()),
  ('plan_An2AlL8GP4i0i', 'user_5CiWsSipuozFp', 'Johann Michel', 'jomax.commerce@gmail.com', 'active', 'owner_redeemed_own_link', 'certain', 'imported 2026-09-10; label was ''Johann''', now()),
  ('plan_AYHbY5JP83DQb', 'user_ssXgqNUdVLxsv', 'Manuel Pérez', 'mpm@atlantisgestion.es', 'active', 'owner_redeemed_own_link', 'certain', 'imported 2026-09-10; label was ''Manuel Perez''', now()),
  ('plan_3EIlU7kctt4z1', 'user_26mmNSAIUyArr', 'Anthony Oudy', 'antoudy99@gmail.com', 'active', 'exact_owner_name', 'confirm', 'imported 2026-09-10; label was ''Anthony Oudy''', now()),
  ('plan_byuztLSC6fN8S', 'user_vXQSezxCIKmm8', 'Claudia Swindale', 'claudia@luckyegg.co', 'active', 'owner_redeemed_own_link', 'certain', 'imported 2026-09-10; label was ''Claudia Swindale''', now()),
  ('plan_xH8UNHdMcObsr', 'user_5CiWsSipuozFp', 'Johann Michel', 'jomax.commerce@gmail.com', 'archived', 'exact_owner_name', 'confirm', 'imported 2026-09-10; label was ''Johann Michel - JoMax'' — DUPLICATE of plan_An2AlL8GP4i0i for the same owner; archived so one active link per owner holds', now()),
  ('plan_E13y2PhTFOIyr', 'user_97jD0TlmW7rgK', 'Wiets Burger', 'wietsbu@gmail.com', 'active', 'exact_owner_name', 'confirm', 'imported 2026-09-10; label was ''Wiets Burger''', now()),
  ('plan_vntYA7KdX5bco', 'user_qk0keO2SS3FFD', 'rehan', 'rehanvg@gmail.com', 'active', 'owner_redeemed_own_link', 'certain', 'imported 2026-09-10; label was ''Rehan''', now()),
  ('plan_sExSki4zAA43x', 'user_ivTNed9ZLLOnN', 'Kien T nguyen', 'yunminoishere@gmail.com', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''Kien T Nguyen - yunminoishere''', now()),
  ('plan_OwCBR0pk911j9', 'user_ErvYWEEQTi75b', 'Onuia', 'operations@onuia.com', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''Onuia''', now()),
  ('plan_EShDNGJJfpcZm', 'user_amhxXbzkc9ydA', 'Amit', 'accounts@khulife.co', 'active', 'exact_owner_name', 'confirm', 'imported 2026-09-10; label was ''Amit''', now()),
  ('plan_Maamjiz9ydpkl', 'user_xqfmq4BYgZ8Sq', 'Mikey', 'mikey@mailbakes.com', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''Mikey - bikey123''', now()),
  ('plan_RaPNfn0zWTI8B', 'user_M7Qt2Eh5eA7ol', 'Joel & Sam', 'joel.rensam.w@gmail.com', 'active', 'exact_owner_name', 'confirm', 'imported 2026-09-10; label was ''Joel & Sam''', now()),
  ('plan_IKRmqeNPr9F1Y', null, null, null, 'archived', 'manual', 'certain', 'imported 2026-09-10; never redeemed; label ''Ahmed-iamsg''', now()),
  ('plan_5SgpK7Hy3dNdA', 'user_NfThr1kOlsDUZ', 'Din Radetinac', 'radetinacdin@gmail.com', 'active', 'owner_redeemed_own_link', 'certain', 'imported 2026-09-10; label was ''Din Radetinac - Oleturf''', now()),
  ('plan_NXtYxddZ1bP8g', 'user_CWcD4hi6bMrrg', 'Karos Ma', 'karosma.km@gmail.com', 'active', 'owner_redeemed_own_link', 'certain', 'imported 2026-09-10; label was ''Karos Ma''', now()),
  ('plan_1676bOKoqlZ5i', 'user_4kCG26L9VcUa7', 'William Rivera', 'will@ecomdegreeuniversity.com', 'active', 'exact_owner_name', 'confirm', 'imported 2026-09-10; label was ''William Rivera''', now()),
  ('plan_4mwqoMDuN15bW', 'user_HNF5e0JY96YvA', 'Jaimeu', 'jaimey@sunbizbrands.com', 'active', 'owner_redeemed_own_link', 'certain', 'imported 2026-09-10; label was ''Jaimeu''', now()),
  ('plan_2e0xMJlW45lKo', 'user_1y2D44gjHRc5b', 'Awad', 'cratemunch@gmail.com', 'active', 'exact_owner_name', 'confirm', 'imported 2026-09-10; label was ''Awad''', now()),
  ('plan_QdEQ6BVrdCPsK', 'user_mjJYabMlSUK10', '', 'jordanproductions02@gmail.com', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''Zach - userc99c666975''', now()),
  ('plan_V1ZbmVkttXJvt', 'user_LktmEh6efExb8', 'qwertmcsquirty', 'benvail36@gmail.com', 'active', 'owner_redeemed_own_link', 'certain', 'imported 2026-09-10; label was ''qwertmcsquirty''', now()),
  ('plan_TiVNpYnMMa1FT', null, null, null, 'archived', 'manual', 'certain', 'imported 2026-09-10; never redeemed; label ''Seond Ltd.''', now()),
  ('plan_Q1jIqsa09z4WZ', 'user_DmEqZtXGDrIMs', '', 'axel.odhner@stonebite.org', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''elfincake32''', now()),
  ('plan_t6HVKeMakRPwk', 'user_C0ftJfhL2E5qx', '', 'alexandrebienaime@seemplify.org', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''sourrover53''', now()),
  ('plan_lPz8mdQX1TWZL', 'user_PKlwoOgwXPLGW', '', 'pavel@craveinc.com', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''focallute''', now()),
  ('plan_uKzpHuszxAATO', 'user_M7JS3OYC5Hc2N', '', 'kevin@kuranordic.se', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''ableboycottde''', now()),
  ('plan_zoK1vzldwE89R', 'user_rE9ieUle4XXxo', 'Henry Nguyen', 'callixestore@gmail.com', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''Henry Nguyen - henryng77''', now()),
  ('plan_zC6J4HCm6KUu7', 'user_wX0wcDv1uClL5', 'Mercator', 'mercatorcommerceltd@gmail.com', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''safevoodoo''', now()),
  ('plan_jPaffhcg68mNK', 'user_jHnS7kYzfz1Nl', 'Keven B', 'markhouten1984@gmail.com', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''Keven B - kevenb777''', now()),
  ('plan_9ytRSlY7ZmM74', 'user_vYskGGVsLo3vz', 'Tom', 'tomroy@hotmail.co.uk', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''Tom - trd4''', now()),
  ('plan_76l1PrXQoFjhF', 'user_jggWnEGkmftsV', 'Roberto Noel', 'roberto@spicycubes.co', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''Roberto Noel - spicycubes3054''', now()),
  ('plan_ch9nVtyKICHal', 'user_fzRM6Bl9leTkI', 'Jordy', 'admin@aetherworld.co', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''Jordy - jordyecom2026''', now()),
  ('plan_wrP6hbw13xmC7', 'user_rPUmHkFQBrFkW', 'Reda Bouab', 'redaec.ltd@gmail.com', 'active', 'owner_redeemed_own_link', 'certain', 'imported 2026-09-10; label was ''Reda''', now()),
  ('plan_U9KkZ01c3OZa5', 'user_7f2HrqqmG6s4Z', 'mustafa zokari', 'mustafazoksri@gmail.com', 'active', 'owner_redeemed_own_link', 'certain', 'imported 2026-09-10; label was ''Mustafa''', now()),
  ('plan_H3Y2av4w2zGBI', 'user_DysyLCUyZH9AG', '', 'dmenter91@gmail.com', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''Dylan - Dmenter91''', now()),
  ('plan_P6lJykvMhdTNm', 'user_vgKh5HTzML9zJ', '', 'mert@carismaspa.com', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''mert19''', now()),
  ('plan_VjUu79ZtkaEL2', 'user_loLLfILaI3SNW', 'Daniel Kolmakov', 'danielkolmakov@gmail.com', 'active', 'owner_redeemed_own_link', 'certain', 'imported 2026-09-10; label was ''Daniel Kolmakov''', now()),
  ('plan_hisBWFe9ewtf3', 'user_xSoGeTDiUxI2n', 'Taylor Whitworth ', 'whitworthenterprise@gmail.com', 'active', 'exact_owner_name', 'confirm', 'imported 2026-09-10; label was ''Taylor Whitworth''', now()),
  ('plan_XvfE8d7N38EGH', 'user_gzw4ncIdgwiTS', 'Mark Grün', 'mark.gruenb@gmail.com', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''Mark Grün - markgruenb''', now()),
  ('plan_7BGdfmgZHGNwV', 'user_Nz6OgyhOPczku', 'Amir', 'amirtai96@gmail.com', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''Amir - amirtai96''', now()),
  ('plan_QAJToQpdS8EoJ', 'user_G3xbl9lsFuvUR', 'Ray Smith', 'rdsmith032@gmail.com', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''Ray Smith - rdsmith''', now()),
  ('plan_osXySeuyMDaYe', 'user_DfDEqCdjxw2w8', 'FL INTERNATIONAL SRLS', 'filippolovadina@gmail.com', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''FL INTERNATIONAL SRLS - filippolova''', now()),
  ('plan_cT6ZxQArLYyYk', 'user_ZMfswcTaRfQ8M', 'Muhammed Ramish Jehanzeb', 'ramishjehanzeb@gmail.com', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''Muhammed Ramish Jehanzeb - ramishjehanzeb''', now()),
  ('plan_FLnlNIG8WNRMV', 'user_gWt1NGFPG30Bj', 'Thomas Jared Van Yperen', 'jared@vintage-muscle.com', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''Thomas Jared Van Yperen - surenonstop''', now()),
  ('plan_kGj27GoNQoKny', 'user_m920Pi8gvWuUa', 'Stefan Vasianovych', 'stefan.vasianovych@gmail.com', 'active', 'discord_handle_label', 'certain', 'imported 2026-09-10; label was ''Stefan - stefannnn_05312''', now()),
  ('plan_qXQwpg4WAPKWr', 'user_Oax7QDWUmCF8A', 'Ruben Collin', 'rubencollin@outlook.com', 'active', 'owner_redeemed_own_link', 'certain', 'imported 2026-09-10; label was ''Ruben''', now()),
  ('plan_6JDhs1ZffHzmV', 'user_RN7lFxWeIA1nb', 'gregoryfts', 'business.gfreitas@gmail.com', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''Gregory - gregoryfts''', now()),
  ('plan_psFj9fwGz3671', 'user_PpkxyNew9L5LI', 'Riccardo Zerbini', 'riccardoecom@yahoo.com', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''Riccardo Zerbini - userffde761290''', now()),
  ('plan_6AxfjelL6dO2y', 'user_5DzgoMIoVzwN1', 'Nevin Jiang', 'nevinjecom@gmail.com', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''Nevin Jiang - nevinjecom''', now()),
  ('plan_NYS1jozoGF5WD', 'user_IqOjm23Yn0nJ8', 'James S', 'jay_sadiq@yahoo.com', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''James S - jxyvevo''', now()),
  ('plan_GYRxx2eTUdSAk', 'user_LMvTyV2U1CFJ4', 'Alex G', 'alexgilmour1991@gmail.com', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''Alex G - alexg-ecom''', now()),
  ('plan_CAaiVG83py5E7', 'user_4BGyfdu2Y7WnH', '', 'fin.law10@gmail.com', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''Fin Law - user096b1894631''', now()),
  ('plan_N5K9K58LP5Rvc', 'user_DqONHMqgJBTZE', 'Anthony Hilario', 'anthony@goalveris.com', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''Anthony Hilario - solidvaquero3e''', now()),
  ('plan_rRQLCFdX0o6mG', 'user_Y9PGtMmUanqeT', 'Ray', 'admin@elevategroup.co.nz', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''Ray - raymong''', now()),
  ('plan_d7dZVtaJYXXrb', 'user_QyEyQicJlMAxJ', 'JD', 'j.dinakis@hotmail.com', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''Jordan - jordaand''', now()),
  ('plan_WruVxFGoLPgjY', 'user_6V9dFFSu3BVnz', 'Milad', 'milad.nazir1304@gmail.com', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''Milad - miladnazir''', now()),
  ('plan_45anP8ps1S1sZ', 'user_rP13jjihFpzmc', 'Brian Kwan', 'briankwands@gmail.com', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''Brian Kwan - briank318''', now()),
  ('plan_j2Md8Z8CQRGW8', 'user_ZjoA7ii66JpZi', 'Ritual Recover', 'help@ritualrecover.com', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''Ritual Recover - okaycherrye6''', now()),
  ('plan_vMmCSppidxmSM', 'user_iRNERRR4Vpl57', '', 'walkdowncommerce@gmail.com', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''juicyoverlayf8''', now()),
  ('plan_P19qNL0uf7jZn', 'user_t2zFoCEQhPrOC', 'Leo Iciano', 'leoicianochannel@gmail.com', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''Leo Iciano - leoiciano''', now()),
  ('plan_uCkGzk9EUTKzd', 'user_3VsqCjpaXiVnM', 'Gabriele', 'kurinuka@gmail.com', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''Gabriele - kn2024''', now()),
  ('plan_Xrk0bckgtFnMm', 'user_HoOU5ybHlk01O', 'MDG', 'mdg@mdg-brands.com', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''MDG - mdgbrands''', now()),
  ('plan_ibr2D69uN6LiE', 'user_9oogKr6zkn5ho', 'Mete Gultekin', 'gultekinn.mete@gmail.com', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''Mete Gultekin - gultekinnmete''', now()),
  ('plan_lI8ZAcqhd3kWS', 'user_klPnJMRZsHItC', 'Wesley Vork', 'wes.98@hotmail.com', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''Wesley Vork - wes98''', now()),
  ('plan_iGDsFOLZDTaSM', 'user_yb2piTfCt35wS', 'Samuel Cooper', 'samuel.cooper1993@gmail.com', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''Samuel Cooper - samcoop112''', now()),
  ('plan_NvKz50OCrNNCP', 'user_uLAocVrpuphP6', 'Zan Strusnik', 'zan.strusnik@gmail.com', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''Zan Strusnik - user70a7819839''', now()),
  ('plan_sCR0hJD35fELA', 'user_D74uHl4u6nms4', 'Jack', 'softdancellc@gmail.com', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''Tunc Omurtak - tuncomu''', now()),
  ('plan_IoIhe2A7NFDeB', 'user_ajhKubj5SIN3O', 'Zhi', 'zhihaolin08@gmail.com', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''Zhi - zhiecom''', now()),
  ('plan_TEyKV3Emq3Xei', 'user_daoYJaeENjMs0', 'Liam', 'liamoates2000@gmail.com', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''Liam - ecomliam''', now()),
  ('plan_W7S1IboWKjeox', 'user_Gwtzp25TyYcFF', 'Hunter Davenport', 'hdport13@gmail.com', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''Hunter Davenport - hdport13''', now()),
  ('plan_eX720SkgvgzqQ', 'user_kUS3pZDtsC6EH', 'Jacob', 'team@urosolteam.com', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''Jacob - iacov''', now()),
  ('plan_4Jq7RwK976B4P', 'user_5gAJgTV5YGvVE', 'Simon Bauer', 'surfscalellc@gmail.com', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''Simon Bauer - sibau''', now()),
  ('plan_RYAxmBSzcZROT', 'user_LiwR5bjWoS7om', 'Usman Ather', 'usmanather1@gmail.com', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''Usman Ather - usmanather''', now()),
  ('plan_YuFUjreYk7a81', 'user_4NgPehRzGu4Oa', 'lucki', 'twenzipw@gmail.com', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''lucki - luckiguy''', now()),
  ('plan_QkX7kzvIsviPi', 'user_4AZGzuv14sz05', 'Sandor', 'alexandre.reeber@corebiogenesis.com', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''Sandor - sandorcaelan''', now()),
  ('plan_8HUsF795Qk9Ua', 'user_LDDwfn3g5Pqs3', '', 'damian@trynativebloom.com', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''Iskander - slimconvert2c''', now()),
  ('plan_ZNsy3yt2W4H52', 'user_yQ17DAp6y9tlr', 'Chris Borghouts', 'chrisborghoutss@gmail.com', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''Chris Borghouts - coolestgobbledygook870e''', now()),
  ('plan_mh9CrrntUJwyP', 'user_GHv8S9hTBjmX9', 'Meder Kenenbaev', 'mkwizrd@gmail.com', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''Meder Kenenbaev - mkwizrd''', now()),
  ('plan_Ts2dgX17FoeG6', 'user_lp01RDOYGZ17k', 'George ', 'hhecomltduk@gmail.com', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''George - georgemikey''', now()),
  ('plan_wdwaThQj98uHq', 'user_RB8HavVe6wLSZ', 'Apex Setups', 'setups.apex@gmail.com', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''Apex Setups - setupsapex''', now()),
  ('plan_AIrVCYxJEdmbk', 'user_5sipSFahy0yVS', 'jay', 'jenson1999@gmail.com', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''Jay - jay56086''', now()),
  ('plan_1LCF8EM3CeZmT', 'user_lpEW3MJd6T29K', 'Chex', 'slavchek2222@gmail.com', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''Chex - usere55d1176701''', now()),
  ('plan_60HhguMHms9pF', 'user_zV2zu9tb2ebqm', '', 'theo@roostys.co', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''saltycanal - saltycanal''', now()),
  ('plan_oUJCqcZE81CZs', 'user_6r8KMYN6H31Uv', 'Jonathan Munoz', 'joniboy205@gmail.com', 'active', 'whop_username_label', 'certain', 'imported 2026-09-10; label was ''Jonathan Munoz - joniboy''', now())
on conflict (plan_id) do nothing;
