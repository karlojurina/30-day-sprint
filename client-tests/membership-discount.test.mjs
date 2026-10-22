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
// moved past the shared deadline. Since T-122 (2026-10-21) every student
// gets a yes or a no unless Whop does not answer: the stand-in also answers
// v2's GET /api/v2/memberships?user_id= (a student's memberships, found
// through their Whop user) and the pinned GET /api/v1/payments?user_id=
// (the latest real payment, under 97.00 being a discount), and the cron's
// answer counts by the step that answered. Since T-122's fix round (the same
// day) the payments carry their subtotal, tax_amount and tax_behavior as the
// pinned shape does: a payment naming a code that took money off is a
// discount at any price, and the price is the total less any tax added on
// top; and every course membership found through the Whop user is read (a
// newer free one hid an older paid one), as is the case of a free one on file.
// Since T-122's third fix round (2026-10-22) the check is the owner's rule as
// he put it: a code other than the student's own 30% on any course membership
// (the user's memberships read every time) or on any course payment, the $0
// ones too, is a coupon; with no code anywhere, a real payment in dollars
// under 97.00 that is no plan change is one; and a stored "no coupon" answers
// for a Whop that gives none only when this rule wrote it (its source set).
// Its own section, at the end, runs every case of the re-check that found
// the round before still let coupon holders in.
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
// T-122's fix round: a $970 yearly plan, and a free plan sold on the course product (friends and family).
const YEAR970 = 'plan_devYearly970'
const FREE = 'plan_devFree'
// T-122: the course's product, and another one. WHOP_PRODUCT_ID names the course alone, as on production since 2026-10-20.
const COURSE = 'prod_devCourse'
const OTHER = 'prod_devOther'
process.env.WHOP_PRODUCT_ID = COURSE
const whop = {
  memberships: new Map(),
  plans: new Map(),
  promos: new Map(),
  /** v2's list by user (GET /api/v2/memberships?user_id=): Whop user id -> their memberships, in v2's flat shape. */
  byUser: new Map(),
  /** v1's payments by user (GET /api/v1/payments?user_id=), pinned shape: Whop user id -> their payments. */
  payments: new Map(),
  /** Every request: its path and query, the version and key it carried, and when it started. */
  log: [],
  /** (path, n, url) => a Response, 'hang', 'throw' or null: an answer of the test's choosing for that request. */
  answer: null,
  /** How long every answer takes, on the suite's clock (T-122's fourth fix round measures a slow Whop); 0 by default. */
  delayMs: 0,
}
const json = (status, body, headers = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', ...headers },
})
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url))
  if (u.hostname !== 'api.whop.com') throw new Error(`the suite let a request go to ${u.hostname}`)
  const h = init.headers ?? {}
  whop.log.push({ path: u.pathname, query: u.search, version: h['Api-Version-Date'] ?? null, auth: h.Authorization ?? null, at: Date.now() })
  if (whop.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, whop.delayMs))
  const special = whop.answer ? whop.answer(u.pathname, whop.log.length, u) : null
  if (special === 'hang') return new Promise(() => {})
  if (special === 'throw') throw new TypeError('fetch failed')
  if (special) return special
  if (u.pathname === '/api/v2/memberships') {
    // v2's pages: `per` rows a page, { current_page, total_page }. A user whose list is a number answers that status.
    const per = Number(u.searchParams.get('per') ?? 10)
    const page = Number(u.searchParams.get('page') ?? 1)
    const listed = whop.byUser.get(u.searchParams.get('user_id'))
    if (typeof listed === 'number') return json(listed, { error: { message: 'Not found' } })
    const all = listed ?? []
    return json(200, { data: all.slice((page - 1) * per, page * per), pagination: { current_page: page, total_page: Math.max(1, Math.ceil(all.length / per)), total_count: all.length } })
  }
  if (u.pathname === '/api/v1/payments') {
    // The pinned list: `first` rows from the cursor, newest first as Whop gives them; status=paid is left to the reader to check.
    const first = Number(u.searchParams.get('first') ?? 20)
    const from = Number(u.searchParams.get('after') ?? 0)
    const all = whop.payments.get(u.searchParams.get('user_id')) ?? []
    const more = from + first < all.length
    return json(200, { data: all.slice(from, from + first), page_info: { has_next_page: more, end_cursor: more ? String(from + first) : null } })
  }
  const m = u.pathname.match(/^\/api\/v1\/(memberships|plans|promo_codes)\/([^/]+)$/)
  if (!m) return json(404, { error: { message: 'Not found' } })
  const table = { memberships: whop.memberships, plans: whop.plans, promo_codes: whop.promos }[m[1]]
  const id = decodeURIComponent(m[2])
  return table.has(id) ? json(200, table.get(id)) : json(404, { error: { message: 'Not found' } })
}
/** A membership as v2 lists it for a user: flat ids, status and valid, created_at in seconds. */
const v2 = (id, user, more = {}) => ({ id, user, product: COURSE, plan: MONTHLY, status: 'active', valid: true, created_at: 1_759_000_000, ...more })
/** An amount as the pinned shape gives it. */
const money = (amount) => ({ amount, currency: 'usd' })
/**
 * A real payment in the pinned shape: paid, a money object, the buyer nested, the rest as ids. Every payment carries
 * subtotal, tax_amount and tax_behavior there (Whop's payment object at 2026-10-15-1): by default the subtotal is the
 * total and no tax applied (null).
 */
const pay = (id, user, total, paidAt, more = {}) => ({
  id, status: 'paid', substatus: 'succeeded', paid_at: paidAt, created_at: paidAt,
  total: money(total), subtotal: money(total), tax_amount: null, tax_behavior: null, refunded_amount: money('0.00'),
  user: { id: user }, product_id: COURSE, membership_id: null, promo_code_id: null, ...more,
})
/** A payment a promo code took money off: the subtotal the plan's price, the total less. */
const onCode = (code, subtotal, more = {}) => ({ promo_code_id: code, subtotal: money(subtotal), ...more })
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
    // T-122: a null renewal price, and no plan id: judged by the real payments. These name no code on the membership:
    // since T-122's second fix round a membership naming a code whose price or plan does not read is a discount by
    // itself (the round's own section, at the end), so the code is on the payments here, as the first rounds tested.
    ['mem_devNullPrice', { id: 'mem_devNullPrice', status: 'active', promo_code_id: null, renewal_price: null, plan_id: MONTHLY }],
    ['mem_devNoPlan', { id: 'mem_devNoPlan', status: 'active', promo_code_id: null, renewal_price: '97.00' }],
    // On a plan Whop does not know.
    ['mem_devGone', { id: 'mem_devGone', status: 'active', promo_code_id: null, renewal_price: '97.00', plan_id: 'plan_devGone' }],
    // T-122's fix round. No renewal price, so the real payments decide: a $970 yearly member on a 10% code, an
    // evolve10 member taxed on top, and a full-price member (each control's payment is its user's). No code named on
    // the membership, as above.
    ['mem_devYear970Null', { id: 'mem_devYear970Null', status: 'active', promo_code_id: null, renewal_price: null, plan_id: YEAR970 }],
    ['mem_devTaxNull', { id: 'mem_devTaxNull', status: 'active', promo_code_id: null, renewal_price: null, plan_id: MONTHLY }],
    ['mem_devCtlNull', { id: 'mem_devCtlNull', status: 'active', promo_code_id: null, renewal_price: null, plan_id: MONTHLY }],
    // evolve10 on a paid membership, and a free friends-and-family membership of the course product given later.
    ['mem_devEvolve3', { id: 'mem_devEvolve3', status: 'active', promo_code_id: 'promo_devEvolve', renewal_price: '87.30', plan_id: MONTHLY }],
    ['mem_devFree', { id: 'mem_devFree', status: 'completed', promo_code_id: null, renewal_price: '0.00', plan_id: FREE }],
  ])
  whop.plans = new Map([
    [MONTHLY, { id: MONTHLY, plan_type: 'renewal', renewal_price: '97.00', initial_price: '0.00' }],
    [YEARLY, { id: YEARLY, plan_type: 'renewal', renewal_price: 997 }],
    [YEAR970, { id: YEAR970, plan_type: 'renewal', renewal_price: '970.00', initial_price: '0.00' }],
    [FREE, { id: FREE, plan_type: 'one_time', renewal_price: '0.00', initial_price: '0.00' }],
  ])
  whop.promos = new Map([
    ['promo_devEvolve', { id: 'promo_devEvolve', code: 'evolve10' }],
    ['promo_devUsed50', { id: 'promo_devUsed50', code: 'welcome50' }],
  ])
  whop.byUser = new Map([
    // A payment's id on file: the course membership is evolve10's, or a full-price one.
    ['user_devEvolvePay', [v2('mem_devEvolve', 'user_devEvolvePay')]],
    ['user_devFullPay', [v2('mem_devFull', 'user_devFullPay')]],
    // The order: active before past_due, then the newest; another product and a canceled one never.
    ['user_devOrder', [
      v2('mem_devUsed', 'user_devOrder', { created_at: 1_740_000_000 }),
      v2('mem_devEvolve', 'user_devOrder', { created_at: 1_750_000_000 }),
      v2('mem_devFull', 'user_devOrder', { status: 'past_due', valid: true, created_at: 1_760_000_000 }),
      v2('mem_devYear', 'user_devOrder', { product: OTHER, created_at: 1_761_000_000 }),
      v2('mem_devKept', 'user_devOrder', { status: 'canceled', valid: false, created_at: 1_762_000_000 }),
    ]],
    // A membership Whop does not know on file; the user's course membership is the evolve10 one.
    ['user_devGone', [v2('mem_devEvolve2', 'user_devGone')]],
    // No course membership that grants access: another product's, and an expired course one.
    ['user_devNoCourse', [v2('mem_devYear', 'user_devNoCourse', { product: OTHER }), v2('mem_devFull', 'user_devNoCourse', { status: 'expired', valid: false })]],
    // The course membership has no renewal price: the payment decides.
    ['user_devNullPay', [v2('mem_devNullPrice', 'user_devNullPay')]],
    // T-122's fix round: evolve10 on a paid membership (September), then a free one given later (October). Both grant
    // access (a free one-time claim reads completed and valid). And the same free one beside a full-price membership.
    ['user_devFreeLater', [
      v2('mem_devEvolve3', 'user_devFreeLater', { created_at: 1_759_000_000 }),
      v2('mem_devFree', 'user_devFreeLater', { plan: FREE, status: 'completed', valid: true, created_at: 1_760_500_000 }),
    ]],
    ['user_devFreeFull', [
      v2('mem_devFull', 'user_devFreeFull', { created_at: 1_759_000_000 }),
      v2('mem_devFree', 'user_devFreeFull', { plan: FREE, status: 'completed', valid: true, created_at: 1_760_500_000 }),
    ]],
    // A list that cannot be used: Whop ignored the user filter and answered with someone else's membership (no answer
    // since T-122's fourth fix round), and a list that answers 404 (the check goes on by the payments).
    ['user_devIgnored', [v2('mem_devSomeone', 'user_devSomeoneElse')]],
    ['user_devListGone', 404],
  ])
  whop.payments = new Map([
    // The newest real course payment is 87.30 on evolve10; a refund, another product and a $0 one after it do not count.
    ['user_devOdd', [
      pay('pay_devO5', 'user_devOdd', '0.00', '2026-10-14T10:00:00.000Z'),
      pay('pay_devO4', 'user_devOdd', '20.00', '2026-10-12T10:00:00.000Z', { product_id: OTHER }),
      pay('pay_devO3', 'user_devOdd', '50.00', '2026-10-10T10:00:00.000Z', { substatus: 'refunded', refunded_amount: { amount: '50.00', currency: 'usd' } }),
      pay('pay_devO1', 'user_devOdd', '97.00', '2026-09-03T10:00:00.000Z'),
      pay('pay_devO2', 'user_devOdd', '87.30', '2026-10-03T10:00:00.000Z', onCode('promo_devEvolve', '97.00', { membership_id: 'mem_devOdd' })),
    ]],
    // 87.30 once, then 97.00, the newest: full price now.
    ['user_devOddFull', [
      pay('pay_devF2', 'user_devOddFull', '97.00', '2026-10-05T10:00:00.000Z'),
      pay('pay_devF1', 'user_devOddFull', '87.30', '2026-09-05T10:00:00.000Z', onCode('promo_devEvolve', '97.00')),
    ]],
    // No course membership, a real payment under 97.00 with no code on it, made for a membership of its own.
    ['user_devNoCourse', [pay('pay_devN1', 'user_devNoCourse', '87.30', '2026-10-03T10:00:00.000Z', { membership_id: 'mem_devPaid' })]],
    ['user_devNullPay', [pay('pay_devP1', 'user_devNullPay', '87.30', '2026-10-04T10:00:00.000Z', onCode('promo_devEvolve', '97.00'))]],
    // T-122's fix round, the adversarial check's cases: a yearly 873.00 on a 10% code (970.00 before it); evolve10's
    // 87.30 with 20% tax added on top (a total of 104.76); the same yearly payment for a student whose list cannot be used.
    ['user_devYear970', [pay('pay_devY1', 'user_devYear970', '873.00', '2026-10-12T10:00:00.000Z', onCode('promo_devYear10', '970.00', { membership_id: 'mem_devYear970Null' }))]],
    ['user_devTaxed', [pay('pay_devT1', 'user_devTaxed', '104.76', '2026-10-12T10:00:00.000Z',
      onCode('promo_devEvolve', '97.00', { tax_amount: money('17.46'), tax_behavior: 'exclusive', membership_id: 'mem_devTaxNull' }))]],
    ['user_devIgnored', [pay('pay_devI1', 'user_devIgnored', '873.00', '2026-10-12T10:00:00.000Z', onCode('promo_devYear10', '970.00'))]],
    ['user_devListGone', [pay('pay_devLG1', 'user_devListGone', '873.00', '2026-10-12T10:00:00.000Z', onCode('promo_devYear10', '970.00'))]],
    // The controls, no code on any: 97.00; 97.00 with 20% tax added on top (116.40); a yearly 970.00; and 97.00 with
    // the tax inside the price (Whop's tax_behavior "inclusive": 16.17 of the 97.00 is VAT).
    ['user_devCtl97', [pay('pay_devC1', 'user_devCtl97', '97.00', '2026-10-12T10:00:00.000Z')]],
    ['user_devCtlTax', [pay('pay_devC2', 'user_devCtlTax', '116.40', '2026-10-12T10:00:00.000Z',
      { subtotal: money('97.00'), tax_amount: money('19.40'), tax_behavior: 'exclusive' })]],
    ['user_devCtl970', [pay('pay_devC3', 'user_devCtl970', '970.00', '2026-10-12T10:00:00.000Z')]],
    ['user_devCtlIncl', [pay('pay_devC4', 'user_devCtlIncl', '97.00', '2026-10-12T10:00:00.000Z', { tax_amount: money('16.17'), tax_behavior: 'inclusive' })]],
    // A used one-month code on a full-price renewal: the payment names it, and it took nothing off.
    ['user_devUsedPay', [pay('pay_devU1', 'user_devUsedPay', '97.00', '2026-10-12T10:00:00.000Z', onCode('promo_devUsed50', '97.00'))]],
  ])
  whop.log = []
  whop.answer = null
  whop.delayMs = 0
}
resetWhop()

const {
  WHOP_DISCOUNT_VERSION, MEMBERSHIP_DISCOUNTS_TABLE, REFRESH_START_BUDGET_MS, priceOf, idOf, isDiscounted, storedRowApplies,
  isMembershipId, newReadContext, readMembershipDiscount, checkMembershipDiscount, codeOf,
  FULL_PRICE, paidUnderFullPrice, courseProductIds, findCourseMemberships, judgeStudentDiscount, lacksSourceColumn, isNoAnswer,
  paymentCoupon,
} = await import('./_gen/membership-discount.ts')
const { fetchCoursePayments, taxOnTopOf, judgePayment } = await import('./_gen/first-payment.ts')
const { ETFB_PRODUCT_ID, TEAM_SEAT_PRODUCT_ID } = await import('./_gen/whop-products.ts')
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
/**
 * THE RULE STAMP (T-122's fifth fix round): the `source` a row this rule writes carries, the step with the rule's
 * version before it. The step's word alone until then, which v113's check now refuses. A checked row written by this
 * rule also carries `source_checked_at`, its own `checked_at`.
 */
const R5 = (step) => `r5-${step}`
/** A stored row as this rule writes it: its stamp, and source_checked_at its checked_at. */
const stampedBy = (row, step) => ({ ...row, source: R5(step), source_checked_at: row.checked_at })

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
     && !storedRowApplies(null, 'mem_a') && !storedRowApplies({ whop_membership_id: null }, 'mem_a') && !storedRowApplies(null, null),
   'a stored row counts only for the membership it was read from')
ok(storedRowApplies({ whop_membership_id: 'mem_a' }, 'pay_devPayment') && storedRowApplies({ whop_membership_id: 'mem_a' }, null)
     && storedRowApplies({ whop_membership_id: null }, null) && storedRowApplies({ whop_membership_id: null }, undefined),
   'with a payment\'s id or no id on file there is no membership to compare: the student\'s row counts (T-122: it was written through the Whop user or a payment)')
// T-122's rule of thumb and the course's products.
ok(FULL_PRICE === 97 && paidUnderFullPrice(87.3) && paidUnderFullPrice(96.99) && !paidUnderFullPrice(97) && !paidUnderFullPrice(97.000001) && !paidUnderFullPrice(997),
   'a real payment under 97.00 is a discount (87.30, 96.99); 97.00 and more is none, compared in cents')
// T-122's fix round: the tax a total carries on top of the price (Whop: total is "the price after discounts, plus any
// tax added on top"), and step 3's answer on one payment: the code is the rule, 97.00 the rule of thumb.
ok(taxOnTopOf({ tax_amount: null }) === 0 && taxOnTopOf({ tax_amount: null, tax_behavior: 'exclusive' }) === 0,
   'tax_amount null is no tax ("Null when no tax applied"): nothing on top')
// T-122's second fix round: only "exclusive" is on top. Until then any behaviour but "inclusive" was, so a 97.00
// total holding a tax under a behaviour of null read as 80.83, a coupon (the adversarial re-check's nit c).
ok(taxOnTopOf({ tax_amount: money('17.46'), tax_behavior: 'exclusive' }) === 17.46 && taxOnTopOf({ tax_amount: 17.46, tax_behavior: 'exclusive' }) === 17.46
     && taxOnTopOf({ tax_amount: '17.46', tax_behavior: 'exclusive' }) === 17.46,
   'a tax added on top ("exclusive") is on top: a money object, a number or a string')
ok(taxOnTopOf({ tax_amount: money('17.46'), tax_behavior: 'unspecified' }) === null && taxOnTopOf({ tax_amount: money('19.40'), tax_behavior: 'unable_to_collect' }) === null
     && taxOnTopOf({ tax_amount: '17.46', tax_behavior: null }) === null && taxOnTopOf({ tax_amount: 17.46 }) === null,
   'a tax with any other behaviour, or none, is not known to be on top (null): the total may hold it (it was read as on top until the second fix round)')
ok(taxOnTopOf({ tax_amount: money('0.00'), tax_behavior: null }) === 0 && taxOnTopOf({ tax_amount: 0, tax_behavior: 'unspecified' }) === 0,
   'a tax of 0 is nothing on top, whatever the behaviour')
ok(taxOnTopOf({ tax_amount: money('16.17'), tax_behavior: 'inclusive' }) === 0, 'a tax already inside the price ("inclusive") is not on top: the total is the price')
ok(taxOnTopOf({}) === null && taxOnTopOf({ tax_behavior: 'exclusive' }) === null && taxOnTopOf({ tax_amount: { amount: null } }) === null && taxOnTopOf({ tax_amount: 'some' }) === null,
   'a tax_amount missing (another shape) or that does not read: not known (null), never 0')
{
  const coupon = (total, subtotal, taxOnTop, promoCodeId = null) => paymentCoupon({ total, subtotal, taxOnTop, promoCodeId })
  ok(show(coupon(873, 970, 0, 'promo_devYear10')) === show({ price: 873, heldAgainst: 970, discounted: true }),
     'a yearly 873.00 naming a code, 970.00 before it: the code took money off, a coupon (it read as none until the fix round, 873.00 being over 97.00)', show(coupon(873, 970, 0, 'promo_devYear10')))
  ok(show(coupon(104.76, 97, 17.46, 'promo_devEvolve')) === show({ price: 87.3, heldAgainst: 97, discounted: true }),
     'evolve10 with 20% tax added on top (104.76 less 17.46 is 87.30): a coupon, held against its subtotal', show(coupon(104.76, 97, 17.46, 'promo_devEvolve')))
  ok(show(coupon(97, 97, 0)) === show({ price: 97, heldAgainst: 97, discounted: false })
       && show(coupon(116.4, 97, 19.4)) === show({ price: 97, heldAgainst: 97, discounted: false })
       && show(coupon(970, 970, 0)) === show({ price: 970, heldAgainst: 97, discounted: false }),
     'the controls, no code named: 97.00; 116.40 with 19.40 added on top (97.00, in cents, no float\'s dust); a yearly 970.00: none of them a coupon')
  // T-122's third fix round: any code named on a payment is a coupon, whatever its totals (the re-check's case of a
  // 100% first month whose full-price renewal still names the used code). Until then a code that took nothing off was none.
  ok(show(coupon(97, 97, 0, 'promo_devUsed50')) === show({ price: 97, heldAgainst: 97, discounted: true }) && coupon(970, 970, 0, 'promo_devYear10').discounted === true
       && coupon(97, 97, 0, 'promo_devThirty').discounted === true && paymentCoupon({ total: 67.9, subtotal: 97, taxOnTop: 0, promoCodeId: 'promo_devThirty' }, { ownCode: true }).discounted === false,
     'a code that took nothing off (a used one-month code on a full-price renewal, or yearly) is a coupon too; only the student\'s own 30% is not, and the caller says so (ownCode)')
  ok(coupon(970, null, 0, 'promo_devYear10').discounted === true && coupon(970, 970, null, 'promo_devYear10').discounted === true
       && coupon(116.4, null, 19.4, 'promo_devEvolve').discounted === true,
     'a code named with a subtotal or a tax that does not read: a coupon, whatever the price (a missing figure never clears a named code)')
  ok(coupon(104.76, null, null).discounted === false && coupon(104.76, null, null).price === 104.76 && coupon(96, 96, null).discounted === true,
     'no code named and a tax that does not read: the total stands for the price (104.76 none, 96.00 a coupon by the rule of thumb)')
  ok(coupon(116.4, 97, 19.41).discounted === true && coupon(116.4, 97, 19.41).price === 96.99 && coupon(1, 1, 0).discounted === true,
     'a price a cent under 97.00 is a coupon, code or none; so is a $1 plan\'s payment (the rule of thumb\'s known limit)')
}
ok(show([...courseProductIds(`${COURSE}, ${ETFB_PRODUCT_ID},${TEAM_SEAT_PRODUCT_ID}`)]) === show([COURSE]) && courseProductIds('').size === 0 && courseProductIds(' , ').size === 0
     && show([...courseProductIds()]) === show([COURSE]),
   'the course is what WHOP_PRODUCT_ID names less ETfB and Apex (whop-products.ts); nothing when it names nothing')
ok(['no_api_key', 'network', 'http_other', 'rate_limited', 'time_budget', 'http_401_403'].every(isNoAnswer)
     && !['not_a_membership', 'not_found', 'http_4xx', 'bad_shape', 'no_plan_price'].some(isNoAnswer),
   'a read fails closed only when Whop does not answer (or refuses the key); a 404, another 4xx, no plan, no price move to the next step')
ok(lacksSourceColumn({ code: 'PGRST204', message: "Could not find the 'source' column of 'student_membership_discounts' in the schema cache" })
     && lacksSourceColumn({ code: '42703', message: 'column "source" of relation "student_membership_discounts" does not exist' })
     && !lacksSourceColumn({ code: '42703', message: 'column "sourcing" does not exist' }) && !lacksSourceColumn({ code: '42P01', message: 'relation "source" does not exist' })
     && !lacksSourceColumn(null),
   'a database without v113 is told by PostgREST\'s or Postgres\'s missing column error naming source, nothing else')
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
  ok(show(await one('mem_devFull', (p) => (p.includes('/memberships/') ? json(422, { error: 'no' }) : null))) === show({ ok: false, fail: 'http_4xx' }),
     'another 4xx for that one id (a 422): http_4xx, which T-122 asks the Whop user about, where a 5xx is no answer')
  // Since T-122's second fix round a membership whose renewal price or plan does not read hands back what it names
  // (`unpriced`), so a code on it is not lost.
  const fullUnpriced = { whopMembershipId: 'mem_devFull', promoCodeId: null, renewalPrice: 97 }
  ok(show(await one('mem_devFull', (p) => (p.includes('/plans/') ? json(400, { error: 'no' }) : null))) === show({ ok: false, fail: 'no_plan_price', unpriced: fullUnpriced }),
     'a plan Whop does not take (a 400): no_plan_price, as a plan it does not know')
  ok(show(await one('mem_devFull', (p) => (p.includes('/memberships/') ? json(200, 'not json at all') : null))) === show({ ok: false, fail: 'bad_shape' }), 'an answer that is not JSON: bad_shape')
  ok(show(await one('mem_devFull', (p) => (p.includes('/memberships/') ? json(200, [1, 2]) : null))) === show({ ok: false, fail: 'bad_shape' }), 'a list where one object belongs: bad_shape')
  ok(show(await one('mem_devOdd', null)) === show({ ok: false, fail: 'bad_shape', unpriced: { whopMembershipId: 'mem_devOdd', promoCodeId: null, renewalPrice: null } }),
     'a membership with no renewal price: bad_shape')
  ok(show(await one('mem_devGone', null)) === show({ ok: false, fail: 'no_plan_price', unpriced: { whopMembershipId: 'mem_devGone', promoCodeId: null, renewalPrice: 97 } }),
     'a plan Whop does not have: no_plan_price')
  ok(show(await one('mem_devFull', (p) => (p.includes('/plans/') ? json(200, { id: MONTHLY, renewal_price: null }) : null))) === show({ ok: false, fail: 'no_plan_price', unpriced: fullUnpriced }),
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
// T-122 (2026-10-21): the first live dry run of the cron could not read 46 of
// 290 students, 22 with a payment's id where the membership's belongs and 24
// memberships with no plan or no renewal price, and since the owner's review
// the request routes turn away every student whose check gives no answer.
// Every student now ends in a yes or a no: the membership on file, else the
// course membership found through the Whop user, else the latest real
// payment (under 97.00 is a discount, the owner's rule of thumb). Only Whop
// not answering (or the deployment not being able to ask) gives no answer.
console.log('\n=== T-122: every student a yes or a no (judgeStudentDiscount) ===')
const student = (whop_membership_id, whop_user_id) => ({ id: 's1', whop_membership_id, whop_user_id })
async function judge(onFile, user, answer = null, ctxOpts = {}) {
  resetWhop()
  whop.answer = answer
  return judgeStudentDiscount(student(onFile, user), newReadContext(ctxOpts.key ?? KEY, ctxOpts.startBy ?? null, ctxOpts.answerBy ?? null))
}
const paths = () => whop.log.map((r) => `${r.path}${r.path.endsWith('/memberships') || r.path.endsWith('/payments') ? r.query : ''}`)
{
  // The membership on file reads as before (source "membership"), and nothing else is asked.
  const onFile = await judge('mem_devEvolve', 'user_devEvolvePay')
  // Since T-122's fifth fix round the row carries THE RULE STAMP: the step with the rule's version, and the time of its write.
  ok(onFile.ok && onFile.source === 'membership' && onFile.row.discounted === true && onFile.row.source === R5('membership') && onFile.row.source_checked_at === onFile.row.checked_at
       && onFile.row.whop_membership_id === 'mem_devEvolve'
       && !whop.log.some((r) => r.path.startsWith('/api/v2/') || r.path === '/api/v1/payments'),
     'a membership on file that reads: THE RULE on it, source "membership", no user or payment read', show(onFile))

  // 22 of the 46: a payment's id where the membership's belongs.
  const viaUser = await judge('pay_devPayment', 'user_devEvolvePay')
  ok(viaUser.ok && viaUser.source === 'user' && viaUser.row.discounted === true && viaUser.row.promo_code === 'evolve10'
       && viaUser.row.whop_membership_id === 'mem_devEvolve' && viaUser.row.source === R5('user') && viaUser.row.renewal_price === 87.3 && viaUser.row.plan_renewal_price === 97,
     'a payment\'s id on file: the course membership found through the Whop user, evolve10 on it: discounted, the membership it judged stored', show(viaUser))
  // Since T-122's fourth fix round the user's list and the payments are read at the same time (one after the other
  // until then, so a Whop slower than 2 s an answer gave the request routes' 503), and the membership the list names
  // after them.
  ok(show(paths()) === show(['/api/v2/memberships?user_id=user_devEvolvePay&per=50&page=1', '/api/v1/payments?user_id=user_devEvolvePay&status=paid&first=100',
    '/api/v1/memberships/mem_devEvolve', '/api/v1/plans/plan_devMonthly97', '/api/v1/promo_codes/promo_devEvolve'])
       && whop.log[0].version === null && whop.log.slice(1).every((r) => r.version === PINNED) && whop.log.every((r) => r.auth === `Bearer ${KEY}`),
     'v2\'s list by the user (no version pin, as the login\'s lookup reads it) beside the payments pinned, then the membership, its plan and its code pinned', show(paths()))
  const full = await judge('pay_devPayment', 'user_devFullPay')
  ok(full.ok && full.source === 'user' && full.row.discounted === false && full.row.whop_membership_id === 'mem_devFull', 'a payment\'s id, a full-price course membership: no discount', show(full))
  const none = await judge(null, 'user_devEvolvePay')
  ok(none.ok && none.source === 'user' && none.row.discounted === true, 'no id on file at all: the same, through the Whop user', show(none))
  const gone = await judge('mem_devMissing', 'user_devGone')
  ok(gone.ok && gone.source === 'user' && gone.row.discounted === true && gone.row.whop_membership_id === 'mem_devEvolve2'
       && paths()[0] === '/api/v1/memberships/mem_devMissing' && paths()[1].startsWith('/api/v2/memberships?user_id=user_devGone'),
     'a membership Whop does not know (404): through the Whop user, whose course membership is on evolve10', show(gone))
  const refused = await judge('mem_devFull', 'user_devGone', (p) => (p === '/api/v1/memberships/mem_devFull' ? json(400, { error: 'no' }) : null))
  ok(refused.ok && refused.source === 'user' && refused.row.whop_membership_id === 'mem_devEvolve2', 'another 4xx for the id on file: through the Whop user too', show(refused))
  const order = await judge('pay_devPayment', 'user_devOrder')
  // Since T-122's fourth fix round no plan is read to put them in order (paid or free is each one's own renewal price),
  // and the canceled one would be read for a code after the three, had none been found.
  ok(order.ok && order.source === 'user' && order.row.whop_membership_id === 'mem_devEvolve' && order.row.discounted === true
       && show(paths()) === show(['/api/v2/memberships?user_id=user_devOrder&per=50&page=1', '/api/v1/payments?user_id=user_devOrder&status=paid&first=100',
         '/api/v1/memberships/mem_devEvolve', '/api/v1/plans/plan_devMonthly97', '/api/v1/promo_codes/promo_devEvolve']),
     'the order: of the course memberships that grant access (3), active before past_due, then the newest; another product\'s never; the first with a code answers and nothing after it is read, its plan read for its row', show(paths()))

  // 24 of the 46: no plan or no renewal price, no code named on the membership. The real payments decide: 87.30 is a
  // discount. Since T-122's second fix round every real payment is judged and the row names the membership of the
  // payment on a coupon (here mem_devOdd; it named the membership whose read gave no price until then).
  const price = await judge('mem_devNullPrice', 'user_devOdd')
  ok(price.ok && price.source === 'payment' && price.row.discounted === true && price.row.renewal_price === 87.3 && price.row.plan_renewal_price === 97
       && price.row.promo_code_id === 'promo_devEvolve' && price.row.promo_code === 'evolve10' && price.row.whop_membership_id === 'mem_devOdd' && price.row.source === R5('payment') && price.noRealPayment === false,
     'a null renewal price, the latest real payment 87.30 (on evolve10): discounted, the payment\'s total and the 97.00 stored, the code named, the payment\'s membership named', show(price))
  // Since T-122's third fix round the user's course memberships are read whatever the one on file said (a code on a
  // second membership is a coupon), so the list comes before the payments; until then it was not read here.
  ok(show(paths()) === show(['/api/v1/memberships/mem_devNullPrice', '/api/v2/memberships?user_id=user_devOdd&per=50&page=1', '/api/v1/payments?user_id=user_devOdd&status=paid&first=100', '/api/v1/promo_codes/promo_devEvolve'])
       && whop.log.filter((r) => r.path.startsWith('/api/v1/')).every((r) => r.version === PINNED) && whop.log[1].version === null,
     'the membership, the user\'s course memberships (v2, no pin), then the payments pinned, then the code\'s name', show(paths()))
  // Since the second fix round an 87.30 on evolve10 before the newest 97.00 is a coupon: the student came in on a code
  // (the newest payment alone said none until then).
  const ninetySeven = await judge('mem_devNullPrice', 'user_devOddFull')
  ok(ninetySeven.ok && ninetySeven.source === 'payment' && ninetySeven.row.discounted === true && ninetySeven.row.renewal_price === 87.3 && ninetySeven.row.promo_code === 'evolve10',
     'a null renewal price, the latest real payment 97.00 (87.30 on evolve10 before it): a discount, the 87.30 named (none until the second fix round)', show(ninetySeven))
  const noPlan = await judge('mem_devNoPlan', 'user_devOdd')
  ok(noPlan.ok && noPlan.source === 'payment' && noPlan.row.discounted === true, 'no plan id on the membership: the payment decides too', show(noPlan))
  const planGone = await judge('mem_devGone', 'user_devOddFull')
  ok(planGone.ok && planGone.source === 'payment' && planGone.row.discounted === true && planGone.row.renewal_price === 87.3,
     'a plan Whop does not know: the payments decide, and the 87.30 on evolve10 before the 97.00 is a discount (none until the second fix round)', show(planGone))
  const foundUnpriced = await judge('pay_devPayment', 'user_devNullPay')
  ok(foundUnpriced.ok && foundUnpriced.source === 'payment' && foundUnpriced.row.discounted === true && foundUnpriced.row.whop_membership_id === 'mem_devNullPrice',
     'a payment\'s id, and the course membership found through the user has no renewal price: the payment decides, that membership stored', show(foundUnpriced))
  const noCourse = await judge('pay_devPayment', 'user_devNoCourse')
  ok(noCourse.ok && noCourse.source === 'payment' && noCourse.row.discounted === true && noCourse.row.promo_code_id === null && noCourse.row.promo_code === null
       && noCourse.row.whop_membership_id === 'mem_devPaid' && noCourse.noRealPayment === false,
     'no course membership that grants access (another product\'s, an expired one), a real payment of 87.30 with no code: discounted, code not known, the payment\'s membership stored', show(noCourse))
  const nothing = await judge(null, 'user_devNothing')
  ok(nothing.ok && nothing.source === 'payment' && nothing.row.discounted === false && nothing.noRealPayment === true && nothing.row.renewal_price === null
       && nothing.row.plan_renewal_price === null && nothing.row.whop_membership_id === null,
     'no course membership and no real payment at all: no discount, and nothing to show for it', show(nothing))

  // The user's list cannot be used. Since T-122's fourth fix round a list in another shape or holding another user's
  // row is no answer, as the payments read has it (each read as no memberships until then, the payment deciding), and
  // a 404 is a fall-through the cron counts: the payment decides, never a guess from the list.
  const ignored = await judge('pay_devPayment', 'user_devNoCourse', (p) => (p === '/api/v2/memberships' ? json(200, { data: [v2('mem_devEvolve', 'user_devSomeoneElse')], pagination: { current_page: 1, total_page: 1 } }) : null))
  ok(show(ignored) === show({ ok: false, fail: 'filter_ignored' }), 'a list with another user\'s membership (Whop ignored the filter): no answer (filter_ignored; the payment decided until the fourth fix round)', show(ignored))
  const v2Gone = await judge('pay_devPayment', 'user_devNoCourse', (p) => (p === '/api/v2/memberships' ? json(404, {}) : null))
  const v2Odd = await judge('pay_devPayment', 'user_devNoCourse', (p) => (p === '/api/v2/memberships' ? json(200, { data: 'none' }) : null))
  ok(v2Gone.ok && v2Gone.source === 'payment' && v2Gone.userListUnusable === true && show(v2Odd) === show({ ok: false, fail: 'bad_page' }),
     'a 404 for the list: the payment decides, the student marked for the cron\'s count; a list in another shape: no answer (bad_page; the payment decided until the fourth fix round)', show([v2Gone, v2Odd]))
  // A user with more than 50 memberships: the second page is read.
  resetWhop()
  whop.byUser.set('user_devMany', [...Array.from({ length: 50 }, (_, i) => v2(`mem_devOld${i}`, 'user_devMany', { status: 'expired', valid: false })), v2('mem_devEvolve', 'user_devMany')])
  const many = await findCourseMemberships('user_devMany', new Set([COURSE]), newReadContext(KEY))
  ok(many.ok && show(many.membershipIds) === show(['mem_devEvolve']) && whop.log.length === 2 && whop.log[1].query.includes('page=2'),
     'a list over two pages: both read, the one that grants access found on the second (one found, so no plan is read to order them)', show(many))

  // No answer: only when Whop does not answer, or the deployment cannot ask.
  const down = await judge('pay_devPayment', 'user_devEvolvePay', () => 'throw')
  ok(show(down) === show({ ok: false, fail: 'network' }), 'Whop down while the user\'s list is read: no answer (network)', show(down))
  const v2Down = await judge('pay_devPayment', 'user_devEvolvePay', (p) => (p === '/api/v2/memberships' ? json(503, {}) : null))
  ok(show(v2Down) === show({ ok: false, fail: 'http_other' }), 'a 5xx for the user\'s list: no answer, never "no course membership"', show(v2Down))
  const v2Key = await judge(null, 'user_devEvolvePay', (p) => (p === '/api/v2/memberships' ? json(401, {}) : null))
  ok(show(v2Key) === show({ ok: false, fail: 'http_401_403' }), 'the key refused for the user\'s list: no answer', show(v2Key))
  const foundDown = await judge('pay_devPayment', 'user_devEvolvePay', (p) => (p === '/api/v1/memberships/mem_devEvolve' ? json(502, {}) : null))
  ok(show(foundDown) === show({ ok: false, fail: 'http_other' }), 'the membership found through the user cannot be read (a 502): no answer', show(foundDown))
  const payDown = await judge('mem_devNullPrice', 'user_devOdd', (p) => (p === '/api/v1/payments' ? json(500, {}) : null))
  ok(show(payDown) === show({ ok: false, fail: 'http_other' }), 'a 5xx for the payments: no answer, never "no payment"', show(payDown))
  let n429 = 0
  const t0 = Date.now()
  const payBusy = await judge('mem_devNullPrice', 'user_devOdd', (p) => (p === '/api/v1/payments' && ++n429 <= 3 ? json(429, 'Try again in 1 seconds.') : null))
  ok(show(payBusy) === show({ ok: false, fail: 'rate_limited' }) && n429 === 3 && Date.now() - t0 >= 2000, `a 429 for the payments three times (two waited out, ${Date.now() - t0} ms): no answer (rate_limited)`, show(payBusy))
  const payHung = await judge('mem_devNullPrice', 'user_devOdd', (p) => (p === '/api/v1/payments' ? 'hang' : null), { startBy: Date.now() + 5000, answerBy: Date.now() + 8000 })
  ok(show(payHung) === show({ ok: false, fail: 'time_budget' }), 'the payments never answered: given up at the answer limit (time_budget)', show(payHung))
  const payOther = await judge('mem_devNullPrice', 'user_devOdd', (p) => (p === '/api/v1/payments' ? json(200, { data: [pay('pay_devX', 'user_devSomeoneElse', '10.00', '2026-10-01T00:00:00.000Z')], page_info: { has_next_page: false } }) : null))
  ok(show(payOther) === show({ ok: false, fail: 'filter_ignored' }), 'a payment of another user (Whop ignored the filter): no answer, never another person\'s payment', show(payOther))
  const payShape = await judge('mem_devNullPrice', 'user_devOdd', (p) => (p === '/api/v1/payments' ? json(200, { data: [{ id: 'pay_devY', status: 'paid', amount_paid: 87.3 }], page_info: { has_next_page: false } }) : null))
  ok(show(payShape) === show({ ok: false, fail: 'bad_page' }), 'payments in another shape: no answer (bad_page), never "no payment"', show(payShape))
  const memDown = await judge('mem_devEvolve', 'user_devEvolvePay', (p) => (p.startsWith('/api/v1/memberships/') ? json(503, {}) : null))
  ok(show(memDown) === show({ ok: false, fail: 'http_other' }) && !whop.log.some((r) => r.path.startsWith('/api/v2/')),
     'the membership on file gets a 5xx: no answer, and the user is not asked instead (Whop is down, not the id)', show(memDown))
  const noKey = await judge('pay_devPayment', 'user_devEvolvePay', null, { key: '' })
  ok(show(noKey) === show({ ok: false, fail: 'no_api_key' }) && whop.log.length === 0, 'no key: no answer, no request')
  const noUser = await judge('pay_devPayment', null)
  ok(show(noUser) === show({ ok: false, fail: 'no_whop_user' }) && whop.log.length === 0, 'no Whop user on file (the column is NOT NULL, so never on production): no answer, no request')
  process.env.WHOP_PRODUCT_ID = ''
  const noProduct = await judge('pay_devPayment', 'user_devEvolvePay')
  const noProductOnFile = await judge('mem_devEvolve', 'user_devEvolvePay')
  const noProductReads = whop.log.length
  process.env.WHOP_PRODUCT_ID = COURSE
  // Since T-122's fifth fix round the membership on file is checked against the course's products too, so with none
  // named nothing is read (the membership on file still read, and its code answered, until then).
  ok(show(noProduct) === show({ ok: false, fail: 'no_course_product' }) && show(noProductOnFile) === show({ ok: false, fail: 'no_course_product' }) && noProductReads === 0,
     'WHOP_PRODUCT_ID naming no course product: no answer, before any read (the membership on file is the course\'s only by those products)', show([noProduct, noProductOnFile]))
}

// ════════════════════════════════════════════════════════════════════════════
// T-122's fix round (2026-10-21). An adversarial check on a stand-in Whop found
// two ways past the owner's rule ("they should not be able to apply for the
// code if they have a coupon already"). Step 3 read only "a total under
// 97.00", so a yearly member on a 10% code (873.00), an evolve10 member with
// tax added on top (104.76) and a payment's-id student whose list cannot be
// used, each with the code on the payment, read as none. Step 2 read only the
// first course membership in its order, so a newer free one hid an older paid
// one with a code; step 1 did too, as the sync puts the newest membership
// that grants access on file. The same cases run through both request routes
// and the cron below.
console.log('\n=== T-122\'s fix round: the code on the payment, and every course membership ===')
{
  const year = await judge('mem_devYear970Null', 'user_devYear970')
  ok(year.ok && year.source === 'payment' && year.row.discounted === true && year.row.renewal_price === 873 && year.row.plan_renewal_price === 970
       && year.row.promo_code_id === 'promo_devYear10' && year.row.whop_membership_id === 'mem_devYear970Null',
     'a $970 yearly member on a 10% code whose membership has no renewal price, the payment 873.00 naming the code: a coupon, 873.00 against its subtotal 970.00 stored (none until the fix round)', show(year))
  const taxed = await judge('mem_devTaxNull', 'user_devTaxed')
  ok(taxed.ok && taxed.source === 'payment' && taxed.row.discounted === true && taxed.row.renewal_price === 87.3 && taxed.row.plan_renewal_price === 97 && taxed.row.promo_code === 'evolve10',
     'evolve10 with 20% tax added on top, a total of 104.76: a coupon, its price after the code (87.30) against its subtotal (97.00) stored (none until the fix round)', show(taxed))
  // The list that cannot be used is a 404 here since T-122's fourth fix round: one holding someone else's membership
  // (this check's list until then) is no answer now, below.
  const ignoredList = await judge('pay_devPayment', 'user_devListGone')
  ok(ignoredList.ok && ignoredList.source === 'payment' && ignoredList.row.discounted === true && ignoredList.row.promo_code_id === 'promo_devYear10' && ignoredList.row.whop_membership_id === null
       && ignoredList.userListUnusable === true
       && show(paths()) === show(['/api/v2/memberships?user_id=user_devListGone&per=50&page=1', '/api/v1/payments?user_id=user_devListGone&status=paid&first=100', '/api/v1/promo_codes/promo_devYear10']),
     'a payment\'s id on file and a list that cannot be used (a 404), the latest payment a yearly 873.00 naming a code: a coupon (none until the fix round); the list, the payments, the code\'s name (which Whop does not give here)', show({ ignoredList, paths: paths() }))
  const someoneElse = await judge('pay_devPayment', 'user_devIgnored')
  ok(show(someoneElse) === show({ ok: false, fail: 'filter_ignored' }), 'the same with someone else\'s membership in the list: no answer since the fourth fix round', show(someoneElse))
  // The controls: no code named, so the rule of thumb alone, on the price before any tax added on top.
  for (const [why, user, price] of [
    ['a 97.00 payment naming no code', 'user_devCtl97', 97],
    ['a 116.40 payment (97.00 and 20% tax added on top) naming no code', 'user_devCtlTax', 97],
    ['a $970 yearly payment naming no code', 'user_devCtl970', 970],
    ['a 97.00 payment with the tax inside the price ("inclusive") naming no code', 'user_devCtlIncl', 97],
  ]) {
    const r = await judge('mem_devCtlNull', user)
    ok(r.ok && r.source === 'payment' && r.row.discounted === false && r.row.renewal_price === price && r.row.plan_renewal_price === 97,
       `${why}: no coupon, ${price.toFixed(2)} against 97.00 stored`, show(r.ok && r.row))
  }
  // A control until T-122's third fix round: a code named on a payment is a coupon whatever its totals, so a full-price
  // renewal still naming a used one-month code is one (the re-check's 100% first month, its renewal naming the code).
  const usedPay = await judge('mem_devCtlNull', 'user_devUsedPay')
  ok(usedPay.ok && usedPay.source === 'payment' && usedPay.row.discounted === true && usedPay.row.promo_code === 'welcome50' && usedPay.row.renewal_price === 97 && usedPay.row.plan_renewal_price === 97,
     'a 97.00 renewal naming a used one-month code that took nothing off: a coupon, 97.00 against its subtotal 97.00 stored (none until the third fix round)', show(usedPay.ok && usedPay.row))

  // Step 2 reads every course membership that grants access. evolve10 on the older paid one, a free one given later.
  const freeLater = await judge('pay_devPayment', 'user_devFreeLater')
  ok(freeLater.ok && freeLater.source === 'user' && freeLater.row.discounted === true && freeLater.row.whop_membership_id === 'mem_devEvolve3' && freeLater.row.promo_code === 'evolve10',
     'a payment\'s id on file, an evolve10 monthly membership and a newer free course membership: a coupon, the row naming the membership that carried the code (until the fix round the newer free one was read alone: none)', show(freeLater))
  // Since T-122's fourth fix round no plan is read to put them in order: the newer free one is read first, naming no
  // code, then evolve10's (its plan read for its row), and nothing after the code found; the payments beside the list.
  ok(show(paths()) === show(['/api/v2/memberships?user_id=user_devFreeLater&per=50&page=1', '/api/v1/payments?user_id=user_devFreeLater&status=paid&first=100',
    '/api/v1/memberships/mem_devFree', '/api/v1/memberships/mem_devEvolve3', '/api/v1/plans/plan_devMonthly97', '/api/v1/promo_codes/promo_devEvolve']),
     'no plan read to order them (the two plans were read first until the fourth fix round), and nothing read after the code found', show(paths()))
  // The same student with the free one on file: a plan that renews at 0 has no renewal to discount, so step 2 answers.
  const freeOnFile = await judge('mem_devFree', 'user_devFreeLater')
  ok(freeOnFile.ok && freeOnFile.source === 'user' && freeOnFile.row.discounted === true && freeOnFile.row.whop_membership_id === 'mem_devEvolve3'
       && paths()[0] === '/api/v1/memberships/mem_devFree' && paths()[1].startsWith('/api/v2/memberships?user_id=user_devFreeLater'),
     'the free membership on file (the sync puts the newest that grants access there), evolve10 on the older paid one: a coupon through the Whop user (the membership on file answered none until the fix round)', show(freeOnFile))
  // No code on any: the paid one answers, by its own renewal price (97.00) since T-122's fourth fix round, which reads
  // no plan for a membership naming no code, so the row holds no plan price (97.00 until then).
  const freeFull = await judge('pay_devPayment', 'user_devFreeFull')
  ok(freeFull.ok && freeFull.source === 'user' && freeFull.row.discounted === false && freeFull.row.whop_membership_id === 'mem_devFull' && freeFull.row.plan_renewal_price === null
       && freeFull.row.renewal_price === 97 && paths().filter((p) => p.startsWith('/api/v1/memberships/')).join() === '/api/v1/memberships/mem_devFree,/api/v1/memberships/mem_devFull'
       && !paths().some((p) => p.startsWith('/api/v1/plans/')),
     'a full-price monthly membership and a newer free one: no coupon, both read newest first and no plan, the row naming the paid one (paid before free, by the renewal price)', show(paths()))
  // Since T-122's third fix round the Whop user's course memberships are read for a code even then (a second
  // membership on a 100% code beside a full-price one on file); the one on file still answers with no coupon. Since its
  // fourth no plan is read for a membership naming no code, and the payments are read beside the list.
  const paidOnFile = await judge('mem_devFull', 'user_devFreeFull')
  ok(paidOnFile.ok && paidOnFile.source === 'membership' && paidOnFile.row.discounted === false && paidOnFile.row.whop_membership_id === 'mem_devFull'
       && show(paths()) === show(['/api/v1/memberships/mem_devFull', '/api/v2/memberships?user_id=user_devFreeFull&per=50&page=1',
         '/api/v1/payments?user_id=user_devFreeFull&status=paid&first=100', '/api/v1/memberships/mem_devFree']),
     'a paid plan on file with no code still answers with no coupon; the Whop user\'s other course membership is read for a code, the one on file not twice (it was not asked until the third fix round)', show(paths()))
  resetWhop()
  whop.byUser.set('user_devComp', [v2('mem_devFree', 'user_devComp', { plan: FREE, status: 'completed', valid: true })])
  const comp = await judgeStudentDiscount(student('mem_devFree', 'user_devComp'), newReadContext(KEY))
  ok(comp.ok && comp.source === 'user' && comp.row.discounted === false && comp.row.whop_membership_id === 'mem_devFree',
     'a free membership and nothing else: no coupon, answered by that membership through the Whop user', show(comp))
  resetWhop()
  whop.byUser.set('user_devPair', [v2('mem_devCtlNull', 'user_devPair', { created_at: 1_760_000_000 }), v2('mem_devFull', 'user_devPair', { created_at: 1_759_000_000 })])
  whop.payments.set('user_devPair', [pay('pay_devR1', 'user_devPair', '97.00', '2026-10-12T10:00:00.000Z')])
  const pair = await judgeStudentDiscount(student('pay_devPayment', 'user_devPair'), newReadContext(KEY))
  ok(pair.ok && pair.source === 'payment' && pair.row.discounted === false && pair.row.whop_membership_id === 'mem_devCtlNull',
     'one membership with no renewal price beside one at full price: neither carries a known discount, so the latest payment decides (97.00, none), the row naming the one without a price', show(pair))

  // Whop gives no answer for one of them: no answer, never "none" from the others.
  const secondDown = await judge('pay_devPayment', 'user_devFreeFull', (p) => (p === '/api/v1/memberships/mem_devFree' ? json(503, {}) : null))
  ok(show(secondDown) === show({ ok: false, fail: 'http_other' }), 'Whop down for the second of two memberships (the first at full price): no answer, never "none" from the first alone', show(secondDown))
  const t0 = Date.now()
  const secondHung = await judge('pay_devPayment', 'user_devFreeFull', (p) => (p === '/api/v1/memberships/mem_devFree' ? 'hang' : null), { startBy: Date.now() + 6000, answerBy: Date.now() + 8000 })
  ok(show(secondHung) === show({ ok: false, fail: 'time_budget' }) && Date.now() - t0 <= 8000,
     `the second never answers, on the request routes' limits: given up by 8 s (${Date.now() - t0} ms), no answer`, show(secondHung))
}
{
  // The payment read itself (first-payment.ts), on the coupon check's pace and limits. Since T-122's third fix round
  // (fetchCoursePayments, which replaced fetchRealCoursePayments) every course payment the list gives is kept, a $0
  // one and a refunded one too, each marked real or not: a code on any of them is a coupon.
  resetWhop()
  const pace = { nextAt: 0, requests: 0, retried429: 0 }
  const course = new Set([COURSE])
  const opts = { apiKey: KEY, pace, startBy: null, answerBy: null, productIds: course }
  const odd = await fetchCoursePayments('user_devOdd', opts)
  ok(odd.ok && show(odd.payments.map((x) => [x.paidAt.slice(0, 10), x.total, x.real])) === show([['2026-10-14', 0, false], ['2026-10-10', 50, false], ['2026-10-03', 87.3, true], ['2026-09-03', 97, true]])
       && odd.seen === 5 && odd.kept === 2 && pace.requests === 1,
     'every course payment, newest first by paid_at whatever order Whop gives: the $0 one and the refunded one kept as not real, another product\'s left out (5 seen, 4 kept, 2 of them real), on the caller\'s pace', show(odd))
  const coded = odd.ok ? odd.payments.find((x) => x.promoCodeId !== null) : null
  ok(coded && coded.total === 87.3 && coded.promoCodeId === 'promo_devEvolve' && coded.membershipId === 'mem_devOdd' && coded.subtotal === 97 && coded.taxOnTop === 0,
     'with its code, its membership, its subtotal (97.00, before the code) and nothing on top (tax_amount null), read from the pinned shape', show(coded))
  ok(odd.ok && odd.payments.every((x) => x.currency === 'usd' && x.billingReason === null && !('usdTotal' in x)),
     'the currency its total names (usd), no billing reason named on these, and no usd_total read since the third fix round', show(odd.ok && odd.payments.map((x) => [x.currency, x.billingReason])))
  ok(show(whop.log.map((x) => x.query)) === show(['?user_id=user_devOdd&status=paid&first=100']),
     'the read sends no include_free: the pinned list gives the $0 payments with the rest (Whop\'s changelog entry 2026-09-02-1), and a filter of the older list could be a 400 there', show(whop.log.map((x) => x.query)))
  whop.payments.set('user_devEurRead', [
    pay('pay_devEu1', 'user_devEurRead', '89.90', '2026-10-12T10:00:00.000Z', { currency: 'eur', total: { amount: '89.90', currency: 'eur' }, subtotal: { amount: '89.90', currency: 'eur' }, usd_total: money('97.00') }),
    pay('pay_devEu2', 'user_devEurRead', '89.90', '2026-10-13T10:00:00.000Z', { currency: null, total: { amount: '89.90', currency: 'EUR' }, usd_total: null, billing_reason: 'subscription_update' }),
  ])
  const eurRead = await fetchCoursePayments('user_devEurRead', opts)
  ok(eurRead.ok && show(eurRead.payments.map((x) => [x.currency, x.billingReason])) === show([['eur', 'subscription_update'], ['eur', null]]),
     'a payment\'s currency is its `currency`, else its total\'s own, lower case; its billing_reason as Whop names it', show(eurRead))
  const taxed = await fetchCoursePayments('user_devTaxed', opts)
  const incl = await fetchCoursePayments('user_devCtlIncl', opts)
  ok(taxed.ok && taxed.payments[0].total === 104.76 && taxed.payments[0].subtotal === 97 && taxed.payments[0].taxOnTop === 17.46 && taxed.payments[0].promoCodeId === 'promo_devEvolve'
       && incl.ok && incl.payments[0].total === 97 && incl.payments[0].taxOnTop === 0,
     'a tax added on top read as on top (17.46 of 104.76), one inside the price ("inclusive") as nothing on top', show([taxed.ok && taxed.payments[0], incl.ok && incl.payments[0]]))
  const noFields = pay('pay_devX1', 'user_devNoTaxField', '97.00', '2026-10-12T10:00:00.000Z', onCode('promo_devEvolve', '97.00'))
  delete noFields.subtotal
  delete noFields.tax_amount
  whop.payments.set('user_devNoTaxField', [noFields])
  const bare = await fetchCoursePayments('user_devNoTaxField', opts)
  ok(bare.ok && bare.payments[0].subtotal === null && bare.payments[0].taxOnTop === null && bare.payments[0].promoCodeId === 'promo_devEvolve',
     'a payment without subtotal and tax_amount (another shape): both not known (null), never 0', show(bare.ok && bare.payments[0]))
  whop.payments.set('user_devLegacyTax', [
    { id: 'pay_devL4', status: 'paid', paid_at: 1_759_700_000, total: 104.76, subtotal: 97, tax_amount: 17.46, tax_behavior: 'exclusive', refunded_amount: 0, user: { id: 'user_devLegacyTax' }, product: { id: COURSE }, promo_code: { id: 'promo_devL', code: 'legacy10' } },
  ])
  const legacyTax = await fetchCoursePayments('user_devLegacyTax', opts)
  ok(legacyTax.ok && legacyTax.payments[0].subtotal === 97 && legacyTax.payments[0].taxOnTop === 17.46 && legacyTax.payments[0].promoCodeId === 'promo_devL'
       && paymentCoupon(legacyTax.payments[0]).discounted === true,
     'the key\'s older shape (bare numbers, the code nested) reads the same subtotal and tax', show(legacyTax.ok && legacyTax.payments[0]))
  whop.payments.set('user_devLegacy', [
    { id: 'pay_devL1', status: 'paid', paid_at: 1_759_500_000, total: 87.3, refunded_amount: 0, user: { id: 'user_devLegacy' }, product: { id: COURSE }, membership: { id: 'mem_devL' }, promo_code: { id: 'promo_devL', code: 'legacy10' } },
    { id: 'pay_devL2', status: 'paid', paid_at: 1_759_600_000, total: 40, user: { id: 'user_devLegacy' } },
    { id: 'pay_devL3', status: 'pending', paid_at: null, total: 97, user: { id: 'user_devLegacy' }, product: { id: COURSE } },
  ])
  const legacy = await fetchCoursePayments('user_devLegacy', opts)
  ok(legacy.ok && legacy.payments[0].total === 40 && legacy.payments[0].productId === null && legacy.kept === 2
       && legacy.payments.length === 3 && legacy.payments[2].real === false && legacy.payments[2].paidAt === null,
     'the older shape reads too (a number, nested ids); a payment naming no product is kept, a pending one with no date kept last as not real (left out until the third fix round)', show(legacy))
  whop.payments.set('user_devLegacy', [whop.payments.get('user_devLegacy')[0]])
  const legacyOne = await fetchCoursePayments('user_devLegacy', opts)
  ok(legacyOne.ok && legacyOne.payments[0].promoCode === 'legacy10' && legacyOne.payments[0].promoCodeId === 'promo_devL' && legacyOne.payments[0].membershipId === 'mem_devL',
     'and its nested code carries its name', show(legacyOne))
  whop.payments.set('user_devPages', Array.from({ length: 150 }, (_, i) => pay(`pay_devPg${i}`, 'user_devPages', i === 120 ? '87.30' : '97.00', new RealDate(Date.parse('2026-01-01T00:00:00.000Z') + i * 86_400_000).toISOString())))
  const pages = await fetchCoursePayments('user_devPages', opts)
  ok(pages.ok && pages.seen === 150 && pages.payments[0].total === 97 && pages.payments[0].paidAt.startsWith('2026-05-30'), 'two pages, by the cursor: the newest of all 150', show(pages.ok && pages.payments[0]))
  whop.payments.set('user_devEndless', Array.from({ length: 1500 }, (_, i) => pay(`pay_devE${i}`, 'user_devEndless', '97.00', '2026-10-01T00:00:00.000Z')))
  const endless = await fetchCoursePayments('user_devEndless', opts)
  ok(show(endless) === show({ ok: false, fail: 'too_many_pages' }), 'more than 10 pages for one user: no answer (too_many_pages)', show(endless))
  const noKey = await fetchCoursePayments('user_devOdd', { ...opts, apiKey: '' })
  ok(show(noKey) === show({ ok: false, fail: 'no_api_key' }), 'no key: no answer')
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
  ok(show(live.value) === show({ discounted: true, code: 'evolve10', source: 'live', via: 'membership', liveFail: null, saved: true }), 'Whop answers: discounted, evolve10, live from the membership on file, and saved', show(live.value))
  ok(row && row.student_id === 's1' && row.whop_membership_id === 'mem_devEvolve' && row.promo_code === 'evolve10' && row.promo_code_id === 'promo_devEvolve'
       && row.renewal_price === 87.3 && row.plan_renewal_price === 97 && row.discounted === true && row.checked_at === new Date().toISOString()
       && row.source === R5('membership') && row.source_checked_at === row.checked_at,
     'and the answer is stored for the map and the admin page, with the rule\'s stamp: the step that answered with the rule\'s version, and the time of this write (v113)', show(row))
  ok(live.lines.length === 0, 'nothing is logged when Whop answers')
}
{
  resetWhop()
  // Every student has a Whop user on production (the column is NOT NULL), and since T-122's second fix round a
  // membership with no code is followed by the user's payments (none here). Since its third fix round a used code
  // still named on the membership is a coupon, so this case is a code taken off the membership (it was mem_devUsed).
  const db = new FakeDb({ students: [{ id: 's1', whop_membership_id: 'mem_devFull', whop_user_id: 'user_devFullPay' }], [MEMBERSHIP_DISCOUNTS_TABLE]: [storedEvolve('s1', 'mem_devFull')] })
  const r = await checkMembershipDiscount(fakeClient(db), 's1', { apiKey: KEY })
  ok(r.discounted === false && r.source === 'live' && db.rows(MEMBERSHIP_DISCOUNTS_TABLE)[0].discounted === false && db.rows(MEMBERSHIP_DISCOUNTS_TABLE).length === 1,
     'a code taken off the membership since the last read: Whop now says no, and the stored row is set right (one row per student)', show(r))
}
{
  resetWhop()
  whop.answer = () => json(500, {})
  const db = new FakeDb({ students: [{ id: 's1', whop_membership_id: 'mem_devEvolve' }], [MEMBERSHIP_DISCOUNTS_TABLE]: [storedEvolve('s1')] })
  const r = await quiet(() => checkMembershipDiscount(fakeClient(db), 's1', { apiKey: KEY }))
  ok(show(r.value) === show({ discounted: true, code: 'evolve10', source: 'stored', via: null, liveFail: 'http_other', saved: false }), 'Whop fails: the stored row for this membership decides (nothing saved)', show(r.value))
  ok(r.lines.length === 1 && r.lines[0].includes('http_other') && r.lines[0].includes('the stored row decides') && !r.lines[0].includes('mem_'),
     'one line for the log, with the kind and no Whop id', show(r.lines))
}
{
  resetWhop()
  whop.answer = () => json(500, {})
  const db = new FakeDb({ students: [{ id: 's1', whop_membership_id: 'mem_devFull' }], [MEMBERSHIP_DISCOUNTS_TABLE]: [storedEvolve('s1', 'mem_devOld')] })
  const r = await quiet(() => checkMembershipDiscount(fakeClient(db), 's1', { apiKey: KEY }))
  ok(r.value.discounted === false && r.value.source === 'none', 'a stored row from another membership says nothing about this one: no answer on file', show(r.value))
  const none = await quiet(() => checkMembershipDiscount(fakeClient(new FakeDb({ students: [{ id: 's1', whop_membership_id: 'mem_devFull' }] })), 's1', { apiKey: KEY }))
  ok(none.value.discounted === false && none.value.source === 'none' && none.lines.some((l) => l.includes('no answer is on file')),
     'neither Whop nor a stored row: no answer on file (the caller decides: the request routes refuse, and since T-122\'s fourth fix round the normal Approve too), and the log says so')
}
{
  resetWhop()
  const db = new FakeDb({ students: [{ id: 's1', whop_membership_id: 'mem_devEvolve' }], [MEMBERSHIP_DISCOUNTS_TABLE]: [storedEvolve('s1')] })
  const r = await quiet(() => checkMembershipDiscount(fakeClient(db), 's1', { apiKey: null }))
  ok(r.value.source === 'stored' && r.value.discounted === true && r.value.liveFail === 'no_api_key' && whop.log.length === 0 && r.lines.length === 0,
     'no key on the deployment: no request, the stored row decides, nothing logged', show(r.value))
  // Until T-122 no membership on file meant no request and no answer: Whop is asked through the Whop user now.
  const noMembership = new FakeDb({ students: [{ id: 's1', whop_membership_id: null, whop_user_id: 'user_devFullPay' }], [MEMBERSHIP_DISCOUNTS_TABLE]: [storedEvolve('s1')] })
  const r2 = await quiet(() => checkMembershipDiscount(fakeClient(noMembership), 's1', { apiKey: KEY }))
  const row2 = noMembership.rows(MEMBERSHIP_DISCOUNTS_TABLE)[0]
  ok(show(r2.value) === show({ discounted: false, code: null, source: 'live', via: 'user', liveFail: null, saved: true })
       && row2.whop_membership_id === 'mem_devFull' && row2.source === R5('user') && row2.discounted === false && r2.lines.length === 0,
     'no membership on file: the course membership found through the Whop user answers (full price), and its row replaces the old one', show({ answer: r2.value, row: row2 }))
}
{
  // T-122 through checkMembershipDiscount: a payment's id, a null renewal price, Whop down at each step.
  resetWhop()
  const db = new FakeDb({ students: [{ id: 's1', whop_membership_id: 'pay_devPayment', whop_user_id: 'user_devEvolvePay' }] })
  const r = await quiet(() => checkMembershipDiscount(fakeClient(db), 's1', { apiKey: KEY }))
  ok(show(r.value) === show({ discounted: true, code: 'evolve10', source: 'live', via: 'user', liveFail: null, saved: true })
       && db.rows(MEMBERSHIP_DISCOUNTS_TABLE)[0].whop_membership_id === 'mem_devEvolve' && r.lines.length === 0,
     'a payment\'s id on file: through the Whop user, evolve10, stored for the membership it judged', show(r.value))
  resetWhop()
  const odd = new FakeDb({ students: [{ id: 's1', whop_membership_id: 'mem_devNullPrice', whop_user_id: 'user_devOdd' }] })
  const r3 = await quiet(() => checkMembershipDiscount(fakeClient(odd), 's1', { apiKey: KEY }))
  const row3 = odd.rows(MEMBERSHIP_DISCOUNTS_TABLE)[0]
  ok(show(r3.value) === show({ discounted: true, code: 'evolve10', source: 'live', via: 'payment', liveFail: null, saved: true })
       && row3.source === R5('payment') && row3.renewal_price === 87.3 && row3.plan_renewal_price === 97 && row3.whop_membership_id === 'mem_devOdd',
     'a null renewal price: the latest real payment (87.30) answers, stored with source payment for the payment\'s membership (since the second fix round)', show(row3))
  // Whop down while the user is asked, with a row stored through the user before: the stored row decides (the id on file names no membership).
  resetWhop()
  whop.answer = () => 'throw'
  const stale = new FakeDb({ students: [{ id: 's1', whop_membership_id: 'pay_devPayment', whop_user_id: 'user_devEvolvePay' }], [MEMBERSHIP_DISCOUNTS_TABLE]: [{ ...storedEvolve('s1', 'mem_devEvolve'), source: 'user' }] })
  const r4 = await quiet(() => checkMembershipDiscount(fakeClient(stale), 's1', { apiKey: KEY }))
  ok(show(r4.value) === show({ discounted: true, code: 'evolve10', source: 'stored', via: null, liveFail: 'network', saved: false })
       && r4.lines.some((l) => l.includes('Whop gave no answer (network), so the stored row decides')),
     'Whop down, a payment\'s id on file and a row stored through the user: that row decides', show(r4.value))
  resetWhop()
  whop.answer = () => 'throw'
  const empty = new FakeDb({ students: [{ id: 's1', whop_membership_id: 'pay_devPayment', whop_user_id: 'user_devEvolvePay' }] })
  const r5 = await quiet(() => checkMembershipDiscount(fakeClient(empty), 's1', { apiKey: KEY }))
  ok(r5.value.source === 'none' && r5.value.liveFail === 'network' && r5.lines.some((l) => l.includes('Whop gave no answer (network), so no answer is on file')) && !r5.lines.some((l) => /pay_|mem_|user_/.test(l)),
     'Whop down and nothing stored: no answer on file, and the log line names no Whop id', show(r5.lines))
  resetWhop()
  const noUser = new FakeDb({ students: [{ id: 's1', whop_membership_id: 'pay_devPayment', whop_user_id: null }] })
  const r6 = await quiet(() => checkMembershipDiscount(fakeClient(noUser), 's1', { apiKey: KEY }))
  ok(r6.value.source === 'none' && r6.value.liveFail === 'no_whop_user' && whop.log.length === 0 && r6.lines.some((l) => l.includes('Whop could not be asked (no_whop_user), so no answer is on file')),
     'a student with no Whop user (never on production: the column is NOT NULL): Whop could not be asked, and the log says so', show(r6.value))
}
{
  // A database without v113: the row carrying source is refused, written again without it, and the answer is saved.
  resetWhop()
  const db = new FakeDb({ students: [{ id: 's1', whop_membership_id: 'mem_devEvolve' }] })
  db.failWhen = (q) => (q.table === MEMBERSHIP_DISCOUNTS_TABLE && q.op === 'upsert' && [].concat(q.values).some((v) => 'source' in v)
    ? { code: 'PGRST204', message: "Could not find the 'source' column of 'student_membership_discounts' in the schema cache" } : null)
  const r = await quiet(() => checkMembershipDiscount(fakeClient(db), 's1', { apiKey: KEY }))
  const upserts = db.calls(MEMBERSHIP_DISCOUNTS_TABLE, 'upsert')
  ok(r.value.source === 'live' && r.value.saved === true && upserts.length === 2 && 'source' in upserts[0].values[0] && !('source' in upserts[1].values[0])
       && db.rows(MEMBERSHIP_DISCOUNTS_TABLE).length === 1 && !('source' in db.rows(MEMBERSHIP_DISCOUNTS_TABLE)[0]) && r.lines.length === 0,
     'a database without v113: the row is refused with source, written again without it, saved, nothing logged', show(upserts.map((u) => Object.keys(u.values[0]))))
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
/** A student ready to apply on the new course: both videos up to the gate watched, 2 days after a first payment. `user` is their Whop user. */
function readyDb(membership, more = {}, user = 'user_devFullPay', id = 's1') {
  setCatalog({ v2: true, lessonsTable: 'lessons_next' })
  const db = new FakeDb({
    students: [{ id, supabase_user_id: 'auth-1', first_paid_at: PAID, joined_at: PAID, whop_membership_id: membership, whop_user_id: user }],
    lessons_next: [
      { id: 'a1l01', type: 'watch', sort_order: 1, duration_seconds: 300 },
      { id: 'a1l02', type: 'watch', sort_order: 2, duration_seconds: 300, is_gate: true },
    ],
    lesson_videos: [{ lesson_id: 'a1l01', created_at: '2026-10-01T00:00:00.000Z' }, { lesson_id: 'a1l02', created_at: '2026-10-01T00:00:00.000Z' }],
    student_lesson_completions: [
      { student_id: id, lesson_id: 'a1l01', completed_at: PAID },
      { student_id: id, lesson_id: 'a1l02', completed_at: PAID },
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

  // T-122's third fix round: a code named on the membership is a coupon whatever the renewal (the request went in until then).
  resetWhop()
  db = readyDb('mem_devUsed')
  r = await quiet(() => post(route, path, body))
  ok(r.value.status === 400 && r.value.body.error === LINE && db.rows('discount_requests').length === 0 && db.rows(MEMBERSHIP_DISCOUNTS_TABLE)[0]?.promo_code === 'welcome50',
     'a used one-month code still named on the membership (renews at full price): 400 with the line, nothing written', show(r.value))
  resetWhop()
  db = readyDb('mem_devFull')
  r = await quiet(() => post(route, path, body))
  ok(r.value.status === 200 && db.rows('discount_requests').length === 1, 'no code on the membership and no payment on one: the request goes in', show(r.value))

  resetWhop()
  whop.answer = () => json(503, {})
  db = readyDb('mem_devEvolve', { [MEMBERSHIP_DISCOUNTS_TABLE]: [storedEvolve('s1')] })
  r = await quiet(() => post(route, path, body))
  ok(r.value.status === 400 && r.value.body.error === LINE && db.rows('discount_requests').length === 0,
     'Whop down, the stored row says discounted: refused with the same line', show(r.value))

  // The owner's review (2026-10-21): a check that cannot run writes nothing. Whop gave no answer and nothing is
  // stored for the membership: the student reads the exact sentence, 503, and nothing is written (it went in before).
  resetWhop()
  whop.answer = () => 'throw'
  db = readyDb('mem_devEvolve')
  r = await quiet(() => post(route, path, body))
  ok(r.value.status === 503 && r.value.body.error === "We couldn't check your membership just now. Try again in a minute." && r.value.body.state === 'read-failed'
       && db.rows('discount_requests').length === 0 && db.calls('submit_discount_with_feedback', 'rpc').length === 0,
     'Whop down and nothing stored: refused, 503, "We couldn\'t check your membership just now. Try again in a minute.", nothing written (it went in before the owner\'s review)', show(r.value))
  ok(r.lines.some((l) => l.includes('nothing written, the coupon check could not run (network) and nothing is stored')) && !r.lines.some((l) => /mem_dev|@example/.test(l)),
     'the server log says why, with no name, email or Whop id', show(r.lines))

  // T-122: the students the first dry run could not read now get a yes or a no. Until then each of these was
  // the 503 above, for good: the request routes refuse every check that gives no answer.
  const LINE_503 = "We couldn't check your membership just now. Try again in a minute."
  for (const [why, membership, user, status, source] of [
    ['a payment\'s id on file, evolve10 on the course membership found through the Whop user', 'pay_devNotAMembership', 'user_devEvolvePay', 400, 'user'],
    ['no Whop membership on file, evolve10 on the one found through the Whop user', null, 'user_devEvolvePay', 400, 'user'],
    ['a payment\'s id on file, a full-price course membership through the Whop user', 'pay_devNotAMembership', 'user_devFullPay', 200, 'user'],
    ['a membership Whop does not know, evolve10 on the one found through the Whop user', 'mem_devMissing', 'user_devGone', 400, 'user'],
    ['a null renewal price, the latest real payment 87.30', 'mem_devNullPrice', 'user_devOdd', 400, 'payment'],
    // Since T-122's second fix round every real payment is judged: the 87.30 on evolve10 before the newest 97.00 refuses (it went in until then).
    ['a null renewal price, the latest real payment 97.00 and an 87.30 on evolve10 before it', 'mem_devNullPrice', 'user_devOddFull', 400, 'payment'],
    ['no course membership through the Whop user, a real payment of 87.30', 'pay_devNotAMembership', 'user_devNoCourse', 400, 'payment'],
    ['no course membership and no real payment', 'pay_devNotAMembership', 'user_devNothing', 200, 'payment'],
  ]) {
    resetWhop()
    db = readyDb(membership, {}, user)
    r = await quiet(() => post(route, path, body))
    const stored = db.rows(MEMBERSHIP_DISCOUNTS_TABLE)[0]
    const wrote = db.rows('discount_requests').length
    ok(r.value.status === status && (status === 400 ? r.value.body.error === LINE && wrote === 0 : wrote === 1) && stored?.source === R5(source) && stored?.discounted === (status === 400),
       `${why}: ${status === 400 ? '400, the student\'s line, nothing written' : '200, the request goes in'} (source ${source}, stored)`, show({ status: r.value.status, body: r.value.body, source: stored?.source }))
  }
  // Whop down at the steps T-122 added: still the 503 and nothing written.
  for (const [why, membership, user, answer] of [
    ['a payment\'s id on file, Whop down while the user is asked', 'pay_devNotAMembership', 'user_devEvolvePay', (p) => (p === '/api/v2/memberships' ? json(503, {}) : null)],
    ['a null renewal price, Whop down while the payments are read', 'mem_devNullPrice', 'user_devOdd', (p) => (p === '/api/v1/payments' ? 'throw' : null)],
    ['a null renewal price, the payments rate limited three times', 'mem_devNullPrice', 'user_devOdd', (p) => (p === '/api/v1/payments' ? json(429, 'Try again in 1 seconds.') : null)],
  ]) {
    resetWhop()
    whop.answer = answer
    db = readyDb(membership, {}, user)
    r = await quiet(() => post(route, path, body))
    ok(r.value.status === 503 && r.value.body.error === LINE_503 && r.value.body.state === 'read-failed' && db.rows('discount_requests').length === 0 && db.rows(MEMBERSHIP_DISCOUNTS_TABLE).length === 0,
       `${why}: 503, "${LINE_503}", nothing written or stored`, show(r.value))
  }
  // T-122's fix round: the adversarial check's cases refused, the controls let in. Until the fix round the first four
  // went in (each read as no coupon) and the fifth too (the free membership on file answered).
  for (const [why, membership, user, status, judged] of [
    ['a $970 yearly member on a 10% code with no renewal price, the payment 873.00 naming the code', 'mem_devYear970Null', 'user_devYear970', 400, 'mem_devYear970Null'],
    ['evolve10 with 20% tax added on top (104.76) and no renewal price', 'mem_devTaxNull', 'user_devTaxed', 400, 'mem_devTaxNull'],
    // The list that cannot be used is a 404 since T-122's fourth fix round (one holding another user's row is the 503 now).
    ['a payment\'s id on file and a list that cannot be used (a 404), the latest payment a yearly 873.00 naming a code', 'pay_devNotAMembership', 'user_devListGone', 400, null],
    ['a payment\'s id on file, evolve10 on a monthly membership and a newer free one', 'pay_devNotAMembership', 'user_devFreeLater', 400, 'mem_devEvolve3'],
    ['the newer free membership on file, evolve10 on the older paid one', 'mem_devFree', 'user_devFreeLater', 400, 'mem_devEvolve3'],
    ['control: a 97.00 payment naming no code', 'mem_devCtlNull', 'user_devCtl97', 200, 'mem_devCtlNull'],
    ['control: a 116.40 payment (97.00 and 20% tax added on top) naming no code', 'mem_devCtlNull', 'user_devCtlTax', 200, 'mem_devCtlNull'],
    ['control: a $970 yearly payment naming no code', 'mem_devCtlNull', 'user_devCtl970', 200, 'mem_devCtlNull'],
    ['control: a full-price monthly membership and a newer free one', 'pay_devNotAMembership', 'user_devFreeFull', 200, 'mem_devFull'],
  ]) {
    resetWhop()
    db = readyDb(membership, {}, user)
    r = await quiet(() => post(route, path, body))
    const stored = db.rows(MEMBERSHIP_DISCOUNTS_TABLE)[0]
    const wrote = db.rows('discount_requests').length
    ok(r.value.status === status && (status === 400 ? r.value.body.error === LINE && r.value.body.state === 'not-eligible' && wrote === 0 : wrote === 1)
         && stored?.discounted === (status === 400) && stored?.whop_membership_id === judged,
       `${why}: ${status === 400 ? '400, the student\'s line, nothing written' : '200, the request goes in'} (the row stored for ${judged ?? 'no membership'})`,
       show({ status: r.value.status, body: r.value.body, stored }))
  }
  // Two memberships, and Whop never answers for the second: given up at the routes' 8 s, the 503, nothing written.
  resetWhop()
  whop.answer = (p) => (p === '/api/v1/memberships/mem_devFree' ? 'hang' : null)
  db = readyDb('pay_devNotAMembership', {}, 'user_devFreeFull')
  const hangFrom = Date.now()
  r = await quiet(() => post(route, path, body))
  ok(r.value.status === 503 && r.value.body.error === LINE_503 && db.rows('discount_requests').length === 0 && Date.now() - hangFrom <= 8000,
     `two course memberships through the Whop user, the second never answered: 503 after ${Date.now() - hangFrom} ms (the 8 s limit kept), nothing written, never "none" from the first alone`, show(r.value))
  // Whop down, a payment's id on file, and the cron's row found through the user: that row decides (it counts with no membership id on file).
  resetWhop()
  whop.answer = () => 'throw'
  db = readyDb('pay_devNotAMembership', { [MEMBERSHIP_DISCOUNTS_TABLE]: [{ ...storedEvolve('s1', 'mem_devEvolve'), source: 'user' }] }, 'user_devEvolvePay')
  r = await quiet(() => post(route, path, body))
  ok(r.value.status === 400 && r.value.body.error === LINE && db.rows('discount_requests').length === 0,
     'Whop down, a payment\'s id on file, a row stored through the Whop user saying evolve10: refused with the line, not the 503', show(r.value))
  // T-122's third fix round: a stored "no coupon" answers only when this rule wrote it, its source set (v113). Until
  // then any stored "no discount" let the request in, the rows production's cron wrote by the rule before too. Since
  // its fifth the source carries the rule's version and source_checked_at its checked_at (stampedBy).
  const noCoupon = { ...storedEvolve('s1'), promo_code_id: null, promo_code: null, renewal_price: 97, discounted: false }
  resetWhop()
  whop.answer = () => 'throw'
  db = readyDb('mem_devEvolve', { [MEMBERSHIP_DISCOUNTS_TABLE]: [stampedBy(noCoupon, 'membership')] })
  r = await quiet(() => post(route, path, body))
  ok(r.value.status === 200 && db.rows('discount_requests').length === 1,
     'Whop down, the stored row for this membership says no coupon and holds this rule\'s stamp: the request goes in on the stored answer', show(r.value))
  resetWhop()
  whop.answer = () => 'throw'
  db = readyDb('mem_devEvolve', { [MEMBERSHIP_DISCOUNTS_TABLE]: [noCoupon] })
  r = await quiet(() => post(route, path, body))
  ok(r.value.status === 503 && r.value.body.error === LINE_503 && db.rows('discount_requests').length === 0
       && r.lines.some((l) => l.includes('so no answer is on file (the stored row says no coupon and holds no source, so this rule did not write it)')),
     'Whop down, the same row with no source (the rule before wrote it): 503, nothing written, and the log says why (it went in until the third fix round)', show({ value: r.value, lines: r.lines }))

  resetWhop()
  db = readyDb('mem_devEvolve', { student_lesson_completions: [] })
  r = await quiet(() => post(route, path, body))
  ok(r.value.status === 400 && r.value.body.state === 'locked' && whop.log.length === 0,
     'a student who is not ready: the rule refuses first, and Whop is not asked', show(r.value))
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== The approve route: Whop now; Approve anyway on the coupon\'s row passes it (the owner\'s review) ===')
function approveDb(membership, more = {}) {
  const db = readyDb(membership, {
    discount_requests: [{ id: 'r1', student_id: 's1', status: 'pending', created_at: new Date(Date.parse(NOW) - 3_600_000).toISOString() }],
    admin_config: [{ key: 'curriculum_reset_at', value: '2026-10-19T14:33:00.000Z' }],
    ...more,
  })
  return db
}
async function approve(override = false, overrideCoupon = false) {
  const res = await approveRoute(new Request('http://app/api/discounts/approve', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: 'r1', override, overrideCoupon }),
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
       `${override ? 'Approve anyway past the rule alone' : 'Approve'}: evolve10 on the membership, 400 with the code named and code "has-discount"`, show(r.value))
    ok(promoCodes.length === made && db.rows('discount_requests')[0].status === 'pending', 'no Whop code is made, the request stays pending')
  }
  // The owner's review (2026-10-21): a founder or an admin approves past any check. Approve anyway on the coupon's row
  // sends overrideCoupon with override (a founder here: the stand-in's login), and the code is made.
  {
    resetWhop()
    const db = approveDb('mem_devEvolve', { student_lesson_completions: [] })
    const made = promoCodes.length
    const r = await quiet(() => approve(true, true))
    ok(r.value.status === 200 && promoCodes.length === made + 1 && db.rows('discount_requests')[0].status === 'approved' && whop.log.length === 0,
       'Approve anyway on the coupon\'s row (override and overrideCoupon): approved and the code made past evolve10 and the rule (no video watched), Whop not asked', show(r.value.body))
    ok(r.lines.some((l) => l.includes('OVERRIDE') && l.includes('Eligibility gates skipped.') && l.includes('The coupon check skipped.')),
       'the log line says both checks were skipped, and who skipped them', show(r.lines))
    resetWhop()
    const db2 = approveDb('mem_devEvolve')
    const r2 = await quiet(() => approve(false, true))
    ok(r2.value.status === 200 && db2.rows('discount_requests')[0].status === 'approved' && whop.log.length === 0,
       'overrideCoupon alone, the rule saying yes: approved, Whop not asked', show(r2.value.body))
    resetWhop()
    const db3 = approveDb('mem_devFull', { student_lesson_completions: [] })
    const r3 = await quiet(() => approve(false, true))
    ok(r3.value.status === 400 && r3.value.body.code === 'rule' && db3.rows('discount_requests')[0].status === 'pending',
       'overrideCoupon alone, the rule saying no: refused with code "rule", nothing approved', show(r3.value))
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
     'Whop down, the stored row says discounted with no name: refused, naming the code\'s id (with override, past the rule alone)', show(r.value.body))
  // T-122's fourth fix round: Whop down and nothing stored, the normal Approve is refused in the team's words with code
  // "rule" (the approval went on until then, a code made for a student who might hold a coupon); Approve anyway, a
  // founder's (the stand-in's login), still goes on.
  resetWhop()
  whop.answer = () => 'throw'
  db = approveDb('mem_devEvolve')
  made = promoCodes.length
  r = await quiet(() => approve(false))
  ok(r.value.status === 503 && r.value.body.code === 'rule' && r.value.body.error === 'Whop gave no answer to the coupon check, so nothing was approved. Try again in a minute.'
       && promoCodes.length === made && db.rows('discount_requests')[0].status === 'pending',
     'Whop down, nothing stored: the normal Approve refused, 503 with code "rule" and a plain sentence, no Whop code made (it went on until the fourth fix round)', show(r.value.body))
  resetWhop()
  whop.answer = () => 'throw'
  db = approveDb('mem_devEvolve')
  made = promoCodes.length
  r = await quiet(() => approve(true))
  ok(r.value.status === 200 && promoCodes.length === made + 1 && db.rows('discount_requests')[0].status === 'approved'
       && r.lines.some((l) => l.includes('OVERRIDE') && l.includes('The coupon check gave no answer.')),
     'the same with Approve anyway (override): approved, the code made, and the log line says the coupon check gave no answer', show({ body: r.value.body, lines: r.lines }))
  // T-122: the approve route's check is the same one, so a payment's id or a null renewal price no longer lets a code through unasked.
  resetWhop()
  db = readyDb('pay_devNotAMembership', {
    discount_requests: [{ id: 'r1', student_id: 's1', status: 'pending', created_at: new Date(Date.parse(NOW) - 3_600_000).toISOString() }],
    admin_config: [{ key: 'curriculum_reset_at', value: '2026-10-19T14:33:00.000Z' }],
  }, 'user_devEvolvePay')
  made = promoCodes.length
  r = await quiet(() => approve(false))
  ok(r.value.status === 400 && r.value.body.code === 'has-discount' && r.value.body.error === 'This student already has a discount on their membership (evolve10).'
       && promoCodes.length === made && db.rows('discount_requests')[0].status === 'pending',
     'a payment\'s id on file, evolve10 through the Whop user: refused with the code named, no Whop code made (it went through unasked before T-122)', show(r.value))
  resetWhop()
  db = readyDb('mem_devNullPrice', {
    discount_requests: [{ id: 'r1', student_id: 's1', status: 'pending', created_at: new Date(Date.parse(NOW) - 3_600_000).toISOString() }],
    admin_config: [{ key: 'curriculum_reset_at', value: '2026-10-19T14:33:00.000Z' }],
  }, 'user_devOddFull')
  made = promoCodes.length
  r = await quiet(() => approve(false))
  // T-122's second fix round: the 87.30 on evolve10 before the newest 97.00 is a coupon (approved until then).
  ok(r.value.status === 400 && r.value.body.code === 'has-discount' && r.value.body.error === 'This student already has a discount on their membership (evolve10).'
       && promoCodes.length === made && db.rows('discount_requests')[0].status === 'pending',
     'a null renewal price, a latest real payment of 97.00 and an 87.30 on evolve10 before it: refused with the code named, no Whop code made', show(r.value))
  resetWhop()
  db = readyDb('mem_devNullPrice', {
    discount_requests: [{ id: 'r1', student_id: 's1', status: 'pending', created_at: new Date(Date.parse(NOW) - 3_600_000).toISOString() }],
    admin_config: [{ key: 'curriculum_reset_at', value: '2026-10-19T14:33:00.000Z' }],
  }, 'user_devCtl97')
  made = promoCodes.length
  r = await quiet(() => approve(false))
  ok(r.value.status === 200 && promoCodes.length === made + 1 && db.rows('discount_requests')[0].status === 'approved',
     'a null renewal price and a single real payment of 97.00 naming no code: approved, the code made', show(r.value.body))
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
function checkDb(membership, more = {}, user = 'user_devFullPay') {
  const db = readyDb(membership, {
    discount_requests: [{ id: 'r1', student_id: 's1', status: 'pending', created_at: new Date(Date.parse(NOW) - 3_600_000).toISOString() }],
    [MEMBERSHIP_DISCOUNTS_TABLE]: [{ ...storedEvolve('s1', membership), checked_at: '2026-10-20T08:40:00.000Z' }],
    team_members: [{ id: 'tm-csm', email: 'csm@example.com', full_name: 'Robin Hale', role: 'csm' }],
    ...more,
  }, user)
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
  const db = checkDb('mem_devFull')
  const none = await quiet(() => checkAgain({ requestId: 'r1' }, null))
  const student = await quiet(() => checkAgain({ requestId: 'r1' }, 'tok-1'))
  ok(none.value.status === 401 && student.value.status === 403 && whop.log.length === 0 && db.rows(MEMBERSHIP_DISCOUNTS_TABLE)[0].discounted === true,
     'no token 401, a student\'s token 403 (the real team check): Whop is not asked, the stored row stays', show([none.value.status, student.value.status]))

  // evolve10 was stored on 20 October; since then the code came off the membership, which names none now. (Until
  // T-122's third fix round this case was a used one-month code still named on the membership: a coupon since, below.)
  const before = await listedRow(db)
  ok(before?.verdict?.reason === 'has-discount' && before.coupon?.discounted === true && before.couponCheck === 'stored',
     'before: the stored row says evolve10 is on the renewal, so the row is the coupon\'s (Reject alone, and Check Whop again, on the page)', show(before?.verdict))
  const made = promoCodes.length
  const r = await quiet(() => checkAgain())
  const row = db.rows(MEMBERSHIP_DISCOUNTS_TABLE)[0]
  ok(r.value.status === 200 && show(r.value.body) === show({ discounted: false, code: null }),
     'a csm checks again: 200, Whop shows no code now, and nothing else in the answer', show(r.value))
  ok(row.discounted === false && row.whop_membership_id === 'mem_devFull' && row.source === R5('membership') && row.checked_at === new Date().toISOString() && db.rows(MEMBERSHIP_DISCOUNTS_TABLE).length === 1,
     'the stored row is Whop\'s answer, read now, with its source (still one row per student)', show(row))
  const after = await listedRow(db)
  ok(after?.verdict?.ok === true && after.verdict.reason === null && after.coupon?.discounted === false,
     'the list read after it: the coupon is gone, the 30% rule decides and says yes, so the row shows Approve again', show(after?.verdict))
  ok(promoCodes.length === made && db.rows('discount_requests')[0].status === 'pending' && db.calls('discount_requests', 'update').length === 0,
     'no Whop code is made and the request is not changed')
  // Since T-122's second fix round a membership with no code is followed by the student's payments, and since its
  // third by the student's course memberships first (v2, which takes no pin). Since its fourth the plan of a
  // membership naming no code is not read, and the course memberships and the payments are read at the same time.
  ok(show(whop.log.map((x) => x.path)) === show(['/api/v1/memberships/mem_devFull', '/api/v2/memberships', '/api/v1/payments'])
       && whop.log.filter((x) => x.path.startsWith('/api/v1/')).every((x) => x.version === PINNED),
     'one live read: the membership pinned, then the student\'s course memberships beside the student\'s payments pinned', whop.log.map((x) => x.path).join())
  // A used one-month code still named on the membership: a coupon since the third fix round (none until then).
  resetWhop()
  const used = checkDb('mem_devUsed')
  const r2 = await quiet(() => checkAgain())
  ok(r2.value.status === 200 && show(r2.value.body) === show({ discounted: true, code: 'welcome50' }) && used.rows(MEMBERSHIP_DISCOUNTS_TABLE)[0].discounted === true
       && (await listedRow(used))?.verdict?.reason === 'has-discount',
     'a used one-month code still named on the membership, renewing at full price: 200 naming welcome50 as a coupon, and the row stays the coupon\'s', show(r2.value))
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
  // T-122: a payment's id, no id and an id Whop does not know were 422s here; they are asked through the Whop user now (below).
  await one('no Whop user on file (never on production: the column is NOT NULL)', () => checkDb('pay_devPayment', {}, null), undefined, 422,
    "The student's Whop account is not on file, so Whop can't be asked. Check the coupon in Whop.")
  process.env.WHOP_PRODUCT_ID = ''
  await one('no course product named on the deployment, for a student who needs one found', () => checkDb('pay_devPayment'), undefined, 500,
    "This deployment doesn't name the course's Whop product, so Whop can't be asked.")
  process.env.WHOP_PRODUCT_ID = COURSE
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
{
  // T-122: "Check Whop again" for the students the first dry run could not read (each was a 422 until then).
  resetWhop()
  const db = checkDb('pay_devPayment', {}, 'user_devFullPay')
  const before = await listedRow(db)
  ok(before?.verdict?.reason === 'has-discount' && before.couponCheck === 'stored',
     'a payment\'s id on file: the stored row counts (no membership id to compare), so the row is the coupon\'s', show(before?.couponCheck))
  const r = await quiet(() => checkAgain())
  const row = db.rows(MEMBERSHIP_DISCOUNTS_TABLE)[0]
  ok(r.value.status === 200 && show(r.value.body) === show({ discounted: false, code: null }) && row.whop_membership_id === 'mem_devFull' && row.source === R5('user') && row.discounted === false,
     'checked again: 200, the course membership found through the Whop user renews at full price, stored for that membership', show({ body: r.value.body, row }))
  const after = await listedRow(db)
  ok(after?.verdict?.ok === true && after.coupon?.discounted === false && after.couponCheck === 'stored',
     'the list read after it: the row is the rule\'s again, Approve back', show(after?.verdict))
  resetWhop()
  const none = checkDb(null, {}, 'user_devEvolvePay')
  const r2 = await quiet(() => checkAgain())
  ok(r2.value.status === 200 && show(r2.value.body) === show({ discounted: true, code: 'evolve10' }) && none.rows(MEMBERSHIP_DISCOUNTS_TABLE)[0].source === R5('user'),
     'no membership on file: 200, evolve10 on the one found through the Whop user', show(r2.value))
  resetWhop()
  const odd = checkDb('mem_devNullPrice', {}, 'user_devCtl97')
  const r3 = await quiet(() => checkAgain())
  ok(r3.value.status === 200 && show(r3.value.body) === show({ discounted: false, code: null }) && odd.rows(MEMBERSHIP_DISCOUNTS_TABLE)[0].source === R5('payment')
       && (await listedRow(odd))?.verdict?.ok === true,
     'a null renewal price: 200, judged by the real payments (one, 97.00, no code on it), and the list shows Approve again', show(r3.value))
  // T-122's second fix round: an 87.30 on evolve10 before the newest 97.00 is a coupon (the newest alone gave Approve back until then).
  resetWhop()
  const oddFull = checkDb('mem_devNullPrice', {}, 'user_devOddFull')
  const r3b = await quiet(() => checkAgain())
  ok(r3b.value.status === 200 && show(r3b.value.body) === show({ discounted: true, code: 'evolve10' }) && oddFull.rows(MEMBERSHIP_DISCOUNTS_TABLE)[0].source === R5('payment')
       && oddFull.rows(MEMBERSHIP_DISCOUNTS_TABLE)[0].whop_membership_id === 'mem_devNullPrice' && (await listedRow(oddFull))?.verdict?.reason === 'has-discount',
     'a null renewal price, the newest payment 97.00 and an 87.30 on evolve10 before it: 200 naming evolve10, the row for the membership on file (the payment names none), and the list keeps the coupon\'s row', show(r3b.value))
  resetWhop()
  const gone = checkDb('mem_devMissing', {}, 'user_devGone')
  const r4 = await quiet(() => checkAgain())
  const goneRow = await listedRow(gone)
  ok(r4.value.status === 200 && show(r4.value.body) === show({ discounted: true, code: 'evolve10' }) && gone.rows(MEMBERSHIP_DISCOUNTS_TABLE)[0].whop_membership_id === 'mem_devEvolve2'
       && goneRow?.couponCheck === 'not-checked',
     'a membership Whop does not know: 200, evolve10 on the one found through the Whop user; the list, which compares with the membership on file, says "not checked yet" until the sync puts the new one there (Approve asks Whop first)', show({ body: r4.value.body, check: goneRow?.couponCheck }))
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== The cron route: who is read, what is written ===')
process.env.CRON_SECRET = 'cron-test-secret'
function cronDb() {
  // Every student has a Whop user on production (the column is NOT NULL): one with no payments unless a row names one.
  // Since T-122's second fix round a membership with no discount is followed by the user's real payments.
  const p = (id, membership, more = {}) => ({ id, first_paid_at: '2026-10-05T10:00:00.000Z', membership_status: 'active', whop_membership_id: membership, whop_user_id: `user_dev_${id}`, ...more })
  const db = new FakeDb({
    students: [
      p('s-evolve', 'mem_devEvolve'),
      p('s-used', 'mem_devUsed'),
      p('s-full', 'mem_devFull', { membership_status: 'past_due' }),
      p('s-year', 'mem_devYearCode'),
      p('s-pending', 'mem_devEvolve2'),
      p('s-rejected', 'mem_devLegacy'),
      // T-122: no id, a payment's id and an id Whop does not know, answered through the Whop user or the real
      // payments; no renewal price and no plan, answered by the real payments (s-no-plan's 87.30 on evolve10 before
      // its newest 97.00 is a coupon since the second fix round).
      p('s-none', null, { whop_user_id: 'user_devNothing' }),
      p('s-pay', 'pay_devPayment', { whop_user_id: 'user_devEvolvePay' }),
      p('s-missing', 'mem_devMissing', { whop_user_id: 'user_devGone' }),
      p('s-null-price', 'mem_devNullPrice', { whop_user_id: 'user_devOdd' }),
      p('s-no-plan', 'mem_devNoPlan', { whop_user_id: 'user_devOddFull' }),
      p('s-no-course', 'pay_devPayment2', { whop_user_id: 'user_devNoCourse' }),
      // Whop gives no answer for this one (cronAnswer): its stored row stays.
      p('s-down', 'mem_devDown', { whop_user_id: 'user_devDown' }),
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
      // Read before; Whop gives no answer for it now: kept as it was.
      { ...storedEvolve('s-down', 'mem_devDown'), checked_at: '2026-10-21T07:00:00.000Z' },
    ],
  })
  installDb(db)
  return db
}
/** Whop down for one membership (a 503): the one student the cron gets no answer for. */
const cronAnswer = (p) => (p === '/api/v1/memberships/mem_devDown' ? json(503, {}) : null)
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
  whop.answer = cronAnswer
  const started = Date.now()
  const r = await quiet(() => cron())
  const b = r.value.body
  const rows = new Map(db.rows(MEMBERSHIP_DISCOUNTS_TABLE).map((x) => [x.student_id, x]))
  ok(r.value.status === 200 && b.ok === true && b.mode === 'write', 'a run: 200, ok', show(b))
  ok(b.in_window === 15 && b.pending_requests === 1 && b.have_the_30 === 2 && b.candidates === 13,
     'the window on 21 Oct, when every first payment from 1 October is still in one: active or past_due (15, the one pending request among them); the 2 with an approved or applied request left out (13 to check)', show({ in: b.in_window, pending: b.pending_requests, held: b.have_the_30, c: b.candidates }))
  ok(b.checked === 12 && show(b.by_source) === show({ membership: 6, user: 2, payment: 4 }) && b.no_real_payment === 1 && b.discounted === 10 && b.written === 12
       && show(b.failed) === show({ http_other: 1 }) && b.left === 0 && !('skipped' in b),
     '12 answered and written (10 discounted: s-no-plan\'s 87.30 among them since the second fix round, s-used\'s used welcome50 since the third): 6 from the membership on file, 2 through the Whop user (a payment\'s id, a membership Whop does not know), 4 from the payments (no price, no plan, no course membership, and one with no payment at all); failed holds only the one Whop gave no answer for, and nobody is skipped any more', show(b))
  ok(rows.get('s-evolve')?.discounted === true && rows.get('s-evolve')?.promo_code === 'evolve10' && rows.get('s-used')?.discounted === true && rows.get('s-used')?.promo_code === 'welcome50'
       && rows.get('s-full')?.discounted === false && rows.get('s-year')?.discounted === true && rows.get('s-pending')?.discounted === true && rows.get('s-rejected')?.discounted === true,
     'each row as Whop said: evolve10 yes, a used code still named yes (no until the third fix round), full price no, yearly code yes; a pending and a rejected request are read too')
  ok(rows.get('s-pay')?.discounted === true && rows.get('s-pay')?.source === R5('user') && rows.get('s-pay')?.whop_membership_id === 'mem_devEvolve'
       && rows.get('s-missing')?.discounted === true && rows.get('s-missing')?.source === R5('user') && rows.get('s-missing')?.whop_membership_id === 'mem_devEvolve2'
       && rows.get('s-null-price')?.discounted === true && rows.get('s-null-price')?.source === R5('payment') && rows.get('s-null-price')?.renewal_price === 87.3
       && rows.get('s-no-plan')?.discounted === true && rows.get('s-no-plan')?.source === R5('payment') && rows.get('s-no-plan')?.renewal_price === 87.3
       && rows.get('s-no-course')?.discounted === true && rows.get('s-no-course')?.source === R5('payment')
       && rows.get('s-none')?.discounted === false && rows.get('s-none')?.source === R5('payment') && rows.get('s-none')?.renewal_price === null
       && rows.get('s-evolve')?.source === R5('membership')
       && [...rows.values()].filter((x) => x.student_id !== 's-down').every((x) => x.source_checked_at === x.checked_at),
     'T-122\'s rows: a payment\'s id and an unknown id through the Whop user (evolve10, stored for the membership judged), no price 87.30 yes, no plan with an 87.30 on evolve10 before its 97.00 yes (no until the second fix round), no course membership 87.30 yes, no payment at all no; each with its source')
  ok(!rows.has('s-sept') && !rows.has('s-canceled') && !rows.has('s-expired') && !rows.has('s-nopay') && !rows.has('s-approved') && !rows.has('s-applied'),
     'nobody outside the window and nobody with the 30% already is written')
  ok(rows.get('s-down')?.checked_at === '2026-10-21T07:00:00.000Z' && rows.get('s-down')?.discounted === true, 'the one Whop gave no answer for keeps the row it had')
  const reads = (prefix) => whop.log.filter((x) => x.path.startsWith(prefix)).length
  // Since T-122's fourth fix round the payments are read beside every user list (5 payment reads, one for every student
  // no membership showed a code for, until then), a course membership that no longer grants access is read for its
  // code (s-no-course's expired one), and no plan is read for a membership naming no code (the 2 plans read here are
  // those of the memberships naming one).
  ok(reads('/api/v1/plans/') === 2 && reads('/api/v1/memberships/') === 13 && reads('/api/v2/memberships') === 7 && reads('/api/v1/payments') === 7
       && reads('/api/v1/promo_codes/') === 3 && b.whop_requests === 32,
     'each plan read once (2 plans, both of memberships naming a code); 13 membership reads (10 on file, 2 found through a user, and 1 that no longer grants access, read for its code); 7 user lists, one for every student whose membership on file showed no code, and 7 payment reads, one beside each list (5 until the fourth fix round); 3 code names; 32 requests', show(whop.log.map((x) => x.path)))
  ok(show(b.refused_by_price) === show([{ student_id: 's-no-course', price: 87.3, billing_reason: null }]) && b.user_list_unusable === 0,
     'the answer lists the student the price alone refused (s-no-course\'s first real payment, 87.30 naming no code), with its price and billing_reason, and counts no unusable user list (T-122\'s fourth fix round)', show({ refused: b.refused_by_price, unusable: b.user_list_unusable }))
  ok([...rows.values()].filter((x) => x.student_id !== 's-down').every((x) => x.checked_at >= new RealDate(started).toISOString()), 'every row written carries the moment it was read')
  // The stand-in gives cron_runs rows no id, so cron-auth.ts's finish (an update by id) is not seen here; the start is.
  ok(db.rows('cron_runs').some((x) => x.route_name === 'refresh-membership-discounts' && x.auth_status === 'ok' && x.status === 'running'),
     'cron_runs: the run opens its row, as every cron does')
  ok(!/mem_|promo_|pay_|@/.test(show(b)), 'the answer names no Whop id and no email')

  // The next run: those never read come first, then the oldest read.
  resetWhop()
  db = cronDb()
  whop.answer = cronAnswer
  db.tables[MEMBERSHIP_DISCOUNTS_TABLE].push({ ...storedEvolve('s-evolve'), checked_at: '2026-10-21T08:00:00.000Z' })
  await quiet(() => cron())
  const order = whop.log.filter((x) => x.path.startsWith('/api/v1/memberships/')).map((x) => x.path.split('/').pop())
  ok(order.at(-2) === 'mem_devDown' && order.at(-1) === 'mem_devEvolve' && order.indexOf('mem_devUsed') < order.indexOf('mem_devDown'),
     'never read first, then the longest unread: the two read at 07:00 and 08:00 go last, in that order', order.join(', '))

  resetWhop()
  db = cronDb()
  whop.answer = cronAnswer
  const dry = await quiet(() => cron('?mode=dry'))
  ok(dry.value.status === 200 && dry.value.body.mode === 'dry' && dry.value.body.checked === 12 && show(dry.value.body.by_source) === show({ membership: 6, user: 2, payment: 4 })
       && dry.value.body.written === 0 && db.rows(MEMBERSHIP_DISCOUNTS_TABLE).length === 1,
     '?mode=dry: the same reads and counts, nothing written', show(dry.value.body))

  // A run Whop answers for every student, the unreadable ones of the first dry run included: failed is empty.
  resetWhop()
  db = cronDb()
  db.tables.students = db.rows('students').filter((s) => s.id !== 's-down')
  const clean = await quiet(() => cron('?mode=dry'))
  ok(clean.value.status === 200 && clean.value.body.checked === clean.value.body.candidates && show(clean.value.body.failed) === show({}),
     'with Whop answering, every candidate is answered and failed is empty: what the next dry run on production must read', show(clean.value.body))

  resetWhop()
  whop.answer = () => json(401, {})
  db = cronDb()
  const dead = await quiet(() => cron())
  ok(dead.value.status === 500 && dead.value.body.ok === false && dead.value.body.checked === 0 && dead.value.body.failed.http_401_403 === 13,
     'every read refused (a revoked key): 500, ok false, every student counted under the kind, the ones asked through their Whop user too', show(dead.value.body))
  ok(dead.lines.some((l) => l.includes('[refresh-membership-discounts] every Whop read failed: http_401_403 13')),
     'and the log says why, for Vercel\'s log search', show(dead.lines))

  // A database without v113: the first write is refused for its source column, every write of the run goes without it.
  resetWhop()
  db = cronDb()
  whop.answer = cronAnswer
  db.failWhen = (q) => (q.table === MEMBERSHIP_DISCOUNTS_TABLE && q.op === 'upsert' && [].concat(q.values).some((v) => 'source' in v)
    ? { code: 'PGRST204', message: "Could not find the 'source' column of 'student_membership_discounts' in the schema cache" } : null)
  const noV113 = await quiet(() => cron())
  const upserts = db.calls(MEMBERSHIP_DISCOUNTS_TABLE, 'upsert')
  ok(noV113.value.status === 200 && noV113.value.body.written === 12 && upserts.length === 2 && 'source' in upserts[0].values[0] && !('source' in upserts[1].values[0])
       && db.rows(MEMBERSHIP_DISCOUNTS_TABLE).filter((x) => x.student_id !== 's-down').every((x) => !('source' in x)),
     'a database without v113: the rows are refused once with source and written without it, the run says 200 and 12 written', show(upserts.map((u) => u.values.length)))

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
    // Each with a Whop user with no payments: since T-122's second fix round the payments are read after the membership.
    return { id: `s-${String(i).padStart(4, '0')}`, first_paid_at: '2026-10-05T10:00:00.000Z', membership_status: 'active', whop_membership_id: id, whop_user_id: `user_devMany${i}` }
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
{
  // T-122's fix round in the cron: the yearly code, the tax on top and the free membership's two ways are discounts now.
  resetWhop()
  const p = (id, membership, user) => ({ id, first_paid_at: '2026-10-05T10:00:00.000Z', membership_status: 'active', whop_membership_id: membership, whop_user_id: user })
  const db = new FakeDb({ students: [
    p('f-year', 'mem_devYear970Null', 'user_devYear970'),
    p('f-taxed', 'mem_devTaxNull', 'user_devTaxed'),
    p('f-free-later', 'pay_devPayment', 'user_devFreeLater'),
    p('f-free-on-file', 'mem_devFree', 'user_devFreeLater'),
    p('f-free-full', 'pay_devPayment', 'user_devFreeFull'),
    p('f-ctl-tax', 'mem_devCtlNull', 'user_devCtlTax'),
  ] })
  installDb(db)
  const r = await quiet(() => cron())
  const b = r.value.body
  const rows = new Map(db.rows(MEMBERSHIP_DISCOUNTS_TABLE).map((x) => [x.student_id, x]))
  ok(r.value.status === 200 && b.ok === true && b.checked === 6 && show(b.by_source) === show({ membership: 0, user: 3, payment: 3 }) && b.discounted === 4
       && b.written === 6 && show(b.failed) === show({}),
     '6 read and written: 4 discounted (the yearly code, the tax on top, evolve10 beside a newer free membership with a payment\'s id or the free one on file), 3 through the Whop user and 3 from the latest payment, none failed', show(b))
  ok(rows.get('f-year')?.discounted === true && rows.get('f-year')?.plan_renewal_price === 970 && rows.get('f-taxed')?.discounted === true && rows.get('f-taxed')?.renewal_price === 87.3
       && rows.get('f-free-later')?.whop_membership_id === 'mem_devEvolve3' && rows.get('f-free-on-file')?.whop_membership_id === 'mem_devEvolve3' && rows.get('f-free-on-file')?.source === R5('user')
       && rows.get('f-free-full')?.discounted === false && rows.get('f-free-full')?.whop_membership_id === 'mem_devFull' && rows.get('f-ctl-tax')?.discounted === false,
     'each row as the fix round reads it: the code\'s membership named, the prices compared stored, the controls none', show([...rows.values()].map((x) => [x.student_id, x.whop_membership_id, x.discounted, x.renewal_price, x.plan_renewal_price])))
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

  // A Whop user each (NOT NULL on production), with no payments: since T-122's second fix round they are read after the membership.
  const p = (id, paid, membership, more = {}) => ({ id, first_paid_at: paid, membership_status: 'active', whop_membership_id: membership, whop_user_id: `user_dev_${id}`, ...more })
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
  r = await quiet(async () => { dataDb({ ...storedEvolve('s1', 'mem_devEvolve'), source: 'user' }, 'pay_devPayment'); return data() })
  const noId = await quiet(async () => { dataDb({ ...storedEvolve('s1', null), source: 'payment', renewal_price: 87.3, plan_renewal_price: 97 }, null); return data() })
  ok(r.value.body.membershipDiscounted === true && noId.value.body.membershipDiscounted === true,
     'a payment\'s id or no id on file (T-122): the row the check wrote through the Whop user or from a payment counts, so the map says it before Apply', show([r.value.body.membershipDiscounted, noId.value.body.membershipDiscounted]))
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
  // T-122's column (supabase/migration-tests/v113.test.mjs pastes it on Postgres).
  const v113 = read('../supabase/migrations/2026_v113_membership_discount_source.sql').replace(/--.*$/gm, '')
  const v113undo = read('../supabase/undo/2026_v113_undo.sql').replace(/--.*$/gm, '')
  // Since T-122's fifth fix round the source carries the rule's version (r5-...), and source_checked_at the time of the
  // write that set it; an earlier round's word is emptied before the check goes on (a dev database with the earlier copy).
  ok(/add column if not exists source text;/.test(v113) && /add column if not exists source_checked_at timestamptz;/.test(v113)
       && /check \(source is null or source in \('r5-membership', 'r5-user', 'r5-payment'\)\)/.test(v113)
       && /update public\.student_membership_discounts\s+set source = null,\s+source_checked_at = null\s+where source is not null\s+and source not in \('r5-membership', 'r5-user', 'r5-payment'\);/.test(v113)
       && /^begin;/m.test(v113) && /^commit;/m.test(v113) && /set local lock_timeout = '5s';/.test(v113) && !/create policy|grant |revoke /.test(v113),
     'v113 adds source, held to this rule\'s three values or empty, and source_checked_at, in one transaction with 5 seconds for a lock, and touches no policy or privilege')
  ok(/drop column if exists source;/.test(v113undo) && /drop column if exists source_checked_at;/.test(v113undo) && /alter table if exists public\.student_membership_discounts/.test(v113undo),
     'its undo drops both columns, and runs again with nothing to drop')
  const src = read('../src/lib/membership-discount.ts')
  // Until T-122's third fix round no read named source. Since then the request routes' fallback does, to tell a stored
  // "no coupon" this rule wrote; on a database without v113 it reads again without it (run in the round's own section).
  // Since the fifth it names source_checked_at with it, and reads checked_at.
  ok(/MEMBERSHIP_DISCOUNT_COLUMNS =\s+"student_id, whop_membership_id, promo_code_id, promo_code, renewal_price, plan_renewal_price, discounted, checked_at";/.test(src)
       && /STORED_FALLBACK_COLUMNS = "whop_membership_id, promo_code_id, promo_code, discounted, checked_at";/.test(src)
       && (src.match(/`\$\{STORED_FALLBACK_COLUMNS\}, source, source_checked_at`/g) ?? []).length === 1 && !/\.select\("[^"]*source/.test(src)
       && /if \(!lacksSourceColumn\(withSource\.error\)\) return null;\s+const bare = await read\(STORED_FALLBACK_COLUMNS\);/.test(src),
     'one read names source and source_checked_at, the request routes\' fallback, and on a database without v113 it reads again without them, so every read still answers there')
}

// ════════════════════════════════════════════════════════════════════════════
// T-122's second fix round (2026-10-21). An adversarial re-check on a stand-in
// Whop found the owner's rule still passed: "they should not be able to apply
// for the code if they have a coupon already ... If they paid less than 97,
// most likely they have a coupon. I don't want to even let them apply for the
// discount if they have a code already." A code used on the first payment
// alone (a one-month 50% code, a first-year 10% on the $970 yearly) renews at
// full price, so the membership said none and no payment was read; a code on
// a second course membership was never read beside a full-price one on file;
// and a membership naming a code whose renewal price or plan does not read
// dropped the code. The rule of thumb also refused a 97.00 payment whose tax
// behaviour is not "exclusive", and one paid in another currency. Every case
// runs through judgeStudentDiscount, both request routes and the cron, beside
// controls that must still get in, and the team's own 30% code, which never
// makes a student a coupon holder. The section's fixtures are its own
// (round2Whop, made-up ids). T-122's third fix round changed the answers its
// comments mark: a used code still named on a membership is a coupon found
// there, the price judges no payment in another currency, and the 30% code is
// the student's own only by its name or their request's promo id.
console.log('\n=== T-122\'s second fix round: every real payment, a named code, the tax and the currency ===')
{
  const MD2 = await import('./_gen/membership-discount.ts')
  const { couponWarns } = await import('./_gen/thirty-view.ts')
  const THIRTY = 'promo_devThirty'
  const THIRTY_NAME = 'ECOM30-AB12CD'
  const eur = (amount) => ({ amount, currency: 'eur' })
  function round2Whop() {
    resetWhop()
    const m = (id, promo, renewal, plan = MONTHLY) => whop.memberships.set(id, { id, status: 'active', promo_code_id: promo, renewal_price: renewal, plan_id: plan })
    m('mem_devW50', 'promo_devW50', '97.00')
    m('mem_devFirstYear', 'promo_devFirstYear', '970.00', YEAR970)
    m('mem_devEvolveOld', 'promo_devEvolve', '87.30')
    m('mem_devFullNew', null, '97.00')
    m('mem_devCodeNoPrice', 'promo_devEvolve', null)
    m('mem_devCodePlanGone', 'promo_devEvolve', '87.30', 'plan_devGone')
    m('mem_devThirtyOn', THIRTY, '67.90')
    m('mem_devThirtyUsed', THIRTY, '97.00')
    m('mem_devThirtyNoPrice', THIRTY, null)
    whop.promos.set('promo_devW50', { id: 'promo_devW50', code: 'welcome50' })
    whop.promos.set(THIRTY, { id: THIRTY, code: THIRTY_NAME })
    // promo_devFirstYear: Whop gives no name for it (a 404), as for the yearly code above.
    whop.byUser.set('user_devTwoPaid', [v2('mem_devEvolveOld', 'user_devTwoPaid', { created_at: 1_759_500_000 }), v2('mem_devFullNew', 'user_devTwoPaid', { created_at: 1_760_500_000 })])
    whop.byUser.set('user_devCodeNoPriceList', [v2('mem_devCodeNoPrice', 'user_devCodeNoPriceList')])
    const P = (user, ...list) => whop.payments.set(user, list)
    const at = '2026-10-12T10:00:00.000Z'
    // welcome50 (50% for one month) on the first and only payment, 48.50 of 97.00; the membership renews at 97.00.
    P('user_devW50', pay('pay_devW1', 'user_devW50', '48.50', '2026-10-15T10:00:00.000Z', onCode('promo_devW50', '97.00', { membership_id: 'mem_devW50' })))
    // A first-year 10% on the $970 yearly: 873.00 of 970.00, renewing at 970.00.
    P('user_devFirstYear', pay('pay_devFY1', 'user_devFirstYear', '873.00', '2026-10-15T10:00:00.000Z', onCode('promo_devFirstYear', '970.00', { membership_id: 'mem_devFirstYear' })))
    // evolve10 on the older membership (87.30), full price on the newer one, which the sync keeps on file.
    P('user_devTwoPaid',
      pay('pay_devTP2', 'user_devTwoPaid', '97.00', at, { membership_id: 'mem_devFullNew' }),
      pay('pay_devTP1', 'user_devTwoPaid', '87.30', '2026-10-03T10:00:00.000Z', onCode('promo_devEvolve', '97.00', { membership_id: 'mem_devEvolveOld' })))
    // A code named on the membership, its renewal price or plan unreadable, the one payment 97.00 naming no code.
    P('user_devCodeNoPrice', pay('pay_devCN1', 'user_devCodeNoPrice', '97.00', at, { membership_id: 'mem_devCodeNoPrice' }))
    P('user_devCodePlanGone', pay('pay_devCG1', 'user_devCodePlanGone', '97.00', at, { membership_id: 'mem_devCodePlanGone' }))
    P('user_devCodeNoPriceList', pay('pay_devCL1', 'user_devCodeNoPriceList', '97.00', at, { membership_id: 'mem_devCodeNoPrice' }))
    // The controls, no code named.
    P('user_devR97', pay('pay_devR1', 'user_devR97', '97.00', at))
    P('user_devR116', pay('pay_devR2', 'user_devR116', '116.40', at, { subtotal: money('97.00'), tax_amount: money('19.40'), tax_behavior: 'exclusive' }))
    P('user_devRIncl', pay('pay_devR3', 'user_devRIncl', '97.00', at, { tax_amount: money('16.17'), tax_behavior: 'inclusive' }))
    P('user_devRNull', pay('pay_devR4', 'user_devRNull', '97.00', at, { tax_amount: money('16.17'), tax_behavior: null }))
    P('user_devRNull116', pay('pay_devR5', 'user_devRNull116', '116.40', at, { subtotal: money('97.00'), tax_amount: money('19.40'), tax_behavior: null }))
    P('user_devRUnspec', pay('pay_devR6', 'user_devRUnspec', '97.00', at, { tax_amount: money('16.17'), tax_behavior: 'unspecified' }))
    P('user_devRUnable', pay('pay_devR7', 'user_devRUnable', '97.00', at, { tax_amount: money('19.40'), tax_behavior: 'unable_to_collect' }))
    P('user_devREur', pay('pay_devR8', 'user_devREur', '89.90', at, { currency: 'eur', total: eur('89.90'), subtotal: eur('89.90'), usd_total: money('97.00') }))
    P('user_devREurNoUsd', pay('pay_devR9', 'user_devREurNoUsd', '89.90', at, { currency: 'eur', total: eur('89.90'), subtotal: eur('89.90'), usd_total: null }))
    // In euros and on a coupon: welcome50 with no usd_total (44.95 of 89.90); 80.00 naming no code, 86.30 in dollars.
    P('user_devREurCode', pay('pay_devR10', 'user_devREurCode', '44.95', at, { currency: 'eur', total: eur('44.95'), subtotal: eur('89.90'), usd_total: null, promo_code_id: 'promo_devW50' }))
    P('user_devREurLow', pay('pay_devR11', 'user_devREurLow', '80.00', at, { currency: 'eur', total: eur('80.00'), subtotal: eur('80.00'), usd_total: money('86.30') }))
    // The team's own 30%: the first payment at full price, then the renewal the 30% took 29.10 off.
    P('user_devThirty',
      pay('pay_devTh2', 'user_devThirty', '67.90', '2026-10-20T10:00:00.000Z', onCode(THIRTY, '97.00', { membership_id: 'mem_devThirtyUsed' })),
      pay('pay_devTh1', 'user_devThirty', '97.00', '2026-10-02T10:00:00.000Z', { membership_id: 'mem_devThirtyUsed' }))
    // welcome50 on the first payment and the team's 30% later (an Approve anyway): the real code is the one named.
    P('user_devThirtyW50',
      pay('pay_devTW2', 'user_devThirtyW50', '67.90', '2026-10-20T10:00:00.000Z', onCode(THIRTY, '97.00', { membership_id: 'mem_devThirtyUsed' })),
      pay('pay_devTW1', 'user_devThirtyW50', '48.50', '2026-10-02T10:00:00.000Z', onCode('promo_devW50', '97.00', { membership_id: 'mem_devThirtyUsed' })))
  }
  const judge2 = async (onFile, user, answer = null, ctxOpts = {}) => {
    round2Whop()
    whop.answer = answer
    return judgeStudentDiscount(student(onFile, user), newReadContext(KEY, ctxOpts.startBy ?? null, ctxOpts.answerBy ?? null))
  }
  const rowOf2 = (r) => (r.ok ? { source: r.source, discounted: r.row.discounted, membership: r.row.whop_membership_id, code: r.row.promo_code, codeId: r.row.promo_code_id, price: r.row.renewal_price, against: r.row.plan_renewal_price } : r)
  /** Both request routes for one student: what each answered and what it wrote. */
  async function bothRoutes(membership, user, answer = null) {
    const out = []
    for (const [name, route, path, body] of [['request', requestRoute, 'request', { studentId: 's1' }], ['submit-feedback', feedbackRoute, 'submit-feedback', { answers: ANSWERS }]]) {
      round2Whop()
      whop.answer = answer
      const db = readyDb(membership, {}, user)
      const t0 = Date.now()
      const r = await quiet(() => post(route, path, body))
      const stored = db.rows(MEMBERSHIP_DISCOUNTS_TABLE)[0] ?? null
      out.push({ name, status: r.value.status, error: r.value.body.error ?? null, state: r.value.body.state ?? null, written: db.rows('discount_requests').length,
        rpc: db.calls('submit_discount_with_feedback', 'rpc').length, stored: stored && { discounted: stored.discounted, source: stored.source ?? null, membership: stored.whop_membership_id }, ms: Date.now() - t0 })
    }
    return out
  }
  const refused = (rs) => rs.every((x) => x.status === 400 && x.error === LINE && x.state === 'not-eligible' && x.written === 0 && x.rpc === 0 && x.stored?.discounted === true)
  const letIn = (rs) => rs.every((x) => x.status === 200 && x.written === 1 && x.stored?.discounted === false)

  // The owner's rule, case by case: judgeStudentDiscount, then both request routes. Since T-122's third fix round the
  // first three are found on a membership (the used code still named on the one on file; evolve10 on the older one,
  // read through the Whop user every time), where the second round found them on a payment: the same coupon, its own
  // step and prices (the membership's renewal and plan).
  const blocking = [
    ['BLOCKING: welcome50 (one month, 50%) on file, paid 48.50 on the 97.00 plan, renewing at 97.00', 'mem_devW50', 'user_devW50',
      { source: 'membership', discounted: true, membership: 'mem_devW50', code: 'welcome50', codeId: 'promo_devW50', price: 97, against: 97 }],
    ['BLOCKING: a first-year 10% on the $970 yearly on file, paid 873.00, renewing at 970.00 (the code\'s name not given)', 'mem_devFirstYear', 'user_devFirstYear',
      { source: 'membership', discounted: true, membership: 'mem_devFirstYear', code: null, codeId: 'promo_devFirstYear', price: 970, against: 970 }],
    ['evolve10 on an older course membership, a newer full-price one on file: the row names the membership that carries it', 'mem_devFullNew', 'user_devTwoPaid',
      { source: 'user', discounted: true, membership: 'mem_devEvolveOld', code: 'evolve10', codeId: 'promo_devEvolve', price: 87.3, against: 97 }],
    ['a membership naming evolve10 with no renewal price, its one payment 97.00 naming no code: the membership\'s own code decides', 'mem_devCodeNoPrice', 'user_devCodeNoPrice',
      { source: 'membership', discounted: true, membership: 'mem_devCodeNoPrice', code: 'evolve10', codeId: 'promo_devEvolve', price: null, against: null }],
    ['a membership naming evolve10 whose plan Whop does not know, its one payment 97.00 naming no code', 'mem_devCodePlanGone', 'user_devCodePlanGone',
      { source: 'membership', discounted: true, membership: 'mem_devCodePlanGone', code: 'evolve10', codeId: 'promo_devEvolve', price: 87.3, against: null }],
    ['a payment\'s id on file, the course membership found through the Whop user naming evolve10 with no renewal price', 'pay_devNotAMembership', 'user_devCodeNoPriceList',
      { source: 'user', discounted: true, membership: 'mem_devCodeNoPrice', code: 'evolve10', codeId: 'promo_devEvolve', price: null, against: null }],
  ]
  for (const [why, membership, user, want] of blocking) {
    const r = rowOf2(await judge2(membership, user))
    ok(show(r) === show(want), `${why}: a coupon (judgeStudentDiscount)`, show(r))
    const routes = await bothRoutes(membership, user)
    ok(refused(routes), `${why}: both request routes 400 with the student's line, nothing written`, show(routes))
  }
  // The reads: a code on the membership on file answers by itself, pinned, 4 a second (until the third fix round the
  // payments were read after it, the code taking nothing off the renewal); a name read once.
  {
    await judge2('mem_devW50', 'user_devW50')
    ok(show(paths()) === show(['/api/v1/memberships/mem_devW50', '/api/v1/plans/plan_devMonthly97', '/api/v1/promo_codes/promo_devW50'])
         && whop.log.every((x) => x.version === PINNED) && whop.log.slice(1).every((x, i) => x.at - whop.log[i].at >= 250),
       'welcome50: the membership, its plan, the code\'s name, and nothing after the code is found, pinned, 4 a second', show(paths()))
    await judge2('mem_devCodeNoPrice', 'user_devCodeNoPrice')
    ok(show(paths()) === show(['/api/v1/memberships/mem_devCodeNoPrice', '/api/v1/promo_codes/promo_devEvolve']),
       'a named code with no renewal price: the membership and the code\'s name (to tell the team\'s own 30%), no payment read', show(paths()))
  }

  // The controls: no code anywhere, so they still get in. A membership with no renewal price and no code, so the payment decides.
  const controls = [
    ['97.00 naming no code', 'user_devR97', 97, 97],
    ['116.40, 19.40 of it tax added on top ("exclusive"), naming no code', 'user_devR116', 97, 97],
    ['97.00 with the tax inside the price ("inclusive"), naming no code', 'user_devRIncl', 97, 97],
    ['97.00 holding a 16.17 tax whose behaviour is null, naming no code (read as 80.83 until the second fix round)', 'user_devRNull', 97, 97],
    ['116.40, 97.00 plus a 19.40 tax whose behaviour is null, naming no code', 'user_devRNull116', 116.4, 97],
    ['97.00 holding a tax whose behaviour is "unspecified", naming no code', 'user_devRUnspec', 97, 97],
    ['97.00 holding a tax whose behaviour is "unable_to_collect", naming no code', 'user_devRUnable', 97, 97],
    // Since T-122's third fix round the price judges no payment in another currency: its usd_total is not read, and the
    // row keeps the payment's own price (the second round held it against 97.00 at its usd_total's rate, 97.00 here).
    ['EUR 89.90 with usd_total 97.00, naming no code (read as 89.90 dollars until the second fix round)', 'user_devREur', 89.9, null],
    ['EUR 89.90 with no usd_total, naming no code: no rule of thumb, nothing held against 97.00', 'user_devREurNoUsd', 89.9, null],
  ]
  for (const [why, user, price, against] of controls) {
    const r = rowOf2(await judge2('mem_devCtlNull', user))
    ok(show(r) === show({ source: 'payment', discounted: false, membership: 'mem_devCtlNull', code: null, codeId: null, price, against }), `control, ${why}: no coupon (judgeStudentDiscount)`, show(r))
    const routes = await bothRoutes('mem_devCtlNull', user)
    ok(letIn(routes), `control, ${why}: both request routes 200, the request written`, show(routes))
  }
  {
    // The same student with a full-price membership on file: since this round the payments are read after it too, and still let them in.
    // Since T-122's fourth fix round they are read beside the user's list, and the membership naming no code has its
    // plan read no more, so its row holds no plan price (97.00 until then).
    const r = rowOf2(await judge2('mem_devFull', 'user_devRNull'))
    ok(show(r) === show({ source: 'membership', discounted: false, membership: 'mem_devFull', code: null, codeId: null, price: 97, against: null })
         && paths().at(-1) === '/api/v1/payments?user_id=user_devRNull&status=paid&first=100',
       'control, a full-price membership on file and 97.00 holding a tax of unknown behaviour: the payments read after it, no coupon, the membership\'s row', show({ r, paths: paths() }))
    ok(letIn(await bothRoutes('mem_devFull', 'user_devRNull')), 'and both request routes let the request in')
  }
  // In another currency: a code still decides. Since T-122's third fix round the price does not (the task's rule: codes
  // only for those), so EUR 80.00 naming no code, a coupon at its usd_total's 86.30 until then, is none.
  {
    const code = rowOf2(await judge2('mem_devCtlNull', 'user_devREurCode'))
    ok(code.ok !== false && code.source === 'payment' && code.discounted === true && code.price === 44.95 && code.against === 89.9,
       'EUR 44.95 on welcome50 (of 89.90), no usd_total: the code decides, a coupon', show(code))
    const low = rowOf2(await judge2('mem_devCtlNull', 'user_devREurLow'))
    ok(show(low) === show({ source: 'payment', discounted: false, membership: 'mem_devCtlNull', code: null, codeId: null, price: 80, against: null }),
       'EUR 80.00 naming no code (86.30 in dollars): no coupon, the price judges no payment in another currency (a coupon until the third fix round)', show(low))
  }
  ok(show(paymentCoupon({ total: 89.9, subtotal: 89.9, taxOnTop: 0, promoCodeId: null, currency: 'eur', usdTotal: 97 })) === show({ price: 89.9, heldAgainst: null, discounted: false })
       && show(paymentCoupon({ total: 80, subtotal: 80, taxOnTop: 0, promoCodeId: null, currency: 'eur' })) === show({ price: 80, heldAgainst: null, discounted: false })
       && show(paymentCoupon({ total: 44.95, subtotal: 89.9, taxOnTop: 0, promoCodeId: 'promo_devW50', currency: 'eur' })) === show({ price: 44.95, heldAgainst: 89.9, discounted: true })
       && show(paymentCoupon({ total: 97, subtotal: 97, taxOnTop: 0, promoCodeId: null, currency: 'usd' })) === show({ price: 97, heldAgainst: 97, discounted: false }),
     'paymentCoupon in another currency: no usd_total read, the price held against nothing, a code a coupon; in dollars as before', show(paymentCoupon({ total: 89.9, subtotal: 89.9, taxOnTop: 0, promoCodeId: null, currency: 'eur', usdTotal: 97 })))

  // Whop not answering the payments read after a membership with no discount: no answer, the routes' 503, inside the limits.
  {
    const hung = await bothRoutes('mem_devFull', 'user_devR97', (p) => (p === '/api/v1/payments' ? 'hang' : null))
    ok(hung.every((x) => x.status === 503 && x.error === "We couldn't check your membership just now. Try again in a minute." && x.written === 0 && x.stored === null && x.ms <= 8000),
       'the payments never answer after a full-price membership: both routes 503 within the 8 s, nothing written or stored', show(hung))
    const down = await judge2('mem_devFull', 'user_devR97', (p) => (p === '/api/v1/payments' ? json(502, {}) : null))
    const noUser = await judge2('mem_devFull', null)
    ok(show(down) === show({ ok: false, fail: 'http_other' }) && show(noUser) === show({ ok: false, fail: 'no_whop_user' }),
       'a 5xx for those payments is no answer, and so is a student whose payments cannot be asked for (no Whop user, never on production)', show([down, noUser]))
  }

  // The student's own 30% code: never a coupon holder because of it. Until T-122's third fix round any ECOM30 code was
  // (isTeamThirtyCode, gone); since then only this student's own, by the name Approve makes for them or by the promo id
  // on their own approved or applied request. These students are 's1', whose own name is ECOM30-S1, so the code here
  // (ECOM30-AB12CD) is theirs by the promo id of their applied request, as checkMembershipDiscount reads it.
  // Since T-122's fourth fix round the name counts only while the student holds an approved or applied request of their
  // own (two students' ids can share 6 characters), so the name alone, with no request, is a coupon (it was theirs).
  ok(typeof MD2.isTeamThirtyCode === 'undefined' && MD2.teamThirtyCodeFor('ab12cd00-0000-4000-8000-000000000001') === THIRTY_NAME
       && MD2.isOwnThirtyCode({ id: 'ab12cd00-0000-4000-8000-000000000001', holdsOwnThirty: true }, 'promo_devAny', 'ecom30-ab12cd')
       && !MD2.isOwnThirtyCode({ id: 'ab12cd00-0000-4000-8000-000000000001' }, 'promo_devAny', 'ecom30-ab12cd')
       && MD2.isOwnThirtyCode({ id: 's1', ownThirtyPromoIds: [THIRTY] }, THIRTY, null)
       && !MD2.isOwnThirtyCode({ id: 's1' }, THIRTY, THIRTY_NAME) && !MD2.isOwnThirtyCode({ id: 's1' }, 'promo_devX', 'evolve10') && !MD2.isOwnThirtyCode({ id: 's1' }, null, null),
     'the student\'s own 30% code: the promo id on their own request, or the name Approve makes for them (the case not minded) while they hold such a request; the name with no request is not, nor another student\'s ECOM30 code, nor a code with no name and no such id')
  const own2 = async (onFile, user) => {
    round2Whop()
    return judgeStudentDiscount({ ...student(onFile, user), ownThirtyPromoIds: [THIRTY] }, newReadContext(KEY))
  }
  {
    const used = rowOf2(await own2('mem_devThirtyUsed', 'user_devThirty'))
    ok(show(used) === show({ source: 'membership', discounted: false, membership: 'mem_devThirtyUsed', code: THIRTY_NAME, codeId: THIRTY, price: 97, against: 97 }),
       'the student\'s own 30% used (the membership renews at 97.00), its 67.90 payment on that code: no coupon, the payment left out', show(used))
    const noPrice = rowOf2(await own2('mem_devThirtyNoPrice', 'user_devThirty'))
    ok(noPrice.ok !== false && noPrice.discounted === false && noPrice.source === 'payment' && noPrice.membership === 'mem_devThirtyNoPrice',
       'the student\'s own code named on a membership with no renewal price: not a coupon by itself, and its payments show none but the 30%', show(noPrice))
    const both = rowOf2(await own2('mem_devThirtyUsed', 'user_devThirtyW50'))
    ok(show(both) === show({ source: 'payment', discounted: true, membership: 'mem_devThirtyUsed', code: 'welcome50', codeId: 'promo_devW50', price: 48.5, against: 97 }),
       'welcome50 on the first payment and the student\'s own 30% after it: a coupon, the real code named, never hidden by the 30%', show(both))
    const notTheirs = rowOf2(await judge2('mem_devThirtyUsed', 'user_devThirty'))
    ok(show(notTheirs) === show({ source: 'membership', discounted: true, membership: 'mem_devThirtyUsed', code: THIRTY_NAME, codeId: THIRTY, price: 97, against: 97 }),
       'the same code on a student it is not known to belong to (no request of theirs holds its id, and it is not the name Approve makes for them): a coupon', show(notTheirs))
  }
  {
    // The 30% page's flag: an Approved row warns about a discount on the membership that is not the request's own 30%.
    const pageRow = async (membership, user, status) => {
      round2Whop()
      const db = readyDb(membership, {
        discount_requests: [{ id: 'r1', student_id: 's1', status, created_at: new Date(Date.parse(NOW) - 3 * 86_400_000).toISOString(),
          reviewed_at: new Date(Date.parse(NOW) - 2 * 86_400_000).toISOString(), promo_code: THIRTY_NAME, whop_promo_id: THIRTY }],
      }, user)
      const r = await quiet(() => checkMembershipDiscount(fakeClient(db), 's1', { apiKey: KEY }))
      const row = await listedRow(db)
      return { check: r.value, coupon: row?.coupon ?? null, warns: row ? couponWarns(row) : null, status: row?.status ?? null }
    }
    // Since T-122's third fix round the student's own 30% is no coupon on the membership either, its renewal discounted or
    // not (THE RULE read it as a discount, so the check said one until then). On production the page reads an Approved
    // row's coupon from Whop itself (readApprovedCoupons, THE RULE) and marks it the team's own; here the stored row decides.
    const on = await pageRow('mem_devThirtyOn', 'user_devThirty', 'approved')
    ok(on.check.discounted === false && on.check.code === THIRTY_NAME && on.coupon?.discounted === false && on.coupon?.ours === true && on.warns === false,
       'the student\'s own 30% still on the next renewal, an Approved row: no coupon (the promo id of their request), the page marks the code the team\'s own and does not warn', show(on))
    const usedPage = await pageRow('mem_devThirtyUsed', 'user_devThirty', 'applied')
    ok(usedPage.check.discounted === false && usedPage.coupon?.discounted === false && usedPage.warns === false,
       'the team\'s 30% applied and used, a Code Applied row: no coupon stored, so the page shows none', show(usedPage))
    const realToo = await pageRow('mem_devThirtyUsed', 'user_devThirtyW50', 'approved')
    ok(realToo.check.discounted === true && realToo.coupon?.code === 'welcome50' && realToo.coupon?.ours === false && realToo.warns === true,
       'welcome50 and the team\'s 30%, an Approved row: the page warns about welcome50', show(realToo))
    const judged = await own2('mem_devThirtyUsed', 'user_devThirty')
    const map = await quiet(async () => { dataDb(judged.ok ? judged.row : null, 'mem_devThirtyUsed'); return data() })
    ok(judged.ok && map.value.status === 200 && map.value.body.membershipDiscounted === false,
       'and the map\'s flag for that student is false', show(map.value.body.membershipDiscounted))
  }

  // The cron: the same students in the 30% window, each judged and stored.
  {
    round2Whop()
    const sp = (id, membership, user) => ({ id, first_paid_at: '2026-10-05T10:00:00.000Z', membership_status: 'active', whop_membership_id: membership, whop_user_id: user })
    const coupons = blocking.map(([, membership, user], i) => sp(`c-${i}`, membership, user))
    const ins = controls.map(([, user], i) => sp(`k-${i}`, 'mem_devCtlNull', user))
    // A student whose id starts ab12cd, the membership naming ECOM30-AB12CD, used: the name Approve makes for them. The
    // cron leaves out every student holding an approved or applied request, so this one holds none, and since T-122's
    // fourth fix round the name alone is then a coupon (two students' ids can share 6 characters, so it may be another
    // student's code); it was no coupon until then. It was 't-used' until the third fix round, when any ECOM30 code was
    // the team's.
    const T_USED = 'ab12cd00-0000-4000-8000-0000000000aa'
    const db = new FakeDb({ students: [...coupons, ...ins, sp(T_USED, 'mem_devThirtyUsed', 'user_devThirty'), sp('k-full', 'mem_devFull', 'user_devRNull')] })
    installDb(db)
    const r = await quiet(() => cron())
    const b = r.value.body
    const rows = new Map(db.rows(MEMBERSHIP_DISCOUNTS_TABLE).map((x) => [x.student_id, x]))
    ok(r.value.status === 200 && b.ok === true && b.checked === coupons.length + ins.length + 2 && b.written === b.checked && show(b.failed) === show({})
         && b.discounted === coupons.length + 1,
       `the cron: ${coupons.length + ins.length + 2} students read and written, ${coupons.length + 1} discounted (the round's cases, and the ECOM30 code of a student holding no request), none failed`, show(b))
    ok(coupons.every((s) => rows.get(s.id)?.discounted === true) && blocking.every(([, , , want], i) => rows.get(`c-${i}`)?.source === R5(want.source) && rows.get(`c-${i}`)?.whop_membership_id === want.membership),
       'each case stored as a coupon, with the step that found it and the membership it names', show(coupons.map((s) => [s.id, rows.get(s.id)?.discounted, rows.get(s.id)?.source, rows.get(s.id)?.whop_membership_id])))
    ok(ins.every((s) => rows.get(s.id)?.discounted === false) && rows.get(T_USED)?.discounted === true && rows.get(T_USED)?.promo_code === THIRTY_NAME && rows.get('k-full')?.discounted === false,
       'each control stored with no coupon, the full-price membership with a tax of unknown behaviour too; the ECOM30 code named for an id starting ab12cd, on a student holding no request, a coupon', show([...ins, { id: T_USED }, { id: 'k-full' }].map((s) => [s.id, rows.get(s.id)?.discounted])))
  }
}

// ════════════════════════════════════════════════════════════════════════════
// T-122's third fix round (2026-10-22). A re-check of the second round on a
// stand-in Whop still found the owner's rule broken ("I don't want to even
// let them apply for the discount if they have a code already"): a code the
// student came in on was missed whenever the payments did not show it taking
// money off. (a) A 100% first month: the checkout's 0.00 was never read, and
// the membership naming the used code renews at 97.00. (b) A code named on
// the membership, the payment naming none (a first-year 10% yearly, its
// promo_code_id null or absent) or whose total or paid_at does not read. (c)
// A EUR payment naming no code, beside welcome50 on the membership. (d) A
// second course membership on a 100% code beside the full-price one on file,
// never read. And any ECOM30 code was the team's: a public code named ECOM30,
// one named Ecom30Friends and another student's ECOM30-ABC123 used at
// checkout all passed. Now: a code other than this student's own 30% on any
// course membership read (on file, and every one found through the Whop
// user) or on any course payment, the $0 ones too, is a coupon; with no code
// anywhere, the price of a real payment in dollars that is no plan change.
// Every case runs through judgeStudentDiscount, both request routes (400
// with the student's line, nothing written) and the cron, beside controls
// that must get in, the stored rows a Whop that gives no answer falls back
// on, and the approve route's code. The fixtures are the section's own.
console.log('\n=== T-122\'s third fix round: a code anywhere is a coupon, then the price ===')
{
  const MD3 = await import('./_gen/membership-discount.ts')
  // The student: Approve names their 30% code ECOM30-5A1B2C (ECOM30- and the first 6 characters of the id, upper-cased).
  const SID = '5a1b2c3d-0000-4000-8000-000000000003'
  const OWN = 'ECOM30-5A1B2C'
  const EUR_PLAN = 'plan_devEur8990'
  const eur = (amount) => ({ amount, currency: 'eur' })
  const AT = { first: '2026-10-05T10:00:00.000Z', renewal: '2026-10-19T10:00:00.000Z', later: '2026-10-20T10:00:00.000Z' }
  /** Users whose payments list leaves the $0 rows out (as the older list does by default), to show the membership alone still answers. */
  const omitZero = new Set()
  const r3answer = (p, n, u) => {
    if (p !== '/api/v1/payments' || !omitZero.has(u.searchParams.get('user_id'))) return null
    const all = (whop.payments.get(u.searchParams.get('user_id')) ?? []).filter((x) => Number(x.total?.amount ?? x.total) !== 0)
    return json(200, { data: all, page_info: { has_next_page: false, end_cursor: null } })
  }
  function round3Whop() {
    resetWhop()
    omitZero.clear()
    whop.plans.set(EUR_PLAN, { id: EUR_PLAN, plan_type: 'renewal', renewal_price: eur('89.90') })
    for (const [id, code] of [['promo_r3Free100', 'freemonth'], ['promo_r3W50', 'welcome50'], ['promo_r3Y10', 'firstyear10'], ['promo_r3Pub30', 'ECOM30'],
      ['promo_r3Friends30', 'Ecom30Friends'], ['promo_r3Other30', 'ECOM30-ABC123'], ['promo_r3Own30', OWN]]) whop.promos.set(id, { id, code })
    // promo_r3OwnNoName: Whop gives no name for it (a 404), so it is this student's own only by its promo id.
    const m = (id, promo, renewal, plan = MONTHLY) => whop.memberships.set(id, { id, status: 'active', promo_code_id: promo, renewal_price: renewal, plan_id: plan })
    const list = (user, ...rows) => whop.byUser.set(user, rows.length ? rows : [v2(`mem_r3${user.slice(7)}`, user)])
    const P = (user, ...rows) => whop.payments.set(user, rows)
    // (a) A 100% first month (freemonth): the checkout's 0.00 of a 97.00 subtotal naming the code, then a 97.00 renewal.
    const freeMonth = (user, membership, renewalNames = false) => P(user,
      pay(`pay_${user}_2`, user, '97.00', AT.renewal, { membership_id: membership, billing_reason: 'subscription_cycle', ...(renewalNames ? { promo_code_id: 'promo_r3Free100' } : {}) }),
      pay(`pay_${user}_1`, user, '0.00', AT.first, { subtotal: money('97.00'), membership_id: membership, promo_code_id: 'promo_r3Free100', billing_reason: 'subscription_create' }))
    m('mem_r3A1', 'promo_r3Free100', '97.00'); list('user_r3A1'); freeMonth('user_r3A1', 'mem_r3A1')
    m('mem_r3A2', 'promo_r3Free100', '97.00'); list('user_r3A2'); freeMonth('user_r3A2', 'mem_r3A2'); omitZero.add('user_r3A2')
    m('mem_r3A3', 'promo_r3Free100', '97.00'); list('user_r3A3'); freeMonth('user_r3A3', 'mem_r3A3', true)
    m('mem_r3A4', null, '97.00'); list('user_r3A4'); freeMonth('user_r3A4', 'mem_r3A4')
    m('mem_r3A5', null, '97.00'); list('user_r3A5'); freeMonth('user_r3A5', 'mem_r3A5', true); omitZero.add('user_r3A5')
    // (b) Fields missing: a first-year 10% yearly whose payment has promo_code_id null, or no such field; welcome50's 48.50
    // whose total does not read, or whose paid_at does not.
    const yearly = (user, membership, more = {}) => {
      const p = pay(`pay_${user}`, user, '873.00', AT.first, { subtotal: money('970.00'), membership_id: membership, ...more })
      if (!('promo_code_id' in more)) delete p.promo_code_id
      P(user, p)
    }
    m('mem_r3B1', 'promo_r3Y10', '970.00', YEAR970); list('user_r3B1'); yearly('user_r3B1', 'mem_r3B1', { promo_code_id: null })
    m('mem_r3B2', 'promo_r3Y10', '970.00', YEAR970); list('user_r3B2'); yearly('user_r3B2', 'mem_r3B2')
    const half = (user, membership, odd) => P(user,
      pay(`pay_${user}_2`, user, '97.00', AT.renewal, { membership_id: membership, billing_reason: 'subscription_cycle' }),
      pay(`pay_${user}_1`, user, '48.50', AT.first, onCode('promo_r3W50', '97.00', { membership_id: membership, ...odd })))
    m('mem_r3B3', 'promo_r3W50', '97.00'); list('user_r3B3'); half('user_r3B3', 'mem_r3B3', { total: { value: '48.50' } })
    m('mem_r3B4', 'promo_r3W50', '97.00'); list('user_r3B4'); half('user_r3B4', 'mem_r3B4', { paid_at: null, created_at: null })
    m('mem_r3B5', null, '97.00'); list('user_r3B5'); half('user_r3B5', 'mem_r3B5', { total: { value: '48.50' } })
    m('mem_r3B6', null, '97.00'); list('user_r3B6'); half('user_r3B6', 'mem_r3B6', { paid_at: null, created_at: null })
    // (c) EUR: 44.95 of 89.90 naming no code, no usd_total; welcome50 on the membership of the EUR plan.
    m('mem_r3C1', 'promo_r3W50', eur('89.90'), EUR_PLAN); list('user_r3C1', v2('mem_r3C1', 'user_r3C1', { plan: EUR_PLAN }))
    P('user_r3C1', pay('pay_r3C1', 'user_r3C1', '44.95', AT.first, { currency: 'eur', total: eur('44.95'), subtotal: eur('89.90'), membership_id: 'mem_r3C1', usd_total: null }))
    // (d) A second course membership on a 100% code beside the full-price one on file; then the $0 row left out; then the
    // second membership no longer granting access, so its $0 payment alone shows the code.
    for (const [k, gone] of [['D1', false], ['D2', false], ['D3', true]]) {
      const user = `user_r3${k}`
      m(`mem_r3${k}full`, null, '97.00')
      m(`mem_r3${k}free`, 'promo_r3Free100', '97.00')
      list(user, v2(`mem_r3${k}full`, user, { created_at: 1_760_500_000 }), v2(`mem_r3${k}free`, user, { created_at: 1_760_400_000, ...(gone ? { status: 'canceled', valid: false } : {}) }))
      P(user,
        pay(`pay_${user}_2`, user, '97.00', AT.renewal, { membership_id: `mem_r3${k}full` }),
        pay(`pay_${user}_1`, user, '0.00', AT.first, { subtotal: money('97.00'), membership_id: `mem_r3${k}free`, promo_code_id: 'promo_r3Free100' }))
    }
    omitZero.add('user_r3D2')
    // ECOM30 codes that are not this student's: another student's used at checkout, a public one named ECOM30, one named
    // Ecom30Friends; on the membership and the payment, then on the payment alone.
    for (const [k, promo, onMembership] of [['S1', 'promo_r3Other30', true], ['S2', 'promo_r3Pub30', true], ['S3', 'promo_r3Friends30', true],
      ['S4', 'promo_r3Other30', false], ['S5', 'promo_r3Pub30', false], ['S6', 'promo_r3Friends30', false]]) {
      m(`mem_r3${k}`, onMembership ? promo : null, '97.00'); list(`user_r3${k}`)
      P(`user_r3${k}`, pay(`pay_r3${k}`, `user_r3${k}`, '67.90', AT.first, onCode(promo, '97.00', { membership_id: `mem_r3${k}` })))
    }
    // A code whose name cannot be read, and that no request of the student's holds: not known to be theirs.
    m('mem_r3S7', 'promo_r3OwnNoName', '67.90'); list('user_r3S7')
    P('user_r3S7', pay('pay_r3S7', 'user_r3S7', '67.90', AT.first, onCode('promo_r3OwnNoName', '97.00', { membership_id: 'mem_r3S7' })))
    // The controls.
    m('mem_r3K1', null, '97.00'); list('user_r3K1'); P('user_r3K1', pay('pay_r3K1', 'user_r3K1', '97.00', AT.first, { membership_id: 'mem_r3K1' }))
    m('mem_r3K2', null, '97.00'); list('user_r3K2'); P('user_r3K2',
      pay('pay_r3K2b', 'user_r3K2', '12.34', AT.later, { membership_id: 'mem_r3K2', billing_reason: 'subscription_update' }),
      pay('pay_r3K2a', 'user_r3K2', '97.00', AT.first, { membership_id: 'mem_r3K2', billing_reason: 'subscription_create' }))
    // This student's own 30% (ECOM30-5A1B2C): still on the next renewal of the membership, and on a payment; then on a payment alone.
    m('mem_r3K3', 'promo_r3Own30', '67.90'); list('user_r3K3'); P('user_r3K3',
      pay('pay_r3K3b', 'user_r3K3', '67.90', AT.renewal, onCode('promo_r3Own30', '97.00', { membership_id: 'mem_r3K3' })),
      pay('pay_r3K3a', 'user_r3K3', '97.00', AT.first, { membership_id: 'mem_r3K3' }))
    m('mem_r3K4', null, '97.00'); list('user_r3K4'); P('user_r3K4',
      pay('pay_r3K4b', 'user_r3K4', '67.90', AT.renewal, onCode('promo_r3Own30', '97.00', { membership_id: 'mem_r3K4' })),
      pay('pay_r3K4a', 'user_r3K4', '97.00', AT.first, { membership_id: 'mem_r3K4' }))
    m('mem_r3K5', null, '97.00'); list('user_r3K5'); P('user_r3K5', pay('pay_r3K5', 'user_r3K5', '116.40', AT.first, { subtotal: money('97.00'), tax_amount: money('19.40'), tax_behavior: 'exclusive', membership_id: 'mem_r3K5' }))
    m('mem_r3K6', null, '97.00'); list('user_r3K6'); P('user_r3K6', pay('pay_r3K6', 'user_r3K6', '97.00', AT.first, { tax_amount: money('16.17'), tax_behavior: 'inclusive', membership_id: 'mem_r3K6' }))
    for (const [k, usd] of [['K7', money('96.99')], ['K8', null]]) {
      m(`mem_r3${k}`, null, eur('89.90'), EUR_PLAN); list(`user_r3${k}`, v2(`mem_r3${k}`, `user_r3${k}`, { plan: EUR_PLAN }))
      P(`user_r3${k}`, pay(`pay_r3${k}`, `user_r3${k}`, '89.90', AT.first, { currency: 'eur', total: eur('89.90'), subtotal: eur('89.90'), usd_total: usd, membership_id: `mem_r3${k}` }))
    }
    // This student's own 30% whose name Whop does not give, known by the promo id on their applied request.
    m('mem_r3K9', 'promo_r3OwnNoName', '67.90'); list('user_r3K9')
    P('user_r3K9', pay('pay_r3K9', 'user_r3K9', '67.90', AT.renewal, onCode('promo_r3OwnNoName', '97.00', { membership_id: 'mem_r3K9' })))
    // The known limit kept: a $1 first week, then 97.00, no code anywhere.
    m('mem_r3L1', null, '97.00'); list('user_r3L1'); P('user_r3L1',
      pay('pay_r3L1b', 'user_r3L1', '97.00', AT.renewal, { membership_id: 'mem_r3L1', billing_reason: 'subscription_cycle' }),
      pay('pay_r3L1a', 'user_r3L1', '1.00', AT.first, { membership_id: 'mem_r3L1', billing_reason: 'subscription_create' }))
  }
  const want = (source, discounted, membership, code, price, against) => ({ source, discounted, membership, code, price, against })
  const row3 = (r) => (r.ok ? { source: r.source, discounted: r.row.discounted, membership: r.row.whop_membership_id, code: r.row.promo_code ?? r.row.promo_code_id, price: r.row.renewal_price, against: r.row.plan_renewal_price } : r)
  const judge3 = async (onFile, user, ownThirtyPromoIds, more = {}) => {
    round3Whop()
    whop.answer = r3answer
    return judgeStudentDiscount({ id: SID, whop_membership_id: onFile, whop_user_id: user, ...(ownThirtyPromoIds ? { ownThirtyPromoIds } : {}), ...more }, newReadContext(KEY))
  }
  /** Both request routes for the student: what each answered, wrote and stored, and how many Whop requests it made. */
  async function routes3(membership, user, more = {}) {
    const out = []
    for (const [name, route, path, body] of [['request', requestRoute, 'request', { studentId: SID }], ['submit-feedback', feedbackRoute, 'submit-feedback', { answers: ANSWERS }]]) {
      round3Whop()
      whop.answer = more.down ? () => 'throw' : r3answer
      const db = readyDb(membership, more.db ?? {}, user, SID)
      if (more.failWhen) db.failWhen = more.failWhen
      const r = await quiet(() => post(route, path, body))
      const stored = db.rows(MEMBERSHIP_DISCOUNTS_TABLE).find((x) => x.student_id === SID) ?? null
      out.push({ name, status: r.value.status, error: r.value.body.error ?? null, state: r.value.body.state ?? null,
        written: db.rows('discount_requests').length - (more.db?.discount_requests?.length ?? 0), rpc: db.calls('submit_discount_with_feedback', 'rpc').length,
        stored: stored && { discounted: stored.discounted, source: stored.source ?? null, membership: stored.whop_membership_id }, asked: whop.log.length, lines: r.lines })
    }
    return out
  }
  const refused3 = (rs) => rs.every((x) => x.status === 400 && x.error === LINE && x.state === 'not-eligible' && x.written === 0 && x.rpc === 0 && x.stored?.discounted === true)
  const letIn3 = (rs) => rs.every((x) => x.status === 200 && x.written === 1 && x.stored?.discounted === false)
  const brief = (rs) => rs.map((x) => [x.name, x.status, x.written, x.stored?.discounted, x.stored?.source])

  const blocking3 = [
    ['(a) a 100% first month: the checkout 0.00 of 97.00 naming freemonth, a 97.00 renewal, the membership naming the used code at 97.00', 'mem_r3A1', 'user_r3A1',
      want('membership', true, 'mem_r3A1', 'freemonth', 97, 97)],
    ['(a) the same, Whop leaving the 0.00 row out of the list', 'mem_r3A2', 'user_r3A2', want('membership', true, 'mem_r3A2', 'freemonth', 97, 97)],
    ['(a) the same, the 97.00 renewal naming the used code (97.00 of 97.00)', 'mem_r3A3', 'user_r3A3', want('membership', true, 'mem_r3A3', 'freemonth', 97, 97)],
    ['(a) the membership naming no code, the checkout 0.00 naming freemonth: the $0 payment shows it', 'mem_r3A4', 'user_r3A4', want('payment', true, 'mem_r3A4', 'freemonth', 0, 97)],
    ['(a) the membership naming no code, the 0.00 row left out, the 97.00 renewal naming freemonth', 'mem_r3A5', 'user_r3A5', want('payment', true, 'mem_r3A5', 'freemonth', 97, 97)],
    ['(b) a first-year 10% yearly paid 873.00 of 970.00, the payment\'s promo_code_id null, the membership naming the code at 970.00', 'mem_r3B1', 'user_r3B1',
      want('membership', true, 'mem_r3B1', 'firstyear10', 970, 970)],
    ['(b) the same, the payment holding no promo_code_id field at all', 'mem_r3B2', 'user_r3B2', want('membership', true, 'mem_r3B2', 'firstyear10', 970, 970)],
    ['(b) welcome50\'s 48.50 whose total does not read, beside a 97.00 renewal, welcome50 on the membership', 'mem_r3B3', 'user_r3B3', want('membership', true, 'mem_r3B3', 'welcome50', 97, 97)],
    ['(b) welcome50\'s 48.50 whose paid_at does not read, beside a 97.00 renewal, welcome50 on the membership', 'mem_r3B4', 'user_r3B4', want('membership', true, 'mem_r3B4', 'welcome50', 97, 97)],
    ['(b) the 48.50 whose total does not read naming welcome50, the membership naming no code', 'mem_r3B5', 'user_r3B5', want('payment', true, 'mem_r3B5', 'welcome50', null, 97)],
    ['(b) the 48.50 whose paid_at does not read naming welcome50, the membership naming no code', 'mem_r3B6', 'user_r3B6', want('payment', true, 'mem_r3B6', 'welcome50', 48.5, 97)],
    ['(c) a EUR 44.95 of 89.90 naming no code, no usd_total, the membership naming welcome50', 'mem_r3C1', 'user_r3C1', want('membership', true, 'mem_r3C1', 'welcome50', 89.9, 89.9)],
    ['(d) a second course membership on a 100% code beside the full-price one on file', 'mem_r3D1full', 'user_r3D1', want('user', true, 'mem_r3D1free', 'freemonth', 97, 97)],
    ['(d) the same, the 0.00 row left out of the list', 'mem_r3D2full', 'user_r3D2', want('user', true, 'mem_r3D2free', 'freemonth', 97, 97)],
    // Since T-122's fourth fix round a course membership that no longer grants access is read for its code, so the code
    // is found on it (source user) before its 0.00 payment (source payment until then).
    ['(d) the second membership no longer granting access, the code on it and on its 0.00 payment', 'mem_r3D3full', 'user_r3D3', want('user', true, 'mem_r3D3free', 'freemonth', 97, 97)],
    ['another student\'s ECOM30-ABC123 used at checkout, on the membership and the payment', 'mem_r3S1', 'user_r3S1', want('membership', true, 'mem_r3S1', 'ECOM30-ABC123', 97, 97)],
    ['a once code named ECOM30, on the membership and the payment', 'mem_r3S2', 'user_r3S2', want('membership', true, 'mem_r3S2', 'ECOM30', 97, 97)],
    ['a code named Ecom30Friends, on the membership and the payment', 'mem_r3S3', 'user_r3S3', want('membership', true, 'mem_r3S3', 'Ecom30Friends', 97, 97)],
    ['another student\'s ECOM30-ABC123 on the payment alone', 'mem_r3S4', 'user_r3S4', want('payment', true, 'mem_r3S4', 'ECOM30-ABC123', 67.9, 97)],
    ['a code named ECOM30 on the payment alone', 'mem_r3S5', 'user_r3S5', want('payment', true, 'mem_r3S5', 'ECOM30', 67.9, 97)],
    ['a code named Ecom30Friends on the payment alone', 'mem_r3S6', 'user_r3S6', want('payment', true, 'mem_r3S6', 'Ecom30Friends', 67.9, 97)],
    ['a code whose name Whop does not give, held by no request of the student\'s', 'mem_r3S7', 'user_r3S7', want('membership', true, 'mem_r3S7', 'promo_r3OwnNoName', 67.9, 97)],
    // The name Approve makes for this student, with no approved or applied request of theirs: controls until T-122's
    // fourth fix round, when the name came to count only beside such a request (two students' ids can share their first
    // 6 characters, so it may be another student's code). With the request, below, they are no coupon.
    [`${OWN} on the membership (67.90 on the next renewal) and on a payment, no request of this student's`, 'mem_r3K3', 'user_r3K3', want('membership', true, 'mem_r3K3', OWN, 67.9, 97)],
    [`${OWN} on a payment alone, no request of this student's`, 'mem_r3K4', 'user_r3K4', want('payment', true, 'mem_r3K4', OWN, 67.9, 97)],
  ]
  // Since T-122's fourth fix round a membership naming no code has its plan read no more, so its row holds no plan
  // price (the plan's 97.00, or 89.90, until then).
  const controls3 = [
    ['97.00, no code anywhere', 'mem_r3K1', 'user_r3K1', want('membership', false, 'mem_r3K1', null, 97, null)],
    ['97.00, then a 12.34 plan change charge (subscription_update), no code', 'mem_r3K2', 'user_r3K2', want('membership', false, 'mem_r3K2', null, 97, null)],
    ['116.40, 19.40 of it tax added on top ("exclusive"), no code', 'mem_r3K5', 'user_r3K5', want('membership', false, 'mem_r3K5', null, 97, null)],
    ['97.00 with the tax inside the price ("inclusive"), no code', 'mem_r3K6', 'user_r3K6', want('membership', false, 'mem_r3K6', null, 97, null)],
    ['EUR 89.90, no code, usd_total 96.99 (refused until this round)', 'mem_r3K7', 'user_r3K7', want('membership', false, 'mem_r3K7', null, 89.9, null)],
    ['EUR 89.90, no code, no usd_total', 'mem_r3K8', 'user_r3K8', want('membership', false, 'mem_r3K8', null, 89.9, null)],
  ]
  for (const [why, membership, user, w] of blocking3) {
    const r = row3(await judge3(membership, user))
    ok(show(r) === show(w), `${why}: a coupon (judgeStudentDiscount)`, show(r))
    const rs = await routes3(membership, user)
    ok(refused3(rs) && rs.every((x) => x.stored.source === R5(w.source) && x.stored.membership === w.membership),
       `${why}: both request routes 400 with the student's line, nothing written, the coupon stored (source ${w.source})`, show(brief(rs)))
  }
  for (const [why, membership, user, w] of controls3) {
    const r = row3(await judge3(membership, user))
    ok(show(r) === show(w), `control, ${why}: no coupon (judgeStudentDiscount)`, show(r))
    const rs = await routes3(membership, user)
    ok(letIn3(rs), `control, ${why}: both request routes 200, the request written`, show(brief(rs)))
  }

  // The reads: a $0 payment is read for its code alone, never a real payment (first_paid_at stays the first real one).
  // Since T-122's fourth fix round a membership naming no code has its plan read no more, and the user's course
  // memberships and the payments are read at the same time.
  {
    await judge3('mem_r3A4', 'user_r3A4')
    ok(show(paths()) === show(['/api/v1/memberships/mem_r3A4', '/api/v2/memberships?user_id=user_r3A4&per=50&page=1',
      '/api/v1/payments?user_id=user_r3A4&status=paid&first=100', '/api/v1/promo_codes/promo_r3Free100']),
       'a membership naming no code: no plan read, the user\'s course memberships beside the payments (no include_free sent: the pinned list gives the $0 ones), the code\'s name', show(paths()))
    const zero = pay('pay_z', 'user_z', '0.00', AT.first, onCode('promo_r3Free100', '97.00'))
    ok(show(judgePayment(zero)) === show({ keep: false, skip: 'zero_total' }), 'a $0 payment is still no real payment under first-payment.ts THE RULE, so it never sets first_paid_at', show(judgePayment(zero)))
    await judge3('mem_r3A1', 'user_r3A1')
    ok(show(paths()) === show(['/api/v1/memberships/mem_r3A1', '/api/v1/plans/plan_devMonthly97', '/api/v1/promo_codes/promo_r3Free100']),
       'a code on the membership on file answers before any other read', show(paths()))
    await judge3('mem_r3D1full', 'user_r3D1')
    ok(show(paths()) === show(['/api/v1/memberships/mem_r3D1full', '/api/v2/memberships?user_id=user_r3D1&per=50&page=1',
      '/api/v1/payments?user_id=user_r3D1&status=paid&first=100', '/api/v1/memberships/mem_r3D1free', '/api/v1/plans/plan_devMonthly97', '/api/v1/promo_codes/promo_r3Free100']),
       '(d): the full-price one on file (no plan read), then the user\'s list beside the payments, the one on file not read twice, the second one, its plan and its code', show(paths()))
  }

  // This student's own 30% by the promo id on their own request, its name unreadable; a code that is not theirs stays a coupon.
  {
    const withId = row3(await judge3('mem_r3K9', 'user_r3K9', ['promo_r3OwnNoName']))
    ok(show(withId) === show(want('membership', false, 'mem_r3K9', 'promo_r3OwnNoName', 67.9, 97)),
       'their own code, its name not given, known by the promo id on their own request: no coupon, on the membership or the payment', show(withId))
    const withoutId = row3(await judge3('mem_r3K9', 'user_r3K9'))
    ok(withoutId.discounted === true && withoutId.source === 'membership', 'the same code with no request holding its id: a coupon', show(withoutId))
    const otherId = row3(await judge3('mem_r3S1', 'user_r3S1', ['promo_r3OwnNoName']))
    ok(otherId.discounted === true && otherId.code === 'ECOM30-ABC123', 'a request\'s promo id clears that code alone: another student\'s ECOM30 code is still a coupon', show(otherId))
    // The name Approve makes for this student counts beside a request of their own (T-122's fourth fix round): K3 and
    // K4 above, coupons with no request, are no coupon with one, by the name or by the promo id.
    const k3Named = row3(await judge3('mem_r3K3', 'user_r3K3', undefined, { holdsOwnThirty: true }))
    const k3ById = row3(await judge3('mem_r3K3', 'user_r3K3', ['promo_r3Own30']))
    const k4Named = row3(await judge3('mem_r3K4', 'user_r3K4', undefined, { holdsOwnThirty: true }))
    ok(show(k3Named) === show(want('membership', false, 'mem_r3K3', OWN, 67.9, 97)) && show(k3ById) === show(k3Named)
         && show(k4Named) === show(want('membership', false, 'mem_r3K4', null, 97, null)),
       `${OWN} on the membership or on a payment alone, the student holding a request of their own: no coupon, by the name or by the promo id`, show([k3Named, k3ById, k4Named]))
    // Through checkMembershipDiscount, which reads the promo ids of the student's approved and applied requests.
    for (const status of ['approved', 'applied']) {
      round3Whop()
      const db = readyDb('mem_r3K9', { discount_requests: [{ id: 'r9', student_id: SID, status, created_at: AT.later, promo_code: OWN, whop_promo_id: 'promo_r3OwnNoName' }] }, 'user_r3K9', SID)
      const r = await quiet(() => checkMembershipDiscount(fakeClient(db), SID, { apiKey: KEY }))
      ok(r.value.source === 'live' && r.value.discounted === false && db.rows(MEMBERSHIP_DISCOUNTS_TABLE)[0]?.discounted === false && r.lines.length === 0,
         `an ${status} request holding the code's promo id: checkMembershipDiscount reads it, no coupon`, show(r.value))
    }
    round3Whop()
    const failing = readyDb('mem_r3K9', { discount_requests: [{ id: 'r9', student_id: SID, status: 'applied', created_at: AT.later, whop_promo_id: 'promo_r3OwnNoName' }] }, 'user_r3K9', SID)
    failing.fail['discount_requests.select'] = { message: 'canceling statement due to statement timeout' }
    const unread = await quiet(() => checkMembershipDiscount(fakeClient(failing), SID, { apiKey: KEY }))
    // Since T-122's fourth fix round the name counts only beside a request of theirs, so with none read no code is theirs.
    ok(unread.value.source === 'live' && unread.value.discounted === true
         && unread.lines.some((l) => l.includes(`student ${SID}: their own 30% requests could not be read, so no code is known to be their own`)),
       'their requests cannot be read: no code is known to be their own (the name counted alone until the fourth fix round), so a coupon, and a line says why', show({ value: unread.value, lines: unread.lines }))
    // The request routes never reach the coupon for a student holding an applied request: the request itself refuses.
    const rs = await routes3('mem_r3K9', 'user_r3K9', { db: { discount_requests: [{ id: 'r9', student_id: SID, status: 'applied', created_at: AT.later, whop_promo_id: 'promo_r3OwnNoName' }] } })
    ok(rs.every((x) => x.status === 400 && x.state === 'applied' && x.error !== LINE && x.written === 0 && x.asked === 0),
       'with that request applied, both request routes refuse by the request itself, before Whop is asked', show(rs.map((x) => [x.name, x.status, x.state, x.asked])))
  }

  // The known limit kept: the price still reads a cheaper plan's payment naming no code as a coupon (the $1 first week).
  {
    const r = row3(await judge3('mem_r3L1', 'user_r3L1'))
    ok(show(r) === show(want('payment', true, 'mem_r3L1', null, 1, 97)), 'known limit: a $1 first week, then 97.00, no code anywhere, still reads as a coupon by its price', show(r))
  }

  // A stored row, when Whop gives no answer: a coupon answers whoever wrote it; "no coupon" only when this rule wrote it.
  {
    const noCoupon = { student_id: SID, whop_membership_id: 'mem_r3K1', promo_code_id: null, promo_code: null, renewal_price: 97, plan_renewal_price: 97, discounted: false, checked_at: '2026-10-21T11:40:00.000Z' }
    const coupon = { ...noCoupon, promo_code_id: 'promo_r3W50', promo_code: 'welcome50', discounted: true }
    const stored = (row) => ({ db: { [MEMBERSHIP_DISCOUNTS_TABLE]: [row] }, down: true })
    const LINE_503 = "We couldn't check your membership just now. Try again in a minute."
    const unchecked = (rs) => rs.every((x) => x.status === 503 && x.error === LINE_503 && x.state === 'read-failed' && x.written === 0 && x.rpc === 0)
    let rs = await routes3('mem_r3K1', 'user_r3K1', stored(noCoupon))
    ok(unchecked(rs) && rs.every((x) => x.lines.some((l) => l.includes('Whop gave no answer (network), so no answer is on file (the stored row says no coupon and holds no source'))),
       'Whop down, a stored "no coupon" with no source (as production\'s cron wrote them by the rule before): both routes 503, nothing written', show(brief(rs)))
    // Since T-122's fifth fix round "this rule wrote it" is the rule's stamp (stampedBy): its version in the source, and
    // source_checked_at its checked_at.
    rs = await routes3('mem_r3K1', 'user_r3K1', stored(stampedBy(noCoupon, 'membership')))
    ok(rs.every((x) => x.status === 200 && x.written === 1 && x.stored?.discounted === false && x.stored?.source === R5('membership')),
       'Whop down, the same row with this rule\'s stamp: both routes 200, the request written on the stored answer', show(brief(rs)))
    rs = await routes3('mem_r3K1', 'user_r3K1', stored(coupon))
    ok(rs.every((x) => x.status === 400 && x.error === LINE && x.written === 0), 'Whop down, a stored coupon with no source: still refused with the student\'s line', show(brief(rs)))
    // A database without v113: the read naming source is refused, made again without it; a coupon still answers, "no coupon" never.
    const noV113 = (q) => (q.table === MEMBERSHIP_DISCOUNTS_TABLE && q.op === 'select' && /\bsource\b/.test(q.columns ?? '')
      ? { code: '42703', message: 'column student_membership_discounts.source does not exist' } : null)
    rs = await routes3('mem_r3K1', 'user_r3K1', { ...stored(stampedBy(noCoupon, 'membership')), failWhen: noV113 })
    ok(unchecked(rs), 'without v113, Whop down, a stored "no coupon": both routes 503 (the source cannot be read, so it never answers there)', show(brief(rs)))
    rs = await routes3('mem_r3K1', 'user_r3K1', { ...stored(coupon), failWhen: noV113 })
    ok(rs.every((x) => x.status === 400 && x.error === LINE && x.written === 0), 'without v113, Whop down, a stored coupon: refused with the line, read again without source', show(brief(rs)))
    // checkMembershipDiscount's own answers, and its reads.
    const check = async (row, failWhen) => {
      round3Whop()
      whop.answer = () => 'throw'
      const db = readyDb('mem_r3K1', { [MEMBERSHIP_DISCOUNTS_TABLE]: [row] }, 'user_r3K1', SID)
      if (failWhen) db.failWhen = failWhen
      const r = await quiet(() => checkMembershipDiscount(fakeClient(db), SID, { apiKey: KEY }))
      return { ...r.value, selects: db.calls(MEMBERSHIP_DISCOUNTS_TABLE, 'select').map((c) => c.columns) }
    }
    const a = await check(noCoupon)
    const b = await check(stampedBy(noCoupon, 'payment'))
    const b2 = await check({ ...noCoupon, source: 'payment' })
    const c = await check({ ...noCoupon, source: 'someone' })
    const d = await check(stampedBy(noCoupon, 'user'), noV113)
    // A step's word alone (an earlier round's build wrote it) answered until T-122's fifth fix round; now this rule's stamp alone does.
    ok(a.source === 'none' && b.source === 'stored' && b.discounted === false && b2.source === 'none' && c.source === 'none' && d.source === 'none'
         && show(d.selects) === show(['whop_membership_id, promo_code_id, promo_code, discounted, checked_at, source, source_checked_at', 'whop_membership_id, promo_code_id, promo_code, discounted, checked_at']),
       'checkMembershipDiscount: "no coupon" with no source none, with this rule\'s stamp stored, with a step\'s word alone or any other value none; without v113 read twice and none', show({ a: a.source, b: b.source, b2: b2.source, c: c.source, d }))
  }

  // The approve route names the code teamThirtyCodeFor makes, the name the check reads as the student's own.
  {
    round3Whop()
    readyDb('mem_r3K1', {
      discount_requests: [{ id: 'r3', student_id: SID, status: 'pending', created_at: new Date(Date.parse(NOW) - 3_600_000).toISOString() }],
      admin_config: [{ key: 'curriculum_reset_at', value: '2026-10-19T14:33:00.000Z' }],
    }, 'user_r3K1', SID)
    const made = promoCodes.length
    const res = await quiet(async () => {
      const r = await approveRoute(new Request('http://app/api/discounts/approve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: 'r3' }) }))
      return { status: r.status, body: await r.json() }
    })
    ok(res.value.status === 200 && res.value.body.promoCode === OWN && promoCodes.length === made + 1 && promoCodes.at(-1).code === OWN
         && typeof MD3.teamThirtyCodeFor === 'function' && MD3.teamThirtyCodeFor(SID) === OWN,
       `Approve makes ${OWN} for this student (teamThirtyCodeFor), the name the check takes as theirs`, show(res.value.body))
    const route = read('../src/app/api/discounts/approve/route.ts')
    ok(/const code = teamThirtyCodeFor\(studentRow\.id\);/.test(route) && !/`ECOM30-\$\{/.test(route), 'the route builds the code with it alone, so the two cannot drift apart')
  }

  // The cron: every case and control in the window, each judged and stored with its source.
  {
    round3Whop()
    whop.answer = r3answer
    const cid = (k) => `5a1b2c3d-0000-4000-8000-${String(k).padStart(12, '0')}`
    const sp = (k, membership, user) => ({ id: cid(k), first_paid_at: '2026-10-05T10:00:00.000Z', membership_status: 'active', whop_membership_id: membership, whop_user_id: user })
    const coupons = blocking3.map(([, membership, user], i) => sp(100 + i, membership, user))
    const ins = controls3.map(([, membership, user], i) => sp(200 + i, membership, user))
    const db = new FakeDb({ students: [...coupons, ...ins] })
    installDb(db)
    const r = await quiet(() => cron())
    const b = r.value.body
    const rows = new Map(db.rows(MEMBERSHIP_DISCOUNTS_TABLE).map((x) => [x.student_id, x]))
    const bySource = (list) => list.reduce((acc, [, , , w]) => ({ ...acc, [w.source]: (acc[w.source] ?? 0) + 1 }), { membership: 0, user: 0, payment: 0 })
    const expected = Object.fromEntries(['membership', 'user', 'payment'].map((s) => [s, bySource(blocking3)[s] + bySource(controls3)[s]]))
    ok(r.value.status === 200 && b.ok === true && b.checked === coupons.length + ins.length && b.written === b.checked && show(b.failed) === show({})
         && b.discounted === coupons.length && show(b.by_source) === show(expected) && b.left === 0,
       `the cron: ${coupons.length + ins.length} students read and written, the ${coupons.length} cases discounted, none failed, each counted by its step`, show(b))
    ok(blocking3.every(([, , , w], i) => rows.get(cid(100 + i))?.discounted === true && rows.get(cid(100 + i))?.source === R5(w.source) && rows.get(cid(100 + i))?.whop_membership_id === w.membership),
       'each case stored as a coupon, with its source and the membership it names', show(coupons.map((s) => [s.id.slice(-3), rows.get(s.id)?.discounted, rows.get(s.id)?.source])))
    ok(controls3.every(([, , , w], i) => rows.get(cid(200 + i))?.discounted === false && rows.get(cid(200 + i))?.source === R5(w.source)),
       'each control stored with no coupon and its source', show(ins.map((s) => [s.id.slice(-3), rows.get(s.id)?.discounted, rows.get(s.id)?.source])))
    // The answer's own field user_list_unusable (T-122's fourth fix round) is a name, not a Whop id.
    ok(!BANNED.test(show(b)) && !/mem_|promo_|pay_|user_/.test(show(b).replaceAll('"user_list_unusable"', '')), 'the answer names no Whop id')
  }
}

// ════════════════════════════════════════════════════════════════════════════
// T-122's fourth fix round (2026-10-22). The third round passed its re-check
// with nothing blocking; the re-check's should-fixes and nits, each reproduced
// on a stand-in Whop, are this section's cases. (1) A stored "no coupon" with a
// source was trusted even when an older build of T-122 wrote it for a student
// holding a used code (the world-engine preview's welcome50 row, probe-we): it
// answers now only naming no code, or the student's own 30% by the promo id on
// their own request. (2) A v2 list in another shape, holding another user's
// row or running past 4 pages read as no memberships: no answer now; a 404 or
// a 410 goes on without the list, and the cron counts it. (3) A course
// membership that no longer grants access was never read: its code is a coupon
// now. (4) The price judged every real course payment: it judges the first
// alone now, so a later manual charge or add-on lets a full-price student in,
// and the cron lists the students the price alone refused. (5) The name of the
// student's own code counted with no request of theirs: only beside one now.
// (6) A membership read answering 200 with a body it cannot read read as no
// code: no answer now. (7) The normal Approve went on when the check gave no
// answer: refused now, Approve anyway going on. (8) No plan read for a
// membership naming no code, and the user's list beside the payments, so a
// student with no code answers inside the routes' limits when Whop takes 2.5 s
// an answer (4 reads in a row gave the 503 until then). Every case runs
// through judgeStudentDiscount, both request routes and the cron where it
// applies. The fixtures are the section's own, every id and code made up.
console.log('\n=== T-122\'s fourth fix round: stored rows, the v2 list, ended memberships, the first payment, the own code, Approve with no answer, the reads ===')
{
  const MD4 = await import('./_gen/membership-discount.ts')
  const { anywaySkip, approveAnywayText } = await import('./_gen/thirty-view.ts')
  const DS4 = await import('./_gen/discount-server.ts')
  // This student and another share the first 6 characters of their ids, so Approve names both codes ECOM30-5A1B2C.
  const SID = '5a1b2c3d-0000-4000-8000-000000000004'
  const OTHER_STUDENT = '5a1b2cff-0000-4000-8000-000000000099'
  const OWN = 'ECOM30-5A1B2C'
  const LINE_503 = "We couldn't check your membership just now. Try again in a minute."
  // The first payments are paid at PAID, the first_paid_at readyDb stores, so it names them.
  const AT = { old: '2026-09-01T09:00:00.000Z', first: PAID, later: '2026-10-20T09:00:00.000Z' }
  /** Users whose payments list leaves the $0 rows out; users whose v2 list answers as the test says; memberships whose first read is a 200 this code cannot read. */
  const omitZero = new Set()
  const listAnswer = new Map()
  const glitch = new Map()
  const r4answer = (p, n, u) => {
    const user = u.searchParams.get('user_id')
    if (p === '/api/v2/memberships' && listAnswer.has(user)) return listAnswer.get(user)(u)
    if (p === '/api/v1/payments' && omitZero.has(user)) {
      const all = (whop.payments.get(user) ?? []).filter((x) => Number(x.total?.amount ?? x.total) !== 0)
      return json(200, { data: all, page_info: { has_next_page: false, end_cursor: null } })
    }
    const read = p.match(/^\/api\/v1\/memberships\/(.+)$/)
    if (read && glitch.has(read[1])) {
      const body = glitch.get(read[1])
      glitch.delete(read[1])
      return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return null
  }
  function round4Whop() {
    resetWhop()
    omitZero.clear()
    listAnswer.clear()
    glitch.clear()
    for (const [id, code] of [['promo_r4Free100', 'freemonth'], ['promo_r4W50', 'welcome50'], ['promo_r4Y10', 'firstyear10'],
      ['promo_r4Others', MD4.teamThirtyCodeFor(OTHER_STUDENT)], ['promo_r4Own', OWN]]) whop.promos.set(id, { id, code })
    const m = (id, promo, renewal, more = {}) => whop.memberships.set(id, { id, status: 'active', promo_code_id: promo, renewal_price: renewal, plan_id: MONTHLY, ...more })
    const P = (user, ...rows) => whop.payments.set(user, rows)
    const one = (k) => whop.byUser.set(`user_r4${k}`, [v2(`mem_r4${k}`, `user_r4${k}`)])
    // R: a code on a course membership that no longer grants access, the student back at 97.00 on a new one, on file.
    // R1 its 0.00 checkout listed naming the code; R2 left out of the list; R3 listed naming no code.
    for (const k of ['R1', 'R2', 'R3']) {
      const user = `user_r4${k}`
      m(`mem_r4${k}old`, 'promo_r4Free100', '97.00', { status: 'canceled' })
      m(`mem_r4${k}new`, null, '97.00')
      whop.byUser.set(user, [v2(`mem_r4${k}new`, user, { created_at: 1_760_900_000 }), v2(`mem_r4${k}old`, user, { status: 'canceled', valid: false, created_at: 1_758_000_000 })])
      P(user,
        pay(`pay_r4${k}b`, user, '97.00', AT.first, { membership_id: `mem_r4${k}new`, billing_reason: 'subscription_create' }),
        pay(`pay_r4${k}a`, user, '0.00', AT.old, { subtotal: money('97.00'), membership_id: `mem_r4${k}old`, billing_reason: 'subscription_create', ...(k === 'R3' ? {} : { promo_code_id: 'promo_r4Free100' }) }))
    }
    omitZero.add('user_r4R2')
    // R4: a first-year 10% on a yearly membership since expired, its 873.00 refunded and naming no code; monthly 97.00 on file.
    m('mem_r4R4old', 'promo_r4Y10', '970.00', { status: 'expired', plan_id: YEAR970 })
    m('mem_r4R4new', null, '97.00')
    whop.byUser.set('user_r4R4', [v2('mem_r4R4new', 'user_r4R4', { created_at: 1_760_900_000 }), v2('mem_r4R4old', 'user_r4R4', { plan: YEAR970, status: 'expired', valid: false, created_at: 1_758_000_000 })])
    P('user_r4R4',
      pay('pay_r4R4b', 'user_r4R4', '97.00', AT.first, { membership_id: 'mem_r4R4new', billing_reason: 'subscription_create' }),
      pay('pay_r4R4a', 'user_r4R4', '873.00', AT.old, { subtotal: money('970.00'), membership_id: 'mem_r4R4old', substatus: 'refunded', refunded_amount: money('873.00'), billing_reason: 'subscription_create' }))
    // V: a second course membership on a 100% first month beside the full-price one on file, its 0.00 checkout left out
    // of the payments (V1b's listed), the v2 list answering each way.
    for (const k of ['V0', 'V1', 'V1b', 'V2', 'V3', 'V4', 'V5', 'V6']) {
      const user = `user_r4${k}`
      m(`mem_r4${k}full`, null, '97.00')
      m(`mem_r4${k}free`, 'promo_r4Free100', '97.00')
      whop.byUser.set(user, [v2(`mem_r4${k}full`, user, { created_at: 1_760_500_000 }), v2(`mem_r4${k}free`, user, { created_at: 1_760_400_000 })])
      P(user,
        pay(`pay_r4${k}a`, user, '97.00', AT.first, { membership_id: `mem_r4${k}full`, billing_reason: 'subscription_create' }),
        pay(`pay_r4${k}b`, user, '0.00', AT.old, { subtotal: money('97.00'), membership_id: `mem_r4${k}free`, promo_code_id: 'promo_r4Free100', billing_reason: 'subscription_create' }))
      if (k !== 'V1b') omitZero.add(user)
    }
    whop.byUser.set('user_r4V1', 410)
    whop.byUser.set('user_r4V1b', 410)
    whop.byUser.set('user_r4V2', 404)
    listAnswer.set('user_r4V3', () => json(200, { memberships: [v2('mem_r4V3full', 'user_r4V3'), v2('mem_r4V3free', 'user_r4V3')] }))
    listAnswer.set('user_r4V4', () => json(200, { data: [v2('mem_r4V4full', 'user_r4V4'), v2('mem_r4V4free', 'user_r4V4'), v2('mem_r4V4someone', 'user_r4Someone')], pagination: { current_page: 1, total_page: 1 } }))
    listAnswer.set('user_r4V5', (u) => json(200, { data: [v2('mem_r4V5full', 'user_r4V5'), v2('mem_r4V5free', 'user_r4V5')], pagination: { current_page: Number(u.searchParams.get('page')), total_page: 5 } }))
    listAnswer.set('user_r4V6', () => json(200, { data: [{ id: 'mem_r4V6full', status: 'active', valid: true }, { id: 'mem_r4V6free', status: 'active', valid: true }], pagination: { current_page: 1, total_page: 1 } }))
    // L: no code anywhere, 97.00 first, then a charge under 97.00: a manual one, an add-on naming no membership.
    m('mem_r4L1', null, '97.00'); one('L1')
    P('user_r4L1',
      pay('pay_r4L1b', 'user_r4L1', '10.00', AT.later, { membership_id: 'mem_r4L1', billing_reason: 'manual' }),
      pay('pay_r4L1a', 'user_r4L1', '97.00', AT.first, { membership_id: 'mem_r4L1', billing_reason: 'subscription_create' }))
    m('mem_r4L2', null, '97.00'); one('L2')
    P('user_r4L2',
      pay('pay_r4L2b', 'user_r4L2', '47.00', AT.later, { membership_id: null, billing_reason: 'one_time' }),
      pay('pay_r4L2a', 'user_r4L2', '97.00', AT.first, { membership_id: 'mem_r4L2', billing_reason: 'subscription_create' }))
    // The known limits kept: a $1 and a $5 first week, then 97.00, no code anywhere.
    for (const [k, first] of [['D1', '1.00'], ['D5', '5.00']]) {
      m(`mem_r4${k}`, null, '97.00'); one(k)
      P(`user_r4${k}`,
        pay(`pay_r4${k}b`, `user_r4${k}`, '97.00', AT.later, { membership_id: `mem_r4${k}`, billing_reason: 'subscription_cycle' }),
        pay(`pay_r4${k}a`, `user_r4${k}`, first, AT.first, { membership_id: `mem_r4${k}`, billing_reason: 'subscription_create' }))
    }
    // E1: another student's ECOM30-5A1B2C (their ids share 6 characters), used at checkout by this one, 67.90 of 97.00.
    m('mem_r4E1', 'promo_r4Others', '97.00'); one('E1')
    P('user_r4E1', pay('pay_r4E1', 'user_r4E1', '67.90', AT.first, onCode('promo_r4Others', '97.00', { membership_id: 'mem_r4E1' })))
    // E2: this student's own ECOM30-5A1B2C, applied after their request: on the next renewal (67.90) and on a payment.
    m('mem_r4E2', 'promo_r4Own', '67.90'); one('E2')
    P('user_r4E2',
      pay('pay_r4E2b', 'user_r4E2', '67.90', AT.later, onCode('promo_r4Own', '97.00', { membership_id: 'mem_r4E2' })),
      pay('pay_r4E2a', 'user_r4E2', '97.00', AT.first, { membership_id: 'mem_r4E2' }))
    // S: a 100% code on the membership on file whose first read answers 200 with a body this code cannot read (S1 an
    // array, S2 a JSON string, S3 no JSON), and S4 an object naming none of the fields read (a known limit); the 0.00
    // checkout left out of the payments, so the membership alone shows the code.
    for (const [k, body] of [['S1', '[1,2]'], ['S2', '"ok"'], ['S3', '<html>busy</html>'], ['S4', '{}']]) {
      m(`mem_r4${k}`, 'promo_r4Free100', '97.00'); one(k)
      P(`user_r4${k}`,
        pay(`pay_r4${k}b`, `user_r4${k}`, '97.00', AT.first, { membership_id: `mem_r4${k}`, billing_reason: 'subscription_cycle' }),
        pay(`pay_r4${k}a`, `user_r4${k}`, '0.00', AT.old, { subtotal: money('97.00'), membership_id: `mem_r4${k}`, promo_code_id: 'promo_r4Free100' }))
      omitZero.add(`user_r4${k}`)
      glitch.set(`mem_r4${k}`, body)
    }
    // WE: probe-we's student, who came in on welcome50 (48.50 of 97.00), the used code still on the membership on file.
    m('mem_r4WE', 'promo_r4W50', '97.00'); one('WE')
    P('user_r4WE', pay('pay_r4WE', 'user_r4WE', '48.50', AT.first, onCode('promo_r4W50', '97.00', { membership_id: 'mem_r4WE' })))
    // F: no code anywhere, one course membership at 97.00 and one 97.00 payment (the 2.5 s measurement).
    m('mem_r4F', null, '97.00'); one('F')
    P('user_r4F', pay('pay_r4F', 'user_r4F', '97.00', AT.first, { membership_id: 'mem_r4F', billing_reason: 'subscription_create' }))
  }
  const want = (source, discounted, membership, code, price, against) => ({ source, discounted, membership, code, price, against })
  const row4 = (r) => (r.ok ? { source: r.source, discounted: r.row.discounted, membership: r.row.whop_membership_id, code: r.row.promo_code ?? r.row.promo_code_id, price: r.row.renewal_price, against: r.row.plan_renewal_price } : r)
  const judge4 = async (onFile, user, more = {}) => {
    round4Whop()
    whop.answer = r4answer
    return judgeStudentDiscount({ id: SID, whop_membership_id: onFile, whop_user_id: user, first_paid_at: PAID, ...more }, newReadContext(KEY))
  }
  /** Both request routes for the student: what each answered, wrote and stored, its Whop reads, and how long it took. */
  async function routes4(membership, user, more = {}) {
    const out = []
    for (const [name, route, path, body] of [['request', requestRoute, 'request', { studentId: SID }], ['submit-feedback', feedbackRoute, 'submit-feedback', { answers: ANSWERS }]]) {
      round4Whop()
      whop.answer = more.down ? () => 'throw' : r4answer
      whop.delayMs = more.delayMs ?? 0
      const db = readyDb(membership, more.db ?? {}, user, SID)
      const t0 = Date.now()
      const r = await quiet(() => post(route, path, body))
      const stored = db.rows(MEMBERSHIP_DISCOUNTS_TABLE).find((x) => x.student_id === SID) ?? null
      out.push({ name, status: r.value.status, error: r.value.body.error ?? null, state: r.value.body.state ?? null,
        written: db.rows('discount_requests').length - (more.db?.discount_requests?.length ?? 0), rpc: db.calls('submit_discount_with_feedback', 'rpc').length,
        stored: stored && { discounted: stored.discounted, source: stored.source ?? null, membership: stored.whop_membership_id },
        asked: whop.log.length, ms: Date.now() - t0, lastStart: whop.log.length ? Math.max(...whop.log.map((x) => x.at)) - t0 : null, lines: r.lines })
    }
    whop.delayMs = 0
    return out
  }
  const refused4 = (rs) => rs.every((x) => x.status === 400 && x.error === LINE && x.state === 'not-eligible' && x.written === 0 && x.rpc === 0 && x.stored?.discounted === true)
  const letIn4 = (rs) => rs.every((x) => x.status === 200 && x.written === 1 && x.stored?.discounted === false)
  const unchecked4 = (rs) => rs.every((x) => x.status === 503 && x.error === LINE_503 && x.state === 'read-failed' && x.written === 0 && x.rpc === 0)
  const brief4 = (rs) => rs.map((x) => [x.name, x.status, x.written, x.stored?.discounted, x.stored?.source])

  const refusedCases = [
    ['R1 a 100% first month on a membership since canceled, its 0.00 checkout listed naming the code, re-bought at 97.00 on a new one (on file)', 'mem_r4R1new', 'user_r4R1', want('user', true, 'mem_r4R1old', 'freemonth', 97, 97)],
    ['R2 the same, the 0.00 checkout left out of the list', 'mem_r4R2new', 'user_r4R2', want('user', true, 'mem_r4R2old', 'freemonth', 97, 97)],
    ['R3 the same, the 0.00 checkout listed naming no code', 'mem_r4R3new', 'user_r4R3', want('user', true, 'mem_r4R3old', 'freemonth', 97, 97)],
    ['R4 a first-year 10% on a yearly membership since expired (its 873.00 refunded), monthly 97.00 on file', 'mem_r4R4new', 'user_r4R4', want('user', true, 'mem_r4R4old', 'firstyear10', 970, 970)],
    ['V0 a second course membership on a 100% first month beside the full-price one on file, the v2 list answering', 'mem_r4V0full', 'user_r4V0', want('user', true, 'mem_r4V0free', 'freemonth', 97, 97)],
    ['V1b the same with the v2 list answering 410, the 0.00 checkout listed naming the code', 'mem_r4V1bfull', 'user_r4V1b', want('payment', true, 'mem_r4V1bfree', 'freemonth', 0, 97)],
    ['the $1 first week, then 97.00, no code anywhere (a known limit kept)', 'mem_r4D1', 'user_r4D1', want('payment', true, 'mem_r4D1', null, 1, 97)],
    ['a $5 first week, then 97.00, no code anywhere (a known limit kept)', 'mem_r4D5', 'user_r4D5', want('payment', true, 'mem_r4D5', null, 5, 97)],
    [`E1 ${OWN}, made by Approve for another student whose id shares 6 characters, used at checkout (67.90 of 97.00), no request of this student's`, 'mem_r4E1', 'user_r4E1', want('membership', true, 'mem_r4E1', OWN, 97, 97)],
    ['WE welcome50 on the membership on file (48.50 of 97.00, renewing at 97.00), Whop answering', 'mem_r4WE', 'user_r4WE', want('membership', true, 'mem_r4WE', 'welcome50', 97, 97)],
  ]
  const letInCases = [
    ['L1 97.00, then a 10.00 manual charge (billing_reason manual), no code', 'mem_r4L1', 'user_r4L1', want('membership', false, 'mem_r4L1', null, 97, null)],
    ['L2 97.00, then a 47.00 add-on (billing_reason one_time, naming no membership), no code', 'mem_r4L2', 'user_r4L2', want('membership', false, 'mem_r4L2', null, 97, null)],
    ['F one course membership at 97.00, one 97.00 payment, no code', 'mem_r4F', 'user_r4F', want('membership', false, 'mem_r4F', null, 97, null)],
  ]
  const fallThroughCases = [
    ['V1 the v2 list answering 410 Gone for every read (what 13 November may bring), the 0.00 checkout left out', 'mem_r4V1full', 'user_r4V1'],
    ['V2 the v2 list answering 404 for every read, the 0.00 checkout left out', 'mem_r4V2full', 'user_r4V2'],
  ]
  const noAnswerCases = [
    ['V3 the v2 list answering 200 in another shape ({ memberships: [...] })', 'mem_r4V3full', 'user_r4V3', 'bad_page'],
    ['V4 the v2 list ignoring the user filter (a row of another user on the page)', 'mem_r4V4full', 'user_r4V4', 'filter_ignored'],
    ['V5 the v2 list saying 5 pages of 50 (more than one user has)', 'mem_r4V5full', 'user_r4V5', 'too_many_pages'],
    ['V6 the v2 list whose rows name no buyer (another shape)', 'mem_r4V6full', 'user_r4V6', 'bad_page'],
    ['S1 a 100% code on the membership on file, its read a 200 with an array body, the 0.00 checkout left out', 'mem_r4S1', 'user_r4S1', 'bad_shape'],
    ['S2 the same, the body a JSON string', 'mem_r4S2', 'user_r4S2', 'bad_shape'],
    ['S3 the same, the body no JSON at all', 'mem_r4S3', 'user_r4S3', 'bad_shape'],
  ]
  for (const [why, membership, user, w] of refusedCases) {
    const r = row4(await judge4(membership, user))
    ok(show(r) === show(w), `${why}: a coupon (judgeStudentDiscount)`, show(r))
    const rs = await routes4(membership, user)
    ok(refused4(rs) && rs.every((x) => x.stored.source === R5(w.source) && x.stored.membership === w.membership),
       `${why}: both request routes 400 with the student's line, nothing written, the coupon stored (source ${w.source})`, show(brief4(rs)))
  }
  for (const [why, membership, user, w] of letInCases) {
    const named = await judge4(membership, user)
    const earliest = await judge4(membership, user, { first_paid_at: null })
    ok(show(row4(named)) === show(w) && show(row4(earliest)) === show(w) && named.byPrice === null,
       `${why}: no coupon, by the payment first_paid_at names and by the earliest real one alike (judgeStudentDiscount)`, show([row4(named), row4(earliest)]))
    const rs = await routes4(membership, user)
    ok(letIn4(rs), `${why}: both request routes 200, the request written`, show(brief4(rs)))
  }
  for (const [why, membership, user] of fallThroughCases) {
    const r = await judge4(membership, user)
    ok(r.ok && r.userListUnusable === true && show(row4(r)) === show(want('membership', false, membership, null, 97, null)),
       `${why}: judged without the list, by the membership on file and the payments, and marked for the cron's count; the code on the second membership is not seen there (a known limit until the v1 list, T-113)`, show({ row: row4(r), unusable: r.ok && r.userListUnusable }))
    const rs = await routes4(membership, user)
    ok(letIn4(rs), `${why}: both request routes go by that answer (the request written)`, show(brief4(rs)))
  }
  for (const [why, membership, user, fail] of noAnswerCases) {
    const r = await judge4(membership, user)
    ok(show(r) === show({ ok: false, fail }), `${why}: no answer (${fail}), never "no code" (judgeStudentDiscount)`, show(r))
    const rs = await routes4(membership, user)
    ok(unchecked4(rs) && rs.every((x) => x.stored === null), `${why}: both request routes 503, "${LINE_503}", nothing written or stored`, show(brief4(rs)))
  }

  // The reads of these: an ended membership read for its code alone; a list naming more than 4 pages read once.
  {
    await judge4('mem_r4R2new', 'user_r4R2')
    ok(show(paths()) === show(['/api/v1/memberships/mem_r4R2new', '/api/v2/memberships?user_id=user_r4R2&per=50&page=1', '/api/v1/payments?user_id=user_r4R2&status=paid&first=100',
      '/api/v1/memberships/mem_r4R2old', `/api/v1/plans/${MONTHLY}`, '/api/v1/promo_codes/promo_r4Free100']),
       'R2: the one on file (no plan read), the list beside the payments, then the canceled one, its plan and its code', show(paths()))
    await judge4('mem_r4V5full', 'user_r4V5')
    ok(whop.log.filter((x) => x.path === '/api/v2/memberships').length === 1, 'V5: the first page naming 5 pages ends the list read, no more pages read (4 were until this round)', show(paths()))
    round4Whop()
    const r1 = await MD4.findCourseMemberships('user_r4R1', new Set([COURSE]), newReadContext(KEY))
    const gone = await MD4.findCourseMemberships('user_r4V1', new Set([COURSE]), newReadContext(KEY))
    ok(r1.ok && show(r1.membershipIds) === show(['mem_r4R1new']) && show(r1.endedIds) === show(['mem_r4R1old']) && r1.unusable === false
         && show(gone) === show({ ok: true, membershipIds: [], endedIds: [], unusable: true }),
       'findCourseMemberships: those that grant access, and apart from them those that no longer do; a 410 for the list is no memberships, marked unusable', show([r1, gone]))
  }

  // The first real payment, the one the price judges: the one first_paid_at names, else the earliest, in any order.
  {
    const cp = (paidAt, total, real = true) => ({ real, paidAt, total, currency: 'usd', billingReason: null, productId: COURSE, membershipId: null, promoCodeId: null, promoCode: null, subtotal: total, taxOnTop: 0 })
    const a = cp('2026-10-05T10:00:00.000Z', 47)
    const b = cp('2026-10-12T10:00:00.000Z', 97)
    const c = cp('2026-10-20T10:00:00.000Z', 10)
    const z = cp('2026-10-01T10:00:00.000Z', 0, false)
    const frp = typeof MD4.firstRealPayment === 'function' ? MD4.firstRealPayment : () => undefined
    ok(frp([c, b, a, z], null) === a && frp([a, z, c, b], undefined) === a
         && frp([c, b, a], '2026-10-12T10:00:00+00:00') === b && frp([c, b, a], '2026-09-30T10:00:00.000Z') === a
         && frp([z], null) === null && frp([], PAID) === null,
       'firstRealPayment: the real payment first_paid_at names (as the database gives it back), else the earliest real one whatever the order; a $0 one never; none with no real payment')
    // The $1 first week's answer carries its price and billing_reason for the cron to list; a coupon found by a code does not.
    const d1 = await judge4('mem_r4D1', 'user_r4D1')
    const coded = await judge4('mem_r4V1bfull', 'user_r4V1b')
    ok(show(d1.byPrice) === show({ price: 1, billingReason: 'subscription_create' }) && coded.ok && coded.byPrice === null,
       'the price alone refused the $1 first week: its price and billing_reason handed on; a code on a payment refuses without them', show([d1.byPrice, coded.byPrice]))
  }

  // This student's own code: by the promo id on their own approved or applied request; by the name only beside one.
  {
    const st = { id: SID }
    const held = { id: SID, holdsOwnThirty: true }
    const withId = { id: SID, ownThirtyPromoIds: ['promo_r4Own'] }
    ok(!MD4.isOwnThirtyCode(st, 'promo_x', OWN) && MD4.isOwnThirtyCode(held, 'promo_x', OWN) && MD4.isOwnThirtyCode(held, 'promo_x', ' ecom30-5a1b2c ')
         && MD4.isOwnThirtyCode(withId, 'promo_r4Own', null) && MD4.isOwnThirtyCode(withId, 'promo_x', OWN) && !MD4.isOwnThirtyCode(withId, 'promo_x', 'ECOM30-5A1B2')
         && !MD4.isOwnThirtyCode(held, 'promo_x', 'ECOM30') && !MD4.isOwnThirtyCode(held, null, null) && MD4.teamThirtyCodeFor(OTHER_STUDENT) === OWN,
       `isOwnThirtyCode: the promo id on their own request; ${OWN} by name only while they hold one (another student whose id starts 5a1b2c gets the same name)`)
    const noRequest = row4(await judge4('mem_r4E2', 'user_r4E2'))
    const byId = row4(await judge4('mem_r4E2', 'user_r4E2', { ownThirtyPromoIds: ['promo_r4Own'] }))
    const byName = row4(await judge4('mem_r4E2', 'user_r4E2', { holdsOwnThirty: true }))
    ok(noRequest.discounted === true && noRequest.code === OWN && show(byId) === show(want('membership', false, 'mem_r4E2', OWN, 67.9, 97)) && show(byName) === show(byId),
       `this student's ${OWN} on the membership (67.90 on the next renewal) and on a payment: a coupon with no request of theirs; none by the promo id on their request, or by the name beside one`, show([noRequest, byId, byName]))
    // Through checkMembershipDiscount, which reads the student's approved and applied requests.
    const viaCheck = async (requests) => {
      round4Whop()
      whop.answer = r4answer
      const db = readyDb('mem_r4E1', { discount_requests: requests }, 'user_r4E1', SID)
      return (await quiet(() => checkMembershipDiscount(fakeClient(db), SID, { apiKey: KEY }))).value
    }
    const none = await viaCheck([])
    const rejected = await viaCheck([{ id: 'r4', student_id: SID, status: 'rejected', created_at: AT.later }])
    ok(none.source === 'live' && none.discounted === true && none.code === OWN && rejected.discounted === true,
       'E1 through checkMembershipDiscount: no request, or a rejected one, so the other student\'s code is a coupon', show([none, rejected]))
    // A known limit: with a request of their own held, a code by their name is theirs whatever its promo id. The approve
    // route expects Whop to refuse a second code by one name, so the other student's would not be made (not checked).
    const heldOne = await viaCheck([{ id: 'r4', student_id: SID, status: 'approved', created_at: AT.later, promo_code: OWN, whop_promo_id: 'promo_r4Own' }])
    ok(heldOne.source === 'live' && heldOne.discounted === false,
       `known limit: this student holding an approved request of their own, another code named ${OWN} reads as theirs by its name`, show(heldOne))
  }

  // A body that cannot be read is kept nowhere: read again, the membership shows its code; a plan or a code's name too.
  {
    round4Whop()
    whop.answer = r4answer
    const ctx = newReadContext(KEY)
    const st = { id: SID, whop_membership_id: 'mem_r4S1', whop_user_id: 'user_r4S1', first_paid_at: PAID }
    const first = await judgeStudentDiscount(st, ctx)
    const firstReads = whop.log.length
    const again = await judgeStudentDiscount(st, ctx)
    ok(show(first) === show({ ok: false, fail: 'bad_shape' }) && firstReads === 1 && show(row4(again)) === show(want('membership', true, 'mem_r4S1', 'freemonth', 97, 97))
         && whop.log.filter((x) => x.path === '/api/v1/memberships/mem_r4S1').length === 2,
       'S1: the array body is no answer and nothing more is read; asked again, the membership is read again and shows its 100% code (it read as no code and was kept until this round)', show({ first, again: row4(again) }))
    round4Whop()
    whop.answer = (p) => (p === `/api/v1/plans/${MONTHLY}` || p === '/api/v1/promo_codes/promo_r4W50' ? json(200, [1]) : null)
    const ctx2 = newReadContext(KEY)
    const w = await judgeStudentDiscount({ id: SID, whop_membership_id: 'mem_r4WE', whop_user_id: 'user_r4WE', first_paid_at: PAID }, ctx2)
    ok(w.ok && w.row.discounted === true && w.row.promo_code_id === 'promo_r4W50' && w.row.promo_code === null && w.row.plan_renewal_price === null
         && !ctx2.plans.has(MONTHLY) && !ctx2.promoNames.has('promo_r4W50'),
       'a plan and a code\'s name answering a body that cannot be read: the code is a coupon all the same, named by its id, and neither answer is kept for the next read', show({ row: w.ok && w.row, plans: [...ctx2.plans.keys()], names: [...ctx2.promoNames.keys()] }))
    // A known limit until T-122's fifth fix round, when it read as a membership naming no code and no renewal price and
    // the payments decided (no code on them here: no coupon). An object of another id, or naming no code field, is no
    // answer since.
    const s4 = row4(await judge4('mem_r4S4', 'user_r4S4'))
    ok(show(s4) === show({ ok: false, fail: 'bad_shape' }),
       'a 200 whose body is an object naming none of the fields read (`{}`, no id): no answer (bad_shape), never "no code"', show(s4))
  }

  // Probe-we's row and the stored fallback: a stored no coupon answers only naming no code, or the student's own 30%
  // by the promo id on their own approved or applied request.
  const weRow = { student_id: SID, whop_membership_id: 'mem_r4WE', promo_code_id: 'promo_r4W50', promo_code: 'welcome50', renewal_price: 97, plan_renewal_price: 97, discounted: false, checked_at: '2026-10-21T09:00:00.500Z', source: 'membership' }
  // Since T-122's fifth fix round the preview's row is no answer by its source alone (a step's word, no stamp of this
  // rule), whatever it names; the cases below that test the code carry this rule's stamp (stampedBy).
  const weStamped = stampedBy(weRow, 'membership')
  {
    let rs = await routes4('mem_r4WE', 'user_r4WE', { down: true, db: { [MEMBERSHIP_DISCOUNTS_TABLE]: [weRow] } })
    ok(unchecked4(rs) && rs.every((x) => x.lines.some((l) => l.includes('Whop gave no answer (network)') && l.includes("its source is an older rule's"))),
       'probe-we: the world-engine preview\'s stored no coupon (source membership, naming welcome50), Whop down: both routes 503, nothing written (the request went in on it until the fourth round), and the log says why', show(brief4(rs)))
    rs = await routes4('mem_r4WE', 'user_r4WE', { down: true, db: { [MEMBERSHIP_DISCOUNTS_TABLE]: [weStamped] } })
    ok(unchecked4(rs) && rs.every((x) => x.lines.some((l) => l.includes("names a code that is not the student's own 30%"))),
       'the same row stamped by this rule, still naming welcome50: both routes 503 by its code, and the log says why', show(brief4(rs)))
    rs = await routes4('mem_r4WE', 'user_r4WE', { delayMs: 2100, db: { [MEMBERSHIP_DISCOUNTS_TABLE]: [weRow] } })
    ok(refused4(rs) && rs.every((x) => x.ms <= 8000), `the same row, Whop slow (2.1 s an answer): Whop's own answer refuses inside the 8 s (${rs.map((x) => `${x.ms} ms`).join(', ')})`, show(brief4(rs)))
    rs = await routes4('mem_r4WE', 'user_r4WE', { down: true, db: { [MEMBERSHIP_DISCOUNTS_TABLE]: [{ ...weStamped, promo_code_id: null, promo_code: null }] } })
    ok(rs.every((x) => x.status === 200 && x.written === 1), 'control: the stamped row naming no code, Whop down: the stored answer lets the request in', show(brief4(rs)))
    rs = await routes4('mem_r4WE', 'user_r4WE', { down: true, db: { [MEMBERSHIP_DISCOUNTS_TABLE]: [{ ...weRow, promo_code_id: null, promo_code: null }] } })
    ok(unchecked4(rs), 'the preview\'s row naming no code (its source a step\'s word alone), Whop down: both routes 503 (it let the request in until the fifth fix round)', show(brief4(rs)))
    const check = async (row, requests = []) => {
      round4Whop()
      whop.answer = () => 'throw'
      const db = readyDb('mem_r4WE', { [MEMBERSHIP_DISCOUNTS_TABLE]: [row], discount_requests: requests }, 'user_r4WE', SID)
      return (await quiet(() => checkMembershipDiscount(fakeClient(db), SID, { apiKey: KEY }))).value
    }
    const mine = (status, whopPromoId) => [{ id: 'r4', student_id: SID, status, created_at: AT.later, promo_code: OWN, whop_promo_id: whopPromoId }]
    const ownRow = { ...weStamped, promo_code_id: 'promo_r4Own', promo_code: OWN }
    const a = await check(weStamped)
    const b = await check({ ...weStamped, promo_code_id: null, promo_code: null })
    const c = await check(ownRow, mine('applied', 'promo_r4Own'))
    const c2 = await check(ownRow, mine('approved', 'promo_r4Own'))
    const d = await check(ownRow, mine('approved', 'promo_r4Elsewhere'))
    const e = await check(ownRow)
    const f = await check(ownRow, mine('rejected', 'promo_r4Own'))
    const g = await check({ ...weStamped, source: undefined, source_checked_at: undefined })
    ok(a.source === 'none' && b.source === 'stored' && b.discounted === false && c.source === 'stored' && c.discounted === false && c2.source === 'stored'
         && d.source === 'none' && e.source === 'none' && f.source === 'none' && g.source === 'none',
       'checkMembershipDiscount, Whop down: a stored no coupon with this rule\'s stamp answers naming no code (b), or their own 30% by the promo id on their applied or approved request (c); welcome50 (a), their code\'s name with another promo id on the request (d), with no request (e) or a rejected one (f), and no source (g) are no answer', show({ a: a.source, b: b.source, c: c.source, c2: c2.source, d: d.source, e: e.source, f: f.source, g: g.source }))
  }

  // Approve when the coupon check gives no answer: the normal Approve refused, Approve anyway going on.
  {
    const approve4 = async (membership, user, body, tables = {}, down = true) => {
      round4Whop()
      whop.answer = down ? () => 'throw' : r4answer
      const db = readyDb(membership, {
        discount_requests: [{ id: 'r4a', student_id: SID, status: 'pending', created_at: new Date(Date.parse(NOW) - 3_600_000).toISOString() }],
        admin_config: [{ key: 'curriculum_reset_at', value: '2026-10-19T14:33:00.000Z' }],
        ...tables,
      }, user, SID)
      const made = promoCodes.length
      const r = await quiet(async () => {
        const res = await approveRoute(new Request('http://app/api/discounts/approve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: 'r4a', ...body }) }))
        return { status: res.status, body: await res.json() }
      })
      return { ...r.value, made: promoCodes.length - made, request: db.rows('discount_requests')[0].status, lines: r.lines }
    }
    const plain = await approve4('mem_r4F', 'user_r4F', {})
    ok(plain.status === 503 && plain.body.code === 'rule' && plain.body.error === 'Whop gave no answer to the coupon check, so nothing was approved. Try again in a minute.'
         && plain.made === 0 && plain.request === 'pending' && plain.lines.some((l) => l.includes('nothing approved, the coupon check gave no answer (network)')),
       'Approve, Whop down and nothing stored: 503 with code "rule" and a plain sentence for the team, no Whop code made, the request still pending (it went on until this round)', show(plain))
    const anyway = await approve4('mem_r4F', 'user_r4F', { override: true })
    ok(anyway.status === 200 && anyway.made === 1 && anyway.request === 'approved' && anyway.lines.some((l) => l.includes('OVERRIDE') && l.includes('The coupon check gave no answer.')),
       'Approve anyway (override, a founder): approved past the check that gave no answer, the code made, the log line saying so', show({ status: anyway.status, lines: anyway.lines }))
    const weStored = await approve4('mem_r4WE', 'user_r4WE', {}, { [MEMBERSHIP_DISCOUNTS_TABLE]: [weRow] })
    ok(weStored.status === 503 && weStored.body.code === 'rule' && weStored.made === 0, 'probe-we\'s row stored, Whop down: the normal Approve refused the same way', show(weStored.body))
    const live = await approve4('mem_r4F', 'user_r4F', {}, {}, false)
    ok(live.status === 200 && live.made === 1 && live.request === 'approved', 'control: Whop answering, no code anywhere: Approve goes on as before', show(live.body))
    const coupon = await approve4('mem_r4WE', 'user_r4WE', { override: true }, {}, false)
    ok(coupon.status === 400 && coupon.body.code === 'has-discount' && coupon.made === 0, 'Approve anyway past the rule alone on welcome50, Whop answering: still the coupon\'s refusal, as before', show(coupon.body))
    // The 30% page offers Approve anyway on that refusal (its code "rule"), to a founder or an admin, naming the sentence.
    const skip = anywaySkip({ ok: true, reason: null }, plain.body.error)
    ok(skip === 'check' && approveAnywayText(skip, 'Every video done.', plain.body.error).includes(plain.body.error),
       'the 30% page: Approve anyway on that row skips "the check that refused this approval", its confirm naming the sentence', approveAnywayText(skip, 'Every video done.', plain.body.error))
    const refusal = typeof DS4.couponUncheckedApprovalRefusal === 'function' ? DS4.couponUncheckedApprovalRefusal : () => null
    const sentences = [null, 'network', 'http_other', 'rate_limited', 'time_budget', 'http_401_403', 'filter_ignored', 'bad_page', 'too_many_pages', 'bad_shape', 'no_api_key', 'no_course_product', 'no_whop_user', 'student_unread']
      .map((k) => refusal(k))
    ok(sentences.every((s) => typeof s === 'string' && s.endsWith('.') && !BANNED.test(s) && !/mem_|promo_|pay_|user_|@/.test(s)) && new Set(sentences).size === 7,
       'every refusal of the normal Approve is a plain sentence by its reason: no em dash, "unlock" or "EcomTalent", no Whop id', show([...new Set(sentences)]))
  }

  // Whop taking 2.5 s an answer: a student with no code answers inside the routes' 6 s and 8 s. Until this round 4
  // reads in a row (the membership, its plan, the list, the payments) put the payments past 6 s: the 503.
  {
    const rs = await routes4('mem_r4F', 'user_r4F', { delayMs: 2500 })
    ok(letIn4(rs) && rs.every((x) => x.asked === 3 && x.lastStart <= 6000 && x.ms <= 8000),
       `no code anywhere, 2.5 s an answer: both request routes 200, the request written, 3 Whop reads, the last started by 6 s and answered by 8 s (${rs.map((x) => `${x.name} ${x.ms} ms, last read started at ${x.lastStart} ms`).join('; ')})`,
       show(rs.map((x) => [x.name, x.status, x.asked, x.lastStart, x.ms])))
    round4Whop()
    whop.answer = r4answer
    whop.delayMs = 2500
    const t0 = Date.now()
    const r = await judgeStudentDiscount({ id: SID, whop_membership_id: 'mem_r4F', whop_user_id: 'user_r4F', first_paid_at: PAID }, newReadContext(KEY, t0 + 6000, t0 + 8000))
    const took = Date.now() - t0
    whop.delayMs = 0
    ok(show(row4(r)) === show(want('membership', false, 'mem_r4F', null, 97, null)) && took <= 5500
         && show(paths()) === show(['/api/v1/memberships/mem_r4F', '/api/v2/memberships?user_id=user_r4F&per=50&page=1', '/api/v1/payments?user_id=user_r4F&status=paid&first=100']),
       `judgeStudentDiscount on the routes' limits, the same: answered in ${took} ms, two answers' time and the pace's 250 ms; the membership, then the list and the payments together`, show({ row: row4(r), paths: paths() }))
    const coupon = await routes4('mem_r4WE', 'user_r4WE', { delayMs: 2500 })
    ok(refused4(coupon) && coupon.every((x) => x.ms <= 8000),
       `welcome50 on file, 2.5 s an answer: both routes 400 with the line inside the 8 s, 3 reads in a row (${coupon.map((x) => `${x.ms} ms`).join(', ')})`, show(coupon.map((x) => [x.name, x.status, x.ms])))
  }

  // The cron: every case in the window, each judged and stored; the answer counts the unusable lists and lists the
  // students the price alone refused.
  {
    const cid = (k) => `5a1b2c3d-0000-4000-8000-${String(k).padStart(12, '0')}`
    const sp = (k, membership, user) => ({ id: cid(k), first_paid_at: PAID, membership_status: 'active', whop_membership_id: membership, whop_user_id: user })
    const students = [
      ...refusedCases.map(([, membership, user], i) => sp(100 + i, membership, user)),
      ...letInCases.map(([, membership, user], i) => sp(200 + i, membership, user)),
      ...fallThroughCases.map(([, membership, user], i) => sp(300 + i, membership, user)),
      ...noAnswerCases.map(([, membership, user], i) => sp(400 + i, membership, user)),
    ]
    const run = async (q = '', down = false, tables = {}) => {
      round4Whop()
      whop.answer = down ? () => 'throw' : r4answer
      const db = new FakeDb({ students, ...tables })
      installDb(db)
      const r = await quiet(() => cron(q))
      return { status: r.value.status, b: r.value.body, rows: new Map(db.rows(MEMBERSHIP_DISCOUNTS_TABLE).map((x) => [x.student_id, x])) }
    }
    const dry = await run('?mode=dry')
    const d = dry.b
    const bySource = (list) => list.reduce((acc, [, , , w]) => ({ ...acc, [w.source]: (acc[w.source] ?? 0) + 1 }), { membership: 0, user: 0, payment: 0 })
    const expected = { membership: bySource(refusedCases).membership + letInCases.length + fallThroughCases.length, user: bySource(refusedCases).user, payment: bySource(refusedCases).payment }
    ok(dry.status === 200 && d.ok === true && d.mode === 'dry' && d.candidates === students.length && d.checked === students.length - noAnswerCases.length && d.written === 0
         && d.discounted === refusedCases.length && show(d.by_source) === show(expected) && d.user_list_unusable === 3
         && show(d.failed) === show({ bad_page: 2, filter_ignored: 1, too_many_pages: 1, bad_shape: 3 }) && d.left === 0,
       `the cron's dry run: ${students.length} students, ${students.length - noAnswerCases.length} answered (${refusedCases.length} coupons), the 3 whose v2 list answered 410 or 404 counted (user_list_unusable), the 7 that gave no answer in failed by kind, nothing written`, show(d))
    ok(show(d.refused_by_price) === show([{ student_id: cid(106), price: 1, billing_reason: 'subscription_create' }, { student_id: cid(107), price: 5, billing_reason: 'subscription_create' }]),
       'refused_by_price: the $1 and the $5 first weeks, each with its price and billing_reason, for the owner to rule on; no student a code refused, no Whop id', show(d.refused_by_price))
    const write = await run()
    ok(write.status === 200 && write.b.written === write.b.checked
         && refusedCases.every(([, , , w], i) => write.rows.get(cid(100 + i))?.discounted === true && write.rows.get(cid(100 + i))?.source === R5(w.source) && write.rows.get(cid(100 + i))?.whop_membership_id === w.membership)
         && [...letInCases, ...fallThroughCases].every((c, i) => write.rows.get(cid(i < letInCases.length ? 200 + i : 300 + i - letInCases.length))?.discounted === false)
         && noAnswerCases.every((c, i) => !write.rows.has(cid(400 + i))),
       'the write run: each case stored as a coupon with its source and the membership it names, the controls and the counted fall-throughs as none, nothing for the 7 that gave no answer', show([...write.rows.values()].map((x) => [x.student_id.slice(-3), x.discounted, x.source])))
    ok(!BANNED.test(show(d)) && !/mem_|promo_|pay_|user_/.test(show(d).replaceAll('"user_list_unusable"', '')), 'the answer names no Whop id')
    // Probe-we's row stored for the welcome50 student, Whop down: the cron writes nothing for them, so the row stays
    // until a run Whop answers, which stores the coupon (the write runs until left is 0, before anyone approves).
    const stale = await run('', true, { [MEMBERSHIP_DISCOUNTS_TABLE]: [{ ...weRow, student_id: cid(109) }] })
    ok(stale.status === 500 && stale.b.ok === false && stale.b.checked === 0 && stale.b.failed.network === students.length && stale.rows.get(cid(109))?.discounted === false,
       'Whop down for the cron: every student failed (network), nothing written, the preview\'s row as it was', show({ failed: stale.b.failed, row: stale.rows.get(cid(109)) }))
    const healed = await run('', false, { [MEMBERSHIP_DISCOUNTS_TABLE]: [{ ...weRow, student_id: cid(109) }] })
    ok(healed.rows.get(cid(109))?.discounted === true && healed.rows.get(cid(109))?.promo_code === 'welcome50' && healed.rows.get(cid(109))?.source === R5('membership'),
       'the next run Whop answers: the welcome50 student\'s row is the coupon, written by this rule', show(healed.rows.get(cid(109))))
  }
}

// ════════════════════════════════════════════════════════════════════════════
// T-122's fifth fix round (2026-10-22), the last. The fourth round passed its
// re-check with nothing blocking; each case here is one of the re-check's own
// (its probes a to e), run through judgeStudentDiscount, both request routes,
// the normal Approve and the cron where it applies. (1) THE RULE STAMP: a
// stored "no coupon" answers only when its source carries this rule's
// version and its source_checked_at is its checked_at, so the row an earlier
// round's build stored (a step's word alone: a89ff1c, the world-engine
// preview) and this rule's row written over by a build from before T-122 are
// no answer. (2) A student whose row cannot be read: only a stored coupon
// answers. (3) A membership read answering an object of another id, or
// naming no code field, is no answer; a payment naming no buyer is read for
// its code. (4) A membership of another product on file is passed over. (5)
// A payment naming no code that came to less than its subtotal is a coupon,
// the student's own 30% exempt. (6) Among the real payments at the first
// payment's moment the price judges the checkout, else the highest; the
// ended memberships are read at once. (7) A no coupon judged without the
// user's list is stored with no source. Every id and code here is made up.
console.log('\n=== T-122\'s fifth fix round: the rule stamp, an unread student, the shapes, another product, a discount with no code, the read order, the v2 shutdown ===')
{
  const MD5 = await import('./_gen/membership-discount.ts')
  const DS5 = await import('./_gen/discount-server.ts')
  // This round's functions, read so the section also runs on a copy of the round before (each then answers undefined).
  const missing = () => undefined
  const stampedByThisRule = typeof MD5.stampedByThisRule === 'function' ? MD5.stampedByThisRule : missing
  const storedSourceOf = typeof MD5.storedSourceOf === 'function' ? MD5.storedSourceOf : missing
  const discountWithoutCode = typeof MD5.discountWithoutCode === 'function' ? MD5.discountWithoutCode : missing
  const SID = '5a1b2c3d-0000-4000-8000-000000000005'
  const OWN = 'ECOM30-5A1B2C'
  const LINE_503 = "We couldn't check your membership just now. Try again in a minute."
  // The first payments are paid at PAID, the first_paid_at readyDb stores.
  const AT = { old: '2026-09-01T09:00:00.000Z', first: PAID, later: '2026-10-20T09:00:00.000Z' }
  const eur = (amount) => ({ amount, currency: 'eur' })
  /** Users whose payments list leaves the $0 rows out; memberships whose read answers as the test says. */
  const omitZero = new Set()
  const glitch = new Map()
  const r5answer = (p, n, u) => {
    const user = u.searchParams.get('user_id')
    if (p === '/api/v1/payments' && omitZero.has(user)) {
      const all = (whop.payments.get(user) ?? []).filter((x) => Number(x.total?.amount ?? x.total) !== 0)
      return json(200, { data: all, page_info: { has_next_page: false, end_cursor: null } })
    }
    const read = p.match(/^\/api\/v1\/memberships\/(.+)$/)
    if (read && glitch.has(read[1])) return glitch.get(read[1])(whop.memberships.get(read[1]))
    return null
  }
  function round5Whop() {
    resetWhop()
    omitZero.clear()
    glitch.clear()
    for (const [id, code] of [['promo_f5Free100', 'freemonth'], ['promo_f5W50', 'welcome50'], ['promo_f5Other20', 'other20'], ['promo_f5Own', OWN]]) whop.promos.set(id, { id, code })
    // Every membership here names its product, as Whop's schema has it (product_id is required).
    const m = (id, promo, renewal, more = {}) => whop.memberships.set(id, { id, status: 'active', promo_code_id: promo, renewal_price: renewal, plan_id: MONTHLY, product_id: COURSE, ...more })
    const P = (user, ...rows) => whop.payments.set(user, rows)
    const one = (k) => whop.byUser.set(`user_f5${k}`, [v2(`mem_f5${k}`, `user_f5${k}`)])
    const ended = (more = {}) => ({ status: 'canceled', valid: false, ...more })
    // F: the control, 97.00 at the checkout and no code anywhere.
    m('mem_f5F', null, '97.00'); one('F')
    P('user_f5F', pay('pay_f5F', 'user_f5F', '97.00', AT.first, { membership_id: 'mem_f5F', billing_reason: 'subscription_create' }))
    // S (item 1): a 100% first month on a membership since canceled, its 0.00 checkout left out of the list, back at
    // 97.00 on a new one (probe-b's S1 to S3).
    m('mem_f5Sold', 'promo_f5Free100', '97.00', { status: 'canceled' })
    m('mem_f5Snew', null, '97.00')
    whop.byUser.set('user_f5S', [v2('mem_f5Snew', 'user_f5S', { created_at: 1_760_900_000 }), v2('mem_f5Sold', 'user_f5S', ended({ created_at: 1_758_000_000 }))])
    P('user_f5S',
      pay('pay_f5Sb', 'user_f5S', '97.00', AT.first, { membership_id: 'mem_f5Snew', billing_reason: 'subscription_create' }),
      pay('pay_f5Sa', 'user_f5S', '0.00', AT.old, { subtotal: money('97.00'), membership_id: 'mem_f5Sold', promo_code_id: 'promo_f5Free100', billing_reason: 'subscription_create' }))
    omitZero.add('user_f5S')
    // U (item 2): welcome50 on the membership on file now; this rule's no coupon stored for the canceled one before it.
    m('mem_f5Uold', null, '97.00', { status: 'canceled' })
    m('mem_f5Unew', 'promo_f5W50', '97.00')
    whop.byUser.set('user_f5U', [v2('mem_f5Unew', 'user_f5U', { created_at: 1_760_900_000 }), v2('mem_f5Uold', 'user_f5U', ended({ created_at: 1_758_000_000 }))])
    P('user_f5U',
      pay('pay_f5Ub', 'user_f5U', '48.50', AT.later, onCode('promo_f5W50', '97.00', { membership_id: 'mem_f5Unew' })),
      pay('pay_f5Ua', 'user_f5U', '97.00', AT.first, { membership_id: 'mem_f5Uold' }))
    // W, E, K, I (item 3): a 100% code on the membership on file, its 0.00 checkout left out, the membership read
    // answering the object wrapped, `{}`, with no code field, or of another id. Leg: the key's older shape, the code
    // under promo_code alone, read as before.
    for (const [k, answer] of [
      ['W', (mm) => json(200, { data: mm })],
      ['E', () => json(200, {})],
      ['K', (mm) => json(200, Object.fromEntries(Object.entries(mm).filter(([key]) => key !== 'promo_code_id')))],
      ['I', (mm) => json(200, { ...mm, id: 'mem_f5Someone' })],
      ['Leg', (mm) => { const { promo_code_id, ...rest } = mm; return json(200, { ...rest, promo_code: { id: promo_code_id } }) }],
    ]) {
      m(`mem_f5${k}`, 'promo_f5Free100', '97.00'); one(k)
      P(`user_f5${k}`,
        pay(`pay_f5${k}b`, `user_f5${k}`, '97.00', AT.first, { membership_id: `mem_f5${k}`, billing_reason: 'subscription_cycle' }),
        pay(`pay_f5${k}a`, `user_f5${k}`, '0.00', AT.old, { subtotal: money('97.00'), membership_id: `mem_f5${k}`, promo_code_id: 'promo_f5Free100' }))
      omitZero.add(`user_f5${k}`)
      glitch.set(`mem_f5${k}`, answer)
    }
    // B (item 3): welcome50 named on the first payment alone, that row naming no buyer; B2 the control, a 10.00 row
    // naming no buyer and no code at the first payment's moment, the checkout 97.00 after it.
    m('mem_f5B', null, '97.00'); one('B')
    P('user_f5B',
      pay('pay_f5Bb', 'user_f5B', '97.00', AT.later, { membership_id: 'mem_f5B', billing_reason: 'subscription_cycle' }),
      { ...pay('pay_f5Ba', 'user_f5B', '48.50', AT.first, onCode('promo_f5W50', '97.00', { membership_id: 'mem_f5B', billing_reason: 'subscription_create' })), user: null })
    m('mem_f5B2', null, '97.00'); one('B2')
    P('user_f5B2',
      pay('pay_f5B2b', 'user_f5B2', '97.00', AT.later, { membership_id: 'mem_f5B2', billing_reason: 'subscription_create' }),
      { ...pay('pay_f5B2a', 'user_f5B2', '10.00', AT.first, { membership_id: null, billing_reason: 'one_time' }), user: null })
    // O (item 4): a membership of another product on file naming that product's code (39.20 of 49.00), the course
    // membership found through the user: O1 naming no code, O2 naming welcome50; O3 the course one on file.
    for (const k of ['O1', 'O2', 'O3']) {
      const user = `user_f5${k}`
      m(`mem_f5${k}x`, 'promo_f5Other20', '39.20', { plan_id: 'plan_f5Other', product_id: OTHER })
      m(`mem_f5${k}`, k === 'O2' ? 'promo_f5W50' : null, '97.00')
      whop.byUser.set(user, [v2(`mem_f5${k}x`, user, { product: OTHER, plan: 'plan_f5Other', created_at: 1_760_900_000 }), v2(`mem_f5${k}`, user)])
      P(user,
        pay(`pay_f5${k}b`, user, '39.20', AT.later, { subtotal: money('49.00'), product_id: OTHER, membership_id: `mem_f5${k}x`, promo_code_id: 'promo_f5Other20' }),
        pay(`pay_f5${k}a`, user, k === 'O2' ? '48.50' : '97.00', AT.first, { subtotal: money('97.00'), membership_id: `mem_f5${k}`, billing_reason: 'subscription_create', ...(k === 'O2' ? { promo_code_id: 'promo_f5W50' } : {}) }))
    }
    // X (item 5): a discount with no code named. X2 a 100% first month's 0.00 of 97.00, then 97.00; X3 a first-year
    // 873.00 of 970.00; X4 welcome50's EUR 44.95 of 89.90; X7 48.50 of 97.00 since refunded, then 97.00. X5 the
    // student's own 30% (67.90 of 97.00, named) after a 97.00 checkout; X6 a plan change's 12.34 of 97.00.
    m('mem_f5X2', null, '97.00'); one('X2')
    P('user_f5X2',
      pay('pay_f5X2b', 'user_f5X2', '97.00', AT.later, { membership_id: 'mem_f5X2', billing_reason: 'subscription_cycle' }),
      pay('pay_f5X2a', 'user_f5X2', '0.00', AT.first, { subtotal: money('97.00'), membership_id: 'mem_f5X2', billing_reason: 'subscription_create' }))
    m('mem_f5X3', null, '970.00', { plan_id: YEAR970 }); whop.byUser.set('user_f5X3', [v2('mem_f5X3', 'user_f5X3', { plan: YEAR970 })])
    P('user_f5X3', pay('pay_f5X3', 'user_f5X3', '873.00', AT.first, { subtotal: money('970.00'), membership_id: 'mem_f5X3', plan_id: YEAR970, billing_reason: 'subscription_create' }))
    m('mem_f5X4', null, eur('89.90'), { plan_id: 'plan_f5Eur' }); one('X4')
    P('user_f5X4', pay('pay_f5X4', 'user_f5X4', '44.95', AT.first, { currency: 'eur', total: eur('44.95'), subtotal: eur('89.90'), membership_id: 'mem_f5X4', billing_reason: 'subscription_create' }))
    m('mem_f5X5', null, '97.00'); one('X5')
    P('user_f5X5',
      pay('pay_f5X5b', 'user_f5X5', '67.90', AT.later, onCode('promo_f5Own', '97.00', { membership_id: 'mem_f5X5', billing_reason: 'subscription_cycle' })),
      pay('pay_f5X5a', 'user_f5X5', '97.00', AT.first, { membership_id: 'mem_f5X5', billing_reason: 'subscription_create' }))
    m('mem_f5X6', null, '97.00'); one('X6')
    P('user_f5X6',
      pay('pay_f5X6b', 'user_f5X6', '12.34', AT.later, { subtotal: money('97.00'), membership_id: 'mem_f5X6', billing_reason: 'subscription_update' }),
      pay('pay_f5X6a', 'user_f5X6', '97.00', AT.first, { membership_id: 'mem_f5X6', billing_reason: 'subscription_create' }))
    m('mem_f5X7', null, '97.00'); one('X7')
    P('user_f5X7',
      pay('pay_f5X7b', 'user_f5X7', '97.00', AT.first, { membership_id: 'mem_f5X7', billing_reason: 'subscription_create' }),
      pay('pay_f5X7a', 'user_f5X7', '48.50', AT.old, { subtotal: money('97.00'), membership_id: 'mem_f5X7', substatus: 'refunded', refunded_amount: money('48.50'), billing_reason: 'subscription_create' }))
    // L (item 6): at the first payment's moment, L2 a 10.00 add-on listed before the 97.00 checkout; L3 the same
    // naming no billing reason; L4 a 48.50 checkout (no discount shown) beside a 97.00 one-time charge.
    for (const [k, small, big] of [['L2', ['10.00', 'one_time'], ['97.00', 'subscription_create']], ['L3', ['10.00', null], ['97.00', null]], ['L4', ['97.00', 'one_time'], ['48.50', 'subscription_create']]]) {
      m(`mem_f5${k}`, null, '97.00'); one(k)
      P(`user_f5${k}`,
        pay(`pay_f5${k}b`, `user_f5${k}`, small[0], AT.first, { membership_id: null, billing_reason: small[1] }),
        pay(`pay_f5${k}a`, `user_f5${k}`, big[0], AT.first, { membership_id: `mem_f5${k}`, billing_reason: big[1] }))
    }
    // T (item 6): two course memberships since canceled beside the one on file; T2 no code anywhere, T3 the older
    // one on a 100% first month whose 0.00 checkout is left out.
    for (const k of ['T2', 'T3']) {
      const user = `user_f5${k}`
      m(`mem_f5${k}`, null, '97.00')
      m(`mem_f5${k}e0`, null, '97.00', { status: 'canceled' })
      m(`mem_f5${k}e1`, k === 'T3' ? 'promo_f5Free100' : null, '97.00', { status: 'canceled' })
      whop.byUser.set(user, [v2(`mem_f5${k}`, user, { created_at: 1_760_900_000 }), v2(`mem_f5${k}e0`, user, ended({ created_at: 1_759_500_000 })), v2(`mem_f5${k}e1`, user, ended({ created_at: 1_758_000_000 }))])
      P(user,
        pay(`pay_f5${k}`, user, '97.00', AT.first, { membership_id: `mem_f5${k}`, billing_reason: 'subscription_create' }),
        pay(`pay_f5${k}z`, user, '0.00', AT.old, { subtotal: money('97.00'), membership_id: `mem_f5${k}e1`, promo_code_id: 'promo_f5Free100' }))
      omitZero.add(user)
    }
    // V (item 7): the v2 list answering 410 (V410) or 404 (V404), no code on the membership on file or the payments;
    // Vc the same with a 0.00 checkout naming a 100% code listed.
    for (const [k, status] of [['V410', 410], ['V404', 404], ['Vc', 410]]) {
      m(`mem_f5${k}`, null, '97.00')
      whop.byUser.set(`user_f5${k}`, status)
      P(`user_f5${k}`,
        pay(`pay_f5${k}b`, `user_f5${k}`, '97.00', AT.first, { membership_id: `mem_f5${k}`, billing_reason: 'subscription_create' }),
        ...(k === 'Vc' ? [pay(`pay_f5${k}a`, `user_f5${k}`, '0.00', AT.old, { subtotal: money('97.00'), membership_id: 'mem_f5Vcold', promo_code_id: 'promo_f5Free100' })] : []))
    }
  }
  const want = (source, discounted, membership, code, price, against) => ({ source, discounted, membership, code, price, against })
  const row5 = (r) => (r.ok ? { source: r.source, discounted: r.row.discounted, membership: r.row.whop_membership_id, code: r.row.promo_code ?? r.row.promo_code_id, price: r.row.renewal_price, against: r.row.plan_renewal_price } : r)
  const judge5 = async (onFile, user, more = {}) => {
    round5Whop()
    whop.answer = r5answer
    return judgeStudentDiscount({ id: SID, whop_membership_id: onFile, whop_user_id: user, first_paid_at: PAID, ...more }, newReadContext(KEY))
  }
  /** Both request routes for the student: what each answered, wrote and stored, its Whop reads and when they started. */
  async function routes5(membership, user, more = {}) {
    const out = []
    for (const [name, route, path, body] of [['request', requestRoute, 'request', { studentId: SID }], ['submit-feedback', feedbackRoute, 'submit-feedback', { answers: ANSWERS }]]) {
      round5Whop()
      whop.answer = more.down ? () => 'throw' : r5answer
      whop.delayMs = more.delayMs ?? 0
      const db = readyDb(membership, more.db ?? {}, user, SID)
      if (more.failWhen) db.failWhen = more.failWhen
      if (more.prepare) await more.prepare(db)
      const t0 = Date.now()
      const r = await quiet(() => post(route, path, body))
      const stored = db.rows(MEMBERSHIP_DISCOUNTS_TABLE).find((x) => x.student_id === SID) ?? null
      out.push({ name, status: r.value.status, error: r.value.body.error ?? null, state: r.value.body.state ?? null,
        written: db.rows('discount_requests').length - (more.db?.discount_requests?.length ?? 0), rpc: db.calls('submit_discount_with_feedback', 'rpc').length,
        stored: stored && { discounted: stored.discounted, source: stored.source ?? null, sameWrite: stored.source_checked_at === stored.checked_at, membership: stored.whop_membership_id },
        asked: whop.log.length, starts: whop.log.map((x) => x.at - t0), ms: Date.now() - t0, lines: r.lines })
    }
    whop.delayMs = 0
    return out
  }
  /** The normal Approve, a founder's (the stand-in's login), on a pending request of the student. */
  async function approve5(membership, user, more = {}) {
    round5Whop()
    whop.answer = more.down ? () => 'throw' : r5answer
    const db = readyDb(membership, {
      discount_requests: [{ id: 'r5a', student_id: SID, status: 'pending', created_at: new Date(Date.parse(NOW) - 3_600_000).toISOString() }],
      admin_config: [{ key: 'curriculum_reset_at', value: '2026-10-19T14:33:00.000Z' }],
      ...(more.tables ?? {}),
    }, user, SID)
    if (more.failWhen) db.failWhen = more.failWhen
    if (more.prepare) await more.prepare(db)
    const made = promoCodes.length
    const r = await quiet(async () => {
      const res = await approveRoute(new Request('http://app/api/discounts/approve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: 'r5a' }) }))
      return { status: res.status, body: await res.json() }
    })
    return { status: r.value.status, code: r.value.body.code ?? null, error: r.value.body.error ?? null, made: promoCodes.length - made,
      request: db.rows('discount_requests').find((x) => x.id === 'r5a')?.status, lines: r.lines }
  }
  const refused5 = (rs) => rs.every((x) => x.status === 400 && x.error === LINE && x.state === 'not-eligible' && x.written === 0 && x.rpc === 0 && x.stored?.discounted === true)
  const letIn5 = (rs) => rs.every((x) => x.status === 200 && x.written === 1 && x.stored?.discounted === false)
  const unchecked5 = (rs) => rs.every((x) => x.status === 503 && x.error === LINE_503 && x.state === 'read-failed' && x.written === 0 && x.rpc === 0)
  const brief5 = (rs) => rs.map((x) => [x.name, x.status, x.written, x.stored?.discounted, x.stored?.source])
  const approvedOk = (a) => a.status === 200 && a.made === 1 && a.request === 'approved'
  const approveRefused = (a) => a.status === 400 && a.code === 'has-discount' && a.made === 0 && a.request === 'pending'
  const approveUnchecked = (a, sentence) => a.status === 503 && a.code === 'rule' && a.error === sentence && a.made === 0 && a.request === 'pending'
  const UNREADABLE = DS5.couponUncheckedApprovalRefusal('bad_shape')
  const NO_WHOP = DS5.couponUncheckedApprovalRefusal('network')
  const UNREAD = DS5.couponUncheckedApprovalRefusal('student_unread')

  // The cases judged with Whop answering: what each comes to, both request routes, and the normal Approve.
  const refusedCases = [
    ['(1) S: a 100% first month on a membership since canceled, its 0.00 checkout left out, back at 97.00 on a new one', 'mem_f5Snew', 'user_f5S', want('user', true, 'mem_f5Sold', 'freemonth', 97, 97)],
    ['(3) B: welcome50 named on the first payment alone, that row naming no buyer (it was skipped)', 'mem_f5B', 'user_f5B', want('payment', true, 'mem_f5B', 'welcome50', 48.5, 97)],
    ['(3) Leg: the membership naming its 100% code in the key\'s older shape (promo_code { id }, no promo_code_id): still read', 'mem_f5Leg', 'user_f5Leg', want('membership', true, 'mem_f5Leg', 'freemonth', 97, 97)],
    ['(4) O2: another product\'s membership on file naming its code, welcome50 on the course membership found through the user', 'mem_f5O2x', 'user_f5O2', want('user', true, 'mem_f5O2', 'welcome50', 97, 97)],
    ['(5) X2: a 100% first month\'s 0.00 of a 97.00 subtotal naming no code, then 97.00', 'mem_f5X2', 'user_f5X2', want('payment', true, 'mem_f5X2', null, 0, 97)],
    ['(5) X3: a first-year 873.00 of a 970.00 subtotal naming no code', 'mem_f5X3', 'user_f5X3', want('payment', true, 'mem_f5X3', null, 873, 970)],
    ['(5) X4: welcome50\'s EUR 44.95 of an 89.90 subtotal naming no code', 'mem_f5X4', 'user_f5X4', want('payment', true, 'mem_f5X4', null, 44.95, 89.9)],
    ['(5) X7: 48.50 of a 97.00 subtotal naming no code, since refunded, then 97.00', 'mem_f5X7', 'user_f5X7', want('payment', true, 'mem_f5X7', null, 48.5, 97)],
    ['(6) L4: the 48.50 checkout (subscription_create) beside a 97.00 one-time charge at the same moment: the checkout judged', 'mem_f5L4', 'user_f5L4', want('payment', true, 'mem_f5L4', null, 48.5, 97)],
    ['(7) Vc: the v2 list answering 410, a 0.00 checkout naming a 100% code listed: the coupon, its stamp kept', 'mem_f5Vc', 'user_f5Vc', want('payment', true, 'mem_f5Vcold', 'freemonth', 0, 97)],
  ]
  const letInCases = [
    ['control F: 97.00 at the checkout, no code anywhere', 'mem_f5F', 'user_f5F', want('membership', false, 'mem_f5F', null, 97, null)],
    ['(3) B2: a 10.00 row naming no buyer and no code at the first payment\'s moment, the 97.00 checkout after it: never judged by its price', 'mem_f5B2', 'user_f5B2', want('membership', false, 'mem_f5B2', null, 97, null)],
    ['(4) O1: another product\'s membership on file naming its code (other20), the course membership found through the user at 97.00, no code (it was refused by the other product\'s code)', 'mem_f5O1x', 'user_f5O1', want('user', false, 'mem_f5O1', null, 97, null)],
    ['(4) O3: the course membership on file, another product\'s naming its code on the list (left out by its product)', 'mem_f5O3', 'user_f5O3', want('membership', false, 'mem_f5O3', null, 97, null)],
    ['(5) X6: a plan change\'s 12.34 of a 97.00 subtotal (subscription_update) after a 97.00 checkout: not judged by its subtotal', 'mem_f5X6', 'user_f5X6', want('membership', false, 'mem_f5X6', null, 97, null)],
    ['(6) L2: a 10.00 add-on listed before the 97.00 checkout at the first payment\'s moment (it was refused by the 10.00)', 'mem_f5L2', 'user_f5L2', want('membership', false, 'mem_f5L2', null, 97, null)],
    ['(6) L3: the same with no billing reason named: the highest price judged', 'mem_f5L3', 'user_f5L3', want('membership', false, 'mem_f5L3', null, 97, null)],
    ['(6) T2: two course memberships since canceled beside the one on file, no code anywhere', 'mem_f5T2', 'user_f5T2', want('membership', false, 'mem_f5T2', null, 97, null)],
    ['(7) V410: the v2 list answering 410, no code on the membership on file or the payments: the live answer lets in', 'mem_f5V410', 'user_f5V410', want('membership', false, 'mem_f5V410', null, 97, null)],
    ['(7) V404: the same with a 404', 'mem_f5V404', 'user_f5V404', want('membership', false, 'mem_f5V404', null, 97, null)],
  ]
  const noAnswerCases = [
    ['(3) W: a 100% code on the membership on file, its read answering the object wrapped ({ data: {...} }), the 0.00 checkout left out (it was let in)', 'mem_f5W', 'user_f5W'],
    ['(3) E: the same read answering {} (it was let in)', 'mem_f5E', 'user_f5E'],
    ['(3) K: the same read naming neither promo_code_id nor promo_code (it was let in)', 'mem_f5K', 'user_f5K'],
    ['(3) I: the same read answering an object of another id', 'mem_f5I', 'user_f5I'],
  ]
  for (const [why, membership, user, w] of refusedCases) {
    const r = await judge5(membership, user)
    ok(show(row5(r)) === show(w) && r.row.source === R5(w.source) && r.row.source_checked_at === r.row.checked_at, `${why}: a coupon, stamped (judgeStudentDiscount)`, show(row5(r)))
    const rs = await routes5(membership, user)
    ok(refused5(rs) && rs.every((x) => x.stored.source === R5(w.source) && x.stored.sameWrite && x.stored.membership === w.membership),
       `${why}: both request routes 400 with the student's line, nothing written, the coupon stored with this rule's stamp`, show(brief5(rs)))
    const a = await approve5(membership, user)
    ok(approveRefused(a), `${why}: the normal Approve refused (400, has-discount), no Whop code made`, show(a))
  }
  for (const [why, membership, user, w] of letInCases) {
    const r = await judge5(membership, user)
    const unusable = /V4/.test(membership)
    ok(show(row5(r)) === show(w) && r.byPrice === null && r.bySubtotal === null && r.userListUnusable === unusable
         && (unusable ? r.row.source === null && r.row.source_checked_at === null : r.row.source === R5(w.source) && r.row.source_checked_at === r.row.checked_at),
       `${why}: no coupon (judgeStudentDiscount), ${unusable ? 'its row with no source (never trusted)' : 'stamped'}`, show({ row: row5(r), source: r.ok && r.row.source }))
    const rs = await routes5(membership, user)
    ok(letIn5(rs) && rs.every((x) => (unusable ? x.stored.source === null : x.stored.source === R5(w.source) && x.stored.sameWrite)),
       `${why}: both request routes 200, the request written, the answer stored ${unusable ? 'with no source' : 'with this rule\'s stamp'}`, show(brief5(rs)))
    const a = await approve5(membership, user)
    ok(approvedOk(a), `${why}: the normal Approve goes on, the code made`, show({ status: a.status, error: a.error }))
  }
  for (const [why, membership, user] of noAnswerCases) {
    const r = await judge5(membership, user)
    ok(show(r) === show({ ok: false, fail: 'bad_shape' }), `${why}: no answer (bad_shape), never "no code" (judgeStudentDiscount)`, show(r))
    const rs = await routes5(membership, user)
    ok(unchecked5(rs) && rs.every((x) => x.stored === null), `${why}: both request routes 503, "${LINE_503}", nothing written or stored`, show(brief5(rs)))
    const a = await approve5(membership, user)
    ok(approveUnchecked(a, UNREADABLE), `${why}: the normal Approve refused, 503 code rule, "${UNREADABLE}"`, show(a))
  }

  // (1) THE RULE STAMP. S's stored "no coupon" from builds that are not this rule, Whop down: no answer.
  {
    const earlier = { student_id: SID, whop_membership_id: 'mem_f5Snew', promo_code_id: null, promo_code: null, renewal_price: 97, plan_renewal_price: 97, discounted: false, checked_at: '2026-10-21T09:00:00.750Z', source: 'membership' }
    const stamped = stampedBy({ ...earlier, source: undefined }, 'membership')
    // A build from before T-122 writes over this rule's row as PostgREST's upsert does: its eight columns, no source.
    const writtenOver = async (db) => {
      const { error } = await fakeClient(db).from(MEMBERSHIP_DISCOUNTS_TABLE).upsert([{ student_id: SID, whop_membership_id: 'mem_f5Snew', promo_code_id: null, promo_code: null,
        renewal_price: 97, plan_renewal_price: 97, discounted: false, checked_at: '2026-10-21T10:40:00.000Z' }], { onConflict: 'student_id' })
      if (error) throw new Error(error.message)
    }
    let rs = await routes5('mem_f5Snew', 'user_f5S', { down: true, db: { [MEMBERSHIP_DISCOUNTS_TABLE]: [earlier] } })
    ok(unchecked5(rs) && rs.every((x) => x.lines.some((l) => l.includes("its source is an older rule's"))),
       '(1) S, Whop down, the "no coupon" a89ff1c or the world-engine preview stored for them (source membership, a step\'s word alone): both routes 503, nothing written (the request went in on it), the log says why', show(brief5(rs)))
    let a = await approve5('mem_f5Snew', 'user_f5S', { down: true, tables: { [MEMBERSHIP_DISCOUNTS_TABLE]: [earlier] } })
    ok(approveUnchecked(a, NO_WHOP), '(1) the normal Approve on that row, Whop down: refused, 503 code rule (it approved)', show(a))
    rs = await routes5('mem_f5Snew', 'user_f5S', { down: true, db: { [MEMBERSHIP_DISCOUNTS_TABLE]: [stamped] }, prepare: writtenOver })
    ok(unchecked5(rs) && rs.every((x) => x.lines.some((l) => l.includes('was written over since this rule wrote it'))),
       '(1) this rule\'s stamped row written over by a build from before T-122 (its upsert keeps the stamp, with a new checked_at), Whop down: both routes 503, the log says why', show(brief5(rs)))
    a = await approve5('mem_f5Snew', 'user_f5S', { down: true, tables: { [MEMBERSHIP_DISCOUNTS_TABLE]: [stamped] }, prepare: writtenOver })
    ok(approveUnchecked(a, NO_WHOP), '(1) the normal Approve on that row, Whop down: refused, 503 code rule', show(a))
    rs = await routes5('mem_f5F', 'user_f5F', { down: true, db: { [MEMBERSHIP_DISCOUNTS_TABLE]: [stampedBy({ ...earlier, whop_membership_id: 'mem_f5F', source: undefined }, 'membership')] } })
    ok(rs.every((x) => x.status === 200 && x.written === 1), 'control: the control student\'s no coupon with this rule\'s stamp, Whop down: the stored answer lets the request in', show(brief5(rs)))
    // Whop answering, the next write is this rule's, stamped, whatever the row held.
    rs = await routes5('mem_f5Snew', 'user_f5S', { db: { [MEMBERSHIP_DISCOUNTS_TABLE]: [earlier] } })
    ok(refused5(rs) && rs.every((x) => x.stored.source === R5('user') && x.stored.sameWrite), '(1) Whop answering: refused live, and the row rewritten with this rule\'s stamp', show(brief5(rs)))
    ok(stampedByThisRule(stamped) === true && !stampedByThisRule(earlier) && !stampedByThisRule({ ...stamped, checked_at: '2026-10-21T10:40:00.000Z' })
         && !stampedByThisRule({ ...stamped, source: 'r4-membership' }) && !stampedByThisRule({ ...stamped, source_checked_at: null })
         && stampedByThisRule({ ...stamped, source_checked_at: '2026-10-21T09:00:00.75+00:00' }) === true
         && show(MD5.STORED_SOURCES) === show(['r5-membership', 'r5-user', 'r5-payment']) && storedSourceOf('user') === 'r5-user',
       'stampedByThisRule: this rule\'s version and the same moment (as the database gives it back) alone; a step\'s word, another version, another checked_at or no time are not')
  }

  // (2) A student whose row cannot be read: only a stored coupon answers, and a line says so.
  {
    const unread = (q) => (q.table === 'students' && q.op === 'select' && q.columns === 'whop_membership_id, whop_user_id, first_paid_at' ? { code: 'XX000', message: 'connection reset' } : null)
    const oldClean = stampedBy({ student_id: SID, whop_membership_id: 'mem_f5Uold', promo_code_id: null, promo_code: null, renewal_price: 97, plan_renewal_price: null, discounted: false, checked_at: '2026-10-13T09:00:00.000Z' }, 'membership')
    let rs = await routes5('mem_f5Unew', 'user_f5U', { db: { [MEMBERSHIP_DISCOUNTS_TABLE]: [oldClean] } })
    ok(refused5(rs), '(2) control: U, the students read working, welcome50 on the membership on file now: refused live', show(brief5(rs)))
    rs = await routes5('mem_f5Unew', 'user_f5U', { db: { [MEMBERSHIP_DISCOUNTS_TABLE]: [oldClean] }, failWhen: unread })
    ok(unchecked5(rs) && rs.every((x) => x.asked === 0 && x.lines.some((l) => l.includes(`student ${SID}: the student's row could not be read, so Whop was not asked and no answer is on file`))),
       '(2) U, the students read failing, this rule\'s no coupon stored for the membership before: both routes 503 (the request went in on it), Whop not asked, a warning line', show(brief5(rs)))
    const a = await approve5('mem_f5Unew', 'user_f5U', { tables: { [MEMBERSHIP_DISCOUNTS_TABLE]: [oldClean] }, failWhen: unread })
    ok(approveUnchecked(a, UNREAD), `(2) the normal Approve, the students read failing: refused, 503 code rule, "${UNREAD}" (it approved)`, show(a))
    const coupon = { ...oldClean, whop_membership_id: 'mem_f5Unew', promo_code_id: 'promo_f5W50', promo_code: 'welcome50', discounted: true }
    rs = await routes5('mem_f5Unew', 'user_f5U', { db: { [MEMBERSHIP_DISCOUNTS_TABLE]: [coupon] }, failWhen: unread })
    ok(rs.every((x) => x.status === 400 && x.error === LINE && x.written === 0), '(2) the same with a stored coupon: refused with the student\'s line, as before', show(brief5(rs)))
  }

  // (5) The student's own 30% named on a payment stays no coupon by its subtotal: by the promo id on their request.
  {
    const own = row5(await judge5('mem_f5X5', 'user_f5X5', { ownThirtyPromoIds: ['promo_f5Own'] }))
    const named = row5(await judge5('mem_f5X5', 'user_f5X5', { holdsOwnThirty: true }))
    const none = row5(await judge5('mem_f5X5', 'user_f5X5'))
    ok(show(own) === show(want('membership', false, 'mem_f5X5', null, 97, null)) && show(named) === show(own) && none.discounted === true && none.code === OWN,
       `(5) X5: their own ${OWN} on a payment (67.90 of 97.00): no coupon by the promo id on their request or by the name beside one, never one by its subtotal; with no request of theirs, a coupon by the code`, show([own, named, none]))
    const shown = (p) => discountWithoutCode(p)
    const base = { total: 0, subtotal: 97, taxOnTop: 0, promoCodeId: null, billingReason: 'subscription_create' }
    ok(show(shown(base)) === show({ price: 0, subtotal: 97 }) && shown({ ...base, total: 97 }) === null && shown({ ...base, total: 96.99 })?.price === 96.99
         && shown({ ...base, total: 116.4, taxOnTop: 19.4 }) === null && shown({ ...base, total: 116.4, taxOnTop: 19.41 })?.price === 96.99
         && shown({ ...base, promoCodeId: 'promo_x' }) === null && shown({ ...base, billingReason: 'subscription_update' }) === null
         && shown({ ...base, subtotal: null }) === null && shown({ ...base, total: null }) === null,
       'discountWithoutCode: the price (the total less a tax added on top) below the subtotal, in cents; a code named, a plan change, or a figure that does not read: not judged')
  }

  // (6) The price's first payment, and the ended memberships read at once.
  {
    const cp = (paidAt, total, billingReason = null, more = {}) => ({ real: true, paidAt, total, currency: 'usd', billingReason, productId: COURSE, membershipId: null, promoCodeId: null, promoCode: null, subtotal: total, taxOnTop: 0, ...more })
    const addOn = cp(PAID, 10, 'one_time')
    const checkout = cp(PAID, 97, 'subscription_create')
    const big = cp(PAID, 97, null)
    const small = cp(PAID, 48.5, 'subscription_create')
    const noBuyer = cp('2026-10-01T09:00:00.000Z', 5, null, { buyerNamed: false })
    const frp = MD5.firstRealPayment
    ok(frp([addOn, checkout], PAID) === checkout && frp([checkout, addOn], PAID) === checkout && frp([cp(PAID, 10), big], PAID) === big
         && frp([big, small], PAID) === small && frp([addOn, checkout], null) === checkout && frp([noBuyer, checkout], null) === checkout && frp([noBuyer], null) === null,
       'firstRealPayment: at the first payment\'s moment the checkout (subscription_create), else the highest price, in any order; a row naming no buyer never')
    const rs = await routes5('mem_f5T2', 'user_f5T2', { delayMs: 2000 })
    ok(letIn5(rs) && rs.every((x) => x.asked === 5 && Math.max(...x.starts) <= 6000 && x.ms <= 8000 && x.starts[4] - x.starts[3] === 250),
       `(6) T2, Whop taking 2.0 s an answer: both request routes 200, the request written; the two canceled memberships read at once, the last read started by 6 s and answered by 8 s (${rs.map((x) => `${x.name} ${x.ms} ms, reads started at ${x.starts.join(', ')} ms`).join('; ')}; the 503 until this round)`,
       show(rs.map((x) => [x.name, x.status, x.asked, x.starts, x.ms])))
    const coupon = await routes5('mem_f5T3', 'user_f5T3', { delayMs: 2000 })
    ok(refused5(coupon) && coupon.every((x) => x.ms <= 8000 && x.stored.membership === 'mem_f5T3e1'),
       `(6) T3, the same, the older canceled membership on a 100% first month: both routes 400 with the line inside the 8 s (${coupon.map((x) => `${x.ms} ms`).join(', ')})`, show(brief5(coupon)))
    const t2 = await judge5('mem_f5T2', 'user_f5T2')
    ok(show(paths().slice(3).sort()) === show(['/api/v1/memberships/mem_f5T2e0', '/api/v1/memberships/mem_f5T2e1']) && t2.ok && t2.row.discounted === false,
       '(6) T2\'s reads: the one on file, the list beside the payments, then the two canceled ones', show(paths()))
  }

  // (7) A no coupon judged without the user's list is stored with no source, so Whop down it is no answer.
  {
    let stored = null
    const keep = async (db) => { stored = db }
    let rs = await routes5('mem_f5V410', 'user_f5V410', { prepare: keep })
    const row = stored.rows(MEMBERSHIP_DISCOUNTS_TABLE)[0]
    ok(letIn5(rs) && row.source === null && row.source_checked_at === null && row.discounted === false,
       '(7) V410, Whop answering: the request goes in on the live answer, its row stored with no source', show(row))
    rs = await routes5('mem_f5V410', 'user_f5V410', { down: true, db: { [MEMBERSHIP_DISCOUNTS_TABLE]: [{ ...row }] } })
    ok(unchecked5(rs) && rs.every((x) => x.lines.some((l) => l.includes('holds no source'))),
       '(7) the same student a minute later, Whop down, that row stored: both routes 503 (it never answers for the stored fallback)', show(brief5(rs)))
    const a = await approve5('mem_f5V410', 'user_f5V410', { down: true, tables: { [MEMBERSHIP_DISCOUNTS_TABLE]: [{ ...row }] } })
    ok(approveUnchecked(a, NO_WHOP), '(7) the normal Approve on that row, Whop down: refused, 503 code rule', show(a))
  }

  // The cron: every case in the window, judged and stored, each row as v113's check takes it (a check standing in for it
  // here: a source of this rule or none); the answer lists the students refused by a subtotal, apart from the price's.
  {
    const cid = (k) => `5a1b2c3d-0000-4000-8000-${String(k).padStart(12, '0')}`
    const sp = (k, membership, user) => ({ id: cid(k), first_paid_at: PAID, membership_status: 'active', whop_membership_id: membership, whop_user_id: user })
    const students = [
      ...refusedCases.map(([, membership, user], i) => sp(100 + i, membership, user)),
      ...letInCases.map(([, membership, user], i) => sp(200 + i, membership, user)),
      ...noAnswerCases.map(([, membership, user], i) => sp(300 + i, membership, user)),
    ]
    const v113Check = (q) => (q.table === MEMBERSHIP_DISCOUNTS_TABLE && q.op === 'upsert'
      && [].concat(q.values).some((v) => v.source !== null && v.source !== undefined && !['r5-membership', 'r5-user', 'r5-payment'].includes(v.source))
      ? { code: '23514', message: 'new row for relation "student_membership_discounts" violates check constraint "student_membership_discounts_source_check"' } : null)
    round5Whop()
    whop.answer = r5answer
    const db = new FakeDb({ students })
    db.failWhen = v113Check
    installDb(db)
    const r = await quiet(() => cron())
    const b = r.value.body
    const rows = new Map(db.rows(MEMBERSHIP_DISCOUNTS_TABLE).map((x) => [x.student_id, x]))
    ok(r.value.status === 200 && b.ok === true && b.checked === refusedCases.length + letInCases.length && b.written === b.checked
         && b.discounted === refusedCases.length && show(b.failed) === show({ bad_shape: noAnswerCases.length }) && b.user_list_unusable === 3 && b.left === 0,
       `the cron: ${students.length} students, ${b.checked} answered and written past v113's check (${refusedCases.length} coupons), the ${noAnswerCases.length} membership reads it cannot read in failed, the 3 lists answering 410 or 404 counted`, show(b))
    ok(refusedCases.every(([, , , w], i) => rows.get(cid(100 + i))?.discounted === true && rows.get(cid(100 + i))?.source === R5(w.source) && rows.get(cid(100 + i))?.source_checked_at === rows.get(cid(100 + i))?.checked_at)
         && letInCases.every(([, membership], i) => rows.get(cid(200 + i))?.discounted === false && rows.get(cid(200 + i))?.source === (/V4/.test(membership) ? null : R5(letInCases[i][3].source)))
         && noAnswerCases.every((c, i) => !rows.has(cid(300 + i))),
       'each coupon stored with this rule\'s stamp, each no coupon too but those judged without the user\'s list (no source), nothing for the reads it cannot read', show([...rows.values()].map((x) => [x.student_id.slice(-3), x.discounted, x.source])))
    const bySubtotal = (k, price, subtotal, currency) => ({ student_id: cid(k), price, subtotal, currency, billing_reason: 'subscription_create' })
    ok(show(b.refused_by_subtotal) === show([bySubtotal(104, 0, 97, 'usd'), bySubtotal(105, 873, 970, 'usd'), bySubtotal(106, 44.95, 89.9, 'eur'), bySubtotal(107, 48.5, 97, 'usd')])
         && show(b.refused_by_price) === show([{ student_id: cid(108), price: 48.5, billing_reason: 'subscription_create' }]),
       'refused_by_subtotal: the four a payment naming no code refused by its subtotal, each with its price, subtotal, currency and billing reason; refused_by_price: the checkout the price alone refused', show({ subtotal: b.refused_by_subtotal, price: b.refused_by_price }))
    ok(!BANNED.test(show(b)) && !/mem_|promo_|pay_|user_/.test(show(b).replaceAll('"user_list_unusable"', '')), 'the answer names no Whop id')
  }
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
