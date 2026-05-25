-- ============================================================
-- v60: Replace l057's description (Complete Ad Bounty Onboarding).
--
-- The old copy was:
--   "Read the bounty brief process. Understand how submissions
--    are judged."
-- Karlo flagged it as confusing + felt duplicate. l057 isn't a
-- lesson to watch - it's the gate where the student APPLIES for
-- Bounty Access via the Tally form (Apply for Bounty Access ->).
-- Approval comes from Zak's webhook, which unlocks the Playbook
-- programmatically.
--
-- New copy frames the actual deliverable: applying, and what's
-- on the other side of approval.
--
-- Idempotent.
-- ============================================================

update lessons
set description =
  'Apply for the Ad Bounty Program. Once you''re approved, you can ship real ads for real brands and the Playbook unlocks - your home for months 2 and beyond.'
where id = 'l057';
