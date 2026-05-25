-- ============================================================
-- v64: Playbook — build_portfolio rewrite in Karlo's voice.
--
-- The pb_build_portfolio node was last written in v50. Lovro flagged
-- the existing copy as "cringe and sounds like AI" — lines like
-- "One real result is worth ten case studies of theory" and
-- "Movement compounds" are writer flourishes, not Karlo.
--
-- Rewrite grounded in Karlo's actual portfolio walkthrough from the
-- transcript corpus (~line 8240 of ecomtalent Transcripts.pdf). Key
-- voice anchors pulled directly:
--   • "clear over clever, every time" (his words)
--   • Google Drive folder is fine, don't over-complicate
--   • Loom-over-job-post is the differentiator that landed him most
--     clients
--   • "two hours of free work has landed students retainers" (his
--     editing-trial framing)
--   • Action items + bounties = portfolio (his explicit teaching)
--
-- Other 3 playbook nodes (submit_bounties, apply_job_board,
-- land_first_client) untouched in this pass. submit_bounties was
-- rewritten in v63; build_portfolio is this pass.
--
-- Idempotent.
-- ============================================================

update playbook_nodes
set
  subtitle = 'It''s a Google Drive folder. Don''t overthink it.',
  doc_content = E'**Don''t overthink this.**\n\nA portfolio is one thing: a place where someone can click a link and see examples of your work. That''s it. Not a website. Not a Framer landing page with your brand colors and a "Hi, I''m…" hero section. Karlo''s rule — clear over clever, every time.\n\nSo pick the lowest-friction option that lets a brand or agency click → see your ads → see results. Google Drive folder works. Notion page works. One scrollable doc works. The simplest one is the right one.\n\n## Your first move\n\nOpen a Google Drive folder right now. Title it "Your Name — Ad Creative." Drop in every ad you made in the 30-day sprint — action items, bounties, statics, organics, the ones that didn''t work, all of them.\n\nYou already have a portfolio. You just haven''t put it in a folder yet.\n\n## What goes in it\n\nThe work itself, and the truth about it. That''s the whole standard.\n\n1. **Every action item from the sprint.** UGC, organic, VSL, static — all of it. That''s why Karlo made you do them in this order: by the end of the sprint, you have 10–20 ads to point at.\n2. **Every bounty you''ve submitted.** Even the ones that didn''t get spend yet. Submitted ads = real ads for real brands.\n3. **For winning bounties: the numbers.** Spend, ROAS, revenue. Pull them off your bounty dashboard and write them next to the ad. "This ad generated $X for [brand]" beats anything else you could say.\n4. **Group by format.** UGC in one section, statics in another, VSLs in another. Lets a brand spot what they need in 10 seconds.\n\n## What NOT to do\n\n- **Don''t rip other people''s work.** It''s everywhere right now and brands know it — that''s why most job posts ask for an editing trial. Be the person who doesn''t need to fake it.\n- **Don''t wait for a "good enough" piece before you start.** That''s the move that kills 90% of portfolios. Your first version exists today. Add to it as you ship.\n- **Don''t build a fancy website.** You''re not a designer pitching designers. Brands want to click a link and see ads. Spend the time making more ads instead.\n- **Don''t be precious about it.** Action items count. Bounties without spend count. Free trials count. The portfolio is where the work lives, not a museum of your wins.\n\n## How to actually apply with it\n\nThis is where the folder pays off:\n\n- **Text application?** Drop the link. Don''t write a wall of copy explaining what you can do. Brands judge in 30 seconds whether they want to talk to you.\n- **Loom application?** This is the differentiator. A 2–3 minute Loom over the brand''s job post — "here''s what you posted, here''s what I''d do, here''s my work" — is what got Karlo most of his clients. Everyone applies with text. Almost nobody records a Loom. That''s the gap you walk through.\n- **If they ask for an editing trial, do it.** Free. Two hours of effort. Treat it like a bounty — two hours of free work has landed students retainers worth thousands per month because the brand kept them long-term.\n\n## When you''re ready\n\nThe moment you have a folder with anything in it — even three action items and one bounty — head to **Apply to the job board.** The folder is a tool. Applying is the move that actually changes your income.',
  updated_at = now()
where id = 'pb_build_portfolio';

-- Sanity check (commented):
-- select id, title, subtitle, length(doc_content) as len
-- from playbook_nodes where id = 'pb_build_portfolio';
