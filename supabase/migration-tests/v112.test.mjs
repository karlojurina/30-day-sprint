// v112 and its undo (the badges for the new course, 2026-10-21) on a real
// Postgres (PGlite), apart from run.mjs as v111's test is.
//
//   cd supabase/migration-tests && npm install && node --experimental-strip-types v112.test.mjs
//
// The database: base.sql, Supabase's default privileges on new tables in
// public, and the badge tables made by the real files in order: v53 (the
// tables, the first view and the seed), v56, v76, v90, v91, then v93's watch
// table and view lifted verbatim, then what the switch (v104) did to the
// catalog (the six old-course badges deleted, curriculum_reset_at written).
// Made-up students on that, each standing on one edge of a rule. Then v112 is
// pasted as the owner pastes it, and its two badge rules and the share are
// held to src/lib/achievement-rules.ts, the very file the app awards with.
// Every student here is made up.
import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'
import { countsInShare, mostFinishedInOneDay, sharePercent } from '../../src/lib/achievement-rules.ts'

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8')
const M = (f) => read(`../migrations/${f}`)
const V112 = M('2026_v112_new_achievements.sql')
const UNDO = read('../undo/2026_v112_undo.sql')

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? Number(x) : x))
/** Prints the count and exits: at the end, or early when a paste the rest stands on failed. */
function finish(why = '') {
  if (why) console.log(`\n  stopped: ${why}`)
  console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
  if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
  process.exit(0)
}
const same = (a, b) => show(a) === show(b)

// Lift a statement verbatim out of a real migration file (run.mjs's lift()).
function lift(file, startMarker, endMarker) {
  const s = M(file)
  const i = s.indexOf('\n' + startMarker) + 1
  if (i < 1) throw new Error(`marker not found in ${file}: ${startMarker}`)
  const j = s.indexOf(endMarker, i)
  if (j < 0) throw new Error(`end not found in ${file}`)
  return s.slice(i, j + endMarker.length)
}

// ── The moments ──────────────────────────────────────────────────────────────
const RESET = '2026-10-19T18:25:00.000Z'
/** The switch's date plus 6 days, 00:00 UTC: Habit Builder's cut. */
const CUT = '2026-10-25T00:00:00.000Z'

// ── The students ─────────────────────────────────────────────────────────────
const sid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const uid = (n) => `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`
const PEOPLE = {
  tt_batch3: { n: 1 }, tt_three: { n: 2 }, tt_mixed: { n: 3, status: 'past_due' }, tt_spread: { n: 4 },
  tt_action: { n: 5 }, tt_action_late: { n: 6 }, tt_midnight: { n: 7 }, tt_skip: { n: 8 }, tt_catchup: { n: 9 },
  tt_new: { n: 10 },
  hb_old: { n: 11 }, hb_before: { n: 12 }, hb_at: { n: 13 }, hb_later: { n: 14 },
  rs1: { n: 15 }, rs2: { n: 16, status: 'canceled' }, s14: { n: 17 },
  never_opened: { n: 18 }, canceled: { n: 19, status: 'canceled' }, expired: { n: 20, status: 'expired' },
  no_status: { n: 21, status: null }, exempt: { n: 22, exempt: true }, team: { n: 23, team: true },
  bounty: { n: 24, status: 'past_due' }, discount: { n: 25 },
}
const S = (name) => sid(PEOPLE[name].n)

// [lesson, completed_at, action_completed_at, skipped_at]; a time shared by
// two rows of a student is a sync's (the statement's own now()).
const SYNC_A = '2026-10-20T09:00:00.123456Z'
const SYNC_B = '2026-10-20T07:00:00.654321Z'
const SYNC_C = '2026-10-20T12:00:00.111111Z'
const ROWS = {
  // three lessons from one sync: no day
  tt_batch3: [['a1l01', SYNC_A], ['a1l02', SYNC_A], ['a1l03', SYNC_A]],
  // three lessons finished on their own on 20 October
  tt_three: [['a1l01', '2026-10-20T08:00:01Z'], ['a1l02', '2026-10-20T09:10:02Z'], ['a1l03', '2026-10-20T21:30:03Z']],
  // two on their own and two from one sync, all on 20 October: 2
  tt_mixed: [['a1l01', '2026-10-20T08:00:01Z'], ['a1l02', '2026-10-20T10:00:02Z'], ['a1l03', SYNC_A], ['a1l04', SYNC_A]],
  // three on three days
  tt_spread: [['a1l01', '2026-10-19T20:00:00Z'], ['a1l02', '2026-10-20T20:00:00Z'], ['a1l03', '2026-10-21T20:00:00Z']],
  // two on their own, and a video action item whose video came in a sync at 07:00 and whose action was
  // pressed at 10:00: finished at 10:00, so 3 on 20 October (a2l01 from the same sync: no day)
  tt_action: [['a1l01', '2026-10-20T08:00:00Z'], ['a1l02', '2026-10-20T08:30:00Z'],
              ['a1l07', SYNC_B, '2026-10-20T10:00:00Z'], ['a2l01', SYNC_B]],
  // the same, but the sync brought the video at 12:00, after the action at 10:00: no telling, 2
  tt_action_late: [['a1l01', '2026-10-20T08:00:00Z'], ['a1l02', '2026-10-20T08:30:00Z'],
                   ['a1l07', SYNC_C, '2026-10-20T10:00:00Z'], ['a2l01', SYNC_C]],
  // two before midnight, one after (UTC): 2
  tt_midnight: [['a1l01', '2026-10-20T23:59:58Z'], ['a1l02', '2026-10-20T23:59:59Z'], ['a1l03', '2026-10-21T00:00:01Z']],
  // two finished and one skipped: 2
  tt_skip: [['a1l01', '2026-10-20T08:00:00Z'], ['a1l02', '2026-10-20T09:00:00Z'], ['a1l03', null, null, '2026-10-20T10:00:00Z']],
  // the catch-up's rows: Whop's own times, before the switch
  tt_catchup: [['a2l01', '2026-10-10T10:00:00Z'], ['a2l02', '2026-10-10T12:00:00Z'], ['a2l03', '2026-10-10T15:00:00Z']],
  // meets the rule and does not hold the badge: v112 gives nobody a badge
  tt_new: [['a1l01', '2026-10-21T08:00:00Z'], ['a1l02', '2026-10-21T09:00:00Z'], ['a1l03', '2026-10-21T10:00:00Z']],
  hb_old: [['a1l01', '2026-10-20T08:00:00Z']],
  rs1: [['a1l01', '2026-10-20T08:00:00Z']],
  canceled: [['a1l01', '2026-10-01T08:00:00Z']],
  discount: [['a1l08', '2026-10-20T11:00:00Z', '2026-10-20T11:00:00Z']],
}

// Who holds what before v112, and since when.
const HELD = [
  ...['tt_batch3', 'tt_three', 'tt_mixed', 'tt_spread', 'tt_action', 'tt_action_late', 'tt_midnight', 'tt_skip', 'tt_catchup']
    .map((p) => [p, 'triple_play', '2026-10-20T12:00:00Z']),
  ...['tt_batch3', 'tt_three', 'tt_mixed', 'tt_spread', 'tt_action', 'tt_action_late', 'tt_midnight', 'tt_skip', 'tt_catchup',
      'tt_new', 'hb_old', 'rs1', 'canceled', 'exempt', 'team', 'discount'].map((p) => [p, 'first_lesson', '2026-10-20T08:05:00Z']),
  ['hb_old', 'streak_7', '2026-10-20T10:00:00Z'],
  ['hb_before', 'streak_7', '2026-10-24T23:59:59.999Z'],
  ['hb_at', 'streak_7', '2026-10-25T00:00:00Z'],
  ['hb_later', 'streak_7', '2026-10-27T08:00:00Z'],
  ['rs1', 'region_sweep', '2026-10-20T12:00:00Z'], ['rs2', 'region_sweep', '2026-09-20T12:00:00Z'],
  ['s14', 'region_sweep', '2026-09-21T12:00:00Z'], ['s14', 'streak_14', '2026-10-20T08:00:00Z'],
  ['hb_later', 'streak_14', '2026-10-20T08:00:00Z'],
  ['bounty', 'bounty_access_claimed', '2026-09-30T08:00:00Z'],
  ['discount', 'discount_earned', '2026-10-20T13:00:00Z'], ['discount', 'first_action_shipped', '2026-10-20T11:00:00Z'],
]

const q = (s) => (s === null || s === undefined ? 'null' : `'${s}'`)

async function freshDb() {
  const db = new PGlite()
  await db.exec(read('base.sql'))
  await db.exec(`
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter role service_role bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    -- base.sql holds a small stand-in of the two badge tables; v53 makes the real ones. v53's view reads joined_at.
    drop table student_achievements; drop table achievements;
    alter table students add column joined_at timestamptz;
  `)
  for (const f of ['2026_v53_phase5_achievements.sql', '2026_v56_achievement_cleanup.sql', '2026_v76_drop_streak_30_again.sql',
                   '2026_v90_achievement_stats_and_copy.sql', '2026_v91_achievement_retier.sql']) await db.exec(M(f))
  await db.exec(lift('2026_v93_lesson_watch_telemetry.sql', 'create table if not exists public.student_lesson_watch (', '\n);'))
  await db.exec(lift('2026_v93_lesson_watch_telemetry.sql', 'create or replace view public.achievement_unlock_stats', 'group by a.id;'))
  await db.exec(`revoke select on public.achievement_unlock_stats from anon;`)
  // What the switch did to the catalog (v104, step 5) and the moment it wrote (step 8).
  await db.exec(`
    delete from public.achievements where id in ('r1_clear', 'r2_clear', 'r3_clear', 'r4_clear', 'early_finisher', 'speedrun');
    insert into admin_config (key, value) values ('curriculum_reset_at', '${RESET}');
    insert into regions (id, order_num, name, terrain) values ('a1', 1, 'Area one', 'shore'), ('a2', 2, 'Area two', 'shore');
    insert into lessons (id, region_id, day, type, title, requires_action) values
      ('a1l01', 'a1', 1, 'watch', 'L1', false), ('a1l02', 'a1', 1, 'watch', 'L2', false), ('a1l03', 'a1', 1, 'watch', 'L3', false),
      ('a1l04', 'a1', 1, 'watch', 'L4', false), ('a1l07', 'a1', 1, 'watch', 'L7', true), ('a1l08', 'a1', 1, 'setup', 'L8', true),
      ('a2l01', 'a2', 1, 'watch', 'M1', false), ('a2l02', 'a2', 1, 'watch', 'M2', false), ('a2l03', 'a2', 1, 'watch', 'M3', false);
  `)
  const students = Object.entries(PEOPLE).map(([name, p]) =>
    `('${sid(p.n)}', '${uid(p.n)}', '${name}@example.com', ${p.exempt ? 'true' : 'false'}, '2026-09-01T10:00:00Z', ${q(p.status === undefined ? 'active' : p.status)}, '2026-09-01T10:00:00Z')`)
  await db.exec(`insert into students (id, supabase_user_id, email, csm_exempt, first_paid_at, membership_status, joined_at) values ${students.join(', ')};`)
  await db.exec(`insert into team_members (id, email) values ('${uid(PEOPLE.team.n)}', 'team@example.com');`)
  const rows = Object.entries(ROWS).flatMap(([name, list]) =>
    list.map(([lesson, at, action = null, skip = null]) => `('${S(name)}', '${lesson}', ${q(at)}, ${q(action)}, ${q(skip)})`))
  await db.exec(`insert into student_lesson_completions (student_id, lesson_id, completed_at, action_completed_at, skipped_at) values ${rows.join(', ')};`)
  const held = HELD.map(([name, badge, at]) => `('${S(name)}', '${badge}', '${at}')`)
  await db.exec(`insert into student_achievements (student_id, achievement_id, unlocked_at) values ${held.join(', ')};`)
  return db
}

/** Runs a file as the SQL editor does: every statement; the last one's rows, or the refusal (rolled back). */
async function paste(db, sql) {
  try {
    const last = (await db.exec(sql)).at(-1)
    return { ok: true, rows: last.rows }
  } catch (e) {
    await db.exec('rollback;').catch(() => {})
    return { ok: false, code: e.code, said: e.message }
  }
}
const rows = async (db, sql) => (await db.query(sql)).rows
const one = async (db, sql) => (await rows(db, sql))[0]
const holders = async (db, badge) =>
  (await rows(db, `select s.email from student_achievements sa join students s on s.id = sa.student_id
                    where sa.achievement_id = '${badge}' order by 1`)).map((r) => r.email.replace('@example.com', ''))
/** Every row of the public tables the files touch, and the archive's, as JSON: what "nothing changed" compares. */
async function dump(db) {
  const out = {}
  for (const t of ['achievements', 'student_achievements', 'student_lesson_completions', 'students', 'admin_config']) {
    out[t] = await rows(db, `select * from public.${t} order by 1, 2`)
  }
  out.view = await rows(db, `select pg_get_viewdef('public.achievement_unlock_stats'::regclass, true) as d,
                                    obj_description('public.achievement_unlock_stats'::regclass, 'pg_class') as c`)
  out.stats = await rows(db, `select * from public.achievement_unlock_stats order by id`)
  for (const t of ['runs', 'achievements', 'student_achievements', 'view_before']) {
    out[`archive.${t}`] = (await one(db, `select to_regclass('archive_v112.${t}') is not null as there`)).there
      ? await rows(db, `select * from archive_v112.${t} order by 1`) : null
  }
  return show(out)
}
/** The final table as a map: line -> the row. */
const table = (r) => Object.fromEntries((r.rows ?? []).map((x) => [x.line, x]))
const KEEP = ['bounty_access_claimed', 'discount_earned', 'first_action_shipped', 'first_lesson', 'perfect_run', 'streak_7', 'triple_play', 'unbroken']

/** Triple Threat, worked out in JavaScript with the app's own rule, from the database's rows. */
async function tripleByTheApp(db) {
  const requiresAction = new Map((await rows(db, 'select id, requires_action from lessons')).map((l) => [l.id, l.requires_action === true]))
  const all = await rows(db, `select student_id::text as s, lesson_id,
      to_char(completed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as completed_at,
      to_char(action_completed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as action_completed_at,
      completed_at_real from student_lesson_completions`)
  const byStudent = new Map()
  for (const r of all) (byStudent.get(r.s) ?? byStudent.set(r.s, []).get(r.s)).push(r)
  return new Set([...byStudent].filter(([, list]) => mostFinishedInOneDay(list, requiresAction) >= 3).map(([s]) => s))
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n=== The database before v112 ===')
const db = await freshDb()
const BEFORE = {
  catalog: await rows(db, 'select * from achievements order by id'),
  badges: await rows(db, 'select * from student_achievements order by student_id, achievement_id'),
  view: await one(db, `select pg_get_viewdef('public.achievement_unlock_stats'::regclass, true) as d,
                              obj_description('public.achievement_unlock_stats'::regclass, 'pg_class') as c,
                              (select reloptions from pg_class where oid = 'public.achievement_unlock_stats'::regclass) as o`),
  members: Number((await one(db, 'select total_count from achievement_unlock_stats limit 1')).total_count),
}
ok(same(BEFORE.catalog.map((a) => a.id), ['bounty_access_claimed', 'discount_earned', 'first_action_shipped', 'first_lesson', 'perfect_run',
  'region_sweep', 'streak_14', 'streak_7', 'triple_play', 'unbroken']), 'the catalog is the ten the switch left (v53, v56, v76, v90, v91, then v104)',
   BEFORE.catalog.map((a) => a.id).join(' '))
ok(BEFORE.view.d.includes('first_paid_at') && BEFORE.view.d.includes('student_lesson_watch') && same(BEFORE.view.o, ['security_invoker=false']),
   'the share is v93\'s: paid since 25 May and used the app, security_invoker=false', `members ${BEFORE.members}`)

console.log('\n=== v112, pasted ===')
const first = await paste(db, V112)
ok(first.ok, 'it runs', first.said)
if (!first.ok) finish('the first paste failed, and every check after it reads its result')
const T1 = first.ok ? table(first) : {}
ok(/^v112 ran now, at \d{4}-\d\d-\d\dT[\d:.]+Z: 8 badges left, 13 badge rows taken away \(kept in archive_v112\.student_achievements\), 27 lesson rows read as finished at their own time\.$/.test(T1.v112?.value ?? ''),
   'its first row says what it did', T1.v112?.value)
{
  const cat = await rows(db, 'select * from achievements order by id')
  ok(same(cat.map((a) => a.id), KEEP), 'the catalog holds exactly the eight', cat.map((a) => a.id).join(' '))
  const words = Object.fromEntries(cat.map((a) => [a.id, a.description]))
  ok(words.first_action_shipped === 'Complete your first action item.' && words.discount_earned === 'Get the 30% off your next month approved.' &&
     words.perfect_run === 'Finish every lesson in the course.' && words.unbroken === 'Finish the whole course without breaking your streak.',
     'the four new sentences', show(words))
  const was = Object.fromEntries(BEFORE.catalog.map((a) => [a.id, a]))
  ok(cat.every((a) => a.name === was[a.id].name && a.rarity === was[a.id].rarity && a.sort_order === was[a.id].sort_order && a.icon === was[a.id].icon) &&
     ['first_lesson', 'triple_play', 'streak_7', 'bounty_access_claimed'].every((id) => words[id] === was[id].description),
     'every name, tier, order and icon as it was, and the other four sentences too', show(['first_lesson', 'triple_play', 'streak_7', 'bounty_access_claimed'].map((id) => words[id])))
  const student = cat.flatMap((a) => [a.name, a.description]).join(' ')
  ok(!/—|unlock|EcomTalent|month two|sprint|skipped/i.test(student), 'no em dash, no "unlock", no "EcomTalent", no month two, sprint or skipped in what students read')
}
{
  ok(same(await holders(db, 'region_sweep'), []) && same(await holders(db, 'streak_14'), []), 'nobody holds Region Sweep or Two Weeks Strong')
  ok(same(await holders(db, 'streak_7'), ['hb_at', 'hb_later']),
     'Habit Builder: taken from the holders of 20 October and of 23:59:59.999 on the 24th; kept from 00:00 on the 25th', show(await holders(db, 'streak_7')))
  ok(same(await holders(db, 'triple_play'), ['tt_action', 'tt_catchup', 'tt_three']),
     'Triple Threat kept for 3 lessons on one day (on their own; an action item at its action; Whop\'s own times), taken for a sync\'s 3, 2 + a sync\'s 2, 3 days, an action before its sync, midnight, a skip',
     show(await holders(db, 'triple_play')))
  ok(!(await holders(db, 'triple_play')).includes('tt_new'), 'and given to nobody: tt_new meets the rule and holds nothing new (the app awards it at their next lesson or visit)')
  const app = await tripleByTheApp(db)
  const kept = new Set((await rows(db, `select student_id::text as s from student_achievements where achievement_id = 'triple_play'`)).map((r) => r.s))
  const held = HELD.filter(([, b]) => b === 'triple_play').map(([p]) => S(p))
  ok(held.every((s) => kept.has(s) === app.has(s)) && app.has(S('tt_new')),
     'the SQL keeps exactly the holders src/lib/achievement-rules.ts says meet the rule (mostFinishedInOneDay, on the same rows)', `${kept.size} kept of ${held.length}`)
  for (const id of ['first_lesson', 'first_action_shipped', 'bounty_access_claimed', 'discount_earned']) {
    const was = BEFORE.badges.filter((b) => b.achievement_id === id).length
    const now = Number((await one(db, `select count(*) as n from student_achievements where achievement_id = '${id}'`)).n)
    ok(was === now, `${id}: every holder keeps it (${now})`)
  }
}
{
  const arch = await rows(db, `select s.email, a.achievement_id, a.unlocked_at, a.reason from archive_v112.student_achievements a
                               join students s on s.id = a.student_id order by a.achievement_id, s.email`)
  ok(arch.length === 13 && same([...new Set(arch.map((a) => a.reason))].sort(), [
       'Habit Builder earned before a 7-day streak on the new course was possible', 'Region Sweep is gone (v112)',
       'Triple Threat without 3 lessons really finished on one day', 'Two Weeks Strong is gone (v112)']),
     'the archive holds the 13 rows taken away, each with why', show(arch.map((a) => `${a.email.split('@')[0]}:${a.achievement_id}`)))
  const original = new Map(BEFORE.badges.map((b) => [`${b.student_id}|${b.achievement_id}`, b.unlocked_at.toISOString()]))
  const archived = await rows(db, 'select student_id::text as s, achievement_id, unlocked_at from archive_v112.student_achievements')
  ok(archived.every((a) => original.get(`${a.s}|${a.achievement_id}`) === a.unlocked_at.toISOString()), 'each with its own unlocked_at, as it was')
  ok(same(await rows(db, 'select id from archive_v112.achievements order by id'), BEFORE.catalog.map((a) => ({ id: a.id }))),
     'and the catalog as it was, all ten')
}
{
  const judged = await rows(db, `select s.email, c.lesson_id, c.completed_at_real from student_lesson_completions c
                                 join students s on s.id = c.student_id order by 1, 2`)
  const all = await rows(db, `select student_id::text as s, lesson_id, completed_at::text as at, completed_at_real from student_lesson_completions`)
  const wrong = all.filter((r) => r.at === null ? r.completed_at_real !== null
    : r.completed_at_real !== !all.some((o) => o.s === r.s && o.lesson_id !== r.lesson_id && o.at === r.at))
  ok(wrong.length === 0, 'completed_at_real: true for a time no other row of the student holds, false for a shared one, null with no completed_at', show(wrong))
  const count = (v) => judged.filter((r) => r.completed_at_real === v).length
  ok(count(true) === 27 && count(false) === 9 && count(null) === 1 && T1.lesson_rows_real_time?.value === '27' &&
     T1.lesson_rows_shared_time?.value === '9' && T1.lesson_rows_no_watch_time?.value === '1',
     'the final table counts them: 27 real, 9 a sync\'s, 1 with no watch time', show({ true: count(true), false: count(false), null: count(null) }))
  const col = await one(db, `select data_type, column_default, is_nullable,
                                    col_description('public.student_lesson_completions'::regclass, ordinal_position::int) as note
                               from information_schema.columns where table_name = 'student_lesson_completions' and column_name = 'completed_at_real'`)
  ok(col?.data_type === 'boolean' && col.column_default === null && col.is_nullable === 'YES' && /really finished/.test(col.note ?? ''),
     'the column: boolean, no default (a sync\'s new row is null), with a comment that says what it means', show(col))
}
{
  const cols = await rows(db, `select column_name, data_type from information_schema.columns where table_name = 'achievement_unlock_stats' order by ordinal_position`)
  ok(same(cols.map((c) => `${c.column_name} ${c.data_type}`), ['id text', 'unlocked_count bigint', 'total_count bigint', 'unlock_pct numeric']),
     'the view keeps its columns and their types (bigint, no cast)', show(cols))
  const opts = await one(db, `select reloptions from pg_class where oid = 'public.achievement_unlock_stats'::regclass`)
  ok(same(opts.reloptions, ['security_invoker=false']), 'and security_invoker=false', show(opts.reloptions))
  const priv = await one(db, `select has_table_privilege('anon', 'public.achievement_unlock_stats', 'select') as anon,
                                     has_table_privilege('authenticated', 'public.achievement_unlock_stats', 'select') as signed_in`)
  ok(priv.anon === false && priv.signed_in === true, 'a visitor cannot read it, a signed-in student can (the corner reads it)', show(priv))

  const people = await rows(db, `select s.id::text as id, s.email, s.membership_status, s.csm_exempt,
                                        exists (select 1 from team_members t where t.id = s.supabase_user_id) as is_team from students s`)
  const members = people.filter((p) => countsInShare(p))
  ok(same(members.map((p) => p.email.split('@')[0]).sort(), ['bounty', 'discount', 'hb_at', 'hb_before', 'hb_later', 'hb_old', 'never_opened',
       'rs1', 's14', 'tt_action', 'tt_action_late', 'tt_batch3', 'tt_catchup', 'tt_midnight', 'tt_mixed', 'tt_new', 'tt_skip', 'tt_spread', 'tt_three']),
     'who counts (achievement-rules.ts, countsInShare): active and past due, never opened the app included; not canceled, expired, no status, exempt or the team member',
     `${members.length} members`)
  const stats = await rows(db, 'select id, unlocked_count, total_count, unlock_pct from achievement_unlock_stats order by id')
  const ids = new Set(members.map((p) => p.id))
  const holdersOf = await rows(db, 'select achievement_id, student_id::text as s from student_achievements')
  const mismatch = stats.filter((st) => {
    const n = holdersOf.filter((h) => h.achievement_id === st.id && ids.has(h.s)).length
    return Number(st.total_count) !== members.length || Number(st.unlocked_count) !== n || Number(st.unlock_pct) !== sharePercent(n, members.length)
  })
  ok(stats.length === 8 && mismatch.length === 0,
     'each badge\'s share is its holders among them over every one of them, rounded as sharePercent says', show(stats.map((s) => `${s.id} ${s.unlocked_count}/${s.total_count} ${s.unlock_pct}`)))
  const fl = stats.find((s) => s.id === 'first_lesson')
  ok(Number(fl.unlocked_count) === 13 && Number(fl.unlock_pct) === 68.4,
     'First Steps: 16 hold it, 13 of them members (the canceled, exempt and team holders left out): 68.4%', show(fl))
  ok(T1.share_members_now?.value === '19' && T1.share_members_before?.value === String(BEFORE.members),
     'the final table: 19 members now, and the old count before', show({ now: T1.share_members_now?.value, before: T1.share_members_before?.value }))
}
{
  const rowsOut = first.rows.map((r) => r.line)
  ok(same(rowsOut, ['v112', 'first_lesson', 'triple_play', 'first_action_shipped', 'bounty_access_claimed', 'streak_7', 'discount_earned',
                    'perfect_run', 'unbroken', 'region_sweep', 'streak_14', 'share_members_now', 'share_members_before',
                    'habit_builder_counts_from', 'lesson_rows_real_time', 'lesson_rows_shared_time', 'lesson_rows_no_watch_time',
                    'badge_rows_in_the_archive']),
     'the final table: the sentence, the eight in their order, the two gone, then the counts', rowsOut.join(' '))
  const n = (line) => [T1[line]?.holders_before, T1[line]?.taken_away, T1[line]?.holders_now].map(Number)
  ok(same(n('triple_play'), [9, 6, 3]) && same(n('streak_7'), [4, 2, 2]) && same(n('region_sweep'), [3, 3, 0]) && same(n('streak_14'), [2, 2, 0]) &&
     same(n('first_lesson'), [16, 0, 16]) && T1.region_sweep?.badge === 'Region Sweep' && T1.streak_14?.badge === 'Two Weeks Strong',
     'each badge: holders before, taken away, holders now', show(['triple_play', 'streak_7', 'region_sweep', 'streak_14', 'first_lesson'].map((l) => [l, ...n(l)])))
  ok(T1.triple_play?.share_now === '15.8%' && T1.region_sweep?.share_now === null && T1.habit_builder_counts_from?.value === CUT &&
     T1.badge_rows_in_the_archive?.value === '13',
     'the share now beside each of the eight, the cut, the archive\'s rows', show({ tt: T1.triple_play?.share_now, cut: T1.habit_builder_counts_from?.value }))
}
{
  const priv = await rows(db, `select c.relname, has_table_privilege('authenticated', c.oid, 'select') as a,
                                      has_table_privilege('service_role', c.oid, 'select') as s, has_table_privilege('anon', c.oid, 'select') as v
                                 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'archive_v112' and c.relkind = 'r'`)
  ok(priv.length === 4 && priv.every((p) => !p.a && !p.s && !p.v), 'only the owner reads the archive (runs, the catalog, the view, the badge rows)', show(priv))
  const fk = await paste(db, `insert into student_achievements (student_id, achievement_id) values ('${S('rs1')}', 'region_sweep');`)
  ok(!fk.ok && fk.code === '23503', 'the old code\'s Region Sweep row is refused now (23503): why the header says deploy first', fk.code)
}

console.log('\n=== Pasted again ===')
{
  const before = await dump(db)
  const again = await paste(db, V112)
  ok(again.ok && /^v112 is in place since \d{4}-.+Z\. This run changed nothing\.$/.test(table(again).v112?.value ?? ''),
     'it says it is in place and changed nothing', table(again).v112?.value)
  ok(before === await dump(db), 'and nothing changed: every row, the view, the archive')
  ok(table(again).lesson_rows_real_time?.value === null && Number(table(again).triple_play?.taken_away) === 0, 'no row judged again, nothing taken away')
}

console.log('\n=== The old code still running after it, then a paste after the deploy ===')
{
  // The old code awards Habit Builder from old history and Triple Threat by the old count; the new code
  // awards tt_new, who meets the rule. A lesson row the new code wrote is marked as such; one a sync wrote is null.
  await db.exec(`
    insert into student_achievements (student_id, achievement_id, unlocked_at) values
      ('${S('hb_old')}', 'streak_7', '2026-10-21T15:00:00Z'), ('${S('tt_batch3')}', 'triple_play', '2026-10-21T15:00:00Z'),
      ('${S('tt_new')}', 'triple_play', '2026-10-21T15:00:00Z')
      on conflict (student_id, achievement_id) do nothing;
    insert into student_lesson_completions (student_id, lesson_id, completed_at, completed_at_real) values
      ('${S('hb_old')}', 'a1l02', '2026-10-21T10:00:00Z', true), ('${S('hb_old')}', 'a1l03', '2026-10-21T10:00:00Z', null);`)
  const flagsBefore = await rows(db, 'select student_id, lesson_id, completed_at_real from student_lesson_completions order by 1, 2')
  const r = await paste(db, V112)
  const T = r.ok ? table(r) : {}
  ok(r.ok && /^v112 ran again, at .+Z \(first run .+Z\): 2 badge rows taken away \(kept in archive_v112\.student_achievements\)\.$/.test(T.v112?.value ?? ''),
     'it says it ran again and took away 2', T.v112?.value)
  ok(same(await holders(db, 'streak_7'), ['hb_at', 'hb_later']) && same(await holders(db, 'triple_play'), ['tt_action', 'tt_catchup', 'tt_new', 'tt_three']),
     'the old code\'s two are gone, the new code\'s tt_new stays', show(await holders(db, 'triple_play')))
  ok(same(flagsBefore, await rows(db, 'select student_id, lesson_id, completed_at_real from student_lesson_completions order by 1, 2')),
     'and no lesson row is judged again: the new code\'s true and the sync\'s null stay as they were')
  const twice = await rows(db, `select count(*)::int as n from archive_v112.student_achievements where student_id = '${S('tt_batch3')}' and achievement_id = 'triple_play'`)
  ok(twice[0].n === 2 && Number((await one(db, 'select count(*) as n from archive_v112.runs')).n) === 2,
     'tt_batch3\'s Triple Threat is in the archive twice, once per run that took it; two runs recorded')
}

console.log('\n=== The undo, pasted twice, then v112 again ===')
{
  const flags = Number((await one(db, 'select count(*) as n from student_lesson_completions where completed_at_real is not null')).n)
  const u = await paste(db, UNDO)
  if (!u.ok) { ok(false, 'the undo runs', u.said); finish('the undo failed, and every check after it reads its result') }
  const row = u.rows?.[0] ?? {}
  ok(u.ok && /^v112 is undone: 13 badge rows are back and the catalog has 10 badges again\. The archive is now archive_v112_undone_\d{8}_\d{4}\.$/.test(row.v112_undo ?? ''),
     'its row says what it did', row.v112_undo ?? u.said)
  ok(row.badges_back === 13 && row.student_gone === 0 && row.held_again === 0 && row.badge_gone === 0 && row.catalog_rows_back === 2 &&
     row.completed_at_real_kept === flags,
     'the counts: 13 back (15 archived rows, two of them a second taking of the same badge, which comes back once), none gone or held again, 2 catalog rows, every flag kept', show(row))
  ok(same(await rows(db, 'select * from achievements order by id'), BEFORE.catalog), 'the catalog is back as it was, every column')
  const now = (await rows(db, 'select * from student_achievements order by student_id, achievement_id'))
  const extra = now.filter((b) => !BEFORE.badges.some((o) => o.student_id === b.student_id && o.achievement_id === b.achievement_id))
  ok(same(now.filter((b) => !extra.includes(b)), BEFORE.badges) && extra.length === 1 && extra[0].student_id === S('tt_new'),
     'every badge row is back with its first unlocked_at, and tt_new\'s, earned since, stays', show(extra.map((e) => e.achievement_id)))
  const view = await one(db, `select pg_get_viewdef('public.achievement_unlock_stats'::regclass, true) as d,
                                     obj_description('public.achievement_unlock_stats'::regclass, 'pg_class') as c,
                                     (select reloptions from pg_class where oid = 'public.achievement_unlock_stats'::regclass) as o`)
  ok(same(view, BEFORE.view), 'the view is back as it was: its query, its options and its comment')
  ok((await one(db, `select has_table_privilege('anon', 'public.achievement_unlock_stats', 'select') as a`)).a === false, 'and still not for a visitor')
  const col = await one(db, `select count(*)::int as n from information_schema.columns where table_name = 'student_lesson_completions' and column_name = 'completed_at_real'`)
  const kept = await one(db, `select count(*)::int as n from ${row.archive_renamed_to}.completed_at_real`)
  ok(col.n === 0 && kept.n === flags && (await one(db, `select to_regnamespace('archive_v112') is null as gone`)).gone,
     'completed_at_real is dropped, its values kept in the renamed archive, and archive_v112 is gone', `${kept.n} values kept`)
  const priv = await one(db, `select has_table_privilege('service_role', '${row.archive_renamed_to}.completed_at_real', 'select') as s`)
  ok(priv.s === false, 'the kept values: the owner only')

  const before = await dump(db)
  const u2 = await paste(db, UNDO)
  ok(u2.ok && u2.rows[0].v112_undo === 'v112 is not in place (there is no archive_v112.runs). This run changed nothing.' && before === await dump(db),
     'a second undo changes nothing and says so', u2.rows?.[0]?.v112_undo)

  const back = await paste(db, V112)
  const T = back.ok ? table(back) : {}
  ok(back.ok && /^v112 ran now/.test(T.v112?.value ?? '') && same(await holders(db, 'triple_play'), ['tt_action', 'tt_catchup', 'tt_new', 'tt_three']) &&
     same(await holders(db, 'streak_7'), ['hb_at', 'hb_later']) && T.lesson_rows_real_time?.value !== null,
     'v112 runs again after it, as a first run: the rows judged again, the same badges taken', T.v112?.value)
}

console.log('\n=== When it refuses, nothing changes ===')
for (const [label, setup, sentence] of [
  ['the switch has not run', `delete from admin_config where key = 'curriculum_reset_at';`, 'The course switch has not run here'],
  ['the switch\'s value is no time', `update admin_config set value = 'not a time' where key = 'curriculum_reset_at';`, 'which is not a date and time'],
  ['a kept badge is missing', `delete from student_achievements where achievement_id = 'unbroken'; delete from achievements where id = 'unbroken';`, 'These badges are missing from achievements: unbroken'],
  ['a badge it does not know', `insert into achievements (id, name, description, icon, rarity, sort_order) values ('r1_clear', 'Foundation Set', 'x', '', 'common', 40);`, 'achievements holds badges v112 does not know: r1_clear'],
  ['an archive without its record', `create schema archive_v112;`, 'The schema archive_v112 is here without its record of runs'],
]) {
  const d = await freshDb()
  await d.exec(setup)
  const before = await dump(d)
  const r = await paste(d, V112)
  ok(!r.ok && r.code === 'P0001' && r.said.includes(sentence) && /Nothing was changed\.$/.test(r.said) && before === await dump(d),
     `${label}: refused with its sentence, nothing changed`, r.said?.slice(0, 120))
}
{
  const d = await freshDb()
  await d.exec(`drop table team_members cascade;`)
  const r = await paste(d, V112)
  ok(!r.ok && r.said.includes('v112 needs these tables and they are missing: team_members'), 'a missing table: named', r.said?.slice(0, 120))
}
{
  // The undo refuses on an archive missing a part, and on a name already taken.
  const d = await freshDb()
  await paste(d, V112)
  await d.exec('drop table archive_v112.view_before;')
  const before = await dump(d)
  const r = await paste(d, UNDO)
  ok(!r.ok && r.said.includes('archive_v112.view_before is missing') && /Nothing was changed\.$/.test(r.said) && before === await dump(d),
     'the undo with the view\'s copy missing: refused, nothing changed', r.said?.slice(0, 120))
}

console.log('\n=== The lock ===')
for (const [label, sql, word] of [['v112', V112, 'v112 did not start'], ['the undo', UNDO, 'the undo did not start']]) {
  const d = await freshDb()
  const upToLock = sql.slice(0, sql.indexOf('$lock$;') + '$lock$;'.length)
  await d.exec(upToLock)
  const locked = await rows(d, `select c.relname from pg_locks l join pg_class c on c.oid = l.relation
                                 where l.pid = pg_backend_pid() and l.mode = 'AccessExclusiveLock' and c.relkind = 'r' order by 1`)
  const timeout = await one(d, `select current_setting('lock_timeout') as t`)
  await d.exec('rollback;')
  ok(same(locked.map((r) => r.relname), ['achievements', 'student_achievements', 'student_lesson_completions']) && timeout.t === '5s',
     `${label}: before its first read it holds the three tables in ACCESS EXCLUSIVE, waiting 5 s at most`, show(locked.map((r) => r.relname)))
  const timedOut = sql.replace("execute 'lock table ' || v_list || ' in access exclusive mode';",
    "raise exception using errcode = '55P03', message = 'canceling statement due to lock timeout';")
  ok(timedOut !== sql, `${label}: the lock statement is where the test expects it`)
  if (label === 'the undo') await paste(d, V112)
  const before = await dump(d)
  const r = await paste(d, timedOut)
  ok(!r.ok && r.code === '55P03' && r.said.includes(word) && r.said.endsWith('Nothing was changed. Paste it again in a minute.') && before === await dump(d),
     `${label}: a lock it cannot get stops it with its sentence, nothing changed`, r.said?.slice(0, 140))
}

finish()
