// Signing out when the logout request fails (2026-10-20, the night bug hunt:
// login-5).
//
// auth-js keeps the session when its logout request fails on the network or
// with a 5xx: signOut() answers { error } and never removes the stored session
// (GoTrueClient.js, _signOut). AuthContext ignored the answer and cleared its
// own state anyway, so the guard showed the login page while the browser
// still held a working session; on a shared computer the next person to open
// the site was in that student's account. Now the state is cleared only once
// the session is gone, and signOut() resolves to the line to show otherwise.
//
// HOW IT RUNS. The real AuthProvider (src/contexts/AuthContext.tsx), turned
// into JavaScript by the app's own TypeScript and run by the real React in
// Node, as client-tests/student-context.test.mjs runs StudentContext. Its
// browser client is the real auth-js client the app's is built on, installed
// in node_modules, keeping its session in a store this file can read; only
// the requests are answered here: /api/auth/me, and auth's logout, which
// fails offline, fails with a 500, or works. The two screens with a Sign out
// button for students, the map's corner and the closed-membership card, are
// run in headless Chrome by client-tests/student-screens-sim.test.mjs.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url))
const require = createRequire(import.meta.url)
const ts = require('typescript')
const { GoTrueClient } = require('@supabase/auth-js')

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? `: ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? `: ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v)
const read = (rel) => fs.readFileSync(here(rel), 'utf8')

// ── The page React DOM reads, for a tree that renders no elements ────────────
class Target {
  #on = new Map()
  addEventListener(type, fn) { if (!this.#on.has(type)) this.#on.set(type, new Set()); this.#on.get(type).add(fn) }
  removeEventListener(type, fn) { this.#on.get(type)?.delete(fn) }
  dispatchEvent(e) { for (const fn of [...(this.#on.get(e.type) ?? [])]) fn.call(this, e); return true }
}
const win = new Target()
globalThis.window = globalThis
globalThis.addEventListener = win.addEventListener.bind(win)
globalThis.removeEventListener = win.removeEventListener.bind(win)
globalThis.dispatchEvent = win.dispatchEvent.bind(win)
globalThis.HTMLIFrameElement = class {}
const doc = new Target()
Object.assign(doc, { visibilityState: 'visible', activeElement: null, createElement: () => ({ setAttribute() {}, style: {} }) })
globalThis.document = doc
globalThis.IS_REACT_ACT_ENVIRONMENT = false
// auth-js logs a failed request; kept out of the output.
const logged = []
console.error = (...a) => { logged.push(a.map(String).join(' ')) }

// ── The requests ─────────────────────────────────────────────────────────────
const AUTH_URL = 'http://auth.test/auth/v1'
const STUDENT = { id: 's1', name: 'Test Student', whop_user_id: 'user_1', membership_status: 'active' }
const net = { logout: 204, logouts: 0, unexpected: [] }
globalThis.fetch = async (input, init = {}) => {
  const url = String(input)
  const method = (init.method ?? 'GET').toUpperCase()
  if (method === 'GET' && url === '/api/auth/me') {
    return new Response(JSON.stringify({ role: 'student', profile: { ...STUDENT }, appClosed: false }), { status: 200 })
  }
  if (method === 'POST' && url === `${AUTH_URL}/logout?scope=global`) {
    net.logouts++
    if (net.logout === 'offline') throw new TypeError('Failed to fetch')
    return new Response(net.logout === 204 ? null : JSON.stringify({ code: net.logout, msg: 'upstream error' }), { status: net.logout })
  }
  net.unexpected.push(`${method} ${url}`)
  return new Response('{}', { status: 404 })
}

// ── The real AuthProvider, with its imports pointed at the stand-ins ─────────
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sign-out-'))
const fileUrl = (p) => pathToFileURL(p).href
fs.writeFileSync(path.join(TMP, 'navigation.mjs'), "export function usePathname() { return '/world' }\n")
fs.writeFileSync(path.join(TMP, 'supabase-browser.mjs'), [
  '// The browser client: the test hands it a real auth-js client per case.',
  'export const client = { auth: null }',
  'export function createClient() { return client }',
  'export async function getSharedSession(sb) { const { data } = await sb.auth.getSession(); return data.session }',
].join('\n'))
const SPEC = {
  react: fileUrl(require.resolve('react')),
  'react/jsx-runtime': fileUrl(require.resolve('react/jsx-runtime')),
  'next/navigation': fileUrl(path.join(TMP, 'navigation.mjs')),
  '@/lib/supabase-browser': fileUrl(path.join(TMP, 'supabase-browser.mjs')),
  '@/lib/call-gate': fileUrl(here('./_gen/stub-call-gate.ts')),
}
async function load(rel) {
  let js = ts.transpileModule(read(`../${rel}`), {
    fileName: path.basename(rel),
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  js = js.replace(/from "([^"]+)"/g, (_m, spec) => {
    if (!(spec in SPEC)) throw new Error(`${rel} imports ${spec}, which has no stand-in here`)
    return `from ${JSON.stringify(SPEC[spec])}`
  })
  const out = path.join(TMP, `${path.basename(rel).replace(/\.tsx?$/, '')}.mjs`)
  fs.writeFileSync(out, js)
  return import(fileUrl(out))
}
const React = require('react')
const { createRoot } = require('react-dom/client')
const h = React.createElement
const browser = await import(SPEC['@/lib/supabase-browser'])
const { AuthProvider, useAuth, SIGN_OUT_FAILED_TEXT } = await load('src/contexts/AuthContext.tsx')

const view = { auth: null }
function AuthProbe() {
  view.auth = useAuth()
  return null
}
const settle = async () => { for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r)) }

/** A signed-in student on a fresh page: a stored session, the provider mounted and loaded. */
let cases = 0
async function signedIn() {
  const key = `sb-test-${++cases}-auth-token`
  const store = new Map()
  store.set(key, JSON.stringify({
    access_token: 'tok-1', refresh_token: 'refresh-1', token_type: 'bearer', expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: 'auth-1', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-10-01T00:00:00Z' },
  }))
  browser.client.auth = new GoTrueClient({
    url: AUTH_URL, storageKey: key, autoRefreshToken: false, persistSession: true, detectSessionInUrl: false,
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => { store.set(k, v) }, removeItem: (k) => { store.delete(k) } },
  })
  const container = Object.assign(new Target(), { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', namespaceURI: null, ownerDocument: doc, childNodes: [], firstChild: null })
  const root = createRoot(container)
  root.render(h(AuthProvider, null, h(AuthProbe)))
  await settle()
  return { root, stored: () => store.has(key) }
}

console.log('\n=== A sign-out that fails keeps the student where they are (login-5) ===')
for (const [mode, what] of [['offline', 'offline (a flaky connection)'], [500, 'with a 500 from auth']]) {
  const page = await signedIn()
  ok(view.auth.loading === false && view.auth.student?.id === 's1' && page.stored(), `${what}: signed in to start with`, `student ${view.auth.student?.id}`)
  net.logout = mode
  const said = await view.auth.signOut()
  await settle()
  ok(page.stored(), '  auth-js keeps the session in the browser', `stored ${page.stored()}`)
  ok(view.auth.student?.id === 's1' && view.auth.user?.id === 'auth-1',
     '  so the app keeps the student too: the guard has no reason to show the login page', `student ${view.auth.student?.id}, user ${view.auth.user?.id}`)
  ok(typeof said === 'string' && said === SIGN_OUT_FAILED_TEXT, '  and signOut() says what to show', show(said))
  page.root.unmount()
}

console.log('\n=== A sign-out that works signs them out, as before ===')
for (const [mode, what] of [[204, 'answered'], [401, 'refused for an expired token, which auth-js treats as signed out']]) {
  const page = await signedIn()
  net.logout = mode
  const said = await view.auth.signOut()
  await settle()
  ok(!page.stored() && view.auth.student === null && view.auth.user === null && view.auth.session === null && said === null,
     `logout ${what}: the session is gone and so is the student`, `stored ${page.stored()}, student ${show(view.auth.student)}, said ${show(said)}`)
  page.root.unmount()
}
ok(net.logouts === 4 && net.unexpected.length === 0, 'one logout request per press, and nothing else asked', `${net.logouts} logouts, ${show(net.unexpected)}`)

console.log('\n=== The line the student screens show (student-screens-sim.test.mjs shows it on them) ===')
{
  ok(typeof SIGN_OUT_FAILED_TEXT === 'string' && /sign you out/.test(SIGN_OUT_FAILED_TEXT) && /connection/.test(SIGN_OUT_FAILED_TEXT) && !/—|unlock|EcomTalent/i.test(SIGN_OUT_FAILED_TEXT),
     'one plain line: not signed out, check the connection', show(SIGN_OUT_FAILED_TEXT))
}

fs.rmSync(TMP, { recursive: true, force: true })
console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
process.exit(0)
