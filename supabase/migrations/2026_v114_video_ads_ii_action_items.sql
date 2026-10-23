-- ============================================================
-- v114: Video Ads II's four editing breakdowns become action items with a
--       Discord link: a4l02, a4l03, a4l04 and a4l05.
--
-- The owner's decision of 2026-10-22 and 23: the coaches of Video Ads I and
-- II named their action items, and every one is handed in on Discord. The
-- four editing breakdowns, plain videos until now, ask for the student's own
-- edit, posted for the coaches' review. Their briefs, approved by the owner
-- word for word:
--   a4l02  Editing Breakdown - UGC
--          Edit the UGC ad yourself from the brief in the lesson, then post
--          it for the coaches' review.
--   a4l03  Editing Breakdown - Text on Screen Ad
--          Edit the text on screen ad yourself from the brief in the lesson,
--          then post it for the coaches' review.
--   a4l04  Editing Breakdown - AI VO Ad
--          Edit the AI voiceover ad yourself from the brief in the lesson,
--          then post it for the coaches' review.
--   a4l05  Editing Breakdown - VSL Ad
--          Edit the VSL ad yourself from the brief and the assets in the
--          lesson, then post it for the coaches' review.
-- The same four briefs are in supabase/catalog/course_catalog.json, so a
-- catalog rebuilt from the data file agrees with this file;
-- supabase/migration-tests/v114.test.mjs fails when the two differ.
--
-- WHICH TABLE: public.lessons, the live catalog. Since the course switch
-- (v104, on production since 2026-10-19) the new course is in lessons and
-- every reader reads it there: the student data route, the lesson page's
-- routes and the discount routes read LESSONS_TABLE
-- (src/lib/catalog-tables.ts), which is "lessons" once CATALOG_TABLE_SUFFIX
-- is empty, as the switch's ship order sets it and the admin's cutover check
-- asks; the progress views, lesson_is_complete's callers, the snapshot
-- function, the crons, the badges and the admin pages read lessons by name.
-- lessons_next, the staging copy the switch copied from, is left as it is:
-- since the switch nothing reads its action items (v101 refuses to run, and
-- the two private loads write only the texts and the lengths).
--
-- WHAT THIS FILE DOES, in one transaction
--   1. Locks public.lessons in SHARE ROW EXCLUSIVE mode, waiting 5 seconds
--      at most: no other session writes a lesson between the check and the
--      change. Reads go on (every page load reads lessons).
--   2. Checks it can (WHEN IT REFUSES below).
--   3. Sets requires_action true and action_brief to the brief above on each
--      of the four, only where either differs. Nothing else on the row moves
--      but updated_at (its trigger). No other lesson, no other table.
--   4. Checks its own result, commits, and shows one table.
--
-- WHAT STUDENTS SEE
--   * On each of the four: the Milestone box with its brief under the video,
--     then the Discord block: paste the link to the message, Save, then
--     "Complete lesson" (or "Complete the action" before the video is
--     watched). The lesson is done with both halves, the video and the
--     hand-in, in either order, as for a3l17, a3l25 and a5l23. A hand-in with
--     no link is refused by the server (mark-action-shipped).
--   * Everyone who already watched any of the four has an open action item
--     on it from this paste on: the video's half stays, and the lesson counts
--     as done only once the link and the button are in too. Their progress
--     counts it open until then: the percentage, Video Ads II's count on the
--     map (the place reads done only with the four handed in), the admin's
--     lessons done and the drawer ("Not yet"), Avg progress on the readings
--     written after the paste, the Playbook's 80% rule.
--   * The map does not hold them at any of the four: an action item whose
--     video is watched is passed (isPassed, map-model.ts), so the next lesson
--     on the map stays where it was.
--   * The 30% asks for the videos only (discount.ts, discount-server.ts), so
--     a student who watched every video through Video Ads II still meets it
--     with none of the four handed in.
--   * No badge is taken away. A new Perfectionist or Unbroken needs the four
--     handed in, Took the Shot can come from one, and Triple Threat counts
--     each at its hand-in.
--   * The team: the drawer lists the four as action items, and the trigger
--     editor offers them among the lessons with an action item. No built-in
--     CSM rule names them.
--
-- IT CAN BE PASTED ON ITS OWN, before or after any deploy. Production's code
-- (main as last fetched, 35bf390) handles any action item with a link, and
-- reads requires_action and action_brief from the catalog: the lesson page's
-- Milestone box and block, the link's route (save-action-link), the hand-in's
-- route (mark-action-shipped, which refuses one with no link), the map's rule
-- and the 30%. None of the four is on the list of action items finished with
-- Done alone (DONE_ONLY_ACTION_ITEMS, src/lib/world/action-items.ts, on the
-- preview's branch), so they keep the link with that build too.
--
-- WHEN IT REFUSES, changing nothing (every message ends "Nothing was changed.")
--   * public.lessons is missing.
--   * One of the four is not in public.lessons (the course switch has not
--     run, or the course there is another one).
--   * One of the four is not in Video Ads II (region a4).
--   * One of the four is not a watch lesson.
--   * One of the four is an action item already, with another brief: look
--     at it before going on.
--   * Its own check after the change fails.
--
-- WHEN THE TABLE IS BUSY
--   Another session holding public.lessons for more than 5 seconds stops it
--   with "Another session held public.lessons for more than 5 seconds (...),
--   so v114 did not start. Nothing was changed. Paste it again in a minute."
--   While it runs (well under a second) the app's writes of lessons wait for
--   it; its reads do not.
--
-- UNDO: supabase/undo/2026_v114_undo.sql puts the four back to plain videos,
-- each only while it still holds v114's brief, and never touches a
-- student's row.
--
-- Re-runnable: a second paste finds the four as this file leaves them,
-- changes nothing, and says so.
-- ============================================================

begin;

set local search_path = public;
set local lock_timeout = '5s';

-- ─────────────── 1. The lock ───────────────
--
-- Before anything is read. SHARE ROW EXCLUSIVE keeps every other writer out
-- and lets every reader in. The update below needs ROW EXCLUSIVE, which this
-- transaction then takes at once: no other session can hold a mode that
-- conflicts with it.

do $lock$
begin
  perform set_config('v114.changed', '', false);
  perform set_config('v114.ran', 'no', false);
  if to_regclass('public.lessons') is not null then
    lock table public.lessons in share row exclusive mode;
  end if;
exception when lock_not_available or deadlock_detected then
  raise exception 'Another session held public.lessons for more than 5 seconds (%), so v114 did not start. Nothing was changed. Paste it again in a minute.', sqlerrm
    using errcode = sqlstate;
end
$lock$;

-- ─────────────── 2 to 4. The four ───────────────

do $v114$
declare
  -- The four and their briefs, side by side: the one copy in this file.
  c_ids    constant text[] := array['a4l02', 'a4l03', 'a4l04', 'a4l05'];
  c_briefs constant text[] := array[
    'Edit the UGC ad yourself from the brief in the lesson, then post it for the coaches'' review.',
    'Edit the text on screen ad yourself from the brief in the lesson, then post it for the coaches'' review.',
    'Edit the AI voiceover ad yourself from the brief in the lesson, then post it for the coaches'' review.',
    'Edit the VSL ad yourself from the brief and the assets in the lesson, then post it for the coaches'' review.'
  ];
  v_found   text;
  v_before  bigint;
  v_after   bigint;
  v_changed text;
  v_n       int;
begin
  if to_regclass('public.lessons') is null then
    raise exception 'public.lessons is missing, so there is no catalog for v114 to change. Nothing was changed.';
  end if;

  select string_agg(f.id, ', ' order by f.place) into v_found
    from unnest(c_ids, c_briefs) with ordinality as f(id, brief, place)
   where not exists (select 1 from public.lessons l where l.id = f.id);
  if v_found is not null then
    raise exception 'These lessons are not in public.lessons: %. Since the course switch (v104) the new course is there, so this database holds another course or the switch has not run. Nothing was changed.', v_found;
  end if;

  select string_agg(format('%s (in %s)', l.id, coalesce(l.region_id, 'no area')), ', ' order by f.place) into v_found
    from unnest(c_ids, c_briefs) with ordinality as f(id, brief, place)
    join public.lessons l on l.id = f.id
   where l.region_id is distinct from 'a4';
  if v_found is not null then
    raise exception 'v114 is for Video Ads II (a4), and these lessons are not in it: %. Nothing was changed.', v_found;
  end if;

  select string_agg(format('%s (%s)', l.id, coalesce(l.type, 'no type')), ', ' order by f.place) into v_found
    from unnest(c_ids, c_briefs) with ordinality as f(id, brief, place)
    join public.lessons l on l.id = f.id
   where l.type is distinct from 'watch';
  if v_found is not null then
    raise exception 'v114 is for four watch lessons, and these are not watch lessons: %. Nothing was changed.', v_found;
  end if;

  select string_agg(format('%s ("%s")', l.id, coalesce(l.action_brief, 'no brief')), ', ' order by f.place) into v_found
    from unnest(c_ids, c_briefs) with ordinality as f(id, brief, place)
    join public.lessons l on l.id = f.id
   where l.requires_action and l.action_brief is distinct from f.brief;
  if v_found is not null then
    raise exception 'These lessons are action items already, with another brief than v114''s: %. Look at them before going on. Nothing was changed.', v_found;
  end if;

  select count(*) into v_before from public.lessons where requires_action;

  with changed as (
    update public.lessons l
       set requires_action = true,
           action_brief    = f.brief
      from unnest(c_ids, c_briefs) as f(id, brief)
     where l.id = f.id
       and (l.requires_action is distinct from true or l.action_brief is distinct from f.brief)
    returning l.id
  )
  select string_agg(c.id, ',' order by c.id), count(*) into v_changed, v_n from changed c;

  -- Its own check: the four as they must be, and no other lesson made or unmade an action item.
  select string_agg(f.id, ', ' order by f.place) into v_found
    from unnest(c_ids, c_briefs) with ordinality as f(id, brief, place)
    join public.lessons l on l.id = f.id
   where not (l.requires_action and l.action_brief = f.brief and l.region_id = 'a4' and l.type = 'watch');
  if v_found is not null then
    raise exception 'After v114 these lessons are not action items with v114''s brief: %. Nothing was changed.', v_found;
  end if;
  select count(*) into v_after from public.lessons where requires_action;
  if v_after <> v_before + v_n then
    raise exception 'There were % action items, v114 made % of the four one, and there are %. Nothing was changed.', v_before, v_n, v_after;
  end if;

  perform set_config('v114.changed', coalesce(v_changed, ''), false);
  perform set_config('v114.ran', 'yes', false);
end
$v114$;

commit;

-- ─────────────── What is there now ───────────────
--
-- One table: the first row says what this run did, then one row per lesson,
-- in course order.

select lesson, title, action_item, brief, changed_now, v114
  from (
    select 0 as o, null::text as lesson, null::text as title, null::boolean as action_item, null::text as brief,
           null::boolean as changed_now,
           case
             when current_setting('v114.ran', true) is distinct from 'yes'
               then 'v114 did not finish in this session. Nothing was changed.'
             when current_setting('v114.changed', true) <> ''
               then 'v114 ran now: ' || array_length(string_to_array(current_setting('v114.changed', true), ','), 1)
                    || ' of the four made action items with a Discord link ('
                    || replace(current_setting('v114.changed', true), ',', ', ') || ').'
             else 'v114 was already in place. This run changed nothing.'
           end as v114
    union all
    select l.sort_order, l.id, l.title, l.requires_action, l.action_brief,
           l.id = any (string_to_array(current_setting('v114.changed', true), ',')), null
      from public.lessons l
     where l.id in ('a4l02', 'a4l03', 'a4l04', 'a4l05')
  ) x
 order by o;
-- EXPECT on production, first run: 5 rows. The first says "v114 ran now: 4
-- of the four made action items with a Discord link (a4l02, a4l03, a4l04,
-- a4l05).", then a4l02 Editing Breakdown - UGC, a4l03 Editing Breakdown -
-- Text on Screen Ad, a4l04 Editing Breakdown - AI VO Ad and a4l05 Editing
-- Breakdown - VSL Ad, each with action_item true, its brief from the header
-- and changed_now true. A second paste: "v114 was already in place. This run
-- changed nothing." and changed_now false on all four. If the file stopped
-- with a message ending "Nothing was changed.", it is true: the whole file is
-- one transaction. A stop on "canceling statement due to lock timeout"
-- (SQLSTATE 55P03) or "deadlock detected" (40P01) is the same: nothing was
-- changed. Paste it again in a minute.
