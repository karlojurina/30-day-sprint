// membership-discount.test.mjs: the coupon rule (admin rebuild 2, D5,
// _admin/prds/admin-rebuild-2/admin_rebuild_2_prd.md in the workspace).
//
// A student whose Whop membership already has a code that discounts the next
// renewal cannot get the 30%. The rule: a promo code on the membership and a
// renewal_price below the plan's renewal price, read from Whop v1 pinned to
// 2026-10-15-1 (the live probe of 2026-10-20: evolve10 members renew at 87.30
// on the 97.00 plan; a used one-month code keeps its id and renews at 97.00).
//
// What runs is the real source, copied by build.mjs: the reader
// (src/lib/membership-discount.ts) on a stand-in for Whop's API that answers
// GET /api/v1/memberships/{id}, /plans/{id} and /promo_codes/{id} in the
// pinned shape (and the key's older shape where a row says so); the request
// routes, the approve route, the cron route and the student data route
// through their own handlers, on stub-server.ts's database; the rule's
// discountState, the refusal words and the map's checkpointView. Since the
// render review's fix round, also the cron's population: only the students
// whose 30% window is still open (discountWindowOpen), on the suite's clock
// moved past the shared deadline.
//
// The clock is the suite's, as in first-payment.test.mjs: `new Date()` and
// `Date.now()` answer it, and setTimeout sets a timer on it that fires in the
// order timers fall due, moving the clock to its time. So the pace (4
// requests a second), a 429's wait and the 240 s budget pass in milliseconds
// and are measured. No request leaves the machine: the stand-in fetch fails
// the suite on any host but api.whop.com, and answers that one itself.
//
// Every Whop id, key, name and code here is made up.
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
const NOW = '2026-10-21T09:00:00.000Z' // Wed 21 Oct, 11:00 in Croatia
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

// ── Whop, standing in ────────────────────────────────────────────────────────
const KEY = 'whop-test-key'
const PINNED = '2026-10-15-1'
const MONTHLY = 'plan_devMonthly97'
const YEARLY = 'plan_devYearly997'
const whop = {
  memberships: new Map(),
  plans: new Map(),
  promos: new Map(),
  /** Every request: its path, the version and key it carried, and when it started. */
  log: [],
  /** (path, n) => a Response, 'hang', 'throw' or null: an answer of the test's choosing for that request. */
  answer: null,
}
const json = (status, body, headers = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', ...headers },
})
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url))
  if (u.hostname !== 'api.whop.com') throw new Error(`the suite let a request go to ${u.hostname}`)
  const h = init.headers ?? {}
  whop.log.push({ path: u.pathname, version: h['Api-Version-Date'] ?? null, auth: h.Authorization ?? null, at: Date.now() })
  const special = whop.answer ? whop.answer(u.pathname, whop.log.length) : null
  if (special === 'hang') return new Promise(() => {})
  if (special === 'throw') throw new TypeError('fetch failed')
  if (special) return special
  const m = u.pathname.match(/^\/api\/v1\/(memberships|plans|promo_codes)\/([^/]+)$/)
  if (!m) return json(404, { error: { message: 'Not found' } })
  const table = { memberships: whop.memberships, plans: whop.plans, promo_codes: whop.promos }[m[1]]
  const id = decodeURIComponent(m[2])
  return table.has(id) ? json(200, table.get(id)) : json(404, { error: { message: 'Not found' } })
}
function resetWhop() {
  whop.memberships = new Map([
    // The forever 10%: renews at 87.30 on the 97.00 plan.
    ['mem_devEvolve', { id: 'mem_devEvolve', status: 'active', promo_code_id: 'promo_devEvolve', renewal_price: '87.30', plan_id: MONTHLY }],
    ['mem_devEvolve2', { id: 'mem_devEvolve2', status: 'active', promo_code_id: 'promo_devEvolve', renewal_price: '87.30', plan_id: MONTHLY }],
    // A one-month code, used up: the id stays, the renewal is full price.
    ['mem_devUsed', { id: 'mem_devUsed', status: 'active', promo_code_id: 'promo_devUsed50', renewal_price: '97.00', plan_id: MONTHLY }],
    // No code at all.
    ['mem_devFull', { id: 'mem_devFull', status: 'active', promo_code_id: null, renewal_price: '97.00', plan_id: MONTHLY }],
    // A yearly plan at full price, and one on a yearly code whose name Whop will not give.
    ['mem_devYear', { id: 'mem_devYear', status: 'active', promo_code_id: null, renewal_price: 997, plan_id: YEARLY }],
    ['mem_devYearCode', { id: 'mem_devYearCode', status: 'active', promo_code_id: 'promo_devYear10', renewal_price: { amount: '897.30', currency: 'usd' }, plan_id: YEARLY }],
    // The key's older shape: promo_code and plan as objects, the price a number.
    ['mem_devLegacy', { id: 'mem_devLegacy', status: 'active', promo_code: { id: 'promo_devEvolve' }, renewal_price: 87.3, plan: { id: MONTHLY } }],
    // A lower price and no code: kept on an older price, not a discount applied to the account.
    ['mem_devKept', { id: 'mem_devKept', status: 'active', promo_code_id: null, renewal_price: '77.00', plan_id: MONTHLY }],
    // No price on the membership: a shape this code does not read.
    ['mem_devOdd', { id: 'mem_devOdd', status: 'active', promo_code_id: null, plan_id: MONTHLY }],
    // On a plan Whop does not know.
    ['mem_devGone', { id: 'mem_devGone', status: 'active', promo_code_id: null, renewal_price: '97.00', plan_id: 'plan_devGone' }],
  ])
  whop.plans = new Map([
    [MONTHLY, { id: MONTHLY, plan_type: 'renewal', renewal_price: '97.00', initial_price: '0.00' }],
    [YEARLY, { id: YEARLY, plan_type: 'renewal', renewal_price: 997 }],
  ])
  whop.promos = new Map([
    ['promo_devEvolve', { id: 'promo_devEvolve', code: 'evolve10' }],
    ['promo_devUsed50', { id: 'promo_devUsed50', code: 'welcome50' }],
  ])
  whop.log = []
  whop.answer = null
}
resetWhop()

const {
  WHOP_DISCOUNT_VERSION, MEMBERSHIP_DISCOUNTS_TABLE, REFRESH_START_BUDGET_MS, priceOf, idOf, isDiscounted, storedRowApplies,
  isMembershipId, newReadContext, readMembershipDiscount, checkMembershipDiscount, codeOf,
} = await import('./_gen/membership-discount.ts')
const { POST: requestRoute } = await import('./_gen/discount-request-route.ts')
const { POST: feedbackRoute } = await import('./_gen/discount-submit-feedback-route.ts')
const { POST: approveRoute } = await import('./_gen/discount-approve-route.ts')
const { GET: cronRoute } = await import('./_gen/refresh-membership-discounts-route.ts')
const { GET: dataRoute } = await import('./_gen/student-data-route.ts')
const { MEMBERSHIP_DISCOUNT_LINE, DISCOUNT_ELIGIBLE_FROM, DISCOUNT_LAUNCH_DATE, DISCOUNT_SHARED_DEADLINE, discountState, discountWindowOpen, earliestOpenFirstPayment } = await import('./_gen/discount.ts')
const { discountRefusalMessage, membershipDiscountRefusal, couponApprovalRefusal } = await import('./_gen/discount-server.ts')
const { checkpointView } = await import('./_gen/checkpointView.ts')
// useDb is no React hook; the alias keeps eslint's hook rule from reading it as one.
const { FakeDb, fakeClient, useDb: installDb, setCatalog, promoCodes } = await import('./_gen/stub-server.ts')

/** Runs `fn` with what it logs kept off the suite's output and handed back. */
async function quiet(fn) {
  const real = [console.info, console.warn, console.error]
  const lines = []
  console.info = console.warn = console.error = (...a) => { lines.push(a.map(String).join(' ')) }
  try { return { value: await fn(), lines } } finally { [console.info, console.warn, console.error] = real }
}
const BANNED = /—|\bunlock|ecomtalent/i
const LINE = "You can't apply for this discount because you already have a discount applied to your account."

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== The rule, on its own ===')
ok(priceOf('87.30') === 87.3 && priceOf(97) === 97 && priceOf({ amount: '997.00' }) === 997 && priceOf('') === null
     && priceOf('ninety') === null && priceOf(null) === null && priceOf(undefined) === null && priceOf(Number.NaN) === null,
   'a price reads as "87.30", 97 or { amount }, and nothing else')
ok(idOf('promo_x') === 'promo_x' && idOf({ id: 'promo_x' }) === 'promo_x' && idOf('') === null && idOf({}) === null && idOf(null) === null,
   'an id reads as a string or { id }')
ok(isDiscounted('promo_devEvolve', 87.3, 97) === true, 'evolve10: a code, 87.30 against the plan\'s 97.00: discounted')
ok(isDiscounted('promo_devUsed50', 97, 97) === false, 'a used one-month code: the id is still there, 97.00 against 97.00: not discounted')
ok(isDiscounted(null, 997, 997) === false && isDiscounted('promo_devYear10', 897.3, 997) === true,
   'yearly plans: 997 at full price is not; 897.30 on a code is')
ok(isDiscounted(null, 77, 97) === false, 'a lower price with no code on the membership (an older price kept) is no discount applied')
ok(isDiscounted('p', 96.99, 97) === true && isDiscounted('p', 97.001, 97) === false && isDiscounted('p', 0.1 + 0.2, 0.3) === false,
   'compared in cents: a cent below counts, a float\'s dust does not')
ok(storedRowApplies({ whop_membership_id: 'mem_a' }, 'mem_a') && !storedRowApplies({ whop_membership_id: 'mem_a' }, 'mem_b')
     && !storedRowApplies(null, 'mem_a') && !storedRowApplies({ whop_membership_id: null }, null) && !storedRowApplies({ whop_membership_id: 'mem_a' }, null),
   'a stored row counts only for the membership it was read from')
ok(isMembershipId('mem_devEvolve') && !isMembershipId('pay_devPayment') && !isMembershipId('') && !isMembershipId(null) && !isMembershipId('mem_'),
   'a membership id is mem_ and more; a payment\'s id (the webhook has stored one there) is not')
ok(codeOf({ promo_code: 'evolve10', promo_code_id: 'promo_x' }) === 'evolve10' && codeOf({ promo_code: null, promo_code_id: 'promo_x' }) === 'promo_x'
     && codeOf(null) === null, 'a code is named by its name, else its Whop promo id')

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== The reader, on Whop standing in ===')
{
  resetWhop()
  const ctx = newReadContext(KEY)
  const evolve = await readMembershipDiscount('mem_devEvolve', ctx)
  ok(evolve.ok && evolve.membership.discounted === true && evolve.membership.promoCode === 'evolve10' && evolve.membership.promoCodeId === 'promo_devEvolve'
       && evolve.membership.renewalPrice === 87.3 && evolve.membership.planRenewalPrice === 97 && evolve.membership.whopMembershipId === 'mem_devEvolve',
     'evolve10 (87.30 against 97.00): discounted, the code named', show(evolve))
  ok(whop.log.map((r) => r.path).join() === '/api/v1/memberships/mem_devEvolve,/api/v1/plans/plan_devMonthly97,/api/v1/promo_codes/promo_devEvolve',
     'three reads: the membership, its plan, its code', whop.log.map((r) => r.path).join())
  ok(whop.log.every((r) => r.version === PINNED && r.auth === `Bearer ${KEY}`) && WHOP_DISCOUNT_VERSION === PINNED,
     `every read pinned to Api-Version-Date ${PINNED}, with the key`)
  const used = await readMembershipDiscount('mem_devUsed', ctx)
  ok(used.ok && used.membership.discounted === false && used.membership.promoCode === 'welcome50' && used.membership.renewalPrice === 97,
     'a used one-month code (97.00 against 97.00): not discounted, its name still read', show(used))
  const full = await readMembershipDiscount('mem_devFull', ctx)
  ok(full.ok && full.membership.discounted === false && full.membership.promoCodeId === null && full.membership.promoCode === null,
     'no code: not discounted')
  const plansRead = whop.log.filter((r) => r.path.startsWith('/api/v1/plans/')).length
  ok(plansRead === 1, `the monthly plan was read once for 3 members of it (cached per run): ${plansRead}`)
  await readMembershipDiscount('mem_devEvolve2', ctx)
  ok(whop.log.filter((r) => r.path === '/api/v1/promo_codes/promo_devEvolve').length === 1, 'and evolve10\'s name once for 2 members on it')
  const year = await readMembershipDiscount('mem_devYear', ctx)
  const yearCode = await readMembershipDiscount('mem_devYearCode', ctx)
  ok(year.ok && year.membership.discounted === false && year.membership.planRenewalPrice === 997,
     'a yearly plan at full price (997 against 997, a number): not discounted', show(year))
  ok(yearCode.ok && yearCode.membership.discounted === true && yearCode.membership.renewalPrice === 897.3 && yearCode.membership.promoCode === null
       && yearCode.membership.promoCodeId === 'promo_devYear10',
     'a yearly code (897.30 as { amount } against 997): discounted; Whop gives no name, so only its id is known', show(yearCode))
  const legacy = await readMembershipDiscount('mem_devLegacy', ctx)
  ok(legacy.ok && legacy.membership.discounted === true && legacy.membership.promoCode === 'evolve10',
     'the key\'s older shape (promo_code { id }, plan { id }, a number): read the same', show(legacy))
  const kept = await readMembershipDiscount('mem_devKept', ctx)
  ok(kept.ok && kept.membership.discounted === false, 'a lower renewal with no code (77.00 against 97.00): not discounted', show(kept))
  const fresh = newReadContext(KEY)
  const before = whop.log.length
  await readMembershipDiscount('mem_devFull', fresh)
  ok(whop.log.slice(before).some((r) => r.path === '/api/v1/plans/plan_devMonthly97'), 'a new run reads the plan again')
}
{
  resetWhop()
  const ctx = newReadContext(KEY)
  const t0 = Date.now()
  for (const id of ['mem_devFull', 'mem_devUsed', 'mem_devEvolve', 'mem_devYear']) await readMembershipDiscount(id, ctx)
  const starts = whop.log.map((r) => r.at)
  const gaps = starts.slice(1).map((t, i) => t - starts[i])
  ok(gaps.length >= 6 && gaps.every((g) => g >= 250) && starts[0] === t0, `4 requests a second, start to start: ${gaps.join(', ')} ms`)
}
console.log('\n=== The reader, when Whop does not answer as it should ===')
{
  const one = async (id, answer, opts = {}) => {
    resetWhop()
    whop.answer = answer
    const ctx = newReadContext(opts.key ?? KEY, opts.startBy ?? null, opts.answerBy ?? null)
    return readMembershipDiscount(id, ctx)
  }
  const r404 = await one('mem_devMissing', null)
  ok(!r404.ok && r404.fail === 'not_found', 'a membership Whop does not have: not_found', show(r404))
  ok(show(await one('mem_devFull', (p) => (p.includes('/memberships/') ? json(401, { error: 'no' }) : null))) === show({ ok: false, fail: 'http_401_403' }), 'a 401: http_401_403')
  ok(show(await one('mem_devFull', (p) => (p.includes('/memberships/') ? json(500, { error: 'boom' }) : null))) === show({ ok: false, fail: 'http_other' }), 'a 500: http_other')
  ok(show(await one('mem_devFull', (p) => (p.includes('/memberships/') ? json(200, 'not json at all') : null))) === show({ ok: false, fail: 'bad_shape' }), 'an answer that is not JSON: bad_shape')
  ok(show(await one('mem_devFull', (p) => (p.includes('/memberships/') ? json(200, [1, 2]) : null))) === show({ ok: false, fail: 'bad_shape' }), 'a list where one object belongs: bad_shape')
  ok(show(await one('mem_devOdd', null)) === show({ ok: false, fail: 'bad_shape' }), 'a membership with no renewal price: bad_shape')
  ok(show(await one('mem_devGone', null)) === show({ ok: false, fail: 'no_plan_price' }), 'a plan Whop does not have: no_plan_price')
  ok(show(await one('mem_devFull', (p) => (p.includes('/plans/') ? json(200, { id: MONTHLY, renewal_price: null }) : null))) === show({ ok: false, fail: 'no_plan_price' }),
     'a plan with no renewal price: no_plan_price')
  ok(show(await one('mem_devFull', () => 'throw')) === show({ ok: false, fail: 'network' }), 'no connection: network')
  const noName = await one('mem_devEvolve', (p) => (p.includes('/promo_codes/') ? json(500, {}) : null))
  ok(noName.ok && noName.membership.discounted === true && noName.membership.promoCode === null,
     'the code\'s name cannot be read: still discounted, the name left out', show(noName))
  const noKey = await one('mem_devEvolve', null, { key: '' })
  ok(!noKey.ok && noKey.fail === 'no_api_key' && whop.log.length === 0, 'no key: no_api_key, and no request')
  const payment = await one('pay_devPayment', null)
  ok(!payment.ok && payment.fail === 'not_a_membership' && whop.log.length === 0, 'a payment\'s id: not_a_membership, and no request')
  // A 429, "Try again in 2 seconds", twice, then the answer.
  let n = 0
  const t0 = Date.now()
  const after429 = await one('mem_devFull', (p) => (p.includes('/memberships/') && ++n <= 2 ? json(429, 'Too many requests. Try again in 2 seconds.') : null))
  ok(after429.ok && n === 3 && Date.now() - t0 >= 4000, `two 429s waited out (${Date.now() - t0} ms), then the answer`)
  let m = 0
  const thrice = await one('mem_devFull', (p) => (p.includes('/memberships/') && ++m <= 3 ? json(429, 'Try again in 1 seconds.') : null))
  ok(!thrice.ok && thrice.fail === 'rate_limited' && m === 3, 'a third 429: rate_limited', show(thrice))
  const late = await one('mem_devFull', null, { startBy: Date.now() - 1 })
  ok(!late.ok && late.fail === 'time_budget' && whop.log.length === 0, 'past its start limit: time_budget, and no request')
  const hung = await one('mem_devFull', () => 'hang', { startBy: Date.now() + 5000, answerBy: Date.now() + 8000 })
  ok(!hung.ok && hung.fail === 'time_budget', 'Whop never answers: given up at the answer limit (time_budget)')
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== Live, then the stored row, then nothing (checkMembershipDiscount) ===')
/** A stored row: evolve10 on `membership`, read the morning before. */
function storedEvolve(student, membership = 'mem_devEvolve') {
  return {
    student_id: student, whop_membership_id: membership, promo_code_id: 'promo_devEvolve', promo_code: 'evolve10',
    renewal_price: 87.3, plan_renewal_price: 97, discounted: true, checked_at: '2026-10-20T08:40:00.000Z',
  }
}
{
  resetWhop()
  const db = new FakeDb({ students: [{ id: 's1', whop_membership_id: 'mem_devEvolve' }] })
  const live = await quiet(() => checkMembershipDiscount(fakeClient(db), 's1', { apiKey: KEY }))
  const row = db.rows(MEMBERSHIP_DISCOUNTS_TABLE)[0]
  ok(show(live.value) === show({ discounted: true, code: 'evolve10', source: 'live', liveFail: null, saved: true }), 'Whop answers: discounted, evolve10, live, and saved', show(live.value))
  ok(row && row.student_id === 's1' && row.whop_membership_id === 'mem_devEvolve' && row.promo_code === 'evolve10' && row.promo_code_id === 'promo_devEvolve'
       && row.renewal_price === 87.3 && row.plan_renewal_price === 97 && row.discounted === true && row.checked_at === new Date().toISOString(),
     'and the answer is stored for the map and the admin page', show(row))
  ok(live.lines.length === 0, 'nothing is logged when Whop answers')
}
{
  resetWhop()
  const db = new FakeDb({ students: [{ id: 's1', whop_membership_id: 'mem_devUsed' }], [MEMBERSHIP_DISCOUNTS_TABLE]: [storedEvolve('s1', 'mem_devUsed')] })
  const r = await checkMembershipDiscount(fakeClient(db), 's1', { apiKey: KEY })
  ok(r.discounted === false && r.source === 'live' && db.rows(MEMBERSHIP_DISCOUNTS_TABLE)[0].discounted === false && db.rows(MEMBERSHIP_DISCOUNTS_TABLE).length === 1,
     'a code used up since the last read: Whop now says no, and the stored row is set right (one row per student)', show(r))
}
{
  resetWhop()
  whop.answer = () => json(500, {})
  const db = new FakeDb({ students: [{ id: 's1', whop_membership_id: 'mem_devEvolve' }], [MEMBERSHIP_DISCOUNTS_TABLE]: [storedEvolve('s1')] })
  const r = await quiet(() => checkMembershipDiscount(fakeClient(db), 's1', { apiKey: KEY }))
  ok(show(r.value) === show({ discounted: true, code: 'evolve10', source: 'stored', liveFail: 'http_other', saved: false }), 'Whop fails: the stored row for this membership decides (nothing saved)', show(r.value))
  ok(r.lines.length === 1 && r.lines[0].includes('http_other') && r.lines[0].includes('the stored row decides') && !r.lines[0].includes('mem_'),
     'one line for the log, with the kind and no Whop id', show(r.lines))
}
{
  resetWhop()
  whop.answer = () => json(500, {})
  const db = new FakeDb({ students: [{ id: 's1', whop_membership_id: 'mem_devFull' }], [MEMBERSHIP_DISCOUNTS_TABLE]: [storedEvolve('s1', 'mem_devOld')] })
  const r = await quiet(() => checkMembershipDiscount(fakeClient(db), 's1', { apiKey: KEY }))
  ok(r.value.discounted === false && r.value.source === 'none', 'a stored row from another membership says nothing about this one: nothing blocks', show(r.value))
  const none = await quiet(() => checkMembershipDiscount(fakeClient(new FakeDb({ students: [{ id: 's1', whop_membership_id: 'mem_devFull' }] })), 's1', { apiKey: KEY }))
  ok(none.value.discounted === false && none.value.source === 'none' && none.lines.some((l) => l.includes('nothing blocks')), 'neither Whop nor a stored row: nothing blocks, and the log says so')
}
{
  resetWhop()
  const db = new FakeDb({ students: [{ id: 's1', whop_membership_id: 'mem_devEvolve' }], [MEMBERSHIP_DISCOUNTS_TABLE]: [storedEvolve('s1')] })
  const r = await quiet(() => checkMembershipDiscount(fakeClient(db), 's1', { apiKey: null }))
  ok(r.value.source === 'stored' && r.value.discounted === true && r.value.liveFail === 'no_api_key' && whop.log.length === 0 && r.lines.length === 0,
     'no key on the deployment: no request, the stored row decides, nothing logged', show(r.value))
  const noMembership = new FakeDb({ students: [{ id: 's1', whop_membership_id: null }], [MEMBERSHIP_DISCOUNTS_TABLE]: [storedEvolve('s1')] })
  const r2 = await quiet(() => checkMembershipDiscount(fakeClient(noMembership), 's1', { apiKey: KEY }))
  ok(r2.value.source === 'none' && r2.value.liveFail === 'no_membership' && whop.log.length === 0 && r2.lines.length === 0,
     'no membership on file: no request, and a row from a membership the student no longer has does not count', show(r2.value))
}
{
  resetWhop()
  const db = new FakeDb({ students: [{ id: 's1', whop_membership_id: 'mem_devEvolve' }] })
  db.fail[`${MEMBERSHIP_DISCOUNTS_TABLE}.upsert`] = { message: 'relation "student_membership_discounts" does not exist', code: '42P01' }
  const r = await quiet(() => checkMembershipDiscount(fakeClient(db), 's1', { apiKey: KEY }))
  ok(r.value.discounted === true && r.value.source === 'live' && r.value.saved === false && r.lines.some((l) => l.includes('was not stored')),
     'a database without v111: the live answer still decides, the failed write is logged, and the answer says it was not saved', show(r.lines))
  const db2 = new FakeDb({ students: [{ id: 's1', whop_membership_id: 'mem_devEvolve' }] })
  db2.fail['students.select'] = { message: 'canceling statement due to statement timeout' }
  db2.tables[MEMBERSHIP_DISCOUNTS_TABLE] = [storedEvolve('s1')]
  const r2 = await quiet(() => checkMembershipDiscount(fakeClient(db2), 's1', { apiKey: KEY }))
  ok(r2.value.source === 'stored' && r2.value.discounted === true && r2.value.liveFail === 'student_unread',
     'the student\'s membership cannot be read: the stored row decides', show(r2.value))
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== The rule on the map: discountState, its words, checkpointView ===')
const LESSONS = [
  { id: 'a1l01', type: 'watch', counts_toward_progress: true, is_gate: false, has_video: true, duration_seconds: 300 },
  { id: 'a1l02', type: 'watch', counts_toward_progress: true, is_gate: true, has_video: true, duration_seconds: 300 },
]
const DAY = 86_400_000
const PAID = new Date(Date.parse(NOW) - 2 * DAY).toISOString()
const at = (s) => new RealDate(s)
{
  const base = { now: at(NOW), firstPaidAt: PAID, lessons: LESSONS, requests: [] }
  const ready = discountState({ ...base, videoDoneIds: new Set(['a1l01', 'a1l02']) })
  const flagged = discountState({ ...base, videoDoneIds: new Set(['a1l01', 'a1l02']), membershipDiscounted: true })
  ok(ready.kind === 'ready' && show(flagged) === show({ kind: 'not-eligible', reason: 'has-discount' }), 'every video done and a discount on the membership: not eligible, has-discount', show(flagged))
  ok(discountState({ ...base, videoDoneIds: new Set(), membershipDiscounted: true }).reason === 'has-discount', 'with videos left: has-discount too (no "11 days left" for a student who can never get it)')
  ok(discountState({ ...base, now: at('2026-11-30T00:00:00.000Z'), videoDoneIds: new Set(), membershipDiscounted: true }).reason === 'has-discount', 'past the deadline: has-discount')
  ok(discountState({ ...base, videoDoneIds: new Set(), membershipDiscounted: false }).kind === 'locked' && discountState({ ...base, videoDoneIds: new Set() }).kind === 'locked',
     'the flag false or left out: as before')
  const asked = discountState({ ...base, videoDoneIds: new Set(), membershipDiscounted: true, requests: [{ id: 'r1', status: 'applied', created_at: PAID }] })
  ok(asked.kind === 'applied', 'a request already made still decides first (a student with the 30% on the membership sees "Yours")')
  ok(discountState({ ...base, firstPaidAt: '2026-09-15T10:00:00.000Z', videoDoneIds: new Set(), membershipDiscounted: true }).reason === 'before-launch'
       && discountState({ ...base, firstPaidAt: null, videoDoneIds: new Set(), membershipDiscounted: true }).reason === 'no-payment',
     'a closed window keeps its own words (before 1 October, no first payment)')
  ok(MEMBERSHIP_DISCOUNT_LINE === LINE, 'the student\'s line, exactly as written: ' + MEMBERSHIP_DISCOUNT_LINE)
  ok(discountRefusalMessage({ kind: 'not-eligible', reason: 'has-discount' }) === LINE, 'both request routes refuse with that line (discountRefusalMessage)')
  ok(show(membershipDiscountRefusal()) === show({ grant: false, status: 400, state: 'not-eligible', error: LINE }), 'the decision: 400, state not-eligible, the line', show(membershipDiscountRefusal()))
  ok(couponApprovalRefusal('evolve10') === 'This student already has a discount on their membership (evolve10).'
       && couponApprovalRefusal(null) === 'This student already has a discount on their membership (code not known).',
     'the approve route\'s line names the code')
  const cv = checkpointView(flagged, Date.parse(NOW), 3, 3)
  ok(cv.chip.tail === 'Closed' && cv.header === false && cv.tag === 'closed' && cv.look === 'closed' && cv.label.tail === 'Closed' && cv.left === null && cv.deadline === null,
     'the map: the word "Closed", no chip in the header, the closed tag and look, no clock', show(cv))
  ok(![LINE, couponApprovalRefusal('evolve10'), couponApprovalRefusal(null)].some((s) => BANNED.test(s)), 'no em dash, "unlock" or "EcomTalent" in any of them')
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== The request routes: Whop now, the stored row, then the request ===')
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'
process.env.WHOP_API_KEY = KEY
delete process.env.STUDENT_APP_CLOSED
/** A student ready to apply on the new course: both videos up to the gate watched, 2 days after a first payment. */
function readyDb(membership, more = {}) {
  setCatalog({ v2: true, lessonsTable: 'lessons_next' })
  const db = new FakeDb({
    students: [{ id: 's1', supabase_user_id: 'auth-1', first_paid_at: PAID, joined_at: PAID, whop_membership_id: membership }],
    lessons_next: [
      { id: 'a1l01', type: 'watch', sort_order: 1, duration_seconds: 300 },
      { id: 'a1l02', type: 'watch', sort_order: 2, duration_seconds: 300, is_gate: true },
    ],
    lesson_videos: [{ lesson_id: 'a1l01', created_at: '2026-10-01T00:00:00.000Z' }, { lesson_id: 'a1l02', created_at: '2026-10-01T00:00:00.000Z' }],
    student_lesson_completions: [
      { student_id: 's1', lesson_id: 'a1l01', completed_at: PAID },
      { student_id: 's1', lesson_id: 'a1l02', completed_at: PAID },
    ],
    discount_requests: [],
    ...more,
  }, { 'tok-1': 'auth-1' })
  db.functions.submit_discount_with_feedback = async (args, client) => {
    const { data: row, error } = await client.from('discount_requests').insert({ student_id: args.p_student_id }).select('id').single()
    return error ? { data: null, error } : { data: row.id, error: null }
  }
  installDb(db)
  return db
}
async function post(route, path, body) {
  const res = await route(new Request(`http://app/api/discounts/${path}`, {
    method: 'POST',
    headers: { authorization: 'Bearer tok-1', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }))
  return { status: res.status, body: await res.json() }
}
const ANSWERS = [{ question_id: 'q1', answer_scale: 9 }]
for (const [name, route, path, body] of [
  ['POST /api/discounts/request', requestRoute, 'request', { studentId: 's1' }],
  ['POST /api/discounts/submit-feedback (the map\'s Apply when the team has questions)', feedbackRoute, 'submit-feedback', { answers: ANSWERS }],
]) {
  console.log(`  ${name}`)
  resetWhop()
  let db = readyDb('mem_devEvolve')
  let r = await quiet(() => post(route, path, body))
  ok(r.value.status === 400 && r.value.body.error === LINE && r.value.body.state === 'not-eligible',
     'Whop says evolve10 applies: 400, the student\'s line exactly, state not-eligible', show(r.value))
  ok(db.rows('discount_requests').length === 0 && db.calls('submit_discount_with_feedback', 'rpc').length === 0, 'and nothing is written')
  ok(db.rows(MEMBERSHIP_DISCOUNTS_TABLE)[0]?.discounted === true, 'the live answer is stored, so the map says it at its next load')

  resetWhop()
  db = readyDb('mem_devUsed')
  r = await quiet(() => post(route, path, body))
  ok(r.value.status === 200 && db.rows('discount_requests').length === 1, 'a used one-month code (renews at full price): the request goes in', show(r.value))

  resetWhop()
  whop.answer = () => json(503, {})
  db = readyDb('mem_devEvolve', { [MEMBERSHIP_DISCOUNTS_TABLE]: [storedEvolve('s1')] })
  r = await quiet(() => post(route, path, body))
  ok(r.value.status === 400 && r.value.body.error === LINE && db.rows('discount_requests').length === 0,
     'Whop down, the stored row says discounted: refused with the same line', show(r.value))

  resetWhop()
  whop.answer = () => 'throw'
  db = readyDb('mem_devEvolve')
  r = await quiet(() => post(route, path, body))
  ok(r.value.status === 200 && db.rows('discount_requests').length === 1, 'Whop down and nothing stored: the request goes in (the approve route checks again)', show(r.value))

  resetWhop()
  db = readyDb('mem_devEvolve', { student_lesson_completions: [] })
  r = await quiet(() => post(route, path, body))
  ok(r.value.status === 400 && r.value.body.state === 'locked' && whop.log.length === 0,
     'a student who is not ready: the rule refuses first, and Whop is not asked', show(r.value))
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== The approve route: Whop now, no override ===')
function approveDb(membership, more = {}) {
  const db = readyDb(membership, {
    discount_requests: [{ id: 'r1', student_id: 's1', status: 'pending', created_at: new Date(Date.parse(NOW) - 3_600_000).toISOString() }],
    admin_config: [{ key: 'curriculum_reset_at', value: '2026-10-19T14:33:00.000Z' }],
    ...more,
  })
  return db
}
async function approve(override = false) {
  const res = await approveRoute(new Request('http://app/api/discounts/approve', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: 'r1', override }),
  }))
  return { status: res.status, body: await res.json() }
}
{
  for (const override of [false, true]) {
    resetWhop()
    const db = approveDb('mem_devEvolve')
    const made = promoCodes.length
    const r = await quiet(() => approve(override))
    ok(r.value.status === 400 && r.value.body.error === 'This student already has a discount on their membership (evolve10).' && r.value.body.code === 'has-discount',
       `${override ? 'Approve anyway' : 'Approve'}: evolve10 on the membership, 400 with the code named and code "has-discount"`, show(r.value))
    ok(promoCodes.length === made && db.rows('discount_requests')[0].status === 'pending', 'no Whop code is made, the request stays pending')
  }
  resetWhop()
  let db = approveDb('mem_devFull')
  let made = promoCodes.length
  let r = await quiet(() => approve(false))
  ok(r.value.status === 200 && promoCodes.length === made + 1 && db.rows('discount_requests')[0].status === 'approved', 'no code on the membership, the rule says yes: approved, the code made', show(r.value.body))
  resetWhop()
  whop.answer = () => json(500, {})
  db = approveDb('mem_devYearCode', { [MEMBERSHIP_DISCOUNTS_TABLE]: [{ ...storedEvolve('s1', 'mem_devYearCode'), promo_code: null, promo_code_id: 'promo_devYear10' }] })
  r = await quiet(() => approve(true))
  ok(r.value.status === 400 && r.value.body.error === 'This student already has a discount on their membership (promo_devYear10).',
     'Whop down, the stored row says discounted with no name: refused, naming the code\'s id', show(r.value.body))
  resetWhop()
  whop.answer = () => 'throw'
  db = approveDb('mem_devEvolve')
  made = promoCodes.length
  r = await quiet(() => approve(false))
  ok(r.value.status === 200 && promoCodes.length === made + 1, 'Whop down, nothing stored: the approval goes on', show(r.value.body))
}

// ════════════════════════════════════════════════════════════════════════════
// The render review's second round: "Check Whop again" on the 30% page. A
// pending row whose stored coupon says a discount is on the next renewal
// offers only Reject, so the approve route's own live read never runs for it;
// when the code was taken off the membership since, the row stayed refused.
// POST /api/admin/thirty/check-coupon asks Whop for that one student
// (checkMembershipDiscount) and stores the answer, and the list read after it
// (loadThirtyData, buildThirtyView: the page's own) judges the row again.
console.log('\n=== Check Whop again: POST /api/admin/thirty/check-coupon ===')
const { POST: checkRoute } = await import('./_gen/admin-check-coupon-route.ts')
const { loadThirtyData } = await import('./_gen/thirty-data.ts')
const { buildThirtyView } = await import('./_gen/thirty-view.ts')
const CSM_TOKEN = 'tok-csm'
/** readyDb's student (every video up to the gate watched), a pending request, evolve10 stored for `membership`, and a csm who signs in. */
function checkDb(membership, more = {}) {
  const db = readyDb(membership, {
    discount_requests: [{ id: 'r1', student_id: 's1', status: 'pending', created_at: new Date(Date.parse(NOW) - 3_600_000).toISOString() }],
    [MEMBERSHIP_DISCOUNTS_TABLE]: [{ ...storedEvolve('s1', membership), checked_at: '2026-10-20T08:40:00.000Z' }],
    team_members: [{ id: 'tm-csm', email: 'csm@example.com', full_name: 'Robin Hale', role: 'csm' }],
    ...more,
  })
  db.users[CSM_TOKEN] = 'tm-csm'
  return db
}
/** Every error sentence the route answered here, held to the team's words at the end. */
const checkErrors = []
async function checkAgain(body = { requestId: 'r1' }, token = CSM_TOKEN) {
  const res = await checkRoute(new Request('http://app/api/admin/thirty/check-coupon', {
    method: 'POST',
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }))
  const json = await res.json()
  if (res.status >= 400) checkErrors.push(json?.error)
  return { status: res.status, body: json }
}
/** Request r1 as the 30% page's list has it, read from the same database at this moment. */
async function listedRow(db) {
  const load = await loadThirtyData(fakeClient(db))
  return load.ok ? buildThirtyView(load.data, new Date(), '2026-10-19T14:33:00.000Z').requests.find((x) => x.id === 'r1') ?? null : null
}
{
  resetWhop()
  const db = checkDb('mem_devUsed')
  const none = await quiet(() => checkAgain({ requestId: 'r1' }, null))
  const student = await quiet(() => checkAgain({ requestId: 'r1' }, 'tok-1'))
  ok(none.value.status === 401 && student.value.status === 403 && whop.log.length === 0 && db.rows(MEMBERSHIP_DISCOUNTS_TABLE)[0].discounted === true,
     'no token 401, a student\'s token 403 (the real team check): Whop is not asked, the stored row stays', show([none.value.status, student.value.status]))

  // evolve10 was stored on 20 October; since then the code came off the membership (Whop: a used code, full price).
  const before = await listedRow(db)
  ok(before?.verdict?.reason === 'has-discount' && before.coupon?.discounted === true && before.couponCheck === 'stored',
     'before: the stored row says evolve10 is on the renewal, so the row is the coupon\'s (Reject alone, and Check Whop again, on the page)', show(before?.verdict))
  const made = promoCodes.length
  const r = await quiet(() => checkAgain())
  const row = db.rows(MEMBERSHIP_DISCOUNTS_TABLE)[0]
  ok(r.value.status === 200 && show(r.value.body) === show({ discounted: false, code: 'welcome50' }),
     'a csm checks again: 200, Whop has no discount on the renewal now (the used code named), and nothing else in the answer', show(r.value))
  ok(row.discounted === false && row.whop_membership_id === 'mem_devUsed' && row.checked_at === new Date().toISOString() && db.rows(MEMBERSHIP_DISCOUNTS_TABLE).length === 1,
     'the stored row is Whop\'s answer, read now (still one row per student)', show(row))
  const after = await listedRow(db)
  ok(after?.verdict?.ok === true && after.verdict.reason === null && after.coupon?.discounted === false,
     'the list read after it: the coupon is gone, the 30% rule decides and says yes, so the row shows Approve again', show(after?.verdict))
  ok(promoCodes.length === made && db.rows('discount_requests')[0].status === 'pending' && db.calls('discount_requests', 'update').length === 0,
     'no Whop code is made and the request is not changed')
  ok(whop.log.length === 3 && whop.log.every((x) => x.version === PINNED) && whop.log[0].path === '/api/v1/memberships/mem_devUsed',
     'one live read, pinned: the membership, its plan, its code', whop.log.map((x) => x.path).join())
}
{
  resetWhop()
  const db = checkDb('mem_devEvolve')
  const r = await quiet(() => checkAgain())
  ok(r.value.status === 200 && show(r.value.body) === show({ discounted: true, code: 'evolve10' }) && db.rows(MEMBERSHIP_DISCOUNTS_TABLE)[0].checked_at === new Date().toISOString(),
     'the code still applies: 200 naming it, the row read again now', show(r.value))
  ok((await listedRow(db))?.verdict?.reason === 'has-discount', 'and the row stays the coupon\'s')
}
{
  resetWhop()
  whop.answer = () => json(503, {})
  const db = checkDb('mem_devUsed')
  const stored = show(db.rows(MEMBERSHIP_DISCOUNTS_TABLE))
  const r = await quiet(() => checkAgain())
  ok(r.value.status === 502 && r.value.body.error === 'Whop gave no answer, so nothing changed. Try again in a minute.'
       && show(db.rows(MEMBERSHIP_DISCOUNTS_TABLE)) === stored && db.calls(MEMBERSHIP_DISCOUNTS_TABLE, 'upsert').length === 0,
     'Whop gives no answer: 502 in plain words, the stored row as it was, nothing written', show(r.value))
  ok(r.lines.some((l) => l.includes('Whop gave no answer (http_other)')) && !r.lines.some((l) => /mem_/.test(l)), 'the log says why by its kind, with no Whop id', show(r.lines))
}
{
  resetWhop()
  const db = checkDb('mem_devUsed')
  db.fail[`${MEMBERSHIP_DISCOUNTS_TABLE}.upsert`] = { message: 'canceling statement due to statement timeout' }
  const r = await quiet(() => checkAgain())
  ok(r.value.status === 500 && r.value.body.error === "Whop answered, but its answer couldn't be saved, so the list still shows the old one. Try again."
       && db.rows(MEMBERSHIP_DISCOUNTS_TABLE)[0].discounted === true,
     'Whop answers but the write fails: 500 saying the list still shows the old answer, never a 200 the list would contradict', show(r.value))
}
{
  // The other answers, each in the team's words; Whop is not asked where it cannot help.
  const answers = []
  const one = async (label, prep, body, status, error, whopAsked = false) => {
    resetWhop()
    const db = prep()
    const r = await quiet(() => checkAgain(body))
    answers.push(label)
    ok(r.value.status === status && r.value.body.error === error && (whopAsked || whop.log.length === 0) && db.rows(MEMBERSHIP_DISCOUNTS_TABLE).every((x) => x.checked_at === '2026-10-20T08:40:00.000Z'),
       `${label}: ${status}, "${error}"${whopAsked ? '' : ', Whop not asked'}, the stored row as it was`, show(r.value))
  }
  const decided = () => checkDb('mem_devUsed', { discount_requests: [{ id: 'r1', student_id: 's1', status: 'approved', created_at: new Date(Date.parse(NOW) - 3_600_000).toISOString() }] })
  await one('the request was decided meanwhile', decided, undefined, 409, 'This request was already decided.')
  await one('no such request', () => checkDb('mem_devUsed'), { requestId: 'r-gone' }, 404, 'This request no longer exists.')
  await one('no request id', () => checkDb('mem_devUsed'), {}, 400, 'Missing requestId')
  await one('a body that is not JSON', () => checkDb('mem_devUsed'), '{not json', 400, 'Missing requestId')
  await one('a payment\'s id where the membership belongs', () => checkDb('pay_devPayment'), undefined, 422,
    "The student's Whop membership is not on file, so Whop can't be asked. Check the coupon in Whop.")
  await one('no membership on file', () => checkDb(null), undefined, 422,
    "The student's Whop membership is not on file, so Whop can't be asked. Check the coupon in Whop.")
  await one('a membership Whop does not know', () => checkDb('mem_devMissing'), undefined, 422,
    "Whop doesn't know the membership on file, so nothing changed. Check the student in Whop.", true)
  await one('the request cannot be read', () => {
    const db = checkDb('mem_devUsed')
    db.fail['discount_requests.select'] = { message: 'canceling statement due to statement timeout' }
    return db
  }, undefined, 500, "Couldn't read this request, so Whop was not asked. Try again.")
  await one('the student cannot be read', () => {
    const db = checkDb('mem_devUsed')
    db.fail['students.select'] = { message: 'canceling statement due to statement timeout' }
    return db
  }, undefined, 500, "Couldn't read the student's Whop membership, so Whop was not asked. Try again.")
  delete process.env.WHOP_API_KEY
  await one('no Whop key on the deployment', () => checkDb('mem_devUsed'), undefined, 500, "This deployment has no Whop key, so Whop can't be asked.")
  process.env.WHOP_API_KEY = KEY
  ok(checkErrors.length >= 10 && checkErrors.every((s) => typeof s === 'string' && s.trim() && !BANNED.test(s) && !/mem_|promo_|pay_|@/.test(s)),
     'every refusal is a plain sentence: no em dash, "unlock" or "EcomTalent", no Whop id', show([...new Set(checkErrors)]))
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== The cron route: who is read, what is written ===')
process.env.CRON_SECRET = 'cron-test-secret'
function cronDb() {
  const p = (id, membership, more = {}) => ({ id, first_paid_at: '2026-10-05T10:00:00.000Z', membership_status: 'active', whop_membership_id: membership, ...more })
  const db = new FakeDb({
    students: [
      p('s-evolve', 'mem_devEvolve'),
      p('s-used', 'mem_devUsed'),
      p('s-full', 'mem_devFull', { membership_status: 'past_due' }),
      p('s-year', 'mem_devYearCode'),
      p('s-pending', 'mem_devEvolve2'),
      p('s-rejected', 'mem_devLegacy'),
      p('s-none', null),
      p('s-pay', 'pay_devPayment'),
      p('s-missing', 'mem_devMissing'),
      // Not in the window, never read:
      p('s-sept', 'mem_devFull', { first_paid_at: '2026-09-29T10:00:00.000Z' }),
      p('s-canceled', 'mem_devFull', { membership_status: 'canceled' }),
      p('s-expired', 'mem_devFull', { membership_status: 'expired' }),
      p('s-nopay', 'mem_devFull', { first_paid_at: null }),
      // In the window with the 30% already: never read.
      p('s-approved', 'mem_devFull'),
      p('s-applied', 'mem_devFull'),
    ],
    discount_requests: [
      { id: 'r-p', student_id: 's-pending', status: 'pending', created_at: '2026-10-20T10:00:00.000Z' },
      { id: 'r-r', student_id: 's-rejected', status: 'rejected', created_at: '2026-10-15T10:00:00.000Z' },
      { id: 'r-a', student_id: 's-approved', status: 'approved', created_at: '2026-10-15T10:00:00.000Z' },
      { id: 'r-ap', student_id: 's-applied', status: 'applied', created_at: '2026-10-12T10:00:00.000Z' },
    ],
    [MEMBERSHIP_DISCOUNTS_TABLE]: [
      // Read before, from a membership that now 404s: kept as it was.
      { ...storedEvolve('s-missing', 'mem_devMissing'), checked_at: '2026-10-21T07:00:00.000Z' },
    ],
  })
  installDb(db)
  return db
}
const cron = async (q = '', secret = process.env.CRON_SECRET) => {
  const res = await cronRoute(new Request(`http://app/api/cron/refresh-membership-discounts${q}`, { headers: secret ? { authorization: `Bearer ${secret}` } : {} }))
  return { status: res.status, body: await res.json() }
}
{
  resetWhop()
  let db = cronDb()
  const no = await quiet(() => cron('', null))
  ok(no.value.status === 401 && db.rows(MEMBERSHIP_DISCOUNTS_TABLE).length === 1 && whop.log.length === 0, 'no secret: 401, nothing read or written')
  ok(db.rows('cron_runs').some((r) => r.route_name === 'refresh-membership-discounts' && r.status === 'auth_failed'), 'and a cron_runs row says so')
  const bad = await quiet(() => cron('?mode=all'))
  ok(bad.value.status === 400 && /mode must be/.test(bad.value.body.error) && whop.log.length === 0, 'an unknown mode: 400, nothing ran', show(bad.value.body))
  delete process.env.WHOP_API_KEY
  const noKey = await quiet(() => cron())
  ok(noKey.value.status === 500 && noKey.value.body.error === 'WHOP_API_KEY is not set on this deployment. Nothing ran.', 'no Whop key: 500, nothing ran')
  process.env.WHOP_API_KEY = KEY

  db = cronDb()
  const started = Date.now()
  const r = await quiet(() => cron())
  const b = r.value.body
  const rows = new Map(db.rows(MEMBERSHIP_DISCOUNTS_TABLE).map((x) => [x.student_id, x]))
  ok(r.value.status === 200 && b.ok === true && b.mode === 'write', 'a run: 200, ok', show(b))
  ok(b.in_window === 11 && b.pending_requests === 1 && b.have_the_30 === 2 && b.candidates === 9,
     'the window on 21 Oct, when every first payment from 1 October is still in one: active or past_due (11, the one pending request among them); the 2 with an approved or applied request left out (9 to check)', show({ in: b.in_window, pending: b.pending_requests, held: b.have_the_30, c: b.candidates }))
  ok(b.checked === 6 && b.discounted === 4 && b.written === 6 && b.skipped.no_membership === 1 && b.skipped.not_a_membership === 1 && show(b.failed) === show({ not_found: 1 }) && b.left === 0,
     '6 read and written (4 discounted), one with no membership, one with a payment\'s id, one Whop does not know', show(b))
  ok(rows.get('s-evolve')?.discounted === true && rows.get('s-evolve')?.promo_code === 'evolve10' && rows.get('s-used')?.discounted === false
       && rows.get('s-full')?.discounted === false && rows.get('s-year')?.discounted === true && rows.get('s-pending')?.discounted === true && rows.get('s-rejected')?.discounted === true,
     'each row as Whop said: evolve10 yes, used up no, full price no, yearly code yes; a pending and a rejected request are read too')
  ok(!rows.has('s-sept') && !rows.has('s-canceled') && !rows.has('s-expired') && !rows.has('s-nopay') && !rows.has('s-approved') && !rows.has('s-applied') && !rows.has('s-none') && !rows.has('s-pay'),
     'nobody outside the window, nobody with the 30% already, nobody with no membership is written')
  ok(rows.get('s-missing')?.checked_at === '2026-10-21T07:00:00.000Z', 'a failed read keeps the row it had')
  ok(whop.log.filter((x) => x.path.startsWith('/api/v1/plans/')).length === 2 && whop.log.filter((x) => x.path.startsWith('/api/v1/memberships/')).length === 7,
     'one read per member, each plan read once (2 plans)', show(whop.log.map((x) => x.path)))
  ok([...rows.values()].filter((x) => x.student_id !== 's-missing').every((x) => x.checked_at >= new RealDate(started).toISOString()), 'every row written carries the moment it was read')
  // The stand-in gives cron_runs rows no id, so cron-auth.ts's finish (an update by id) is not seen here; the start is.
  ok(db.rows('cron_runs').some((x) => x.route_name === 'refresh-membership-discounts' && x.auth_status === 'ok' && x.status === 'running'),
     'cron_runs: the run opens its row, as every cron does')
  ok(!/mem_|promo_|pay_|@/.test(show(b)), 'the answer names no Whop id and no email')

  // The next run: those never read come first, then the oldest read.
  resetWhop()
  db = cronDb()
  db.tables[MEMBERSHIP_DISCOUNTS_TABLE].push({ ...storedEvolve('s-evolve'), checked_at: '2026-10-21T08:00:00.000Z' })
  await quiet(() => cron())
  const order = whop.log.filter((x) => x.path.startsWith('/api/v1/memberships/')).map((x) => x.path.split('/').pop())
  ok(order.at(-2) === 'mem_devMissing' && order.at(-1) === 'mem_devEvolve' && order.indexOf('mem_devUsed') < order.indexOf('mem_devMissing'),
     'never read first, then the longest unread: the two read at 07:00 and 08:00 go last, in that order', order.join(', '))

  resetWhop()
  db = cronDb()
  const dry = await quiet(() => cron('?mode=dry'))
  ok(dry.value.status === 200 && dry.value.body.mode === 'dry' && dry.value.body.checked === 6 && dry.value.body.written === 0 && db.rows(MEMBERSHIP_DISCOUNTS_TABLE).length === 1,
     '?mode=dry: the same reads and counts, nothing written', show(dry.value.body))

  resetWhop()
  whop.answer = () => json(401, {})
  db = cronDb()
  const dead = await quiet(() => cron())
  ok(dead.value.status === 500 && dead.value.body.ok === false && dead.value.body.checked === 0 && dead.value.body.failed.http_401_403 === 7,
     'every read refused (a revoked key): 500, ok false, the kind counted', show(dead.value.body))
  ok(dead.lines.some((l) => l.includes('[refresh-membership-discounts] every Whop read failed: http_401_403 7')),
     'and the log says why, for Vercel\'s log search', show(dead.lines))

  resetWhop()
  db = cronDb()
  db.fail['students.select'] = { message: 'canceling statement due to statement timeout' }
  const noStudents = await quiet(() => cron())
  ok(noStudents.value.status === 500 && /students/.test(noStudents.value.body.error) && whop.log.length === 0, 'who is in the window cannot be read: 500, nothing read from Whop')

  resetWhop()
  db = cronDb()
  db.fail['discount_requests.select'] = { message: 'canceling statement due to statement timeout' }
  const noPending = await quiet(() => cron())
  ok(noPending.value.status === 500 && /discount_requests \(pending\)/.test(noPending.value.body.error) && whop.log.length === 0,
     'who holds a pending request cannot be read: 500 naming that read, nothing read from Whop (the render review\'s second round)', show(noPending.value.body.error))

  resetWhop()
  db = cronDb()
  db.fail[`${MEMBERSHIP_DISCOUNTS_TABLE}.upsert`] = { message: 'relation "student_membership_discounts" does not exist' }
  const noTable = await quiet(() => cron())
  ok(noTable.value.status === 500 && /student_membership_discounts/.test(noTable.value.body.error) && noTable.value.body.written === 0, 'a database without v111: 500 on the first write, and it says which table')
}
{
  // 1,000 members: no request starts after 240 s, the rest are left for the next run; rows written 25 at a time.
  resetWhop()
  const many = Array.from({ length: 1000 }, (_, i) => {
    const id = `mem_devMany${String(i).padStart(4, '0')}`
    whop.memberships.set(id, { id, promo_code_id: null, renewal_price: '97.00', plan_id: MONTHLY })
    return { id: `s-${String(i).padStart(4, '0')}`, first_paid_at: '2026-10-05T10:00:00.000Z', membership_status: 'active', whop_membership_id: id }
  })
  const db = new FakeDb({ students: many })
  installDb(db)
  const started = Date.now()
  const r = await quiet(() => cron())
  const b = r.value.body
  const lastStart = Math.max(...whop.log.map((x) => x.at))
  ok(r.value.status === 200 && b.left > 0 && b.checked + b.left === 1000 && b.written === b.checked && lastStart - started <= REFRESH_START_BUDGET_MS,
     `1,000 members: ${b.checked} read in the 240 s, ${b.left} left for the next run, the last request started at ${Math.round((lastStart - started) / 1000)} s`, show({ checked: b.checked, left: b.left }))
  const writes = db.calls(MEMBERSHIP_DISCOUNTS_TABLE, 'upsert').map((q) => q.values.length)
  ok(writes.length > 1 && writes.slice(0, -1).every((n) => n === 25), `written 25 at a time, as it went: ${writes.length} writes`)
}

// ════════════════════════════════════════════════════════════════════════════
// Admin rebuild 2, the render review's fix round: the cron reads only the
// students whose 30% window is still open (discountWindowOpen), with no
// approved or applied request. It read every student who first paid from 1
// October, active or past due: a list that only grew while their windows
// closed and no request could be made any more. Its second round: every
// student holding a pending request is read too, whatever their window or
// membership, so a stale answer on the 30% page's row heals by itself (the
// first round left them out once their window closed).
console.log('\n=== The cron: the students whose 30% window is still open, and every pending request ===')
{
  const ms = (iso) => RealDate.parse(iso)
  // The rule's own edges, on the suite's clock moved where each is.
  ok(discountWindowOpen('2026-10-05T10:00:00.000Z', ms('2026-10-21T09:00:00.000Z')) && discountWindowOpen('2026-10-05T10:00:00.000Z', ms(DISCOUNT_SHARED_DEADLINE))
       && !discountWindowOpen('2026-10-05T10:00:00.000Z', ms(DISCOUNT_SHARED_DEADLINE) + 1),
     'a first payment in the shared window (5 Oct): open until the end of 23 October, its last millisecond inside, closed the next')
  ok(discountWindowOpen('2026-10-20T10:00:00.000Z', ms('2026-11-03T10:00:00.000Z')) && !discountWindowOpen('2026-10-20T10:00:00.000Z', ms('2026-11-03T10:00:00.001Z')),
     'a first payment from the launch (20 Oct): open for 14 days to the millisecond, as discountState counts it')
  ok(!discountWindowOpen('2026-09-29T10:00:00.000Z', ms('2026-10-21T09:00:00.000Z')) && !discountWindowOpen(null, ms('2026-10-21T09:00:00.000Z')),
     'a first payment before 1 October, or none: never open')
  ok(earliestOpenFirstPayment(ms('2026-10-21T09:00:00.000Z')) === DISCOUNT_ELIGIBLE_FROM && earliestOpenFirstPayment(ms(DISCOUNT_SHARED_DEADLINE)) === DISCOUNT_ELIGIBLE_FROM,
     'the read starts at 1 October while the shared deadline has not passed')
  ok(earliestOpenFirstPayment(ms('2026-10-24T09:00:00.000Z')) === '2026-10-10T09:00:00.000Z' && earliestOpenFirstPayment(ms('2026-11-05T09:00:00.000Z')) === '2026-10-22T09:00:00.000Z'
       && Date.parse(earliestOpenFirstPayment(ms(DISCOUNT_SHARED_DEADLINE) + 1)) > Date.parse(DISCOUNT_LAUNCH_DATE),
     'once the shared deadline has passed, 14 days back (24 Oct reads from 10 Oct, 5 Nov from 22 Oct), never before the launch')

  const p = (id, paid, membership, more = {}) => ({ id, first_paid_at: paid, membership_status: 'active', whop_membership_id: membership, ...more })
  function windowDb() {
    const db = new FakeDb({
      students: [
        // Shared window (paid 1 to 8 October): closed after 23 October.
        p('w-shared', '2026-10-05T10:00:00.000Z', 'mem_devEvolve'),
        // Own windows: 14 days from the first payment.
        p('w-closed', '2026-10-20T10:00:00.000Z', 'mem_devUsed'),
        p('w-edge', '2026-10-22T09:00:00.000Z', 'mem_devFull'),
        p('w-open', '2026-10-25T10:00:00.000Z', 'mem_devEvolve2'),
        p('w-pending', '2026-11-01T10:00:00.000Z', 'mem_devYearCode', { membership_status: 'past_due' }),
        // Open, but the 30% is theirs already.
        p('w-approved', '2026-11-02T10:00:00.000Z', 'mem_devFull'),
        // Open, but not a member any more.
        p('w-canceled', '2026-11-03T10:00:00.000Z', 'mem_devFull', { membership_status: 'canceled' }),
        // A pending request outside any open window (the render review's second round): the shared group's, asked
        // by 23 October and still waiting; and one from before 1 October, of a member who canceled since.
        p('w-shared-pending', '2026-10-06T10:00:00.000Z', 'mem_devLegacy'),
        p('w-gone-pending', '2026-09-20T10:00:00.000Z', 'mem_devKept', { membership_status: 'canceled' }),
      ],
      discount_requests: [
        { id: 'r-wp', student_id: 'w-pending', status: 'pending', created_at: '2026-11-04T10:00:00.000Z' },
        { id: 'r-wa', student_id: 'w-approved', status: 'approved', created_at: '2026-11-04T10:00:00.000Z' },
        { id: 'r-wsp', student_id: 'w-shared-pending', status: 'pending', created_at: '2026-10-22T10:00:00.000Z' },
        { id: 'r-wgp', student_id: 'w-gone-pending', status: 'pending', created_at: '2026-10-02T10:00:00.000Z' },
      ],
    })
    installDb(db)
    return db
  }
  const before = clock
  try {
    // Thu 5 Nov, 10:00 in Croatia: the shared deadline long past.
    clock = ms('2026-11-05T09:00:00.000Z')
    resetWhop()
    const db = windowDb()
    const r = await quiet(() => cron())
    const b = r.value.body
    const rows = new Set(db.rows(MEMBERSHIP_DISCOUNTS_TABLE).map((x) => x.student_id))
    const read = whop.log.filter((x) => x.path.startsWith('/api/v1/memberships/')).map((x) => x.path.split('/').pop()).sort()
    ok(r.value.status === 200 && b.in_window === 4 && b.pending_requests === 3 && b.have_the_30 === 1 && b.candidates === 5,
       '5 Nov: in the window the 4 whose window is open and who are members (the edge of 22 Oct, 25 Oct, 1 Nov past due, 2 Nov); 3 pending requests, 2 of them outside any open window; the approved one left out, 5 to check',
       show({ in: b.in_window, pending: b.pending_requests, held: b.have_the_30, c: b.candidates }))
    ok(show(read) === show(['mem_devEvolve2', 'mem_devFull', 'mem_devKept', 'mem_devLegacy', 'mem_devYearCode'])
         && show([...rows].sort()) === show(['w-edge', 'w-gone-pending', 'w-open', 'w-pending', 'w-shared-pending']),
       'Whop is asked about those 5 alone, and their rows written: the open windows, and every student holding a pending request whatever their window or membership', show({ read, rows: [...rows] }))
    ok(!rows.has('w-shared') && !rows.has('w-closed') && !rows.has('w-approved') && !rows.has('w-canceled'),
       'the shared window (closed 23 Oct) and the own window closed on 3 Nov are no longer read with no request waiting, nor the approved or the canceled student')
    ok(rows.has('w-shared-pending') && rows.has('w-gone-pending'),
       'a pending request of the shared group (its window closed on 23 Oct) and one of a canceled member from before 1 October are read: a stale answer on their 30% row heals by itself (the render review\'s second round)')
    const asked = db.calls('students', 'select').map((c) => c.filters).flat()
    ok(asked.some((f) => f === 'first_paid_at>=2026-10-22T09:00:00.000Z'),
       'the students read itself starts at the earliest first payment still open (22 Oct), so it stays as short as the window', show(asked))
    ok(asked.some((f) => f === 'id in (w-gone-pending,w-shared-pending)') && db.calls('discount_requests', 'select').some((c) => c.filters.includes('status=pending')),
       'the pending requests are read by their status, and only their holders outside the window are read again, by id', show(asked))

    // 21 October, the suite's own day: both of these windows are still open, and the read starts at 1 October.
    clock = ms('2026-10-21T09:00:00.000Z')
    resetWhop()
    const early = new FakeDb({ students: [p('w-shared', '2026-10-05T10:00:00.000Z', 'mem_devEvolve'), p('w-closed', '2026-10-20T10:00:00.000Z', 'mem_devUsed')] })
    installDb(early)
    const e = (await quiet(() => cron())).value.body
    ok(e.in_window === 2 && e.checked === 2 && early.calls('students', 'select').some((c) => c.filters.includes(`first_paid_at>=${DISCOUNT_ELIGIBLE_FROM}`)),
       '21 Oct: the shared window (to 23 Oct) and the own one (to 3 Nov) are open, both read; the read starts at 1 October',
       show({ in: e.in_window, checked: e.checked }))
  } finally {
    clock = before
  }
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== GET /api/student/data carries the stored flag, and only the flag ===')
function dataDb(stored, membership = 'mem_devEvolve') {
  setCatalog({ v2: false })
  const db = new FakeDb({
    students: [{ id: 's1', whop_user_id: 'user_1', supabase_user_id: 'auth-1', whop_membership_id: membership }],
    regions: [{ id: 'a1', order_num: 1 }],
    lessons: [{ id: 'a1l01', region_id: 'a1', sort_order: 1 }],
    student_streaks: [{ student_id: 's1', current_streak: 1, longest_streak: 1, last_streak_date: '2099-01-01' }],
    student_milestones: [{ student_id: 's1' }],
    discount_requests: [],
    ...(stored ? { [MEMBERSHIP_DISCOUNTS_TABLE]: [stored] } : {}),
  }, { 'tok-1': 'auth-1' })
  installDb(db)
  return db
}
async function data() {
  const res = await dataRoute(new Request('http://app/api/student/data', { headers: { authorization: 'Bearer tok-1' } }))
  return { status: res.status, body: await res.json() }
}
{
  let r = await quiet(async () => { dataDb(storedEvolve('s1')); return data() })
  ok(r.value.status === 200 && r.value.body.membershipDiscounted === true, 'a stored discount on the student\'s own membership: membershipDiscounted true')
  ok(!/evolve10|promo_|87\.3|renewal/.test(show(r.value.body)), 'the code, its id and the prices never reach the student\'s browser')
  r = await quiet(async () => { dataDb(storedEvolve('s1', 'mem_devOld'), 'mem_devNew'); return data() })
  ok(r.value.body.membershipDiscounted === false, 'a row read from a membership the student no longer has: false')
  r = await quiet(async () => { dataDb({ ...storedEvolve('s1'), discounted: false }); return data() })
  ok(r.value.body.membershipDiscounted === false, 'a stored row that says no: false')
  r = await quiet(async () => { dataDb(null); return data() })
  ok(r.value.status === 200 && r.value.body.membershipDiscounted === false && r.lines.length === 0, 'no row: false, nothing logged')
  r = await quiet(async () => {
    const db = dataDb(storedEvolve('s1'))
    db.fail[`${MEMBERSHIP_DISCOUNTS_TABLE}.select`] = { message: 'relation "student_membership_discounts" does not exist', code: '42P01' }
    return data()
  })
  ok(r.value.status === 200 && r.value.body.membershipDiscounted === false && r.lines.some((l) => l.includes('student_membership_discounts read failed')),
     'the read fails (a database without v111): still 200, the flag false, the failure logged (the request routes ask Whop themselves)', show(r.lines))
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== vercel.json, the migration and its undo ===')
{
  const v = JSON.parse(read('../vercel.json'))
  const entry = v.crons.find((c) => c.path === '/api/cron/refresh-membership-discounts')
  const minute = (s) => s.split(' ')[0]
  const others = v.crons.filter((c) => c !== entry).map((c) => minute(c.schedule))
  ok(entry?.schedule === '40 */2 * * *' && !others.includes('40'), 'every 2 hours at minute 40, a minute no other cron uses', show(v.crons.map((c) => c.schedule)))
  ok(show(v.functions['src/app/api/cron/refresh-membership-discounts/route.ts']) === show({ regions: ['iad1'] }), 'its function pinned to iad1, next to Whop')
  const route = read('../src/app/api/cron/refresh-membership-discounts/route.ts')
  ok(/export const maxDuration = 300;/.test(route) && REFRESH_START_BUDGET_MS === 240_000, 'maxDuration 300, no request started after 240 s')

  const sql = read('../supabase/migrations/2026_v111_student_membership_discounts.sql').replace(/--.*$/gm, '')
  const undo = read('../supabase/undo/2026_v111_undo.sql').replace(/--.*$/gm, '')
  ok(/create table if not exists public\.student_membership_discounts \(/.test(sql), 'v111 makes the table, and a second run finds it')
  const cols = {
    student_id: /student_id\s+uuid primary key references public\.students\(id\) on delete cascade/,
    whop_membership_id: /whop_membership_id\s+text,/, promo_code_id: /promo_code_id\s+text,/, promo_code: /promo_code\s+text,/,
    renewal_price: /renewal_price\s+numeric,/, plan_renewal_price: /plan_renewal_price\s+numeric,/,
    discounted: /discounted\s+boolean not null,/, checked_at: /checked_at\s+timestamptz not null/,
  }
  ok(Object.values(cols).every((re) => re.test(sql)), 'its 8 columns, the student\'s id the key and gone with the student', Object.keys(cols).filter((k) => !cols[k].test(sql)).join(', '))
  ok(/enable row level security/.test(sql) && (sql.match(/create policy/g) ?? []).length === 1
       && /for select\s+to authenticated\s+using \(public\.current_user_is_team\(\)\)/.test(sql) && !/for (insert|update|delete|all)/.test(sql),
     'row level security on, one policy: the team reads; no policy writes (the service role only)')
  ok(/drop policy if exists "Team reads membership discounts"/.test(sql) && /revoke all on public\.student_membership_discounts from anon;/.test(sql)
       && /revoke insert, update, delete, truncate, references, trigger on public\.student_membership_discounts from authenticated;/.test(sql),
     're-runnable policy, and a visitor\'s and a student\'s write privileges taken away')
  ok(/^begin;/m.test(sql) && /^commit;/m.test(sql) && /set local lock_timeout = '5s';/.test(sql), 'one transaction, 5 seconds at most for a lock')
  ok(/drop table if exists public\.student_membership_discounts;/.test(undo) && /set local lock_timeout = '5s';/.test(undo), 'the undo drops the table, and a second run changes nothing')
  ok(DISCOUNT_ELIGIBLE_FROM === '2026-09-30T22:00:00.000Z', 'the window starts at 1 October in Croatia, the date the cron reads')
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
