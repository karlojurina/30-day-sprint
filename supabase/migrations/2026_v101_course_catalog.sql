-- ============================================================
-- v101 — the real course goes into the staging catalog: 141 lessons in
--        the 8 areas, in the course's own order, under their real titles
--
-- GENERATED FILE. Never edit it by hand. It is written by
-- supabase/catalog/build-course-sql.mjs from
-- supabase/catalog/course_catalog.json. To change a title, the order, an
-- action item or the gate, change the data file and run
-- `npm run build:catalog`. The migration tests fail when this file and the
-- data file disagree.
--
-- Part of the course-catalog PRD (_admin/prds/course-catalog/
-- course_catalog_prd.md, section 9). The data file holds the course
-- "Ad Creative Program" as it was read on 2026-10-13, checked again on 2026-10-19.
--
-- WHAT THIS FILE DOES
--   1. Gives the 8 areas of regions_next the course's own chapter names.
--   2. Rewrites lessons_next. v94 seeded it with 145 placeholder lessons
--      ("Fundamentals · lesson 3"). After this file it holds the 141
--      lessons of the course: id, area, type, title, order, the 14 action
--      items with their briefs, the one gate (a4l17), the special
--      rows (a7l19, feature key bounty_access, outside the lesson count),
--      and every lesson's Whop lesson id (whop_lesson_id, a column this file
--      adds to lessons_next when it is missing). The Whop sync and the Whop
--      webhook find a lesson by that id, so once the cutover copies these
--      rows into lessons, a lesson watched on Whop counts on the map.
--      A lesson whose id is in the table already is updated in place and
--      keeps its created_at. A row whose id is not in the course is deleted.
--   3. Checks its own result before it commits, and ends with a table of
--      what the catalog holds.
--
-- WHY A NEW FILE
--   v94 seeds with "on conflict (id) do nothing", so running v94 again
--   changes no row that is already there.
--
-- WHAT IT NEVER WRITES
--   duration_seconds, bunny_video_id, video_ready_at and created_at. A
--   lesson gets its length together with its video row, from
--   supabase/diagnostics/load-lesson-videos.sql. Running this file again
--   after the videos are loaded keeps every length and every video row.
--   Nor does it write description on a lesson that exists: the written
--   instructions under a lesson come from
--   supabase/diagnostics/load-lesson-text.sql, and running this file again
--   keeps every one of them. A new lesson starts with none.
--
-- WHEN IT REFUSES, changing nothing
--   * The course switch has happened (admin_config holds
--     curriculum_reset_at, written by 2026_v104_course_switch.sql). The
--     course is then live in lessons, and this file changes only the
--     staging tables: run after the switch, it would look like it worked
--     while nothing a student sees changed.
--   * regions_next or lessons_next is missing (v94 has not run).
--   * regions_next holds anything other than the 8 areas a1 to a8.
--   * A row of lesson_videos or of student_lesson_watch points at a lesson
--     that this file would retitle or delete. Both tables name a lesson by
--     its id alone, so such a row would end up on another lesson. The
--     message lists the lessons and says what to do.
--   * A lesson that has a row in lesson_videos would stop being a watch
--     lesson. Only a watch lesson plays a video.
--   * A row of lesson_videos sits on a course lesson id (an id like a3l07)
--     that has no lesson in lessons_next yet. This file would create that
--     lesson, and the row would become its video without anyone having
--     matched the two.
--
-- OPERATIONAL CONSEQUENCES, stated plainly
--   1. A deployment that reads the staging catalog (CATALOG_TABLE_SUFFIX =
--      "_next", today the preview) shows the real course from the moment
--      this runs. On that deployment /dashboard reads the staging catalog
--      as well.
--   2. Nothing live reads these two tables. lessons and regions are not
--      touched.
--   3. After this file alone no lesson has a video or a length. The lesson
--      page says "Not recorded yet" until the video load has run.
--   4. A lesson id is its place in the course today: a, the area, l, the
--      position. From the moment a lesson has a video row or a watch row its
--      id stays. The order lives in sort_order, so a lesson added later
--      takes the next free number of its area and any position in the order.
--   5. Watching a staging lesson is still not counted before the cutover
--      (v100, consequence 4). This file does not change that.
--   6. supabase/diagnostics/prd1-postchecks.sql, rows 40 to 48, describes
--      v94's placeholder seed. Once this file has run those rows report
--      differences. The check for this file is
--      supabase/diagnostics/course-catalog-check.sql.
--
-- UNDO: supabase/undo/2026_v101_undo.sql. It is never run in sequence with
-- the migrations. It puts v94's placeholder seed back, and it refuses while a
-- video row or a watch row points at a course lesson.
--
-- Idempotent: a second run changes no column except updated_at. Wrapped in a
-- transaction, so it either finishes or changes nothing.
-- ============================================================

begin;

-- ─────────────── 1. The switch has not happened, the two tables are there, and the areas are the eight ───────────────

do $guard$
declare
  v_switched text;
  v_areas    text;
begin
  -- Read through to_regclass and execute, so the file runs the same way on a
  -- database without admin_config.
  if to_regclass('public.admin_config') is not null then
    execute 'select value from public.admin_config where key = $1' into v_switched using 'curriculum_reset_at';
    if v_switched is not null then
      raise exception 'The course is live in public.lessons since the switch of %; this file changes only the staging tables. Nothing was changed.', v_switched;
    end if;
  end if;

  if to_regclass('public.regions_next') is null or to_regclass('public.lessons_next') is null then
    raise exception 'public.regions_next or public.lessons_next does not exist. Run migration 2026_v94_catalog_next_staging.sql first. Nothing was changed.';
  end if;

  select string_agg(r.id, ', ' order by r.id) into v_areas from public.regions_next r;
  if v_areas is distinct from 'a1, a2, a3, a4, a5, a6, a7, a8' then
    raise exception 'public.regions_next must hold exactly the 8 areas a1 to a8, and it holds: %. This file writes the course into those 8 areas. Nothing was changed.', coalesce(v_areas, 'no rows');
  end if;
end
$guard$;

-- ─────────────── 2. No video row and no watch row may lose its lesson ───────────────
--
-- lesson_videos and student_lesson_watch name a lesson by its id, with no
-- foreign key. A row on a2l05 belongs to whatever lesson a2l05 is. So this
-- file stops when such a row sits on a staging lesson whose title would
-- change, or which would be deleted.
-- Both tables are read through to_regclass and execute, so the file runs the
-- same way on a database where v93 or v100 has not run.

do $guard$
declare
  -- Every lesson this file writes: its id, its title and its type.
  v_new constant text[] := array[
    ['a1l01', 'Welcome to Ecom University', 'watch'],
    ['a1l02', 'Why Marketing + Ecom = Money Printer', 'watch'],
    ['a1l03', 'The Skill Stacking Effect', 'watch'],
    ['a1l04', 'How This Program Works', 'watch'],
    ['a1l05', 'How To Learn Like A Billionaire', 'watch'],
    ['a1l06', 'How To Lock In', 'watch'],
    ['a1l07', 'Why You''re Not Behind', 'watch'],
    ['a1l08', 'You Need Resistance To Grow', 'watch'],
    ['a2l01', 'How Marketing Works (And Why We''re Doing Ads)', 'watch'],
    ['a2l02', 'Direct Response Advertising Explained', 'watch'],
    ['a2l03', 'How Ads Are Made, Full Process', 'watch'],
    ['a2l04', 'How To Stay Ahead Of AI', 'watch'],
    ['a2l05', 'Why Are People On Social Media?', 'watch'],
    ['a2l06', 'Why Do People Buy Things?', 'watch'],
    ['a2l07', 'How To Make People Say "This Is Literally Me"', 'watch'],
    ['a2l08', 'You''re Not Selling Products', 'watch'],
    ['a2l09', 'The Advertising Dictionary', 'watch'],
    ['a2l10', 'Building Your Marketing Muscle', 'watch'],
    ['a2l11', 'Time To Lock In', 'watch'],
    ['a3l01', 'Start to Greatness', 'watch'],
    ['a3l02', 'What an Ads Editor Actually Does', 'watch'],
    ['a3l03', 'What an Ad Really Is', 'watch'],
    ['a3l04', 'Types of Ads', 'watch'],
    ['a3l05', 'What Makes an Ad Work', 'watch'],
    ['a3l06', 'The Art of ''Show, Don''t Tell''', 'watch'],
    ['a3l07', 'Avatar-based Editing', 'watch'],
    ['a3l08', 'Understanding The Hook Slap', 'watch'],
    ['a3l09', 'The Hook Teardown', 'watch'],
    ['a3l10', 'The Slippery Slope', 'watch'],
    ['a3l11', 'Your Editing Software', 'watch'],
    ['a3l12', 'Load Your Kit', 'watch'],
    ['a3l13', 'CapCut Starter Course', 'watch'],
    ['a3l14', 'Premiere Pro Starter Course', 'watch'],
    ['a3l15', 'Asset Management', 'watch'],
    ['a3l16', 'What a Brief Is & How to Work With It', 'watch'],
    ['a3l17', 'Your First Boss Battle', 'watch'],
    ['a3l18', 'A-Roll - Your First Boss Battle', 'watch'],
    ['a3l19', 'Music - Your First Boss Battle', 'watch'],
    ['a3l20', 'B-Roll - Your First Boss Battle', 'watch'],
    ['a3l21', 'Effects & Transitions - Your First Boss Battle', 'watch'],
    ['a3l22', 'Captions & Text - Your First Boss Battle', 'watch'],
    ['a3l23', 'SFX - Your First Boss Battle', 'watch'],
    ['a3l24', 'How to Submit an Action Item', 'watch'],
    ['a3l25', '[ACTION ITEM] Congrats! Here''s another one', 'watch'],
    ['a4l01', 'How to Improve Fast: Your Daily Editing Routine', 'watch'],
    ['a4l02', 'Editing Breakdown - UGC', 'watch'],
    ['a4l03', 'Editing Breakdown - Text on Screen Ad', 'watch'],
    ['a4l04', 'Editing Breakdown - AI VO Ad', 'watch'],
    ['a4l05', 'Editing Breakdown - VSL Ad', 'watch'],
    ['a4l06', 'Understanding Leverage Moves', 'watch'],
    ['a4l07', 'The Emotion Map', 'watch'],
    ['a4l08', 'Reading Scripts Like the Top 1%', 'watch'],
    ['a4l09', 'ElevenLabs: Walkthrough', 'watch'],
    ['a4l10', 'ElevenLabs: Masterclass V1', 'watch'],
    ['a4l11', 'Music Leverage', 'watch'],
    ['a4l12', 'The Focal Point', 'watch'],
    ['a4l13', 'World Building', 'watch'],
    ['a4l14', 'Cinematography Basics', 'watch'],
    ['a4l15', 'Effects & Transitions', 'watch'],
    ['a4l16', 'Sound Design That Feels Real', 'watch'],
    ['a4l17', 'The Editor''s Teardown', 'watch'],
    ['a5l01', 'You should be a designer', 'watch'],
    ['a5l02', 'What are static ads?', 'watch'],
    ['a5l03', 'The Tools', 'watch'],
    ['a5l04', 'Figma - The Base', 'watch'],
    ['a5l05', 'Figma - Ad Design', 'watch'],
    ['a5l06', 'Figma - Ad Design 2', 'watch'],
    ['a5l07', 'Photoshop - Essentials', 'watch'],
    ['a5l08', 'Action item - The Backbone', 'watch'],
    ['a5l09', 'Design Execution', 'watch'],
    ['a5l10', 'The anatomy of a static ad', 'watch'],
    ['a5l11', 'Design Fundamentals: Demo', 'watch'],
    ['a5l12', 'Action Item - Imitation', 'watch'],
    ['a5l13', 'How Static Ads Work?', 'watch'],
    ['a5l14', 'Meta Andromeda', 'watch'],
    ['a5l15', 'The Scroll & The Single Frame', 'watch'],
    ['a5l16', 'Study the Greats', 'watch'],
    ['a5l17', 'Copywriting for Statics', 'watch'],
    ['a5l18', 'Visual Inspiration', 'watch'],
    ['a5l19', 'Interpretation', 'watch'],
    ['a5l20', 'How to break the pattern', 'watch'],
    ['a5l21', 'Brand Interpretation', 'watch'],
    ['a5l22', 'Action Item - Brand Deck', 'setup'],
    ['a5l23', 'Action Item - Static Ad Brief', 'watch'],
    ['a5l24', 'AI in Design', 'watch'],
    ['a5l25', 'AI isn''t replacing designers', 'watch'],
    ['a5l26', 'The Core Principle', 'watch'],
    ['a6l01', 'AI, the biggest opportunity today', 'watch'],
    ['a6l02', 'Limitless Creativity', 'watch'],
    ['a6l03', 'ACTION ITEM: Study winning AI Ads', 'setup'],
    ['a6l04', 'Prompting 101: Prompt like a Million $ Operator', 'watch'],
    ['a6l05', 'What Actually Makes AI Ads generate $$$: Basics', 'watch'],
    ['a6l06', 'The Science Behind AI Animation Ads: Deep Dive', 'watch'],
    ['a6l07', 'The Anatomy of a Winning Ad: Half a Million in Spend', 'watch'],
    ['a6l08', 'Formats & Avatars', 'watch'],
    ['a6l09', 'How to Develop Winning Ideas: Creative Inspiration', 'watch'],
    ['a6l10', 'ACTION ITEM: Choose Your Visual Style', 'setup'],
    ['a6l11', 'Enough Theory, Let''s Get Shit Done', 'watch'],
    ['a6l12', 'Systems & Workflows: Basics', 'watch'],
    ['a6l13', 'TrenchOS: Your Private AI Ads Platform', 'watch'],
    ['a6l14', 'Our Private $$$ AI UGC Workflow', 'watch'],
    ['a6l15', 'Our Private $$$ AI Animation Workflow', 'watch'],
    ['a6l16', 'Our Private $$$ AI B-Roll Workflow', 'watch'],
    ['a6l17', 'ACTION ITEM: Stop', 'setup'],
    ['a6l18', 'Intro + My Mental Model to Reverse-Engineer Any AI Ad', 'watch'],
    ['a6l19', 'ACTION ITEM: Reverse engineering', 'setup'],
    ['a6l20', 'Advanced Technique: Transitions', 'watch'],
    ['a6l21', 'Mastering Creative Judgment in AI Ads', 'watch'],
    ['a6l22', 'The Start', 'watch'],
    ['a7l01', 'Welcome To Creative Strategy', 'watch'],
    ['a7l02', 'What Is Creative Strategy?', 'watch'],
    ['a7l03', 'How To Be Creative?', 'watch'],
    ['a7l04', 'How To Strategize?', 'watch'],
    ['a7l05', 'Market Awareness', 'watch'],
    ['a7l06', 'Market Sophistication', 'watch'],
    ['a7l07', 'How I Made A Winning Ad From Scratch (With Proof)', 'watch'],
    ['a7l08', 'Winning Ad Breakdown: Episode 1', 'watch'],
    ['a7l09', 'Winning Ad Breakdown: Episode 2', 'watch'],
    ['a7l10', 'Winning Ad Breakdown: Episode 3', 'watch'],
    ['a7l11', 'Winning Ad Breakdown: Episode 4', 'watch'],
    ['a7l12', 'Winning Ad Breakdown: Episode 5', 'watch'],
    ['a7l13', 'Winning Ad Breakdown: Episode 6', 'watch'],
    ['a7l14', 'How We Use AI For Creative Strategy', 'watch'],
    ['a7l15', 'Creative Strategy Workspace Overview', 'watch'],
    ['a7l16', 'How To Setup Creative Strategy Workspace', 'watch'],
    ['a7l17', 'Making Your First Ad', 'watch'],
    ['a7l18', 'Making The Workspace Your Own', 'watch'],
    ['a7l19', 'How To Win On The Ad Bounty Program', 'watch'],
    ['a8l01', 'Intro', 'watch'],
    ['a8l02', 'Communication', 'watch'],
    ['a8l03', 'Experience Over Money', 'watch'],
    ['a8l04', 'Portfolio', 'watch'],
    ['a8l05', 'How To Win On The Job Board', 'watch'],
    ['a8l06', 'Build Your Name In Public', 'watch'],
    ['a8l07', 'After You Apply', 'watch'],
    ['a8l08', 'The Call', 'watch'],
    ['a8l09', 'What To Charge', 'watch'],
    ['a8l10', 'How To Vet Clients', 'watch'],
    ['a8l11', 'Become Unfireable', 'watch'],
    ['a8l12', 'Raise Your Prices', 'watch'],
    ['a8l13', 'What Now?', 'watch']
  ];
  v_videos    text[];
  v_watched   text[];
  v_on_videos text;
  v_on_watch  text;
  v_no_watch  text;
  v_waiting   text;
begin
  if to_regclass('public.lesson_videos') is not null then
    execute 'select array_agg(distinct lesson_id) from public.lesson_videos' into v_videos;
  end if;
  if to_regclass('public.student_lesson_watch') is not null then
    execute 'select array_agg(distinct lesson_id) from public.student_lesson_watch' into v_watched;
  end if;

  select string_agg(l.id, ', ' order by l.sort_order) filter (where l.id = any (v_videos)),
         string_agg(l.id, ', ' order by l.sort_order) filter (where l.id = any (v_watched))
    into v_on_videos, v_on_watch
    from public.lessons_next l
    left join (select v_new[i][1] as id, v_new[i][2] as title
                 from generate_subscripts(v_new, 1) as i) n on n.id = l.id
   where n.id is null or n.title is distinct from l.title;

  -- Same id, same title, and the lesson would stop being a watch lesson.
  select string_agg(l.id, ', ' order by l.sort_order) into v_no_watch
    from public.lessons_next l
    join (select v_new[i][1] as id, v_new[i][3] as type
            from generate_subscripts(v_new, 1) as i) n on n.id = l.id
   where l.id = any (v_videos) and l.type = 'watch' and n.type <> 'watch';

  -- A video row on a course lesson id that has no lesson yet.
  select string_agg(v.id, ', ' order by v.id) into v_waiting
    from unnest(v_videos) as v(id)
   where v.id ~ '^a[1-8]l[0-9]{2}$'
     and not exists (select 1 from public.lessons_next l where l.id = v.id);

  if v_on_videos is not null or v_on_watch is not null then
    raise exception 'This file would retitle or delete lessons that other rows point at. With a video row in lesson_videos: %. With a watch row in student_lesson_watch: %. Those rows name a lesson by its id, so afterwards they would sit on another lesson or on none. To go on, delete those rows, run this file again, and then load the videos again with supabase/diagnostics/load-lesson-videos.sql, which is written from the new catalog. Nothing was changed.',
      coalesce(v_on_videos, 'none'), coalesce(v_on_watch, 'none');
  end if;

  if v_no_watch is not null then
    raise exception 'This file would turn lessons that have a video row into lessons that are not watch lessons: %. Only a watch lesson plays a video. To go on, delete the rows of those lessons from public.lesson_videos and run this file again. Nothing was changed.', v_no_watch;
  end if;

  if v_waiting is not null then
    raise exception 'public.lesson_videos holds rows on course lesson ids that have no lesson in public.lessons_next: %. A video row names a lesson by its id, so each of them would become the video of whatever lesson this file puts under that id. To go on, delete those rows, run this file again, and then load the videos with supabase/diagnostics/load-lesson-videos.sql. Nothing was changed.', v_waiting;
  end if;
end
$guard$;

-- ─────────────── 3. The 8 areas get their real names ───────────────

update public.regions_next as r
   set name = v.name
  from (values
    ('a1', 'Introduction'),
    ('a2', 'Marketing Fundamentals'),
    ('a3', 'Video Ads I'),
    ('a4', 'Video Ads II'),
    ('a5', 'Static Ads'),
    ('a6', 'AI Ads + Content'),
    ('a7', 'Creative Strategy'),
    ('a8', 'How To Land Clients')
  ) as v(id, name)
 where r.id = v.id;

-- ─────────────── 4. Clear the way ───────────────
--
-- First the column for the Whop lesson id, when it is missing, with its own
-- unique index: one Whop lesson belongs to one lesson. v94 has no such column.
--
-- Four unique indexes stand in the way of rewriting the rows one by one: one
-- gate, one lesson per feature key, one lesson per Whop lesson id, one lesson
-- per sort_order. The gate, the feature keys and the Whop lesson ids are taken
-- off, and every sort_order is moved up by 100000. Step 5 gives the lessons
-- of the course their real values back. What is still parked above 100000
-- after step 5 is a row the course no longer has.

alter table public.lessons_next add column if not exists whop_lesson_id text;

create unique index if not exists lessons_next_whop_lesson_id_key
  on public.lessons_next (whop_lesson_id) where whop_lesson_id is not null;

update public.lessons_next
   set is_gate = false, feature_key = null, whop_lesson_id = null
 where is_gate or feature_key is not null or whop_lesson_id is not null;

update public.lessons_next set sort_order = sort_order + 100000;

-- ─────────────── 5. The 141 lessons of the course ───────────────
--
-- lesson_group_id and discord_channel are null and is_optional is false on
-- every row. A new row starts with no description, and a row that exists
-- keeps its own: load-lesson-text.sql writes that column, so it is not in the
-- update list below. duration_seconds, bunny_video_id, video_ready_at and
-- created_at are not in the column list, so a row that exists keeps its own.

insert into public.lessons_next
  (id, region_id, type, title, description, sort_order, requires_action, action_brief,
   is_optional, is_gate, lesson_group_id, discord_channel, counts_toward_progress, feature_key,
   whop_lesson_id)
values
  ('a1l01', 'a1', 'watch', 'Welcome to Ecom University', null, 1, false, null, false, false, null, null, true, null, 'lesn_cpJLgWKYeczP8'),
  ('a1l02', 'a1', 'watch', 'Why Marketing + Ecom = Money Printer', null, 2, false, null, false, false, null, null, true, null, 'lesn_cgI3ZSzUQ0CNC'),
  ('a1l03', 'a1', 'watch', 'The Skill Stacking Effect', null, 3, false, null, false, false, null, null, true, null, 'lesn_hJrXBoPiB7iN9'),
  ('a1l04', 'a1', 'watch', 'How This Program Works', null, 4, false, null, false, false, null, null, true, null, 'lesn_9tZJBvqx0b1NI'),
  ('a1l05', 'a1', 'watch', 'How To Learn Like A Billionaire', null, 5, false, null, false, false, null, null, true, null, 'lesn_T3xjECjrBrrr2'),
  ('a1l06', 'a1', 'watch', 'How To Lock In', null, 6, false, null, false, false, null, null, true, null, 'lesn_5FVNyI5IlsJkD'),
  ('a1l07', 'a1', 'watch', 'Why You''re Not Behind', null, 7, false, null, false, false, null, null, true, null, 'lesn_UDoNWaqWKAdeM'),
  ('a1l08', 'a1', 'watch', 'You Need Resistance To Grow', null, 8, false, null, false, false, null, null, true, null, 'lesn_Tx08hjqPbO5rH'),
  ('a2l01', 'a2', 'watch', 'How Marketing Works (And Why We''re Doing Ads)', null, 9, false, null, false, false, null, null, true, null, 'lesn_IV8st85TL9EzZ'),
  ('a2l02', 'a2', 'watch', 'Direct Response Advertising Explained', null, 10, false, null, false, false, null, null, true, null, 'lesn_TMSDjHZV94kgv'),
  ('a2l03', 'a2', 'watch', 'How Ads Are Made, Full Process', null, 11, false, null, false, false, null, null, true, null, 'lesn_Y22BG4q1RCcnq'),
  ('a2l04', 'a2', 'watch', 'How To Stay Ahead Of AI', null, 12, false, null, false, false, null, null, true, null, 'lesn_6nyT8bfBK9K0j'),
  ('a2l05', 'a2', 'watch', 'Why Are People On Social Media?', null, 13, false, null, false, false, null, null, true, null, 'lesn_t0u1NHGNE5u0J'),
  ('a2l06', 'a2', 'watch', 'Why Do People Buy Things?', null, 14, false, null, false, false, null, null, true, null, 'lesn_YNa2lt7W4M5ge'),
  ('a2l07', 'a2', 'watch', 'How To Make People Say "This Is Literally Me"', null, 15, false, null, false, false, null, null, true, null, 'lesn_13v224kX5OVxH'),
  ('a2l08', 'a2', 'watch', 'You''re Not Selling Products', null, 16, false, null, false, false, null, null, true, null, 'lesn_HKiS5KpygYexl'),
  ('a2l09', 'a2', 'watch', 'The Advertising Dictionary', null, 17, false, null, false, false, null, null, true, null, 'lesn_famuI1T6CSpwz'),
  ('a2l10', 'a2', 'watch', 'Building Your Marketing Muscle', null, 18, false, null, false, false, null, null, true, null, 'lesn_yzr0mf5Jlqslr'),
  ('a2l11', 'a2', 'watch', 'Time To Lock In', null, 19, false, null, false, false, null, null, true, null, 'lesn_lDCUjsItYSRVV'),
  ('a3l01', 'a3', 'watch', 'Start to Greatness', null, 20, false, null, false, false, null, null, true, null, 'lesn_5I9lOoZsLRU5c'),
  ('a3l02', 'a3', 'watch', 'What an Ads Editor Actually Does', null, 21, false, null, false, false, null, null, true, null, 'lesn_gWVR78ehigHAA'),
  ('a3l03', 'a3', 'watch', 'What an Ad Really Is', null, 22, false, null, false, false, null, null, true, null, 'lesn_SEEHgNdF5PSpk'),
  ('a3l04', 'a3', 'watch', 'Types of Ads', null, 23, false, null, false, false, null, null, true, null, 'lesn_21pQDOwhgeJWr'),
  ('a3l05', 'a3', 'watch', 'What Makes an Ad Work', null, 24, false, null, false, false, null, null, true, null, 'lesn_Q366ST1SLZMrS'),
  ('a3l06', 'a3', 'watch', 'The Art of ''Show, Don''t Tell''', null, 25, false, null, false, false, null, null, true, null, 'lesn_hnHrbscBN6MDv'),
  ('a3l07', 'a3', 'watch', 'Avatar-based Editing', null, 26, false, null, false, false, null, null, true, null, 'lesn_fb7qM8fgfb9az'),
  ('a3l08', 'a3', 'watch', 'Understanding The Hook Slap', null, 27, false, null, false, false, null, null, true, null, 'lesn_r582g3kmv9qVw'),
  ('a3l09', 'a3', 'watch', 'The Hook Teardown', null, 28, false, null, false, false, null, null, true, null, 'lesn_5a4qol57uMGpc'),
  ('a3l10', 'a3', 'watch', 'The Slippery Slope', null, 29, false, null, false, false, null, null, true, null, 'lesn_6ob6gb50zJFob'),
  ('a3l11', 'a3', 'watch', 'Your Editing Software', null, 30, false, null, false, false, null, null, true, null, 'lesn_TfCehZMcwFFED'),
  ('a3l12', 'a3', 'watch', 'Load Your Kit', null, 31, false, null, false, false, null, null, true, null, 'lesn_fQK4tPL1d8yiA'),
  ('a3l13', 'a3', 'watch', 'CapCut Starter Course', null, 32, false, null, false, false, null, null, true, null, 'lesn_aTv5ztfDe5FQk'),
  ('a3l14', 'a3', 'watch', 'Premiere Pro Starter Course', null, 33, false, null, false, false, null, null, true, null, 'lesn_GM5vHgPalb3XY'),
  ('a3l15', 'a3', 'watch', 'Asset Management', null, 34, false, null, false, false, null, null, true, null, 'lesn_9oqTEV90xGiAD'),
  ('a3l16', 'a3', 'watch', 'What a Brief Is & How to Work With It', null, 35, false, null, false, false, null, null, true, null, 'lesn_BZsTm3En9zj7k'),
  ('a3l17', 'a3', 'watch', 'Your First Boss Battle', null, 36, true, 'Edit your first ad from the brief, step by step with the lessons that follow, then submit it.', false, false, null, null, true, null, 'lesn_tqVoEVlvmqcNg'),
  ('a3l18', 'a3', 'watch', 'A-Roll - Your First Boss Battle', null, 37, false, null, false, false, null, null, true, null, 'lesn_K9rw8c7czrnxh'),
  ('a3l19', 'a3', 'watch', 'Music - Your First Boss Battle', null, 38, false, null, false, false, null, null, true, null, 'lesn_PNwFBoNG6qUAi'),
  ('a3l20', 'a3', 'watch', 'B-Roll - Your First Boss Battle', null, 39, false, null, false, false, null, null, true, null, 'lesn_n5tesFEBVoEDP'),
  ('a3l21', 'a3', 'watch', 'Effects & Transitions - Your First Boss Battle', null, 40, false, null, false, false, null, null, true, null, 'lesn_TezU5obcbVhK4'),
  ('a3l22', 'a3', 'watch', 'Captions & Text - Your First Boss Battle', null, 41, false, null, false, false, null, null, true, null, 'lesn_5rrfiw4rpjDKU'),
  ('a3l23', 'a3', 'watch', 'SFX - Your First Boss Battle', null, 42, false, null, false, false, null, null, true, null, 'lesn_P0YLAiY8Don7n'),
  ('a3l24', 'a3', 'watch', 'How to Submit an Action Item', null, 43, false, null, false, false, null, null, true, null, 'lesn_oBG9UqLxBA6yI'),
  ('a3l25', 'a3', 'watch', '[ACTION ITEM] Congrats! Here''s another one', null, 44, true, 'Edit the entire ad all by yourself, from the brief all the way to the submission.', false, false, null, null, true, null, 'lesn_utZ7VahCXShWV'),
  ('a4l01', 'a4', 'watch', 'How to Improve Fast: Your Daily Editing Routine', null, 45, false, null, false, false, null, null, true, null, 'lesn_lgkk7aRIPBwDf'),
  ('a4l02', 'a4', 'watch', 'Editing Breakdown - UGC', null, 46, true, 'Edit the UGC ad yourself from the brief in the lesson, then post it for the coaches'' review.', false, false, null, null, true, null, 'lesn_RZAleGyAu1pmm'),
  ('a4l03', 'a4', 'watch', 'Editing Breakdown - Text on Screen Ad', null, 47, true, 'Edit the text on screen ad yourself from the brief in the lesson, then post it for the coaches'' review.', false, false, null, null, true, null, 'lesn_Op529V4SoObt2'),
  ('a4l04', 'a4', 'watch', 'Editing Breakdown - AI VO Ad', null, 48, true, 'Edit the AI voiceover ad yourself from the brief in the lesson, then post it for the coaches'' review.', false, false, null, null, true, null, 'lesn_JZleFDdLUDGL0'),
  ('a4l05', 'a4', 'watch', 'Editing Breakdown - VSL Ad', null, 49, true, 'Edit the VSL ad yourself from the brief and the assets in the lesson, then post it for the coaches'' review.', false, false, null, null, true, null, 'lesn_26RJ8fja7HATk'),
  ('a4l06', 'a4', 'watch', 'Understanding Leverage Moves', null, 50, false, null, false, false, null, null, true, null, 'lesn_hvfqbNtKKrYMq'),
  ('a4l07', 'a4', 'watch', 'The Emotion Map', null, 51, false, null, false, false, null, null, true, null, 'lesn_L73QjVPOxinzc'),
  ('a4l08', 'a4', 'watch', 'Reading Scripts Like the Top 1%', null, 52, false, null, false, false, null, null, true, null, 'lesn_18IWiJpLCWDj5'),
  ('a4l09', 'a4', 'watch', 'ElevenLabs: Walkthrough', null, 53, false, null, false, false, null, null, true, null, 'lesn_ojBtxdb3cONKr'),
  ('a4l10', 'a4', 'watch', 'ElevenLabs: Masterclass V1', null, 54, false, null, false, false, null, null, true, null, 'lesn_7IAajltBVDNZL'),
  ('a4l11', 'a4', 'watch', 'Music Leverage', null, 55, false, null, false, false, null, null, true, null, 'lesn_j6s1pubEinnRv'),
  ('a4l12', 'a4', 'watch', 'The Focal Point', null, 56, false, null, false, false, null, null, true, null, 'lesn_u3uVqYyHrU6me'),
  ('a4l13', 'a4', 'watch', 'World Building', null, 57, false, null, false, false, null, null, true, null, 'lesn_UMmkFPoLQF4TP'),
  ('a4l14', 'a4', 'watch', 'Cinematography Basics', null, 58, false, null, false, false, null, null, true, null, 'lesn_EtC6pacSfELda'),
  ('a4l15', 'a4', 'watch', 'Effects & Transitions', null, 59, false, null, false, false, null, null, true, null, 'lesn_P5w5nAGWLguLR'),
  ('a4l16', 'a4', 'watch', 'Sound Design That Feels Real', null, 60, false, null, false, false, null, null, true, null, 'lesn_iBl1YOaml1Ckl'),
  ('a4l17', 'a4', 'watch', 'The Editor''s Teardown', null, 61, false, null, false, true, null, null, true, null, 'lesn_k7eJSJKR4nKFG'),
  ('a5l01', 'a5', 'watch', 'You should be a designer', null, 62, false, null, false, false, null, null, true, null, 'lesn_P7CYyeRhoOjuV'),
  ('a5l02', 'a5', 'watch', 'What are static ads?', null, 63, false, null, false, false, null, null, true, null, 'lesn_YoFOMOavZuF1n'),
  ('a5l03', 'a5', 'watch', 'The Tools', null, 64, false, null, false, false, null, null, true, null, 'lesn_m1f3rkYYOdsrH'),
  ('a5l04', 'a5', 'watch', 'Figma - The Base', null, 65, false, null, false, false, null, null, true, null, 'lesn_9o7w6zgr1f2dy'),
  ('a5l05', 'a5', 'watch', 'Figma - Ad Design', null, 66, false, null, false, false, null, null, true, null, 'lesn_zbHDuWaFKI6gp'),
  ('a5l06', 'a5', 'watch', 'Figma - Ad Design 2', null, 67, false, null, false, false, null, null, true, null, 'lesn_uIn3TI66tITL5'),
  ('a5l07', 'a5', 'watch', 'Photoshop - Essentials', null, 68, false, null, false, false, null, null, true, null, 'lesn_GLqQFtMKJT6Lg'),
  ('a5l08', 'a5', 'watch', 'Action item - The Backbone', null, 69, true, 'You''ll build a batch of 3 statics and grade it yourself with our Figma plugin.', false, false, null, null, true, null, 'lesn_fGZBBR3bdoswc'),
  ('a5l09', 'a5', 'watch', 'Design Execution', null, 70, false, null, false, false, null, null, true, null, 'lesn_x5l1UuaOw3ZqI'),
  ('a5l10', 'a5', 'watch', 'The anatomy of a static ad', null, 71, false, null, false, false, null, null, true, null, 'lesn_7EVYoU21lxJgL'),
  ('a5l11', 'a5', 'watch', 'Design Fundamentals: Demo', null, 72, false, null, false, false, null, null, true, null, 'lesn_3bWOVXY2iPkJD'),
  ('a5l12', 'a5', 'watch', 'Action Item - Imitation', null, 73, true, 'Your first shot at making actual ads by imitating an existing batch. The goal is accurately recreating existing creatives, while still following the technicalities covered so far.', false, false, null, null, true, null, 'lesn_1u1ml63Gd336B'),
  ('a5l13', 'a5', 'watch', 'How Static Ads Work?', null, 74, false, null, false, false, null, null, true, null, 'lesn_3yQOkZwcFf6kS'),
  ('a5l14', 'a5', 'watch', 'Meta Andromeda', null, 75, false, null, false, false, null, null, true, null, 'lesn_sjEdWhGcSUJmB'),
  ('a5l15', 'a5', 'watch', 'The Scroll & The Single Frame', null, 76, false, null, false, false, null, null, true, null, 'lesn_kPllhhEb6XmSV'),
  ('a5l16', 'a5', 'watch', 'Study the Greats', null, 77, false, null, false, false, null, null, true, null, 'lesn_eu82uZJ6fA3hb'),
  ('a5l17', 'a5', 'watch', 'Copywriting for Statics', null, 78, false, null, false, false, null, null, true, null, 'lesn_ElHwr0bveS5jp'),
  ('a5l18', 'a5', 'watch', 'Visual Inspiration', null, 79, false, null, false, false, null, null, true, null, 'lesn_3y5pGvbm8vGth'),
  ('a5l19', 'a5', 'watch', 'Interpretation', null, 80, false, null, false, false, null, null, true, null, 'lesn_ho8b7Gku9OJV0'),
  ('a5l20', 'a5', 'watch', 'How to break the pattern', null, 81, false, null, false, false, null, null, true, null, 'lesn_GTufpgEzZY6rE'),
  ('a5l21', 'a5', 'watch', 'Brand Interpretation', null, 82, false, null, false, false, null, null, true, null, 'lesn_hpeHnPMvPbWyc'),
  ('a5l22', 'a5', 'setup', 'Action Item - Brand Deck', null, 83, true, 'A finished brand deck of a random brand of your choice, using the template provided, and an analysis of 5 of the brand''s ads, their favorite formats and layouts.', false, false, null, null, true, null, 'lesn_Uod56bEnIDY1z'),
  ('a5l23', 'a5', 'watch', 'Action Item - Static Ad Brief', null, 84, true, 'Interpret a creative brief and design your own batch from scratch. It''s a review by Valter and George, not the plugin.', false, false, null, null, true, null, 'lesn_FI2Y1i1cOBowL'),
  ('a5l24', 'a5', 'watch', 'AI in Design', null, 85, false, null, false, false, null, null, true, null, 'lesn_OwbBYX22CWiuE'),
  ('a5l25', 'a5', 'watch', 'AI isn''t replacing designers', null, 86, false, null, false, false, null, null, true, null, 'lesn_ckFV01ZeE8yct'),
  ('a5l26', 'a5', 'watch', 'The Core Principle', null, 87, false, null, false, false, null, null, true, null, 'lesn_4IRDzy6voMXj1'),
  ('a6l01', 'a6', 'watch', 'AI, the biggest opportunity today', null, 88, false, null, false, false, null, null, true, null, 'lesn_UfecktfFX67Cc'),
  ('a6l02', 'a6', 'watch', 'Limitless Creativity', null, 89, false, null, false, false, null, null, true, null, 'lesn_clZRgxOiM83Fz'),
  ('a6l03', 'a6', 'setup', 'ACTION ITEM: Study winning AI Ads', null, 90, true, 'Take 10-15 minutes of your time and look through these AI ads and gather your first thoughts.', false, false, null, null, true, null, 'lesn_2MoZmjbIULyOi'),
  ('a6l04', 'a6', 'watch', 'Prompting 101: Prompt like a Million $ Operator', null, 91, false, null, false, false, null, null, true, null, 'lesn_LQ0edS1u6djPq'),
  ('a6l05', 'a6', 'watch', 'What Actually Makes AI Ads generate $$$: Basics', null, 92, false, null, false, false, null, null, true, null, 'lesn_fID6MV68kNB2f'),
  ('a6l06', 'a6', 'watch', 'The Science Behind AI Animation Ads: Deep Dive', null, 93, false, null, false, false, null, null, true, null, 'lesn_hfy4PCCBJM21S'),
  ('a6l07', 'a6', 'watch', 'The Anatomy of a Winning Ad: Half a Million in Spend', null, 94, false, null, false, false, null, null, true, null, 'lesn_y7Kw170CzE1jw'),
  ('a6l08', 'a6', 'watch', 'Formats & Avatars', null, 95, false, null, false, false, null, null, true, null, 'lesn_EBIdeIfkpyYwI'),
  ('a6l09', 'a6', 'watch', 'How to Develop Winning Ideas: Creative Inspiration', null, 96, false, null, false, false, null, null, true, null, 'lesn_bkZnU3aVhVY9E'),
  ('a6l10', 'a6', 'setup', 'ACTION ITEM: Choose Your Visual Style', null, 97, true, 'Find a visual style or ad that inspires you and save it as your reference.', false, false, null, null, true, null, 'lesn_OJextvPQ1ITwh'),
  ('a6l11', 'a6', 'watch', 'Enough Theory, Let''s Get Shit Done', null, 98, false, null, false, false, null, null, true, null, 'lesn_0B9WoLcPfmuup'),
  ('a6l12', 'a6', 'watch', 'Systems & Workflows: Basics', null, 99, false, null, false, false, null, null, true, null, 'lesn_9PV8DLbekxvyG'),
  ('a6l13', 'a6', 'watch', 'TrenchOS: Your Private AI Ads Platform', null, 100, false, null, false, false, null, null, true, null, 'lesn_XR7ACR1vGtbnf'),
  ('a6l14', 'a6', 'watch', 'Our Private $$$ AI UGC Workflow', null, 101, false, null, false, false, null, null, true, null, 'lesn_zVgJNRt31cclz'),
  ('a6l15', 'a6', 'watch', 'Our Private $$$ AI Animation Workflow', null, 102, false, null, false, false, null, null, true, null, 'lesn_AJFo7Ka7FMBow'),
  ('a6l16', 'a6', 'watch', 'Our Private $$$ AI B-Roll Workflow', null, 103, false, null, false, false, null, null, true, null, 'lesn_yx8hJNP7VUQFI'),
  ('a6l17', 'a6', 'setup', 'ACTION ITEM: Stop', null, 104, true, 'Take 10 to 15 minutes away from the screen. Sit down, relax, and think back over what you''ve learned so far.', false, false, null, null, true, null, 'lesn_DahglS54yV55A'),
  ('a6l18', 'a6', 'watch', 'Intro + My Mental Model to Reverse-Engineer Any AI Ad', null, 105, false, null, false, false, null, null, true, null, 'lesn_0EQQMfaMQAZxZ'),
  ('a6l19', 'a6', 'setup', 'ACTION ITEM: Reverse engineering', null, 106, true, 'Pick one piece of content you like, then break it down. Go shot by shot.', false, false, null, null, true, null, 'lesn_tiyMQICEXQBx2'),
  ('a6l20', 'a6', 'watch', 'Advanced Technique: Transitions', null, 107, false, null, false, false, null, null, true, null, 'lesn_BJ3Jtbi36B5ep'),
  ('a6l21', 'a6', 'watch', 'Mastering Creative Judgment in AI Ads', null, 108, false, null, false, false, null, null, true, null, 'lesn_7o1vdESoROyhG'),
  ('a6l22', 'a6', 'watch', 'The Start', null, 109, false, null, false, false, null, null, true, null, 'lesn_vnXkJ1SorbbVq'),
  ('a7l01', 'a7', 'watch', 'Welcome To Creative Strategy', null, 110, false, null, false, false, null, null, true, null, 'lesn_3GSvk5xWJyims'),
  ('a7l02', 'a7', 'watch', 'What Is Creative Strategy?', null, 111, false, null, false, false, null, null, true, null, 'lesn_Us9nE96lP3itG'),
  ('a7l03', 'a7', 'watch', 'How To Be Creative?', null, 112, false, null, false, false, null, null, true, null, 'lesn_eBKBfva1LLl4r'),
  ('a7l04', 'a7', 'watch', 'How To Strategize?', null, 113, false, null, false, false, null, null, true, null, 'lesn_FiQrpxXHhfAAW'),
  ('a7l05', 'a7', 'watch', 'Market Awareness', null, 114, false, null, false, false, null, null, true, null, 'lesn_BiIvR51xCwJ4r'),
  ('a7l06', 'a7', 'watch', 'Market Sophistication', null, 115, false, null, false, false, null, null, true, null, 'lesn_MstOaChCUFJHX'),
  ('a7l07', 'a7', 'watch', 'How I Made A Winning Ad From Scratch (With Proof)', null, 116, false, null, false, false, null, null, true, null, 'lesn_wfe69IgVMGOdg'),
  ('a7l08', 'a7', 'watch', 'Winning Ad Breakdown: Episode 1', null, 117, false, null, false, false, null, null, true, null, 'lesn_FNYVuTiBWdsp0'),
  ('a7l09', 'a7', 'watch', 'Winning Ad Breakdown: Episode 2', null, 118, false, null, false, false, null, null, true, null, 'lesn_VYdyXfQ91r7S3'),
  ('a7l10', 'a7', 'watch', 'Winning Ad Breakdown: Episode 3', null, 119, false, null, false, false, null, null, true, null, 'lesn_H18bK4SA6jshr'),
  ('a7l11', 'a7', 'watch', 'Winning Ad Breakdown: Episode 4', null, 120, false, null, false, false, null, null, true, null, 'lesn_QmaZSEH8GvZdU'),
  ('a7l12', 'a7', 'watch', 'Winning Ad Breakdown: Episode 5', null, 121, false, null, false, false, null, null, true, null, 'lesn_w5o84jabPcAHP'),
  ('a7l13', 'a7', 'watch', 'Winning Ad Breakdown: Episode 6', null, 122, false, null, false, false, null, null, true, null, 'lesn_rdcDDOkeLRZpr'),
  ('a7l14', 'a7', 'watch', 'How We Use AI For Creative Strategy', null, 123, false, null, false, false, null, null, true, null, 'lesn_Zo0MgXznAjwTQ'),
  ('a7l15', 'a7', 'watch', 'Creative Strategy Workspace Overview', null, 124, false, null, false, false, null, null, true, null, 'lesn_3T60HczIAmTe1'),
  ('a7l16', 'a7', 'watch', 'How To Setup Creative Strategy Workspace', null, 125, false, null, false, false, null, null, true, null, 'lesn_TlEOXVjBbmWoo'),
  ('a7l17', 'a7', 'watch', 'Making Your First Ad', null, 126, false, null, false, false, null, null, true, null, 'lesn_0tPgz1h8mixNu'),
  ('a7l18', 'a7', 'watch', 'Making The Workspace Your Own', null, 127, false, null, false, false, null, null, true, null, 'lesn_qREYYoc7gXFFA'),
  ('a7l19', 'a7', 'watch', 'How To Win On The Ad Bounty Program', null, 128, false, null, false, false, null, null, false, 'bounty_access', 'lesn_ZrEgiuDjhXOY2'),
  ('a8l01', 'a8', 'watch', 'Intro', null, 129, false, null, false, false, null, null, true, null, 'lesn_nDXLopje3ggoX'),
  ('a8l02', 'a8', 'watch', 'Communication', null, 130, false, null, false, false, null, null, true, null, 'lesn_B0dFf7uCBPb2d'),
  ('a8l03', 'a8', 'watch', 'Experience Over Money', null, 131, false, null, false, false, null, null, true, null, 'lesn_FpIfJIp9zQNip'),
  ('a8l04', 'a8', 'watch', 'Portfolio', null, 132, false, null, false, false, null, null, true, null, 'lesn_O2zCOoEf2u31F'),
  ('a8l05', 'a8', 'watch', 'How To Win On The Job Board', null, 133, false, null, false, false, null, null, true, null, 'lesn_wPiBe4VYi9C4A'),
  ('a8l06', 'a8', 'watch', 'Build Your Name In Public', null, 134, false, null, false, false, null, null, true, null, 'lesn_OJJVAyc2X26Ng'),
  ('a8l07', 'a8', 'watch', 'After You Apply', null, 135, false, null, false, false, null, null, true, null, 'lesn_FXZakY2eO91pH'),
  ('a8l08', 'a8', 'watch', 'The Call', null, 136, false, null, false, false, null, null, true, null, 'lesn_cDk3zQ1MWEbc8'),
  ('a8l09', 'a8', 'watch', 'What To Charge', null, 137, false, null, false, false, null, null, true, null, 'lesn_DBoFE4f5DS4yA'),
  ('a8l10', 'a8', 'watch', 'How To Vet Clients', null, 138, false, null, false, false, null, null, true, null, 'lesn_LFmVqrBwvy83R'),
  ('a8l11', 'a8', 'watch', 'Become Unfireable', null, 139, false, null, false, false, null, null, true, null, 'lesn_cRa08utk4iQpu'),
  ('a8l12', 'a8', 'watch', 'Raise Your Prices', null, 140, false, null, false, false, null, null, true, null, 'lesn_5XKWUVpQxaE09'),
  ('a8l13', 'a8', 'watch', 'What Now?', null, 141, false, null, false, false, null, null, true, null, 'lesn_ng7hOOi1pUxuv')
on conflict (id) do update
  set region_id              = excluded.region_id,
      type                   = excluded.type,
      title                  = excluded.title,
      sort_order             = excluded.sort_order,
      requires_action        = excluded.requires_action,
      action_brief           = excluded.action_brief,
      is_optional            = excluded.is_optional,
      is_gate                = excluded.is_gate,
      lesson_group_id        = excluded.lesson_group_id,
      discord_channel        = excluded.discord_channel,
      counts_toward_progress = excluded.counts_toward_progress,
      feature_key            = excluded.feature_key,
      whop_lesson_id         = excluded.whop_lesson_id;

-- ─────────────── 6. The rows the course no longer has ───────────────

delete from public.lessons_next where sort_order > 100000;

-- ─────────────── 7. The result is checked before it is kept ───────────────
--
-- Any line that does not hold raises, and the raise undoes everything above.

do $check$
declare
  f         record;
  v_sizes   text;
  v_crossed int;
begin
  select count(*)::int                                                      as n,
         count(*) filter (where counts_toward_progress)::int                as counting,
         min(sort_order)                                                    as lowest,
         max(sort_order)                                                    as highest,
         count(distinct sort_order)::int                                    as orders,
         count(*) filter (where requires_action)::int                       as actions,
         count(*) filter (where requires_action and action_brief is null)::int as no_brief,
         count(*) filter (where type = 'setup')::int                        as setups,
         count(*) filter (where title like '% · lesson %')::int             as placeholders,
         count(distinct whop_lesson_id)::int                                as whop_ids,
         coalesce(string_agg(id, ', ' order by sort_order) filter (where is_gate), 'none') as gates,
         coalesce(string_agg(id || ':' || coalesce(feature_key, 'no key') || ':'
                             || case when counts_toward_progress then 'counting' else 'outside the count' end,
                             ', ' order by sort_order)
                  filter (where feature_key is not null or not counts_toward_progress), 'none') as specials
    into f
    from public.lessons_next;

  select string_agg(s.n::text, ', ' order by s.order_num) into v_sizes
    from (select r.order_num, count(l.id) as n
            from public.regions_next r
            left join public.lessons_next l on l.region_id = r.id
           group by r.order_num) s;

  -- Areas whose first lesson does not come after the last lesson of the area
  -- before it. With none, sort_order never interleaves between two areas and
  -- it rises with order_num.
  select count(*)::int into v_crossed
    from (select a.lowest, lag(a.highest) over (order by a.order_num) as highest_before
            from (select r.order_num, min(l.sort_order) as lowest, max(l.sort_order) as highest
                    from public.regions_next r
                    join public.lessons_next l on l.region_id = r.id
                   group by r.order_num) a) t
   where t.lowest <= t.highest_before;

  if f.n <> 141 then
    raise exception 'lessons_next would hold % lessons and the course has 141. Nothing was changed.', f.n;
  end if;
  if f.counting <> 140 then
    raise exception '% lessons would count toward progress and the course has 140 that do. Nothing was changed.', f.counting;
  end if;
  if f.lowest <> 1 or f.highest <> 141 or f.orders <> 141 then
    raise exception 'sort_order would run from % to % over % different values. It must run from 1 to 141 with no hole. Nothing was changed.', f.lowest, f.highest, f.orders;
  end if;
  if v_sizes is distinct from '8, 11, 25, 17, 26, 22, 19, 13' then
    raise exception 'The 8 areas would hold % lessons. They must hold 8, 11, 25, 17, 26, 22, 19, 13. Nothing was changed.', v_sizes;
  end if;
  if v_crossed <> 0 then
    raise exception 'In % area(s) the first lesson would not come after the last lesson of the area before it. The order of the lessons must rise with the order of the areas and never cross between two of them. Nothing was changed.', v_crossed;
  end if;
  if f.gates <> 'a4l17' then
    raise exception 'The gate would be on: %. It must be on a4l17 and nowhere else. Nothing was changed.', f.gates;
  end if;
  if f.specials <> 'a7l19:bounty_access:outside the count' then
    raise exception 'The rows with a feature key or outside the lesson count would be: %. They must be: a7l19:bounty_access:outside the count. Nothing was changed.', f.specials;
  end if;
  if f.actions <> 14 or f.no_brief <> 0 then
    raise exception 'There would be % action items, % of them with no brief. The course has 14, each with its brief. Nothing was changed.', f.actions, f.no_brief;
  end if;
  if f.setups <> 5 then
    raise exception '% lessons would have the type setup and the course has 5. Nothing was changed.', f.setups;
  end if;
  if f.placeholders <> 0 then
    raise exception '% lessons would still carry a placeholder title from v94. Nothing was changed.', f.placeholders;
  end if;
  if f.whop_ids <> 141 then
    raise exception '% lessons would carry a Whop lesson id of their own, and all 141 must. Nothing was changed.', f.whop_ids;
  end if;
end
$check$;

commit;

-- ─────────────── 8. What the catalog holds now ───────────────
--
-- This is the table the SQL editor shows. One row per area and a total.

select t.area, t.name, t.rows, t.counting, t.action_items, t.with_length
  from (
    select r.order_num                                                   as place,
           r.id                                                          as area,
           r.name                                                        as name,
           count(l.id)::int                                              as rows,
           count(l.id) filter (where l.counts_toward_progress)::int      as counting,
           count(l.id) filter (where l.requires_action)::int             as action_items,
           count(l.id) filter (where l.duration_seconds is not null)::int as with_length
      from public.regions_next r
      left join public.lessons_next l on l.region_id = r.id
     group by r.order_num, r.id, r.name
    union all
    select 1000000, 'total', 'the whole course',
           count(*)::int,
           count(*) filter (where counts_toward_progress)::int,
           count(*) filter (where requires_action)::int,
           count(*) filter (where duration_seconds is not null)::int
      from public.lessons_next
  ) t
 order by t.place;
-- EXPECT 9 rows:
--     area    rows  counting  action_items
--     a1        8         8             0
--     a2       11        11             0
--     a3       25        25             2
--     a4       17        17             4
--     a5       26        26             4
--     a6       22        22             4
--     a7       19        18             0
--     a8       13        13             0
--     total   141       140            14
--   with_length is 0 on every row until load-lesson-videos.sql has run. After
--   it, with_length is the number of lessons that have a video.
--   If the file stopped with a message ending "Nothing was changed.", it is
--   true: the whole file is one transaction.
