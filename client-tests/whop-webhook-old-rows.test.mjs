// login-1 review (2026-10-20): a row the Whop webhook wrote for another
// product before login-1 closes when that membership ends. Until login-1 the
// webhook wrote a membership of any product as 'active' (an Apex seat, an
// ETfB membership), and the sync never closes such a row: it walks only the
// course's memberships. So when a membership that is not the course's ends,
// and the student's row still points at it (whop_membership_id), the route
// settles the row as it did before login-1: re-pointed at a course membership
// Whop lists, else canceled. A row that points anywhere else is left alone
// and Whop is not asked (whop-webhook-product.test.mjs).
//
// The route is the real source (src/app/api/webhooks/whop/route.ts), copied by
// build.mjs onto stub-server.ts (Next's response, a stand-in database) and the
// real whop-members.ts, whose Whop lookup runs here on a stand-in fetch that
// answers as Whop's v2 API does. Every delivery is signed the way Whop signs
// it, with a secret made up here. No network.
//
//   node client-tests/build.mjs
//   node --experimental-strip-types client-tests/whop-webhook-old-rows.test.mjs
import { createHmac, randomBytes } from 'node:crypto'
import { POST } from './_gen/whop-webhook-route.ts'
// useDb is the stand-in's "use this database", not a React hook: imported under a plainer name.
import { FakeDb, useDb as switchDb } from './_gen/stub-server.ts'

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v)

/** Runs `fn` with the console quiet; returns [result, lines], each line led by its level ("info: ..."). */
async function quietly(fn) {
  const real = [console.info, console.warn, console.error]
  const lines = []
  const keep = (level) => (...a) => { lines.push(`${level}: ${a.map((x) => (typeof x === 'string' ? x : show(x))).join(' ')}`) }
  console.info = keep('info'); console.warn = keep('warn'); console.error = keep('error')
  try { return [await fn(), lines] } finally { [console.info, console.warn, console.error] = real }
}

// ── Whop, as its v2 API answers the three lookups whop-members.ts makes ─────
// `whop.onAsk` runs on every request before Whop answers: the test uses it to
// change the database while Whop is being asked, as the sync can.
const whop = { down: false, memberships: {}, calls: [], onAsk: null }
globalThis.fetch = async (input) => {
  const url = new URL(String(input))
  if (url.hostname !== 'api.whop.com') throw new Error(`the test made a request to ${url.hostname}`)
  whop.calls.push(url.pathname + url.search)
  if (whop.onAsk) whop.onAsk()
  if (whop.down) return new Response('upstream error', { status: 500 })
  const member = url.pathname.match(/^\/api\/v2\/members\/([^/]+)$/)
  if (member) return Response.json({ memberships: whop.memberships[decodeURIComponent(member[1])] ?? [] })
  if (url.pathname === '/api/v2/memberships') {
    const product = url.searchParams.get('product_id')
    const rows = (whop.memberships[url.searchParams.get('user_id')] ?? []).filter((m) => !product || m.product === product)
    return Response.json({ data: rows })
  }
  return new Response('not found', { status: 404 })
}
/** A membership as Whop's v2 list returns it: flat ids. */
const whopRow = (id, user, product, extra = {}) => ({ id, user, product, plan: `plan_${product}`, status: 'active', valid: true, created_at: 1760000000, ...extra })

// ── The deliveries ───────────────────────────────────────────────────────────
const KEY = randomBytes(24)
process.env.WHOP_WEBHOOK_SECRET = `ws_${KEY.toString('base64')}`
process.env.WHOP_API_KEY = 'test-key-made-up-here'
const COURSE = 'prod_course'
const APEX = 'prod_apex'
process.env.WHOP_PRODUCT_ID = COURSE
let msg = 0
function delivery(payload) {
  const body = JSON.stringify(payload)
  const id = `msg_${++msg}`
  const ts = String(Math.floor(Date.now() / 1000))
  const sig = createHmac('sha256', KEY).update(`${id}.${ts}.${body}`).digest('base64')
  return new Request('http://app/api/webhooks/whop', {
    method: 'POST',
    headers: { 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': `v1,${sig}` },
    body,
  })
}
const person = (user) => ({ id: user, username: user, name: 'A Student', email: `${user}@example.com` })
/** A membership ending, as Whop documents the event (product as an object). `product: null` leaves the product out. */
function ending(type, { user = 'user_1', id = 'mem_apex', product = APEX } = {}) {
  const data = { id, user: person(user), status: 'expired', joined_at: '2026-09-01T00:00:00.000Z' }
  if (product !== null) data.product = { id: product, title: 'A product' }
  return { type, data }
}
async function send(payload) {
  whop.calls.length = 0
  const [res, log] = await quietly(() => POST(delivery(payload)))
  return { status: res.status, body: await res.json(), log, whopCalls: whop.calls.length }
}

/** The row the old webhook wrote for an Apex seat: active, pointing at that membership. */
const OLD_APEX_ROW = {
  id: 's1', whop_user_id: 'user_1', email: 'user_1@example.com', membership_status: 'active',
  whop_membership_id: 'mem_apex', whop_plan_id: 'plan_apex', canceled_at: null, first_paid_at: '2026-09-01T00:00:00.000Z',
}
function freshDb(students = [OLD_APEX_ROW]) {
  const db = new FakeDb({ students })
  switchDb(db)
  whop.down = false
  whop.memberships = {}
  whop.onAsk = null
  return db
}
const student = (db, user = 'user_1') => db.rows('students').find((r) => r.whop_user_id === user)
const writes = (db) => db.calls('students').filter((c) => c.op !== 'select')
const snapshot = (db) => JSON.stringify(db.rows('students'))

console.log('\n=== A row the old webhook wrote for another product: closed when that membership ends ===')
for (const type of ['membership.went_invalid', 'membership_went_invalid', 'membership.deactivated', 'membership_deactivated']) {
  const db = freshDb()
  // Whop lists the ended Apex seat and nothing of the course.
  whop.memberships.user_1 = [whopRow('mem_apex', 'user_1', APEX, { status: 'expired', valid: false })]
  const r = await send(ending(type))
  const row = student(db)
  ok(r.status === 200 && row.membership_status === 'canceled' && row.canceled_at && r.whopCalls > 0,
     `${type}: the Apex seat the row points at ends, no course membership on Whop: canceled, with the time`,
     show({ status: r.status, whopCalls: r.whopCalls, membership_status: row.membership_status, canceled_at: row.canceled_at }))
}
{
  const db = freshDb()
  whop.memberships.user_1 = [whopRow('mem_apex', 'user_1', APEX, { status: 'expired', valid: false })]
  const r = await send(ending('membership.went_invalid'))
  ok(r.log.some((l) => l.includes('mem_apex') && l.includes(`product ${APEX}`) && l.includes('row points at')),
     'and the log says the row pointed at the membership that ended', r.log.filter((l) => l.includes('row points at')).join(' | '))
  ok(writes(db).length === 1 && writes(db)[0].filters.includes('whop_membership_id=mem_apex'),
     'the write is made only while the row still points at that membership', show(writes(db).map((w) => w.filters)))
}

console.log('\n=== A course member whose row still points at an Apex seat: kept in ===')
{
  // The old webhook wrote the Apex seat over the course membership, and the
  // sync has not run since. Whop lists the course membership as valid.
  const db = freshDb()
  whop.memberships.user_1 = [
    whopRow('mem_apex', 'user_1', APEX, { status: 'expired', valid: false }),
    whopRow('mem_course', 'user_1', COURSE, { plan: 'plan_paid' }),
  ]
  const r = await send(ending('membership.went_invalid'))
  const row = student(db)
  ok(r.status === 200 && row.membership_status === 'active' && row.whop_membership_id === 'mem_course' &&
     row.whop_plan_id === 'plan_paid' && row.canceled_at === null,
     'the Apex seat ends: the row is re-pointed at the course membership and stays active, as before login-1', show(row))
}
{
  const db = freshDb()
  whop.down = true
  const r = await send(ending('membership.went_invalid'))
  const row = student(db)
  ok(r.status === 200 && row.membership_status === 'canceled' && r.whopCalls > 0,
     'Whop failing: canceled, as before login-1 (for a course member the next sync, or the login\'s own Whop check, lets them back in)',
     show({ status: r.status, membership_status: row.membership_status }))
}

console.log('\n=== A row that points anywhere else: left alone, Whop not asked ===')
{
  const db = freshDb([{ ...OLD_APEX_ROW, whop_membership_id: 'mem_apex_other' }])
  const before = snapshot(db)
  const r = await send(ending('membership.went_invalid', { id: 'mem_apex' }))
  ok(r.status === 200 && r.whopCalls === 0 && snapshot(db) === before && writes(db).length === 0,
     'the row points at another membership of another product: untouched', show({ whopCalls: r.whopCalls, row: student(db) }))
}
{
  // Until 2026-10-20 payment.succeeded wrote the payment's own id (it writes
  // the payment's membership now). No membership event names it: only a
  // cleanup closes these rows (supabase/diagnostics/non-course-members-read.sql).
  const db = freshDb([{ ...OLD_APEX_ROW, whop_membership_id: 'pay_1' }])
  const before = snapshot(db)
  const r = await send(ending('membership.went_invalid', { id: 'mem_apex' }))
  ok(r.status === 200 && r.whopCalls === 0 && snapshot(db) === before,
     'a row a payment wrote (the payment\'s id, pay_...) is not matched: it stays as it is', show(student(db)))
}
{
  const db = freshDb([])
  const r = await send(ending('membership.went_invalid', { user: 'user_nobody' }))
  ok(r.status === 200 && r.whopCalls === 0 && writes(db).length === 0 && db.rows('students').length === 0,
     'no row at all: nothing written, Whop not asked', show({ status: r.status, whopCalls: r.whopCalls }))
}

console.log('\n=== No product in the payload: the row it points at is settled too ===')
{
  const db = freshDb()
  whop.memberships.user_1 = [whopRow('mem_apex', 'user_1', APEX, { status: 'expired', valid: false })]
  const r = await send(ending('membership.went_invalid', { product: null }))
  const row = student(db)
  ok(r.status === 200 && row.membership_status === 'canceled' && row.canceled_at,
     'no product, the row points at the membership that ended, no course membership on Whop: canceled (the sync never would)',
     show(row))
}
{
  const db = freshDb()
  whop.memberships.user_1 = [whopRow('mem_course', 'user_1', COURSE, { plan: 'plan_paid' })]
  const r = await send(ending('membership.went_invalid', { product: null }))
  const row = student(db)
  ok(r.status === 200 && row.membership_status === 'active' && row.whop_membership_id === 'mem_course',
     'no product, the row points at it, a valid course membership on Whop: re-pointed at it', show(row))
}

console.log('\n=== The row moves on while Whop is asked: the cancel does not follow it ===')
{
  // Whop fails, and meanwhile the sync (or a course activation) points the row
  // at the student's course membership. The cancel was meant for the row the
  // Apex seat made, so it must not land on the row the course made.
  const db = freshDb()
  whop.down = true
  whop.onAsk = () => {
    const row = student(db)
    row.whop_membership_id = 'mem_course'
    row.whop_plan_id = 'plan_paid'
  }
  const r = await send(ending('membership.went_invalid'))
  const row = student(db)
  ok(r.status === 200 && row.membership_status === 'active' && row.whop_membership_id === 'mem_course' && row.canceled_at === null,
     'the row now points at the course membership: still active, not canceled', show(row))
}

console.log('\n=== A failed database call answers 500, so Whop sends the event again ===')
{
  const db = freshDb()
  db.fail['students.select'] = { message: 'connection reset' }
  whop.memberships.user_1 = [whopRow('mem_apex', 'user_1', APEX, { status: 'expired', valid: false })]
  const r = await send(ending('membership.went_invalid'))
  ok(r.status === 500 && r.whopCalls === 0 && writes(db).length === 0 && student(db).membership_status === 'active',
     'the read of the row fails: 500, nothing written, Whop not asked', show({ status: r.status, whopCalls: r.whopCalls }))
}
{
  const db = freshDb()
  db.fail['students.update'] = { message: 'connection reset' }
  whop.memberships.user_1 = [whopRow('mem_apex', 'user_1', APEX, { status: 'expired', valid: false })]
  const r = await send(ending('membership.went_invalid'))
  ok(r.status === 500, 'the cancel fails: 500', show({ status: r.status }))
}

console.log('\n=== The course\'s own membership ending: as before ===')
{
  const db = freshDb([{ ...OLD_APEX_ROW, whop_membership_id: 'mem_course', whop_plan_id: 'plan_paid' }])
  const r = await send(ending('membership.went_invalid', { id: 'mem_course', product: COURSE }))
  const row = student(db)
  ok(r.status === 200 && row.membership_status === 'canceled' && r.whopCalls > 0 &&
     !db.calls('students', 'select').some((c) => c.filters.some((f) => f.startsWith('whop_membership_id'))) &&
     !writes(db).some((w) => w.filters.some((f) => f.startsWith('whop_membership_id'))),
     'canceled with nothing valid on Whop, keyed on the student alone as before', show(writes(db).map((w) => w.filters)))
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
