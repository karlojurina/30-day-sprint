-- ============================================================
-- UNDO for v101 (supabase/migrations/2026_v101_course_catalog.sql)
--
-- GENERATED FILE. Never edit it by hand. It is written by
-- supabase/catalog/build-course-sql.mjs, together with the migration.
--
-- NOT A MIGRATION. A file in supabase/undo/ is never run in sequence with
-- supabase/migrations/. This one is run by hand, and only to take v101 back.
--
-- ⚠ IT REFUSES WHILE A VIDEO ROW OR A WATCH ROW POINTS AT A COURSE LESSON,
--   which is any id shaped like a3l07: a, the area 1 to 8, l, two digits.
--   After this file such an id names a placeholder lesson or no lesson, and
--   the row would say that a placeholder has a real video. With even one such
--   row the file stops, says how many there are, and changes nothing.
--   To go on:
--     1. the videos:   the private load file the Tella tool wrote holds
--                      every row. Run again after v101, it puts them back.
--                      If that file is lost, save the rows first:
--                        select lesson_id, tella_video_id
--                          from public.lesson_videos
--                         where lesson_id ~ '^a[1-8]l[0-9]{2}$'
--                         order by lesson_id;
--                      (keep the result somewhere private; never commit it)
--                      then: delete from public.lesson_videos
--                             where lesson_id ~ '^a[1-8]l[0-9]{2}$';
--     2. watch rows:   before the cutover none can exist on a course lesson.
--                      If some do, they are test rows or the cutover has
--                      happened. After the cutover this file is the wrong
--                      tool. Test rows: delete from public.student_lesson_watch
--                                        where lesson_id ~ '^a[1-8]l[0-9]{2}$';
--     3. run this file again.
--
-- WHAT IT DOES, once nothing points at a course lesson
--   1. Deletes every row of lessons_next.
--   2. Runs v94's own seed statements again: the 8 area names, the 145
--      placeholder lessons, the pond, the gate and the 9 placeholder action
--      items. Each statement below was copied by the script out of
--      supabase/migrations/2026_v94_catalog_next_staging.sql, from its first
--      line through its semicolon. Nothing in them was typed again. The
--      harness (supabase/migration-tests/run.mjs, section 20) checks that
--      every copy is found in the v94 file character for character, and that
--      regions_next and lessons_next end up as they were before v101.
--
-- WHAT YOU LOSE
--   The real course in the staging catalog. A deployment that reads it shows
--   "Fundamentals · lesson 3" again. Every length on a staging lesson goes
--   with its row.
--
-- WHAT IT LEAVES ALONE
--   lessons and regions, the live catalog. On regions_next: landmark_label,
--   rail_at and terrain (v99). On lessons_next: the whop_lesson_id column
--   and its index, which v101 adds; the placeholder rows have none. Every
--   student's rows.
--
-- Safe to run again: a second run ends in the same state. v101 can be run
-- again after it.
-- ============================================================

-- ─────────────── 0. Refuse while a row points at a course lesson ───────────────
--
-- On its own, ahead of the transaction: when it stops the file, nothing has
-- been started and nothing is left open. The message gives counts and never
-- a video id. Both tables are read through to_regclass and execute, so the
-- file runs the same way where v93 or v100 has not run.
do $guard$
declare
  c_course constant text := '^a[1-8]l[0-9]{2}$';
  v_videos bigint := 0;
  v_watch  bigint := 0;
begin
  if to_regclass('public.lesson_videos') is not null then
    execute 'select count(*) from public.lesson_videos where lesson_id ~ $1' into v_videos using c_course;
  end if;
  if to_regclass('public.student_lesson_watch') is not null then
    execute 'select count(*) from public.student_lesson_watch where lesson_id ~ $1' into v_watch using c_course;
  end if;
  if v_videos > 0 or v_watch > 0 then
    raise exception '% row(s) of public.lesson_videos and % row(s) of public.student_lesson_watch point at a course lesson (an id like a3l07). After this file those ids name placeholder lessons, so the rows would be wrong. The header of this file says how to save and remove them. Then run it again. Nothing was changed.', v_videos, v_watch;
  end if;
end
$guard$;

begin;

-- ─────────────── 1. The real course goes ───────────────

delete from public.lessons_next;

-- ─────────────── 2. v94's seed, copied by script ───────────────

-- The 8 areas and their placeholder names.
-- ▼ copied from 2026_v94_catalog_next_staging.sql
insert into public.regions_next (id, order_num, name) values
  ('a1', 1, 'Introduction'),
  ('a2', 2, 'Fundamentals'),
  ('a3', 3, 'Video Ads I'),
  ('a4', 4, 'Video Ads II'),
  ('a5', 5, 'Static Ads'),
  ('a6', 6, 'AI Ads & Content'),
  ('a7', 7, 'Creative Strategy'),
  ('a8', 8, 'Job Board')
on conflict (id) do update
  set order_num = excluded.order_num,
      name      = excluded.name;
-- ▲ end of the copy

-- The 145 placeholder lessons.
-- ▼ copied from 2026_v94_catalog_next_staging.sql
insert into public.lessons_next (id, region_id, type, title, sort_order)
select
  a.id || 'l' || lpad(g.n::text, 2, '0'),
  a.id,
  'watch',
  a.name || ' · lesson ' || g.n,
  row_number() over (order by a.order_num, g.n)
from (values
  ('a1', 1, 'Introduction',      8),
  ('a2', 2, 'Fundamentals',     10),
  ('a3', 3, 'Video Ads I',      22),
  ('a4', 4, 'Video Ads II',     22),
  ('a5', 5, 'Static Ads',       25),
  ('a6', 6, 'AI Ads & Content', 22),
  -- 21 lessons + the Ad Bounty pond = 22
  ('a7', 7, 'Creative Strategy', 22),
  ('a8', 8, 'Job Board',        14)
) as a(id, order_num, name, n)
cross join lateral generate_series(1, a.n) as g(n)
on conflict (id) do nothing;
-- ▲ end of the copy

-- The Ad Bounty pond.
-- ▼ copied from 2026_v94_catalog_next_staging.sql
update public.lessons_next
   set type = 'setup',
       title = 'Ad Bounty · get access',
       counts_toward_progress = false,
       feature_key = 'bounty_access'
 where id = 'a7l22';
-- ▲ end of the copy

-- The gate, in two statements.
-- ▼ copied from 2026_v94_catalog_next_staging.sql
update public.lessons_next set is_gate = false where is_gate and id <> 'a5l25';
-- ▲ end of the copy

-- ▼ copied from 2026_v94_catalog_next_staging.sql
update public.lessons_next set is_gate = true  where id = 'a5l25';
-- ▲ end of the copy

-- The 9 placeholder action items.
-- ▼ copied from 2026_v94_catalog_next_staging.sql
update public.lessons_next
   set requires_action = true,
       action_brief = 'Placeholder brief — PRD 2 writes the real one.'
 where id in ('a3l07','a3l14','a3l21',
              'a4l07','a4l14','a4l21',
              'a5l08','a5l16','a5l24');
-- ▲ end of the copy

commit;

-- ============================================================
-- POST-CHECKS
-- ============================================================
--
-- 1. One query. The placeholder catalog is back.
--
--    select
--      (select count(*) from public.regions_next) = 8                      as eight_areas,
--      (select count(*) from public.lessons_next) = 145                    as placeholder_lessons,
--      (select count(*) from public.lessons_next
--        where counts_toward_progress) = 144                               as counting,
--      (select count(*) from public.lessons_next
--        where title like '% · lesson %') = 144                            as placeholder_titles,
--      (select string_agg(id, ',') from public.lessons_next
--        where is_gate) = 'a5l25'                                          as gate_back,
--      (select count(*) from public.lessons_next
--        where requires_action) = 9                                        as action_items,
--      (select string_agg(id, ',') from public.lessons_next
--        where feature_key = 'bounty_access') = 'a7l22'                    as pond_back,
--      (select count(*) from public.lessons_next
--        where duration_seconds is not null) = 0                           as no_lengths;
--    EXPECT: every column true.
--
--  If the file stopped with "point at a course lesson", nothing was changed,
--  and this query comes back with most columns false.
-- ============================================================
