-- ============================================================
-- v61: Rewrite lesson descriptions across R1-R4.
--
-- Old descriptions were short summaries written before the
-- transcripts existed. v61 replaces each with a tighter, more
-- specific 1-line description that captures what the student
-- WALKS AWAY WITH from each lesson.
--
-- R1 descriptions are informed by the ecomtalent Transcripts.pdf
-- where transcript sections exist (lines 1-3000 of the PDF
-- cover R1 with clean "Video Title:" markers). R2/R3/R4 are
-- written from lesson titles + topic knowledge; Karlo can
-- refine any specific one with a one-line update against
-- scenario_id.
--
-- Action items keep operational copy (what the student DOES,
-- not what the video teaches).
--
-- Idempotent.
-- ============================================================

-- ─── R1 — Foundation ───
update lessons set description =
  'Join the EcomTalent Discord, verify via Whop, and say hi in #general. (Optional: introduce yourself in the chat - share your niche, your goal, or just a wave.)'
where id = 'l001';

update lessons set description =
  'Karlo''s two goals for you: make your money back fast, and become the most valuable version of yourself.'
where id = 'l002';

update lessons set description =
  'How to learn 10x faster than everyone else. The mindset shift that puts you in the top 5%.'
where id = 'l003';

update lessons set description =
  'Real student wins. What''s realistic to expect at 30 days, 90 days, a year - so you can break your own limiting beliefs.'
where id = 'l004';

update lessons set description =
  'The full 30-day roadmap. What to do, what to skip, how to stop drowning in content.'
where id = 'l005';

update lessons set description =
  'A walk through every pillar of the program so you see how the pieces fit before you start.'
where id = 'l007';

update lessons set description =
  'The fundamentals: ROAS, CPM, why Meta lowers cost for engaging ads, what "a good ad" actually means.'
where id = 'l008';

update lessons set description =
  'What direct response advertising actually is and why it''s the only style that prints money on social.'
where id = 'l009';

update lessons set description =
  'Flip the 80/20: most editors spend 80% editing, 20% on the customer. Do it the other way and the ad writes itself.'
where id = 'l010';

update lessons set description =
  'You don''t create desire - you channel what''s already there. The forces that actually move people to buy.'
where id = 'l011';

update lessons set description =
  'Karlo''s step-by-step process for going from blank page to shipped ad. Every time.'
where id = 'l013';

update lessons set description =
  'How to use Atria + winning ads as fuel without copying. Inspiration beats replication.'
where id = 'l014';

update lessons set description =
  'Intro to the Video Ads pillar. What''s coming: organic, UGC, VSLs, high-prod - and when each one wins.'
where id = 'l015';

update lessons set description =
  'Organic ads - the iPhone-shot, pattern-interrupt style that out-prints high-prod on social. When to use them.'
where id = 'l016';

update lessons set description =
  'Where Reels + Stories UI eats your text. The safe zones for 9:16 so the important pixels stay visible.'
where id = 'l017';

update lessons set description =
  'Action item: ship your first Organic ad. Submit it in #organic-ads-feedback for coach review.'
where id = 'l018';

update lessons set description =
  'User-generated content ads. When to use them, who should record them, why trust beats production.'
where id = 'l019';

update lessons set description =
  'Action item: ship your first UGC ad. Submit it in #ugc-ads-feedback for coach review.'
where id = 'l020';

-- ─── R2 — Strategy / Editing ───
update lessons set description =
  'Video sales letters - longer-form video ads. When to use them, the structure that holds attention.'
where id = 'l021';

update lessons set description =
  'Action item: ship your first VSL ad. Submit it in #vsl-feedback for coach review.'
where id = 'l022';

update lessons set description =
  'High-production ads. When polish actually wins (rare) and when iPhone beats it (most of the time).'
where id = 'l023';

update lessons set description =
  'Action item: ship your first high-production ad. Submit it in #high-prod-feedback for coach review.'
where id = 'l024';

update lessons set description =
  'The first 3 seconds make or break the ad. The hook patterns working right now.'
where id = 'l025';

update lessons set description =
  'How Mr. Beast keeps people watching. The retention moves you can steal for ads.'
where id = 'l026';

update lessons set description =
  'How Karlo organizes assets so every project starts fast and nothing gets lost.'
where id = 'l027';

update lessons set description =
  'Where to source the music and SFX that lift an ad from good to great.'
where id = 'l028';

update lessons set description =
  'Karlo''s full editing stack - software, plugins, hardware. Steal it directly.'
where id = 'l029';

update lessons set description =
  'Upscale low-res clips with AI so footage doesn''t limit which ads you can make.'
where id = 'l030';

update lessons set description =
  'AI voiceover tools that sound real enough to ship. The settings + workflow.'
where id = 'l031';

update lessons set description =
  'Intro to the next 5 lessons: full editing breakdowns of real winning ads.'
where id = 'l032';

update lessons set description =
  'Karlo edits a real ad start-to-finish on screen. Full process, unfiltered.'
where id = 'l033';

update lessons set description =
  'Editing breakdown of a winning ad. Part 1: setup + opening hook.'
where id = 'l035';

update lessons set description =
  'Editing breakdown continued. The middle act of the same winning ad.'
where id = 'l036';

update lessons set description =
  'Editing breakdown final piece. The close, the CTA, the polish that ships.'
where id = 'l037';

update lessons set description =
  'A second winning ad broken down end-to-end. Different format, same principles.'
where id = 'l038';

update lessons set description =
  'Third breakdown. The patterns that show up across every winning ad.'
where id = 'l039';

update lessons set description =
  'Fourth breakdown. Higher-production ad teardown.'
where id = 'l041';

update lessons set description =
  'Final breakdown. A VSL ad cut all the way through.'
where id = 'l042';

-- ─── R3 — Production / Static / Strategy ───
update lessons set description =
  'Static ads. Why 1 frame is harder than 30 seconds and how to make it stop the scroll.'
where id = 'l045';

update lessons set description =
  'Where text + product can sit on a static ad without UI cropping eating it.'
where id = 'l046';

update lessons set description =
  'Karlo''s static ad stack - Figma, Photoshop, AI tools. The setup that lets you ship fast.'
where id = 'l047';

update lessons set description =
  'Karlo''s go-to static templates + a live build from blank canvas to ship-ready.'
where id = 'l048';

update lessons set description =
  'Action item: ship your first static ad. Submit it in #static-feedback for coach review.'
where id = 'l049';

update lessons set description =
  'The Karlo Method - the repeatable framework for going from product to portfolio-ready ads.'
where id = 'l050';

update lessons set description =
  'The private marketplace that pays for ad work. How to get in and what to expect.'
where id = 'l052';

update lessons set description =
  'The Ad Bounty program in detail. How brands post bounties, how you cash in.'
where id = 'l053';

update lessons set description =
  'The workflow strategists use to research, ideate, and ship ads at scale.'
where id = 'l054';

update lessons set description =
  'The 5 levels of awareness. How to write to a customer who doesn''t even know your product yet.'
where id = 'l055';

update lessons set description =
  'The 5 levels of sophistication. Why the same hook stops working and what replaces it.'
where id = 'l056';

update lessons set description =
  'How to use Claude/ChatGPT for serious market research - not surface-level fluff.'
where id = 'l064';

-- ─── R4 — Gate of Possibilities (AI + Bounties) ───
-- l057 already updated by v60.

update lessons set description =
  'How to give Claude live web access so it can fetch real ads, reviews, and research.'
where id = 'l065';

update lessons set description =
  'Build a Brand AI agent that knows your product and customer better than you do.'
where id = 'l066';

update lessons set description =
  'Set up the Growth Guide system that drives every ad decision from here on.'
where id = 'l067';

update lessons set description =
  'Step 1 of ideation: imitate winning ads structurally, not visually.'
where id = 'l068';

update lessons set description =
  'Step 2: turn what you''ve seen into your own original ad concepts.'
where id = 'l069';

update lessons set description =
  'Step 3: test, refine, iterate until the ad converts.'
where id = 'l070';

update lessons set description =
  'Use AI to write static-ad copy that doesn''t sound like AI.'
where id = 'l071';

update lessons set description =
  'Use AI to draft video-ad scripts. Prompts + the editing pass that makes them ship-ready.'
where id = 'l072';

update lessons set description =
  'How to actually talk to AI so it gives you useful output, not generic fluff.'
where id = 'l073';

update lessons set description =
  'How to read your own ad data and extract real learnings - not vibes.'
where id = 'l074';

update lessons set description =
  'Teardown of recent winning ads. What made them win, what you can steal.'
where id = 'l075';

update lessons set description =
  'Karlo''s real edit cycle on a flop. The exact changes that flipped the result.'
where id = 'l076';

update lessons set description =
  'The cognitive biases driving every buying decision. How ads exploit them ethically.'
where id = 'l077';

update lessons set description =
  'Karlo''s research workflow. Where ideas come from when "I have no ideas" hits.'
where id = 'l078';

-- l057 - already updated in v60 to bounty-onboarding copy. Leave it.

update lessons set description =
  'Pick a bounty brief. Build it. Submit it. Your first real client work.'
where id = 'l058';

update lessons set description =
  'Ship your second bounty. Reps build the muscle.'
where id = 'l059';

update lessons set description =
  'Ship your third. By now you''re feeling the rhythm - and starting to earn.'
where id = 'l060';

update lessons set description =
  'Pull up your live ad performance numbers. Read them. Apply what you see.'
where id = 'l061';

update lessons set description =
  'Join the weekly community call. Get feedback, get unstuck, see what''s working.'
where id = 'l062';

update lessons set description =
  'Day 30. Write the reflection that locks in everything you built this month.'
where id = 'l063';
