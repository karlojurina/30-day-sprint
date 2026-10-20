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
//
// The routes run as they are. This file copies each one into _gen/ with only
// its import lines rewritten, as build.mjs and discount-queue.test.mjs do: the
// team's login and Whop's promo code go to stub-admin.ts, Next and the
// database to stub-server.ts, the rule to build.mjs's copies (run it first;
// `npm run test:client` does). The page's own button handlers are taken from
// its source with TypeScript's parser, their types stripped and nothing else
// changed, and run with the browser's prompt() and fetch() standing in: fetch
// hands the call to the route copies, so the button, the route and the row
// are one path. The page and the routes as they were at BASE (production,
// where this lane started) are taken from git and run beside them, so each
// check is shown failing on the old code.
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
/** The route at `rel`, now and at BASE, copied to _gen/<out>.ts and _gen/<out>.old.ts. */
function copyRoute(rel, out, rewrites) {
  write(fromSrc(rel), rel, `./_gen/${out}.ts`, rewrites)
  write(fromBase(rel), `${rel}@${BASE}`, `./_gen/${out}.old.ts`, rewrites)
}

const LOGIN = [
  ['from "next/server"', 'from "./stub-server.ts"'],
  ['from "@/lib/admin-auth"', 'from "./stub-admin.ts"'],
]
copyRoute('src/app/api/discounts/reject/route.ts', 'admin-reject-route', LOGIN)
copyRoute('src/app/api/discounts/approve/route.ts', 'admin-approve-route', [
  ...LOGIN,
  ['from "@/lib/whop"', 'from "./stub-admin.ts"'],
  ['from "@/lib/catalog-tables"', 'from "./stub-server.ts"'],
  ['from "@/lib/constants"', 'from "./constants.ts"'],
  ['from "@/lib/curriculum-reset"', 'from "./curriculum-reset.ts"'],
  ['from "@/lib/world/discount-server"', 'from "./discount-server.ts"'],
])

copyRoute('src/app/api/discounts/mark-applied/route.ts', 'admin-mark-applied-route', LOGIN)

const reject = { now: (await import('./_gen/admin-reject-route.ts')).POST, old: (await import('./_gen/admin-reject-route.old.ts')).POST }
const approve = { now: (await import('./_gen/admin-approve-route.ts')).POST, old: (await import('./_gen/admin-approve-route.old.ts')).POST }
const markApplied = { now: (await import('./_gen/admin-mark-applied-route.ts')).POST, old: (await import('./_gen/admin-mark-applied-route.old.ts')).POST }
const routes = (v) => ({
  '/api/discounts/reject': reject[v], '/api/discounts/approve': approve[v], '/api/discounts/mark-applied': markApplied[v],
})
// useDb is no React hook; the alias keeps eslint's hook rule from reading it as one.
const { FakeDb, useDb: installDb } = await import('./_gen/stub-server.ts')
const { setTeam, promoCodes, whileWhopAnswers } = await import('./_gen/stub-admin.ts')

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
  const handleMarkApplied = bind('handleMarkApplied')
  return {
    seen,
    reject: (id) => logged(() => handleReject(id)),
    approve: (id, override = false) => logged(() => handleApprove(id, override)),
    markApplied: (id) => logged(() => handleMarkApplied(id)),
  }
}

/**
 * One student and their requests. The catalog flag is stub-server.ts's
 * default, the old course, whose rule needs only these two lessons done in
 * the 14 days: the shortest way to a request the rule approves. What these
 * checks are about, the route's last write, is the same on both courses.
 * The ads are ticked for the routes at BASE, which still refuse without it.
 */
function freshDb(requests) {
  const db = new FakeDb({
    students: [{ id: 'a1b2c3d4-0000-4000-8000-000000000001', first_paid_at: '2026-10-02T10:00:00.000Z', ad_submissions_verified: true }],
    lessons: [{ id: 'l001', region_id: 'r1' }, { id: 'l002', region_id: 'r2' }],
    student_lesson_completions: ['l001', 'l002'].map((lesson_id) => ({
      student_id: 'a1b2c3d4-0000-4000-8000-000000000001', lesson_id, completed_at: '2026-10-03T10:00:00.000Z',
    })),
    discount_requests: requests.map((r) => ({
      student_id: 'a1b2c3d4-0000-4000-8000-000000000001', created_at: '2026-10-05T10:00:00.000Z', ...r,
    })),
  })
  installDb(db)
  setTeam({ id: 'team-1', role: 'founder' })
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

console.log('\n=== admin-4 / discount-3: only a pending request can be decided ===')
const ALREADY = 'This request was already decided.'
/** POST /api/discounts/reject straight, as a stale tab's button sends it. */
const rejectStraight = async (v, requestId, reason = 'changed my mind') =>
  (await logged(async () => {
    const res = await reject[v](new Request('http://app/api/discounts/reject', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId, reason }),
    }))
    return { status: res.status, body: await res.json() }
  })).value
for (const [status, extra] of [
  ['approved', { promo_code: 'ECOM30-A1B2C3', whop_promo_id: 'promo_7', reviewed_by: 'team-2', reviewed_at: '2026-10-20T09:00:00.000Z' }],
  ['applied', { promo_code: 'ECOM30-A1B2C3', whop_promo_id: 'promo_7', applied_at: '2026-10-20T09:30:00.000Z' }],
  ['rejected', { rejection_reason: 'ads not verified', reviewed_at: '2026-10-20T09:00:00.000Z' }],
]) {
  const db = freshDb([{ id: 'r1', status, ...extra }])
  const before = show(row(db, 'r1'))
  const r = await rejectStraight('now', 'r1')
  ok(r.status === 409 && r.body.error === ALREADY && show(row(db, 'r1')) === before,
     `Reject on a request already ${status}: 409 "${ALREADY}", the row untouched`, show(r))
}
{
  const db = freshDb([{ id: 'r1', status: 'approved', promo_code: 'ECOM30-A1B2C3', whop_promo_id: 'promo_7' }])
  const r = await rejectStraight('old', 'r1')
  ok(r.status === 200 && row(db, 'r1').status === 'rejected' && row(db, 'r1').promo_code === 'ECOM30-A1B2C3',
     `control: the route at ${BASE} turns an approved request with a live code into a rejected one`, show(row(db, 'r1')))
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
    ok(a.seen.reloads === 1 && r.status === 'approved' && r.promo_code === 'ECOM30-A1B2C3' && show(r) === approved,
       'two tabs: A approves (one code), then B\'s stale Reject leaves the approved row exactly as it was', show(r))
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
    const sentence = 'The Whop code ECOM30-A1B2C3 was created, but this request had already been decided, so the code must be deleted in Whop.'
    ok(bDuring !== null && b.seen.reloads === 1 && r.status === 'rejected' && r.rejection_reason === 'not this one' && r.promo_code === null,
       'a rejection that lands while Whop makes the code stands: rejected, B\'s reason, no code on the row', show(r))
    ok(show(made) === show(['ECOM30-A1B2C3']) && a.seen.errors.r1 === sentence && a.seen.reloads === 0,
       'A reads the 409 inline: the code was made and must be deleted in Whop', show({ made, shown: a.seen.errors.r1 }))
    ok(lines.some((l) => l.includes('request r1') && l.includes('ECOM30-A1B2C3') && l.includes('Delete the code in Whop')),
       'and the server log names the request and the code', show(lines))
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
  await t.markApplied('r1')
  await t.reject('r2')
  const { lines } = await t.approve('r3', true)
  const [r1, r2, r3] = ['r1', 'r2', 'r3'].map((id) => row(db, id))
  const override = lines.find((l) => l.includes('OVERRIDE')) ?? ''
  if (v === 'now') {
    ok(r1.status === 'applied' && r1.reviewed_by === 'team-csm-1' && r1.applied_by === 'team-csm-1',
       'Approve, then Mark applied: reviewed_by and applied_by are the login, whatever the page sends', show({ reviewed_by: r1.reviewed_by, applied_by: r1.applied_by }))
    ok(r2.status === 'rejected' && r2.reviewed_by === 'team-csm-1', 'Reject records the login as the reviewer (it recorded nobody)', show(r2.reviewed_by))
    ok(r3.status === 'approved' && r3.reviewed_by === 'team-csm-1' && override.includes('team-csm-1') && !override.includes('team-founder-1'),
       'Generate anyway: the row and the log line name the login', override)
  } else {
    ok(r1.reviewed_by === 'team-founder-1' && r1.applied_by === 'team-founder-1' && r2.reviewed_by === null && override.includes('team-founder-1'),
       `control: at ${BASE} the routes record whatever the page sends, and Reject records nobody`, show({ r1: [r1.reviewed_by, r1.applied_by], r2: r2.reviewed_by, override }))
  }
}

console.log('\n=== Admin PRD review: the refusals are plain sentences ===')
for (const v of ['now', 'old']) {
  const db = freshDb([{ id: 'r1', status: 'pending' }])
  const t = tab(page[v], routes(v))
  await t.markApplied('r1')
  const said = t.seen.errors.r1 ?? ''
  if (v === 'now') {
    ok(row(db, 'r1').status === 'pending' && said === 'Only an approved request can be marked applied. This one is "pending".',
       'Mark applied on a pending request: refused in two plain sentences', said)
  } else {
    ok(said.includes('—'), `control: at ${BASE} that refusal carries an em dash`, said)
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
    ok(r.status === 'approved' && r.promo_code === 'ECOM30-A1B2C3' && promoCodes.length === codes + 1 && said === '' && t.seen.reloads === 1,
       'Approve, the rule saying yes and the ads never ticked: approved, one code, no refusal, the list reloads', show({ status: r.status, code: r.promo_code, said }))
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
const ROUTE_FILES = ['approve', 'reject', 'mark-applied'].map((r) => `src/app/api/discounts/${r}/route.ts`)
const dashed = (src) => ROUTE_FILES.flatMap((f) => stringsIn(src(f)).filter((s) => s.includes('—')))
ok(dashed(fromSrc).length === 0, 'no string the three routes send or log holds an em dash', show(dashed(fromSrc)))
ok(dashed(fromBase).length === 3, `control: at ${BASE} three did`, show(dashed(fromBase)))

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
