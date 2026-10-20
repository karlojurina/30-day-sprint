// team-page.test.mjs: the Team page of admin rebuild 2 (WI-9),
// _admin/prds/admin-rebuild-2/ in the workspace: the brand look, a phone
// layout, the invite's example address name@ecomuniversity.com (it was
// name@ecomtalent.com), and no em dash (the page printed one for a member
// with no name and in its empty list).
//
// The page's rules (src/lib/admin/team-data.ts, copied by build.mjs) run as
// they are; its calls (src/lib/admin/team-transport.ts, copied here) go
// through fetch() to copies of the real team-members routes with the real
// team check (admin-auth.ts) on stub-server.ts's database; the page itself
// is compiled by TypeScript and rendered by React's server renderer (its
// first state: the invite form, and the list loading). world-tests/
// admin-pages.mjs draws it in a browser at a phone's width.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'

const BASE = 'ca9b5ef' // night/admin2 after WI-1, where this lane started

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const fromSrc = (rel) => fs.readFileSync(here(`../${rel}`), 'utf8')
const fromBase = (rel) => execFileSync('git', ['show', `${BASE}:${rel}`], { cwd: here('..'), encoding: 'utf8' })

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v)

function write(text, label, out, rewrites = []) {
  let s = text
  for (const [from, to] of rewrites) {
    if (!s.includes(from)) throw new Error(`${label} has no ${from}`)
    s = s.split(from).join(to)
  }
  if (/(?:from|import)\s*["']@\//.test(s)) throw new Error(`an unrewritten @/ import remains in ${label}`)
  fs.writeFileSync(here(`./_gen/${out}`), s)
}
function compile(rel, out, rewrites = []) {
  write(ts.transpileModule(fromSrc(rel), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, rel, out, rewrites)
}
async function hush(fn) {
  const real = [console.info, console.warn, console.error]
  console.info = console.warn = console.error = () => {}
  try { return await fn() } finally { [console.info, console.warn, console.error] = real }
}

// ── The code under test ─────────────────────────────────────────────────────
const ROUTES = [['from "next/server"', 'from "./stub-server.ts"'], ['from "@/lib/admin-auth"', 'from "./admin-auth.ts"']]
write(fromSrc('src/app/api/admin/team-members/route.ts'), 'team-members/route.ts', 'a2-team-members-route.ts', ROUTES)
write(fromSrc('src/app/api/admin/team-members/[id]/route.ts'), 'team-members/[id]/route.ts', 'a2-team-member-route.ts', ROUTES)
write(fromSrc('src/lib/admin/team-transport.ts'), 'src/lib/admin/team-transport.ts', 'a2-team-transport.ts', [
  ['from "@/lib/admin/call-route"', 'from "./call-route.ts"'],
  ['from "@/lib/admin/team-data"', 'from "./team-data.ts"'],
])
const UI = [['from "@/components/admin/ui"', 'from "./a2-ui.mjs"']]
compile('src/components/admin/ui.tsx', 'a2-ui.mjs', [['import Link from "next/link";', 'const Link = (props) => props.children;']])
compile('src/components/admin/list-parts.tsx', 'a2-list-parts.mjs', [...UI, ['from "@/lib/admin/croatia-dates"', 'from "./croatia-dates.ts"']])
compile('src/components/admin/templates/form-parts.tsx', 'a2-form-parts.mjs', [...UI, ['from "@/components/admin/list-parts"', 'from "./a2-list-parts.mjs"']])
compile('src/components/admin/team/TeamView.tsx', 'a2-team-view.mjs', [
  ...UI,
  ['from "@/components/admin/list-parts"', 'from "./a2-list-parts.mjs"'],
  ['from "@/components/admin/templates/form-parts"', 'from "./a2-form-parts.mjs"'],
  ['from "@/lib/admin/croatia-dates"', 'from "./croatia-dates.ts"'],
  ['from "@/lib/admin/team-data"', 'from "./team-data.ts"'],
])
console.log('generated the Team page, its calls and the routes into _gen/')

const TEAM = await import('./_gen/team-data.ts')
const { teamTransport } = await import('./_gen/a2-team-transport.ts')
const listRoute = await import('./_gen/a2-team-members-route.ts')
const memberRoute = await import('./_gen/a2-team-member-route.ts')
const { setBrowser } = await import('./_gen/a2-browser-stub.ts')
// useDb is no React hook; the alias keeps eslint's hook rule from reading it as one.
const { FakeDb, NextRequest, useDb: installDb } = await import('./_gen/stub-server.ts')
const { TeamView } = await import('./_gen/a2-team-view.mjs')

const words = (html) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ')
const STAMP = '2026-10-20T08:30:00.000Z'

console.log('\n=== The invite: the team\'s own address, and the page\'s first state ===')
{
  ok(TEAM.INVITE_PLACEHOLDER === 'name@ecomuniversity.com', 'the example address is name@ecomuniversity.com')
  const noop = { list: () => new Promise(() => {}), invite: async () => ({ ok: true }), changeRole: async () => ({ ok: true }), remove: async () => ({ ok: true }) }
  const html = renderToString(createElement(TeamView, { transport: noop, me: { id: 'tm-1', role: 'founder' } }))
  ok(html.includes('placeholder="name@ecomuniversity.com"') && !/ecomtalent/i.test(html),
     'a founder sees the invite form with that address in the email field, and the list loading', words(html).slice(0, 140))
  ok(/<button type="submit"[^>]*>Send invite<\/button>/.test(html) && html.includes('Loading the team'), 'the form sends with Send invite; the list says it is loading')
  const admin = words(renderToString(createElement(TeamView, { transport: noop, me: { id: 'tm-2', role: 'admin' } })))
  ok(admin.includes('Only founders can manage the team.') && !admin.includes('Send invite'), 'an admin reads one line and no form (the routes refuse them too)')
  const old = fromBase('src/app/admin/(authenticated)/team/page.tsx')
  ok(old.includes('placeholder="name@ecomtalent.com"') && old.includes('m.full_name || "—"') && old.includes('yet — that'),
     `control: at ${BASE} the field said name@ecomtalent.com, and the page printed an em dash for a member with no name and in its empty list`)
}

console.log('\n=== The rules the page holds back, as the routes do ===')
{
  ok(TEAM.roleLocked({ id: 'me', role: 'founder' }, 'me') && !TEAM.roleLocked({ id: 'me', role: 'admin' }, 'me') && !TEAM.roleLocked({ id: 'x', role: 'founder' }, 'me'),
     'a founder cannot change their own role here (another founder\'s, yes)')
  ok(!TEAM.canRemove({ id: 'me' }, 'me') && TEAM.canRemove({ id: 'x' }, 'me'), 'nobody can remove themselves')
  ok(TEAM.inviteProblem({ email: 'nope', full_name: 'A B', role: 'csm' }) === 'Enter a full email address.'
       && TEAM.inviteProblem({ email: 'a@example.com', full_name: '  ', role: 'csm' }) === 'Enter their full name.'
       && TEAM.inviteProblem({ email: ' a@example.com ', full_name: 'A B', role: 'csm' }) === null,
     'an invite needs a full email address and a name, as the route does')
}

console.log('\n=== The calls reach the real routes, with the real team check ===')
const realFetch = globalThis.fetch
globalThis.fetch = async (url, init = {}) => {
  // Node's Request takes no cache mode: the rest of the call as the page made it.
  const rest = { ...init }
  delete rest.cache
  const path = String(url)
  if (path === '/api/admin/team-members') return listRoute[rest.method](new NextRequest(`http://app${path}`, rest))
  const m = /^\/api\/admin\/team-members\/([^/]+)$/.exec(path)
  if (m) return memberRoute[rest.method](new NextRequest(`http://app${path}`, rest), { params: Promise.resolve({ id: decodeURIComponent(m[1]) }) })
  throw new Error(`no route for ${rest.method} ${path}`)
}
{
  const db = new FakeDb({
    team_members: [
      { id: 'tm-founder', email: 'founder@example.com', full_name: 'Founder', role: 'founder', created_at: '2026-05-01T09:00:00.000Z' },
      { id: 'tm-admin', email: 'admin@example.com', full_name: 'Admin', role: 'admin', created_at: '2026-05-20T09:00:00.000Z' },
      { id: 'tm-csm', email: 'csm@example.com', full_name: 'Csm', role: 'csm', created_at: STAMP },
    ],
  }, { 'tok-founder': 'tm-founder', 'tok-admin': 'tm-admin' })
  installDb(db)
  setBrowser({ db, token: 'tok-founder' })
  const list = await hush(() => teamTransport.list())
  ok(list.ok && show(list.data.map((m) => m.id)) === show(['tm-founder', 'tm-admin', 'tm-csm']), 'a founder\'s list: everyone, oldest first', show(list.ok && list.data.length))
  const up = await hush(() => teamTransport.changeRole('tm-csm', 'admin'))
  ok(up.ok && up.data.role === 'admin' && db.rows('team_members').find((m) => m.id === 'tm-csm').role === 'admin', 'a role change goes through PATCH and comes back as saved')
  const self = await hush(() => teamTransport.changeRole('tm-founder', 'csm'))
  ok(!self.ok && self.status === 400 && self.error === 'Cannot demote your own founder role', 'demoting oneself is refused by the route too, in its words', show(self))
  setBrowser({ db, token: 'tok-admin' })
  const notFounder = await hush(() => teamTransport.list())
  ok(!notFounder.ok && notFounder.status === 403 && notFounder.error === "Your team account can't do this.", 'an admin is refused (403), in the page\'s words', show(notFounder))
}
globalThis.fetch = async () => new Response(JSON.stringify({ warning: 'team_members row removed, but auth user delete failed: boom' }), { status: 200 })
{
  const r = await teamTransport.remove('tm-x')
  ok(r.ok && r.data.warning === 'team_members row removed, but auth user delete failed: boom', 'a removal whose login could not be deleted comes back with the route\'s warning, for the page to show')
}
globalThis.fetch = realFetch

console.log('\n=== The words the team reads ===')
{
  const files = ['src/components/admin/team/TeamView.tsx', 'src/lib/admin/team-data.ts', 'src/lib/admin/team-transport.ts',
    'src/app/admin/(authenticated)/team/TeamPage.tsx', 'src/app/dev/admin/team-fixtures.ts']
  const bad = files.filter((f) => /—|\bunlock|ecomtalent/i.test(fromSrc(f)))
  ok(bad.length === 0, 'no em dash, "unlock" or "EcomTalent" in the Team page\'s files', bad.join(', '))
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
