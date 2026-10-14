#!/usr/bin/env node
// Writes the course catalog's two SQL files from course_catalog.json.
//
//   supabase/migrations/2026_v101_course_catalog.sql   the migration
//   supabase/undo/2026_v101_undo.sql                   its undo
//
// The course lives in ONE place, course_catalog.json beside this file. Three
// things read it: this script, the development page and the Tella tool. The
// two SQL files are never edited by hand. Change the data file and run this.
//
//   npm run build:catalog              write both files
//   npm run build:catalog -- --check   write nothing; exit 1 when a file on
//                                      disk differs from what would be written
//   --catalog <path>                   read another data file (the migration
//                                      tests use this on temporary copies)
//
// Exit codes: 0 done, 1 --check found a difference, 2 the data file was
// refused or the script could not run. A refused data file writes nothing.
//
// What makes a data file refused: anything but the 8 areas a1 to a8 in order;
// a lesson id used twice or not shaped like a3l07; an id that does not start
// with its area; an area whose lessons do not sit in one block, or blocks
// that are not in the order a1 to a8; a type other than watch or setup; a
// title that is empty, untrimmed or over 120 characters; no gate or more
// than one; two lessons of one area outside the lesson count; a feature key
// on two lessons; a brief with a link in it (http, www., or a bare domain
// such as discord.gg/x); a lesson without its Whop lesson id, an id not shaped
// like lesn_ and letters or digits, or one Whop lesson id on two lessons.
//
// The undo's seed statements are copied out of v94's own file. Nothing in
// them is typed here, so the undo cannot drift from what v94 really seeds.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..', '..')
const rel = p => path.relative(ROOT, p)

const CATALOG   = path.join(HERE, 'course_catalog.json')
const V94       = path.join(HERE, '..', 'migrations', '2026_v94_catalog_next_staging.sql')
const MIGRATION = path.join(HERE, '..', 'migrations', '2026_v101_course_catalog.sql')
const UNDO      = path.join(HERE, '..', 'undo', '2026_v101_undo.sql')

const AREAS = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8']
const LESSON_ID = /^a[1-8]l[0-9]{2}$/
// The same pattern as text, for the SQL this script writes.
const LESSON_ID_SQL = '^a[1-8]l[0-9]{2}$'
const TITLE_MAX = 120
// The id of the same lesson in the Whop course. The Whop sync and the webhook
// find a lesson by it (lessons.whop_lesson_id), so it is catalog-owned, like
// the title. A Whop lesson id is not a secret; a Whop course id never goes in
// the data file.
const WHOP_LESSON_ID = /^lesn_[A-Za-z0-9]+$/
// A link in a brief: http, www., or a bare domain, which is a word, a dot and
// one of these endings with nothing joined on after it (discord.gg/x).
const LINK = /http|www\.|\w\.(?:com|gg|io|net|org|app|co|tv)\b/i
// How far step 4 of the migration moves every sort_order out of the way.
const PARKED = 100000

const stop = (code, lines) => {
  for (const l of [].concat(lines)) console.error(l)
  process.exit(code)
}

// ─────────────── arguments ───────────────

const args = process.argv.slice(2)
let check = false
let catalogPath = CATALOG
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--check') check = true
  else if (args[i] === '--catalog' && args[i + 1]) catalogPath = path.resolve(args[++i])
  else stop(2, `Unknown argument ${JSON.stringify(args[i])}. Use --check, or --catalog <path>.`)
}

// ─────────────── the data file, checked before anything is written ───────────────

// Returns one sentence per thing that is wrong. An empty list means the file
// can be turned into SQL.
function problems(c) {
  const out = []
  const isText = v => typeof v === 'string'
  const list = ids => ids.join(', ')

  if (!c || typeof c !== 'object' || !Array.isArray(c.areas) || !Array.isArray(c.lessons)) {
    return ['The data file must be an object with an "areas" list and a "lessons" list.']
  }

  const areaIds = c.areas.map(a => a?.id)
  if (JSON.stringify(areaIds) !== JSON.stringify(AREAS)) {
    out.push(`The data file must list exactly 8 areas, a1 to a8, in that order. It lists ${areaIds.length}: ${list(areaIds.map(String)) || 'none'}.`)
  }
  for (const a of c.areas) {
    if (!isText(a?.name) || a.name.trim() === '' || a.name !== a.name.trim()) {
      out.push(`Area ${a?.id} needs a name with no space at its start or end.`)
    }
  }

  const seen = new Map()
  c.lessons.forEach((l, i) => {
    const where = `Lesson ${i + 1} in the list`
    if (!l || typeof l !== 'object') { out.push(`${where} is not an object.`); return }
    const id = l.id

    if (!isText(id) || !LESSON_ID.test(id)) {
      out.push(`${where} has the id ${JSON.stringify(id)}. A lesson id is a, the area 1 to 8, l, and two digits, as in a3l07.`)
    } else {
      seen.set(id, (seen.get(id) ?? 0) + 1)
      if (isText(l.area) && !id.startsWith(l.area + 'l')) {
        out.push(`Lesson ${id} is listed under area ${l.area}. A lesson's id starts with its area.`)
      }
    }
    if (!AREAS.includes(l.area)) {
      out.push(`${where} (${id}) is in area ${JSON.stringify(l.area)}, which is not one of a1 to a8.`)
    }

    if (l.type !== 'watch' && l.type !== 'setup') {
      out.push(`Lesson ${id} has the type ${JSON.stringify(l.type)}. The type is watch or setup.`)
    }

    if (!isText(l.title) || l.title.trim() === '') out.push(`Lesson ${id} has no title.`)
    else if (l.title !== l.title.trim()) out.push(`The title of lesson ${id} has a space at its start or end.`)
    else if (l.title.length > TITLE_MAX) out.push(`The title of lesson ${id} is ${l.title.length} characters long. The most is ${TITLE_MAX}.`)

    if (l.action_brief !== undefined) {
      if (!isText(l.action_brief) || l.action_brief.trim() === '') out.push(`The brief of lesson ${id} is empty. Leave the brief out when the lesson is not an action item.`)
      else if (LINK.test(l.action_brief)) out.push(`The brief of lesson ${id} holds a link. A brief is plain text with no link in it.`)
    }
    if (l.feature_key !== undefined && (!isText(l.feature_key) || l.feature_key.trim() === '')) {
      out.push(`The feature key of lesson ${id} is empty. Leave it out when the lesson has none.`)
    }
    if (l.whop_lesson_id === undefined) out.push(`Lesson ${id} has no whop_lesson_id. Every lesson carries the id of the same lesson in the Whop course.`)
    else if (!isText(l.whop_lesson_id) || !WHOP_LESSON_ID.test(l.whop_lesson_id)) {
      out.push(`Lesson ${id} has the whop_lesson_id ${JSON.stringify(l.whop_lesson_id)}. A Whop lesson id is lesn_ and then letters or digits.`)
    }
  })

  for (const [id, n] of seen) {
    if (n > 1) out.push(`Lesson id ${id} is used ${n} times. Every lesson needs an id of its own.`)
  }

  // One block per area. Array order is the course's order, so a lesson that
  // sits among another area's lessons would get a sort_order inside that area.
  for (const area of AREAS) {
    const at = c.lessons.flatMap((l, i) => l?.area === area ? [i] : [])
    if (!at.length) continue
    const between = c.lessons.slice(at[0], at.at(-1) + 1).filter(l => l?.area !== area).map(l => String(l?.id))
    if (between.length) {
      out.push(`The lessons of area ${area} do not sit in one block: ${list(between)} ${between.length === 1 ? 'sits' : 'sit'} between them. A lesson outside its area's block would be ordered inside another area.`)
    }
  }

  // The blocks come in the order a1 to a8. The order of the list becomes
  // sort_order, and the app orders the areas by order_num, so a block out of
  // place would run sort_order against order_num.
  const blocks = [...new Set(c.lessons.map(l => l?.area).filter(a => AREAS.includes(a)))]
  if (JSON.stringify(blocks) !== JSON.stringify(AREAS.filter(a => blocks.includes(a)))) {
    out.push(`The blocks of the areas must come in the order a1 to a8. In the list they come as ${list(blocks)}. The order of the list is the order of the course.`)
  }

  const gates = c.lessons.filter(l => l?.gate === true).map(l => l.id)
  if (gates.length !== 1) {
    out.push(`The data file must mark exactly one lesson as the gate. It marks ${gates.length}${gates.length ? ': ' + list(gates) : ''}.`)
  }

  for (const area of AREAS) {
    const outside = c.lessons.filter(l => l?.area === area && l.counts === false).map(l => l.id)
    if (outside.length > 1) {
      out.push(`Area ${area} has ${outside.length} lessons outside the lesson count (${list(outside)}). An area can have one at most.`)
    }
  }

  const byKey = new Map()
  for (const l of c.lessons) {
    if (isText(l?.feature_key)) byKey.set(l.feature_key, [...(byKey.get(l.feature_key) ?? []), l.id])
  }
  for (const [key, ids] of byKey) {
    if (ids.length > 1) out.push(`The feature key ${JSON.stringify(key)} is on ${ids.length} lessons (${list(ids)}). A feature key belongs to one lesson.`)
  }

  const byWhop = new Map()
  for (const l of c.lessons) {
    if (isText(l?.whop_lesson_id)) byWhop.set(l.whop_lesson_id, [...(byWhop.get(l.whop_lesson_id) ?? []), l.id])
  }
  for (const [whop, ids] of byWhop) {
    if (ids.length > 1) out.push(`The whop_lesson_id ${whop} is on ${ids.length} lessons (${list(ids)}). A Whop lesson belongs to one lesson.`)
  }

  return out
}

let catalog
try { catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8')) }
catch (e) { stop(2, `Could not read the data file ${catalogPath}: ${e.message}`) }

const wrong = problems(catalog)
if (wrong.length) {
  stop(2, [`The data file was refused. Nothing was written. ${wrong.length} thing(s) to fix in ${catalogPath}:`,
           ...wrong.map(w => '  - ' + w)])
}

// ─────────────── the rows ───────────────

// A SQL string: every single quote doubled. Titles hold apostrophes, $$$, &,
// +, brackets and double quotes, and all of those are plain text inside a
// quoted SQL string.
const sq = s => "'" + String(s).replaceAll("'", "''") + "'"
const orNull = s => s === undefined ? 'null' : sq(s)
// Text from the data file that goes into a SQL comment: on one line.
const oneLine = s => String(s ?? '').replace(/\s+/g, ' ').trim()

const rows = catalog.lessons.map((l, i) => ({
  id: l.id,
  region_id: l.area,
  type: l.type,
  title: l.title,
  sort_order: i + 1,
  requires_action: l.action_brief !== undefined,
  action_brief: l.action_brief,
  is_gate: l.gate === true,
  counts_toward_progress: l.counts !== false,
  feature_key: l.feature_key,
  whop_lesson_id: l.whop_lesson_id,
}))

const total      = rows.length
const counting   = rows.filter(r => r.counts_toward_progress).length
const actions    = rows.filter(r => r.requires_action).length
const setups     = rows.filter(r => r.type === 'setup').length
const gate       = rows.find(r => r.is_gate).id
const perArea    = AREAS.map(a => rows.filter(r => r.region_id === a))
const sizes      = perArea.map(a => a.length).join(', ')
// The rows that are special: a feature key, or outside the lesson count.
const special    = rows.filter(r => r.feature_key !== undefined || !r.counts_toward_progress)
const specialSql = r => `${r.id}:${r.feature_key ?? 'no key'}:${r.counts_toward_progress ? 'counting' : 'outside the count'}`
const specials   = special.map(specialSql).join(', ') || 'none'
// The same rows in words, for the header.
const specialsSaid = special.map(r => oneLine(`${r.id}, ${r.feature_key === undefined ? 'no feature key' : `feature key ${r.feature_key}`}, ${r.counts_toward_progress ? 'counting' : 'outside the lesson count'}`)).join('; ') || 'none'

// A dollar-quote tag that no text in the file can close early.
const everyText = rows.map(r => `${r.title} ${r.action_brief ?? ''} ${r.feature_key ?? ''}`).join(' ')
                + catalog.areas.map(a => a.name).join(' ')
const tag = base => {
  let t = base
  for (let n = 2; everyText.includes(`$${t}$`); n++) t = base + n
  return `$${t}$`
}
const GUARD = tag('guard')
const CHECK = tag('check')

// ─────────────── v94's seed statements, copied for the undo ───────────────

const v94 = fs.readFileSync(V94, 'utf8')

// One statement out of v94's file: from the line(s) it starts with through
// its semicolon. The start must be found exactly once, at the start of a
// line. The semicolon must be in code: one inside a `--` comment does not
// end the statement.
function copied(firstLines) {
  const marker = '\n' + firstLines
  if (v94.split(marker).length !== 2) {
    stop(2, `Could not copy a seed statement out of ${rel(V94)}: its opening text was not found exactly once.\n  ${firstLines.split('\n').join('\n  ')}`)
  }
  const out = []
  for (const line of v94.slice(v94.indexOf(marker) + 1).split('\n')) {
    out.push(line)
    if (line.replace(/--.*$/, '').includes(';')) return out.join('\n')
  }
  stop(2, `Could not copy a seed statement out of ${rel(V94)}: it has no closing semicolon.`)
}

const SEED = [
  ['The 8 areas and their placeholder names.',
   'insert into public.regions_next (id, order_num, name) values'],
  ['The 145 placeholder lessons.',
   'insert into public.lessons_next (id, region_id, type, title, sort_order)'],
  ['The Ad Bounty pond.',
   "update public.lessons_next\n   set type = 'setup',"],
  ['The gate, in two statements.',
   "update public.lessons_next set is_gate = false where is_gate and id <> 'a5l25';"],
  [null,
   "update public.lessons_next set is_gate = true  where id = 'a5l25';"],
  ['The 9 placeholder action items.',
   'update public.lessons_next\n   set requires_action = true,'],
].map(([says, firstLines]) => ({ says, sql: copied(firstLines) }))

// The two lines the undo puts around each copied statement. The migration
// tests split the file on them.
const COPY_OPEN  = '-- ▼ copied from 2026_v94_catalog_next_staging.sql'
const COPY_CLOSE = '-- ▲ end of the copy'

// ─────────────── the migration ───────────────

const RULE = '-- ============================================================'
const head = title => `-- ─────────────── ${title} ───────────────`

const expectTable = [
  ...AREAS.map((a, i) => `--     ${a}     ${String(perArea[i].length).padStart(4)}  ${String(perArea[i].filter(r => r.counts_toward_progress).length).padStart(8)}  ${String(perArea[i].filter(r => r.requires_action).length).padStart(12)}`),
  `--     total  ${String(total).padStart(4)}  ${String(counting).padStart(8)}  ${String(actions).padStart(12)}`,
].join('\n')

const migration = `${RULE}
-- v101 — the real course goes into the staging catalog: ${total} lessons in
--        the 8 areas, in the course's own order, under their real titles
--
-- GENERATED FILE. Never edit it by hand. It is written by
-- supabase/catalog/build-course-sql.mjs from
-- supabase/catalog/course_catalog.json. To change a title, the order, an
-- action item or the gate, change the data file and run
-- \`npm run build:catalog\`. The migration tests fail when this file and the
-- data file disagree.
--
-- Part of the course-catalog PRD (_admin/prds/course-catalog/
-- course_catalog_prd.md, section 9). The data file holds the course
-- "${oneLine(catalog.course)}" as it was read on ${oneLine(catalog.read)}.
--
-- WHAT THIS FILE DOES
--   1. Gives the 8 areas of regions_next the course's own chapter names.
--   2. Rewrites lessons_next. v94 seeded it with 145 placeholder lessons
--      ("Fundamentals · lesson 3"). After this file it holds the ${total}
--      lessons of the course: id, area, type, title, order, the ${actions} action
--      items with their briefs, the one gate (${gate}), the special
--      rows (${specialsSaid}),
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
${RULE}

begin;

${head('1. The two tables are there, and the areas are the eight')}

do ${GUARD}
declare
  v_areas text;
begin
  if to_regclass('public.regions_next') is null or to_regclass('public.lessons_next') is null then
    raise exception 'public.regions_next or public.lessons_next does not exist. Run migration 2026_v94_catalog_next_staging.sql first. Nothing was changed.';
  end if;

  select string_agg(r.id, ', ' order by r.id) into v_areas from public.regions_next r;
  if v_areas is distinct from '${AREAS.join(', ')}' then
    raise exception 'public.regions_next must hold exactly the 8 areas a1 to a8, and it holds: %. This file writes the course into those 8 areas. Nothing was changed.', coalesce(v_areas, 'no rows');
  end if;
end
${GUARD};

${head('2. No video row and no watch row may lose its lesson')}
--
-- lesson_videos and student_lesson_watch name a lesson by its id, with no
-- foreign key. A row on a2l05 belongs to whatever lesson a2l05 is. So this
-- file stops when such a row sits on a staging lesson whose title would
-- change, or which would be deleted.
-- Both tables are read through to_regclass and execute, so the file runs the
-- same way on a database where v93 or v100 has not run.

do ${GUARD}
declare
  -- Every lesson this file writes: its id, its title and its type.
  v_new constant text[] := array[
${rows.map(r => `    [${sq(r.id)}, ${sq(r.title)}, ${sq(r.type)}]`).join(',\n')}
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
   where v.id ~ '${LESSON_ID_SQL}'
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
${GUARD};

${head('3. The 8 areas get their real names')}

update public.regions_next as r
   set name = v.name
  from (values
${catalog.areas.map(a => `    (${sq(a.id)}, ${sq(a.name)})`).join(',\n')}
  ) as v(id, name)
 where r.id = v.id;

${head('4. Clear the way')}
--
-- First the column for the Whop lesson id, when it is missing, with its own
-- unique index: one Whop lesson belongs to one lesson. v94 has no such column.
--
-- Four unique indexes stand in the way of rewriting the rows one by one: one
-- gate, one lesson per feature key, one lesson per Whop lesson id, one lesson
-- per sort_order. The gate, the feature keys and the Whop lesson ids are taken
-- off, and every sort_order is moved up by ${PARKED}. Step 5 gives the lessons
-- of the course their real values back. What is still parked above ${PARKED}
-- after step 5 is a row the course no longer has.

alter table public.lessons_next add column if not exists whop_lesson_id text;

create unique index if not exists lessons_next_whop_lesson_id_key
  on public.lessons_next (whop_lesson_id) where whop_lesson_id is not null;

update public.lessons_next
   set is_gate = false, feature_key = null, whop_lesson_id = null
 where is_gate or feature_key is not null or whop_lesson_id is not null;

update public.lessons_next set sort_order = sort_order + ${PARKED};

${head(`5. The ${total} lessons of the course`)}
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
${rows.map(r => `  (${[sq(r.id), sq(r.region_id), sq(r.type), sq(r.title), 'null', r.sort_order, r.requires_action,
                       orNull(r.action_brief), 'false', r.is_gate, 'null', 'null', r.counts_toward_progress,
                       orNull(r.feature_key), sq(r.whop_lesson_id)].join(', ')})`).join(',\n')}
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

${head('6. The rows the course no longer has')}

delete from public.lessons_next where sort_order > ${PARKED};

${head('7. The result is checked before it is kept')}
--
-- Any line that does not hold raises, and the raise undoes everything above.

do ${CHECK}
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

  if f.n <> ${total} then
    raise exception 'lessons_next would hold % lessons and the course has ${total}. Nothing was changed.', f.n;
  end if;
  if f.counting <> ${counting} then
    raise exception '% lessons would count toward progress and the course has ${counting} that do. Nothing was changed.', f.counting;
  end if;
  if f.lowest <> 1 or f.highest <> ${total} or f.orders <> ${total} then
    raise exception 'sort_order would run from % to % over % different values. It must run from 1 to ${total} with no hole. Nothing was changed.', f.lowest, f.highest, f.orders;
  end if;
  if v_sizes is distinct from '${sizes}' then
    raise exception 'The 8 areas would hold % lessons. They must hold ${sizes}. Nothing was changed.', v_sizes;
  end if;
  if v_crossed <> 0 then
    raise exception 'In % area(s) the first lesson would not come after the last lesson of the area before it. The order of the lessons must rise with the order of the areas and never cross between two of them. Nothing was changed.', v_crossed;
  end if;
  if f.gates <> '${gate}' then
    raise exception 'The gate would be on: %. It must be on ${gate} and nowhere else. Nothing was changed.', f.gates;
  end if;
  if f.specials <> ${sq(specials)} then
    raise exception 'The rows with a feature key or outside the lesson count would be: %. They must be: ${specials.replaceAll("'", "''").replaceAll('%', '%%')}. Nothing was changed.', f.specials;
  end if;
  if f.actions <> ${actions} or f.no_brief <> 0 then
    raise exception 'There would be % action items, % of them with no brief. The course has ${actions}, each with its brief. Nothing was changed.', f.actions, f.no_brief;
  end if;
  if f.setups <> ${setups} then
    raise exception '% lessons would have the type setup and the course has ${setups}. Nothing was changed.', f.setups;
  end if;
  if f.placeholders <> 0 then
    raise exception '% lessons would still carry a placeholder title from v94. Nothing was changed.', f.placeholders;
  end if;
  if f.whop_ids <> ${total} then
    raise exception '% lessons would carry a Whop lesson id of their own, and all ${total} must. Nothing was changed.', f.whop_ids;
  end if;
end
${CHECK};

commit;

${head('8. What the catalog holds now')}
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
${expectTable}
--   with_length is 0 on every row until load-lesson-videos.sql has run. After
--   it, with_length is the number of lessons that have a video.
--   If the file stopped with a message ending "Nothing was changed.", it is
--   true: the whole file is one transaction.
`

// ─────────────── the undo ───────────────

const undo = `${RULE}
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
--                         where lesson_id ~ '${LESSON_ID_SQL}'
--                         order by lesson_id;
--                      (keep the result somewhere private; never commit it)
--                      then: delete from public.lesson_videos
--                             where lesson_id ~ '${LESSON_ID_SQL}';
--     2. watch rows:   before the cutover none can exist on a course lesson.
--                      If some do, they are test rows or the cutover has
--                      happened. After the cutover this file is the wrong
--                      tool. Test rows: delete from public.student_lesson_watch
--                                        where lesson_id ~ '${LESSON_ID_SQL}';
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
${RULE}

${head('0. Refuse while a row points at a course lesson')}
--
-- On its own, ahead of the transaction: when it stops the file, nothing has
-- been started and nothing is left open. The message gives counts and never
-- a video id. Both tables are read through to_regclass and execute, so the
-- file runs the same way where v93 or v100 has not run.
do ${GUARD}
declare
  c_course constant text := '${LESSON_ID_SQL}';
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
${GUARD};

begin;

${head('1. The real course goes')}

delete from public.lessons_next;

${head("2. v94's seed, copied by script")}

${SEED.map(s => `${s.says ? `-- ${s.says}\n` : ''}${COPY_OPEN}\n${s.sql}\n${COPY_CLOSE}`).join('\n\n')}

commit;

${RULE}
-- POST-CHECKS
${RULE}
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
${RULE}
`

// ─────────────── write, or compare ───────────────

const files = [[MIGRATION, migration], [UNDO, undo]]
const onDisk = p => { try { return fs.readFileSync(p, 'utf8') } catch { return null } }

if (check) {
  const stale = files.filter(([p, text]) => onDisk(p) !== text)
  if (stale.length) {
    stop(1, [...stale.map(([p]) => `${rel(p)} ${onDisk(p) === null ? 'is missing' : 'differs from what the data file gives'}.`),
             'Run `npm run build:catalog` and commit the result. Nothing was written.'])
  }
  console.log(`The two SQL files are current: ${total} lessons in 8 areas (${sizes}).`)
} else {
  for (const [p, text] of files) {
    const same = onDisk(p) === text
    if (!same) fs.writeFileSync(p, text)
    console.log(`${same ? 'unchanged' : 'wrote    '} ${rel(p)}`)
  }
  console.log(`${total} lessons in 8 areas (${sizes}); ${counting} count, ${actions} action items, gate on ${gate}.`)
}
