-- ============================================================
-- V2: Streak tracking + Title/Rank columns on students
-- ============================================================

alter table students
  add column if not exists current_streak   int  not null default 0,
  add column if not exists longest_streak   int  not null default 0,
  add column if not exists last_streak_date date,
  add column if not exists current_title    text not null default 'recruit'
    check (current_title in (
      'recruit', 'explorer', 'apprentice', 'ad_creator',
      'strategist', 'bounty_hunter', 'ecomtalent_pro'
    ));
