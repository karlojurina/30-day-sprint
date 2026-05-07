-- ============================================================
-- v16: Rename Region 4
--   Old: "Scale"
--   New: "Gate of Possibilities"
--
-- Subtitle + tagline kept aligned to the new framing.
-- ============================================================

update regions
set
  name = 'Gate of Possibilities',
  subtitle = 'Bounties + Scale',
  tagline = 'Real briefs. Real money. The doors that open from here.'
where id = 'r4';
