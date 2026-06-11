-- ============================================================
-- v83: students.cancel_scheduled_at — Whop "Canceling" state.
--
-- Karlo's screenshot showed 4 cohort students with Whop's
-- "Canceling" status (status=active, cancel_at_period_end=true)
-- that didn't appear in our churn count. They've clicked cancel
-- but still have access through the end of their billing cycle.
--
-- Why we need a NEW column instead of stamping canceled_at:
--   * canceled_at = "access ended" (used by snapshot cron's
--     churned_count, M2 helper's day-30 boundary check, dashboard's
--     canceledThisMonth, journey kanban's churned classification)
--   * cancel_scheduled_at = "intent to cancel; access still active"
--   * These are DIFFERENT semantics — stamping canceled_at on a
--     Canceling student would break every consumer that filters
--     out non-active members (CSM crons would stop seeing them,
--     they'd vanish from the dashboard's active count, etc).
--
-- Set / cleared by src/lib/whop-sync-runner.ts based on the new
-- WhopMembershipRow.cancel_at_period_end field (v75.46 adds this
-- to the interface — TypeScript was silently dropping the JSON
-- field before).
--
-- Idempotent (IF NOT EXISTS).
-- ============================================================

alter table students
  add column if not exists cancel_scheduled_at timestamptz;

-- Indexed because the journey kanban + dashboard "Canceling
-- early-warning" tile (v75.47) will filter on this column to
-- highlight students who've requested cancellation.
create index if not exists idx_students_cancel_scheduled_at
  on students(cancel_scheduled_at)
  where cancel_scheduled_at is not null;

comment on column students.cancel_scheduled_at is
  'Set when Whop reports cancel_at_period_end=true while membership is still active/past_due. Distinct from canceled_at (access ended). Cleared on re-activation or when access actually ends (canceled_at then takes over).';
