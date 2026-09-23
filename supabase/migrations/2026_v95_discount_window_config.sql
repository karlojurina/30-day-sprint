-- ============================================================
-- v95 — the one timed thing in the whole app
--
-- Part of PRD 1 (the engine).
--
-- THE TIME MODEL, decided by Lovro 2026-09-23: there is NO clock. Progress is
-- measured in lessons and areas, never days. No "Day 5 of 30". The single
-- exception is the discount: "complete up to this point within X days of
-- joining and you get a discount" — a progress milestone with a deadline
-- counted from first_paid_at.
--
-- This file makes the X tunable without a deploy, and makes an approval
-- auditable after the gate moves.
--
-- Both changes are additive and read by nothing yet.
-- ============================================================

begin;

-- ─────────────── 1. The window ───────────────
--
-- Reuses the existing admin_config key/value table (v27) rather than adding
-- a column or a constants entry: the CSM team already edits config there,
-- and DISCOUNT_WINDOW_DAYS in constants.ts needs a deploy to change.
--
-- Kept at 14 to match today's behaviour exactly. PRD 2 sets the real number
-- once the curriculum decides where the gate sits.

insert into public.admin_config (key, value, description)
values (
  'discount_window_days',
  '14',
  'Days from students.first_paid_at within which a student must reach the '
  'gate lesson to qualify for the discount. The ONLY deadline in the app. '
  'Read by api/student/discounts/request and .../approve. Changing it here '
  'takes effect immediately, with no deploy.'
)
on conflict (key) do nothing;   -- never clobber a value the team has tuned

-- ─────────────── 2. Which gate was in force at approval time ───────────────
--
-- The gate lesson MOVES: it is 'l049' today, a5l25 in staging, and whatever
-- PRD 2 decides after that. Without this column, a discount approved last
-- month is indistinguishable from one approved under a different rule, and
-- "why did this student get it?" has no answer.
--
-- Deliberately NO foreign key: the cutover empties `lessons`, and an audit
-- record must survive the disappearance of the thing it names. A dangling
-- id here is the correct outcome, not a broken reference.

alter table public.discount_requests
  add column if not exists gate_lesson_id text;

comment on column public.discount_requests.gate_lesson_id is
  'The lesson that was the discount gate when this request was decided. '
  'Audit only, intentionally un-foreign-keyed so it survives the catalog '
  'swap at cutover. Null for rows created before v95.';

commit;

-- ============================================================
-- POST-CHECKS
-- ============================================================
--
-- 1. select key, value from admin_config where key = 'discount_window_days';
--    EXPECT one row, value '14'
--
-- 2. select column_name, is_nullable, data_type
--      from information_schema.columns
--     where table_name = 'discount_requests' and column_name = 'gate_lesson_id';
--    EXPECT text, YES
--
-- 3. Nothing reads either yet, so no behaviour should change:
--    select count(*) from discount_requests where gate_lesson_id is not null;
--    EXPECT 0
-- ============================================================
