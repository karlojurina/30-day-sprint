-- ============================================================
-- Put the written instructions of the course's action items on their
-- lessons: description, for every lesson in the list.
--
-- THIS FILE IS A TEMPLATE. It holds no text and it must never hold one here:
-- the repository is public and the texts carry the links to the course's
-- assets (briefs, templates, channels). The lesson text tool
-- (clients/ecom-university/tools/lesson-text/, outside this repository) reads
-- the texts from the course builder on Whop and writes a filled copy into its
-- own bulk_ops folder. That copy is the file to paste into the SQL editor.
-- Never save a filled copy inside the repository.
--
-- THE ONE LINE THAT CHANGES
--   Under "insert into _text values" stands one placeholder line. The tool
--   puts the rows in its place, one per lesson, the last one closed with a
--   semicolon:
--     ('a5l22', 'Action Item - Brand Deck', '<the text>'),
--     ('a5l23', 'Action Item - Static Ad Brief', '<the text>');
--   That is: the lesson id, the lesson's title as the catalog has it, the
--   text. Every single quote inside a title or a text is written twice. A
--   text may run over several lines.
--
-- THE TEXT FORMAT (what the lesson page reads)
--   Plain text with \n line ends, at most 8000 characters. Blocks are
--   separated by exactly one blank line. A block whose every line starts
--   with "- " is a bullet list, one item per line. A block whose every line
--   starts with a number, a dot and a space ("1. ") is a numbered list. Any
--   other block is a paragraph, and a single line end inside it is a line
--   break. Inline: **bold**, and a link written [label](https://...); only an
--   address that starts with https:// is written as a link. Nothing else: no
--   HTML, no headings, no italics.
--
-- WHY THE TITLE IS IN THE LIST
--   A lesson id is a place in the course. When the course changes, the same
--   id can come to name another lesson. The title ties each row to the lesson
--   the text was read for: the file refuses when the catalog has another
--   title under that id, and a text cannot land on the wrong lesson.
--
-- WHAT IT DOES
--   The list is the whole truth about the course's texts. After this file
--   the description of every course lesson says exactly what the list says.
--   Every change happens in one transaction, so the file either finishes or
--   changes nothing.
--   1. Checks the list. See WHEN IT REFUSES.
--   2. Sets description to the text on every lesson in the list, in
--      lessons_next and in lessons where the lesson is there too. A lesson
--      that already holds the same text is not touched at all.
--   3. Empties description on every course lesson that is not in the list,
--      in both tables. A text taken out of the list disappears from its
--      lesson.
--   4. Ends with a table: what this run did (listed, changed, emptied), then
--      one row per area of the staging catalog (lessons, with_text). It shows
--      numbers only, never a text.
--
-- WHAT COUNTS AS A COURSE LESSON
--   An id shaped like a3l07: a, the area 1 to 8, l, two digits. A lesson on
--   any other id, such as the live lesson l004, is never written: its
--   description stays as it is.
--
-- WHEN IT REFUSES, changing nothing
--   * the placeholder line is still there;
--   * lessons_next still holds v94's placeholder lessons (migration
--     2026_v101 has not run). A placeholder has the same id as a real
--     lesson, so a text would land on "Fundamentals · lesson 3";
--   * a lesson id in the list is not a course lesson id;
--   * a lesson is in the list twice;
--   * a text is empty, or longer than 8000 characters;
--   * a lesson in the list is in neither catalog;
--   * a title in the list is not the title the catalog has for that lesson:
--     lessons_next when the lesson is there, lessons when it is only there.
--     The list was made for another version of the course.
--   No message repeats a text or a title. Four of them say WHICH lessons, by
--   id: a lesson twice, a text that is empty or too long, a lesson in neither
--   catalog, a lesson with another title. They name only ids shaped like
--   course lesson ids, at most 10 of them, then "and N more". Anything else
--   found in the lesson column is counted and never repeated.
--
-- SAFE TO RUN AGAIN. With the same list a second run changes nothing: no
-- description and no updated_at.
--
-- IT DOES NOT TOUCH duration_seconds, action_brief, lesson_videos or anything
-- else: the description column of the course's lessons, and nothing more.
--
-- AFTER v101 RUNS AGAIN the texts are gone: v101 writes description = null on
-- every lesson of the course. Paste the newest filled copy of this file again.
--
-- Needs migration 2026_v101_course_catalog.sql to have run.
-- ============================================================

begin;

create temp table _text (lesson_id text, title text, body text) on commit drop;

-- ▼▼▼ THE ROWS GO HERE, IN PLACE OF THE ONE LINE UNDER "values" ▼▼▼
insert into _text values
  ('REPLACE_WITH_ROWS', 'REPLACE_WITH_ROWS', 'REPLACE_WITH_ROWS');
-- ▲▲▲ nothing below this line changes ▲▲▲

do $text$
declare
  c_course constant text := '^a[1-8]l[0-9]{2}$';
  c_most   constant int  := 8000;

  v_n       bigint;
  v_ids     text[];
  v_which   text;
  v_listed  bigint;
  v_changed bigint;
  v_emptied bigint;
begin
  -- ─────────────── The list is checked before anything is written ───────────────
  -- A message never repeats a text, a title, or a lesson id of the wrong
  -- shape. See the header.

  if exists (select 1 from _text n
              where n.lesson_id ~ 'REPLACE_WITH' or n.title ~ 'REPLACE_WITH' or n.body ~ 'REPLACE_WITH') then
    raise exception 'The placeholder line was not replaced with the rows. This file is the template: the file to run is the filled copy the lesson text tool writes. Nothing was changed.';
  end if;

  if exists (select 1 from public.lessons_next l where l.title like '% · lesson %') then
    raise exception 'The course catalog is still the placeholder one: public.lessons_next holds lessons titled like the seed of v94. Run migration 2026_v101_course_catalog.sql first. Nothing was changed.';
  end if;

  select count(*) into v_n from _text n
   where n.lesson_id is null or n.lesson_id !~ c_course;
  if v_n > 0 then
    raise exception '% row(s) of the list have a lesson id that is not a course lesson id. A course lesson id is a, the area 1 to 8, l and two digits, as in a3l07. Nothing was changed.', v_n;
  end if;

  -- From here on every lesson id of the list has the shape of a course
  -- lesson id, so a message may say which lessons it means. The filter on
  -- c_course is kept all the same: what does not match is never named.
  select count(*), array_agg(twice.lesson_id order by twice.lesson_id) filter (where twice.lesson_id ~ c_course)
    into v_n, v_ids
    from (select n.lesson_id from _text n group by n.lesson_id having count(*) > 1) twice;
  if v_n > 0 then
    v_which := coalesce(array_to_string(v_ids[1:10], ', '), 'none that can be named')
               || case when cardinality(v_ids) > 10 then ' and ' || (cardinality(v_ids) - 10) || ' more' else '' end;
    raise exception '% lesson(s) are in the list more than once: %. A lesson has one text. Nothing was changed.', v_n, v_which;
  end if;

  select count(*), array_agg(n.lesson_id order by n.lesson_id) filter (where n.lesson_id ~ c_course)
    into v_n, v_ids
    from _text n
   where n.body is null or n.body !~ '[^[:space:]]';
  if v_n > 0 then
    v_which := coalesce(array_to_string(v_ids[1:10], ', '), 'none that can be named')
               || case when cardinality(v_ids) > 10 then ' and ' || (cardinality(v_ids) - 10) || ' more' else '' end;
    raise exception '% lesson(s) of the list have an empty text: %. A lesson without a text is left out of the list. Nothing was changed.', v_n, v_which;
  end if;

  select count(*), array_agg(n.lesson_id order by n.lesson_id) filter (where n.lesson_id ~ c_course)
    into v_n, v_ids
    from _text n
   where char_length(n.body) > c_most;
  if v_n > 0 then
    v_which := coalesce(array_to_string(v_ids[1:10], ', '), 'none that can be named')
               || case when cardinality(v_ids) > 10 then ' and ' || (cardinality(v_ids) - 10) || ' more' else '' end;
    raise exception '% lesson(s) of the list have a text longer than 8000 characters: %. Nothing was changed.', v_n, v_which;
  end if;

  select count(*), array_agg(n.lesson_id order by n.lesson_id) filter (where n.lesson_id ~ c_course)
    into v_n, v_ids
    from _text n
   where not exists (select 1 from public.lessons_next l where l.id = n.lesson_id)
     and not exists (select 1 from public.lessons l where l.id = n.lesson_id);
  if v_n > 0 then
    v_which := coalesce(array_to_string(v_ids[1:10], ', '), 'none that can be named')
               || case when cardinality(v_ids) > 10 then ' and ' || (cardinality(v_ids) - 10) || ' more' else '' end;
    raise exception '% lesson(s) of the list are in neither public.lessons_next nor public.lessons: %. The list was written from another catalog than the one this database holds. Run migration 2026_v101_course_catalog.sql, or have the tool write the list again. Nothing was changed.', v_n, v_which;
  end if;

  -- Every row carries the title its text was read for. The catalog's title
  -- is the one in lessons_next when the lesson is there, and the one in
  -- lessons when it is only there. Another title under the same id means the
  -- course has changed since the list was made.
  select count(*), array_agg(n.lesson_id order by n.lesson_id) filter (where n.lesson_id ~ c_course)
    into v_n, v_ids
    from _text n
   where n.title is distinct from coalesce(
           (select l.title from public.lessons_next l where l.id = n.lesson_id),
           (select l.title from public.lessons l where l.id = n.lesson_id));
  if v_n > 0 then
    v_which := coalesce(array_to_string(v_ids[1:10], ', '), 'none that can be named')
               || case when cardinality(v_ids) > 10 then ' and ' || (cardinality(v_ids) - 10) || ' more' else '' end;
    raise exception '% lesson(s) of the list carry another title than the catalog has under that id: %. This list was made for another version of the course. Run the read and the sql command of the lesson text tool again, and paste the file it writes. Nothing was changed.', v_n, v_which;
  end if;

  -- ─────────────── What this run is about to do, counted before it does it ───────────────

  select count(*) into v_listed from _text;

  -- A lesson counts once, whether its text changes in one table or in both.
  select count(*) into v_changed
    from _text n
   where exists (select 1 from public.lessons_next l where l.id = n.lesson_id and l.description is distinct from n.body)
      or exists (select 1 from public.lessons l where l.id = n.lesson_id and l.description is distinct from n.body);

  select count(*) into v_emptied
    from (select l.id from public.lessons_next l
           where l.id ~ c_course and l.description is not null
             and not exists (select 1 from _text n where n.lesson_id = l.id)
          union
          select l.id from public.lessons l
           where l.id ~ c_course and l.description is not null
             and not exists (select 1 from _text n where n.lesson_id = l.id)) gone;

  -- ─────────────── The write, over course lessons only ───────────────

  -- The texts of the list. The WHERE leaves a lesson alone when it already
  -- holds the same text, so its updated_at stays as it is.
  update public.lessons_next l
     set description = n.body
    from _text n
   where l.id = n.lesson_id
     and l.id ~ c_course
     and l.description is distinct from n.body;

  update public.lessons l
     set description = n.body
    from _text n
   where l.id = n.lesson_id
     and l.id ~ c_course
     and l.description is distinct from n.body;

  -- A course lesson that is not in the list has no text.
  update public.lessons_next l
     set description = null
   where l.id ~ c_course
     and l.description is not null
     and not exists (select 1 from _text n where n.lesson_id = l.id);

  update public.lessons l
     set description = null
   where l.id ~ c_course
     and l.description is not null
     and not exists (select 1 from _text n where n.lesson_id = l.id);

  -- Hand the three numbers to the select below. _text is gone after the
  -- commit, and the numbers hold no text.
  perform set_config('lesson_text.did', v_listed || ',' || v_changed || ',' || v_emptied, false);
  perform set_config('lesson_text.at', clock_timestamp()::text, false);
end
$text$;

commit;

-- What it did. This is the table the SQL editor shows.
with did as (
  -- The three numbers of this run. They are read only when a block like the
  -- one above set them on this connection in the last five minutes. Pasted
  -- and run in one go, that block is this run's, and the numbers are its own.
  -- Sent statement by statement on a session that is used again, the select
  -- can show the numbers of an earlier run that is less than five minutes
  -- old. with_text is counted from the table either way.
  select string_to_array(current_setting('lesson_text.did', true), ',') as n
   where coalesce(nullif(current_setting('lesson_text.at', true), ''), '2000-01-01')::timestamptz
         > clock_timestamp() - interval '5 minutes'
),
areas as (
  select r.order_num                                                as place,
         r.id                                                       as line,
         r.name                                                     as name,
         count(l.id)::int                                           as lessons,
         count(l.id) filter (where l.description is not null)::int as with_text
    from public.regions_next r
    left join public.lessons_next l on l.region_id = r.id
   group by r.order_num, r.id, r.name
)
select t.line, t.name, t.listed, t.changed, t.emptied, t.lessons, t.with_text
  from (
    select 0 as place, 'this run' as line, 'the whole course' as name,
           (select d.n[1]::int from did d) as listed,
           (select d.n[2]::int from did d) as changed,
           (select d.n[3]::int from did d) as emptied,
           sum(a.lessons)::int             as lessons,
           sum(a.with_text)::int           as with_text
      from areas a
    union all
    select a.place, a.line, a.name, null, null, null,
           a.lessons, a.with_text
      from areas a
  ) t
 order by t.place;
-- EXPECT: 9 rows. On the first row, listed is the number of rows in the list
-- and with_text equals it. A second run of the same file shows changed 0 and
-- emptied 0.
--
-- If the file ran without an error and the first row shows no numbers under
-- listed, the block and this select did not share a session. The texts were
-- still written: with_text says so, and it is always read from the table.
