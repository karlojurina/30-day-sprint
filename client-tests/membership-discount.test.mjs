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
}
const json = (status, body, headers = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', ...headers },
})
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url))
  if (u.hostname !== 'api.whop.com') throw new Error(`the suite let a request go to ${u.hostname}`)
  const h = init.headers ?? {}
  whop.log.push({ path: u.pathname, query: u.search, version: h['Api-Version-Date'] ?? null, auth: h.Authorization ?? null, at: Date.now() })
  const special = whop.answer ? whop.answer(u.pathname, whop.log.length, u) : null
  if (special === 'hang') return new Promise(() => {})
  if (special === 'throw') throw new TypeError('fetch failed')
  if (special) return special
  if (u.pathname === '/api/v2/memberships') {
    // v2's pages: `per` rows a page, { current_page, total_page }.
    const per = Number(u.searchParams.get('per') ?? 10)
    const page = Number(u.searchParams.get('page') ?? 1)
    const all = whop.byUser.get(u.searchParams.get('user_id')) ?? []
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
    // A list that cannot be used: Whop ignored the user filter and answered with someone else's membership.
    ['user_devIgnored', [v2('mem_devSomeone', 'user_devSomeoneElse')]],
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
}
resetWhop()

const {
  WHOP_DISCOUNT_VERSION, MEMBERSHIP_DISCOUNTS_TABLE, REFRESH_START_BUDGET_MS, priceOf, idOf, isDiscounted, storedRowApplies,
  isMembershipId, newReadContext, readMembershipDiscount, checkMembershipDiscount, codeOf,
  FULL_PRICE, paidUnderFullPrice, courseProductIds, findCourseMemberships, judgeStudentDiscount, lacksSourceColumn, isNoAnswer,
  paymentCoupon,
} = await import('./_gen/membership-discount.ts')
const { fetchRealCoursePayments, taxOnTopOf } = await import('./_gen/first-payment.ts')
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
  ok(coupon(97, 97, 0, 'promo_devUsed50').discounted === false && coupon(970, 970, 0, 'promo_devYear10').discounted === false,
     'a code that took nothing off (a used one-month code on a full-price renewal, or yearly): none, as on the membership')
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
  ok(onFile.ok && onFile.source === 'membership' && onFile.row.discounted === true && onFile.row.source === 'membership' && onFile.row.whop_membership_id === 'mem_devEvolve'
       && !whop.log.some((r) => r.path.startsWith('/api/v2/') || r.path === '/api/v1/payments'),
     'a membership on file that reads: THE RULE on it, source "membership", no user or payment read', show(onFile))

  // 22 of the 46: a payment's id where the membership's belongs.
  const viaUser = await judge('pay_devPayment', 'user_devEvolvePay')
  ok(viaUser.ok && viaUser.source === 'user' && viaUser.row.discounted === true && viaUser.row.promo_code === 'evolve10'
       && viaUser.row.whop_membership_id === 'mem_devEvolve' && viaUser.row.source === 'user' && viaUser.row.renewal_price === 87.3 && viaUser.row.plan_renewal_price === 97,
     'a payment\'s id on file: the course membership found through the Whop user, evolve10 on it: discounted, the membership it judged stored', show(viaUser))
  ok(show(paths()) === show(['/api/v2/memberships?user_id=user_devEvolvePay&per=50&page=1', '/api/v1/memberships/mem_devEvolve', '/api/v1/plans/plan_devMonthly97', '/api/v1/promo_codes/promo_devEvolve'])
       && whop.log[0].version === null && whop.log.slice(1).every((r) => r.version === PINNED) && whop.log.every((r) => r.auth === `Bearer ${KEY}`),
     'v2\'s list by the user (no version pin, as the login\'s lookup reads it), then the membership, its plan and its code pinned', show(paths()))
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
  ok(order.ok && order.source === 'user' && order.row.whop_membership_id === 'mem_devEvolve' && order.row.discounted === true
       && show(paths()) === show(['/api/v2/memberships?user_id=user_devOrder&per=50&page=1', '/api/v1/plans/plan_devMonthly97', '/api/v1/memberships/mem_devEvolve', '/api/v1/promo_codes/promo_devEvolve']),
     'the order: of the course memberships that grant access (3, all on the monthly plan, read once to order them), active before past_due, then the newest; another product\'s and a canceled one never; the first with a discount answers and nothing after it is read', show(paths()))

  // 24 of the 46: no plan or no renewal price, no code named on the membership. The real payments decide: 87.30 is a
  // discount. Since T-122's second fix round every real payment is judged and the row names the membership of the
  // payment on a coupon (here mem_devOdd; it named the membership whose read gave no price until then).
  const price = await judge('mem_devNullPrice', 'user_devOdd')
  ok(price.ok && price.source === 'payment' && price.row.discounted === true && price.row.renewal_price === 87.3 && price.row.plan_renewal_price === 97
       && price.row.promo_code_id === 'promo_devEvolve' && price.row.promo_code === 'evolve10' && price.row.whop_membership_id === 'mem_devOdd' && price.row.source === 'payment' && price.noRealPayment === false,
     'a null renewal price, the latest real payment 87.30 (on evolve10): discounted, the payment\'s total and the 97.00 stored, the code named, the payment\'s membership named', show(price))
  ok(show(paths()) === show(['/api/v1/memberships/mem_devNullPrice', '/api/v1/payments?user_id=user_devOdd&status=paid&first=100', '/api/v1/promo_codes/promo_devEvolve'])
       && whop.log.every((r) => r.version === PINNED),
     'the membership, then the payments pinned (no user list: the membership is known, only its price is missing), then the code\'s name', show(paths()))
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

  // The user's list cannot be used: the payment decides, never a guess from it.
  const ignored = await judge('pay_devPayment', 'user_devNoCourse', (p) => (p === '/api/v2/memberships' ? json(200, { data: [v2('mem_devEvolve', 'user_devSomeoneElse')], pagination: { current_page: 1, total_page: 1 } }) : null))
  ok(ignored.ok && ignored.source === 'payment' && ignored.row.discounted === true, 'a list with another user\'s membership (Whop ignored the filter): the payment decides', show(ignored))
  const v2Gone = await judge('pay_devPayment', 'user_devNoCourse', (p) => (p === '/api/v2/memberships' ? json(404, {}) : null))
  const v2Odd = await judge('pay_devPayment', 'user_devNoCourse', (p) => (p === '/api/v2/memberships' ? json(200, { data: 'none' }) : null))
  ok(v2Gone.ok && v2Gone.source === 'payment' && v2Odd.ok && v2Odd.source === 'payment', 'a 404 for the list, or a list in another shape: the payment decides', show([v2Gone, v2Odd]))
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
  process.env.WHOP_PRODUCT_ID = COURSE
  ok(show(noProduct) === show({ ok: false, fail: 'no_course_product' }) && noProductOnFile.ok && noProductOnFile.source === 'membership',
     'WHOP_PRODUCT_ID naming no course product: no answer where the course must be found, and the membership on file still reads', show(noProduct))
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
  const ignoredList = await judge('pay_devPayment', 'user_devIgnored')
  ok(ignoredList.ok && ignoredList.source === 'payment' && ignoredList.row.discounted === true && ignoredList.row.promo_code_id === 'promo_devYear10' && ignoredList.row.whop_membership_id === null
       && show(paths()) === show(['/api/v2/memberships?user_id=user_devIgnored&per=50&page=1', '/api/v1/payments?user_id=user_devIgnored&status=paid&first=100', '/api/v1/promo_codes/promo_devYear10']),
     'a payment\'s id on file and a list that cannot be used (someone else\'s membership in it), the latest payment a yearly 873.00 naming a code: a coupon (none until the fix round); the list, the payments, the code\'s name (which Whop does not give here)', show({ ignoredList, paths: paths() }))
  // The controls: no code named, so the rule of thumb alone, on the price before any tax added on top.
  for (const [why, user, price] of [
    ['a 97.00 payment naming no code', 'user_devCtl97', 97],
    ['a 116.40 payment (97.00 and 20% tax added on top) naming no code', 'user_devCtlTax', 97],
    ['a $970 yearly payment naming no code', 'user_devCtl970', 970],
    ['a 97.00 payment with the tax inside the price ("inclusive") naming no code', 'user_devCtlIncl', 97],
    ['a 97.00 renewal naming a used one-month code that took nothing off', 'user_devUsedPay', 97],
  ]) {
    const r = await judge('mem_devCtlNull', user)
    ok(r.ok && r.source === 'payment' && r.row.discounted === false && r.row.renewal_price === price && r.row.plan_renewal_price === 97,
       `${why}: no coupon, ${price.toFixed(2)} against 97.00 stored`, show(r.ok && r.row))
  }

  // Step 2 reads every course membership that grants access. evolve10 on the older paid one, a free one given later.
  const freeLater = await judge('pay_devPayment', 'user_devFreeLater')
  ok(freeLater.ok && freeLater.source === 'user' && freeLater.row.discounted === true && freeLater.row.whop_membership_id === 'mem_devEvolve3' && freeLater.row.promo_code === 'evolve10',
     'a payment\'s id on file, an evolve10 monthly membership and a newer free course membership: a coupon, the row naming the membership that carried the code (until the fix round the newer free one was read alone: none)', show(freeLater))
  ok(show(paths()) === show(['/api/v2/memberships?user_id=user_devFreeLater&per=50&page=1', '/api/v1/plans/plan_devMonthly97', '/api/v1/plans/plan_devFree',
    '/api/v1/memberships/mem_devEvolve3', '/api/v1/promo_codes/promo_devEvolve']),
     'the two plans read to put the paid one first, and nothing read after the discount found', show(paths()))
  // The same student with the free one on file: a plan that renews at 0 has no renewal to discount, so step 2 answers.
  const freeOnFile = await judge('mem_devFree', 'user_devFreeLater')
  ok(freeOnFile.ok && freeOnFile.source === 'user' && freeOnFile.row.discounted === true && freeOnFile.row.whop_membership_id === 'mem_devEvolve3'
       && paths()[0] === '/api/v1/memberships/mem_devFree' && paths()[2].startsWith('/api/v2/memberships?user_id=user_devFreeLater'),
     'the free membership on file (the sync puts the newest that grants access there), evolve10 on the older paid one: a coupon through the Whop user (the membership on file answered none until the fix round)', show(freeOnFile))
  // No code on any: the paid one answers, before the free one.
  const freeFull = await judge('pay_devPayment', 'user_devFreeFull')
  ok(freeFull.ok && freeFull.source === 'user' && freeFull.row.discounted === false && freeFull.row.whop_membership_id === 'mem_devFull' && freeFull.row.plan_renewal_price === 97
       && paths().filter((p) => p.startsWith('/api/v1/memberships/')).join() === '/api/v1/memberships/mem_devFull,/api/v1/memberships/mem_devFree',
     'a full-price monthly membership and a newer free one: no coupon, both read, the paid one first, and the row naming it (paid plans before free)', show(paths()))
  const paidOnFile = await judge('mem_devFull', 'user_devFreeFull')
  ok(paidOnFile.ok && paidOnFile.source === 'membership' && paidOnFile.row.discounted === false && !whop.log.some((x) => x.path.startsWith('/api/v2/')),
     'a paid plan on file with no discount still answers by itself: the Whop user is not asked', show(paths()))
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
  // The payment read itself (first-payment.ts), on the coupon check's pace and limits.
  resetWhop()
  const pace = { nextAt: 0, requests: 0, retried429: 0 }
  const course = new Set([COURSE])
  const opts = { apiKey: KEY, pace, startBy: null, answerBy: null, productIds: course }
  const odd = await fetchRealCoursePayments('user_devOdd', opts)
  ok(odd.ok && odd.payments[0].total === 87.3 && odd.payments[0].paidAt === '2026-10-03T10:00:00.000Z' && odd.payments[0].promoCodeId === 'promo_devEvolve' && odd.payments[0].membershipId === 'mem_devOdd'
       && odd.seen === 5 && odd.kept === 2 && pace.requests === 1,
     'the newest real course payment by paid_at, whatever order Whop gives: a $0 one, a refunded one and another product\'s left out (5 seen, 2 kept), on the caller\'s pace', show(odd))
  ok(odd.ok && odd.payments[0].subtotal === 97 && odd.payments[0].taxOnTop === 0,
     'with its subtotal (97.00, before the code) and nothing on top (tax_amount null), read from the pinned shape (T-122\'s fix round)', show(odd.ok && odd.payments[0]))
  // T-122's second fix round: every real course payment, not the newest alone, each with its currency and its total in dollars.
  ok(odd.ok && show(odd.payments.map((x) => [x.paidAt.slice(0, 10), x.total])) === show([['2026-10-03', 87.3], ['2026-09-03', 97]])
       && odd.payments.every((x) => x.currency === 'usd' && x.usdTotal === null),
     'every real course payment, newest first by paid_at whatever order Whop gives, the currency its total names (usd), no usd_total on these', show(odd.ok && odd.payments.map((x) => [x.paidAt, x.total, x.currency, x.usdTotal])))
  whop.payments.set('user_devEurRead', [
    pay('pay_devEu1', 'user_devEurRead', '89.90', '2026-10-12T10:00:00.000Z', { currency: 'eur', total: { amount: '89.90', currency: 'eur' }, subtotal: { amount: '89.90', currency: 'eur' }, usd_total: money('97.00') }),
    pay('pay_devEu2', 'user_devEurRead', '89.90', '2026-10-13T10:00:00.000Z', { currency: null, total: { amount: '89.90', currency: 'EUR' }, usd_total: null }),
  ])
  const eurRead = await fetchRealCoursePayments('user_devEurRead', opts)
  ok(eurRead.ok && show(eurRead.payments.map((x) => [x.currency, x.usdTotal])) === show([['eur', null], ['eur', 97]]),
     'a payment\'s currency is its `currency`, else its total\'s own, lower case; its usd_total read as dollars, null when Whop gives none', show(eurRead))
  const taxed = await fetchRealCoursePayments('user_devTaxed', opts)
  const incl = await fetchRealCoursePayments('user_devCtlIncl', opts)
  ok(taxed.ok && taxed.payments[0].total === 104.76 && taxed.payments[0].subtotal === 97 && taxed.payments[0].taxOnTop === 17.46 && taxed.payments[0].promoCodeId === 'promo_devEvolve'
       && incl.ok && incl.payments[0].total === 97 && incl.payments[0].taxOnTop === 0,
     'a tax added on top read as on top (17.46 of 104.76), one inside the price ("inclusive") as nothing on top', show([taxed.ok && taxed.payments[0], incl.ok && incl.payments[0]]))
  const noFields = pay('pay_devX1', 'user_devNoTaxField', '97.00', '2026-10-12T10:00:00.000Z', onCode('promo_devEvolve', '97.00'))
  delete noFields.subtotal
  delete noFields.tax_amount
  whop.payments.set('user_devNoTaxField', [noFields])
  const bare = await fetchRealCoursePayments('user_devNoTaxField', opts)
  ok(bare.ok && bare.payments[0].subtotal === null && bare.payments[0].taxOnTop === null && bare.payments[0].promoCodeId === 'promo_devEvolve',
     'a payment without subtotal and tax_amount (another shape): both not known (null), never 0', show(bare.ok && bare.payments[0]))
  whop.payments.set('user_devLegacyTax', [
    { id: 'pay_devL4', status: 'paid', paid_at: 1_759_700_000, total: 104.76, subtotal: 97, tax_amount: 17.46, tax_behavior: 'exclusive', refunded_amount: 0, user: { id: 'user_devLegacyTax' }, product: { id: COURSE }, promo_code: { id: 'promo_devL', code: 'legacy10' } },
  ])
  const legacyTax = await fetchRealCoursePayments('user_devLegacyTax', opts)
  ok(legacyTax.ok && legacyTax.payments[0].subtotal === 97 && legacyTax.payments[0].taxOnTop === 17.46 && legacyTax.payments[0].promoCodeId === 'promo_devL'
       && paymentCoupon(legacyTax.payments[0]).discounted === true,
     'the key\'s older shape (bare numbers, the code nested) reads the same subtotal and tax', show(legacyTax.ok && legacyTax.payments[0]))
  whop.payments.set('user_devLegacy', [
    { id: 'pay_devL1', status: 'paid', paid_at: 1_759_500_000, total: 87.3, refunded_amount: 0, user: { id: 'user_devLegacy' }, product: { id: COURSE }, membership: { id: 'mem_devL' }, promo_code: { id: 'promo_devL', code: 'legacy10' } },
    { id: 'pay_devL2', status: 'paid', paid_at: 1_759_600_000, total: 40, user: { id: 'user_devLegacy' } },
    { id: 'pay_devL3', status: 'pending', paid_at: null, total: 97, user: { id: 'user_devLegacy' }, product: { id: COURSE } },
  ])
  const legacy = await fetchRealCoursePayments('user_devLegacy', opts)
  ok(legacy.ok && legacy.payments[0].total === 40 && legacy.payments[0].productId === null && legacy.kept === 2,
     'the older shape reads too (a number, nested ids); a payment naming no product is kept, a pending one is not', show(legacy))
  whop.payments.set('user_devLegacy', [whop.payments.get('user_devLegacy')[0]])
  const legacyOne = await fetchRealCoursePayments('user_devLegacy', opts)
  ok(legacyOne.ok && legacyOne.payments[0].promoCode === 'legacy10' && legacyOne.payments[0].promoCodeId === 'promo_devL' && legacyOne.payments[0].membershipId === 'mem_devL',
     'and its nested code carries its name', show(legacyOne))
  whop.payments.set('user_devPages', Array.from({ length: 150 }, (_, i) => pay(`pay_devPg${i}`, 'user_devPages', i === 120 ? '87.30' : '97.00', new RealDate(Date.parse('2026-01-01T00:00:00.000Z') + i * 86_400_000).toISOString())))
  const pages = await fetchRealCoursePayments('user_devPages', opts)
  ok(pages.ok && pages.seen === 150 && pages.payments[0].total === 97 && pages.payments[0].paidAt.startsWith('2026-05-30'), 'two pages, by the cursor: the newest of all 150', show(pages.ok && pages.payments[0]))
  whop.payments.set('user_devEndless', Array.from({ length: 1500 }, (_, i) => pay(`pay_devE${i}`, 'user_devEndless', '97.00', '2026-10-01T00:00:00.000Z')))
  const endless = await fetchRealCoursePayments('user_devEndless', opts)
  ok(show(endless) === show({ ok: false, fail: 'too_many_pages' }), 'more than 10 pages for one user: no answer (too_many_pages)', show(endless))
  const noKey = await fetchRealCoursePayments('user_devOdd', { ...opts, apiKey: '' })
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
       && row.renewal_price === 87.3 && row.plan_renewal_price === 97 && row.discounted === true && row.checked_at === new Date().toISOString() && row.source === 'membership',
     'and the answer is stored for the map and the admin page, with the step that answered (v113)', show(row))
  ok(live.lines.length === 0, 'nothing is logged when Whop answers')
}
{
  resetWhop()
  // Every student has a Whop user on production (the column is NOT NULL), and since T-122's second fix round a
  // membership with no discount is followed by the user's payments (none here).
  const db = new FakeDb({ students: [{ id: 's1', whop_membership_id: 'mem_devUsed', whop_user_id: 'user_devFullPay' }], [MEMBERSHIP_DISCOUNTS_TABLE]: [storedEvolve('s1', 'mem_devUsed')] })
  const r = await checkMembershipDiscount(fakeClient(db), 's1', { apiKey: KEY })
  ok(r.discounted === false && r.source === 'live' && db.rows(MEMBERSHIP_DISCOUNTS_TABLE)[0].discounted === false && db.rows(MEMBERSHIP_DISCOUNTS_TABLE).length === 1,
     'a code used up since the last read: Whop now says no, and the stored row is set right (one row per student)', show(r))
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
     'neither Whop nor a stored row: no answer on file (the caller decides: the request routes refuse, the approve route goes on), and the log says so')
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
       && row2.whop_membership_id === 'mem_devFull' && row2.source === 'user' && row2.discounted === false && r2.lines.length === 0,
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
       && row3.source === 'payment' && row3.renewal_price === 87.3 && row3.plan_renewal_price === 97 && row3.whop_membership_id === 'mem_devOdd',
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
function readyDb(membership, more = {}, user = 'user_devFullPay') {
  setCatalog({ v2: true, lessonsTable: 'lessons_next' })
  const db = new FakeDb({
    students: [{ id: 's1', supabase_user_id: 'auth-1', first_paid_at: PAID, joined_at: PAID, whop_membership_id: membership, whop_user_id: user }],
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
    ok(r.value.status === status && (status === 400 ? r.value.body.error === LINE && wrote === 0 : wrote === 1) && stored?.source === source && stored?.discounted === (status === 400),
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
    ['a payment\'s id on file and a list that cannot be used, the latest payment a yearly 873.00 naming a code', 'pay_devNotAMembership', 'user_devIgnored', 400, null],
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
  resetWhop()
  whop.answer = () => 'throw'
  db = readyDb('mem_devEvolve', { [MEMBERSHIP_DISCOUNTS_TABLE]: [{ ...storedEvolve('s1'), promo_code_id: null, promo_code: null, renewal_price: 97, discounted: false }] })
  r = await quiet(() => post(route, path, body))
  ok(r.value.status === 200 && db.rows('discount_requests').length === 1,
     'Whop down, the stored row for this membership says no discount: the request goes in on the stored answer', show(r.value))

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
  resetWhop()
  whop.answer = () => 'throw'
  db = approveDb('mem_devEvolve')
  made = promoCodes.length
  r = await quiet(() => approve(false))
  ok(r.value.status === 200 && promoCodes.length === made + 1, 'Whop down, nothing stored: the approval goes on', show(r.value.body))
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
  // Since T-122's second fix round a membership with no discount is followed by the student's real payments.
  ok(whop.log.length === 4 && whop.log.every((x) => x.version === PINNED) && whop.log[0].path === '/api/v1/memberships/mem_devUsed' && whop.log[3].path === '/api/v1/payments',
     'one live read, pinned: the membership, its plan, its code, then the student\'s payments', whop.log.map((x) => x.path).join())
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
  ok(r.value.status === 200 && show(r.value.body) === show({ discounted: false, code: null }) && row.whop_membership_id === 'mem_devFull' && row.source === 'user' && row.discounted === false,
     'checked again: 200, the course membership found through the Whop user renews at full price, stored for that membership', show({ body: r.value.body, row }))
  const after = await listedRow(db)
  ok(after?.verdict?.ok === true && after.coupon?.discounted === false && after.couponCheck === 'stored',
     'the list read after it: the row is the rule\'s again, Approve back', show(after?.verdict))
  resetWhop()
  const none = checkDb(null, {}, 'user_devEvolvePay')
  const r2 = await quiet(() => checkAgain())
  ok(r2.value.status === 200 && show(r2.value.body) === show({ discounted: true, code: 'evolve10' }) && none.rows(MEMBERSHIP_DISCOUNTS_TABLE)[0].source === 'user',
     'no membership on file: 200, evolve10 on the one found through the Whop user', show(r2.value))
  resetWhop()
  const odd = checkDb('mem_devNullPrice', {}, 'user_devCtl97')
  const r3 = await quiet(() => checkAgain())
  ok(r3.value.status === 200 && show(r3.value.body) === show({ discounted: false, code: null }) && odd.rows(MEMBERSHIP_DISCOUNTS_TABLE)[0].source === 'payment'
       && (await listedRow(odd))?.verdict?.ok === true,
     'a null renewal price: 200, judged by the real payments (one, 97.00, no code on it), and the list shows Approve again', show(r3.value))
  // T-122's second fix round: an 87.30 on evolve10 before the newest 97.00 is a coupon (the newest alone gave Approve back until then).
  resetWhop()
  const oddFull = checkDb('mem_devNullPrice', {}, 'user_devOddFull')
  const r3b = await quiet(() => checkAgain())
  ok(r3b.value.status === 200 && show(r3b.value.body) === show({ discounted: true, code: 'evolve10' }) && oddFull.rows(MEMBERSHIP_DISCOUNTS_TABLE)[0].source === 'payment'
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
  ok(b.checked === 12 && show(b.by_source) === show({ membership: 6, user: 2, payment: 4 }) && b.no_real_payment === 1 && b.discounted === 9 && b.written === 12
       && show(b.failed) === show({ http_other: 1 }) && b.left === 0 && !('skipped' in b),
     '12 answered and written (9 discounted, s-no-plan\'s 87.30 among them since the second fix round): 6 from the membership on file, 2 through the Whop user (a payment\'s id, a membership Whop does not know), 4 from the real payments (no price, no plan, no course membership, and one with no payment at all); failed holds only the one Whop gave no answer for, and nobody is skipped any more', show(b))
  ok(rows.get('s-evolve')?.discounted === true && rows.get('s-evolve')?.promo_code === 'evolve10' && rows.get('s-used')?.discounted === false
       && rows.get('s-full')?.discounted === false && rows.get('s-year')?.discounted === true && rows.get('s-pending')?.discounted === true && rows.get('s-rejected')?.discounted === true,
     'each row as Whop said: evolve10 yes, used up no, full price no, yearly code yes; a pending and a rejected request are read too')
  ok(rows.get('s-pay')?.discounted === true && rows.get('s-pay')?.source === 'user' && rows.get('s-pay')?.whop_membership_id === 'mem_devEvolve'
       && rows.get('s-missing')?.discounted === true && rows.get('s-missing')?.source === 'user' && rows.get('s-missing')?.whop_membership_id === 'mem_devEvolve2'
       && rows.get('s-null-price')?.discounted === true && rows.get('s-null-price')?.source === 'payment' && rows.get('s-null-price')?.renewal_price === 87.3
       && rows.get('s-no-plan')?.discounted === true && rows.get('s-no-plan')?.source === 'payment' && rows.get('s-no-plan')?.renewal_price === 87.3
       && rows.get('s-no-course')?.discounted === true && rows.get('s-no-course')?.source === 'payment'
       && rows.get('s-none')?.discounted === false && rows.get('s-none')?.source === 'payment' && rows.get('s-none')?.renewal_price === null
       && rows.get('s-evolve')?.source === 'membership',
     'T-122\'s rows: a payment\'s id and an unknown id through the Whop user (evolve10, stored for the membership judged), no price 87.30 yes, no plan with an 87.30 on evolve10 before its 97.00 yes (no until the second fix round), no course membership 87.30 yes, no payment at all no; each with its source')
  ok(!rows.has('s-sept') && !rows.has('s-canceled') && !rows.has('s-expired') && !rows.has('s-nopay') && !rows.has('s-approved') && !rows.has('s-applied'),
     'nobody outside the window and nobody with the 30% already is written')
  ok(rows.get('s-down')?.checked_at === '2026-10-21T07:00:00.000Z' && rows.get('s-down')?.discounted === true, 'the one Whop gave no answer for keeps the row it had')
  const reads = (prefix) => whop.log.filter((x) => x.path.startsWith(prefix)).length
  ok(reads('/api/v1/plans/') === 2 && reads('/api/v1/memberships/') === 12 && reads('/api/v2/memberships') === 4 && reads('/api/v1/payments') === 6,
     'each plan read once (2 plans); 12 membership reads (one per member on file, one per membership found through a user, 2 for the unknown id); 4 user lists; 6 payment reads (since the second fix round also for the 2 whose membership has no discount)', show(whop.log.map((x) => x.path)))
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
       && rows.get('f-free-later')?.whop_membership_id === 'mem_devEvolve3' && rows.get('f-free-on-file')?.whop_membership_id === 'mem_devEvolve3' && rows.get('f-free-on-file')?.source === 'user'
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
  ok(/add column if not exists source text;/.test(v113) && /check \(source is null or source in \('membership', 'user', 'payment'\)\)/.test(v113)
       && /^begin;/m.test(v113) && /^commit;/m.test(v113) && /set local lock_timeout = '5s';/.test(v113) && !/create policy|grant |revoke /.test(v113),
     'v113 adds source, held to the three steps or empty, in one transaction with 5 seconds for a lock, and touches no policy or privilege')
  ok(/drop column if exists source;/.test(v113undo) && /alter table if exists public\.student_membership_discounts/.test(v113undo), 'its undo drops the column, and runs again with nothing to drop')
  const src = read('../src/lib/membership-discount.ts')
  ok(/MEMBERSHIP_DISCOUNT_COLUMNS =\s+"student_id, whop_membership_id, promo_code_id, promo_code, renewal_price, plan_renewal_price, discounted, checked_at";/.test(src)
       && !/\.select\([^)]*source/.test(src),
     'no read selects source, so every read answers on a database without v113')
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
// (round2Whop, made-up ids), so it runs unchanged against the previous commit.
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

  // The owner's rule, case by case: judgeStudentDiscount, then both request routes.
  const blocking = [
    ['BLOCKING: welcome50 (one month, 50%) on file, paid 48.50 on the 97.00 plan, renewing at 97.00', 'mem_devW50', 'user_devW50',
      { source: 'payment', discounted: true, membership: 'mem_devW50', code: 'welcome50', codeId: 'promo_devW50', price: 48.5, against: 97 }],
    ['BLOCKING: a first-year 10% on the $970 yearly on file, paid 873.00, renewing at 970.00 (the code\'s name not given)', 'mem_devFirstYear', 'user_devFirstYear',
      { source: 'payment', discounted: true, membership: 'mem_devFirstYear', code: null, codeId: 'promo_devFirstYear', price: 873, against: 970 }],
    ['evolve10 on an older course membership, a newer full-price one on file: the row names the payment\'s membership', 'mem_devFullNew', 'user_devTwoPaid',
      { source: 'payment', discounted: true, membership: 'mem_devEvolveOld', code: 'evolve10', codeId: 'promo_devEvolve', price: 87.3, against: 97 }],
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
  // The reads: a membership with no discount is followed by the payments, on the same pace and pin; a name read once.
  {
    await judge2('mem_devW50', 'user_devW50')
    ok(show(paths()) === show(['/api/v1/memberships/mem_devW50', '/api/v1/plans/plan_devMonthly97', '/api/v1/promo_codes/promo_devW50', '/api/v1/payments?user_id=user_devW50&status=paid&first=100'])
         && whop.log.every((x) => x.version === PINNED) && whop.log.slice(1).every((x, i) => x.at - whop.log[i].at >= 250),
       'welcome50: the membership, its plan, the code\'s name (read once, the payment names the same code), then the payments, pinned, 4 a second', show(paths()))
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
    ['EUR 89.90 with usd_total 97.00, naming no code (read as 89.90 dollars until the second fix round)', 'user_devREur', 97, 97],
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
    const r = rowOf2(await judge2('mem_devFull', 'user_devRNull'))
    ok(show(r) === show({ source: 'membership', discounted: false, membership: 'mem_devFull', code: null, codeId: null, price: 97, against: 97 })
         && paths().at(-1) === '/api/v1/payments?user_id=user_devRNull&status=paid&first=100',
       'control, a full-price membership on file and 97.00 holding a tax of unknown behaviour: the payments read after it, no coupon, the membership\'s row', show({ r, paths: paths() }))
    ok(letIn(await bothRoutes('mem_devFull', 'user_devRNull')), 'and both request routes let the request in')
  }
  // In another currency, on a coupon: the code still decides, and with a usd_total so does 97.00 in dollars.
  for (const [why, user, price, against] of [
    ['EUR 44.95 on welcome50 (of 89.90), no usd_total: the code that took money off decides', 'user_devREurCode', 44.95, 89.9],
    ['EUR 80.00 naming no code, 86.30 in dollars: under 97.00 in dollars', 'user_devREurLow', 86.3, 97],
  ]) {
    const r = rowOf2(await judge2('mem_devCtlNull', user))
    ok(r.ok !== false && r.source === 'payment' && r.discounted === true && r.price === price && r.against === against, `${why}: a coupon`, show(r))
  }
  ok(show(paymentCoupon({ total: 89.9, subtotal: 89.9, taxOnTop: 0, promoCodeId: null, currency: 'eur', usdTotal: 97 })) === show({ price: 97, heldAgainst: 97, discounted: false })
       && show(paymentCoupon({ total: 89.9, subtotal: 89.9, taxOnTop: 0, promoCodeId: null, currency: 'eur', usdTotal: null })) === show({ price: 89.9, heldAgainst: null, discounted: false })
       && show(paymentCoupon({ total: 97, subtotal: 97, taxOnTop: 0, promoCodeId: null, currency: 'usd', usdTotal: null })) === show({ price: 97, heldAgainst: 97, discounted: false }),
     'paymentCoupon in another currency: held against 97.00 at its usd_total\'s rate, not at all without one; in dollars as before', show(paymentCoupon({ total: 89.9, subtotal: 89.9, taxOnTop: 0, promoCodeId: null, currency: 'eur', usdTotal: 97 })))

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

  // The team's own 30% code (ECOM30-..., the approve route's): never a coupon holder because of it.
  ok(typeof MD2.isTeamThirtyCode === 'function' && MD2.isTeamThirtyCode(THIRTY_NAME) && MD2.isTeamThirtyCode('ecom30-ab12cd')
       && !MD2.isTeamThirtyCode('evolve10') && !MD2.isTeamThirtyCode(null) && !MD2.isTeamThirtyCode('XECOM30'),
     'the team\'s own 30% code is an ECOM30 code, as the 30% page reads it; a code whose name is not known is not one')
  {
    const used = rowOf2(await judge2('mem_devThirtyUsed', 'user_devThirty'))
    ok(show(used) === show({ source: 'membership', discounted: false, membership: 'mem_devThirtyUsed', code: THIRTY_NAME, codeId: THIRTY, price: 97, against: 97 }),
       'the team\'s 30% used (the membership renews at 97.00), its 67.90 payment on the team\'s code: no coupon, the payment left out', show(used))
    const noPrice = rowOf2(await judge2('mem_devThirtyNoPrice', 'user_devThirty'))
    ok(noPrice.ok !== false && noPrice.discounted === false && noPrice.source === 'payment' && noPrice.membership === 'mem_devThirtyNoPrice',
       'the team\'s code named on a membership with no renewal price: not a coupon by itself, and its payments show none but the 30%', show(noPrice))
    const both = rowOf2(await judge2('mem_devThirtyUsed', 'user_devThirtyW50'))
    ok(show(both) === show({ source: 'payment', discounted: true, membership: 'mem_devThirtyUsed', code: 'welcome50', codeId: 'promo_devW50', price: 48.5, against: 97 }),
       'welcome50 on the first payment and the team\'s 30% after it: a coupon, the real code named, never hidden by the team\'s', show(both))
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
    const on = await pageRow('mem_devThirtyOn', 'user_devThirty', 'approved')
    ok(on.check.discounted === true && on.coupon?.discounted === true && on.coupon?.ours === true && on.warns === false,
       'the team\'s 30% still on the next renewal, an Approved row: the membership says a discount, the page marks it the team\'s own and does not warn', show(on))
    const usedPage = await pageRow('mem_devThirtyUsed', 'user_devThirty', 'applied')
    ok(usedPage.check.discounted === false && usedPage.coupon?.discounted === false && usedPage.warns === false,
       'the team\'s 30% applied and used, a Code Applied row: no coupon stored, so the page shows none', show(usedPage))
    const realToo = await pageRow('mem_devThirtyUsed', 'user_devThirtyW50', 'approved')
    ok(realToo.check.discounted === true && realToo.coupon?.code === 'welcome50' && realToo.coupon?.ours === false && realToo.warns === true,
       'welcome50 and the team\'s 30%, an Approved row: the page warns about welcome50', show(realToo))
    round2Whop()
    const judged = await judgeStudentDiscount(student('mem_devThirtyUsed', 'user_devThirty'), newReadContext(KEY))
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
    const db = new FakeDb({ students: [...coupons, ...ins, sp('t-used', 'mem_devThirtyUsed', 'user_devThirty'), sp('k-full', 'mem_devFull', 'user_devRNull')] })
    installDb(db)
    const r = await quiet(() => cron())
    const b = r.value.body
    const rows = new Map(db.rows(MEMBERSHIP_DISCOUNTS_TABLE).map((x) => [x.student_id, x]))
    ok(r.value.status === 200 && b.ok === true && b.checked === coupons.length + ins.length + 2 && b.written === b.checked && show(b.failed) === show({})
         && b.discounted === coupons.length,
       `the cron: ${coupons.length + ins.length + 2} students read and written, ${coupons.length} discounted (the round's cases), none failed`, show(b))
    ok(coupons.every((s) => rows.get(s.id)?.discounted === true) && blocking.every(([, , , want], i) => rows.get(`c-${i}`)?.source === want.source && rows.get(`c-${i}`)?.whop_membership_id === want.membership),
       'each case stored as a coupon, with the step that found it and the membership it names', show(coupons.map((s) => [s.id, rows.get(s.id)?.discounted, rows.get(s.id)?.source, rows.get(s.id)?.whop_membership_id])))
    ok(ins.every((s) => rows.get(s.id)?.discounted === false) && rows.get('t-used')?.discounted === false && rows.get('k-full')?.discounted === false,
       'each control stored with no coupon, the team\'s used 30% and the full-price membership with a tax of unknown behaviour too', show([...ins, { id: 't-used' }, { id: 'k-full' }].map((s) => [s.id, rows.get(s.id)?.discounted])))
  }
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
