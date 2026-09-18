-- v90 — Fix what "Owned by X% of students" divides by, and stop two cards
--       describing things the code does not check.
--
-- THE DENOMINATOR
-- ---------------
-- v53 shipped: count(*) from students where joined_at is not null
--                                      and csm_exempt = false
--
-- That is every student row that has ever existed: 3,399 people, including
-- everyone who bought the course before this app launched and therefore
-- could never have completed a lesson in it. First Steps read 24.1% as a
-- result, against 820 real holders.
--
-- Two separate faults, measured in production 2026-09-18:
--
--   1. The denominator reached back before the app existed, and included
--      students we have NO data for. Lesson completions are mirrored from
--      Whop by syncWatchProgress, which only runs when a student logs in.
--      A buyer who never opens the app has zero rows here no matter what
--      they watched — so they were being scored as a zero rather than
--      excluded as unmeasurable. 467 of the 1,044 post-launch students are
--      in that state.
--
--   2. The NUMERATOR was not filtered at all, while the denominator was.
--      Against a launch-cohort denominator First Steps computed to 101.6%.
--      A percentage over 100 is the proof; the populations must match.
--
-- Now both sides are the same set: joined since launch, not csm_exempt, and
-- has actually used the app. "Used the app" is the OR of three signals
-- because no single one is reliable:
--   * first_sprint_login_at    — stamped server-side in the OAuth callback
--   * first_dashboard_login_at — stamped client-side, misses people, and did
--                                not exist before v51
--   * any lesson completion row — itself proof of a login, since that is the
--                                only path that writes them
-- Using first_dashboard_login_at alone undercounted app users by 161.
--
-- Effect: First Steps goes from 24.1% to roughly 94%, and rises again once
-- the missing badges are backfilled. No student earns or loses anything —
-- this changes a displayed percentage, not who holds what.
--
-- THE TWO FALSE CARDS
-- -------------------
-- region_sweep says "Clear an entire region in a single calendar day." The
-- rule never checks that a region was cleared; it fires on 5 lessons from
-- one region in a day. 702 students hold it while only 229 have ever
-- finished any region. The rule is left alone deliberately — 702 people
-- already earned it under the stated rule and achievements are never
-- revoked — so the words are corrected to match the behaviour.
--
-- r4_clear says "Finish every lesson and action item in Region 4. The sprint
-- is complete." Region 4 has 14 lessons and ZERO action items, and finishing
-- it does not mean the sprint is complete. That phrasing belongs to
-- perfect_run, which genuinely requires all four regions.
--
-- UNBROKEN
-- --------
-- Redefined rather than deleted. "Reach a 30-day streak" rewarded slowness
-- and was unreachable for exactly the students the sprint wants: the fast
-- finishers. It becomes "finish the whole sprint without ever breaking your
-- streak". 0 students held the old version, so nobody loses anything.
--
-- NOT IN THIS MIGRATION: the rarity re-tier. Tiers must be set from
-- corrected counts, and the counts move again when the missing badges are
-- backfilled. That lands after.
--
-- Idempotent: create or replace, update by id, delete if exists.

-- ─────────────────── 1. the view ───────────────────
-- security_invoker stays OFF, deliberately. This aggregate must span every
-- student; with invoker semantics a student would see only their own
-- student_achievements row and every percentage would collapse to 100 or 0.
-- See the v78 header for the full rationale.
create or replace view achievement_unlock_stats
with (security_invoker = false) as
with eligible as (
  select s.id
  from students s
  where s.csm_exempt = false
    and s.first_paid_at >= '2026-05-25T00:00:00Z'::timestamptz
    and (
      exists (
        select 1 from student_milestones m
        where m.student_id = s.id
          and (m.first_sprint_login_at is not null
               or m.first_dashboard_login_at is not null)
      )
      or exists (
        select 1 from student_lesson_completions c
        where c.student_id = s.id
      )
    )
),
denom as (
  select count(*) as n from eligible
)
select
  a.id,
  -- Types must match v53's output EXACTLY. CREATE OR REPLACE VIEW cannot
  -- change a column's type, so these stay bigint (count()'s natural type);
  -- casting them to int makes the migration fail outright.
  count(distinct sa.student_id)                   as unlocked_count,
  (select n from denom)                           as total_count,
  case
    when (select n from denom) = 0 then 0
    else round(
      100.0 * count(distinct sa.student_id)::numeric
        / (select n from denom)::numeric,
      1
    )
  end                                             as unlock_pct
from achievements a
-- Scoped in the JOIN, not a WHERE: a WHERE would drop achievements that
-- nobody holds, and those still need to render as 0%.
left join student_achievements sa
       on sa.achievement_id = a.id
      and sa.student_id in (select id from eligible)
group by a.id;

-- v78 revoked this from anon; re-assert it so a replace can never widen it.
revoke select on public.achievement_unlock_stats from anon;

comment on view public.achievement_unlock_stats is
  'Per-achievement unlock counts + global percentage, shown to students in '
  'the achievements modal. Numerator AND denominator are the same set: '
  'joined since LAUNCH_DATE, not csm_exempt, and has actually used the app. '
  'Students who never opened the app are excluded rather than counted as '
  'zeros, because lesson progress is only mirrored from Whop on login and we '
  'have no data for them. Intentionally runs with security_invoker=off so '
  'the aggregate spans all students — see the v78 header.';

-- ─────────────────── 2. two descriptions that overclaimed ───────────────────
update achievements
   set description = 'Complete 5 lessons from the same region in a single day.'
 where id = 'region_sweep';

update achievements
   set description = 'Finish every lesson in Region 4.'
 where id = 'r4_clear';

-- ─────────────────── 3. redefine Unbroken ───────────────────
-- Was "Reach a 30-day streak", which rewarded slowness: a student who
-- finished the sprint in 6 days could never earn it, while one who logged in
-- daily for a month without finishing could. Backwards for a sprint built to
-- make people finish fast. 0 students ever held it, so nothing is taken away.
-- The matching rule changes in src/lib/achievements.ts in the same release.
update achievements
   set name        = 'Unbroken',
       description = 'Finish the whole sprint without ever breaking your streak.'
 where id = 'unbroken';
