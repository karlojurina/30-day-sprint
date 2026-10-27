// thirty-apply.test.mjs: the 30% that applies itself (T-137), work item 2 of
// _admin/prds/thirty-automatic/thirty_automatic_prd.md in the workspace: the
// Whop calls (the attach, the code found by name, the memberships holding a
// code, the create's typed error), the words, the lists, and the shared step
// (src/lib/thirty-apply.ts) that claims a request, makes its code, attaches
// it and marks it applied once Whop names it on the student's own membership.
//
// What runs is the real source, copied by build.mjs: thirty-apply.ts over the
// real coupon check and Whop reads (membership-discount.ts) on a stand-in for
// Whop's API, the rule's copies, the words; whop.ts's own copy for the
// create. The database is stub-server.ts's stand-in with v116's columns and
// history table (its three check lists refuse a value outside them), and runs
// with STUB_STRICT_NULL=1: an .eq() handed null throws, as PostgREST's
// eq.null matches nothing, so every conditional write on a value read as NULL
// is proven to say .is(). The code Whop makes is stub-admin.ts's stand-in
// (one list every copy shares), which can fail as the test says. The stand-in
// runs no trigger, so these checks prove the audit columns each write sets and
// the app's own attempt_failed rows; the trigger's events are v116.test.mjs's.
//
// The approve route's checks moved into thirtyApprovalChecks: the last
// section runs the route as it was at a031e8a (its own copy of the checks,
// taken from git), the route now (which calls the moved checks since work
// item 3) and the moved checks themselves on the same rows, and holds every
// answer equal.
//
// The clock is the suite's, as in membership-discount.test.mjs: `new Date()`
// and `Date.now()` answer it and setTimeout moves it, so the 4-a-second pace
// costs nothing. No request leaves the machine: the stand-in fetch fails the
// suite on any host but api.whop.com and answers that one itself. Every Whop
// id, key, name and code here is made up.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
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
const BANNED = /—|\bunlock|ecomtalent/i

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
const KEY = 'whop-test-key'
const PINNED = '2026-10-15-1'
const COMPANY = 'biz_devCompany'
const COURSE = 'prod_devCourse'
const OTHER = 'prod_devOther'
process.env.WHOP_API_KEY = KEY
process.env.WHOP_COMPANY_ID = COMPANY
process.env.WHOP_PRODUCT_ID = COURSE
process.env.STUB_STRICT_NULL = '1'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'
delete process.env.WHOP_DISCOUNT_PLAN_IDS
delete process.env.STUDENT_APP_CLOSED

// ── Whop, standing in ────────────────────────────────────────────────────────
const whop = {
  /** id -> { id, user, status, product, title, promo, renewal, cancel }: one membership, read alone or in a list. */
  memberships: new Map(),
  /** Every code Whop holds: { id, code, created_at }. The step's creates land here too (registerCreates). */
  codes: [],
  /** Every request: method, path, query, the pinned version, the key, the body, the signal. */
  log: [],
  /** (request) => a Response, 'throw', 'timeout', 'abort' or null: an answer of the test's choosing. */
  answer: null,
  /** (membershipId) => void: runs while Whop applies a code (a reject landing meanwhile). */
  onApply: null,
  /** Whether a code the step asks for is made on Whop (false: a refused create). */
  made: true,
}
const json = (status, body) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const money = (amount) => (amount === null ? null : { amount, currency: 'usd' })
/** A membership as Whop's pinned read gives it. */
const single = (m) => ({
  id: m.id, status: m.status, user_id: m.user, product_id: m.product, plan_id: 'plan_devMonthly97', promo_code_id: m.promo,
  renewal_price: money(m.renewal), cancel_at_period_end: m.cancel,
})
/** A membership as Whop's list gives it: the user and the product nested. */
const listed = (m) => ({
  ...single(m),
  user: m.user === null ? null : { id: m.user, username: 'someone' },
  product: m.product === null ? null : { id: m.product, title: m.title },
})
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url))
  if (u.hostname !== 'api.whop.com') throw new Error(`the suite let a request go to ${u.hostname}`)
  const h = init.headers ?? {}
  const req = {
    method: init.method ?? 'GET', path: u.pathname, params: u.searchParams, query: u.search, version: h['Api-Version-Date'] ?? null,
    idempotencyKey: h['Idempotency-Key'] ?? null, auth: h.Authorization ?? null, accept: h.Accept ?? null, contentType: h['Content-Type'] ?? null,
    body: typeof init.body === 'string' ? JSON.parse(init.body) : null, signal: init.signal ?? null, at: Date.now(),
  }
  whop.log.push(req)
  const special = whop.answer ? whop.answer(req) : null
  if (special === 'throw') throw new TypeError('fetch failed')
  if (special === 'timeout') throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
  if (special === 'abort') throw new DOMException('This operation was aborted', 'AbortError')
  if (special) return special
  if (req.method === 'POST') {
    const apply = u.pathname.match(/^\/api\/v1\/memberships\/([^/]+)\/apply_promo_code$/)
    if (apply) {
      const m = whop.memberships.get(decodeURIComponent(apply[1]))
      if (!m) return json(404, { error: { type: 'not_found', message: 'Membership not found.' } })
      if (whop.onApply) whop.onApply(m.id)
      if (m.promo) return json(400, { error: { type: 'invalid_request_error', message: 'This membership already has a promo code.' } })
      const code = whop.codes.find((c) => c.code.toLowerCase() === String(req.body?.promo_code ?? '').toLowerCase())
      if (!code) return json(400, { error: { type: 'invalid_request_error', message: 'Promo code not found.' } })
      m.promo = code.id
      return json(200, single(m))
    }
    if (u.pathname === '/api/v1/promo_codes') return json(200, { id: 'promo_devRealMade', code: req.body?.code })
    return json(404, { error: { message: 'Not found' } })
  }
  if (u.pathname === '/api/v1/memberships') {
    if (u.searchParams.get('company_id') !== COMPANY) return json(400, { error: { message: 'company_id is required' } })
    const promo = u.searchParams.get('promo_code_ids')
    const rows = [...whop.memberships.values()].filter((m) => m.promo === promo).slice(0, Number(u.searchParams.get('first') ?? 10))
    return json(200, { data: rows.map(listed), page_info: { has_next_page: false, end_cursor: null } })
  }
  if (u.pathname === '/api/v1/promo_codes') {
    if (u.searchParams.get('account_id') !== COMPANY) return json(400, { error: { message: 'account_id is required' } })
    const after = Date.parse(u.searchParams.get('created_after'))
    const all = whop.codes.filter((c) => Date.parse(c.created_at) > after).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
    const first = Number(u.searchParams.get('first') ?? 10)
    const from = Number(u.searchParams.get('after') ?? 0)
    const more = from + first < all.length
    return json(200, { data: all.slice(from, from + first).map((c) => ({ id: c.id, code: c.code, created_at: c.created_at })), page_info: { has_next_page: more, end_cursor: more ? String(from + first) : null } })
  }
  const one = u.pathname.match(/^\/api\/v1\/(memberships|plans|promo_codes)\/([^/]+)$/)
  if (one) {
    const id = decodeURIComponent(one[2])
    if (one[1] === 'memberships') return whop.memberships.has(id) ? json(200, single(whop.memberships.get(id))) : json(404, { error: { message: 'Not found' } })
    if (one[1] === 'plans') return json(200, { id, plan_type: 'renewal', renewal_price: '97.00' })
    const code = whop.codes.find((c) => c.id === id)
    return code ? json(200, { id, code: code.code }) : json(404, { error: { message: 'Not found' } })
  }
  return json(404, { error: { message: 'Not found' } })
}
/** A membership on Whop: the student's, active, on the course, renewing at 97.00, no code, unless `more` says otherwise. */
function member(id, more = {}) {
  whop.memberships.set(id, { id, user: 'user_s1', status: 'active', product: COURSE, title: 'The Sprint', promo: null, renewal: '97.00', cancel: false, ...more })
}
function resetWhop() {
  whop.memberships = new Map()
  whop.codes = []
  whop.log = []
  whop.answer = null
  whop.onApply = null
  whop.made = true
}
const calls = {
  applies: () => whop.log.filter((r) => r.method === 'POST' && r.path.endsWith('/apply_promo_code')),
  where: () => whop.log.filter((r) => r.method === 'GET' && r.path === '/api/v1/memberships'),
  members: () => whop.log.filter((r) => r.method === 'GET' && /^\/api\/v1\/memberships\/[^/]+$/.test(r.path)).map((r) => decodeURIComponent(r.path.split('/').pop())),
  codeLists: () => whop.log.filter((r) => r.method === 'GET' && r.path === '/api/v1/promo_codes'),
}

const S = await import('./_gen/stub-server.ts')
const { FakeDb, fakeClient, useDb: installDb, setCatalog } = S
const A = await import('./_gen/stub-admin.ts')
const { promoCodes, createSignals, whileWhopAnswers, setWhopCreateError, setWhopCreateBody } = A
const T = await import('./_gen/thirty-apply.ts')
const { putThirtyOn, thirtyApprovalChecks, whereIsCode, settleClaim, thirtyCodeName, requestShape, CLAIM_IN_PROGRESS_MS } = T
const W = await import('./_gen/thirty-words.ts')
const MD = await import('./_gen/membership-discount.ts')
const DS = await import('./_gen/discount-server.ts')
const WHOP = await import('./_gen/whop.ts')
const { POST: approveRoute } = await import('./_gen/discount-approve-route.ts')

// Every code the step asks Whop for is made on Whop (unless the test says it was refused), under the name it asked for.
whileWhopAnswers((params) => {
  if (whop.made) whop.codes.push({ id: `promo_${promoCodes.length}`, code: String(params.code), created_at: new Date().toISOString() })
})

/** Runs `fn` with what it logs kept off the suite's output and handed back; a throw comes back as `error`. */
async function quiet(fn) {
  const real = [console.info, console.warn, console.error]
  const lines = []
  console.info = console.warn = console.error = (...a) => { lines.push(a.map(String).join(' ')) }
  try { return { value: await fn(), lines, error: null } } catch (e) { return { value: null, lines, error: e instanceof Error ? e.message : String(e) } } finally { [console.info, console.warn, console.error] = real }
}

// ── The database ─────────────────────────────────────────────────────────────
const SID = '5a1b2c3d-0000-4000-8000-000000000001'
const OLD = 'ECOM30-5A1B2C'
const CORR = '11111111-1111-4111-8111-111111111111'
const TEAM = '22222222-2222-4222-8222-222222222222'
const NAME = /^ECOM30-[A-HJ-NP-Z2-9]{6}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
/**
 * One student and their request r1 (pending, made 10 minutes ago, unless `request` says otherwise): their membership
 * on file mem_s1, the coupon check's stored row naming `stored` (null: no stored row), and `others` beside r1.
 */
function seed(request = {}, { student = {}, stored = 'mem_s1', others = [] } = {}) {
  const db = new FakeDb({
    students: [{ id: SID, whop_user_id: 'user_s1', whop_membership_id: 'mem_s1', first_paid_at: ago(5 * DAY), ...student }],
    discount_requests: [{ id: 'r1', student_id: SID, status: 'pending', created_at: ago(10 * MIN), ...request }, ...others],
    student_membership_discounts: stored === null ? [] : [{ student_id: SID, whop_membership_id: stored }],
  })
  installDb(db)
  return db
}
/**
 * putThirtyOn on r1: the app in the student's request unless `opts` says otherwise, 20 seconds to finish. A throw
 * comes back as an answer of its own (outcome "threw", its message), so a check fails with the reason in its detail.
 */
async function put(db, opts = {}) {
  const r = await quiet(() => putThirtyOn(fakeClient(db), 'r1', { actor: { kind: 'auto' }, correlationId: CORR, deadlineMs: Date.now() + 20_000, couponSource: 'live', ...opts }))
  return r.error === null ? r : { ...r, value: { outcome: 'threw', status: null, reason: null, step: null, message: r.error } }
}
const JOB = { actor: { kind: 'job' } }
const TEAM_ACTOR = { actor: { kind: 'team', teamMemberId: TEAM } }
const writes = (db) => db.calls('discount_requests', 'update')
const events = (db) => db.rows('discount_request_events')
const r1 = (db) => db.rows('discount_requests').find((r) => r.id === 'r1')
/** Every write carries its audit columns: the actor, this action's correlation, the team member for the team alone. */
const audited = (db, actor, member = null) => writes(db).length > 0 && writes(db).every((w) =>
  w.values.audit_actor === actor && w.values.audit_correlation_id === CORR && w.values.audit_team_member_id === member)
/** The one attempt_failed event a failure leaves: its reason and detail, the actor, the member, the correlation. */
const failed = (db) => events(db).map((e) => ({ event: e.event, reason: e.reason, step: e.detail?.step ?? null, actor: e.actor, member: e.team_member_id, corr: e.correlation_id, detail: e.detail }))
/** An approved request holding our code `code`, named `name` (seedOn makes it on Whop). */
const approvedWith = (code = 'promo_devOurs', name = 'ECOM30-ABCDEF', more = {}) =>
  ({ status: 'approved', promo_code: name, whop_promo_id: code, reviewed_at: ago(HOUR), promo_claimed_at: ago(HOUR), ...more })
/** seed(), and the request's own code made on Whop when it holds one. Call it after resetWhop(). */
function seedOn(request = {}, seedOpts = {}) {
  const db = seed(request, seedOpts)
  if (request.whop_promo_id && request.promo_code) whop.codes.push({ id: request.whop_promo_id, code: request.promo_code, created_at: ago(HOUR) })
  return db
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== The three lists: v116\'s check lists, word for word ===')
{
  const sql = read('../supabase/migrations/2026_v116_discount_request_history.sql')
  const listOf = (column) => {
    const line = sql.split('\n').find((l) => new RegExp(`^\\s*${column}\\s+text\\b.*\\bcheck \\(`).test(l))
    const inner = line?.match(/\bin \(([^)]*)\)/)?.[1] ?? ''
    return inner.split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean)
  }
  const events = listOf('event')
  const actors = listOf('actor')
  const reasons = listOf('reason')
  ok(events.length === 8 && actors.length === 5 && reasons.length === 12, 'the migration\'s create table read: 8 events, 5 actors, 12 reasons, one list per line', show({ events, actors, reasons }))
  ok(show([...W.THIRTY_EVENTS]) === show(events) && show([...W.THIRTY_ACTORS]) === show(actors) && show([...W.THIRTY_REASONS]) === show(reasons),
     'thirty-words.ts\'s THIRTY_EVENTS, THIRTY_ACTORS and THIRTY_REASONS equal v116\'s, in the same order', show({ events: W.THIRTY_EVENTS, actors: W.THIRTY_ACTORS }))
  ok(show(S.V116_CHECKS) === show({ event: events, actor: actors, reason: reasons }),
     'and so do the stand-in database\'s, which refuse a value outside them')
  ok(W.JOB_NEW_CODE_WINDOW_MS === 48 * HOUR && CLAIM_IN_PROGRESS_MS === 300_000, 'the job\'s 48 hours and the claim\'s 5 minutes')
  // The stand-in refuses as Postgres does, and writes nothing.
  const db = new FakeDb()
  const c = fakeClient(db)
  const row = (more) => ({ request_id: 'r1', student_id: SID, event: 'attempt_failed', actor: 'job', reason: 'whop_no_answer', ...more })
  const good = await c.from('discount_request_events').insert(row({}))
  const badEvent = await c.from('discount_request_events').insert(row({ event: 'made' }))
  const badActor = await c.from('discount_request_events').insert(row({ actor: 'cron' }))
  const badReason = await c.from('discount_request_events').insert(row({ reason: 'whop_down' }))
  const noActor = await c.from('discount_request_events').insert(row({ actor: null }))
  const nullReason = await c.from('discount_request_events').insert(row({ reason: null }))
  ok(!good.error && !nullReason.error && badEvent.error?.code === '23514' && badActor.error?.code === '23514' && badReason.error?.code === '23514'
       && /discount_request_events_reason_check/.test(badReason.error.message) && noActor.error?.code === '23502' && db.rows('discount_request_events').length === 2,
     'the stand-in\'s check: an event, actor or reason outside the lists refused (23514), a missing actor too (23502), a null reason taken; nothing written for a refusal',
     show({ badEvent: badEvent.error, noActor: noActor.error, rows: db.rows('discount_request_events').length }))
  ok(typeof db.rows('discount_request_events')[0].id === 'number' && show(db.rows('discount_request_events')[0].detail) === '{}' && typeof db.rows('discount_request_events')[0].created_at === 'string',
     'an event\'s id is a number (v116\'s identity), its detail defaults to {}, its created_at to now')
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== thirtyCodeName: ECOM30- and 6 random characters ===')
{
  const many = Array.from({ length: 10_000 }, () => thirtyCodeName())
  ok(many.every((n) => NAME.test(n)), '10,000 names, every one ECOM30- and 6 of ABCDEFGHJKLMNPQRSTUVWXYZ23456789 (no 0, 1, I or O)', many.slice(0, 3).join(' '))
  const seen = new Set(many.flatMap((n) => [...n.slice(7)]))
  ok(seen.size === 32 && ![...'01IO'].some((ch) => seen.has(ch)), 'all 32 characters turn up across them, and never 0, 1, I or O', [...seen].sort().join(''))
  const thousand = Array.from({ length: 1_000 }, () => thirtyCodeName())
  ok(new Set(thousand).size === 1_000, 'no name repeats among 1,000')
  const src = read('../src/lib/thirty-apply.ts')
  ok(/CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"/.test(src) && /CODE_ALPHABET\[randomInt\(32\)\]/.test(src) && /import \{ randomInt, randomUUID \} from "crypto";/.test(src),
     'each character by crypto.randomInt(32)')
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== thirtyWords: every reason and step, by who acts next ===')
{
  const RETRY = 'The app tries again.'
  const LATE = 'The app only tries requests from the last 2 days. Approve or reject it.'
  const PAUSED = 'The app is paused. Approve or reject it.'
  const PAUSED_APPROVED = 'The app is paused. Press Try again or reject it.'
  const NOT_YET = "The app hasn't tried yet."
  // The situations: a pending row under 48 hours, one 48 hours or older, a claimed row (60 hours), an approved row,
  // and the app paused on a young pending row and on an approved one.
  const SITUATIONS = [
    ['pending under 48 h', { status: 'pending', ageHours: 3 }],
    ['pending 48 h+', { status: 'pending', ageHours: 50 }],
    ['claimed, 60 h', { status: 'pending', ageHours: 60, claimed: true }],
    ['approved', { status: 'approved', ageHours: 100 }],
    ['paused, pending', { status: 'pending', ageHours: 3, paused: true }],
    ['paused, approved', { status: 'approved', ageHours: 100, paused: true }],
  ]
  // What follows each kind of reason in those six situations, as §9.3 says it.
  const NEXT = {
    retried: [RETRY, LATE, RETRY, RETRY, PAUSED, PAUSED_APPROVED],
    held: [null, null, null, null, null, null],
    codeNotMade: [RETRY, LATE, null, null, PAUSED, PAUSED_APPROVED],
    none: [NOT_YET, LATE, NOT_YET, NOT_YET, PAUSED, PAUSED_APPROVED],
  }
  const C = 'ECOM30-ABCDEF'
  const FIX = 'Fix it in Whop, then tell the owner so the app records it.'
  const CASES = [
    ['no_membership', null, {}, 'Whop shows no paid course membership to put the code on.', 'retried'],
    ['membership_not_active', 'membership', { membershipStatus: 'past_due' }, "Their membership is past_due on Whop, so the code can't go on yet.", 'retried'],
    ['membership_not_active', 'membership', { membershipStatus: 'canceled' }, "Their membership is canceled on Whop, so the code can't go on yet.", 'retried'],
    ['membership_not_active', 'membership', { membershipStatus: 'trialing' }, 'Their membership is a trial on Whop. The app leaves trials to the team: Approve or Try again puts the code on.', 'held'],
    ['membership_has_code', 'membership', {}, 'Their membership already has another code on Whop.', 'retried'],
    ['membership_has_code', 'attach', {}, 'Their membership already has another code on Whop.', 'retried'],
    ['key_not_allowed', 'attach', {}, "Whop refused the app's key. It needs member:manage.", 'retried'],
    ['code_not_made', 'create', { message: 'A promo code with this code already exists.' }, "Whop wouldn't make the code: A promo code with this code already exists.", 'codeNotMade'],
    ['apply_refused', 'attach', { message: 'This membership already has a promo code.' }, "Whop wouldn't take the code: This membership already has a promo code.", 'retried'],
    ['landed_elsewhere', 'other_person', { code: C }, `Whop shows ${C} on someone else's membership. ${FIX}`, 'held'],
    ['landed_elsewhere', 'other_product', { code: C, product: 'Apex' }, `Whop shows ${C} on their Apex membership, not the course. ${FIX}`, 'held'],
    ['landed_elsewhere', 'other_product', { code: C }, `Whop shows ${C} on their membership of another product. ${FIX}`, 'held'],
    ['landed_elsewhere', 'free', { code: C }, `Whop shows ${C} on their free membership. ${FIX}`, 'held'],
    ['write_failed', 'decided_meanwhile', { code: C }, `Whop made ${C}, but the request had changed. Delete ${C} in Whop.`, 'held'],
    ['write_failed', 'approved_write_error', { code: C }, `Whop made ${C}, but saving it failed.`, 'retried'],
    ['write_failed', 'attach_after_reject', { code: C, confirmed: true }, `Whop attached ${C} after the request was rejected. It can only come off in Whop.`, 'held'],
    ['write_failed', 'attach_after_reject', { code: C, confirmed: false }, `Whop may have attached ${C} after the request was rejected. Check their membership in Whop.`, 'held'],
    // The build's review of 2026-10-27: another code of the name put on by Whop; a Reject that left the code usable;
    // the key refused on the code list and on the where read, each naming its scope.
    ['write_failed', 'attach_other_code', { code: C }, `Whop put another code named ${C} on their membership. Check it in Whop, then tell the owner so the app records it.`, 'held'],
    ['write_failed', 'rejected_usable', { code: C }, `Rejected. The code ${C} stays usable at checkout until someone switches it off in Whop.`, 'held'],
    ['key_not_allowed', 'list', {}, "Whop refused the app's key. It needs promo_code:basic:read.", 'retried'],
    ['key_not_allowed', 'where', {}, "Whop refused the app's key. It needs member:basic:read.", 'retried'],
    ['old_code', null, { code: OLD }, 'This code was made before the app attached codes itself. Press Try again to attach it, or attach it in Whop.', 'held'],
    ['code_unknown', null, { code: C }, `This request has a code with no Whop id, so the app can't check it. Check ${C} in Whop, then tell the owner so the app records it.`, 'held'],
    ['check_refused', null, { message: 'This student already has a 30% request that went through.' }, 'This student already has a 30% request that went through.', 'held'],
    ['whop_no_answer', 'attach', {}, "Whop didn't answer.", 'retried'],
    ['whop_no_answer', 'create', {}, "Whop didn't answer.", 'retried'],
    ['whop_no_answer', 'create_no_id', {}, "Whop didn't answer.", 'retried'],
    ['whop_no_answer', 'list', {}, "Whop didn't answer.", 'retried'],
    ['whop_no_answer', 'deadline', {}, "Whop didn't answer.", 'retried'],
    ['whop_no_answer', 'coupon_stored', {}, "Whop's coupon check didn't answer.", 'retried'],
    ['whop_no_answer', 'where', {}, "Whop didn't answer.", 'retried'],
    ['whop_no_answer', 'where_filter', { code: C }, `The app can't tell whose membership ${C} is on. Check it in Whop.`, 'held'],
    ['whop_no_answer', 'where_no_ids', { code: C }, `The app can't tell whose membership ${C} is on. Check it in Whop.`, 'held'],
    [null, null, {}, '', 'none'],
  ]
  const wrong = []
  let checked = 0
  const said = []
  for (const [reason, step, extra, why, kind] of CASES) {
    SITUATIONS.forEach(([situation, ctx], i) => {
      const next = NEXT[kind][i]
      const want = [why, next].filter((s) => s !== null && s !== '').join(' ')
      const got = W.thirtyWords(reason, step, { ...ctx, ...extra })
      checked++
      said.push(got)
      if (got !== want) wrong.push(`${reason}/${step}/${situation}: "${got}" (want "${want}")`)
    })
  }
  ok(wrong.length === 0 && checked === CASES.length * SITUATIONS.length,
     `every reason and step (${CASES.length}) in each of the six situations (${checked} in all): the words of §9.3, then what happens next by who acts`, wrong.slice(0, 3).join(' | '))
  ok(!said.some((s) => BANNED.test(s)) && !said.some((s) => /\btell [A-Z]/.test(s)) && said.some((s) => s.includes('tell the owner')),
     'no em dash, "unlock" or "EcomTalent" anywhere, and whoever is told is "the owner", never a person by name')
  // A decided row listed for a write_failed adds no next line; the trial's own words stand while paused.
  ok(W.thirtyWords('write_failed', 'approved_write_error', { status: 'rejected', ageHours: 5, code: C }) === `Whop made ${C}, but saving it failed.`
       && W.thirtyWords('membership_not_active', 'membership', { status: 'pending', ageHours: 2, paused: true, membershipStatus: 'trialing' })
         === 'Their membership is a trial on Whop. The app leaves trials to the team: Approve or Try again puts the code on.'
       && W.thirtyWords(null, null, { status: 'pending', ageHours: 47.99 }) === NOT_YET && W.thirtyWords(null, null, { status: 'pending', ageHours: 48 }) === LATE,
     'a rejected row: the words alone; a trial while paused: its own words alone; 47.99 hours still the app\'s, 48 the team\'s')
  ok(W.thirtyWords('code_not_made', 'create', { status: 'pending', ageHours: 1 }) === "Whop wouldn't make the code. The app tries again."
       && W.thirtyWords('membership_not_active', 'membership', { status: 'approved', ageHours: 1 }) === "Their membership is not active on Whop, so the code can't go on yet. The app tries again.",
     'with no message, or no status, a sentence still ends cleanly')
  const src = read('../src/lib/thirty-words.ts')
  ok(!/^import /m.test(src), 'thirty-words.ts imports nothing, so the 30% page (a client component) can read it')

  // The build's review of 2026-10-27: the job stops trying a request whose newest failure only a person can clear,
  // after JOB_GIVES_UP_AFTER failures, and the Why line hands it to the team.
  const HAS = 'Their membership already has another code on Whop.'
  const CANCELED = "Their membership is canceled on Whop, so the code can't go on yet."
  const STOP = 'The app stopped after 6 tries.'
  const words = (reason, step, ctx) => W.thirtyWords(reason, step, { ageHours: 100, status: 'approved', ...ctx })
  const GIVE_UP = [
    [words('membership_has_code', 'membership', { failures: 5 }), `${HAS} ${RETRY}`, 'another code, 5 failures: still tried'],
    [words('membership_has_code', 'membership', { failures: 6 }), `${HAS} ${STOP} Press Try again once that code is off their membership, or reject it.`, 'another code, 6 failures: stopped, Try again once that code is off'],
    [words('membership_not_active', 'membership', { failures: 6, membershipStatus: 'canceled' }), `${CANCELED} ${STOP} Press Try again if they join again, or reject it.`, 'canceled, 6: stopped, Try again if they join again'],
    [words('membership_not_active', 'membership', { failures: 9, membershipStatus: 'expired' }), `Their membership is expired on Whop, so the code can't go on yet. ${STOP} Press Try again if they join again, or reject it.`, 'expired, 9: stopped'],
    [words('membership_not_active', 'membership', { failures: 40, membershipStatus: 'past_due' }), `Their membership is past_due on Whop, so the code can't go on yet. ${RETRY}`, 'past_due, 40: still tried (Whop retries the payment)'],
    [words('membership_not_active', 'membership', { failures: 40, membershipStatus: 'trialing' }), 'Their membership is a trial on Whop. The app leaves trials to the team: Approve or Try again puts the code on.', 'a trial, 40: its own words alone'],
    [words('code_unknown', null, { failures: 40, code: C }), `This request has a code with no Whop id, so the app can't check it. Check ${C} in Whop, then tell the owner so the app records it.`, 'code unknown, 40: its own words alone (they already hand it to the team)'],
    [words('whop_no_answer', 'attach', { failures: 40 }), `Whop didn't answer. ${RETRY}`, 'Whop not answering, 40: still tried'],
    [words('membership_has_code', 'membership', { failures: 6, status: 'pending', ageHours: 5 }), `${HAS} ${STOP} Approve or reject it.`, 'a pending row under 48 hours, 6: stopped, Approve or reject it'],
    [words('membership_has_code', 'membership', { failures: 6, paused: true }), `${HAS} ${PAUSED_APPROVED}`, 'paused: the paused line first'],
  ]
  const off = GIVE_UP.filter(([got, want]) => got !== want)
  ok(off.length === 0 && W.JOB_GIVES_UP_AFTER === 6, `the stopped line, ${GIVE_UP.length} rows: ${GIVE_UP.map((g) => g[2]).join('; ')}`, off.map(([got, want, label]) => `${label}: "${got}" (want "${want}")`).slice(0, 2).join(' | '))
  ok(W.needsAPerson('membership_not_active', 'CANCELED') && W.needsAPerson('membership_has_code', null) && W.needsAPerson('code_unknown', null)
       && !W.needsAPerson('membership_not_active', 'past_due') && !W.needsAPerson('membership_not_active', 'trialing') && !W.needsAPerson('old_code', null)
       && !W.needsAPerson('whop_no_answer', null) && !W.needsAPerson('no_membership', null)
       && W.jobGivesUp('membership_has_code', null, 6) && !W.jobGivesUp('membership_has_code', null, 5) && !W.jobGivesUp('key_not_allowed', null, 99),
     'needsAPerson: another code, canceled or expired (any case), a code with no Whop id; not past_due, a trial, the old name, Whop silent, no membership; jobGivesUp from the 6th failure')
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== holdsAnotherThirty; madeOutsideApply as it was ===')
{
  const FIRST = '2026-10-20T10:00:00.000Z'
  const r = (id, status, created_at = '2026-10-21T10:00:00.000Z') => ({ id, status, created_at })
  ok(DS.holdsAnotherThirty([r('r0', 'approved'), r('r1', 'pending')], FIRST, 'r1') && DS.holdsAnotherThirty([r('r0', 'applied'), r('r1', 'pending')], FIRST, 'r1'),
     'another request approved, or applied: true')
  ok(!DS.holdsAnotherThirty([r('r0', 'rejected'), r('r1', 'pending')], FIRST, 'r1') && !DS.holdsAnotherThirty([r('r1', 'approved')], FIRST, 'r1')
       && !DS.holdsAnotherThirty([r('r0', 'pending'), r('r1', 'pending')], FIRST, 'r1') && !DS.holdsAnotherThirty([], FIRST, 'r1'),
     'a rejected one, a pending one, or the request itself approved: false')
  // A request made before the launch by a student whose window is their own does not count (requestCounts), approved or not.
  ok(!DS.holdsAnotherThirty([r('r0', 'approved', '2026-06-10T10:00:00.000Z'), r('r1', 'pending')], FIRST, 'r1')
       && DS.holdsAnotherThirty([r('r0', 'approved', '2026-06-10T10:00:00.000Z'), r('r1', 'pending')], '2026-10-03T10:00:00.000Z', 'r1'),
     'June\'s approved request: not counted for a first payment after the launch, counted for one in the shared window (requestCounts)')
  const fnOf = (s) => s.slice(s.indexOf('function madeOutsideApply('), s.indexOf('\n}\n', s.indexOf('function madeOutsideApply(')) + 2)
  const before = execFileSync('git', ['show', 'afd6bd4:src/lib/world/discount-server.ts'], { cwd: here('..'), encoding: 'utf8' })
  const now = read('../src/lib/world/discount-server.ts')
  ok(fnOf(before).length > 500 && fnOf(now) === fnOf(before) && !/export function madeOutsideApply/.test(now),
     'madeOutsideApply is byte for byte what it was at afd6bd4, and still not exported', `${fnOf(now).length} characters`)
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== createWhopPromoCode (whop.ts): a signal, and a typed error ===')
{
  const create = async (answer, opts) => {
    resetWhop()
    whop.answer = (req) => (req.method === 'POST' && req.path === '/api/v1/promo_codes' ? answer : null)
    try { return { value: await WHOP.createWhopPromoCode({ code: 'ECOM30-AAAAAA', amount_off: 30 }, opts) } } catch (e) { return { error: e } }
  }
  const signal = new AbortController().signal
  const made = await create(null, { signal })
  ok(made.value?.id === 'promo_devRealMade' && whop.log[0].signal === signal && whop.log[0].body.company_id === COMPANY && whop.log[0].body.code === 'ECOM30-AAAAAA',
     'a 2xx: the code\'s answer; the caller\'s signal reaches the request; company_id is added', show(made.value))
  const refused = await create(json(422, { error: { message: 'code taken' } }))
  const down = await create(json(503, 'busy'))
  const net = await create('throw')
  const aborted = await create('abort')
  const odd = await create(new Response('not json', { status: 200 }))
  const kinds = [refused, down, net, aborted, odd].map((r) => [r.error instanceof WHOP.WhopCallError, r.error ? r.error.status : 'none', r.error?.name])
  ok(show(kinds) === show([[true, 422, 'WhopCallError'], [true, 503, 'WhopCallError'], [true, null, 'WhopCallError'], [true, null, 'WhopCallError'], [true, null, 'WhopCallError']]),
     'a 422 and a 503 throw WhopCallError with their status; no connection, an abort and a 2xx body that does not read throw one with status null', show(kinds))
  ok(refused.error.message === 'Whop promo code creation failed: {"error":{"message":"code taken"}}' && refused.error instanceof Error,
     'its message is the one the approve route has always shown after "Details:"', refused.error.message)
  ok(typeof A.WhopCallError === 'function' && S.WhopCallError === A.WhopCallError && S.createWhopPromoCode === A.createWhopPromoCode && S.promoCodes === A.promoCodes,
     'both stand-ins export WhopCallError, and hand out one create and one list of codes asked for')
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== applyWhopPromoCode: the attach ===')
{
  const apply = async (answer, timeoutMs = 8_000) => {
    resetWhop()
    member('mem_a', { promo: null })
    whop.codes.push({ id: 'promo_a', code: 'ECOM30-AAAAAA', created_at: ago(MIN) })
    whop.answer = answer ? (req) => (req.method === 'POST' ? answer(req) : null) : null
    const r = await MD.applyWhopPromoCode('mem_a', 'ECOM30-AAAAAA', 'key-1', timeoutMs)
    return { r, req: whop.log[0] }
  }
  const { r: done, req } = await apply(null)
  ok(show(done) === show({ ok: true, promoCodeId: 'promo_a' }), 'Whop takes it: ok, naming the code it put on the membership', show(done))
  ok(req.method === 'POST' && req.path === '/api/v1/memberships/mem_a/apply_promo_code' && show(req.body) === show({ promo_code: 'ECOM30-AAAAAA' })
       && req.auth === `Bearer ${KEY}` && req.contentType === 'application/json' && req.accept === 'application/json' && req.version === PINNED
       && req.idempotencyKey === 'key-1' && req.signal instanceof AbortSignal,
     'POST .../memberships/{id}/apply_promo_code with the code\'s name, the key, JSON both ways, pinned to 2026-10-15-1, the Idempotency-Key handed in, and a time limit')
  const none = (await apply(() => json(200, { id: 'mem_a', promo_code_id: null }))).r
  const unreadable = (await apply(() => new Response('<html>', { status: 200 }))).r
  ok(show(none) === show({ ok: true, promoCodeId: null }) && unreadable.ok === false && unreadable.outcome === 'unknown' && unreadable.http === 200,
     '200 naming no code: ok with null; a 200 whose body does not read: unknown', show({ none, unreadable }))
  const long = 'x'.repeat(400)
  const outcomes = []
  for (const status of [400, 401, 403, 404, 422, 409, 429, 500, 502, 503, 410]) {
    const { r } = await apply(() => json(status, { error: { type: 'some', message: status === 400 ? long : `said ${status}` } }))
    outcomes.push([status, r.ok, r.outcome, r.http, r.message?.length === 300 ? 'cut' : r.message])
  }
  ok(show(outcomes) === show([
    [400, false, 'refused', 400, 'cut'], [401, false, 'refused', 401, 'said 401'], [403, false, 'refused', 403, 'said 403'], [404, false, 'refused', 404, 'said 404'],
    [422, false, 'refused', 422, 'said 422'], [409, false, 'unknown', 409, 'said 409'], [429, false, 'unknown', 429, 'said 429'], [500, false, 'unknown', 500, 'said 500'],
    [502, false, 'unknown', 502, 'said 502'], [503, false, 'unknown', 503, 'said 503'], [410, false, 'unknown', 410, 'said 410'],
  ]), '400, 401, 403, 404, 422 refused; 409, 429, 5xx and any other status unknown; the message is Whop\'s error.message, cut to 300 characters', show(outcomes))
  const net = (await apply(() => 'throw')).r
  const slow = (await apply(() => 'timeout')).r
  const noBody = (await apply(() => new Response('', { status: 403 }))).r
  ok(net.outcome === 'unknown' && net.http === null && slow.outcome === 'unknown' && slow.message === 'timeout' && noBody.outcome === 'refused' && noBody.message === null,
     'no connection and a timeout: unknown with no status; a refusal with no body: refused, no message', show({ net, slow, noBody }))
  delete process.env.WHOP_API_KEY
  const noKey = await apply(null)
  process.env.WHOP_API_KEY = KEY
  ok(noKey.r.ok === false && noKey.r.outcome === 'refused' && whop.log.length === 0, 'no key on the deployment: refused, and nothing is sent')
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== findThirtyCodeByName and findMembershipsWithCode: the two list reads ===')
{
  const ctx = () => MD.newReadContext(KEY)
  const AFTER = ago(30 * MIN)
  resetWhop()
  whop.codes.push({ id: 'promo_old', code: 'ECOM30-FOUNDX', created_at: ago(2 * HOUR) }, { id: 'promo_new', code: '  ecom30-foundx ', created_at: ago(10 * MIN) })
  const found = await MD.findThirtyCodeByName('ECOM30-FOUNDX', AFTER, ctx())
  const q = whop.log[0]
  ok(show(found) === show({ ok: true, id: 'promo_new' }) && q.params.get('account_id') === COMPANY && q.params.get('created_after') === AFTER
       && q.params.get('direction') === 'asc' && q.params.get('first') === '100' && q.version === PINNED && q.auth === `Bearer ${KEY}`,
     'found by its name, trimmed and the case not minded, among the codes made after the time (an older one of the same name left out); the read pinned, by account, oldest first, 100 a page', show(found))
  resetWhop()
  for (let i = 0; i < 250; i++) whop.codes.push({ id: `promo_f${i}`, code: `ECOM30-F${String(i).padStart(5, '0')}`, created_at: new Date(Date.now() - HOUR + i * 1000).toISOString() })
  whop.codes.push({ id: 'promo_target', code: 'ECOM30-TARGET', created_at: ago(30 * 1000) })
  const third = await MD.findThirtyCodeByName('ECOM30-TARGET', ago(2 * HOUR), ctx())
  ok(show(third) === show({ ok: true, id: 'promo_target' }) && calls.codeLists().length === 3 && calls.codeLists()[1].params.get('after') === '100' && calls.codeLists()[2].params.get('after') === '200',
     'on the 3rd page: the pages read in turn, each from the last one\'s end_cursor', show(calls.codeLists().map((r) => r.params.get('after'))))
  resetWhop()
  for (let i = 0; i < 150; i++) whop.codes.push({ id: `promo_g${i}`, code: `ECOM30-G${i}`, created_at: ago(HOUR - i * 1000) })
  const absent = await MD.findThirtyCodeByName('ECOM30-NOPE', ago(2 * HOUR), ctx())
  ok(show(absent) === show({ ok: true, id: null }) && calls.codeLists().length === 2, 'not among 150 codes on 2 pages: found nowhere', show(absent))
  resetWhop()
  for (let i = 0; i < 600; i++) whop.codes.push({ id: `promo_h${i}`, code: `ECOM30-H${i}`, created_at: new Date(Date.now() - 2 * HOUR + i * 1000).toISOString() })
  const endless = await MD.findThirtyCodeByName('ECOM30-H555', ago(3 * HOUR), ctx())
  ok(show(endless) === show({ ok: false, fail: 'too_many_pages' }) && calls.codeLists().length === 5,
     'still paging after the 5th page (the name is on the 6th): no answer, never "not found", and no 6th page read', show(endless))
  resetWhop()
  for (let i = 0; i < 150; i++) whop.codes.push({ id: `promo_i${i}`, code: `ECOM30-I${i}`, created_at: ago(HOUR - i * 1000) })
  whop.answer = (req) => (req.path === '/api/v1/promo_codes' && req.params.get('after') === '100' ? json(502, {}) : null)
  const brokenPage = await MD.findThirtyCodeByName('ECOM30-NOPE', ago(2 * HOUR), ctx())
  whop.answer = (req) => (req.path === '/api/v1/promo_codes' ? json(200, { data: [], page_info: { has_next_page: true, end_cursor: null } }) : null)
  const noCursor = await MD.findThirtyCodeByName('ECOM30-NOPE', ago(2 * HOUR), ctx())
  whop.answer = (req) => (req.path === '/api/v1/promo_codes' ? json(200, { items: [] }) : null)
  const shape = await MD.findThirtyCodeByName('ECOM30-NOPE', ago(2 * HOUR), ctx())
  delete process.env.WHOP_COMPANY_ID
  resetWhop()
  const noCompany = await MD.findThirtyCodeByName('ECOM30-NOPE', ago(2 * HOUR), ctx())
  process.env.WHOP_COMPANY_ID = COMPANY
  ok(show(brokenPage) === show({ ok: false, fail: 'http_other' }) && show(noCursor) === show({ ok: false, fail: 'bad_shape' }) && show(shape) === show({ ok: false, fail: 'bad_shape' })
       && show(noCompany) === show({ ok: false, fail: 'no_company_id' }) && whop.log.length === 0,
     'a page that fails, more pages with no cursor, a body in another shape, no company on the deployment: no answer (the last asks nothing)', show({ brokenPage, noCursor, shape, noCompany }))

  resetWhop()
  member('mem_w1', { promo: 'promo_w', renewal: null, title: 'The Sprint' })
  member('mem_w2', { promo: 'promo_w', user: null, product: null, renewal: '0.00' })
  const held = await MD.findMembershipsWithCode('promo_w', ctx())
  const wq = whop.log[0]
  ok(held.ok && show(held.memberships) === show([
    { id: 'mem_w1', userId: 'user_s1', status: 'active', productId: COURSE, productTitle: 'The Sprint', promoCodeId: 'promo_w', renewalPrice: null },
    { id: 'mem_w2', userId: null, status: 'active', productId: null, productTitle: null, promoCodeId: 'promo_w', renewalPrice: 0 },
  ]) && wq.params.get('promo_code_ids') === 'promo_w' && wq.params.get('company_id') === COMPANY && wq.params.get('first') === '10' && wq.version === PINNED,
     'each membership holding the code: its id, its user (none for a business buyer), status, product and its title, code, renewal price; pinned, by company, 10 at most', show(held))
  whop.answer = () => json(200, { data: [{ id: 'mem_x', user_id: 'user_flat', product_id: COURSE, promo_code_id: 'promo_w', renewal_price: '97.00', status: 'active' }] })
  const flat = await MD.findMembershipsWithCode('promo_w', ctx())
  whop.answer = () => json(200, { data: [{ user: { id: 'user_s1' } }] })
  const noId = await MD.findMembershipsWithCode('promo_w', ctx())
  whop.answer = () => json(500, {})
  const down = await MD.findMembershipsWithCode('promo_w', ctx())
  ok(flat.ok && flat.memberships[0].userId === 'user_flat' && flat.memberships[0].renewalPrice === 97 && show(noId) === show({ ok: false, fail: 'bad_shape' }) && show(down) === show({ ok: false, fail: 'http_other' }),
     'a user named only as user_id is read; a row naming no id, or Whop failing, is no answer', show({ flat, noId, down }))

  resetWhop()
  member('mem_r1', { status: 'past_due', cancel: true, renewal: null, promo: 'promo_x' })
  const one = await MD.readMembershipForApply('mem_r1', ctx())
  const notMem = await MD.readMembershipForApply('pay_r1', ctx())
  ok(show(one) === show({ ok: true, status: 'past_due', promoCodeId: 'promo_x', productId: COURSE, cancelAtPeriodEnd: true, renewalPrice: null })
       && show(notMem) === show({ ok: false, fail: 'not_a_membership' }) && whop.log.length === 1,
     'readMembershipForApply: the status, the code, the product, set to cancel, the renewal price; a payment\'s id is not asked about', show(one))
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== The coupon check names its membership, and can read without storing ===')
{
  const coupon = async (opts, more = {}) => {
    resetWhop()
    member('mem_s1', { promo: 'promo_evolve', renewal: '87.30' })
    whop.codes.push({ id: 'promo_evolve', code: 'evolve10', created_at: ago(30 * DAY) })
    const db = new FakeDb({ students: [{ id: SID, whop_user_id: 'user_s1', whop_membership_id: 'mem_s1', first_paid_at: ago(5 * DAY) }], ...more })
    const r = await quiet(() => MD.checkMembershipDiscount(fakeClient(db), SID, opts))
    return { r: r.value, db }
  }
  const live = await coupon({})
  const dry = await coupon({ store: false })
  ok(live.r.source === 'live' && live.r.membershipId === 'mem_s1' && live.r.saved === true && live.db.rows(MD.MEMBERSHIP_DISCOUNTS_TABLE).length === 1,
     'a live answer names the membership it was read from (mem_s1), and is stored', show(live.r))
  ok(dry.r.source === 'live' && dry.r.discounted === true && dry.r.membershipId === 'mem_s1' && dry.r.saved === false
       && dry.db.rows(MD.MEMBERSHIP_DISCOUNTS_TABLE).length === 0 && dry.db.calls(MD.MEMBERSHIP_DISCOUNTS_TABLE, 'upsert').length === 0,
     'store: false: the same answer, nothing written', show(dry.r))
  const T0 = '2026-10-25T08:00:00.000Z'
  const stored = await coupon({ apiKey: null }, { [MD.MEMBERSHIP_DISCOUNTS_TABLE]: [{ student_id: SID, whop_membership_id: 'mem_s1', promo_code_id: null, promo_code: null, renewal_price: 97, discounted: false, checked_at: T0, source: 'r6-membership', source_checked_at: T0 }] })
  const none = await coupon({ apiKey: null })
  ok(stored.r.source === 'stored' && stored.r.membershipId === 'mem_s1' && none.r.source === 'none' && none.r.membershipId === null,
     'a stored answer names the stored row\'s membership; no answer names none', show({ stored: stored.r, none: none.r }))
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== whereIsCode: whose membership holds a code ===')
{
  const student = (more = {}) => ({ id: SID, whopUserId: 'user_s1', membershipOnFile: 'mem_s1', membershipStored: 'mem_s1', firstPaidAt: null, ...more })
  const where = async (setup, s = student()) => { resetWhop(); setup(); return whereIsCode('promo_q', s, MD.newReadContext(KEY)) }
  const nowhere = await where(() => {})
  const theirs = await where(() => member('mem_s1', { promo: 'promo_q' }))
  const free = await where(() => member('mem_s1', { promo: 'promo_q', renewal: '0.00' }))
  const product = await where(() => member('mem_s1x', { promo: 'promo_q', product: OTHER, title: 'Apex' }))
  const person = await where(() => member('mem_p', { promo: 'promo_q', user: 'user_someone' }))
  const noRenewal = await where(() => member('mem_s1', { promo: 'promo_q', renewal: null, cancel: true }))
  const noProduct = await where(() => member('mem_s1', { promo: 'promo_q', product: null }))
  ok(show(nowhere) === show({ where: 'nowhere' }) && show(theirs) === show({ where: 'on_theirs', membershipId: 'mem_s1' })
       && show(free) === show({ where: 'elsewhere', step: 'free', membershipId: 'mem_s1', product: 'The Sprint' })
       && show(product) === show({ where: 'elsewhere', step: 'other_product', membershipId: 'mem_s1x', product: 'Apex' })
       && show(person) === show({ where: 'elsewhere', step: 'other_person', membershipId: 'mem_p', product: 'The Sprint' }),
     'an empty list: nowhere; the student\'s course membership: on_theirs; renewing at 0: elsewhere free; their other product\'s: elsewhere other_product; someone else\'s: elsewhere other_person',
     show({ nowhere, theirs, free, product, person }))
  ok(show(noRenewal) === show({ where: 'on_theirs', membershipId: 'mem_s1' }) && show(noProduct) === show({ where: 'on_theirs', membershipId: 'mem_s1' }),
     'a membership that won\'t renew (no renewal price, set to cancel) is still theirs (R3), and one naming no product counts as the course\'s')
  const filter = await where(() => { whop.answer = () => json(200, { data: [listed({ id: 'mem_z', user: 'user_s1', status: 'active', product: COURSE, title: 'T', promo: 'promo_OTHER', renewal: '97.00', cancel: false })] }) })
  const byId = await where(() => member('mem_s1', { promo: 'promo_q', user: null }))
  const notById = await where(() => member('mem_n', { promo: 'promo_q', user: null }))
  const noIds = await where(() => member('mem_n', { promo: 'promo_q', user: null }), student({ membershipOnFile: 'pay_x', membershipStored: null }))
  const noUserOnFile = await where(() => member('mem_s1', { promo: 'promo_q' }), student({ whopUserId: null }))
  const down = await where(() => { whop.answer = () => json(503, {}) })
  ok(show(filter) === show({ where: 'unknown', step: 'where_filter', fail: null }) && show(byId) === show({ where: 'on_theirs', membershipId: 'mem_s1' })
       && show(notById) === show({ where: 'elsewhere', step: 'other_person', membershipId: 'mem_n', product: 'The Sprint' })
       && show(noIds) === show({ where: 'unknown', step: 'where_no_ids', fail: null }) && show(noUserOnFile) === show({ where: 'on_theirs', membershipId: 'mem_s1' })
       && show(down) === show({ where: 'unknown', step: 'where', fail: 'http_other' }),
     'a row naming another code: the filter was ignored (unknown, where_filter); no user id on the row: matched by a membership id on file, else another person\'s; nothing to compare: unknown (where_no_ids); a failed read: unknown (where)',
     show({ filter, byId, notById, noIds, noUserOnFile, down }))
  const two = await where(() => { member('mem_p', { promo: 'promo_q', user: 'user_someone' }); member('mem_s1', { promo: 'promo_q' }) })
  const cannot = await where(() => { member('mem_p', { promo: 'promo_q', user: 'user_someone' }); member('mem_n', { promo: 'promo_q', user: null }) }, student({ membershipOnFile: null, membershipStored: null }))
  ok(two.where === 'on_theirs' && cannot.where === 'unknown' && cannot.step === 'where_no_ids', 'a row on theirs wins; a row that cannot be compared comes before one that is elsewhere', show({ two, cannot }))
  process.env.WHOP_PRODUCT_ID = ''
  const noCourse = await where(() => member('mem_s1', { promo: 'promo_q' }))
  process.env.WHOP_PRODUCT_ID = COURSE
  ok(show(noCourse) === show({ where: 'unknown', step: 'where', fail: 'no_course_product' }) && whop.log.length === 0, 'no course product named: unknown, and nothing asked')
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== settleClaim: a lost claim\'s code, looked up by its name (a read only) ===')
{
  const settle = async (row, setup) => {
    resetWhop()
    setup?.()
    const db = new FakeDb()
    const r = await settleClaim(fakeClient(db), { promo_code: 'ECOM30-LOSTXX', created_at: ago(20 * MIN), ...row }, MD.newReadContext(KEY))
    return { r, db, after: calls.codeLists()[0]?.params.get('created_after') ?? null }
  }
  const claimedAt = ago(10 * MIN)
  const created = ago(20 * MIN)
  const found = await settle({ promo_claimed_at: claimedAt }, () => whop.codes.push({ id: 'promo_lostxx', code: 'ECOM30-LOSTXX', created_at: ago(9 * MIN) }))
  const notFound = await settle({ promo_claimed_at: claimedAt })
  const noTime = await settle({ promo_claimed_at: null, created_at: created })
  const down = await settle({ promo_claimed_at: claimedAt }, () => { whop.answer = () => json(500, {}) })
  ok(show(found.r) === show({ found: 'promo_lostxx' }) && found.after === new Date(Date.parse(claimedAt) - 5 * MIN).toISOString()
       && show(notFound.r) === show({ notFound: true }) && noTime.after === new Date(Date.parse(created) - 5 * MIN).toISOString()
       && show(down.r) === show({ failed: 'http_other' }) && [found, notFound, noTime, down].every((x) => x.db.log.length === 0),
     'found (its id), not found, or failed; looked for from 5 minutes before the claim, or before the request with no claim time; nothing read or written in the database',
     show({ found: found.r, notFound: notFound.r, down: down.r }))
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== putThirtyOn: the student\'s Apply, start to end ===')
{
  resetWhop()
  member('mem_s1')
  const db = seed()
  const made = promoCodes.length
  // When Whop is asked about the membership, nothing has been written yet: where to attach comes before the claim.
  let writesAtRead = null
  whop.answer = (req) => { if (req.path === '/api/v1/memberships/mem_s1' && writesAtRead === null) writesAtRead = writes(db).length; return null }
  const r = await put(db, { membershipId: 'mem_s1' })
  const w = writes(db)
  const name = w[0]?.values.promo_code
  const id = `promo_${made + 1}`
  ok(r.value?.outcome === 'applied' && r.value.status === 'applied' && r1(db).status === 'applied' && r1(db).whop_promo_id === id && NAME.test(name) && r1(db).promo_code === name,
     'unclaimed, the app in the student\'s request, a membership that fits: claimed, made, approved, attached, applied', show(r.value ?? r.error))
  ok(w.length === 3 && audited(db, 'auto', null)
       && show(Object.keys(w[0].values).sort()) === show(['audit_actor', 'audit_correlation_id', 'audit_team_member_id', 'promo_claimed_at', 'promo_code'])
       && Date.parse(w[0].values.promo_claimed_at) >= Date.parse(NOW) && Date.parse(w[0].values.promo_claimed_at) <= Date.now()
       && show(w[0].filters) === show(['id=r1', 'status=pending', 'promo_code is null'])
       && w[1].values.status === 'approved' && w[1].values.whop_promo_id === id && w[1].values.reviewed_by === null && typeof w[1].values.reviewed_at === 'string'
       && show(w[1].filters) === show(['id=r1', 'status=pending', `promo_code=${name}`, 'whop_promo_id is null'])
       && w[2].values.status === 'applied' && w[2].values.applied_by === null && typeof w[2].values.applied_at === 'string'
       && show(w[2].filters) === show(['id=r1', 'status=approved', `whop_promo_id=${id}`]),
     'three writes, each with the audit columns (auto, this correlation, no member): the claim only while pending and unclaimed, approved only while it holds the claim and no id, applied only while approved with our id',
     show(w.map((x) => ({ v: x.values, f: x.filters }))))
  ok(show(promoCodes.at(-1)) === show({ code: name, amount_off: 30, promo_type: 'percentage', base_currency: 'usd', new_users_only: false, one_per_customer: true, stock: 1, promo_duration_months: 1 })
       && promoCodes.length === made + 1 && createSignals.at(-1) === true,
     'the code made with Approve\'s exact body under its new name, and a time limit (a signal)', show(promoCodes.at(-1)))
  const a = calls.applies()
  ok(a.length === 1 && a[0].path === '/api/v1/memberships/mem_s1/apply_promo_code' && a[0].body.promo_code === name && UUID.test(a[0].idempotencyKey) && a[0].version === PINNED,
     'attached to mem_s1 by its name, with a fresh Idempotency-Key, pinned', show(a.map((x) => ({ p: x.path, k: x.idempotencyKey }))))
  ok(calls.where().length === 0 && events(db).length === 0 && calls.members().join() === 'mem_s1',
     'a code made in the same attempt is never looked for first, nothing failed so no event; one membership read')
  ok(writesAtRead === 0 && whop.log[0].path === '/api/v1/memberships/mem_s1',
     'where to attach is read before the claim, so a membership that cannot take the code makes no code', String(writesAtRead))
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== putThirtyOn: an approved request, where its code is first ===')
{
  const approved = async (setup, opts = JOB, seedOpts = {}) => {
    resetWhop()
    member('mem_s1')
    const req = approvedWith()
    setup?.()
    const db = seedOn(req, seedOpts)
    const r = await put(db, opts)
    return { r: r.value, error: r.error, db, applies: calls.applies().length, where: calls.where().length, lines: r.lines }
  }
  const onTheirs = await approved(() => { whop.memberships.get('mem_s1').promo = 'promo_devOurs' })
  ok(onTheirs.r.outcome === 'applied' && onTheirs.applies === 0 && onTheirs.where === 1 && writes(onTheirs.db).length === 1 && audited(onTheirs.db, 'job', null)
       && show(writes(onTheirs.db)[0].filters) === show(['id=r1', 'status=approved', 'whop_promo_id=promo_devOurs']) && events(onTheirs.db).length === 0,
     'on their membership already: applied, no attach (the job\'s write, actor job)', show(onTheirs.r))
  const elsewhere = await approved(() => member('mem_x', { user: 'user_x', promo: 'promo_devOurs' }))
  ok(elsewhere.r.outcome === 'waiting' && elsewhere.r.reason === 'landed_elsewhere' && elsewhere.r.step === 'other_person' && elsewhere.applies === 0 && r1(elsewhere.db).status === 'approved'
       && show(failed(elsewhere.db).map((e) => [e.event, e.reason, e.step, e.actor, e.member, e.corr])) === show([['attempt_failed', 'landed_elsewhere', 'other_person', 'job', null, CORR]])
       && elsewhere.db.rows('discount_request_events')[0].detail.code === 'ECOM30-ABCDEF' && elsewhere.db.rows('discount_request_events')[0].detail.membership === 'mem_x',
     'on someone else\'s: landed_elsewhere (other_person), nothing written but the event, which names the code and the membership', show(failed(elsewhere.db)))
  const unknown = await approved(() => { whop.answer = (req) => (req.path === '/api/v1/memberships' ? json(500, {}) : null) })
  ok(unknown.r.reason === 'whop_no_answer' && unknown.r.step === 'where' && unknown.applies === 0 && writes(unknown.db).length === 0, 'the where read fails: whop_no_answer (where), nothing attached', show(unknown.r))
  // The build's review of 2026-10-27: a key the where read is refused for read as Whop not answering.
  const keyWhere = await approved(() => { whop.answer = (req) => (req.path === '/api/v1/memberships' ? json(403, { error: { message: 'not authorized' } }) : null) })
  ok(keyWhere.r.reason === 'key_not_allowed' && keyWhere.r.step === 'where' && keyWhere.applies === 0 && writes(keyWhere.db).length === 0 && failed(keyWhere.db)[0]?.detail.message === 'http_401_403',
     'the where read refused the key (403): key_not_allowed (where), nothing attached', show(keyWhere.r))
  const nowhere = await approved(null)
  ok(nowhere.r.outcome === 'applied' && nowhere.where === 1 && nowhere.applies === 1 && writes(nowhere.db).length === 1 && audited(nowhere.db, 'job', null),
     'on nobody\'s: goes on, attached to their membership, applied', show(nowhere.r))
  const filter = await approved(() => { whop.answer = (req) => (req.path === '/api/v1/memberships' ? json(200, { data: [listed({ id: 'mem_s1', user: 'user_s1', status: 'active', product: COURSE, title: 'T', promo: 'promo_else', renewal: '97.00', cancel: false })] }) : null) })
  ok(filter.r.reason === 'whop_no_answer' && filter.r.step === 'where_filter' && filter.applies === 0, 'the filter ignored: whop_no_answer (where_filter)', show(filter.r))
  const otherProduct = await approved(() => member('mem_s1apex', { promo: 'promo_devOurs', product: OTHER, title: 'Apex' }))
  ok(otherProduct.r.reason === 'landed_elsewhere' && otherProduct.r.step === 'other_product' && events(otherProduct.db)[0].detail.product === 'Apex',
     'their code on another product\'s membership: landed_elsewhere (other_product), the product named', show(otherProduct.r))
  const byId = await approved(() => { whop.memberships.get('mem_s1').promo = 'promo_devOurs'; whop.memberships.get('mem_s1').user = null })
  ok(byId.r.outcome === 'applied' && byId.applies === 0, 'no user id on the row, matched by the membership id on file: applied, no attach', show(byId.r))
  const noIds = await approved(() => member('mem_q', { promo: 'promo_devOurs', user: null }), JOB, { student: { whop_membership_id: 'pay_x' }, stored: null })
  ok(noIds.r.reason === 'whop_no_answer' && noIds.r.step === 'where_no_ids' && noIds.applies === 0, 'no user id and no mem_ id to compare: whop_no_answer (where_no_ids)', show(noIds.r))
  const noMemOnFile = await approved(() => { whop.memberships.get('mem_s1').promo = 'promo_devOurs' }, JOB, { student: { whop_membership_id: 'pay_x' }, stored: null })
  ok(noMemOnFile.r.outcome === 'applied' && noMemOnFile.applies === 0, 'no mem_ id on file, the code on their own membership (the user ids match): applied, no attach', show(noMemOnFile.r))
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== putThirtyOn: a lost claim, settled ===')
{
  const CLAIM = 'ECOM30-SETTLE'
  const settling = async (setup, opts = JOB, request = {}) => {
    resetWhop()
    member('mem_s1')
    setup?.()
    const db = seed({ promo_code: CLAIM, promo_claimed_at: ago(10 * MIN), created_at: ago(20 * MIN), ...request })
    const claimedAt = r1(db).promo_claimed_at
    const made = promoCodes.length
    const r = await put(db, opts)
    return { r: r.value, error: r.error, db, claimedAt, made: promoCodes.length - made, applies: calls.applies().length, lists: calls.codeLists() }
  }
  const pass = async () => ({ ok: true, coupon: { source: 'live', membershipId: 'mem_s1' } })
  const lostCode = (more = {}) => whop.codes.push({ id: 'promo_lost', code: CLAIM, created_at: ago(9 * MIN), ...more })
  const onTheirs = await settling(() => { lostCode(); whop.memberships.get('mem_s1').promo = 'promo_lost' })
  const w = writes(onTheirs.db)
  ok(onTheirs.r.outcome === 'applied' && onTheirs.made === 0 && onTheirs.applies === 0 && w.length === 2
       && w[0].values.status === 'approved' && w[0].values.whop_promo_id === 'promo_lost' && show(w[0].filters) === show(['id=r1', 'status=pending', `promo_code=${CLAIM}`, 'whop_promo_id is null'])
       && w[1].values.status === 'applied' && audited(onTheirs.db, 'job', null),
     'its code found, already on their membership: approved with that id, then applied, no attach and nothing new made', show(onTheirs.r))
  const lq = onTheirs.lists[0]
  ok(lq.params.get('created_after') === new Date(Date.parse(onTheirs.claimedAt) - 5 * MIN).toISOString(),
     'looked up among the codes made from 5 minutes before the claim')
  const foundNowhere = await settling(() => lostCode())
  ok(foundNowhere.r.outcome === 'applied' && foundNowhere.made === 0 && foundNowhere.applies === 1 && writes(foundNowhere.db).length === 2
       && writes(foundNowhere.db)[0].values.whop_promo_id === 'promo_lost' && r1(foundNowhere.db).promo_code === CLAIM,
     'found, on nobody\'s membership: approved with that id, then attached', show(foundNowhere.r))
  const anew = await settling(null, { ...JOB, freshChecks: pass, allowNewCode: true })
  const aw = writes(anew.db)
  ok(anew.r.outcome === 'applied' && anew.made === 1 && aw.length === 4
       && aw[0].values.promo_code === null && aw[0].values.promo_claimed_at === null
       && show(aw[0].filters) === show(['id=r1', 'status=pending', `promo_code=${CLAIM}`, 'whop_promo_id is null', `promo_claimed_at=${anew.claimedAt}`])
       && NAME.test(aw[1].values.promo_code) && aw[1].values.promo_code !== CLAIM && audited(anew.db, 'job', null),
     'not found, the checks pass: released only as it was read, then made anew under a new name and attached', show(aw.map((x) => x.filters)))
  const refused = await settling(null, { ...JOB, freshChecks: async () => ({ ok: false, status: 400, body: { error: 'Cannot approve: student has no first_paid_at on file.', code: 'rule' } }) })
  ok(refused.r.reason === 'check_refused' && refused.r.message === 'Cannot approve: student has no first_paid_at on file.' && refused.made === 0 && writes(refused.db).length === 1
       && r1(refused.db).promo_code === null && failed(refused.db)[0].detail.message === 'Cannot approve: student has no first_paid_at on file.',
     'not found, the checks refuse: released, then check_refused with the check\'s own sentence, and nothing made', show(refused.r))
  const old = await settling(null, { ...JOB, allowNewCode: false, freshChecks: pass })
  ok(old.r.outcome === 'waiting' && old.r.reason === null && old.made === 0 && writes(old.db).length === 1 && r1(old.db).promo_code === null && events(old.db).length === 0,
     'not found, made more than 48 hours ago: released and waiting, no new code and no event', show(old.r))
  const withOther = await (async () => {
    resetWhop()
    member('mem_s1')
    const db = seed({ promo_code: CLAIM, promo_claimed_at: ago(10 * MIN), created_at: ago(20 * MIN) },
      { others: [{ id: 'r0', student_id: SID, status: 'applied', created_at: ago(DAY), promo_code: 'ECOM30-EARLYR', whop_promo_id: 'promo_early' }] })
    const r = await put(db, { ...JOB, freshChecks: pass })
    return { r: r.value, db }
  })()
  ok(withOther.r.reason === 'check_refused' && withOther.r.message === 'This student already has a 30% request that went through.' && r1(withOther.db).promo_code === null && withOther.r.outcome === 'waiting',
     'not found, then a hold (another 30% that went through): released, and the hold\'s reason; nothing new made', show(withOther.r))
  const listDown = await settling(() => { whop.answer = (req) => (req.path === '/api/v1/promo_codes' ? json(502, {}) : null) })
  // 600 codes made 2 minutes before the claim, inside the 5 minutes either side of it where its own code would be.
  const tooMany = await settling(() => { for (let i = 0; i < 600; i++) whop.codes.push({ id: `promo_m${i}`, code: `ECOM30-M${i}`, created_at: new Date(Date.now() - 12 * MIN + i).toISOString() }) })
  ok(listDown.r.reason === 'whop_no_answer' && listDown.r.step === 'list' && tooMany.r.reason === 'whop_no_answer' && tooMany.r.step === 'list'
       && writes(listDown.db).length === 0 && writes(tooMany.db).length === 0 && listDown.made === 0 && tooMany.made === 0 && r1(tooMany.db).promo_code === CLAIM
       && tooMany.lists.length === 5,
     'the list fails, or runs past 5 pages of codes made around the claim: whop_no_answer (list) both times, the claim kept, nothing made', show({ listDown: listDown.r.step, tooMany: tooMany.r.step, pages: tooMany.lists.length }))
  // The build's review of 2026-10-27: a claim settled late, with 600 codes made after it (5 minutes or more after the
  // claim, so none of them its own): the read stops at the first of them, not found, instead of giving up after 500.
  const later = await settling(() => { for (let i = 0; i < 600; i++) whop.codes.push({ id: `promo_n${i}`, code: `ECOM30-N${i}`, created_at: new Date(Date.now() - 4 * MIN + i).toISOString() }) },
    { ...JOB, freshChecks: pass, allowNewCode: true })
  ok(later.r.outcome === 'applied' && later.lists.length === 1 && writes(later.db)[0].values.promo_code === null && later.made === 1,
     'a claim settled after 600 newer codes were made: one page read, not found, released and made anew (the codes after the claim\'s 5 minutes cannot be its own)', show({ r: later.r, pages: later.lists.length }))
  const unbounded = await settling(() => { for (let i = 0; i < 600; i++) whop.codes.push({ id: `promo_t${i}`, code: `ECOM30-T${i}`, created_at: new Date(Date.now() - 4 * MIN + i).toISOString() }) },
    JOB, { promo_claimed_at: null })
  ok(unbounded.r.reason === 'whop_no_answer' && unbounded.r.step === 'list' && unbounded.lists.length === 5 && r1(unbounded.db).promo_code === CLAIM,
     'with no claim time there is no end to look to: past 5 pages it is still no answer, the claim kept', show({ r: unbounded.r.step, pages: unbounded.lists.length }))
  // The key refused on the code list: key_not_allowed (list), its scope named.
  const listKey = await settling(() => { whop.answer = (req) => (req.path === '/api/v1/promo_codes' ? json(403, { error: { message: 'not authorized for promo_code:basic:read' } }) : null) })
  ok(listKey.r.reason === 'key_not_allowed' && listKey.r.step === 'list' && r1(listKey.db).promo_code === CLAIM && listKey.made === 0
       && W.thirtyWords(listKey.r.reason, listKey.r.step, { status: 'pending', ageHours: 1, claimed: true }) === "Whop refused the app's key. It needs promo_code:basic:read. The app tries again.",
     'Whop refusing the key on the code list: key_not_allowed (list), "It needs promo_code:basic:read.", the claim kept (it read as Whop not answering)', show(listKey.r))
  const noTime = await settling(null, { ...JOB, freshChecks: pass }, { promo_claimed_at: null })
  const rel = writes(noTime.db)[0]
  ok(noTime.r.outcome === 'applied' && rel.filters.includes('promo_claimed_at is null') && noTime.lists[0].params.get('created_after') === new Date(Date.parse(r1(noTime.db).created_at) - 5 * MIN).toISOString(),
     'a claim with no claim time: looked up from 5 minutes before the request, released with .is(promo_claimed_at, null), made anew', show(rel.filters))
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== putThirtyOn: a request reopened by hand ===')
{
  const reopened = async (setup, opts = JOB) => {
    resetWhop()
    member('mem_s1')
    whop.codes.push({ id: 'promo_hand', code: 'ECOM30-HANDXX', created_at: ago(DAY) })
    setup?.()
    const db = seed({ status: 'pending', promo_code: 'ECOM30-HANDXX', whop_promo_id: 'promo_hand', reviewed_by: 'team-old', reviewed_at: ago(DAY) })
    const r = await put(db, opts)
    return { r: r.value, error: r.error, db, applies: calls.applies().length }
  }
  const on = await reopened(() => { whop.memberships.get('mem_s1').promo = 'promo_hand' })
  const w = writes(on.db)
  ok(on.r.outcome === 'applied' && on.applies === 0 && w.length === 2 && show(Object.keys(w[0].values).sort()) === show(['audit_actor', 'audit_correlation_id', 'audit_team_member_id', 'status'])
       && w[0].values.status === 'approved' && show(w[0].filters) === show(['id=r1', 'status=pending', 'whop_promo_id=promo_hand'])
       && w[1].values.status === 'applied' && r1(on.db).reviewed_by === 'team-old' && audited(on.db, 'job', null),
     'the job, its code on their membership: approved (the status and the audit columns only, the reviewer kept), then applied: two writes', show(w.map((x) => x.values)))
  const nowhere = await reopened(null)
  ok(nowhere.r.reason === 'check_refused' && nowhere.r.message === 'Reopened by hand with ECOM30-HANDXX. Approve attaches that code, or reject it.' && nowhere.applies === 0 && writes(nowhere.db).length === 0,
     'the job, its code on nobody\'s: check_refused, left to the team', show(nowhere.r))
  const team = await reopened(null, TEAM_ACTOR)
  const tw = writes(team.db)
  ok(team.r.outcome === 'applied' && tw.length === 2 && tw[0].values.reviewed_by === TEAM && typeof tw[0].values.reviewed_at === 'string' && tw[1].values.applied_by === TEAM
       && team.applies === 1 && audited(team.db, 'team', TEAM),
     'the team on it: approved with reviewed_by the member, then attached and applied by them, each write naming the member', show(tw.map((x) => x.values)))
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== putThirtyOn: where to attach ===')
{
  const target = async (setup, opts = JOB, seedOpts = {}, request = approvedWith()) => {
    resetWhop()
    member('mem_s1')
    setup?.()
    const db = seedOn(request, seedOpts)
    const r = await put(db, opts)
    return { r: r.value, error: r.error, db, applies: calls.applies().map((a) => a.path.split('/')[4]), reads: calls.members() }
  }
  const pastDue = await target(() => { whop.memberships.get('mem_s1').status = 'past_due' })
  const canceling = await target(() => { Object.assign(whop.memberships.get('mem_s1'), { status: 'active', cancel: true, renewal: null }) })
  const cancelingWord = await target(() => { whop.memberships.get('mem_s1').status = 'canceling' })
  const free = await target(() => { whop.memberships.get('mem_s1').renewal = '0.00' })
  ok(pastDue.r.reason === 'membership_not_active' && pastDue.r.membershipStatus === 'past_due' && pastDue.applies.length === 0
       && canceling.r.outcome === 'applied' && cancelingWord.r.outcome === 'applied' && free.r.reason === 'no_membership',
     'only a past_due course membership: membership_not_active (past_due); one set to cancel, won\'t renew: attached; status canceling: attached; only a free one: no_membership',
     show({ pastDue: pastDue.r.reason, canceling: canceling.r.outcome, free: free.r.reason }))
  const ev = events(free.db)[0]
  ok(show(ev.detail.candidates) === show([{ membership: 'mem_s1', why: 'free' }]), 'the event names each candidate\'s reason', show(ev.detail))
  const paidStored = await target(() => { member('mem_free', { renewal: '0.00' }); member('mem_paid') }, JOB, { student: { whop_membership_id: 'mem_free' }, stored: 'mem_paid' })
  ok(paidStored.r.outcome === 'applied' && show(paidStored.applies) === show(['mem_paid']) && show(paidStored.reads) === show(['mem_free', 'mem_paid']),
     'approved, a free membership on file and a paid one stored: attached to the paid one', show({ applies: paidStored.applies, reads: paidStored.reads }))
  const preferPaid = await target(() => { member('mem_a', { renewal: null }); member('mem_b') }, JOB, { student: { whop_membership_id: 'mem_a' }, stored: 'mem_b' })
  ok(show(preferPaid.applies) === show(['mem_b']), 'two that fit: the one renewing above 0 before one that won\'t renew', show(preferPaid.applies))
  const onlyNull = await target(() => { member('mem_a', { renewal: null }) }, JOB, { student: { whop_membership_id: 'mem_a' }, stored: null })
  ok(onlyNull.r.outcome === 'applied' && show(onlyNull.applies) === show(['mem_a']), 'a null renewal price fits: a membership that won\'t renew takes the code when nothing else does', show({ outcome: onlyNull.r.outcome, applies: onlyNull.applies }))
  // The order of the candidates.
  const both = () => { member('mem_a'); member('mem_b'); member('mem_c') }
  const approvedOrder = await target(both, JOB, { student: { whop_membership_id: 'mem_a' }, stored: 'mem_b' })
  const pendingOrder = await target(both, { actor: { kind: 'auto' } }, { student: { whop_membership_id: 'mem_a' }, stored: 'mem_b' }, {})
  const firstOrder = await target(both, { ...JOB, membershipId: 'mem_c' }, { student: { whop_membership_id: 'mem_a' }, stored: 'mem_b' })
  ok(show(approvedOrder.applies) === show(['mem_a']) && show(approvedOrder.reads.slice(0, 2)) === show(['mem_a', 'mem_b'])
       && show(pendingOrder.applies) === show(['mem_b']) && show(pendingOrder.reads.slice(0, 2)) === show(['mem_b', 'mem_a'])
       && show(firstOrder.applies) === show(['mem_c']) && firstOrder.reads[0] === 'mem_c',
     'approved prefers the membership on file, a pending request the stored one, and opts.membershipId comes first', show({ approved: approvedOrder.reads, pending: pendingOrder.reads, first: firstOrder.reads }))
  // Each way a membership can fail to take the code (§9.3 step 2).
  const none = await target(null, JOB, { student: { whop_membership_id: null }, stored: null })
  const notFound = await target(() => whop.memberships.delete('mem_s1'))
  const four = await target(() => { whop.answer = (req) => (req.path === '/api/v1/memberships/mem_s1' ? json(422, {}) : null) })
  const notMem = await target(null, JOB, { student: { whop_membership_id: 'pay_x' }, stored: null })
  const key = await target(() => { whop.answer = (req) => (req.path === '/api/v1/memberships/mem_s1' ? json(403, {}) : null) })
  const quiet503 = await target(() => { whop.answer = (req) => (req.path === '/api/v1/memberships/mem_s1' ? json(503, {}) : null) })
  const otherProduct = await target(() => { whop.memberships.get('mem_s1').product = OTHER })
  const nullProduct = await target(() => { whop.memberships.get('mem_s1').product = null })
  const code = await target(() => { whop.memberships.get('mem_s1').promo = 'promo_evolve' })
  const trialJob = await target(() => { whop.memberships.get('mem_s1').status = 'trialing' })
  const trialAuto = await target(() => { whop.memberships.get('mem_s1').status = 'trialing' }, { actor: { kind: 'auto' } }, {}, {})
  const trialTeam = await target(() => { whop.memberships.get('mem_s1').status = 'trialing' }, { ...TEAM_ACTOR, allowOldName: true })
  const expired = await target(() => { whop.memberships.get('mem_s1').status = 'expired' })
  const setToCancel = await target(() => { whop.memberships.get('mem_s1').cancel = true })
  const got = (x) => [x.r?.outcome, x.r?.reason, x.r?.membershipStatus]
  ok(show([none, notFound, four, notMem].map(got)) === show([['waiting', 'no_membership', null], ['waiting', 'no_membership', null], ['waiting', 'no_membership', null], ['waiting', 'no_membership', null]])
       && show(events(notFound.db)[0].detail.candidates) === show([{ membership: 'mem_s1', why: 'not_found' }])
       && show(events(four.db)[0].detail.candidates) === show([{ membership: 'mem_s1', why: 'http_4xx' }])
       && show(events(notMem.db)[0].detail.candidates) === show([{ membership: 'pay_x', why: 'not_a_membership' }]) && notMem.reads.length === 0,
     'none on file, one Whop does not know (404), another 4xx, a payment\'s id (never read): each passed over, so no_membership naming why', show([none, notFound, four, notMem].map(got)))
  ok(show(got(key)) === show(['waiting', 'key_not_allowed', null]) && show(got(quiet503)) === show(['waiting', 'whop_no_answer', null]) && quiet503.r.step === 'membership',
     'the key refused (403): key_not_allowed; no answer (503): whop_no_answer (membership)')
  ok(show(got(otherProduct)) === show(['waiting', 'no_membership', null]) && nullProduct.r.outcome === 'applied'
       && show(got(code)) === show(['waiting', 'membership_has_code', 'active']) && code.applies.length === 0,
     'another product: no_membership; no product named: the course\'s, attached; another code on it: membership_has_code, nothing attached')
  ok(show(got(trialJob)) === show(['waiting', 'membership_not_active', 'trialing']) && show(got(trialAuto)) === show(['waiting', 'membership_not_active', 'trialing'])
       && trialAuto.db.calls('discount_requests', 'update').length === 0 && trialTeam.r.outcome === 'applied'
       && show(got(expired)) === show(['waiting', 'membership_not_active', 'expired']) && setToCancel.r.outcome === 'applied',
     'a trial: held for the job and in the student\'s request (no claim, no code), attached for the team; expired: membership_not_active; set to cancel: attached', show([trialJob, trialAuto, trialTeam, expired, setToCancel].map(got)))
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== putThirtyOn: what the app holds for the team ===')
{
  resetWhop()
  member('mem_s1')
  const inProgress = seed({ promo_code: 'ECOM30-NOWNOW', promo_claimed_at: ago(MIN) })
  const a = await put(inProgress)
  ok(a.value.outcome === 'waiting' && a.value.reason === null && whop.log.length === 0 && writes(inProgress).length === 0 && events(inProgress).length === 0,
     'a claim in progress (a minute old): waiting, no Whop call, no write, no event', show(a.value))
  const team = await put(seed({ promo_code: 'ECOM30-NOWNOW', promo_claimed_at: ago(MIN) }), TEAM_ACTOR)
  ok(team.value.outcome === 'claimed_elsewhere' && whop.log.length === 0, 'the team on it: claimed_elsewhere, nothing asked', show(team.value))
  const codeUnknown = []
  for (const opts of [JOB, { actor: { kind: 'auto' } }, { ...TEAM_ACTOR, allowOldName: true }]) {
    resetWhop()
    const db = seed({ status: 'approved', promo_code: 'ECOM30-NOIDXX', whop_promo_id: null })
    const r = await put(db, opts)
    codeUnknown.push([r.value.outcome, r.value.reason, whop.log.length, writes(db).length, failed(db).map((e) => [e.reason, e.actor, e.member])])
  }
  ok(show(codeUnknown) === show([
    ['waiting', 'code_unknown', 0, 0, [['code_unknown', 'job', null]]],
    ['waiting', 'code_unknown', 0, 0, [['code_unknown', 'auto', null]]],
    ['waiting', 'code_unknown', 0, 0, [['code_unknown', 'team', TEAM]]],
  ]), 'a code with no Whop id, for the job, in the student\'s request and on Try again: code_unknown, nothing called', show(codeUnknown))
  resetWhop()
  member('mem_s1')
  const another = seed({}, { others: [{ id: 'r0', student_id: SID, status: 'approved', created_at: ago(DAY), promo_code: 'ECOM30-EARLYR', whop_promo_id: 'promo_e' }] })
  const b = await put(another)
  ok(b.value.reason === 'check_refused' && b.value.message === 'This student already has a 30% request that went through.' && writes(another).length === 0 && whop.log.length === 0,
     'another 30% request of theirs went through: check_refused, no claim, nothing asked of Whop', show(b.value))
  resetWhop()
  member('mem_s1')
  const storedAnswer = seed()
  const c = await put(storedAnswer, { couponSource: 'stored' })
  const noAnswer = seed()
  const c2 = await put(noAnswer, { couponSource: 'none' })
  ok(c.value.reason === 'whop_no_answer' && c.value.step === 'coupon_stored' && c2.value.step === 'coupon_stored' && writes(storedAnswer).length === 0 && whop.log.length === 0,
     'a coupon answer from the stored row (or none): whop_no_answer (coupon_stored), no claim', show(c.value))
  resetWhop()
  member('mem_s1')
  const late = seed({ created_at: ago(3 * DAY) })
  const d = await put(late, { ...JOB, allowNewCode: false })
  ok(d.value.outcome === 'waiting' && d.value.reason === null && writes(late).length === 0 && events(late).length === 0 && whop.log.length === 0,
     'allowNewCode false: waiting, nothing written, no event', show(d.value))
  // A claim lost to another actor between the read and the claim.
  resetWhop()
  member('mem_s1')
  const raced = seed()
  raced.failWhen = (q) => {
    if (q.table === 'discount_requests' && q.op === 'update' && q.values?.promo_code && !q.values.status) Object.assign(raced.rows('discount_requests')[0], { promo_code: 'ECOM30-OTHERS', promo_claimed_at: ago(0) })
    return null
  }
  const made = promoCodes.length
  const e = await put(raced)
  ok(e.value.outcome === 'claimed_elsewhere' && promoCodes.length === made && calls.applies().length === 0, 'the claim lost to another actor: claimed_elsewhere, no create', show(e.value))
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== putThirtyOn: Whop making the code ===')
{
  const create = async (fail, opts = { actor: { kind: 'auto' } }) => {
    resetWhop()
    member('mem_s1')
    const db = seed()
    whop.made = fail === undefined
    if (fail?.error !== undefined) setWhopCreateError(fail.error)
    if (fail?.body !== undefined) setWhopCreateBody(fail.body)
    const r = await put(db, opts)
    setWhopCreateError(undefined)
    setWhopCreateBody(null)
    return { r: r.value, db }
  }
  const refused = await create({ error: 400 })
  const rw = writes(refused.db)
  ok(refused.r.reason === 'code_not_made' && refused.r.step === 'create' && rw.length === 2 && rw[1].values.promo_code === null && rw[1].values.promo_claimed_at === null
       && rw[1].filters.includes(`promo_claimed_at=${rw[0].values.promo_claimed_at}`) && r1(refused.db).promo_code === null
       && failed(refused.db)[0].detail.http === 400 && failed(refused.db)[0].detail.code === rw[0].values.promo_code && /Whop promo code creation failed/.test(refused.r.message),
     'a 4xx: the claim released (as it was set), code_not_made with Whop\'s words; the event names the name tried', show({ r: refused.r, release: rw[1].filters }))
  const noAnswer = await create({ error: null })
  const fiveHundred = await create({ error: 503 })
  const noId = await create({ body: { code: 'whatever' } })
  ok([noAnswer, fiveHundred, noId].every((x) => x.r.reason === 'whop_no_answer' && writes(x.db).length === 1 && NAME.test(r1(x.db).promo_code) && r1(x.db).whop_promo_id === null && x.r.promoCode === r1(x.db).promo_code)
       && show([noAnswer, fiveHundred, noId].map((x) => x.r.step)) === show(['create', 'create', 'create_no_id']),
     'no answer, a 5xx, a 2xx naming no promo_ id: the claim kept for a settle, whop_no_answer (create, create, create_no_id), the answer naming the claimed name',
     show([noAnswer, fiveHundred, noId].map((x) => [x.r.step, x.r.promoCode])))
  // The approved write.
  const approvedWrite = async (during, fail) => {
    resetWhop()
    member('mem_s1')
    const db = seed()
    if (fail) db.failWhen = (q) => (q.table === 'discount_requests' && q.op === 'update' && q.values?.status === 'approved' ? { message: 'connection reset' } : null)
    whileWhopAnswers((params) => {
      whop.codes.push({ id: `promo_${promoCodes.length}`, code: String(params.code), created_at: new Date().toISOString() })
      during?.(db, `promo_${promoCodes.length}`)
    })
    const r = await put(db)
    whileWhopAnswers((params) => { if (whop.made) whop.codes.push({ id: `promo_${promoCodes.length}`, code: String(params.code), created_at: new Date().toISOString() }) })
    return { r: r.value, db, lines: r.lines }
  }
  const ours = await approvedWrite((db, id) => Object.assign(db.rows('discount_requests')[0], { status: 'approved', whop_promo_id: id }))
  ok(ours.r.outcome === 'applied' && calls.applies().length === 1, '0 rows, the row already holding our id: goes on, attached and applied', show(ours.r))
  const decided = await approvedWrite((db) => Object.assign(db.rows('discount_requests')[0], { status: 'rejected' }))
  const dev = failed(decided.db)[0]
  ok(decided.r.outcome === 'decided_meanwhile' && decided.r.reason === 'write_failed' && decided.r.step === 'decided_meanwhile' && calls.applies().length === 0
       && dev.detail.step === 'decided_meanwhile' && NAME.test(dev.detail.code) && /^promo_\d+$/.test(dev.detail.whop_promo_id) && decided.r.whopPromoId === dev.detail.whop_promo_id
       && decided.lines.some((l) => l.includes('Delete')),
     '0 rows otherwise (rejected meanwhile): decided_meanwhile, a write_failed naming the code and its id, nothing attached, a log line', show(dev.detail))
  const dbError = await approvedWrite(null, true)
  const de = failed(dbError.db)[0]
  ok(dbError.r.outcome === 'write_error' && de.reason === 'write_failed' && de.step === 'approved_write_error' && r1(dbError.db).status === 'pending' && NAME.test(r1(dbError.db).promo_code)
       && r1(dbError.db).whop_promo_id === null && de.detail.whop_promo_id === dbError.r.whopPromoId,
     'a database error: write_error and a write_failed (approved_write_error), the claim kept', show(de.detail))
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== putThirtyOn: the old name, the status before the attach, the attach\'s answers ===')
{
  const attach = async (setup, opts = JOB, request) => {
    resetWhop()
    member('mem_s1')
    const req = request ?? approvedWith()
    setup?.()
    const db = seedOn(req)
    const r = await put(db, opts)
    return { r: r.value, error: r.error, db, applies: calls.applies(), where: calls.where().length, lines: r.lines }
  }
  const oldName = approvedWith('promo_old', OLD)
  const job = await attach(null, JOB, oldName)
  const tryAgain = await attach(null, { ...TEAM_ACTOR, allowOldName: true }, approvedWith('promo_old', OLD))
  ok(job.r.reason === 'old_code' && job.applies.length === 0 && tryAgain.r.outcome === 'applied' && tryAgain.applies.length === 1 && tryAgain.applies[0].body.promo_code === OLD,
     `the old name (${OLD}): the job leaves it (old_code); the team's Try again attaches it`, show({ job: job.r, tryAgain: tryAgain.r }))
  const oldOn = await attach(() => { whop.memberships.get('mem_s1').promo = 'promo_old' }, JOB, approvedWith('promo_old', OLD))
  ok(oldOn.r.outcome === 'applied' && oldOn.applies.length === 0, 'the old name already on their membership: the job still marks it applied')
  // A request reopened by hand holding the old name: a pending row, so the team's button is Approve (no Try again there).
  const reopenedOld = { status: 'pending', promo_code: OLD, whop_promo_id: 'promo_oldhand', reviewed_at: ago(DAY) }
  const teamApprove = await attach(null, TEAM_ACTOR, reopenedOld)
  const jobOnIt = await attach(null, JOB, reopenedOld)
  ok(teamApprove.r.outcome === 'applied' && teamApprove.applies.length === 1 && teamApprove.applies[0].body.promo_code === OLD
       && jobOnIt.r.reason === 'check_refused' && jobOnIt.applies.length === 0,
     'reopened by hand with the old name: the team\'s Approve attaches it (the guard is the app\'s alone); the job leaves the reopen to the team', show({ team: teamApprove.r, job: jobOnIt.r }))
  const moved = await (async () => {
    resetWhop()
    member('mem_s1')
    const db = seedOn(approvedWith())
    whop.answer = (req) => { if (req.method === 'GET' && req.path === '/api/v1/memberships/mem_s1') r1(db).status = 'rejected'; return null }
    const r = await put(db, JOB)
    return { r: r.value, db, applies: calls.applies().length }
  })()
  ok(moved.r.outcome === 'unchanged' && moved.r.status === 'rejected' && moved.applies === 0 && writes(moved.db).length === 0, 'the status changed before the attach: unchanged, nothing attached', show(moved.r))
  // The attach's answers.
  const answer = (fn) => () => { whop.answer = (req) => (req.method === 'POST' ? fn(req) : null) }
  // The build's review of 2026-10-27: the membership read just before held no code, so a 200 naming another code is
  // Whop attaching another code by this name (two codes can share one): its own write_failed, for the team.
  const otherId = await attach(answer(() => json(200, { id: 'mem_s1', promo_code_id: 'promo_someone' })))
  const sameName = failed(otherId.db)
  ok(otherId.r.reason === 'write_failed' && otherId.r.step === 'attach_other_code' && otherId.r.outcome === 'waiting' && otherId.r.status === 'approved'
       && writes(otherId.db).length === 0 && sameName.length === 1 && sameName[0].reason === 'write_failed' && sameName[0].detail.step === 'attach_other_code'
       && sameName[0].detail.attached === 'promo_someone' && sameName[0].detail.membership === 'mem_s1' && sameName[0].detail.code === 'ECOM30-ABCDEF' && sameName[0].detail.http === 200
       && otherId.lines.some((l) => l.includes('Whop put another code named ECOM30-ABCDEF (promo_someone) on membership mem_s1')),
     'a 200 naming another code, the membership read just before holding none: write_failed (attach_other_code), the code Whop attached in its detail, still approved, nothing written', show({ r: otherId.r, event: sameName }))
  ok(W.thirtyWords('write_failed', 'attach_other_code', { status: 'approved', ageHours: 50, code: 'ECOM30-ABCDEF', failures: 9 })
       === 'Whop put another code named ECOM30-ABCDEF on their membership. Check it in Whop, then tell the owner so the app records it.',
     'its Why line: another code of that name is on their membership; check it in Whop and tell the owner; no second line (the job leaves it)')
  const noIdOn = await attach(answer(() => { whop.memberships.get('mem_s1').promo = 'promo_devOurs'; return json(200, { id: 'mem_s1', promo_code_id: null }) }))
  ok(noIdOn.r.outcome === 'applied' && noIdOn.where === 2, 'a 200 naming none: Whop asked where the code is once more; on theirs, applied', show(noIdOn.r))
  const k401 = await attach(answer(() => json(401, { error: { message: 'missing credentials' } })))
  const k403 = await attach(answer(() => json(403, { error: { message: 'Company API key is not authorized for the member:manage scope.' } })))
  const r400 = await attach(answer(() => json(400, { error: { message: 'promo code cannot be applied' } })))
  ok(k401.r.reason === 'key_not_allowed' && k403.r.reason === 'key_not_allowed' && r400.r.reason === 'apply_refused' && r400.r.message === 'promo code cannot be applied'
       && failed(k403.db)[0].detail.http === 403 && [k401, k403, r400].every((x) => x.where === 1),
     '401 and 403: key_not_allowed; 400: apply_refused with Whop\'s words; none asks where the code is again', show([k401.r.reason, k403.r.reason, r400.r]))
  const conflictOn = await attach(answer(() => { whop.memberships.get('mem_s1').promo = 'promo_devOurs'; return json(409, { error: { message: 'conflict' } }) }))
  const slow = await attach(answer(() => 'timeout'))
  ok(conflictOn.r.outcome === 'applied' && conflictOn.where === 2 && slow.r.reason === 'whop_no_answer' && slow.r.step === 'attach' && slow.where === 2 && r1(slow.db).status === 'approved',
     'a 409, the code on theirs after all: applied; a timeout, the code nowhere: whop_no_answer (attach), still approved', show({ conflictOn: conflictOn.r.outcome, slow: slow.r }))
  const rejectedAfter = await (async () => {
    resetWhop()
    member('mem_s1')
    const db = seedOn(approvedWith())
    whop.onApply = () => { r1(db).status = 'rejected' }
    const r = await put(db, JOB)
    return { r: r.value, db, lines: r.lines }
  })()
  const ra = failed(rejectedAfter.db)[0]
  ok(rejectedAfter.r.outcome === 'ended_rejected' && rejectedAfter.r.confirmed === true && ra.reason === 'write_failed' && ra.step === 'attach_after_reject' && ra.detail.confirmed === true
       && r1(rejectedAfter.db).status === 'rejected' && rejectedAfter.lines.some((l) => l.includes('after the request was rejected')),
     'Whop attached ours, the applied write found the row rejected: ended_rejected, a write_failed (attach_after_reject, confirmed), a log line', show(ra.detail))
  const unknownRejected = await (async () => {
    resetWhop()
    member('mem_s1')
    const db = seedOn(approvedWith())
    whop.answer = (req) => { if (req.method === 'POST') { r1(db).status = 'rejected'; return json(500, {}) } return null }
    const r = await put(db, JOB)
    return { r: r.value, db }
  })()
  const ur = failed(unknownRejected.db)[0]
  ok(unknownRejected.r.outcome === 'ended_rejected' && unknownRejected.r.confirmed === false && ur.step === 'attach_after_reject' && ur.detail.confirmed === false,
     'an unknown attach answer, then the row rejected: write_failed (attach_after_reject, not confirmed), ended_rejected', show(ur.detail))
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== putThirtyOn: a retry, the deadline, a dry run, v116 missing ===')
{
  resetWhop()
  member('mem_s1')
  const db = seedOn(approvedWith())
  whop.answer = (req) => (req.method === 'POST' ? json(503, {}) : null)
  await put(db, JOB)
  whop.answer = null
  const second = await put(db, JOB)
  const keys = calls.applies().map((a) => a.idempotencyKey)
  ok(second.value.outcome === 'applied' && keys.length === 2 && keys.every((k) => UUID.test(k)) && keys[0] !== keys[1],
     'a retry after an unknown attach: a fresh Idempotency-Key every attach (Whop replays a key\'s answer for 24 hours)', show(keys))
  resetWhop()
  member('mem_s1')
  const short = seedOn(approvedWith())
  const s = await put(short, { ...JOB, deadlineMs: Date.now() + 1_500 })
  const fresh = seed()
  const s2 = await put(fresh, { deadlineMs: Date.now() + 1_999 })
  ok(s.value.reason === 'whop_no_answer' && s.value.step === 'deadline' && s2.value.step === 'deadline' && whop.log.length === 0 && writes(fresh).length === 0,
     'under 2 seconds left: whop_no_answer (deadline), and no Whop call starts', show([s.value, s2.value]))
  resetWhop()
  member('mem_s1')
  const roomy = seedOn(approvedWith())
  await put(roomy, { ...JOB, deadlineMs: Date.now() + 3_500 })
  const limit = calls.applies()[0]?.signal
  ok(limit instanceof AbortSignal, 'with 3.5 seconds left the calls still start, each limited (the attach carries its signal)')
  // Dry runs: nothing claimed, made, attached, stored or recorded.
  const dry = async (request, setup, opts = {}) => {
    resetWhop()
    member('mem_s1')
    setup?.()
    const db = seed(request)
    const made = promoCodes.length
    const r = await put(db, { ...JOB, dry: true, ...opts })
    return { r: r.value, db, made: promoCodes.length - made, writes: db.log.filter((q) => q.op !== 'select').length, applies: calls.applies().length }
  }
  const dOn = await dry(approvedWith(), () => { whop.memberships.get('mem_s1').promo = 'promo_devOurs' })
  const dSettle = await dry({ promo_code: 'ECOM30-SETTLE', promo_claimed_at: ago(10 * MIN) }, () => whop.codes.push({ id: 'promo_lost', code: 'ECOM30-SETTLE', created_at: ago(9 * MIN) }))
  const dSettleNot = await dry({ promo_code: 'ECOM30-SETTLE', promo_claimed_at: ago(10 * MIN) })
  const dHand = await dry({ promo_code: 'ECOM30-HANDXX', whop_promo_id: 'promo_hand' }, () => { whop.codes.push({ id: 'promo_hand', code: 'ECOM30-HANDXX', created_at: ago(DAY) }); whop.memberships.get('mem_s1').promo = 'promo_hand' })
  const dAttach = await dry(approvedWith())
  const dFresh = await dry({}, null, { freshChecks: async () => ({ ok: true, coupon: { source: 'live', membershipId: 'mem_s1' } }) })
  const dHold = await dry(approvedWith('promo_old', OLD))
  const all = [dOn, dSettle, dSettleNot, dHand, dAttach, dFresh, dHold]
  ok(show(all.map((x) => [x.r.outcome, x.r.would ?? null, x.r.found ?? null, x.r.reason])) === show([
    ['planned', 'mark_applied', null, null], ['planned', 'settle_claim', true, null], ['planned', 'settle_claim', false, null], ['planned', 'mark_applied', null, null],
    ['planned', 'attach', null, null], ['planned', 'claim_and_make', null, null], ['waiting', null, null, 'old_code'],
  ]) && all.every((x) => x.writes === 0 && x.made === 0 && x.applies === 0 && events(x.db).length === 0),
     'dry: a code already on theirs, mark_applied; a lost claim, settle_claim (found, and not); a hand reopen on theirs, mark_applied; an approved row, attach; a fresh one, claim_and_make; a hold says its reason; nothing written, made, attached or recorded',
     show(all.map((x) => [x.r.outcome, x.r.would, x.r.found, x.r.reason, x.writes])))
  resetWhop()
  const noV116 = seed()
  noV116.failWhen = (q) => (q.table === 'discount_requests' && q.op === 'select' && /\baudit_actor\b/.test(q.columns ?? '') ? { code: '42703', message: 'column discount_requests.audit_actor does not exist' } : null)
  const nr = await put(noV116)
  ok(nr.value.outcome === 'not_ready' && nr.value.status === null && whop.log.length === 0 && noV116.log.length === 1, 'v116 not pasted (42703 on audit_actor): not_ready, nothing asked of Whop or written', show(nr.value))
  // A request already decided, or gone.
  const decided = await put(seed({ status: 'applied' }))
  const gone = await quiet(() => putThirtyOn(fakeClient(seed()), 'r404', { actor: { kind: 'job' }, correlationId: CORR, deadlineMs: Date.now() + 20_000 }))
  ok(decided.value.outcome === 'unchanged' && decided.value.status === 'applied' && gone.value.outcome === 'unchanged' && gone.value.status === null && whop.log.length === 0,
     'an applied request, or one that is gone: unchanged, nothing asked')
  ok(requestShape({ status: 'pending', promo_code: 'X', promo_claimed_at: ago(CLAIM_IN_PROGRESS_MS - 1), whop_promo_id: null }, Date.now()) === 'in_progress'
       && requestShape({ status: 'pending', promo_code: 'X', promo_claimed_at: ago(CLAIM_IN_PROGRESS_MS), whop_promo_id: null }, Date.now()) === 'settling'
       && requestShape({ status: 'pending', promo_code: 'X', promo_claimed_at: 'nonsense', whop_promo_id: null }, Date.now()) === 'settling'
       && requestShape({ status: 'approved', promo_code: 'X', promo_claimed_at: null, whop_promo_id: 'pay_x' }, Date.now()) === 'code_unknown'
       && requestShape({ status: 'rejected', promo_code: null, promo_claimed_at: null, whop_promo_id: null }, Date.now()) === 'decided',
     'the shapes: a claim under 5 minutes in progress, at 5 minutes settling, a claim time that does not read settling, an approved row with no promo_ id code unknown')
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== STUB_STRICT_NULL: a value read as NULL is matched with .is() ===')
{
  const db = new FakeDb({ discount_requests: [{ id: 'r9', student_id: SID, promo_code: null }] })
  let threw = null
  try { fakeClient(db).from('discount_requests').update({ status: 'approved' }).eq('promo_code', null) } catch (e) { threw = e.message }
  ok(process.env.STUB_STRICT_NULL === '1' && /use \.is\(\) for null/.test(threw ?? ''), 'the stand-in throws on .eq(column, null) while STUB_STRICT_NULL=1', threw)
  delete process.env.STUB_STRICT_NULL
  let lax = null
  try { fakeClient(db).from('discount_requests').update({ status: 'approved' }).eq('promo_code', null); lax = 'no throw' } catch (e) { lax = e.message }
  process.env.STUB_STRICT_NULL = '1'
  ok(lax === 'no throw', 'and only then: other suites keep the stand-in as it was')
  const src = read('../src/lib/thirty-apply.ts')
  ok(/\.is\("promo_code", null\)/.test(src) && /\.is\("whop_promo_id", null\)/.test(src) && /claimedAt === null \? q\.is\("promo_claimed_at", null\) : q\.eq\("promo_claimed_at", claimedAt\)/.test(src),
     'every conditional write the step makes on a NULL read names .is(): the claim, the approved write, the release (and a claim time read as NULL)')
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== thirtyApprovalChecks: the approve route\'s checks, moved, every answer as the route gave it ===')
{
  // The route kept its own copy of these checks until work item 3 pointed it here. Each row is run through the route
  // as it was then (a031e8a, from git), the route now and the moved checks, on the same database, and the answers are
  // held equal: every refusal's status and body, every pass a pass (the route now goes on to put the 30% on, which
  // with no Whop key here leaves the request approved), and the same log lines.
  const OLD = 'a031e8a'
  {
    let s = execFileSync('git', ['show', `${OLD}:src/app/api/discounts/approve/route.ts`], { cwd: here('..'), encoding: 'utf8' })
    for (const [from, to] of [
      ['from "next/server"', 'from "./stub-server.ts"'],
      ['from "@/lib/admin-auth"', 'from "./stub-server.ts"'],
      ['from "@/lib/constants"', 'from "./constants.ts"'],
      ['from "@/lib/whop"', 'from "./stub-server.ts"'],
      ['from "@/lib/catalog-tables"', 'from "./stub-server.ts"'],
      ['from "@/lib/curriculum-reset"', 'from "./curriculum-reset.ts"'],
      ['from "@/lib/membership-discount"', 'from "./membership-discount.ts"'],
      ['from "@/lib/world/discount-server"', 'from "./discount-server.ts"'],
    ]) {
      if (!s.includes(from)) throw new Error(`the approve route at ${OLD} has no ${from}`)
      s = s.split(from).join(to)
    }
    if (s.includes('@/')) throw new Error(`an unrewritten @/ import remains in the approve route at ${OLD}`)
    fs.writeFileSync(here(`./_gen/discount-approve-route.${OLD}.ts`), s)
  }
  const { POST: oldApproveRoute } = await import(`./_gen/discount-approve-route.${OLD}.ts`)
  delete process.env.WHOP_API_KEY // the stored rows answer the coupon check here (no live read)
  const T0 = '2026-10-25T08:00:00.000Z'
  const STORED = {
    coupon: { student_id: SID, whop_membership_id: 'mem_s1', promo_code_id: 'promo_evolve', promo_code: 'evolve10', renewal_price: 87.3, plan_renewal_price: 97, discounted: true, checked_at: T0 },
    clean: { student_id: SID, whop_membership_id: 'mem_s1', promo_code_id: null, promo_code: null, renewal_price: 97, plan_renewal_price: null, discounted: false, checked_at: T0, source: 'r6-membership', source_checked_at: T0 },
    unpaid: { student_id: SID, whop_membership_id: 'mem_s1', promo_code_id: null, promo_code: null, renewal_price: null, plan_renewal_price: null, discounted: false, checked_at: T0, source: 'r6-payment', source_checked_at: T0 },
  }
  const WATCHED = '2026-10-21T10:00:00.000Z'
  /** The new course: two videos up to the gate, both watched unless `watched` says otherwise. */
  const newCourse = ({ student = { first_paid_at: '2026-10-20T10:00:00.000Z' }, stored = 'clean', request = {}, watched = 2, others = [], failWhen = null, reset = null } = {}) => () => {
    setCatalog({ v2: true, lessonsTable: 'lessons' })
    const db = new FakeDb({
      students: student === null ? [] : [{ id: SID, joined_at: '2026-10-20T10:00:00.000Z', whop_membership_id: 'mem_s1', whop_user_id: 'user_s1', ...student }],
      lessons: [
        { id: 'a1l01', type: 'watch', sort_order: 1, duration_seconds: 300 },
        { id: 'a1l02', type: 'watch', sort_order: 2, duration_seconds: 300, is_gate: true },
      ],
      lesson_videos: [{ lesson_id: 'a1l01', created_at: '2026-10-01T00:00:00.000Z' }, { lesson_id: 'a1l02', created_at: '2026-10-01T00:00:00.000Z' }],
      student_lesson_completions: ['a1l01', 'a1l02'].slice(0, watched).map((lesson_id) => ({ student_id: SID, lesson_id, completed_at: WATCHED })),
      discount_requests: [{ id: 'r1', student_id: SID, status: 'pending', created_at: '2026-10-26T09:00:00.000Z', ...request }, ...others],
      [MD.MEMBERSHIP_DISCOUNTS_TABLE]: stored === null ? [] : [STORED[stored]],
      admin_config: reset === null ? [] : [{ key: 'curriculum_reset_at', value: reset }],
    })
    if (failWhen) db.failWhen = failWhen
    return db
  }
  /** The old course: r1 and r2 lessons, done or not. */
  const oldCourse = ({ student = { first_paid_at: '2026-10-20T10:00:00.000Z' }, lessons = true, done = true, doneAt = '2026-10-22T10:00:00.000Z' } = {}) => () => {
    setCatalog({ v2: false })
    return new FakeDb({
      students: [{ id: SID, joined_at: '2026-10-20T10:00:00.000Z', whop_membership_id: 'mem_s1', whop_user_id: 'user_s1', ...student }],
      lessons: lessons ? [{ id: 'r1l1', region_id: 'r1', requires_action: false }, { id: 'r2l1', region_id: 'r2', requires_action: true }] : [{ id: 'a1l01', region_id: 'a1' }],
      student_lesson_completions: done ? [
        { student_id: SID, lesson_id: 'r1l1', completed_at: doneAt, action_completed_at: null, skipped_at: null },
        { student_id: SID, lesson_id: 'r2l1', completed_at: doneAt, action_completed_at: doneAt, skipped_at: null },
      ] : [{ student_id: SID, lesson_id: 'r1l1', completed_at: doneAt, action_completed_at: null, skipped_at: null }],
      discount_requests: [{ id: 'r1', student_id: SID, status: 'pending', created_at: '2026-10-26T09:00:00.000Z' }],
      [MD.MEMBERSHIP_DISCOUNTS_TABLE]: [STORED.clean],
    })
  }
  const ROWS = [
    ['the student is gone', newCourse({ student: null }), {}, 404],
    ['a coupon on the membership', newCourse({ stored: 'coupon' }), {}, 400],
    ['no paid plan and payment (stored unpaid)', newCourse({ stored: 'unpaid' }), {}, 400],
    ['a video not watched', newCourse({ watched: 0 }), {}, 400],
    ['the switch date unreadable', newCourse({ failWhen: (q) => (q.table === 'admin_config' ? { message: 'boom' } : null) }), {}, 500],
    ['a read the rule needs fails', newCourse({ failWhen: (q) => (q.table === 'lessons' ? { message: 'boom' } : null) }), {}, 500],
    ['no first payment on file', newCourse({ student: { first_paid_at: null } }), {}, 400],
    ['a first payment before 1 October', newCourse({ student: { first_paid_at: '2026-09-20T10:00:00.000Z' } }), {}, 400],
    ['a request made after the deadline', newCourse({ student: { first_paid_at: '2026-10-10T10:00:00.000Z' }, request: { created_at: '2026-10-25T10:00:00.000Z' } }), {}, 400],
    ['another request of theirs approved', newCourse({ others: [{ id: 'r0', student_id: SID, status: 'approved', created_at: '2026-10-22T10:00:00.000Z', promo_code: 'ECOM30-OTHERX', whop_promo_id: 'promo_o' }] }), {}, 400],
    ['a request from before the switch, its videos not watched', newCourse({ student: { first_paid_at: '2026-10-16T10:00:00.000Z' }, request: { created_at: '2026-10-18T10:00:00.000Z' }, watched: 0, reset: '2026-10-19T14:33:00.000Z' }), {}, 400],
    ['no coupon answer at all', newCourse({ stored: null }), {}, 503],
    ['the rule says yes', newCourse(), {}, 200],
    ['Approve anyway past the rule, no coupon answer', newCourse({ stored: null, watched: 0 }), { override: true }, 200],
    ['Approve anyway past a coupon', newCourse({ stored: 'coupon', watched: 0 }), { override: true, overrideCoupon: true }, 200],
    ['Approve anyway past unpaid', newCourse({ stored: 'unpaid' }), { override: true }, 200],
    ['the old course: no first payment', oldCourse({ student: { first_paid_at: null } }), {}, 400],
    ['the old course: no r1 or r2 lesson', oldCourse({ lessons: false }), {}, 409],
    ['the old course: a lesson not done', oldCourse({ done: false }), {}, 400],
    ['the old course: done after the window', oldCourse({ doneAt: '2026-11-20T10:00:00.000Z' }), {}, 400],
    ['the old course: done in time', oldCourse(), {}, 200],
  ]
  const results = []
  /** One press of a route on a fresh database: its status and body, and its log lines. */
  const pressOn = async (route, make, body) => {
    installDb(make())
    return quiet(async () => {
      const res = await route(new Request('http://app/api/discounts/approve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: 'r1', ...body }) }))
      return { status: res.status, body: await res.json() }
    })
  }
  for (const [label, make, body, want] of ROWS) {
    const viaOld = await pressOn(oldApproveRoute, make, body)
    const viaRoute = await pressOn(approveRoute, make, body)
    const checksDb = make()
    installDb(checksDb)
    const request = checksDb.rows('discount_requests').find((r) => r.id === 'r1')
    const viaChecks = await quiet(() => thirtyApprovalChecks(fakeClient(checksDb), { id: request.id, student_id: request.student_id, created_at: request.created_at },
      { override: body.override, overrideCoupon: body.overrideCoupon, teamMemberId: 'team-1' }))
    const c = viaChecks.value
    const sameAs = (v) => c && (c.ok ? v.value.status === 200 : c.status === v.value.status && show(c.body) === show(v.value.body))
    const linesOf = (v) => show(v.lines.filter((l) => l.startsWith('[discount approve]')))
    const checkLines = viaChecks.lines.filter((l) => l.startsWith('[discount approve]'))
    results.push({ label, want, old: viaOld.value.status, route: viaRoute.value.status, checks: c ? (c.ok ? 200 : c.status) : viaChecks.error,
      same: sameAs(viaOld) && sameAs(viaRoute), lines: linesOf(viaOld) === show(checkLines) && linesOf(viaRoute) === show(checkLines),
      checkLines, coupon: c?.ok ? c.coupon : undefined, body: c?.ok ? null : c?.body, now: viaRoute.value.body })
  }
  const off = results.filter((x) => !x.same || !x.lines || x.route !== x.want || x.old !== x.want)
  ok(off.length === 0 && results.length === 21, `${results.length} rows through the route at ${OLD}, the route now and the moved checks: every refusal's status and body the same, every pass a pass, and the same log lines (the override's naming the member)`,
     show(off.length ? off : results.map((x) => [x.label, x.old, x.route])))
  const passes = results.filter((x) => x.want === 200)
  ok(passes.length === 5 && passes.every((x) => x.now.success === true && x.now.status === 'approved' && x.now.reason === 'whop_no_answer' && x.now.step === 'membership'),
     'every pass, the route now: the code made and the request approved, Whop (no key here) not asked where to put it', show(passes.map((x) => [x.label, x.now.status, x.now.reason])))
  const byLabel = Object.fromEntries(results.map((x) => [x.label, x]))
  const anyway = results.filter((x) => x.label.startsWith('Approve anyway'))
  ok(anyway.length === 3 && anyway.every((x) => x.checkLines.some((l) => l.startsWith('[discount approve] OVERRIDE by team member team-1, request r1,')))
       && anyway[0].checkLines.some((l) => l.endsWith('Eligibility gates skipped. The coupon check gave no answer.'))
       && anyway[1].checkLines.some((l) => l.endsWith('Eligibility gates skipped. The coupon check skipped.'))
       && anyway[2].checkLines.some((l) => l.endsWith('Eligibility gates skipped. Whop does not show both a paid course plan and a course payment that went through.')),
     'each Approve anyway logs the override naming the member and what it skipped, word for word as the route does', show(anyway.map((x) => x.checkLines)))
  ok(byLabel['a coupon on the membership'].body.code === 'has-discount' && byLabel['no coupon answer at all'].body.code === 'rule' && byLabel['a video not watched'].body.code === 'rule'
       && byLabel['the student is gone'].body.error === 'Student not found' && byLabel['the student is gone'].body.code === undefined,
     'the coupon\'s refusal carries code has-discount, the rule\'s and an unchecked coupon\'s code rule, a missing student none')
  ok(byLabel['the rule says yes'].coupon?.source === 'stored' && byLabel['the rule says yes'].coupon?.membershipId === 'mem_s1' && byLabel['Approve anyway past a coupon'].coupon === null,
     'a pass hands back the coupon check\'s answer (its membership with it); Approve anyway past the coupon, none (Whop not asked)')
  const step = read('../src/lib/thirty-apply.ts')
  const checksSrc = step.slice(step.indexOf('export async function thirtyApprovalChecks('), step.indexOf('// ── The student, and where a code sits'))
  ok(/OVERRIDE by team member \$\{opts\.teamMemberId\}/.test(checksSrc) && (checksSrc.match(/\.\.\.RULE/g) ?? []).length === 8 && /checkMembershipDiscount\(db, request\.student_id, \{ store: opts\.store \}\)/.test(checksSrc),
     'the override log line takes teamMemberId; the 8 refusals Approve anyway skips carry code rule; the coupon check takes store')
  // store: false (the job's dry run) reads Whop without storing.
  process.env.WHOP_API_KEY = KEY
  resetWhop()
  member('mem_s1', { promo: 'promo_evolve' })
  whop.codes.push({ id: 'promo_evolve', code: 'evolve10', created_at: ago(30 * DAY) })
  const dryDb = newCourse({ stored: null })()
  const dryChecks = await quiet(() => thirtyApprovalChecks(fakeClient(dryDb), { id: 'r1', student_id: SID, created_at: '2026-10-26T09:00:00.000Z' }, { store: false }))
  ok(dryChecks.value.ok === false && dryChecks.value.body.code === 'has-discount' && dryDb.rows(MD.MEMBERSHIP_DISCOUNTS_TABLE).length === 0,
     'store: false: Whop\'s coupon answers now (a coupon refuses), and nothing is stored', show(dryChecks.value))
}

ok(Date === Clock, 'the suite\'s clock ran throughout')
globalThis.Date = RealDate
globalThis.setTimeout = realSetTimeout
console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
