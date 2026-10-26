// admin-discounts.test.mjs: the team's buttons on /admin/discounts and the
// routes behind them (fix lane G1, 2026-10-20).
//
//   admin-1 / discount-1: Cancel (or Esc) on the Reject prompt rejected the
//   request anyway, with no reason, and on the new course a rejection is final.
//   admin-4 / discount-3: Reject overwrote a request another team member (or
//   another tab) had already approved or marked applied, and Approve's last
//   write overwrote a rejection that landed while Whop made the code.
//   The admin PRD review (2026-10-19): who approved, rejected or marked a
//   request applied is the logged-in team member, never what the browser
//   sends, and the routes' refusals are plain sentences with no em dash.
//   Lovro, 2026-10-20: Approve no longer checks the ads tick
//   (students.ad_submissions_verified); the 30% rule alone decides.
//   The 30% that applies itself (T-137, _admin/prds/thirty-automatic in the
//   workspace, §9.4): Approve claims the request, makes its code under a
//   random name and attaches it to the student's membership; Try again (an
//   approved request) attaches it with no checks; Reject asks Whop where a
//   code is before it rejects a request whose code may exist; Mark code
//   applied (POST /api/discounts/mark-applied) is gone. Each row of the PRD's
//   approve and reject tables has its section below, with the Approve anyway
//   event.
//
// The routes run as they are. This file copies each one into _gen/ with only
// its import lines rewritten, as build.mjs and discount-queue.test.mjs do: the
// team's login and Whop's promo code go to stub-admin.ts, Next and the
// database to stub-server.ts, the rule and the 30%'s step to build.mjs's
// copies (run it first; `npm run test:client` does). Whop's API is a stand-in
// fetch below (a membership read, the attach, the memberships holding a code,
// the codes made after a moment); nothing leaves the machine. The page's own
// button handlers are taken from its source with TypeScript's parser, their
// types stripped and nothing else changed, and run with the browser's prompt()
// and fetch() standing in: fetch hands the call to the route copies, so the
// button, the route and the row are one path. The page and the routes as they
// were at BASE (production, where this lane started) are taken from git and
// run beside them, so each check is shown failing on the old code. Every
// student, id, key and code here is made up.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const BASE = '70c934a' // production when fix lane G1 started

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const fromSrc = (rel) => fs.readFileSync(here(`../${rel}`), 'utf8')
const fromBase = (rel) => execFileSync('git', ['show', `${BASE}:${rel}`], { cwd: here('..'), encoding: 'utf8' })

function write(text, label, outRel, rewrites) {
  let s = text
  for (const [from, to] of rewrites) {
    if (!s.includes(from)) throw new Error(`${label} has no ${from}`)
    s = s.split(from).join(to)
  }
  if (s.includes('@/')) throw new Error(`an unrewritten @/ import remains in ${label}`)
  fs.writeFileSync(here(outRel), s)
  console.log(`generated ${outRel} from ${label}`)
}
/**
 * The route at `rel`, now and at BASE, copied to _gen/<out>.ts and
 * _gen/<out>.old.ts. `nowOnly`: rewrites for imports the route gained after
 * BASE (the coupon check of admin rebuild 2, D5; the 30%'s step of T-137),
 * applied to today's copy; `oldOnly`: those it has lost since (T-137 moved
 * Approve's checks and its promo code into thirty-apply.ts), applied to BASE's.
 */
function copyRoute(rel, out, rewrites, nowOnly = [], oldOnly = []) {
  write(fromSrc(rel), rel, `./_gen/${out}.ts`, [...rewrites, ...nowOnly])
  write(fromBase(rel), `${rel}@${BASE}`, `./_gen/${out}.old.ts`, [...rewrites, ...oldOnly])
}

const LOGIN = [
  ['from "next/server"', 'from "./stub-server.ts"'],
  ['from "@/lib/admin-auth"', 'from "./stub-admin.ts"'],
]
// T-137: the 30%'s step (build.mjs's copy, its promo code at stub-admin.ts) and the words for a code that landed elsewhere.
const STEP = ['from "@/lib/thirty-apply"', 'from "./thirty-apply.ts"']
copyRoute('src/app/api/discounts/reject/route.ts', 'admin-reject-route', LOGIN, [
  STEP,
  ['from "@/lib/thirty-words"', 'from "./thirty-words.ts"'],
  ['from "@/lib/membership-discount"', 'from "./membership-discount.ts"'],
])
copyRoute('src/app/api/discounts/approve/route.ts', 'admin-approve-route', LOGIN, [STEP], [
  ['from "@/lib/whop"', 'from "./stub-admin.ts"'],
  ['from "@/lib/catalog-tables"', 'from "./stub-server.ts"'],
  ['from "@/lib/constants"', 'from "./constants.ts"'],
  ['from "@/lib/curriculum-reset"', 'from "./curriculum-reset.ts"'],
  ['from "@/lib/world/discount-server"', 'from "./discount-server.ts"'],
])

const reject = { now: (await import('./_gen/admin-reject-route.ts')).POST, old: (await import('./_gen/admin-reject-route.old.ts')).POST }
const approve = { now: (await import('./_gen/admin-approve-route.ts')).POST, old: (await import('./_gen/admin-approve-route.old.ts')).POST }
const routes = (v) => ({ '/api/discounts/reject': reject[v], '/api/discounts/approve': approve[v] })
// useDb is no React hook; the alias keeps eslint's hook rule from reading it as one.
const { FakeDb, useDb: installDb } = await import('./_gen/stub-server.ts')
const { setTeam, promoCodes, whileWhopAnswers, setWhopCreateError, setWhopCreateBody } = await import('./_gen/stub-admin.ts')
const { teamThirtyCodeFor } = await import('./_gen/membership-discount.ts')

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v)

/** Runs `fn` with the routes' log lines kept, and hands them back beside its answer. */
async function logged(fn) {
  const lines = []
  const real = [console.info, console.warn, console.error]
  console.info = console.warn = console.error = (...a) => lines.push(a.map(String).join(' '))
  try { return { value: await fn(), lines } } finally { [console.info, console.warn, console.error] = real }
}

// ── Whop, standing in (T-137) ───────────────────────────────────────────────
// The deployment's values, made up. A membership answers its pinned read and
// takes a code by its name (an id the test put on Whop, else the one
// stub-admin.ts's create gave it, promo_<n>); the memberships holding a code
// and the codes made after a moment are listed as Whop lists them. Anything
// else is a 404. `answer` overrides any call; `onApply` runs inside an attach.
process.env.WHOP_API_KEY = 'whop-test-key'
process.env.WHOP_COMPANY_ID = 'biz_devCompany'
process.env.WHOP_PRODUCT_ID = 'prod_devCourse'
const whop = { memberships: new Map(), codes: [], log: [], answer: null, onApply: null }
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const pinnedOf = (m) => ({
  id: m.id, status: m.status, user_id: m.user, product_id: m.product, plan_id: 'plan_devMonthly97', promo_code_id: m.promo,
  renewal_price: m.renewal === null ? null : { amount: m.renewal, currency: 'usd' }, cancel_at_period_end: false,
})
const listedOf = (m) => ({ ...pinnedOf(m), user: m.user === null ? null : { id: m.user }, product: m.product === null ? null : { id: m.product, title: m.title } })
/** A code's Whop id by its name: one the test put on Whop, else the one the create gave it. */
const codeId = (name) => {
  const n = String(name).toLowerCase()
  const listed = whop.codes.findLast((c) => c.code.toLowerCase() === n)
  if (listed) return listed.id
  const made = promoCodes.findLastIndex((p) => String(p.code).toLowerCase() === n)
  return made < 0 ? null : `promo_${made + 1}`
}
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url))
  if (u.hostname !== 'api.whop.com') throw new Error(`the suite let a request go to ${u.hostname}`)
  const req = { method: init.method ?? 'GET', path: u.pathname, params: u.searchParams, idempotencyKey: init.headers?.['Idempotency-Key'] ?? null }
  whop.log.push(req)
  const special = whop.answer ? await whop.answer(req) : null
  if (special === 'throw') throw new TypeError('fetch failed')
  if (special) return special
  const attach = u.pathname.match(/^\/api\/v1\/memberships\/([^/]+)\/apply_promo_code$/)
  if (req.method === 'POST' && attach) {
    const m = whop.memberships.get(decodeURIComponent(attach[1]))
    if (!m) return json(404, { error: { message: 'Membership not found.' } })
    if (whop.onApply) {
      const said = await whop.onApply(m)
      if (said) return said
    }
    if (m.promo) return json(400, { error: { message: 'This membership already has a promo code.' } })
    const id = codeId(JSON.parse(init.body).promo_code)
    if (!id) return json(400, { error: { message: 'Promo code not found.' } })
    m.promo = id
    return json(200, pinnedOf(m))
  }
  if (req.method === 'GET' && u.pathname === '/api/v1/memberships') {
    const rows = [...whop.memberships.values()].filter((m) => m.promo === u.searchParams.get('promo_code_ids'))
    return json(200, { data: rows.map(listedOf), page_info: { has_next_page: false, end_cursor: null } })
  }
  if (req.method === 'GET' && u.pathname === '/api/v1/promo_codes') {
    const after = Date.parse(u.searchParams.get('created_after'))
    const rows = whop.codes.filter((c) => Date.parse(c.created_at) > after)
    return json(200, { data: rows.map((c) => ({ id: c.id, code: c.code, created_at: c.created_at })), page_info: { has_next_page: false, end_cursor: null } })
  }
  const one = u.pathname.match(/^\/api\/v1\/memberships\/([^/]+)$/)
  if (req.method === 'GET' && one) {
    const m = whop.memberships.get(decodeURIComponent(one[1]))
    return m ? json(200, pinnedOf(m)) : json(404, { error: { message: 'Not found' } })
  }
  return json(404, { error: { message: 'Not found' } })
}
/** A membership on Whop: active, the course's, renewing at 97.00, no code, no user named, unless `more` says otherwise. */
const member = (id, more = {}) => whop.memberships.set(id, { id, user: null, status: 'active', product: 'prod_devCourse', title: 'The Sprint', promo: null, renewal: '97.00', ...more })
const attaches = () => whop.log.filter((r) => r.method === 'POST')

// ── The page's handlers, as the page has them ───────────────────────────────

const PAGE = 'src/app/admin/(authenticated)/discounts/page.tsx'
// The admin rebuild (night/admin, 2026-10-20) replaced this page with ThirtyView,
// whose Reject is an inline panel with no prompt. The page with lane G1's fixes
// is kept as client-tests/fixtures/discounts-page-g1.tsx (a byte copy of it on
// night/main-ready) and drives the routes here, so every route check below
// still runs; the Cancel check is about that page, which production runs until
// the rebuild ships. Retire the page checks once it has.
const FIXTURE = 'client-tests/fixtures/discounts-page-g1.tsx'
const hasHandlers = (src) => /function handleReject\(/.test(src)
const page = { now: hasHandlers(fromSrc(PAGE)) ? fromSrc(PAGE) : fromSrc(FIXTURE), old: fromBase(PAGE) }
if (!hasHandlers(fromSrc(PAGE))) console.log(`  note  the page is the admin rebuild's; its old handlers come from ${FIXTURE}`)

/**
 * A function declared inside a component, as plain JavaScript: found with
 * TypeScript's parser and its types stripped by TypeScript, nothing else
 * changed.
 */
function componentFunction(source, name) {
  const sf = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let found = null
  const visit = (node) => {
    if (found) return
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node
    else ts.forEachChild(node, visit)
  }
  visit(sf)
  if (!found) throw new Error(`no function ${name} in the page`)
  return ts.transpileModule(found.getText(sf), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
}

/**
 * The page in one browser tab: its handlers from `source`, closed over the
 * component's state setters (recorded), its Supabase client (a session),
 * prompt() answering `answer`, and fetch() handing each call to `routes`.
 */
function tab(source, routes, { answer = null, teamMember = { id: 'team-1' } } = {}) {
  const seen = { prompts: 0, posts: [], processing: [], cleared: [], reloads: 0, errors: {} }
  const scope = {
    prompt: () => { seen.prompts++; return answer },
    setProcessing: (v) => { seen.processing.push(v) },
    clearActionError: (id) => { seen.cleared.push(id) },
    setActionError: (f) => { seen.errors = typeof f === 'function' ? f(seen.errors) : f },
    fetchRequests: () => { seen.reloads++ },
    teamMember,
    supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'team-token' } } }) } },
    fetch: async (url, init) => {
      seen.posts.push({ url, body: JSON.parse(init.body) })
      if (!routes[url]) throw new Error(`no route for ${url}`)
      return routes[url](new Request(`http://app${url}`, init))
    },
  }
  const bind = (name) => {
    const names = Object.keys(scope)
    return new Function(...names, `${componentFunction(source, name)}\nreturn ${name};`)(...names.map((n) => scope[n]))
  }
  const handleReject = bind('handleReject')
  const handleApprove = bind('handleApprove')
  return {
    seen,
    reject: (id) => logged(() => handleReject(id)),
    approve: (id, override = false) => logged(() => handleApprove(id, override)),
  }
}

const SID = 'a1b2c3d4-0000-4000-8000-000000000001'
const MEM = 'mem_devA1B2'
/** A code made since T-137: ECOM30- and 6 of ABCDEFGHJKLMNPQRSTUVWXYZ23456789. */
const NAME = /^ECOM30-[A-HJ-NP-Z2-9]{6}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/**
 * One student and their requests. The catalog flag is stub-server.ts's
 * default, the old course, whose rule needs only these two lessons done in
 * the 14 days: the shortest way to a request the rule approves. What these
 * checks are about, the route's last write, is the same on both courses.
 * The ads are ticked for the routes at BASE, which still refuse without it.
 * The coupon check finds a stored "no coupon" this rule wrote (its source
 * set, naming no code): with no Whop user here it gives the approve route its
 * answer, as the cron's row does on production when Whop does not answer.
 * Since T-122's fourth fix round a check with no answer refuses the normal
 * Approve, so without the row every Approve below would be that 503. Since
 * its fifth the row carries the rule's stamp: `source` with the rule's
 * version, and `source_checked_at` its checked_at; the version r6 since the
 * owner's paid plan and payment (2026-10-26). Since 2026-10-26 it holds the
 * first real payment's price (97.00): a row with no code and no price is the
 * rule's unpaid answer, which refuses the normal Approve. Since T-137 the
 * student's course membership is on file (and the stored row names it, so it
 * answers for it) and on Whop, active, renewing at 97.00, holding no code: the
 * step attaches the code there. `whopMember` changes it on Whop (null: none).
 */
function freshDb(requests, { whopMember = {}, student = {} } = {}) {
  const db = new FakeDb({
    students: [{ id: SID, first_paid_at: '2026-10-02T10:00:00.000Z', ad_submissions_verified: true, whop_membership_id: MEM, ...student }],
    lessons: [{ id: 'l001', region_id: 'r1' }, { id: 'l002', region_id: 'r2' }],
    student_lesson_completions: ['l001', 'l002'].map((lesson_id) => ({
      student_id: SID, lesson_id, completed_at: '2026-10-03T10:00:00.000Z',
    })),
    discount_requests: requests.map((r) => ({
      student_id: SID, created_at: '2026-10-05T10:00:00.000Z', ...r,
    })),
    student_membership_discounts: [{
      student_id: SID, whop_membership_id: student.whop_membership_id === undefined ? MEM : student.whop_membership_id, promo_code_id: null, promo_code: null,
      renewal_price: 97, plan_renewal_price: 97, discounted: false, checked_at: '2026-10-05T09:40:00.000Z',
      source: 'r6-payment', source_checked_at: '2026-10-05T09:40:00.000Z',
    }],
  })
  installDb(db)
  setTeam({ id: 'team-1', role: 'founder' })
  whop.memberships = new Map()
  if (whopMember !== null) member(MEM, whopMember)
  whop.codes = []
  whop.log = []
  whop.answer = null
  whop.onApply = null
  return db
}
const row = (db, id) => db.rows('discount_requests').find((r) => r.id === id)

console.log('\n=== admin-1 / discount-1: Cancel on the Reject prompt changes nothing ===')
for (const [answer, says] of [[null, 'Cancel'], ['', 'OK on an empty box'], ['ads not verified', 'OK with a reason']]) {
  const db = freshDb([{ id: 'r1', status: 'pending' }])
  const t = tab(page.now, { '/api/discounts/reject': reject.now }, { answer })
  await t.reject('r1')
  const r = row(db, 'r1')
  if (answer === null) {
    ok(t.seen.prompts === 1 && t.seen.posts.length === 0 && t.seen.processing.length === 0 && t.seen.cleared.length === 0
         && r.status === 'pending' && r.rejection_reason === null && r.reviewed_at === null,
       'Reject, then Cancel: nothing is sent, the row stays pending, the button never shows as busy', show({ posts: t.seen.posts, row: r.status }))
  } else {
    ok(t.seen.posts.length === 1 && t.seen.posts[0].url === '/api/discounts/reject'
         && show(t.seen.posts[0].body) === show({ requestId: 'r1', reason: answer || null })
         && r.status === 'rejected' && r.rejection_reason === (answer || null) && t.seen.reloads === 1,
       `Reject, then ${says}: rejected, reason ${show(answer || null)}, the list reloads`, show({ body: t.seen.posts[0]?.body, row: r }))
  }
}
{
  // The page as it was: Cancel posted the reject with no reason.
  const db = freshDb([{ id: 'r1', status: 'pending' }])
  const t = tab(page.old, { '/api/discounts/reject': reject.old }, { answer: null })
  await t.reject('r1')
  ok(t.seen.posts.length === 1 && row(db, 'r1').status === 'rejected' && row(db, 'r1').rejection_reason === null,
     `control: the page at ${BASE} sends the reject on Cancel and the request is rejected with no reason`, show(t.seen.posts))
}
ok(/const reason = prompt\("Rejection reason \(optional\):"\);\s*(\/\/[^\n]*\n\s*)*if \(reason === null\) return;\s*setProcessing\(requestId\);/.test(page.now),
   'in the source, the null check sits between the prompt and the first state change')

console.log('\n=== admin-4 / discount-3: a decided request stays as it is ===')
const ALREADY = 'This request was already decided.'
/** POST /api/discounts/reject straight, as a stale tab's button sends it. */
const rejectStraight = async (v, requestId, reason = 'changed my mind') =>
  (await logged(async () => {
    const res = await reject[v](new Request('http://app/api/discounts/reject', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId, reason }),
    }))
    return { status: res.status, body: await res.json() }
  })).value
// An approved request is no longer always refused (T-137, R10): a founder or an admin rejects it once Whop shows its code
// on nobody's membership, and the reject table below has its rows.
for (const [status, extra] of [
  ['applied', { promo_code: 'ECOM30-A1B2C3', whop_promo_id: 'promo_7', applied_at: '2026-10-20T09:30:00.000Z' }],
  ['rejected', { rejection_reason: 'ads not verified', reviewed_at: '2026-10-20T09:00:00.000Z' }],
]) {
  const db = freshDb([{ id: 'r1', status, ...extra }])
  const before = show(row(db, 'r1'))
  const r = await rejectStraight('now', 'r1')
  ok(r.status === 409 && r.body.error === ALREADY && show(row(db, 'r1')) === before && whop.log.length === 0,
     `Reject on a request already ${status}: 409 "${ALREADY}", the row untouched, Whop not asked`, show(r))
}
{
  const db = freshDb([{ id: 'r1', status: 'approved', promo_code: 'ECOM30-A1B2C3', whop_promo_id: 'promo_7' }])
  const r = await rejectStraight('old', 'r1')
  ok(r.status === 200 && row(db, 'r1').status === 'rejected' && row(db, 'r1').promo_code === 'ECOM30-A1B2C3',
     `control: the route at ${BASE} turns an approved request with a live code into a rejected one, Whop never asked`, show(row(db, 'r1')))
}

for (const v of ['now', 'old']) {
  // Two tabs on the Pending tab. A approves; B, never reloaded, presses Reject.
  const db = freshDb([{ id: 'r1', status: 'pending' }])
  const codes = promoCodes.length
  const a = tab(page[v], routes(v), { teamMember: { id: 'team-1' } })
  const b = tab(page[v], routes(v), { answer: 'not this one', teamMember: { id: 'team-2' } })
  await a.approve('r1')
  const approved = show(row(db, 'r1'))
  await b.reject('r1')
  const r = row(db, 'r1')
  if (v === 'now') {
    ok(a.seen.reloads === 1 && r.status === 'applied' && NAME.test(r.promo_code) && promoCodes.length === codes + 1 && show(r) === approved,
       'two tabs: A approves (one code, on the student\'s membership since T-137), then B\'s stale Reject leaves the applied row exactly as it was', show(r))
    ok(b.seen.errors.r1 === ALREADY && b.seen.reloads === 0,
       'and B\'s page shows the refusal inline, in plain words', show(b.seen.errors))
  } else {
    ok(r.status === 'rejected' && r.promo_code === 'ECOM30-A1B2C3' && promoCodes.length === codes + 1 && b.seen.reloads === 1,
       `control: at ${BASE} B's Reject wins, and the code made on Whop for A stays live on a rejected request`, show(r))
  }
}

for (const v of ['now', 'old']) {
  // A presses Approve. While Whop makes the code, B (another tab, or a second
  // team member) rejects the same request, still pending at that moment.
  const db = freshDb([{ id: 'r1', status: 'pending' }])
  const codes = promoCodes.length
  const a = tab(page[v], routes(v), { teamMember: { id: 'team-1' } })
  const b = tab(page[v], routes(v), { answer: 'not this one', teamMember: { id: 'team-2' } })
  let bDuring = null
  whileWhopAnswers(async () => { bDuring = await b.reject('r1') })
  const { lines } = await a.approve('r1')
  whileWhopAnswers(null)
  const r = row(db, 'r1')
  const made = promoCodes.slice(codes).map((p) => p.code)
  if (v === 'now') {
    // Since T-137 the request is claimed before its code is made: B's Reject meets the claim, and A's approval stands.
    ok(bDuring !== null && b.seen.errors.r1 === 'The app is making this code right now. Try again in a few minutes.' && b.seen.reloads === 0,
       'B\'s Reject while Whop makes the code meets the claim: 409, "The app is making this code right now. Try again in a few minutes.", inline', show(b.seen.errors))
    ok(made.length === 1 && NAME.test(made[0]) && r.status === 'applied' && r.promo_code === made[0] && r.rejection_reason === null && a.seen.reloads === 1
         && !lines.some((l) => l.includes('Delete')),
       'A\'s approval goes through: one code, the request applied with it, no rejection reason, no code left to delete', show({ made, r }))
  } else {
    ok(r.status === 'approved' && r.promo_code === 'ECOM30-A1B2C3' && r.rejection_reason === 'not this one',
       `control: at ${BASE} Approve's last write turns B's rejection back into an approval, keeping B's reason`, show(r))
  }
}

console.log('\n=== Admin PRD review: who decided is the logged-in team member ===')
for (const v of ['now', 'old']) {
  // A CSM is logged in; the page in their browser sends another id,
  // as a stale or edited page could. Her login decides what is recorded.
  // Three students, one pending request each (v106 allows no more): r3's
  // student has done no lesson, so only Generate anyway approves it.
  const db = freshDb([{ id: 'r1', status: 'pending' }, { id: 'r2', status: 'pending' }, { id: 'r3', status: 'pending' }])
  for (const [i, sid, verified] of [[1, 'c0000000-0000-4000-8000-000000000003', true], [2, 'b0000000-0000-4000-8000-000000000002', false]]) {
    db.rows('discount_requests')[i].student_id = sid
    db.rows('students').push({ id: sid, first_paid_at: '2026-10-02T10:00:00.000Z', ad_submissions_verified: verified })
  }
  setTeam({ id: 'team-csm-1', role: 'csm' })
  const t = tab(page[v], routes(v), { answer: 'not this one', teamMember: { id: 'team-founder-1' } })
  await t.approve('r1')
  await t.reject('r2')
  // The owner's review (2026-10-21): Generate anyway (the 30% page's Approve anyway) is a founder's or an admin's.
  // A csm's is refused before anything is read or made; then an admin sends it.
  let csmOverride = null
  if (v === 'now') {
    const made = promoCodes.length
    const tried = await t.approve('r3', true)
    csmOverride = { made: promoCodes.length - made, status: row(db, 'r3').status, logged: tried.lines.some((l) => l.includes('OVERRIDE')) }
    setTeam({ id: 'team-admin-1', role: 'admin' })
  }
  const { lines } = await t.approve('r3', true)
  const [r1, r2, r3] = ['r1', 'r2', 'r3'].map((id) => row(db, id))
  const override = lines.find((l) => l.includes('OVERRIDE')) ?? ''
  if (v === 'now') {
    // Since T-137 Approve puts the code on the membership itself (Mark code applied is gone): one press records both.
    ok(r1.status === 'applied' && r1.reviewed_by === 'team-csm-1' && r1.applied_by === 'team-csm-1',
       'Approve, which now attaches the code: reviewed_by and applied_by are the login, whatever the page sends', show({ reviewed_by: r1.reviewed_by, applied_by: r1.applied_by }))
    ok(r2.status === 'rejected' && r2.reviewed_by === 'team-csm-1', 'Reject records the login as the reviewer (it recorded nobody)', show(r2.reviewed_by))
    ok(csmOverride.made === 0 && csmOverride.status === 'pending' && !csmOverride.logged,
       'a csm\'s Generate anyway is refused: no Whop code, the request still pending, no OVERRIDE line (the owner\'s review)', show(csmOverride))
    ok(r3.status === 'approved' && r3.reviewed_by === 'team-admin-1' && override.includes('team-admin-1') && !override.includes('team-founder-1'),
       'Generate anyway by an admin: the row and the log line name the login (left approved: no membership on file to put the code on)', override)
  } else {
    ok(r1.reviewed_by === 'team-founder-1' && r2.reviewed_by === null && override.includes('team-founder-1'),
       `control: at ${BASE} the routes record whatever the page sends, and Reject records nobody`, show({ r1: r1.reviewed_by, r2: r2.reviewed_by, override }))
  }
}

console.log('\n=== Lovro, 2026-10-20: no ads check on Approve, the 30% rule alone decides ===')
for (const v of ['now', 'old']) {
  // Both lessons done in time (the rule says yes), the ads never ticked.
  const db = freshDb([{ id: 'r1', status: 'pending' }])
  db.rows('students')[0].ad_submissions_verified = false
  const codes = promoCodes.length
  const t = tab(page[v], routes(v))
  await t.approve('r1')
  const r = row(db, 'r1')
  const said = t.seen.errors.r1 ?? ''
  if (v === 'now') {
    ok(r.status === 'applied' && NAME.test(r.promo_code) && promoCodes.length === codes + 1 && said === '' && t.seen.reloads === 1,
       'Approve, the rule saying yes and the ads never ticked: one code, on their membership, no refusal, the list reloads', show({ status: r.status, code: r.promo_code, said }))
  } else {
    ok(r.status === 'pending' && promoCodes.length === codes && said.startsWith('Ad submissions not verified yet') && said.includes('—'),
       `control: at ${BASE} the route refused it over the ads, in a sentence with an em dash: still pending, no code`, said)
  }
}
for (const verified of [false, true]) {
  // The rule says no (l002 never done): refused, ticked or not.
  const db = freshDb([{ id: 'r1', status: 'pending' }])
  db.rows('students')[0].ad_submissions_verified = verified
  db.tables.student_lesson_completions = db.rows('student_lesson_completions').filter((c) => c.lesson_id !== 'l002')
  const codes = promoCodes.length
  const t = tab(page.now, routes('now'))
  await t.approve('r1')
  const said = t.seen.errors.r1 ?? ''
  ok(row(db, 'r1').status === 'pending' && promoCodes.length === codes && said === 'Student has not completed all required R1 + R2 lessons',
     `Approve, the rule saying no, the ads ${verified ? 'ticked' : 'never ticked'}: refused over the lessons, still pending, no code`, said)
}

// ════════════════════════════════════════════════════════════════════════════
// The 30% that applies itself (T-137): PRD §9.4's approve table, Approve anyway's event, Try again. The stand-in database
// runs with STUB_STRICT_NULL=1 from here on: an .eq() handed null throws, as PostgREST's eq.null matches nothing, so
// every conditional write on a value read as NULL is proven to say .is().
process.env.STUB_STRICT_NULL = '1'
/** Approve (with `body`: Approve anyway's flags) straight, logged in as `role`: the answer, the log lines, the row. */
async function press(db, requestId, role = 'founder', body = {}) {
  setTeam({ id: `team-${role}`, role })
  const { value, lines } = await logged(async () => {
    const res = await approve.now(new Request('http://app/api/discounts/approve', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId, ...body }),
    }))
    return { status: res.status, body: await res.json() }
  })
  return { ...value, lines, row: row(db, requestId) }
}
const events = (db) => db.rows('discount_request_events')
const failed = (db) => events(db).filter((e) => e.event === 'attempt_failed').map((e) => ({ reason: e.reason, step: e.detail?.step ?? null, actor: e.actor, member: e.team_member_id }))
const writes = (db) => db.calls('discount_requests', 'update')
/** Every write the press made carries the team, the member and one correlation id (a uuid), as v116's trigger needs them. */
const audited = (db, member) => {
  const w = writes(db)
  return w.length > 0 && w.every((x) => x.values.audit_actor === 'team' && x.values.audit_team_member_id === member && UUID.test(x.values.audit_correlation_id))
    && new Set(w.map((x) => x.values.audit_correlation_id)).size === 1
}
const BODY_KEYS = show(['membershipStatus', 'message', 'promoCode', 'reason', 'status', 'step', 'success', 'whopPromoId'])
const ago = (ms) => new Date(Date.now() - ms).toISOString()
const MIN = 60_000

console.log('\n=== T-137: the approve table (PRD §9.4), each row through the real route ===')
{
  // applied
  const db = freshDb([{ id: 'r1', status: 'pending' }])
  const r = await press(db, 'r1', 'csm')
  ok(r.status === 200 && show(Object.keys(r.body).sort()) === BODY_KEYS && r.body.success === true && r.body.status === 'applied'
       && NAME.test(r.body.promoCode) && r.body.promoCode === r.row.promo_code && r.body.whopPromoId === r.row.whop_promo_id && r.body.reason === null && r.body.step === null,
     'applied: 200 { success: true, status: "applied", promoCode, whopPromoId, reason, step, membershipStatus, message }, the code its random name', show(r.body))
  ok(r.row.status === 'applied' && r.row.reviewed_by === 'team-csm' && r.row.applied_by === 'team-csm' && attaches().length === 1
       && attaches()[0].path === `/api/v1/memberships/${MEM}/apply_promo_code` && UUID.test(attaches()[0].idempotencyKey ?? '')
       && whop.memberships.get(MEM).promo === r.row.whop_promo_id && audited(db, 'team-csm') && writes(db).length === 3 && events(db).length === 0,
     'claimed, made, approved and attached to the membership on file, a fresh key on the attach; three writes, each with the team, the member and one correlation; no failure recorded', show({ row: r.row, writes: writes(db).map((w) => w.values.status ?? 'claim') }))
}
{
  // waiting, approved: a membership that can't take the code yet, its status named
  const db = freshDb([{ id: 'r1', status: 'pending' }], { whopMember: { status: 'past_due' } })
  const r = await press(db, 'r1', 'admin')
  ok(r.status === 200 && r.body.success === true && r.body.status === 'approved' && r.body.reason === 'membership_not_active' && r.body.step === 'membership'
       && r.body.membershipStatus === 'past_due' && NAME.test(r.body.promoCode) && r.row.status === 'approved' && attaches().length === 0
       && show(failed(db)) === show([{ reason: 'membership_not_active', step: 'membership', actor: 'team', member: 'team-admin' }]),
     'waiting, approved (past_due on Whop): 200, success true, status approved, its reason, step and membership status; the code made, not attached; one attempt_failed by the member', show(r.body))
  // A trial is left to the team: its Approve goes on and attaches it (R3).
  const trial = freshDb([{ id: 'r1', status: 'pending' }], { whopMember: { status: 'trialing' } })
  const t = await press(trial, 'r1', 'csm')
  ok(t.status === 200 && t.body.status === 'applied' && t.row.status === 'applied' && attaches().length === 1,
     'a trial on Whop: the team\'s Approve goes on and puts the code on (the app alone leaves trials to the team)', show(t.body))
}
for (const [step, arm, disarm] of [
  ['create', () => setWhopCreateError(null), () => setWhopCreateError(undefined)],
  ['create_no_id', () => setWhopCreateBody({ code: 'whatever' }), () => setWhopCreateBody(null)],
]) {
  // waiting, pending: Whop gave no answer while making the code, so the claim stays for the code to be looked for
  const db = freshDb([{ id: 'r1', status: 'pending' }])
  arm()
  const r = await press(db, 'r1')
  disarm()
  ok(r.status === 200 && r.body.success === false && r.body.status === 'pending' && r.body.reason === 'whop_no_answer' && r.body.step === step
       && NAME.test(r.body.promoCode) && r.body.promoCode === r.row.promo_code && r.row.whop_promo_id === null && typeof r.row.promo_claimed_at === 'string',
     `waiting, pending, step ${step}: 200, success false, status pending, promoCode the claimed name (kept on the row for the app to look for)`, show(r.body))
}
{
  // waiting, pending, any other reason: a lost claim whose code Whop's list cannot be asked about
  const db = freshDb([{ id: 'r1', status: 'pending', promo_code: 'ECOM30-LOSTAA', promo_claimed_at: ago(10 * MIN) }])
  whop.answer = (req) => (req.path === '/api/v1/promo_codes' ? json(502, { error: { message: 'Bad gateway' } }) : null)
  const r = await press(db, 'r1')
  ok(r.status === 200 && r.body.success === false && r.body.status === 'pending' && r.body.reason === 'whop_no_answer' && r.body.step === 'list'
       && r.row.promo_code === 'ECOM30-LOSTAA' && r.row.status === 'pending',
     'waiting, pending, another reason (a lost claim, Whop\'s code list not answering): 200, success false, status pending, the claim kept', show(r.body))
}
{
  // the create refused (4xx): nothing made, the claim given back
  const db = freshDb([{ id: 'r1', status: 'pending' }])
  setWhopCreateError(422)
  const r = await press(db, 'r1')
  setWhopCreateError(undefined)
  ok(r.status === 502 && show(r.body) === show({ error: 'Couldn\'t create the promo code on Whop. The request is still pending. Details: Whop promo code creation failed: HTTP 422' })
       && r.row.status === 'pending' && r.row.promo_code === null && r.row.promo_claimed_at === null
       && show(failed(db)) === show([{ reason: 'code_not_made', step: 'create', actor: 'team', member: 'team-founder' }]),
     'the create refused (422): 502 in today\'s words, the request still pending with its claim given back, one code_not_made', show(r.body))
}
{
  // claimed_elsewhere: the app is making the code right now
  const db = freshDb([{ id: 'r1', status: 'pending', promo_code: 'ECOM30-BUSYAA', promo_claimed_at: ago(MIN) }])
  const codes = promoCodes.length
  const r = await press(db, 'r1')
  ok(r.status === 409 && show(r.body) === show({ error: 'The app is making this code right now. Refresh in a few minutes.' })
       && promoCodes.length === codes && r.row.promo_code === 'ECOM30-BUSYAA' && writes(db).length === 0,
     'claimed_elsewhere (a claim a minute old): 409 "The app is making this code right now. Refresh in a few minutes.", nothing made or written', show(r.body))
}
{
  // decided_meanwhile: the request changed while Whop made the code (by hand, in the database)
  const db = freshDb([{ id: 'r1', status: 'pending' }])
  whileWhopAnswers(() => { row(db, 'r1').status = 'rejected' })
  const r = await press(db, 'r1')
  whileWhopAnswers(null)
  const made = promoCodes.at(-1).code
  ok(r.status === 409 && show(r.body) === show({ error: `The Whop code ${made} was created, but this request had already been decided, so the code must be deleted in Whop.` })
       && r.row.status === 'rejected' && r.row.whop_promo_id === null && show(failed(db)) === show([{ reason: 'write_failed', step: 'decided_meanwhile', actor: 'team', member: 'team-founder' }]),
     'decided_meanwhile: 409 naming the code made, which must be deleted in Whop; the decision stands; one write_failed', show(r.body))
}
for (const confirmed of [true, false]) {
  // ended_rejected: the request rejected while Whop attached its code
  const db = freshDb([{ id: 'r1', status: 'pending' }])
  whop.onApply = () => {
    row(db, 'r1').status = 'rejected'
    return confirmed ? null : json(503, { error: { message: 'Service unavailable' } })
  }
  const r = await press(db, 'r1')
  const code = r.row.promo_code
  const words = confirmed
    ? `Whop attached ${code} after the request was rejected. It can only come off in Whop.`
    : `Whop may have attached ${code} after the request was rejected. Check their membership in Whop.`
  const last = events(db).at(-1)
  ok(r.status === 409 && show(r.body) === show({ error: words }) && r.row.status === 'rejected'
       && last?.reason === 'write_failed' && last.detail.step === 'attach_after_reject' && last.detail.confirmed === confirmed,
     `ended_rejected, Whop ${confirmed ? 'naming our code on the membership' : 'giving no answer'}: 409 "${words}", one write_failed (attach_after_reject, confirmed ${confirmed})`, show(r.body))
}
{
  // write_error: Whop made the code, saving approved failed
  const db = freshDb([{ id: 'r1', status: 'pending' }])
  db.failWhen = (q) => (q.table === 'discount_requests' && q.op === 'update' && q.values?.status === 'approved' ? { message: 'connection reset' } : null)
  const r = await press(db, 'r1')
  const made = promoCodes.at(-1).code
  ok(r.status === 500 && show(r.body) === show({ error: `Whop made ${made}, but saving it failed. The app picks it up on its next try; leave it in Whop.` })
       && r.row.status === 'pending' && r.row.promo_code === made && r.row.whop_promo_id === null
       && show(failed(db)) === show([{ reason: 'write_failed', step: 'approved_write_error', actor: 'team', member: 'team-founder' }]),
     'write_error: 500, the code named and left in Whop, the claim kept for the app; one write_failed', show(r.body))
}
{
  // not_ready: v116 not pasted (the step's own read names audit_actor)
  const db = freshDb([{ id: 'r1', status: 'pending' }])
  db.failWhen = (q) => (q.table === 'discount_requests' && q.op === 'select' && (q.columns ?? '').includes('audit_actor')
    ? { code: '42703', message: 'column discount_requests.audit_actor does not exist' } : null)
  const codes = promoCodes.length
  const r = await press(db, 'r1')
  ok(r.status === 503 && show(r.body) === show({ error: 'The 30% update isn\'t finished on the database (v116). Nothing was made.' })
       && promoCodes.length === codes && writes(db).length === 0 && attaches().length === 0 && r.row.status === 'pending',
     'not_ready: 503 "The 30% update isn\'t finished on the database (v116). Nothing was made.", no code, no write, no attach', show(r.body))
}
{
  // unchanged: decided already, or decided while the checks ran
  const db = freshDb([{ id: 'r1', status: 'rejected', reviewed_at: '2026-10-20T09:00:00.000Z' }])
  const r = await press(db, 'r1')
  const db2 = freshDb([{ id: 'r1', status: 'pending' }])
  db2.failWhen = (q) => {
    if (q.table === 'student_membership_discounts' && q.op === 'select') row(db2, 'r1').status = 'rejected'
    return null
  }
  const codes = promoCodes.length
  const r2 = await press(db2, 'r1')
  ok(r.status === 400 && show(r.body) === show({ error: 'Request already processed' }) && r2.status === 400 && show(r2.body) === show({ error: 'Request already processed' })
       && promoCodes.length === codes && writes(db2).length === 0,
     'unchanged: a request decided already, or rejected while the checks ran: 400 "Request already processed", nothing made', show({ r: r.body, r2: r2.body }))
}
{
  // A database failure the step has no answer for (the claim refused by the database): the route answers, never throws.
  const db = freshDb([{ id: 'r1', status: 'pending' }])
  db.failWhen = (q) => (q.table === 'discount_requests' && q.op === 'update' && 'promo_claimed_at' in (q.values ?? {}) ? { message: 'connection reset' } : null)
  const codes = promoCodes.length
  const r = await press(db, 'r1')
  ok(r.status === 500 && show(r.body) === show({ error: 'Something failed while putting the 30% on. Refresh the list to see where the request stands.' })
       && promoCodes.length === codes && r.row.status === 'pending' && r.lines.some((l) => l.startsWith('[discount approve] request r1: putting the 30% on failed') && l.includes('connection reset')),
     'a database failure the step gives no answer for (the claim refused): 500 asking for a refresh, no code made, the real error in the log', show({ body: r.body, lines: r.lines }))
}

console.log('\n=== T-137: Approve anyway is recorded as an override event ===')
for (const [label, body, detail] of [
  ['Approve anyway past the rule (override)', { override: true }, { rule: true, coupon: false }],
  ['Approve anyway past the rule and the coupon (override, overrideCoupon)', { override: true, overrideCoupon: true }, { rule: true, coupon: true }],
]) {
  // The rule says no (l002 never done): only Approve anyway passes it.
  const db = freshDb([{ id: 'r1', status: 'pending' }])
  db.tables.student_lesson_completions = db.rows('student_lesson_completions').filter((c) => c.lesson_id !== 'l002')
  const r = await press(db, 'r1', 'admin', body)
  const overrides = events(db).filter((e) => e.event === 'override')
  const step = new Set(writes(db).map((w) => w.values.audit_correlation_id))
  ok(r.status === 200 && r.row.status === 'applied' && overrides.length === 1 && overrides[0].actor === 'team' && overrides[0].team_member_id === 'team-admin'
       && overrides[0].request_id === 'r1' && overrides[0].student_id === SID && show(overrides[0].detail) === show(detail)
       && step.size === 1 && step.has(overrides[0].correlation_id),
     `${label}: one override event (actor team, the member, detail ${show(detail)}), on the same correlation as the step's writes; then claimed, made and attached`, show(overrides))
}
{
  const db = freshDb([{ id: 'r1', status: 'pending' }])
  const r = await press(db, 'r1', 'admin')
  const csm = freshDb([{ id: 'r1', status: 'pending' }])
  const codes = promoCodes.length
  const refused = await press(csm, 'r1', 'csm', { override: true })
  ok(r.status === 200 && events(db).filter((e) => e.event === 'override').length === 0
       && refused.status === 403 && show(refused.body) === show({ error: 'Only a founder or an admin can approve past a check.' }) && events(csm).length === 0 && promoCodes.length === codes,
     'the normal Approve records no override; a csm\'s Approve anyway: 403, no event, no code', show({ r: r.body, refused: refused.body }))
}
{
  // Approve anyway with no membership to put the code on: left approved, with the reason.
  const db = freshDb([{ id: 'r1', status: 'pending' }], { whopMember: null, student: { whop_membership_id: null } })
  db.tables.student_lesson_completions = []
  const r = await press(db, 'r1', 'founder', { override: true })
  ok(r.status === 200 && r.body.success === true && r.body.status === 'approved' && r.body.reason === 'no_membership' && r.row.status === 'approved' && attaches().length === 0,
     'Approve anyway, no membership on file or stored: the code made, left approved with no_membership', show(r.body))
}

console.log('\n=== T-137: Try again (an approved request): no checks, then where the code is and the attach ===')
{
  /** An approved request holding our code, made on Whop and on nobody's membership unless the test puts it on. */
  const approvedRow = (name = 'ECOM30-TRYAGN', id = 'promo_devTry') => ({ id: 'r1', status: 'approved', promo_code: name, whop_promo_id: id, reviewed_at: ago(60 * MIN), reviewed_by: 'team-founder' })
  const noChecks = (db) => db.calls('lessons').length === 0 && db.calls('student_lesson_completions').length === 0
  {
    const db = freshDb([approvedRow()])
    whop.codes.push({ id: 'promo_devTry', code: 'ECOM30-TRYAGN', created_at: ago(60 * MIN) })
    const r = await press(db, 'r1', 'csm')
    ok(r.status === 200 && r.body.success === true && r.body.status === 'applied' && r.row.status === 'applied' && r.row.applied_by === 'team-csm'
         && attaches().length === 1 && noChecks(db) && whop.memberships.get(MEM).promo === 'promo_devTry' && audited(db, 'team-csm'),
       'Try again by a csm (every team role): no checks run (no lesson read), Whop shows the code on nobody\'s, so it is attached: applied', show(r.body))
  }
  {
    const db = freshDb([approvedRow()], { whopMember: { promo: 'promo_devTry' } })
    const r = await press(db, 'r1')
    ok(r.status === 200 && r.body.status === 'applied' && attaches().length === 0 && noChecks(db),
       'Try again, the code already on their membership (attached in Whop by hand): marked applied, nothing attached', show(r.body))
  }
  {
    const old = teamThirtyCodeFor(SID)
    const db = freshDb([approvedRow(old, 'promo_devOld')])
    whop.codes.push({ id: 'promo_devOld', code: old, created_at: ago(60 * MIN) })
    const r = await press(db, 'r1')
    ok(r.status === 200 && r.body.status === 'applied' && attaches().length === 1 && old === 'ECOM30-A1B2C3',
       `Try again on a code with the old per-student name (${old}): attached, applied (the app alone leaves those to the team)`, show(r.body))
  }
  {
    const db = freshDb([approvedRow()], { whopMember: { promo: 'promo_devSomeoneElses' } })
    const r = await press(db, 'r1')
    ok(r.status === 200 && r.body.success === true && r.body.status === 'approved' && r.body.reason === 'membership_has_code' && attaches().length === 0,
       'Try again, another code on their membership: 200, still approved, with the reason', show(r.body))
  }
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n=== T-137: the reject table (PRD §9.4), each row through the real route ===')
/** Reject straight as `role`: the answer and the row. */
async function rejectAs(db, requestId, role = 'founder', reason = 'not this one') {
  setTeam({ id: `team-${role}`, role })
  const r = await rejectStraight('now', requestId, reason)
  return { ...r, row: row(db, requestId) }
}
const CHANGED = 'This request changed meanwhile. Refresh the list.'
const NOT_ASKED = 'Couldn\'t ask Whop. Try again.'
/** The row rejected by this press: by the login, with the reason, and the write audited. */
const rejectedBy = (r, db, member) => r.row.status === 'rejected' && r.row.reviewed_by === member && r.row.rejection_reason === 'not this one' && audited(db, member)
{
  for (const role of ['csm', 'founder']) {
    const db = freshDb([{ id: 'r1', status: 'pending' }])
    const r = await rejectAs(db, 'r1', role)
    ok(r.status === 200 && show(r.body) === show({ success: true, code: null, codeState: null }) && rejectedBy(r, db, `team-${role}`)
         && writes(db)[0].filters.includes('promo_code is null') && whop.log.length === 0,
       `pending, unclaimed, a ${role}: 200 { success, code: null, codeState: null }, rejected where the row still has no code, Whop not asked`, show(r.body))
  }
}
{
  const claim = { id: 'r1', status: 'pending', promo_code: 'ECOM30-BUSYAA', promo_claimed_at: ago(MIN) }
  const db = freshDb([claim])
  const r = await rejectAs(db, 'r1')
  const csm = freshDb([claim])
  const c = await rejectAs(csm, 'r1', 'csm')
  ok(r.status === 409 && r.body.error === 'The app is making this code right now. Try again in a few minutes.' && r.row.status === 'pending' && writes(db).length === 0
       && c.status === 403 && c.row.status === 'pending' && whop.log.length === 0,
     'pending, claimed a minute ago (in progress): a founder 409 "The app is making this code right now. Try again in a few minutes.", a csm 403; nothing written, Whop not asked', show({ founder: r.body, csm: c.body }))
}
{
  // A claim 10 minutes old that lost its answer: its code is looked for by its name first.
  const LOST = 'ECOM30-LOSTBB'
  const settling = (more = {}) => ({ id: 'r1', status: 'pending', promo_code: LOST, promo_claimed_at: ago(10 * MIN), ...more })
  const onWhop = () => whop.codes.push({ id: 'promo_devLost', code: LOST, created_at: ago(10 * MIN - 1000) })
  {
    const db = freshDb([settling()])
    onWhop()
    const r = await rejectAs(db, 'r1')
    ok(r.status === 200 && show(r.body) === show({ success: true, code: LOST, codeState: 'usable' }) && rejectedBy(r, db, 'team-founder')
         && r.row.whop_promo_id === 'promo_devLost' && r.row.promo_code === LOST && writes(db).length === 1,
       'settling, its code found and on nobody\'s membership: 200, codeState usable, rejected with the code\'s Whop id stored, in one write', show(r.body))
  }
  {
    const db = freshDb([settling()], { whopMember: { promo: 'promo_devLost' } })
    onWhop()
    const r = await rejectAs(db, 'r1')
    ok(r.status === 409 && r.body.error === 'The code is already on their membership, so the 30% is theirs. The app marks it applied within the hour.'
         && r.row.status === 'pending' && r.row.whop_promo_id === null && writes(db).length === 0,
       'settling, its code found on their membership: 409, the 30% is theirs, the app marks it applied; the claim left for the job', show(r.body))
  }
  {
    const db = freshDb([settling()])
    onWhop()
    member('mem_devSomeone', { user: 'user_devSomeone', promo: 'promo_devLost' })
    const r = await rejectAs(db, 'r1')
    ok(r.status === 409 && r.body.error === `Whop shows ${LOST} on someone else's membership. Fix it in Whop, then tell the owner so the app records it.` && writes(db).length === 0,
       'settling, its code found on someone else\'s membership: 409 in the landed_elsewhere words of its step', show(r.body))
  }
  {
    const db = freshDb([settling()])
    onWhop()
    whop.answer = (req) => (req.path === '/api/v1/memberships' ? json(502, {}) : null)
    const r = await rejectAs(db, 'r1')
    ok(r.status === 503 && r.body.error === NOT_ASKED && writes(db).length === 0, `settling, its code found, Whop not answering where it is: 503 "${NOT_ASKED}"`, show(r.body))
  }
  for (const claimedAt of [ago(10 * MIN), null]) {
    const db = freshDb([settling({ promo_claimed_at: claimedAt })])
    const r = await rejectAs(db, 'r1')
    const w = writes(db)[0]
    ok(r.status === 200 && show(r.body) === show({ success: true, code: null, codeState: null }) && rejectedBy(r, db, 'team-founder')
         && r.row.promo_code === null && r.row.promo_claimed_at === null && w.filters.includes('whop_promo_id is null')
         && (claimedAt === null ? w.filters.includes('promo_claimed_at is null') : w.filters.includes(`promo_claimed_at=${claimedAt}`)),
       `settling${claimedAt === null ? ' with no claim time' : ''}, its code never made: 200, codeState null, rejected and the claim given back in one write, matched as read${claimedAt === null ? ' (.is() for the empty claim time)' : ''}`, show({ body: r.body, filters: w.filters }))
  }
  {
    const db = freshDb([settling()])
    whop.answer = (req) => (req.path === '/api/v1/promo_codes' ? 'throw' : null)
    const r = await rejectAs(db, 'r1')
    ok(r.status === 503 && r.body.error === 'Couldn\'t ask Whop about this code. Try again.' && r.row.status === 'pending' && writes(db).length === 0,
       'settling, Whop\'s code list not answering: 503 "Couldn\'t ask Whop about this code. Try again.", nothing written', show(r.body))
  }
  {
    const db = freshDb([settling()])
    const c = await rejectAs(db, 'r1', 'csm')
    ok(c.status === 403 && whop.log.length === 0 && writes(db).length === 0, 'settling, a csm: 403 before Whop is asked', show(c.body))
  }
}
{
  // Approved with our id, or reopened by hand (pending holding a Whop id): where the code is first.
  const CODE = 'ECOM30-OURSAA'
  const approvedRow = (more = {}) => ({ id: 'r1', status: 'approved', promo_code: CODE, whop_promo_id: 'promo_devOurs', reviewed_at: ago(60 * MIN), ...more })
  const reopened = () => approvedRow({ status: 'pending' })
  for (const [shape, make] of [['approved', approvedRow], ['reopened by hand', reopened]]) {
    const db = freshDb([make()])
    const r = await rejectAs(db, 'r1')
    ok(r.status === 200 && show(r.body) === show({ success: true, code: CODE, codeState: 'usable' }) && rejectedBy(r, db, 'team-founder')
         && writes(db)[0].filters.includes('whop_promo_id=promo_devOurs') && writes(db)[0].filters.includes(`status=${make().status}`),
       `${shape}, its code on nobody's membership: 200, codeState usable, rejected where the row still holds that code`, show(r.body))
  }
  {
    const db = freshDb([approvedRow()], { whopMember: { promo: 'promo_devOurs' } })
    const r = await rejectAs(db, 'r1')
    const re = freshDb([reopened()], { whopMember: { promo: 'promo_devOurs' } })
    const p = await rejectAs(re, 'r1')
    ok(r.status === 409 && r.body.error === 'The code is already on their membership, so the 30% is theirs. Press Try again to mark it applied.'
         && p.status === 409 && p.body.error === 'The code is already on their membership, so the 30% is theirs. The app marks it applied within the hour; while the app is paused, press Approve anyway.'
         && r.row.status === 'approved' && p.row.status === 'pending' && writes(db).length === 0 && writes(re).length === 0,
       'its code on their membership: 409, the 30% is theirs; approved "Press Try again to mark it applied.", reopened "The app marks it applied within the hour; while the app is paused, press Approve anyway."', show({ approved: r.body, reopened: p.body }))
  }
  {
    const db = freshDb([approvedRow()])
    member('mem_devOtherProduct', { promo: 'promo_devOurs', product: 'prod_devOther', title: 'Brand Lab' })
    db.rows('students')[0].whop_membership_id = MEM
    // The other membership is the student's own (the stored row names it): theirs, of another product.
    db.rows('student_membership_discounts')[0].whop_membership_id = 'mem_devOtherProduct'
    const r = await rejectAs(db, 'r1')
    ok(r.status === 409 && r.body.error === `Whop shows ${CODE} on their Brand Lab membership, not the course. Fix it in Whop, then tell the owner so the app records it.`,
       'its code on their membership of another product: 409 in the landed_elsewhere words, the product named', show(r.body))
  }
  {
    const db = freshDb([approvedRow()])
    whop.answer = (req) => (req.path === '/api/v1/memberships' ? json(200, { data: [listedOf({ id: 'mem_devX', user: null, status: 'active', product: 'prod_devCourse', title: 'The Sprint', promo: 'promo_devAnother', renewal: '97.00' })], page_info: { has_next_page: false } }) : null)
    const filter = await rejectAs(db, 'r1')
    const none = freshDb([approvedRow()], { whopMember: null, student: { whop_membership_id: null } })
    member('mem_devSomebody', { promo: 'promo_devOurs' })
    const noIds = await rejectAs(none, 'r1')
    const words = `The app can't tell whose membership ${CODE} is on. Check it in Whop.`
    ok(filter.status === 409 && filter.body.error === words && noIds.status === 409 && noIds.body.error === words && writes(db).length === 0 && writes(none).length === 0,
       `Whop ignoring the filter, or no membership id or Whop user to compare: 409 "${words}"`, show({ filter: filter.body, noIds: noIds.body }))
  }
  {
    const db = freshDb([approvedRow()])
    whop.answer = (req) => (req.path === '/api/v1/memberships' ? 'throw' : null)
    const r = await rejectAs(db, 'r1')
    ok(r.status === 503 && r.body.error === NOT_ASKED && r.row.status === 'approved' && writes(db).length === 0, `Whop not answering where the code is: 503 "${NOT_ASKED}", nothing written`, show(r.body))
  }
  {
    const db = freshDb([approvedRow()])
    const c = await rejectAs(db, 'r1', 'csm')
    ok(c.status === 403 && c.row.status === 'approved' && whop.log.length === 0, 'approved, a csm: 403, Whop not asked', show(c.body))
  }
  {
    // The request changed while Whop was asked: the conditional write finds nothing.
    const db = freshDb([approvedRow()])
    whop.answer = (req) => {
      if (req.path === '/api/v1/memberships') row(db, 'r1').status = 'applied'
      return null
    }
    const r = await rejectAs(db, 'r1')
    ok(r.status === 409 && r.body.error === CHANGED && r.row.status === 'applied', `the row changed while Whop was asked: 409 "${CHANGED}"`, show(r.body))
  }
}
{
  // Approved with no Whop id the app can ask about: rejected with a note to check the code in Whop.
  const db = freshDb([{ id: 'r1', status: 'approved', promo_code: 'ECOM30-NOIDAA', whop_promo_id: null, reviewed_at: ago(60 * MIN) }])
  const r = await rejectAs(db, 'r1')
  const csm = freshDb([{ id: 'r1', status: 'approved', promo_code: 'ECOM30-NOIDAA', whop_promo_id: null }])
  const c = await rejectAs(csm, 'r1', 'csm')
  ok(r.status === 200 && show(r.body) === show({ success: true, code: 'ECOM30-NOIDAA', codeState: 'may_exist' }) && rejectedBy(r, db, 'team-founder')
       && writes(db)[0].filters.includes('whop_promo_id is null') && whop.log.length === 0 && c.status === 403,
     'approved, code unknown (no Whop id): 200, codeState may_exist, rejected where it still has no id (.is()), the one Reject with no Whop answer; a csm 403', show(r.body))
}

console.log('\n=== The routes: no em dash, and Mark code applied is gone ===')
/** Every string and template text in a file's code (comments left out). */
function stringsIn(source) {
  const sf = ts.createSourceFile('route.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const out = []
  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.push(node.text)
    else if (ts.isTemplateExpression(node)) out.push(node.head.text, ...node.templateSpans.map((s) => s.literal.text))
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}
const ROUTE_FILES = ['approve', 'reject'].map((r) => `src/app/api/discounts/${r}/route.ts`)
const dashed = (src) => ROUTE_FILES.flatMap((f) => stringsIn(src(f)).filter((s) => s.includes('—')))
ok(dashed(fromSrc).length === 0, 'no string the two routes send or log holds an em dash', show(dashed(fromSrc)))
ok(dashed(fromBase).length === 2, `control: at ${BASE} two did`, show(dashed(fromBase)))
ok(!fs.existsSync(here('../src/app/api/discounts/mark-applied')), 'POST /api/discounts/mark-applied is gone (T-137): Try again marks a request applied when Whop shows the code on the membership')

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
