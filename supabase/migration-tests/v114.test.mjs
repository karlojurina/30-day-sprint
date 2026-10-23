// v114 and its undo (2026-10-23: Video Ads II's four editing breakdowns,
// a4l02 to a4l05, become action items with a Discord link, the owner's
// decision of 2026-10-22 and 23) on a real Postgres (PGlite), in a file of its
// own as v111 to v113 are, with v114's count before the paste
// (supabase/diagnostics/v114-before-paste.sql).
//
//   cd supabase/migration-tests && npm install && node --experimental-strip-types v114.test.mjs
//
// THE DATABASE is production as the course switch left it, made by the real
// files in order: base.sql; the pre-v92 views and function lifted verbatim
// and v78's hardening, as run.mjs makes them; v28 (the Discord link's column
// and its check); an old course of made-up lessons (l001 to l008, l057, l078)
// with one student on it; v92 to v101; then v103 and the switch, v104. One
// thing is done by hand before the switch: the four are plain videos in
// lessons_next, as production's was when the switch copied it (v101 was
// pasted there before 2026-10-23; the data file, and so the v101 file, hold
// the four briefs since). Made-up students then stand on the new course,
// with watch rows, a video row and Discord links where the routes write them.
//
// v114 is pasted as the owner pastes it, twice; a student then hands one of
// the four in as the two routes write it; the undo is pasted twice; v114
// again. Both files write lessons and lessons_next, the same way. Every
// refusal runs on a copy of the database as it was before v114 (PGlite's
// dumpDataDir), and every copy is compared whole before and after: a refusal
// changes nothing. The locks are read from pg_locks, and a lock timeout is
// raised in their place. Both files also run statement by statement, as psql
// sends them. lesson_is_complete() (v92) is held to isLessonComplete
// (src/lib/progress.ts, the app's own rule) on every completion row, before
// v114 and after it, and the count before the paste to isPlaybookUnlocked,
// the Playbook's rule, on students at each of its edges. Every student, link
// and id here is made up.
import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'
import { isLessonComplete, isPlaybookUnlocked } from '../../src/lib/progress.ts'

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8')
const M = (f) => read(`../migrations/${f}`)
const V114 = M('2026_v114_video_ads_ii_action_items.sql')
const UNDO = read('../undo/2026_v114_undo.sql')
const BEFORE_PASTE = read('../diagnostics/v114-before-paste.sql')
const POSTCHECK = read('../diagnostics/cutover-postcheck.sql')
const COURSE = JSON.parse(read('../catalog/course_catalog.json'))

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? Number(x) : x))
const same = (a, b) => show(a) === show(b)
/** A row without these columns. */
const without = (row, cols) => Object.fromEntries(Object.entries(row).filter(([k]) => !cols.includes(k)))
function finish(why = '') {
  if (why) console.log(`\n  stopped: ${why}`)
  console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
  if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
  process.exit(0)
}

// Lift a statement verbatim out of a real migration file (run.mjs's lift()).
function lift(file, startMarker, endMarker = ';') {
  const s = M(file)
  const i = s.indexOf('\n' + startMarker) + 1
  if (i < 1) throw new Error(`marker not found in ${file}: ${startMarker}`)
  if (endMarker !== ';') {
    const j = s.indexOf(endMarker, i)
    if (j < 0) throw new Error(`end not found in ${file}`)
    return s.slice(i, j + endMarker.length)
  }
  const out = []
  for (const line of s.slice(i).split('\n')) {
    out.push(line)
    if (line.replace(/--.*$/, '').includes(';')) return out.join('\n')
  }
  throw new Error(`end not found in ${file}`)
}

// ── The four, and what the data file says of them ───────────────────────────
const FOUR = ['a4l02', 'a4l03', 'a4l04', 'a4l05']
const TITLES = {
  a4l02: 'Editing Breakdown - UGC',
  a4l03: 'Editing Breakdown - Text on Screen Ad',
  a4l04: 'Editing Breakdown - AI VO Ad',
  a4l05: 'Editing Breakdown - VSL Ad',
}
/** The owner's four briefs, typed here word for word, on purpose: the data file and v114 are each held to them. */
const OWNER = {
  a4l02: "Edit the UGC ad yourself from the brief in the lesson, then post it for the coaches' review.",
  a4l03: "Edit the text on screen ad yourself from the brief in the lesson, then post it for the coaches' review.",
  a4l04: "Edit the AI voiceover ad yourself from the brief in the lesson, then post it for the coaches' review.",
  a4l05: "Edit the VSL ad yourself from the brief and the assets in the lesson, then post it for the coaches' review.",
}
const lessonOf = (id) => COURSE.lessons.find((l) => l.id === id)
/** The data file as catalog rows (run.mjs's wantRows, section 20). */
const fileRows = COURSE.lessons.map((l, i) => ({
  id: l.id, region_id: l.area, type: l.type, title: l.title, sort_order: i + 1,
  requires_action: 'action_brief' in l, action_brief: l.action_brief ?? null,
  is_gate: l.gate === true, counts_toward_progress: l.counts !== false, feature_key: l.feature_key ?? null,
  whop_lesson_id: l.whop_lesson_id,
}))
/** The same rows with the four as plain videos: production's catalog before v114, in both tables. */
const fileRowsBefore = fileRows.map((r) => (FOUR.includes(r.id) ? { ...r, requires_action: false, action_brief: null } : r))
const CATALOG_COLS = 'id, region_id, type, title, sort_order, requires_action, action_brief, is_gate, counts_toward_progress, feature_key, whop_lesson_id'

// ── The students, on the new course after the switch ────────────────────────
const sid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const OLD = sid(1) // on the old course before the switch
const WATCHED = sid(2) // watched a4l01 to a4l05
const GATE = sid(3) // watched every video through Video Ads II, handed in Video Ads I's two
const NONE = sid(4) // nothing yet
const LINK = 'https://discord.com/channels/1100000000000000001/1200000000000000002/1300000000000000003'
const LINK2 = 'https://discord.com/channels/1100000000000000001/1200000000000000002/1300000000000000004'
const FAKE_VIDEO = 'vid_v114fakeaaaa02'
const at = (h) => `2026-10-21T${String(h).padStart(2, '0')}:00:00.000Z`

const OLD_COURSE = `
  insert into regions (id, order_num, name, terrain) values
    ('r1', 1, 'Foundation', 'shore'), ('r2', 2, 'Production', 'forest'), ('r3', 3, 'Strategy', 'mountains'), ('r4', 4, 'Gate of Possibilities', 'city');
  insert into lessons (id, region_id, day, type, title, sort_order) values
    ${Array.from({ length: 8 }, (_, i) => `('l00${i + 1}', 'r1', ${i + 1}, 'watch', 'Old lesson ${i + 1}', ${i + 1})`).join(', ')},
    ('l057', 'r4', 29, 'action', 'Ad Bounty', 57), ('l078', 'r4', 30, 'action', 'Playbook unlock', 78);
  insert into students (id, supabase_user_id, email, first_paid_at, whop_plan_id, membership_status) values
    ('${OLD}', '${OLD}', 'old@example.com', '2026-06-01 10:00:00+00', 'plan_4ZrwR4PmBsVsx', 'active');
  insert into student_lesson_completions (student_id, lesson_id, completed_at) values
    ('${OLD}', 'l001', '2026-06-10 10:00:00+00'), ('${OLD}', 'l002', '2026-06-11 10:00:00+00');`

/** The database up to the switch: `switched` false stops before v103 and v104 (the old course still live). */
async function database({ switched = true } = {}) {
  const d = new PGlite()
  await d.exec(read('base.sql'))
  for (const sql of [
    lift('2026_v81_canonical_progress_alignment.sql', 'create or replace view public.student_progress_counts as'),
    lift('2026_v49_student_current_region_view.sql', 'create or replace view public.student_current_region as'),
    lift('2026_v90_achievement_stats_and_copy.sql', 'create or replace view achievement_unlock_stats'),
    lift('2026_v89_point_in_time_snapshots.sql', 'create or replace function public.rebuild_daily_snapshots(', '$$;'),
  ]) await d.exec(sql)
  // v78's hardening as production has it (run.mjs, V78_HARDENING).
  await d.exec(`
    alter view public.student_progress_counts set (security_invoker = on);
    revoke select on public.student_progress_counts from anon;
    grant select on public.student_progress_counts to authenticated;
    alter view public.student_current_region set (security_invoker = on);
    revoke select on public.student_current_region from anon;
    grant select on public.student_current_region to authenticated;
    revoke select on public.achievement_unlock_stats from anon;
    grant select on public.achievement_unlock_stats to authenticated;
    grant execute on function public.rebuild_daily_snapshots(date, date) to authenticated;`)
  await d.exec(M('2026_v28_discord_message_link.sql'))
  await d.exec(OLD_COURSE)
  for (const f of ['2026_v92_progress_predicate_and_lessons_v2_columns.sql', '2026_v93_lesson_watch_telemetry.sql',
                   '2026_v94_catalog_next_staging.sql', '2026_v95_discount_window_config.sql',
                   '2026_v96_lock_down_rebuild_snapshots.sql', '2026_v97_heartbeat_trust_nothing.sql',
                   '2026_v98_current_region_counts_toward_progress.sql', '2026_v99_area_landmarks_and_rail.sql']) await d.exec(M(f))
  await d.exec(`alter default privileges in schema public grant all on tables to anon, authenticated, service_role;`)
  await d.exec(M('2026_v100_lesson_videos_and_speed.sql'))
  await d.exec(M('2026_v101_course_catalog.sql'))
  // Production's lessons_next when the switch copied it: the four plain videos (v101 pasted before 2026-10-23).
  await d.exec(`update public.lessons_next set requires_action = false, action_brief = null
                 where id in (${FOUR.map((x) => `'${x}'`).join(', ')});`)
  if (!switched) return d
  await d.exec(M('2026_v103_cutover_expand.sql'))
  await d.exec(M('2026_v104_course_switch.sql'))
  // The new course's students, after the switch.
  const watchedThroughA4 = COURSE.lessons
    .filter((l, i) => i < COURSE.lessons.findIndex((x) => x.id === 'a4l17') + 1 && l.counts !== false)
  const gateRows = watchedThroughA4.map((l, i) => {
    const t = `2026-10-20T08:${String(i % 60).padStart(2, '0')}:00.000Z`
    const handedIn = l.action_brief !== undefined && !FOUR.includes(l.id)
    return `('${GATE}', '${l.id}', '${t}', ${handedIn ? `'${t}'` : 'null'}, ${handedIn ? `'${LINK}'` : 'null'})`
  })
  await d.exec(`
    insert into students (id, supabase_user_id, email, first_paid_at, whop_plan_id, membership_status) values
      ('${WATCHED}', '${WATCHED}', 'watched@example.com', '2026-10-12 10:00:00+00', 'plan_4ZrwR4PmBsVsx', 'active'),
      ('${GATE}', '${GATE}', 'gate@example.com', '2026-10-12 10:00:00+00', 'plan_4ZrwR4PmBsVsx', 'active'),
      ('${NONE}', '${NONE}', 'none@example.com', '2026-10-12 10:00:00+00', 'plan_4ZrwR4PmBsVsx', 'active');
    insert into student_lesson_completions (student_id, lesson_id, completed_at, action_completed_at, discord_message_link) values
      ('${WATCHED}', 'a4l01', '${at(8)}', null, null), ('${WATCHED}', 'a4l02', '${at(9)}', null, null),
      ('${WATCHED}', 'a4l03', '${at(10)}', null, null), ('${WATCHED}', 'a4l04', '${at(11)}', null, null),
      ('${WATCHED}', 'a4l05', '${at(12)}', null, null),
      ${gateRows.join(',\n      ')};
    insert into student_lesson_watch (student_id, lesson_id, max_position_seconds, last_position_seconds, watched_seconds, reported_duration_seconds, threshold_met_at) values
      ('${WATCHED}', 'a4l02', 617, 617, 600, 617, '${at(9)}');
    insert into lesson_videos (lesson_id, tella_video_id) values ('a4l02', '${FAKE_VIDEO}');`)
  return d
}

/** Runs a file as the SQL editor does: every statement; the last one's rows, or the refusal (rolled back). */
async function paste(d, sql) {
  try {
    const last = (await d.exec(sql)).at(-1)
    return { ok: true, rows: last.rows, cols: last.fields.map((f) => f.name) }
  } catch (e) {
    await d.exec('rollback;').catch(() => {})
    return { ok: false, code: e.code, said: e.message }
  }
}
/**
 * A file's statements as psql sends them, one at a time: split at each ";"
 * outside quotes, dollar quotes and comments, comment-only pieces dropped.
 */
function statements(sql) {
  const out = []
  let start = 0
  let i = 0
  while (i < sql.length) {
    const ch = sql[i]
    if (ch === '-' && sql[i + 1] === '-') { const j = sql.indexOf('\n', i); i = j < 0 ? sql.length : j + 1; continue }
    if (ch === '/' && sql[i + 1] === '*') { const j = sql.indexOf('*/', i + 2); i = j < 0 ? sql.length : j + 2; continue }
    if (ch === "'") {
      let j = i + 1
      while (j < sql.length && !(sql[j] === "'" && sql[j + 1] !== "'")) j += sql[j] === "'" ? 2 : 1
      i = j + 1
      continue
    }
    const tag = ch === '$' ? /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i))?.[0] : null
    if (tag) { const j = sql.indexOf(tag, i + tag.length); i = j < 0 ? sql.length : j + tag.length; continue }
    if (ch === ';') { out.push(sql.slice(start, i + 1)); start = i + 1 }
    i++
  }
  out.push(sql.slice(start))
  return out.filter((s) => s.replace(/--.*$/gm, '').trim().length > 0)
}
/** Runs a file as psql -f does: statement by statement, going on after an error. The last result, and every error. */
async function psql(d, sql) {
  let last = null
  const errors = []
  for (const s of statements(sql)) {
    try { last = (await d.exec(s)).at(-1) } catch (e) { errors.push(e.message) }
  }
  return { rows: last?.rows ?? [], errors }
}
const rows = async (d, sql) => (await d.query(sql)).rows
const one = async (d, sql) => (await rows(d, sql))[0]
/** Every row of every table in public but `skip`, and the archive schemas, as sorted JSON: what "nothing changed" compares. */
async function dump(d, skip = []) {
  const out = {}
  for (const { tablename: t } of await rows(d, `select tablename from pg_tables where schemaname = 'public' order by 1`)) {
    if (skip.includes(t)) continue
    out[t] = (await rows(d, `select * from public."${t}"`)).map((r) => show(r)).sort()
  }
  out.archives = (await rows(d, `select nspname from pg_namespace where nspname like 'archive%' order by 1`)).map((r) => r.nspname)
  return show(out)
}
const everything = async (d) => dump(d)
/** What no file here may touch: every table but the two catalogs. Students' rows, the videos, the archive. */
const allButCatalogs = async (d) => dump(d, ['lessons', 'lessons_next'])
const lessonsNow = async (d) => rows(d, `select * from public.lessons order by sort_order, id`)
const nextNow = async (d) => rows(d, `select * from public.lessons_next order by sort_order, id`)
const fourNow = async (d, table = 'lessons') => rows(d, `select id, requires_action, action_brief from public.${table} where id in ('a4l02', 'a4l03', 'a4l04', 'a4l05') order by id`)
const catalogNow = async (d, table = 'lessons') => rows(d, `select ${CATALOG_COLS} from public.${table} order by sort_order`)
/** A clone of `d` as it is now (PGlite's own copy of its data directory). */
const cloneOf = async (blob) => new PGlite({ loadDataDir: blob })
/** The final table as a map: lesson (or "v114" / "undo" for the first row) to the row. */
const table = (r, first) => Object.fromEntries((r.rows ?? []).map((x) => [x.lesson ?? first, x]))
const progress = async (d) => Object.fromEntries((await rows(d, `select student_id::text as s, completed_count from student_progress_counts`)).map((x) => [x.s, x.completed_count]))
const lastCounted = async (d, s) => (await one(d, `select last_completed_at from student_last_counted_completion where student_id = '${s}'`))?.last_completed_at?.toISOString() ?? null
/** lesson_is_complete (SQL) and isLessonComplete (progress.ts) on every completion row: the rows where they disagree. */
async function predicateDisagreements(d) {
  const all = await rows(d, `select c.lesson_id, c.completed_at, c.action_completed_at, c.skipped_at, l.requires_action,
                                    public.lesson_is_complete(l.requires_action, c.completed_at, c.action_completed_at, c.skipped_at) as sql_done
                               from student_lesson_completions c join lessons l on l.id = c.lesson_id`)
  const wrong = all.filter((r) => r.sql_done !== isLessonComplete(r, { id: r.lesson_id, requires_action: r.requires_action }))
  return { n: all.length, wrong: wrong.map((r) => r.lesson_id) }
}
/** The switch's postcheck, its row 4: the lessons that differ from lessons_next in the catalog columns. */
async function stagingDiff(d) {
  const r = await paste(d, POSTCHECK)
  const row = r.ok ? r.rows.find((x) => x.item === 'lessons that differ from lessons_next (catalog columns)') : null
  return row ? `${row.found} ${row.verdict}` : `no row (${r.said ?? 'ran'})`
}
/** Rows that moved between two reads of a table, by id: the ids, and whether only these columns moved on them. */
function moved(before, after, cols) {
  const ids = after.filter((r, i) => !same(r, before[i])).map((r) => r.id)
  const onlyThose = after.filter((r) => ids.includes(r.id)).every((r) => {
    const b = before.find((x) => x.id === r.id)
    return same(without(r, [...cols, 'updated_at']), without(b, [...cols, 'updated_at'])) && r.updated_at > b.updated_at
  })
  return { ids, onlyThose }
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n=== The data file and the owner\'s briefs ===')
ok(FOUR.every((id) => lessonOf(id)?.area === 'a4' && lessonOf(id)?.type === 'watch' && lessonOf(id)?.title === TITLES[id]),
   'course_catalog.json: the four are Video Ads II\'s editing breakdowns, watch lessons, under these titles', show(FOUR.map((id) => lessonOf(id)?.title)))
ok(FOUR.every((id) => lessonOf(id)?.action_brief === OWNER[id]), 'the data file holds the owner\'s four briefs, word for word', show(FOUR.map((id) => lessonOf(id)?.action_brief)))
ok(FOUR.every((id) => V114.includes(`'${OWNER[id].replaceAll("'", "''")}'`)) && FOUR.every((id) => UNDO.includes(`'${OWNER[id].replaceAll("'", "''")}'`)),
   'v114 and its undo hold the same four, quoted for SQL')
ok(FOUR.every((id) => !/—|unlock|ecomtalent|http|www\./i.test(OWNER[id])), 'no em dash, no "unlock", no "EcomTalent" and no link in what students read')
ok(COURSE.lessons.filter((l) => l.action_brief !== undefined).length === 14,
   'the data file now has 14 action items (the PRD\'s 9, a3l17 since 2026-10-19, these four)', String(COURSE.lessons.filter((l) => l.action_brief !== undefined).length))

console.log('\n=== The database: production as the switch left it ===')
const t0 = Date.now()
const db = await database()
const BEFORE_BLOB = await db.dumpDataDir()
console.log(`  (built from the real files in ${Date.now() - t0} ms)`)
const reset = await one(db, `select value from admin_config where key = 'curriculum_reset_at'`)
ok(!!reset?.value, 'the switch ran: admin_config holds curriculum_reset_at', reset?.value)
const catalogBefore = await catalogNow(db)
const offFile = catalogBefore.filter((r, i) => !same(r, fileRows[i])).map((r) => r.id)
ok(catalogBefore.length === 141 && same(offFile, FOUR),
   'lessons holds the 141 lessons of the data file, and differs from it only on the four', show(offFile))
ok(same(catalogBefore, fileRowsBefore) && same(await catalogNow(db, 'lessons_next'), fileRowsBefore),
   'lessons and lessons_next both hold the data file with the four as plain videos, as on production')
ok(same(await fourNow(db), FOUR.map((id) => ({ id, requires_action: false, action_brief: null }))), 'the four are plain videos with no brief, as on production')
ok((await one(db, `select count(*)::int as n from lessons where requires_action`)).n === 10, 'production\'s 10 action items')
ok(await stagingDiff(db) === '0 PASS', 'the switch\'s postcheck finds lessons equal to lessons_next (its row 4: 0, PASS)')
const lessonsBefore = await lessonsNow(db)
const nextBefore = await nextNow(db)
const restBefore = await allButCatalogs(db)
const progressBefore = await progress(db)
const lastBefore = await lastCounted(db, WATCHED)
{
  const p = await predicateDisagreements(db)
  ok(p.n > 50 && p.wrong.length === 0, `lesson_is_complete agrees with isLessonComplete (progress.ts) on all ${p.n} completion rows`, show(p.wrong))
}
ok(progressBefore[WATCHED] === 5 && lastBefore === at(12), 'before v114 the student who watched a4l01 to a4l05 has 5 lessons done, the last at a4l05\'s time', show({ n: progressBefore[WATCHED], last: lastBefore }))

console.log('\n=== v114, pasted ===')
const first = await paste(db, V114)
ok(first.ok, 'it runs', first.said)
if (!first.ok) finish('the first paste failed, and every check after it reads its result')
{
  ok(same(first.cols, ['lesson', 'title', 'action_item', 'brief', 'changed_now', 'v114']), 'one table: lesson, title, action_item, brief, changed_now, v114', first.cols.join(', '))
  const want = [
    { lesson: null, title: null, action_item: null, brief: null, changed_now: null, v114: 'v114 ran now: 4 of the four made action items with a Discord link (a4l02, a4l03, a4l04, a4l05), in lessons and in lessons_next.' },
    ...FOUR.map((id) => ({ lesson: id, title: TITLES[id], action_item: true, brief: OWNER[id], changed_now: true, v114: null })),
  ]
  ok(same(first.rows, want), 'its first row says what it did, in both tables, then each of the four with its title, its brief and "changed now", in course order', show(first.rows.map((r) => r.v114 ?? `${r.lesson} ${r.changed_now}`)))
  ok(same(await fourNow(db), FOUR.map((id) => ({ id, requires_action: true, action_brief: OWNER[id] }))), 'the four are action items with the owner\'s briefs')
  ok(same(await catalogNow(db), fileRows), 'and lessons now equals the data file on every lesson, in every catalog column: a catalog rebuilt from it agrees with v114')
  ok(same(await catalogNow(db, 'lessons_next'), fileRows),
     'lessons_next equals it too, so a deployment with CATALOG_TABLE_SUFFIX=_next reads the four as action items as production does')
  const inLessons = moved(lessonsBefore, await lessonsNow(db), ['requires_action', 'action_brief'])
  const inNext = moved(nextBefore, await nextNow(db), ['requires_action', 'action_brief'])
  ok(same(inLessons.ids, FOUR) && inLessons.onlyThose && same(inNext.ids, FOUR) && inNext.onlyThose,
     'in each table no other lesson moved in any column; on the four only requires_action, action_brief and updated_at (its trigger)', show({ lessons: inLessons.ids, lessons_next: inNext.ids }))
  ok((await one(db, `select (select count(*) from lessons where requires_action)::int as a, (select count(*) from lessons_next where requires_action)::int as b`)).a === 14 &&
     (await one(db, `select count(*)::int as n from lessons_next where requires_action`)).n === 14, '14 action items now, in both tables')
  ok(await allButCatalogs(db) === restBefore, 'every other table is as it was: every student\'s row, the watch row and the video row on a4l02, the archive')
  ok(await stagingDiff(db) === '0 PASS', 'the switch\'s postcheck still finds lessons equal to lessons_next (row 4: 0, PASS)')
  const p = await predicateDisagreements(db)
  ok(p.wrong.length === 0, `lesson_is_complete still agrees with isLessonComplete on all ${p.n} rows`, show(p.wrong))
  const done = await one(db, `select bool_or(public.lesson_is_complete(true, now(), null, null)) as watch_only,
                                     bool_or(public.lesson_is_complete(true, null, now(), null)) as action_only,
                                     bool_or(public.lesson_is_complete(true, now(), now(), null)) as both`)
  const four = await rows(db, `select c.lesson_id, public.lesson_is_complete(l.requires_action, c.completed_at, c.action_completed_at, c.skipped_at) as done
                                 from student_lesson_completions c join lessons l on l.id = c.lesson_id
                                where c.student_id = '${WATCHED}' and c.lesson_id in ('a4l02', 'a4l03', 'a4l04', 'a4l05') order by 1`)
  ok(!done.watch_only && !done.action_only && done.both && four.length === 4 && four.every((r) => r.done === false),
     'lesson_is_complete needs the link half on the four now: the video alone is not done, nor the hand-in alone, both are; the watched four read not done',
     show({ done, four: four.map((r) => `${r.lesson_id}:${r.done}`) }))
  const now = await progress(db)
  const lastNow = await lastCounted(db, WATCHED)
  ok(now[WATCHED] === progressBefore[WATCHED] - 4 && now[GATE] === progressBefore[GATE] - 4 && now[OLD] === progressBefore[OLD] && lastNow === at(8),
     'the progress view counts them open: 5 to 1 for the student who watched them, 4 fewer for the one through Video Ads II, and the last counted lesson is a4l01\'s',
     show({ before: progressBefore, now, last: lastNow }))
}

console.log('\n=== Pasted again ===')
{
  const was = await everything(db)
  const again = await paste(db, V114)
  const T = again.ok ? table(again, 'v114') : {}
  ok(again.ok && T.v114?.v114 === 'v114 was already in place. This run changed nothing.' && FOUR.every((id) => T[id]?.changed_now === false && T[id]?.brief === OWNER[id]),
     'it says it was already in place and changed nothing, changed_now false on all four', T.v114?.v114 ?? again.said)
  ok(await everything(db) === was, 'and nothing changed: every row of every table, updated_at included')
}

console.log('\n=== After v114: a student hands one in, as the two routes write it ===')
{
  // save-action-link writes the link; mark-action-shipped then the action half (both with the service role).
  await db.exec(`update student_lesson_completions set discord_message_link = '${LINK2}' where student_id = '${WATCHED}' and lesson_id = 'a4l03';
                 update student_lesson_completions set action_completed_at = '${at(15)}' where student_id = '${WATCHED}' and lesson_id = 'a4l03';`)
  const r = await one(db, `select public.lesson_is_complete(l.requires_action, c.completed_at, c.action_completed_at, c.skipped_at) as done
                             from student_lesson_completions c join lessons l on l.id = c.lesson_id
                            where c.student_id = '${WATCHED}' and c.lesson_id = 'a4l03'`)
  const n = (await progress(db))[WATCHED]
  ok(r.done === true && n === 2 && await lastCounted(db, WATCHED) === at(15), 'a4l03 handed in with its link: done, 2 lessons, the last counted at the hand-in', show({ done: r.done, n }))
  const bad = await paste(db, `update student_lesson_completions set discord_message_link = 'https://discord.com/channels/1/2' where student_id = '${WATCHED}' and lesson_id = 'a4l04';`)
  ok(!bad.ok && bad.code === '23514', 'a thread\'s own link is refused by the database\'s check (v28), as the routes refuse it', bad.code)
}
const AFTER_HANDIN = await db.dumpDataDir()

console.log('\n=== The undo, pasted twice, then v114 again ===')
{
  const studentsWere = await allButCatalogs(db)
  const u = await paste(db, UNDO)
  const T = u.ok ? table(u, 'undo') : {}
  ok(u.ok && same(u.cols, ['lesson', 'title', 'action_item', 'brief', 'this_run', 'v114_undo']), 'it runs, one table', u.ok ? u.cols.join(', ') : u.said)
  ok(T.undo?.v114_undo === "The v114 undo ran now: 4 of the four are plain videos again (a4l02, a4l03, a4l04, a4l05), in lessons and in lessons_next. No student's row was touched." &&
     FOUR.every((id) => T[id]?.this_run === 'put back to a plain video' && T[id]?.action_item === false && T[id]?.brief === null && T[id]?.title === TITLES[id]),
     'its first row says what it did, in both tables, then each of the four "put back to a plain video"', T.undo?.v114_undo ?? u.said)
  const strip = (x) => without(x, ['updated_at'])
  const now = await lessonsNow(db)
  const next = await nextNow(db)
  ok(same(now.map(strip), lessonsBefore.map(strip)) && same(now.filter((r) => !FOUR.includes(r.id)), lessonsBefore.filter((r) => !FOUR.includes(r.id))) &&
     same(next.map(strip), nextBefore.map(strip)) && same(next.filter((r) => !FOUR.includes(r.id)), nextBefore.filter((r) => !FOUR.includes(r.id))),
     'lessons and lessons_next are as they were before v114 in every column, updated_at aside on the four (their trigger)')
  ok(await allButCatalogs(db) === studentsWere, 'no student\'s row touched: a4l03\'s hand-in, its link and every other row, the watch row, the video row')
  const handIn = await one(db, `select c.discord_message_link, c.action_completed_at, public.lesson_is_complete(l.requires_action, c.completed_at, c.action_completed_at, c.skipped_at) as done
                                  from student_lesson_completions c join lessons l on l.id = c.lesson_id
                                 where c.student_id = '${WATCHED}' and c.lesson_id = 'a4l03'`)
  ok(handIn.discord_message_link === LINK2 && handIn.done === true && (await progress(db))[WATCHED] === 5,
     'the hand-in stays on its row and is read by nothing: a plain video is done by its video, so the student has 5 again', show({ link: handIn.discord_message_link, done: handIn.done }))
  const was = await everything(db)
  const u2 = await paste(db, UNDO)
  const T2 = u2.ok ? table(u2, 'undo') : {}
  ok(u2.ok && T2.undo?.v114_undo === "Nothing to put back: none of the four holds v114's brief. This run changed nothing." &&
     FOUR.every((id) => T2[id]?.this_run === 'a plain video already') && await everything(db) === was,
     'a second undo changes nothing and says so, "a plain video already" on each', T2.undo?.v114_undo ?? u2.said)
  const back = await paste(db, V114)
  const T3 = back.ok ? table(back, 'v114') : {}
  const doneAgain = await one(db, `select public.lesson_is_complete(l.requires_action, c.completed_at, c.action_completed_at, c.skipped_at) as done
                                     from student_lesson_completions c join lessons l on l.id = c.lesson_id
                                    where c.student_id = '${WATCHED}' and c.lesson_id = 'a4l03'`)
  ok(back.ok && /^v114 ran now: 4 of the four .*, in lessons and in lessons_next\.$/.test(T3.v114?.v114 ?? '') && same(await catalogNow(db), fileRows) &&
     same(await catalogNow(db, 'lessons_next'), fileRows) && doneAgain.done === true && (await progress(db))[WATCHED] === 2,
     'v114 runs again after it, as a first run, in both tables, and the hand-in kept on the row counts again', T3.v114?.v114 ?? back.said)
}

console.log('\n=== The undo leaves a brief changed since ===')
{
  const d = await cloneOf(AFTER_HANDIN)
  await d.exec(`update lessons set action_brief = 'Edit the text on screen ad yourself and post it in Discord.' where id = 'a4l03';`)
  const studentsWere = await allButCatalogs(d)
  const u = await paste(d, UNDO)
  const T = u.ok ? table(u, 'undo') : {}
  ok(u.ok && T.undo?.v114_undo === "The v114 undo ran now: in lessons 3 of the four are plain videos again (a4l02, a4l04, a4l05), in lessons_next 4 of the four (a4l02, a4l03, a4l04, a4l05). No student's row was touched." &&
     T.a4l03?.this_run === "left as it is: its brief is not v114's" && T.a4l03?.action_item === true && T.a4l03?.brief === 'Edit the text on screen ad yourself and post it in Discord.',
     'in lessons the three that hold v114\'s brief go back and a4l03, changed by hand, is left as it is; in lessons_next, where a4l03 holds v114\'s brief, all four go back; the table says so', T.undo?.v114_undo ?? u.said)
  ok(same(await fourNow(d, 'lessons_next'), FOUR.map((id) => ({ id, requires_action: false, action_brief: null }))), 'lessons_next: the four plain videos again')
  ok(await allButCatalogs(d) === studentsWere, 'no student\'s row touched')
  const was = await everything(d)
  const again = await paste(d, V114)
  ok(!again.ok && again.code === 'P0001' &&
     again.said.includes('In public.lessons these lessons hold a brief that is not v114\'s, or are action items with none: a4l03 (an action item, "Edit the text on screen ad yourself and post it in Discord.").') &&
     /Nothing was changed\.$/.test(again.said) && await everything(d) === was,
     'v114 then refuses: a4l03 is an action item with another brief, and nothing changes', again.said?.slice(0, 140))
}

console.log('\n=== When v114 refuses, nothing changes ===')
for (const [label, setup, sentence] of [
  ['one of the four missing', `delete from student_lesson_completions where lesson_id = 'a4l03'; delete from lessons where id = 'a4l03';`,
   'These lessons are not in public.lessons: a4l03.'],
  ['one of the four in another place', `update lessons set region_id = 'a5' where id = 'a4l04';`,
   'v114 is for Video Ads II (a4), and in public.lessons these lessons are not in it: a4l04 (in a5).'],
  ['one of the four not a watch lesson', `update lessons set type = 'setup' where id = 'a4l05';`,
   'v114 is for four watch lessons, and in public.lessons these are not watch lessons: a4l05 (setup).'],
  ['one of the four an action item with another brief', `update lessons set requires_action = true, action_brief = 'Post your UGC edit.' where id = 'a4l02';`,
   'In public.lessons these lessons hold a brief that is not v114\'s, or are action items with none: a4l02 (an action item, "Post your UGC edit.").'],
  ['one of the four an action item with no brief', `update lessons set requires_action = true, action_brief = null where id = 'a4l02';`,
   'In public.lessons these lessons hold a brief that is not v114\'s, or are action items with none: a4l02 (an action item, no brief).'],
  ['one of the four a plain video holding another brief', `update lessons set action_brief = 'An old brief left behind.' where id = 'a4l04';`,
   'In public.lessons these lessons hold a brief that is not v114\'s, or are action items with none: a4l04 (a plain video, "An old brief left behind.").'],
  ['lessons_next: one of the four missing', `delete from lessons_next where id = 'a4l03';`,
   'These lessons are not in public.lessons_next, the staging copy the switch copied from: a4l03.'],
  ['lessons_next: one of the four in another place', `update lessons_next set region_id = 'a5' where id = 'a4l04';`,
   'v114 is for Video Ads II (a4), and in public.lessons_next these lessons are not in it: a4l04 (in a5).'],
  ['lessons_next: one of the four not a watch lesson', `update lessons_next set type = 'setup' where id = 'a4l05';`,
   'v114 is for four watch lessons, and in public.lessons_next these are not watch lessons: a4l05 (setup).'],
  ['lessons_next: one of the four an action item with another brief', `update lessons_next set requires_action = true, action_brief = 'Post your UGC edit.' where id = 'a4l02';`,
   'In public.lessons_next these lessons hold a brief that is not v114\'s, or are action items with none: a4l02 (an action item, "Post your UGC edit.").'],
  ['lessons_next: one of the four a plain video holding another brief', `update lessons_next set action_brief = 'An old brief left behind.' where id = 'a4l04';`,
   'In public.lessons_next these lessons hold a brief that is not v114\'s, or are action items with none: a4l04 (a plain video, "An old brief left behind.").'],
  ['public.lessons missing', `drop table lessons cascade;`, 'public.lessons is missing'],
]) {
  const d = await cloneOf(BEFORE_BLOB)
  await d.exec(setup)
  const was = await everything(d)
  const r = await paste(d, V114)
  ok(!r.ok && r.code === 'P0001' && r.said.includes(sentence) && /Nothing was changed\.$/.test(r.said) && await everything(d) === was,
     `${label}: refused with its sentence, nothing changed`, r.said?.slice(0, 130))
  if (label === 'public.lessons missing') {
    const u = await paste(d, UNDO)
    ok(!u.ok && u.said.includes('public.lessons is missing') && /Nothing was changed\.$/.test(u.said) && await everything(d) === was,
       'and the undo refuses there too, nothing changed', u.said?.slice(0, 100))
  }
}
{
  // Pasted before the switch: lessons holds the old course, so all four are missing.
  const d = await database({ switched: false })
  const was = await everything(d)
  const r = await paste(d, V114)
  ok(!r.ok && r.said.includes('These lessons are not in public.lessons: a4l02, a4l03, a4l04, a4l05.') && r.said.includes('the switch has not run') && await everything(d) === was,
     'before the switch: all four missing, refused, nothing changed', r.said?.slice(0, 120))
}

console.log('\n=== Partly in place already, and lessons_next missing ===')
{
  // One of the four done by hand already, with v114's brief, in both tables: the other three change, and the table says which.
  const d = await cloneOf(BEFORE_BLOB)
  await d.exec(`update lessons set requires_action = true, action_brief = '${OWNER.a4l02.replaceAll("'", "''")}' where id = 'a4l02';
                update lessons_next set requires_action = true, action_brief = '${OWNER.a4l02.replaceAll("'", "''")}' where id = 'a4l02';`)
  const r = await paste(d, V114)
  const T = r.ok ? table(r, 'v114') : {}
  ok(r.ok && T.v114?.v114 === 'v114 ran now: 3 of the four made action items with a Discord link (a4l03, a4l04, a4l05), in lessons and in lessons_next.' &&
     T.a4l02?.changed_now === false && ['a4l03', 'a4l04', 'a4l05'].every((id) => T[id]?.changed_now === true) &&
     same(await catalogNow(d), fileRows) && same(await catalogNow(d, 'lessons_next'), fileRows),
     'a4l02 already v114\'s in both: only the other three change, and its row says so', T.v114?.v114 ?? r.said)
}
{
  // The same in lessons alone: the two tables changed differently, and the first row says so for each.
  const d = await cloneOf(BEFORE_BLOB)
  await d.exec(`update lessons set requires_action = true, action_brief = '${OWNER.a4l02.replaceAll("'", "''")}' where id = 'a4l02';`)
  const r = await paste(d, V114)
  const T = r.ok ? table(r, 'v114') : {}
  ok(r.ok && T.v114?.v114 === 'v114 ran now: in lessons 3 of the four made action items with a Discord link (a4l03, a4l04, a4l05), in lessons_next 4 of the four (a4l02, a4l03, a4l04, a4l05).' &&
     same(await catalogNow(d), fileRows) && same(await catalogNow(d, 'lessons_next'), fileRows),
     'a4l02 already v114\'s in lessons alone: three change there, four in lessons_next, and the first row names each', T.v114?.v114 ?? r.said)
}
{
  // A database with no lessons_next: v114 writes lessons alone and says so, and so does its undo.
  const d = await cloneOf(BEFORE_BLOB)
  await d.exec(`drop table lessons_next cascade;`)
  const was = await allButCatalogs(d)
  const r = await paste(d, V114)
  const T = r.ok ? table(r, 'v114') : {}
  ok(r.ok && T.v114?.v114 === 'v114 ran now: 4 of the four made action items with a Discord link (a4l02, a4l03, a4l04, a4l05). lessons_next is not in this database.' &&
     same(await catalogNow(d), fileRows) && await allButCatalogs(d) === was,
     'with lessons_next missing it writes lessons alone, and its first row says lessons_next is not in this database', T.v114?.v114 ?? r.said)
  const u = await paste(d, UNDO)
  const U = u.ok ? table(u, 'undo') : {}
  ok(u.ok && U.undo?.v114_undo === "The v114 undo ran now: 4 of the four are plain videos again (a4l02, a4l03, a4l04, a4l05). lessons_next is not in this database. No student's row was touched." &&
     same(await catalogNow(d), fileRowsBefore) && await allButCatalogs(d) === was,
     'and the undo puts lessons back alone, saying the same', U.undo?.v114_undo ?? u.said)
}

console.log('\n=== The locks ===')
for (const [label, sql, word] of [['v114', V114, 'so v114 did not start'], ['the undo', UNDO, 'so the v114 undo did not start']]) {
  const d = await cloneOf(BEFORE_BLOB)
  const upToLock = sql.slice(0, sql.indexOf('$lock$;') + '$lock$;'.length)
  await d.exec(upToLock)
  const locked = await rows(d, `select c.relname, l.mode from pg_locks l join pg_class c on c.oid = l.relation
                                 where l.pid = pg_backend_pid() and l.mode not in ('AccessShareLock') and c.relkind = 'r' order by 1`)
  const timeout = await one(d, `select current_setting('lock_timeout') as t`)
  await d.exec('rollback;')
  ok(same(locked, [{ relname: 'lessons', mode: 'ShareRowExclusiveLock' }, { relname: 'lessons_next', mode: 'ShareRowExclusiveLock' }]) && timeout.t === '5s',
     `${label}: before its first read it holds lessons and lessons_next alone, in SHARE ROW EXCLUSIVE (reads go on), each waiting 5 s at most`, show(locked))
  if (label === 'the undo') await paste(d, V114)
  for (const tbl of ['lessons', 'lessons_next']) {
    const timedOut = sql.replace(`lock table public.${tbl} in share row exclusive mode;`,
      "raise exception using errcode = '55P03', message = 'canceling statement due to lock timeout';")
    ok(timedOut !== sql, `${label}: the lock statement on ${tbl} is where the test expects it`)
    const was = await everything(d)
    const r = await paste(d, timedOut)
    ok(!r.ok && r.code === '55P03' && r.said.startsWith(`Another session held public.${tbl} for more than 5 seconds`) && r.said.includes(word) &&
       r.said.endsWith('Nothing was changed. Paste it again in a minute.') && await everything(d) === was,
       `${label}: a lock on ${tbl} it cannot get stops it with its sentence, naming the table, nothing changed`, r.said?.slice(0, 140))
  }
}

console.log('\n=== Statement by statement, as psql -f runs them ===')
{
  // psql sends each statement on its own and goes on after an error. After a
  // finished run, a refusal in the same session must not show that run's words.
  const d = await cloneOf(BEFORE_BLOB)
  const firstRun = await psql(d, V114)
  ok(firstRun.errors.length === 0 && /^v114 ran now: 4 of the four/.test(firstRun.rows[0]?.v114 ?? ''), 'v114 run statement by statement: no error, and its table says it ran', firstRun.rows[0]?.v114)
  await d.exec(`update lessons set action_brief = 'Another brief.' where id = 'a4l02';`)
  const was = await everything(d)
  const refused = await psql(d, V114)
  ok(refused.errors.some((e) => e.includes('hold a brief that is not v114')) && refused.rows[0]?.v114 === 'v114 did not finish in this session. Nothing was changed.' &&
     await everything(d) === was,
     'then refused in the same session: its table says it did not finish, never the earlier run\'s "ran now", and nothing changed', refused.rows[0]?.v114)
  const undoRun = await psql(d, UNDO)
  ok(undoRun.errors.length === 0 && /^The v114 undo ran now: in lessons 3 of the four/.test(undoRun.rows[0]?.v114_undo ?? ''), 'the undo statement by statement: it runs and says so', undoRun.rows[0]?.v114_undo)
  const timedOut = UNDO.replace('lock table public.lessons in share row exclusive mode;', "raise exception using errcode = '55P03', message = 'canceling statement due to lock timeout';")
  const was2 = await everything(d)
  const stopped = await psql(d, timedOut)
  ok(stopped.errors.some((e) => e.includes('so the v114 undo did not start')) && stopped.rows[0]?.v114_undo === 'The v114 undo did not finish in this session. Nothing was changed.' &&
     await everything(d) === was2,
     'then stopped by a lock in the same session: its table says it did not finish, nothing changed', stopped.rows[0]?.v114_undo)
}

console.log('\n=== Before the paste: v114-before-paste.sql ===')
{
  const DAY = 86_400_000
  const nowMs = Date.now()
  const ago = (ms) => new Date(nowMs - ms).toISOString()
  const d = await cloneOf(BEFORE_BLOB)
  // Production's students have joined_at; base.sql leaves it out.
  await d.exec(`alter table students add column if not exists joined_at timestamptz;`)
  const counting = COURSE.lessons.filter((l) => l.counts !== false)
  const brief = (id) => lessonOf(id).action_brief !== undefined
  /** A student's rows: `ids` done, every action item among them handed in but the four, which go as `four` says. */
  const rowsFor = (s, ids, four = 'watched') => ids.map((id) => {
    const t = ago(2 * DAY)
    if (FOUR.includes(id)) {
      if (four === 'handed in') return `('${s}', '${id}', '${t}', '${t}', '${LINK}', null)`
      if (four === 'skipped') return `('${s}', '${id}', null, null, null, '${t}')`
      return `('${s}', '${id}', '${t}', null, null, null)`
    }
    return `('${s}', '${id}', '${t}', ${brief(id) ? `'${t}', '${LINK}'` : 'null, null'}, null)`
  })
  const first = (n) => counting.slice(0, n).map((l) => l.id)
  const S = {
    closes: sid(10),       // 113 of 140 with the four watched, 40 days: 80.7% to 77.9%
    stamped: sid(11),      // the same with the stamp
    lastLesson: sid(12),   // the same with the last counting lesson done
    stillOver: sid(13),    // 118 of 140: 84.3% to 81.4%
    handedIn: sid(14),     // 113 with the four handed in
    young: sid(15),        // the same as closes, 20 days
    noDates: sid(16),      // the same as closes, with neither date (the app reads 1970)
    twoOfFour: sid(17),    // 113, a4l04 and a4l05 handed in, a4l02 and a4l03 watched: 77.9% after, 2 reopened
    edge: sid(18),         // 112 of 140, exactly 80%: open before, closed after
    skipped: sid(19),      // 113 with the four skipped
    justOver: sid(20),     // 30 days and an hour
    justUnder: sid(21),    // 30 days less an hour
    oneWatched: sid(22),   // a4l02 watched only, 5 days
    paidLater: sid(23),    // the same as closes, joined 60 days ago, first paid 20 days ago: the payment counts
  }
  /** [student, first paid, done lessons, the four, joined (else the first payment)] */
  const people = [
    [S.closes, ago(40 * DAY), first(113), 'watched'], [S.stamped, ago(40 * DAY), first(113), 'watched'],
    [S.lastLesson, ago(40 * DAY), [...first(113), counting.at(-1).id], 'watched'], [S.stillOver, ago(40 * DAY), first(118), 'watched'],
    [S.handedIn, ago(40 * DAY), first(113), 'handed in'], [S.young, ago(20 * DAY), first(113), 'watched'],
    [S.noDates, null, first(113), 'watched'], [S.twoOfFour, ago(40 * DAY), first(113), 'two'],
    [S.edge, ago(40 * DAY), first(112), 'watched'], [S.skipped, ago(40 * DAY), first(113), 'skipped'],
    [S.justOver, ago(30 * DAY + 3_600_000), first(113), 'watched'], [S.justUnder, ago(30 * DAY - 3_600_000), first(113), 'watched'],
    [S.oneWatched, ago(5 * DAY), ['a4l02'], 'watched'], [S.paidLater, ago(20 * DAY), first(113), 'watched', ago(60 * DAY)],
  ]
  ok(first(113).filter((id) => FOUR.includes(id)).length === 4 && !first(113).includes(counting.at(-1).id) && counting.length === 140,
     'the first 113 counting lessons hold the four and not the last lesson (a8l13); 140 count')
  await d.exec(`
    insert into students (id, supabase_user_id, email, first_paid_at, joined_at, whop_plan_id, membership_status) values
      ${people.map(([s, t, , , joined = t]) => `('${s}', '${s}', '${s.slice(-2)}@example.com', ${t ? `'${t}'` : 'null'}, ${joined ? `'${joined}'` : 'null'}, 'plan_4ZrwR4PmBsVsx', 'active')`).join(',\n      ')};
    insert into student_lesson_completions (student_id, lesson_id, completed_at, action_completed_at, discord_message_link, skipped_at) values
      ${people.flatMap(([s, , ids, four]) => four === 'two'
        ? [...rowsFor(s, ids.filter((id) => !['a4l04', 'a4l05'].includes(id))), ...rowsFor(s, ['a4l04', 'a4l05'], 'handed in')]
        : rowsFor(s, ids, four)).join(',\n      ')};
    insert into student_milestones (student_id, playbook_unlocked_at) values ('${S.stamped}', '${ago(10 * DAY)}')
      on conflict (student_id) do update set playbook_unlocked_at = excluded.playbook_unlocked_at;
    insert into templates (scenario_id, bucket, title, trigger_description, is_active, is_custom, trigger_config) values
      ('custom.a4-done', 'custom', 'Video Ads II done', 'x', true, true, '{"all":[{"metric":"region_complete","region":"a4","op":"is"}]}'),
      ('custom.a4-half', 'custom', 'Video Ads II half', 'x', true, true, '{"all":[{"metric":"region_completion_pct","region":"a4","op":"at_least","value":50}]}'),
      ('custom.a4-off', 'custom', 'Video Ads II done, off', 'x', false, true, '{"all":[{"metric":"region_complete","region":"a4","op":"is"}]}'),
      ('custom.a4-watched', 'custom', 'Video Ads II watched', 'x', true, true, '{"all":[{"metric":"region_lessons_watched","region":"a4","op":"at_least","value":3}]}'),
      ('custom.a3-done', 'custom', 'Video Ads I done', 'x', true, true, '{"all":[{"metric":"region_complete","region":"a3","op":"is"}]}'),
      ('custom.a4l02', 'custom', 'UGC edit not in', 'x', true, true, '{"all":[{"metric":"lesson_shipped","lesson_id":"a4l02","op":"is_not"}]}');`)

  // The lines as the app's own rules give them, worked out here from the same rows.
  const catalog = await rows(d, `select id, sort_order, requires_action, counts_toward_progress, feature_key from lessons order by sort_order`)
  const before = catalog.map((l) => (FOUR.includes(l.id) ? { ...l, requires_action: false } : l))
  const after = catalog.map((l) => (FOUR.includes(l.id) ? { ...l, requires_action: true } : l))
  const students = await rows(d, `select s.id::text, s.first_paid_at, s.joined_at, m.playbook_unlocked_at from students s left join student_milestones m on m.student_id = s.id`)
  const completions = await rows(d, `select student_id::text, lesson_id, completed_at, action_completed_at, skipped_at from student_lesson_completions`)
  const iso = (t) => (t ? new Date(t).toISOString() : null)
  const doneIn = (lessons, s) => {
    const byId = new Map(lessons.map((l) => [l.id, l]))
    return new Set(completions.filter((c) => c.student_id === s).filter((c) => isLessonComplete(c, byId.get(c.lesson_id))).map((c) => c.lesson_id))
  }
  const want = { a: 0, b: 0, c: [], d: [] }
  for (const s of students) {
    const student = { joined_at: iso(s.joined_at), first_paid_at: iso(s.first_paid_at) }
    const b4 = doneIn(before, s.id)
    const af = doneIn(after, s.id)
    const reopened = b4.size - af.size
    if (reopened > 0) { want.a++; want.b += reopened }
    const open = (lessons, done, now) => isPlaybookUnlocked({ student, completedLessonIds: done, lessons, unlockedAt: iso(s.playbook_unlocked_at), now })
    const since = new Date(student.first_paid_at ?? student.joined_at).getTime()
    if (open(before, b4, nowMs) && !open(after, af, nowMs)) want.c.push(s.id)
    if ((nowMs - since) / DAY < 30 && open(before, b4, since + 30 * DAY) && !open(after, af, since + 30 * DAY)) want.d.push(s.id)
  }
  want.c.sort(); want.d.sort()
  const templatesWant = (await rows(d, `select scenario_id, is_active, trigger_config from templates order by scenario_id`))
    .filter((t) => t.is_active && (t.trigger_config?.all ?? []).some((c) => ['region_complete', 'region_completion_pct'].includes(c.metric) && c.region === 'a4'))
    .map((t) => t.scenario_id)
  ok(same(want.c, [S.closes, S.noDates, S.twoOfFour, S.edge, S.justOver].sort()) && same(want.d, [S.young, S.justUnder, S.paidLater].sort()),
     'the app\'s rule (isPlaybookUnlocked) closes the Playbook for the five at 30 days or more who hold it by the 80% rule alone and fall under it, and delays it for the three under 30 days since the first payment (one of them joined 60 days ago); not for the stamped one, the one with the last lesson, the one still over 80%, the ones who handed the four in or skipped them',
     show({ c: want.c.map((x) => x.slice(-2)), d: want.d.map((x) => x.slice(-2)) }))

  const lines = (r) => Object.fromEntries((r.rows ?? []).map((x) => [x.line, x]))
  const was = await everything(d)
  const r = await paste(d, BEFORE_PASTE)
  const L = lines(r)
  ok(r.ok && same(r.cols, ['line', 'what', 'found', 'ids']) && same(Object.keys(L), ['a', 'b', 'c', 'd', 'e']) && await everything(d) === was,
     'it runs, five lines a to e, and changes nothing', r.ok ? Object.keys(L).join(',') : r.said)
  ok(L.a?.found === String(want.a) && L.b?.found === String(want.b),
     `a and b: ${want.a} students with a lesson v114 reopens, ${want.b} lessons, as isLessonComplete counts them before and after`, show([L.a?.found, L.b?.found]))
  ok(L.c?.found === String(want.c.length) && L.c?.ids === want.c.join(', '), 'c: the students whose Playbook it closes, by the app\'s own rule, with their ids', show(L.c))
  ok(L.d?.found === String(want.d.length) && L.d?.ids === want.d.join(', '), 'd: the students under 30 days whose Playbook it delays, with their ids', show(L.d))
  ok(L.e?.found === '2' && L.e?.ids === templatesWant.join(', ') && L.e?.ids === 'custom.a4-done, custom.a4-half',
     'e: the active templates with region_complete or region_completion_pct on a4, not the one turned off, not region_lessons_watched, not a3, not one naming a4l02', show(L.e))
  const after114 = await cloneOf(await d.dumpDataDir())
  const pasted = await paste(after114, V114)
  const again = await paste(after114, BEFORE_PASTE)
  ok(pasted.ok && again.ok && same(again.rows, r.rows), 'after v114 it reads the same five lines: it works both states out itself', show(lines(again).c))
  ok(want.c.every((s) => !isPlaybookUnlocked({ student: students.find((x) => x.id === s) ?? {}, completedLessonIds: doneIn(after, s), lessons: after, unlockedAt: null, now: nowMs })),
     'and those students\' Playbook is closed after v114')

  // The block at its foot: the stamp, on the owner's word only.
  const stamp = BEFORE_PASTE.slice(BEFORE_PASTE.indexOf("\n-- OPTIONAL, ON THE OWNER'S WORD ONLY")).split('\n').filter((l) => /^-- {4}/.test(l)).map((l) => l.slice(2)).join('\n')
  ok(/insert into public\.student_milestones/.test(stamp) && !/^\s*(with|insert|select)/m.test(BEFORE_PASTE.slice(BEFORE_PASTE.indexOf("\n-- OPTIONAL, ON THE OWNER'S WORD ONLY")).replace(/^--.*$/gm, '')),
     'the stamp at its foot is commented out: pasted whole, the file only reads')
  const s = await cloneOf(await d.dumpDataDir())
  const milestones = async () => (await rows(s, `select student_id::text as s, playbook_unlocked_at from student_milestones order by 1`)).map((x) => ({ s: x.s, at: iso(x.playbook_unlocked_at) }))
  const msBefore = await milestones()
  const restWas = await dump(s, ['student_milestones'])
  const stamped = await paste(s, stamp)
  const msAfter = await milestones()
  const newly = msAfter.filter((x) => x.at && !msBefore.find((y) => y.s === x.s && y.at === x.at)).map((x) => x.s).sort()
  ok(stamped.ok && same(newly, want.c) && same(msAfter.filter((x) => !want.c.includes(x.s)), msBefore.filter((x) => !want.c.includes(x.s))) && await dump(s, ['student_milestones']) === restWas,
     'the stamp, run alone, stamps exactly line c\'s students, keeps the stamp already there and touches no other row or table', show(newly.map((x) => x.slice(-2))))
  const afterStamp = lines(await paste(s, BEFORE_PASTE))
  ok(afterStamp.c?.found === '0' && afterStamp.d?.found === String(want.d.length), 'then the file again: line c reads 0, line d as before', show([afterStamp.c?.found, afterStamp.d?.found]))
  await paste(s, V114)
  const kept = await rows(s, `select student_id::text as s, playbook_unlocked_at from student_milestones where student_id in (${want.c.map((x) => `'${x}'`).join(', ')})`)
  ok(kept.length === want.c.length && kept.every((x) => isPlaybookUnlocked({ student: { joined_at: null }, completedLessonIds: new Set(), lessons: after, unlockedAt: iso(x.playbook_unlocked_at), now: nowMs })),
     'and after v114 their Playbook stays open, by the stamp')
}

finish()
