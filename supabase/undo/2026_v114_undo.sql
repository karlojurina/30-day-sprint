-- ============================================================
-- UNDO for v114 (supabase/migrations/2026_v114_video_ads_ii_action_items.sql)
--
-- NOT A MIGRATION. A file in supabase/undo/ is never run in sequence with
-- supabase/migrations/. This one is run by hand, and only to take v114 back.
--
-- WHAT IT DOES, in one transaction
--   1. Locks public.lessons in SHARE ROW EXCLUSIVE mode, as v114 does,
--      waiting 5 seconds at most.
--   2. Puts each of the four editing breakdowns of Video Ads II (a4l02,
--      a4l03, a4l04, a4l05) back to a plain video, requires_action false and
--      no brief, only while it still holds v114's brief. A lesson whose brief
--      someone has changed since is left as it is, and so is a lesson that is
--      a plain video already or is missing; the table at the end says which
--      and why.
--   3. Commits, and shows one table.
--
-- WHAT IT NEVER TOUCHES
--   A student's row. Every hand-in made on the four since v114 stays where it
--   is (student_lesson_completions.action_completed_at and
--   discord_message_link), and so does every watch row. Nothing reads those
--   hand-ins while the four are plain videos: a plain video is done with its
--   video alone. Paste v114 again and they count again.
--   Nor any other lesson, nor lessons_next.
--
-- WHAT CHANGES FOR STUDENTS
--   The four are plain videos again: no Milestone box and no Discord block on
--   their pages, and a lesson whose video is watched counts as done, so the
--   progress of everyone who watched one and did not hand it in goes back up.
--   No badge is given or taken away.
--
-- WHEN IT REFUSES, changing nothing: public.lessons is missing ("Nothing was
-- changed.").
--
-- WHEN THE TABLE IS BUSY
--   Another session holding public.lessons for more than 5 seconds stops it
--   with "Another session held public.lessons for more than 5 seconds (...),
--   so the v114 undo did not start. Nothing was changed. Paste it again in a
--   minute."
--
-- Safe to run again: with the four plain videos it changes nothing and says
-- so. v114 can run again after it.
-- ============================================================

begin;

set local search_path = public;
set local lock_timeout = '5s';

do $lock$
begin
  perform set_config('v114undo.back', '', false);
  perform set_config('v114undo.ran', 'no', false);
  if to_regclass('public.lessons') is not null then
    lock table public.lessons in share row exclusive mode;
  end if;
exception when lock_not_available or deadlock_detected then
  raise exception 'Another session held public.lessons for more than 5 seconds (%), so the v114 undo did not start. Nothing was changed. Paste it again in a minute.', sqlerrm
    using errcode = sqlstate;
end
$lock$;

do $undo$
declare
  -- v114's four and their briefs, as v114 writes them.
  c_ids    constant text[] := array['a4l02', 'a4l03', 'a4l04', 'a4l05'];
  c_briefs constant text[] := array[
    'Edit the UGC ad yourself from the brief in the lesson, then post it for the coaches'' review.',
    'Edit the text on screen ad yourself from the brief in the lesson, then post it for the coaches'' review.',
    'Edit the AI voiceover ad yourself from the brief in the lesson, then post it for the coaches'' review.',
    'Edit the VSL ad yourself from the brief and the assets in the lesson, then post it for the coaches'' review.'
  ];
  v_back text;
  v_left text;
begin
  if to_regclass('public.lessons') is null then
    raise exception 'public.lessons is missing, so there is nothing for the v114 undo to put back. Nothing was changed.';
  end if;

  with back as (
    update public.lessons l
       set requires_action = false,
           action_brief    = null
      from unnest(c_ids, c_briefs) as f(id, brief)
     where l.id = f.id
       and l.action_brief = f.brief
    returning l.id
  )
  select string_agg(b.id, ',' order by b.id) into v_back from back b;

  -- Its own check: what it put back is a plain video now.
  select string_agg(l.id, ', ' order by l.id) into v_left
    from public.lessons l
   where l.id = any (string_to_array(coalesce(v_back, ''), ','))
     and (l.requires_action or l.action_brief is not null);
  if v_left is not null then
    raise exception 'After the v114 undo these lessons are not plain videos: %. Nothing was changed.', v_left;
  end if;

  perform set_config('v114undo.back', coalesce(v_back, ''), false);
  perform set_config('v114undo.ran', 'yes', false);
end
$undo$;

commit;

-- ─────────────── What is there now ───────────────
--
-- The first row says what this run did, then one row per lesson of the four.

select lesson, title, action_item, brief, this_run, v114_undo
  from (
    select 0 as o, null::text as lesson, null::text as title, null::boolean as action_item, null::text as brief,
           null::text as this_run,
           case
             when current_setting('v114undo.ran', true) is distinct from 'yes'
               then 'The v114 undo did not finish in this session. Nothing was changed.'
             when current_setting('v114undo.back', true) <> ''
               then 'The v114 undo ran now: ' || array_length(string_to_array(current_setting('v114undo.back', true), ','), 1)
                    || ' of the four are plain videos again ('
                    || replace(current_setting('v114undo.back', true), ',', ', ') || '). No student''s row was touched.'
             else 'Nothing to put back: none of the four holds v114''s brief. This run changed nothing.'
           end as v114_undo
    union all
    select coalesce(l.sort_order, 1000000 + f.place::int), f.id, l.title, l.requires_action, l.action_brief,
           case
             when l.id is null then 'missing: left as it is'
             when l.id = any (string_to_array(current_setting('v114undo.back', true), ',')) then 'put back to a plain video'
             when not l.requires_action and l.action_brief is null then 'a plain video already'
             else 'left as it is: its brief is not v114''s'
           end,
           null
      from unnest(array['a4l02', 'a4l03', 'a4l04', 'a4l05']) with ordinality as f(id, place)
      left join public.lessons l on l.id = f.id
  ) x
 order by o;
-- EXPECT right after v114: 5 rows. The first says "The v114 undo ran now: 4
-- of the four are plain videos again (a4l02, a4l03, a4l04, a4l05). No
-- student's row was touched.", then the four, each with action_item false, no
-- brief and "put back to a plain video". A second paste: "Nothing to put
-- back: none of the four holds v114's brief. This run changed nothing." and
-- "a plain video already" on each. A lesson whose brief was changed by hand
-- after v114 reads "left as it is: its brief is not v114's" and keeps it. If
-- the file stopped with a message ending "Nothing was changed.", it is true:
-- the whole file is one transaction. A stop on "canceling statement due to
-- lock timeout" (SQLSTATE 55P03) or "deadlock detected" (40P01) is the same:
-- nothing was changed. Paste it again in a minute.
