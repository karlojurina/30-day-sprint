-- ============================================================
-- v94 — the staging catalog: regions_next + lessons_next
--
-- Part of PRD 1 (the engine).
--
-- WHY TWO CATALOGS INSTEAD OF SEEDING THE REAL TABLES
--   The live /dashboard, five crons, every admin page, the achievements
--   engine and both discount routes read `lessons` UNFILTERED. Putting 145
--   placeholder rows in the real table would change every denominator on
--   /admin overnight and draw 145 phantom dots on the map 845 students are
--   still using. These tables are invisible to every one of those readers.
--
--   The new /world code reads whichever pair is live through ONE constant
--   (CATALOG_TABLE_SUFFIX), which flips from '_next' to '' at cutover.
--
--   The rows are COPIED into `lessons` at cutover (v98), not renamed, so the
--   real tables keep their own views, policies and FK identities.
--
-- WHAT IS DELIBERATELY PLACEHOLDER HERE
--   Every title, and the area names. 145 rows exist so the world has
--   something to render and so the shape can be verified (does a 25-lesson
--   area read as crammed? does an 8-lesson one read as empty?) months before
--   the course is recorded. PRD 2's v96 upserts the real catalog over this.
--
--   The area ORDER is provisional. The teaching order of the 8 modules is
--   still open (see the memo). order_num is the only thing that encodes it,
--   and it is one UPDATE to change.
--
-- WHAT IS NOT PLACEHOLDER — these are locked decisions:
--   * 8 areas, ids a1..a8. Two-digit-safe ordering comes from order_num,
--     never from sorting the id text ('a10' < 'a9' lexically — the exact
--     bug v92 fixed in student_current_region).
--   * 145 lessons; 144 count toward progress. The 145th is the Ad Bounty
--     pond, which lives INSIDE Creative Strategy rather than being a 9th area.
--   * `type` is ('watch','setup') only. 'action' is RETIRED as a type:
--     an action item is a PROPERTY of a lesson (requires_action), not a
--     separate lesson. Today's title-regex detection (/^Action Item:/i in
--     MapMockup.tsx:504) dies with it.
--   * ~9-10 action items in the ENTIRE course, only in the video and static
--     areas. At roughly 1 per 15 lessons an action item is a rare MILESTONE,
--     not a per-lesson chore, and the UI should show it that way.
--   * Exactly one discount gate, enforced by a partial unique index rather
--     than by hoping.
--
-- Idempotent: re-running re-asserts the 8 areas and adds no duplicate
-- lessons. Wrapped in a transaction.
-- ============================================================

begin;

-- ─────────────── 1. regions_next ───────────────

create table if not exists public.regions_next (
  id         text primary key,
  order_num  int  not null unique,
  name       text not null,
  subtitle   text,
  tagline    text,
  -- NO check constraint. v3's `terrain in ('shore','forest','mountains',
  -- 'city')` is one of the two constraints that would reject the new course
  -- outright, and what these eight places actually look like is the open
  -- art-direction conversation. Nullable until that talk happens.
  terrain    text,
  -- Art-talk outputs. In the DB rather than hardcoded in catalog.ts so the
  -- world can be retuned without a deploy.
  landmark_label text,
  rail_at    numeric,
  quiz_format text,
  is_discount_gate boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.regions_next enable row level security;
drop policy if exists "Authenticated can read regions_next" on public.regions_next;
create policy "Authenticated can read regions_next"
  on public.regions_next for select using (auth.uid() is not null);

-- ─────────────── 2. lessons_next ───────────────

create table if not exists public.lessons_next (
  id         text primary key,
  region_id  text not null references public.regions_next(id) on delete cascade,
  -- 'action' is gone on purpose — see the header.
  type       text not null check (type in ('watch','setup')),
  title      text not null,
  description text,
  -- GLOBAL 1..N, not per-area. This is what orders the whole course, what
  -- prev/next walks, and what the discount helper compares against the gate.
  -- v3's `day int check (day between 1 and 30)` is retired with it — the new
  -- course has no clock.
  sort_order int not null,

  -- THE action-item flag. A lesson that claims one must carry its brief, or
  -- the student gets a milestone with no instructions.
  requires_action boolean not null default false,
  action_brief    text,

  is_optional boolean not null default false,
  is_gate     boolean not null default false,
  lesson_group_id text,
  discord_channel text,

  -- Same six columns v92 added to the real `lessons`, so the cutover copy is
  -- a plain column-listed INSERT with no transformation.
  counts_toward_progress boolean not null default true,
  feature_key   text,
  bunny_video_id text,
  duration_seconds int,
  video_ready_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint lessons_next_action_brief_chk
    check (requires_action = false or action_brief is not null),
  constraint lessons_next_duration_chk
    check (duration_seconds is null or duration_seconds > 0)
);

create unique index if not exists lessons_next_sort_order_key
  on public.lessons_next (sort_order);

-- Only ONE lesson may be the discount gate. Every row in this partial index
-- has is_gate = true, so uniqueness on the column permits exactly one.
create unique index if not exists lessons_next_single_gate_key
  on public.lessons_next (is_gate) where is_gate;

create unique index if not exists lessons_next_bunny_video_id_key
  on public.lessons_next (bunny_video_id) where bunny_video_id is not null;

create unique index if not exists lessons_next_feature_key_key
  on public.lessons_next (feature_key) where feature_key is not null;

create index if not exists idx_lessons_next_region on public.lessons_next (region_id);

alter table public.lessons_next enable row level security;
drop policy if exists "Authenticated can read lessons_next" on public.lessons_next;
create policy "Authenticated can read lessons_next"
  on public.lessons_next for select using (auth.uid() is not null);

drop trigger if exists trg_lessons_next_updated_at on public.lessons_next;
create trigger trg_lessons_next_updated_at
  before update on public.lessons_next
  for each row execute function public.set_updated_at();

-- ─────────────── 3. The eight areas ───────────────
--
-- Counts are Lovro's, locked 2026-09-22. Video Ads was split in two "around
-- the middle" — that split alone dropped the area-size spread from 5.5x to
-- 3.1x, which is what makes a single area layout viable for both the
-- 8-lesson and the 25-lesson case.

insert into public.regions_next (id, order_num, name) values
  ('a1', 1, 'Introduction'),
  ('a2', 2, 'Fundamentals'),
  ('a3', 3, 'Video Ads I'),
  ('a4', 4, 'Video Ads II'),
  ('a5', 5, 'Static Ads'),
  ('a6', 6, 'AI Ads & Content'),
  ('a7', 7, 'Creative Strategy'),
  ('a8', 8, 'Job Board')
on conflict (id) do update
  set order_num = excluded.order_num,
      name      = excluded.name;

-- ─────────────── 4. 145 placeholder lessons ───────────────

insert into public.lessons_next (id, region_id, type, title, sort_order)
select
  a.id || 'l' || lpad(g.n::text, 2, '0'),
  a.id,
  'watch',
  a.name || ' · lesson ' || g.n,
  row_number() over (order by a.order_num, g.n)
from (values
  ('a1', 1, 'Introduction',      8),
  ('a2', 2, 'Fundamentals',     10),
  ('a3', 3, 'Video Ads I',      22),
  ('a4', 4, 'Video Ads II',     22),
  ('a5', 5, 'Static Ads',       25),
  ('a6', 6, 'AI Ads & Content', 22),
  -- 21 lessons + the Ad Bounty pond = 22
  ('a7', 7, 'Creative Strategy', 22),
  ('a8', 8, 'Job Board',        14)
) as a(id, order_num, name, n)
cross join lateral generate_series(1, a.n) as g(n)
on conflict (id) do nothing;

-- ─────────────── 5. The roles, stamped onto placeholders ───────────────

-- The Ad Bounty pond. NOT a 9th area — a place inside Creative Strategy.
-- counts_toward_progress = false makes it the new catalog's l057: reachable,
-- claimable, and outside the denominator.
update public.lessons_next
   set type = 'setup',
       title = 'Ad Bounty · get access',
       counts_toward_progress = false,
       feature_key = 'bounty_access'
 where id = 'a7l22';

-- The discount gate: last lesson of Static Ads. Placeholder position — PRD 2
-- moves it once the real curriculum exists. The partial unique index above
-- guarantees moving it can never leave two gates behind.
update public.lessons_next set is_gate = false where is_gate and id <> 'a5l25';
update public.lessons_next set is_gate = true  where id = 'a5l25';

-- ~9 action items across the whole course, only in the video and static
-- areas, spaced so each one lands as a milestone.
update public.lessons_next
   set requires_action = true,
       action_brief = 'Placeholder brief — PRD 2 writes the real one.'
 where id in ('a3l07','a3l14','a3l21',
              'a4l07','a4l14','a4l21',
              'a5l08','a5l16','a5l24');

commit;

-- ============================================================
-- POST-CHECKS
-- ============================================================
--
-- 1. select count(*) from regions_next;                    -- EXPECT 8
--    select count(*) from lessons_next;                    -- EXPECT 145
--    select count(*) from lessons_next where counts_toward_progress;  -- EXPECT 144
--
-- 2. select r.id, r.name, count(l.id)
--      from regions_next r join lessons_next l on l.region_id = r.id
--     group by r.id, r.name order by r.id;
--    EXPECT 8 rows: 8, 10, 22, 22, 25, 22, 22, 14  (sum 145)
--
-- 3. select count(*) from lessons_next where is_gate;       -- EXPECT 1
--    select count(*) from lessons_next where requires_action;  -- EXPECT 9
--    select id, feature_key from lessons_next where feature_key is not null;
--    EXPECT a7l22 / bounty_access
--
-- 4. Global ordering is contiguous and area-monotonic:
--    select min(sort_order), max(sort_order), count(distinct sort_order)
--      from lessons_next;                                   -- EXPECT 1, 145, 145
--
-- 5. The live app is untouched:
--    select count(*) from lessons;                          -- EXPECT 65 (unchanged)
-- ============================================================
