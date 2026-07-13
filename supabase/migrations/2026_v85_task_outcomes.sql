-- v85 — Phase 0 of the retention overhaul (2026-07-13): close the loop.
--
-- Manual outcome tracking on CSM tasks: after sending a DM, the CSM
-- taps "Replied" / "No reply" on the Sent tab of /admin/tasks.
--
-- Re-engagement is deliberately NOT stored here —
-- /api/admin/templates/stats computes it on the fly from
-- student_lesson_completions (watch or ship within 72h of the send),
-- which retroactively grades the entire pre-v85 task history too.
--
-- Idempotent: safe to re-run.

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS outcome text
    CHECK (outcome IN ('replied', 'no_reply')),
  ADD COLUMN IF NOT EXISTS outcome_at timestamptz,
  ADD COLUMN IF NOT EXISTS outcome_by uuid;

COMMENT ON COLUMN tasks.outcome IS
  'Manual CSM reply tracking (v85): replied | no_reply | NULL (not marked yet). Written by POST /api/admin/tasks/:id/outcome, read by /api/admin/templates/stats.';
