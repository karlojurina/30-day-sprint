-- ============================================================
-- EcomTalent — 23 Playbook Tasks Seed Data
-- Run after schema.sql
-- ============================================================

insert into tasks (id, week, sort_order, title, description, task_type, is_activation_point, activation_point_id, is_discount_required) values

-- Week 1: Foundation + First Ads (8 tasks)
('w1_t1', 1, 1, 'Join Discord + Confirm Access',
  'Confirm you can see: #general, #ad-review, #job-board, #wins. If anything is missing, DM your CSM immediately.',
  'setup', false, null, true),

('w1_t2', 1, 2, 'Set Up Weekly Calls',
  'Find the weekly call schedule in Discord. Mark yourself as "Interested" and add it to your calendar so you get notified every week.',
  'setup', false, null, true),

('w1_t3', 1, 3, 'Post Your Discord Intro',
  'Say hi to #general-chat. What''s your name, background, and what you want to achieve in 90 days. Do this Day 1.',
  'action', false, null, true),

('w1_t4', 1, 4, 'Watch Introduction Module (all 4 videos)',
  'Key mindset: learning = same condition, different behavior. Watching without doing is entertainment, not learning.',
  'watch', true, 'AP1', true),

('w1_t5', 1, 5, 'Complete Fundamentals Module',
  'Direct Response Advertising, Understanding Your Customer, Buying Psychology. Take notes. Start a swipe file. This is your foundation — everything else builds on it.',
  'watch', true, 'AP1', true),

('w1_t6', 1, 6, 'Watch Video Ads Introduction',
  'Overview of all video ad types. Watch before diving into individual modules.',
  'watch', true, 'AP1', true),

('w1_t7', 1, 7, 'Organic Ads Module + Action Item',
  'Watch the full module. Make the ad. Submit to #ad-review and tag the coach. Target: Day 3-4.',
  'action', true, 'AP2', true),

('w1_t8', 1, 8, 'UGC Module + Action Item',
  'Watch the full module. Make the ad. Submit to #ad-review. Back to back with Organic — don''t wait.',
  'action', true, 'AP2', true),

-- Week 2: Level Up Your Editing (5 tasks)
('w2_t1', 2, 1, 'Watch Video Hooks + MrBeast Retention',
  'No action items — but apply these principles to everything you make from here on. You''ll look at your Week 1 ads differently after this.',
  'watch', true, 'AP1', true),

('w2_t2', 2, 2, 'Watch Video Editing Breakdowns',
  'Agency editors showing their actual thought process while editing. Watch before or alongside your action items this week.',
  'watch', true, 'AP1', true),

('w2_t3', 2, 3, 'High-Production Ads Module + Action Item',
  'Watch the full module. Complete the action item. Submit to #ad-review. This is where you learn to make brands look premium.',
  'action', true, 'AP2', true),

('w2_t4', 2, 4, 'VSL Module + Action Item',
  'These are the hardest and most time consuming ads to edit, but they also have the highest earning potential. Watch the full module. Complete the action item. Submit to #ad-review.',
  'action', true, 'AP2', true),

('w2_t5', 2, 5, 'Engage With All #ad-review Feedback',
  'By now you should have multiple ads reviewed. Go back through every piece of feedback. Reply, ask questions, note what you''re changing, and make your ads better.',
  'action', false, null, true),

-- Week 3: Creative Strategy + Job Board (4 tasks)
('w3_t1', 3, 1, 'Static Ads Module + Action Item',
  'Watch the full module. Make the static ad. Submit to #ad-review. Static + video skills together make you significantly more valuable to brands. Skill stacking.',
  'action', true, 'AP2', false),

('w3_t2', 3, 2, 'Complete Creative Strategy Module',
  'Karlo''s most important section in the program. Developing concepts from scratch, analyzing what''s working, building a creative system. Do NOT come here before finishing all previous action items — you will get lost. This is the unlock for Ad Bounties.',
  'watch', true, 'AP1', false),

('w3_t3', 3, 3, 'Watch ''How to Make Money'' Section',
  'Watch the Private Marketplace Cheat Code video. Understand how the job board works before you start applying.',
  'watch', true, 'AP1', false),

('w3_t4', 3, 4, 'Start Applying to Job Board',
  'You''ve done the action items. You have a portfolio. You have knowledge. Apply to 3+ job board posts using your action item ads as samples. Apply to everything you''re remotely qualified for.',
  'action', false, null, false),

-- Week 4: Ad Bounties — The Activation Point (6 tasks)
('w4_t1', 4, 1, 'Complete Ad Bounty Onboarding',
  'Watch the Ad Bounties explainer. Get Ad Bounty System access confirmed with CSM. Browse brand briefs — pick ones that match your strongest skills.',
  'setup', true, 'AP3', false),

('w4_t2', 4, 2, 'Submit Your First Ad Bounty',
  'Make the ad based on the brief. Submit via ClickUp. The brand tests it with real spend. Your first one probably won''t be a winner — that''s fine. It starts with submitting.',
  'action', false, null, false),

('w4_t3', 4, 3, 'Submit Ad Bounty #2',
  'Pick a different brand or angle. Apply everything you learned from Creative Strategy. Volume matters here — more submissions = more chances to land a winner.',
  'action', false, null, false),

('w4_t4', 4, 4, 'Submit Ad Bounty #3',
  'By now you should be getting faster. Three bounties in one week is the target. Each one teaches you something different about real brand work.',
  'action', false, null, false),

('w4_t5', 4, 5, 'Check Ad Performance Dashboard',
  'Check daily performance and revenue. Bring questions to the weekly call or Lovro. Even if nothing performs yet — real market feedback is worth more than any module.',
  'action', false, null, false),

('w4_t6', 4, 6, 'Attend Weekly Call',
  'Bring your best ad for review + questions from your bounty experience. Your billing renews this week. If you did all action items + submitted 3 bounties — you''re exactly where you need to be.',
  'action', false, null, false);
