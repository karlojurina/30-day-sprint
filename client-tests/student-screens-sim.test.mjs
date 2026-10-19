// Student screens a failed load reaches, in a real browser (2026-10-20, the
// review of the night bug hunt).
//
//   node client-tests/student-screens-sim.test.mjs
//
// Run it from the app root (30-day-sprint). Nothing has to be running: no dev
// server, no database, no login. It needs Chrome (CHROME_PATH, or the system
// one) and puppeteer-core, which is world-tests' own (`npm install` once in
// world-tests/), as for world-tests/lesson-player-sim.mjs. About 10 seconds.
//
// WHAT IT PROVES. The code under test is the real source, read from src/ on
// every run and turned into JavaScript by the app's own TypeScript: the
// Playbook page (src/app/dashboard/playbook/page.tsx), which must not send a
// graduate away while their data failed to load (T-026). It is mounted in
// headless Chrome by React's development build, with its real effects.
//
// WHAT IT DOES NOT PROVE. AuthContext, StudentContext and Supabase are
// stand-ins here: the page is handed the provider's values directly
// (client-tests/student-context.test.mjs runs the real provider). next/link
// and next/navigation are stand-ins too, and the app's tokens are not loaded,
// so nothing here says how the page looks.
//
// NO NETWORK. Every request the page makes is answered from this file, and
// Chrome is started with a rule that fails every DNS lookup. The last check
// fails if the page asked for anything else.
//
// One line per check, a totals line, exit code 1 if any check fails.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const APP_ROOT = path.join(HERE, '..')
const ts = createRequire(import.meta.url)('typescript')
let puppeteer
try {
  puppeteer = createRequire(path.join(APP_ROOT, 'world-tests', 'package.json'))('puppeteer-core')
} catch {
  console.error('This test needs puppeteer-core: run `npm install` once in world-tests/.')
  process.exit(1)
}
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
if (!fs.existsSync(CHROME)) {
  console.error(`This test needs Chrome at ${CHROME} (or set CHROME_PATH).`)
  process.exit(1)
}
/** Chrome's profile for the run, removed at the end (see lesson-player-sim.mjs on why it is kept here). */
const PROFILE = path.join(APP_ROOT, 'world-tests', 'shots', 'student-screens-sim-profile')
const PAGE_ORIGIN = 'https://app.test'

// ── The bundle: the real sources, a few stand-ins, and the harness ───
const read = (rel) => fs.readFileSync(path.join(APP_ROOT, rel), 'utf8')
const real = (rel) => ts.transpileModule(read(rel), {
  fileName: rel,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText
/** A function from this file, as the body of a module in the page. */
const inPage = (fn) => `(${fn.toString()})(require, module, exports);`

/** @/contexts/AuthContext: useAuth over a context the harness provides. */
function authStandIn(require, module, exports) {
  const React = require('react')
  const Ctx = React.createContext(null)
  function useAuth() {
    return React.useContext(Ctx)
  }
  exports.AuthCtx = Ctx
  exports.useAuth = useAuth
}

/** @/contexts/StudentContext: useStudent over a context the harness provides. */
function studentStandIn(require, module, exports) {
  const React = require('react')
  const Ctx = React.createContext(null)
  function useStudent() {
    return React.useContext(Ctx)
  }
  exports.StudentCtx = Ctx
  exports.useStudent = useStudent
}

/** @/lib/supabase-browser: every read answers no rows (the Playbook's cards). */
function supabaseStandIn(require, module, exports) {
  window.__reads = []
  function from(table) {
    const b = {
      select() { return b },
      eq() { return b },
      order() { return b },
      then(res, rej) {
        window.__reads.push(table)
        return Promise.resolve({ data: [], error: null }).then(res, rej)
      },
    }
    return b
  }
  exports.createClient = () => ({ from })
  exports.getSharedSession = async () => ({ access_token: 'tok-1' })
}

/** next/navigation: a router that records where it was sent. */
function navigationStandIn(require, module, exports) {
  window.__nav = { replaced: [], pushed: [] }
  const router = {
    replace: (href) => window.__nav.replaced.push(href),
    push: (href) => window.__nav.pushed.push(href),
    prefetch() {},
    back() {},
  }
  exports.useRouter = () => router
  exports.usePathname = () => '/world'
}

/** next/link: a plain link. */
function linkStandIn(require, module, exports) {
  const React = require('react')
  const Link = React.forwardRef(function Link(props, ref) {
    const rest = { ...props }
    for (const k of ['children', 'prefetch', 'scroll', 'replace']) delete rest[k]
    return React.createElement('a', { ...rest, ref }, props.children)
  })
  exports.__esModule = true
  exports.default = Link
}

/** The harness: one host for every screen. */
function harness(require) {
  const React = require('react')
  const { createRoot } = require('react-dom/client')
  const { AuthCtx } = require('@/contexts/AuthContext')
  const { StudentCtx } = require('@/contexts/StudentContext')
  const PlaybookPage = require('@/app/dashboard/playbook/page').default
  const h = React.createElement

  const STUDENT = { id: 's1', name: 'Test Student', membership_status: 'active', first_paid_at: '2026-10-10T00:00:00.000Z', joined_at: '2026-10-10T00:00:00.000Z' }
  let patchStudent = null

  function Host({ student: first, ctx: firstCtx, children }) {
    const [student, setStudent] = React.useState(first)
    const [ctx, setCtx] = React.useState(firstCtx)
    patchStudent = (patch) => setCtx((c) => ({ ...c, ...patch }))
    return h(AuthCtx.Provider, { value: { student, setStudent } }, h(StudentCtx.Provider, { value: ctx }, children))
  }

  let root = null
  window.__h = {
    mount(kind, cfg = {}) {
      window.__nav.replaced.length = 0
      root = createRoot(document.getElementById('root'))
      if (kind === 'playbook') {
        root.render(h(Host, { student: STUDENT, ctx: { playbookWelcomeSeenAt: '2026-10-19T00:00:00.000Z', dismissPlaybookWelcome() {}, ...cfg.student } }, h(PlaybookPage)))
      }
    },
    unmount() {
      root?.unmount()
      root = null
    },
    student(patch) {
      patchStudent(patch)
    },
  }
}

const modules = {
  react: read('node_modules/react/cjs/react.development.js'),
  'react/jsx-runtime': read('node_modules/react/cjs/react-jsx-runtime.development.js'),
  'react-dom': read('node_modules/react-dom/cjs/react-dom.development.js'),
  'react-dom/client': read('node_modules/react-dom/cjs/react-dom-client.development.js'),
  scheduler: read('node_modules/scheduler/cjs/scheduler.development.js'),
  '@/app/dashboard/playbook/page': real('src/app/dashboard/playbook/page.tsx'),
  '@/lib/world/access': real('src/lib/world/access.ts'),
  '@/contexts/AuthContext': inPage(authStandIn),
  '@/contexts/StudentContext': inPage(studentStandIn),
  '@/lib/supabase-browser': inPage(supabaseStandIn),
  'next/navigation': inPage(navigationStandIn),
  'next/link': inPage(linkStandIn),
  '@/components/playbook/PlaybookHub': 'exports.PlaybookHub = function PlaybookHub() { return require("react").createElement("div", { "data-stand-in": "hub" }, "The Playbook\'s cards"); };',
  '@/components/playbook/PlaybookNodeSheet': 'exports.PlaybookNodeSheet = function PlaybookNodeSheet() { return null; };',
  '@/components/playbook/PlaybookWelcomeOverlay': 'exports.PlaybookWelcomeOverlay = function PlaybookWelcomeOverlay() { return null; };',
  harness: inPage(harness),
}
const BUNDLE = `
var process = { env: { NODE_ENV: 'development' } };
const __defs = {}; const __cache = {};
function __req(name) {
  if (__cache[name]) return __cache[name].exports;
  if (!__defs[name]) throw new Error('module not in the bundle: ' + name);
  const module = { exports: {} }; __cache[name] = module;
  __defs[name](__req, module, module.exports);
  return module.exports;
}
${Object.entries(modules).map(([name, src]) => `__defs[${JSON.stringify(name)}] = function (require, module, exports) {\n${src}\n};`).join('\n')}
__req('harness');
`
const PAGE = `<!doctype html><meta charset="utf-8"><title>student screens sim</title><body style="margin:0;background:#16111a;color:#eee;font:14px sans-serif"><div id="root"></div><script src="/bundle.js"></script></body>`

// ── The runner ───────────────────────────────────────────────────────
let pass = 0
const fails = []
function ok(cond, label, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${label}${detail ? `: ${detail}` : ''}`) }
  else { fails.push(label); console.log(` FAIL  ${label}${detail ? `: ${detail}` : ''}`) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const show = (v) => JSON.stringify(v)
const strays = []
const pageErrors = []
let browser = null

/** A fresh page with the bundle loaded and every request answered here. */
async function open() {
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900 })
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    const url = req.url()
    if (url === `${PAGE_ORIGIN}/`) return req.respond({ status: 200, contentType: 'text/html', body: PAGE })
    if (url === `${PAGE_ORIGIN}/bundle.js`) return req.respond({ status: 200, contentType: 'application/javascript', body: BUNDLE })
    if (url.endsWith('/favicon.ico')) return req.respond({ status: 204 })
    strays.push(url)
    return req.abort()
  })
  page.on('pageerror', (e) => pageErrors.push(String(e.message)))
  await page.goto(`${PAGE_ORIGIN}/`, { waitUntil: 'load' })
  const s = {
    page,
    mount: (kind, cfg) => page.evaluate((k, c) => window.__h.mount(k, c), kind, cfg ?? {}),
    unmount: () => page.evaluate(() => window.__h.unmount()),
    /** Waits until `test` (run in the page) is true, looking every 25 ms; gives up after `ms` and says so. */
    until: async (test, ms = 3000) => {
      const end = Date.now() + ms
      for (;;) {
        if (await page.evaluate(test)) return true
        if (Date.now() > end) return false
        await sleep(25)
      }
    },
    /** What the student sees, and where the page sent them. */
    look: () => page.evaluate(() => ({
      text: document.getElementById('root').innerText,
      replaced: [...window.__nav.replaced],
    })),
  }
  return s
}

const sections = [
  {
    id: 'P',
    title: 'The Playbook page while the student\'s data failed to load (T-026)',
    async run() {
      const s = await open()
      await s.mount('playbook', { student: { loading: true, loadError: null, playbookUnlocked: false } })
      await sleep(150)
      let v = await s.look()
      ok(v.replaced.length === 0 && !v.text.includes("didn't load"), 'loading: the spinner, and nobody is sent away', show(v.replaced))
      // The first load failed and its retries with it: no data, so no Playbook either.
      await s.page.evaluate(() => window.__h.student({ loading: false, loadError: 'Could not load your course (HTTP 500).', playbookUnlocked: false }))
      await sleep(150)
      v = await s.look()
      ok(v.replaced.length === 0, 'the load failed: the graduate is not sent back to the map', show(v.replaced))
      const tryAgain = await s.page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Try again')
        return b ? b.getBoundingClientRect().height > 0 : false
      })
      ok(v.text.includes("Your course didn't load.") && tryAgain, 'the page says "Your course didn\'t load." with Try again', show(v.text))
      // A refresh answered later loads everything: the Playbook is theirs.
      await s.page.evaluate(() => window.__h.student({ loadError: null, playbookUnlocked: true }))
      ok(await s.until(() => Boolean(document.querySelector('[data-stand-in=hub]'))), 'once the data arrives the Playbook shows')
      v = await s.look()
      ok(v.replaced.length === 0, '  and nobody was sent away on the way', show(v.replaced))
      await s.unmount()
      // A student it is not open to, whose data loaded: sent back, as before.
      await s.mount('playbook', { student: { loading: false, loadError: null, playbookUnlocked: false } })
      ok(await s.until(() => window.__nav.replaced.length === 1), 'a loaded student without the Playbook is sent back, as before', show((await s.look()).replaced))
      await s.unmount()
      await s.page.close()
    },
  },
]

const dropProfile = () => {
  try {
    fs.rmSync(PROFILE, { recursive: true, force: true })
  } catch {
    // Chrome can still be letting go of a file. The next run starts by removing it.
  }
}
dropProfile()
fs.mkdirSync(PROFILE, { recursive: true })
browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new', userDataDir: PROFILE,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-first-run', '--disable-default-apps', '--disable-sync',
    '--disable-background-networking', '--disable-component-update', '--disable-domain-reliability',
    '--disable-client-side-phishing-detection', '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    // Every DNS lookup fails. The page's requests are answered above before
    // any lookup; anything else has nowhere to go.
    '--host-resolver-rules=MAP * ~NOTFOUND'],
})
try {
  for (const x of sections) {
    console.log(`\n=== ${x.id}. ${x.title} ===`)
    try {
      await x.run()
    } catch (e) {
      ok(false, `${x.id} ran to its end`, String(e?.message ?? e).slice(0, 300))
    }
  }
} finally {
  await browser.close()
  dropProfile()
}
ok(pageErrors.length === 0, 'the page threw nothing', pageErrors.join(' | ').slice(0, 400))
ok(strays.length === 0, 'the page asked for nothing this file did not answer', strays.join(', '))

console.log(`\n${'='.repeat(58)}\n  PASS ${pass}   FAIL ${fails.length}`)
fails.forEach((f) => console.log('  - ' + f))
// Leave once the lines above are written out: Chrome's helper processes can
// hold the pipe puppeteer reads from (lesson-player-sim.mjs measured 24 s).
process.stdout.write('', () => process.exit(fails.length ? 1 : 0))
