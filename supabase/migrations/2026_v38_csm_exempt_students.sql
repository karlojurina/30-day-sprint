-- ============================================================
-- v38: students.csm_exempt — flag for accounts that should never
-- trigger CSM tasks (Astrid DMs, Day-28 DM, etc.).
--
-- Use for:
--   • Team's own test accounts (Karlo's, Lovro's, dummies)
--   • Internal QA accounts
--
-- The check-csm-tasks cron, day28-dm cron, and any future
-- task-generator should filter `where csm_exempt = false`.
--
-- Toggle from /admin/students/[id] (UI checkbox) or via SQL:
--   update students set csm_exempt = true where name ilike 'lovro%';
--
-- Idempotent.
-- ============================================================

alter table students
  add column if not exists csm_exempt boolean not null default false;

create index if not exists idx_students_csm_exempt
  on students(csm_exempt)
  where csm_exempt = false;
