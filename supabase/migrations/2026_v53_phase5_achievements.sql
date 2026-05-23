-- ============================================================
-- v53: Phase 5 - achievements.
--
-- Steam-style achievement catalog + per-student unlock rows + a
-- view that surfaces global unlock % so the modal can show "12%
-- of students earned this".
--
-- Catalog is migration-managed (new ones land via new migrations,
-- never editable from admin). Per-student rows are append-only -
-- once unlocked, sticky forever.
--
-- The 17 seeded achievements come from the 23-05-2026 list Karlo
-- approved (lovro-brief-v3 conversation). Mix of common → legendary
-- so the rarity tiers actually mean something:
--    4 common, 4 uncommon, 5 rare, 4 legendary
--
-- Idempotent.
-- ============================================================

-- 1. achievements catalog ------------------------------------------------
create table if not exists achievements (
  id            text primary key,
  name          text not null,
  description   text not null,
  icon          text not null,
  rarity        text not null check (rarity in ('common','uncommon','rare','legendary')),
  sort_order    int  not null,
  created_at    timestamptz not null default now()
);

comment on table achievements is
  'Catalog of unlockable achievements. New rows land via migration; never editable from /admin.';

-- 2. per-student unlocks -------------------------------------------------
create table if not exists student_achievements (
  student_id      uuid not null references students(id) on delete cascade,
  achievement_id  text not null references achievements(id) on delete cascade,
  unlocked_at     timestamptz not null default now(),
  primary key (student_id, achievement_id)
);

create index if not exists idx_student_achievements_student
  on student_achievements(student_id);
create index if not exists idx_student_achievements_unlocked
  on student_achievements(unlocked_at desc);

comment on table student_achievements is
  'One row per (student, achievement) unlock. Append-only - the evaluator inserts; nothing updates or deletes.';

-- 3. unlock-rate view ----------------------------------------------------
-- The denominator is students with joined_at IS NOT NULL so refunded /
-- unactivated accounts don't drag the % down. csm_exempt accounts are
-- also excluded (team dummies).
create or replace view achievement_unlock_stats as
select
  a.id,
  count(distinct sa.student_id) as unlocked_count,
  (
    select count(*)
    from students
    where joined_at is not null
      and csm_exempt = false
  ) as total_count,
  case
    when (
      select count(*)
      from students
      where joined_at is not null
        and csm_exempt = false
    ) = 0 then 0
    else round(
      100.0 * count(distinct sa.student_id)::numeric / (
        select count(*)
        from students
        where joined_at is not null
          and csm_exempt = false
      ),
      1
    )
  end as unlock_pct
from achievements a
left join student_achievements sa on sa.achievement_id = a.id
group by a.id;

comment on view achievement_unlock_stats is
  'Per-achievement unlock counts + global %. Excludes unactivated + csm_exempt students from the denominator.';

-- 4. RLS -----------------------------------------------------------------
alter table achievements enable row level security;
alter table student_achievements enable row level security;

drop policy if exists "achievements: anyone reads" on achievements;
create policy "achievements: anyone reads"
on achievements for select using (true);

drop policy if exists "student_achievements: student reads own" on student_achievements;
create policy "student_achievements: student reads own"
on student_achievements for select
using (
  student_id in (
    select id from students where supabase_user_id = auth.uid()
  )
);

drop policy if exists "student_achievements: team reads all" on student_achievements;
create policy "student_achievements: team reads all"
on student_achievements for select
using (exists (select 1 from team_members where supabase_user_id = auth.uid()));

-- 5. seed --------------------------------------------------------------
insert into achievements (id, name, description, icon, rarity, sort_order) values
  ('first_lesson',           'First Steps',          'Watch your first lesson.',                                                        '🎬', 'common',    10),
  ('first_action_shipped',   'Took the Shot',        'Ship your first action item.',                                                    '🎯', 'common',    20),
  ('streak_7',               'Habit Builder',        'Reach a 7-day streak.',                                                           '🔥', 'common',    30),
  ('r1_clear',               'Foundation Set',       'Finish every lesson and action item in Region 1.',                                '🧱', 'common',    40),
  ('r2_clear',               'Past the Halfway',     'Finish every lesson and action item in Region 2.',                                '🪜', 'uncommon',  50),
  ('discount_earned',        'Discount Earned',      'Earn the 30% off month two by clearing R1 + R2 in time.',                         '🏷️', 'uncommon',  60),
  ('streak_14',              'Two Weeks Strong',     'Reach a 14-day streak.',                                                          '🔥', 'uncommon',  70),
  ('r3_clear',               'Almost There',         'Finish every lesson and action item in Region 3.',                                '🗺️', 'uncommon',  80),
  ('r4_clear',               'Summit Reached',       'Finish every lesson and action item in Region 4. The sprint is complete.',        '🏔️', 'rare',      90),
  ('streak_30',              'Full Sprint',          'Reach a 30-day streak.',                                                          '🔥', 'rare',     100),
  ('bounty_access_claimed',  'Through the Gate',     'Get approved for Bounty Access. The Playbook unlocks for you.',                   '🗝️', 'rare',     110),
  ('triple_play',            'Triple Threat',        'Complete 3 lessons in a single calendar day.',                                    '⚡', 'rare',     120),
  ('region_sweep',           'Region Sweep',         'Clear an entire region in a single calendar day.',                                '🌊', 'rare',     130),
  ('early_finisher',         'Ahead of Schedule',    'Finish Region 4 before Day 21.',                                                  '🚀', 'legendary',140),
  ('speedrun',               'Speedrunner',          'Finish Region 4 before Day 14.',                                                  '💨', 'legendary',150),
  ('unbroken',               'Unbroken',             'Hit a 30-day streak with no break since Day 1.',                                  '💎', 'legendary',160),
  ('perfect_run',            'Perfectionist',        'Finish the sprint with zero skipped lessons.',                                    '✨', 'legendary',170)
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  icon = excluded.icon,
  rarity = excluded.rarity,
  sort_order = excluded.sort_order;
