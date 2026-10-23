// v114 and its undo (2026-10-23: Video Ads II's four editing breakdowns,
// a4l02 to a4l05, become action items with a Discord link, the owner's
// decision of 2026-10-22 and 23) on a real Postgres (PGlite), in a file of its
// own as v111 to v113 are.
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
// again. Every refusal runs on a copy of the database as it was before v114
// (PGlite's dumpDataDir), and every copy is compared whole before and after:
// a refusal changes nothing. The lock is read from pg_locks, and a lock
// timeout is raised in its place. lesson_is_complete() (v92) is held to
// isLessonComplete (src/lib/progress.ts, the app's own rule) on every
// completion row, before v114 and after it. Every student, link and id here
// is made up.
import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'
import { isLessonComplete } from '../../src/lib/progress.ts'

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8')
const M = (f) => read(`../migrations/${f}`)
const V114 = M('2026_v114_video_ads_ii_action_items.sql')
const UNDO = read('../undo/2026_v114_undo.sql')
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
/** What no file here may touch: every table but lessons. Students' rows, lessons_next, the videos, the archive. */
const allButLessons = async (d) => dump(d, ['lessons'])
const lessonsNow = async (d) => rows(d, `select * from public.lessons order by sort_order, id`)
const fourNow = async (d) => rows(d, `select id, requires_action, action_brief from public.lessons where id in ('a4l02', 'a4l03', 'a4l04', 'a4l05') order by id`)
const catalogNow = async (d) => rows(d, `select ${CATALOG_COLS} from public.lessons order by sort_order`)
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
ok(same(await fourNow(db), FOUR.map((id) => ({ id, requires_action: false, action_brief: null }))), 'the four are plain videos with no brief, as on production')
ok((await one(db, `select count(*)::int as n from lessons where requires_action`)).n === 10, 'production\'s 10 action items')
const lessonsBefore = await lessonsNow(db)
const restBefore = await allButLessons(db)
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
    { lesson: null, title: null, action_item: null, brief: null, changed_now: null, v114: 'v114 ran now: 4 of the four made action items with a Discord link (a4l02, a4l03, a4l04, a4l05).' },
    ...FOUR.map((id) => ({ lesson: id, title: TITLES[id], action_item: true, brief: OWNER[id], changed_now: true, v114: null })),
  ]
  ok(same(first.rows, want), 'its first row says what it did, then each of the four with its title, its brief and "changed now", in course order', show(first.rows.map((r) => r.v114 ?? `${r.lesson} ${r.changed_now}`)))
  ok(same(await fourNow(db), FOUR.map((id) => ({ id, requires_action: true, action_brief: OWNER[id] }))), 'the four are action items with the owner\'s briefs')
  ok(same(await catalogNow(db), fileRows), 'and lessons now equals the data file on every lesson, in every catalog column: a catalog rebuilt from it agrees with v114')
  const after = await lessonsNow(db)
  const moved = after.filter((r, i) => !same(r, lessonsBefore[i])).map((r) => r.id)
  const fourElse = after.filter((r) => FOUR.includes(r.id)).every((r) => {
    const b = lessonsBefore.find((x) => x.id === r.id)
    const strip = (x) => without(x, ['requires_action', 'action_brief', 'updated_at'])
    return same(strip(r), strip(b)) && r.updated_at > b.updated_at
  })
  ok(same(moved, FOUR) && fourElse,
     'no other lesson moved in any column; on the four only requires_action, action_brief and updated_at (its trigger)', show(moved))
  ok((await one(db, `select count(*)::int as n from lessons where requires_action`)).n === 14, '14 action items now')
  ok(await allButLessons(db) === restBefore, 'every other table is as it was: every student\'s row, the watch row and the video row on a4l02, lessons_next, the archive')
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
  const studentsWere = await allButLessons(db)
  const u = await paste(db, UNDO)
  const T = u.ok ? table(u, 'undo') : {}
  ok(u.ok && same(u.cols, ['lesson', 'title', 'action_item', 'brief', 'this_run', 'v114_undo']), 'it runs, one table', u.ok ? u.cols.join(', ') : u.said)
  ok(T.undo?.v114_undo === "The v114 undo ran now: 4 of the four are plain videos again (a4l02, a4l03, a4l04, a4l05). No student's row was touched." &&
     FOUR.every((id) => T[id]?.this_run === 'put back to a plain video' && T[id]?.action_item === false && T[id]?.brief === null && T[id]?.title === TITLES[id]),
     'its first row says what it did, then each of the four "put back to a plain video"', T.undo?.v114_undo ?? u.said)
  const now = await lessonsNow(db)
  const strip = (x) => without(x, ['updated_at'])
  ok(same(now.map(strip), lessonsBefore.map(strip)) && same(now.filter((r) => !FOUR.includes(r.id)), lessonsBefore.filter((r) => !FOUR.includes(r.id))),
     'lessons is as it was before v114 in every column, updated_at aside on the four (their trigger)')
  ok(await allButLessons(db) === studentsWere, 'no student\'s row touched: a4l03\'s hand-in, its link and every other row, the watch row, the video row, lessons_next')
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
  ok(back.ok && /^v114 ran now: 4 of the four/.test(T3.v114?.v114 ?? '') && same(await catalogNow(db), fileRows) && doneAgain.done === true && (await progress(db))[WATCHED] === 2,
     'v114 runs again after it, as a first run, and the hand-in kept on the row counts again', T3.v114?.v114 ?? back.said)
}

console.log('\n=== The undo leaves a brief changed since ===')
{
  const d = await cloneOf(AFTER_HANDIN)
  await d.exec(`update lessons set action_brief = 'Edit the text on screen ad yourself and post it in Discord.' where id = 'a4l03';`)
  const studentsWere = await allButLessons(d)
  const u = await paste(d, UNDO)
  const T = u.ok ? table(u, 'undo') : {}
  ok(u.ok && /ran now: 3 of the four are plain videos again \(a4l02, a4l04, a4l05\)/.test(T.undo?.v114_undo ?? '') &&
     T.a4l03?.this_run === "left as it is: its brief is not v114's" && T.a4l03?.action_item === true && T.a4l03?.brief === 'Edit the text on screen ad yourself and post it in Discord.',
     'the three that hold v114\'s brief go back; a4l03, changed by hand, is left as it is and the table says why', show(T.a4l03))
  ok(await allButLessons(d) === studentsWere, 'no student\'s row touched')
  const again = await paste(d, V114)
  ok(!again.ok && again.code === 'P0001' && again.said.includes('These lessons are action items already, with another brief than v114\'s: a4l03') && /Nothing was changed\.$/.test(again.said),
     'v114 then refuses: a4l03 is an action item with another brief', again.said?.slice(0, 120))
}

console.log('\n=== When v114 refuses, nothing changes ===')
for (const [label, setup, sentence] of [
  ['one of the four missing', `delete from student_lesson_completions where lesson_id = 'a4l03'; delete from lessons where id = 'a4l03';`,
   'These lessons are not in public.lessons: a4l03.'],
  ['one of the four in another place', `update lessons set region_id = 'a5' where id = 'a4l04';`,
   'v114 is for Video Ads II (a4), and these lessons are not in it: a4l04 (in a5).'],
  ['one of the four not a watch lesson', `update lessons set type = 'setup' where id = 'a4l05';`,
   'v114 is for four watch lessons, and these are not watch lessons: a4l05 (setup).'],
  ['one of the four an action item with another brief', `update lessons set requires_action = true, action_brief = 'Post your UGC edit.' where id = 'a4l02';`,
   'These lessons are action items already, with another brief than v114\'s: a4l02 ("Post your UGC edit.").'],
  ['one of the four an action item with no brief', `update lessons set requires_action = true, action_brief = null where id = 'a4l02';`,
   'These lessons are action items already, with another brief than v114\'s: a4l02 ("no brief").'],
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
{
  // One of the four done by hand already, with v114's brief: the other three change, and the table says which.
  const d = await cloneOf(BEFORE_BLOB)
  await d.exec(`update lessons set requires_action = true, action_brief = '${OWNER.a4l02.replaceAll("'", "''")}' where id = 'a4l02';`)
  const r = await paste(d, V114)
  const T = r.ok ? table(r, 'v114') : {}
  ok(r.ok && T.v114?.v114 === 'v114 ran now: 3 of the four made action items with a Discord link (a4l03, a4l04, a4l05).' &&
     T.a4l02?.changed_now === false && ['a4l03', 'a4l04', 'a4l05'].every((id) => T[id]?.changed_now === true) && same(await catalogNow(d), fileRows),
     'a4l02 already v114\'s: only the other three change, and its row says so', T.v114?.v114 ?? r.said)
}

console.log('\n=== The lock ===')
for (const [label, sql, word] of [['v114', V114, 'so v114 did not start'], ['the undo', UNDO, 'so the v114 undo did not start']]) {
  const d = await cloneOf(BEFORE_BLOB)
  const upToLock = sql.slice(0, sql.indexOf('$lock$;') + '$lock$;'.length)
  await d.exec(upToLock)
  const locked = await rows(d, `select c.relname, l.mode from pg_locks l join pg_class c on c.oid = l.relation
                                 where l.pid = pg_backend_pid() and l.mode not in ('AccessShareLock') and c.relkind = 'r' order by 1`)
  const timeout = await one(d, `select current_setting('lock_timeout') as t`)
  await d.exec('rollback;')
  ok(same(locked, [{ relname: 'lessons', mode: 'ShareRowExclusiveLock' }]) && timeout.t === '5s',
     `${label}: before its first read it holds lessons alone, in SHARE ROW EXCLUSIVE (reads go on), waiting 5 s at most`, show(locked))
  const timedOut = sql.replace('lock table public.lessons in share row exclusive mode;',
    "raise exception using errcode = '55P03', message = 'canceling statement due to lock timeout';")
  ok(timedOut !== sql, `${label}: the lock statement is where the test expects it`)
  if (label === 'the undo') await paste(d, V114)
  const was = await everything(d)
  const r = await paste(d, timedOut)
  ok(!r.ok && r.code === '55P03' && r.said.includes(word) && r.said.endsWith('Nothing was changed. Paste it again in a minute.') && await everything(d) === was,
     `${label}: a lock it cannot get stops it with its sentence, nothing changed`, r.said?.slice(0, 140))
}

finish()
