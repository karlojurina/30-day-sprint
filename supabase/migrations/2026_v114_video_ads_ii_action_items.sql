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
-- WHICH TABLES: public.lessons and public.lessons_next, the same change in
-- both.
--   * lessons is the live catalog. Since the course switch (v104, on
--     production since 2026-10-19) the new course is there, and production
--     reads it there: the student data route, the lesson page's routes and
--     the discount routes read LESSONS_TABLE (src/lib/catalog-tables.ts),
--     which is "lessons" once CATALOG_TABLE_SUFFIX is empty, as the switch's
--     ship order sets it on Production and the admin's cutover check asks;
--     the progress views, lesson_is_complete's callers, the snapshot
--     function, the crons, the badges and the admin pages read lessons by
--     name.
--   * lessons_next is the staging copy the switch copied from. A deployment
--     with CATALOG_TABLE_SUFFIX=_next reads LESSONS_TABLE there instead: the
--     lesson page and the map (through the data route) and the two hand-in
--     routes (save-action-link, mark-action-shipped). The cutover plan takes
--     that value off Vercel's Preview only in its week-later cleanup (WI-12),
--     and whether a preview still has it was not checked. Left as it was,
--     such a preview, on production's database, would show the four as
--     plain videos and refuse their hand-ins while its admin pages, which
--     read lessons by name, list them as action items, and the switch's
--     postcheck (cutover-postcheck.sql, its row 4) would find 4 lessons that
--     differ from lessons_next. v101 can no longer write it (it refuses to
--     run after the switch), so v114 does. With lessons_next missing, v114
--     writes lessons alone and says so.
--
-- BEFORE THE PASTE: run supabase/diagnostics/v114-before-paste.sql (read
-- only) on the same database. It counts what the paste changes for
-- students; WHAT STUDENTS SEE below names its lines. Production was not
-- read when this file was written, so none of its numbers is here. Two
-- lines ask for a look first:
--   * line c, the students whose Playbook the paste closes. When it is not
--     0, the owner decides: paste anyway, or first stamp
--     student_milestones.playbook_unlocked_at for them (the block at that
--     file's foot, a write on their rows that needs his word).
--   * line e, the live CSM templates with a condition on Video Ads II's
--     completion: look at each one before the paste.
--
-- WHAT THIS FILE DOES
--   0. Before its transaction, empties the four settings its last table
--      reads, so a run that stops says "did not finish" even in a session
--      where an earlier run finished.
--   Then, in one transaction:
--   1. Locks public.lessons, then public.lessons_next, in SHARE ROW EXCLUSIVE
--      mode, each lock waiting 5 seconds at most: no other session writes a
--      lesson between the check and the change. Reads go on (every page load
--      reads lessons).
--   2. Checks it can, in both tables (WHEN IT REFUSES below).
--   3. Sets requires_action true and action_brief to the brief above on each
--      of the four, in both tables, only where either differs. Nothing else
--      on the row moves but updated_at (its trigger). No other lesson, no
--      other table.
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
--     on it from this paste on (v114-before-paste.sql, line a counts the
--     students and line b the lessons): the video's half stays, and the
--     lesson counts as done only once the link and the button are in too.
--     Their progress counts it open until then: the percentage, Video Ads
--     II's count on the map (the place reads done only with the four handed
--     in), the admin's lessons done and the drawer ("Not yet"), Avg progress
--     on the readings written after the paste, the Playbook's 80% rule.
--   * The Playbook can close. The app works isPlaybookUnlocked
--     (src/lib/progress.ts) out on every load and never stamps it, so a
--     student who holds it by the 80% rule alone (no stamp, the last
--     counting lesson not done, 30 days or more since the first payment)
--     and falls under 80% with the four counted open loses it:
--     /dashboard/playbook sends them away and its link leaves the map, until
--     they hand in enough of the four (line c). A student under 30 days who
--     falls the same way gets it later than day 30 (line d).
--   * A student who watched one of the four can no longer rate it, or change
--     a rating, until it is handed in: the page shows no stars and the route
--     answers "Finish this lesson first, then rate it."
--     (src/lib/world/lesson-rating.ts). A rating given before stays.
--   * The map does not hold them at any of the four: an action item whose
--     video is watched is passed (isPassed, map-model.ts), so the next lesson
--     on the map stays where it was.
--   * The 30% asks for the videos only (discount.ts, discount-server.ts), so
--     a student who watched every video through Video Ads II still meets it
--     with none of the four handed in.
--   * No badge is taken away: a badge once given stays. A new Perfectionist
--     or Unbroken needs the four handed in, Took the Shot can come from one,
--     and Triple Threat counts each at its hand-in.
--   * The team. The drawer lists the four as action items, and the trigger
--     editor offers them among the lessons with an action item. No built-in
--     CSM rule names them. For students who did nothing new, four readings
--     move:
--       - the alert mapping's "0 counted lessons" gate (alertTask, a
--         no_lessons_3d alert to a nolessons task) also lets through a
--         student whose only lessons are among the four, watched and not
--         handed in, as it already does for one who watched a3l17 alone; the
--         nolessons rule itself does not match them (they watched lessons),
--         so the cron's re-check dismisses such a task;
--       - a template condition on Video Ads II's completion, region_complete
--         or region_completion_pct on a4 (src/lib/csm-triggers.ts), reads the
--         four open until handed in: for a student with one of them watched
--         and not handed in, Video Ads II reads not complete and its share
--         lower, so such a template can match other students than before
--         (line e lists the live templates that have one);
--       - the activity word (activityLabel, src/lib/curriculum-reset.ts, on
--         Insights, the journey, All students and a student's page) reads
--         the student's last counted lesson (student_last_counted_completion),
--         which moves back to the last one before the four: moving can turn
--         slipping or stalled, and a student whose lessons since the switch
--         are only among the four reads not started;
--       - the area a student's page names ("In ...", and the draft's "you're
--         in ... now"), the furthest area with a done lesson, as
--         student_current_region has it, can move back to an earlier area,
--         or to the first.
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
--     run, or the course there is another one), or public.lessons_next is
--     there and one of the four is not in it.
--   * In either table, one of the four is not in Video Ads II (area a4).
--   * In either table, one of the four is not a watch lesson.
--   * In either table, one of the four holds a brief that is not v114's (an
--     action item with another brief, a plain video with one), or is an
--     action item with no brief: look at it before going on.
--   * Its own check after the change fails.
--
-- WHEN A TABLE IS BUSY
--   Another session holding public.lessons or public.lessons_next for more
--   than 5 seconds stops it with "Another session held public.lessons (or
--   public.lessons_next) for more than 5 seconds (...), so v114 did not
--   start. Nothing was changed. Paste it again in a minute." While it runs
--   (well under a second) the app's writes of lessons wait for it; its reads
--   do not.
--
-- UNDO: supabase/undo/2026_v114_undo.sql puts the four back to plain videos,
-- in each table only while it still holds v114's brief, and never touches a
-- student's row.
--
-- Re-runnable: a second paste finds the four as this file leaves them,
-- changes nothing, and says so.
-- ============================================================

-- ─────────────── 0. What the table at the end reads ───────────────
--
-- Outside the transaction, so a refusal does not roll it back. The SQL
-- editor stops at the first error and never reaches the table; run
-- statement by statement (psql), the table after a refusal says so instead
-- of repeating an earlier run's words.

select set_config('v114.changed', '', false), set_config('v114.changed_next', '', false),
       set_config('v114.next', '', false), set_config('v114.ran', 'no', false);

begin;

set local search_path = public;
set local lock_timeout = '5s';

-- ─────────────── 1. The locks ───────────────
--
-- Before anything is read. SHARE ROW EXCLUSIVE keeps every other writer out
-- and lets every reader in. The update below needs ROW EXCLUSIVE, which this
-- transaction then takes at once: no other session can hold a mode that
-- conflicts with it.

do $lock$
declare
  v_table text := 'public.lessons';
begin
  if to_regclass('public.lessons') is not null then
    lock table public.lessons in share row exclusive mode;
  end if;
  v_table := 'public.lessons_next';
  if to_regclass('public.lessons_next') is not null then
    lock table public.lessons_next in share row exclusive mode;
  end if;
exception when lock_not_available or deadlock_detected then
  raise exception 'Another session held % for more than 5 seconds (%), so v114 did not start. Nothing was changed. Paste it again in a minute.', v_table, sqlerrm
    using errcode = sqlstate;
end
$lock$;

-- ─────────────── 2 to 4. The four, in each table ───────────────

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
  -- The tables it writes: lessons, then lessons_next when it is there.
  v_tables  text[] := array['lessons'];
  v_table   text;
  v_found   text;
  v_before  bigint;
  v_after   bigint;
  v_changed text;
  v_n       int;
begin
  if to_regclass('public.lessons') is null then
    raise exception 'public.lessons is missing, so there is no catalog for v114 to change. Nothing was changed.';
  end if;
  if to_regclass('public.lessons_next') is not null then
    v_tables := v_tables || 'lessons_next'::text;
  end if;
  perform set_config('v114.next', case when 'lessons_next' = any (v_tables) then 'written' else 'missing' end, false);

  -- 2. The checks, on every table, before any changes.
  foreach v_table in array v_tables loop
    execute format($q$
      select string_agg(f.id, ', ' order by f.place)
        from unnest($1) with ordinality as f(id, place)
       where not exists (select 1 from public.%I l where l.id = f.id)
    $q$, v_table) into v_found using c_ids;
    if v_found is not null and v_table = 'lessons' then
      raise exception 'These lessons are not in public.lessons: %. Since the course switch (v104) the new course is there, so this database holds another course or the switch has not run. Nothing was changed.', v_found;
    elsif v_found is not null then
      raise exception 'These lessons are not in public.lessons_next, the staging copy the switch copied from: %. Look at it before going on. Nothing was changed.', v_found;
    end if;

    execute format($q$
      select string_agg(l.id || ' (in ' || coalesce(l.region_id, 'no area') || ')', ', ' order by f.place)
        from unnest($1) with ordinality as f(id, place)
        join public.%I l on l.id = f.id
       where l.region_id is distinct from 'a4'
    $q$, v_table) into v_found using c_ids;
    if v_found is not null then
      raise exception 'v114 is for Video Ads II (a4), and in public.% these lessons are not in it: %. Nothing was changed.', v_table, v_found;
    end if;

    execute format($q$
      select string_agg(l.id || ' (' || coalesce(l.type, 'no type') || ')', ', ' order by f.place)
        from unnest($1) with ordinality as f(id, place)
        join public.%I l on l.id = f.id
       where l.type is distinct from 'watch'
    $q$, v_table) into v_found using c_ids;
    if v_found is not null then
      raise exception 'v114 is for four watch lessons, and in public.% these are not watch lessons: %. Nothing was changed.', v_table, v_found;
    end if;

    -- A brief v114 would write over, or an action item with none: someone made it so by hand.
    execute format($q$
      select string_agg(l.id || ' (' || case when l.requires_action then 'an action item, ' else 'a plain video, ' end
                        || coalesce('"' || l.action_brief || '"', 'no brief') || ')', ', ' order by f.place)
        from unnest($1, $2) with ordinality as f(id, brief, place)
        join public.%I l on l.id = f.id
       where (l.requires_action or l.action_brief is not null)
         and l.action_brief is distinct from f.brief
    $q$, v_table) into v_found using c_ids, c_briefs;
    if v_found is not null then
      raise exception 'In public.% these lessons hold a brief that is not v114''s, or are action items with none: %. Look at them before going on. Nothing was changed.', v_table, v_found;
    end if;
  end loop;

  -- 3 and 4. The change, then its own check, on every table.
  foreach v_table in array v_tables loop
    execute format('select count(*) from public.%I where requires_action', v_table) into v_before;

    execute format($q$
      with changed as (
        update public.%I l
           set requires_action = true,
               action_brief    = f.brief
          from unnest($1, $2) as f(id, brief)
         where l.id = f.id
           and (l.requires_action is distinct from true or l.action_brief is distinct from f.brief)
        returning l.id
      )
      select string_agg(c.id, ',' order by c.id), count(*) from changed c
    $q$, v_table) into v_changed, v_n using c_ids, c_briefs;

    -- Its own check: the four as they must be, and no other lesson made or unmade an action item.
    execute format($q$
      select string_agg(f.id, ', ' order by f.place)
        from unnest($1, $2) with ordinality as f(id, brief, place)
        join public.%I l on l.id = f.id
       where not (l.requires_action and l.action_brief = f.brief and l.region_id = 'a4' and l.type = 'watch')
    $q$, v_table) into v_found using c_ids, c_briefs;
    if v_found is not null then
      raise exception 'After v114 these lessons of public.% are not action items with v114''s brief: %. Nothing was changed.', v_table, v_found;
    end if;
    execute format('select count(*) from public.%I where requires_action', v_table) into v_after;
    if v_after <> v_before + v_n then
      raise exception 'public.% had % action items, v114 made % of the four one, and it has %. Nothing was changed.', v_table, v_before, v_n, v_after;
    end if;

    perform set_config(case when v_table = 'lessons' then 'v114.changed' else 'v114.changed_next' end,
                       coalesce(v_changed, ''), false);
  end loop;

  perform set_config('v114.ran', 'yes', false);
end
$v114$;

commit;

-- ─────────────── What is there now ───────────────
--
-- One table: the first row says what this run did, in both tables, then one
-- row per lesson of public.lessons, in course order.

with s as (
  select current_setting('v114.ran', true)                         as ran,
         current_setting('v114.next', true)                        as next,
         nullif(current_setting('v114.changed', true), '')         as live,
         nullif(current_setting('v114.changed_next', true), '')    as staging
)
select lesson, title, action_item, brief, changed_now, v114
  from (
    select 0 as o, null::text as lesson, null::text as title, null::boolean as action_item, null::text as brief,
           null::boolean as changed_now,
           case
             when s.ran is distinct from 'yes'
               then 'v114 did not finish in this session. Nothing was changed.'
             when s.live is null and s.staging is null
               then 'v114 was already in place. This run changed nothing.'
             when s.live = s.staging
               then 'v114 ran now: ' || cardinality(string_to_array(s.live, ','))
                    || ' of the four made action items with a Discord link (' || replace(s.live, ',', ', ')
                    || '), in lessons and in lessons_next.'
             when s.next = 'missing'
               then 'v114 ran now: ' || cardinality(string_to_array(s.live, ','))
                    || ' of the four made action items with a Discord link (' || replace(s.live, ',', ', ')
                    || '). lessons_next is not in this database.'
             else 'v114 ran now: in lessons '
                  || coalesce(cardinality(string_to_array(s.live, ',')) || ' of the four made action items with a Discord link ('
                              || replace(s.live, ',', ', ') || ')', 'the four were action items already')
                  || ', in lessons_next '
                  || coalesce(cardinality(string_to_array(s.staging, ',')) || ' of the four ('
                              || replace(s.staging, ',', ', ') || ')', 'the four were action items already')
                  || '.'
           end as v114
      from s
    union all
    select l.sort_order, l.id, l.title, l.requires_action, l.action_brief,
           l.id = any (string_to_array(coalesce(s.live, ''), ',')), null
      from public.lessons l
     cross join s
     where l.id in ('a4l02', 'a4l03', 'a4l04', 'a4l05')
  ) x
 order by o;
-- EXPECT on production, first run: 5 rows. The first says "v114 ran now: 4
-- of the four made action items with a Discord link (a4l02, a4l03, a4l04,
-- a4l05), in lessons and in lessons_next.", then a4l02 Editing Breakdown -
-- UGC, a4l03 Editing Breakdown - Text on Screen Ad, a4l04 Editing Breakdown
-- - AI VO Ad and a4l05 Editing Breakdown - VSL Ad, each with action_item
-- true, its brief from the header and changed_now true. A second paste:
-- "v114 was already in place. This run changed nothing." and changed_now
-- false on all four. If the file stopped with a message ending "Nothing was
-- changed.", it is true: everything after the first select is one
-- transaction, and that select only empties this session's four settings.
-- A stop on "canceling statement due to lock timeout" (SQLSTATE 55P03) or
-- "deadlock detected" (40P01) is the same: nothing was changed. Paste it
-- again in a minute.
