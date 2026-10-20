// The first-paid fix (2026-10-20): a student's first payment is the earliest
// Whop payment by that user with status paid, paid_at set, a total above 0 and
// not fully refunded, for any product. Until now first_paid_at came from Whop
// membership dates, so a student who bought on 14 October after a free
// membership was told his first payment was before 1 October.
//
// What runs is the real source, copied by build.mjs: the reader
// (src/lib/first-payment.ts) on a stand-in for Whop's API that pages
// GET /api/v1/payments as Whop's v1 does (cursor, first=100; created_after and
// created_before for the walk's 4 lanes, which no live call has tried yet,
// taken in each way Whop might; rows served in another shape on demand), and
// the four writers through their own entry points: the webhook's POST, the login's GET
// (its Whop calls as stand-ins in stub-server.ts, the first-payment read
// included), the sync (runWhopCommunitySync, with the real whop-members.ts and
// first-payment.ts on the same stand-in fetch) and the backfill route's POST
// (with the real admin-auth.ts). The database is stub-server.ts's stand-in.
//
// The clock is the suite's, as in whop-catchup.test.mjs: `new Date()` and
// `Date.now()` answer it, and setTimeout sets a timer on it that fires in the
// order timers fall due, moving the clock to its time. So the pace (4 requests
// a second), a 429's wait and the login's 2.5 s wait pass in milliseconds and
// are measured.
//
// Every Whop id, email, name, key and secret here is made up.
import { createHmac, randomBytes } from 'node:crypto'
import {
  judgePayment, moneyAmount, addFirstPayments, noPaymentCounts, hasOtherUser, waitAfter429Ms, pageInShape,
  fetchFirstPaymentForUser, walkFirstPayments, walkLanes, WALK_LANE_SPLITS, WHOP_PAYMENTS_URL, WHOP_PAYMENTS_VERSION,
} from './_gen/first-payment.ts'
import { runWhopCommunitySync } from './_gen/whop-sync-runner.ts'
import { POST as webhook } from './_gen/whop-webhook-route.ts'
import { GET as login } from './_gen/whop-callback-route.ts'
import { POST as backfill } from './_gen/backfill-first-paid-at-route.ts'
import { signState } from './_gen/pkce.ts'
// useDb is no React hook; the alias keeps eslint's hook rule from reading it as one.
import {
  FakeDb, useDb as installDb, createClient, NextRequest, setWhopUser, setWhopJoinDate,
  setFirstPayment, firstPaymentReads, setActiveMembership,
} from './_gen/stub-server.ts'

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
/** On the next turn of the event loop, after everything already under way has run, fire the timer due first. */
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
/** A fresh clock for a section: back to NOW, no timer left from the one before. */
function resetClock() {
  timers = []
  clock = RealDate.parse(NOW)
}

// ── The deployment's values ──────────────────────────────────────────────────
const KEY = 'apik_made_up_for_tests'
const SECRET = 'cron-secret-made-up-for-tests'
const PRODUCT = 'prod_TESTcourse'
const PAYING = 'plan_4ZrwR4PmBsVsx'
const FREE_PLAN = 'plan_TESTfree0001'
const YEARLY = 'plan_TESTyearly01'
process.env.WHOP_API_KEY = KEY
process.env.CRON_SECRET = SECRET
process.env.WHOP_PRODUCT_ID = PRODUCT

// ── Whop's payments, in the shape pinned by Api-Version-Date ─────────────────
const W = (n) => `user_TEST${String(n).padStart(6, '0')}`
let payN = 0
const money = (n) => ({ amount: n.toFixed(2), currency: 'usd', decimals: 2, display_decimals: 2 })
/** One payment as GET /api/v1/payments lists it (2026-09-02-1 and later). */
const pay = (user, paidAt, total, extra = {}) => ({
  id: `pay_TEST${String(++payN).padStart(6, '0')}`,
  status: 'paid', substatus: 'succeeded',
  subtotal: money(total), total: money(total), refunded_amount: money(0),
  paid_at: paidAt, created_at: paidAt, billing_reason: 'subscription_create',
  user: user === null ? null : { id: user, name: 'Made Up Buyer', username: 'madeupbuyer' },
  membership_id: `mem_TEST${payN}`, plan_id: PAYING, product_id: PRODUCT,
  ...extra,
})
const FREE_DAY = '2026-09-05T10:00:00.000Z'
const BOUGHT = '2026-10-14T10:00:05.000Z'

// ── The stand-in for Whop's API ──────────────────────────────────────────────
/** Every payment Whop holds, newest first as Whop lists them by default. */
let payments = []
/** v2 memberships by product, for the sync. */
let memberships = []
/** Every request: its address, its headers, when on the suite's clock. */
let asked = []
/** When set, answers the nth request (1-based) instead of the list. */
let answerWith = null
let latency = 0
let ignoreUserFilter = false
/**
 * How the stand-in takes created_after and created_before, the walk's lanes:
 * 'inclusive' (a payment at the moment named is listed), 'exclusive' (it is
 * not), 'ignored' (the whole list, as for a name Whop does not know) or
 * 'refused' (400, as Whop's native list answers a filter it does not take).
 */
let dateFilters = 'inclusive'
/** When set, every listed payment is served through it: the same payments, in another shape than the pinned one. */
let reshape = null
/** The buyer as a bare user_id, no nested user. */
const flat = ({ user, ...rest }) => ({ ...rest, user_id: user?.id ?? null })
/** The total under another name. */
const renamed = ({ total, ...rest }) => ({ ...rest, amount_total: total })
const answer = (body, status = 200, headers = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
const byNewest = (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url))
  asked.push({ url: String(url), path: u.pathname, params: Object.fromEntries(u.searchParams), headers: { ...(init.headers ?? {}) }, at: clock })
  if (latency > 0) await wait(latency)
  if (answerWith) {
    const got = await answerWith(asked.length, u)
    if (got) return got
  }
  if (u.pathname === '/api/v2/memberships') {
    const rows = memberships.filter((m) => m.product === u.searchParams.get('product_id'))
    return answer({ data: rows, pagination: { current_page: 1, total_page: 1, total_count: rows.length } })
  }
  if (u.pathname === '/api/v1/payments') {
    const user = u.searchParams.get('user_id')
    const status = u.searchParams.get('status')
    const first = Number(u.searchParams.get('first') ?? 20)
    const after = u.searchParams.get('after')
    const from = after ? Number(after.slice(1)) : 0
    const createdAfter = u.searchParams.get('created_after')
    const createdBefore = u.searchParams.get('created_before')
    if ((createdAfter || createdBefore) && dateFilters === 'refused') return answer({ error: 'Unsupported parameter(s)' }, 400)
    const inDates = (p) => {
      if (dateFilters === 'ignored') return true
      const t = RealDate.parse(p.created_at)
      const lo = createdAfter ? RealDate.parse(createdAfter) : -Infinity
      const hi = createdBefore ? RealDate.parse(createdBefore) : Infinity
      return dateFilters === 'exclusive' ? t > lo && t < hi : t >= lo && t <= hi
    }
    const list = [...payments].sort(byNewest)
      .filter((p) => (!user || ignoreUserFilter || p.user?.id === user) && (!status || p.status === status) && inDates(p))
    const more = list.length > from + first
    const rows = list.slice(from, from + first).map((p) => (reshape ? reshape(p) : p))
    return answer({ data: rows, page_info: { has_next_page: more, end_cursor: more ? `c${from + first}` : null, start_cursor: `c${from}` } })
  }
  return answer({ error: 'not found' }, 404)
}
function freshWhop() {
  payments = []
  memberships = []
  asked = []
  answerWith = null
  latency = 0
  ignoreUserFilter = false
  dateFilters = 'inclusive'
  reshape = null
  firstPaymentReads.length = 0
}
const paymentRequests = () => asked.filter((a) => a.path === '/api/v1/payments')
const gaps = (list) => list.slice(1).map((a, i) => a.at - list[i].at)

/** Runs `fn` with the console quiet; returns [result, lines]. */
async function quietly(fn) {
  const real = [console.log, console.info, console.warn, console.error]
  const lines = []
  console.log = console.info = console.warn = console.error = (...a) => { lines.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')) }
  try { return [await fn(), lines] } finally { [console.log, console.info, console.warn, console.error] = real }
}

console.log('\n=== The rule, one payment at a time ===')
{
  const keep = (p) => judgePayment(p)
  ok(same(keep(pay(W(1), BOUGHT, 97)), { keep: true, paidAt: BOUGHT }), 'a $97 payment, paid: kept, with its paid_at')
  ok(same(keep(pay(W(1), FREE_DAY, 0)), { keep: false, skip: 'zero_total' }), 'a $0 payment (a free claim): left out')
  ok(same(keep(pay(W(1), FREE_DAY, 0, { subtotal: money(97) })), { keep: false, skip: 'zero_total' }),
     'a 100% promo (subtotal 97, total 0): left out, it counts only from its first real charge')
  ok(keep(pay(W(1), BOUGHT, 1)).keep === true, 'a $1 plan counts')
  for (const status of ['pending', 'open', 'draft', 'void', 'authorized', 'uncollectible']) {
    ok(same(keep(pay(W(1), BOUGHT, 97, { status })), { keep: false, skip: 'not_paid' }), `status ${status}: left out`)
  }
  ok(same(keep(pay(W(1), null, 97)), { keep: false, skip: 'no_paid_at' }), 'paid with no paid_at: left out')
  ok(same(keep(pay(W(1), 'not a date', 97)), { keep: false, skip: 'no_paid_at' }), 'a paid_at that does not read: left out')
  ok(same(keep(pay(W(1), BOUGHT, 97, { substatus: 'refunded', refunded_amount: money(97) })), { keep: false, skip: 'refunded' }), 'fully refunded: left out')
  ok(same(keep(pay(W(1), BOUGHT, 97, { substatus: 'auto_refunded' })), { keep: false, skip: 'refunded' }), 'substatus auto_refunded: left out')
  ok(same(keep(pay(W(1), BOUGHT, 97, { refunded_amount: money(97) })), { keep: false, skip: 'refunded' }),
     'a refund of the whole total under another substatus: left out')
  ok(keep(pay(W(1), BOUGHT, 97, { substatus: 'partially_refunded', refunded_amount: money(40) })).keep === true, 'a partial refund still counts')
  ok(same(keep(pay(W(1), BOUGHT, 97, { total: 97, subtotal: 97, refunded_amount: 0 })), { keep: true, paidAt: BOUGHT }),
     'the older shape, a bare number: read too')
  ok(keep(pay(W(1), BOUGHT, 97, { total: 0 })).keep === false && keep(pay(W(1), BOUGHT, 97, { total: 97, refunded_amount: 97 })).keep === false,
     'the older shape: $0 and a full refund left out')
  ok(same(keep(pay(W(1), BOUGHT, 97, { total: undefined })), { keep: false, skip: 'bad_total' }) &&
     same(keep(pay(W(1), BOUGHT, 97, { total: { amount: 'n/a' } })), { keep: false, skip: 'bad_total' }) &&
     same(keep(pay(W(1), BOUGHT, 97, { total: null })), { keep: false, skip: 'bad_total' }),
     'no total, or one that does not read: left out (it cannot be shown to be above 0), and counted apart from a $0 one (bad_total)')
  ok(same(keep(pay(W(1), BOUGHT, 97, { substatus: 'dispute_lost' })), { keep: false, skip: 'dispute_lost' }) &&
     same(keep(pay(W(1), BOUGHT, 97, { substatus: 'dispute_lost', refunded_amount: money(97) })), { keep: false, skip: 'dispute_lost' }),
     'a lost dispute (a chargeback the buyer won): left out like a full refund, counted apart, whatever refunded_amount says')
  ok(keep(pay(W(1), BOUGHT, 97, { substatus: 'dispute_won' })).keep === true, 'a dispute the account won: the money stood, so it counts')
  ok(same(noPaymentCounts().skipped, { not_paid: 0, no_paid_at: 0, zero_total: 0, bad_total: 0, refunded: 0, dispute_lost: 0, no_user: 0 }),
     'every reason a payment is left out has its own count')
  ok(same(keep(pay(W(1), 1791972005, 97)), { keep: true, paidAt: BOUGHT }), 'a paid_at in Unix seconds reads as the same moment')
  ok(moneyAmount({ amount: '97.00' }) === 97 && moneyAmount(1) === 1 && moneyAmount('5') === 5 && Number.isNaN(moneyAmount(null)) &&
     Number.isNaN(moneyAmount({})) && Number.isNaN(moneyAmount('')), 'money in either shape', '97.00, 1, "5"; none reads as NaN')
  ok(waitAfter429Ms('{"error":{"message":"Try again in 12 seconds."}}', null) === 12000 && waitAfter429Ms('Try again in 90 seconds', null) === 30000 &&
     waitAfter429Ms('{}', '5') === 5000 && waitAfter429Ms('{}', null) === 15000 && waitAfter429Ms('Try again in 0.2 seconds', null) === 1000,
     'a 429\'s wait: the seconds Whop names, else Retry-After, else 15; at least 1, at most 30')
}

console.log('\n=== The rule over many payments: the earliest real one per user ===')
{
  const rows = [
    // The student of the report: a free claim on 5 September, the course on 14 October, its renewal.
    pay(W(1), FREE_DAY, 0), pay(W(1), BOUGHT, 97), pay(W(1), '2026-11-14T10:00:05.000Z', 97, { billing_reason: 'subscription_cycle' }),
    // A 100% promo on 1 September, its first real charge on 1 October.
    pay(W(2), '2026-09-01T08:00:00.000Z', 0, { subtotal: money(97) }), pay(W(2), '2026-10-01T08:00:00.000Z', 97),
    // Refunded in full on 1 August, bought again on 20 August and refunded in part.
    pay(W(3), '2026-08-01T12:00:00.000Z', 97, { substatus: 'refunded', refunded_amount: money(97) }),
    pay(W(3), '2026-08-20T12:00:00.000Z', 97, { substatus: 'partially_refunded', refunded_amount: money(40) }),
    // The $1 plan.
    pay(W(4), '2026-09-10T09:00:00.000Z', 1),
    // Free only.
    pay(W(5), FREE_DAY, 0),
    // No buyer on the row.
    pay(null, '2026-09-11T09:00:00.000Z', 97),
    // Charged back on 15 September (a lost dispute), bought again on 16 October.
    pay(W(7), '2026-09-15T10:00:00.000Z', 97, { substatus: 'dispute_lost' }), pay(W(7), '2026-10-16T10:00:00.000Z', 97),
    // A total that does not read on 2 September, a real payment on 3 October.
    pay(W(8), '2026-09-02T10:00:00.000Z', 97, { total: { amount: 'n/a' } }), pay(W(8), '2026-10-03T10:00:00.000Z', 97),
  ]
  const expected = {
    [W(1)]: BOUGHT, [W(2)]: '2026-10-01T08:00:00.000Z', [W(3)]: '2026-08-20T12:00:00.000Z', [W(4)]: '2026-09-10T09:00:00.000Z',
    [W(7)]: '2026-10-16T10:00:00.000Z', [W(8)]: '2026-10-03T10:00:00.000Z',
  }
  const mixed = [rows[5], rows[11], rows[1], rows[9], rows[13], rows[0], rows[3], rows[10], rows[7], rows[2], rows[12], rows[6], rows[4], rows[8]]
  for (const [label, order] of [['newest first', [...rows].reverse()], ['oldest first', rows], ['mixed', mixed]]) {
    const map = new Map()
    const counts = noPaymentCounts()
    addFirstPayments(order, map, counts)
    ok(same(Object.fromEntries([...map].sort()), expected), `the earliest real payment per user, read ${label}`, show(Object.fromEntries(map)))
    ok(same(counts, { seen: 14, kept: 7, skipped: { not_paid: 0, no_paid_at: 0, zero_total: 3, bad_total: 1, refunded: 1, dispute_lost: 1, no_user: 1 } }),
       `and the counts, read ${label}: 14 read, 7 kept, 3 at $0, 1 total that does not read, 1 refunded, 1 lost dispute, 1 with no buyer`, show(counts))
  }
  const map = new Map()
  addFirstPayments([pay(W(1), BOUGHT, 97)], map, noPaymentCounts())
  addFirstPayments([pay(W(1), '2026-10-13T10:00:00.000Z', 1)], map, noPaymentCounts())
  ok(map.get(W(1)) === '2026-10-13T10:00:00.000Z', 'pages add up: an earlier payment on a later page wins')
  ok(hasOtherUser([pay(W(1), BOUGHT, 97), pay(W(2), BOUGHT, 97)], W(1)) && !hasOtherUser([pay(W(1), BOUGHT, 97), pay(null, BOUGHT, 97)], W(1)),
     'a row for another buyer is caught; a row with no buyer is not taken for one')
  ok(pageInShape([]) && pageInShape(rows) && pageInShape([pay(null, BOUGHT, 97), pay(W(1), BOUGHT, 97, { total: null })]),
     'a page is in the shape read when some row has a buyer and some row a total that reads; one odd row is judged, not the page')
  ok(!pageInShape(rows.map(flat)) && !pageInShape(rows.map(renamed)) && !pageInShape([null]) && !pageInShape(['pay_TEST000001']),
     'and not when no row has a nested buyer, no row a total under that name, or a row is not an object')
}

console.log('\n=== One user\'s first payment (the login, the sync, the backfill) ===')
{
  resetClock(); freshWhop()
  payments = [pay(W(1), FREE_DAY, 0), pay(W(1), BOUGHT, 97), pay(W(1), '2026-11-14T10:00:05.000Z', 97), pay(W(2), '2026-08-01T10:00:00.000Z', 97)]
  const r = await fetchFirstPaymentForUser(W(1))
  ok(same(r, { firstPaidIso: BOUGHT, kept: 2, seen: 3, error: null }), 'the student of the report: 14 October, not his free 5 September', show(r))
  const [q] = paymentRequests()
  ok(q && q.url.startsWith(`${WHOP_PAYMENTS_URL}?`) && same(q.params, { user_id: W(1), status: 'paid', first: '100' }),
     'one request: GET /api/v1/payments?user_id=<id>&status=paid&first=100', q?.url)
  ok(q.headers.Authorization === `Bearer ${KEY}` && q.headers['Api-Version-Date'] === '2026-10-15-1' && WHOP_PAYMENTS_VERSION === '2026-10-15-1',
     'with the app\'s key and Api-Version-Date: 2026-10-15-1', show(q.headers['Api-Version-Date']))

  freshWhop()
  // 150 payments: the first real one is the oldest, on the second page.
  payments = Array.from({ length: 150 }, (_, i) => pay(W(6), new Date(RealDate.parse('2026-01-01T00:00:00.000Z') + i * 86_400_000).toISOString(), 97))
  const paged = await fetchFirstPaymentForUser(W(6))
  const reqs = paymentRequests()
  ok(paged.firstPaidIso === '2026-01-01T00:00:00.000Z' && paged.seen === 150 && reqs.length === 2 && reqs[1].params.after === 'c100',
     'two pages: the second asked with after=<end_cursor>, and the earliest is on it', show({ r: paged, after: reqs[1]?.params.after }))
  ok(same(gaps(reqs), [250]), 'the pages 250 ms apart, start to start (4 a second)', show(gaps(reqs)))

  freshWhop()
  payments = [pay(W(5), FREE_DAY, 0), pay(W(5), '2026-10-01T00:00:00.000Z', 97, { status: 'pending' })]
  ok(same(await fetchFirstPaymentForUser(W(5)), { firstPaidIso: null, kept: 0, seen: 1, error: null }),
     'a free member: no first payment, and no error (the pending one is not even listed: status=paid)')

  freshWhop()
  payments = [pay(W(1), BOUGHT, 97), pay(W(2), '2026-08-01T10:00:00.000Z', 97)]
  ignoreUserFilter = true
  ok(same(await fetchFirstPaymentForUser(W(1)), { firstPaidIso: null, kept: 0, seen: 0, error: 'filter_ignored' }),
     'Whop ignoring the user filter (a row of someone else): an error and no date, so nothing is written')

  freshWhop()
  delete process.env.WHOP_API_KEY
  ok(same(await fetchFirstPaymentForUser(W(1)), { firstPaidIso: null, kept: 0, seen: 0, error: 'no_api_key' }) && asked.length === 0,
     'no WHOP_API_KEY: no_api_key, and Whop is never asked')
  process.env.WHOP_API_KEY = KEY
}

console.log('\n=== Failures: a 429 waited out, the rest by kind ===')
{
  for (const [body, waitMs, label] of [
    ['{"error":{"type":"rate_limit_exceeded","message":"Try again in 3 seconds."}}', 3000, 'the 3 seconds Whop names'],
    ['{"error":{"message":"Try again in 90 seconds."}}', 30000, 'at most 30 when Whop names 90'],
    ['{"error":"rate limited"}', 15000, '15 when Whop names none'],
  ]) {
    resetClock(); freshWhop()
    payments = [pay(W(1), BOUGHT, 97)]
    answerWith = (n) => (n === 1 ? answer(body, 429) : null)
    const r = await fetchFirstPaymentForUser(W(1))
    ok(r.firstPaidIso === BOUGHT && r.error === null && same(gaps(paymentRequests()), [waitMs]), `a 429, then the page: waits ${label}`, show(gaps(paymentRequests())))
  }
  resetClock(); freshWhop()
  answerWith = () => answer('{"error":"rate limited"}', 429)
  let r = await fetchFirstPaymentForUser(W(1))
  ok(r.error === 'rate_limited' && r.firstPaidIso === null && asked.length === 3 && same(gaps(paymentRequests()), [15000, 15000]),
     'three 429s: asked 3 times (two waits), then rate_limited and no date', show({ r, gaps: gaps(paymentRequests()) }))
  for (const [res, kind] of [
    [() => answer('{"error":"unauthorized"}', 401), 'http_401_403'],
    [() => answer('{"error":"forbidden"}', 403), 'http_401_403'],
    [() => answer('upstream', 502), 'http_other'],
    [() => { throw new TypeError('fetch failed') }, 'network'],
    [() => answer('<html>not json</html>'), 'bad_page'],
    [() => answer({ data: null }), 'bad_page'],
    [() => answer({ data: [], page_info: { has_next_page: true, end_cursor: null } }), 'bad_page'],
  ]) {
    resetClock(); freshWhop()
    answerWith = res
    r = await fetchFirstPaymentForUser(W(1))
    ok(r.error === kind && r.firstPaidIso === null, `${kind}: no date`, show(r))
  }
  // Whop answering in a shape this code does not read: every buyer would look like a free member.
  for (const [shape, label] of [[flat, 'the buyer as a bare user_id'], [renamed, 'the total under another name']]) {
    resetClock(); freshWhop()
    payments = [pay(W(1), FREE_DAY, 0), pay(W(1), BOUGHT, 97)]
    reshape = shape
    r = await fetchFirstPaymentForUser(W(1))
    ok(same(r, { firstPaidIso: null, kept: 0, seen: 0, error: 'bad_page' }), `a page in another shape (${label}): bad_page, an error and no date, never "no payment"`, show(r))
  }
  resetClock(); freshWhop()
  payments = [pay(W(1), FREE_DAY, 0), pay(W(1), BOUGHT, 97)]
  reshape = (p) => (p.paid_at === FREE_DAY ? { ...p, total: undefined } : p)
  r = await fetchFirstPaymentForUser(W(1))
  ok(same(r, { firstPaidIso: BOUGHT, kept: 1, seen: 2, error: null }), 'one row with no total beside a whole one: the page reads, that row is left out', show(r))

  resetClock(); freshWhop()
  answerWith = (n) => answer({ data: [pay(W(1), BOUGHT, 97)], page_info: { has_next_page: true, end_cursor: `c${n}` } })
  r = await fetchFirstPaymentForUser(W(1))
  ok(r.error === 'too_many_pages' && r.firstPaidIso === null && asked.length === 10, 'Whop paging for ever: 10 pages, then too_many_pages and no date', show({ asked: asked.length }))

  // The login's short wait: nothing past its deadline.
  resetClock(); freshWhop()
  answerWith = () => answer('{"error":{"message":"Try again in 3 seconds."}}', 429)
  r = await fetchFirstPaymentForUser(W(1), { deadlineAtMs: clock + 2500 })
  ok(r.error === 'time_budget' && asked.length === 1 && clock === RealDate.parse(NOW), 'with a 2.5 s deadline, a 429 naming 3 s is not waited: time_budget at once', show({ r, asked: asked.length }))
  resetClock(); freshWhop()
  payments = [pay(W(1), BOUGHT, 97)]
  latency = 10_000
  const startedAt = clock
  r = await fetchFirstPaymentForUser(W(1), { deadlineAtMs: clock + 2500 })
  ok(r.error === 'time_budget' && clock - startedAt === 2500, 'and an answer slower than the deadline is given up at it', show({ r, waited: clock - startedAt }))
  timers = []
}

console.log('\n=== The walk: every paid payment of the account, once (the repair) ===')
{
  resetClock(); freshWhop()
  // 250 payments of 120 buyers, as Whop lists them: three pages.
  payments = []
  for (let i = 0; i < 250; i++) {
    const user = W(100 + (i % 120))
    const day = new Date(RealDate.parse('2026-05-01T00:00:00.000Z') + i * 3_600_000).toISOString()
    payments.push(pay(user, day, i % 10 === 0 ? 0 : 97))
  }
  const w = await walkFirstPayments()
  const reqs = paymentRequests()
  ok(w.complete === true && w.stoppedBecause === 'done' && w.pages === 3 && w.requests === 3 && reqs.length === 3,
     'three pages, read to the end', show({ complete: w.complete, pages: w.pages }))
  ok(same(reqs.map((q) => q.params), [{ status: 'paid', first: '100' }, { status: 'paid', first: '100', after: 'c100' }, { status: 'paid', first: '100', after: 'c200' }]),
     'GET /api/v1/payments?status=paid&first=100, no user filter, then after=<end_cursor>', show(reqs.map((q) => q.params)))
  ok(reqs.every((q) => q.headers['Api-Version-Date'] === '2026-10-15-1' && q.headers.Authorization === `Bearer ${KEY}`), 'every page with the key and the pinned version')
  ok(same(gaps(reqs), [250, 250]), '4 requests a second, start to start', show(gaps(reqs)))
  const firsts = new Map()
  for (const p of payments) {
    if (moneyAmount(p.total) <= 0) continue
    const had = firsts.get(p.user.id)
    if (!had || Date.parse(p.paid_at) < Date.parse(had)) firsts.set(p.user.id, p.paid_at)
  }
  // Buyers 0, 10, ... 110 only ever paid $0 (every 10th payment is free), so 108 of the 120 have a first payment.
  ok(firsts.size === 108 && w.firstByUser.size === 108 && [...firsts].every(([u, at]) => w.firstByUser.get(u) === at),
     'grouped by buyer: each one\'s earliest payment above 0, as worked out here row by row; the $0-only buyers have none', `${w.firstByUser.size} buyers`)
  ok(w.counts.seen === 250 && w.counts.kept === 225 && w.counts.skipped.zero_total === 25, 'the counts: 250 read, 225 kept, 25 at $0', show(w.counts))
  ok(w.lanes === 1 && w.answerMs === 0, 'one lane, and Whop\'s answer time summed over its pages (0 here: no latency)', show({ lanes: w.lanes, answerMs: w.answerMs }))

  // One row with no buyer and one with no total among whole ones: the page reads.
  resetClock(); freshWhop()
  payments = Array.from({ length: 150 }, (_, i) => pay(W(300 + i), '2026-09-01T00:00:00.000Z', 97))
  payments[3].user = null
  payments[7].total = { amount: 'n/a' }
  const odd = await walkFirstPayments()
  ok(odd.complete === true && odd.counts.skipped.no_user === 1 && odd.counts.skipped.bad_total === 1 && odd.counts.kept === 148,
     'one row with no buyer and one with no total among whole ones: complete, the two counted apart', show(odd.counts))

  // The second page in another shape: the walk stops there, never planning from a blind read.
  for (const [shape, label] of [[flat, 'the buyer as a bare user_id'], [renamed, 'the total under another name']]) {
    resetClock(); freshWhop()
    payments = Array.from({ length: 150 }, (_, i) => pay(W(300 + i), '2026-09-01T00:00:00.000Z', 97))
    reshape = (p) => (asked.length >= 2 ? shape(p) : p)
    const blind = await walkFirstPayments()
    ok(blind.complete === false && blind.stoppedBecause === 'bad_page' && blind.pages === 1,
       `the second page in another shape (${label}): incomplete, bad_page, after 1 page`, show({ stopped: blind.stoppedBecause, pages: blind.pages }))
  }

  resetClock(); freshWhop()
  payments = Array.from({ length: 450 }, (_, i) => pay(W(300 + i), '2026-09-01T00:00:00.000Z', 97))
  latency = 85_000
  const slow = await walkFirstPayments({ startBy: clock + 240_000, answerBy: clock + 285_000 })
  ok(slow.complete === false && slow.stoppedBecause === 'time_budget' && slow.pages === 3 && slow.requests === 3 && clock === RealDate.parse(NOW) + 255_000,
     'Whop taking 85 s a page: pages start at 0, 85 and 170 s; the 4th would start at 255 s, past 240, so the walk stops there, incomplete',
     show({ pages: slow.pages, stopped: slow.stoppedBecause, at: clock - RealDate.parse(NOW) }))

  resetClock(); freshWhop()
  payments = Array.from({ length: 450 }, (_, i) => pay(W(300 + i), '2026-09-01T00:00:00.000Z', 97))
  latency = 100_000
  const late = await walkFirstPayments({ startBy: clock + 240_000, answerBy: clock + 285_000 })
  ok(late.complete === false && late.stoppedBecause === 'time_budget' && late.pages === 2 && late.requests === 3 && clock === RealDate.parse(NOW) + 285_000,
     'Whop taking 100 s a page: the 3rd, started at 200 s and unanswered at 285 s, is given up then: incomplete',
     show({ pages: late.pages, at: clock - RealDate.parse(NOW) }))
  timers = []

  resetClock(); freshWhop()
  payments = Array.from({ length: 150 }, (_, i) => pay(W(300 + i), '2026-09-01T00:00:00.000Z', 97))
  answerWith = (n) => (n === 2 ? answer('{"error":"unauthorized"}', 401) : null)
  const refused = await walkFirstPayments()
  ok(refused.complete === false && refused.stoppedBecause === 'http_401_403' && refused.pages === 1, 'a 401 on the second page: incomplete, http_401_403', show({ stopped: refused.stoppedBecause }))

  resetClock(); freshWhop()
  answerWith = () => answer({ data: [pay(W(1), BOUGHT, 97)], page_info: { has_next_page: true, end_cursor: 'same' } })
  const stuck = await walkFirstPayments()
  ok(stuck.complete === false && stuck.stoppedBecause === 'bad_page' && stuck.requests === 2, 'a cursor Whop gives twice: stopped, never read for ever', show({ stopped: stuck.stoppedBecause, requests: stuck.requests }))

  resetClock(); freshWhop()
  answerWith = () => answer('{"error":"rate limited"}', 429)
  const limited = await walkFirstPayments({ startBy: clock + 240_000 })
  ok(limited.complete === false && limited.stoppedBecause === 'rate_limited' && limited.retried429 === 2 && limited.requests === 3,
     'three 429s on a page: two waits, then rate_limited', show({ retried: limited.retried429 }))

  resetClock(); freshWhop()
  const empty = await walkFirstPayments()
  ok(empty.complete === true && empty.firstByUser.size === 0 && empty.pages === 1, 'an account with no payment: one page, complete, no buyer')
}

console.log('\n=== The walk in 4 lanes: the history in 4 stretches, side by side ===')
{
  const SPLITS = WALK_LANE_SPLITS.map((x) => RealDate.parse(x))
  const iso = (t) => new RealDate(t).toISOString()
  ok(same(walkLanes(1), [{ after: null, before: null }]), 'one lane: no dates sent')
  ok(same(walkLanes(4), [
    { after: null, before: iso(SPLITS[0] + 1000) },
    { after: iso(SPLITS[0] - 1000), before: iso(SPLITS[1] + 1000) },
    { after: iso(SPLITS[1] - 1000), before: iso(SPLITS[2] + 1000) },
    { after: iso(SPLITS[2] - 1000), before: null },
  ]), '4 lanes, oldest first, cut at the 3 splits, each a second wider on either side', show(walkLanes(4)))

  /** 600 payments from February 2025 to October 2026, and 5 at each split: 1 s and half a second either side, and on it. */
  const history = () => {
    const list = []
    const start = RealDate.parse('2025-02-01T00:00:00.000Z')
    const span = RealDate.parse('2026-10-19T00:00:00.000Z') - start
    for (let i = 0; i < 600; i++) list.push(pay(W(1000 + (i % 150)), iso(start + Math.floor((span * i) / 600)), i % 10 === 0 ? 0 : 97))
    SPLITS.forEach((t, k) => [-1000, -500, 0, 500, 1000].forEach((d, j) => list.push(pay(W(2000 + k * 10 + j), iso(t + d), 97))))
    return list
  }
  const shown = (walk) => ({ firsts: Object.fromEntries([...walk.firstByUser].sort()), counts: walk.counts })

  resetClock(); freshWhop()
  payments = history()
  const one = await walkFirstPayments()
  ok(one.complete === true && one.firstByUser.size === 150 && one.counts.seen === 615, 'the history in 1 lane: complete, 615 payments, 150 buyers (15 of them at the splits)', show({ seen: one.counts.seen, buyers: one.firstByUser.size }))

  for (const how of ['inclusive', 'exclusive']) {
    resetClock(); freshWhop()
    payments = history()
    dateFilters = how
    const four = await walkFirstPayments({ lanes: 4 })
    ok(four.complete === true && four.lanes === 4 && same(shown(four), shown(one)),
       `in 4 lanes, Whop taking its dates as ${how}: the same first payments and the same counts as 1 lane, each payment at a split counted once`, show({ seen: four.counts.seen, kept: four.counts.kept }))
    const firstOfLane = walkLanes(4).map((lane) => paymentRequests().find((q) => (q.params.created_after ?? null) === lane.after && (q.params.created_before ?? null) === lane.before && !q.params.after))
    ok(firstOfLane.every((q) => q && q.params.status === 'paid' && q.params.first === '100'), 'each lane asks for its own dates, status=paid&first=100',
       show(firstOfLane.map((q) => q && { after: q.params.created_after, before: q.params.created_before })))
    const starts = paymentRequests().map((q) => q.at).sort((a, b) => a - b)
    ok(gaps(starts.map((at) => ({ at }))).every((g) => g >= 250) && starts.length === four.requests && four.requests === four.pages,
       'and the 4 lanes together still start at most 4 requests a second', show(gaps(starts.map((at) => ({ at })))))
  }

  // The time it saves: Whop taking 1 s a page.
  resetClock(); freshWhop()
  payments = history()
  latency = 1000
  let startedAt = clock
  const slowOne = await walkFirstPayments()
  const oneTook = clock - startedAt
  resetClock(); freshWhop()
  payments = history()
  latency = 1000
  startedAt = clock
  const slowFour = await walkFirstPayments({ lanes: 4 })
  const fourTook = clock - startedAt
  ok(slowOne.complete && slowFour.complete && oneTook === 7000 && fourTook <= oneTook / 2,
     'Whop taking 1 s a page: 1 lane reads its 7 pages in 7 s, 4 lanes the same history in half that or less', show({ oneTook, fourTook, pages: [slowOne.pages, slowFour.pages] }))
  ok(slowFour.answerMs === slowFour.pages * 1000, 'and Whop\'s answer time is summed per page read (1 s each)', show({ answerMs: slowFour.answerMs, pages: slowFour.pages }))

  // A 429 on one lane: every lane waits it out.
  resetClock(); freshWhop()
  payments = history()
  answerWith = (n) => (n === 3 ? answer('{"error":{"message":"Try again in 5 seconds."}}', 429) : null)
  const waited = await walkFirstPayments({ lanes: 4 })
  const reqs = paymentRequests()
  const T = reqs[2].at
  const during = reqs.filter((q) => q.at > T && q.at < T + 5000)
  ok(waited.complete === true && waited.retried429 === 1 && same(shown(waited), shown(one)) && during.length === 3 && during.every((q) => q.at <= T + 750) &&
     reqs.some((q) => q.at === T + 5000),
     'a 429 on one lane: only the 3 requests already given their moment go out, then none until the 5 s are over, and the walk ends whole',
     show(during.map((q) => q.at - T)))

  // Whop not applying the dates: the lanes would not add up to the account, so the walk stops.
  resetClock(); freshWhop()
  payments = history()
  dateFilters = 'ignored'
  const ignored = await walkFirstPayments({ lanes: 4 })
  ok(ignored.complete === false && ignored.stoppedBecause === 'filter_ignored', 'Whop ignoring created_after and created_before: a lane gets a payment outside its stretch, filter_ignored, incomplete',
     show({ stopped: ignored.stoppedBecause, pages: ignored.pages }))
  resetClock(); freshWhop()
  payments = history()
  dateFilters = 'refused'
  const refused = await walkFirstPayments({ lanes: 4 })
  ok(refused.complete === false && refused.stoppedBecause === 'http_other', 'Whop refusing the dates (400): http_other, incomplete', show({ stopped: refused.stoppedBecause }))
  resetClock(); freshWhop()
  payments = history()
  reshape = (p) => ({ ...p, created_at: null })
  const undated = await walkFirstPayments({ lanes: 4 })
  ok(undated.complete === false && undated.stoppedBecause === 'filter_ignored', 'a payment with no created_at cannot be placed in a lane: filter_ignored, incomplete')
  resetClock(); freshWhop()
  payments = history()
  dateFilters = 'refused'
  const plain = await walkFirstPayments()
  ok(plain.complete === true && paymentRequests().every((q) => !('created_after' in q.params) && !('created_before' in q.params)),
     '1 lane sends no dates, so a Whop that refuses them still reads the whole account')
}

// ── The writers ──────────────────────────────────────────────────────────────
const sid = (n) => `f0000000-0000-4000-8000-${String(n).padStart(12, '0')}`

console.log('\n=== The webhook stamps no first payment ===')
{
  const SIGNING = randomBytes(24)
  process.env.WHOP_WEBHOOK_SECRET = `ws_${SIGNING.toString('base64')}`
  let msg = 0
  const send = async (payload) => {
    const body = JSON.stringify(payload)
    const id = `msg_${++msg}`
    const ts = String(Math.floor(RealDate.now() / 1000))
    const sig = createHmac('sha256', SIGNING).update(`${id}.${ts}.${body}`).digest('base64')
    const [res] = await quietly(() => webhook(new Request('http://app/api/webhooks/whop', {
      method: 'POST', headers: { 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': `v1,${sig}` }, body,
    })))
    return res.status
  }
  /**
   * A membership event as the handler reads it: joined_at is the user's first
   * join to the company. It names the course's product, as Whop's payloads do:
   * since login-1 the webhook writes a row only for a product in
   * WHOP_PRODUCT_ID (whop-webhook-product.test.mjs).
   */
  const activated = (user, joinedAt) => ({
    type: 'membership.activated',
    data: { id: `mem_TEST${user.slice(-3)}`, user: { id: user, email: 'buyer@example.com', name: 'Made Up Buyer', username: 'madeupbuyer' },
      status: 'active', joined_at: joinedAt, created_at: BOUGHT, plan_id: PAYING, product: { id: PRODUCT, title: 'The course' } },
  })
  /** payment.succeeded carries a payment, read by the handler as a membership. */
  const paid = (user) => ({ type: 'payment.succeeded', data: pay(user, BOUGHT, 97) })

  resetClock()
  const db = new FakeDb({ students: [{ id: sid(1), whop_user_id: W(11), first_paid_at: '2026-10-14T10:00:05.000Z', joined_at: FREE_DAY }] })
  installDb(db)
  const paidW12 = paid(W(12))
  const paidW11 = paid(W(11))
  const statuses = [await send(activated(W(10), FREE_DAY)), await send(paidW12), await send(activated(W(11), FREE_DAY)), await send(paidW11)]
  const row = (u) => db.rows('students').find((s) => s.whop_user_id === u)
  ok(statuses.every((s) => s === 200), 'every event answers 200', show(statuses))
  ok(row(W(12))?.whop_membership_id === paidW12.data.membership_id && row(W(11))?.whop_membership_id === paidW11.data.membership_id,
     'payment.succeeded points the row at the payment\'s membership (membership_id), never at the payment (pay_...)',
     show({ w12: row(W(12))?.whop_membership_id, w11: row(W(11))?.whop_membership_id }))
  ok(row(W(10)) && row(W(10)).first_paid_at === null && row(W(10)).joined_at === FREE_DAY,
     'membership.activated for a new member: the row is made with no first payment (it took joined_at, the free date); joined_at as before', show(row(W(10))))
  ok(row(W(12)) && row(W(12)).first_paid_at === null, 'payment.succeeded for a new member: no first payment either (it took the arrival time)', show(row(W(12))?.first_paid_at))
  ok(row(W(11)).first_paid_at === '2026-10-14T10:00:05.000Z', 'a stored first payment is left exactly as it is by both events')
  ok(db.calls('students', 'upsert').every((q) => !('first_paid_at' in q.values)), 'no upsert the webhook sends names first_paid_at')
  ok(db.calls('students', 'select').length === 0, 'and it no longer reads the row first (that read was only for the stamp)')
}

console.log('\n=== The login: the first payment fills an empty first_paid_at, and only that ===')
process.env.NEXT_PUBLIC_APP_URL = 'http://app'
process.env.PKCE_COOKIE_SECRET = 'a made-up secret for this test'
delete process.env.STUDENT_APP_CLOSED
{
  const user = W(20)
  /** A database with `row` as this student's row (none when null), and the auth account a past login made when `account`. */
  const setUp = ({ row = null, account = true } = {}) => {
    resetClock(); freshWhop()
    const db = new FakeDb({ students: row ? [{ id: sid(20), whop_user_id: user, email: 'student@example.com', ...row }] : [] })
    if (account) db.authUsers[`${user}@whop.ecomtalent.com`] = { id: 'auth-20', password: `password-for-${user}` }
    installDb(db)
    setWhopUser({ sub: user, email: 'student@example.com', name: 'Made Up Student', picture: null, username: 'madeupstudent' })
    setWhopJoinDate(null)
    setActiveMembership(async () => null)
    setFirstPayment(async () => ({ firstPaidIso: BOUGHT, kept: 1, seen: 2, error: null }))
    delete process.env.WHOP_BYPASS_USER_IDS
    return db
  }
  const logIn = async () => {
    const state = signState('a-made-up-verifier', process.env.PKCE_COOKIE_SECRET)
    const startedAt = clock
    const [res, log] = await quietly(() => login(new NextRequest(`http://app/api/auth/whop/callback?code=made-up-code&state=${encodeURIComponent(state)}`)))
    return { status: res.status, location: res.headers.get('location'), took: clock - startedAt, log }
  }
  const signedIn = (r) => r.status === 307 && r.location === 'http://app/auth/complete'
  const rowOf = (db) => db.rows('students').find((s) => s.whop_user_id === user)

  // A new student (a bypassed id: no membership check, so no row exists before step 5).
  let db = setUp({ account: false })
  process.env.WHOP_BYPASS_USER_IDS = user
  setWhopJoinDate(FREE_DAY)
  let r = await logIn()
  ok(signedIn(r) && rowOf(db)?.first_paid_at === BOUGHT && rowOf(db).joined_at === FREE_DAY,
     'a new student: first_paid_at is the first payment (14 October), joined_at still Whop\'s join date (5 September)', show({ row: rowOf(db) && { first: rowOf(db).first_paid_at, joined: rowOf(db).joined_at } }))
  ok(firstPaymentReads.length === 1 && firstPaymentReads[0].whopUserId === user && firstPaymentReads[0].deadlineAtMs === RealDate.parse(NOW) + 2500,
     'one read, for this student, with a deadline 2.5 s out', show(firstPaymentReads))
  ok(db.calls('students', 'upsert').every((q) => !('first_paid_at' in q.values)), 'the row\'s upsert names no first_paid_at; the fill is its own update')
  ok(same(db.calls('students', 'update').map((q) => q.filters), [[`id=${rowOf(db).id}`, 'first_paid_at is null']]),
     'the fill: one update of this row, only while its first_paid_at is empty', show(db.calls('students', 'update').map((q) => q.filters)))

  // The self-heal: no row, Whop's admin read finds a free membership created on 5 September.
  db = setUp({ account: false })
  setActiveMembership(async () => ({ id: 'mem_TESTfree', user, email: 'student@example.com', status: 'completed', valid: true,
    created_at: FREE_DAY, product: PRODUCT, plan: FREE_PLAN }))
  r = await logIn()
  ok(signedIn(r) && rowOf(db)?.first_paid_at === BOUGHT && rowOf(db).joined_at === FREE_DAY,
     'the self-heal: first_paid_at is the first payment, not the membership\'s created_at (it took that); joined_at keeps it', show({ first: rowOf(db)?.first_paid_at, joined: rowOf(db)?.joined_at }))
  ok(firstPaymentReads.length === 1, 'still one read in the whole login', show(firstPaymentReads.length))
  db = setUp({ account: false })
  setActiveMembership(async () => ({ id: 'mem_TESTfree', user, status: 'completed', valid: true, created_at: FREE_DAY, product: PRODUCT, plan: FREE_PLAN }))
  setFirstPayment(async () => ({ firstPaidIso: null, kept: 0, seen: 1, error: null }))
  r = await logIn()
  ok(signedIn(r) && rowOf(db)?.first_paid_at === null, 'the self-heal of a free member with no payment: signed in, first_paid_at empty', show(rowOf(db)?.first_paid_at))

  // A row the webhook made, with no first payment.
  db = setUp({ row: { membership_status: 'active', first_paid_at: null } })
  r = await logIn()
  ok(signedIn(r) && rowOf(db).first_paid_at === BOUGHT, 'a row the webhook made without one: filled at the login', show(rowOf(db).first_paid_at))

  // A stored first payment, even a wrong one: the login does not touch it (only the repair does).
  db = setUp({ row: { membership_status: 'active', first_paid_at: FREE_DAY } })
  r = await logIn()
  ok(signedIn(r) && rowOf(db).first_paid_at === FREE_DAY && firstPaymentReads.length === 0 && db.calls('students', 'update').length === 0,
     'a stored first_paid_at: no read, no write, kept as it is', show({ first: rowOf(db).first_paid_at, reads: firstPaymentReads.length }))

  // No payment, or a failed read: empty, signed in all the same.
  db = setUp({ row: { membership_status: 'active' } })
  setFirstPayment(async () => ({ firstPaidIso: null, kept: 0, seen: 1, error: null }))
  r = await logIn()
  ok(signedIn(r) && rowOf(db).first_paid_at === null && db.calls('students', 'update').length === 0, 'a free member: no payment, nothing written, signed in')
  db = setUp({ row: { membership_status: 'active' } })
  setFirstPayment(async () => ({ firstPaidIso: null, kept: 0, seen: 0, error: 'http_other' }))
  r = await logIn()
  ok(signedIn(r) && rowOf(db).first_paid_at === null && r.log.some((l) => l.includes('first payment not read') && l.includes('http_other')),
     'a failed read: nothing written, signed in, and the log names the kind', show(r.log.filter((l) => l.includes('first payment'))))
  db = setUp({ row: { membership_status: 'active' } })
  setFirstPayment(async () => { throw new Error('a read that throws') })
  r = await logIn()
  ok(signedIn(r) && rowOf(db).first_paid_at === null, 'a read that throws: nothing written, signed in')

  // Whop slower than the login waits.
  db = setUp({ row: { membership_status: 'active' } })
  setFirstPayment(async () => { await wait(10_000); return { firstPaidIso: BOUGHT, kept: 1, seen: 1, error: null } })
  r = await logIn()
  ok(signedIn(r) && rowOf(db).first_paid_at === null && r.took === 2500,
     'a read taking 10 s: the login goes on after 2.5 s, signed in, first_paid_at left for the sync', show({ took: r.took, first: rowOf(db).first_paid_at }))
  timers = []

  // Filled meanwhile (the sync's recovery, between the login's read and its write): kept.
  db = setUp({ row: { membership_status: 'active' } })
  const push = db.log.push.bind(db.log)
  db.log.push = (q) => {
    if (q.table === 'students' && q.op === 'update') rowOf(db).first_paid_at = '2026-10-14T10:00:00.000Z'
    return push(q)
  }
  r = await logIn()
  ok(signedIn(r) && rowOf(db).first_paid_at === '2026-10-14T10:00:00.000Z', 'a value written meanwhile is not moved by the login\'s fill', rowOf(db).first_paid_at)
  delete process.env.WHOP_BYPASS_USER_IDS
}

console.log('\n=== The sync: no membership date; an empty paying row filled from the payment ===')
{
  resetClock(); freshWhop()
  /** A v2 membership as the product list gives it. */
  const mem = (user, plan, createdAt, extra = {}) => ({
    id: `mem_TEST${user.slice(-3)}${plan.slice(-2)}`, user, email: null, status: 'active', valid: true,
    created_at: RealDate.parse(createdAt) / 1000, expires_at: null, renewal_period_end: null, cancel_at_period_end: false,
    product: PRODUCT, plan, ...extra,
  })
  const free = (user) => mem(user, FREE_PLAN, FREE_DAY, { status: 'completed' })
  memberships = [
    // 31, new to the app: free on 5 September, bought on 14 October (the report's student).
    free(W(31)), mem(W(31), PAYING, '2026-10-14T10:00:00.000Z'),
    // 32: stored as the free date; the sync leaves it (only the repair moves it).
    free(W(32)), mem(W(32), PAYING, '2026-10-14T10:00:00.000Z'),
    // 33: corrected to the payment; the old sync put the free date back (earlier wins).
    free(W(33)), mem(W(33), PAYING, '2026-10-14T10:00:00.000Z'),
    // 34: new, on a yearly plan outside PAYING_WHOP_PLAN_IDS.
    mem(W(34), YEARLY, '2026-10-15T10:00:00.000Z'),
    // 35: new, on the paying plan with no real payment (a comp).
    mem(W(35), PAYING, '2026-10-16T10:00:00.000Z'),
    // 36: new, on the paying plan; Whop refuses its payments read.
    mem(W(36), PAYING, '2026-10-17T10:00:00.000Z'),
  ]
  payments = [
    pay(W(31), FREE_DAY, 0), pay(W(31), BOUGHT, 97), pay(W(32), BOUGHT, 97), pay(W(33), BOUGHT, 97),
    pay(W(34), '2026-10-15T10:00:00.000Z', 700, { plan_id: YEARLY }), pay(W(35), '2026-10-16T10:00:00.000Z', 0), pay(W(36), '2026-10-17T10:00:00.000Z', 97),
  ]
  answerWith = (_n, u) => (u.pathname === '/api/v1/payments' && u.searchParams.get('user_id') === W(36) ? answer('{"error":"forbidden"}', 403) : null)
  const db = new FakeDb({
    students: [
      { id: sid(32), whop_user_id: W(32), membership_status: 'active', whop_plan_id: PAYING, first_paid_at: FREE_DAY, joined_at: FREE_DAY },
      { id: sid(33), whop_user_id: W(33), membership_status: 'active', whop_plan_id: PAYING, first_paid_at: BOUGHT, joined_at: FREE_DAY },
    ],
  })
  installDb(db)
  const [result, log] = await quietly(() => runWhopCommunitySync(createClient(), 'cron'))
  const first = (n) => db.rows('students').find((s) => s.whop_user_id === W(n))?.first_paid_at
  ok(result.fetched === 6 && result.inserted === 4 && result.updated === 2 && result.errors === 0, 'the sync ran: 6 members, 4 new rows, 2 updated', show(result))
  ok(db.calls('students', 'upsert').every((q) => q.values.every((row) => !('first_paid_at' in row))),
     'no row of its upsert names first_paid_at, so it can neither stamp one nor write a stale one back')
  ok(first(31) === BOUGHT && result.first_paid_recovered === 1,
     'the new member who was free first: 14 October, from the payment (it was 5 September, the free membership\'s created_at)', show({ first: first(31), recovered: result.first_paid_recovered }))
  ok(first(32) === FREE_DAY, 'a stored date is left as it is (the repair corrects it, not the sync)', first(32))
  ok(first(33) === BOUGHT, 'a corrected date holds: the free membership\'s earlier date is no longer put back', first(33))
  ok(first(34) === null, 'a new member on a plan outside the paying list: left empty here (the login or the backfill fills it)', show(first(34)))
  ok(first(35) === null && log.some((l) => l.includes('no real payment')), 'a comp with no real payment: empty, and the log says so')
  ok(first(36) === null && log.some((l) => l.includes('payments read failed (http_401_403)')), 'a refused payments read: empty, and the log names the kind')
  const readFor = paymentRequests().map((q) => q.params.user_id)
  ok(same([...readFor].sort(), [W(31), W(35), W(36)]), 'payments are read only for the empty rows on the paying plan', show(readFor))
  ok(db.rows('sync_runs').length === 1 && db.rows('sync_runs')[0].status === 'success', 'one sync_runs row, success')
  ok(same(db.calls('students', 'update').map((q) => q.filters), [[`whop_user_id=${W(31)}`, 'first_paid_at is null']]),
     'the fill: one update, only while first_paid_at is empty', show(db.calls('students', 'update').map((q) => q.filters)))

  // A login fills the row between the sync's read and its fill: the login's value stays.
  freshWhop()
  memberships = [mem(W(37), PAYING, '2026-10-18T10:00:00.000Z')]
  payments = [pay(W(37), '2026-10-18T10:00:03.000Z', 97)]
  const raced = new FakeDb({ students: [] })
  installDb(raced)
  const push = raced.log.push.bind(raced.log)
  raced.log.push = (q) => {
    if (q.table === 'students' && q.op === 'update') raced.rows('students').find((s) => s.whop_user_id === W(37)).first_paid_at = '2026-10-18T10:00:02.000Z'
    return push(q)
  }
  const [again] = await quietly(() => runWhopCommunitySync(createClient(), 'cron'))
  ok(raced.rows('students')[0].first_paid_at === '2026-10-18T10:00:02.000Z' && again.first_paid_recovered === 0,
     'a value written meanwhile is kept, and not counted as recovered', show({ first: raced.rows('students')[0].first_paid_at, recovered: again.first_paid_recovered }))

  // Whop's payments in another shape: logged as a failed read, never as "no real payment" (which reads like a comp).
  freshWhop()
  memberships = [mem(W(39), PAYING, '2026-10-18T10:00:00.000Z')]
  payments = [pay(W(39), '2026-10-18T10:00:03.000Z', 97)]
  reshape = flat
  const blindDb = new FakeDb({ students: [] })
  installDb(blindDb)
  const [, blindLog] = await quietly(() => runWhopCommunitySync(createClient(), 'cron'))
  ok(blindDb.rows('students')[0].first_paid_at === null && blindLog.some((l) => l.includes('payments read failed (bad_page)')) && !blindLog.some((l) => l.includes('no real payment')),
     'payments in another shape: left empty, and the log names bad_page, not "no real payment"', show(blindLog.filter((l) => l.includes('first_paid'))))

  // The recovery starts a read at 239 s that Whop never answers: given up at 280 s, and the run still writes its success row.
  resetClock(); freshWhop()
  memberships = [mem(W(38), PAYING, '2026-10-18T10:00:00.000Z')]
  payments = [pay(W(38), '2026-10-18T10:00:03.000Z', 97)]
  answerWith = async (_n, u) => {
    if (u.pathname === '/api/v2/memberships') await wait(239_000)
    if (u.pathname === '/api/v1/payments') await wait(1_000_000)
    return null
  }
  const hungDb = new FakeDb({ students: [] })
  installDb(hungDb)
  const syncStart = clock
  const [hung, hungLog] = await quietly(() => runWhopCommunitySync(createClient(), 'cron'))
  const tookSync = clock - syncStart
  ok(paymentRequests().length === 1 && paymentRequests()[0].at - syncStart === 239_000 && hung.first_paid_recovered === 0 &&
     hungDb.rows('sync_runs').length === 1 && hungDb.rows('sync_runs')[0].status === 'success' && tookSync <= 280_200,
     'a payments read started at 239 s and never answered: given up at 280 s, the sync_runs success row written, the run over before Vercel\'s 300 s',
     show({ startedAt: paymentRequests()[0]?.at - syncStart, took: tookSync, runs: hungDb.rows('sync_runs').map((x) => x.status) }))
  ok(hungDb.rows('students')[0].first_paid_at === null && hungLog.some((l) => l.includes('payments read failed (time_budget)')),
     'and the row is left empty, the log naming time_budget (the next sync tries again)')
  timers = []
}

console.log('\n=== The backfill route: an empty first_paid_at filled from the payment ===')
{
  resetClock(); freshWhop()
  payments = [pay(W(41), FREE_DAY, 0), pay(W(41), BOUGHT, 97), pay(W(42), FREE_DAY, 0), pay(W(44), '2026-06-01T10:00:00.000Z', 97), pay(W(45), BOUGHT, 97)]
  answerWith = (_n, u) => (u.searchParams.get('user_id') === W(43) ? answer('{"error":"forbidden"}', 403) : null)
  const db = new FakeDb({
    students: [
      { id: sid(41), whop_user_id: W(41), membership_status: 'active', email: 'a@example.com' },
      { id: sid(42), whop_user_id: W(42), membership_status: 'active', email: 'b@example.com' },
      { id: sid(43), whop_user_id: W(43), membership_status: 'past_due', email: 'c@example.com' },
      { id: sid(44), whop_user_id: W(44), membership_status: 'active', first_paid_at: FREE_DAY, email: 'd@example.com' },
      { id: sid(45), whop_user_id: W(45), membership_status: 'canceled', email: 'e@example.com' },
    ],
    team_members: [{ id: 'auth-csm', role: 'csm', email: 'csm@example.com', full_name: 'Made Up Csm' }],
  }, { 'tok-csm': 'auth-csm' })
  installDb(db)
  const call = async (auth) => {
    const headers = auth ? { authorization: auth } : {}
    const [res] = await quietly(() => backfill(new Request('http://app/api/admin/backfill-first-paid-at', { method: 'POST', headers })))
    const text = await res.text()
    return { status: res.status, body: JSON.parse(text), text }
  }
  let r = await call(null)
  ok(r.status === 401 && asked.length === 0, 'no login: 401, Whop not asked')
  r = await call('Bearer tok-csm')
  ok(r.status === 403 && asked.length === 0, 'a CSM: 403, Whop not asked')
  r = await call(`Bearer ${SECRET}`)
  const first = (n) => db.rows('students').find((s) => s.id === sid(n)).first_paid_at
  ok(r.status === 200 && r.body.total_candidates === 3 && r.body.backfilled === 1 && r.body.no_payment === 1 && r.body.api_errors === 1,
     'three empty active or past_due rows: one filled, one with no payment, one failed read', show(r.body))
  ok(first(41) === BOUGHT && first(42) === null && first(43) === null, 'the buyer gets 14 October; the free member and the failed read stay empty')
  ok(first(44) === FREE_DAY && first(45) === null, 'a stored value is never a candidate; a canceled row is not either')
  ok(same(r.body.errors, [{ student_id: sid(43), reason: 'payments read failed: http_401_403' }]), 'the failure by kind and student id', show(r.body.errors))
  ok(!/user_TEST|@example|Made Up/.test(r.text), 'the answer names no Whop id, email or name')
  ok(same(gaps(paymentRequests()), [200, 200]), 'still 200 ms between students, the one with no payment included', show(gaps(paymentRequests())))
  ok(r.body.checked === 3 && r.body.remaining === 0 && r.body.next_after === null, 'all 3 read in one call: remaining 0, no next_after', show({ checked: r.body.checked, remaining: r.body.remaining }))

  // The cursor: from the student after the one named, in id order.
  db.rows('students').find((x) => x.id === sid(41)).first_paid_at = null
  freshWhop()
  payments = [pay(W(41), BOUGHT, 97), pay(W(42), FREE_DAY, 0)]
  const callWith = async (body) => {
    const [res] = await quietly(() => backfill(new Request('http://app/api/admin/backfill-first-paid-at', {
      method: 'POST', headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
    })))
    const text = await res.text()
    return { status: res.status, body: JSON.parse(text), text }
  }
  r = await callWith({ after: sid(41) })
  ok(r.status === 200 && same(paymentRequests().map((q) => q.params.user_id), [W(42), W(43)]) && r.body.checked === 2 && r.body.remaining === 0 && first(41) === null,
     'after a student id: only the students after it are read, in id order', show({ read: paymentRequests().map((q) => q.params.user_id), checked: r.body.checked }))
  for (const bad of ['not-an-id', 42, { id: sid(41) }]) {
    freshWhop()
    r = await callWith({ after: bad })
    ok(r.status === 400 && asked.length === 0, `after ${show(bad)}: 400, Whop not asked`, show(r.body))
  }

  // Payments in another shape: a failed read by its kind.
  freshWhop()
  payments = [pay(W(41), BOUGHT, 97)]
  reshape = flat
  r = await callWith({ after: null })
  ok(first(41) === null && r.body.errors.some((e) => e.student_id === sid(41) && e.reason === 'payments read failed: bad_page'),
     'payments in another shape: left empty, and the answer names bad_page, never "no payment"', show(r.body.errors))
}

console.log('\n=== The backfill route: no student started after 240 s, no read waited on past 280 s ===')
{
  resetClock(); freshWhop()
  const ids = [61, 62, 63, 64, 65, 66]
  payments = ids.map((n) => pay(W(n), BOUGHT, 97))
  // Seeded out of order: the route reads them in id order.
  const db = new FakeDb({ students: [...ids].reverse().map((n) => ({ id: sid(n), whop_user_id: W(n), membership_status: 'active' })) })
  installDb(db)
  const call = async (body) => {
    const startedAt = clock
    const [res] = await quietly(() => backfill(new Request('http://app/api/admin/backfill-first-paid-at', {
      method: 'POST', headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
    })))
    return { status: res.status, body: JSON.parse(await res.text()), took: clock - startedAt }
  }
  // Whop taking 70 s a read: students start at 0, 70.2, 140.4 and 210.6 s; the 4th read is still unanswered at 280 s.
  latency = 70_000
  let r = await call({})
  const first = (n) => db.rows('students').find((x) => x.id === sid(n)).first_paid_at
  ok(r.status === 200 && r.body.ok === true && r.body.checked === 3 && r.body.backfilled === 3 && r.body.remaining === 3 && r.body.next_after === sid(63) && r.took === 280_000,
     'Whop slow: 3 students filled, the 4th given up at 280 s, the answer at 280 s with remaining 3 and next_after the 3rd', show({ checked: r.body.checked, remaining: r.body.remaining, next: r.body.next_after, took: r.took }))
  ok(same(paymentRequests().map((q) => q.params.user_id), [W(61), W(62), W(63), W(64)]) && first(63) === BOUGHT && first(64) === null && r.body.api_errors === 0,
     'read in id order; the 4th is left empty and not counted as an error (the next call reads it first)', show(paymentRequests().map((q) => q.params.user_id)))
  timers = []

  // Whop taking 90 s: the 4th student would start at 270.6 s, past 240, so it is not started.
  resetClock(); freshWhop()
  payments = ids.map((n) => pay(W(n), BOUGHT, 97))
  for (const s of db.rows('students')) s.first_paid_at = null
  latency = 90_000
  r = await call({})
  ok(r.body.checked === 3 && r.body.remaining === 3 && paymentRequests().length === 3 && r.took === 270_600,
     'Whop taking 90 s a read: no 4th student is started past 240 s; the answer at 270.6 s', show({ requests: paymentRequests().length, took: r.took }))

  resetClock(); freshWhop()
  payments = ids.map((n) => pay(W(n), BOUGHT, 97))
  r = await call({ after: r.body.next_after })
  ok(r.body.checked === 3 && r.body.remaining === 0 && r.body.next_after === null && ids.every((n) => first(n) === BOUGHT),
     'the next call, from next_after: the other 3, remaining 0, every student filled', show({ checked: r.body.checked, remaining: r.body.remaining }))
}

globalThis.Date = RealDate
globalThis.setTimeout = realSetTimeout
globalThis.clearTimeout = realClearTimeout
globalThis.fetch = realFetch
ok(Date === RealDate && globalThis.setTimeout === realSetTimeout && globalThis.fetch === realFetch, 'the clock, the timers and fetch are the real ones again')

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
