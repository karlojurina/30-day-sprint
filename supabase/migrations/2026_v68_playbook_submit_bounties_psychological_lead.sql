-- ============================================================
-- v68: pb_submit_bounties rewrite - psychological lead, math
-- as secondary, fix factual error about "filming."
--
-- Karlo's feedback on the v67 copy:
--   1. Leading with "$3K covers your subscription" makes the
--      subscription math feel like the main reason to do bounties.
--      It isn't. It's a secondary "look how easy the bar is"
--      reframe. The MAIN hook is the opportunity itself - real
--      brands, real budgets, passive income from one winning ad.
--   2. Step 2 said "before you write a single frame" implying
--      students are filming. They're not. They edit ads using
--      assets the brand provides + do the creative strategy +
--      use AI tools. Corrected to "before you open your editor."
--
-- Voice anchors pulled from the ad bounty video transcript:
--   - "you basically earn while still learning... There is nothing
--      else like this anywhere online"
--   - "you can get passive income on your work, which is crazy"
--   - Lucas: $651K generated for one brand in one month = $7.3K
--      payout; Oscar: $2K+ from one 30-minute ad (anonymized in
--      copy per v3 brief style)
--   - "brands spending $50,000 a day on ads is really not that
--      crazy thing in Ecom"
--
-- Other 3 nodes (build_portfolio, apply_job_board, land_first_
-- client) untouched - Karlo flagged only submit_bounties.
--
-- Idempotent.
-- ============================================================

update playbook_nodes
set
  subtitle = 'Real brands. Real budgets. You get paid when your ads spend.',
  doc_content = E'**This is the part nobody else does.**\n\nYou make an ad. A real brand runs it with their own money. You get paid 3.5% of every dollar that ad spends.\n\nThat''s the whole game.\n\nNo other community does this. No other course program does this. You''re early to something that doesn''t exist anywhere else in online education.\n\nAnd here''s the wildest part. **Winning ads keep paying you for months.**\n\nBrands keep running ads that work. As long as your ad stays profitable, it stays in the campaign.\n\nOne ad you spent three hours on can pay you every month. For six months. A year. Two years if it really hits.\n\nYou did the work once. The money keeps coming.\n\n**This is happening right now.**\n\nStudents in this community have generated $600K+ in revenue for a single brand in a single month from their bounties. Payout for that month: $7K+. From ads they made.\n\nAnother student made $2K+ from one ad that took 30 minutes to put together.\n\nThese aren''t promises. These are Discord screenshots from last quarter.\n\n## How it actually works\n\nYou. Your time. Your skill. That''s the entire investment. No money out. Zero risk.\n\nYou pick a brand. You read their brief. You do the creative strategy. You edit the ad using the assets they give you.\n\nYou submit through your link. AI runs a quality + brand check in about 5 minutes. If it passes, the media-buying team launches within 24-48 hours.\n\nThe brand pays for the ad spend. Always. You never spend a dollar.\n\nYou watch your dashboard live. Spend, ROAS, revenue per ad.\n\nEvery two weeks: automated payout to Wise. 3.5% of every dollar your ads spent.\n\n## Quick reframe on how easy the bar actually is\n\nBrands on the program spend tens of thousands of dollars on ads every day. Some spend $50K on a single ad in a single day.\n\nCovering your EcomTalent subscription only takes about $3K in total spend across your bounties. That''s about $100 back to you.\n\n$3K is roughly one hour of testing for these brands. The bar is on the floor.\n\nThat''s not why you should do bounties. That''s just the floor of what''s possible.\n\n## Step 1. Get on the program.\n\nFind #ad-bounty-info in Discord. Click the start link.\n\nFill out the application. You''ll need a Wise account so payouts get automated. Approval takes 24-48 hours.\n\nOnce you''re in, enroll in one brand whose product you''d actually buy. Pin the submission link they DM you. That''s where every ad for that brand goes.\n\n## Step 2. Study before you cut.\n\nRead the brand brief twice before you open your editor.\n\nWatch their last 10 ads. Skim the market research doc they send. Get inside the brand''s head.\n\nThis is where most students lose their first bounty. They skip the research, jump into editing, and produce something generic.\n\nAn hour of brand study beats a day of cutting.\n\n## Step 3. One angle. Three variations.\n\nPick one angle you believe in. Do the creative strategy. Edit the ad using the brand''s assets.\n\nThen make three variations of the same ad with three different hooks. Same body. Different opening 4-5 seconds.\n\nThree is the sweet spot. Not one. Not six. Three lets Meta find which hook lands.\n\n## Step 4. Submit and wait.\n\nAI runs technical + brand QA in about 5 minutes.\n\nIf it passes, the media-buying team launches within 24-48 hours. Sometimes longer when volume is high. That''s normal.\n\nIf your ad gets flagged for manual review, also normal. The review is strict by design to protect the brands. Someone on the team will come back with approval or specific changes.\n\n## Step 5. Track and get paid.\n\nLive dashboard per brand. Spend, ROAS, revenue per ad, updating as the campaign runs.\n\nPaid every two weeks. Automated to Wise based on your share of spend.\n\n## ⚠ The rule that decides everything: evergreen ads only.\n\nYour goal is to make ads that run for a year. Two years. Indefinitely.\n\nThat means three hard rules:\n\n1. **No sales. No "ending today." No Black Friday angles.** If you reference a window, the ad dies when the window closes.\n2. **No prices in the ad.** Brands change pricing. Your "$29.99" ad becomes inaccurate and gets shut off.\n3. **Talk to people who''ve never heard of this product.** Solve a problem they have. Don''t pitch a feature list.\n\nBreak these rules and your ad doesn''t get launched.\n\n## Five things that actually move the needle\n\n**An hour of brand study beats a day of editing.** The students who win are the ones who knew the brand better than the brand expected.\n\n**Quality over volume.** Two thoughtful bounties beat ten lazy ones.\n\n**If five ads don''t get spend, your angle is the problem.** Not your craft. Stop iterating on edits. Start iterating on hooks and audiences.\n\n**When you hit a winner, remake it five ways.** Different hook. Different format (static if it was video, voiceover if it was text-on-screen). Different sub-audience. One winner is the start, not the finish.\n\n**Don''t marry the first brand.** Stack bounties across three or four. That''s how the income actually compounds.\n\n## When your first ad lands\n\nPull up the dashboard. Study why it worked. The hook. The visual. The angle. What emotion did it trigger.\n\nThen iterate. The students earning the most are the ones who turn one winner into five.\n\nTwo or three bounties in, even before you''ve won, head to **Build your portfolio**. Every ad you''ve shipped is a portfolio piece you didn''t know you had.',
  updated_at = now()
where id = 'pb_submit_bounties';

-- Sanity check (commented):
-- select id, title, subtitle, length(doc_content) as len
-- from playbook_nodes where id = 'pb_submit_bounties';
