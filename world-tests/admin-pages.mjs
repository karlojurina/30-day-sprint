/**
 * The rebuilt admin pages in a real browser (admin rebuild PRD, work item 5;
 * admin rebuild 2, WI-1): the top bar, the two sign-in pages and the 30%
 * page, in every state, at a phone's width and two desktop widths. Today,
 * which this file also drew, was removed in admin rebuild 2 (D2).
 *
 *   node world-tests/admin-pages.mjs [--only routes,frame,signin,thirty,dash,tasks,people,feedback]
 *
 * Opens BASE_URL (default http://localhost:3226): a development server
 * started for the run in the app root, `PORT=3226 npx next dev`. This script
 * never starts one. The dev pages need nothing from .env.local; the
 * set-password form and the sign-in that lands need a server with no
 * Supabase settings (see signin).
 *
 *   routes  client-tests/build.mjs, then the route suite
 *           (client-tests/admin-routes.test.mjs: GET /api/admin/thirty and
 *           PUT /api/admin/config) as npm run test:client runs it, with
 *           ADMIN_ROUTE_ERRORS_OUT set: it must pass, and every error
 *           sentence a route answered there is held to the words below
 *   frame   /dev/admin/frame for a founder, a csm and an admin, over a light
 *           page and the Dashboard in the dark look: the bar reads Dashboard
 *           · 30% off · Tasks · Students · Feedback · Templates · Insights ·
 *           Team for each role's flags, with no "More", Dashboard marked on
 *           /admin, no plan or subscription in it, and the lockup to /admin;
 *           under 1100px the Menu with every entry; above it each dropdown,
 *           and Escape closing them; at 1100px wide a founder's bar fits
 *           with the lockup at full size, and with a name longer than the
 *           profile's 180px the lockup shrinks and nothing overlaps
 *   signin  /admin/login, and its refusal (Supabase's answer given here);
 *           /admin/set-password with no invite; and, when the server has no
 *           Supabase settings, its form with a made-up invite and its own
 *           check of the two passwords, and a sign-in with Supabase's yes
 *           given here that opens /admin (NOT COVERED otherwise, with why)
 *   thirty  /dev/admin/discounts (admin rebuild 2, D4 and D5): the tabs
 *           Applied, Approved, Rejected and Code Applied, each full and
 *           empty, with their counts, every tab oldest first and the old tab
 *           names still opening theirs; partial, novideos, nocoupons, loading
 *           and error; a row is the name (to the student page), @username,
 *           Active or not, the date applied, the verdict line with its count,
 *           the coupon and the actions, with no plan, Discord buttons,
 *           survey, Can still earn, last contact or Mark messaged; then its
 *           paths by clicks: Approve on the rule's yes, Approve refused for a
 *           coupon Whop names only then (its row turns to the coupon, no
 *           Approve anyway after it), the Approve anyway link and its confirm,
 *           Reject, a 409 on approve and on reject, a failed reload, Mark
 *           code applied, the coupon warning on Approved, ?student=; every
 *           tap 44px, the link too
 *   dash    /dev/admin/dashboard (admin rebuild 2, WI-2): full, renewed,
 *           empty, partial, error and loading; Month 2 waiting with no
 *           rate before the first renewals, then its rate; Avg progress's
 *           line from the switch only; every failed tile "Couldn't load"
 *           with no number; the readouts by pointer and keyboard; How it's
 *           counted; Refresh for a founder (its line, a refusal, a step that
 *           failed) and none for a csm; Retry; every tap 44px
 *   tasks   /dev/admin/tasks (admin rebuild 2, D7): To do, Sent, Dismissed
 *           and Archived full, before the reset (no Archived), empty, loading
 *           and error; the Archived rows read only, with the reset's words;
 *           then by clicks: Mark sent, Dismiss (a reason is asked for), Move
 *           to To do, Replied, a task's detail, the search; every tap 44px
 *   people  /dev/admin/tasks/insights, /dev/admin/students, a student's page
 *           and /dev/admin/journey (D7 to D9), in every state, with what each
 *           says when a read failed; then by clicks: the insights' ranges, the
 *           students' filters and search, the student's ticks and areas, the
 *           journey's drawer (opened by a card, closed by Escape); every tap
 *           44px, and no bold word glued to the next one
 *   feedback  /dev/admin/feedback/lessons (admin rebuild 2, WI-7): full,
 *           empty, loading, error, unplaced and stray; the areas in route
 *           order with their counts, a lesson's average and count, its 3
 *           newest comments and "Show all", a lesson with none and an area
 *           with none saying so, a name missing (the email) and a student
 *           gone; a failed Refresh keeps the page with its own line; every
 *           tap 44px
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
  const run = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', 'client-tests/admin-routes.test.mjs'], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ADMIN_ROUTE_ERRORS_OUT: file },
  })
  const summary = (`${run.stdout}`.match(/PASS \d+\s+FAIL \d+/) || ['no summary line'])[0].replace(/\s+/g, ' ')
  expect(run.status === 0, `client-tests/admin-routes.test.mjs passes: ${summary}`,
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

const needBrowser = ['frame', 'signin', 'thirty', 'dash', 'tasks', 'people', 'feedback'].some(wanted)
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
// frame: the top bar for each role, over a light page and the Dashboard
// ════════════════════════════════════════════════════════════════════════════
if (wanted('frame')) {
  const from = consoleErrors.length
  // Admin rebuild 2, D1: Dashboard · 30% off · Tasks · Students ▾ · Feedback ▾ · Templates · Insights · Team, no "More".
  // Feedback's two pages are hidden from the csm role, and Team is a founder's only, as before.
  const BAR = {
    founder: ['Dashboard', '30% off', 'Tasks', 'Students', 'Feedback', 'Templates', 'Insights', 'Team'],
    csm: ['Dashboard', '30% off', 'Tasks', 'Students', 'Templates', 'Insights'],
    admin: ['Dashboard', '30% off', 'Tasks', 'Students', 'Feedback', 'Templates', 'Insights'],
  }
  const GROUPS = { Students: ['All students', 'Student journey'], Feedback: ['Lesson feedback', 'Survey'] }
  /** Every entry a role may open, as the phone's Menu lists them: each group's pages in its place. */
  const ENTRIES = Object.fromEntries(Object.entries(BAR).map(([role, bar]) => [role, bar.flatMap((e) => GROUPS[e] ?? [e])]))
  const visibleLabels = (selector) => page.$$eval(selector, (els) => els
    .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' })
    .map((e) => e.textContent.replace(/\s+/g, ' ').trim()))
  /** D12 for the frame: the bar never speaks of a plan or a subscription. */
  const barSaysPlan = () => page.$eval('header', (h) => /\b(plans?|subscriptions?|subscribed)\b/i.test(h.innerText))
  for (const role of ['founder', 'csm', 'admin']) {
    for (const ground of ['light', 'dark']) {
      for (const size of SIZES) {
        const [w, h] = size
        const label = `frame, ${role}, ${ground === 'dark' ? 'the Dashboard' : 'a light page'}, ${w}x${h}`
        console.log(`\n${label}`)
        await go(`/dev/admin/frame?role=${role}&ground=${ground}`, size)
        await page.waitForSelector(`[data-frame-role="${role}"][data-frame-ground="${ground}"]`)
        await check(label, `frame-${role}-${ground}-${w}`)
        expect(await page.$eval('header a:has(img)', (a) => a.getAttribute('href') === '/admin'), `${label}: the lockup links to the Dashboard, /admin`)
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
          const current = await page.$$eval('header [id] nav a[aria-current="page"]', (as) => as.map((a) => a.textContent.trim()))
          expect(JSON.stringify(current) === JSON.stringify([ground === 'dark' ? 'Dashboard' : 'Tasks']), `${label}: the Menu marks the page it sits over`, JSON.stringify(current))
          expect((await menu.evaluate((b) => b.getAttribute('aria-expanded'))) === 'true', `${label}: aria-expanded is true while it is open`)
          // Students and Feedback sit next to each other: one hairline between them, never two.
          const doubled = await page.evaluate(() => {
            const items = [...document.querySelectorAll('header [id] nav > ul > li')]
            const px = (el, side) => parseFloat(getComputedStyle(el)[`border${side}Width`]) || 0
            return items.slice(1).filter((li, i) => px(items[i], 'Bottom') > 0 && px(li, 'Top') > 0).length
          })
          expect(doubled === 0, `${label}: one hairline between two groups, never two`, String(doubled))
          expect(!(await barSaysPlan()), `${label}, Menu open: no plan or subscription in the bar`)
          await check(`${label}, Menu open`, `frame-${role}-${ground}-${w}-menu`)
          // A founder's list may be taller than a phone: the panel scrolls inside itself.
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
          expect(JSON.stringify(top) === JSON.stringify(BAR[role]), `${label}: the bar reads ${BAR[role].join(' · ')}`, JSON.stringify(top))
          const active = await page.$$eval('header nav [data-active]', (els) => els.map((e) => e.textContent.trim()))
          const wantActive = ground === 'dark' ? ['Dashboard'] : ['Tasks']
          expect(JSON.stringify(active) === JSON.stringify(wantActive), `${label}: ${wantActive[0]} is marked as the page it sits over`, JSON.stringify(active))
          expect(!(await barSaysPlan()), `${label}: no plan or subscription in the bar`)
          const outside = await page.evaluate(() => {
            const header = document.querySelector('header')
            return [...header.querySelectorAll(':scope > div > *')]
              .filter((e) => getComputedStyle(e).display !== 'none')
              .map((e) => e.getBoundingClientRect())
              .filter((r) => r.right > window.innerWidth || r.left < 0).length
          })
          expect(outside === 0, `${label}: the lockup, every entry and the profile fit inside the window`)
          const groups = await page.$$('header nav[aria-label="Admin"] > div > button')
          const names = await Promise.all(groups.map((g) => g.evaluate((b) => b.textContent.trim())))
          expect(JSON.stringify(names) === JSON.stringify(BAR[role].filter((e) => GROUPS[e])), `${label}: the dropdowns are ${names.join(' and ')}`, JSON.stringify(names))
          for (const [i, name] of names.entries()) {
            await groups[i].click()
            await page.waitForSelector('header [role="menu"]')
            const items = await visibleLabels('header [role="menu"] a')
            expect(JSON.stringify(items) === JSON.stringify(GROUPS[name]), `${label}: ${name} lists ${items.join(', ')}`, JSON.stringify(items))
            await check(`${label}, ${name} open`, `frame-${role}-${ground}-${w}-${name.toLowerCase()}`)
            await page.keyboard.press('Escape')
            expect((await page.$('header [role="menu"]')) === null, `${label}: Escape closes ${name}`)
          }
        }
      }
    }
  }
  // 1100px is where the entries move into the bar. A founder's 8 fit there
  // beside the profile with the lockup at full size (216px); with a name
  // longer than the profile's 180px the lockup shrinks first, and nothing
  // overlaps or overflows.
  for (const [role, name] of [['founder', ''], ['admin', ''], ['founder', 'long']]) {
    const label = `frame, ${role}${name ? ' with a long name' : ''}, the Dashboard, 1100x800`
    console.log(`\n${label}`)
    await go(`/dev/admin/frame?role=${role}&ground=dark${name ? `&name=${name}` : ''}`, [1100, 800])
    await page.waitForSelector(`[data-frame-role="${role}"]`)
    const fit = await page.evaluate(() => {
      const nav = document.querySelector('header nav[aria-label="Admin"]').getBoundingClientRect()
      const img = document.querySelector('header a img').getBoundingClientRect()
      const signOut = [...document.querySelectorAll('header button')].find((b) => b.textContent.trim() === 'Sign out' && b.getBoundingClientRect().width > 0)
      const profile = signOut ? signOut.parentElement.parentElement.getBoundingClientRect() : null
      return { navLeft: Math.round(nav.left), navRight: Math.round(nav.right), lockup: Math.round(img.width), profileLeft: profile ? Math.round(profile.left) : null, width: innerWidth }
    })
    const clear = fit.profileLeft !== null && fit.navLeft >= fit.lockup && fit.navRight <= fit.profileLeft - 12 && fit.navRight < fit.width
    if (name) {
      expect(clear && fit.lockup >= 120,
        `${label}: the entries stay clear of the profile and the lockup shrinks to fit (lockup ${fit.lockup}px, entries end at ${fit.navRight}px, profile starts at ${fit.profileLeft}px)`, JSON.stringify(fit))
    } else {
      expect(clear && fit.lockup >= 215,
        `${label}: the entries fit between the full-size lockup and the profile (lockup ${fit.lockup}px, entries end at ${fit.navRight}px, profile starts at ${fit.profileLeft}px)`, JSON.stringify(fit))
    }
    await check(label, `frame-${role}${name ? '-long' : ''}-dark-1100`)
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
  // Admin rebuild 2, D1: a sign-in Supabase says yes to opens the Dashboard,
  // /admin. Supabase's yes is a made-up session given here; the address the
  // page then opens is answered here with a page of one word, so no app code
  // runs after it and nothing is asked of a real server. Every cookie the
  // sign-in set is deleted after.
  if (supabaseHost) {
    const label = '/admin/login, a sign-in that goes through, 1280x720'
    console.log(`\n${label}`)
    const b64u = (s) => Buffer.from(s).toString('base64url')
    const now = Math.floor(Date.now() / 1000)
    const user = { id: '00000000-0000-4000-8000-000000000002', aud: 'authenticated', role: 'authenticated', email: 'team.member@example.com', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() }
    const jwt = [b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' })), b64u(JSON.stringify({ sub: user.id, email: user.email, exp: now + 3600, role: 'authenticated', aud: 'authenticated' })), b64u('not-a-signature')].join('.')
    let landed = null
    answerHere = (req) => {
      const u = new URL(req.url())
      if (u.pathname.endsWith('/auth/v1/token')) {
        if (req.method() === 'OPTIONS') { req.respond({ status: 204, headers: CORS }); return true }
        req.respond({ status: 200, headers: CORS, contentType: 'application/json',
          body: JSON.stringify({ access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'made-up-refresh-token', user }) })
        return true
      }
      if (u.hostname.endsWith('.supabase.co')) { req.respond({ status: 503, headers: CORS, body: '' }); return true }
      if (u.origin === ORIGIN && u.pathname === '/api/auth/me') { req.respond({ status: 401, contentType: 'application/json', body: '{"error":"Not a team member"}' }); return true }
      if (u.origin === ORIGIN && req.isNavigationRequest() && u.pathname !== '/admin/login') {
        landed = `${u.pathname}${u.search}`
        req.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><html lang="en"><head><title>Landed</title></head><body><p>Landed</p></body></html>' })
        return true
      }
      return false
    }
    await go('/admin/login', [1280, 720])
    await page.waitForSelector('#email')
    await page.type('#email', user.email)
    await page.type('#password', 'a-made-up-password')
    await page.click('button[type="submit"]')
    await page.waitForFunction(() => document.title === 'Landed', { timeout: 20000 }).catch(() => {})
    expect(landed === '/admin', `${label}: it opens the Dashboard, /admin (it opened ${landed})`)
    answerHere = null
    const cookies = await page.cookies(ORIGIN)
    if (cookies.length) await page.deleteCookie(...cookies)
  } else {
    gap('/admin/login, a sign-in that goes through', 'the login page never called Supabase, so its answer could not be given here')
  }
  // The answers given here log in the console: the refusal's 400 from Supabase,
  // and the 401 for the made-up invite's /api/auth/me. Nothing else may.
  const errs = newConsoleErrors(from, [/status of 400 .*\/auth\/v1\/token/, /status of 401 .*\/api\/auth\/me\]$/])
  expect(errs.length === 0, "signin: no error in the browser console but the answers given here (the refusal's 400, the made-up invite's 401)",
    errs.slice(0, 3).join(' || '))
}

// ════════════════════════════════════════════════════════════════════════════
// thirty: /dev/admin/discounts (admin rebuild 2, D4 and D5)
// ════════════════════════════════════════════════════════════════════════════
if (wanted('thirty')) {
  const from = consoleErrors.length
  const TABS = ['applied', 'approved', 'rejected', 'code-applied']
  const EMPTY = {
    applied: 'No request is waiting for a decision.',
    approved: 'No code is waiting to be applied in Whop.',
    rejected: 'No request has been rejected.',
    'code-applied': 'No code has been applied in Whop yet.',
  }
  const COUPON_LINE = 'This student already has a discount on their membership (evolve10).'
  const open = (query, size) => go(`/dev/admin/discounts${query}`, size)
  const waitReady = () => page.waitForSelector('[role="tablist"]', { timeout: 30000 })
  const row = (name) => page.evaluateHandle((n) => [...document.querySelectorAll('.list-row')].find((r) => r.querySelector('a')?.textContent === n) ?? null, name)
  const tabCounts = () => page.$$eval('[role="tab"]', (ts) => ts.map((t) => `${t.childNodes[0].textContent.trim()} ${t.querySelector('span')?.textContent.trim() ?? ''}`.trim()))
  const names = () => page.$$eval('.list-row', (rs) => rs.map((r) => r.querySelector('a')?.textContent))
  const rowText = (h) => h.evaluate((r) => r.innerText)
  const linkIn = (h) => buttonIn(h, 'Approve anyway')

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
      const label = `30% off, one student unreadable, Applied, ${w}x${h}`
      console.log(`\n${label}`)
      await open('?state=partial&tab=applied', size)
      await waitReady()
      const nina = await row('Nina Petrova')
      expect(await nina.evaluate((r) => r.textContent.includes("Couldn't read this student's progress, so there is no verdict.") && !/\d+ of 61 videos/.test(r.textContent)),
        `${label}: the row says there is no verdict, in words, and shows no count`)
      expect((await (await buttonIn(nina, 'Approve')).evaluate((b) => b.disabled)) && !(await isNull(await linkIn(nina))), `${label}: Approve disabled, the Approve anyway link offered`)
      await check(label, `thirty-partial-applied-${w}`)
    }
    {
      const label = `30% off, the videos unreadable, Applied, ${w}x${h}`
      console.log(`\n${label}`)
      await open('?state=novideos&tab=applied', size)
      await waitReady()
      expect((await bodyText()).includes("Couldn't read the course's videos, so no request has a verdict. Press Refresh to try again."), `${label}: the warning above the list`)
      const verdicts = await page.$$eval('.list-row', (rs) => rs.map((r) => ({ name: r.querySelector('a')?.textContent, none: r.textContent.includes("Couldn't read this student's progress, so there is no verdict. Press Refresh to try again."), coupon: r.textContent.includes('already has a discount on their membership') })))
      expect(verdicts.length === 8 && verdicts.every((v) => (v.name === 'Tara Quinn' ? v.coupon && !v.none : v.none && !v.coupon)),
        `${label}: every pending row says there is no verdict, but Tara's, whose coupon decides without the videos`, JSON.stringify(verdicts))
      await check(label, `thirty-novideos-applied-${w}`)
    }
    {
      const label = `30% off, the coupons unreadable, Applied, ${w}x${h}`
      console.log(`\n${label}`)
      await open('?state=nocoupons&tab=applied', size)
      await waitReady()
      expect((await bodyText()).includes("Couldn't read the membership coupons, so no row shows one. Approve still asks Whop before it makes a code."), `${label}: the warning above the list`)
      const tara = await row('Tara Quinn')
      expect(!(await rowText(tara)).includes('already has a discount') && !(await (await buttonIn(tara, 'Approve')).evaluate((b) => b.disabled)),
        `${label}: Tara's row shows the rule's yes, Approve on (the approve route asks Whop itself)`)
      await check(label, `thirty-nocoupons-applied-${w}`)
    }
    {
      const label = `30% off, the tabs and taps, ${w}x${h}`
      console.log(`\n${label}`)
      await open('', size)
      await waitReady()
      const tabs = await page.$$eval('[role="tab"]', (ts) => ts.map((t) => { const r = t.getBoundingClientRect(); return { label: t.childNodes[0].textContent.trim(), left: r.left, right: r.right, h: r.height, width: innerWidth, on: t.getAttribute('aria-selected') } }))
      expect(tabs.map((t) => t.label).join() === 'Applied,Approved,Rejected,Code Applied' && tabs[0].on === 'true',
        `${label}: the tabs are Applied, Approved, Rejected, Code Applied, Applied open first`, tabs.map((t) => t.label).join())
      expect(tabs.length === 4 && tabs.every((t) => t.left >= 0 && t.right <= t.width && t.h >= 44),
        `${label}: all four tabs whole in the window, 44px tall (they wrap on a phone)`, JSON.stringify(tabs.map((t) => Math.round(t.right))))
      expect(JSON.stringify(await tabCounts()) === JSON.stringify(['Applied 8', 'Approved 2', 'Rejected 3', 'Code Applied 2']),
        `${label}: each with its count; the September request is on none`, (await tabCounts()).join(' | '))
      const small = await smallTaps()
      expect(small.length === 0, `${label}: every button, tab and link styled as one is 44px tall or more, the Approve anyway link too`, JSON.stringify(small.slice(0, 4)))
      const order = await names()
      expect(JSON.stringify(order) === JSON.stringify(['Leo Hartmann', 'Sofia Marin', 'Tara Quinn', 'Hugo Lindahl', 'Maya Lindqvist', 'Jonah Pereira', 'Maximilian Featherstonehaugh-Smythe', 'Priya Raman']),
        `${label}: Applied, the oldest first`, order.join(', '))
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

  console.log('\n30% off: every tab oldest first, and the old tab names still open theirs')
  {
    for (const [tab, want] of [
      ['approved', ['Ethan Cole', 'Nora Brandt']],
      ['rejected', ['Ruby Okafor', 'Felix Moreau', 'Maximilian Featherstonehaugh-Smythe']],
      ['code-applied', ['Omar Haddad', 'Lena Vogel']],
    ]) {
      await open(`?tab=${tab}`)
      await waitReady()
      const got = await names()
      expect(JSON.stringify(got) === JSON.stringify(want), `${tab}: ${want.join(', ')}, the oldest first`, got.join(', '))
    }
    for (const [old, now] of [['decide', 'Applied'], ['code-added', 'Code Applied']]) {
      await open(`?tab=${old}`)
      await waitReady()
      const on = await page.$eval('[role="tab"][aria-selected="true"]', (t) => t.childNodes[0].textContent.trim())
      expect(on === now, `?tab=${old}, a link from before admin rebuild 2, opens ${now}`, on)
    }
  }

  console.log('\n30% off: a row is the student, the date applied, the verdict, the coupon and the actions, and nothing else (D4)')
  {
    await open('')
    await waitReady()
    const text = await bodyText()
    expect(!/\b(Monthly|Yearly|Other plan)\b/.test(text) && !/subscription/i.test(text), 'no plan pill and no "subscription" anywhere on the page')
    expect(!/Open in Discord|Copy @|No Discord linked|Survey answers|Can still earn|Mark messaged|No message yet|Messaged |Deadline |Paid |Whop progress not pulled yet/.test(text),
      'no Discord buttons, survey answers, Can still earn, last contact, Mark messaged, deadline or payment facts, and no "not pulled" pill')
    const maya = await row('Maya Lindqvist')
    const head = await maya.evaluate((r) => {
      const top = r.firstElementChild
      return { link: top.querySelector('a')?.getAttribute('href'), parts: [...top.children].map((c) => c.textContent.trim()) }
    })
    expect(head.link === '/admin/students/p-maya' && JSON.stringify(head.parts) === JSON.stringify(['Maya Lindqvist', '@maya.lq', 'Active']),
      'the top line: the name (to the student page), @username, Active', JSON.stringify(head))
    expect((await rowText(maya)).includes('Applied Mon 19 Oct') && (await rowText(maya)).includes('Every video up to the checkpoint was done in time.') && (await rowText(maya)).includes('61 of 61 videos'),
      'then the date applied and the verdict line with the count', await rowText(maya))
    const priyaHead = await (await row('Priya Raman')).evaluate((r) => [...r.firstElementChild.children].map((c) => c.textContent.trim()))
    expect(JSON.stringify(priyaHead) === JSON.stringify(['Priya Raman', 'Payment failed']), 'a member whose payment failed, with no @username: name and "Payment failed"', JSON.stringify(priyaHead))
    const priya = await rowText(await row('Priya Raman'))
    expect(priya.includes('Not every video up to the checkpoint is done yet.') && priya.includes('57 of 61 videos') && priya.includes('Whop progress not pulled since the switch'),
      'Priya: why not, the count, and that her Whop progress is not in yet, on the verdict line', priya)
    expect((await rowText(await row('Sofia Marin'))).includes('Asked on the old course, before the switch.'), 'Sofia: asked on the old course, and the verdict says so')
    expect((await rowText(await row('Leo Hartmann'))).includes('The first payment was before Thu 1 Oct, so this student cannot earn the 30%.') && (await rowText(await row('Leo Hartmann'))).includes('Canceled'),
      'Leo: a first payment before 1 October, a canceled membership')
    const approvable = await page.$$eval('.list-row', (rs) => rs.map((r) => {
      const b = [...r.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Approve')
      const link = [...r.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Approve anyway')
      return { name: r.querySelector('a')?.textContent, yes: r.textContent.includes('Every video up to the checkpoint was done in time.'), open: !!b && !b.disabled, link: !!link }
    }))
    expect(approvable.every((a) => a.yes === a.open) && approvable.filter((a) => a.open).map((a) => a.name).join() === 'Hugo Lindahl,Maya Lindqvist,Jonah Pereira',
      'Approve is on exactly where the verdict is yes: Hugo, Maya, Jonah', JSON.stringify(approvable))
    expect(approvable.filter((a) => a.link).map((a) => a.name).join() === 'Leo Hartmann,Sofia Marin,Maximilian Featherstonehaugh-Smythe,Priya Raman',
      'the Approve anyway link after every refusal but the coupon\'s: Leo, Sofia, Max, Priya, never Tara', approvable.filter((a) => a.link).map((a) => a.name).join())
    const tara = await row('Tara Quinn')
    expect((await rowText(tara)).includes(COUPON_LINE) && (await (await buttonIn(tara, 'Approve')).evaluate((b) => b.disabled)) && (await isNull(await linkIn(tara))) && !(await rowText(tara)).includes('videos'),
      'Tara, every video done and evolve10 on her membership: the coupon\'s line, Approve off, no Approve anyway, no count', await rowText(tara))
    const link = await (await linkIn(await row('Priya Raman'))).evaluate((b) => {
      const cs = getComputedStyle(b)
      const r = b.getBoundingClientRect()
      return { bg: cs.backgroundColor, border: cs.borderTopStyle, underline: cs.textDecorationLine, size: cs.fontSize, h: Math.round(r.height) }
    })
    expect(link.bg === 'rgba(0, 0, 0, 0)' && link.border === 'none' && link.underline === 'underline' && link.size === '13px' && link.h >= 44,
      'Approve anyway is a small link: no fill, no border, underlined 13px words, a 44px target', JSON.stringify(link))
    await viewport([1440, 900])
    await check('30% off, Applied, the verdicts and the coupon, 1440x900', 'thirty-applied-rows-1440')
  }

  console.log('\n30% off: Approve on the rule\'s yes, and on Hugo, whose coupon Whop names only now (D5)')
  {
    await open('')
    await waitReady()
    await press(await buttonIn(await row('Jonah Pereira'), 'Approve'))
    await page.waitForFunction(() => document.body.innerText.includes('Approved Jonah Pereira.'), { timeout: 10000 })
    await settled()
    const made = await calls()
    expect(made.filter((c) => c.name === 'approve').map((c) => JSON.stringify(c.args)).join() === '["r-jonah",false]',
      'Approve on Jonah: one approve call, without override', JSON.stringify(made.map((c) => c.name)))
    let counts = await tabCounts()
    expect(counts[0] === 'Applied 7' && counts[1] === 'Approved 3', 'Jonah moves from Applied to Approved', counts.join(' | '))

    await press(await buttonIn(await row('Hugo Lindahl'), 'Approve'))
    await page.waitForFunction(() => document.body.innerText.includes('Hugo Lindahl: This student already has a discount on their membership'), { timeout: 10000 })
    await settled()
    const notice = await page.$eval('[role="alert"]', (e) => ({ text: e.textContent, copy: [...e.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Copy code') }))
    expect(notice.text.startsWith(`Hugo Lindahl: ${COUPON_LINE}`) && !notice.copy,
      'Whop says now that evolve10 applies: the approve route\'s own sentence, naming the code, with nothing to copy', JSON.stringify(notice))
    const hugo = await row('Hugo Lindahl')
    expect((await rowText(hugo)).includes(COUPON_LINE) && (await (await buttonIn(hugo, 'Approve')).evaluate((b) => b.disabled)) && (await isNull(await linkIn(hugo))),
      'the list is read again: Hugo\'s row now shows the coupon, Approve off, no Approve anyway after it')
    counts = await tabCounts()
    expect(counts[0] === 'Applied 7' && counts[1] === 'Approved 3', 'and he stays on Applied, nothing approved', counts.join(' | '))
    for (const size of SIZES) {
      await viewport(size)
      await check(`30% off, Approve refused for the coupon, ${size.join('x')}`, `thirty-coupon-refused-${size[0]}`)
    }
  }

  console.log('\n30% off: Approve anyway, the small link, an inline confirm, then the call with override')
  {
    await open('')
    await waitReady()
    await press(await linkIn(await row('Priya Raman')))
    await page.waitForFunction(() => document.body.innerText.includes('Approve anyway skips the 30% rule'))
    expect(!(await calls()).some((c) => c.name === 'approve'), 'the first click opens the confirm and calls nothing')
    const confirmText = await page.evaluate(() => [...document.querySelectorAll('p')].find((p) => p.textContent.startsWith('Approve anyway skips'))?.textContent)
    expect(confirmText === "Approve anyway skips the 30% rule and creates the student's Whop code now. A discount already on the student's membership still stops it.",
      'the confirm says what it skips, and what it does not', confirmText)
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
    const counts = await tabCounts()
    expect(counts[0] === 'Applied 7' && counts[1] === 'Approved 3', 'Priya moves from Applied to Approved', counts.join(' | '))
  }

  console.log('\n30% off: Reject, its reason, and what the student sees')
  {
    await open('')
    await waitReady()
    await press(await buttonIn(await row('Jonah Pereira'), 'Reject'))
    await page.waitForSelector('input[placeholder^="For example"]')
    expect((await bodyText()).includes('The student sees this reason on their map, and cannot ask for the 30% again.'), 'the panel says the student sees the reason and cannot ask again')
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
    const counts = await tabCounts()
    expect(counts[0] === 'Applied 7' && counts[2] === 'Rejected 4', 'Jonah moves to Rejected', counts.join(' | '))
  }

  console.log('\n30% off: a 409 on approve and on reject')
  {
    await open('?conflict=1')
    await waitReady()
    await press(await buttonIn(await row('Maya Lindqvist'), 'Approve'))
    await page.waitForFunction(() => document.body.innerText.includes('this request had already been decided, so the code must be deleted in Whop.'), { timeout: 10000 })
    await settled()
    expect((await calls()).filter((x) => x.name === 'loadThirty').length === 2, 'approve answered 409: its sentence is shown and the list is read again')
    expect(await isNull(await row('Maya Lindqvist')), 'Maya is off Applied: another member decided it')
    const notice = await page.$eval('[role="alert"]', (e) => ({ text: e.textContent, copy: [...e.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Copy code') }))
    expect(notice.text.startsWith('Maya Lindqvist: The Whop code ECOM30-') && notice.copy, 'the notice names the student and the code to delete, with Copy code', JSON.stringify(notice))
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
    expect(await isNull(await row('Jonah Pereira')), 'reject answered 409: its sentence is shown, the list read again, Jonah off Applied')
  }

  console.log('\n30% off: a decision goes through, then the list cannot be read again')
  {
    const STALE = "Couldn't refresh the list, so it may be out of date. Press Refresh."
    await open('?reload=fail')
    await waitReady()
    await press(await buttonIn(await row('Maya Lindqvist'), 'Approve'))
    await page.waitForFunction((t) => document.body.innerText.includes(t), { timeout: 10000 }, STALE)
    await settled()
    const said = await page.evaluate(() => ({
      status: [...document.querySelectorAll('[role="status"]')].map((e) => e.textContent),
      alert: [...document.querySelectorAll('[role="alert"]')].map((e) => e.textContent),
    }))
    expect(said.status.some((t) => t.startsWith('Approved Maya Lindqvist. The code ECOM30-')) && said.alert.some((t) => t.startsWith(STALE)),
      'the approval and its code in a notice of their own, the list being out of date on a line of its own', JSON.stringify(said))
    const maya = await row('Maya Lindqvist')
    expect((await (await buttonIn(maya, 'Approve')).evaluate((b) => b.disabled)) && (await (await buttonIn(maya, 'Reject')).evaluate((b) => b.disabled))
      && (await maya.evaluate((r) => r.textContent.includes('Saved. Press Refresh to see this row as it is now.'))),
      "Maya's row, still shown as it was, keeps its buttons off until a read works")
    for (const size of SIZES) {
      await viewport(size)
      await check(`30% off, the reload failed, ${size.join('x')}`, `thirty-reload-failed-${size[0]}`)
    }
  }

  console.log('\n30% off: Approved, the code, a coupon to check first, and Mark code applied')
  {
    await open('?tab=approved')
    await waitReady()
    const ethan = await row('Ethan Cole')
    const e = await rowText(ethan)
    expect(e.includes('ECOM30-3F9A21') && e.includes('Applied Sat 17 Oct') && e.includes('Approved Sun 18 Oct by Robin') && !(e.includes('already has a discount')),
      'Ethan: the code, the date applied, who approved it and when', e)
    expect(!(await isNull(await buttonIn(ethan, 'Copy'))) && !(await isNull(await buttonIn(ethan, 'Mark code applied'))), 'with Copy and Mark code applied')
    const nora = await rowText(await row('Nora Brandt'))
    expect(nora.includes(`${COUPON_LINE} Check Whop before you add the 30% code.`),
      'Nora, approved before the coupon rule, evolve10 on her membership: a line to check Whop before adding the code', nora)
    for (const size of SIZES) {
      await viewport(size)
      await check(`30% off, Approved, ${size.join('x')}`, `thirty-approved-${size[0]}`)
    }
    await viewport([1280, 720])
    await press(await buttonIn(ethan, 'Mark code applied'))
    await page.waitForFunction(() => document.body.innerText.includes('Marked the code as applied in Whop for Ethan Cole.'), { timeout: 10000 })
    await settled()
    const counts = await tabCounts()
    expect(counts[1] === 'Approved 1' && counts[3] === 'Code Applied 3', 'Ethan moves to Code Applied', counts.join(' | '))
    await open('?tab=code-applied')
    await waitReady()
    const omar = await rowText(await row('Omar Haddad'))
    expect(omar.includes('Applied Tue 13 Oct · Approved Wed 14 Oct by Robin · Code applied Thu 15 Oct by Jamie') && omar.includes('ECOM30-A1D9E0') && !omar.includes('Mark code applied'),
      'Code Applied: the three dates and who, the code to copy, nothing to press', omar)
    await open('?tab=rejected')
    await waitReady()
    const ruby = await rowText(await row('Ruby Okafor'))
    const felix = await rowText(await row('Felix Moreau'))
    expect(ruby.includes('Applied Wed 14 Oct · Rejected Thu 15 Oct by Robin') && ruby.includes('Reason: The ads were not handed in.') && felix.includes('No reason given.'),
      'Rejected: the dates, who, and the reason or "No reason given."', `${ruby} | ${felix}`)
  }

  console.log('\n30% off: ?student= keeps every tab to one student')
  {
    await open('?student=p-ethan')
    await waitReady()
    expect(JSON.stringify(await tabCounts()) === JSON.stringify(['Applied 0', 'Approved 1', 'Rejected 0', 'Code Applied 0']),
      'Ethan: every tab counts him alone', (await tabCounts()).join(' | '))
    expect((await page.$eval('[role="tab"][aria-selected="true"]', (t) => t.textContent)).startsWith('Approved'), 'the first tab that has him opens')
    expect((await bodyText()).includes('Showing Ethan Cole only.'), 'the banner names him')
    for (const size of SIZES) {
      await viewport(size)
      await check(`30% off, one student, ${size.join('x')}`, `thirty-student-${size[0]}`)
    }
    await viewport([1280, 720])
    await page.$$eval('[role="tab"]', (ts) => ts.find((t) => t.textContent.startsWith('Applied')).click())
    await sleep(200)
    expect((await bodyText()).includes('This student has nothing on this tab.'), 'Applied, filtered: nothing for him')
    expect(page.url().includes('student=p-ethan') && page.url().includes('tab=applied'), 'the address keeps the student and the tab', page.url())
    await press(await button('Show everyone'))
    await sleep(300)
    const all = await tabCounts()
    expect(all[0] === 'Applied 8' && !page.url().includes('student='), 'Show everyone: the filter goes, the tab stays', `${all.join(' | ')} ${page.url()}`)
  }
  const errs = newConsoleErrors(from)
  expect(errs.length === 0, '30% off: no error in the browser console', errs.slice(0, 3).join(' || '))
}

// ════════════════════════════════════════════════════════════════════════════
// dash: /dev/admin/dashboard (admin rebuild 2, WI-2)
// ════════════════════════════════════════════════════════════════════════════
if (wanted('dash')) {
  const from = consoleErrors.length
  const TILES = ['month2', 'bounty', 'open-tasks', 'to-decide', 'active', 'canceling', 'churned', 'avg-progress']
  const open = (query, size) => go(`/dev/admin/dashboard${query}`, size)
  const ready = () => page.waitForFunction(() => /Updated \d\d:\d\d/.test(document.body.innerText), { timeout: 30000 })
  /** Each tile: its words, whether it shows a number, whether it says it could not load. */
  const tiles = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-tile]')].map((t) => [t.dataset.tile, {
    text: t.innerText.replace(/\s+/g, ' ').trim(),
    numbers: [...t.querySelectorAll('[data-number]')].map((n) => n.textContent.trim()),
    failed: !!t.querySelector('[data-failed]'),
    href: t.getAttribute('href'),
  }])))
  /** The rows of a chart's table for screen readers, in a tile. */
  const tableOf = (tile) => page.evaluate((name) => [...document.querySelectorAll(`[data-tile="${name}"] tbody tr`)].map((r) => r.innerText.replace(/\s+/g, ' ').trim()), tile)
  const dashCalls = () => page.evaluate(() => (window.__dashCalls ?? []).map((c) => c.name))
  const refreshButton = () => page.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => /^↻?\s*Refresh/.test(b.textContent.trim())) || null)

  for (const size of SIZES) {
    const [w, h] = size
    {
      const label = `Dashboard, full (20 Oct, before the first renewals), ${w}x${h}`
      console.log(`\n${label}`)
      await open('?state=full', size)
      await ready()
      await check(label, `dash-full-${w}`)
      const t = await tiles()
      expect(TILES.every((k) => t[k] && !t[k].failed), `${label}: all 8 tiles, none failed`, JSON.stringify(Object.keys(t)))
      expect(t.month2.text.includes('First renewals from Mon 9 Nov') && t.month2.text.includes('paid since Fri 9 Oct') && t.month2.text.includes('Sun 15 Nov')
        && !/\d%/.test(t.month2.text), `${label}: Month 2 waits for the first renewals, with the dates, and shows no rate (no 0%, no old 61%)`, t.month2.text.slice(0, 160))
      expect(t['open-tasks'].numbers[0] === '95' && t['open-tasks'].href === '/admin/tasks' && t['to-decide'].numbers[0] === '3' && t['to-decide'].href === '/admin/discounts',
        `${label}: Open tasks 95, links to Tasks; 30% to decide 3, links to the 30% page`, JSON.stringify([t['open-tasks'].numbers, t['to-decide'].numbers]))
      const avgRows = await tableOf('avg-progress')
      expect(t['avg-progress'].numbers[0] === '2.7%' && JSON.stringify(avgRows) === JSON.stringify(['Mon 19 Oct 2.66%', 'Tue 20 Oct 2.71%']),
        `${label}: Avg progress 2.7%, its line from the switch only (19 and 20 Oct, no 36%)`, JSON.stringify([t['avg-progress'].numbers, avgRows]))
      expect((await tableOf('active')).length === 14 && (await tableOf('churned')).length === 14, `${label}: the other lines hold the 14 days`)
      expect(!(await isNull(await refreshButton())), `${label}: a founder has Refresh`)
      const small = await smallTaps()
      expect(small.length === 0, `${label}: every button is 44px tall or more`, JSON.stringify(small.slice(0, 4)))
    }
    {
      const label = `Dashboard, renewed (24 Nov, the first rates in), ${w}x${h}`
      console.log(`\n${label}`)
      await open('?state=renewed', size)
      await ready()
      await check(label, `dash-renewed-${w}`)
      const t = await tiles()
      expect(/^\d+%$/.test(t.month2.numbers[0] ?? '') && t.month2.text.includes('still paying after their first renewal'),
        `${label}: Month 2 shows its rate`, JSON.stringify(t.month2.numbers))
      const m2 = await tableOf('month2')
      expect(m2.length === 14 && m2[0] === 'Wed 11 Nov Nobody past a renewal yet' && /^Tue 24 Nov \d+%$/.test(m2[13]) && m2[13].endsWith(t.month2.numbers[0]),
        `${label}: its line: no rate before anyone resolved, and the last day is the big number`, JSON.stringify([m2[0], m2[13]]))
      expect(t['open-tasks'].text.includes('Created since the reset, Wed 21 Oct'), `${label}: Open tasks count from the tasks reset`, t['open-tasks'].text)
    }
    {
      const label = `Dashboard, empty, ${w}x${h}`
      console.log(`\n${label}`)
      await open('?state=empty', size)
      await ready()
      await check(label, `dash-empty-${w}`)
      const t = await tiles()
      expect(t['open-tasks'].text.includes('All caught up') && t['to-decide'].text.includes('Nothing to decide') && t.month2.text.includes('No first payment since Fri 9 Oct yet')
        && t['avg-progress'].text.includes('No snapshot since the switch') && t.churned.text.includes('No snapshot in these 14 days') && !t.churned.numbers.length,
        `${label}: each tile says what nothing means, and Churned shows no 0 without a snapshot`)
    }
    {
      const label = `Dashboard, partial (the open tasks and the snapshots fail), ${w}x${h}`
      console.log(`\n${label}`)
      await open('?state=partial', size)
      await ready()
      await check(label, `dash-partial-${w}`)
      const t = await tiles()
      const down = ['open-tasks', 'churned', 'avg-progress']
      expect(down.every((k) => t[k].failed && t[k].numbers.length === 0 && t[k].text.includes("Couldn't load")),
        `${label}: Open tasks, Churned and Avg progress say "Couldn't load" and show no number`, JSON.stringify(down.map((k) => t[k].numbers)))
      expect(t['to-decide'].numbers[0] === '3' && !t.active.failed && t.active.numbers.length === 1 && t.active.text.includes("Couldn't load the line"),
        `${label}: the rest stands; Active keeps its number and says its line could not load`)
      const alert = await page.$eval('[role="alert"]', (e) => e.innerText)
      expect(alert.includes('Some numbers couldn\'t load.') && alert.includes('Open tasks: permission denied for table tasks') && alert.includes('Daily snapshots:') && alert.includes('Retry'),
        `${label}: one line at the top names each failed read, with Retry`, alert.replace(/\s+/g, ' '))
    }
    {
      const label = `Dashboard, error (every read fails), ${w}x${h}`
      console.log(`\n${label}`)
      await open('?state=error', size)
      await ready()
      await check(label, `dash-error-${w}`)
      const t = await tiles()
      expect(TILES.every((k) => t[k].failed && t[k].numbers.length === 0), `${label}: all 8 tiles "Couldn't load", not one number`, JSON.stringify(TILES.map((k) => t[k].numbers)))
      expect((await page.$eval('[role="alert"]', (e) => e.innerText)).includes("Couldn't load the dashboard."), `${label}: the line at the top says nothing could load`)
    }
    {
      const label = `Dashboard, loading, ${w}x${h}`
      console.log(`\n${label}`)
      await open('?state=loading', size)
      await page.waitForSelector('.animate-pulse')
      expect((await page.$('.animate-spin')) === null && (await bodyText()).includes('Loading'), `${label}: skeletons, no spinner`)
      await check(label, `dash-loading-${w}`)
    }
  }

  console.log('\nDashboard: the readouts, How it\'s counted, Retry')
  {
    await open('?state=full', [1280, 720])
    await ready()
    // Pointer: the middle of the Bounty chart shows that day.
    const bars = await page.$('[data-tile="bounty"] [aria-roledescription="chart"]')
    const box = await bars.boundingBox()
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5)
    await sleep(150)
    const readout = await page.evaluate(() => document.querySelector('[data-tile="bounty"] [aria-live="polite"]').textContent)
    const tip = await page.evaluate(() => [...document.querySelectorAll('[data-tile="bounty"] [aria-roledescription="chart"] > div[aria-hidden="true"]')].map((d) => d.innerText.trim()).filter(Boolean).pop() ?? '')
    expect(/^\w{3} \d{1,2} Oct: \d+$/.test(readout) && tip.includes(readout.split(': ')[1]) && tip.includes(readout.split(': ')[0]),
      `the pointer over the Bounty chart reads that day: "${readout}", and the readout box says the same`, tip)
    await check('Dashboard, the Bounty readout open, 1280x720', 'dash-readout-bounty-1280')
    await page.mouse.move(5, 5)
    await sleep(100)
    expect(await page.evaluate(() => document.querySelector('[data-tile="bounty"] [aria-live="polite"]').textContent === ''), 'it goes when the pointer leaves')
    // Keyboard: the Active chart, from the last day back one.
    await page.$eval('[data-tile="active"] [aria-roledescription="chart"]', (c) => c.focus())
    await sleep(100)
    const last = await page.evaluate(() => document.querySelector('[data-tile="active"] [aria-live="polite"]').textContent)
    await page.keyboard.press('ArrowLeft')
    await sleep(100)
    const before = await page.evaluate(() => document.querySelector('[data-tile="active"] [aria-live="polite"]').textContent)
    expect(last.startsWith('Tue 20 Oct: ') && before.startsWith('Mon 19 Oct: '), `the keyboard reads the Active line: "${last}", then "${before}"`)
    await page.keyboard.press('Escape')
    // How it's counted, on Avg progress.
    const how = await page.$('[data-tile="avg-progress"] button[aria-controls]')
    expect((await how.evaluate((b) => b.getAttribute('aria-label'))) === 'How Avg progress is counted', 'Avg progress has its "How it\'s counted" button')
    const tileHeights = () => page.$$eval('[data-tile]', (ts) => ts.map((t) => Math.round(t.getBoundingClientRect().height)).join(','))
    const heightsShut = await tileHeights()
    await how.click()
    await sleep(100)
    expect((await tileHeights()) === heightsShut, 'the rule floats over its tile: no tile changes height, no line drops to a tile\'s foot', `${heightsShut} / ${await tileHeights()}`)
    const panel = await page.evaluate(() => {
      const b = document.querySelector('[data-tile="avg-progress"] button[aria-controls]')
      const p = document.getElementById(b.getAttribute('aria-controls'))
      return { expanded: b.getAttribute('aria-expanded'), shown: !p.hidden, text: p.innerText }
    })
    expect(panel.expanded === 'true' && panel.shown && panel.text.startsWith('One number for the tile and its line'), "it opens the rule, which says it is one metric for the number and the line", panel.text.slice(0, 80))
    await check("Dashboard, Avg progress's rule open, 1280x720", 'dash-how-avg-1280')
    const ruleState = () => page.evaluate(() => {
      const b = document.querySelector('[data-tile="avg-progress"] button[aria-controls]')
      return { expanded: b.getAttribute('aria-expanded'), hidden: document.getElementById(b.getAttribute('aria-controls')).hidden, focused: document.activeElement === b }
    })
    await page.keyboard.press('Escape')
    await sleep(100)
    const afterEscape = await ruleState()
    expect(afterEscape.expanded === 'false' && afterEscape.hidden && afterEscape.focused, 'Escape closes it, and the focus is back on its button', JSON.stringify(afterEscape))
    await how.click()
    await sleep(100)
    await page.mouse.click(20, 400)
    await sleep(100)
    const afterOutside = await ruleState()
    expect(afterOutside.expanded === 'false' && afterOutside.hidden, 'a press outside it closes it', JSON.stringify(afterOutside))
    // On a phone a trend tile is about 173px wide: the rule opens wider than it, inside the window.
    await open('?state=full', [390, 844])
    await ready()
    for (const name of ['active', 'avg-progress']) {
      await press(await page.$(`[data-tile="${name}"] button[aria-controls]`))
      await sleep(150)
      const box = await page.evaluate((t) => {
        const b = document.querySelector(`[data-tile="${t}"] button[aria-controls]`)
        const r = document.getElementById(b.getAttribute('aria-controls')).getBoundingClientRect()
        return { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width), room: document.documentElement.clientWidth }
      }, name)
      expect(box.width >= 300 && box.left >= 0 && box.right <= box.room, `on a phone, ${name}'s rule is ${box.width}px wide and inside the window (${box.left} to ${box.right})`, JSON.stringify(box))
      await check(`Dashboard, ${name}'s rule open, 390x844`, `dash-how-${name}-390`)
      await page.keyboard.press('Escape')
      await sleep(100)
    }
    await open('?state=error', [1280, 720])
    await ready()
    const loadsBefore = (await dashCalls()).filter((c) => c === 'load').length
    await press(await button('Retry'))
    await page.waitForFunction((n) => (window.__dashCalls ?? []).filter((c) => c.name === 'load').length > n, { timeout: 10000 }, loadsBefore)
    expect(true, 'Retry reads everything again')
  }

  console.log('\nDashboard: Refresh')
  {
    await open('?state=full', [1280, 720])
    await ready()
    const loadsBefore = (await dashCalls()).filter((c) => c === 'load').length
    await press(await refreshButton())
    await page.waitForFunction(() => [...document.querySelectorAll('[role="status"]')].some((e) => e.textContent.includes('snapshots rebuilt')), { timeout: 15000 })
    const note = await page.evaluate(() => [...document.querySelectorAll('[role="status"]')].map((e) => e.textContent).find((t) => t.includes('snapshots rebuilt')))
    const calls = await dashCalls()
    expect(note === 'Whop synced, 3 new and 118 updated · snapshots rebuilt · 4 new tasks · 2 alerts', `Refresh says what each step did: "${note}"`)
    await page.waitForFunction((n) => (window.__dashCalls ?? []).filter((c) => c.name === 'load').length > n, { timeout: 10000 }, loadsBefore)
    expect(calls.includes('refresh'), 'one refresh call, then the numbers are read again', JSON.stringify(calls))
    await check('Dashboard, after Refresh, 1280x720', 'dash-refreshed-1280')

    await open('?state=full&refresh=fail', [1280, 720])
    await ready()
    await press(await refreshButton())
    await page.waitForFunction(() => [...document.querySelectorAll('[role="alert"]')].some((e) => e.textContent.startsWith('Refresh failed')), { timeout: 15000 })
    const refusal = await page.evaluate(() => [...document.querySelectorAll('[role="alert"]')].map((e) => e.textContent).find((t) => t.startsWith('Refresh failed')))
    expect(refusal === 'Refresh failed: Founder or admin role required', `a refusal is said in the route's words: "${refusal}"`)

    await open('?state=full&refresh=partial', [1280, 720])
    await ready()
    await press(await refreshButton())
    await page.waitForFunction(() => document.body.innerText.includes('Whop sync failed: HTTP 502'), { timeout: 15000 })
    expect(true, 'a step that failed inside a 200 is said: "Whop sync failed: HTTP 502"')

    for (const size of SIZES) {
      await open('?state=full&role=csm', size)
      await ready()
      expect(await isNull(await refreshButton()), `a csm has no Refresh (the route refuses one), ${size.join('x')}`)
      await check(`Dashboard, a csm, ${size.join('x')}`, `dash-csm-${size[0]}`)
    }
  }
  const errs = newConsoleErrors(from)
  expect(errs.length === 0, 'Dashboard: no error in the browser console', errs.slice(0, 3).join(' || '))
}

// ════════════════════════════════════════════════════════════════════════════
// tasks and people: admin rebuild 2's lane WI-5 and WI-6 (Tasks, its
// insights, All students, a student's page, the Student journey), on their
// dev pages (src/app/dev/admin/fixtures-people.ts, made-up people only)
// ════════════════════════════════════════════════════════════════════════════
const peopleCalls = () => page.evaluate(() => (window.__peopleCalls ?? []).map((c) => ({ name: c.name, args: c.args })))
const rowWith = (text) => page.evaluateHandle((t) => [...document.querySelectorAll('.list-row')].find((r) => r.textContent.includes(t)) ?? null, text)
/** Each tab's words, its label and its count apart: "To do 6". */
const tabTexts = () => page.$$eval('[role="tab"]', (ts) => ts.map((t) => [...t.childNodes].map((n) => n.textContent.trim()).filter(Boolean).join(' ')))
/** Bold words glued to the next word ("switcharchived"): a space lost in the JSX. */
const gluedBold = () => page.evaluate(() => [...document.querySelectorAll('main strong, main b')]
  .filter((b) => { const n = b.nextSibling; return n && n.nodeType === 3 && /^[A-Za-z0-9]/.test(n.textContent) })
  .map((b) => `${b.textContent}|${b.nextSibling.textContent.slice(0, 12)}`))
const waitText = (text, timeout = 15000) => page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text)

if (wanted('tasks')) {
  const from = consoleErrors.length
  const ready = () => page.waitForSelector('[role="tablist"]', { timeout: 30000 })
  for (const size of SIZES) {
    const [w, h] = size
    for (const [tab, query] of [['todo', ''], ['sent', '&tab=sent'], ['dismissed', '&tab=dismissed'], ['archived', '&tab=archived']]) {
      const label = `Tasks, full, ${tab}, ${w}x${h}`
      console.log(`\n${label}`)
      await go(`/dev/admin/tasks?state=full${query}`, size)
      await ready()
      await check(label, `tasks-full-${tab}-${w}`)
    }
    {
      const label = `Tasks, before the reset, ${w}x${h}`
      console.log(`\n${label}`)
      await go('/dev/admin/tasks?reset=none', size)
      await ready()
      const tabs = await tabTexts()
      expect(JSON.stringify(tabs) === JSON.stringify(['To do 6', 'Sent 3', 'Dismissed 5']), `${label}: no Archived tab, every task on the three lists`, JSON.stringify(tabs))
      await check(label, `tasks-no-reset-${w}`)
    }
    for (const state of ['empty', 'loading', 'error']) {
      const label = `Tasks, ${state}, ${w}x${h}`
      console.log(`\n${label}`)
      await go(`/dev/admin/tasks?state=${state}`, size)
      if (state === 'loading') {
        await page.waitForSelector('.animate-pulse')
        expect((await page.$('.animate-spin')) === null, `${label}: skeleton rows, no spinner`)
      } else if (state === 'error') {
        await page.waitForSelector('[role="alert"]')
        const text = await page.$eval('[role="alert"]', (e) => e.textContent)
        expect(text.includes("Couldn't load the tasks.") && text.includes('Retry'), `${label}: the error sentence and Retry`, text)
      } else {
        await ready()
        expect((await bodyText()).includes('Nothing to do.'), `${label}: "Nothing to do."`)
      }
      await check(label, `tasks-${state}-${w}`)
    }
  }

  console.log('\nTasks: the reset, To do and Archived')
  {
    await go('/dev/admin/tasks')
    await ready()
    expect(JSON.stringify(await tabTexts()) === JSON.stringify(['To do 6', 'Sent 2', 'Dismissed 2', 'Archived 4']),
      'after the reset: To do 6, Sent 2, Dismissed 2, Archived 4', JSON.stringify(await tabTexts()))
    const text = await bodyText()
    expect(text.includes('Open tasks made since the reset on Tue 20 Oct, 09:00 (Croatia time)') && text.includes('New program since Tue 20 Oct'),
      'To do says its tasks were made since the reset, in Croatia time')
    const heads = await page.$$eval('main section h2', (hs) => hs.map((h) => [...h.childNodes].map((n) => n.textContent.trim()).filter(Boolean).join(' ')))
    expect(JSON.stringify(heads) === JSON.stringify(['Canceling: save first 1', 'Cancel path 1', 'At risk 2', 'Events and wins 2']),
      'the tiers: canceling first, then cancel path, at risk, events and wins', JSON.stringify(heads))
    expect((await page.$$eval('.list-row', (rs) => rs.map((r) => r.querySelector('button')?.textContent))).join() === 'Sofia Marin,Priya Raman,Omar Haddad,Nora Brandt,Maya Lindqvist,Maximilian Featherstonehaugh-Smythe',
      'the longest wait first in each tier')
    const small = await smallTaps()
    expect(small.length === 0, 'To do: every button and tab 44px tall or more', JSON.stringify(small.slice(0, 4)))
    await page.$$eval('[role="tab"]', (ts) => ts.find((t) => t.textContent.startsWith('Archived')).click())
    await sleep(200)
    const archived = await page.$$eval('.list-row', (rs) => rs.map((r) => ({
      buttons: [...r.querySelectorAll('button')].map((b) => b.textContent.trim()),
      text: r.textContent,
    })))
    expect(archived.length === 4 && archived.every((r) => r.buttons.length === 1),
      'Archived: four rows, read only: the name opens the task, and nothing else is a button', JSON.stringify(archived.map((r) => r.buttons)))
    expect(archived.some((r) => r.text.includes('Dismissed Tue 20 Oct by the reset for the new program. Before it: checked twice'))
      && archived.some((r) => r.text.includes('Sent Mon 12 Oct, no reply')),
      'an archived row says how it was closed: by the reset (with the note before it), or sent with its reply')
    await press(await button('Leo Hartmann'))
    await page.waitForSelector('[role="dialog"]')
    const dialogButtons = await page.$$eval('[role="dialog"] button', (bs) => bs.map((b) => b.textContent.trim()))
    expect(JSON.stringify(dialogButtons) === JSON.stringify(['Close']), 'an archived task\'s detail has no Copy DM, Mark sent, Dismiss or Move to To do', JSON.stringify(dialogButtons))
    for (const size of SIZES) {
      await viewport(size)
      await check(`Tasks, an archived task's detail, ${size.join('x')}`, `tasks-archived-detail-${size[0]}`)
    }
    await viewport([1280, 720])
    await press(await button('Close'))
  }

  console.log('\nTasks: Mark sent, Dismiss, Move to To do, Replied')
  {
    await go('/dev/admin/tasks')
    await ready()
    await press(await buttonIn(await rowWith('Omar Haddad'), 'Mark sent'))
    await waitText('Marked the DM to Omar Haddad as sent.')
    await page.waitForFunction(() => [...document.querySelectorAll('[role="tab"]')].some((t) => t.textContent === 'To do5'))
    expect((await peopleCalls()).some((c) => c.name === 'transition' && c.args[0] === 't-04' && c.args[1] === 'completed'),
      'Mark sent on Omar: transition to completed, and To do reads 5')
    await press(await buttonIn(await rowWith('Nora Brandt'), 'Dismiss'))
    await page.waitForSelector('[role="dialog"] textarea')
    await press(await page.evaluateHandle(() => [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === 'Dismiss')))
    await waitText('Add a short reason first.')
    expect(!(await peopleCalls()).some((c) => c.name === 'transition' && c.args[1] === 'dismissed'), 'Dismiss with no reason asks for one and sends nothing')
    for (const size of SIZES) {
      await viewport(size)
      await check(`Tasks, the Dismiss dialog, ${size.join('x')}`, `tasks-dismiss-${size[0]}`)
    }
    await viewport([1280, 720])
    await page.type('[role="dialog"] textarea', 'Paid by the hour, will join on Monday')
    await press(await page.evaluateHandle(() => [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === 'Dismiss')))
    await waitText('Dismissed the task for Nora Brandt.')
    await page.waitForFunction(() => !document.querySelector('[role="dialog"]'), { timeout: 5000 })
    expect((await peopleCalls()).some((c) => c.name === 'transition' && c.args[0] === 't-03' && c.args[1] === 'dismissed' && c.args[2] === 'Paid by the hour, will join on Monday'),
      'then Dismiss sends the reason, and the dialog closes')
    await page.$$eval('[role="tab"]', (ts) => ts.find((t) => t.textContent.startsWith('Dismissed')).click())
    await sleep(200)
    expect((await bodyText()).includes('Dismissed Wed 21 Oct: Paid by the hour, will join on Monday'), 'Dismissed shows it with its reason')
    await press(await buttonIn(await rowWith('Ethan Cole'), 'Move to To do'))
    await waitText('Moved the task for Ethan Cole back to To do.')
    expect((await peopleCalls()).some((c) => c.name === 'transition' && c.args[0] === 't-09' && c.args[1] === 'open'), 'Move to To do on Ethan')
    await page.$$eval('[role="tab"]', (ts) => ts.find((t) => t.textContent.startsWith('Sent')).click())
    await sleep(200)
    await press(await buttonIn(await rowWith('Leo Hartmann'), 'Replied'))
    await waitText('Leo Hartmann replied.')
    const pressed = await (await rowWith('Leo Hartmann')).evaluate((r) => [...r.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Replied')?.getAttribute('aria-pressed'))
    expect(pressed === 'true' && (await peopleCalls()).some((c) => c.name === 'setOutcome' && c.args[0] === 't-08' && c.args[1] === 'replied'),
      'Replied on Leo: the outcome is sent and the button stays pressed')
    for (const size of SIZES) {
      await viewport(size)
      await check(`Tasks, Sent after Replied, ${size.join('x')}`, `tasks-sent-replied-${size[0]}`)
    }
    await viewport([1280, 720])
    await page.$$eval('[role="tab"]', (ts) => ts.find((t) => t.textContent.startsWith('To do')).click())
    await page.type('input[type="search"]', 'maya')
    await page.waitForFunction(() => document.querySelectorAll('.list-row').length === 1, { timeout: 10000 })
    expect((await peopleCalls()).some((c) => c.name === 'loadTasks' && c.args[0] === 'maya'), 'the search goes to the route, and To do shows Maya alone')
  }
  const errs = newConsoleErrors(from)
  expect(errs.length === 0, 'tasks: no error in the browser console', errs.slice(0, 3).join(' || '))
}

if (wanted('people')) {
  const from = consoleErrors.length
  const settledPage = () => page.waitForFunction(() => !document.querySelector('.animate-pulse'), { timeout: 30000 })

  // ── Outreach insights ──
  for (const size of SIZES) {
    const [w, h] = size
    for (const [name, query] of [['full', ''], ['no-reset', '?reset=none'], ['empty', '?state=empty']]) {
      const label = `Insights, ${name}, ${w}x${h}`
      console.log(`\n${label}`)
      await go(`/dev/admin/tasks/insights${query}`, size)
      await settledPage()
      await check(label, `insights-${name}-${w}`)
      expect((await gluedBold()).length === 0, `${label}: no bold word glued to the next`, JSON.stringify(await gluedBold()))
    }
    for (const state of ['loading', 'error']) {
      const label = `Insights, ${state}, ${w}x${h}`
      console.log(`\n${label}`)
      await go(`/dev/admin/tasks/insights?state=${state}`, size)
      if (state === 'loading') await page.waitForSelector('.animate-pulse')
      else await page.waitForSelector('[role="alert"]')
      await check(label, `insights-${state}-${w}`)
    }
  }
  console.log('\nInsights: the ranges and the words')
  {
    await go('/dev/admin/tasks/insights')
    await settledPage()
    const text = await bodyText()
    expect(text.includes('Since the reset, Tue 20 Oct') && text.includes('still a member') && !/subscri/i.test(text),
      'after the reset the second range is "Since the reset, Tue 20 Oct", and a save is "still a member", never "subscribed"')
    await press(await button('Since the reset, Tue 20 Oct'))
    await page.waitForFunction(() => [...document.querySelectorAll('[aria-pressed="true"]')].some((b) => b.textContent.startsWith('Since the reset')))
    await settledPage()
    const asked = (await peopleCalls()).filter((c) => c.name === 'loadInsights').map((c) => c.args[0])
    expect(asked.length === 2 && typeof asked[0] === 'string' && asked[1] === null, 'Last 30 days asks from 30 days ago; Since the reset asks for everything the route counts', JSON.stringify(asked))
    await go('/dev/admin/tasks/insights?reset=none')
    await settledPage()
    expect((await bodyText()).includes('All time'), 'before the reset the second range reads "All time"')
    const small = await smallTaps()
    expect(small.length === 0, 'Insights: every button 44px tall or more', JSON.stringify(small.slice(0, 4)))
  }

  // ── All students ──
  for (const size of SIZES) {
    const [w, h] = size
    for (const state of ['full', 'partial', 'empty', 'loading', 'error']) {
      const label = `All students, ${state}, ${w}x${h}`
      console.log(`\n${label}`)
      await go(`/dev/admin/students?state=${state}`, size)
      if (state === 'loading') await page.waitForSelector('.animate-pulse')
      else if (state === 'error') await page.waitForSelector('[role="alert"]')
      else await settledPage()
      if (state === 'partial') {
        const text = await bodyText()
        expect(text.includes("Couldn't load the students' progress") && text.includes("Couldn't read which course is live") && text.includes("Couldn't load") && !/\b0%/.test(text),
          `${label}: the failed reads say so, and no row shows 0% for a progress nobody could read`)
      }
      if (state === 'error') {
        const t = await page.$eval('[role="alert"]', (e) => e.textContent)
        expect(t.includes("Couldn't load the students.") && t.includes('Retry'), `${label}: the error, never "no students"`, t)
      }
      await check(label, `students-${state}-${w}`)
    }
  }
  console.log('\nAll students: the order, the username, the filters')
  {
    await go('/dev/admin/students', [1440, 900])
    await settledPage()
    const header = await page.$$eval('main div[aria-hidden="true"]', (ds) => ds.map((d) => d.textContent))
    expect(header.some((t) => t.includes('Username') && t.includes('First paid') && !t.includes('Discord')), 'the column reads Username, not Discord', JSON.stringify(header))
    const names = await page.$$eval('main a.list-row', (as) => as.map((a) => a.querySelector('p')?.textContent))
    expect(names[0] === 'Nora Brandt' && names[names.length - 1] === 'Felix Moreau' && names.length === 13,
      'every student with a first payment, newest first payment first (Nora, 20 Oct) to the oldest (Felix, 28 May)', names.join(', '))
    expect(!/\bplan\b/i.test(await bodyText()) || (await bodyText()).includes('any plan'), 'no plan shown on any row (the page says "any plan" once)')
    await press(await button('Payment failed1'))
    await sleep(150)
    expect((await page.$$eval('main a.list-row', (as) => as.length)) === 1 && (await bodyText()).includes('Priya Raman'), 'Payment failed: Priya alone')
    await press(await button('All13'))
    await page.type('input[type="search"]', '@JONAH')
    await sleep(150)
    expect((await page.$$eval('main a.list-row', (as) => as.map((a) => a.querySelector('p')?.textContent))).join() === 'Jonah Pereira', 'the search finds @jonah_p in any case')
    const small = await smallTaps()
    expect(small.length === 0, 'All students: every button 44px tall or more', JSON.stringify(small.slice(0, 4)))
  }

  // ── A student ──
  for (const size of SIZES) {
    const [w, h] = size
    for (const [name, route] of [['synced', '/p-maya'], ['stale', '/p-jonah'], ['never', '/p-priya'], ['canceling', '/p-sofia'], ['no-name', '/p-iris'],
      ['partial', '/p-sofia?state=partial'], ['missing', '/p-nobody'], ['error', '/p-maya?state=error'], ['loading', '/p-maya?state=loading']]) {
      const label = `A student, ${name}, ${w}x${h}`
      console.log(`\n${label}`)
      await go(`/dev/admin/students${route}`, size)
      if (name === 'loading') await page.waitForSelector('.animate-pulse')
      else if (name === 'error') await page.waitForSelector('[role="alert"]')
      else await settledPage()
      const text = await bodyText()
      if (name === 'synced') expect(text.includes('Synced since the switch'), `${label}: "Synced since the switch"`)
      if (name === 'stale') expect(text.includes('Not synced since the switch') && text.includes('These numbers are from before the course switch.'), `${label}: "Not synced since the switch", and why the numbers are old`)
      if (name === 'never') expect(text.includes('Never synced'), `${label}: "Never synced"`)
      if (name === 'canceling') expect(text.includes('Canceling') && text.includes('Note: Whop returned 3 interactions but 0 marked completed'), `${label}: Canceling, and the backfill's note as a note`)
      if (name === 'partial') {
        // Progress, Streak, the Whop sync, the 30% request and the lessons: their reads failed.
        expect((text.match(/Couldn't load/g) ?? []).length === 5 && !text.includes('0 days') && !text.includes('No 30% request') && !text.includes('Never synced'),
          `${label}: each of the 5 blocks whose read failed says "Couldn't load", never 0 days, "No 30% request" or "Never synced"`,
          String((text.match(/Couldn't load/g) ?? []).length))
      }
      if (name === 'missing') expect(text.includes('No student has this id.'), `${label}: "No student has this id."`)
      if (name === 'error') expect(text.includes("Couldn't load this student.") && text.includes('Retry'), `${label}: the error and Retry, never a spinner forever`)
      await check(label, `student-${name}-${w}`)
    }
  }
  console.log('\nA student: the ticks, the areas, the words')
  {
    await go('/dev/admin/students/p-maya')
    await settledPage()
    const text = await bodyText()
    expect(!/\bplan\b/i.test(text) && !/subscri/i.test(text), 'no plan and no subscription on the page')
    await press(await page.evaluateHandle(() => [...document.querySelectorAll('label')].find((l) => l.textContent.includes('Leave out of the tasks'))))
    await page.waitForFunction(() => document.body.innerText.includes('No task and no day 28 DM is made for this account.'), { timeout: 10000 })
    expect((await peopleCalls()).some((c) => c.name === 'setExempt' && c.args[0] === 'p-maya' && c.args[1] === true), 'the exempt tick writes, and the page says what it does now')
    await press(await page.evaluateHandle(() => [...document.querySelectorAll('label')].find((l) => l.textContent.includes('Ad submissions verified'))))
    await page.waitForFunction(() => (window.__peopleCalls ?? []).some((c) => c.name === 'setAdVerified'), { timeout: 10000 })
    expect((await peopleCalls()).some((c) => c.name === 'setAdVerified' && c.args[0] === 'p-maya' && c.args[1] === false), 'the ads tick writes (Maya\'s was ticked)')
    await press(await page.evaluateHandle(() => [...document.querySelectorAll('summary')].find((x) => x.textContent.includes('Foundations'))))
    await waitText('Hide')
    expect(await page.evaluate(() => [...document.querySelectorAll('details')].find((d) => d.textContent.includes('Foundations'))?.open === true && document.body.innerText.includes('Foundations, part 1')),
      'an area opens on a tap and lists its lessons, its fold now saying Hide')
    for (const size of SIZES) {
      await viewport(size)
      await check(`A student, an area open, ${size.join('x')}`, `student-area-open-${size[0]}`)
    }
    await viewport([1280, 720])
    const small = await smallTaps()
    expect(small.length === 0, 'A student: every button and tick 44px tall or more', JSON.stringify(small.slice(0, 4)))
  }

  // ── The journey ──
  for (const size of SIZES) {
    const [w, h] = size
    for (const [name, query] of [['full', ''], ['later', '?at=later'], ['partial', '?state=partial'], ['empty', '?state=empty'], ['loading', '?state=loading'], ['error', '?state=error']]) {
      const label = `Journey, ${name}, ${w}x${h}`
      console.log(`\n${label}`)
      await go(`/dev/admin/journey${query}`, size)
      if (name === 'loading') await page.waitForSelector('.animate-pulse')
      else if (name === 'error') await page.waitForSelector('[role="alert"]')
      else await settledPage()
      if (name === 'partial') {
        const text = await bodyText()
        expect(text.includes("Couldn't load the students' progress") && text.includes("Couldn't load where each student is") && !/\b0%/.test(text),
          `${label}: the failed reads say so on the board and on every card, never 0%`)
      }
      if (name === 'error') {
        const t = await page.$eval('[role="alert"]', (e) => e.textContent)
        expect(t.includes("Couldn't load the journey."), `${label}: the error, never an empty board`, t)
      }
      await check(label, `journey-${name}-${w}`)
    }
  }
  console.log('\nJourney: the population, the columns, the drawer')
  {
    await go('/dev/admin/journey', [1440, 900])
    await settledPage()
    const cols = await page.$$eval('main section[aria-label]', (ss) => ss.map((s) => `${s.getAttribute('aria-label')}:${s.querySelectorAll('button').length}`))
    expect(JSON.stringify(cols) === JSON.stringify(['Week 1:4', 'Week 2:3', 'Week 3:0', 'Week 4:0', 'Churned:1', 'Month 2+:0']),
      'the six columns: on 21 October everyone is in weeks 1 and 2, the canceled one in Churned', JSON.stringify(cols))
    const text = await bodyText()
    expect(text.includes('a first payment on or after Fri 9 Oct, on any plan') && !text.includes('Leo Hartmann') && !text.includes('Theo Marsh'),
      'the new program\'s students only: Leo (paid in September) and Theo (no Whop membership) are not on it')
    await press(await page.evaluateHandle(() => [...document.querySelectorAll('main section button')].find((b) => b.textContent.includes('Maya Lindqvist'))))
    await page.waitForSelector('aside[role="dialog"]')
    // textContent: the block's title is drawn in capitals, which innerText reports.
    await page.waitForFunction(() => document.querySelector('aside[role="dialog"]')?.textContent.includes('Lessons by area'), { timeout: 10000 })
    expect(await page.$eval('aside[role="dialog"]', (a) => a.innerText.includes('Maya Lindqvist') && a.innerText.includes('Open the full page') && a.innerText.includes('Approving the 30% no longer needs it.')),
      'a card opens the drawer with that student, the ads tick\'s words and the link to the full page')
    for (const size of SIZES) {
      await viewport(size)
      await check(`Journey, the drawer, ${size.join('x')}`, `journey-drawer-${size[0]}`)
    }
    await viewport([1440, 900])
    await press(await page.evaluateHandle(() => [...document.querySelectorAll('aside button')].find((b) => b.textContent.trim() === 'Close')))
    expect((await page.$('aside[role="dialog"]')) === null, 'Close closes it')
    await press(await page.evaluateHandle(() => [...document.querySelectorAll('main section button')].find((b) => b.textContent.includes('Priya Raman'))))
    await page.waitForSelector('aside[role="dialog"]')
    await page.waitForFunction(() => document.querySelector('aside[role="dialog"]')?.innerText.includes('Priya Raman'), { timeout: 10000 })
    expect(!(await page.$eval('aside[role="dialog"]', (a) => a.innerText.includes('Maya Lindqvist'))), 'the next student\'s drawer holds nothing of the last one')
    await page.keyboard.press('Escape')
    expect((await page.$('aside[role="dialog"]')) === null, 'Escape closes it')
    await go('/dev/admin/journey?at=later', [1440, 900])
    await settledPage()
    const later = await page.$$eval('main section[aria-label]', (ss) => ss.map((s) => `${s.getAttribute('aria-label')}:${s.querySelectorAll('button').length}`))
    expect(JSON.stringify(later) === JSON.stringify(['Week 1:0', 'Week 2:1', 'Week 3:1', 'Week 4:6', 'Churned:1', 'Month 2+:2']),
      'read on 12 November: weeks 3 and 4 and Month 2+ fill up, a past-due student past day 30 stays in Week 4', JSON.stringify(later))
    const fits = await page.evaluate(() => { const s = [...document.querySelectorAll('main section[aria-label]')].at(-1).getBoundingClientRect(); return s.right <= innerWidth })
    expect(fits, 'at 1440px wide all six columns are in the window')
    const small = await smallTaps()
    expect(small.length === 0, 'Journey: every card and button 44px tall or more', JSON.stringify(small.slice(0, 4)))
  }
  const errs = newConsoleErrors(from)
  expect(errs.length === 0, 'people: no error in the browser console', errs.slice(0, 3).join(' || '))
}

// ════════════════════════════════════════════════════════════════════════════
// feedback: /dev/admin/feedback/lessons (admin rebuild 2, WI-7, lane feedback)
// ════════════════════════════════════════════════════════════════════════════
if (wanted('feedback')) {
  const from = consoleErrors.length
  // The made-up ratings of src/app/dev/admin/feedback/lesson-fixtures.ts over the real course.
  const AREAS = ['01 Introduction', '02 Marketing Fundamentals', '03 Video Ads I', '04 Video Ads II', '05 Static Ads',
    '06 AI Ads + Content', '07 Creative Strategy', '08 How To Land Clients']
  const UNRATED_AREAS = ['04 Video Ads II', '06 AI Ads + Content', '08 How To Land Clients']
  const open = (query, size) => go(`/dev/admin/feedback/lessons${query}`, size)
  const ready = () => page.waitForFunction(() => /Updated \d\d:\d\d/.test(document.body.innerText), { timeout: 30000 })
  const headings = () => page.$$eval('main section h2', (hs) => hs.map((x) => x.textContent.replace(/\s+/g, ' ').trim()))
  const stats = () => page.$$eval('main .stat-value', (vs) => vs.map((v) => v.textContent.trim()))
  const lessonRow = (id) => page.$(`main li[data-lesson="${id}"]`)
  const comments = (id) => page.$$eval(`main li[data-lesson="${id}"] ul li p:last-child`, (ps) => ps.map((x) => x.textContent.trim()))

  for (const size of SIZES) {
    const [w, h] = size
    {
      const label = `lesson feedback, full, ${w}x${h}`
      console.log(`\n${label}`)
      await open('', size)
      await ready()
      expect(JSON.stringify(await headings()) === JSON.stringify(AREAS), `${label}: the 8 areas in route order`, JSON.stringify(await headings()))
      expect(JSON.stringify(await stats()) === JSON.stringify(['4.0 of 5', '17', '9 of 135']),
        `${label}: the three numbers: the average of every rating, 17 ratings, 9 of the 135 video lessons rated`, JSON.stringify(await stats()))
      const text = await bodyText()
      expect(text.includes('Since Mon 19 Oct · Updated 11:00'), `${label}: since the switch, and when it was read (Croatia time)`)
      expect(text.includes('4.0 average · 10 ratings · 3 of 8 lessons rated'), `${label}: Introduction's own line`)
      const unrated = await page.$$eval('main section', (ss) => ss.filter((x) => x.textContent.includes('No lesson in this area has a rating yet.')).map((x) => x.querySelector('h2').textContent.replace(/\s+/g, ' ').trim()))
      expect(JSON.stringify(unrated) === JSON.stringify(UNRATED_AREAS), `${label}: an area with no rating says so in one line`, JSON.stringify(unrated))
      const welcome = await lessonRow('a1l01')
      expect(!!welcome && (await welcome.evaluate((r) => r.textContent.includes('4.0') && r.textContent.includes('7 ratings'))), `${label}: the welcome lesson: 4.0 from 7 ratings`)
      expect(JSON.stringify(await comments('a1l01')) === JSON.stringify(['I already knew all of this from Whop.', 'Fine.', 'Too long for a welcome. Cut it to 3 minutes.']),
        `${label}: its 3 newest comments, the edited one first`, JSON.stringify(await comments('a1l01')))
      const third = await lessonRow('a1l03')
      expect(!!third && (await third.evaluate((r) => r.textContent.includes('No ratings yet.'))), `${label}: a lesson with none says "No ratings yet."`)
      expect(text.includes('s-noname@example.com') && text.includes('A student no longer on file'), `${label}: a student with no name shows the email, a student gone says so`)
      const small = await smallTaps()
      expect(small.length === 0, `${label}: every button and link drawn as one is 44px or taller`, JSON.stringify(small.slice(0, 4)))
      await check(label, `feedback-full-${w}`)
    }
    for (const [state, wait, want] of [
      ['empty', ready, 'No ratings yet.'],
      ['loading', () => page.waitForSelector('main [role="status"]'), 'Loading'],
      ['error', () => page.waitForFunction(() => document.body.innerText.includes("Couldn't load lesson feedback.")), "Couldn't read the lesson ratings, so nothing is shown. Try again."],
      ['unplaced', ready, "2 ratings are for a lesson the course list didn't have"],
      ['stray', ready, "students can't rate this lesson now"],
    ]) {
      const label = `lesson feedback, ${state}, ${w}x${h}`
      console.log(`\n${label}`)
      await open(`?state=${state}`, size)
      await wait()
      expect((await bodyText()).includes(want), `${label}: "${want}"`)
      if (state === 'empty') {
        expect(JSON.stringify(await stats()) === JSON.stringify(['None yet', '0', '0 of 135']), `${label}: None yet, 0, 0 of 135`, JSON.stringify(await stats()))
        expect((await headings()).length === 0, `${label}: no area list when nothing is rated`)
      }
      if (state === 'error') expect(!(await bodyText()).includes('of 135'), `${label}: no numbers at all, never zeros`)
      await check(label, `feedback-${state}-${w}`)
    }
  }

  console.log('\nlesson feedback: Show all, and a Refresh that fails')
  {
    await open('', [1280, 720])
    await ready()
    const more = await page.evaluateHandle(() => [...document.querySelectorAll('main li[data-lesson="a1l01"] button')].find((b) => b.textContent.trim() === 'Show all 6 comments') ?? null)
    expect(!(await isNull(more)) && (await more.evaluate((b) => b.getAttribute('aria-expanded'))) === 'false', '"Show all 6 comments", collapsed')
    await press(more)
    await sleep(150)
    expect((await comments('a1l01')).length === 6 && (await more.evaluate((b) => b.textContent.trim() === 'Show fewer' && b.getAttribute('aria-expanded') === 'true')),
      'pressed: all 6, newest first, and the button says "Show fewer"', JSON.stringify(await comments('a1l01')))
    await check('lesson feedback, every comment shown, 1280x720', 'feedback-all-comments-1280')
    await press(more)
    await sleep(150)
    expect((await comments('a1l01')).length === 3, 'pressed again: the 3 newest')

    await open('?reload=fail', [1280, 720])
    await ready()
    await press(await button('Refresh'))
    await page.waitForFunction(() => document.body.innerText.includes("Couldn't refresh the list, so it may be out of date. Press Refresh."), { timeout: 10000 })
    expect(JSON.stringify(await headings()) === JSON.stringify(AREAS), 'a Refresh that fails: its own line, and the page stays as it was')
    await check('lesson feedback, a failed Refresh, 1280x720', 'feedback-refresh-failed-1280')
    const reads = await calls()
    expect(reads.length === 2 && reads.every((c) => c.name === 'loadLessonFeedback'), 'two reads: the load and the Refresh', JSON.stringify(reads))

    await open('?state=error', [1280, 720])
    await page.waitForFunction(() => document.body.innerText.includes("Couldn't load lesson feedback."))
    await press(await button('Retry'))
    await sleep(600)
    expect((await calls()).length === 2 && (await bodyText()).includes("Couldn't load lesson feedback."), 'Retry asks again, and a second failure still says so', JSON.stringify(await calls()))
  }
  const errs = newConsoleErrors(from)
  expect(errs.length === 0, 'lesson feedback: no error in the browser console', errs.slice(0, 3).join(' || '))
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
