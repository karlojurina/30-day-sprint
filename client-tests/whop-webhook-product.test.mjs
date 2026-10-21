// login-1 (2026-10-20): the Whop webhook writes a student row only for a
// membership of the course. The company's webhook sends the events of every
// product it sells, and a membership of another product (an Apex seat, an
// ETfB membership, a one-time product) used to be written as 'active', which
// the login and the map trust without asking Whop.
//
// The route is the real source (src/app/api/webhooks/whop/route.ts), copied
// by build.mjs with its imports pointed at stub-server.ts (Next's response, a
// stand-in database) and at the real whop-members.ts, whose Whop lookup
// (fetchActiveMembershipForUser) and mapStatus run for real here on a
// stand-in fetch that answers as Whop's v2 API does. Every delivery is signed
// the way Whop signs it, with a secret made up here. No network: a request to
// anything but the stand-in fails the test.
//
//   node client-tests/build.mjs
//   node --experimental-strip-types client-tests/whop-webhook-product.test.mjs
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
  const keep = (level) => (...a) => { lines.push(`${level}: ${a.join(' ')}`) }
  console.info = keep('info'); console.warn = keep('warn'); console.error = keep('error')
  try { return [await fn(), lines] } finally { [console.info, console.warn, console.error] = real }
}

// ── Whop, as its v2 API answers the three lookups whop-members.ts makes ─────
const whop = { down: false, memberships: {}, calls: [] }
globalThis.fetch = async (input) => {
  const url = new URL(String(input))
  if (url.hostname !== 'api.whop.com') throw new Error(`the test made a request to ${url.hostname}`)
  whop.calls.push(url.pathname + url.search)
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
/**
 * A membership event's data as Whop documents it (product and plan as
 * objects). `product: null` leaves the product out; a string sets it.
 */
function membershipEvent(type, { user = 'user_1', id = 'mem_event', product = COURSE, extra = {} } = {}) {
  const data = { id, user: person(user), status: 'active', joined_at: '2026-10-19T18:00:00.000Z', plan_id: 'plan_from_event', ...extra }
  if (product !== null) data.product = { id: product, title: 'A product' }
  return { type, data }
}
/** A payment event's data: the payment's own id, its product and membership. `product: null` leaves the product out. */
function paymentEvent({ user = 'user_1', product = COURSE } = {}) {
  const data = { id: 'pay_1', user: person(user), membership: { id: 'mem_paid' }, plan_id: 'plan_from_event' }
  if (product !== null) data.product = { id: product, title: 'A product' }
  return { type: 'payment.succeeded', data }
}
async function send(payload) {
  whop.calls.length = 0
  const [res, log] = await quietly(() => POST(delivery(payload)))
  return { status: res.status, body: await res.json(), log, whopCalls: whop.calls.length }
}

const ACTIVE_ROW = {
  id: 's1', whop_user_id: 'user_1', email: 'user_1@example.com', membership_status: 'active',
  whop_membership_id: 'mem_course', whop_plan_id: 'plan_paid', canceled_at: null, first_paid_at: '2026-10-01T00:00:00.000Z',
}
function freshDb(students = []) {
  const db = new FakeDb({ students })
  switchDb(db)
  whop.down = false
  whop.memberships = {}
  return db
}
const student = (db, user = 'user_1') => db.rows('students').find((r) => r.whop_user_id === user)
const writes = (db) => db.calls('students').filter((c) => c.op !== 'select')
const snapshot = (db) => JSON.stringify(db.rows('students'))

process.env.WHOP_PRODUCT_ID = COURSE

console.log('\n=== A membership of the course: written, as before ===')
for (const type of ['membership.went_valid', 'membership.activated']) {
  const db = freshDb()
  const r = await send(membershipEvent(type, { user: 'user_new', id: 'mem_c1' }))
  const row = student(db, 'user_new')
  // No first payment on it: since the first-paid fix the webhook stamps none,
  // and the login or the sync fills it from the first real payment.
  ok(r.status === 200 && row?.membership_status === 'active' && row.whop_membership_id === 'mem_c1' && row.first_paid_at === null,
     `${type} for the course: the new student's row is written, active, with no first payment`, show(row))
  ok(r.whopCalls === 0, 'and Whop is not asked: the payload names the course', `${r.whopCalls} calls`)
}
{
  const db = freshDb([{ ...ACTIVE_ROW, membership_status: 'canceled', canceled_at: '2026-10-10T00:00:00.000Z' }])
  const r = await send(paymentEvent())
  const row = student(db)
  ok(r.status === 200 && row.membership_status === 'active' && row.canceled_at === null && row.whop_membership_id === 'mem_paid',
     'payment.succeeded for the course: a renewal makes a lapsed student active again, on the payment\'s membership', show(row))
}

console.log('\n=== A payment points the row at its membership, never at the payment ===')
// Until 2026-10-20 every payment wrote its own id (pay_...) as the row's
// whop_membership_id, main too before login-1. It is the payment's membership
// now: membership.id, else membership_id, else membership as a bare id; the
// payment's own id only when the payload names none of them.
for (const [shape, fields, want] of [
  ['membership as an object', { membership: { id: 'mem_object' } }, 'mem_object'],
  ['membership_id', { membership_id: 'mem_flat' }, 'mem_flat'],
  ['membership as a bare id', { membership: 'mem_bare' }, 'mem_bare'],
  ['membership as an object and membership_id', { membership: { id: 'mem_object' }, membership_id: 'mem_flat' }, 'mem_object'],
  ['membership_id and membership as a bare id', { membership_id: 'mem_flat', membership: 'mem_bare' }, 'mem_flat'],
  ['no membership at all (the last resort)', {}, 'pay_1'],
]) {
  const db = freshDb([{ ...ACTIVE_ROW, membership_status: 'canceled', canceled_at: '2026-10-10T00:00:00.000Z' }])
  const data = { id: 'pay_1', user: person('user_1'), plan_id: 'plan_from_event', product: { id: COURSE, title: 'A product' }, ...fields }
  const r = await send({ type: 'payment.succeeded', data })
  const sent = db.calls('students', 'upsert').map((q) => q.values.whop_membership_id)
  ok(r.status === 200 && sent.length === 1 && sent[0] === want && student(db).whop_membership_id === want && student(db).membership_status === 'active',
     `payment.succeeded with ${shape}: the row points at ${want}`, show({ sent }))
}

console.log('\n=== A membership of another product: 200, nothing written ===')
{
  const db = freshDb()
  const r = await send(membershipEvent('membership.went_valid', { user: 'user_apex', product: APEX }))
  ok(r.status === 200 && !student(db, 'user_apex') && writes(db).length === 0,
     'went_valid for an Apex seat, no row yet: no row is made (it used to be made active)', show({ status: r.status, writes: writes(db) }))
  ok(r.whopCalls === 0, 'Whop is not asked', `${r.whopCalls} calls`)
  ok(r.log.some((l) => l.includes(`for product ${APEX}, not the course`) && l.includes('nothing written')),
     'and the log says which product was turned away')
}
{
  const lapsed = { ...ACTIVE_ROW, membership_status: 'canceled', canceled_at: '2026-10-10T00:00:00.000Z' }
  const db = freshDb([lapsed])
  const before = snapshot(db)
  const r = await send(paymentEvent({ product: APEX }))
  ok(r.status === 200 && snapshot(db) === before && writes(db).length === 0,
     'payment.succeeded for another product, a lapsed course student: still canceled (it used to let them back in until the next sync)',
     show(student(db)))
}
{
  const db = freshDb([ACTIVE_ROW])
  const before = snapshot(db)
  const r = await send(membershipEvent('membership.activated', { product: APEX, id: 'mem_apex' }))
  ok(r.status === 200 && snapshot(db) === before,
     'membership.activated for another product, an active course student: the row keeps the course membership and plan',
     show(student(db)))
}
{
  const db = freshDb([ACTIVE_ROW])
  whop.memberships.user_1 = [whopRow('mem_course', 'user_1', COURSE)]
  const before = snapshot(db)
  const r = await send(membershipEvent('membership.went_invalid', { product: APEX, id: 'mem_apex' }))
  ok(r.status === 200 && r.whopCalls === 0 && snapshot(db) === before && writes(db).length === 0,
     'went_invalid for another product: Whop is not asked and the row is untouched', show({ whopCalls: r.whopCalls, row: student(db) }))
}
{
  const db = freshDb([ACTIVE_ROW])
  const before = snapshot(db)
  const flat = { type: 'membership.went_valid', data: { id: 'mem_apex', product_id: APEX, user: person('user_1') } }
  const bare = { type: 'membership.went_valid', data: { id: 'mem_apex', product: APEX, user: person('user_1') } }
  const a = await send(flat)
  const b = await send(bare)
  ok(a.status === 200 && b.status === 200 && snapshot(db) === before && a.whopCalls + b.whopCalls === 0,
     'the product read from older shapes too: product_id, and product as a bare id', show(student(db)))
}

console.log('\n=== No product in the payload: only a course membership Whop lists is written ===')
{
  const db = freshDb()
  whop.memberships.user_2 = [
    whopRow('mem_apex_2', 'user_2', APEX),
    whopRow('mem_course_2', 'user_2', COURSE, { plan: 'plan_paid', status: 'past_due', valid: true }),
  ]
  const r = await send(membershipEvent('membership.went_valid', { user: 'user_2', id: 'mem_unknown', product: null }))
  const row = student(db, 'user_2')
  ok(r.status === 200 && r.whopCalls > 0, 'went_valid with no product: Whop is asked', `${r.whopCalls} calls`)
  ok(row?.membership_status === 'past_due' && row.whop_membership_id === 'mem_course_2' && row.whop_plan_id === 'plan_paid',
     'and the course membership it lists is written, with its own status, id and plan (past_due stays past_due)', show(row))
}
{
  const db = freshDb()
  whop.memberships.user_3 = [whopRow('mem_apex_3', 'user_3', APEX)]
  const r = await send(membershipEvent('membership.went_valid', { user: 'user_3', product: null }))
  ok(r.status === 200 && !student(db, 'user_3') && writes(db).length === 0,
     'went_valid with no product, Whop lists only another product: nothing written', show({ status: r.status, writes: writes(db) }))
}
{
  const db = freshDb([{ ...ACTIVE_ROW, membership_status: 'canceled', canceled_at: '2026-10-10T00:00:00.000Z' }])
  whop.memberships.user_1 = [whopRow('mem_course_new', 'user_1', COURSE, { plan: 'plan_paid' })]
  const r = await send(paymentEvent({ product: null }))
  const row = student(db)
  ok(r.status === 200 && row.membership_status === 'active' && row.whop_membership_id === 'mem_course_new' && row.canceled_at === null,
     'payment.succeeded with no product, Whop lists a valid course membership: active again', show(row))
}
{
  const db = freshDb()
  whop.down = true
  const r = await send(membershipEvent('membership.went_valid', { user: 'user_4', product: null }))
  ok(r.status === 200 && !student(db, 'user_4') && writes(db).length === 0,
     'with no product and Whop failing: nothing written (a course member still gets in: the login asks Whop itself)',
     show({ status: r.status, whopCalls: r.whopCalls }))
}
{
  const db = freshDb([ACTIVE_ROW])
  whop.memberships.user_1 = [whopRow('mem_course_kept', 'user_1', COURSE, { plan: 'plan_paid' })]
  const r = await send(membershipEvent('membership.went_invalid', { product: null, id: 'mem_gone' }))
  const row = student(db)
  ok(r.status === 200 && row.membership_status === 'active' && row.whop_membership_id === 'mem_course_kept',
     'went_invalid with no product, Whop lists a valid course membership: re-pointed at it and kept active, as before', show(row))
}
// With Whop failing no read answers, so the route answers 500 and Whop sends
// the event again (the order's second review, 2026-10-20); it answered 200.
for (const [down, status, label] of [
  [false, 200, 'went_invalid with no product and no course membership on Whop: 200, the student is not canceled, the sync settles it'],
  [true, 500, 'went_invalid with no product and Whop failing: 500 so Whop sends it again, the student is not canceled'],
]) {
  const db = freshDb([ACTIVE_ROW])
  whop.down = down
  const before = snapshot(db)
  const r = await send(membershipEvent('membership.went_invalid', { product: null, id: 'mem_gone' }))
  ok(r.status === status && snapshot(db) === before && writes(db).length === 0, label, show({ status: r.status, row: student(db) }))
}

console.log('\n=== The course\'s own membership ending: as before ===')
{
  const db = freshDb([ACTIVE_ROW])
  const r = await send(membershipEvent('membership.went_invalid', { id: 'mem_course' }))
  const row = student(db)
  ok(r.status === 200 && row.membership_status === 'canceled' && row.canceled_at,
     'went_invalid for the course, nothing else valid on Whop: canceled, with the time', show(row))
}
{
  const db = freshDb([ACTIVE_ROW])
  whop.memberships.user_1 = [whopRow('mem_course_second', 'user_1', COURSE, { plan: 'plan_paid' })]
  const r = await send(membershipEvent('membership.deactivated', { id: 'mem_course' }))
  const row = student(db)
  ok(r.status === 200 && row.membership_status === 'active' && row.whop_membership_id === 'mem_course_second',
     'membership.deactivated for the course with a second course membership valid: re-pointed, still active', show(row))
}

console.log('\n=== Several course products in WHOP_PRODUCT_ID ===')
process.env.WHOP_PRODUCT_ID = ` ${COURSE} , prod_course_b `
{
  const db = freshDb()
  await send(membershipEvent('membership.went_valid', { user: 'user_a', product: COURSE }))
  await send(membershipEvent('membership.went_valid', { user: 'user_b', product: 'prod_course_b' }))
  await send(membershipEvent('membership.went_valid', { user: 'user_c', product: APEX }))
  ok(student(db, 'user_a')?.membership_status === 'active' && student(db, 'user_b')?.membership_status === 'active',
     'each listed product is a course product (spaces around the commas ignored)', show(db.rows('students').map((r) => r.whop_user_id)))
  ok(!student(db, 'user_c'), 'a product not listed is still turned away')
}
{
  const db = freshDb([{ ...ACTIVE_ROW, whop_membership_id: 'mem_b' }])
  const r = await send(membershipEvent('membership.went_invalid', { product: 'prod_course_b', id: 'mem_b' }))
  ok(r.status === 200 && student(db).membership_status === 'canceled' && r.whopCalls > 0,
     'went_invalid for the second course product, the row on it: Whop is asked, and with nothing valid the student is canceled', show(student(db)))
}
{
  // The row is on another membership: with nothing valid on Whop it is left
  // for that membership's own event or the sync (the order's second review).
  // It was canceled, keyed on the student alone.
  const db = freshDb([ACTIVE_ROW])
  const before = snapshot(db)
  const r = await send(membershipEvent('membership.went_invalid', { product: 'prod_course_b', id: 'mem_b' }))
  ok(r.status === 200 && r.whopCalls > 0 && snapshot(db) === before && writes(db).length === 0,
     'went_invalid for the second course product, the row on another membership, nothing valid on Whop: left for the sync', show(student(db)))
}

console.log('\n=== WHOP_PRODUCT_ID empty: no membership is written, and the log says why ===')
process.env.WHOP_PRODUCT_ID = ''
{
  const db = freshDb()
  const r = await send(membershipEvent('membership.went_valid', { user: 'user_x' }))
  ok(r.status === 200 && !student(db, 'user_x'), 'a course event is turned away rather than let anyone in', show({ status: r.status }))
  ok(r.log.some((l) => l.startsWith('error: ') && l.includes('WHOP_PRODUCT_ID is empty')),
     'and an error line says WHOP_PRODUCT_ID is empty', r.log.filter((l) => l.includes('empty')).join(' | '))
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
