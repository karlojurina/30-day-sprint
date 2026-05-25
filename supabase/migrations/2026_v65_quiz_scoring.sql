-- ============================================================
-- v65: Region-quiz scoring (per Karlo's overhaul, 25-05-2026).
--
-- The v54 quiz was a binary gate: clear the deck 100% or get
-- nothing. Karlo's new model treats the region quiz as a real
-- quiz - per-question feedback, a final percentage, a 50% pass
-- bar, and unlimited retakes with the best score kept.
--
-- Schema additions:
--   best_score_pct  - 0..100 or null. Best % ever scored on this
--                     region's quiz. Drives the "Best: X%" badge
--                     on the region card.
--   last_score_pct  - 0..100 or null. Most recent attempt's %.
--                     Drives the "Try again - last: X%" copy.
--   last_attempt_at - timestamp of most recent attempt. Same row
--                     also bumps updated_at; this column exists so
--                     we can sort/display "your last attempt was
--                     X days ago" without parsing updated_at
--                     (which moves for unrelated reasons).
--
-- quiz_passed_at semantics shift:
--   old: stamped when the deck was cleared 100%
--   new: stamped on the first attempt scoring >= 50%
--
-- No backfill needed - any existing pass row was a 100% deck-clear
-- under v54 rules, which is still >= 50% under v65 rules.
--
-- Other 3 region-quiz formats (stack_builder, tier_ranking,
-- vault_tumblers) inherit the new contract automatically when
-- content lands; this migration is format-agnostic.
--
-- Idempotent.
-- ============================================================

alter table student_region_quiz
  add column if not exists best_score_pct  int,
  add column if not exists last_score_pct  int,
  add column if not exists last_attempt_at timestamptz;

-- Sanity rails on the score columns. 0..100 inclusive, or null.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'student_region_quiz_best_score_pct_range'
  ) then
    alter table student_region_quiz
      add constraint student_region_quiz_best_score_pct_range
      check (best_score_pct is null or (best_score_pct between 0 and 100));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'student_region_quiz_last_score_pct_range'
  ) then
    alter table student_region_quiz
      add constraint student_region_quiz_last_score_pct_range
      check (last_score_pct is null or (last_score_pct between 0 and 100));
  end if;
end $$;

comment on column student_region_quiz.best_score_pct is
  'Best percentage ever scored on this region''s quiz (0-100). Null until first attempt. v65.';
comment on column student_region_quiz.last_score_pct is
  'Most recent attempt''s percentage (0-100). Null until first attempt. v65.';
comment on column student_region_quiz.last_attempt_at is
  'Timestamp of the most recent attempt. Separate from updated_at so it isn''t bumped by unrelated row updates. v65.';

-- Sanity check (commented):
-- select region_id, quiz_passed_at, best_score_pct, last_score_pct, quiz_attempts
-- from student_region_quiz order by region_id;
