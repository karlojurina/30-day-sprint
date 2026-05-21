-- ============================================================
-- v50: Bounty Access is the finish line.
--
-- Major model change per Karlo:
--   - The 30-day sprint ENDS with Bounty Access (l057).
--   - Everything that used to live after l057 (l058–l063: submit
--     bounty #1/#2/#3, performance dashboard, weekly call, final
--     reflection) was always Month 2-3 work, not sprint work.
--     Those concepts now live INSIDE the Playbook as content, not
--     as gated R4 lessons.
--   - sprint_completed_at retires. bounty_access_claimed_at is now
--     the single signal that unlocks the Playbook.
--
-- What this migration does:
--   1. Backfills bounty_access_claimed_at from sprint_completed_at
--      for any test student who finished under the old model
--      (so they don't regress to "playbook locked").
--   2. Drops l058–l063 from the lessons table (and any completion
--      rows referencing them — handled by FK CASCADE).
--   3. Drops the sprint_completed_at column from student_milestones.
--   4. Rewrites the four playbook_nodes bodies in Karlo's voice
--      (transcript-grounded) with the agreed shape: PROMISE →
--      FIRST MOVE → HOW IT WORKS → TIPS → WHEN YOU'RE READY.
--
-- Idempotent.
-- ============================================================

-- 1. Backfill bounty_access_claimed_at from sprint_completed_at
--    where it's missing. Only matters for the few test students who
--    finished under the old "Finish Program" flow.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name='student_milestones'
      and column_name='sprint_completed_at'
  ) then
    update student_milestones
    set bounty_access_claimed_at = sprint_completed_at
    where bounty_access_claimed_at is null
      and sprint_completed_at is not null;
  end if;
end $$;

-- 2. Drop l058–l063 (and their completion rows via CASCADE).
delete from lessons where id in ('l058', 'l059', 'l060', 'l061', 'l062', 'l063');

-- 3. Drop sprint_completed_at — it has no consumers after this push.
alter table student_milestones drop column if exists sprint_completed_at;

-- 4. Rewrite the playbook_nodes content. The four nodes already
--    exist from v42 (with TODO placeholder bodies). Update bodies +
--    subtitles in place; ids and positions stay.
update playbook_nodes
set
  title = 'Submit ad bounties',
  subtitle = 'Real brands. Real ad spend. Real data on what landed.',
  doc_content = E'**This is the Dragon.**\n\nYou stacked the skill for thirty days. Now you fight real brands with real ad spend behind your work. Every bounty teaches you what audiences actually buy — not what you guessed they''d buy. That feedback loop is the only way you get good.\n\n## Your first move\n\nOpen the bounty board → pick one brand whose product you''d actually use → read their brief twice before you write a single frame.\n\n## How it works\n\n1. **One brand. One ad.** Don''t spread thin on bounty #1. Read the brief, study their past ads, pick a single angle.\n2. **Ship it.** Submit through the bounty platform. The brand launches it with their own budget.\n3. **You get the data back.** What hooked, what dropped, what your CTR actually was.\n4. **Use the data on bounty #2.** This is where the loop kicks in.\n5. **Stack wins across brands.** You get paid a percent of every dollar a winning ad generates. Multiple brands = stacked income.\n\n## Tips\n\n- **Evergreen content beats promo content.** No prices, no discounts, no "ending today" — those expire, and so does your payout.\n- **Solve the customer''s problem.** Don''t pitch the product, address what they''re actually trying to fix.\n- **Speed > polish on #1.** Get data first, iterate next.\n- **If five ads don''t land, you''re missing something.** Stop guessing — drop the brief in Discord and ask.\n- **The ones who win stack bounties across multiple brands.** Don''t marry the first brand.\n\n## When you''re ready\n\nTwo or three bounties in — even just submitted, not winning yet — head to **Build your portfolio**. The work you''ve already done is portfolio fuel; most students don''t realize that.',
  updated_at = now()
where id = 'pb_submit_bounties';

update playbook_nodes
set
  title = 'Build your portfolio',
  subtitle = 'Every ad you shipped is a portfolio piece. Most students miss that.',
  doc_content = E'**The work is already yours.**\n\nEvery bounty submission, every action item, every ad you shipped in the sprint — that''s your portfolio. You don''t need permission, you don''t need a winner first, and you don''t need a "designer template". You need a doc, your name, and the truth about what you''ve made.\n\n## Your first move\n\nSet up your portfolio doc. Notion, Google Doc, one-page Framer site — pick whatever takes the least friction. Title it. Put your name on it. Today.\n\n## How it works\n\n1. **For each ad you shipped:** drop the creative, one short paragraph on the brand + angle, one short paragraph on what you learned making it.\n2. **When a winner lands:** add the numbers. Spend, CTR, ROAS, revenue — whatever the brand shares back.\n3. **Group by format:** organic, UGC, VSL, static, high-prod. Lets a brand spot the format they need at a glance.\n4. **Update every time you ship.** Not "someday when I have time" — the moment the ad goes out.\n\n## Tips\n\n- **Numbers beat opinions.** "Generated $4k in two weeks" beats "this one was good".\n- **Action items count.** Anything you made in the 30-day sprint is portfolio fuel.\n- **Don''t wait for a win to start.** Working portfolios get jobs; "I''ll do it later" portfolios don''t.\n- **One real result is worth ten case studies of theory.**\n- **Keep two versions.** A polished one you send to clients. A rough one for yourself — notes, failed angles, lessons.\n\n## When you''re ready\n\nYou don''t need to feel "finished" — start applying to the **job board** the moment you have three pieces with a story behind them. Movement compounds.',
  updated_at = now()
where id = 'pb_build_portfolio';

update playbook_nodes
set
  title = 'Apply to the job board',
  subtitle = 'Brands post almost every day, looking for what you just learned to do.',
  doc_content = E'**One client changes you.**\n\nKarlo posts new brand opportunities almost every day. They''re looking for the exact thing you just spent 30 days getting good at — editing video ads, writing static ads, building UGC. Editing for one brand teaches you ten times faster than studying. The path from "I''m learning" to "I''m a marketer" runs through this.\n\n## Your first move\n\nOpen the job board → scan the latest five posts → apply to the one that excites you, not the one that pays most. Do it before you close this sheet.\n\n## How it works\n\n1. **Read the brand''s brief.** Watch their last three ads. Notice what''s working and what''s missing.\n2. **Send a short application.** Two sentences: who you are, why this brand. Drop your portfolio link. That''s it.\n3. **If they ask for a sample:** make ONE ad to spec. Free. Treat it like a bounty.\n4. **Track every reply.** Even the no''s — patterns show up after three or four applications.\n\n## Tips\n\n- **Apply to brands you actually want to work with.** Mediocre fit = mediocre work.\n- **Quality over volume.** Five thoughtful applications beat thirty templates.\n- **Mention specifics from their brief.** Generic outreach gets ignored.\n- **A "no" today often becomes a "yes" in three weeks.** Stay friendly, keep shipping.\n- **Set a daily 5-minute window** to check the board. Karlo posts almost every day; don''t miss them.\n\n## When you''re ready\n\nWhen a brand says "send me a sample" — that''s the moment. The next card is the one that matters most.',
  updated_at = now()
where id = 'pb_apply_job_board';

update playbook_nodes
set
  title = 'Land your first client',
  subtitle = 'The line between learning and earning. You only cross it once.',
  doc_content = E'**This is the line.**\n\nOn one side: someone learning a skill. On the other: someone paid for it. The first client changes how you see yourself — not just what''s in your account. It''s the moment the whole 30-day sprint stops being theory.\n\nKarlo says it everywhere in the program: once you land the first one, things truly start to change. The skill compounds, the next clients come faster, the rate goes up. But the first one is the one you remember.\n\n## How you get there\n\nThis card doesn''t have a tutorial. The path runs through the three before it — bounty after bounty, portfolio piece after portfolio piece, application after application. Show up. Send the work. Don''t blink when it takes longer than you wanted.\n\n## When it happens\n\nPress the button below. The celebration is real because the moment is real. The work continues — but you''ve already crossed.',
  updated_at = now()
where id = 'pb_land_first_client';

-- Sanity check (commented):
-- select id, title, length(doc_content) as len, is_milestone
-- from playbook_nodes order by position;
-- -- expect: 4 rows, doc_content len > 500 chars each, only
-- -- pb_land_first_client is_milestone = true.
