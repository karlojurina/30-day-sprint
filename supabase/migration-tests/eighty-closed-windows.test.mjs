// supabase/diagnostics/eighty-closed-windows.sql (2026-10-26: the windows of
// the 30% that had closed by the owner's 80% rule, and where his call, B,
// leaves each student) on a real Postgres (PGlite), held to the app's own
// rule.
//
//   cd supabase/migration-tests && npm install && node --experimental-strip-types eighty-closed-windows.test.mjs
//
// THE DATABASE is the tables the count reads, with the columns the app itself
// reads there (loadDiscountReads in src/lib/world/discount-server.ts, the 30%
// page's thirty-data.ts and the coupon rows of v111): the real course
// (course_catalog.json) in lessons in course order, a lesson_videos row for
// every lesson the development page's lengths file has a video for, the
// course switch in admin_config, and made-up students at every edge of the
// rule: first payments before 1 October, at its first moment, in the shared
// window, at the launch, with their own 14 days ending just before and at
// the start of 26 October in Croatia, and still open; 45, 48, 49, 57, 60 and
// 61 videos in time, a video finished a millisecond after the deadline,
// videos past the gate, a row with no completed_at; requests none, rejected,
// rejected before the launch (which does not count), pending (from before
// the launch, from before the switch, after a rejection, after the
// deadline), approved, applied; stored coupon rows saying a coupon, saying
// no real payment, and one of another membership.
//
// The count is the file as it is, its one now() pinned to a moment of the
// test's choosing. Every line it gives is held to the same count made with
// the real source: discount.ts (discountWindow, requiredLessons,
// videosNeeded, requestCounts, closedBeforeEighty) and discount-server.ts
// (toDiscountLessons, videoDoneIds, approvalVerdict), copied with their
// import lines pointed at each other as client-tests/build.mjs copies them.
// Line c is approvalVerdict's own answer on every pending request the 30%
// page lists (the review of 2026-10-26: the file counted it by its own
// logic, which the approval's filters did not match). The file writes
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
/** The course switch (v104), as admin_config holds it: a request made before it is judged by the videos loaded by then. */
const RESET = '2026-10-19T14:33:00.000Z'
const db = new PGlite()
await db.exec(`
  create table public.lessons (
    id text primary key, type text not null, counts_toward_progress boolean not null default true,
    is_gate boolean not null default false, sort_order int not null, duration_seconds int);
  create table public.lesson_videos (lesson_id text primary key, created_at timestamptz not null default now());
  create table public.students (id uuid primary key, first_paid_at timestamptz, membership_status text, whop_membership_id text);
  create table public.student_lesson_completions (
    id uuid primary key default gen_random_uuid(), student_id uuid not null, lesson_id text not null,
    completed_at timestamptz, unique (student_id, lesson_id));
  create table public.discount_requests (
    id uuid primary key default gen_random_uuid(), student_id uuid not null, status text not null, created_at timestamptz not null);
  create table public.admin_config (key varchar(64) primary key, value text not null);
  create table public.student_membership_discounts (
    student_id uuid primary key, whop_membership_id text, promo_code_id text, promo_code text, renewal_price numeric,
    plan_renewal_price numeric, discounted boolean not null, checked_at timestamptz not null);
  insert into public.admin_config (key, value) values ('curriculum_reset_at', '${RESET}');
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
 * course order, an hour before it), more after it, lessons past the gate, their requests, the membership on file and
 * the coupon row stored for them.
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
  const membership = o.membership === undefined ? `mem_dev${String(n).padStart(4, '0')}` : o.membership
  students.push({
    id, why, paid, status: o.status ?? 'active', done, membership, coupon: o.coupon ?? null,
    requests: (o.requests ?? []).map((r, i) => ({ id: `00000000-0000-4000-9000-${String(n * 10 + i).padStart(12, '0')}`, ...r })),
  })
}
const SHARED_PAID = '2026-10-02T10:00:00.000Z'
const req = (status, created_at = '2026-10-20T10:00:00.000Z') => ({ status, created_at })
/** Stored coupon rows: a coupon, and the check's "no real payment" answer (no code, no price). */
const COUPON = { promo_code_id: 'promo_devEvolve', promo_code: 'evolve10', renewal_price: 87.3, discounted: true }
const NO_PAYMENT = { promo_code_id: null, promo_code: null, renewal_price: null, discounted: false }
// The shared window: a first payment from 1 October until the launch, closing at the end of 23 October in Croatia.
student('shared, 55 in time, no request', SHARED_PAID, 55)
student('shared, 49 in time, the least, no request', SHARED_PAID, 49)
student('shared, 48 in time and one a millisecond late', SHARED_PAID, 48, { late: 1 })
student('shared, 49 in time, the 49th at the deadline\'s own millisecond', SHARED_PAID, 49, { atDeadline: true })
// For the second catalog below, which takes a1l02, a1l04 and a1l06 out of the count (58 videos, 47 needed): 47 others
// in time are not enough of the 61 and exactly enough of the 58.
student('shared, 47 in time, never a1l02, a1l04 or a1l06', SHARED_PAID, 47, { skip: ['a1l02', 'a1l04', 'a1l06'] })
student('at the launch, a pending request from before it (the map leaves it out, the 30% page lists it), 50', '2026-10-08T22:00:00.000Z', 50, { requests: [req('pending', '2026-10-07T10:00:00.000Z')] })
student('shared, 60 in time, canceled since', SHARED_PAID, 60, { status: 'canceled' })
student('shared, every video in time, no request (it could apply)', SHARED_PAID, 61)
student('shared, 52 in time and 5 lessons past the gate', SHARED_PAID, 52, { pastGate: true })
student('shared, 50 in time, one row with no completed_at', SHARED_PAID, 50, { unfinished: true })
student('shared, 57 in time, rejected', SHARED_PAID, 57, { requests: [req('rejected')] })
student('shared, 57 in time, pending', SHARED_PAID, 57, { requests: [req('pending')] })
student('shared, 57 in time, approved', SHARED_PAID, 57, { requests: [req('approved')] })
student('shared, 57 in time, applied', SHARED_PAID, 57, { requests: [req('applied')] })
student('shared, 57 in time, rejected before the launch (does not count)', SHARED_PAID, 57, { requests: [req('rejected', '2026-10-05T10:00:00.000Z')] })
student('shared, 57 in time, pending on the old dashboard (counts, judged by the videos at the switch)', SHARED_PAID, 57, { requests: [req('pending', '2026-10-05T10:00:00.000Z')] })
student('shared, 57 in time, rejected then pending again (another request)', SHARED_PAID, 57, { requests: [req('rejected', '2026-10-15T10:00:00.000Z'), req('pending', '2026-10-21T10:00:00.000Z')] })
student('shared, 57 in time, pending made on 26 October (late)', SHARED_PAID, 57, { requests: [req('pending', '2026-10-26T09:00:00.000Z')] })
student('shared, 57 in time, pending made 5 minutes after the deadline (in time for a route\'s insert)', SHARED_PAID, 57, { requests: [req('pending', iso(ms(D.DISCOUNT_SHARED_DEADLINE) + 5 * 60_000))] })
student('shared, 57 in time, pending, a stored coupon for the membership on file', SHARED_PAID, 57, { requests: [req('pending')], coupon: COUPON })
student('shared, 57 in time, pending, a stored row saying no real payment', SHARED_PAID, 57, { requests: [req('pending')], coupon: NO_PAYMENT })
student('shared, 57 in time, pending, no real payment stored for another membership (it does not apply)', SHARED_PAID, 57, { requests: [req('pending')], coupon: { ...NO_PAYMENT, whop_membership_id: 'mem_devOther' } })
student('shared, 57 in time, pending, no membership on file, a stored row saying no real payment (it applies)', SHARED_PAID, 57, { requests: [req('pending')], coupon: NO_PAYMENT, membership: 'pay_devPayment' })
student('shared, 57 in time, pending, past_due', SHARED_PAID, 57, { requests: [req('pending')], status: 'past_due' })
student('shared, 61 in time, pending (every video: Approve passes it)', SHARED_PAID, 61, { requests: [req('pending')] })
student('shared, 45 in time, pending (under the 80%)', SHARED_PAID, 45, { requests: [req('pending')] })
student('shared, 49 in time, the 49th at the deadline\'s own millisecond, pending', SHARED_PAID, 49, { atDeadline: true, requests: [req('pending')] })
// For the phase below where the last 12 videos up to the gate are loaded on 22 October: an old-dashboard request
// judged by the 49 loaded by the switch, 45 of them in time; and a request of 20 October, 49 of 61 in time, 11 of
// them among the 12.
student('shared, an old-dashboard request, 45 of the first 49 in time', SHARED_PAID, 45, { skip: REQUIRED.slice(45, 49), requests: [req('pending', '2026-10-06T10:00:00.000Z')] })
student('shared, a request of 20 October, 49 of 61 in time, 11 of them among the last 12', SHARED_PAID, 49, { skip: REQUIRED.slice(38, 49), requests: [req('pending', '2026-10-20T10:00:00.000Z')] })
student('shared, 57 in time, past_due', SHARED_PAID, 57, { status: 'past_due' })
student('at the first moment of 1 October, 53 in time', '2026-09-30T22:00:00.000Z', 53)
student('a millisecond before 1 October, 55 (never eligible)', '2026-09-30T21:59:59.999Z', 55)
student('no first payment, every video (never eligible)', null, 61)
student('the last moment before the launch, 51 (shared)', '2026-10-08T21:59:59.999Z', 51)
// Their own 14 days, from the launch on.
student('at the launch, 54 in time (own, ends 22 October)', '2026-10-08T22:00:00.000Z', 54)
student('own, ends a millisecond before 26 October in Croatia, 58', iso(ms(D.DISCOUNT_EIGHTY_FROM) - 14 * DAY - 1), 58)
student('own, ends a millisecond before 26 October in Croatia, 55, pending', iso(ms(D.DISCOUNT_EIGHTY_FROM) - 14 * DAY - 1), 55, { requests: [req('pending', '2026-10-24T10:00:00.000Z')] })
student('own, ends at 26 October 00:00 in Croatia, 58', iso(ms(D.DISCOUNT_EIGHTY_FROM) - 14 * DAY), 58)
student('own, ends at 26 October 00:00 in Croatia, 55, pending (the 80% is its rule)', iso(ms(D.DISCOUNT_EIGHTY_FROM) - 14 * DAY), 55, { requests: [req('pending', '2026-10-24T10:00:00.000Z')] })
student('own, ends 27 October, 49, rejected', '2026-10-13T09:00:00.000Z', 49, { requests: [req('rejected', '2026-10-25T09:00:00.000Z')] })
student('own, ends 28 October, 60, no request', '2026-10-14T09:00:00.000Z', 60)
student('own, ends 30 October, 49 and 3 late', '2026-10-16T09:00:00.000Z', 49, { late: 3 })
student('own, still open at the count (ends 5 November), 55', '2026-10-22T09:00:00.000Z', 55)
student('own, still open, the count\'s own moment its deadline', iso(ms(AT) - 14 * DAY), 55)
student('own, a millisecond before the count closed, 55', iso(ms(AT) - 14 * DAY - 1), 55)
student('own, 12 in time', '2026-10-10T09:00:00.000Z', 12)

for (const s of students) {
  await db.query('insert into public.students (id, first_paid_at, membership_status, whop_membership_id) values ($1, $2, $3, $4)', [s.id, s.paid, s.status, s.membership])
  for (const c of s.done) await db.query('insert into public.student_lesson_completions (student_id, lesson_id, completed_at) values ($1, $2, $3)', [s.id, c.lesson_id, c.completed_at])
  for (const r of s.requests) await db.query('insert into public.discount_requests (id, student_id, status, created_at) values ($1, $2, $3, $4)', [r.id, s.id, r.status, r.created_at])
  if (s.coupon) {
    const c = { whop_membership_id: s.membership, plan_renewal_price: null, ...s.coupon }
    await db.query(`insert into public.student_membership_discounts (student_id, whop_membership_id, promo_code_id, promo_code, renewal_price, plan_renewal_price, discounted, checked_at)
                    values ($1, $2, $3, $4, $5, $6, $7, '2026-10-20T08:40:00Z')`, [s.id, c.whop_membership_id, c.promo_code_id, c.promo_code, c.renewal_price, c.plan_renewal_price, c.discounted])
  }
}

// ── The same count, by the app's rule ───────────────────────────────────────
const zagreb = (t) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zagreb', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(t)).map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`
}
const isMembershipId = (id) => typeof id === 'string' && /^mem_\w+$/.test(id)
/** One student's five reads, as loadDiscountReads makes them, from the database as it stands. */
const readsOf = (s, catalog, videoRows, done = s.done) => ({
  student: { data: { first_paid_at: s.paid }, error: null },
  lessons: { data: catalog, error: null },
  videos: { data: videoRows, error: null },
  completions: { data: done, error: null },
  requests: { data: s.requests.map((r) => ({ id: r.id, status: r.status, created_at: r.created_at, promo_code: null, rejection_reason: null })), error: null },
})
/** The five lines by the app's rule, over the database as it holds the catalog and the videos now. */
async function byTheRule() {
  const catalog = (await db.query('select id, type, counts_toward_progress, is_gate, duration_seconds from public.lessons order by sort_order')).rows
  const videoRows = (await db.query('select lesson_id, created_at from public.lesson_videos')).rows
    .map((v) => ({ lesson_id: v.lesson_id, created_at: v.created_at == null ? null : new Date(v.created_at).toISOString() }))
  const required = D.requiredLessons(S.toDiscountLessons(catalog, new Set(videoRows.map((v) => v.lesson_id)))).map((l) => l.id)
  const needed = D.videosNeeded(required.length)
  const coupons = new Map((await db.query('select * from public.student_membership_discounts')).rows.map((r) => [r.student_id, r]))
  const at = new Date(AT)
  const want = new Map(['a', 'b', 'c', 'd', 'e'].map((l) => [l, []]))
  const placed = new Map()
  for (const s of students) {
    const w = D.discountWindow(s.paid)
    if ('closed' in w) continue
    if (ms(AT) <= w.endsAt.getTime()) continue // still open: discountState says locked or ready, not expired
    const before = D.closedBeforeEighty(w.endsAt.toISOString())
    // The pending requests the 30% page lists (thirty-data.ts: every request made from 1 October).
    const listed = s.requests.filter((r) => r.status === 'pending' && ms(r.created_at) >= ms(D.DISCOUNT_ELIGIBLE_FROM))
    if (listed.length === 0) {
      const inTime = required.filter((id) => S.videoDoneIds(s.done, w.endsAt).has(id)).length
      if (needed === 0 || inTime < needed || inTime >= required.length) continue
      const deciding = s.requests.filter((r) => D.requestCounts(r, s.paid)).sort((a, b) => ms(b.created_at) - ms(a.created_at))[0]
      const line = deciding == null ? (before ? 'a' : 'd') : deciding.status === 'rejected' ? (before ? 'b' : 'e') : null
      if (line) {
        want.get(line).push({ ...s, endsAt: w.endsAt.getTime(), line, request: null })
        placed.set(s.why, line)
      }
      continue
    }
    if (!before) continue
    for (const r of listed) {
      // The 30% page judges the stored coupon row first (thirty-view.ts couponOf, storedRowApplies): a coupon, or no
      // real payment, refuses the normal Approve before the rule.
      const m = coupons.get(s.id)
      const applies = m != null && (!isMembershipId(s.membership) || m.whop_membership_id === s.membership)
      if (applies && (m.discounted || (m.promo_code_id == null && m.renewal_price == null))) continue
      // approvalVerdict, as the approve route calls it: refused over the videos, every one needed (the owner's B).
      const v = S.approvalVerdict(readsOf(s, catalog, videoRows), at, r.created_at, r.id, RESET)
      if (v.ok || v.reason !== 'locked') continue
      // What it judged: the videos loaded by the request (by the switch, for one made before it), done by the deadline.
      const asOf = ms(RESET) > ms(r.created_at) ? ms(RESET) : ms(r.created_at)
      const theirs = required.filter((id) => !videoRows.some((x) => x.lesson_id === id && x.created_at != null && ms(x.created_at) > asOf))
      const inTime = theirs.filter((id) => S.videoDoneIds(s.done, w.endsAt).has(id)).length
      if (theirs.length === 0 || inTime < D.videosNeeded(theirs.length) || inTime >= theirs.length) continue
      // Nothing else refuses it: with every one of those videos done in time, the normal Approve approves it.
      const all = [...s.done, ...theirs.map((id) => ({ lesson_id: id, completed_at: iso(w.endsAt.getTime() - 3_600_000) }))]
      if (!S.approvalVerdict(readsOf(s, catalog, videoRows, all), at, r.created_at, r.id, RESET).ok) continue
      want.get('c').push({ ...s, endsAt: w.endsAt.getTime(), line: 'c', request: r.id })
      placed.set(s.why, 'c')
    }
  }
  return { want, total: required.length, needed, placed }
}

// ── The file, as pasted, its now() pinned ───────────────────────────────────
const code = SQL.replace(/--.*$/gm, '')
ok((code.match(/\bnow\(\)/g) ?? []).length === 1, 'the file reads the clock once, now()')
ok(!/\b(insert|update|delete|alter|create|drop|truncate|grant|revoke|lock|call|do)\b/i.test(code) && (code.match(/;/g) ?? []).length === 1 && /^\s*with\b/.test(code),
   'one statement, a select: no write, no lock, no function call')
async function dump() {
  const out = {}
  for (const t of ['lessons', 'lesson_videos', 'students', 'student_lesson_completions', 'discount_requests', 'admin_config', 'student_membership_discounts']) {
    out[t] = (await db.query(`select * from public.${t} order by 1`)).rows
  }
  return show(out)
}
const pinned = SQL.replace('now()', `timestamptz '${AT}'`)
/** The file's five lines against the rule's, on the database as it is now. */
async function compare(label) {
  const before = await dump()
  const got = (await db.exec(pinned)).at(-1).rows
  const { want, total, needed, placed } = await byTheRule()
  ok((await dump()) === before, `${label}: every table the same after the count`)
  ok(got.length === 5 && got.map((r) => r.line).join('') === 'abcde', `${label}: five lines, a to e`, show(got.map((r) => r.line)))
  for (const r of got) {
    const w = want.get(r.line)
    const each = [...w].sort((x, y) => x.endsAt - y.endsAt || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0) || ((x.request ?? '') < (y.request ?? '') ? -1 : 1))
      .map((s) => `${zagreb(s.endsAt)} ${s.id}${s.request ? ` request ${s.request}` : ''}`)
    const people = new Set(w.map((s) => s.id))
    const deadlines = w.map((s) => s.endsAt).sort((x, y) => x - y)
    ok(Number(r.students) === people.size && (r.deadlines_and_ids ?? null) === (each.length ? each.join(', ') : null)
         && Number(r.active_or_past_due) === w.filter((s, i) => (s.status === 'active' || s.status === 'past_due') && w.findIndex((x) => x.id === s.id) === i).length
         && (r.first_deadline ?? null) === (deadlines.length ? zagreb(deadlines[0]) : null)
         && (r.last_deadline ?? null) === (deadlines.length ? zagreb(deadlines.at(-1)) : null),
       `${label}, ${total} videos and ${needed} needed: line ${r.line}, ${people.size} students, as the app's rule counts them, each with their deadline in Croatia`,
       show({ sql: r, rule: w.map((s) => s.why) }))
  }
  return { want, placed }
}
const main = await compare('the real course')
console.log([...main.want.values()].flat().map((s) => `       ${s.line}: ${s.why}`).join('\n'))
const lineOf = (placed, why) => {
  if (!students.some((s) => s.why === why)) throw new Error(`no student: ${why}`)
  return placed.get(why) ?? null
}
{
  const p = main.placed
  const at = (why) => lineOf(p, why)
  ok(at('shared, 57 in time, pending') === 'c' && at('shared, 57 in time, pending on the old dashboard (counts, judged by the videos at the switch)') === 'c'
       && at('at the launch, a pending request from before it (the map leaves it out, the 30% page lists it), 50') === 'c'
       && at('shared, 57 in time, pending made 5 minutes after the deadline (in time for a route\'s insert)') === 'c'
       && at('shared, 57 in time, pending, no real payment stored for another membership (it does not apply)') === 'c'
       && at('own, ends a millisecond before 26 October in Croatia, 55, pending') === 'c' && at('shared, 57 in time, pending, past_due') === 'c'
       && at('shared, 49 in time, the 49th at the deadline\'s own millisecond, pending') === 'c',
     'line c: the pending requests the 80% passed and every video refuses, an old-dashboard request (judged by the videos at the switch) and one the map leaves out among them (it was line a), one 5 minutes after the deadline, one a stored row of another membership does not reach, one whose 49th video came at the deadline\'s own millisecond')
  ok(at('shared, 57 in time, rejected then pending again (another request)') === null && at('shared, 57 in time, pending made on 26 October (late)') === null
       && at('shared, 57 in time, pending, a stored coupon for the membership on file') === null && at('shared, 57 in time, pending, a stored row saying no real payment') === null
       && at('shared, 57 in time, pending, no membership on file, a stored row saying no real payment (it applies)') === null
       && at('shared, 61 in time, pending (every video: Approve passes it)') === null && at('shared, 45 in time, pending (under the 80%)') === null,
     'never line c: beside a rejected request, made after the deadline, a stored coupon or no real payment refusing it first, every video done, under the 80% (the first two and the stored rows were line c until the review of 2026-10-26)')
  ok(at('own, ends at 26 October 00:00 in Croatia, 55, pending (the 80% is its rule)') === null && at('own, ends at 26 October 00:00 in Croatia, 58') === 'd',
     'a window ending at the rule\'s first moment: its pending request is the 80%\'s (Approve passes it, no line), and with none it is line d')
  ok(main.want.get('a').length === 12 && main.want.get('b').length === 1 && main.want.get('c').length === 9 && main.want.get('d').length === 4 && main.want.get('e').length === 1,
     'the edges land where the rule puts them: 12 before the rule with no request (the 49th at the deadline\'s own millisecond counts; a rejection before the launch does not; 48 and one late, 47 others, every video, before 1 October, none on file and 12 are not there), 1 rejected, 9 pending requests, 4 from the rule on with none (26 October 00:00 itself, and a millisecond before the count; the count\'s own moment is still open), 1 rejected',
     show(Object.fromEntries([...main.want].map(([k, v]) => [k, v.map((s) => s.why)]))))
}

// The last 12 videos up to the gate loaded on 22 October, after the switch and after the requests of the 20th: a
// request is judged by the videos there were when it was made (at the switch, for one made before it).
await db.query('update public.lesson_videos set created_at = $1 where lesson_id = any($2)', ['2026-10-22T00:00:00Z', REQUIRED.slice(49)])
const later = await compare('the last 12 videos loaded on 22 October')
{
  const at = (why) => lineOf(later.placed, why)
  ok(at('shared, an old-dashboard request, 45 of the first 49 in time') === 'c' && lineOf(main.placed, 'shared, an old-dashboard request, 45 of the first 49 in time') === null,
     'an old-dashboard request, 45 of the 49 loaded by the switch in time: line c once the other 12 are loaded later (the file counted it in no line until the review of 2026-10-26)')
  ok(at('shared, a request of 20 October, 49 of 61 in time, 11 of them among the last 12') === null && lineOf(main.placed, 'shared, a request of 20 October, 49 of 61 in time, 11 of them among the last 12') === 'c',
     'a request of 20 October, 49 of 61 with 11 among the 12 loaded later: judged by the 49 there were, 38 in time, under the 80%, so no line (the file put it in line c)')
}
await db.query("update public.lesson_videos set created_at = '2026-10-12T00:00:00Z'")

// Another catalog: up to the gate, a1l02 no longer counts, a1l04 is not a watch lesson and a1l06 has no video. 58
// videos, 47 needed: every student who watched them loses them from their count, and the lines move with the rule.
await db.exec(`
  update public.lessons set counts_toward_progress = false where id = 'a1l02';
  update public.lessons set type = 'quiz' where id = 'a1l04';
  delete from public.lesson_videos where lesson_id = 'a1l06';
`)
const moved = await compare('a lesson not counting, one of another type and one with no video')
ok(['a', 'c', 'd'].some((l) => moved.want.get(l).length !== main.want.get(l).length),
   'and the lines did move (so the three filters were tried)', show(Object.fromEntries([...moved.want].map(([k, v]) => [k, v.length]))))

// Before the switch: no gate in public.lessons, so nothing is counted.
await db.exec('update public.lessons set is_gate = false')
const none = (await db.exec(pinned)).at(-1).rows
ok(none.length === 5 && none.every((r) => Number(r.students) === 0 && r.deadlines_and_ids === null), 'no gate (before the switch): five lines, each 0')

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
