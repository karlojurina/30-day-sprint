/**
 * The rebuilt admin pages in a real browser (admin rebuild PRD, work item 5):
 * the top bar, the two sign-in pages, Today and the 30% page, in every state,
 * at a phone's width and two desktop widths.
 *
 *   node world-tests/admin-pages.mjs [--only routes,frame,signin,today,thirty]
 *
 * Opens BASE_URL (default http://localhost:3226): a development server
 * started for the run in the app root, `PORT=3226 npx next dev`. This script
 * never starts one. The dev pages need nothing from .env.local; the
 * set-password form needs a server with no Supabase settings (see signin).
 *
 *   routes  client-tests/build.mjs, then the route suite
 *           (client-tests/admin-today-routes.test.mjs) as npm run test:client
 *           runs it, with ADMIN_ROUTE_ERRORS_OUT set: it must pass, and every
 *           error sentence a route answered there is held to the words below
 *   frame   /dev/admin/frame for a founder, a csm and an admin, over a light
 *           and a dark page: the bar's entries for each role and the marked
 *           one; under 1100px the Menu with every entry; above it More, and
 *           Escape closing both
 *   signin  /admin/login, and its refusal (Supabase's answer given here);
 *           /admin/set-password with no invite; and, when the server has no
 *           Supabase settings, its form with a made-up invite and its own
 *           check of the two passwords (NOT COVERED otherwise, with why)
 *   today   /dev/admin/today full, empty, loading and error, then its paths
 *           by clicks: the reasons and their order, chips, plans, search,
 *           Mark messaged and Undo, Not needed and its reason, Handled;
 *           a phone's first screen (the first row whole, the chips one
 *           sideways row, Refresh beside the title), every tap 44px, the
 *           focus ring, a mark low on the page with its notice in the
 *           window, one mark at a time on a row
 *   thirty  /dev/admin/discounts: every tab full and empty, partial,
 *           novideos, loading and error, then its paths by clicks: the
 *           verdict beside Approve, Approve anyway, Reject, a 409 on approve
 *           (the code to delete pinned in the window, copyable) and on
 *           reject, a failed reload (its own line, the decided row's buttons
 *           off), Mark code added, Mark messaged (closing the student's open
 *           queue task, with Undo), ?student=; the tabs whole on a phone,
 *           To decide oldest first, every tap 44px
 *
 * Every state at 390x844, 1280x720 and 1440x900 (a few click states at one
 * or two of them), and each one is measured. It fails on: a horizontal
 * scroll, or anything past the window's right edge outside a scroll box;
 * any text under 4.5:1 against the colours really under it (text on a
 * disabled control excepted); an em dash, "unlock" or "EcomTalent" in the
 * rendered text, a placeholder, an aria-label, a title or the page's title.
 * Requests to any other host are stopped in the browser and counted, and the
 * count must be 0 (the sign-in pages' calls to Supabase, and the Vercel
 * Analytics script the root layout loads from Vercel's host in development,
 * are answered here, so nothing leaves the machine). The browser console must
 * hold no error and the page no uncaught exception.
 *
 * One ok or FAIL line per check, then PASS / FAIL / NOT COVERED. Exit code 1
 * on any FAIL. Screenshots in world-tests/shots/admin/ (git ignores shots/).
 * Made-up people only: the dev pages' fixtures are src/app/dev/admin/fixtures.ts.
 * About 4 minutes.
 *
 * Needs `npm install` once in world-tests/ (puppeteer-core) and Google Chrome
 * at its default macOS path (CHROME overrides it).
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ORIGIN = (process.env.BASE_URL || 'http://localhost:3226').replace(/\/$/, '')
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const OUT = fileURLToPath(new URL('./shots/admin/', import.meta.url))
const SIZES = [[390, 844], [1280, 720], [1440, 900]]
/** Words the team never reads (the PRD's rule for every sentence a page shows). */
const BANNED = [/\u2014/, /\bunlock/i, /ecomtalent/i]
const BANNED_NAMES = ['an em dash', '"unlock"', '"EcomTalent"']
const onlyAt = process.argv.indexOf('--only')
const ONLY = onlyAt > 0 ? new Set((process.argv[onlyAt + 1] || '').split(',')) : null
const wanted = (part) => !ONLY || ONLY.has(part)

let passed = 0
let failed = 0
let notCovered = 0
const failures = []
const expect = (c, label, detail = '') => {
  if (c) { passed++; console.log(`  ok   ${label}`) }
  else { failed++; failures.push(label); console.log(`  FAIL ${label}${detail ? ` (${detail})` : ''}`) }
}
const gap = (label, why) => { notCovered++; console.log(`  NOT COVERED ${label}: ${why}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const banned = (text) => BANNED.map((re, i) => (re.test(text) ? BANNED_NAMES[i] : null)).filter(Boolean)

// ════════════════════════════════════════════════════════════════════════════
// routes: every error sentence the route suite gets back
// ════════════════════════════════════════════════════════════════════════════
if (wanted('routes')) {
  console.log('\nroutes: the route suite, and every error sentence a route answered in it')
  const build = spawnSync(process.execPath, ['client-tests/build.mjs'], { cwd: ROOT, encoding: 'utf8' })
  expect(build.status === 0, 'client-tests/build.mjs copies the routes and their libraries', `${build.stderr}`.slice(-300))
  const file = path.join(os.tmpdir(), `admin-route-errors-${process.pid}.json`)
  fs.rmSync(file, { force: true })
  const run = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', 'client-tests/admin-today-routes.test.mjs'], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ADMIN_ROUTE_ERRORS_OUT: file },
  })
  const summary = (`${run.stdout}`.match(/PASS \d+\s+FAIL \d+/) || ['no summary line'])[0].replace(/\s+/g, ' ')
  expect(run.status === 0, `client-tests/admin-today-routes.test.mjs passes: ${summary}`,
    `${run.stdout}`.split('\n').filter((l) => l.startsWith(' FAIL')).slice(0, 3).join(' | ') || `${run.stderr}`.slice(-300))
  let sentences = null
  try { sentences = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { sentences = null }
  fs.rmSync(file, { force: true })
  const list = Array.isArray(sentences) ? sentences : []
  const distinct = [...new Set(list.map((s) => (typeof s === 'string' ? s : JSON.stringify(s))))]
  expect(list.length >= 5, `it hands back every error sentence the routes answered: ${list.length}, ${distinct.length} different`)
  const bad = distinct.filter((s) => typeof s !== 'string' || !s.trim() || banned(s).length > 0)
  expect(bad.length === 0, 'none of them is empty or holds an em dash, "unlock" or "EcomTalent"', bad.slice(0, 3).join(' | '))
  for (const s of distinct.slice(0, 40)) console.log(`       "${s}"`)
}

const needBrowser = ['frame', 'signin', 'today', 'thirty'].some(wanted)
if (!needBrowser) finish()

fs.mkdirSync(OUT, { recursive: true })
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-pages-chrome-'))
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  userDataDir,
  args: ['--hide-scrollbars', '--no-first-run', '--no-default-browser-check'],
})
const page = await browser.newPage()

// Nothing leaves the machine: a request to another host is stopped here, or
// answered here when a part asks for it (the sign-in pages' Supabase calls).
// The root layout's Vercel Analytics (<Analytics /> in src/app/layout.tsx)
// fetches its script from Vercel's host in development: it is answered here
// with an empty script, so it neither leaves nor logs a failed load.
const offMachine = []
let analyticsHere = 0
let answerHere = null
await page.setRequestInterception(true)
page.on('request', (req) => {
  const u = req.url()
  if (answerHere && answerHere(req)) return
  if (u.startsWith(ORIGIN) || u.startsWith('data:') || u.startsWith('blob:')) return req.continue()
  if (new URL(u).hostname === 'va.vercel-scripts.com') {
    analyticsHere++
    return req.respond({ status: 200, contentType: 'application/javascript', body: '' })
  }
  offMachine.push(u.split('?')[0])
  return req.abort()
})
const consoleErrors = []
const pageErrors = []
// Each with the address that logged it, so a part can allow exactly its own deliberate answers.
page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(`${msg.text()} [${msg.location()?.url ?? ''}]`) })
page.on('pageerror', (e) => pageErrors.push(String(e)))
const NOISE = /Download the React DevTools|favicon|\[HMR\]|\[Fast Refresh\]/i
/** The console errors since `from`, the expected ones of the part left out. */
const newConsoleErrors = (from, allowed = []) => consoleErrors.slice(from).filter((e) => !NOISE.test(e) && !allowed.some((re) => re.test(e)))

// Runs in the page: every visible text run, its colour composited over the
// backgrounds really under it, its contrast; the page's sideways overflow;
// and every word the page shows or announces.
function measure() {
  const parse = (s) => {
    const m = s.match(/rgba?\(([^)]+)\)/)
    if (!m) return null
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number)
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }
  }
  const over = (top, under) => {
    const a = top.a + under.a * (1 - top.a)
    if (a === 0) return { r: 0, g: 0, b: 0, a: 0 }
    const mix = (k) => (top[k] * top.a + under[k] * under.a * (1 - top.a)) / a
    return { r: mix('r'), g: mix('g'), b: mix('b'), a }
  }
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
  const bgUnder = (el) => {
    const layers = []
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor)
      if (c && c.a > 0) layers.push(c)
      if (c && c.a >= 1) break
    }
    let acc = { r: 255, g: 255, b: 255, a: 1 }
    const html = parse(getComputedStyle(document.documentElement).backgroundColor)
    if (html && html.a > 0) acc = over(html, acc)
    for (let i = layers.length - 1; i >= 0; i--) acc = over(layers[i], acc)
    return acc
  }
  const disabled = (el) => !!el.closest(':disabled, [aria-disabled="true"]')
  const texts = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    const text = t.textContent.replace(/\s+/g, ' ').trim()
    if (!text) continue
    const el = t.parentElement
    if (!el || el.closest('script, style, noscript, .sr-only')) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none') continue
    const rects = el.getClientRects()
    if (!rects.length || [...rects].every((r) => r.width === 0 || r.height === 0)) continue
    let hidden = false
    for (let n = el; n; n = n.parentElement) {
      const s = getComputedStyle(n)
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) { hidden = true; break }
    }
    if (hidden) continue
    // Text inside a closed <details> is not drawn.
    const det = el.closest('details')
    if (det && !det.open && !el.closest('summary')) continue
    const fg = parse(cs.color)
    const bg = bgUnder(el)
    let op = 1
    for (let n = el; n; n = n.parentElement) op *= Number(getComputedStyle(n).opacity)
    const fgOn = over({ ...fg, a: fg.a * op }, bg)
    texts.push({ text: text.slice(0, 70), ratio: Math.round(ratio(fgOn, bg) * 100) / 100, disabled: disabled(el) })
  }
  const doc = document.scrollingElement
  // Anything sticking out past the window's right edge, scroll boxes aside.
  const past = [...document.querySelectorAll('body *')].filter((e) => {
    const r = e.getBoundingClientRect()
    if (r.width === 0 || r.height === 0 || r.right <= window.innerWidth + 0.5) return false
    for (let n = e.parentElement; n; n = n.parentElement) {
      const ox = getComputedStyle(n).overflowX
      if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return false
    }
    return true
  }).map((e) => `${e.tagName.toLowerCase()}: ${e.textContent.trim().slice(0, 40)}`)
  const announced = [...document.querySelectorAll('[placeholder], [aria-label], [title], [alt]')]
    .flatMap((e) => ['placeholder', 'aria-label', 'title', 'alt'].map((a) => e.getAttribute(a)).filter(Boolean))
  return {
    texts,
    overflowX: doc.scrollWidth - doc.clientWidth,
    past,
    words: [document.title, document.body.innerText, ...announced].join('\n'),
  }
}

/** Measures the page as it stands and saves a screenshot named `shot` (none when null). */
async function check(label, shot) {
  const m = await page.evaluate(measure)
  expect(m.overflowX <= 0 && m.past.length === 0, `${label}: no horizontal scroll, nothing past the right edge`,
    `${m.overflowX}px; ${m.past.slice(0, 3).join('; ')}`)
  const readable = m.texts.filter((t) => !t.disabled)
  const off = m.texts.filter((t) => t.disabled)
  const low = readable.filter((t) => t.ratio < 4.5)
  const min = (xs) => (xs.length ? Math.min(...xs.map((t) => t.ratio)).toFixed(2) : '-')
  expect(low.length === 0, `${label}: ${readable.length} text runs at 4.5:1 or more, lowest ${min(readable)}:1 (${off.length} on disabled controls, lowest ${min(off)}:1)`,
    low.slice(0, 4).map((t) => `"${t.text}" ${t.ratio}`).join('; '))
  const found = banned(m.words)
  expect(found.length === 0, `${label}: no em dash, "unlock" or "EcomTalent" in what it shows or announces`, found.join(', '))
  if (shot) await page.screenshot({ path: path.join(OUT, `${shot}.png`), fullPage: true })
  return m
}

const viewport = ([w, h]) => page.setViewport({ width: w, height: h, deviceScaleFactor: 1 })
async function go(route, size = [1280, 720]) {
  await viewport(size)
  await page.goto(`${ORIGIN}${route}`, { waitUntil: 'networkidle0', timeout: 180000 })
}
const bodyText = () => page.evaluate(() => document.body.innerText)
const calls = () => page.evaluate(() => (window.__adminCalls ?? []).map((c) => ({ name: c.name, args: c.args })))
const isNull = (h) => h.evaluate((x) => x === null)
const buttonIn = (handle, label) => handle.evaluateHandle((r, l) => (r && [...r.querySelectorAll('button')].find((b) => b.textContent.trim() === l)) || null, label)
const button = (label) => page.evaluateHandle((l) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === l) || null, label)
/** A real click, the target scrolled to the middle first: the sticky top bar covers the top of the window. */
async function press(handle) {
  await handle.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await handle.click()
}
/** The header says "Updating" while the page reads its list again: wait until it is done. */
const settled = () => page.waitForFunction(() => !document.body.innerText.includes('· Updating'), { timeout: 10000 })
const openAllDetails = () => page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true }))
/**
 * Buttons, chips and tabs, and the links and labels drawn as buttons, on the
 * page under the bar, that are under 44px tall (the kit's touch target). The
 * dev pages render the bar inside <main>; its header (the one with the
 * lockup) is the frame's, and left out here.
 */
const smallTaps = () => page.evaluate(() => [...document.querySelectorAll('main button, main a, main label')]
  .filter((e) => !e.closest('header')?.querySelector('img'))
  .filter((e) => e.tagName === 'BUTTON' || e.textContent.trim() === 'Open in Discord' || e.querySelector('input[type="checkbox"]'))
  .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 })
  .map((e) => ({ text: e.textContent.trim().slice(0, 30), h: Math.round(e.getBoundingClientRect().height) }))
  .filter((x) => x.h < 44))

// ════════════════════════════════════════════════════════════════════════════
// frame: the top bar for each role, over a light page and a dark one
// ════════════════════════════════════════════════════════════════════════════
if (wanted('frame')) {
  const from = consoleErrors.length
  const ENTRIES = {
    founder: ['Today', '30% off', 'Tasks', 'All students', 'Student journey', 'Dashboard', 'Insights', 'Brand Owners', 'Templates', 'Lesson feedback', 'Survey', 'Stats', 'Settings', 'Discord test', 'Team'],
    csm: ['Today', '30% off', 'Tasks', 'All students', 'Student journey', 'Dashboard', 'Insights', 'Brand Owners', 'Templates'],
    admin: ['Today', '30% off', 'Tasks', 'All students', 'Student journey', 'Dashboard', 'Insights', 'Brand Owners', 'Templates', 'Lesson feedback', 'Survey', 'Settings', 'Discord test'],
  }
  const visibleLabels = (selector) => page.$$eval(selector, (els) => els
    .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' })
    .map((e) => e.textContent.replace(/\s+/g, ' ').trim()))
  for (const role of ['founder', 'csm', 'admin']) {
    for (const ground of ['light', 'dark']) {
      for (const size of SIZES) {
        const [w, h] = size
        const label = `frame, ${role}, ${ground} page, ${w}x${h}`
        console.log(`\n${label}`)
        await go(`/dev/admin/frame?role=${role}&ground=${ground}`, size)
        await page.waitForSelector(`[data-frame-role="${role}"][data-frame-ground="${ground}"]`)
        await check(label, `frame-${role}-${ground}-${w}`)
        if (w < 1100) {
          const menu = await page.$('header button[aria-controls]')
          const shown = menu && (await menu.evaluate((b) => getComputedStyle(b).display !== 'none' && b.textContent.includes('Menu')))
          expect(!!shown, `${label}: one Menu button`)
          const navs = await page.$$eval('header nav', (ns) => ns.filter((n) => getComputedStyle(n).display !== 'none').length)
          expect(navs === 0, `${label}: no entries in the bar until the Menu opens`)
          if (!shown) continue
          await menu.click()
          await page.waitForSelector('header [id] nav')
          const rows = await visibleLabels('header [id] nav a')
          expect(JSON.stringify(rows) === JSON.stringify(ENTRIES[role]), `${label}: the Menu lists every entry a ${role} may open, in order (${rows.length})`, JSON.stringify(rows))
          expect((await menu.evaluate((b) => b.getAttribute('aria-expanded'))) === 'true', `${label}: aria-expanded is true while it is open`)
          await check(`${label}, Menu open`, `frame-${role}-${ground}-${w}-menu`)
          // A founder's list is taller than a phone: the panel scrolls inside itself.
          const unreachable = await page.evaluate(() => [...document.querySelectorAll('header [id] nav a')].filter((a) => {
            a.scrollIntoView({ block: 'nearest' })
            const r = a.getBoundingClientRect()
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
            return !(r.top >= 0 && r.bottom <= innerHeight && (hit === a || a.contains(hit)))
          }).map((a) => a.textContent.trim()))
          expect(unreachable.length === 0, `${label}: every Menu entry can be scrolled to and is what a tap on it lands on`, unreachable.join(', '))
          await page.keyboard.press('Escape')
          expect((await page.$('header [id] nav')) === null, `${label}: Escape closes the Menu`)
        } else {
          const menuShown = await page.$eval('header button[aria-controls]', (b) => getComputedStyle(b).display !== 'none')
          expect(!menuShown, `${label}: no Menu button on a wide window`)
          const top = await visibleLabels('header nav[aria-label="Admin"] > a, header nav[aria-label="Admin"] > div > button')
          expect(JSON.stringify(top) === JSON.stringify(['Today', '30% off', 'Tasks', 'Students', 'Dashboard', 'More']),
            `${label}: the bar reads Today · 30% off · Tasks · Students · Dashboard · More`, JSON.stringify(top))
          const active = await page.$$eval('header nav [data-active]', (els) => els.map((e) => e.textContent.trim()))
          const wantActive = ground === 'dark' ? ['Today'] : ['Tasks']
          expect(JSON.stringify(active) === JSON.stringify(wantActive), `${label}: ${wantActive[0]} is marked as the page it sits over`, JSON.stringify(active))
          const outside = await page.evaluate(() => {
            const header = document.querySelector('header')
            return [...header.querySelectorAll(':scope > div > *')]
              .filter((e) => getComputedStyle(e).display !== 'none')
              .map((e) => e.getBoundingClientRect())
              .filter((r) => r.right > window.innerWidth || r.left < 0).length
          })
          expect(outside === 0, `${label}: the lockup, every entry and the profile fit inside the window`)
          const buttons = await page.$$('header nav[aria-label="Admin"] > div > button')
          await buttons[buttons.length - 1].click()
          await page.waitForSelector('header [role="menu"]')
          const items = await visibleLabels('header [role="menu"] a')
          expect(JSON.stringify(items) === JSON.stringify(ENTRIES[role].slice(6)), `${label}: More lists ${items.join(', ')}`, JSON.stringify(items))
          await check(`${label}, More open`, `frame-${role}-${ground}-${w}-more`)
          await page.keyboard.press('Escape')
          expect((await page.$('header [role="menu"]')) === null, `${label}: Escape closes More`)
        }
      }
    }
  }
  const errs = newConsoleErrors(from)
  expect(errs.length === 0, 'frame: no error in the browser console', errs.slice(0, 3).join(' || '))
}

// ════════════════════════════════════════════════════════════════════════════
// signin: /admin/login and /admin/set-password
// ════════════════════════════════════════════════════════════════════════════
if (wanted('signin')) {
  const from = consoleErrors.length
  const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
  // The browser client's project, read from the host it calls (never printed).
  let supabaseHost = null
  for (const size of SIZES) {
    const [w, h] = size
    const label = `/admin/login, ${w}x${h}`
    console.log(`\n${label}`)
    await go('/admin/login', size)
    await page.waitForSelector('form')
    await sleep(300)
    await check(label, `login-${w}`)
    expect((await page.$('button[type="submit"]')) !== null && (await bodyText()).includes('Ecom University'), `${label}: the form, its one button, and "Ecom University"`)
  }
  // Supabase's refusal of a wrong password, answered here.
  answerHere = (req) => {
    const u = new URL(req.url())
    if (!u.pathname.endsWith('/auth/v1/token')) return false
    supabaseHost = u.hostname
    if (req.method() === 'OPTIONS') { req.respond({ status: 204, headers: CORS }); return true }
    req.respond({ status: 400, headers: CORS, contentType: 'application/json',
      body: JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid login credentials' }) })
    return true
  }
  for (const size of SIZES) {
    const [w, h] = size
    const label = `/admin/login refusing a wrong password, ${w}x${h}`
    console.log(`\n${label}`)
    await go('/admin/login', size)
    await page.waitForSelector('#email')
    await page.type('#email', 'someone@example.com')
    await page.type('#password', 'not-a-real-password')
    await page.click('button[type="submit"]')
    await page.waitForSelector('[role="alert"]', { timeout: 15000 })
    const alert = await page.$eval('[role="alert"]', (e) => e.textContent)
    expect(alert === 'Invalid email or password', `${label}: "${alert}"`)
    await check(label, `login-refused-${w}`)
  }
  answerHere = null
  for (const size of SIZES) {
    const [w, h] = size
    const label = `/admin/set-password with no invite, ${w}x${h}`
    console.log(`\n${label}`)
    await go('/admin/set-password', size)
    await page.waitForFunction(() => document.body.innerText.includes('This invite link has expired'), { timeout: 20000 })
    await sleep(300)
    const links = await page.$$eval('a[href="/admin/login"]', (as) => as.map((a) => a.textContent.trim()))
    expect(links.length === 1 && (await bodyText()).includes('This invite link has expired'), `${label}: the expired card, with one link to sign in`, JSON.stringify(links))
    await check(label, `set-password-no-invite-${w}`)
  }
  // The form needs an invite's session: a made-up one, unexpired, in the
  // cookie the browser client reads. Its name follows the project, so this
  // runs only on a server with no Supabase settings (the placeholder project).
  if (supabaseHost === 'placeholder.supabase.co') {
    const b64u = (s) => Buffer.from(s).toString('base64url')
    const now = Math.floor(Date.now() / 1000)
    const user = { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'new.member@example.com' }
    const jwt = [b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' })), b64u(JSON.stringify({ sub: user.id, email: user.email, exp: now + 3600, role: 'authenticated', aud: 'authenticated' })), b64u('not-a-signature')].join('.')
    const session = { access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'made-up-refresh-token',
      user: { ...user, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } }
    answerHere = (req) => {
      const u = new URL(req.url())
      if (u.hostname.endsWith('.supabase.co')) { req.respond({ status: 503, headers: CORS, body: '' }); return true }
      if (u.pathname === '/api/auth/me') { req.respond({ status: 401, contentType: 'application/json', body: '{"error":"Not a team member"}' }); return true }
      return false
    }
    const cookieUrl = new URL(ORIGIN)
    await page.setCookie({ name: 'sb-placeholder-auth-token', value: `base64-${b64u(JSON.stringify(session))}`, domain: cookieUrl.hostname, path: '/' })
    for (const size of SIZES) {
      const [w, h] = size
      const label = `/admin/set-password with an invite, ${w}x${h}`
      console.log(`\n${label}`)
      await go('/admin/set-password', size)
      await page.waitForSelector('form', { timeout: 20000 })
      const btn = await page.$eval('button[type="submit"]', (b) => ({ text: b.textContent.trim(), h: b.getBoundingClientRect().height }))
      expect(btn.text === 'Set password and continue' && btn.h >= 44, `${label}: the form and its one button, "${btn.text}", ${btn.h}px tall`)
      await check(label, `set-password-form-${w}`)
    }
    for (const size of SIZES) {
      const [w, h] = size
      const label = `/admin/set-password, passwords that differ, ${w}x${h}`
      console.log(`\n${label}`)
      await go('/admin/set-password', size)
      await page.waitForSelector('form', { timeout: 20000 })
      await page.type('#password', 'abcdefgh1')
      await page.type('#confirm', 'abcdefgh2')
      await page.click('button[type="submit"]')
      await page.waitForSelector('[role="alert"]')
      const alert = await page.$eval('[role="alert"]', (e) => e.textContent)
      expect(alert === "Passwords don't match.", `${label}: "${alert}"`)
      await check(label, `set-password-mismatch-${w}`)
    }
    await page.deleteCookie({ name: 'sb-placeholder-auth-token', domain: cookieUrl.hostname, path: '/' })
    answerHere = null
  } else if (supabaseHost) {
    gap('/admin/set-password with an invite', "this server has Supabase settings, and the made-up invite's cookie is named for the placeholder project; run it on a server started with no .env.local")
  } else {
    gap('/admin/set-password with an invite', 'the login page never called Supabase, so its project is unknown')
  }
  // The answers given here log in the console: the refusal's 400 from Supabase,
  // and the 401 for the made-up invite's /api/auth/me. Nothing else may.
  const errs = newConsoleErrors(from, [/status of 400 .*\/auth\/v1\/token/, /status of 401 .*\/api\/auth\/me\]$/])
  expect(errs.length === 0, "signin: no error in the browser console but the answers given here (the refusal's 400, the made-up invite's 401)",
    errs.slice(0, 3).join(' || '))
}

// ════════════════════════════════════════════════════════════════════════════
// today: /dev/admin/today
// ════════════════════════════════════════════════════════════════════════════
if (wanted('today')) {
  const from = consoleErrors.length
  const open = (query, size) => go(`/dev/admin/today${query}`, size)
  const waitReady = () => page.waitForFunction(() => document.body.innerText.includes('to message'), { timeout: 30000 })
  const row = (name) => page.evaluateHandle((n) => [...document.querySelectorAll('.list-row')].find((r) => r.querySelector('a')?.textContent === n) ?? null, name)
  const hero = () => page.evaluate(() => {
    const label = [...document.querySelectorAll('span')].find((s) => /^students? to message$/.test(s.textContent.trim()))
    return label ? Number(label.previousElementSibling?.textContent) : null
  })
  const mainNames = () => page.evaluate(() => {
    const details = [...document.querySelectorAll('details')]
    return [...document.querySelectorAll('.list-row')].filter((r) => !details.some((d) => d.contains(r))).map((r) => r.querySelector('a')?.textContent)
  })

  for (const size of SIZES) {
    const [w, h] = size
    {
      const label = `Today, full, ${w}x${h}`
      console.log(`\n${label}`)
      await open('', size)
      await waitReady()
      await check(label, `today-full-${w}`)
      await openAllDetails()
      await check(`${label}, folded groups and messages open`, `today-full-open-${w}`)
    }
    {
      const label = `Today, empty, ${w}x${h}`
      console.log(`\n${label}`)
      await open('?state=empty', size)
      await waitReady()
      expect((await bodyText()).includes('Nobody needs a message right now.') && (await hero()) === 0, `${label}: "Nobody needs a message right now.", and the number is 0`)
      await openAllDetails()
      await check(label, `today-empty-${w}`)
    }
    {
      const label = `Today, loading, ${w}x${h}`
      console.log(`\n${label}`)
      await open('?state=loading', size)
      await page.waitForSelector('.animate-pulse')
      expect((await page.$('.animate-spin')) === null, `${label}: skeleton rows, no spinner`)
      await check(label, `today-loading-${w}`)
    }
    {
      const label = `Today, error, ${w}x${h}`
      console.log(`\n${label}`)
      await open('?state=error', size)
      await page.waitForSelector('[role="alert"]')
      const t = await page.$eval('[role="alert"]', (e) => e.textContent)
      expect(t.includes("Couldn't load Today's list.") && t.includes("Couldn't read everything Today needs") && t.includes('Retry'),
        `${label}: the error sentence, the route's own words and Retry`, t)
      await check(label, `today-error-${w}`)
    }
  }

  console.log('\nToday: the list, as C3 to C8 and C12 to C14 put it')
  {
    await open('')
    await waitReady()
    const names = await mainNames()
    expect(JSON.stringify(names) === JSON.stringify(['Mara Quinn', 'Owen Pratt', 'Lina Sorensen', 'Ravi Menon', 'Hugo Brandt', 'Nadia Kerr', 'Tom Ashby', 'Grace Liu', 'Maximiliana Featherstonehaugh-Wolstenholme', 'Felix Ward']),
      'the most urgent reason first, the longest wait first; exempt, canceled, high churn, heartbeat, handled and other-plan members left out', names.join(', '))
    expect((await hero()) === 10, 'the number: 10 students to message (the folded group and other plans outside it)', String(await hero()))
    const body = await bodyText()
    for (const s of ['Clicked cancel 2 days ago', 'Payment failed', '30% closes Thu 29 Oct, 10:00: 9 videos left (about',
      'Can apply for the 30% now, until Tue 3 Nov, 10:00', 'No lesson for 8 days', 'Stalled', 'No lesson for 5 days', 'Slipping',
      'No lesson on the new course yet (course day 9)', 'Paid 5 days ago, never opened the app', 'Joined yesterday: send the welcome message']) {
      expect(body.includes(s), `C4's words: "${s}"`)
    }
    // Grace paid Thu 22 Oct at 11:00 in Croatia, 5 days and 23 hours before the page's clock: 5 whole days, not 6.
    expect(!body.includes('Paid 6 days ago'), 'Never opened says the whole days that have passed, as the queue\'s own task does ("Paid 5 days ago")')
    const tom = await row('Tom Ashby')
    expect(await tom.evaluate((r) => r.textContent.includes('Also open in the Tasks queue since Mon 26 Oct. Marking this row closes it too.')
      && !r.textContent.includes('(Day 7)')),
      "a computed headline over an open queue task: the task's line says since when, without its old summary and its other day count")
    const mara = await row('Mara Quinn')
    expect(await mara.evaluate((r) => r.textContent.includes('Clicked cancel 2 days ago') && [...r.querySelectorAll('li')].some((li) => li.textContent === 'Payment failed')),
      'two reasons on one student: the cancel as the headline, Payment failed as a chip')
    expect(await mara.evaluate((r) => !!r.querySelector('a[href="https://discord.com/users/100000000000000201"]') && r.textContent.includes('Open in Discord')), 'C7: Open in Discord with the id')
    expect(await mara.evaluate((r) => r.textContent.includes('Messaged Sat 24 Oct by Jamie, no reply')), 'C12: the last message, by whom, and the reply')
    expect(await mara.evaluate((r) => r.textContent.includes('Course day 9') && r.textContent.includes('14 of 140 lessons') && r.textContent.includes('In Ad basics')
      && r.textContent.includes('Last lesson Tue 27 Oct') && r.textContent.includes('Paid Sat 12 Sep')), 'C8: the course day, the lessons, the area, the last lesson, the first payment')
    expect(await mara.evaluate((r) => r.textContent.includes('Message for this reason') && [...r.querySelectorAll('button')].some((b) => b.textContent === 'Copy message')),
      "C6: the reason's own message, with Copy message")
    const grace = await row('Grace Liu')
    expect(await grace.evaluate((r) => r.textContent.includes('Copy @grace.liu') && r.textContent.includes('Whop progress not pulled yet')
      && r.textContent.includes('Message from the Tasks queue') && r.textContent.includes('Marking this row closes it too')),
      "Grace: Copy @name, the C14 chip, the open task's message, and that marking closes it")
    expect(await grace.evaluate((r) => r.textContent.includes('30%: 0 of 61 videos, deadline Thu 5 Nov')), 'the 30% where no 30% reason says it')
    expect(await (await row('Felix Ward')).evaluate((r) => r.textContent.includes('The message still has {bookingLink} in it.')), 'a variable that could not be filled in is named')
    expect(await (await row('Nadia Kerr')).evaluate((r) => r.textContent.includes('No saved message for this reason yet. Write your own.') && ![...r.querySelectorAll('button')].some((b) => b.textContent === 'Copy message')),
      'no message for the reason: nothing to copy (C6)')
    expect(await (await row('Maximiliana Featherstonehaugh-Wolstenholme')).evaluate((r) => r.textContent.includes('No Discord linked') || r.textContent.includes('Copy @maximiliana.featherstonehaugh')),
      'C7 on the longest name')
    expect(body.includes('Whop progress not pulled yet (2)') && body.includes('Handled in the last 7 days ('), 'the folded group and Handled, both folded')
    expect(body.includes('1 student on another plan is hidden. Choose All plans to see them.'), 'other plans hidden, and said so')
    await openAllDetails()
    const opened = await bodyText()
    expect(opened.includes('Their Whop progress has not been copied into the app since the course switch, so lessons they watched on Whop do not count yet.'),
      'the folded group says why in plain words')
    expect(!opened.includes('Payment failed: Payment failed') && !opened.includes('Stopped: No lesson') && !/From the Tasks queue \(/.test(opened),
      'Handled names each reason once, and a queue task without words by where it came from only')
  }

  console.log('\nToday: a phone\'s first screen, taps, focus')
  {
    await open('', [390, 844])
    await waitReady()
    const first = await page.evaluate(() => {
      const r = document.querySelector('.list-row').getBoundingClientRect()
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: innerHeight }
    })
    expect(first.bottom <= first.height, `390x844: the first student's whole row is on the first screen (it ends at ${first.bottom}px of ${first.height})`, JSON.stringify(first))
    const chips = await page.$eval('[aria-label="Reasons"]', (g) => ({ h: Math.round(g.getBoundingClientRect().height), ox: getComputedStyle(g).overflowX }))
    expect(chips.h <= 48 && chips.ox === 'auto', '390x844: the reason chips are one row that scrolls sideways in its own box', JSON.stringify(chips))
    const refresh = await page.evaluate(() => {
      const h1 = document.querySelector('h1').getBoundingClientRect()
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Refresh').getBoundingClientRect()
      return Math.abs((h1.top + h1.bottom) / 2 - (b.top + b.bottom) / 2) < 12
    })
    expect(refresh, '390x844: Refresh sits beside the title, not on a line of its own')
    for (const size of SIZES) {
      await viewport(size)
      await sleep(150)
      const small = await smallTaps()
      expect(small.length === 0, `Today, ${size.join('x')}: every button, chip and link styled as one is 44px tall or more`, JSON.stringify(small.slice(0, 4)))
    }
    await viewport([1280, 720])
    const meta = await page.evaluate(() => {
      const p = [...document.querySelectorAll('header p')].find((x) => x.textContent.startsWith('Updated'))
      return p ? getComputedStyle(p).fontSize : null
    })
    expect(meta === '12px', '"Updated 09:30" is 12px, the kit\'s floor for text that is not an eyebrow', String(meta))
    await page.$eval('input[type="search"]', (i) => i.focus())
    await page.keyboard.press('Tab')
    const ring = await page.evaluate(() => {
      const a = document.activeElement
      const cs = getComputedStyle(a)
      return { tag: a.tagName, color: cs.outlineColor, width: cs.outlineWidth, offset: cs.outlineOffset, scheme: getComputedStyle(a).colorScheme }
    })
    expect(ring.color === 'rgb(247, 246, 243)' && ring.width === '2px' && ring.offset === '2px' && ring.scheme === 'dark',
      'keyboard focus is the kit\'s 2px Stalactite ring, 2px off, and the browser draws its controls in its dark scheme', JSON.stringify(ring))
  }

  console.log('\nToday: a mark low on the page, its notice in view')
  {
    for (const size of [[1440, 900], [390, 844]]) {
      await open('', size)
      await waitReady()
      await press(await buttonIn(await row('Nadia Kerr'), 'Mark messaged'))
      await page.waitForFunction(() => document.body.innerText.includes('Marked Nadia Kerr as messaged.'), { timeout: 10000 })
      await settled()
      const n = await page.evaluate(() => {
        const el = [...document.querySelectorAll('[role="status"]')].find((x) => x.textContent.includes('Marked Nadia Kerr as messaged.'))
        const r = el.getBoundingClientRect()
        return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: innerHeight, scrollY: Math.round(scrollY), undo: [...el.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Undo') }
      })
      expect(n.scrollY > 0 && n.top >= 0 && n.bottom <= n.height && n.undo,
        `${size.join('x')}: Mark messaged on the 6th row: the notice and its Undo are in the window, where the click was (scrolled ${n.scrollY}px)`, JSON.stringify(n))
      await check(`Today, a mark low on the page, ${size.join('x')}`, `today-mark-low-${size[0]}`)
    }
  }

  console.log('\nToday: Not needed cannot be saved while Mark messaged is on its way')
  {
    await open('')
    await waitReady()
    await press(await buttonIn(await row('Hugo Brandt'), 'Not needed'))
    await page.waitForSelector('input[placeholder^="For example"]')
    await page.type('input[placeholder^="For example"]', 'He is on holiday until Monday.')
    const hugo = await row('Hugo Brandt')
    await press(await buttonIn(hugo, 'Mark messaged'))
    const saveOff = await (await buttonIn(hugo, 'Save as not needed')).evaluate((b) => b.disabled)
    await page.waitForFunction(() => document.body.innerText.includes('Marked Hugo Brandt as messaged.'), { timeout: 10000 })
    await settled()
    expect(saveOff && (await calls()).filter((x) => x.name === 'mark').length === 1,
      'one mark at a time: with Mark messaged on its way, Save as not needed is off, and only one call is made')
  }

  console.log('\nToday: chips, plans, search')
  {
    await open('')
    await waitReady()
    await press(await button('All plans'))
    await sleep(150)
    expect((await hero()) === 11 && (await mainNames()).includes('Leo Park'), 'All plans adds Leo, on another plan: 11')
    await press(await page.evaluateHandle(() => [...document.querySelectorAll('[aria-label="Reasons"] button')].find((b) => b.textContent.startsWith('Stopped'))))
    await sleep(150)
    const stopped = await mainNames()
    expect(JSON.stringify(stopped) === JSON.stringify(['Hugo Brandt', 'Leo Park', 'Nadia Kerr']) && (await hero()) === 3, 'the Stopped chip: 3, the longest wait first', stopped.join(', '))
    await page.type('input[type="search"]', '@hugo')
    await sleep(150)
    expect(JSON.stringify(await mainNames()) === JSON.stringify(['Hugo Brandt']) && (await hero()) === 1, 'a search for @discord narrows it to one')
    await page.click('input[type="search"]', { clickCount: 3 })
    await page.type('input[type="search"]', 'nobody at all')
    await sleep(150)
    expect((await bodyText()).includes('No student matches the search and the filter.'), 'nothing matches: said so, with Show everyone')
    for (const size of SIZES) {
      await viewport(size)
      await check(`Today, nothing matches, ${size.join('x')}`, `today-nomatch-${size[0]}`)
    }
    await viewport([1280, 720])
    await press(await button('Show everyone'))
    await sleep(150)
    expect((await hero()) === 10, 'Show everyone: back to the default, 10')
    await viewport([390, 844])
    await check('Today, the filters, 390x844', 'today-filters-390')
  }

  console.log('\nToday: Mark messaged, then Undo from the notice')
  {
    await open('')
    await waitReady()
    await press(await buttonIn(await row('Tom Ashby'), 'Mark messaged'))
    await page.waitForFunction(() => document.body.innerText.includes('Marked Tom Ashby as messaged.'), { timeout: 10000 })
    await settled()
    const mark = (await calls()).find((x) => x.name === 'mark')
    expect(mark && mark.args[0].studentId === 't-tom' && mark.args[0].action === 'messaged' && mark.args[0].headlineKind === 'not_started'
      && mark.args[0].reasonsText === 'No lesson on the new course yet (course day 9)' && JSON.stringify(mark.args[0].openTaskIds) === '["q-tom"]',
      "one call: the headline's kind, every reason in words, and the open queue task", JSON.stringify(mark?.args[0]))
    expect(!(await mainNames()).includes('Tom Ashby') && (await hero()) === 9, 'Tom leaves the list: 9')
    for (const size of SIZES) {
      await viewport(size)
      await check(`Today, after a mark, ${size.join('x')}`, `today-after-mark-${size[0]}`)
    }
    await openAllDetails()
    const handled = await bodyText()
    expect(handled.includes('Tom Ashby') && /Messaged\s*Wed 28 Oct, 09:31 by Robin/.test(handled), 'Handled: Tom, messaged by Robin at 09:31')
    for (const size of SIZES) {
      await viewport(size)
      await check(`Today, after a mark, Handled open, ${size.join('x')}`, `today-after-mark-handled-${size[0]}`)
    }
    await viewport([1280, 720])
    await press(await button('Undo'))
    await page.waitForFunction(() => document.body.innerText.includes('Undone. Tom Ashby is back on the list'), { timeout: 10000 })
    await settled()
    const undo = (await calls()).find((x) => x.name === 'undo')
    expect(undo && undo.args[0].length === 2 && undo.args[0].includes('q-tom'), 'Undo sends the record and the queue task together', JSON.stringify(undo?.args))
    expect((await mainNames()).includes('Tom Ashby') && (await hero()) === 10, 'Tom is back: 10')
  }

  console.log('\nToday: Not needed needs a reason')
  {
    await open('')
    await waitReady()
    await press(await buttonIn(await row('Hugo Brandt'), 'Not needed'))
    await page.waitForSelector('input[placeholder^="For example"]')
    const save = await buttonIn(await row('Hugo Brandt'), 'Save as not needed')
    expect((await save.evaluate((b) => b.disabled)) && (await bodyText()).includes('Write a reason to save.'), 'Save is disabled, and says why beside it')
    for (const size of SIZES) {
      await viewport(size)
      await check(`Today, the Not needed panel, ${size.join('x')}`, `today-notneeded-${size[0]}`)
    }
    await viewport([1280, 720])
    await page.type('input[placeholder^="For example"]', 'He is on holiday until Monday.')
    await press(await buttonIn(await row('Hugo Brandt'), 'Save as not needed'))
    await page.waitForFunction(() => document.body.innerText.includes('Marked Hugo Brandt as not needed.'), { timeout: 10000 })
    await settled()
    const m = (await calls()).find((x) => x.name === 'mark')
    expect(m?.args[0].action === 'not_needed' && m.args[0].note === 'He is on holiday until Monday.' && m.args[0].headlineKind === 'stopped', 'not_needed, with the reason', JSON.stringify(m?.args[0]))
    await openAllDetails()
    expect((await bodyText()).includes('Reason: He is on holiday until Monday.'), 'Handled shows the reason')
  }

  console.log('\nToday: Handled, with Replied / No reply and Undo on my own entries')
  {
    await open('')
    await waitReady()
    await openAllDetails()
    const entries = await page.evaluate(() => {
      const d = [...document.querySelectorAll('details')].find((x) => x.querySelector('summary')?.textContent.startsWith('Handled'))
      return [...d.querySelectorAll('.list-row')].map((r) => ({
        text: r.textContent.slice(0, 120),
        undo: [...r.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Undo'),
        replied: [...r.querySelectorAll('button')].some((b) => b.textContent.includes('Replied')),
      }))
    })
    const cora = entries.find((g) => g.text.startsWith('Cora Diaz'))
    const eli = entries.find((g) => g.text.startsWith('Eli Moreno'))
    const bea = entries.find((g) => g.text.startsWith('Bea Holt'))
    const app = entries.find((g) => g.text.startsWith('2 students'))
    expect(cora?.undo && cora.replied, 'Cora, my mark 5 minutes ago: Undo, and Replied / No reply', JSON.stringify(cora))
    expect(eli && !eli.undo && !eli.replied, 'Eli, my Not needed an hour ago: no Undo, no reply buttons')
    expect(bea && !bea.undo && bea.replied, "Bea, Jamie's: Replied / No reply, no Undo")
    expect(app && !app.undo && !app.replied && app.text.includes('by the app'), 'two tasks the app closed: one entry, by the app', JSON.stringify(app))
    const beaRow = await page.evaluateHandle(() => [...document.querySelectorAll('.list-row')].find((r) => r.textContent.startsWith('Bea Holt')))
    expect(await beaRow.evaluate((r) => [...r.querySelectorAll('button')].find((b) => b.textContent.includes('Replied')).getAttribute('aria-pressed') === 'true'),
      "Bea's saved reply shows pressed")
    await press(await buttonIn(beaRow, 'No reply'))
    await sleep(800)
    await settled()
    const out = (await calls()).find((x) => x.name === 'setOutcome')
    expect(out && out.args[0] === 'h-bea' && out.args[1] === 'no_reply', 'No reply goes to the outcome route for that task', JSON.stringify(out?.args))
    await openAllDetails()
    const coraRow = await page.evaluateHandle(() => [...document.querySelectorAll('.list-row')].find((r) => r.textContent.startsWith('Cora Diaz')))
    await press(await buttonIn(coraRow, 'Undo'))
    await page.waitForFunction(() => document.body.innerText.includes('Undone. Cora Diaz'), { timeout: 10000 })
    await settled()
    expect((await mainNames()).includes('Cora Diaz'), 'Undo from Handled: Cora is back on the list')
    for (const size of SIZES) {
      await viewport(size)
      await check(`Today, after an Undo from Handled, ${size.join('x')}`, `today-after-undo-${size[0]}`)
    }
  }
  const errs = newConsoleErrors(from)
  expect(errs.length === 0, 'Today: no error in the browser console', errs.slice(0, 3).join(' || '))
}

// ════════════════════════════════════════════════════════════════════════════
// thirty: /dev/admin/discounts
// ════════════════════════════════════════════════════════════════════════════
if (wanted('thirty')) {
  const from = consoleErrors.length
  const TABS = ['decide', 'earn', 'approved', 'code-added', 'rejected']
  const EMPTY = {
    decide: 'No request is waiting for a decision.',
    earn: 'Nobody can still earn the 30% right now.',
    approved: 'No code is waiting to be added in Whop.',
    'code-added': 'No code has been added in Whop yet.',
    rejected: 'No request has been rejected.',
  }
  const open = (query, size) => go(`/dev/admin/discounts${query}`, size)
  const waitReady = () => page.waitForSelector('[role="tablist"]', { timeout: 30000 })
  const row = (name) => page.evaluateHandle((n) => [...document.querySelectorAll('.list-row')].find((r) => r.textContent.includes(n)) ?? null, name)
  const tabCounts = () => page.$$eval('[role="tab"]', (ts) => ts.map((t) => `${t.childNodes[0].textContent.trim()} ${t.querySelector('span')?.textContent.trim() ?? ''}`.trim()))

  for (const size of SIZES) {
    const [w, h] = size
    for (const tab of TABS) {
      const label = `30% off, full, ${tab}, ${w}x${h}`
      console.log(`\n${label}`)
      await open(`?tab=${tab}`, size)
      await waitReady()
      await check(label, `thirty-full-${tab}-${w}`)
    }
    for (const tab of TABS) {
      const label = `30% off, empty, ${tab}, ${w}x${h}`
      console.log(`\n${label}`)
      await open(`?state=empty&tab=${tab}`, size)
      await waitReady()
      expect((await bodyText()).includes(EMPTY[tab]), `${label}: "${EMPTY[tab]}"`)
      await check(label, `thirty-empty-${tab}-${w}`)
    }
    {
      const label = `30% off, one student unreadable, To decide, ${w}x${h}`
      console.log(`\n${label}`)
      await open('?state=partial&tab=decide', size)
      await waitReady()
      const nina = await row('Nina Petrova')
      expect(await nina.evaluate((r) => r.textContent.includes("Couldn't read this student's progress, so there is no verdict.") && r.textContent.includes("Videos: couldn't read")),
        `${label}: the row says there is no verdict, in words`)
      expect((await (await buttonIn(nina, 'Approve')).evaluate((b) => b.disabled)) && !(await isNull(await buttonIn(nina, 'Approve anyway'))), `${label}: Approve disabled, Approve anyway offered`)
      await check(label, `thirty-partial-decide-${w}`)
      await press(await page.evaluateHandle(() => [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent.startsWith('Can still earn'))))
      await page.waitForFunction(() => document.body.innerText.includes('1 member is left out of this list'))
      await check(`30% off, one student unreadable, Can still earn, ${w}x${h}`, `thirty-partial-earn-${w}`)
    }
    {
      const label = `30% off, the videos unreadable, To decide, ${w}x${h}`
      console.log(`\n${label}`)
      await open('?state=novideos&tab=decide', size)
      await waitReady()
      expect((await bodyText()).includes("Couldn't read the course's videos, so no request has a verdict and no video count is shown."), `${label}: the warning above the list`)
      const verdicts = await page.$$eval('.list-row', (rs) => rs.map((r) => r.textContent.includes("Couldn't read this student's progress, so there is no verdict. Press Refresh to try again.")))
      expect(verdicts.length === 6 && verdicts.every(Boolean), `${label}: every pending row says there is no verdict, and to press Refresh`, JSON.stringify(verdicts))
      await check(label, `thirty-novideos-decide-${w}`)
      await press(await page.evaluateHandle(() => [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent.startsWith('Can still earn'))))
      await page.waitForFunction(() => document.body.innerText.includes('members are left out of this list'))
      const earnText = await bodyText()
      expect(earnText.includes('Nobody to show until the list can be read. Press Refresh.') && !earnText.includes('Nobody can still earn the 30% right now.'),
        `${label.replace('To decide', 'Can still earn')}: under "left out", the empty list never says "nobody can still earn"`)
      await check(label.replace('To decide', 'Can still earn'), `thirty-novideos-earn-${w}`)
    }
    {
      const label = `30% off, the tabs and taps, ${w}x${h}`
      console.log(`\n${label}`)
      await open('?tab=decide', size)
      await waitReady()
      const tabs = await page.$$eval('[role="tab"]', (ts) => ts.map((t) => { const r = t.getBoundingClientRect(); return { left: r.left, right: r.right, h: r.height, width: innerWidth } }))
      expect(tabs.length === 5 && tabs.every((t) => t.left >= 0 && t.right <= t.width && t.h >= 44),
        `${label}: all five tabs whole in the window, 44px tall (they wrap on a phone)`, JSON.stringify(tabs.map((t) => Math.round(t.right))))
      const small = await smallTaps()
      expect(small.length === 0, `${label}: every button, tab and link styled as one is 44px tall or more`, JSON.stringify(small.slice(0, 4)))
      const order = await page.$$eval('.list-row', (rs) => rs.map((r) => r.querySelector('a')?.textContent))
      expect(JSON.stringify(order) === JSON.stringify(['Leo Hartmann', 'Sofia Marin', 'Maya Lindqvist', 'Jonah Pereira', 'Maximilian Featherstonehaugh-Smythe', 'Priya Raman']),
        `${label}: To decide, the longest wait first`, order.join(', '))
    }
    {
      const label = `30% off, loading, ${w}x${h}`
      console.log(`\n${label}`)
      await open('?state=loading', size)
      await page.waitForSelector('.animate-pulse')
      expect((await page.$('.animate-spin')) === null, `${label}: skeleton rows, no spinner`)
      await check(label, `thirty-loading-${w}`)
    }
    {
      const label = `30% off, error, ${w}x${h}`
      console.log(`\n${label}`)
      await open('?state=error', size)
      await page.waitForSelector('[role="alert"]')
      const text = await page.$eval('[role="alert"]', (e) => e.textContent)
      expect(text.includes("Couldn't load the 30% list.") && text.includes('Retry'), `${label}: the error sentence and Retry`, text)
      await check(label, `thirty-error-${w}`)
    }
  }

  console.log('\n30% off: the verdict beside Approve (C9), and no ads tick since 2026-10-20')
  {
    await open('?tab=decide')
    await waitReady()
    const maya = await row('Maya Lindqvist')
    const approveMaya = await buttonIn(maya, 'Approve')
    expect(!(await isNull(approveMaya)) && !(await approveMaya.evaluate((b) => b.disabled)), 'Maya, every video done: Approve is enabled')
    expect(await maya.evaluate((r) => r.textContent.includes('Every video up to the checkpoint was done in time.')), 'with the yes sentence beside it')
    expect(await isNull(await buttonIn(maya, 'Approve anyway')), 'and no Approve anyway')
    const jonah = await row('Jonah Pereira')
    expect(!(await (await buttonIn(jonah, 'Approve')).evaluate((b) => b.disabled))
      && (await jonah.evaluate((r) => r.textContent.includes('Every video up to the checkpoint was done in time.'))),
      'Jonah, every video done and his ads never ticked: Approve is enabled, the yes sentence beside it (until 2026-10-20 it waited for the tick)')
    const boxes = await page.$$eval('.list-row', (rs) => rs.map((r) => r.querySelectorAll('input[type="checkbox"]').length))
    expect(boxes.length === 6 && boxes.every((n) => n === 0), 'no row on To decide has a checkbox: the "Ads verified" tick is gone', JSON.stringify(boxes))
    const decideText = await bodyText()
    expect(!/ads verified|tick ads|ads are not verified|ads check/i.test(decideText) && !decideText.includes('Action items') && !decideText.includes('Open the post'),
      "nothing on To decide speaks of the ads, and no row shows the action items' hand-ins (C10 kept them as the tick's evidence)")
    const approvable = await page.$$eval('.list-row', (rs) => rs.map((r) => {
      const b = [...r.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Approve')
      return { name: r.querySelector('a')?.textContent, yes: r.textContent.includes('Every video up to the checkpoint was done in time.'), open: !!b && !b.disabled }
    }))
    expect(approvable.every((a) => a.yes === a.open) && approvable.filter((a) => a.open).map((a) => a.name).join() === 'Maya Lindqvist,Jonah Pereira',
      "Approve is enabled on exactly the rows whose verdict is yes, Maya's and Jonah's", JSON.stringify(approvable))
    const priya = await row('Priya Raman')
    expect(await (await buttonIn(priya, 'Approve')).evaluate((b) => b.disabled), 'Priya, 57 of 61: Approve is disabled')
    expect(await priya.evaluate((r) => r.textContent.includes('Not every video up to the checkpoint is done yet.')), 'with the refusal beside it')
    expect(await priya.evaluate((r) => r.textContent.includes('Videos 57 of 61') && r.textContent.includes('Paid Sat 3 Oct')
      && r.textContent.includes('Deadline Fri 23 Oct, 23:59 (Croatia time)') && r.textContent.includes('Asked Tue 20 Oct')),
      'the facts read "Paid Sat 3 Oct", "Deadline Fri 23 Oct, 23:59 (Croatia time)", "Videos 57 of 61", "Asked Tue 20 Oct"')
    expect(await priya.evaluate((r) => r.textContent.includes('No Discord linked') && r.textContent.includes('Payment failed') && r.textContent.includes('Whop progress not pulled yet')),
      'no Discord linked, Payment failed, Whop progress not pulled yet')
    expect(await (await row('Sofia Marin')).evaluate((r) => r.textContent.includes('Asked on the old course, before the switch.') && r.textContent.includes('Asked Fri 16 Oct')),
      'Sofia: asked Fri 16 Oct, on the old course, and the verdict says so')
    expect(await maya.evaluate((r) => !!r.querySelector('a[href="https://discord.com/users/100000000000000101"]') && r.textContent.includes('Open in Discord')),
      'C7: Open in Discord links discord.com/users/<id>')
    expect(await jonah.evaluate((r) => [...r.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Copy @jonah_p')), 'C7: Copy @jonah_p when only the name is known')
    expect(await maya.evaluate((r) => !!r.querySelector('a[href="/admin/students/p-maya"]')), 'C10: the name links to the student page')
    expect(await maya.evaluate((r) => { const d = r.querySelector('details'); return !!d && !d.open && d.textContent.includes('Survey answers (3)') }), 'the survey answers, folded')
    // Jonah's Approve goes through on the rule's yes alone: one call, no override, nothing before it.
    await press(await buttonIn(jonah, 'Approve'))
    await page.waitForFunction(() => document.body.innerText.includes('Approved Jonah Pereira.'), { timeout: 10000 })
    await settled()
    const made = await calls()
    expect(made.filter((c) => c.name === 'approve').map((c) => JSON.stringify(c.args)).join() === '["r-jonah",false]'
      && made.every((c) => c.name === 'loadThirty' || c.name === 'approve'),
      'Approve on Jonah: one approve call without override, and no other call before it', JSON.stringify(made.map((c) => c.name)))
    const counts = await tabCounts()
    expect(counts[0] === 'To decide 5' && counts[2] === 'Approved 3', 'Jonah moves from To decide to Approved', counts.join(' | '))
    for (const size of SIZES) {
      await viewport(size)
      await check(`30% off, after Approve on Jonah, ${size.join('x')}`, `thirty-decide-approved-${size[0]}`)
    }
  }

  console.log('\n30% off: Approve anyway, an inline confirm, then the call with override')
  {
    await open('?tab=decide')
    await waitReady()
    await press(await buttonIn(await row('Priya Raman'), 'Approve anyway'))
    await page.waitForFunction(() => document.body.innerText.includes('Approve anyway skips the 30% rule'))
    expect(!(await calls()).some((c) => c.name === 'approve'), 'the first click opens the confirm and calls nothing')
    const confirmText = await page.evaluate(() => [...document.querySelectorAll('p')].find((p) => p.textContent.startsWith('Approve anyway skips'))?.textContent)
    expect(confirmText === "Approve anyway skips the 30% rule and creates the student's Whop code now.",
      'the confirm says it skips the 30% rule, and no longer an ads check', confirmText)
    for (const size of SIZES) {
      await viewport(size)
      await check(`30% off, the Approve anyway confirm, ${size.join('x')}`, `thirty-override-confirm-${size[0]}`)
    }
    await viewport([1280, 720])
    await press(await buttonIn(await row('Priya Raman'), 'Yes, create the code'))
    await page.waitForFunction(() => document.body.innerText.includes('Approved Priya Raman.'), { timeout: 10000 })
    await settled()
    const after = await calls()
    expect(after.some((c) => c.name === 'approve' && c.args[0] === 'r-priya' && c.args[1] === true), 'the second click sends approve with override', JSON.stringify(after.filter((c) => c.name === 'approve')))
    expect(after.filter((c) => c.name === 'loadThirty').length === 2, 'and the list is read again')
    const counts = await tabCounts()
    expect(counts[0] === 'To decide 5' && counts[2] === 'Approved 3', 'Priya moves from To decide to Approved', counts.join(' | '))
    await check('30% off, after Approve anyway, 1280x720', 'thirty-after-override-1280')
  }

  console.log('\n30% off: Reject, its reason, and what the student sees')
  {
    await open('?tab=decide')
    await waitReady()
    await press(await buttonIn(await row('Jonah Pereira'), 'Reject'))
    await page.waitForSelector('input[placeholder^="For example"]')
    expect((await bodyText()).includes('The student sees this reason on their map, and cannot ask for the 30% again.'), 'the panel says the student sees the reason and cannot ask again')
    const example = await page.$eval('input[placeholder^="For example"]', (i) => i.placeholder)
    expect(example === 'For example: not every video was done by the deadline', 'its example reason is about the videos, no longer the ads', example)
    for (const size of SIZES) {
      await viewport(size)
      await check(`30% off, the Reject panel, ${size.join('x')}`, `thirty-reject-panel-${size[0]}`)
    }
    await viewport([1280, 720])
    await page.type('input[placeholder^="For example"]', 'Two accounts on one card.')
    await press(await buttonIn(await row('Jonah Pereira'), 'Reject the request'))
    await page.waitForFunction(() => document.body.innerText.includes('Rejected the request from Jonah Pereira.'), { timeout: 10000 })
    await settled()
    expect((await calls()).some((x) => x.name === 'reject' && x.args[0] === 'r-jonah' && x.args[1] === 'Two accounts on one card.'), 'reject is sent with the reason')
  }

  console.log('\n30% off: a 409 on approve and on reject')
  {
    await open('?tab=decide&conflict=1')
    await waitReady()
    await press(await buttonIn(await row('Maya Lindqvist'), 'Approve'))
    await page.waitForFunction(() => document.body.innerText.includes('this request had already been decided, so the code must be deleted in Whop.'), { timeout: 10000 })
    await settled()
    expect((await calls()).filter((x) => x.name === 'loadThirty').length === 2, 'approve answered 409: its sentence is shown and the list is read again')
    expect(await isNull(await row('Maya Lindqvist')), 'Maya is off To decide: another member decided it')
    const notice = await page.$eval('[role="alert"]', (e) => e.textContent)
    expect(notice.startsWith('Maya Lindqvist: The Whop code ECOM30-'), 'the notice names the student and the code to delete', notice)
    const placed = await page.$eval('[role="alert"]', (e) => {
      const r = e.getBoundingClientRect()
      return { top: r.top, bottom: r.bottom, height: innerHeight, copy: [...e.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Copy code') }
    })
    expect(placed.top >= 0 && placed.bottom <= placed.height && placed.copy,
      'the code to delete is in the window where the click was, with Copy code, and stays until dismissed', JSON.stringify(placed))
    await sleep(500)
    expect((await page.$('[role="alert"]')) !== null, 'it is still there a moment later (a refusal is never hidden by itself)')
    for (const size of SIZES) {
      await viewport(size)
      await check(`30% off, approve answered 409, ${size.join('x')}`, `thirty-approve-409-${size[0]}`)
    }
    await viewport([1280, 720])
    await press(await buttonIn(await row('Jonah Pereira'), 'Reject'))
    await page.waitForSelector('input[placeholder^="For example"]')
    await press(await buttonIn(await row('Jonah Pereira'), 'Reject the request'))
    await page.waitForFunction(() => document.body.innerText.includes('Jonah Pereira: This request was already decided.'), { timeout: 10000 })
    await settled()
    expect((await calls()).filter((x) => x.name === 'loadThirty').length === 3, 'reject answered 409: its sentence is shown and the list is read again')
    expect(await isNull(await row('Jonah Pereira')), 'Jonah is off To decide')
    for (const size of SIZES) {
      await viewport(size)
      await check(`30% off, reject answered 409, ${size.join('x')}`, `thirty-reject-409-${size[0]}`)
    }
  }

  console.log('\n30% off: a decision goes through, then the list cannot be read again')
  {
    const STALE = "Couldn't refresh the list, so it may be out of date. Press Refresh."
    await open('?tab=decide&reload=fail')
    await waitReady()
    await press(await buttonIn(await row('Maya Lindqvist'), 'Approve'))
    await page.waitForFunction((t) => document.body.innerText.includes(t), { timeout: 10000 }, STALE)
    await settled()
    const said = () => page.evaluate(() => ({
      status: [...document.querySelectorAll('[role="status"]')].map((e) => e.textContent),
      alert: [...document.querySelectorAll('[role="alert"]')].map((e) => e.textContent),
    }))
    const first = await said()
    expect(first.status.some((t) => t.startsWith('Approved Maya Lindqvist. The code ECOM30-')) && first.alert.some((t) => t.startsWith(STALE))
      && !first.status.some((t) => t.includes(STALE)) && ![...first.status, ...first.alert].some((t) => t.includes('nothing is shown')),
      'the approval and its code in a notice of their own, the list being out of date on a line of its own, and never "nothing is shown"', JSON.stringify(first))
    const maya = await row('Maya Lindqvist')
    expect((await (await buttonIn(maya, 'Approve')).evaluate((b) => b.disabled)) && (await (await buttonIn(maya, 'Reject')).evaluate((b) => b.disabled))
      && (await maya.evaluate((r) => r.textContent.includes('Saved. Press Refresh to see this row as it is now.'))),
      "Maya's row, still shown as it was, keeps its buttons off until a read works")
    await press(await button('Refresh'))
    await sleep(700)
    await settled()
    const second = await said()
    expect(JSON.stringify(second) === JSON.stringify(first), 'a second failed Refresh leaves both as they are', JSON.stringify(second))
    for (const size of SIZES) {
      await viewport(size)
      await check(`30% off, the reload failed, ${size.join('x')}`, `thirty-reload-failed-${size[0]}`)
    }
  }

  console.log('\n30% off: Mark code added, and Mark messaged')
  {
    await open('?tab=approved')
    await waitReady()
    const ethan = await row('Ethan Cole')
    expect(await ethan.evaluate((r) => r.textContent.includes('ECOM30-3F9A21') && r.textContent.includes('Approved Sun 18 Oct by Robin')), 'Approved: the code, who approved it and when')
    expect(!(await isNull(await buttonIn(ethan, 'Copy'))), 'with Copy')
    await press(await buttonIn(ethan, 'Mark code added'))
    await page.waitForFunction(() => document.body.innerText.includes('Marked the code as added in Whop for Ethan Cole.'), { timeout: 10000 })
    await settled()
    const counts = await tabCounts()
    expect(counts[2] === 'Approved 1' && counts[3] === 'Code added in Whop 3', 'Ethan moves to Code added in Whop', counts.join(' | '))

    await open('?tab=earn')
    await waitReady()
    const order = await page.$$eval('.list-row', (rs) => rs.map((r) => r.querySelector('a')?.textContent))
    expect(JSON.stringify(order) === JSON.stringify(['Theo Marsh', 'Dana Whitfield', 'Zoe Achterberg', 'Ava Lindgren', 'Iris Kowalski', 'Sam Taylor']),
      'Can still earn: the soonest deadline first, then the fewest videos left; exempt and canceled members left out', order.join(', '))
    const theo = await row('Theo Marsh')
    expect(await theo.evaluate((r) => r.textContent.includes('Deadline Fri 23 Oct, 23:59 (Croatia time), 3 days left') && /50 of 61 videos done, 11 left \(about \d+ hours?\)/.test(r.textContent)
      && r.textContent.includes('Messaged Fri 16 Oct by Jamie, replied')), 'Theo: the deadline and the time left, the videos left and the hours in words, the last message')
    expect(await (await row('Dana Whitfield')).evaluate((r) => r.textContent.includes('Whop progress not pulled yet') && r.textContent.includes('No message yet')), 'Dana: the C14 chip, no message yet')
    expect(await (await row('Iris Kowalski')).evaluate((r) => r.textContent.includes('All 61 videos done. Can apply for the 30% now.') && r.textContent.includes('Can apply now')
      && r.textContent.includes('Messaged Mon 19 Oct by Robin, no reply yet')), 'Iris: ready, with the C12 line')
    await press(await buttonIn(theo, 'Mark messaged'))
    await page.waitForFunction(() => document.body.innerText.includes('Marked Theo Marsh as messaged.'), { timeout: 10000 })
    await settled()
    const mark = (await calls()).find((x) => x.name === 'mark')
    expect(mark && mark.args[0].studentId === 'p-theo' && mark.args[0].action === 'messaged' && mark.args[0].headlineKind === 'thirty_closing'
      && mark.args[0].reasonsText.startsWith('30% closes Fri 23 Oct, 23:59: 11 videos left (about'), "Mark messaged calls Today's mark route with thirty_closing and C4's words", JSON.stringify(mark?.args[0]))
    expect(await (await row('Theo Marsh')).evaluate((r) => r.textContent.includes('Messaged Tue 20 Oct by Robin, no reply yet')), "after the reload Theo's last message is the new one")
    await press(await buttonIn(await row('Iris Kowalski'), 'Mark messaged'))
    await page.waitForFunction(() => document.body.innerText.includes('Marked Iris Kowalski as messaged.'), { timeout: 10000 })
    await settled()
    const iMark = (await calls()).filter((x) => x.name === 'mark')[1]
    expect(iMark?.args[0].headlineKind === 'thirty_ready' && iMark.args[0].reasonsText === 'Can apply for the 30% now, until Wed 28 Oct, 10:00',
      'a ready row marks thirty_ready with its words', JSON.stringify(iMark?.args[0]))
    for (const size of SIZES) {
      await viewport(size)
      await check(`30% off, Can still earn after two marks, ${size.join('x')}`, `thirty-earn-marked-${size[0]}`)
    }

    // Ava has the queue's nolessons.day7 task open: the mark closes it with the same member and moment.
    await viewport([1280, 720])
    const ava = await row('Ava Lindgren')
    expect(await ava.evaluate((r) => r.textContent.includes('Also open in the Tasks queue since Tue 20 Oct. Marking this row closes it too.')),
      'Ava: her open task in the Tasks queue, and that marking her closes it')
    await press(await buttonIn(ava, 'Mark messaged'))
    await page.waitForFunction(() => document.body.innerText.includes('Marked Ava Lindgren as messaged.'), { timeout: 10000 })
    await settled()
    const aMark = (await calls()).filter((x) => x.name === 'mark')[2]
    expect(JSON.stringify(aMark?.args[0].openTaskIds) === '["q-ava"]', "Mark messaged sends her open task, so the Tasks queue closes it too", JSON.stringify(aMark?.args[0]))
    expect(!(await (await row('Ava Lindgren')).evaluate((r) => r.textContent.includes('Also open in the Tasks queue'))), 'after the reload her task is no longer open')
    await check('30% off, Mark messaged with an open queue task, 1280x720', 'thirty-earn-ava-1280')
    await press(await button('Undo'))
    await page.waitForFunction(() => document.body.innerText.includes('Undone. Ava Lindgren is no longer marked as messaged.'), { timeout: 10000 })
    await settled()
    const undo = (await calls()).find((x) => x.name === 'undo')
    expect(undo && undo.args[0].length === 2 && undo.args[0].includes('q-ava'), "the notice's Undo takes back the mark and reopens the queue task, as Today's does", JSON.stringify(undo?.args))
    expect(await (await row('Ava Lindgren')).evaluate((r) => r.textContent.includes('Also open in the Tasks queue since Tue 20 Oct.')), 'her task is open again')
  }

  console.log('\n30% off: ?student= keeps every tab to one student')
  {
    await open('?student=p-ethan')
    await waitReady()
    expect(JSON.stringify(await tabCounts()) === JSON.stringify(['To decide 0', 'Can still earn 0', 'Approved 1', 'Code added in Whop 0', 'Rejected 0']),
      'Ethan: every tab counts him alone', (await tabCounts()).join(' | '))
    expect((await page.$eval('[role="tab"][aria-selected="true"]', (t) => t.textContent)).startsWith('Approved'), 'the first tab that has him opens')
    expect((await bodyText()).includes('Showing Ethan Cole only.'), 'the banner names him')
    for (const size of SIZES) {
      await viewport(size)
      await check(`30% off, one student, ${size.join('x')}`, `thirty-student-${size[0]}`)
    }
    await viewport([1280, 720])
    await page.$$eval('[role="tab"]', (ts) => ts.find((t) => t.textContent.startsWith('To decide')).click())
    await sleep(200)
    expect((await bodyText()).includes('This student has nothing on this tab.'), 'To decide, filtered: nothing for him')
    expect(page.url().includes('student=p-ethan') && page.url().includes('tab=decide'), 'the address keeps the student and the tab', page.url())
    await press(await button('Show everyone'))
    await sleep(300)
    const all = await tabCounts()
    expect(all[0] === 'To decide 6' && !page.url().includes('student='), 'Show everyone: the filter goes, the tab stays', `${all.join(' | ')} ${page.url()}`)
    await open('?student=p-maya&tab=earn')
    await waitReady()
    const mayaEarn = await tabCounts()
    expect(mayaEarn[0] === 'To decide 1' && (await bodyText()).includes('This student has nothing on this tab.'), '?tab= wins over the first tab with rows', mayaEarn.join(' | '))
  }
  const errs = newConsoleErrors(from)
  expect(errs.length === 0, '30% off: no error in the browser console', errs.slice(0, 3).join(' || '))
}

// ── Every page the run opened ──────────────────────────────────────────────
console.log('\nevery page the run opened')
expect(offMachine.length === 0, `no request left the machine: ${offMachine.length} to another host`, [...new Set(offMachine)].slice(0, 3).join(', '))
console.log(`       (the root layout's Vercel Analytics script was answered here, empty, ${analyticsHere} times)`)
expect(pageErrors.length === 0, `no uncaught exception in a page: ${pageErrors.length}`, pageErrors.slice(0, 3).join(' || '))
await browser.close()
fs.rmSync(userDataDir, { recursive: true, force: true })
finish()

function finish() {
  console.log(`\n${'='.repeat(60)}\n  PASS ${passed}   FAIL ${failed}   NOT COVERED ${notCovered}`)
  if (failed) { console.log('\nFAILURES:'); failures.forEach((f) => console.log(`  - ${f}`)) }
  process.exit(failed ? 1 : 0)
}
