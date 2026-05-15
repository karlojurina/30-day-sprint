-- ============================================================
-- v21: Add the "applied" state to the discount lifecycle.
--
-- Old states:  pending → approved | rejected
-- New states:  pending → approved → applied
--                     ↘ rejected
--
-- The flow:
--   1. Student applies            → pending
--   2. Astrid clicks Approve      → approved (server generates the
--                                    Whop promo code at this moment;
--                                    promo_code + whop_promo_id stored)
--   3. Astrid applies the code on the student's Whop subscription
--      manually in Whop's dashboard, then clicks "Mark applied"
--                                  → applied (applied_at + applied_by stamped)
--
-- The student never sees the code. The lifecycle gives Astrid a
-- clear backlog of "approved but not yet attached to Whop sub" work.
-- ============================================================

-- 1. Drop the old CHECK constraint and add a new one that includes 'applied'.
--    (Postgres doesn't let you ALTER a CHECK in place — drop + add.)

alter table discount_requests
  drop constraint if exists discount_requests_status_check;

alter table discount_requests
  add constraint discount_requests_status_check
  check (status in ('pending', 'approved', 'rejected', 'applied'));


-- 2. Audit columns for the applied step.

alter table discount_requests
  add column if not exists applied_at timestamptz;

alter table discount_requests
  add column if not exists applied_by uuid references team_members(id);


-- 3. Verification (run manually):
--   select column_name, data_type from information_schema.columns
--   where table_name = 'discount_requests'
--   order by ordinal_position;
--   -- expect applied_at, applied_by present
--
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--   where conrelid = 'discount_requests'::regclass and contype = 'c';
--   -- expect status IN ('pending','approved','rejected','applied')
