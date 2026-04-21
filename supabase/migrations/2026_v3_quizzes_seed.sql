-- ============================================================
-- V3: Seed quizzes + placeholder questions (region-based)
-- Run AFTER 2026_v3_expedition_restructure.sql and 2026_v3_expedition_seed.sql
-- Supersedes 2026_v2_quizzes_seed.sql (which used the old checkpoint_id column)
-- ============================================================

-- 4 quizzes, one per region. The final "boss reflection" at l33 handles
-- the wrap-up for Region 4, so no separate quiz there.
insert into quizzes (id, region_id, title, passing_percent, sort_order) values
  ('quiz_r1', 'r1', 'Base Camp Quiz',      70, 1),
  ('quiz_r2', 'r2', 'Creative Lab Quiz',   70, 2),
  ('quiz_r3', 'r3', 'Test Track Quiz',     70, 3),
  ('quiz_r4', 'r4', 'The Market Quiz',     70, 4);

-- ============================================================
-- Region 1 — Base Camp Quiz (5 questions)
-- ============================================================
insert into quiz_questions (quiz_id, sort_order, question, options, correct_index, explanation) values
(
  'quiz_r1', 1,
  'What is the main goal of a direct response ad?',
  '["Build brand awareness over time", "Get the viewer to take an immediate action", "Entertain the audience", "Go viral on social media"]',
  1,
  'Direct response ads are designed to drive an immediate, measurable action — a click, a purchase, a signup. Brand awareness is a different strategy.'
),
(
  'quiz_r1', 2,
  'In the "two-product" concept, what are the two products?',
  '["The ad and the landing page", "The hook and the offer", "The creative and the product being sold", "The video and the thumbnail"]',
  1,
  'The two products are the hook (which sells the click) and the offer (which sells the purchase). You need to nail both.'
),
(
  'quiz_r1', 3,
  'What percentage of an ad''s success is typically determined by the hook?',
  '["About 20%", "About 50%", "About 80%", "About 95%"]',
  1,
  'The hook is roughly 50% of whether your ad works. If people don''t stop scrolling, nothing else matters — but the body and offer still need to convert.'
),
(
  'quiz_r1', 4,
  'What is the biggest mistake beginners make with their first ads?',
  '["Using too many colors", "Spending too much on production", "Trying to sell in the first 3 seconds instead of hooking attention", "Making ads that are too short"]',
  2,
  'Beginners often lead with the product pitch. The first 3 seconds should stop the scroll — sell the click, not the product.'
),
(
  'quiz_r1', 5,
  'Why is understanding buying psychology important for ad creation?',
  '["It helps you manipulate people", "It lets you predict what platforms will promote", "It helps you craft messages that align with how people naturally make decisions", "It''s not — creative quality matters more"]',
  2,
  'Understanding buying psychology lets you work with human decision-making patterns, not against them. It''s about alignment, not manipulation.'
);

-- ============================================================
-- Region 2 — Creative Lab Quiz (5 questions)
-- ============================================================
insert into quiz_questions (quiz_id, sort_order, question, options, correct_index, explanation) values
(
  'quiz_r2', 1,
  'What is the key difference between organic-style ads and traditional ads?',
  '["Organic ads are always free to run", "Organic ads feel native to the platform, like real user content", "Organic ads never include a call to action", "There is no real difference"]',
  1,
  'Organic-style ads are designed to blend in with regular content on the platform. They feel like something a friend would post, not a polished commercial.'
),
(
  'quiz_r2', 2,
  'When creating a UGC-style ad, what matters most?',
  '["4K camera quality", "Authentic delivery and relatable presentation", "Professional studio lighting", "Celebrity endorsement"]',
  1,
  'UGC works because it feels real. Authentic delivery beats production quality every time in UGC format.'
),
(
  'quiz_r2', 3,
  'A brand selling premium sunglasses to people who already know they want sunglasses — which approach works best?',
  '["Long educational content about UV protection", "A direct offer with strong social proof", "A funny meme about sunglasses", "An influencer unboxing video"]',
  1,
  'When the audience already has purchase intent, you don''t need to educate — you need to convince them YOUR product is the one. Direct offer + social proof.'
),
(
  'quiz_r2', 4,
  'What should you do BEFORE creating your first ad for a brand?',
  '["Immediately start filming", "Study what competitors are running and what''s working", "Buy the most expensive camera you can", "Post on Reddit asking for tips"]',
  1,
  'Always research first. Look at competitors'' ads, check ad libraries, understand what hooks and angles are working in that niche.'
),
(
  'quiz_r2', 5,
  'How many ad variations should you ideally test in a first campaign?',
  '["Just 1 perfect ad", "2-3 variations with different hooks", "10+ completely different concepts", "As many as possible, quantity over quality"]',
  1,
  'Testing 2-3 variations with different hooks lets you learn what resonates without spreading too thin. Each variation should test one variable.'
);

-- ============================================================
-- Region 3 — Test Track Quiz (5 questions)
-- ============================================================
insert into quiz_questions (quiz_id, sort_order, question, options, correct_index, explanation) values
(
  'quiz_r3', 1,
  'What distinguishes a high-production ad from a UGC ad?',
  '["High-production ads are always longer", "High-production ads use professional editing, motion graphics, and polished visuals", "High-production ads always perform better", "There is no real difference in 2024"]',
  1,
  'High-production ads feature professional editing, transitions, motion graphics, and polished visuals. But UGC can outperform them — it depends on the audience.'
),
(
  'quiz_r3', 2,
  'What is a VSL (Video Sales Letter)?',
  '["A video version of your resume", "A long-form video designed to educate and sell through storytelling", "A 15-second TikTok ad", "A video posted to your email list"]',
  1,
  'A VSL is a structured video that takes the viewer through a problem-agitation-solution framework, building enough trust and desire to drive a purchase.'
),
(
  'quiz_r3', 3,
  'When should you use a static ad instead of a video ad?',
  '["Never — video always wins", "When the offer is simple and the value proposition can be communicated in one visual", "Only for retargeting", "Only for luxury brands"]',
  1,
  'Static ads work great when the message is simple and can be absorbed at a glance — clear value prop, strong visual, minimal text.'
),
(
  'quiz_r3', 4,
  'What is the purpose of engaging with feedback in the #ad-review channel?',
  '["To argue with critics", "To get free compliments", "To learn from peer feedback and iterate faster", "It''s optional and doesn''t matter"]',
  2,
  'The feedback loop is one of the fastest ways to improve. Other creators and the team catch things you can''t see in your own work.'
),
(
  'quiz_r3', 5,
  'What editing technique has the biggest impact on ad performance?',
  '["Adding as many transitions as possible", "Matching the pacing and energy to the hook''s promise", "Using the most expensive software", "Making every ad exactly 30 seconds"]',
  1,
  'Pacing is everything. The edit should match the energy the hook promised — if you hook with urgency, the edit needs to deliver on that energy.'
);

-- ============================================================
-- Region 4 — The Market Quiz (5 questions)
-- ============================================================
insert into quiz_questions (quiz_id, sort_order, question, options, correct_index, explanation) values
(
  'quiz_r4', 1,
  'What is an Ad Bounty?',
  '["A contest where the best ad wins a prize", "A paid opportunity to create ads for real brands with real budgets", "A free tutorial assignment", "A social media challenge"]',
  1,
  'Ad Bounties are real, paid gigs. Brands post briefs, you create the ad, and if it performs well (or gets selected), you get paid.'
),
(
  'quiz_r4', 2,
  'What makes a strong bounty submission?',
  '["Being the first to submit", "Following the brief closely while showing creative skill and strategic thinking", "Making the longest video possible", "Using the most expensive equipment"]',
  1,
  'Strong submissions follow the brief (brands are specific for a reason) while demonstrating that you understand the strategy behind the creative.'
),
(
  'quiz_r4', 3,
  'How should you use bounty results in your portfolio?',
  '["Only show bounties you won", "Show the ad, the brief, and the performance data to demonstrate your value", "Don''t include bounties — they''re not real work", "Just list the brand names"]',
  1,
  'Performance data is your proof. Showing the brief, your creative, and the results tells a complete story that clients care about.'
),
(
  'quiz_r4', 4,
  'How many bounties should you submit per week to build momentum?',
  '["1 if you feel like it", "At least 2-3 consistently", "10+ to guarantee a win", "It doesn''t matter — quality over quantity"]',
  1,
  'Consistency is key. 2-3 per week builds skill, portfolio, and increases your odds of wins. Quality matters, but you also need volume.'
),
(
  'quiz_r4', 5,
  'What should you do after attending a weekly call?',
  '["Nothing — the value is just being there", "Apply what you learned to your next bounty submission or job application", "Wait until next week''s call for more info", "Post about it on social media"]',
  1,
  'The weekly calls are actionable. Take one thing you learned and apply it to your very next piece of work. Action beats passive learning every time.'
);
