-- ============================================================
-- V2: Seed hidden rewards (placeholder content — Karlo replaces later)
-- Run AFTER 2026_v2_hidden_rewards.sql
-- ============================================================

insert into hidden_rewards (id, trigger_type, trigger_value, reward_type, title, description, content, sort_order) values
(
  'reward_first_five',
  'task_count',
  '{"count": 5}',
  'personal_note',
  'You''re Actually Doing This',
  'Most people who sign up never complete 5 tasks. You just did.',
  'Karlo here. The fact that you''ve done 5 tasks already puts you ahead of most people who sign up for anything online. That''s not hype — that''s data. Keep this energy.',
  1
),
(
  'reward_first_note',
  'notes_count',
  '{"count": 1}',
  'exclusive_resource',
  'The Note-Taker''s Edge',
  'You wrote your first lesson note. People who take notes retain 40% more.',
  'Here''s a swipe file of the top 10 hooks from winning ads in the last 30 days. Study the patterns — every great ad starts with a great hook.',
  2
),
(
  'reward_streak_7',
  'streak_length',
  '{"streak": 7}',
  'personal_note',
  'One Week Straight',
  '7 days in a row. That''s not luck — that''s discipline.',
  'Most people quit in the first week. You showed up every single day. That habit is worth more than any individual skill. The people who make money in this game are the ones who don''t stop.',
  3
),
(
  'reward_first_bounty',
  'specific_task',
  '{"task_id": "w4_t2"}',
  'shoutout',
  'Bounty Hunter Initiated',
  'You submitted your first Ad Bounty. Welcome to the arena.',
  'Your name is going on the list for the next weekly call shoutout. First bounty is a milestone — it means you''re not just learning, you''re doing.',
  4
),
(
  'reward_quiz_perfect',
  'quiz_perfect',
  '{}',
  'exclusive_resource',
  'Perfect Score Club',
  'You got 100% on a quiz. That''s not common.',
  'Here''s an exclusive case study breakdown of a $50k/month ad account. This is real data from a real brand — study how they structure their creative rotation.',
  5
),
(
  'reward_streak_14',
  'streak_length',
  '{"streak": 14}',
  'personal_note',
  'Two Weeks of Fire',
  '14 days straight. You''re building a real habit now.',
  'At this point you''re not just going through a course — you''re building a creative practice. The best ad creators in the world have this same habit: show up, do the work, repeat. You''re on that path.',
  6
),
(
  'reward_notes_seven',
  'notes_count',
  '{"count": 7}',
  'exclusive_resource',
  'Deep Thinker',
  'You''ve written 7 lesson notes. Your learning journal is growing.',
  'Because you''re clearly taking this seriously, here''s a template for building your creative portfolio. This is the exact format that gets you hired by brands paying $3-5k/month for ad creators.',
  7
);
