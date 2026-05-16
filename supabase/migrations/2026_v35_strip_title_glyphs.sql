-- ============================================================
-- v35: Strip the leading bucket glyph from template titles.
--
-- The seed in v27 prefixed every title with the bucket icon (★ ⚠ ✗
-- ⚡ 🔁 ⚙). The Templates page already renders that icon as its own
-- column, so titles end up showing "★ ★ Region 1 complete" with
-- the glyph twice.
--
-- This migration trims the leading glyph + whitespace from every
-- existing title. New templates created via the UI never include
-- the glyph in the first place.
--
-- Safe to run multiple times — re-running just no-ops on already-
-- trimmed titles.
-- ============================================================

update templates
set title = regexp_replace(title, '^[★✓⚠✗⚡⚙🔁]\s*', '', 'g')
where title ~ '^[★✓⚠✗⚡⚙🔁]';
