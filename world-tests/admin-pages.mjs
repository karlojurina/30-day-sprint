/**
 * The rebuilt admin pages in a real browser (admin rebuild PRD, work item 5;
 * admin rebuild 2, WI-1): the top bar, the two sign-in pages and the 30%
 * page, in every state, at a phone's width and two desktop widths. Today,
 * which this file also drew, was removed in admin rebuild 2 (D2).
 *
 *   node world-tests/admin-pages.mjs [--only routes,frame,signin,thirty,dash]
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
 *   thirty  /dev/admin/discounts: every tab full and empty, partial,
 *           novideos, loading and error, then its paths by clicks: the
 *           verdict beside Approve, Approve anyway, Reject, a 409 on approve
 *           (the code to delete pinned in the window, copyable) and on
 *           reject, a failed reload (its own line, the decided row's buttons
 *           off), Mark code added, ?student=; the 4 tabs whole on a phone,
 *           To decide oldest first, every tap 44px
 *   dash    /dev/admin/dashboard (admin rebuild 2, WI-2): full, renewed,
 *           empty, partial, error and loading; Month 2 waiting with no
 *           rate before the first renewals, then its rate; Avg progress's
 *           line from the switch only; every failed tile "Couldn't load"
 *           with no number; the readouts by pointer and keyboard; How it's
 *           counted; Refresh for a founder (its line, a refusal, a step that
 *           failed) and none for a csm; Retry; every tap 44px
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

const needBrowser = ['frame', 'signin', 'thirty', 'dash'].some(wanted)
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
// thirty: /dev/admin/discounts
// ════════════════════════════════════════════════════════════════════════════
if (wanted('thirty')) {
  const from = consoleErrors.length
  // Can still earn and its Mark messaged went with Today (admin rebuild 2, D2).
  const TABS = ['decide', 'approved', 'code-added', 'rejected']
  const EMPTY = {
    decide: 'No request is waiting for a decision.',
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
    }
    {
      const label = `30% off, the tabs and taps, ${w}x${h}`
      console.log(`\n${label}`)
      await open('?tab=decide', size)
      await waitReady()
      const tabs = await page.$$eval('[role="tab"]', (ts) => ts.map((t) => { const r = t.getBoundingClientRect(); return { left: r.left, right: r.right, h: r.height, width: innerWidth } }))
      expect(tabs.length === 4 && tabs.every((t) => t.left >= 0 && t.right <= t.width && t.h >= 44),
        `${label}: all four tabs whole in the window, 44px tall (they wrap on a phone)`, JSON.stringify(tabs.map((t) => Math.round(t.right))))
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
    expect(counts[0] === 'To decide 5' && counts[1] === 'Approved 3', 'Jonah moves from To decide to Approved', counts.join(' | '))
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
    expect(counts[0] === 'To decide 5' && counts[1] === 'Approved 3', 'Priya moves from To decide to Approved', counts.join(' | '))
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

  console.log('\n30% off: Mark code added')
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
    expect(counts[1] === 'Approved 1' && counts[2] === 'Code added in Whop 3', 'Ethan moves to Code added in Whop', counts.join(' | '))
  }

  console.log('\n30% off: ?student= keeps every tab to one student')
  {
    await open('?student=p-ethan')
    await waitReady()
    expect(JSON.stringify(await tabCounts()) === JSON.stringify(['To decide 0', 'Approved 1', 'Code added in Whop 0', 'Rejected 0']),
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
    await open('?student=p-maya&tab=approved')
    await waitReady()
    const mayaCounts = await tabCounts()
    expect(mayaCounts[0] === 'To decide 1' && (await bodyText()).includes('This student has nothing on this tab.'), '?tab= wins over the first tab with rows', mayaCounts.join(' | '))
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
