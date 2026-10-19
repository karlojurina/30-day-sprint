// login-3 (2026-10-20): in a login rush a returning student was told
// "Authentication failed". The Whop login's first password sign-in took ANY
// error for "no account yet", tried to create the account, which failed as
// "already registered", and sent the student to auth_failed. Now only
// "invalid login credentials" leads to a new account. Any other error (a rate
// limit, a 5xx, the network) is tried once more after about half a second,
// then sends the student to /login?error=login_busy, which the login page
// words as "Too many people are signing in right now. Try again in a minute."
//
// The callback is the real source, copied by build.mjs (its `//` comment
// lines left out, as streak.test.mjs explains) with Whop's login calls and
// the database as stand-ins in stub-server.ts. The auth stand-in answers a
// sign-in the way auth-js does: a wrong password is status 400 with the code
// invalid_credentials; a rate limit is status 429, over_request_rate_limit; a
// network failure has status 0 and no code. The login page's message is the
// real LoginError.tsx, turned into JavaScript by the app's own TypeScript and
// rendered by React's server renderer.
//
//   node client-tests/build.mjs
//   node --experimental-strip-types client-tests/whop-login-busy.test.mjs
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { GET as login } from './_gen/whop-callback-route.ts'
import { signState } from './_gen/pkce.ts'
// useDb is the stand-in's "use this database", not a React hook: imported under a plainer name.
import { FakeDb, useDb as switchDb, NextRequest, setWhopUser } from './_gen/stub-server.ts'
import * as gate from './_gen/student-app-gate.ts'

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v)

/** Runs `fn` with the console quiet; returns [result, lines]. */
async function quietly(fn) {
  const real = [console.info, console.warn, console.error]
  const lines = []
  console.info = console.warn = console.error = (...a) => { lines.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')) }
  try { return [await fn(), lines] } finally { [console.info, console.warn, console.error] = real }
}

// ── The sign-in's answers, shaped as auth-js returns them ────────────────────
const failed = (error) => ({ data: { user: null, session: null }, error })
const RATE_LIMIT = failed({ name: 'AuthApiError', message: 'Request rate limit reached', status: 429, code: 'over_request_rate_limit' })
const NETWORK = failed({ name: 'AuthRetryableFetchError', message: 'fetch failed', status: 0 })
const UNAVAILABLE = failed({ name: 'AuthRetryableFetchError', message: 'Service Unavailable', status: 503 })
/** An auth server too old for error codes: the message only. */
const OLD_SERVER_NO_ACCOUNT = failed({ name: 'AuthApiError', message: 'Invalid login credentials', status: 400 })

// ── A login, the way Whop sends the student back ─────────────────────────────
process.env.NEXT_PUBLIC_APP_URL = 'http://app'
process.env.PKCE_COOKIE_SECRET = 'a made-up secret for this test'
delete process.env.STUDENT_APP_CLOSED
const authEmail = (user) => `${user}@whop.ecomtalent.com`
/**
 * A database where `user` has a student row that lets them in (the webhook
 * wrote it) and, when `account` is true, the auth account a past login made.
 * `answers` are what the sign-in says first, in order.
 */
function setUp({ user = 'user_1', account = true, answers = [] } = {}) {
  const db = new FakeDb({ students: [{ id: 's1', whop_user_id: user, membership_status: 'active', email: 'student@example.com' }] })
  if (account) db.authUsers[authEmail(user)] = { id: 'auth-1', password: `password-for-${user}` }
  db.signInAnswers.push(...answers)
  switchDb(db)
  setWhopUser({ sub: user, email: 'student@example.com', name: 'A Student', picture: null, username: 'student' })
  return db
}
async function logIn() {
  const state = signState('a-made-up-verifier', process.env.PKCE_COOKIE_SECRET)
  const started = Date.now()
  const [res, log] = await quietly(() => login(new NextRequest(`http://app/api/auth/whop/callback?code=made-up-code&state=${encodeURIComponent(state)}`)))
  const location = res.headers.get('location') ?? ''
  const url = new URL(location)
  return { status: res.status, location, error: url.searchParams.get('error'), detail: url.searchParams.get('detail'), cookies: res.cookies?.jar ?? {}, log, ms: Date.now() - started }
}
const signedIn = (r) => r.status === 307 && r.location === 'http://app/auth/complete' && typeof r.cookies.pending_session === 'string'
/** The sign-ins before the browser session's (the service role's client), and the rest of the auth calls. */
const calls = (db) => ({
  signIns: db.authLog.filter((c) => c.call === 'signIn' && c.client === 'service').length,
  creates: db.authLog.filter((c) => c.call === 'createUser').length,
  session: db.authLog.filter((c) => c.call === 'signIn' && c.client === 'anon').length,
})

console.log('\n=== A returning student while the sign-in server is busy ===')
{
  const db = setUp({ answers: [RATE_LIMIT] })
  const r = await logIn()
  ok(signedIn(r), 'a rate limit on the first sign-in, fine on the second: signed in', show({ status: r.status, location: r.location }))
  ok(show(calls(db)) === show({ signIns: 2, creates: 0, session: 1 }), 'one retry, no account created', show(calls(db)))
  ok(r.ms >= 450, 'the retry waits about half a second', `${r.ms} ms`)
}
{
  const db = setUp({ answers: [RATE_LIMIT, RATE_LIMIT] })
  const r = await logIn()
  ok(r.status === 307 && r.error === 'login_busy' && r.detail === 'server: Request rate limit reached',
     'rate limited twice: back to /login?error=login_busy, with what the server said', show({ location: r.location }))
  ok(show(calls(db)) === show({ signIns: 2, creates: 0, session: 0 }),
     'no account is created (it used to try, fail as "already registered" and say auth_failed), no session either', show(calls(db)))
  ok(db.calls('students', 'upsert').length === 0, 'and the student row is not written')
}
{
  const db = setUp({ answers: [NETWORK, NETWORK] })
  const r = await logIn()
  ok(r.error === 'login_busy' && calls(db).creates === 0, 'a network failure twice: login_busy, no account created', show({ detail: r.detail, calls: calls(db) }))
}
{
  const db = setUp({ answers: [UNAVAILABLE] })
  const r = await logIn()
  ok(signedIn(r) && calls(db).signIns === 2 && calls(db).creates === 0, 'a 503 once, then fine: signed in on the retry', show(calls(db)))
}

console.log('\n=== A new student: "invalid login credentials" still creates the account ===')
{
  const db = setUp({ user: 'user_new', account: false })
  const r = await logIn()
  ok(signedIn(r), 'no account yet: the account is created and the student signed in', show({ location: r.location }))
  ok(show(calls(db)) === show({ signIns: 1, creates: 1, session: 1 }), 'with no retry and no wait first', show({ calls: calls(db), ms: r.ms }))
}
{
  const db = setUp({ user: 'user_new', account: false, answers: [RATE_LIMIT] })
  const r = await logIn()
  ok(signedIn(r) && show(calls(db)) === show({ signIns: 2, creates: 1, session: 1 }),
     'a new student in the rush: rate limited, then "invalid login credentials" on the retry, so the account is created', show(calls(db)))
}
{
  const db = setUp({ user: 'user_new', account: false, answers: [OLD_SERVER_NO_ACCOUNT] })
  const r = await logIn()
  ok(signedIn(r) && calls(db).creates === 1 && calls(db).signIns === 1,
     'an auth server that sends the message without a code: still read as "no account yet"', show(calls(db)))
}

console.log('\n=== The login page says it plainly ===')
{
  const req = createRequire(import.meta.url)
  const ts = req('typescript')
  const React = req('react')
  const { renderToStaticMarkup } = req('react-dom/server')
  const rel = 'src/app/login/LoginError.tsx'
  const src = fs.readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8')
  const js = ts.transpileModule(src, {
    fileName: rel,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText
  let query = ''
  const stubs = {
    'next/navigation': { useSearchParams: () => new URLSearchParams(query) },
    '@/lib/student-app-gate': gate,
    './login.module.css': new Proxy({}, { get: (_, k) => String(k) }),
  }
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', js)((name) => (name in stubs ? stubs[name] : req(name)), mod, mod.exports)
  const shown = (q) => {
    query = q
    return renderToStaticMarkup(React.createElement(mod.exports.LoginError))
      .replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  }
  const text = shown(`error=login_busy&detail=${encodeURIComponent('server: Request rate limit reached')}`)
  ok(text.startsWith('Too many people are signing in right now. Try again in a minute.'),
     'login_busy reads "Too many people are signing in right now. Try again in a minute."', text)
  ok(text.includes('login_busy: server: Request rate limit reached'), 'and the code line under it shows the code and what the server said')
  ok(!/—|unlock|EcomTalent/i.test(text), 'no em dash, no "unlock", no "EcomTalent"')
  const callback = fs.readFileSync(fileURLToPath(new URL('../src/app/api/auth/whop/callback/route.ts', import.meta.url)), 'utf8')
  const codes = [...new Set([...callback.matchAll(/login\?error=([a-z_]+)/g)].map((m) => m[1]))]
  const unmapped = codes.filter((c) => !new RegExp(`^\\s+${c}:`, 'm').test(src))
  ok(codes.includes('login_busy') && unmapped.length === 0, 'every code the callback sends has its sentence in LoginError.tsx', `${codes.join(', ')}${unmapped.length ? `; unmapped: ${unmapped.join(', ')}` : ''}`)
}

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
