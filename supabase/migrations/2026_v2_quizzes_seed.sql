-- ============================================================
-- V2: Seed quizzes + placeholder questions
-- Run AFTER 2026_v2_quizzes.sql
-- ============================================================

-- 5 quizzes, one per major checkpoint
insert into quizzes (id, checkpoint_id, title, passing_percent, sort_order) values
  ('quiz_foundations',  'foundations',  'Foundations Quiz',       70, 1),
  ('quiz_first_ads',    'first_ads',   'First Ads Quiz',        70, 2),
  ('quiz_skill_stack',  'skill_stack', 'Skill Stack Quiz',      70, 3),
  ('quiz_strategy',     'strategy',    'Creative Strategy Quiz', 70, 4),
  ('quiz_ad_bounties',  'ad_bounties', 'Ad Bounties Quiz',      70, 5);

-- ============================================================
-- Foundations Quiz (5 questions)
-- ============================================================
insert into quiz_questions (quiz_id, sort_order, question, options, correct_index, explanation) values
(
  'quiz_foundations', 1,
  'What is the main goal of a direct response ad?',
  '["Build brand awareness over time", "Get the viewer to take an immediate action", "Entertain the audience", "Go viral on social media"]',
  1,
  'Direct response ads are designed to drive an immediate, measurable action — a click, a purchase, a signup. Brand awareness is a different strategy.'
),
(
  'quiz_foundations', 2,
  'In the "two-product" concept, what are the two products?',
  '["The ad and the landing page", "The hook and the offer", "The creative and the product being sold", "The video and the thumbnail"]',
  2,
  'The two products are the hook (which sells the click) and the offer (which sells the purchase). You need to nail both.'
),
(
  'quiz_foundations', 3,
  'What percentage of an ad''s success is typically determined by the hook?',
  '["About 20%", "About 50%", "About 80%", "About 95%"]',
  2,
  'The hook is roughly 50% of whether your ad works. If people don''t stop scrolling, nothing else matters — but the body and offer still need to convert.'
),
(
  'quiz_foundations', 4,
  'What is the biggest mistake beginners make with their first ads?',
  '["Using too many colors", "Spending too much on production", "Trying to sell in the first 3 seconds instead of hooking attention", "Making ads that are too short"]',
  2,
  'Beginners often lead with the product pitch. The first 3 seconds should stop the scroll — sell the click, not the product.'
),
(
  'quiz_foundations', 5,
  'Why is understanding buying psychology important for ad creation?',
  '["It helps you manipulate people", "It lets you predict what platforms will promote", "It helps you craft messages that align with how people naturally make decisions", "It''s not — creative quality matters more"]',
  2,
  'Understanding buying psychology lets you work with human decision-making patterns, not against them. It''s about alignment, not manipulation.'
);

-- ============================================================
-- First Ads Quiz (5 questions)
-- ============================================================
insert into quiz_questions (quiz_id, sort_order, question, options, correct_index, explanation) values
(
  'quiz_first_ads', 1,
  'What is the key difference between organic-style ads and traditional ads?',
  '["Organic ads are always free to run", "Organic ads feel native to the platform, like real user content", "Organic ads never include a call to action", "There is no real difference"]',
  1,
  'Organic-style ads are designed to blend in with regular content on the platform. They feel like something a friend would post, not a polished commercial.'
),
(
  'quiz_first_ads', 2,
  'When creating a UGC-style ad, what matters most?',
  '["4K camera quality", "Authentic delivery and relatable presentation", "Professional studio lighting", "Celebrity endorsement"]',
  1,
  'UGC works because it feels real. Authentic delivery beats production quality every time in UGC format.'
),
(
  'quiz_first_ads', 3,
  'A brand selling premium sunglasses to people who already know they want sunglasses — which approach works best?',
  '["Long educational content about UV protection", "A direct offer with strong social proof", "A funny meme about sunglasses", "An influencer unboxing video"]',
  1,
  'When the audience already has purchase intent, you don''t need to educate — you need to convince them YOUR product is the one. Direct offer + social proof.'
),
(
  'quiz_first_ads', 4,
  'What should you do BEFORE creating your first ad for a brand?',
  '["Immediately start filming", "Study what competitors are running and what''s working", "Buy the most expensive camera you can", "Post on Reddit asking for tips"]',
  1,
  'Always research first. Look at competitors'' ads, check ad libraries, understand what hooks and angles are working in that niche.'
),
(
  'quiz_first_ads', 5,
  'How many ad variations should you ideally test in a first campaign?',
  '["Just 1 perfect ad", "2-3 variations with different hooks", "10+ completely different concepts", "As many as possible, quantity over quality"]',
  1,
  'Testing 2-3 variations with different hooks lets you learn what resonates without spreading too thin. Each variation should test one variable.'
);

-- ============================================================
-- Skill Stack Quiz (5 questions)
-- ============================================================
insert into quiz_questions (quiz_id, sort_order, question, options, correct_index, explanation) values
(
  'quiz_skill_stack', 1,
  'What distinguishes a high-production ad from a UGC ad?',
  '["High-production ads are always longer", "High-production ads use professional editing, motion graphics, and polished visuals", "High-production ads always perform better", "There is no real difference in 2024"]',
  1,
  'High-production ads feature professional editing, transitions, motion graphics, and polished visuals. But UGC can outperform them — it depends on the audience.'
),
(
  'quiz_skill_stack', 2,
  'What is a VSL (Video Sales Letter)?',
  '["A video version of your resume", "A long-form video designed to educate and sell through storytelling", "A 15-second TikTok ad", "A video posted to your email list"]',
  1,
  'A VSL is a structured video that takes the viewer through a problem-agitation-solution framework, building enough trust and desire to drive a purchase.'
),
(
  'quiz_skill_stack', 3,
  'When should you use a static ad instead of a video ad?',
  '["Never — video always wins", "When the offer is simple and the value proposition can be communicated in one visual", "Only for retargeting", "Only for luxury brands"]',
  1,
  'Static ads work great when the message is simple and can be absorbed at a glance — clear value prop, strong visual, minimal text.'
),
(
  'quiz_skill_stack', 4,
  'What is the purpose of engaging with feedback in the #ad-review channel?',
  '["To argue with critics", "To get free compliments", "To learn from peer feedback and iterate faster", "It''s optional and doesn''t matter"]',
  2,
  'The feedback loop is one of the fastest ways to improve. Other creators and the team catch things you can''t see in your own work.'
),
(
  'quiz_skill_stack', 5,
  'What editing technique has the biggest impact on ad performance?',
  '["Adding as many transitions as possible", "Matching the pacing and energy to the hook''s promise", "Using the most expensive software", "Making every ad exactly 30 seconds"]',
  1,
  'Pacing is everything. The edit should match the energy the hook promised — if you hook with urgency, the edit needs to deliver on that energy.'
);

-- ============================================================
-- Creative Strategy Quiz (5 questions)
-- ============================================================
insert into quiz_questions (quiz_id, sort_order, question, options, correct_index, explanation) values
(
  'quiz_strategy', 1,
  'What is a creative strategy in the context of paid ads?',
  '["A fancy name for brainstorming", "A systematic approach to generating, testing, and iterating ad concepts based on data", "Just making ads that look good", "Following whatever trending format exists"]',
  1,
  'Creative strategy is a system — it''s how you decide WHAT to make, WHY, and how to learn from results. It''s data-driven, not random.'
),
(
  'quiz_strategy', 2,
  'What is the "inspiration system" for finding winning ad angles?',
  '["Copying competitors exactly", "Systematically studying winning ads, extracting patterns, and adapting them to your brand", "Waiting for creative inspiration to strike", "Using AI to generate all your ideas"]',
  1,
  'The inspiration system is about studying what works, understanding WHY it works, and applying those principles — not copying, but adapting patterns.'
),
(
  'quiz_strategy', 3,
  'When an ad is performing well, what should you do?',
  '["Leave it alone forever", "Create variations that test different elements of what''s working", "Immediately increase the budget 10x", "Move on to something completely different"]',
  1,
  'A winning ad tells you something is working. Create variations that iterate on different elements — new hooks, new angles, same core message.'
),
(
  'quiz_strategy', 4,
  'What is the most important data point when evaluating ad performance?',
  '["Number of likes", "Hook rate (thumb-stop ratio)", "Number of comments", "How much you personally like the ad"]',
  1,
  'Hook rate tells you if people are stopping to watch. Without that, nothing else matters — you can''t convert someone who never saw your message.'
),
(
  'quiz_strategy', 5,
  'How does creative strategy connect to making money as a freelancer?',
  '["It doesn''t — clients just want cheap ads", "Brands pay premium rates for creators who can think strategically, not just execute", "Strategy is only for agencies", "You need a degree in marketing first"]',
  1,
  'Strategy is what separates a $500/month freelancer from a $5,000/month one. Brands pay for people who understand WHY ads work, not just HOW to edit them.'
);

-- ============================================================
-- Ad Bounties Quiz (5 questions)
-- ============================================================
insert into quiz_questions (quiz_id, sort_order, question, options, correct_index, explanation) values
(
  'quiz_ad_bounties', 1,
  'What is an Ad Bounty?',
  '["A contest where the best ad wins a prize", "A paid opportunity to create ads for real brands with real budgets", "A free tutorial assignment", "A social media challenge"]',
  1,
  'Ad Bounties are real, paid gigs. Brands post briefs, you create the ad, and if it performs well (or gets selected), you get paid.'
),
(
  'quiz_ad_bounties', 2,
  'What makes a strong bounty submission?',
  '["Being the first to submit", "Following the brief closely while showing creative skill and strategic thinking", "Making the longest video possible", "Using the most expensive equipment"]',
  1,
  'Strong submissions follow the brief (brands are specific for a reason) while demonstrating that you understand the strategy behind the creative.'
),
(
  'quiz_ad_bounties', 3,
  'How should you use bounty results in your portfolio?',
  '["Only show bounties you won", "Show the ad, the brief, and the performance data to demonstrate your value", "Don''t include bounties — they''re not real work", "Just list the brand names"]',
  1,
  'Performance data is your proof. Showing the brief, your creative, and the results tells a complete story that clients care about.'
),
(
  'quiz_ad_bounties', 4,
  'How many bounties should you submit per week to build momentum?',
  '["1 if you feel like it", "At least 2-3 consistently", "10+ to guarantee a win", "It doesn''t matter — quality over quantity"]',
  1,
  'Consistency is key. 2-3 per week builds skill, portfolio, and increases your odds of wins. Quality matters, but you also need volume.'
),
(
  'quiz_ad_bounties', 5,
  'What should you do after attending a weekly call?',
  '["Nothing — the value is just being there", "Apply what you learned to your next bounty submission or job application", "Wait until next week''s call for more info", "Post about it on social media"]',
  1,
  'The weekly calls are actionable. Take one thing you learned and apply it to your very next piece of work. Action beats passive learning every time.'
);
