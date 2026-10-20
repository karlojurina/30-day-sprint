// The production setting (2026-10-20): WHOP_PRODUCT_ID names three products,
// the course, ETfB for brands and Apex team seats, after the owner's call that
// Apex and ETfB members keep the app. login-1 has the login check, the login's
// self-heal, the 2-hour sync and the webhook read that one list. This suite
// runs all four on that exact value (three product ids, no plan id), each
// through its real code:
//   - the login (GET /api/auth/whop/callback), from a copy whose Whop calls are
//     the real whop.ts (the code exchange and the login check,
//     checkActiveMembershipDiagnostic) and the real whop-members.ts (the
//     self-heal, fetchActiveMembershipForUser): whop-callback-route-real-whop.ts
//     in build.mjs. Its first-payment read is stub-server.ts's (none).
//   - the sync (runWhopCommunitySync) with the real whop-members.ts and
//     first-payment.ts;
//   - the webhook's POST with the real whop-members.ts.
// It also pins the rule the setting needs (the same day): when a user holds
// more than one membership that grants access, the course's wins over an ETfB
// or Apex one, in the sync's dedupe and in the webhook's activations and
// payments, so a paying course student who also holds an Apex seat or an ETfB
// membership stays on the course membership and its plan (isEtfbOrApexProduct
// in whop-members.ts, whose two ids are checked against etfb.ts's here).
// Whop is a stand-in fetch answering in the shapes this code reads; the
// database is stub-server.ts's. No network: a request to anything but the
// stand-in fails the test. The member ids, plans and emails are made up; the
// three product ids are the ones the repository already names (src/lib/etfb.ts,
// src/lib/whop-members.ts).
//
//   node client-tests/build.mjs
//   node --experimental-strip-types client-tests/whop-product-setting.test.mjs
import { createHmac, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import { GET as login } from './_gen/whop-callback-route-real-whop.ts'
import { POST as webhook } from './_gen/whop-webhook-route.ts'
import { runWhopCommunitySync } from './_gen/whop-sync-runner.ts'
import { checkActiveMembershipDiagnostic } from './_gen/whop.ts'
import { fetchActiveMembershipForUser, isEtfbOrApexProduct } from './_gen/whop-members.ts'
// useDb is the stand-in's "use this database", not a React hook: imported under a plainer name.
import { FakeDb, useDb as switchDb, fakeClient, NextRequest, afterTasks } from './_gen/stub-server.ts'
import { signState } from './_gen/pkce.ts'

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/** Runs `fn` with the console quiet; returns [result, lines], each line led by its level ("info: ..."). */
async function quietly(fn) {
  const real = [console.info, console.warn, console.error, console.log]
  const lines = []
  const keep = (level) => (...a) => { lines.push(`${level}: ${a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}`) }
  console.info = keep('info'); console.warn = keep('warn'); console.error = keep('error'); console.log = keep('log')
  try { return [await fn(), lines] } finally { [console.info, console.warn, console.error, console.log] = real }
}

// ── The setting, exactly as production holds it since 2026-10-20 ─────────────
const PRODUCTION = 'prod_eE7r6SXa3H0MX,prod_bGNf1u02RruKC,prod_vCHZUO8dU4ts2'
const [COURSE, ETFB, APEX] = PRODUCTION.split(',')
/** A product of the company the list does not name (a one-time product, say). */
const OTHER = 'prod_TESTnotlisted'
/** The course's paying plan (PAYING_WHOP_PLAN_IDS in src/lib/constants.ts); the others are made up. */
const COURSE_PLAN = 'plan_4ZrwR4PmBsVsx'
const MEMBERS = {
  course: { user: 'user_TESTcourse', id: 'mem_TESTcourse', product: COURSE, plan: COURSE_PLAN, who: 'a course member' },
  etfb: { user: 'user_TESTetfb', id: 'mem_TESTetfb', product: ETFB, plan: 'plan_TESTetfbbrand', who: 'an ETfB member' },
  apex: { user: 'user_TESTapex', id: 'mem_TESTapex', product: APEX, plan: 'plan_TESTapexseat', who: 'an Apex seat' },
  other: { user: 'user_TESTother', id: 'mem_TESTother', product: OTHER, plan: 'plan_TESTother', who: 'a member of another product' },
}
const LISTED = ['course', 'etfb', 'apex']

process.env.WHOP_PRODUCT_ID = PRODUCTION
process.env.WHOP_API_KEY = 'apik_made_up_for_tests'
process.env.WHOP_CLIENT_ID = 'app_made_up_for_tests'
process.env.STUDENT_AUTH_SECRET = 'a made-up student secret for this test'
process.env.PKCE_COOKIE_SECRET = 'a made-up pkce secret for this test'
process.env.NEXT_PUBLIC_APP_URL = 'http://app'
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://db.test'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-made-up'
const SIGNING = randomBytes(24)
process.env.WHOP_WEBHOOK_SECRET = `ws_${SIGNING.toString('base64')}`
for (const k of ['STUDENT_APP_CLOSED', 'STUDENT_APP_OPEN_FOR', 'WHOP_BYPASS_USER_IDS', 'WHOP_BYPASS_EMAILS']) delete process.env[k]

// ── Whop, as the code reads it ───────────────────────────────────────────────
/**
 * Every membership Whop holds, in the v2 admin shape (flat ids). The student's
 * own /api/v1/me/memberships answers the same memberships in the shape the
 * login check reads (product_id, plan_id). `down.me`: the student's token gets
 * the 404 legacy customers get; `down.admin`: the company key's reads fail.
 */
const whop = { memberships: [], payments: [], down: { me: false, admin: false }, calls: [] }
const v2 = (m, extra = {}) => ({
  id: m.id, user: m.user, email: `${m.user}@example.com`, product: m.product, plan: m.plan,
  status: 'active', valid: true, created_at: 1760000000, expires_at: null, renewal_period_end: null,
  cancel_at_period_end: false, ...extra,
})
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input))
  if (url.hostname !== 'api.whop.com') throw new Error(`the test made a request to ${url.hostname}`)
  const params = Object.fromEntries(url.searchParams)
  whop.calls.push({ path: url.pathname, params })
  const auth = String(init.headers?.Authorization ?? '')
  if (url.pathname === '/oauth/token') {
    const code = new URLSearchParams(String(init.body ?? '')).get('code') ?? ''
    const user = code.replace(/^code_for_/, '')
    return Response.json({ access_token: `tok_${user}`, refresh_token: `refresh_${user}`, token_type: 'bearer', expires_in: 3600 })
  }
  const tokenUser = auth.startsWith('Bearer tok_') ? auth.slice('Bearer tok_'.length) : null
  if (url.pathname === '/oauth/userinfo') {
    return Response.json({ sub: tokenUser, email: `${tokenUser}@example.com`, name: 'A Member', picture: null, username: tokenUser })
  }
  if (url.pathname === '/api/v1/me/memberships') {
    if (whop.down.me) return new Response('not found', { status: 404 })
    const rows = whop.memberships.filter((m) => m.user === tokenUser)
      .map((m) => ({ id: m.id, status: m.status, valid: m.valid, product_id: m.product, plan_id: m.plan, created_at: m.created_at }))
    return Response.json({ data: rows })
  }
  // From here on, the company's key.
  if (whop.down.admin) return new Response('upstream error', { status: 500 })
  const member = url.pathname.match(/^\/api\/v2\/members\/([^/]+)$/)
  if (member) {
    const user = decodeURIComponent(member[1])
    return Response.json({ id: user, social_accounts: [], memberships: whop.memberships.filter((m) => m.user === user) })
  }
  if (url.pathname === '/api/v2/memberships') {
    const product = url.searchParams.get('product_id')
    const user = url.searchParams.get('user_id')
    const rows = whop.memberships.filter((m) => (!product || m.product === product) && (!user || m.user === user))
    return Response.json({ data: rows, pagination: { current_page: 1, total_page: 1, total_count: rows.length } })
  }
  if (url.pathname === '/api/v1/payments') {
    const rows = whop.payments.filter((p) => p.user?.id === url.searchParams.get('user_id'))
    return Response.json({ data: rows, page_info: { has_next_page: false, end_cursor: null } })
  }
  return new Response('not found', { status: 404 })
}
const money = (n) => ({ amount: n.toFixed(2), currency: 'usd', decimals: 2, display_decimals: 2 })
/** One real payment as GET /api/v1/payments lists it (Api-Version-Date 2026-10-15-1). */
const payment = (m, paidAt) => ({
  id: `pay_TEST${m.user.slice(-5)}`, status: 'paid', substatus: 'succeeded', subtotal: money(97), total: money(97),
  refunded_amount: money(0), paid_at: paidAt, created_at: paidAt, billing_reason: 'subscription_create',
  user: { id: m.user, name: 'A Member', username: 'amember' }, membership_id: m.id, plan_id: m.plan, product_id: m.product,
})

function freshWorld({ students = [], memberships = Object.values(MEMBERS).map((m) => v2(m)), payments = [], down = {} } = {}) {
  const db = new FakeDb({ students })
  switchDb(db)
  whop.memberships = memberships
  whop.payments = payments
  whop.down = { me: false, admin: false, ...down }
  whop.calls = []
  return db
}
const rowOf = (db, m) => db.rows('students').find((r) => r.whop_user_id === m.user)

// ── The login, through its GET ───────────────────────────────────────────────
async function logIn(m) {
  const state = signState('a-made-up-verifier', process.env.PKCE_COOKIE_SECRET)
  const [res, log] = await quietly(async () => {
    const r = await login(new NextRequest(`http://app/api/auth/whop/callback?code=code_for_${m.user}&state=${encodeURIComponent(state)}`))
    // The watch sync the login hands to after(), finished before the next login.
    await Promise.allSettled(afterTasks.splice(0))
    return r
  })
  return { status: res.status, location: res.headers.get('location') ?? '', log }
}
const gotIn = (r) => r.status === 307 && r.location === 'http://app/auth/complete'
const turnedAway = (r) => r.status === 307 && r.location.startsWith('http://app/login?error=no_membership')
const accountMade = (db, m) => db.authLog.some((a) => a.call === 'createUser' && a.email === `${m.user}@whop.ecomtalent.com`)

console.log('\n=== The setting as each reader takes it ===')
{
  freshWorld()
  const seen = {}
  for (const k of Object.keys(MEMBERS)) {
    const [d] = await quietly(() => checkActiveMembershipDiagnostic(`tok_${MEMBERS[k].user}`))
    seen[k] = d
  }
  ok(same(seen.course.configured, [COURSE, ETFB, APEX]), 'the login check reads three product ids, no plan id', show(seen.course.configured))
  ok(LISTED.every((k) => seen[k].hasAccess === true), 'the login check: the course member, the ETfB member and the Apex seat have access',
    show(LISTED.map((k) => seen[k].hasAccess)))
  ok(seen.other.hasAccess === false && seen.other.memberships.length === 1 && seen.other.memberships[0].product_id === OTHER,
    'the login check: the member of another product has none, though Whop lists an active membership for them (the list says no)',
    show(seen.other.memberships))
  const healed = {}
  for (const k of Object.keys(MEMBERS)) {
    const [row] = await quietly(() => fetchActiveMembershipForUser(MEMBERS[k].user))
    healed[k] = row
  }
  ok(LISTED.every((k) => healed[k]?.id === MEMBERS[k].id), 'the self-heal finds the course member\'s, the ETfB member\'s and the Apex seat\'s own membership',
    show(LISTED.map((k) => healed[k]?.id ?? null)))
  ok(healed.other === null, 'the self-heal finds nothing for the member of another product', show(healed.other))

  // whop-members.ts writes the ETfB and Apex ids out itself (etfb.ts and it
  // import nothing from each other): its copy must be etfb.ts's constants.
  const etfbSource = fs.readFileSync(new URL('../src/lib/etfb.ts', import.meta.url), 'utf8')
  const declared = (name) => etfbSource.match(new RegExp(`export const ${name} = "([^"]+)";`))?.[1] ?? null
  ok(declared('ETFB_PRODUCT_ID') === ETFB && declared('TEAM_SEAT_PRODUCT_ID') === APEX,
    'etfb.ts\'s ETFB_PRODUCT_ID and TEAM_SEAT_PRODUCT_ID are the setting\'s ETfB and Apex ids',
    show({ ETFB_PRODUCT_ID: declared('ETFB_PRODUCT_ID'), TEAM_SEAT_PRODUCT_ID: declared('TEAM_SEAT_PRODUCT_ID') }))
  ok(isEtfbOrApexProduct(ETFB) && isEtfbOrApexProduct(APEX) && !isEtfbOrApexProduct(COURSE) &&
    !isEtfbOrApexProduct(OTHER) && !isEtfbOrApexProduct(null),
    'isEtfbOrApexProduct (whop-members.ts) names those two and no other product',
    show([ETFB, APEX, COURSE, OTHER, null].map((p) => isEtfbOrApexProduct(p))))
}

console.log('\n=== The login with only its Whop check to go on (the company key\'s reads fail, so the self-heal finds nothing) ===')
for (const k of LISTED) {
  const m = MEMBERS[k]
  const db = freshWorld({ down: { admin: true } })
  const r = await logIn(m)
  ok(gotIn(r) && rowOf(db, m) && accountMade(db, m), `${m.who} (${m.product}) gets in on the login check`, show({ status: r.status, location: r.location }))
}
{
  const m = MEMBERS.other
  const db = freshWorld({ down: { admin: true } })
  const r = await logIn(m)
  ok(turnedAway(r) && !rowOf(db, m) && !accountMade(db, m),
    `${m.who} (${m.product}) is turned away: no row, no account`, show({ location: r.location.split('&')[0] }))
}

console.log('\n=== The login with only its self-heal to go on (the student\'s token gets the 404 legacy customers get) ===')
for (const k of LISTED) {
  const m = MEMBERS[k]
  const db = freshWorld({ down: { me: true } })
  const r = await logIn(m)
  const row = rowOf(db, m)
  ok(gotIn(r) && row?.membership_status === 'active' && row.whop_membership_id === m.id && row.whop_plan_id === m.plan,
    `${m.who} gets in on the self-heal, its row written active with its own membership and plan`,
    show({ location: r.location, row: row && { status: row.membership_status, membership: row.whop_membership_id, plan: row.whop_plan_id } }))
}
{
  const m = MEMBERS.other
  const db = freshWorld({ down: { me: true } })
  const r = await logIn(m)
  const askedProducts = whop.calls.filter((c) => c.path === '/api/v2/memberships' && c.params.user_id === m.user && c.params.product_id)
    .map((c) => c.params.product_id)
  ok(turnedAway(r) && !rowOf(db, m) && !accountMade(db, m), `${m.who} is turned away: no row, no account`, show({ location: r.location.split('&')[0] }))
  ok(same(askedProducts, [COURSE, ETFB, APEX]), 'and the self-heal asked Whop about the three listed products only', show(askedProducts))
}
{
  // A row the webhook wrote before login-1 for another product's membership:
  // the database is asked first, so it still lets that person in. Only that
  // membership ending (whop-webhook-old-rows.test.mjs) or a cleanup
  // (supabase/diagnostics/non-course-members-read.sql) closes it.
  const m = MEMBERS.other
  freshWorld({ students: [{ id: 'f0000000-0000-4000-8000-000000000001', whop_user_id: m.user, membership_status: 'active', whop_membership_id: m.id, whop_plan_id: m.plan }] })
  const r = await logIn(m)
  ok(gotIn(r), `${m.who} with an active row the old webhook wrote still gets in: the login asks the database first`, show({ location: r.location }))
}

console.log('\n=== The 2-hour sync walks the three listed products ===')
{
  const both = { user: 'user_TESTboth', who: 'a course member who also holds a newer Apex seat' }
  const BOTH_COURSE = { ...both, id: 'mem_TESTbothcourse', product: COURSE, plan: COURSE_PLAN }
  const BOTH_APEX = { ...both, id: 'mem_TESTbothapex', product: APEX, plan: MEMBERS.apex.plan }
  const PAID_AT = '2026-10-14T10:00:05.000Z'
  const STORED = '2026-10-02T09:00:00.000Z'
  const db = freshWorld({
    students: [{ id: 'f0000000-0000-4000-8000-000000000002', whop_user_id: both.user, membership_status: 'active', whop_membership_id: BOTH_COURSE.id, whop_plan_id: COURSE_PLAN, first_paid_at: STORED }],
    memberships: [
      ...Object.values(MEMBERS).map((m) => v2(m)),
      v2(BOTH_COURSE, { created_at: 1759000000 }),
      v2(BOTH_APEX, { created_at: 1760500000 }),
    ],
    payments: [payment(MEMBERS.course, PAID_AT)],
  })
  const [result] = await quietly(() => runWhopCommunitySync(fakeClient(db), 'cron'))
  const walked = whop.calls.filter((c) => c.path === '/api/v2/memberships' && !c.params.user_id).map((c) => c.params.product_id)
  ok(same(walked, [COURSE, ETFB, APEX]), 'Whop is asked for the members of the three listed products, each once', show(walked))
  for (const k of LISTED) {
    const m = MEMBERS[k]
    const row = rowOf(db, m)
    ok(row?.membership_status === 'active' && row.whop_membership_id === m.id && row.whop_plan_id === m.plan,
      `${m.who}: a row, active, with its own membership and plan`, show(row && { status: row.membership_status, membership: row.whop_membership_id, plan: row.whop_plan_id }))
  }
  ok(!rowOf(db, MEMBERS.other), 'the member of another product: no row (its product is never walked)')
  const upserted = db.calls('students', 'upsert').flatMap((q) => (Array.isArray(q.values) ? q.values : [q.values]))
  ok(upserted.length === 4 && upserted.every((v) => !('first_paid_at' in v)), 'no row of the sync\'s upsert names first_paid_at (the first-paid fix)', `${upserted.length} rows`)
  ok(rowOf(db, MEMBERS.course)?.first_paid_at === PAID_AT, 'the course member\'s empty first_paid_at is filled from the first real payment (the recovery pass)',
    show(rowOf(db, MEMBERS.course)?.first_paid_at))
  const paymentReads = whop.calls.filter((c) => c.path === '/api/v1/payments').map((c) => c.params.user_id)
  ok(rowOf(db, MEMBERS.apex)?.first_paid_at === null && rowOf(db, MEMBERS.etfb)?.first_paid_at === null && same(paymentReads, [MEMBERS.course.user]),
    'the Apex seat and the ETfB member, on plans outside PAYING_WHOP_PLAN_IDS: not read for a first payment by the sync, left empty (the login fills one from any real payment of theirs)',
    show({ reads: paymentReads }))
  const b = rowOf(db, both)
  ok(b?.membership_status === 'active' && b.whop_membership_id === BOTH_COURSE.id && b.whop_plan_id === COURSE_PLAN && b.first_paid_at === STORED,
    `${both.who}: the row keeps the course membership and its plan (the course wins over a newer Apex seat), so it stays on PAYING_WHOP_PLAN_IDS; first_paid_at kept`,
    show(b && { membership: b.whop_membership_id, plan: b.whop_plan_id, first_paid_at: b.first_paid_at }))
  const run = db.rows('sync_runs').at(-1)
  ok(result.fetched === 4 && result.inserted === 3 && result.updated === 1 && result.errors === 0 && run?.status === 'success',
    'the run: 4 members (one per user), 3 rows made, 1 updated, no error, logged as a success', show({ ...result, status_breakdown: undefined, run: run?.status }))
}

console.log('\n=== The sync\'s dedupe: the course wins over ETfB and Apex, whatever the order of the setting ===')
for (const order of [PRODUCTION, [APEX, ETFB, COURSE].join(',')]) {
  process.env.WHOP_PRODUCT_ID = order
  const when = (n) => 1759000000 + n * 100000
  const held = (user, id, product, plan, n, extra = {}) => v2({ user, id, product, plan }, { created_at: when(n), ...extra })
  const U = { etfb: 'user_TESTcourseetfb', twoApex: 'user_TESTtwoapex', twoCourse: 'user_TESTtwocourse', lapsed: 'user_TESTlapsed' }
  const db = freshWorld({
    memberships: [
      held(U.etfb, 'mem_TESTce_course', COURSE, COURSE_PLAN, 1),
      held(U.etfb, 'mem_TESTce_etfb', ETFB, MEMBERS.etfb.plan, 5),
      // Listed oldest first for the seats, newest first for the course, so
      // neither "the first listed wins" nor "the last listed wins" passes.
      held(U.twoApex, 'mem_TESTta_old', APEX, MEMBERS.apex.plan, 1),
      held(U.twoApex, 'mem_TESTta_new', APEX, MEMBERS.apex.plan, 5),
      held(U.twoCourse, 'mem_TESTtc_new', COURSE, COURSE_PLAN, 5),
      held(U.twoCourse, 'mem_TESTtc_old', COURSE, COURSE_PLAN, 1),
      held(U.lapsed, 'mem_TESTlc_course', COURSE, COURSE_PLAN, 5, { status: 'canceled', valid: false }),
      held(U.lapsed, 'mem_TESTlc_apex', APEX, MEMBERS.apex.plan, 1),
    ],
  })
  await quietly(() => runWhopCommunitySync(fakeClient(db), 'cron'))
  const at = (user) => {
    const r = db.rows('students').find((x) => x.whop_user_id === user)
    return r ? { membership: r.whop_membership_id, plan: r.whop_plan_id, status: r.membership_status } : null
  }
  const listed = order === PRODUCTION ? 'the course listed first' : 'the course listed last'
  ok(at(U.etfb)?.membership === 'mem_TESTce_course' && at(U.etfb)?.plan === COURSE_PLAN,
    `${listed}: a course member who also holds a newer ETfB membership keeps the course membership and plan`, show(at(U.etfb)))
  ok(at(U.twoApex)?.membership === 'mem_TESTta_new',
    `${listed}: two Apex seats, both valid: the newer one (within a kind the order is as before)`, show(at(U.twoApex)))
  ok(at(U.twoCourse)?.membership === 'mem_TESTtc_new',
    `${listed}: two course memberships, both valid: the newer one`, show(at(U.twoCourse)))
  ok(at(U.lapsed)?.membership === 'mem_TESTlc_apex' && at(U.lapsed)?.status === 'active',
    `${listed}: a canceled course membership and a valid Apex seat: the seat, active (access still comes first)`, show(at(U.lapsed)))
}
process.env.WHOP_PRODUCT_ID = PRODUCTION

console.log('\n=== The webhook takes the same three ===')
{
  let msg = 0
  const send = async (payload) => {
    const body = JSON.stringify(payload)
    const id = `msg_${++msg}`
    const ts = String(Math.floor(Date.now() / 1000))
    const sig = createHmac('sha256', SIGNING).update(`${id}.${ts}.${body}`).digest('base64')
    whop.calls = []
    const [res, log] = await quietly(() => webhook(new Request('http://app/api/webhooks/whop', {
      method: 'POST', headers: { 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': `v1,${sig}` }, body,
    })))
    return { status: res.status, log, whopCalls: whop.calls.length }
  }
  /** A membership event's data as Whop documents it (product and plan as objects). */
  const event = (type, m) => ({
    type,
    data: { id: m.id, user: { id: m.user, username: m.user, name: 'A Member', email: `${m.user}@example.com` }, status: 'active',
      joined_at: '2026-10-19T18:00:00.000Z', plan_id: m.plan, product: { id: m.product, title: 'A product' } },
  })
  const db = freshWorld()
  const statuses = []
  for (const m of Object.values(MEMBERS)) statuses.push((await send(event('membership.activated', m))).status)
  ok(statuses.every((s) => s === 200), 'every activation answers 200', show(statuses))
  for (const k of LISTED) {
    const m = MEMBERS[k]
    const row = rowOf(db, m)
    ok(row?.membership_status === 'active' && row.whop_membership_id === m.id && row.whop_plan_id === m.plan && row.first_paid_at === null,
      `membership.activated for ${m.who}: written active, with no first payment`, show(row && { membership: row.whop_membership_id, plan: row.whop_plan_id, first_paid_at: row.first_paid_at }))
  }
  ok(!rowOf(db, MEMBERS.other), 'membership.activated for the member of another product: nothing written')

  // The Apex seat ends: the seat is one of the three, so Whop is asked what else
  // grants access; nothing does, and the row is canceled.
  whop.memberships = whop.memberships.map((r) => (r.id === MEMBERS.apex.id ? { ...r, status: 'canceled', valid: false } : r))
  const ended = await send(event('membership.went_invalid', MEMBERS.apex))
  ok(ended.status === 200 && ended.whopCalls > 0 && rowOf(db, MEMBERS.apex)?.membership_status === 'canceled' && rowOf(db, MEMBERS.apex)?.canceled_at,
    'membership.went_invalid for the Apex seat, nothing else valid: Whop asked, the row canceled with the time', show({ whopCalls: ended.whopCalls, status: rowOf(db, MEMBERS.apex)?.membership_status }))
  const upserts = db.calls('students', 'upsert').flatMap((q) => (Array.isArray(q.values) ? q.values : [q.values]))
  ok(upserts.length === 3 && upserts.every((v) => !('first_paid_at' in v)), 'no upsert the webhook sent names first_paid_at', `${upserts.length} upserts`)

  console.log('\n=== The webhook: an ETfB or Apex membership leaves a course student\'s row on the course ===')
  const keeps = { user: 'user_TESTkeeps', who: 'a course student' }
  const K_COURSE = { ...keeps, id: 'mem_TESTkeepscourse', product: COURSE, plan: COURSE_PLAN }
  const K_APEX = { ...keeps, id: 'mem_TESTkeepsapex', product: APEX, plan: MEMBERS.apex.plan }
  const K_ETFB = { ...keeps, id: 'mem_TESTkeepsetfb', product: ETFB, plan: MEMBERS.etfb.plan }
  const PAID = '2026-10-02T09:00:00.000Z'
  /** The course student's row: active on the course membership and its paying plan. */
  const courseRow = (extra = {}) => ({
    id: 'f0000000-0000-4000-8000-000000000003', whop_user_id: keeps.user, membership_status: 'active',
    whop_membership_id: K_COURSE.id, whop_plan_id: COURSE_PLAN, first_paid_at: PAID, canceled_at: null, ...extra,
  })
  /** A payment event's data: the payment's own id, its product and its membership. */
  const paid = (m) => ({
    type: 'payment.succeeded',
    data: { id: `pay_TEST${m.id.slice(-6)}`, user: { id: m.user, username: m.user, name: 'A Member', email: `${m.user}@example.com` },
      membership: { id: m.id }, plan_id: m.plan, product: { id: m.product, title: 'A product' } },
  })
  const rowNow = (d) => JSON.stringify(rowOf(d, keeps))
  const upsertsOn = (d) => d.calls('students', 'upsert')
  for (const [what, payload] of [
    ['membership.activated for a newer Apex seat', event('membership.activated', K_APEX)],
    ['membership.went_valid for an ETfB membership', event('membership.went_valid', K_ETFB)],
    ['payment.succeeded for an ETfB membership', paid(K_ETFB)],
  ]) {
    const d = freshWorld({ students: [courseRow()] })
    const before = rowNow(d)
    const r = await send(payload)
    ok(r.status === 200 && rowNow(d) === before && upsertsOn(d).length === 0 && r.whopCalls === 0 &&
      r.log.some((l) => l.includes('left as it is')),
      `${what}, ${keeps.who} active on the course: 200, the row keeps the course membership and its plan, Whop not asked, the log says why`,
      show(rowOf(d, keeps) && { membership: rowOf(d, keeps).whop_membership_id, plan: rowOf(d, keeps).whop_plan_id }))
  }
  {
    const d = freshWorld({ students: [courseRow({ membership_status: 'past_due' })] })
    const before = rowNow(d)
    const r = await send(event('membership.activated', K_APEX))
    ok(r.status === 200 && rowNow(d) === before && upsertsOn(d).length === 0,
      `membership.activated for an Apex seat, ${keeps.who} past_due on the course: still past_due on the course membership and plan`,
      show(rowOf(d, keeps)?.membership_status))
  }
  {
    // No product in the payload: Whop's lookup lists the seat first, so the
    // membership it finds is the seat's, and that leaves the row too.
    const d = freshWorld({ students: [courseRow()], memberships: [v2(K_APEX), v2(K_COURSE)] })
    const before = rowNow(d)
    const r = await send({ type: 'membership.went_valid', data: { id: 'mem_TESTkeepsunnamed', user: { id: keeps.user, username: keeps.user, name: 'A Member', email: `${keeps.user}@example.com` }, status: 'active' } })
    ok(r.status === 200 && r.whopCalls > 0 && rowNow(d) === before && upsertsOn(d).length === 0,
      `went_valid with no product, Whop's lookup finding the Apex seat: ${keeps.who}'s row is left on the course`, show({ whopCalls: r.whopCalls }))
  }
  {
    const d = freshWorld({ students: [courseRow()] })
    d.fail['students.select'] = { message: 'connection reset' }
    const r = await send(event('membership.activated', K_APEX))
    ok(r.status === 500 && upsertsOn(d).length === 0,
      'the row cannot be read: 500 (Whop sends the event again), nothing written', show({ status: r.status }))
  }
  // What an ETfB or Apex event still writes.
  {
    const d = freshWorld({ students: [courseRow({ membership_status: 'canceled', canceled_at: '2026-10-10T00:00:00.000Z' })] })
    const r = await send(event('membership.activated', K_APEX))
    const row = rowOf(d, keeps)
    ok(r.status === 200 && row.membership_status === 'active' && row.whop_membership_id === K_APEX.id && row.whop_plan_id === K_APEX.plan &&
      row.canceled_at === null && row.first_paid_at === PAID && upsertsOn(d).every((q) => !('first_paid_at' in q.values)),
      'a lapsed course student (canceled) takes an Apex seat: written, active on the seat and its plan; first_paid_at kept and not sent',
      show({ status: row.membership_status, membership: row.whop_membership_id, plan: row.whop_plan_id, first_paid_at: row.first_paid_at }))
  }
  {
    const d = freshWorld({ students: [courseRow({ whop_membership_id: K_APEX.id, whop_plan_id: K_APEX.plan })] })
    const r = await send(event('membership.went_valid', K_APEX))
    ok(r.status === 200 && upsertsOn(d).length === 1 && rowOf(d, keeps).whop_membership_id === K_APEX.id,
      'went_valid for the Apex seat the row already points at: written', `${upsertsOn(d).length} upserts`)
  }
  {
    const d = freshWorld({ students: [courseRow({ whop_membership_id: K_ETFB.id, whop_plan_id: K_ETFB.plan })] })
    const r = await send(paid(K_ETFB))
    ok(r.status === 200 && upsertsOn(d).length === 1,
      'payment.succeeded naming the ETfB membership the row already points at: written', `${upsertsOn(d).length} upserts`)
  }
  {
    // A user with no row is covered above (the ETfB member and the Apex seat
    // get theirs). The other way round, as before: the course's own
    // activation points a row on an Apex seat at the course.
    const d = freshWorld({ students: [courseRow({ whop_membership_id: K_APEX.id, whop_plan_id: K_APEX.plan })] })
    const r = await send(event('membership.activated', K_COURSE))
    const row = rowOf(d, keeps)
    ok(r.status === 200 && row.whop_membership_id === K_COURSE.id && row.whop_plan_id === COURSE_PLAN,
      'membership.activated for the course, a row on an Apex seat: pointed at the course membership and its plan, as before',
      show({ membership: row.whop_membership_id, plan: row.whop_plan_id }))
  }
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
