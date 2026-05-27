-- ============================================================
-- v72: Playbook HTML articles (lovro-brief-playbook-articles).
--
-- Map 2 collapses from 4 nodes to 3. The "Land Your First Client"
-- milestone node is dropped. Each remaining node now renders a
-- full standalone HTML article (served from public/playbook/<slug>/
-- index.html) inside an iframe, instead of the v63-v68 markdown
-- doc_content.
--
-- What this migration does:
--   1. Drops the pb_land_first_client row.
--   2. Adds playbook_nodes.article_slug - the folder name under
--      public/playbook/ that the iframe src is built from.
--   3. Sets article_slug + the new title/subtitle for the 3
--      remaining nodes.
--
-- Notes:
--   - doc_content stays on the table (NOT NULL historically) but is
--     no longer rendered. We blank it to a short pointer so it's
--     obvious the body now comes from the HTML article, not here.
--   - students.first_client_landed_at column stays (no schema
--     change); nothing writes it from the playbook flow anymore.
--   - is_milestone column stays; all 3 remaining nodes are
--     always-on (is_milestone = false).
--
-- Idempotent.
-- ============================================================

-- 1. Drop the milestone node (and any FK children via cascade).
delete from playbook_nodes where id = 'pb_land_first_client';

-- 2. Add the article_slug column.
alter table playbook_nodes
  add column if not exists article_slug text;

comment on column playbook_nodes.article_slug is
  'Folder under public/playbook/ whose index.html the node sheet renders in an iframe. e.g. 01-submit-ad-bounties. v72.';

-- 3. Point each remaining node at its HTML article + set new copy.
update playbook_nodes
set
  title = 'Submit ad bounties',
  subtitle = 'Cover your subscription, build a track record',
  article_slug = '01-submit-ad-bounties',
  doc_content = 'See HTML article at public/playbook/01-submit-ad-bounties/index.html (v72).',
  is_milestone = false,
  updated_at = now()
where id = 'pb_submit_bounties';

update playbook_nodes
set
  title = 'Build your portfolio',
  subtitle = 'Turn your bounty results into proof of skill',
  article_slug = '02-build-your-portfolio',
  doc_content = 'See HTML article at public/playbook/02-build-your-portfolio/index.html (v72).',
  is_milestone = false,
  updated_at = now()
where id = 'pb_build_portfolio';

-- Node 3 keeps its id (pb_apply_job_board) but is retitled to
-- "Apply to brands" and points at the 03-apply-to-brands article.
update playbook_nodes
set
  title = 'Apply to brands',
  subtitle = 'Sell yourself when you reach out',
  article_slug = '03-apply-to-brands',
  doc_content = 'See HTML article at public/playbook/03-apply-to-brands/index.html (v72).',
  is_milestone = false,
  updated_at = now()
where id = 'pb_apply_job_board';

-- Sanity check (commented):
-- select id, position, title, subtitle, article_slug, is_milestone
-- from playbook_nodes order by position;
-- -- expect 3 rows, all is_milestone = false, each with article_slug set.
