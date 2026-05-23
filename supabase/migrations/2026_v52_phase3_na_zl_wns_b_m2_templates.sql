-- ============================================================
-- v52: Phase 3 templates - NA + ZL + WNS + B + M2 (brief v3).
--
-- Adds 17 new templates supporting the new positioning model:
--
--   NA-A.1-4  Not Activated, Cohort A (Discord follow-up)
--   NA-B.1-4  Not Activated, Cohort B (Whop first-contact)
--   ZL.1-3    Zero Lessons escalation (Day 3 / 7 / 14)
--   WNS.1-2   Watching Not Shipping (R1 / R2 compounds)
--   B.1-3     Behind on Pace (Day 7 / 14 / 21)
--   M2.1      Month 2 entry (the deferred math + Playbook + floor)
--
-- The 18th DM from §10 of 04-template-copy.md is D1, which v51
-- already seeded.
--
-- The legacy W-series (W1.1-W4.4 + X.1) is marked is_active=false
-- but NOT deleted - they stay in the DB for historical task
-- references. The cron in src/app/api/cron/check-csm-tasks/route.ts
-- needs a follow-up code change to stop iterating them (handled in
-- the Phase 3 commit alongside this migration).
--
-- Per CLAUDE.md "living documentation rule": copy here is the
-- snapshot. /admin/templates remains the source of truth for any
-- post-ship edits (Karlo can tweak any of these directly).
--
-- Idempotent via on conflict (scenario_id) do update.
-- ============================================================

-- ----------------------------------------------------------------
-- Mark legacy W-series + X.1 inactive. Don't delete - tasks table
-- has historical FKs to template_id and the audit trail is worth
-- preserving. The Phase 3 cron change skips inactive templates.
-- ----------------------------------------------------------------
update templates
set is_active = false,
    updated_at = now()
where scenario_id in (
  'W1.1','W1.2','W1.3','W1.4',
  'W2.1','W2.2','W2.3','W2.4','W2.5','W2.6','W2.7',
  'W3.1','W3.2','W3.3',
  'W4.1','W4.2','W4.3','W4.4',
  'X.1'
);

-- ----------------------------------------------------------------
-- NA-A.1-4: Cohort A (Discord follow-up to D1)
-- ----------------------------------------------------------------
insert into templates (
  scenario_id, bucket, week, title, body, trigger_description,
  intent, tone, variables, is_active, is_admin_only, is_custom
) values
('NA-A.1', 'cancel_path', 'X', 'NA-A.1 - Day 3 (Discord follow-up)',
 E'Hey {firstName}!\n\nQuick follow-up - sent you the dashboard link a few days ago and noticed you haven''t signed in yet. Just want to make sure it landed and that you''re all good 🙌\n\n👉 {programLink}\n\nOnce you''re in, Karlo''s video kicks off everything else - it''ll save you a ton of time and confusion getting started.\n\nIf anything''s blocking you from signing in, let me know - probably something I can help with.',
 'Day 3 since Whop signup, joined_at IS NULL, Cohort A (has discord_username). Follow-up to D1.',
 'reactivate', 'warm', '["firstName","programLink"]'::jsonb, true, false, false),
('NA-A.2', 'cancel_path', 'X', 'NA-A.2 - Day 5 (Discord, firmer)',
 E'Hey {firstName} 👋\n\nChecking back - still haven''t seen you sign in to the 30-Day Sprint dashboard yet, wanted to flag what''s waiting for you in there.\n\nThe dashboard is where the actual program lives - your map, the action items, real ad submissions, and the 30% discount on month two if you finish the first two regions in time. The videos on Whop are part of it, but they''re missing the structure that gets you real results.\n\n👉 {programLink}\n\nIf anything''s getting in the way, let me know - happy to help on my side.',
 'Day 5 since Whop signup, joined_at IS NULL, Cohort A. Names what they''re missing.',
 'reactivate', 'firm', '["firstName","programLink"]'::jsonb, true, false, false),
('NA-A.3', 'cancel_path', 'X', 'NA-A.3 - Day 7 (Discord, honest stakes)',
 E'Hey {firstName} 👋\n\nA full week since you joined the program and we still haven''t seen you in the 30-Day Sprint dashboard.\n\nYou''re paying for the program, and the most useful part of it is sitting there waiting for you. The longer you wait, the heavier that first step feels - trust me on that, I''ve seen it a bunch of times.\n\n👉 {programLink}\n\nIf something specific is in the way, let me know - I''d love to help you get over that first step.',
 'Day 7 since Whop signup, joined_at IS NULL, Cohort A. Honest stakes.',
 'reactivate', 'honest', '["firstName","programLink"]'::jsonb, true, false, false),
('NA-A.4', 'cancel_path', 'X', 'NA-A.4 - Day 10 (Discord, final, sets high_churn_risk)',
 E'Hey {firstName}\n\nLast note from me for now.\n\nTen days in and we still haven''t seen you in the 30-Day Sprint dashboard. I''ve tried reaching out a few times and I get it - life happens sometimes, but the program isn''t going anywhere.\n\nThe dashboard is still here whenever you''re ready: {programLink}\n\nIf you ever want to come back and need help getting started, message me anytime. No pressure either way - take care 💛',
 'Day 10 since Whop signup, joined_at IS NULL, Cohort A. After this fires, sets high_churn_risk=true and exits NA queue.',
 'final_close', 'warm_close', '["firstName","programLink"]'::jsonb, true, false, false)
on conflict (scenario_id) do update set
  title = excluded.title, body = excluded.body, bucket = excluded.bucket, week = excluded.week,
  trigger_description = excluded.trigger_description, intent = excluded.intent, tone = excluded.tone,
  variables = excluded.variables, is_active = excluded.is_active, is_admin_only = excluded.is_admin_only,
  is_custom = excluded.is_custom, updated_at = now();

-- ----------------------------------------------------------------
-- NA-B.1-4: Cohort B (Whop first-contact, no Discord)
-- ----------------------------------------------------------------
insert into templates (
  scenario_id, bucket, week, title, body, trigger_description,
  intent, tone, variables, is_active, is_admin_only, is_custom
) values
('NA-B.1', 'cancel_path', 'X', 'NA-B.1 - Day 3 (Whop, first contact)',
 E'Hey {firstName}!\n\nWelcome to ecomtalent - so happy to have you here! I''m Astrid, your point of contact while you''re with us 🙌\n\nSending this on Whop because I haven''t seen you in our Discord yet. Just want to make sure you have everything you need to get going.\n\nHere''s how it''s supposed to work:\n\n- **Join the Discord** - this is where our team and other students hang out, and where you''ll get feedback on your work from our coaches.\n- **Sign in to the 30-Day Sprint dashboard** - the tool we built so you have one place for everything in the first 30 days (lessons, action items, progress tracking, the 30% off month two)\n\nYou''re missing both right now, and watching the videos on Whop alone misses the structure that actually gets you real results.\n\nBoth linked here - it takes a couple minutes to set up, I definitely recommend you to join the Discord community first:\n\n👉 Discord: {discordInvite}\n👉 Dashboard: {programLink}\n\nIf anything''s getting in the way, let me know - happy to help 🙌',
 'Day 3 since Whop signup, joined_at IS NULL, Cohort B (no discord_username). First contact ever, Whop DM.',
 'first_contact', 'warm', '["firstName","discordInvite","programLink"]'::jsonb, true, false, false),
('NA-B.2', 'cancel_path', 'X', 'NA-B.2 - Day 5 (Whop, firmer)',
 E'Hey {firstName} 👋\n\nChecking back - still haven''t seen you in our Discord or the 30-Day Sprint dashboard.\n\nI get it, the first step is always the hardest one. But you''re paying for a program you haven''t really opened yet, and the parts that actually move the needle (the map, the action items, the discount on month two) only live in the dashboard.\n\n👉 Discord: {discordInvite}\n👉 Dashboard: {programLink}\n\nIf anything''s blocking you, let me know - probably something I can help with on my side.',
 'Day 5 since Whop signup, joined_at IS NULL, Cohort B. Whop DM.',
 'reactivate', 'firm', '["firstName","discordInvite","programLink"]'::jsonb, true, false, false),
('NA-B.3', 'cancel_path', 'X', 'NA-B.3 - Day 7 (Whop, honest stakes)',
 E'Hey {firstName} 👋\n\nA full week since you signed up and we still haven''t seen you anywhere. Not in Discord, not in the 30-Day Sprint dashboard.\n\nYou''re paying for the program and you haven''t been inside any of it. The longer you wait, the heavier that first step feels - trust me on that, I''ve seen it a bunch of times.\n\nIf something specific is in the way, let me know - I''d love to help you get over that first step.\n\nWhenever you''re ready:\n\n👉 Discord: {discordInvite}\n👉 Dashboard: {programLink}',
 'Day 7 since Whop signup, joined_at IS NULL, Cohort B. Whop DM.',
 'reactivate', 'honest', '["firstName","discordInvite","programLink"]'::jsonb, true, false, false),
('NA-B.4', 'cancel_path', 'X', 'NA-B.4 - Day 10 (Whop, final, sets high_churn_risk)',
 E'Hey {firstName}\n\nLast note from me for now.\n\nTen days in and we still haven''t seen you anywhere - not in Discord, not in the 30-Day Sprint dashboard. I''ve tried reaching out a few times and I get it - life happens, and the program isn''t going anywhere.\n\nBoth still here whenever you''re ready:\n\n👉 Discord: {discordInvite}\n👉 Dashboard: {programLink}\n\nIf you ever want to come back, message me anytime. No pressure either way - take care 💛',
 'Day 10 since Whop signup, joined_at IS NULL, Cohort B. After this fires, sets high_churn_risk=true and exits NA queue.',
 'final_close', 'warm_close', '["firstName","discordInvite","programLink"]'::jsonb, true, false, false)
on conflict (scenario_id) do update set
  title = excluded.title, body = excluded.body, bucket = excluded.bucket, week = excluded.week,
  trigger_description = excluded.trigger_description, intent = excluded.intent, tone = excluded.tone,
  variables = excluded.variables, is_active = excluded.is_active, is_admin_only = excluded.is_admin_only,
  is_custom = excluded.is_custom, updated_at = now();

-- ----------------------------------------------------------------
-- ZL.1-3: Zero Lessons escalation (highest priority, supersedes
-- WNS + B).
-- ----------------------------------------------------------------
insert into templates (
  scenario_id, bucket, week, title, body, trigger_description,
  intent, tone, variables, is_active, is_admin_only, is_custom
) values
('ZL.1', 'at_risk', 'W1', 'ZL.1 - Day 3 (zero lessons)',
 E'Hey {firstName} 👋\n\nQuick check-in - saw you signed in to the dashboard but haven''t started any lessons yet. Totally normal for the first few days, just wanted to make sure nothing''s getting in the way.\n\nThe first 30 minutes is the hardest part. Once you sit down and actually start, the program kind of pulls you in.\n\nIf you can carve out 30 minutes today, that''s enough to get going. Don''t try to do it all - just open one lesson and start there.\n\nAnything I can help with on my side?',
 'Day 3, joined_at IS NOT NULL, total_lessons_watched=0. Highest-priority intervention.',
 'reactivate', 'warm', '["firstName"]'::jsonb, true, false, false),
('ZL.2', 'at_risk', 'W1', 'ZL.2 - Day 7 (zero lessons, full week)',
 E'Hey {firstName} 👋\n\nA full week in and you haven''t started any lessons yet.\n\nYou''re paying for the program and you haven''t been inside any of it. The longer you wait, the heavier that first step feels - trust me on that, I''ve seen it a bunch of times.\n\nThe good news: you''ve still got most of the sprint ahead of you. The first 30 minutes is the hardest part, and once you start one lesson, the rest gets easier from there.\n\nIf something specific is in the way, let me know - happy to help you over that first step.',
 'Day 7, joined_at IS NOT NULL, total_lessons_watched=0.',
 'reactivate', 'firm', '["firstName"]'::jsonb, true, false, false),
('ZL.3', 'at_risk', 'W2', 'ZL.3 - Day 14 (zero lessons, halfway)',
 E'Hey {firstName} 👋\n\nWanted to reach out one more time - halfway through the sprint and you haven''t started any lessons yet.\n\nI''m not going to lecture you. You know you signed up, you know it''s sitting there. But I''d hate for you to walk away from something you paid for without me at least asking once more.\n\nIf something''s pulling you away from this right now, totally understand - just tell me where you''re at. Otherwise, opening one lesson today is enough to start fresh. The map is here whenever you''re ready.\n\n💛',
 'Day 14, joined_at IS NOT NULL, total_lessons_watched=0.',
 'reactivate', 'warm_close', '["firstName"]'::jsonb, true, false, false)
on conflict (scenario_id) do update set
  title = excluded.title, body = excluded.body, bucket = excluded.bucket, week = excluded.week,
  trigger_description = excluded.trigger_description, intent = excluded.intent, tone = excluded.tone,
  variables = excluded.variables, is_active = excluded.is_active, is_admin_only = excluded.is_admin_only,
  is_custom = excluded.is_custom, updated_at = now();

-- ----------------------------------------------------------------
-- WNS.1-2: Watching Not Shipping
-- ----------------------------------------------------------------
insert into templates (
  scenario_id, bucket, week, title, body, trigger_description,
  intent, tone, variables, is_active, is_admin_only, is_custom
) values
('WNS.1', 'at_risk', 'W1', 'WNS.1 - Day 7 (R1 compounds not shipped - GOLF VOICE)',
 E'Hey {firstName}\n\nSaw you''ve been going through the lessons, good progress!\n\nLet me tell you a quick story. Imagine you wanted to learn how to play golf.\n\nYou don''t learn golf by watching others play or reading books about golf strategies. You learn by walking up to the ball and hitting it. You will probably suck at first. Then after some time you''ll suck a bit less. Then one day you''ll become good.\n\nMarketing is the same. You can watch every lesson in the program twice, take perfect notes, study every winning ad - and you''ll still be stuck until you make one ad yourself.\n\nThere''s a moment where this program stops being about watching and starts being about doing. You''re there. There''s 2 action items waiting at the end of region 1, and I get it - they probably feel scary right now.\n\nWatching videos feels productive. Working on the action items gives you resistance.\n\nBut the action items are where things actually click. You don''t need another lesson to make you "ready" - what you''ve already learned is enough to make some ads. Coaches will then give you feedback on your work and that''s how you truly learn.\n\nIt doesn''t have to be good, you just have to take that first step.\n\nYou''ve got this 💪',
 'Day 7, all R1 non-action lessons watched, l018 + l020 not shipped. GOLD STANDARD voice template (originally W1.2). Do not drift without strong reason.',
 'ship_action', 'gold_standard', '["firstName"]'::jsonb, true, false, false),
('WNS.2', 'at_risk', 'W2', 'WNS.2 - Day 14 (R2 compounds not shipped)',
 E'Hey {firstName}\n\nSaw you''ve been crushing through the region 2 lessons - good progress 🙌\n\nBut want to flag something. The two action items at the start of region 2 (vsl + high-production) are still sitting there, and you''ve already moved past them in the lessons.\n\nYou handled the first two action items in region 1, you can handle these too. The vsl and high-prod compounds are a bit more involved than the first ones - that''s normal, they''re meant to stretch you - but the goal isn''t to make them perfect, just to ship them and get real feedback from the coaches.\n\nWatching the rest of the lessons without shipping these is what gets students stuck. Pick one, give yourself a chunk of time today or tomorrow. Submit it. You''ve already proven you can do this.\n\nYou''ve got this 💪',
 'Day 14, all R2 non-action lessons watched, l022 + l024 not shipped.',
 'ship_action', 'firm', '["firstName"]'::jsonb, true, false, false)
on conflict (scenario_id) do update set
  title = excluded.title, body = excluded.body, bucket = excluded.bucket, week = excluded.week,
  trigger_description = excluded.trigger_description, intent = excluded.intent, tone = excluded.tone,
  variables = excluded.variables, is_active = excluded.is_active, is_admin_only = excluded.is_admin_only,
  is_custom = excluded.is_custom, updated_at = now();

-- ----------------------------------------------------------------
-- B.1-3: Behind on Pace (lowest priority, fires only if ZL/WNS
-- didn't catch the student that day).
-- ----------------------------------------------------------------
insert into templates (
  scenario_id, bucket, week, title, body, trigger_description,
  intent, tone, variables, is_active, is_admin_only, is_custom
) values
('B.1', 'at_risk', 'W1', 'B.1 - Day 7 (behind, discount still on the table)',
 E'Hey {firstName} 👋\n\nQuick check-in - noticed you''ve been moving a bit slower than most students at this point. Not a bad thing, just wanted to flag it.\n\nHere''s why I''m bringing it up early: these first 30 days are really about building one specific habit - showing up and doing the work every day. That habit is the single biggest thing that separates people who actually make this work from people who don''t. Get it locked in now and the rest of your journey compounds.\n\nThe good news - you''re still early enough to find your rhythm. A few solid days and you''re back on track. Plus the 30% off month two is still on the table if you push through region 1 and 2 in the next week.\n\nAnything getting in the way I can help with?',
 'Day 7, pace_metric=Behind (5+ lessons behind expected), no higher-priority trigger.',
 'pace_nudge', 'warm', '["firstName"]'::jsonb, true, false, false),
('B.2', 'at_risk', 'W2', 'B.2 - Day 14 (halfway, discount slipped, reframe to habit)',
 E'Hey {firstName} 👋\n\nHalfway through the sprint and you''ve been moving slower than most students. Wanted to be straight with you about where you stand.\n\nSome honest news: the 30% off month two has likely slipped at this point - claiming it required finishing the first two regions by today, and you''re not quite there. That''s okay though, the discount was always the bonus, not the point.\n\nThe point is the habit. These 30 days are about proving to yourself you can show up and do the work every day. Get that locked in and the rest of your ecom journey compounds. Skip it and no discount fixes the underlying thing.\n\nYou''ve still got half the sprint ahead of you - region 3 and 4 are where everything starts coming together. Pushing pace from here is what makes the whole thing worth it.\n\nAnything I can help with?',
 'Day 14, pace_metric=Behind, no higher-priority trigger.',
 'pace_nudge', 'honest', '["firstName"]'::jsonb, true, false, false),
('B.3', 'at_risk', 'W3', 'B.3 - Day 21 (last warm push, R4 imminent)',
 E'Hey {firstName} 👋\n\nThree weeks in and you''ve been moving slower than most. Want to flag something while there''s still time to push.\n\nThe next 9 days are where this whole program clicks. Region 4 is the part where you start doing the work for real - the actual point of the 30 days, and the part that pays off the most. Would hate for you to walk away from the sprint without ever getting there.\n\nThe bigger picture too: the habit you build (or don''t build) in these 30 days is what determines whether the next year of your ecom journey goes well or not. There''s no shortcut. The reps are now.\n\nPush for the rest of the sprint and you''re set up. Anything blocking that I can help with?',
 'Day 21, pace_metric=Behind, no higher-priority trigger.',
 'pace_nudge', 'firm', '["firstName"]'::jsonb, true, false, false)
on conflict (scenario_id) do update set
  title = excluded.title, body = excluded.body, bucket = excluded.bucket, week = excluded.week,
  trigger_description = excluded.trigger_description, intent = excluded.intent, tone = excluded.tone,
  variables = excluded.variables, is_active = excluded.is_active, is_admin_only = excluded.is_admin_only,
  is_custom = excluded.is_custom, updated_at = now();

-- ----------------------------------------------------------------
-- M2.1: Month 2 entry (the deferred Spencer math + Playbook + floor)
-- ----------------------------------------------------------------
insert into templates (
  scenario_id, bucket, week, title, body, trigger_description,
  intent, tone, variables, is_active, is_admin_only, is_custom
) values
('M2.1', 'event', 'X', 'M2.1 - Month 2 entry',
 E'Hey {firstName}! 🔥\n\nMonth 2, locked in. Real respect - most students don''t make it this far. You did the hard part: proved you can show up every day.\n\nIf you took action fast enough in month 1, you got the 30% off this month - that was the first thing we built to help you win. Now we want to help you stay in ecomtalent for free for the months to come.\n\nHere''s how that works: **the Ad Bounty Program**.\n\nBrands on the program are spending multiple millions per month on ads. Your job: ship bounties consistently across those brands. Get to a combined $3K in spend across your bounties in a month and you''ve earned around $100 - which covers your ecomtalent subscription. Get to $30K combined, you make $1,000 that month. Get to $300K, that''s $10,000. All from ads you shipped.\n\nIf you put in the effort and do bounties consistently, you can stay in this community for free forever - the bounty program covers it.\n\nEvery bounty also builds your portfolio, which means more leverage when applying to better-paying jobs through the community job board.\n\nAll of this is covered in **the Playbook** - the post-sprint hub that opens once you complete all 4 regions of the 30-Day Sprint map.\n\n**Your goal for month 2:**\n1. If you haven''t finished all 4 regions yet, do it now.\n2. Open the Playbook.\n3. Follow it.\n\nAnd one last thing worth understanding: **every month you stay in, your income floor goes up.**\n\nEvery bounty you ship adds reps. Every new format you try adds a skill. Every month of effort stacks on top of the last. And every skill you stack permanently raises your income floor - the minimum you can earn from your work. It never goes back down. Even if you take a break. Even if you switch what you''re doing. The skills are yours. You''ll never make less per hour than you can today with what you know.\n\nThat''s the real reason we built this community and this program the way we did. The 30-day sprint is the on-ramp. The Playbook is the path. Skill stacking is the engine that compounds for the rest of your career.\n\nI''m here if anything comes up. Keep cooking 👨‍🍳',
 'Day 31, Whop renewal webhook fired, membership_status=active. First touchpoint that carries chain beats 5-7 (math, compounding, floor). Math: $3K combined spend ~ $100; $30K ~ $1K; $300K ~ $10K. Commission rate ~3.33%.',
 'month2_entry', 'celebration', '["firstName"]'::jsonb, true, false, false)
on conflict (scenario_id) do update set
  title = excluded.title, body = excluded.body, bucket = excluded.bucket, week = excluded.week,
  trigger_description = excluded.trigger_description, intent = excluded.intent, tone = excluded.tone,
  variables = excluded.variables, is_active = excluded.is_active, is_admin_only = excluded.is_admin_only,
  is_custom = excluded.is_custom, updated_at = now();
