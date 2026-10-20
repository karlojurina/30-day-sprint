// The first-paid repair: POST /api/admin/first-paid-repair through the route's
// own POST (the first-paid fix, 2026-10-20). It sets every student's
// first_paid_at to their first real Whop payment, once: the live writers only
// fill an empty one, so a free membership's date stored before the fix is
// corrected here and nowhere else.
//
// What runs is the real source, copied by build.mjs: the route, the run
// (src/lib/first-paid-repair.ts), the walk (src/lib/first-payment.ts) on a
// stand-in for Whop's API that pages GET /api/v1/payments as Whop's v1 does,
// the 30%'s dates and requestCounts (src/lib/world/discount.ts), and the team
// login (admin-auth.ts, on the stand-in's auth and team_members), so 401 and
// 403 are its own answers. The database is stub-server.ts's stand-in.
//
// The clock is the suite's, as in whop-catchup.test.mjs: timers fire in the
// order they fall due, each moving the clock to its time, so the 240 s budget,
// the 285 s limit on one page and the 280 s limit on the writes pass in
// milliseconds and are measured.
//
// Every Whop id, email, name, key and secret here is made up.
import { POST as repair, maxDuration } from './_gen/first-paid-repair-route.ts'
import { planFirstPaidRepair, countRequestFlips } from './_gen/first-paid-repair.ts'
// useDb is no React hook; the alias keeps eslint's hook rule from reading it as one.
import { FakeDb, useDb as installDb } from './_gen/stub-server.ts'

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v)
const same = (a, b) => show(a) === show(b)

// ── The clock ────────────────────────────────────────────────────────────────
const RealDate = Date
const realSetTimeout = globalThis.setTimeout
const realClearTimeout = globalThis.clearTimeout
const realFetch = globalThis.fetch
const NOW = '2026-10-20T07:00:00.000Z'
let clock = RealDate.parse(NOW)
class Clock extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(clock)
    else super(...args)
  }
  static now() { return clock }
}
globalThis.Date = Clock
let timers = []
let timersSet = 0
let pumping = false
function pump() {
  if (pumping || timers.length === 0) return
  pumping = true
  realSetTimeout(() => {
    pumping = false
    timers.sort((a, b) => a.due - b.due || a.n - b.n)
    const t = timers.shift()
    if (t) {
      clock = Math.max(clock, t.due)
      t.fn(...t.args)
    }
    pump()
  }, 0)
}
globalThis.setTimeout = (fn, ms = 0, ...args) => {
  const t = { due: clock + Math.max(0, Number(ms) || 0), n: ++timersSet, fn, args, ref: () => t, unref: () => t }
  timers.push(t)
  pump()
  return t
}
globalThis.clearTimeout = (t) => { timers = timers.filter((x) => x !== t) }
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ── The deployment's values ──────────────────────────────────────────────────
const KEY = 'apik_made_up_for_tests'
const SECRET = 'cron-secret-made-up-for-tests'
process.env.WHOP_API_KEY = KEY
process.env.CRON_SECRET = SECRET

// ── Whop ─────────────────────────────────────────────────────────────────────
const W = (n) => `user_TEST${String(n).padStart(6, '0')}`
let payN = 0
const money = (n) => ({ amount: n.toFixed(2), currency: 'usd', decimals: 2, display_decimals: 2 })
/** One payment as GET /api/v1/payments lists it with Api-Version-Date 2026-10-15-1. */
const pay = (user, paidAt, total, extra = {}) => ({
  id: `pay_TEST${String(++payN).padStart(6, '0')}`,
  status: 'paid', substatus: 'succeeded', subtotal: money(total), total: money(total), refunded_amount: money(0),
  paid_at: paidAt, created_at: paidAt, billing_reason: 'subscription_create',
  user: { id: user, name: 'Made Up Buyer', username: 'madeupbuyer' },
  membership_id: `mem_TEST${payN}`, plan_id: 'plan_4ZrwR4PmBsVsx', product_id: 'prod_TESTcourse',
  ...extra,
})
let payments = []
let asked = []
let latency = 0
/** When set, answers the nth request (1-based) instead of the list. */
let answerWith = null
const answer = (body, status = 200) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url))
  asked.push({ path: u.pathname, params: Object.fromEntries(u.searchParams), headers: { ...(init.headers ?? {}) }, at: clock })
  if (latency > 0) await wait(latency)
  if (answerWith) {
    const got = await answerWith(asked.length, u)
    if (got) return got
  }
  if (u.pathname !== '/api/v1/payments') return answer({ error: 'not found' }, 404)
  const first = Number(u.searchParams.get('first') ?? 20)
  const after = u.searchParams.get('after')
  const from = after ? Number(after.slice(1)) : 0
  const list = [...payments]
    .sort((a, b) => RealDate.parse(b.created_at) - RealDate.parse(a.created_at))
    .filter((p) => !u.searchParams.get('status') || p.status === u.searchParams.get('status'))
  const more = list.length > from + first
  return answer({ data: list.slice(from, from + first), page_info: { has_next_page: more, end_cursor: more ? `c${from + first}` : null } })
}

// ── The students and their payments ──────────────────────────────────────────
const sid = (n) => `d0000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const TEAM = [
  { id: 'auth-founder', role: 'founder', email: 'founder@example.com', full_name: 'Made Up Founder' },
  { id: 'auth-csm', role: 'csm', email: 'csm@example.com', full_name: 'Made Up Csm' },
]
const USERS = { 'tok-founder': 'auth-founder', 'tok-csm': 'auth-csm' }
const student = (n, firstPaidAt, extra = {}) => ({
  id: sid(n), whop_user_id: W(n), email: `student${n}@example.com`, name: `Made Up Student ${n}`,
  membership_status: 'active', first_paid_at: firstPaidAt, ...extra,
})
// Dates as the database answers them (+00:00), as the app wrote them (Z), and the payments' paid_at.
const STUDENTS = [
  // 1. The report's student: free on 5 September (stored by the sync), bought on 14 October.
  student(1, '2026-09-05T10:00:00+00:00'),
  // 2. An ordinary buyer: the membership was created 2 seconds before the payment.
  student(2, '2026-10-12T09:00:00.000Z'),
  // 3. The same moment written two ways: unchanged.
  student(3, '2026-10-03T08:00:00+00:00'),
  // 4. A free member with a date stored: no payment, left as it is.
  student(4, '2026-09-01T12:00:00+00:00'),
  // 5. A free member, empty: left empty.
  student(5, null),
  // 6. Empty, paid on 15 October: the 30% opens.
  student(6, null),
  // 7. Empty, paid on 1 August.
  student(7, null),
  // 8. The course bought on 2 October, but a first payment for another product on 20 September: earlier, the 30% closes.
  student(8, '2026-10-02T10:00:00.000Z'),
  // 9. Stored after the launch, first paid before it: earlier, across the launch.
  student(9, '2026-10-10T10:00:00.000Z'),
  // 10. A 100% promo from 20 September, its first real charge on 20 October.
  student(10, '2026-09-20T10:00:00+00:00'),
  // 11. Paid on 15 September and refunded in full, nothing since: no payment, left as it is.
  student(11, '2026-09-15T10:00:00+00:00'),
  // 12. Refunded in part: still a payment, 30 seconds after the stored time.
  student(12, '2026-09-10T09:00:00+00:00'),
  // 13. Free on 25 September, paid on 3 October (the shared window), with an approved request from 4 October.
  student(13, '2026-09-25T10:00:00+00:00'),
  // 14. Canceled, the same moment: unchanged (every row with a Whop id is read, whatever its status).
  student(14, '2026-08-01T10:00:00+00:00', { membership_status: 'canceled' }),
]
const NO_WHOP = { id: sid(99), whop_user_id: null, email: 'nowhop@example.com', name: 'Made Up Nobody', first_paid_at: '2026-09-01T00:00:00+00:00' }
const PAYMENTS = () => [
  pay(W(1), '2026-09-05T10:00:00.000Z', 0), pay(W(1), '2026-10-14T10:00:05.000Z', 97), pay(W(1), '2026-11-14T10:00:05.000Z', 97),
  pay(W(2), '2026-10-12T09:00:02.000Z', 97),
  pay(W(3), '2026-10-03T08:00:00.000Z', 97),
  pay(W(4), '2026-09-01T12:00:00.000Z', 0),
  pay(W(6), '2026-10-15T11:00:00.000Z', 97),
  pay(W(7), '2026-08-01T09:00:00.000Z', 97),
  pay(W(8), '2026-09-20T10:00:00.000Z', 997, { product_id: 'prod_TESTbrands' }), pay(W(8), '2026-10-02T10:00:00.000Z', 97),
  pay(W(9), '2026-10-05T10:00:00.000Z', 97),
  pay(W(10), '2026-09-20T10:00:00.000Z', 0, { subtotal: money(97) }), pay(W(10), '2026-10-20T06:00:00.000Z', 97),
  pay(W(11), '2026-09-15T10:00:00.000Z', 97, { substatus: 'refunded', refunded_amount: money(97) }),
  pay(W(12), '2026-09-10T09:00:30.000Z', 97, { substatus: 'partially_refunded', refunded_amount: money(20) }),
  pay(W(13), '2026-10-03T10:00:00.000Z', 97),
  pay(W(14), '2026-08-01T10:00:00.000Z', 97, { status: 'paid' }),
  // Buyers the app does not know, enough to fill three pages.
  ...Array.from({ length: 230 }, (_, i) => pay(`user_TESTother${String(i).padStart(4, '0')}`, '2026-07-01T00:00:00.000Z', 97)),
]
const REQUESTS = [
  { id: 'req-13', student_id: sid(13), status: 'approved', created_at: '2026-10-04T10:00:00.000Z' },
  { id: 'req-1', student_id: sid(1), status: 'pending', created_at: '2026-10-15T10:00:00.000Z' },
]
/** What the repair should write: [student, from, to]. */
const CHANGES = [
  [1, '2026-09-05T10:00:00+00:00', '2026-10-14T10:00:05.000Z'],
  [2, '2026-10-12T09:00:00.000Z', '2026-10-12T09:00:02.000Z'],
  [6, null, '2026-10-15T11:00:00.000Z'],
  [7, null, '2026-08-01T09:00:00.000Z'],
  [8, '2026-10-02T10:00:00.000Z', '2026-09-20T10:00:00.000Z'],
  [9, '2026-10-10T10:00:00.000Z', '2026-10-05T10:00:00.000Z'],
  [10, '2026-09-20T10:00:00+00:00', '2026-10-20T06:00:00.000Z'],
  [12, '2026-09-10T09:00:00+00:00', '2026-09-10T09:00:30.000Z'],
  [13, '2026-09-25T10:00:00+00:00', '2026-10-03T10:00:00.000Z'],
].map(([n, from, to]) => [sid(n), from, to])

function freshDb({ students = STUDENTS, requests = REQUESTS } = {}) {
  const db = new FakeDb({
    students: [...students.map((s) => ({ ...s })), { ...NO_WHOP }],
    discount_requests: requests.map((r) => ({ ...r })),
    team_members: TEAM,
  }, USERS)
  installDb(db)
  payments = PAYMENTS()
  asked = []
  latency = 0
  answerWith = null
  timers = []
  clock = RealDate.parse(NOW)
  return db
}
const writes = (db) => db.log.filter((q) => q.op !== 'select')
const firstOf = (db, n) => db.rows('students').find((s) => s.id === sid(n))?.first_paid_at

// ── Calling the route ────────────────────────────────────────────────────────
const answers = []
const logged = []
async function quiet(fn) {
  const real = [console.log, console.info, console.warn, console.error]
  console.log = console.info = console.warn = console.error = (...a) => { logged.push(a.map(String).join(' ')) }
  try { return await fn() } finally { [console.log, console.info, console.warn, console.error] = real }
}
async function call(body, auth = `Bearer ${SECRET}`) {
  const headers = { 'content-type': 'application/json' }
  if (auth) headers.authorization = auth
  const startedAt = clock
  const res = await quiet(() => repair(new Request('http://app/api/admin/first-paid-repair', {
    method: 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body),
  })))
  const text = await res.text()
  answers.push(text)
  return { status: res.status, body: JSON.parse(text), text, took: clock - startedAt }
}

const PLAN_COUNTS = {
  students: { with_whop_id: 14, payment_found: 11, unchanged: 2, to_change: 9, no_payment: { date_stored: 2, empty: 1 } },
  moves: {
    later: { all: 5, under_a_minute: 2, a_day_or_more: 3 },
    earlier: { all: 2, under_a_minute: 0, a_day_or_more: 2 },
    from_empty: 2,
  },
  thirty: { opens_was_before_oct_1: 3, opens_was_empty: 1, closes: 1, to_after_launch: 2, to_before_launch: 1, requests_change: 1 },
}

console.log('\n=== Who may run it ===')
{
  ok(maxDuration === 300, 'maxDuration is 300, as every long route in the repo')
  let db = freshDb()
  let r = await call({ mode: 'dry' }, null)
  ok(r.status === 401 && r.body.error === 'Not authenticated' && asked.length === 0 && writes(db).length === 0,
     'no secret, no login: 401 from the real team login, Whop not asked, nothing written', show(r.body))
  r = await call({ mode: 'dry' }, 'Bearer not-a-token')
  ok(r.status === 401 && r.body.error === 'Invalid token' && asked.length === 0, 'a token nobody holds: 401', show(r.body))
  r = await call({ mode: 'write' }, 'Bearer tok-csm')
  ok(r.status === 403 && r.body.error === 'Requires role: founder or admin' && asked.length === 0 && writes(db).length === 0,
     'a CSM: 403, Whop never asked, nothing written', show(r.body))
  r = await call({ mode: 'dry' }, 'Bearer tok-founder')
  ok(r.status === 200 && r.body.ok === true, 'a founder: in', show({ status: r.status }))
  db = freshDb()
  process.env.CRON_SECRET = `  ${SECRET}\n`
  r = await call({ mode: 'dry' }, `Bearer ${SECRET}  `)
  ok(r.status === 200 && r.body.ok === true, 'CRON_SECRET from a terminal, stray spaces and a newline on either side: in (both sides trimmed)')
  process.env.CRON_SECRET = SECRET
}

console.log('\n=== What it refuses before any read ===')
{
  const db = freshDb()
  let r = await call({ mode: 'everything' })
  ok(r.status === 400 && asked.length === 0 && db.log.length === 0, 'another mode: 400, Whop and the database untouched', show(r.body))
  r = await call(undefined)
  ok(r.status === 400, 'no body: 400', show(r.body))
  delete process.env.WHOP_API_KEY
  r = await call({ mode: 'dry' })
  ok(r.status === 500 && r.body.error === 'WHOP_API_KEY is not set on this deployment. Nothing ran.' && asked.length === 0,
     'no WHOP_API_KEY: 500, naming the variable', r.body.error)
  process.env.WHOP_API_KEY = KEY
}

console.log('\n=== Dry: counts only, nothing written ===')
let dry
{
  const db = freshDb()
  const r = await call({ mode: 'dry' })
  dry = r.body
  ok(r.status === 200 && dry.ok === true && dry.mode === 'dry' && dry.run_started_at === NOW, 'answers 200, ok, dry, and the run\'s start', show({ ok: dry.ok, at: dry.run_started_at }))
  ok(writes(db).length === 0, 'not one insert, upsert, update or delete', show(writes(db).map((q) => `${q.op} ${q.table}`)))
  ok(same(dry.students, PLAN_COUNTS.students),
     '14 students with a Whop id: 11 with a payment, 2 of them unchanged, 9 to change; 2 with no payment and a date, 1 empty', show(dry.students))
  ok(same(dry.moves, PLAN_COUNTS.moves),
     'moves: 5 later (2 by under a minute, 3 by a day or more), 2 earlier (by days), 2 from empty', show(dry.moves))
  ok(same(dry.thirty, PLAN_COUNTS.thirty),
     'the 30%: opens for 3 dated before 1 October and 1 empty one, closes for 1, 2 move past the launch and 1 before it, 1 request starts counting', show(dry.thirty))
  const w = dry.walk
  ok(w.complete === true && w.stopped_because === 'done' && w.pages === 3 && w.requests === 3 && w.retried_429 === 0,
     'the walk: 3 pages, complete', show({ pages: w.pages, requests: w.requests }))
  ok(w.payments.seen === 247 && w.payments.kept === 243 && same(w.payments.skipped, { not_paid: 0, no_paid_at: 0, zero_total: 3, refunded: 1, no_user: 0 }) &&
     w.users_with_a_payment === 241, 'its counts: 247 payments, 243 kept, 3 at $0 and 1 refunded; 241 buyers (11 students, 230 others)', show(w.payments))
  const pageReqs = asked.filter((a) => a.path === '/api/v1/payments')
  ok(pageReqs.length === 3 && pageReqs.every((q) => q.headers['Api-Version-Date'] === '2026-10-15-1' && q.headers.Authorization === `Bearer ${KEY}` && !('user_id' in q.params) && q.params.status === 'paid'),
     'one walk: status=paid, no user filter, the key and the pinned version on every page')
  ok(db.calls('students', 'select').every((q) => q.filters.includes('whop_user_id is not null') && q.filters.some((f) => f.startsWith('range '))),
     'the students read takes only rows with a Whop id, paged past the 1,000-row cap', show(db.calls('students', 'select').map((q) => q.filters)))
  ok(!('changes' in dry) && !('rows' in dry), 'a dry answer has no change log and no rows')
}

console.log('\n=== The plan, as a function ===')
{
  const firstByUser = new Map([[W(1), '2026-10-14T10:00:05.000Z'], [W(2), '2026-10-12T09:00:00.000Z']])
  const plan = planFirstPaidRepair([
    { id: 'a', whop_user_id: W(1), first_paid_at: '2026-09-05T10:00:00+00:00' },
    { id: 'b', whop_user_id: W(2), first_paid_at: '2026-10-12T09:00:00+00:00' },
    { id: 'c', whop_user_id: W(3), first_paid_at: null },
    { id: 'd', whop_user_id: W(1), first_paid_at: 'not a date' },
  ], firstByUser)
  ok(same(plan.changes, [{ id: 'a', from: '2026-09-05T10:00:00+00:00', to: '2026-10-14T10:00:05.000Z' }, { id: 'd', from: 'not a date', to: '2026-10-14T10:00:05.000Z' }]),
     'a stored date and a payment at another time change; the same time written two ways does not; no payment stays out', show(plan.changes))
  ok(plan.moves.from_empty === 1 && plan.thirty.opens_was_empty === 1, 'a stored value that does not read counts as empty (its guard still names it)')
  ok(countRequestFlips([{ id: 'x', from: '2026-09-25T00:00:00Z', to: '2026-10-03T00:00:00Z' }], [{ student_id: 'x', status: 'approved', created_at: '2026-10-04T00:00:00Z' }]) === 1 &&
     countRequestFlips([{ id: 'x', from: '2026-09-25T00:00:00Z', to: '2026-10-03T00:00:00Z' }], [{ student_id: 'x', status: 'rejected', created_at: '2026-10-04T00:00:00Z' }]) === 0 &&
     countRequestFlips([{ id: 'x', from: '2026-09-05T00:00:00Z', to: '2026-10-14T00:00:00Z' }], [{ student_id: 'x', status: 'pending', created_at: '2026-10-15T00:00:00Z' }]) === 0,
     'a request flips when requestCounts reads it differently: an approval from before the launch, into the shared window, yes; a rejected one or one from after the launch, no')
}

console.log('\n=== The snapshot: the rows the write would change, nothing written ===')
{
  const db = freshDb()
  const r = await call({ mode: 'snapshot' })
  const s = r.body
  ok(r.status === 200 && s.ok === true && s.mode === 'snapshot' && typeof s.taken_at === 'string', 'answers 200 with the time the students were read', show({ ok: s.ok, at: s.taken_at }))
  ok(writes(db).length === 0, 'nothing written')
  ok(same(s.columns, ['student_id', 'first_paid_at']) && s.counts.rows === 9 && same(s.rows, CHANGES.map(([id, from]) => [id, from])),
     'every row the write would change, [student id, first_paid_at], the value as it is stored now, and only those', show(s.rows.slice(0, 3)))
  ok(!('students' in s) && !('changes' in s), 'no counts beyond the rows, no change log')
}

console.log('\n=== Write: each change with its guard, the change log, then a second write changes 0 ===')
{
  const db = freshDb()
  const r = await call({ mode: 'write' })
  const w = r.body
  ok(r.status === 200 && w.ok === true && w.mode === 'write', 'answers 200, ok, write', show({ ok: w.ok, kind: w.kind }))
  ok(same(w.students, dry.students) && same(w.moves, dry.moves) && same(w.thirty, dry.thirty), 'the dry run\'s counts')
  ok(w.written === 9 && w.changed_meanwhile === 0 && w.write_failed === 0 && w.not_started === 0, 'written 9, none changed meanwhile, none failed, none left', show(w))
  ok(same(w.changes, CHANGES), 'the change log: [student id, old, new] for each row written, in student order', show(w.changes.slice(0, 2)))
  ok(firstOf(db, 1) === '2026-10-14T10:00:05.000Z', 'the report\'s student: from 5 September (his free membership) to 14 October, his first payment', firstOf(db, 1))
  ok(firstOf(db, 4) === '2026-09-01T12:00:00+00:00' && firstOf(db, 5) === null && firstOf(db, 11) === '2026-09-15T10:00:00+00:00',
     'no payment: a free member\'s date, an empty row and a refunded buyer\'s date are left exactly as they were, never emptied')
  ok(firstOf(db, 3) === '2026-10-03T08:00:00+00:00' && firstOf(db, 14) === '2026-08-01T10:00:00+00:00', 'the unchanged ones are not even written')
  ok(db.rows('students').find((s) => s.id === sid(99)).first_paid_at === '2026-09-01T00:00:00+00:00', 'a row with no Whop id is not touched')
  const updates = db.calls('students', 'update')
  ok(updates.length === 9 && updates.every((q) => q.filters.length === 2 && q.filters[0].startsWith('id=') &&
     (q.filters[1] === 'first_paid_at is null' || q.filters[1].startsWith('first_paid_at='))),
     'each write: this row, and only while it still holds the value read (an equal, or is null)', show(updates.slice(0, 2).map((q) => q.filters)))
  ok(db.calls('students', 'update').every((q) => Object.keys(q.values).join() === 'first_paid_at'), 'and it writes first_paid_at and nothing else')

  const before = show(db.rows('students'))
  const again = await call({ mode: 'write' })
  ok(again.body.ok === true && again.body.students.to_change === 0 && again.body.written === 0 && same(again.body.changes, []) &&
     again.body.students.unchanged === 11, 'a second write right after: 0 to change, 0 written, all 11 with a payment unchanged', show(again.body.students))
  ok(show(db.rows('students')) === before, 'and every row is as the first write left it')
}

console.log('\n=== A row changed between the read and the write: the guard leaves it ===')
{
  const db = freshDb()
  // As the write's update for 2 and for 6 goes out: 2 is corrected by hand, 6 filled by a login.
  const push = db.log.push.bind(db.log)
  db.log.push = (q) => {
    if (q.table === 'students' && q.op === 'update' && q.filters[0] === `id=${sid(2)}`) db.rows('students').find((s) => s.id === sid(2)).first_paid_at = '2026-10-12T09:00:01.000Z'
    if (q.table === 'students' && q.op === 'update' && q.filters[0] === `id=${sid(6)}`) db.rows('students').find((s) => s.id === sid(6)).first_paid_at = '2026-10-15T11:00:00.000Z'
    return push(q)
  }
  const r = await call({ mode: 'write' })
  ok(r.body.ok === true && r.body.written === 7 && r.body.changed_meanwhile === 2, 'written 7, changed meanwhile 2', show({ written: r.body.written, meanwhile: r.body.changed_meanwhile }))
  ok(firstOf(db, 2) === '2026-10-12T09:00:01.000Z' && firstOf(db, 6) === '2026-10-15T11:00:00.000Z', 'both keep the value written meanwhile')
  ok(!r.body.changes.some(([id]) => id === sid(2) || id === sid(6)) && r.body.changes.length === 7, 'and neither is in the change log')
}

console.log('\n=== The walk does not finish: nothing is written ===')
{
  // Whop taking 100 s a page: the 3rd page, started at 200 s, is still unanswered at 285 s.
  let db = freshDb()
  latency = 100_000
  let r = await call({ mode: 'write' })
  ok(r.status === 500 && r.body.ok === false && r.body.kind === 'walk_incomplete' && r.body.walk.stopped_because === 'time_budget' && r.body.walk.pages === 2,
     'Whop slow: 500, ok: false, walk_incomplete (time_budget, 2 pages read)', show({ kind: r.body.kind, walk: r.body.walk }))
  ok(writes(db).length === 0 && db.calls('students').length === 0 && r.took === 285_000,
     'nothing written, the students not even read, and the call answered at 285 s, before Vercel\'s 300 s', show({ took: r.took }))
  ok(/Nothing was written/.test(r.body.error) && !('changes' in r.body), 'the answer says nothing was written', r.body.error)
  timers = []

  // Whop taking 85 s a page: the 4th page would start at 255 s, past the 240 s budget.
  db = freshDb()
  payments = [...PAYMENTS(), ...Array.from({ length: 100 }, (_, i) => pay(`user_TESTmore${String(i).padStart(4, '0')}`, '2026-07-01T00:00:00.000Z', 97))]
  latency = 85_000
  r = await call({ mode: 'write' })
  ok(r.body.kind === 'walk_incomplete' && r.body.walk.pages === 3 && writes(db).length === 0 && r.took === 255_000,
     'a 4th page due past 240 s: walk_incomplete at 255 s, nothing written', show({ pages: r.body.walk.pages, took: r.took }))
  timers = []

  db = freshDb()
  answerWith = (n) => (n === 2 ? answer('{"error":"unauthorized"}', 401) : null)
  r = await call({ mode: 'write' })
  ok(r.status === 500 && r.body.kind === 'walk_incomplete' && r.body.walk.stopped_because === 'http_401_403' && writes(db).length === 0 && /refused the key/.test(r.body.error),
     'a 401 on the 2nd page: walk_incomplete, http_401_403, nothing written, the key named as the cause', show({ walk: r.body.walk.stopped_because }))

  db = freshDb()
  answerWith = () => answer('{"error":{"message":"Try again in 30 seconds."}}', 429)
  r = await call({ mode: 'dry' })
  ok(r.body.kind === 'walk_incomplete' && r.body.walk.stopped_because === 'rate_limited' && r.body.walk.retried_429 === 2 && r.took === 60_000,
     'three 429s: waited 30 s twice, then walk_incomplete (rate_limited)', show({ walk: r.body.walk, took: r.took }))
}

console.log('\n=== Other failures: answered, nothing written ===')
{
  let db = freshDb()
  db.fail['students.select'] = { message: 'connection reset' }
  let r = await call({ mode: 'write' })
  ok(r.status === 500 && r.body.kind === 'students_read_failed' && writes(db).length === 0 && !r.text.includes('connection reset'),
     'the students unreadable: 500, students_read_failed, nothing written, the database\'s words kept to the log', show(r.body.kind))
  db = freshDb()
  db.fail['discount_requests.select'] = { message: 'statement timeout' }
  r = await call({ mode: 'write' })
  ok(r.status === 500 && r.body.kind === 'requests_read_failed' && writes(db).length === 0, 'the 30% requests unreadable: 500, requests_read_failed, nothing written', show(r.body.kind))
  db = freshDb()
  db.fail['students.update'] = { message: 'deadlock detected' }
  r = await call({ mode: 'write' })
  ok(r.status === 500 && r.body.ok === false && r.body.kind === 'write_failed' && r.body.write_failed === 9 && r.body.written === 0 &&
     same(r.body.changes, []) && !r.text.includes('deadlock'), 'every write refused: 500, write_failed 9, an empty change log', show({ kind: r.body.kind, failed: r.body.write_failed }))
  ok(firstOf(db, 1) === '2026-09-05T10:00:00+00:00', 'and the rows as they were')
}

console.log('\n=== The writes run out of time: the rows written stand, the next write finishes ===')
{
  // The walk ends at 279 s (3 pages of 93 s); each write then takes 1 s on the
  // clock. 8 go out at once at 279 s; by the time a lane is free it is 287 s.
  const db = freshDb()
  latency = 93_000
  const push = db.log.push.bind(db.log)
  db.log.push = (q) => {
    if (q.table === 'students' && q.op === 'update') clock += 1000
    return push(q)
  }
  const r = await call({ mode: 'write' })
  ok(r.status === 500 && r.body.ok === false && r.body.kind === 'write_incomplete' && r.body.written === 8 && r.body.not_started === 1,
     'no write starts past 280 s: the 8 started at 279 s are written, the 9th is left, write_incomplete', show({ written: r.body.written, left: r.body.not_started }))
  ok(same(r.body.changes, CHANGES.slice(0, 8)) && firstOf(db, 1) === '2026-10-14T10:00:05.000Z' && firstOf(db, 13) === '2026-09-25T10:00:00+00:00',
     'the 8 written are in the change log and in the rows; the one left is as it was')
  timers = []
  db.log.push = push
  latency = 0
  const next = await call({ mode: 'write' })
  ok(next.body.ok === true && next.body.written === 1 && next.body.students.to_change === 1 && same(next.body.changes, CHANGES.slice(8)),
     'the next write reads Whop again and writes the one left', show({ written: next.body.written }))
}

console.log('\n=== No answer, and no log line, holds an email, a name or a Whop id ===')
{
  const secret = [KEY, SECRET, 'user_TEST', '@example.com', 'Made Up', 'madeupbuyer', 'pay_TEST', 'mem_TEST']
  const leaks = answers.filter((t) => secret.some((x) => t.includes(x)))
  ok(answers.length > 20 && leaks.length === 0, `${answers.length} answers read: none holds one`, leaks[0]?.slice(0, 200))
  const logLeaks = logged.filter((l) => secret.some((x) => l.includes(x)))
  ok(logged.some((l) => l.includes('[first-paid-repair]')) && logLeaks.length === 0, `${logged.length} log lines: none holds one`, logLeaks[0])
  ok(answers.every((t) => !t.includes('—')), 'and no answer holds an em dash')
}

globalThis.Date = RealDate
globalThis.setTimeout = realSetTimeout
globalThis.clearTimeout = realClearTimeout
globalThis.fetch = realFetch
ok(Date === RealDate && globalThis.setTimeout === realSetTimeout && globalThis.fetch === realFetch, 'the clock, the timers and fetch are the real ones again')

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
