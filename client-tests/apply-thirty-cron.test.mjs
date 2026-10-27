// apply-thirty-cron.test.mjs: the 30% that applies itself (T-137), work item 3
// of _admin/prds/thirty-automatic/thirty_automatic_prd.md in the workspace:
// the job, GET /api/cron/apply-thirty (every 10 minutes, at minutes 3, 13,
// 23, 33, 43 and 53). It finishes what the student's own Apply could not: a
// new code only for a request from the last 48 hours, after Approve's own
// checks; claims settled and made codes attached whatever their age; a wait
// after each failure (9 minutes for 1 or 2, 55 for 3 or more), a code on
// someone else's membership left alone; at most 25 requests a run, none
// started after 240 s; ?mode=dry reads only.
//
// What runs is the real source, copied by build.mjs: the route, over the real
// cron-auth.ts on stub-server.ts's database (its cron_runs rows included), the
// shared step (thirty-apply.ts), the coupon check and Whop's reads
// (membership-discount.ts) and the rule's copies. Whop's API is a stand-in
// fetch: a student's membership, their memberships by user (v2), their
// payments (so the coupon check answers live, as it does on production), the
// attach, the memberships holding a code and the codes made after a moment.
// The code Whop makes is stub-admin.ts's stand-in. The database runs with
// STUB_STRICT_NULL=1 (an .eq() handed null throws: a value read as NULL is
// matched with .is()), and runs no trigger, so these checks prove the audit
// columns each write sets and the app's own attempt_failed rows.
//
// The clock is the suite's, as in thirty-apply.test.mjs: `new Date()` and
// `Date.now()` answer it and setTimeout moves it, so the 4-a-second pace
// costs nothing. No request leaves the machine. Every Whop id, key, name,
// secret and code here is made up.
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v)
const here = (rel) => fileURLToPath(new URL(rel, import.meta.url))
const read = (rel) => fs.readFileSync(here(rel), 'utf8')

// ── The clock ────────────────────────────────────────────────────────────────
const RealDate = Date
const realSetTimeout = globalThis.setTimeout
const NOW = '2026-10-26T10:00:00.000Z' // Mon 26 Oct, 11:00 in Croatia
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
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const ago = (ms) => new Date(Date.now() - ms).toISOString()

// ── The deployment ───────────────────────────────────────────────────────────
const SECRET = 'cron-test-secret'
const COMPANY = 'biz_devCompany'
const COURSE = 'prod_devCourse'
const MONTHLY = 'plan_devMonthly97'
process.env.WHOP_API_KEY = 'whop-test-key'
process.env.WHOP_COMPANY_ID = COMPANY
process.env.WHOP_PRODUCT_ID = COURSE
process.env.CRON_SECRET = SECRET
process.env.STUB_STRICT_NULL = '1'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'
delete process.env.THIRTY_AUTO_APPLY
delete process.env.WHOP_DISCOUNT_PLAN_IDS

// ── Whop, standing in ────────────────────────────────────────────────────────
const whop = {
  /** id -> { id, user, status, promo, renewal }: a course membership, read alone, listed by user, or holding a code. */
  memberships: new Map(),
  /** Whop user id -> their real payments, in the pinned shape. */
  payments: new Map(),
  /** Codes put on Whop by the test: { id, code, created_at } (a code the step makes is stub-admin.ts's promo_<n>). */
  codes: [],
  /** Every request: method, path, the query. */
  log: [],
  /** (request) => a Response, 'throw' or null: an answer of the test's choosing, before any other. */
  answer: null,
}
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const money = (amount) => (amount === null ? null : { amount, currency: 'usd' })
const pinnedOf = (m) => ({
  id: m.id, status: m.status, user_id: m.user, product_id: COURSE, plan_id: MONTHLY, promo_code_id: m.promo,
  renewal_price: money(m.renewal), cancel_at_period_end: false,
})
const listedOf = (m) => ({ ...pinnedOf(m), user: { id: m.user, username: 'someone' }, product: { id: COURSE, title: 'The Sprint' } })
/** A membership as v2 lists it for its user: flat ids, status and valid. */
const v2Of = (m) => ({ id: m.id, user: m.user, product: COURSE, plan: MONTHLY, status: m.status, valid: true, created_at: 1_760_000_000 })
// stub-admin.ts's create: what the step asked for, in order (promo_<n> is the n-th).
const { promoCodes } = await import('./_gen/stub-admin.ts')
/** A code's id by its name: one the test put on Whop, else the one the create gave it. */
const codeId = (name) => {
  const n = String(name).toLowerCase()
  const put = whop.codes.findLast((c) => c.code.toLowerCase() === n)
  if (put) return put.id
  const made = promoCodes.findLastIndex((p) => String(p.code).toLowerCase() === n)
  return made < 0 ? null : `promo_${made + 1}`
}
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url))
  if (u.hostname !== 'api.whop.com') throw new Error(`the suite let a request go to ${u.hostname}`)
  const req = { method: init.method ?? 'GET', path: u.pathname, params: u.searchParams }
  whop.log.push(req)
  const special = whop.answer ? await whop.answer(req) : null
  if (special === 'throw') throw new TypeError('fetch failed')
  if (special) return special
  const attach = u.pathname.match(/^\/api\/v1\/memberships\/([^/]+)\/apply_promo_code$/)
  if (req.method === 'POST' && attach) {
    const m = whop.memberships.get(decodeURIComponent(attach[1]))
    if (!m) return json(404, { error: { message: 'Membership not found.' } })
    if (m.promo) return json(400, { error: { message: 'This membership already has a promo code.' } })
    const id = codeId(JSON.parse(init.body).promo_code)
    if (!id) return json(400, { error: { message: 'Promo code not found.' } })
    m.promo = id
    return json(200, pinnedOf(m))
  }
  if (req.method !== 'GET') return json(404, { error: { message: 'Not found' } })
  if (u.pathname === '/api/v1/memberships') {
    if (u.searchParams.get('company_id') !== COMPANY) return json(400, { error: { message: 'company_id is required' } })
    const rows = [...whop.memberships.values()].filter((m) => m.promo === u.searchParams.get('promo_code_ids'))
    return json(200, { data: rows.map(listedOf), page_info: { has_next_page: false, end_cursor: null } })
  }
  if (u.pathname === '/api/v2/memberships') {
    const mine = [...whop.memberships.values()].filter((m) => m.user === u.searchParams.get('user_id'))
    return json(200, { data: mine.map(v2Of), pagination: { current_page: 1, total_page: 1, total_count: mine.length } })
  }
  if (u.pathname === '/api/v1/payments') {
    return json(200, { data: whop.payments.get(u.searchParams.get('user_id')) ?? [], page_info: { has_next_page: false, end_cursor: null } })
  }
  if (u.pathname === '/api/v1/promo_codes') {
    if (u.searchParams.get('account_id') !== COMPANY) return json(400, { error: { message: 'account_id is required' } })
    const after = Date.parse(u.searchParams.get('created_after'))
    const rows = whop.codes.filter((c) => Date.parse(c.created_at) > after)
    return json(200, { data: rows.map((c) => ({ id: c.id, code: c.code, created_at: c.created_at })), page_info: { has_next_page: false, end_cursor: null } })
  }
  const one = u.pathname.match(/^\/api\/v1\/(memberships|plans|promo_codes)\/([^/]+)$/)
  if (one) {
    const id = decodeURIComponent(one[2])
    if (one[1] === 'plans') return json(200, { id, plan_type: 'renewal', renewal_price: '97.00' })
    if (one[1] === 'promo_codes') {
      const name = whop.codes.find((c) => c.id === id)?.code
      return name ? json(200, { id, code: name }) : json(404, { error: { message: 'Not found' } })
    }
    const m = whop.memberships.get(id)
    return m ? json(200, pinnedOf(m)) : json(404, { error: { message: 'Not found' } })
  }
  return json(404, { error: { message: 'Not found' } })
}
const posts = () => whop.log.filter((r) => r.method === 'POST')

const S = await import('./_gen/stub-server.ts')
const { FakeDb, useDb: installDb, setCatalog } = S
const { GET: jobRoute } = await import('./_gen/apply-thirty-route.ts')
const { teamThirtyCodeFor } = await import('./_gen/membership-discount.ts')

/** Runs `fn` with what it logs kept off the suite's output and handed back. */
async function quiet(fn) {
  const real = [console.info, console.warn, console.error]
  const lines = []
  console.info = console.warn = console.error = (...a) => { lines.push(a.map(String).join(' ')) }
  try { return { value: await fn(), lines } } finally { [console.info, console.warn, console.error] = real }
}
/** One run of the job: `query` its ?mode, `auth` the header (null: none). */
async function run(query = '', auth = `Bearer ${SECRET}`) {
  const r = await quiet(async () => {
    const res = await jobRoute(new Request(`http://app/api/cron/apply-thirty${query}`, { headers: auth === null ? {} : { authorization: auth } }))
    return { status: res.status, body: await res.json() }
  })
  return { ...r.value, lines: r.lines }
}

// ── The database ─────────────────────────────────────────────────────────────
const NAME = /^ECOM30-[A-HJ-NP-Z2-9]{6}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const SEEDED = '99999999-9999-4999-8999-999999999999'
const PAID_AT = '2026-10-20T10:00:00.000Z'
const sid = (k) => `5a1b2c3d-0000-4000-8000-${String(k).padStart(12, '0')}`
/**
 * The new course (two videos up to the gate) and students 1..n, each paid on 20 October, their course membership on
 * Whop (active, renewing at 97.00, no code) with a real 97.00 payment for it, so the coupon check answers live, and
 * both videos watched unless `unwatched` names them; `requests` beside them. `whopless` names students with no Whop
 * user or membership at all (their requests are read for the code alone).
 */
function seed({ students = 1, requests = [], unwatched = [], whopless = [], events = [] } = {}) {
  setCatalog({ v2: true, lessonsTable: 'lessons' })
  whop.memberships = new Map()
  whop.payments = new Map()
  whop.codes = []
  whop.log = []
  whop.answer = null
  const people = []
  for (let k = 1; k <= students; k++) {
    if (whopless.includes(k)) {
      people.push({ id: sid(k), first_paid_at: PAID_AT, joined_at: PAID_AT })
      continue
    }
    people.push({ id: sid(k), first_paid_at: PAID_AT, joined_at: PAID_AT, whop_user_id: `user_s${k}`, whop_membership_id: `mem_s${k}` })
    whop.memberships.set(`mem_s${k}`, { id: `mem_s${k}`, user: `user_s${k}`, status: 'active', promo: null, renewal: '97.00' })
    whop.payments.set(`user_s${k}`, [{
      id: `pay_s${k}`, status: 'paid', substatus: 'succeeded', paid_at: PAID_AT, created_at: PAID_AT, total: money('97.00'), subtotal: money('97.00'),
      tax_amount: null, tax_behavior: null, refunded_amount: money('0.00'), user: { id: `user_s${k}` }, product_id: COURSE, membership_id: `mem_s${k}`, promo_code_id: null,
    }])
  }
  const db = new FakeDb({
    students: people,
    lessons: [
      { id: 'a1l01', type: 'watch', sort_order: 1, duration_seconds: 300 },
      { id: 'a1l02', type: 'watch', sort_order: 2, duration_seconds: 300, is_gate: true },
    ],
    lesson_videos: [{ lesson_id: 'a1l01', created_at: '2026-10-01T00:00:00.000Z' }, { lesson_id: 'a1l02', created_at: '2026-10-01T00:00:00.000Z' }],
    student_lesson_completions: people.filter((_, i) => !unwatched.includes(i + 1)).flatMap((p) => ['a1l01', 'a1l02'].map((lesson_id) => ({ student_id: p.id, lesson_id, completed_at: '2026-10-21T10:00:00.000Z' }))),
    discount_requests: requests,
    discount_request_events: events,
    student_membership_discounts: [],
    admin_config: [],
    cron_runs: [],
  })
  installDb(db)
  return db
}
const req = (id, k, more = {}) => ({ id, student_id: sid(k), status: 'pending', created_at: ago(10 * MIN), ...more })
/** A failure already recorded for a request (by an earlier run). */
const failure = (requestId, k, at, reason = 'whop_no_answer') => ({ request_id: requestId, student_id: sid(k), event: 'attempt_failed', actor: 'job', correlation_id: SEEDED, reason, detail: { step: 'where' }, created_at: at })
const row = (db, id) => db.rows('discount_requests').find((r) => r.id === id)
const newEvents = (db) => db.rows('discount_request_events').filter((e) => e.correlation_id !== SEEDED)
const lastRun = (db) => db.rows('cron_runs').at(-1)

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== One run, every kind of request: what is taken, and what is done ===')
{
  const db = seed({
    students: 9,
    unwatched: [9],
    requests: [
      // 1. a request with no code, made 10 minutes ago: Approve's checks, then claimed, made and attached
      req('fresh', 1),
      // 2. approved 20 days ago, its code on Whop and on nobody's membership: attached
      req('approved', 2, { status: 'approved', promo_code: 'ECOM30-APPRVD', whop_promo_id: 'promo_devApproved', created_at: ago(20 * DAY), reviewed_at: ago(20 * DAY) }),
      // 3. approved, its code already on their membership (attached in Whop by hand): marked applied, nothing attached
      req('onTheirs', 3, { status: 'approved', promo_code: 'ECOM30-ONTHRS', whop_promo_id: 'promo_devOnTheirs', created_at: ago(9 * DAY) }),
      // 4. a claim 5 days old that lost its answer, its code made: settled, then attached
      req('settledFound', 4, { promo_code: 'ECOM30-CLAIMD', promo_claimed_at: ago(5 * DAY), created_at: ago(5 * DAY) }),
      // 5. a claim 30 minutes old whose code was never made: released, Approve's checks, made anew and attached
      req('settledAnew', 5, { promo_code: 'ECOM30-NEVERA', promo_claimed_at: ago(30 * MIN), created_at: ago(31 * MIN) }),
      // 6. a claim 3 days old whose code was never made: released, and no new code (past 48 hours)
      req('settledOld', 6, { promo_code: 'ECOM30-NEVERB', promo_claimed_at: ago(3 * DAY), created_at: ago(3 * DAY) }),
      // 7. a request with no code, made 3 days ago: the job's 48 hours are over, the team's now
      req('stale', 7, { created_at: ago(3 * DAY) }),
      // 8. made a minute ago: still the student's own request's to finish
      req('young', 8, { created_at: ago(MIN) }),
      // 9. a request with no code, its videos not watched: Approve's checks refuse it
      req('refused', 9, { created_at: ago(HOUR) }),
    ],
  })
  whop.codes.push({ id: 'promo_devApproved', code: 'ECOM30-APPRVD', created_at: ago(20 * DAY) })
  whop.codes.push({ id: 'promo_devOnTheirs', code: 'ECOM30-ONTHRS', created_at: ago(9 * DAY) })
  whop.memberships.get('mem_s3').promo = 'promo_devOnTheirs'
  whop.codes.push({ id: 'promo_devClaimed', code: 'ECOM30-CLAIMD', created_at: ago(5 * DAY - 1000) })
  const before = Object.fromEntries(['stale', 'young'].map((id) => [id, show(row(db, id))]))
  const codes = promoCodes.length
  const r = await run()
  const b = r.body
  ok(r.status === 200 && b.ok === true && b.paused === false && b.mode === 'write' && b.examined === 7 && b.applied === 5 && b.waiting === 2 && b.skipped === 0
       && b.gaveUp === 0 && show(b.byReason) === show({ check_refused: 1 }) && show(b.planned) === show([]) && show(b.failed) === show([]),
     'the answer: 7 requests read (not the one past 48 hours with no code, not the one a minute old), 5 applied, 2 waiting, no failure', show(b))
  ok(show(['fresh', 'approved', 'onTheirs', 'settledFound', 'settledAnew'].map((id) => row(db, id).status)) === show(Array(5).fill('applied')),
     'applied: the new request, the approved one, the one already on their membership, the lost claim found, the lost claim made anew', show(['fresh', 'approved', 'onTheirs', 'settledFound', 'settledAnew'].map((id) => [id, row(db, id).status])))
  ok(whop.memberships.get('mem_s1').promo === row(db, 'fresh').whop_promo_id && NAME.test(row(db, 'fresh').promo_code)
       && whop.memberships.get('mem_s2').promo === 'promo_devApproved' && whop.memberships.get('mem_s4').promo === 'promo_devClaimed' && row(db, 'settledFound').whop_promo_id === 'promo_devClaimed'
       && whop.memberships.get('mem_s5').promo === row(db, 'settledAnew').whop_promo_id && row(db, 'settledAnew').promo_code !== 'ECOM30-NEVERA' && NAME.test(row(db, 'settledAnew').promo_code),
     'each code on its own student\'s membership: the found claim\'s code kept, the never-made one replaced by a new random name', show(['fresh', 'settledFound', 'settledAnew'].map((id) => row(db, id).promo_code)))
  ok(promoCodes.length === codes + 2 && posts().length === 4 && !posts().some((p) => p.path.includes('mem_s3')),
     'two codes made (the new request, the claim made anew), four attaches, none for the code already on their membership', show(posts().map((p) => p.path)))
  ok(row(db, 'settledOld').status === 'pending' && row(db, 'settledOld').promo_code === null && row(db, 'settledOld').promo_claimed_at === null,
     'the lost claim 3 days old: given back, and no new code (it waits for the team)', show(row(db, 'settledOld')))
  ok(show(before) === show(Object.fromEntries(['stale', 'young'].map((id) => [id, show(row(db, id))]))),
     'the request past 48 hours with no code, and the one a minute old: untouched')
  const refused = newEvents(db).filter((e) => e.request_id === 'refused')
  ok(row(db, 'refused').status === 'pending' && row(db, 'refused').promo_code === null && refused.length === 1 && refused[0].event === 'attempt_failed'
       && refused[0].reason === 'check_refused' && refused[0].actor === 'job' && refused[0].team_member_id === null && refused[0].detail.step === null
       && refused[0].detail.message.startsWith('Student has not watched 80% of the videos up to the discount checkpoint'),
     'Approve\'s checks refusing a request with no code: one attempt_failed check_refused by the job, the check\'s own sentence, no code made', show(refused))
  // The checks ran only before a new code: the new request, the claim made anew and the refused one.
  ok(db.calls('lesson_videos', 'select').length === 3, 'Approve\'s checks ran three times, each before a new code (never for an approved request or a found claim)', String(db.calls('lesson_videos', 'select').length))
  const w = db.calls('discount_requests', 'update')
  const corr = new Set([...w.map((x) => x.values.audit_correlation_id), ...newEvents(db).map((e) => e.correlation_id)])
  ok(w.length > 0 && w.every((x) => x.values.audit_actor === 'job' && x.values.audit_team_member_id === null) && corr.size === 1 && UUID.test([...corr][0]),
     'every write and event of the run: the job as the actor, no team member, one correlation id for the run', show({ writes: w.length, corr: [...corr] }))
  const cron = lastRun(db)
  ok(cron?.route_name === 'apply-thirty' && cron.auth_status === 'ok' && cron.status === 'success' && cron.rows_affected === 5 && cron.error_message === null && typeof cron.finished_at === 'string',
     'cron_runs: the run\'s row, success, rows_affected the 5 applied', show(cron))
  ok(!/@|user_s|mem_s|pay_s|promo_dev|ECOM30/.test(show(b)), 'the answer names request ids only: no student, no email, no Whop id, no code')
  ok(db.rows('student_membership_discounts').length === 3, 'a real run stores the coupon check\'s live answers, as Approve does (3 students checked)', String(db.rows('student_membership_discounts').length))
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== ?mode=dry: what a run would do, and nothing stored ===')
{
  const db = seed({
    students: 6,
    unwatched: [6],
    requests: [
      req('fresh', 1),
      req('approved', 2, { status: 'approved', promo_code: 'ECOM30-APPRVD', whop_promo_id: 'promo_devApproved', created_at: ago(20 * DAY) }),
      req('onTheirs', 3, { status: 'approved', promo_code: 'ECOM30-ONTHRS', whop_promo_id: 'promo_devOnTheirs', created_at: ago(9 * DAY) }),
      req('settledFound', 4, { promo_code: 'ECOM30-CLAIMD', promo_claimed_at: ago(5 * DAY), created_at: ago(5 * DAY) }),
      req('settledAnew', 5, { promo_code: 'ECOM30-NEVERA', promo_claimed_at: ago(30 * MIN), created_at: ago(31 * MIN) }),
      req('refused', 6, { created_at: ago(HOUR) }),
    ],
  })
  whop.codes.push({ id: 'promo_devApproved', code: 'ECOM30-APPRVD', created_at: ago(20 * DAY) })
  whop.codes.push({ id: 'promo_devOnTheirs', code: 'ECOM30-ONTHRS', created_at: ago(9 * DAY) })
  whop.memberships.get('mem_s3').promo = 'promo_devOnTheirs'
  whop.codes.push({ id: 'promo_devClaimed', code: 'ECOM30-CLAIMD', created_at: ago(5 * DAY - 1000) })
  const before = show(db.rows('discount_requests'))
  const codes = promoCodes.length
  const r = await run('?mode=dry')
  const plan = r.body.planned.map((p) => [p.requestId, p.would, p.reason, p.status]).sort()
  ok(r.status === 200 && r.body.ok === true && r.body.mode === 'dry' && r.body.applied === 0 && r.body.examined === 6 && r.body.planned.length === 6
       && show(r.body.planned.map((p) => p.requestId)) === show(['refused', 'settledAnew', 'fresh', 'approved', 'onTheirs', 'settledFound']),
     'a dry run answers 200, mode dry, nothing applied, a plan for each request it took: the last 48 hours\' first, then the ones never tried, each oldest first', show(r.body))
  ok(show(plan) === show([
    ['approved', 'attach', null, 'approved'], ['fresh', 'claim_and_make', null, 'pending'], ['onTheirs', 'mark_applied', null, 'approved'],
    ['refused', null, 'check_refused', 'pending'], ['settledAnew', 'settle_claim', null, 'pending'], ['settledFound', 'settle_claim', null, 'pending'],
  ]),
     'the plan: attach the approved one, mark the one on their membership applied, settle both lost claims, make and attach the new one; the refused one says why', show(plan))
  ok(show(db.rows('discount_requests')) === before && db.calls('discount_requests', 'update').length === 0 && db.rows('discount_request_events').length === 0
       && db.rows('student_membership_discounts').length === 0 && posts().length === 0 && promoCodes.length === codes,
     'nothing claimed, made, attached, stored or recorded: no write to the requests, no event, no coupon answer stored, no Whop write, no code', show({ events: db.rows('discount_request_events').length, posts: posts().length }))
  ok(lastRun(db)?.status === 'success' && lastRun(db).rows_affected === 0, 'cron_runs: the dry run\'s row, success, 0 rows', show(lastRun(db)))
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== The wait after a failure, a code on someone else\'s membership, 25 a run ===')
{
  // 30 approved requests, oldest first (t1 the oldest), for 30 students with no membership on file: each one taken is
  // asked where its code is (nowhere) and then has nowhere to go (no_membership, recorded by this run).
  const requests = []
  const events = []
  for (let k = 1; k <= 30; k++) {
    requests.push(req(`t${k}`, k, { status: 'approved', promo_code: `ECOM30-T${String(k).padStart(5, '0')}`.slice(0, 13), whop_promo_id: `promo_devT${k}`, created_at: ago((31 - k) * HOUR) }))
  }
  // t1: one failure 5 minutes ago (waits 9). t2: two, the newest 10 minutes ago (taken). t3: three, the newest 30 minutes
  // ago (waits 55). t4: three, the newest an hour ago (taken). t5: the newest a code on someone else's membership, 3 days
  // ago (left alone). t6: an older landed_elsewhere, then a newer failure 20 minutes ago (taken).
  events.push(failure('t1', 1, ago(5 * MIN)))
  events.push(failure('t2', 2, ago(40 * MIN)), failure('t2', 2, ago(10 * MIN)))
  events.push(failure('t3', 3, ago(3 * HOUR)), failure('t3', 3, ago(2 * HOUR)), failure('t3', 3, ago(30 * MIN)))
  events.push(failure('t4', 4, ago(3 * HOUR)), failure('t4', 4, ago(2 * HOUR)), failure('t4', 4, ago(HOUR)))
  events.push(failure('t5', 5, ago(3 * DAY), 'landed_elsewhere'))
  events.push(failure('t6', 6, ago(2 * DAY), 'landed_elsewhere'), failure('t6', 6, ago(20 * MIN)))
  const db = seed({ students: 30, whopless: Array.from({ length: 30 }, (_, i) => i + 1), requests, events })
  const r = await run()
  const taken = [...new Set(newEvents(db).map((e) => e.request_id))]
  const want = ['t2', 't4', ...Array.from({ length: 23 }, (_, i) => `t${i + 6}`)]
  ok(r.status === 200 && r.body.examined === 30 && r.body.skipped === 3 && r.body.waiting === 25 && show(r.body.byReason) === show({ no_membership: 25 }),
     '30 read, 3 passed over by the wait or the landed_elsewhere rule, 25 worked on (the run\'s limit), each left approved with no membership to go to', show(r.body))
  ok(show([...taken].sort()) === show([...want].sort()) && newEvents(db).every((e) => e.reason === 'no_membership' && e.actor === 'job'),
     'taken: t2 (2 failures, the newest 10 minutes ago), t4 (3, the newest an hour ago), t6 (the newest no landed_elsewhere) and the oldest after them up to 25; not t1 (5 minutes), t3 (30 minutes after 3), t5 (landed_elsewhere), t29, t30 (past the 25)',
     show({ notTaken: requests.map((x) => x.id).filter((id) => !taken.includes(id)) }))
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== The build\'s review of 2026-10-27: requests that cannot finish never keep a new one waiting ===')
/** A failure recorded by an earlier run, with the detail the step writes (its step and the membership's status). */
const failedWith = (requestId, k, at, reason, detail = {}) =>
  ({ request_id: requestId, student_id: sid(k), event: 'attempt_failed', actor: 'job', correlation_id: SEEDED, reason, detail: { step: 'membership', ...detail }, created_at: at })
{
  // The review's own case: 200 approved requests from early October whose memberships were canceled, each tried 3
  // times (the last 70 minutes ago), and one new student whose Apply could not finish 12 minutes ago (Whop silent).
  const N = 200
  const requests = []
  const events = []
  for (let k = 1; k <= N; k++) {
    const made = new Date(RealDate.parse('2026-10-02T08:00:00.000Z') + k * MIN).toISOString()
    requests.push(req(`old${k}`, k, { status: 'approved', promo_code: `ECOM30-OLD${String(k).padStart(3, '0')}`, whop_promo_id: `promo_old${k}`, created_at: made, reviewed_at: made }))
    for (let f = 0; f < 3; f++) events.push(failedWith(`old${k}`, k, ago(70 * MIN + f * MIN), 'membership_not_active', { membership_status: 'canceled' }))
  }
  requests.push(req('fresh', N + 1, { created_at: ago(15 * MIN) }))
  events.push(failedWith('fresh', N + 1, ago(12 * MIN), 'whop_no_answer', { step: 'create' }))
  const db = seed({ students: N + 1, requests, events })
  for (let k = 1; k <= N; k++) whop.memberships.get(`mem_s${k}`).status = 'canceled'
  const r = await run()
  const taken = [...new Set(newEvents(db).map((e) => e.request_id))]
  ok(r.status === 200 && r.body.examined === N + 1 && row(db, 'fresh').status === 'applied' && r.body.applied === 1 && r.body.skipped === 0 && r.body.stopped === 0
       && taken.length === 24 && taken.every((id) => id.startsWith('old')) && show(r.body.byReason) === show({ membership_not_active: 24 }),
     `${N} approved requests on canceled memberships, read in full, and a new request whose Apply failed 12 minutes ago: the new one goes first and is applied in the first run, then 24 of the old ones (until the review, it was never read)`,
     show({ body: { ...r.body, planned: undefined }, fresh: row(db, 'fresh').status, taken: taken.length }))
}
{
  // 200 approved requests whose codes are on someone else's membership (landed_elsewhere) beside a new request: the
  // 200 are passed over before anything is cut, so the new one is read and worked on.
  const N = 200
  const requests = []
  const events = []
  for (let k = 1; k <= N; k++) {
    requests.push(req(`land${k}`, k, { status: 'approved', promo_code: `ECOM30-L${String(k).padStart(5, '0')}`, whop_promo_id: `promo_land${k}`, created_at: new Date(RealDate.parse('2026-10-02T08:00:00.000Z') + k * MIN).toISOString() }))
    events.push(failedWith(`land${k}`, k, ago(3 * DAY), 'landed_elsewhere', { step: 'other_person' }))
  }
  requests.push(req('fresh', N + 1, { created_at: ago(15 * MIN) }))
  const db = seed({ students: N + 1, whopless: Array.from({ length: N }, (_, i) => i + 1), requests, events })
  const r = await run()
  ok(r.body.examined === N + 1 && r.body.skipped === N && row(db, 'fresh').status === 'applied' && newEvents(db).every((e) => e.request_id === 'fresh'),
     `${N} codes on someone else's membership: all ${N} passed over, the new request read, taken and applied (until the review the run read those ${N} alone and worked on nothing)`, show({ ...r.body, planned: undefined }))
}
{
  // The job stops trying a request whose newest failure only a person can clear, after 6 failures (jobGivesUp).
  const OLD = (d) => ago(d * DAY)
  const at = (h) => ago(h * HOUR)
  const six = (id, k, reason, detail) => Array.from({ length: 6 }, (_, i) => failedWith(id, k, at(2 + i), reason, detail))
  const db = seed({
    students: 7,
    whopless: [1, 2, 3, 4, 5, 6, 7],
    requests: [
      req('code6', 1, { status: 'approved', promo_code: 'ECOM30-CODE6A', whop_promo_id: 'promo_code6', created_at: OLD(9) }),
      req('code5', 2, { status: 'approved', promo_code: 'ECOM30-CODE5A', whop_promo_id: 'promo_code5', created_at: OLD(9) }),
      req('canc6', 3, { status: 'approved', promo_code: 'ECOM30-CANC6A', whop_promo_id: 'promo_canc6', created_at: OLD(9) }),
      req('past6', 4, { status: 'approved', promo_code: 'ECOM30-PAST6A', whop_promo_id: 'promo_past6', created_at: OLD(9) }),
      req('noid6', 5, { status: 'approved', promo_code: 'ECOM30-NOID6A', whop_promo_id: null, created_at: OLD(9) }),
      req('same1', 6, { status: 'approved', promo_code: 'ECOM30-SAME1A', whop_promo_id: 'promo_same1', created_at: OLD(9) }),
      req('mixed7', 7, { status: 'approved', promo_code: 'ECOM30-MIXD7A', whop_promo_id: 'promo_mixed7', created_at: OLD(9) }),
    ],
    events: [
      ...six('code6', 1, 'membership_has_code', { membership_status: 'active' }),
      ...six('code5', 2, 'membership_has_code', { membership_status: 'active' }).slice(1),
      ...six('canc6', 3, 'membership_not_active', { membership_status: 'canceled' }),
      ...six('past6', 4, 'membership_not_active', { membership_status: 'past_due' }),
      ...six('noid6', 5, 'code_unknown', { step: null }),
      failedWith('same1', 6, at(2), 'write_failed', { step: 'attach_other_code', membership_status: 'active' }),
      // Six earlier failures of another code, then Whop silent: the newest decides, so it is still tried.
      ...six('mixed7', 7, 'membership_has_code', { membership_status: 'active' }).map((e) => ({ ...e, created_at: new Date(RealDate.parse(e.created_at) - HOUR).toISOString() })),
      failedWith('mixed7', 7, at(2), 'whop_no_answer', { step: 'where' }),
    ],
  })
  const r = await run()
  const taken = [...new Set(newEvents(db).map((e) => e.request_id))].sort()
  ok(r.body.examined === 7 && r.body.stopped === 3 && r.body.skipped === 1 && show(taken) === show(['code5', 'mixed7', 'past6']),
     'stopped: another code on the membership after 6 failures, a canceled membership after 6, a code with no Whop id after 6; skipped: another code of its name Whop put on their membership; still tried: 5 failures, past_due (Whop retries the payment), and a request whose newest failure is Whop being silent',
     show({ stopped: r.body.stopped, skipped: r.body.skipped, taken }))
}
{
  // The order, as a dry run plans it: the last 48 hours' first, then never tried, then the longest since its last failure.
  const db = seed({
    students: 4,
    whopless: [2, 3, 4],
    requests: [
      req('o1', 4, { status: 'approved', promo_code: 'ECOM30-ORDR1A', whop_promo_id: 'promo_o1', created_at: ago(10 * DAY) }),
      req('o2', 3, { status: 'approved', promo_code: 'ECOM30-ORDR2A', whop_promo_id: 'promo_o2', created_at: ago(5 * DAY) }),
      req('u1', 2, { status: 'approved', promo_code: 'ECOM30-ORDR3A', whop_promo_id: 'promo_u1', created_at: ago(20 * DAY) }),
      req('f1', 1, { created_at: ago(HOUR) }),
    ],
    events: [failedWith('o1', 4, ago(3 * HOUR), 'whop_no_answer', { step: 'where' }), failedWith('o2', 3, ago(5 * HOUR), 'whop_no_answer', { step: 'where' })],
  })
  const r = await run('?mode=dry')
  ok(show(r.body.planned.map((p) => p.requestId)) === show(['f1', 'u1', 'o2', 'o1']) && db.rows('discount_request_events').every((e) => e.correlation_id === SEEDED),
     'the order: the request from the last 48 hours, then the one never tried (20 days old), then the one whose last failure was 5 hours ago before the one at 3 hours', show(r.body.planned.map((p) => p.requestId)))
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== Requests whose 48 hours just ended; a step that fails; no request started after 240 s ===')
{
  const db = seed({
    students: 3,
    requests: [
      req('justOver', 1, { created_at: ago(48 * HOUR + 5 * MIN) }),
      req('longOver', 2, { created_at: ago(48 * HOUR + 20 * MIN) }),
      req('justIn', 3, { created_at: ago(48 * HOUR - 5 * MIN) }),
    ],
  })
  const r = await run()
  ok(r.body.gaveUp === 1 && r.body.examined === 1 && row(db, 'justIn').status === 'applied' && row(db, 'justOver').status === 'pending' && row(db, 'longOver').status === 'pending',
     'gaveUp: 1, the request with no code whose 48 hours ended 5 minutes ago (not the one 20 minutes ago); the one 5 minutes inside them is taken and applied', show(r.body))
}
{
  // An approved request whose student cannot be read: the step throws, the run goes on and is a failure.
  const db = seed({
    students: 2,
    requests: [
      req('ghost', 1, { status: 'approved', promo_code: 'ECOM30-GHOSTA', whop_promo_id: 'promo_devGhost', created_at: ago(3 * DAY), student_id: '5a1b2c3d-0000-4000-8000-0000000000ff' }),
      req('fine', 2, { status: 'approved', promo_code: 'ECOM30-FINEAA', whop_promo_id: 'promo_devFine', created_at: ago(2 * DAY) }),
    ],
  })
  whop.codes.push({ id: 'promo_devFine', code: 'ECOM30-FINEAA', created_at: ago(2 * DAY) })
  const r = await run()
  ok(r.status === 500 && r.body.ok === false && show(r.body.failed) === show(['ghost']) && r.body.applied === 1 && row(db, 'fine').status === 'applied'
       && lastRun(db).status === 'failed' && lastRun(db).error_message === 'the step failed for 1 of 2 requests: ghost' && lastRun(db).rows_affected === 1
       && r.lines.some((l) => l.includes('[apply-thirty] request ghost: the step failed')),
     'a step that throws (its student unreadable): the run goes on (the next request applied), answers 500 naming the request, cron_runs failed with it', show({ body: r.body, run: lastRun(db) }))
}
{
  // The first request's Whop read takes 241 s: no request is started after 240 s. All three older than 48 hours and
  // never tried, so the oldest goes first.
  const db = seed({
    students: 3,
    whopless: [1, 2, 3],
    requests: [1, 2, 3].map((k) => req(`slow${k}`, k, { status: 'approved', promo_code: `ECOM30-SLOW${k}A`, whop_promo_id: `promo_devSlow${k}`, created_at: ago((6 - k) * DAY) })),
  })
  let first = true
  whop.answer = (q) => {
    if (first && q.path === '/api/v1/memberships') {
      first = false
      clock += 241_000
    }
    return null
  }
  const r = await run()
  ok(r.status === 200 && r.body.examined === 3 && new Set(newEvents(db).map((e) => e.request_id)).size === 1 && newEvents(db)[0].request_id === 'slow1',
     'the first request took the clock past 240 s: it ends, and the other two are not started (read again by the next run)', show({ body: r.body, events: newEvents(db).map((e) => [e.request_id, e.reason, e.detail.step]) }))
  const src = read('../src/app/api/cron/apply-thirty/route.ts')
  ok(/const START_BY_MS = 240_000;/.test(src) && /const RUN_MS = 270_000;/.test(src) && /const ITEM_MS = 20_000;/.test(src) && /const TAKE_MAX = 25;/.test(src)
       && !/CANDIDATES_MAX|\.slice\(0, CANDIDATES/.test(src) && (src.match(/fetchAllRowsPaginated<Candidate>/g) ?? []).length === 3
       && /Math\.min\(Date\.now\(\) \+ ITEM_MS, startedAtMs \+ RUN_MS\)/.test(src) && /export const maxDuration = 300;/.test(src),
     'in the source: every candidate of the three kinds read in pages, nothing cut before the skips (the build\'s review of 2026-10-27; 200 at most until then), 25 taken, none started after 240 s, each inside min(20 s from its start, 270 s from the run\'s), maxDuration 300')
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== The doors: the switch, the mode, the secret, v116, the key ===')
{
  for (const value of ['off', 'FALSE']) {
    const db = seed({ students: 1, requests: [req('fresh', 1)] })
    process.env.THIRTY_AUTO_APPLY = value
    const r = await run()
    delete process.env.THIRTY_AUTO_APPLY
    ok(r.status === 200 && show(r.body) === show({ ok: true, paused: true }) && whop.log.length === 0 && row(db, 'fresh').status === 'pending'
         && db.log.every((q) => q.table === 'cron_runs') && lastRun(db).status === 'success' && lastRun(db).rows_affected === 0,
       `THIRTY_AUTO_APPLY=${value}: { ok: true, paused: true }, nothing read but its own run's row, Whop not asked`, show(r.body))
  }
}
{
  // The ship review (2026-10-27): deploy with the switch off, read what the first run would do, then switch it on.
  const db = seed({ students: 1, requests: [req('fresh', 1)] })
  const before = show(db.rows('discount_requests'))
  const codes = promoCodes.length
  process.env.THIRTY_AUTO_APPLY = 'off'
  const r = await run('?mode=dry')
  delete process.env.THIRTY_AUTO_APPLY
  ok(r.status === 200 && r.body.ok === true && r.body.paused === true && r.body.mode === 'dry' && r.body.applied === 0 && r.body.examined === 1
       && r.body.planned.length === 1 && r.body.planned[0].requestId === 'fresh' && r.body.planned[0].would === 'claim_and_make',
     'THIRTY_AUTO_APPLY=off and ?mode=dry: it still reads and plans, its answer saying paused true and what the first run would do', show(r.body))
  ok(show(db.rows('discount_requests')) === before && db.calls('discount_requests', 'update').length === 0 && db.rows('discount_request_events').length === 0
       && db.rows('student_membership_discounts').length === 0 && posts().length === 0 && promoCodes.length === codes
       && lastRun(db).status === 'success' && lastRun(db).rows_affected === 0,
     'paused and dry: nothing claimed, made, attached, stored or recorded; no Whop write; its run row success, 0 rows', show({ posts: posts().length, events: db.rows('discount_request_events').length }))
  const db2 = seed({ students: 1, requests: [req('fresh', 1)] })
  process.env.THIRTY_AUTO_APPLY = 'off'
  const w = await run('?mode=write')
  delete process.env.THIRTY_AUTO_APPLY
  ok(w.status === 200 && show(w.body) === show({ ok: true, paused: true }) && whop.log.length === 0 && row(db2, 'fresh').status === 'pending',
     'paused and ?mode=write: still { ok: true, paused: true }, nothing read, Whop not asked', show(w.body))
}
{
  const db = seed({ students: 1, requests: [req('fresh', 1)] })
  const r = await run('?mode=everything')
  ok(r.status === 400 && r.body.ok === false && r.body.error === 'mode must be "dry" or "write" (left out, it is "write"). Nothing ran.' && whop.log.length === 0
       && db.log.every((q) => q.table === 'cron_runs') && lastRun(db).status === 'failed' && lastRun(db).error_message === 'bad mode',
     'a mode other than dry or write: 400, nothing ran, cron_runs failed "bad mode"', show(r.body))
}
for (const [auth, reason] of [[null, 'missing_header'], ['Bearer not-the-secret', 'mismatch']]) {
  const db = seed({ students: 1, requests: [req('fresh', 1)] })
  const r = await run('', auth)
  ok(r.status === 401 && show(r.body) === show({ error: 'Unauthorized', reason }) && whop.log.length === 0 && row(db, 'fresh').status === 'pending'
       && db.rows('cron_runs').length === 1 && lastRun(db).auth_status === reason && lastRun(db).status === 'auth_failed',
     `${auth === null ? 'no Authorization header' : 'the wrong secret'}: 401 (${reason}), a cron_runs row saying so, nothing else read`, show({ body: r.body, run: lastRun(db) }))
}
{
  const db = seed({ students: 1, requests: [req('fresh', 1)] })
  db.failWhen = (q) => (q.table === 'discount_requests' && q.op === 'select' && (q.columns ?? '').includes('audit_actor')
    ? { code: '42703', message: 'column discount_requests.audit_actor does not exist' } : null)
  const r = await run()
  ok(r.status === 500 && r.body.ok === false && r.body.error === 'v116 is not pasted' && whop.log.length === 0 && db.calls('discount_requests', 'update').length === 0
       && lastRun(db).status === 'failed' && lastRun(db).error_message === 'v116 is not pasted',
     'v116 not pasted: a failed run "v116 is not pasted", no Whop call, nothing written', show({ body: r.body, run: lastRun(db) }))
}
{
  const db = seed({ students: 1, requests: [req('fresh', 1)] })
  delete process.env.WHOP_API_KEY
  const r = await run()
  process.env.WHOP_API_KEY = 'whop-test-key'
  ok(r.status === 500 && r.body.error === 'WHOP_API_KEY is not set on this deployment. Nothing ran.' && whop.log.length === 0 && row(db, 'fresh').status === 'pending' && lastRun(db).status === 'failed',
     'no WHOP_API_KEY on the deployment: a failed run, nothing asked of Whop, nothing recorded as Whop not answering', show(r.body))
}
{
  // An old per-student name on an approved request: the job leaves it to the team (Try again attaches it).
  const db = seed({ students: 1, requests: [req('old', 1, { status: 'approved', promo_code: teamThirtyCodeFor(sid(1)), whop_promo_id: 'promo_devOldName', created_at: ago(10 * DAY) })] })
  whop.codes.push({ id: 'promo_devOldName', code: teamThirtyCodeFor(sid(1)), created_at: ago(10 * DAY) })
  const r = await run()
  ok(r.body.byReason.old_code === 1 && row(db, 'old').status === 'approved' && posts().length === 0,
     `a code with the old per-student name (${teamThirtyCodeFor(sid(1))}): left to the team, old_code, nothing attached`, show(r.body))
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== vercel.json: every 10 minutes, at minutes no other cron uses ===')
{
  const v = JSON.parse(read('../vercel.json'))
  const entry = v.crons.find((c) => c.path === '/api/cron/apply-thirty')
  /** The minutes a schedule's minute field names: lists, ranges and steps spelled out. */
  const minutes = (s) => {
    const out = new Set()
    for (const part of s.split(' ')[0].split(',')) {
      const [range, stepBy] = part.split('/')
      const by = stepBy === undefined ? 1 : Number(stepBy)
      const [from, to] = range === '*' ? [0, 59] : range.includes('-') ? range.split('-').map(Number) : [Number(range), stepBy === undefined ? Number(range) : 59]
      for (let m = from; m <= to; m += by) out.add(m)
    }
    return out
  }
  const mine = minutes(entry?.schedule ?? '')
  const others = v.crons.filter((c) => c !== entry).flatMap((c) => [...minutes(c.schedule)])
  ok(entry?.schedule === '3,13,23,33,43,53 * * * *' && show([...mine]) === show([3, 13, 23, 33, 43, 53]) && [...mine].every((m) => !others.includes(m)) && v.crons.length === 7,
     'the job runs at minutes 3, 13, 23, 33, 43 and 53 of every hour, none of them another cron\'s (7 crons)', show(v.crons.map((c) => c.schedule)))
}

ok(Date === Clock, 'the suite\'s clock ran throughout')
globalThis.Date = RealDate
globalThis.setTimeout = realSetTimeout
console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
