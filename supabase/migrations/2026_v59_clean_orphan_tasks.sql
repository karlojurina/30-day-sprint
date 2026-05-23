-- ============================================================
-- v59: Clean up orphan tasks left behind by v57's template delete.
--
-- v57 deleted the 18 legacy W-series + X.1 template rows. The
-- tasks.template_id FK is ON DELETE SET NULL (per v27), so every
-- task that pointed at a now-deleted template survived with
-- template_id = NULL. Astrid sees them in /admin/tasks as
-- "(no template)" rows - nothing to copy, nothing actionable.
--
-- These are pure noise. Delete them outright. The historical
-- scenario_id (e.g. "W1.2") stays on any task rows that ALREADY
-- HAD a non-null template_id pointing at the renamed template -
-- v58 synced those to the new names. So this delete only catches
-- the genuinely-orphaned ones.
--
-- Idempotent: if no orphans, the delete affects 0 rows.
-- ============================================================

delete from tasks where template_id is null;
