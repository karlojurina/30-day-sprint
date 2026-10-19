// login-4 (2026-10-20): the sign-in handoff (/auth/complete) leaves by
// replacing itself in the browser's history, on every path. It used to push
// a new entry, so Back from the map landed on the spent handoff: "That
// sign-in attempt expired." to a student who was signed in, or a spinner
// that never ended when the browser restored the page from its back-forward
// cache, and every further Back went through it again.
//
// The page is the real source (src/app/auth/complete/page.tsx), turned into
// plain JavaScript by the app's own TypeScript (types and JSX only). It runs
// with a stand-in window (whose location records how the page leaves),
// document (its cookie), timers (fired by hand) and Supabase client, and
// with React's two hooks as stand-ins that hand the test the page's effect.
// STUDENT_HOME is the real one (src/lib/world/access.ts) with production's
// setting.
//
//   node client-tests/build.mjs
//   node --experimental-strip-types client-tests/auth-complete-back.test.mjs
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

process.env.NEXT_PUBLIC_STUDENT_HOME = '/world'
const access = await import('./_gen/access.ts')

let pass = 0
const fails = []
const ok = (c, label, detail = '') => {
  if (c) { pass++; console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}
const show = (v) => JSON.stringify(v)

const req = createRequire(import.meta.url)
const ts = req('typescript')
const REL = 'src/app/auth/complete/page.tsx'
const SRC = fs.readFileSync(fileURLToPath(new URL(`../${REL}`, import.meta.url)), 'utf8')
const JS = ts.transpileModule(SRC, {
  fileName: REL,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText

/**
 * One visit to the page. `cookie` is document.cookie as the browser has it;
 * `setSession` is what supabase.auth.setSession does. Returns what the page
 * did: how it left (`replace` or `assign`, with the address), the cookie
 * writes, and the timers it set, to be fired by hand.
 */
async function visit({ cookie, setSession }) {
  const left = []
  const cookieWrites = []
  const timers = []
  const window = {
    location: {
      replace: (url) => { left.push(['replace', url]) },
      assign: (url) => { left.push(['assign', url]) },
      get href() { return 'http://app/auth/complete' },
      set href(url) { left.push(['assign', url]) },
    },
  }
  const document = {
    get cookie() { return cookie },
    set cookie(v) { cookieWrites.push(v) },
  }
  const setTimeout = (fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t }
  const clearTimeout = (t) => { if (t) t.cleared = true }
  const effects = []
  const stubs = {
    react: { useEffect: (fn) => { effects.push(fn) }, useState: (v) => [v, () => {}] },
    '@/lib/supabase-browser': { createClient: () => ({ auth: { setSession } }), isLockContention: () => false },
    '@/lib/world/access': access,
  }
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', 'window', 'document', 'setTimeout', 'clearTimeout', JS)(
    (name) => (name in stubs ? stubs[name] : req(name)), mod, mod.exports, window, document, setTimeout, clearTimeout,
  )
  mod.exports.default()
  effects.forEach((fn) => fn())
  // Let the page's own awaits finish.
  for (let i = 0; i < 20 && left.length === 0; i++) await new Promise((r) => globalThis.setTimeout(r, 1))
  return { left, cookieWrites, timers }
}
const handoff = (tokens = { access_token: 'access-made-up', refresh_token: 'refresh-made-up' }) =>
  `other=1; pending_session=${encodeURIComponent(JSON.stringify(tokens))}`

console.log('\n=== Signed in: the map replaces the handoff ===')
{
  const seen = []
  const v = await visit({ cookie: handoff(), setSession: async (t) => { seen.push(t); return { error: null } } })
  ok(show(v.left) === show([['replace', access.STUDENT_HOME]]) && access.STUDENT_HOME === '/world',
     'it leaves with location.replace(STUDENT_HOME), so Back from the map never lands on it', show(v.left))
  ok(seen.length === 1 && seen[0].access_token === 'access-made-up', 'after handing the tokens to Supabase once')
  ok(v.cookieWrites.some((c) => c.startsWith('pending_session=;') && c.includes('max-age=0')), 'and the handoff cookie is cleared')
  ok(v.timers.length === 2 && v.timers.every((t) => t.cleared), 'its two timers are cleared, nothing left to fire')
}

console.log('\n=== Every failure replaces it with the login page ===')
{
  const v = await visit({ cookie: 'other=1', setSession: async () => ({ error: null }) })
  ok(v.left.length === 1 && v.left[0][0] === 'replace' && v.left[0][1].startsWith('/login?error=session_expired&detail='),
     'no handoff cookie (a reload after it expired): replace with /login?error=session_expired', show(v.left))
}
{
  const v = await visit({ cookie: 'pending_session=%7Bnot-json', setSession: async () => ({ error: null }) })
  ok(v.left.length === 1 && v.left[0][0] === 'replace' && v.left[0][1].startsWith('/login?error=session_failed&detail=client'),
     'an unreadable cookie: replace with /login?error=session_failed', show(v.left))
}
{
  const v = await visit({ cookie: handoff(), setSession: async () => ({ error: { message: 'Invalid Refresh Token' } }) })
  ok(v.left.length === 1 && v.left[0][0] === 'replace' && v.left[0][1].startsWith('/login?error=session_failed&detail=client%3A%20Invalid%20Refresh%20Token'),
     'Supabase refuses the tokens: replace with /login?error=session_failed', show(v.left))
}
{
  const v = await visit({ cookie: handoff(), setSession: () => new Promise(() => {}) })
  ok(v.left.length === 0, 'the auth host never answers: nothing yet')
  const budget = v.timers.find((t) => t.ms === 20_000)
  budget.fn()
  ok(v.left.length === 1 && v.left[0][0] === 'replace' && v.left[0][1].startsWith('/login?error=session_timeout&detail='),
     'after the 20 s budget: replace with /login?error=session_timeout', show(v.left))
}

console.log('\n=== No other way out pushes an entry ===')
ok(!/location\.href\s*=(?!=)/.test(SRC) && !/location\.assign\(/.test(SRC) && (SRC.match(/window\.location\.replace\(/g) ?? []).length === 2,
   'the page assigns location.href nowhere, and replaces in its two exits')

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1) }
