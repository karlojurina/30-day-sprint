-- ============================================================
-- v14: Region rename — drop the explorer/expedition vocabulary
-- in favor of business-stage labels.
--
-- Old name → new name
--   Base Camp     → Foundation
--   Creative Lab  → Strategy
--   Test Track    → Production
--   The Market    → Scale
--
-- Subtitles + taglines also updated to match the new framing.
-- "Days N–M" labels stay (still useful info). Terrain values stay
-- (they map to image assets we're not regenerating).
-- ============================================================

update regions
set
  name = 'Foundation',
  subtitle = 'Foundations',
  tagline = 'Get your bearings. Learn the fundamentals.'
where id = 'r1';

update regions
set
  name = 'Strategy',
  subtitle = 'First Ads',
  tagline = 'Build and ship your first ads.'
where id = 'r2';

update regions
set
  name = 'Production',
  subtitle = 'Strategy + Editing',
  tagline = 'Sharpen the stack. Think like a director.'
where id = 'r3';

update regions
set
  name = 'Scale',
  subtitle = 'Bounties + Scale',
  tagline = 'Real briefs. Real money. Real work.'
where id = 'r4';
