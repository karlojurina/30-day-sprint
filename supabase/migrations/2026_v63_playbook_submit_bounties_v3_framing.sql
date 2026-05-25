-- ============================================================
-- v63: Playbook — submit_bounties rewrite against v3 positioning.
--
-- The pb_submit_bounties node was last written in v50 with the
-- "Dragon" framing. That predates the v3 positioning constitution
-- (lovro-brief-v3/context/positioning.md), which locks beats 5–7
-- of the chain (the math, compounding, floor) to Month 2+ comms.
-- The Playbook is exactly that surface — students only see it
-- after R4 OR bounty_access_claimed_at — so the math belongs here.
--
-- What this changes:
--   • subtitle now leads with the math beat
--     ("Brands burn tens of thousands per day. Capture a sliver…")
--   • body opens with Spencer's killshot: ~$3K spend = ~$100 back =
--     covers the EcomTalent subscription
--   • adds the evergreen rules from Karlo's ad-bounty video
--     (no sales, no prices, talk to cold audiences) — these are
--     hard launch gates, not suggestions
--   • adds the practical "3 variations per bounty" + "one winner →
--     iterate five ways" mechanics from the transcript
--
-- Brand-spend number is the v3 placeholder ("tens of thousands per
-- day") until Zak's live data integration ships.
--
-- Other 3 playbook nodes (build_portfolio, apply_job_board,
-- land_first_client) are unchanged in this pass.
--
-- Idempotent.
-- ============================================================

update playbook_nodes
set
  subtitle = 'Brands burn tens of thousands per day. Capture a sliver and you''re inside for free.',
  doc_content = E'**Here''s the math nobody told you.**\n\nBrands on the Ad Bounty program spend tens of thousands of dollars per day. You get 3.5% of every dollar your ads spend. To cover what you pay to be here, you need ~$3K in spend across your bounties — roughly $100 back to you. Brands burn through that in minutes.\n\nOne ad that performs and you''re inside for free. Stack two winners and the math gets stupid. Students in this community have made $1K+/month from a single ad that the brand kept running because it kept making them money.\n\nThat''s the prize. Here''s how to capture it.\n\n## Your first move\n\nOpen Discord → find **#ad-bounty-info** → click the start link. Fill out the application (you''ll need a Wise account for automated payouts). Approval takes 24–48hr. Once you''re in, enroll in one brand whose product you''d actually buy yourself. Pin the submission link they DM you — that''s where every ad for that brand goes.\n\n## How it works\n\n1. **Apply once. Enroll per brand.** One approval to the program, then opt in to every brand you want to make ads for.\n2. **Read the brand brief twice before you write a single frame.** Watch their last 10 ads. Skim the market research doc. Most students skip this and waste their first bounty.\n3. **One angle. Three variations.** Same ad body, three different hooks. Lets Meta find which opening lands. Three is the sweet spot — not one, not six.\n4. **Submit through your link.** AI runs technical + brand QA in ~5 minutes. If it passes, the media-buying team launches it within 24–48hr.\n5. **The brand runs it with their own budget.** You never pay for spend.\n6. **Watch your dashboard.** Real-time spend, ROAS, revenue per ad.\n7. **Get paid every two weeks.** Automated to Wise based on your share of spend.\n\n## The Playbook — what most students miss\n\nThe real game is ads that keep running for a **year. Two years. Indefinitely.** Every month the ad survives, you keep getting paid for work you did once.\n\nThat means **evergreen ads only**:\n\n- **No sales. No "ending today". No Black Friday angles.** If you reference a window, the ad dies when the window closes.\n- **No prices in the ad.** Brands change pricing. Your "$29.99" ad becomes inaccurate and gets shut off.\n- **Talk to people who''ve never heard of this product.** Solve a problem they have, don''t pitch a feature list.\n\nBreak these rules and your ad doesn''t get launched. Evergreen or nothing.\n\n## Tips that move the needle\n\n- **An hour of brand study beats a day of editing.** The students who win are the ones who knew the brand better than the brand expected.\n- **Quality over volume.** Two thoughtful bounties beat ten lazy ones.\n- **If five ads don''t get spend, your angle is the problem — not your craft.** Stop iterating on edits, start iterating on hooks and audiences.\n- **When you hit a winner, remake it five ways.** Different hook, different format (static if it was video, voiceover if it was text-on-screen), different sub-audience. One winner is the start, not the finish.\n- **Don''t marry the first brand.** Stack bounties across three or four — that''s how the income actually compounds.\n\n## When your first ad lands\n\nOpen your dashboard. Study why it worked — the hook, the visual, the angle. Then iterate. The students earning the most are the ones who turn one winner into five.\n\nTwo or three bounties in — even before you''ve won — head to **Build your portfolio**. Every ad you''ve shipped is a portfolio piece you didn''t know you had.',
  updated_at = now()
where id = 'pb_submit_bounties';

-- Sanity check (commented):
-- select id, title, subtitle, length(doc_content) as len
-- from playbook_nodes where id = 'pb_submit_bounties';
