// supabase/diagnostics/eighty-closed-windows.sql (2026-10-26: the windows of
// the 30% that closed before the owner's 80% rule) on a real Postgres
// (PGlite), held to the app's own rule.
//
//   cd supabase/migration-tests && npm install && node --experimental-strip-types eighty-closed-windows.test.mjs
//
// THE DATABASE is the five tables the count reads, with the columns the app
// itself reads there (loadDiscountReads in src/lib/world/discount-server.ts
// and the 30% page's thirty-data.ts select them): the real course
// (course_catalog.json) in lessons in course order, a lesson_videos row for
// every lesson the development page's lengths file has a video for, and
// made-up students at every edge of the rule: first payments before 1
// October, at its first moment, in the shared window, at the launch, with
// their own 14 days ending just before and at the start of 26 October in
// Croatia, and still open; 48, 49, 60 and 61 videos in time, a video
// finished a millisecond after the deadline, videos past the gate, a row
// with no completed_at; requests none, rejected, rejected before the launch
// (which does not count), pending, approved, applied, and two of them.
//
// The count is the file as it is, its one now() pinned to a moment of the
// test's choosing. Every line it gives is held to the same count made with
// the real source: discount.ts (discountWindow, requiredLessons,
// videosNeeded, requestCounts, closedBeforeEighty) and discount-server.ts
// (toDiscountLessons, videoDoneIds), copied with their import lines pointed
// at each other as client-tests/build.mjs copies them. The file writes
// nothing: no statement but its select, and every table the same after it.
// Every student and id here is made up.
import { PGlite } from '@electric-sql/pglite'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8')
const SQL = read('../diagnostics/eighty-closed-windows.sql')
const COURSE = JSON.parse(read('../catalog/course_catalog.json'))
const LENGTHS = JSON.parse(read('../../src/app/dev/world-app/course-lengths.fixture.json'))

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? Number(x) : x))

// ── The app's rule, the real source ─────────────────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eighty-closed-windows-'))
function copy(rel, out, rewrites = []) {
  let s = read(rel)
  for (const [from, to] of rewrites) {
    if (!s.includes(from)) throw new Error(`${rel} has no ${from}`)
    s = s.split(from).join(to)
  }
  if (/from "@\//.test(s)) throw new Error(`an unrewritten @/ import remains in ${rel}`)
  fs.writeFileSync(path.join(tmp, out), s)
}
fs.writeFileSync(path.join(tmp, 'package.json'), '{ "type": "module" }')
copy('../../src/lib/constants.ts', 'constants.ts')
copy('../../src/lib/world/discount.ts', 'discount.ts', [['from "@/lib/constants"', 'from "./constants.ts"']])
copy('../../src/lib/world/discount-server.ts', 'discount-server.ts', [['from "./discount"', 'from "./discount.ts"']])
const D = await import(pathToFileURL(path.join(tmp, 'discount.ts')).href)
const S = await import(pathToFileURL(path.join(tmp, 'discount-server.ts')).href)
fs.rmSync(tmp, { recursive: true, force: true })

// ── The database ────────────────────────────────────────────────────────────
const db = new PGlite()
await db.exec(`
  create table public.lessons (
    id text primary key, type text not null, counts_toward_progress boolean not null default true,
    is_gate boolean not null default false, sort_order int not null, duration_seconds int);
  create table public.lesson_videos (lesson_id text primary key, created_at timestamptz not null default now());
  create table public.students (id uuid primary key, first_paid_at timestamptz, membership_status text);
  create table public.student_lesson_completions (
    id uuid primary key default gen_random_uuid(), student_id uuid not null, lesson_id text not null,
    completed_at timestamptz, unique (student_id, lesson_id));
  create table public.discount_requests (
    id uuid primary key default gen_random_uuid(), student_id uuid not null, status text not null, created_at timestamptz not null);
`)
const rows = COURSE.lessons.map((l, i) => ({
  id: l.id, type: l.type, counts_toward_progress: l.counts !== false, is_gate: l.gate === true, sort_order: i + 1, duration_seconds: LENGTHS[l.id] ?? null,
}))
for (const r of rows) {
  await db.query('insert into public.lessons (id, type, counts_toward_progress, is_gate, sort_order, duration_seconds) values ($1, $2, $3, $4, $5, $6)',
    [r.id, r.type, r.counts_toward_progress, r.is_gate, r.sort_order, r.duration_seconds])
}
for (const id of Object.keys(LENGTHS)) await db.query("insert into public.lesson_videos (lesson_id, created_at) values ($1, '2026-10-12T00:00:00Z')", [id])
const LESSONS = S.toDiscountLessons(rows, new Set(Object.keys(LENGTHS)))
const REQUIRED = D.requiredLessons(LESSONS).map((l) => l.id)
const NEEDED = D.videosNeeded(REQUIRED.length)
const gateAt = rows.findIndex((r) => r.is_gate)
const PAST_GATE = rows.slice(gateAt + 1, gateAt + 6).map((r) => r.id)
ok(REQUIRED.length === 61 && NEEDED === 49 && PAST_GATE.length === 5, 'the real course: 61 videos up to the gate, 49 needed, lessons past it to finish too', `${REQUIRED.length}, ${NEEDED}`)

/** The moment the count is read at: its now(). */
const AT = '2026-11-02T12:00:00.000Z'
const ms = (iso) => Date.parse(iso)
const iso = (t) => new Date(t).toISOString()
const DAY = 86_400_000

const students = []
let n = 0
/**
 * A made-up student: their first payment, how many of the 61 they finished by their deadline (the first `inTime` in
 * course order, an hour before it), more after it, lessons past the gate, and their requests.
 */
function student(why, paid, inTime, o = {}) {
  n++
  const id = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  const w = paid ? D.discountWindow(paid) : { closed: 'no-payment' }
  const ends = 'closed' in w ? ms(AT) : w.endsAt.getTime()
  const done = []
  // `skip`: lessons this student never opened, so their first `inTime` are the ones after them.
  const order = REQUIRED.filter((lesson) => !(o.skip ?? []).includes(lesson))
  for (const lesson of order.slice(0, inTime)) done.push({ lesson_id: lesson, completed_at: iso(ends - 3_600_000) })
  for (const lesson of order.slice(inTime, inTime + (o.late ?? 0))) done.push({ lesson_id: lesson, completed_at: iso(ends + 1) })
  for (const lesson of o.pastGate ? PAST_GATE : []) done.push({ lesson_id: lesson, completed_at: iso(ends - 3_600_000) })
  // The last one in time at the deadline's own millisecond, which counts (videoDoneIds: at or before it).
  if (o.atDeadline && inTime > 0) done[inTime - 1].completed_at = iso(ends)
  if (o.unfinished) done.push({ lesson_id: order[inTime + (o.late ?? 0)], completed_at: null })
  students.push({ id, why, paid, status: o.status ?? 'active', done, requests: (o.requests ?? []).map((r, i) => ({ id: `00000000-0000-4000-9000-${String(n * 10 + i).padStart(12, '0')}`, ...r })) })
}
const SHARED_PAID = '2026-10-02T10:00:00.000Z'
const req = (status, created_at = '2026-10-20T10:00:00.000Z') => ({ status, created_at })
// The shared window: a first payment from 1 October until the launch, closing at the end of 23 October in Croatia.
student('shared, 55 in time, no request', SHARED_PAID, 55)
student('shared, 49 in time, the least, no request', SHARED_PAID, 49)
student('shared, 48 in time and one a millisecond late', SHARED_PAID, 48, { late: 1 })
student('shared, 49 in time, the 49th at the deadline\'s own millisecond', SHARED_PAID, 49, { atDeadline: true })
// For the second catalog below, which takes a1l02, a1l04 and a1l06 out of the count (58 videos, 47 needed): 47 others
// in time are not enough of the 61 and exactly enough of the 58.
student('shared, 47 in time, never a1l02, a1l04 or a1l06', SHARED_PAID, 47, { skip: ['a1l02', 'a1l04', 'a1l06'] })
student('at the launch, a pending request from before it (not the shared window, so it does not count), 50', '2026-10-08T22:00:00.000Z', 50, { requests: [req('pending', '2026-10-07T10:00:00.000Z')] })
student('shared, 60 in time, canceled since', SHARED_PAID, 60, { status: 'canceled' })
student('shared, every video in time, no request (it could apply)', SHARED_PAID, 61)
student('shared, 52 in time and 5 lessons past the gate', SHARED_PAID, 52, { pastGate: true })
student('shared, 50 in time, one row with no completed_at', SHARED_PAID, 50, { unfinished: true })
student('shared, 57 in time, rejected', SHARED_PAID, 57, { requests: [req('rejected')] })
student('shared, 57 in time, pending', SHARED_PAID, 57, { requests: [req('pending')] })
student('shared, 57 in time, approved', SHARED_PAID, 57, { requests: [req('approved')] })
student('shared, 57 in time, applied', SHARED_PAID, 57, { requests: [req('applied')] })
student('shared, 57 in time, rejected before the launch (does not count)', SHARED_PAID, 57, { requests: [req('rejected', '2026-10-05T10:00:00.000Z')] })
student('shared, 57 in time, pending before the launch (counts)', SHARED_PAID, 57, { requests: [req('pending', '2026-10-05T10:00:00.000Z')] })
student('shared, 57 in time, rejected then pending again', SHARED_PAID, 57, { requests: [req('rejected', '2026-10-15T10:00:00.000Z'), req('pending', '2026-10-21T10:00:00.000Z')] })
student('shared, 57 in time, past_due', SHARED_PAID, 57, { status: 'past_due' })
student('at the first moment of 1 October, 53 in time', '2026-09-30T22:00:00.000Z', 53)
student('a millisecond before 1 October, 55 (never eligible)', '2026-09-30T21:59:59.999Z', 55)
student('no first payment, every video (never eligible)', null, 61)
student('the last moment before the launch, 51 (shared)', '2026-10-08T21:59:59.999Z', 51)
// Their own 14 days, from the launch on.
student('at the launch, 54 in time (own, ends 22 October)', '2026-10-08T22:00:00.000Z', 54)
student('own, ends a millisecond before 26 October in Croatia, 58', iso(ms(D.DISCOUNT_EIGHTY_FROM) - 14 * DAY - 1), 58)
student('own, ends at 26 October 00:00 in Croatia, 58', iso(ms(D.DISCOUNT_EIGHTY_FROM) - 14 * DAY), 58)
student('own, ends 27 October, 49, rejected', '2026-10-13T09:00:00.000Z', 49, { requests: [req('rejected', '2026-10-25T09:00:00.000Z')] })
student('own, ends 28 October, 60, no request', '2026-10-14T09:00:00.000Z', 60)
student('own, ends 30 October, 49 and 3 late', '2026-10-16T09:00:00.000Z', 49, { late: 3 })
student('own, still open at the count (ends 5 November), 55', '2026-10-22T09:00:00.000Z', 55)
student('own, still open, the count\'s own moment its deadline', iso(ms(AT) - 14 * DAY), 55)
student('own, a millisecond before the count closed, 55', iso(ms(AT) - 14 * DAY - 1), 55)
student('own, 12 in time', '2026-10-10T09:00:00.000Z', 12)

for (const s of students) {
  await db.query('insert into public.students (id, first_paid_at, membership_status) values ($1, $2, $3)', [s.id, s.paid, s.status])
  for (const c of s.done) await db.query('insert into public.student_lesson_completions (student_id, lesson_id, completed_at) values ($1, $2, $3)', [s.id, c.lesson_id, c.completed_at])
  for (const r of s.requests) await db.query('insert into public.discount_requests (id, student_id, status, created_at) values ($1, $2, $3, $4)', [r.id, s.id, r.status, r.created_at])
}

// ── The same count, by the app's rule ───────────────────────────────────────
const zagreb = (t) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zagreb', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(t)).map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`
}
/** The five lines by the app's rule, over the catalog as the database holds it now. */
async function byTheRule() {
  const catalog = (await db.query('select id, type, counts_toward_progress, is_gate, duration_seconds from public.lessons order by sort_order')).rows
  const videos = new Set((await db.query('select lesson_id from public.lesson_videos')).rows.map((r) => r.lesson_id))
  const required = D.requiredLessons(S.toDiscountLessons(catalog, videos)).map((l) => l.id)
  const needed = D.videosNeeded(required.length)
  const want = new Map(['a', 'b', 'c', 'd', 'e'].map((l) => [l, []]))
  for (const s of students) {
    const w = D.discountWindow(s.paid)
    if ('closed' in w) continue
    if (ms(AT) <= w.endsAt.getTime()) continue // still open: discountState says locked or ready, not expired
    const inTime = required.filter((id) => S.videoDoneIds(s.done, w.endsAt).has(id)).length
    if (needed === 0 || inTime < needed || inTime >= required.length) continue
    const deciding = s.requests.filter((r) => D.requestCounts(r, s.paid)).sort((a, b) => ms(b.created_at) - ms(a.created_at))[0]
    const before = D.closedBeforeEighty(w.endsAt.toISOString())
    const line = deciding == null ? (before ? 'a' : 'd') : deciding.status === 'rejected' ? (before ? 'b' : 'e') : deciding.status === 'pending' && before ? 'c' : null
    if (line) want.get(line).push({ ...s, endsAt: w.endsAt.getTime(), line })
  }
  return { want, total: required.length, needed }
}

// ── The file, as pasted, its now() pinned ───────────────────────────────────
const code = SQL.replace(/--.*$/gm, '')
ok((code.match(/\bnow\(\)/g) ?? []).length === 1, 'the file reads the clock once, now()')
ok(!/\b(insert|update|delete|alter|create|drop|truncate|grant|revoke|lock|call|do)\b/i.test(code) && (code.match(/;/g) ?? []).length === 1 && /^\s*with\b/.test(code),
   'one statement, a select: no write, no lock, no function call')
async function dump() {
  const out = {}
  for (const t of ['lessons', 'lesson_videos', 'students', 'student_lesson_completions', 'discount_requests']) {
    out[t] = (await db.query(`select * from public.${t} order by 1`)).rows
  }
  return show(out)
}
const pinned = SQL.replace('now()', `timestamptz '${AT}'`)
/** The file's five lines against the rule's, on the database as it is now. */
async function compare(label) {
  const before = await dump()
  const got = (await db.exec(pinned)).at(-1).rows
  const { want, total, needed } = await byTheRule()
  ok((await dump()) === before, `${label}: every table the same after the count`)
  ok(got.length === 5 && got.map((r) => r.line).join('') === 'abcde', `${label}: five lines, a to e`, show(got.map((r) => r.line)))
  for (const r of got) {
    const w = want.get(r.line)
    const ids = w.map((s) => s.id).sort()
    const deadlines = w.map((s) => s.endsAt).sort((x, y) => x - y)
    ok(Number(r.students) === w.length && (r.ids ?? null) === (ids.length ? ids.join(', ') : null)
         && Number(r.active_or_past_due) === w.filter((s) => s.status === 'active' || s.status === 'past_due').length
         && (r.first_deadline ?? null) === (deadlines.length ? zagreb(deadlines[0]) : null)
         && (r.last_deadline ?? null) === (deadlines.length ? zagreb(deadlines.at(-1)) : null),
       `${label}, ${total} videos and ${needed} needed: line ${r.line}, ${w.length} students, as the app's rule counts them, with their ids and deadlines in Croatia`,
       show({ sql: r, rule: w.map((s) => s.why) }))
  }
  return want
}
const want = await compare('the real course')
console.log([...want.values()].flat().map((s) => `       ${s.line}: ${s.why}`).join('\n'))
ok(want.get('a').length === 13 && want.get('b').length === 1 && want.get('c').length === 3 && want.get('d').length === 4 && want.get('e').length === 1,
   'the edges land where the rule puts them: 13 before the rule with no request (the 49th at the deadline\'s own millisecond counts; a rejection before the launch does not, nor a request from before the launch by a student of their own 14 days; 48 and one late, 47 others, every video, before 1 October, none on file and 12 are not there), 1 rejected, 3 pending (one from before the launch, one after a rejection), 4 from the rule on with none (26 October 00:00 itself, and a millisecond before the count; the count\'s own moment is still open), 1 rejected',
   show(Object.fromEntries([...want].map(([k, v]) => [k, v.map((s) => s.why)]))))

// Another catalog: up to the gate, a1l02 no longer counts, a1l04 is not a watch lesson and a1l06 has no video. 58
// videos, 47 needed: every student who watched them loses them from their count, and the lines move with the rule.
await db.exec(`
  update public.lessons set counts_toward_progress = false where id = 'a1l02';
  update public.lessons set type = 'quiz' where id = 'a1l04';
  delete from public.lesson_videos where lesson_id = 'a1l06';
`)
const moved = await compare('a lesson not counting, one of another type and one with no video')
ok(moved.get('a').length !== want.get('a').length || moved.get('d').length !== want.get('d').length || moved.get('c').length !== want.get('c').length,
   'and the lines did move (so the three filters were tried)', show(Object.fromEntries([...moved].map(([k, v]) => [k, v.length]))))

// Before the switch: no gate in public.lessons, so nothing is counted.
await db.exec('update public.lessons set is_gate = false')
const none = (await db.exec(pinned)).at(-1).rows
ok(none.length === 5 && none.every((r) => Number(r.students) === 0 && r.ids === null), 'no gate (before the switch): five lines, each 0')

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
