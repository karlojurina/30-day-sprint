-- ============================================================
-- V3: Wire Whop lesson IDs to the new v3 lessons so watch-sync
--     can auto-complete watched videos.
--
-- Mapping is best-effort — our v3 lesson TITLES are placeholders
-- (to be rewritten later to match Karlo's real Whop content),
-- but each v3 watch-type lesson points at a real Whop lesson so
-- the sync marks *something* complete when a student watches.
--
-- Karlo can re-map any of these in the Supabase UI once the
-- v3 lesson titles are finalized.
-- ============================================================

-- Region 1 (Base Camp) — foundations & intros
update lessons set whop_lesson_id = 'lesn_O4gxxr5BN3ue4'         where id = 'l2';   -- Welcome to the Sprint → "Your First 30 Days Here"
update lessons set whop_lesson_id = 'lesn_5fM86GlyyNIRVLV0ehSr78' where id = 'l4';   -- Why great ads sell → "How Do Ads Work?"
update lessons set whop_lesson_id = 'lesn_52iRhAVKqhXlPbhwVw5YC4' where id = 'l5';   -- The Hook, Problem, Solution → "Direct Response Advertising"
update lessons set whop_lesson_id = 'lesn_3W5cGvFEtXlNs3aLWESqn0' where id = 'l6';   -- Anatomy of a hook → "Video Hooks"
update lessons set whop_lesson_id = 'lesn_736H8p27WGlSaXuCNLpYhW' where id = 'l7';   -- Finding winning ad inspiration → "Ad Inspiration System"
update lessons set whop_lesson_id = 'lesn_4tWgAr5nJ7PrYnwO6ISblF' where id = 'l9';   -- Brand voice 101 → "Understanding Your Customer"

-- Region 2 (Creative Lab) — first ads
update lessons set whop_lesson_id = 'lesn_70r8gguLZGN3ktIG0UD3ai' where id = 'l11';  -- Scripting your first ad → "Video Ads Master — Introduction"
update lessons set whop_lesson_id = 'lesn_5BXQf2CF3FOs12oxrbgC2g' where id = 'l12';  -- UGC vs scripted → "UGC"
update lessons set whop_lesson_id = 'lesn_fWllPolk7xNvEvCSbDMRN'  where id = 'l14';  -- Shooting on your phone → "Organic Ads"
update lessons set whop_lesson_id = 'lesn_6hZ3RjC9qJRvcVXdnODoJS' where id = 'l16';  -- Writing a second angle → "High-Production Ads"

-- Region 3 (Test Track) — editing & strategy
update lessons set whop_lesson_id = 'lesn_9jREItCoLou8qRLcR0L2e' where id = 'l19';  -- CapCut 1 → "Editing Breakdowns — Intro"
update lessons set whop_lesson_id = 'lesn_5kPtUCuM6bDzrwVK6MMqdh' where id = 'l20';  -- CapCut 2 → "LIVE Example: Editing a Video Ad"
update lessons set whop_lesson_id = 'lesn_vxqavqdgjfY2RnR1qRZVE' where id = 'l21';  -- Sound design → "Music & SFX"
update lessons set whop_lesson_id = 'lesn_5R9qygV5GLrWm8SxXsVsMm' where id = 'l23';  -- Thinking in angles → Strategy Lesson 1
update lessons set whop_lesson_id = 'lesn_2XPI7WaFzI6YIrJW8fRXHX' where id = 'l24';  -- Reading ad performance data → Strategy Lesson 2
update lessons set whop_lesson_id = 'lesn_5HT44WU6d8paaIERpt1lEP' where id = 'l26';  -- How winning ads get measured → Strategy Lesson 3

-- Region 4 (The Market) — bounties & applying
update lessons set whop_lesson_id = 'lesn_7Gm3cibPk7yES3VTuANtAA' where id = 'l27';  -- How to apply for work → Strategy Lesson 4
update lessons set whop_lesson_id = 'lesn_36aPWrKA4T2Brrv0Ugs0lE' where id = 'l30';  -- What is a bounty? → Strategy Lesson 5
update lessons set whop_lesson_id = 'lesn_4CsHnaOijIPBBj1nWS2x3x' where id = 'l31';  -- How winning bounty entries → Strategy Lesson 6

-- Verify: should return 19 rows with whop_lesson_id set
-- select id, title, whop_lesson_id from lessons where whop_lesson_id is not null order by day;
