-- ============================================================
-- UNDO for v114 (supabase/migrations/2026_v114_video_ads_ii_action_items.sql)
--
-- NOT A MIGRATION. A file in supabase/undo/ is never run in sequence with
-- supabase/migrations/. This one is run by hand, and only to take v114 back.
--
-- WHAT IT DOES
--   0. Before its transaction, empties the four settings its last table
--      reads, as v114 does.
--   Then, in one transaction:
--   1. Locks public.lessons, then public.lessons_next, in SHARE ROW EXCLUSIVE
--      mode, as v114 does, each lock waiting 5 seconds at most.
--   2. In public.lessons, and in public.lessons_next when it is there, puts
--      each of the four editing breakdowns of Video Ads II (a4l02, a4l03,
--      a4l04, a4l05) back to a plain video, requires_action false and no
--      brief, only while it still holds v114's brief there. A lesson whose
--      brief someone has changed since is left as it is, and so is a lesson
--      that is a plain video already or is missing; the table at the end
--      says which and why for public.lessons, and its first row what
--      happened in public.lessons_next.
--   3. Commits, and shows one table.
--
-- WHAT IT NEVER TOUCHES
--   A student's row. Every hand-in made on the four since v114 stays where it
--   is (student_lesson_completions.action_completed_at and
--   discord_message_link), and so does every watch row. Nothing reads those
--   hand-ins while the four are plain videos: a plain video is done with its
--   video alone. Paste v114 again and they count again.
--   Nor any other lesson, nor any other table.
--
-- WHAT CHANGES FOR STUDENTS
--   The four are plain videos again: no Milestone box and no Discord block on
--   their pages, and a lesson whose video is watched counts as done, so the
--   progress of everyone who watched one and did not hand it in goes back up.
--   What v114 closed by counting them open opens again with them: the
--   Playbook's 80% rule, a rating, the activity word, the area. No badge is
--   given or taken away.
--
-- WHEN IT REFUSES, changing nothing: public.lessons is missing ("Nothing was
-- changed.").
--
-- WHEN A TABLE IS BUSY
--   Another session holding public.lessons or public.lessons_next for more
--   than 5 seconds stops it with "Another session held public.lessons (or
--   public.lessons_next) for more than 5 seconds (...), so the v114 undo did
--   not start. Nothing was changed. Paste it again in a minute."
--
-- Safe to run again: with the four plain videos it changes nothing and says
-- so. v114 can run again after it.
-- ============================================================

-- Outside the transaction, so a refusal does not roll it back (v114's step 0).
select set_config('v114undo.back', '', false), set_config('v114undo.back_next', '', false),
       set_config('v114undo.next', '', false), set_config('v114undo.ran', 'no', false);

begin;

set local search_path = public;
set local lock_timeout = '5s';

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
  raise exception 'Another session held % for more than 5 seconds (%), so the v114 undo did not start. Nothing was changed. Paste it again in a minute.', v_table, sqlerrm
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
  v_tables text[] := array['lessons'];
  v_table  text;
  v_back   text;
  v_left   text;
begin
  if to_regclass('public.lessons') is null then
    raise exception 'public.lessons is missing, so there is nothing for the v114 undo to put back. Nothing was changed.';
  end if;
  if to_regclass('public.lessons_next') is not null then
    v_tables := v_tables || 'lessons_next'::text;
  end if;
  perform set_config('v114undo.next', case when 'lessons_next' = any (v_tables) then 'written' else 'missing' end, false);

  foreach v_table in array v_tables loop
    execute format($q$
      with back as (
        update public.%I l
           set requires_action = false,
               action_brief    = null
          from unnest($1, $2) as f(id, brief)
         where l.id = f.id
           and l.action_brief = f.brief
        returning l.id
      )
      select string_agg(b.id, ',' order by b.id) from back b
    $q$, v_table) into v_back using c_ids, c_briefs;

    -- Its own check: what it put back is a plain video now.
    execute format($q$
      select string_agg(l.id, ', ' order by l.id)
        from public.%I l
       where l.id = any (string_to_array($1, ','))
         and (l.requires_action or l.action_brief is not null)
    $q$, v_table) into v_left using coalesce(v_back, '');
    if v_left is not null then
      raise exception 'After the v114 undo these lessons of public.% are not plain videos: %. Nothing was changed.', v_table, v_left;
    end if;

    perform set_config(case when v_table = 'lessons' then 'v114undo.back' else 'v114undo.back_next' end,
                       coalesce(v_back, ''), false);
  end loop;

  perform set_config('v114undo.ran', 'yes', false);
end
$undo$;

commit;

-- ─────────────── What is there now ───────────────
--
-- The first row says what this run did, in both tables, then one row per
-- lesson of the four in public.lessons.

with s as (
  select current_setting('v114undo.ran', true)                       as ran,
         current_setting('v114undo.next', true)                      as next,
         nullif(current_setting('v114undo.back', true), '')          as live,
         nullif(current_setting('v114undo.back_next', true), '')     as staging
)
select lesson, title, action_item, brief, this_run, v114_undo
  from (
    select 0 as o, null::text as lesson, null::text as title, null::boolean as action_item, null::text as brief,
           null::text as this_run,
           case
             when s.ran is distinct from 'yes'
               then 'The v114 undo did not finish in this session. Nothing was changed.'
             when s.live is null and s.staging is null
               then 'Nothing to put back: none of the four holds v114''s brief. This run changed nothing.'
             when s.live = s.staging
               then 'The v114 undo ran now: ' || cardinality(string_to_array(s.live, ','))
                    || ' of the four are plain videos again (' || replace(s.live, ',', ', ')
                    || '), in lessons and in lessons_next. No student''s row was touched.'
             when s.next = 'missing'
               then 'The v114 undo ran now: ' || cardinality(string_to_array(s.live, ','))
                    || ' of the four are plain videos again (' || replace(s.live, ',', ', ')
                    || '). lessons_next is not in this database. No student''s row was touched.'
             else 'The v114 undo ran now: in lessons '
                  || coalesce(cardinality(string_to_array(s.live, ',')) || ' of the four are plain videos again ('
                              || replace(s.live, ',', ', ') || ')', 'none of the four held v114''s brief')
                  || ', in lessons_next '
                  || coalesce(cardinality(string_to_array(s.staging, ',')) || ' of the four ('
                              || replace(s.staging, ',', ', ') || ')', 'none of the four held it')
                  || '. No student''s row was touched.'
           end as v114_undo
      from s
    union all
    select coalesce(l.sort_order, 1000000 + f.place::int), f.id, l.title, l.requires_action, l.action_brief,
           case
             when l.id is null then 'missing: left as it is'
             when l.id = any (string_to_array(coalesce(s.live, ''), ',')) then 'put back to a plain video'
             when not l.requires_action and l.action_brief is null then 'a plain video already'
             else 'left as it is: its brief is not v114''s'
           end,
           null
      from unnest(array['a4l02', 'a4l03', 'a4l04', 'a4l05']) with ordinality as f(id, place)
      left join public.lessons l on l.id = f.id
     cross join s
  ) x
 order by o;
-- EXPECT right after v114: 5 rows. The first says "The v114 undo ran now: 4
-- of the four are plain videos again (a4l02, a4l03, a4l04, a4l05), in lessons
-- and in lessons_next. No student's row was touched.", then the four, each
-- with action_item false, no brief and "put back to a plain video". A second
-- paste: "Nothing to put back: none of the four holds v114's brief. This run
-- changed nothing." and "a plain video already" on each. A lesson whose
-- brief was changed by hand after v114 reads "left as it is: its brief is
-- not v114's" and keeps it. If the file stopped with a message ending
-- "Nothing was changed.", it is true: everything after the first select is
-- one transaction, and that select only empties this session's four
-- settings. A stop on "canceling statement due to lock timeout" (SQLSTATE
-- 55P03) or "deadlock detected" (40P01) is the same: nothing was changed.
-- Paste it again in a minute.
