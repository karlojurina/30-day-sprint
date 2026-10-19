// admin-discounts.test.mjs: the team's buttons on /admin/discounts and the
// routes behind them (fix lane G1, 2026-10-20).
//
//   admin-1 / discount-1: Cancel (or Esc) on the Reject prompt rejected the
//   request anyway, with no reason, and on the new course a rejection is final.
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

const reject = { now: (await import('./_gen/admin-reject-route.ts')).POST, old: (await import('./_gen/admin-reject-route.old.ts')).POST }
// useDb is no React hook; the alias keeps eslint's hook rule from reading it as one.
const { FakeDb, useDb: installDb } = await import('./_gen/stub-server.ts')
const { setTeam } = await import('./_gen/stub-admin.ts')

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
const page = { now: fromSrc(PAGE), old: fromBase(PAGE) }

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
  return { seen, reject: (id) => logged(() => handleReject(id)) }
}

function freshDb(requests) {
  const db = new FakeDb({
    students: [{ id: 's1', first_paid_at: '2026-10-02T10:00:00.000Z', ad_submissions_verified: true }],
    discount_requests: requests.map((r) => ({ student_id: 's1', created_at: '2026-10-20T10:00:00.000Z', ...r })),
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

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
