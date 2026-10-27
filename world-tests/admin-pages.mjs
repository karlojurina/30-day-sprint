/**
 * The rebuilt admin pages in a real browser (admin rebuild PRD, work item 5;
 * admin rebuild 2, WI-1): the top bar, the two sign-in pages and the 30%
 * page, in every state, at a phone's width and two desktop widths. Today,
 * which this file also drew, was removed in admin rebuild 2 (D2).
 *
 *   node world-tests/admin-pages.mjs [--only routes,frame,signin,thirty,dash,tasks,people,feedback,templates,survey,team,insights,review,render]
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
 *           · Tasks · Students · Feedback · Templates · Insights · Team for
 *           each role's flags ("30% off" left it with the 30% that applies
 *           itself, T-137, R4), with no "More", Dashboard marked on
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
 *   thirty  /dev/admin/discounts (admin rebuild 2, D4 and D5; since the 30%
 *           that applies itself, T-137, R4, one list of the requests the app
 *           could not finish, the tabs gone): full, empty, paused (the line
 *           under the header, every Why line naming the team), reasons
 *           (every reason and step's Why line, and each answer of the
 *           PRD's approve and reject tables pressed: its notice or its line
 *           on the row), partial, novideos, nocoupons, loading and error; the
 *           list oldest first, what is on no list (applied, rejected with no
 *           write_failed, made 20 minutes ago, from September), old ?tab=
 *           links opening the list, ?student= with nothing of theirs; a row
 *           is the name (to the student page), @username, Active or not, the
 *           dates, the verdict line with its count
 *           and what the 80% needs (the owner's 80% rule of 2026-10-26, 49
 *           of 61: Jonah at 49 says yes, Priya at 48 not yet), Copy Discord
 *           ID then Copy username (each greyed with its tip when the student
 *           has none on file, the username's tip saying it can be the Whop
 *           one, a line in their place with neither, a stored "@" never
 *           doubled when copied; "Copy ID" and "Copy @" until the review of
 *           the same day), the coupon and the actions, with no plan, Open in
 *           Discord, survey, Can still earn, last contact or Mark messaged;
 *           Copy code, Copy Discord ID and Copy username on every row with a
 *           code, and the Why line; an approved row with Try again and, for
 *           a founder or an admin, Reject confirmed first; a rejected row
 *           with a write_failed, its words and its code, nothing to press;
 *           ?state=unpaid, Whop showing no
 *           paid course plan and payment that went through (the owner's rule
 *           of 2026-10-26; ?state=nopayment, no real payment, until then:
 *           the verdict in the page's own words, no Approve, a plain Approve
 *           refused and the row turning, Check Whop again, Approve anyway, a
 *           csm's row); then its
 *           paths by clicks, the dev page deciding where a code goes as the
 *           shared step does (since the build's review of 2026-10-27): Approve
 *           on the rule's yes (the code made; on, and the row gone, where the
 *           membership takes it; else made but not on, the row approved),
 *           Approve refused for a
 *           coupon Whop names only then (its row turns to the coupon, no
 *           Approve anyway after it), the Approve anyway link and its confirm,
 *           Reject (a code left usable keeps the request listed, rejected,
 *           with the code), a 409 on approve (the request stays listed with
 *           the code to delete) and on reject (another member's Approve put
 *           the 30% on), a failed reload, Try again (Whop silent; the code
 *           already on, ?state=owncode), the coupon warning on an approved
 *           row, ?student=; every
 *           tap 44px, the link too. Since the render review's second round:
 *           a coupon row's Reject starting with the map's sentence, changed
 *           by the team before sending, and Check Whop again with each of
 *           its answers (the code still there; gone, and Approve back,
 *           ?state=stalecoupon; Whop down, ?whop=down)
 *   dash    /dev/admin/dashboard (admin rebuild 2, WI-2): full, renewed,
 *           empty, partial, error and loading; "30% needs a hand" and "30%
 *           off applied" (T-137, R5) with their counts, at 0 and failed, the
 *           new card last in the program's row from 1024px; Month 2 waiting with no
 *           rate before the first renewals, then its rate; Avg progress's
 *           line from the switch only, its 2 readings 2 dots and a short
 *           line (the render review's second round); every failed tile
 *           "Couldn't load" with no number, and the header "Couldn't load"
 *           when every read failed (the same round); the readouts by pointer
 *           and keyboard; How it's counted; Refresh for a founder (its line,
 *           a refusal, a step that failed) and none for a csm; Retry; every
 *           tap 44px
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
 *           44px, and no bold word glued to the next one. Since the owner's
 *           answer of 2026-10-21 All students and the journey hold course
 *           members on a $97 monthly plan alone (the hidden one too, never a
 *           yearly or an ETfB owner's plan), and their headers say so. Since
 *           2026-10-22 the drawer's action items: one with nothing to post
 *           (a6l03) says "Done" with no link, the others "Handed in" with
 *           their post's link or "Not yet"
 *   feedback  /dev/admin/feedback/lessons (admin rebuild 2, WI-7): full,
 *           empty, loading, error, unplaced and stray; the areas in route
 *           order with their counts, a lesson's average and count, its 3
 *           newest comments and "Show all", a lesson with none and an area
 *           with none saying so, a name missing (the email) and a student
 *           gone; a failed Refresh keeps the page with its own line; every
 *           tap 44px
 *   templates, survey, team, insights  /dev/admin/templates, survey, team
 *           and insights (admin rebuild 2, WI-8 and WI-9), every state and
 *           the clicks the comment above their part lists
 *   review  admin rebuild 2's review fix round (WI-11), across the pages:
 *           every header keeps its 44px title line, its place and its
 *           action from loading to loaded and on a failed read; the 30%
 *           page's one list at 390, 375 and 360px (its tabs, which had to
 *           stay on one line there, went with T-137). The round's other checks sit in
 *           the parts of the pages they changed (each says "the review's
 *           fix round")
 *   render  admin rebuild 2's render review fix round, across the pages: a
 *           failed read said in every header; the journey's board in the
 *           page's column at 1280 and 1440, scrolling inside itself on a
 *           phone; the Dashboard's sections the same distance apart and
 *           Month 2's bar with no knob; the 30% page's and Tasks' actions on
 *           the right from 768px and under the words on a phone; every pill
 *           row on one line on a phone; a student's numbers on one line and a
 *           failed one plainly not a value; the Whop sync in one line; the
 *           name part on every page; the folds' markers and Show settings'
 *           aria-expanded; the team's own ECOM30 code with no warning; the
 *           course switch page and the not-found page in the dark look, and
 *           the old admin addresses answered 404 by the catch-all. Its
 *           second round: Outreach insights' 5 numbers in the primary ink; a
 *           username longer than its journey card on one line, cut with an
 *           ellipsis, the whole of it in a title (until the owner's review
 *           took the username off the cards); no underline on a name with no
 *           student behind it; every failed block of a student's page and of
 *           the drawer starting with the tiles' warning dot
 *
 * The owner's review of the preview (2026-10-21) changed these parts' checks
 * where it changed the pages: dash, no source line under a tile, taller
 * charts, the Bounty Program's arrow; thirty, Approve anyway for an admin (the
 * dev page's default role) on every refused row, the coupon's too, and after
 * the approve route's 409 (?approve=coursechanged), none for a csm
 * (?role=csm), its confirm naming what it skips, no sentence when the coupons
 * cannot be read; people, All students from 1 October with the pills Active,
 * Payment failed and Ended, the journey's short cards; render, the journey's
 * board across the window's width with the pages' side margins, and a name
 * too long to share its line with the day breaking only between its parts.
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

const needBrowser = ['frame', 'signin', 'thirty', 'dash', 'tasks', 'people', 'feedback', 'templates', 'survey', 'team', 'insights', 'review', 'render'].some(wanted)
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
  // Admin rebuild 2, D1: Dashboard · Tasks · Students ▾ · Feedback ▾ · Templates · Insights · Team, no "More"; "30% off"
  // left the bar with the 30% that applies itself (T-137, R4: the Dashboard's "30% needs a hand" and a student's page
  // link to the page). Feedback's two pages are hidden from the csm role, and Team is a founder's only, as before.
  const BAR = {
    founder: ['Dashboard', 'Tasks', 'Students', 'Feedback', 'Templates', 'Insights', 'Team'],
    csm: ['Dashboard', 'Tasks', 'Students', 'Templates', 'Insights'],
    admin: ['Dashboard', 'Tasks', 'Students', 'Feedback', 'Templates', 'Insights'],
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
  // 1100px is where the entries move into the bar. A founder's 7 fit there
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
// thirty: /dev/admin/discounts (admin rebuild 2, D4 and D5; the 30% that applies itself, T-137, R4)
// ════════════════════════════════════════════════════════════════════════════
if (wanted('thirty')) {
  const from = consoleErrors.length
  // The page's words (ThirtyView.tsx, PRD §9.6).
  const HEADER = "The 30% goes on automatically. These are the requests the app couldn't finish, oldest first."
  const PAUSED = 'The automatic 30% is paused (THIRTY_AUTO_APPLY is off). Requests wait here for the team.'
  const EMPTY = 'Nothing needs a hand.'
  const EMPTY_STUDENT = 'Nothing of theirs needs a hand.'
  const COUPON_LINE = 'This student already has a discount on their membership (evolve10).'
  // The verdict sentences (thirty-view.ts VERDICT_TEXT) since the 80% rule of 2026-10-26.
  const YES = 'At least 80% of the videos up to the checkpoint were watched in time.'
  // A deadline before 26 October keeps every video (the owner's B, 2026-10-26): Maya's and Tara's windows end before it.
  const YES_EVERY = 'Every video up to the checkpoint was watched in time.'
  const EVERY_LINE = '61 of 61 videos · 61 needed, every video for a deadline before Mon 26 Oct'
  const NOT_YET = 'Fewer than 80% of the videos up to the checkpoint are watched so far.'
  // Copy Discord ID's and Copy username's tips, and the line with neither on file (thirty-view.ts, the review of 2026-10-26).
  const NO_USERNAME = 'No username on file for this student.'
  const NO_ID = 'No Discord ID on file for this student.'
  const USERNAME_TIP = "The username on file. It can be the student's Whop username, and on Discord that name may belong to someone else."
  const NO_LINE = 'No Discord ID or username on file.'
  // Beside the buttons with a username and no Discord ID: a phone shows no tip (the review of 2026-10-26).
  const USERNAME_NOTE = 'This username may be their Whop one.'
  // The verdict for a student Whop shows no paid course plan and payment that went through for (the owner's rule of
  // 2026-10-26; "Whop shows no real payment from this student, and the 30% needs one." from the review of that day).
  const NO_PAYMENT = 'The 30% needs a paid course plan and a payment that went through, and Whop doesn\'t show both for this student.'
  /** The map's sentence for a discount already on the account: since the render review's second round, the reason a coupon row's Reject starts with. */
  const MAP_LINE = "You can't apply for this discount because you already have a discount applied to your account."
  // Each row's Why line in ?state=full (thirtyWords over its newest failure), oldest first: the order of the list.
  const TWO_DAYS = 'The app only tries requests from the last 2 days. Approve or reject it.'
  const AGAIN = 'The app tries again.'
  const WHY = {
    'Leo Hartmann': TWO_DAYS,
    'Sofia Marin': `Whop's coupon check didn't answer. ${TWO_DAYS}`,
    'Ethan Cole': `Their membership already has another code on Whop. ${AGAIN}`,
    // The job's refusal is her verdict word for word: said once, by the verdict (the build's review of 2026-10-27).
    'Tara Quinn': null,
    'Hugo Lindahl': `Whop's coupon check didn't answer. ${AGAIN}`,
    'Iris Novak': 'Whop attached ECOM30-Q8M3TZ after the request was rejected. It can only come off in Whop.',
    'Maya Lindqvist': "The app hasn't tried yet.",
    'Nora Brandt': `Whop didn't answer. ${AGAIN}`,
    'Jonah Pereira': `Whop shows no paid course membership to put the code on. ${AGAIN}`,
    'Maximilian Featherstonehaugh-Smythe': `Their membership is past_due on Whop, so the code can't go on yet. ${AGAIN}`,
    'Priya Raman': 'Student has not watched 80% of the videos up to the discount checkpoint inside the 14 days: 48 of 61 watched, 49 needed.',
  }
  const LISTED = Object.keys(WHY)
  // THIRTY_AUTO_APPLY off (?state=paused): the next step is the team's, on every pending and approved row; a hold and a
  // decided row keep their words.
  const P_PENDING = 'The app is paused. Approve or reject it.'
  const P_APPROVED = 'The app is paused. Press Try again or reject it.'
  const WHY_PAUSED = {
    ...WHY,
    'Leo Hartmann': P_PENDING,
    'Sofia Marin': `Whop's coupon check didn't answer. ${P_PENDING}`,
    'Ethan Cole': `Their membership already has another code on Whop. ${P_APPROVED}`,
    'Hugo Lindahl': `Whop's coupon check didn't answer. ${P_PENDING}`,
    'Maya Lindqvist': P_PENDING,
    'Nora Brandt': `Whop didn't answer. ${P_APPROVED}`,
    'Jonah Pereira': `Whop shows no paid course membership to put the code on. ${P_PENDING}`,
    'Maximilian Featherstonehaugh-Smythe': `Their membership is past_due on Whop, so the code can't go on yet. ${P_PENDING}`,
  }
  /** Requests on no list: applied, rejected with no write_failed, made 20 minutes ago, from September, applied after a write_failed. */
  const UNLISTED = ['Omar Haddad', 'Lena Vogel', 'Ruby Okafor', 'Felix Moreau', 'Zoe Hartley', 'Vera Holm', 'Kai Lindgren']
  const open = (query, size) => go(`/dev/admin/discounts${query}`, size)
  const waitReady = () => page.waitForFunction(() => /Updated \d\d:\d\d/.test(document.body.innerText), { timeout: 30000 })
  const row = (name) => page.evaluateHandle((n) => [...document.querySelectorAll('.list-row')].find((r) => r.querySelector('a')?.textContent === n) ?? null, name)
  const names = () => page.$$eval('.list-row', (rs) => rs.map((r) => r.querySelector('a')?.textContent))
  const rowText = (h) => h.evaluate((r) => r.innerText)
  const linkIn = (h) => buttonIn(h, 'Approve anyway')
  /** Every row's Why line, by name. */
  const whys = () => page.$$eval('.list-row', (rs) => Object.fromEntries(rs.map((r) => [r.querySelector('a')?.textContent, r.querySelector('[data-why]')?.textContent ?? null])))
  /** A row's buttons that decide something (the copy buttons are every role's, left out). */
  const actionsOf = (h) => h.evaluate((r) => [...r.querySelectorAll('button')].map((b) => b.textContent.trim()).filter((t) => !/^Copy (code|Discord ID|username)$/.test(t)))
  /** The notices at the bottom of the window: their words, whether they stay (an alert) and whether they offer Copy code. */
  const notices = () => page.evaluate(() => [...document.querySelectorAll('[role="status"], [role="alert"]')]
    .filter((n) => [...n.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Dismiss'))
    .map((n) => ({ text: n.querySelector('p')?.textContent ?? '', role: n.getAttribute('role'), copy: [...n.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Copy code') })))
  const shown = (text) => page.waitForFunction((t) => document.body.innerText.includes(t), { timeout: 10000 }, text)
  const rowAlert = (h) => h.evaluate((r) => r.querySelector('[role="alert"]')?.textContent ?? null)
  /** A row's status on the page (data-row-status), or null when it is off the list. */
  const statusOf = async (name) => (await row(name)).evaluate((r) => r?.dataset.rowStatus ?? null)
  // The approve table's "made but not on their membership yet": since the build's review of 2026-10-27 the dev page's
  // stand-in decides as the shared step does, so a press past the checks ends there when the membership can't take the
  // code (past_due, canceled, another code on it, Whop silent, no paid course membership), the row then approved.
  const NO_MEMBERSHIP = 'Whop shows no paid course membership to put the code on.'
  const HAS_CODE = 'Their membership already has another code on Whop.'
  const escaped = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  /** The notice's whole sentence, the code being the one the press made (ECOM30- and 6 characters) unless named. */
  const madeNotOn = (name, why, code = null) =>
    new RegExp(`^${escaped(name)}: the code ${code ? escaped(code) : 'ECOM30-[A-Z0-9]{6}'} is made but not on their membership yet\\. ${escaped(why)}$`)
  /** After a press: its notice (it stays, with Copy code) says `re`, and the row is still listed with `status`. */
  const leftOn = async (name, re, status = 'approved') => {
    const n = (await notices()).find((x) => re.test(x.text))
    return { ok: Boolean(n && n.role === 'alert' && n.copy) && (await statusOf(name)) === status, said: (await notices()).map((x) => x.text), status: await statusOf(name) }
  }

  for (const size of SIZES) {
    const [w, h] = size
    {
      const label = `30% off, full, ${w}x${h}`
      console.log(`\n${label}`)
      await open('', size)
      await waitReady()
      const text = await bodyText()
      expect(text.includes(HEADER) && (await page.$('[role="tablist"]')) === null && (await page.$('[data-paused]')) === null,
        `${label}: the header's line, one list with no tabs, not paused`)
      const order = await names()
      expect(JSON.stringify(order) === JSON.stringify(LISTED),
        `${label}: the requests that need a hand, oldest first: pending ones 30 minutes after applying, approved ones, and Iris's rejected one with a write_failed`, order.join(', '))
      expect(UNLISTED.every((n) => !order.includes(n)),
        `${label}: on no list: applied (Omar, Lena), rejected with no write_failed (Ruby, Felix), made 20 minutes ago (Zoe), from September (Vera), and Kai's write_failed followed by its applied event`)
      const small = await smallTaps()
      expect(small.length === 0, `${label}: every button and link styled as one is 44px tall or more, the small links too`, JSON.stringify(small.slice(0, 4)))
      await check(label, `thirty-full-${w}`)
    }
    {
      const label = `30% off, empty, ${w}x${h}`
      console.log(`\n${label}`)
      await open('?state=empty', size)
      await waitReady()
      expect((await bodyText()).includes(EMPTY) && (await page.$$('.list-row')).length === 0, `${label}: "${EMPTY}"`)
      await check(label, `thirty-empty-${w}`)
    }
    {
      const label = `30% off, paused, ${w}x${h}`
      console.log(`\n${label}`)
      await open('?state=paused', size)
      await waitReady()
      const line = await page.$eval('[data-paused]', (e) => ({ text: e.textContent.trim(), role: e.getAttribute('role'), top: Math.round(e.getBoundingClientRect().top) })).catch(() => null)
      const head = await page.$eval('main header', (e) => Math.round(e.getBoundingClientRect().bottom))
      expect(line && line.text === PAUSED && line.role === 'status' && line.top >= head - 1, `${label}: under the header, "${PAUSED}"`, JSON.stringify(line))
      const got = await whys()
      const wrong = Object.entries(WHY_PAUSED).filter(([n, t]) => got[n] !== t)
      expect(wrong.length === 0, `${label}: every pending and approved row's Why line names the team; Priya's refusal and Iris's decided row keep their words, Tara's refusal is still said once, by her verdict`, JSON.stringify(wrong.map(([n]) => [n, got[n]])))
      await check(label, `thirty-paused-${w}`)
    }
    {
      const label = `30% off, one student unreadable, ${w}x${h}`
      console.log(`\n${label}`)
      await open('?state=partial', size)
      await waitReady()
      const nina = await row('Nina Petrova')
      expect(await nina.evaluate((r) => r.textContent.includes("Couldn't read this student's progress, so there is no verdict.") && !/\d+ of 61 videos/.test(r.textContent)),
        `${label}: the row says there is no verdict, in words, and shows no count`)
      expect((await isNull(await buttonIn(nina, 'Approve'))) && !(await isNull(await linkIn(nina))), `${label}: the Approve anyway link in Approve's place (no Approve that does nothing)`)
      await check(label, `thirty-partial-${w}`)
    }
    {
      const label = `30% off, the videos unreadable, ${w}x${h}`
      console.log(`\n${label}`)
      await open('?state=novideos', size)
      await waitReady()
      expect((await bodyText()).includes("Couldn't read the course's videos, so no request has a verdict. Press Refresh to try again."), `${label}: the warning above the list`)
      const verdicts = await page.$$eval('.list-row[data-row-status="pending"]', (rs) => rs.map((r) => ({ name: r.querySelector('a')?.textContent, none: r.textContent.includes("Couldn't read this student's progress, so there is no verdict. Press Refresh to try again."), coupon: r.textContent.includes('already has a discount on their membership') })))
      expect(verdicts.length === 8 && verdicts.every((v) => (v.name === 'Tara Quinn' ? v.coupon && !v.none : v.none && !v.coupon)),
        `${label}: every pending row says there is no verdict, but Tara's, whose coupon decides without the videos`, JSON.stringify(verdicts))
      await check(label, `thirty-novideos-${w}`)
    }
    {
      const label = `30% off, the coupons unreadable, ${w}x${h}`
      console.log(`\n${label}`)
      await open('?state=nocoupons', size)
      await waitReady()
      // The owner's review (2026-10-21): no sentence above the list; the rows simply show no coupon.
      expect(!(await bodyText()).includes("Couldn't read the membership coupons") && !(await bodyText()).includes('Approve still asks Whop'),
        `${label}: no sentence above the list about the coupons (the owner's review)`)
      const tara = await row('Tara Quinn')
      // Her Why line still holds the job's coupon refusal (her newest attempt_failed), shown now that the verdict says
      // something else: the rule's yes, the stored coupon unread.
      expect((await tara.evaluate((r) => r.querySelector('[data-verdict]')?.dataset.verdict)) === 'yes' && !(await rowText(tara)).includes('Coupon not checked') && !(await (await buttonIn(tara, 'Approve')).evaluate((b) => b.disabled))
          && (await tara.evaluate((r) => r.querySelector('[data-why]')?.textContent ?? null)) === COUPON_LINE,
        `${label}: Tara's verdict is the rule's yes with no stored coupon shown, Approve on (the approve route asks Whop itself); her Why line still says the job's last refusal over the coupon`)
      await check(label, `thirty-nocoupons-${w}`)
    }
    {
      const label = `30% off, every other reason, ${w}x${h}`
      console.log(`\n${label}`)
      await open('?state=reasons', size)
      await waitReady()
      await check(label, `thirty-reasons-${w}`)
    }
    {
      const label = `30% off, loading, ${w}x${h}`
      console.log(`\n${label}`)
      await open('?state=loading', size)
      await page.waitForSelector('.animate-pulse')
      expect((await page.$('.animate-spin')) === null && (await page.$('[role="tablist"]')) === null, `${label}: skeleton rows, no spinner, no tabs`)
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

  console.log('\n30% off: a row is the student, the dates, the verdict, the Why line, the coupon and the actions, and nothing else (D4, T-137)')
  {
    await open('')
    await waitReady()
    const text = await bodyText()
    expect(!/\b(Monthly|Yearly|Other plan)\b/.test(text) && !/subscription/i.test(text), 'no plan pill and no "subscription" anywhere on the page')
    // Copy Discord ID and Copy username came back on 2026-10-26 (the owner); Open in Discord and the rest stay gone, and Mark code applied went with T-137.
    expect(!/Open in Discord|No Discord linked|Survey answers|Can still earn|Mark messaged|No message yet|Messaged |Deadline |Paid |Whop progress not pulled yet|Mark code applied/.test(text),
      'no Open in Discord, survey answers, Can still earn, last contact, Mark messaged, deadline or payment facts, "not pulled" pill or Mark code applied')
    const got = await whys()
    const wrong = Object.entries(WHY).filter(([n, t]) => got[n] !== t)
    expect(wrong.length === 0, 'every row\'s Why line, thirtyWords over its newest failure: never tried, the 2-day line, a hold, a retry, a code Whop attached after a reject; none on Tara\'s row, whose refusal her verdict says word for word', JSON.stringify(wrong.map(([n]) => [n, got[n]])))
    const dots = await page.$$eval('[data-why]', (ps) => ps.map((p) => ({ why: p.dataset.why, dot: getComputedStyle(p.querySelector('span')).backgroundColor })))
    expect(dots.length === 10 && new Set(dots.filter((d) => d.why === 'none').map((d) => d.dot)).size === 1 && dots.filter((d) => d.why !== 'none').every((d) => d.dot === dots.find((x) => x.why !== 'none').dot)
        && dots.find((d) => d.why === 'none').dot !== dots.find((d) => d.why !== 'none').dot,
      'a Why line\'s dot: the warning colour once an attempt failed, grey while nothing has been tried', JSON.stringify(dots.slice(0, 3)))
    const maya = await row('Maya Lindqvist')
    // The row's words are RowSplit's first column (the render review's fix round): its first line is the student.
    const head = await maya.evaluate((r) => {
      const top = r.querySelector('[data-row-split]').firstElementChild.firstElementChild
      return { link: top.querySelector('a')?.getAttribute('href'), parts: [...top.children].map((c) => c.textContent.trim()) }
    })
    expect(head.link === '/admin/students/p-maya' && JSON.stringify(head.parts) === JSON.stringify(['Maya Lindqvist', '@maya.lq', 'Active']),
      'the top line: the name (to the student page), @username, Active', JSON.stringify(head))
    expect((await rowText(maya)).includes('Applied Mon 19 Oct') && (await rowText(maya)).includes(YES_EVERY) && (await rowText(maya)).includes(EVERY_LINE),
      'then the date applied and the verdict line with the count and what the window needs: every video, her shared deadline being before 26 October (the owner\'s B)', await rowText(maya))
    const jonah = await rowText(await row('Jonah Pereira'))
    expect(jonah.includes(YES) && jonah.includes('49 of 61 videos · 49 needed for 80%'), 'Jonah, 49 of the 61, the least the 80% takes: the yes', jonah)
    const priyaHead = await (await row('Priya Raman')).evaluate((r) => [...r.querySelector('[data-row-split]').firstElementChild.firstElementChild.children].map((c) => c.textContent.trim()))
    expect(JSON.stringify(priyaHead) === JSON.stringify(['Priya Raman', 'Payment failed']), 'a member whose payment failed, with no @username: name and "Payment failed"', JSON.stringify(priyaHead))
    const priya = await rowText(await row('Priya Raman'))
    expect(priya.includes(NOT_YET) && priya.includes('48 of 61 videos · 49 needed for 80% · Whop progress not pulled since the switch'),
      'Priya, 48 of 61, one short: why not, the count and the 49, and that her Whop progress is not in yet, on the verdict line', priya)
    expect((await rowText(await row('Sofia Marin'))).includes('Asked on the old course, before the switch.'), 'Sofia: asked on the old course, and the verdict says so')
    expect((await rowText(await row('Leo Hartmann'))).includes('The first payment was before Thu 1 Oct, so this student cannot earn the 30%.') && (await rowText(await row('Leo Hartmann'))).includes('Canceled'),
      'Leo: a first payment before 1 October, a canceled membership')
    const approvable = await page.$$eval('.list-row[data-row-status="pending"]', (rs) => rs.map((r) => {
      const b = [...r.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Approve')
      const link = [...r.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Approve anyway')
      return { name: r.querySelector('a')?.textContent, open: !!b && !b.disabled, link: !!link }
    }))
    // The render review's fix round: the coupon's row (Tara) has no Approve at all. Since the owner's review
    // (2026-10-21) an admin (the dev page's default role) gets Approve anyway on it too.
    expect(approvable.filter((a) => a.open).map((a) => a.name).join() === 'Hugo Lindahl,Maya Lindqvist,Jonah Pereira'
        && approvable.every((a) => a.open !== a.link),
      'Approve is on where the verdict is yes (Hugo, Maya, Jonah); every row a check refuses, the coupon\'s (Tara) too, has Approve anyway in its place, never both', JSON.stringify(approvable))
    expect(approvable.filter((a) => a.link).map((a) => a.name).join() === 'Leo Hartmann,Sofia Marin,Tara Quinn,Maximilian Featherstonehaugh-Smythe,Priya Raman',
      'the Approve anyway link after every refusal, the coupon\'s too: Leo, Sofia, Tara, Max, Priya (the owner\'s review)', JSON.stringify(approvable))
    const notChecked = await page.$$eval('.list-row', (rs) => rs.filter((r) => r.textContent.includes('Coupon not checked yet. Approve asks Whop first.')).map((r) => r.querySelector('a')?.textContent))
    expect(notChecked.join() === 'Hugo Lindahl',
      '"Coupon not checked yet" only beside the rule\'s yes: Hugo; never Leo, refused for his first payment (the render review\'s fix round)', notChecked.join())
    const buttons = await (await row('Jonah Pereira')).evaluate((r) => [...r.querySelectorAll('button')].map((b) => ({ t: b.textContent.trim(), bg: getComputedStyle(b).backgroundColor })))
    const reject = buttons.find((b) => b.t === 'Reject')
    const approve = buttons.find((b) => b.t === 'Approve')
    expect(reject && approve && reject.bg === 'rgba(0, 0, 0, 0)' && approve.bg !== 'rgba(0, 0, 0, 0)',
      'Reject is the ghost button, the row\'s "no" as Dismiss is on Tasks; Approve is raised', JSON.stringify(buttons))
    const tara = await row('Tara Quinn')
    const taraReject = await (await buttonIn(tara, 'Reject')).evaluate((b) => getComputedStyle(b).backgroundColor)
    expect((await rowText(tara)).includes(COUPON_LINE) && (await isNull(await buttonIn(tara, 'Approve'))) && !(await isNull(await linkIn(tara))) && !(await rowText(tara)).includes('videos') && taraReject !== 'rgba(0, 0, 0, 0)',
      'Tara, every video done and evolve10 stored for her membership: the coupon\'s line, no Approve, Approve anyway for an admin (the owner\'s review), Reject raised; no count', await rowText(tara))
    const link = await (await linkIn(await row('Priya Raman'))).evaluate((b) => {
      const cs = getComputedStyle(b)
      const r = b.getBoundingClientRect()
      return { bg: cs.backgroundColor, border: cs.borderTopStyle, underline: cs.textDecorationLine, size: cs.fontSize, h: Math.round(r.height) }
    })
    expect(link.bg === 'rgba(0, 0, 0, 0)' && link.border === 'none' && link.underline === 'underline' && link.size === '13px' && link.h >= 44,
      'Approve anyway is a small link: no fill, no border, underlined 13px words, a 44px target', JSON.stringify(link))
    // The approved rows (T-137, R4): the dates, the code with its copy buttons, the coupon warning, the Why line; Try again and Reject.
    const ethan = await row('Ethan Cole')
    const e = await rowText(ethan)
    expect(e.includes('ECOM30-3F9A21') && e.includes('Applied Sat 17 Oct · Approved Sun 18 Oct by Robin') && e.includes(`${COUPON_LINE} Check Whop before you add the 30% code.`) && !e.includes('Whop gave no answer now'),
      'Ethan, approved: the code, the dates and who, and the coupon Whop names now (approved before the coupon rule, nothing stored)', e)
    expect(JSON.stringify(await actionsOf(ethan)) === JSON.stringify(['Try again', 'Reject']) && (await ethan.evaluate((r) => r.dataset.rowStatus)) === 'approved',
      'an approved row\'s actions: Try again, and Reject for an admin (Mark code applied went: Try again marks it applied once Whop shows it)', JSON.stringify(await actionsOf(ethan)))
    const nora = await rowText(await row('Nora Brandt'))
    expect(nora.includes(`${COUPON_LINE} Check Whop before you add the 30% code. Whop gave no answer now; this is its answer of Mon 19 Oct.`) && nora.includes('Approved Tue 20 Oct by Jamie'),
      'Nora, evolve10 stored, Whop giving no answer now: the stored row stands in, with its date', nora)
    const iris = await row('Iris Novak')
    const i = await rowText(iris)
    expect(i.includes('Applied Mon 19 Oct · Rejected Tue 20 Oct by Jamie') && i.includes('Reason: Two accounts on one card.') && i.includes('ECOM30-Q8M3TZ')
        && (await actionsOf(iris)).length === 0 && (await iris.evaluate((r) => r.dataset.rowStatus)) === 'rejected',
      'Iris, rejected while Whop attached her code: listed for its write_failed, with its words and the code, and nothing to press', i)
    await viewport([1440, 900])
    await check('30% off, the rows, 1440x900', 'thirty-rows-1440')
  }

  // The owner, 2026-10-26: "We have 'Copy the code,' which is very good, and then 'Copy Discord username' or 'their ID'
  // or whatever. I think ID might be best". The review of the same day: the username can be the Whop one, so its button
  // never says Discord, and Copy Discord ID comes first.
  console.log('\n30% off: Copy Discord ID and Copy username on every pending row and beside Copy code, greyed with a tip when there is nothing to copy, a line with neither')
  {
    /** The copy buttons on a row: on or greyed, their tip, their height; and the line in their place, if any. */
    const copies = (h) => h.evaluate((r) => [...r.querySelectorAll('button')].filter((b) => /^Copy (Discord ID|username|code)$/.test(b.textContent.trim())).map((b) => ({
      label: b.textContent.trim(), off: b.getAttribute('aria-disabled') === 'true', disabled: b.disabled, tip: b.getAttribute('title'), h: Math.round(b.getBoundingClientRect().height),
    })))
    const noLine = (h) => h.evaluate((r) => r.querySelector('[data-no-discord]')?.textContent ?? null)
    // What a press copies: the page's clipboard, held here.
    const holdClipboard = () => page.evaluate(() => {
      window.__copied = []
      navigator.clipboard.writeText = async (t) => { window.__copied.push(t) }
    })
    const copied = () => page.evaluate(() => window.__copied.slice())
    for (const size of [[1440, 900], [390, 844]]) {
      await open('', size)
      await waitReady()
      // [the id greyed, the username greyed]; Priya has neither, so a line stands in their place.
      const want = {
        'Maya Lindqvist': [false, false], 'Jonah Pereira': [false, false], 'Hugo Lindahl': [true, false],
        'Leo Hartmann': [false, true], 'Sofia Marin': [false, false], 'Tara Quinn': [false, false], 'Maximilian Featherstonehaugh-Smythe': [false, false],
      }
      const got = {}
      for (const name of Object.keys(want)) got[name] = { buttons: await copies(await row(name)), line: await noLine(await row(name)) }
      const wrong = Object.entries(want).filter(([name, [idOff, userOff]]) => {
        const { buttons: g, line } = got[name]
        const [id, user] = g
        return g.length !== 2 || line !== null || id?.label !== 'Copy Discord ID' || user?.label !== 'Copy username' || id.off !== idOff || user.off !== userOff || id.disabled || user.disabled
          || (idOff ? id.tip !== NO_ID : id.tip !== null) || (userOff ? user.tip !== NO_USERNAME : user.tip !== USERNAME_TIP) || id.h < 44 || user.h < 44
      })
      expect(wrong.length === 0,
        `${size.join('x')}: every pending row has Copy Discord ID then Copy username (no Copy code: a pending code may not exist), 44px tall; greyed with its tip where there is none on file (Hugo the id, Leo the username), still in the keyboard's path; the username's tip says it can be the Whop one`, JSON.stringify(wrong.map(([n]) => [n, got[n]])))
      const notes = {}
      for (const name of Object.keys(want)) notes[name] = await (await row(name)).evaluate((r) => r.querySelector('[data-username-note]')?.textContent ?? null)
      expect(Object.entries(notes).every(([n, t]) => (n === 'Hugo Lindahl' ? t === USERNAME_NOTE : t === null)),
        `${size.join('x')}: Hugo, a username and no Discord ID: the line "${USERNAME_NOTE}" beside the buttons, shown on a phone too; nobody with a Discord ID has it`, JSON.stringify(notes))
      const priya = await row('Priya Raman')
      expect((await copies(priya)).length === 0 && (await noLine(priya)) === NO_LINE && (await rowText(priya)).includes(NO_LINE),
        `${size.join('x')}: Priya, neither on file: no copy button, the line "${NO_LINE}" in their place (a phone shows no tip)`, JSON.stringify({ buttons: await copies(priya), line: await noLine(priya) }))
      const ethan = await copies(await row('Ethan Cole'))
      const iris = await copies(await row('Iris Novak'))
      expect(JSON.stringify(ethan.map((b) => [b.label, b.off])) === JSON.stringify([['Copy code', false], ['Copy Discord ID', false], ['Copy username', false]])
          && JSON.stringify(iris.map((b) => [b.label, b.off, b.tip])) === JSON.stringify([['Copy code', false, null], ['Copy Discord ID', true, NO_ID], ['Copy username', false, USERNAME_TIP]])
          && (await (await row('Iris Novak')).evaluate((r) => r.querySelector('[data-username-note]')?.textContent ?? null)) === USERNAME_NOTE,
        `${size.join('x')}: beside Copy code, an approved row (Ethan) and Iris's rejected one: Copy Discord ID and Copy username, Iris's id greyed with its tip and the note beside them`, JSON.stringify({ ethan, iris }))
      await check(`30% off, Copy Discord ID and Copy username, ${size.join('x')}`, `thirty-copies-${size[0]}`)
    }
    await viewport([1280, 720])
    await holdClipboard()
    await press(await buttonIn(await row('Maya Lindqvist'), 'Copy Discord ID'))
    await press(await buttonIn(await row('Maya Lindqvist'), 'Copy username'))
    await sleep(200)
    const said = await (await row('Maya Lindqvist')).evaluate((r) => [...r.querySelectorAll('button')].filter((b) => /^Copied$/.test(b.textContent.trim())).length)
    expect(JSON.stringify(await copied()) === JSON.stringify(['100000000000000101', '@maya.lq']) && said === 2,
      'Maya: Copy Discord ID copies her Discord id, Copy username "@maya.lq", each saying "Copied"', JSON.stringify(await copied()))
    await press(await buttonIn(await row('Hugo Lindahl'), 'Copy Discord ID'))
    await sleep(200)
    const hugoSaid = await (await row('Hugo Lindahl')).evaluate((r) => [...r.querySelectorAll('button')].map((b) => b.textContent.trim()).filter((t) => /^Copy|^Copied|^Couldn't/.test(t)))
    expect(JSON.stringify(await copied()) === JSON.stringify(['100000000000000101', '@maya.lq']) && JSON.stringify(hugoSaid) === JSON.stringify(['Copy Discord ID', 'Copy username']),
      'Hugo, no Discord id: a press on the greyed Copy Discord ID copies nothing and says nothing', JSON.stringify(hugoSaid))
    await holdClipboard()
    await press(await buttonIn(await row('Iris Novak'), 'Copy username'))
    await press(await buttonIn(await row('Iris Novak'), 'Copy code'))
    await sleep(200)
    expect(JSON.stringify(await copied()) === JSON.stringify(['@iris.n', 'ECOM30-Q8M3TZ']),
      'Iris, her username stored as "@iris.n": Copy username copies "@iris.n", never "@@iris.n"; Copy code the code Whop attached', JSON.stringify(await copied()))
    expect((await calls()).every((c) => c.name === 'loadThirty'), 'copying calls no route')
  }

  // The review of 2026-10-26, the owner's applicant: "he never had a membership. I see one payment, but it has failed
  // ... he watched the course even though he never paid." Since the owner's answers of the same day, one rule: "If they
  // don't have a payment and a paid plan - no applying to 30% off." ?state=unpaid: Jonah's stored row says Whop does not
  // show both a paid course plan and a payment that went through; Maya's stored row is a clean one and Whop says it only now.
  console.log('\n30% off: Whop showing no paid course plan and payment (?state=unpaid): the verdict, no Approve, a plain Approve refused, Approve anyway')
  {
    for (const size of SIZES) {
      await open('?state=unpaid', size)
      await waitReady()
      const jonah = await row('Jonah Pereira')
      const t = await rowText(jonah)
      const dot = await jonah.evaluate((r) => r.querySelector('[data-verdict]')?.getAttribute('data-verdict') ?? null)
      expect(t.includes(`${NO_PAYMENT} · 49 of 61 videos · 49 needed for 80%`) && dot === 'unpaid' && !t.includes(YES)
          && (await isNull(await buttonIn(jonah, 'Approve'))) && !(await isNull(await linkIn(jonah))) && !(await isNull(await buttonIn(jonah, 'Reject'))),
        `${size.join('x')}: Jonah, 49 of 61 and Whop showing no paid course plan and payment: the verdict says so in the page's own words with the count, no Approve, Approve anyway for an admin, Reject`, t)
      await check(`30% off, unpaid, ${size.join('x')}`, `thirty-unpaid-${size[0]}`)
    }
    await viewport([1280, 720])
    // Check Whop again on the unpaid row too (the review of 2026-10-26): Whop still shows the student so, so it stays.
    expect(!(await isNull(await buttonIn(await row('Jonah Pereira'), 'Check Whop again'))), 'Jonah\'s row has Check Whop again, as the coupon\'s row does')
    await press(await buttonIn(await row('Jonah Pereira'), 'Check Whop again'))
    await shown("Whop still doesn't show both a paid course plan and a payment that went through for Jonah Pereira.")
    await settled()
    expect((await rowText(await row('Jonah Pereira'))).includes(NO_PAYMENT) && (await calls()).some((c) => c.name === 'checkCoupon' && c.args[0] === 'r-jonah'),
      'Check Whop again: the notice says Whop still does not show both, and the row read again says the same', await rowText(await row('Jonah Pereira')))
    // Sofia: her stored row says the same, and Whop shows her paid now (the review of 2026-10-26). The notice names the
    // payment that went through alone: where the plan cannot be known the payment decides, so "a paid course plan" was
    // not always true. The rule decides her row again.
    expect((await rowText(await row('Sofia Marin'))).includes(NO_PAYMENT), 'Sofia: her stored row says the student is unpaid, so her verdict does')
    await press(await buttonIn(await row('Sofia Marin'), 'Check Whop again'))
    await shown('Whop shows a payment that went through for Sofia Marin now. The 30% rule decides this request again.')
    await settled()
    const sofiaNow = await rowText(await row('Sofia Marin'))
    expect(!sofiaNow.includes(NO_PAYMENT) && (await calls()).some((c) => c.name === 'checkCoupon' && c.args[0] === 'r-sofia')
        && !(await page.evaluate(() => document.body.innerText)).includes('Whop shows a paid course plan'),
      'Check Whop again on Sofia: the notice names the payment alone, never a paid course plan, and her row read again is the rule\'s', sofiaNow)
    // Maya: the stored row is clean, so her row says yes until Approve asks Whop.
    const loads = (await calls()).filter((c) => c.name === 'loadThirty').length
    expect((await rowText(await row('Maya Lindqvist'))).includes(YES_EVERY), 'Maya: her stored row is a clean one, so the verdict is the rule\'s yes')
    await press(await buttonIn(await row('Maya Lindqvist'), 'Approve'))
    const REFUSED = 'Not approved: the 30% rule says no for this request now. Its row shows why.'
    await shown(REFUSED)
    await settled()
    const maya = await row('Maya Lindqvist')
    const m = await rowText(maya)
    const alert = await rowAlert(maya)
    expect(alert === REFUSED && m.includes(NO_PAYMENT) && (await isNull(await buttonIn(maya, 'Approve'))) && !(await isNull(await linkIn(maya)))
        && (await calls()).filter((c) => c.name === 'loadThirty').length === loads + 1 && JSON.stringify((await calls()).filter((c) => c.name === 'approve').map((c) => c.args)) === JSON.stringify([['r-maya', false, false]]),
      'Maya\'s Approve: refused with code "rule", the page\'s own sentence on her row, the list read again, and her verdict now says the paid plan and the payment; Approve anyway in Approve\'s place', JSON.stringify({ alert, m }))
    expect((await row('Maya Lindqvist').then((h) => h.evaluate((r) => r.dataset.rowStatus))) === 'pending', 'nothing approved: Maya is still on the list, pending')
    await press(await linkIn(await row('Jonah Pereira')))
    await page.waitForSelector('[data-approve-anyway-confirm]')
    const confirmText = await page.evaluate(() => document.querySelector('[data-approve-anyway-confirm]')?.textContent ?? null)
    expect(confirmText === `Approve anyway skips the 30% rule, and creates the student's Whop code now. The rule says: ${NO_PAYMENT} A discount already on the membership is still checked first.`,
      'Jonah\'s Approve anyway asks once, naming why the rule says no', confirmText)
    await check('30% off, Approve anyway past an unpaid student, 1280x720', 'thirty-unpaid-anyway-1280')
    await press(await buttonIn(await row('Jonah Pereira'), 'Yes, create the code'))
    await shown('Jonah Pereira: the code ECOM30-')
    await settled()
    const sent = (await calls()).filter((c) => c.name === 'approve').map((c) => c.args)
    const left = await leftOn('Jonah Pereira', madeNotOn('Jonah Pereira', `${NO_MEMBERSHIP} ${AGAIN}`))
    expect(JSON.stringify(sent.at(-1)) === JSON.stringify(['r-jonah', true, false]) && left.ok,
      'Approve anyway: one approve call with override; the code made, and with no paid course membership to put it on (his last failure) Jonah stays listed, approved, the notice saying why (until the review of 2026-10-27 the dev page put every code on)', JSON.stringify({ sent, left }))
    // A csm: no Approve anyway, so Jonah's row has Check Whop again and Reject.
    await open('?state=unpaid&role=csm')
    await waitReady()
    const csm = await actionsOf(await row('Jonah Pereira'))
    expect(JSON.stringify(csm) === JSON.stringify(['Check Whop again', 'Reject']), 'a csm: Jonah\'s row has Check Whop again and Reject (Reject alone until the review of 2026-10-26)', JSON.stringify(csm))
  }

  console.log('\n30% off: Approve on the rule\'s yes makes the code, and Hugo, whose coupon Whop names only now (D5)')
  {
    await open('')
    await waitReady()
    await press(await buttonIn(await row('Jonah Pereira'), 'Approve'))
    await shown('Jonah Pereira: the code ECOM30-')
    await settled()
    const made = await calls()
    expect(made.filter((c) => c.name === 'approve').map((c) => JSON.stringify(c.args)).join() === '["r-jonah",false,false]',
      'Approve on Jonah: one approve call, without override', JSON.stringify(made.map((c) => c.name)))
    // Whop shows him no paid course membership (his last failure): the shared step makes the code and leaves it there.
    // The approve table's "applied" is proven on Tara below (?state=stalecoupon), whose membership takes the code.
    const left = await leftOn('Jonah Pereira', madeNotOn('Jonah Pereira', `${NO_MEMBERSHIP} ${AGAIN}`))
    const why = await (await row('Jonah Pereira')).evaluate((r) => r?.querySelector('[data-why]')?.textContent ?? null)
    expect(left.ok && why === `${NO_MEMBERSHIP} ${AGAIN}` && JSON.stringify(await actionsOf(await row('Jonah Pereira'))) === JSON.stringify(['Try again', 'Reject']),
      'the approve table\'s "made but not on their membership yet": the notice stays with Copy code, and Jonah stays listed, approved, with Try again and Reject and the same Why line (until the review of 2026-10-27 the dev page put the code on and he left the list)', JSON.stringify({ left, why }))

    await press(await buttonIn(await row('Hugo Lindahl'), 'Approve'))
    await shown('Hugo Lindahl: This student already has a discount on their membership')
    await settled()
    const notice = await page.$eval('[role="alert"]', (e) => ({ text: e.textContent, copy: [...e.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Copy code') }))
    expect(notice.text.startsWith(`Hugo Lindahl: ${COUPON_LINE}`) && !notice.copy,
      'Whop says now that evolve10 applies: the approve route\'s own sentence, naming the code, with nothing to copy', JSON.stringify(notice))
    const hugo = await row('Hugo Lindahl')
    expect((await rowText(hugo)).includes(COUPON_LINE) && !(await rowText(hugo)).includes('Coupon not checked yet') && !(await isNull(await linkIn(hugo))) && (await isNull(await buttonIn(hugo, 'Approve'))),
      'the list is read again: Hugo\'s row now shows the coupon the route stored, no "not checked" line, no Approve, and Approve anyway for an admin (the owner\'s review)')
    await press(await buttonIn(hugo, 'Reject'))
    await page.waitForSelector('input[placeholder^="For example"]')
    const prefilled = await page.$eval('input[placeholder^="For example"]', (i) => i.value)
    expect(prefilled === MAP_LINE, 'his Reject opens with the reason filled in: the map\'s own sentence to the student, who reads it there (the render review\'s second round)', prefilled)
    await press(await buttonIn(await row('Hugo Lindahl'), 'Cancel'))
    expect((await row('Hugo Lindahl').then((h) => h.evaluate((r) => r.dataset.rowStatus))) === 'pending', 'and he stays on the list, pending, nothing approved')
    for (const size of SIZES) {
      await viewport(size)
      await check(`30% off, Approve refused for the coupon, ${size.join('x')}`, `thirty-coupon-refused-${size[0]}`)
    }
  }

  // The render review's second round: a coupon row asks Whop again for its one student
  // (POST /api/admin/thirty/check-coupon on the real page; fixtures.ts answers it here).
  console.log('\n30% off: Check Whop again on the coupon\'s row, and the reason the team can change')
  {
    const CHECK = 'Check Whop again'
    const DOWN = 'Whop gave no answer, so nothing changed. Try again in a minute.'
    // full: evolve10 is still on Tara's membership in Whop.
    await open('')
    await waitReady()
    let tara = await row('Tara Quinn')
    const look = await (await buttonIn(tara, CHECK)).evaluate((b) => {
      const cs = getComputedStyle(b)
      const r = b.getBoundingClientRect()
      return { bg: cs.backgroundColor, border: cs.borderTopStyle, underline: cs.textDecorationLine, size: cs.fontSize, h: Math.round(r.height) }
    })
    expect(look.bg === 'rgba(0, 0, 0, 0)' && look.border === 'none' && look.underline === 'underline' && look.size === '13px' && look.h >= 44,
      'Tara\'s coupon row: "Check Whop again" in Approve\'s place, a small link as Approve anyway is (no fill, underlined 13px words, a 44px target)', JSON.stringify(look))
    const before = (await calls()).length
    await press(await buttonIn(tara, CHECK))
    await shown("Whop still shows a discount on Tara Quinn's membership (evolve10).")
    await settled()
    const made = (await calls()).slice(before).map((c) => (c.args.length ? `${c.name}:${c.args.join(',')}` : c.name))
    expect(JSON.stringify(made) === JSON.stringify(['checkCoupon:r-tara', 'loadThirty']), 'one check for her request, then the list read again', JSON.stringify(made))
    tara = await row('Tara Quinn')
    expect((await rowText(tara)).includes(COUPON_LINE) && (await isNull(await buttonIn(tara, 'Approve'))) && !(await isNull(await buttonIn(tara, CHECK))),
      'Whop still names evolve10: the notice says so, and the row stays the coupon\'s (Check Whop again and Reject, no Approve)', await rowText(tara))
    for (const size of SIZES) {
      await viewport(size)
      await check(`30% off, Check Whop again, the code still there, ${size.join('x')}`, `thirty-check-still-${size[0]}`)
    }
    await viewport([1280, 720])
    // The reason Reject starts with is the map's sentence, and the team can change it before it is sent.
    await press(await buttonIn(await row('Tara Quinn'), 'Reject'))
    await page.waitForSelector('input[placeholder^="For example"]')
    expect((await page.$eval('input[placeholder^="For example"]', (i) => i.value)) === MAP_LINE, 'Tara\'s Reject opens with the map\'s own sentence, no code and no "their"')
    await page.$eval('input[placeholder^="For example"]', (i) => i.select())
    await page.keyboard.press('Backspace')
    await page.keyboard.type('You already have a discount on your membership.')
    await press(await buttonIn(await row('Tara Quinn'), 'Reject the request'))
    await shown('Rejected the request from Tara Quinn.')
    await settled()
    const sent = (await calls()).filter((x) => x.name === 'reject').map((x) => x.args)
    expect(JSON.stringify(sent) === JSON.stringify([['r-tara', 'You already have a discount on your membership.']]) && (await isNull(await row('Tara Quinn'))),
      'the team changed it: the rejection carries their words, and Tara leaves the list (the reject table\'s "no code": "Rejected the request from Tara Quinn.")', JSON.stringify(sent))

    // stalecoupon: evolve10 came off Tara's membership in Whop since the cron stored it.
    await open('?state=stalecoupon')
    await waitReady()
    tara = await row('Tara Quinn')
    expect((await rowText(tara)).includes(COUPON_LINE) && (await isNull(await buttonIn(tara, 'Approve'))), 'the stored answer still says evolve10: no Approve on her row yet')
    await press(await buttonIn(tara, CHECK))
    await shown("Whop shows no discount on Tara Quinn's membership now.")
    await settled()
    tara = await row('Tara Quinn')
    const t = await rowText(tara)
    const approveOn = !(await isNull(await buttonIn(tara, 'Approve'))) && !(await (await buttonIn(tara, 'Approve')).evaluate((b) => b.disabled))
    const verdictNow = await tara.evaluate((r) => r.querySelector('[data-verdict]')?.dataset.verdict)
    expect(verdictNow === 'yes' && t.includes(YES_EVERY) && t.includes('61 of 61 videos') && approveOn && (await isNull(await buttonIn(tara, CHECK))),
      'the coupon is gone: the row is the rule\'s again, its yes and its count, with Approve on and no Check Whop again (its Why line keeps the job\'s last refusal until the app tries again)', t)
    for (const size of SIZES) {
      await viewport(size)
      await check(`30% off, Check Whop again, the coupon gone, ${size.join('x')}`, `thirty-check-gone-${size[0]}`)
    }
    await viewport([1280, 720])
    await press(await buttonIn(await row('Tara Quinn'), 'Approve'))
    await shown('Approved Tara Quinn.')
    await settled()
    // Her membership active, no code on it now: the shared step puts the code on (the approve table's "applied").
    const n = (await notices()).find((x) => x.text.startsWith('Approved Tara Quinn.'))
    expect(n && /^Approved Tara Quinn\. The code ECOM30-[A-Z0-9]{6} is on their membership\.$/.test(n.text) && n.role === 'status' && n.copy && (await isNull(await row('Tara Quinn'))),
      'and Approve goes through, the approve table\'s "applied": "Approved Tara Quinn. The code ECOM30-... is on their membership.", a success with Copy code, and Tara leaves the list', JSON.stringify(n))

    // whop=down: Whop gives no answer. The row says so, and nothing changes.
    await open('?whop=down')
    await waitReady()
    const loads = (await calls()).filter((c) => c.name === 'loadThirty').length
    await press(await buttonIn(await row('Tara Quinn'), CHECK))
    await shown(DOWN)
    tara = await row('Tara Quinn')
    const alert = await rowAlert(tara)
    expect(alert === DOWN && (await rowText(tara)).includes(COUPON_LINE) && (await calls()).filter((c) => c.name === 'loadThirty').length === loads && !(await isNull(await buttonIn(tara, CHECK))),
      'Whop down: the route\'s sentence on the row, the row as it was, the list not read again, Check Whop again there to try again', alert ?? '')
    await check('30% off, Check Whop again, Whop down, 1280x720', 'thirty-check-down-1280')
  }

  console.log('\n30% off: Approve anyway, the small link, an inline confirm, then the call with override')
  /** Approve anyway's confirm on the page, as shown. */
  const confirmShown = () => page.evaluate(() => document.querySelector('[data-approve-anyway-confirm]')?.textContent ?? null)
  {
    await open('')
    await waitReady()
    await press(await linkIn(await row('Priya Raman')))
    await page.waitForFunction(() => document.body.innerText.includes('Approve anyway skips the 30% rule'))
    expect(!(await calls()).some((c) => c.name === 'approve'), 'the first click opens the confirm and calls nothing')
    // The owner's review (2026-10-21): the confirm names what it skips, in the row's own words.
    const confirmText = await confirmShown()
    expect(confirmText === `Approve anyway skips the 30% rule, and creates the student's Whop code now. The rule says: ${NOT_YET} A discount already on the membership is still checked first.`,
      'the confirm says what it skips (the rule, and why it said no) and what it does not', confirmText)
    for (const size of SIZES) {
      await viewport(size)
      await check(`30% off, the Approve anyway confirm, ${size.join('x')}`, `thirty-override-confirm-${size[0]}`)
    }
    await viewport([1280, 720])
    await press(await buttonIn(await row('Priya Raman'), 'Yes, create the code'))
    await shown('Priya Raman: the code ECOM30-')
    await settled()
    const after = await calls()
    expect(after.some((c) => c.name === 'approve' && c.args[0] === 'r-priya' && c.args[1] === true && c.args[2] === false), 'the second click sends approve with override, the coupon still checked', JSON.stringify(after.filter((c) => c.name === 'approve')))
    // Her payment failed (past_due): the code is made, and can't go on until Whop takes the payment.
    const left = await leftOn('Priya Raman', madeNotOn('Priya Raman', `Their membership is past_due on Whop, so the code can't go on yet. ${AGAIN}`))
    expect(left.ok, 'the code made, not on: her membership is past_due, so Priya stays listed, approved, the notice saying why (until the review of 2026-10-27 she left the list)', JSON.stringify(left))
  }

  // The owner's review (2026-10-21): a founder or an admin approves past any check, the coupon's row too.
  console.log('\n30% off: Approve anyway on the coupon\'s row, naming the code it skips')
  {
    await open('')
    await waitReady()
    await press(await linkIn(await row('Tara Quinn')))
    await page.waitForSelector('[data-approve-anyway-confirm]')
    const confirmText = await confirmShown()
    expect(confirmText === `Approve anyway skips the coupon check and the 30% rule, and creates the student's Whop code now. ${COUPON_LINE}`,
      'Tara\'s confirm names the coupon (evolve10) and the rule it skips', confirmText)
    for (const size of SIZES) {
      await viewport(size)
      await check(`30% off, Approve anyway on the coupon's row, ${size.join('x')}`, `thirty-override-coupon-${size[0]}`)
    }
    await viewport([1280, 720])
    await press(await buttonIn(await row('Tara Quinn'), 'Yes, create the code'))
    await shown('Tara Quinn: the code ECOM30-')
    await settled()
    const sent = (await calls()).filter((c) => c.name === 'approve').map((c) => c.args)
    // evolve10 is still on her membership: the code is made past the check, and the membership can't take it.
    const left = await leftOn('Tara Quinn', madeNotOn('Tara Quinn', `${HAS_CODE} ${AGAIN}`))
    expect(JSON.stringify(sent) === JSON.stringify([['r-tara', true, true]]) && left.ok,
      'one approve call, with override and overrideCoupon; the code made past evolve10, which is still on her membership, so Tara stays listed, approved, "made but not on their membership yet" (until the review of 2026-10-27 she left the list)', JSON.stringify({ sent, left }))
  }

  console.log('\n30% off: the approve route\'s 409 "The course changed", then Approve anyway in Approve\'s place')
  {
    const COURSE = 'The course changed and this check cannot run. Nothing was approved.'
    await open('?approve=coursechanged')
    await waitReady()
    const loads = (await calls()).filter((c) => c.name === 'loadThirty').length
    await press(await buttonIn(await row('Jonah Pereira'), 'Approve'))
    await shown(COURSE)
    await settled()
    const jonah = await row('Jonah Pereira')
    const alert = await rowAlert(jonah)
    expect(alert === COURSE && (await isNull(await buttonIn(jonah, 'Approve'))) && !(await isNull(await linkIn(jonah)))
        && (await rowText(jonah)).includes(YES),
      'the 409 stays on Jonah\'s row in the route\'s words, and Approve anyway takes Approve\'s place though the verdict says yes (Approve used to come back, to be refused again)', alert ?? '')
    expect((await calls()).filter((c) => c.name === 'loadThirty').length === loads + 1, 'the list is read again, quietly, in case its verdict changed')
    for (const size of SIZES) {
      await viewport(size)
      await check(`30% off, a row the approve route refused, ${size.join('x')}`, `thirty-refused-row-${size[0]}`)
    }
    await viewport([1280, 720])
    await press(await linkIn(await row('Jonah Pereira')))
    await page.waitForSelector('[data-approve-anyway-confirm]')
    const confirmText = await confirmShown()
    expect(confirmText === `Approve anyway skips the check that refused this approval, and creates the student's Whop code now. The check said: ${COURSE} A discount already on the membership is still checked first.`,
      'its confirm names the check that refused, in the route\'s words', confirmText)
    for (const size of SIZES) {
      await viewport(size)
      await check(`30% off, Approve anyway after the 409, ${size.join('x')}`, `thirty-refused-confirm-${size[0]}`)
    }
    await viewport([1280, 720])
    await press(await buttonIn(await row('Jonah Pereira'), 'Yes, create the code'))
    await shown('Jonah Pereira: the code ECOM30-')
    await settled()
    const sent = (await calls()).filter((c) => c.name === 'approve').map((c) => c.args)
    expect(JSON.stringify(sent) === JSON.stringify([['r-jonah', false, false], ['r-jonah', true, false]]), 'Approve, then Approve anyway with override: the code made', JSON.stringify(sent))
    const left = await leftOn('Jonah Pereira', madeNotOn('Jonah Pereira', `${NO_MEMBERSHIP} ${AGAIN}`))
    expect(left.ok, 'Jonah stays listed, approved: no paid course membership to put the code on (until the review of 2026-10-27 the dev page put it on)', JSON.stringify(left))
  }

  console.log('\n30% off: a csm has no Approve anyway, and no Reject where the code may exist')
  for (const size of SIZES) {
    await open('?role=csm', size)
    await waitReady()
    const rows = await page.$$eval('.list-row', (rs) => rs.map((r) => ({
      name: r.querySelector('a')?.textContent,
      // The copy buttons (Copy code, Copy Discord ID, Copy username) are every role's: left out here.
      buttons: [...r.querySelectorAll('button')].map((b) => b.textContent.trim()).filter((t) => !/^Copy (code|Discord ID|username)$/.test(t)),
    })))
    const by = Object.fromEntries(rows.map((r) => [r.name, r.buttons.join(',')]))
    expect(rows.every((r) => !r.buttons.includes('Approve anyway')) && by['Tara Quinn'] === 'Check Whop again,Reject' && by['Priya Raman'] === 'Reject'
        && by['Maya Lindqvist'] === 'Approve,Reject' && by['Hugo Lindahl'] === 'Approve,Reject'
        && by['Ethan Cole'] === 'Try again' && by['Nora Brandt'] === 'Try again' && by['Iris Novak'] === '',
      `${size.join('x')}: no Approve anyway on any row; Tara has Check Whop again and Reject, Priya Reject alone, Approve where the verdict says yes; an approved row Try again alone (Reject is a founder's or an admin's), Iris's nothing`, JSON.stringify(by))
    await check(`30% off, a csm, ${size.join('x')}`, `thirty-csm-${size[0]}`)
  }
  {
    // A founder, as an admin: Approve anyway where a check refuses, Try again and Reject on an approved row.
    await open('?role=founder')
    await waitReady()
    const by = Object.fromEntries((await page.$$eval('.list-row', (rs) => rs.map((r) => [r.querySelector('a')?.textContent,
      [...r.querySelectorAll('button')].map((b) => b.textContent.trim()).filter((t) => !/^Copy (code|Discord ID|username)$/.test(t)).join(',')]))))
    expect(by['Ethan Cole'] === 'Try again,Reject' && by['Nora Brandt'] === 'Try again,Reject' && by['Priya Raman'] === 'Approve anyway,Reject' && by['Iris Novak'] === '',
      'a founder: Try again and Reject on an approved row, Approve anyway where a check refuses, nothing on Iris\'s decided row', JSON.stringify(by))
  }

  console.log('\n30% off: Reject, its reason, and what the student sees')
  {
    await open('')
    await waitReady()
    // The example reason says the rule the window had (the review of 2026-10-26): every video for a deadline before
    // 26 October (Sofia's shared window, the owner's B), the 80% from then on (Jonah's).
    const hint = async (name) => (await row(name)).evaluate((r) => r.querySelector('input[placeholder^="For example"]')?.getAttribute('placeholder') ?? null)
    await press(await buttonIn(await row('Sofia Marin'), 'Reject'))
    await page.waitForSelector('input[placeholder^="For example"]')
    const sofiaHint = await hint('Sofia Marin')
    await press(await buttonIn(await row('Sofia Marin'), 'Cancel'))
    await press(await buttonIn(await row('Jonah Pereira'), 'Reject'))
    await page.waitForSelector('input[placeholder^="For example"]')
    const jonahHint = await hint('Jonah Pereira')
    expect(sofiaHint === 'For example: not every video was watched by the deadline' && jonahHint === 'For example: fewer than 80% of the videos were watched by the deadline',
      'the example reason: every video on Sofia\'s row (a deadline before 26 October), the 80% on Jonah\'s', JSON.stringify({ sofiaHint, jonahHint }))
    expect((await bodyText()).includes('The student sees this reason on their map, and cannot ask for the 30% again.'), 'the panel says the student sees the reason and cannot ask again')
    for (const size of SIZES) {
      await viewport(size)
      await check(`30% off, the Reject panel, ${size.join('x')}`, `thirty-reject-panel-${size[0]}`)
    }
    await viewport([1280, 720])
    await page.type('input[placeholder^="For example"]', 'Two accounts on one card.')
    await press(await buttonIn(await row('Jonah Pereira'), 'Reject the request'))
    await shown('Rejected the request from Jonah Pereira.')
    await settled()
    expect((await calls()).some((x) => x.name === 'reject' && x.args[0] === 'r-jonah' && x.args[1] === 'Two accounts on one card.'), 'reject is sent with the reason')
    expect(await isNull(await row('Jonah Pereira')), 'Jonah leaves the list: rejected, and no code was made')
  }

  console.log('\n30% off: a 409 on approve and on reject')
  {
    await open('?conflict=1')
    await waitReady()
    await press(await buttonIn(await row('Maya Lindqvist'), 'Approve'))
    await shown('this request had already been decided, so the code must be deleted in Whop.')
    await settled()
    expect((await calls()).filter((x) => x.name === 'loadThirty').length === 2, 'approve answered 409: its sentence is shown and the list is read again')
    const notice = await page.$eval('[role="alert"]', (e) => ({ text: e.textContent, copy: [...e.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Copy code') }))
    expect(notice.text.startsWith('Maya Lindqvist: The Whop code ECOM30-') && notice.copy, 'the notice names the student and the code to delete, with Copy code', JSON.stringify(notice))
    // As the approve route leaves it (the build's review of 2026-10-27): rejected by another member, holding the code
    // Whop made, with a write_failed (decided_meanwhile) naming it, so the request stays listed for 30 days with that code.
    const code = notice.text.match(/ECOM30-[A-Z0-9]{6}/)?.[0] ?? null
    const maya = await row('Maya Lindqvist')
    const mayaNow = await maya.evaluate((r) => r ? { status: r.dataset.rowStatus, why: r.querySelector('[data-why]')?.textContent ?? null, code: r.querySelector('code')?.textContent ?? null,
      buttons: [...r.querySelectorAll('button')].map((b) => b.textContent.trim()).filter((t) => !/^Copy (code|Discord ID|username)$/.test(t)), copy: [...r.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Copy code') } : null)
    expect(code && mayaNow && mayaNow.status === 'rejected' && mayaNow.why === `Whop made ${code}, but the request had changed. Delete ${code} in Whop.` && mayaNow.code === code && mayaNow.copy && mayaNow.buttons.length === 0,
      'Maya stays on the list, rejected by another member: "Whop made <code>, but the request had changed. Delete <code> in Whop.", the code with Copy code, nothing to press (until the review she left the list)', JSON.stringify(mayaNow))
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
    await shown('Jonah Pereira: This request was already decided.')
    await settled()
    // Another member's Approve went through first, as the routes do it: the 30% on, the request applied (the build's
    // review of 2026-10-27: the dev page had turned it approved, which no route answers "already decided" for).
    expect(await isNull(await row('Jonah Pereira')) && (await calls()).filter((x) => x.name === 'loadThirty').length === 3,
      'reject answered 409: its sentence is shown and the list read again, Jonah gone from it (another member\'s Approve put the 30% on)')
  }

  console.log('\n30% off: a decision goes through, then the list cannot be read again')
  {
    const STALE = "Couldn't refresh the list, so it may be out of date. Press Refresh."
    await open('?reload=fail')
    await waitReady()
    await press(await buttonIn(await row('Maya Lindqvist'), 'Approve'))
    await shown(STALE)
    await settled()
    const said = await page.evaluate(() => ({
      status: [...document.querySelectorAll('[role="status"]')].map((e) => e.textContent),
      alert: [...document.querySelectorAll('[role="alert"]')].map((e) => e.textContent),
    }))
    // Her membership still holds welcome50's id (a used-up code stays on it): the code is made, not on (the build's
    // review of 2026-10-27; the dev page had put it on).
    expect(said.alert.some((t) => /^Maya Lindqvist: the code ECOM30-[A-Z0-9]{6} is made but not on their membership yet\. Their membership already has another code on Whop\. The app tries again\./.test(t))
        && said.alert.some((t) => t.startsWith(STALE)),
      'what the press did and its code in a notice of their own, the list being out of date on a line of its own', JSON.stringify(said))
    const maya = await row('Maya Lindqvist')
    expect((await (await buttonIn(maya, 'Approve')).evaluate((b) => b.disabled)) && (await (await buttonIn(maya, 'Reject')).evaluate((b) => b.disabled))
      && (await maya.evaluate((r) => r.textContent.includes('Saved. Press Refresh to see this row as it is now.'))),
      "Maya's row, still shown as it was, keeps its buttons off until a read works")
    for (const size of SIZES) {
      await viewport(size)
      await check(`30% off, the reload failed, ${size.join('x')}`, `thirty-reload-failed-${size[0]}`)
    }
  }

  console.log('\n30% off: an approved row: Try again, and Reject confirmed first')
  {
    await open('')
    await waitReady()
    for (const size of SIZES) {
      await viewport(size)
      await check(`30% off, the approved rows, ${size.join('x')}`, `thirty-approved-${size[0]}`)
    }
    await viewport([1280, 720])
    // Whop gives no answer about Nora's membership: Try again can't tell where the code is (the build's review of
    // 2026-10-27; the dev page had put it on).
    await press(await buttonIn(await row('Nora Brandt'), 'Try again'))
    await shown('Nora Brandt: the code ECOM30-7B20C4 is made but not on their membership yet.')
    await settled()
    const tried = (await calls()).filter((c) => c.name === 'approve').map((c) => c.args)
    const left = await leftOn('Nora Brandt', madeNotOn('Nora Brandt', `Whop didn't answer. ${AGAIN}`, 'ECOM30-7B20C4'))
    expect(JSON.stringify(tried) === JSON.stringify([['r-nora', false, false]]) && left.ok,
      'Try again: one approve call on the approved request, no override; Whop silent about her membership: "Nora Brandt: the code ECOM30-7B20C4 is made but not on their membership yet. Whop didn\'t answer. The app tries again.", and she stays listed, approved', JSON.stringify({ tried, left }))
    await press(await buttonIn(await row('Ethan Cole'), 'Reject'))
    await page.waitForSelector('[data-reject-confirm]')
    const confirm = await page.$eval('[data-reject-confirm]', (e) => e.textContent)
    expect(confirm === 'The code ECOM30-3F9A21 stays usable at checkout until someone switches it off in Whop.' && !(await calls()).some((c) => c.name === 'reject'),
      'Reject on an approved row asks first: the code stays usable at checkout until someone switches it off in Whop (§9.6); nothing is sent yet', confirm)
    await check('30% off, Reject on an approved row, 1280x720', 'thirty-approved-reject-1280')
    await press(await buttonIn(await row('Ethan Cole'), 'Reject the request'))
    await shown('Rejected. The code ECOM30-3F9A21 stays usable at checkout until someone switches it off in Whop.')
    await settled()
    const r = (await notices()).find((x) => x.text.startsWith('Rejected.'))
    // The build's review of 2026-10-27: the request stays on the list (a write_failed, rejected_usable), rejected, with
    // the code to switch off and its words; until then it left the list with the notice the only trace.
    const ethan = await (await row('Ethan Cole')).evaluate((r) => r ? { status: r.dataset.rowStatus, why: r.querySelector('[data-why]')?.textContent ?? null, code: r.querySelector('code')?.textContent ?? null,
      buttons: [...r.querySelectorAll('button')].map((b) => b.textContent.trim()).filter((t) => !/^Copy (code|Discord ID|username)$/.test(t)) } : null)
    expect(r?.role === 'alert' && r.copy && (await calls()).some((c) => c.name === 'reject' && c.args[0] === 'r-ethan')
        && ethan?.status === 'rejected' && ethan.why === 'Rejected. The code ECOM30-3F9A21 stays usable at checkout until someone switches it off in Whop.' && ethan.code === 'ECOM30-3F9A21' && ethan.buttons.length === 0,
      'the reject table\'s "usable": the notice stays until dismissed, with Copy code; Ethan stays on the list, rejected, with the code and the same words, nothing to press', JSON.stringify({ r, ethan }))
    await sleep(500)
    expect((await notices()).some((x) => x.text.startsWith('Rejected.')), 'and it is still there a moment later')
    for (const size of SIZES) {
      await viewport(size)
      await check(`30% off, a Reject that left the code usable, ${size.join('x')}`, `thirty-rejected-usable-${size[0]}`)
    }
    await viewport([1280, 720])
  }
  {
    // ?state=owncode: the team's own code is on Nora's membership in Whop already, so Try again marks it applied
    // (the approve table's "applied" for Try again).
    await open('?state=owncode')
    await waitReady()
    await press(await buttonIn(await row('Nora Brandt'), 'Try again'))
    await shown('Nora Brandt: the code ECOM30-7B20C4 is on their membership.')
    await settled()
    const n = (await notices()).find((x) => x.text.startsWith('Nora Brandt:'))
    expect(n?.role === 'status' && n.copy && /^Nora Brandt: the code ECOM30-7B20C4 is on their membership\.$/.test(n.text) && (await isNull(await row('Nora Brandt'))),
      'Try again, her own code already on her membership: "Nora Brandt: the code ECOM30-7B20C4 is on their membership.", a success with Copy code, and she leaves the list (applied)', JSON.stringify(n))
  }

  console.log('\n30% off: ?student= keeps the list to one student; an old ?tab= opens the list')
  {
    await open('?student=p-ethan')
    await waitReady()
    expect(JSON.stringify(await names()) === JSON.stringify(['Ethan Cole']) && (await bodyText()).includes('Showing Ethan Cole only.'), 'Ethan alone, the banner naming him')
    for (const size of SIZES) {
      await viewport(size)
      await check(`30% off, one student, ${size.join('x')}`, `thirty-student-${size[0]}`)
    }
    await viewport([1280, 720])
    await open('?student=p-omar')
    await waitReady()
    expect((await bodyText()).includes(EMPTY_STUDENT) && (await bodyText()).includes('Showing one student only.') && (await page.$$('.list-row')).length === 0,
      `Omar, whose request is applied: "${EMPTY_STUDENT}"`)
    await press(await button('Show everyone'))
    await sleep(300)
    expect(JSON.stringify(await names()) === JSON.stringify(LISTED) && !page.url().includes('student='), 'Show everyone: the filter goes, the whole list', `${(await names()).length} ${page.url()}`)
    for (const tab of ['applied', 'approved', 'code-applied', 'decide']) {
      await open(`?tab=${tab}`)
      await waitReady()
      expect(JSON.stringify(await names()) === JSON.stringify(LISTED) && (await page.$('[role="tablist"]')) === null, `?tab=${tab}, a link from before the one list: the list, whole, no tabs`)
    }
  }

  // ?state=reasons: every other reason a request can wait for (the newest attempt_failed of each), and the rows whose
  // Approve, Try again or Reject answers each line of the PRD's tables (§9.4).
  console.log('\n30% off: every other reason, its Why line')
  {
    const FIX = 'Fix it in Whop, then tell the owner so the app records it.'
    const REASONS = {
      'Old Claim': `Whop didn't answer. ${AGAIN}`,
      'Code Refused Late': `Whop wouldn't make the code: A promo code needs a plan on this company. ${TWO_DAYS}`,
      'Trial Holder': 'Their membership is a trial on Whop. The app leaves trials to the team: Approve or Try again puts the code on.',
      'Other Code': `Their membership already has another code on Whop. ${AGAIN}`,
      'Key Refused': `Whop refused the app's key. It needs member:manage. ${AGAIN}`,
      'Membership Unread': `Whop didn't answer. ${AGAIN}`,
      'Code Refused': `Whop wouldn't make the code: A promo code needs a plan on this company. ${AGAIN}`,
      'Create Silent': `Whop didn't answer. ${AGAIN}`,
      'Create No Id': `Whop didn't answer. ${AGAIN}`,
      'Lookup Failed': `Whop didn't answer. ${AGAIN}`,
      'Save Failed': `Whop made ECOM30-S4VE9P, but saving it failed. ${AGAIN}`,
      'Out Of Time': `Whop didn't answer. ${AGAIN}`,
      'Reopened Hand': 'Reopened by hand with ECOM30-R3OP2N. Approve attaches that code, or reject it.',
      'Approved Untried': "The app hasn't tried yet.",
      'Apply Refused': `Whop wouldn't take the code: This membership cannot take a promo code. ${AGAIN}`,
      'Attach Key Refused': `Whop refused the app's key. It needs member:manage. ${AGAIN}`,
      'Someone Else': `Whop shows ECOM30-0THRPR on someone else's membership. ${FIX}`,
      'Other Product': `Whop shows ECOM30-PR0DCT on their Agency Starter Kit membership, not the course. ${FIX}`,
      'Other Product Unnamed': `Whop shows ECOM30-PR0D2X on their membership of another product. ${FIX}`,
      'Free Membership': `Whop shows ECOM30-FR33MB on their free membership. ${FIX}`,
      'Filter Ignored': "The app can't tell whose membership ECOM30-F1LTR9 is on. Check it in Whop.",
      'No Ids': "The app can't tell whose membership ECOM30-N01DS4 is on. Check it in Whop.",
      'Old Name': 'This code was made before the app attached codes itself. Press Try again to attach it, or attach it in Whop.',
      'No Whop Id': 'This request has a code with no Whop id, so the app can\'t check it. Check ECOM30-UNKN0W in Whop, then tell the owner so the app records it.',
      'Approved Trial': 'Their membership is a trial on Whop. The app leaves trials to the team: Approve or Try again puts the code on.',
      'Approved Canceled': `Their membership is canceled on Whop, so the code can't go on yet. ${AGAIN}`,
      // The build's review of 2026-10-27: the where read's refused key names its scope; another code of the name Whop
      // put on; the job stopped after 6 failures only a person can clear; a Reject that left its code usable.
      'Where Key Refused': `Whop refused the app's key. It needs member:basic:read. ${AGAIN}`,
      'Same Name': 'Whop put another code named ECOM30-S4MEN4 on their membership. Check it in Whop, then tell the owner so the app records it.',
      'Gave Up Code': 'Their membership already has another code on Whop. The app stopped after 6 tries. Press Try again once that code is off their membership, or reject it.',
      'Gave Up Canceled': "Their membership is canceled on Whop, so the code can't go on yet. The app stopped after 6 tries. Press Try again if they join again, or reject it.",
      'Decided Meanwhile': 'Whop made ECOM30-D3C1DD, but the request had changed. Delete ECOM30-D3C1DD in Whop.',
      'Maybe Attached': 'Whop may have attached ECOM30-MAYB3A after the request was rejected. Check their membership in Whop.',
      'Applied Meanwhile': 'Whop made ECOM30-EXTR4C, but the request had changed. Delete ECOM30-EXTR4C in Whop.',
      'Rejected Usable': 'Rejected. The code ECOM30-R3JUSE stays usable at checkout until someone switches it off in Whop.',
    }
    for (const size of [[1440, 900], [390, 844]]) {
      await open('?state=reasons', size)
      await waitReady()
      const got = await whys()
      const wrong = Object.entries(REASONS).filter(([n, t]) => got[n] !== t)
      expect(wrong.length === 0, `${size.join('x')}: each of the ${Object.keys(REASONS).length} rows' Why lines, thirtyWords for its reason and step: pending, claimed, a hand reopen, approved, and rejected or applied with a write_failed`,
        JSON.stringify(wrong.map(([n]) => [n, got[n]])))
      const presses = Object.entries(got).filter(([n]) => /^(Approve|Try Again|Reject) /.test(n))
      expect(presses.length === 20 && presses.every(([, t]) => t === "The app hasn't tried yet."), `${size.join('x')}: the ${presses.length} rows of the presses, never tried yet`, JSON.stringify(presses.slice(0, 2)))
      const decided = await page.$$eval('.list-row[data-row-status="rejected"], .list-row[data-row-status="applied"]', (rs) => rs.map((r) => ({
        name: r.querySelector('a')?.textContent, code: r.querySelector('code')?.textContent ?? null,
        buttons: [...r.querySelectorAll('button')].map((b) => b.textContent.trim()).filter((t) => !/^Copy (code|Discord ID|username)$/.test(t)),
      })))
      expect(JSON.stringify(decided.map((d) => [d.name, d.code, d.buttons.length])) === JSON.stringify([['Decided Meanwhile', 'ECOM30-D3C1DD', 0], ['Maybe Attached', 'ECOM30-MAYB3A', 0], ['Applied Meanwhile', 'ECOM30-EXTR4C', 0], ['Rejected Usable', 'ECOM30-R3JUSE', 0]]),
        `${size.join('x')}: the rejected and applied rows: their words, the code Whop made or attached, or a Reject left usable (the one to see to in Whop, from the event: its name is off a rejected row), the copy buttons only`, JSON.stringify(decided))
      await check(`30% off, every other reason, the Why lines, ${size.join('x')}`, `thirty-reasons-why-${size[0]}`)
    }
    // A csm on the same rows: a pending row whose code may exist (a claim, a hand reopen) has no Reject; an approved one Try again alone.
    await open('?state=reasons&role=csm')
    await waitReady()
    const by = Object.fromEntries((await page.$$eval('.list-row', (rs) => rs.map((r) => [r.querySelector('a')?.textContent,
      [...r.querySelectorAll('button')].map((b) => b.textContent.trim()).filter((t) => !/^Copy (code|Discord ID|username)$/.test(t)).join(',')]))))
    expect(by['Create Silent'] === 'Approve' && by['Reopened Hand'] === 'Approve' && by['Out Of Time'] === 'Approve,Reject' && by['Apply Refused'] === 'Try again' && by['No Whop Id'] === 'Try again',
      'a csm: Reject only where no code may exist (Out Of Time), none on a claim (Create Silent) or a hand reopen; an approved row Try again alone', JSON.stringify(by))
  }

  console.log('\n30% off: Approve, Try again and Reject, each answer of the PRD\'s tables (§9.4)')
  {
    await open('?state=reasons', [1280, 720])
    await waitReady()
    const ID = 'ECOM30-[A-Z0-9]{6}'
    /** [row, button, what it says (a regular expression over the whole sentence), where: the notices or the row, its tone] */
    const PRESSES = [
      ['Approve Made Not On', 'Approve', `^Approve Made Not On: the code ${ID} is made but not on their membership yet\\. Their membership already has another code on Whop\\. The app tries again\\.$`, 'notice', 'alert'],
      ['Approve Create Silent', 'Approve', '^Approve Create Silent: Whop didn\'t answer while making ECOM30-CR8SLN\\. Press Approve again in 5 minutes to look for it on Whop now; otherwise the app looks within the hour\\.$', 'notice', 'alert'],
      ['Approve No Code Yet', 'Approve', '^Approve No Code Yet: no code was made yet\\. Whop didn\'t answer\\. The app tries again\\.$', 'notice', 'alert'],
      ['Approve Whop Refused', 'Approve', '^Couldn\'t create the promo code on Whop\\. The request is still pending\\. Details: A promo code needs a plan on this company\\.$', 'row'],
      ['Approve In Progress', 'Approve', '^Approve In Progress: The app is making this code right now\\. Refresh in a few minutes\\.$', 'notice', 'alert'],
      ['Approve After Reject', 'Approve', '^Approve After Reject: Whop attached ECOM30-ATR3J7 after the request was rejected\\. It can only come off in Whop\\.$', 'notice', 'alert'],
      ['Approve Maybe After Reject', 'Approve', '^Approve Maybe After Reject: Whop may have attached ECOM30-MATR3J after the request was rejected\\. Check their membership in Whop\\.$', 'notice', 'alert'],
      ['Approve Save Failed', 'Approve', '^Whop made ECOM30-SVF41L, but saving it failed\\. The app picks it up on its next try; leave it in Whop\\.$', 'row'],
      ['Approve Not Ready', 'Approve', '^The 30% update isn\'t finished on the database \\(v116\\)\\. Nothing was made\\.$', 'row'],
      ['Approve Already Decided', 'Approve', '^Approve Already Decided: This request was already decided\\.$', 'notice', 'alert'],
      ['Approved Untried', 'Try again', '^Approved Untried: the code ECOM30-UNTR1D is on their membership\\.$', 'notice', 'status'],
      ['Try Again Not On', 'Try again', `^Try Again Not On: the code ${ID} is made but not on their membership yet\\. Whop didn't answer\\. The app tries again\\.$`, 'notice', 'alert'],
      // The old per-student name: ECOM30- and the first 6 characters of the (made-up, short) student id.
      ['Old Name', 'Try again', '^Old Name: the code ECOM30-P-X23 is on their membership\\.$', 'notice', 'status'],
      ['No Whop Id', 'Try again', '^No Whop Id: the code ECOM30-UNKN0W is made but not on their membership yet\\. This request has a code with no Whop id, so the app can\'t check it\\. Check ECOM30-UNKN0W in Whop, then tell the owner so the app records it\\.$', 'notice', 'alert'],
      ['Out Of Time', 'Reject', '^Rejected the request from Out Of Time\\.$', 'notice', 'status'],
      ['Reject Usable', 'Reject', `^Rejected\\. The code ${ID} stays usable at checkout until someone switches it off in Whop\\.$`, 'notice', 'alert'],
      ['No Whop Id', 'Reject', '^Rejected\\. Whop may have made ECOM30-UNKN0W: look for it in Whop\'s promo codes and switch it off if it\'s there\\.$', 'notice', 'alert'],
      ['Reject In Progress', 'Reject', '^Reject In Progress: The app is making this code right now\\. Try again in a few minutes\\.$', 'notice', 'alert'],
      ['Reject On Theirs', 'Reject', '^Reject On Theirs: The code is already on their membership, so the 30% is theirs\\. Press Try again to mark it applied\\.$', 'notice', 'alert'],
      ['Reject Claim On Theirs', 'Reject', '^Reject Claim On Theirs: The code is already on their membership, so the 30% is theirs\\. The app marks it applied within the hour; while the app is paused, press Approve anyway\\.$', 'notice', 'alert'],
      ['Reject Elsewhere', 'Reject', '^Reject Elsewhere: Whop shows ECOM30-ELS3WH on someone else\'s membership\\. Fix it in Whop, then tell the owner so the app records it\\.$', 'notice', 'alert'],
      ['Reject Cannot Tell', 'Reject', '^Reject Cannot Tell: The app can\'t tell whose membership ECOM30-CNTT3L is on\\. Check it in Whop\\.$', 'notice', 'alert'],
      ['Reject Changed', 'Reject', '^Reject Changed: This request changed meanwhile\\. Refresh the list\\.$', 'notice', 'alert'],
      ['Reject Whop Silent', 'Reject', '^Couldn\'t ask Whop\\. Try again\\.$', 'row'],
      ['Reject Lookup Silent', 'Reject', '^Couldn\'t ask Whop about this code\\. Try again\\.$', 'row'],
      // The build's review of 2026-10-27: another code of its name on their membership, so Reject refuses.
      ['Same Name', 'Reject', '^Same Name: Whop put another code named ECOM30-S4MEN4 on their membership\\. Check it in Whop, then tell the owner so the app records it\\.$', 'notice', 'alert'],
    ]
    const wrong = []
    for (const [name, label, pattern, where, tone] of PRESSES) {
      const re = new RegExp(pattern)
      const target = await row(name)
      if (await isNull(target)) { wrong.push(`${name}: not on the list`); continue }
      const before = JSON.stringify(await notices())
      await press(await buttonIn(target, label))
      if (label === 'Reject') {
        // The reason panel first; on an approved row its confirm too.
        await page.waitForFunction((n) => [...document.querySelectorAll('.list-row')].find((r) => r.querySelector('a')?.textContent === n)?.querySelector('input[placeholder^="For example"]'), { timeout: 5000 }, name)
        await press(await buttonIn(await row(name), 'Reject the request'))
      }
      let said = null
      try {
        if (where === 'row') {
          await page.waitForFunction((n) => [...document.querySelectorAll('.list-row')].find((r) => r.querySelector('a')?.textContent === n)?.querySelector('[role="alert"]'), { timeout: 10000 }, name)
          said = { text: await rowAlert(await row(name)), role: 'row' }
        } else {
          await page.waitForFunction((b) => {
            const now = [...document.querySelectorAll('[role="status"], [role="alert"]')].filter((n) => [...n.querySelectorAll('button')].some((x) => x.textContent.trim() === 'Dismiss')).map((n) => n.querySelector('p')?.textContent ?? '')
            return JSON.stringify(now) !== b && now.length > 0
          }, { timeout: 10000 }, JSON.stringify(JSON.parse(before).map((x) => x.text)))
          const n = (await notices()).find((x) => re.test(x.text)) ?? (await notices())[0]
          said = n ? { text: n.text, role: n.role } : null
        }
      } catch (e) {
        said = { text: `nothing shown (${e.message.slice(0, 60)})`, role: null }
      }
      await settled()
      if (!said || !re.test(said.text ?? '') || (where === 'notice' && said.role !== tone)) wrong.push(`${name} ${label}: ${JSON.stringify(said)}`)
    }
    expect(wrong.length === 0, `every answer of the approve and reject tables, in its words, where the page puts it (a notice that stays, a success that hides itself, or the row): ${PRESSES.length} presses`, wrong.slice(0, 4).join(' | '))
    await check('30% off, after every press, 1280x720', 'thirty-presses-1280')
    const sent = (await calls()).filter((c) => c.name !== 'loadThirty').map((c) => `${c.name}:${c.args[0]}`)
    expect(sent.length === PRESSES.length && sent.every((s) => /^(approve|reject):r-x\d\d$/.test(s)), `each press one call (${sent.length}), to the route its button names`, JSON.stringify(sent.slice(0, 4)))
  }
  const errs = newConsoleErrors(from)
  expect(errs.length === 0, '30% off: no error in the browser console', errs.slice(0, 3).join(' || '))
}

// ════════════════════════════════════════════════════════════════════════════
// dash: /dev/admin/dashboard (admin rebuild 2, WI-2)
// ════════════════════════════════════════════════════════════════════════════
if (wanted('dash')) {
  const from = consoleErrors.length
  // "30% to decide" became "30% needs a hand", and "30% off applied" joined the program (T-137, R5).
  const TILES = ['month2', 'bounty', 'open-tasks', 'needs-hand', 'thirty-applied', 'active', 'canceling', 'churned', 'avg-progress']
  const open = (query, size) => go(`/dev/admin/dashboard${query}`, size)
  const ready = () => page.waitForFunction(() => /Updated \d\d:\d\d/.test(document.body.innerText), { timeout: 30000 })
  /** Every read failed: the header says "Couldn't load" (the render review's second round), so there is no "Updated" to wait for. */
  const readyFailed = () => page.waitForSelector('main header [data-meta-failed]', { timeout: 30000 })
  const headerMeta = () => page.evaluate(() => {
    const h = [...document.querySelectorAll('main header')].find((x) => x.querySelector('h1'))
    return h ? { failed: !!h.querySelector('[data-meta-failed]'), text: h.innerText.replace(/\s+/g, ' ') } : null
  })
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
  const refreshButton = () => page.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Refresh') || null)
  // The review's fix round: "Refresh" only reads again; the 2 minute sync is "Sync Whop and rebuild".
  const syncButton = () => page.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Sync Whop and rebuild') || null)

  for (const size of SIZES) {
    const [w, h] = size
    {
      const label = `Dashboard, full (20 Oct, before the first renewals), ${w}x${h}`
      console.log(`\n${label}`)
      await open('?state=full', size)
      await ready()
      await check(label, `dash-full-${w}`)
      const t = await tiles()
      expect(TILES.every((k) => t[k] && !t[k].failed), `${label}: all 9 tiles, none failed`, JSON.stringify(Object.keys(t)))
      expect(t.month2.text.includes('First renewals from Mon 9 Nov') && t.month2.text.includes('paid since Fri 9 Oct') && t.month2.text.includes('Sun 15 Nov')
        && !/\d%/.test(t.month2.text), `${label}: Month 2 waits for the first renewals, with the dates, and shows no rate (no 0%, no old 61%)`, t.month2.text.slice(0, 160))
      expect(t['open-tasks'].numbers[0] === '95' && t['open-tasks'].href === '/admin/tasks' && t['needs-hand'].numbers[0] === '3' && t['needs-hand'].href === '/admin/discounts'
          // The title is an eyebrow, drawn in capitals (innerText reads it so).
          && t['needs-hand'].text === '30% NEEDS A HAND 3 Go to 30% off Requests still waiting 30 minutes after the student applied',
        `${label}: Open tasks 95, links to Tasks; "30% needs a hand" 3, "Go to 30% off", its source line, links to the 30% page`, JSON.stringify([t['open-tasks'].numbers, t['needs-hand']]))
      expect(t['thirty-applied'].numbers[0] === '27' && t['thirty-applied'].href === '/admin/insights/progress'
          && t['thirty-applied'].text === "30% OFF APPLIED 27 See it on Insights Codes on students' Whop memberships, requests from 1 Oct",
        `${label}: "30% off applied" 27, "See it on Insights", its source line, links to Insights`, JSON.stringify(t['thirty-applied']))
      const avgRows = await tableOf('avg-progress')
      expect(t['avg-progress'].numbers[0] === '2.7%' && avgRows.length === 14 && JSON.stringify(avgRows.slice(12)) === JSON.stringify(['Mon 19 Oct 2.66%', 'Tue 20 Oct 2.71%'])
          && avgRows.slice(0, 12).every((r) => r.endsWith('Before the switch')) && t['avg-progress'].text.includes('From Mon 19 Oct'),
        `${label}: Avg progress 2.7%, its line on the 14 days with readings from the switch only (19 and 20 Oct, no 36%), "From Mon 19 Oct" over them`, JSON.stringify([t['avg-progress'].numbers, avgRows.slice(10)]))
      const marks = await page.evaluate(() => {
        const chart = document.querySelector('[data-tile="avg-progress"] [aria-roledescription="chart"]')
        const box = chart.getBoundingClientRect()
        const dots = [...chart.querySelectorAll('[data-reading-dot]')].map((d) => {
          const r = d.getBoundingClientRect()
          return { x: Math.round(r.left + r.width / 2 - box.left), left: r.left, right: r.right, w: Math.round(r.width), h: Math.round(r.height), ring: getComputedStyle(d).boxShadow }
        })
        return {
          dots, width: Math.round(box.width), gap: dots.length === 2 ? Math.round((dots[1].left - dots[0].right) * 10) / 10 : null,
          line: !!chart.querySelector('path[vector-effect="non-scaling-stroke"]'), active: document.querySelectorAll('[data-tile="active"] [data-reading-dot]').length,
        }
      })
      expect(marks.dots.length === 2 && marks.dots.every((d) => d.w === 6 && d.h === 6 && d.ring === 'none' && d.x > marks.width * 0.85) && marks.dots[0].x < marks.dots[1].x
          && marks.gap >= 3 && marks.line && marks.active === 0,
        `${label}: Avg progress's 2 readings are a dot each at the right end of the 14 days, the short line between them showing (${marks.gap}px of it), never a 20px stroke alone; Active's 14 days have no reading dots (the render review's second round)`, JSON.stringify(marks))
      expect((await tableOf('active')).length === 14 && (await tableOf('churned')).length === 14, `${label}: the other lines hold the 14 days`)
      expect(!(await isNull(await refreshButton())) && !(await isNull(await syncButton())), `${label}: a founder has Refresh (reads again) and Sync Whop and rebuild`)
      const order = await page.evaluate(() => ['dash-today', 'dash-program', 'dash-trends'].map((id) => Math.round(document.getElementById(id).getBoundingClientRect().top)))
      expect(order[0] < order[1] && order[1] < order[2], `${label}: Today first, then the program, then the trends (the review's fix round: what waits for the team on top)`, JSON.stringify(order))
      const m2 = await page.evaluate(() => {
        const t = document.querySelector('[data-tile="month2"]')
        const sizes = [...t.querySelectorAll('p, span')].map((e) => parseFloat(getComputedStyle(e).fontSize))
        const b = document.querySelector('[data-tile="bounty"]').getBoundingClientRect()
        const m = t.getBoundingClientRect()
        return { biggest: Math.max(...sizes), m2Width: Math.round(m.width), bountyWidth: Math.round(b.width), side: Math.round(m.top) === Math.round(b.top) }
      })
      expect(m2.biggest <= 24 && (w < 768 || (m2.side && m2.m2Width < m2.bountyWidth)),
        `${label}: until its first rate Month 2 is a compact tile (no headline over 24px) beside the Bounty Program's chart`, JSON.stringify(m2))
      const slots = await page.evaluate(() => [...document.querySelectorAll('[data-program-slot]')].map((x) => { const r = x.getBoundingClientRect(); return { slot: x.dataset.programSlot, left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), card: Math.round(x.firstElementChild.getBoundingClientRect().height) } }))
      // "30% off applied" is the section's last card (T-137, R5): from 1024px the row has a column more for it.
      expect(slots.length === 3 && slots.map((x) => x.slot).join() === 'bounty,month2,thirty'
          && (w < 768 ? slots[0].top < slots[1].top && slots[1].top < slots[2].top
            : slots[0].left < slots[1].left && slots[1].left < slots[2].left && slots.every((x) => x.top === slots[0].top && x.h === slots[0].h && x.card === slots[0].card)
              && slots[0].w > slots[1].w && Math.abs(slots[1].w - slots[2].w) <= 1),
        `${label}: the Bounty Program first (left from 768px), Month 2 beside it, then "30% off applied" (in the row from 1024px), the cards as tall as each other (the render review's fix round)`, JSON.stringify(slots))
      const small = await smallTaps()
      expect(small.length === 0, `${label}: every button is 44px tall or more`, JSON.stringify(small.slice(0, 4)))
      // The owner's review (2026-10-21): no source or explanation line under a tile; the room goes to the charts.
      const words = Object.values(t).map((x) => x.text).join(' | ')
      const gone = ['Whop status now', 'the line from the nightly snapshot', 'pressed cancel', 'Access ended, per day', 'The nightly snapshot',
        'Students on the monthly plan who first paid from', 'who joined on the bounty site', 'Joined per day']
      expect(gone.every((g) => !words.includes(g)), `${label}: no source or explanation line under any tile`, gone.filter((g) => words.includes(g)).join(' | '))
      const heights = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-tile]')]
        .map((tile) => [tile.dataset.tile, Math.round(tile.querySelector('[aria-roledescription="chart"]')?.getBoundingClientRect().height ?? 0)])))
      expect(heights.active === 76 && heights.canceling === 76 && heights.churned === 76 && heights['avg-progress'] === 76 && heights.bounty === 156,
        `${label}: taller charts, the trend lines 76px (44 before) and the Bounty Program's bars 156px (124)`, JSON.stringify(heights))
      // The arrow beside the Bounty Program's 14-day number: its direction follows the rule against the earlier count in its title.
      const arrow = await page.evaluate(() => {
        const a = document.querySelector('[data-tile="bounty"] [data-bounty-arrow]')
        const big = document.querySelector('[data-tile="bounty"] [data-number]')
        if (!a) return { none: true, big: big?.textContent }
        const g = a.querySelector('[aria-hidden="true"]')
        const ar = a.getBoundingClientRect()
        const br = big.getBoundingClientRect()
        // The kit's status colours as this page computes them: green for up, red for down.
        const probe = (v) => { const s = document.createElement('span'); s.style.color = v; a.parentElement.appendChild(s); const c = getComputedStyle(s).color; s.remove(); return c }
        return {
          dir: a.dataset.bountyArrow, title: a.getAttribute('title'), glyph: g.textContent, color: getComputedStyle(g).color, green: probe('var(--color-success)'), red: probe('var(--color-danger)'),
          sr: a.querySelector('.sr-only')?.textContent, big: big.textContent, beside: ar.left >= br.right && ar.left - br.right <= 12 && ar.top < br.bottom && ar.bottom > br.top,
        }
      })
      const before = arrow.none ? null : Number((arrow.title.match(/^([\d,]+) in the 14 days before$/) ?? [])[1]?.replace(/,/g, ''))
      const last = Number(String(arrow.big).replace(/,/g, ''))
      expect(!arrow.none && Number.isFinite(before) && arrow.dir === (last > before ? 'up' : 'down') && last !== before && arrow.glyph === (arrow.dir === 'up' ? '↑' : '↓')
          && arrow.color === (arrow.dir === 'up' ? arrow.green : arrow.red) && arrow.green !== arrow.red && arrow.sr === `${arrow.dir === 'up' ? 'Up' : 'Down'} from ${arrow.title}` && arrow.beside,
        `${label}: beside the Bounty Program's ${arrow.big}, a small ${arrow.dir} arrow, the 14 days before (${arrow.title}) in its tooltip and its words for a screen reader`, JSON.stringify(arrow))
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
      const slots = await page.evaluate(() => [...document.querySelectorAll('[data-program-slot]')].map((x) => { const r = x.getBoundingClientRect(); return { slot: x.dataset.programSlot, left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } }))
      expect(slots.length === 3 && slots.map((x) => x.slot).join() === 'bounty,month2,thirty'
          && (w < 768 ? slots[0].top < slots[1].top && slots[1].top < slots[2].top
            : slots[0].left < slots[1].left && slots[1].left < slots[2].left && slots.every((x) => x.top === slots[0].top && x.h === slots[0].h) && slots.every((x) => Math.abs(x.w - slots[0].w) <= 1)),
        `${label}: with its rate, Month 2 still beside the Bounty Program, then "30% off applied": three equal thirds from 1024px, as tall as each other (Month 2 took the left before the render review's fix round)`, JSON.stringify(slots))
      expect(t['needs-hand'].numbers[0] === '5' && t['thirty-applied'].numbers[0] === '212', `${label}: 5 need a hand, 212 codes on memberships`, JSON.stringify([t['needs-hand'].numbers, t['thirty-applied'].numbers]))
    }
    {
      const label = `Dashboard, empty, ${w}x${h}`
      console.log(`\n${label}`)
      await open('?state=empty', size)
      await ready()
      await check(label, `dash-empty-${w}`)
      const t = await tiles()
      expect(t['open-tasks'].text.includes('All caught up') && t['needs-hand'].text.includes('Nothing waiting') && t['needs-hand'].numbers[0] === '0'
        && t['thirty-applied'].text.includes('None yet') && t['thirty-applied'].numbers[0] === '0' && t.month2.text.includes('No first payment since Fri 9 Oct yet')
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
      expect(t['needs-hand'].numbers[0] === '3' && t['thirty-applied'].numbers[0] === '27' && !t.active.failed && t.active.numbers.length === 1 && t.active.text.includes("Couldn't load the line"),
        `${label}: the rest stands; Active keeps its number and says its line could not load`)
      const alert = await page.$eval('[role="alert"]', (e) => e.innerText)
      expect(alert.includes('Some numbers couldn\'t load.') && alert.includes("This account can't read the tasks.") && alert.includes('The database took too long to answer.') && alert.includes('Retry')
          && !/permission denied|canceling statement/.test(alert),
        `${label}: one line at the top says why in plain words, each reason once, with Retry; the database's own words are not on the page`, alert.replace(/\s+/g, ' '))
      const tileWords = Object.values(t).map((x) => x.text).join(' ')
      expect(!/permission denied|canceling statement|admin_config|statement timeout/.test(tileWords), `${label}: no tile repeats a reason, or a table's name`)
      const m = await headerMeta()
      expect(m && !m.failed && /Updated \d\d:\d\d/.test(m.text), `${label}: with tiles drawn, the header keeps its time`, JSON.stringify(m))
      await page.$eval('[role="alert"] details summary', (sm) => sm.click())
      await sleep(100)
      const opened = await page.$eval('[role="alert"]', (e) => e.innerText)
      expect(opened.includes('Open tasks: permission denied for table tasks') && opened.includes('Daily snapshots: canceling statement due to statement timeout'),
        `${label}: Details names each read with the database's own words`, opened.replace(/\s+/g, ' '))
      await check(`${label}, Details open`, `dash-partial-details-${w}`)
    }
    {
      const label = `Dashboard, error (every read fails), ${w}x${h}`
      console.log(`\n${label}`)
      await open('?state=error', size)
      await readyFailed()
      await check(label, `dash-error-${w}`)
      const t = await tiles()
      expect(TILES.every((k) => t[k].failed && t[k].numbers.length === 0), `${label}: all 9 tiles "Couldn't load", not one number (the two 30% tiles among them)`, JSON.stringify(TILES.map((k) => t[k].numbers)))
      expect((await page.$eval('[role="alert"]', (e) => e.innerText)).includes("Couldn't load the dashboard."), `${label}: the line at the top says nothing could load`)
      const m = await headerMeta()
      expect(m && m.failed && m.text.includes("Couldn't load") && !/Updated \d\d:\d\d/.test(m.text),
        `${label}: the header says "Couldn't load" with the warning dot, never "Updated" over numbers it never read (the render review's second round)`, JSON.stringify(m))
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
    await readyFailed()
    const loadsBefore = (await dashCalls()).filter((c) => c === 'load').length
    await press(await button('Retry'))
    await page.waitForFunction((n) => (window.__dashCalls ?? []).filter((c) => c.name === 'load').length > n, { timeout: 10000 }, loadsBefore)
    expect(true, 'Retry reads everything again')
  }

  console.log('\nDashboard: Refresh reads again; Sync Whop and rebuild')
  {
    await open('?state=full', [1280, 720])
    await ready()
    {
      const before = await dashCalls()
      await press(await refreshButton())
      await page.waitForFunction((n) => (window.__dashCalls ?? []).filter((c) => c.name === 'load').length > n, { timeout: 10000 }, before.filter((c) => c === 'load').length)
      const after = await dashCalls()
      expect(after.filter((c) => c === 'refresh').length === before.filter((c) => c === 'refresh').length,
        'Refresh reads every number again and starts no sync (it started the 2 minute sync before the review\'s fix round)', JSON.stringify(after))
    }
    const loadsBefore = (await dashCalls()).filter((c) => c === 'load').length
    await press(await syncButton())
    await page.waitForFunction(() => [...document.querySelectorAll('[role="status"]')].some((e) => e.textContent.includes('snapshots rebuilt')), { timeout: 15000 })
    const note = await page.evaluate(() => [...document.querySelectorAll('[role="status"]')].map((e) => e.textContent).find((t) => t.includes('snapshots rebuilt')))
    const calls = await dashCalls()
    expect(note === 'Whop synced, 3 new and 118 updated · snapshots rebuilt · 4 new tasks · 2 alerts', `Sync Whop and rebuild says what each step did: "${note}"`)
    await page.waitForFunction((n) => (window.__dashCalls ?? []).filter((c) => c.name === 'load').length > n, { timeout: 10000 }, loadsBefore)
    expect(calls.includes('refresh'), 'one refresh call, then the numbers are read again', JSON.stringify(calls))
    await check('Dashboard, after Refresh, 1280x720', 'dash-refreshed-1280')

    await open('?state=full&refresh=fail', [1280, 720])
    await ready()
    await press(await syncButton())
    await page.waitForFunction(() => [...document.querySelectorAll('[role="alert"]')].some((e) => e.textContent.startsWith('Sync failed')), { timeout: 15000 })
    const refusal = await page.evaluate(() => [...document.querySelectorAll('[role="alert"]')].map((e) => e.textContent).find((t) => t.startsWith('Sync failed')))
    expect(refusal === 'Sync failed: Founder or admin role required', `a refusal is said in the route's words: "${refusal}"`)

    await open('?state=full&refresh=partial', [1280, 720])
    await ready()
    await press(await syncButton())
    await page.waitForFunction(() => document.body.innerText.includes('Whop sync failed: HTTP 502'), { timeout: 15000 })
    expect(true, 'a step that failed inside a 200 is said: "Whop sync failed: HTTP 502"')

    for (const size of SIZES) {
      await open('?state=full&role=csm', size)
      await ready()
      expect(await isNull(await syncButton()) && !(await isNull(await refreshButton())), `a csm has Refresh, which only reads, and no Sync Whop and rebuild (the route refuses one), ${size.join('x')}`)
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
    expect(text.includes('Open tasks made since the reset on Tue 20 Oct, 09:00 (Croatia time)') && !text.includes('New program since'),
      'To do says its tasks were made since the reset, in Croatia time (the meta no longer calls the reset "New program since")')
    // The review's fix round: the header links to the outreach insights in words; no pill row twin of the tabs; the checks named for what they do.
    const header = await page.evaluate(() => {
      const h = [...document.querySelectorAll('main header')].find((x) => x.querySelector('h1'))
      return { links: [...h.querySelectorAll('a')].map((a) => `${a.textContent.trim()} ${a.getAttribute('href')}`), buttons: [...h.querySelectorAll('button')].map((b) => b.textContent.trim()) }
    })
    expect(JSON.stringify(header) === JSON.stringify({ links: ['Outreach insights → /admin/tasks/insights'], buttons: ['Run task checks'] }) && (await page.$('nav[aria-label="Views"]')) === null,
      'the header: "Outreach insights →" and "Run task checks"; no Queue | Insights pills over the tabs', JSON.stringify(header))
    const edges = await page.$$eval('main section', (ss) => ss.map((sec) => ({ head: sec.querySelector('h2')?.textContent.trim(), edge: getComputedStyle(sec.querySelector('.list-row')).boxShadow })))
    expect(/rgb\(255, 69, 58\)/.test(edges[0].edge) && /rgb\(255, 159, 10\)/.test(edges[1].edge) && /rgb\(255, 159, 10\)/.test(edges[2].edge) && edges[3].edge === 'none',
      'the edges: red for canceling, orange for cancel path and at risk, none for the rest', JSON.stringify(edges))
    const heads = await page.$$eval('main section h2', (hs) => hs.map((h) => [...h.childNodes].map((n) => n.textContent.trim()).filter(Boolean).join(' ')))
    expect(JSON.stringify(heads) === JSON.stringify(['Canceling: save first 1', 'Cancel path 1', 'At risk 2', 'Events and wins 2']),
      'the tiers: canceling first, then cancel path, at risk, events and wins', JSON.stringify(heads))
    expect((await page.$$eval('.list-row', (rs) => rs.map((r) => r.querySelector('[data-student-name]')?.textContent))).join() === 'Sofia Marin,Priya Raman,Omar Haddad,Nora Brandt,Maya Lindqvist,Maximilian Featherstonehaugh-Smythe',
      'the longest wait first in each tier')
    const small = await smallTaps()
    expect(small.length === 0, 'To do: every button and tab 44px tall or more', JSON.stringify(small.slice(0, 4)))
    await page.$$eval('[role="tab"]', (ts) => ts.find((t) => t.textContent.startsWith('Archived')).click())
    await sleep(200)
    const archived = await page.$$eval('.list-row', (rs) => rs.map((r) => ({
      buttons: [...r.querySelectorAll('button')].map((b) => b.textContent.trim()),
      text: r.textContent,
    })))
    expect(archived.length === 4 && archived.every((r) => r.buttons.length === 1 && r.buttons[0] === 'Details'),
      'Archived: four rows, read only: Details opens the task, and nothing else is a button (the name is the student\'s link)', JSON.stringify(archived.map((r) => r.buttons)))
    expect(archived.some((r) => r.text.includes('Dismissed Tue 20 Oct by the reset for the new program. Before it: checked twice'))
      && archived.some((r) => r.text.includes('Sent Mon 12 Oct, no reply')),
      'an archived row says how it was closed: by the reset (with the note before it), or sent with its reply')
    await press(await buttonIn(await rowWith('Leo Hartmann'), 'Details'))
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
    await press(await page.evaluateHandle(() => [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === 'Dismiss the task')))
    await waitText('Add a short reason first.')
    expect(!(await peopleCalls()).some((c) => c.name === 'transition' && c.args[1] === 'dismissed'), 'Dismiss with no reason asks for one and sends nothing')
    for (const size of SIZES) {
      await viewport(size)
      await check(`Tasks, the Dismiss dialog, ${size.join('x')}`, `tasks-dismiss-${size[0]}`)
    }
    await viewport([1280, 720])
    await page.type('[role="dialog"] textarea', 'Paid by the hour, will join on Monday')
    await press(await page.evaluateHandle(() => [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === 'Dismiss the task')))
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
  // Its pictures are tasks-insights-*: the templates lane's part draws
  // /dev/admin/insights (progress insights) as insights-*, and the same name
  // would put one page's picture over the other's.
  for (const size of SIZES) {
    const [w, h] = size
    for (const [name, query] of [['full', ''], ['no-reset', '?reset=none'], ['empty', '?state=empty']]) {
      const label = `Insights, ${name}, ${w}x${h}`
      console.log(`\n${label}`)
      await go(`/dev/admin/tasks/insights${query}`, size)
      await settledPage()
      await check(label, `tasks-insights-${name}-${w}`)
      expect((await gluedBold()).length === 0, `${label}: no bold word glued to the next`, JSON.stringify(await gluedBold()))
    }
    for (const state of ['loading', 'error']) {
      const label = `Insights, ${state}, ${w}x${h}`
      console.log(`\n${label}`)
      await go(`/dev/admin/tasks/insights?state=${state}`, size)
      if (state === 'loading') await page.waitForSelector('.animate-pulse')
      else await page.waitForSelector('[role="alert"]')
      await check(label, `tasks-insights-${state}-${w}`)
    }
  }
  console.log('\nInsights: the ranges and the words')
  {
    await go('/dev/admin/tasks/insights')
    await settledPage()
    const text = await bodyText()
    // The review's fix round: with the reset under 30 days old the last 30 days are the tasks since it, so there is no range to pick.
    expect(text.includes('Counts the tasks made since the reset on Tue 20 Oct') && (await page.$('[role="group"][aria-label="Range"]')) === null
        && text.includes('still a member') && !/subscri/i.test(text),
      'the reset is under 30 days old: one range, said in the meta ("since the reset on Tue 20 Oct"), no pills that show the same numbers twice; a save is "still a member", never "subscribed"')
    const backLink = await page.evaluate(() => [...document.querySelectorAll('main a')].find((a) => a.textContent.includes('Queue'))?.getAttribute('href'))
    expect(backLink === '/admin/tasks' && (await page.$('nav[aria-label="Views"]')) === null, 'a "← Queue" link back to Tasks, and no Queue | Insights pills', String(backLink))
    const notes = await page.evaluate(() => { const d = [...document.querySelectorAll('details')].find((x) => x.querySelector('summary')?.textContent.trim() === 'How these numbers work'); return d ? { open: d.open } : null })
    expect(notes && notes.open === false, 'how the numbers work is folded under one line, as on Insights', JSON.stringify(notes))
    expect(/time to send/i.test(text) && !/task to send/i.test(text) && /\d+ of \d+ graded sends did what the DM asked/.test(text), 'the tile is "Time to send", and success reads "N of M graded sends did what the DM asked"')
    await go('/dev/admin/tasks/insights?reset=none')
    await settledPage()
    expect((await bodyText()).includes('All time') && (await bodyText()).includes('Last 30 days'), 'before the reset the two ranges are "Last 30 days" and "All time"')
    await press(await button('All time'))
    await page.waitForFunction(() => [...document.querySelectorAll('[aria-pressed="true"]')].some((b) => b.textContent.startsWith('All time')))
    await settledPage()
    const asked = (await peopleCalls()).filter((c) => c.name === 'loadInsights').map((c) => c.args[0])
    expect(asked.length === 2 && typeof asked[0] === 'string' && asked[1] === null, 'Last 30 days asks from 30 days ago; All time asks for everything the route counts', JSON.stringify(asked))
    await go('/dev/admin/tasks/insights', [390, 844])
    await settledPage()
    const cards = await page.$$eval('[data-template-card]', (cs) => cs.filter((c) => c.getBoundingClientRect().height > 0).map((c) => c.innerText.replace(/\s+/g, ' ')))
    const table = await page.$$eval('main table', (ts) => ts.filter((t) => t.getBoundingClientRect().height > 0).length)
    expect(cards.length >= 1 && table === 0 && cards.every((c) => /SENT/i.test(c) && /TIME TO SEND/i.test(c) && /SUCCESS/i.test(c) && /REPLIED/i.test(c)),
      'on a phone each template is a card with Sent, Time to send, Success and Replied, and no table to scroll sideways', JSON.stringify(cards.slice(0, 1)))
    await check('Insights, the phone\'s template cards, 390x844', 'tasks-insights-cards-390')
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
    // The owner's review (2026-10-21): the first payments from 1 October alone, and the page opens on Active.
    expect(JSON.stringify(names) === JSON.stringify(['Nora Brandt', 'Maya Lindqvist', 'Theo Marsh', 'Omar Haddad', 'Jonah Pereira', 'Sofia Marin', 'Maximilian Featherstonehaugh-Smythe']),
      'the page opens on Active: the active course members on a $97 monthly plan who first paid from 1 October, newest first payment first (Nora, 20 Oct, to Maximilian, 9 Oct)', names.join(', '))
    const pills = await page.$$eval('[role="group"][aria-label="Membership"] button', (bs) => bs.map((b) => ({ t: [...b.childNodes].map((n) => n.textContent.trim()).join(' '), on: b.getAttribute('aria-pressed') })))
    expect(JSON.stringify(pills) === JSON.stringify([{ t: 'Active 7', on: 'true' }, { t: 'Payment failed 1', on: 'false' }, { t: 'Ended 2', on: 'false' }]),
      'three pills with their counts, Active pressed: Active 7, Payment failed 1, Ended 2 (no All)', JSON.stringify(pills))
    // The owner's answer of 2026-10-21: course members only, and only the $97 ones.
    const text = await bodyText()
    expect(names.includes('Omar Haddad') && !text.includes('Yusuf Demir') && !text.includes('Clara Vance') && !text.includes('Leo Hartmann') && !text.includes('Felix Moreau') && !text.includes('Iris'),
      'Omar, on the hidden $97 plan, is listed; Yusuf (a yearly plan) and Clara (an ETfB owner\'s plan) are not, nor Leo (September), Felix (May) or Iris (August)', names.join(', '))
    const words = await page.evaluate(() => ({
      description: [...document.querySelectorAll('main header')].find((x) => x.querySelector('h1'))?.querySelector('p')?.textContent ?? null,
      meta: [...document.querySelectorAll('main header')].find((x) => x.querySelector('h1'))?.innerText ?? '',
      rows: [...document.querySelectorAll('main a.list-row')].map((a) => a.innerText).join(' '),
    }))
    expect(words.description === 'Course members on a $97 monthly plan who first paid on or after Thu 1 Oct, newest first payment first.' && !/\bplan\b/i.test(words.rows) && words.meta.includes('10 students'),
      'the header\'s line says who is listed in plain words, from Thu 1 Oct, with the 10 listed; no row shows a plan', JSON.stringify(words.description))
    await press(await button('Payment failed1'))
    await sleep(150)
    expect((await page.$$eval('main a.list-row', (as) => as.length)) === 1 && (await bodyText()).includes('Priya Raman'), 'Payment failed: Priya alone')
    await press(await button('Ended2'))
    await sleep(150)
    const ended = await page.$$eval('main a.list-row', (as) => as.map((a) => a.querySelector('p')?.textContent))
    expect(JSON.stringify(ended) === JSON.stringify(['Ethan Cole', 'Hana Sato']), 'Ended: the canceled (Ethan) and the expired (Hana) together', JSON.stringify(ended))
    await check('All students, Ended, 1440x900', 'students-ended-1440')
    await press(await button('Active7'))
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
      // The 30% request's code is offered to copy only once Whop made it (its Whop id on the request, T-137): Maya's pending
      // request holds a claimed name with no id, Jonah's approved one a code Whop made.
      if (name === 'synced' || name === 'stale') {
        const copies = await page.$$eval('button', (bs) => bs.map((b) => b.textContent.trim()).filter((t) => t.startsWith('Copy ECOM30')))
        expect(name === 'synced' ? copies.length === 0 && text.includes('See on the 30% page') : JSON.stringify(copies) === JSON.stringify(['Copy ECOM30-7B20C4']),
          name === 'synced' ? `${label}: her 30% request, a claim with no Whop id: no "Copy ECOM30-K7Q2MX" (that code may not exist)` : `${label}: his approved request, its code made on Whop: "Copy ECOM30-7B20C4"`,
          JSON.stringify(copies))
      }
      if (name === 'canceling') {
        // The render review's fix round: the note is folded under "Sync details", with the counts.
        const fold = await page.evaluate(() => { const d = document.querySelector('details[data-sync-details]'); return d ? { open: d.open, text: d.textContent } : null })
        expect(text.includes('Canceling') && fold && !fold.open && fold.text.includes('Note: Whop returned 3 interactions but 0 marked completed') && !text.includes('Note: Whop returned'),
          `${label}: Canceling, and the backfill's note as a note, folded under Sync details`, JSON.stringify(fold).slice(0, 160))
      }
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
    // The review's fix round: the settings sit quiet at the foot, after the quick DMs; the ads tick under a closed More.
    const order = await page.evaluate(() => {
      const top = (sel, txt) => { const el = [...document.querySelectorAll(sel)].find((e) => e.textContent.includes(txt)); return el ? Math.round(el.getBoundingClientRect().top + scrollY) : -1 }
      return { stats: top('p', 'Progress'), sync: top('h2', 'Whop sync'), dms: top('h2', 'Quick DMs'), exempt: top('label', 'Leave out of the tasks'), more: top('summary', 'More') }
    })
    expect(order.stats < order.sync && order.sync < order.dms && order.dms < order.exempt && order.exempt < order.more,
      'the numbers and Whop sync come first; "Leave out of the tasks" and More at the foot, after the quick DMs', JSON.stringify(order))
    expect(!(await page.evaluate(() => [...document.querySelectorAll('details[data-more]')][0]?.open)) && !(await bodyText()).includes('Ad submissions verified'),
      'the ads tick is folded under a closed More, out of sight')
    await press(await page.evaluateHandle(() => [...document.querySelectorAll('summary')].find((x) => x.textContent.trim() === 'More')))
    await press(await page.evaluateHandle(() => [...document.querySelectorAll('label')].find((l) => l.textContent.includes('Ad submissions verified'))))
    await page.waitForFunction(() => (window.__peopleCalls ?? []).some((c) => c.name === 'setAdVerified'), { timeout: 10000 })
    expect((await peopleCalls()).some((c) => c.name === 'setAdVerified' && c.args[0] === 'p-maya' && c.args[1] === false), 'opened, the ads tick writes (Maya\'s was ticked)')
    expect((await bodyText()).includes('Approving the 30% does not need it.'), 'and its words say approving the 30% does not need it')
    // The quick DMs, as the team copies them: the messages draft's words.
    await page.evaluate(() => {
      window.__copied = []
      navigator.clipboard.writeText = (t) => { window.__copied.push(t); return Promise.resolve() }
    })
    for (const label of ['Welcome', 'Check-in', 'Encouragement']) await press(await button(label))
    const copied = await page.evaluate(() => window.__copied)
    expect(copied.length === 3 && copied[0].startsWith('Hey Maya! Welcome to Ecom University') && copied[0].includes('https://sprint.ecomuniversity.com/login')
        && copied.every((t) => !/\u2014|unlock|ecomtalent|expedition|region|30 days/i.test(t)),
      'the 3 quick DMs copy the messages draft\'s words: the first name, Ecom University, the program link; no em dash, no old brand, no old course words', JSON.stringify(copied))
    await press(await page.evaluateHandle(() => [...document.querySelectorAll('summary')].find((x) => x.textContent.includes('Foundations'))))
    await page.waitForFunction(() => [...document.querySelectorAll('summary')].find((x) => x.textContent.includes('Foundations'))?.getAttribute('aria-label').endsWith('Hide its lessons.'), { timeout: 10000 })
    const area = await page.evaluate(() => {
      const d = [...document.querySelectorAll('details')].find((x) => x.textContent.includes('Foundations'))
      const sm = d.querySelector('summary')
      return { open: d.open, lists: document.body.innerText.includes('Foundations, part 1'), words: sm.innerText.replace(/\s+/g, ' ').trim(), label: sm.getAttribute('aria-label') }
    })
    expect(area.open && area.lists && !/\b(Show|Hide)\b/.test(area.words) && area.label.endsWith('Hide its lessons.'),
      'an area opens on a tap of its row and lists its lessons; a chevron, no "Show" or "Hide" word (the label says it)', JSON.stringify(area))
    for (const size of SIZES) {
      await viewport(size)
      await check(`A student, an area open, ${size.join('x')}`, `student-area-open-${size[0]}`)
    }
    await viewport([390, 844])
    const phoneRow = await page.evaluate(() => {
      const sm = [...document.querySelectorAll('summary')].find((x) => x.textContent.includes('Research'))
      const r = sm.getBoundingClientRect()
      const cs = getComputedStyle(sm)
      const name = [...sm.children][0].getBoundingClientRect()
      const done = [...sm.children][1].getBoundingClientRect()
      const bar = sm.querySelector('[role="meter"]').getBoundingClientRect()
      return { pad: [cs.paddingTop, cs.paddingBottom], nameTop: Math.round(name.top), doneTop: Math.round(done.top), barTop: Math.round(bar.top), nameBottom: Math.round(name.bottom), barWidth: Math.round(bar.width), rowWidth: Math.round(r.width) }
    })
    expect(phoneRow.pad[0] === '12px' && phoneRow.pad[1] === '12px' && Math.abs(phoneRow.nameTop - phoneRow.doneTop) <= 4 && phoneRow.barTop > phoneRow.nameBottom && phoneRow.barWidth > phoneRow.rowWidth * 0.6,
      'on a phone an area row has 12px of air, the name and "N of M done" on one line, then the bar across the row', JSON.stringify(phoneRow))
    await check('A student, the lesson areas on a phone, 390x844', 'student-areas-390')
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
        const cards = await page.$$eval('[data-card-progress]', (ps) => ps.map((p) => p.textContent))
        expect(text.includes("Couldn't load the students' progress") && text.includes("Couldn't read which course is live") && !/\b0%/.test(text)
            && cards.length > 0 && cards.every((c) => c === "Progress couldn't load"),
          `${label}: the failed reads say so on the board and on every card ("Progress couldn't load"), never 0%`, JSON.stringify(cards.slice(0, 2)))
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
      'the six columns: on 21 October everyone is in weeks 1 and 2, the canceled one in Churned (Clara and Yusuf, off the $97 plans, would make them 5 and 4)', JSON.stringify(cols))
    const text = await bodyText()
    const description = await page.evaluate(() => [...document.querySelectorAll('main header')].find((x) => x.querySelector('h1'))?.querySelector('p')?.textContent ?? null)
    expect(description === 'The new program\'s students: course members on a $97 monthly plan with a first payment on or after Fri 9 Oct, by days since that payment. Open a card for the student.'
        && !text.includes('Leo Hartmann') && !text.includes('Theo Marsh'),
      'the header\'s line says who is on it in plain words; the new program\'s students only: Leo (paid in September) and Theo (no Whop membership) are not on it', JSON.stringify(description))
    expect(text.includes('Omar Haddad') && !text.includes('Yusuf Demir') && !text.includes('Clara Vance'),
      'the same plans as All students: Omar, on the hidden $97 plan, is on it; Yusuf (a yearly plan) and Clara (an ETfB owner\'s plan), both paid since the launch, are not')
    // The owner's review (2026-10-21): a card holds the name, the day, the activity word, the progress and the last activity, nothing else.
    const cards = await page.$$eval('[data-journey-card]', (cs) => cs.map((c) => ({
      id: c.dataset.journeyCard,
      text: c.lastElementChild.innerText.replace(/\s+/g, ' ').trim(),
      h: Math.round(c.getBoundingClientRect().height),
      pills: c.querySelectorAll('.pill-tone').length,
      meter: !!c.querySelector('[role="meter"]'),
      user: !!c.querySelector('[data-student-username]'),
    })))
    const maya = cards.find((c) => c.id === 'p-maya')
    const sofia = cards.find((c) => c.id === 'p-sofia')
    const priya = cards.find((c) => c.id === 'p-priya')
    expect(maya.text === 'Maya Lindqvist Day 2 Moving 38% done Last active 40 min ago' && maya.pills === 1 && !maya.meter && !maya.user,
      'Maya\'s card: her name, Day 2, Moving, 38% done and her last activity; one pill (the activity word), no bar, no username, no area', JSON.stringify(maya))
    // Priya first paid on 10 Oct at 08:00 UTC; the page's clock is 21 Oct 08:30, 11 days and 30 minutes on: Day 12.
    expect(sofia.text === 'Sofia Marin Day 9 Not started 0% done Last active 20 h ago' && priya.text === 'Priya Raman Day 12 Stalled 4% done Last active 9 days ago'
        && cards.every((c) => !/Canceling|Payment failed|Foundations|Research|\b(I|II|III|IV)\b/.test(c.text)),
      'no Canceling (Sofia booked one) and no Payment failed (Priya\'s did) on a card, and no area', JSON.stringify([sofia.text, priya.text]))
    // Maximilian's name takes two lines and his day a third (render checks how it breaks), so his card is measured apart.
    const short = cards.filter((c) => c.id !== 'p-maximilian')
    const long = cards.find((c) => c.id === 'p-maximilian')
    expect(short.every((c) => c.h <= 100 && c.h >= 44) && long.h <= 140,
      `the cards are short: ${Math.min(...short.map((c) => c.h))} to ${Math.max(...short.map((c) => c.h))}px tall with a one-line name, ${long.h}px with Maximilian's long one`, JSON.stringify(cards.map((c) => [c.id, c.h])))
    const board = await page.evaluate(() => { const r = document.querySelector('[data-board]').getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), col: Math.round(document.querySelector('main section[aria-label]').getBoundingClientRect().width) } })
    expect(board.left === 48 && board.right === 1392 && board.col >= 210,
      'the board runs across the window with the pages\' side margins (48px each side at 1440), each column about 217px wide (164 in the old column)', JSON.stringify(board))
    await press(await page.evaluateHandle(() => [...document.querySelectorAll('main section button')].find((b) => b.textContent.includes('Maya Lindqvist'))))
    await page.waitForSelector('aside[role="dialog"]')
    // textContent: the block's title is drawn in capitals, which innerText reports.
    await page.waitForFunction(() => document.querySelector('aside[role="dialog"]')?.textContent.includes('Lessons by area'), { timeout: 10000 })
    const drawer = await page.$eval('aside[role="dialog"]', (a) => {
      const h = a.querySelector('h2')
      const link = [...a.querySelectorAll('a')].find((x) => x.textContent.trim() === 'Open the full page')
      return { name: h?.querySelector('[data-student-name]')?.textContent, linkTop: link ? Math.round(link.getBoundingClientRect().top) : null, nameTop: h ? Math.round(h.getBoundingClientRect().top) : null, ads: a.innerText.includes('Ad submissions verified'), firstBlock: Math.round([...a.querySelectorAll('section')][0]?.getBoundingClientRect().top ?? 0) }
    })
    expect(drawer.name === 'Maya Lindqvist' && drawer.linkTop !== null && Math.abs(drawer.linkTop - drawer.nameTop) < 30 && drawer.linkTop < drawer.firstBlock && !drawer.ads,
      'a card opens the drawer with that student, "Open the full page" at its top beside the name, and no ads tick (the review\'s fix round)', JSON.stringify(drawer))
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
  // The action items with nothing to post (the owner, 2026-10-22; isDoneOnly in src/lib/world/action-items.ts): the
  // drawer says "Done" and shows no link for one, "Handed in" with its post's link for the others. Maximilian did
  // AI Ads' (a6l03, one of the four) ahead of the order, so his drawer holds both kinds.
  console.log('\nJourney: the drawer\'s action items, the two kinds')
  for (const size of [[1440, 900], [390, 844]]) {
    const label = `Journey, Maximilian's action items, ${size.join('x')}`
    await go('/dev/admin/journey?drawer=p-maximilian', size)
    await page.waitForFunction(() => [...document.querySelectorAll('aside[role="dialog"] section')].some((s) => s.querySelector('h2')?.textContent.trim() === 'Action items' && s.querySelector('li')), { timeout: 15000 })
    const rows = await page.$$eval('aside[role="dialog"] section', (ss) => {
      const block = ss.find((s) => s.querySelector('h2')?.textContent.trim() === 'Action items')
      return [...block.querySelectorAll('li')].map((li) => ({
        text: li.innerText.replace(/\s+/g, ' ').trim(),
        links: [...li.querySelectorAll('a')].map((a) => ({ words: a.textContent.trim(), href: a.getAttribute('href') })),
      }))
    })
    const row = (title) => rows.find((r) => r.text.startsWith(title)) ?? null
    const done = row('AI Ads: study the winners')
    expect(!!done && done.text === 'AI Ads: study the winners Done' && done.links.length === 0,
      `${label}: AI Ads' action item, done, says "Done" and has no link (nothing was posted)`, JSON.stringify(done))
    const handed = ['Foundations', 'Research', 'Hooks', 'Scripts'].map((n) => row(`${n}: hand in your work`))
    expect(handed.every((r) => r && /^\w+: hand in your work Handed in Open the post$/.test(r.text) && r.links.length === 1 && /^https:\/\/discord\.com\/channels\/\d+\/\d+\/\d+$/.test(r.links[0].href)),
      `${label}: the four handed in say "Handed in" with their post's link, as before`, JSON.stringify(handed))
    const open = ['Editing', 'Clients', 'Scale'].map((n) => row(`${n}: hand in your work`))
    expect(rows.length === 8 && open.every((r) => r && / Not yet$/.test(r.text) && r.links.length === 0),
      `${label}: the three not done say "Not yet", with no link; 8 rows in all`, JSON.stringify(open))
    await check(label, `journey-drawer-action-items-${size[0]}`)
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
      // The review's fix round: only the rated lessons are rows; the rest of an area is one line, "N lessons with no rating yet".
      const unrated = await page.$$eval('main section', (ss) => ss.filter((x) => !x.querySelector('li[data-lesson]') && x.querySelector('[data-unrated]')).map((x) => x.querySelector('h2').textContent.replace(/\s+/g, ' ').trim()))
      expect(JSON.stringify(unrated) === JSON.stringify(UNRATED_AREAS), `${label}: an area with no rating is its heading and one line, no rows`, JSON.stringify(unrated))
      const lines = await page.$$eval('main [data-unrated] > button', (bs) => bs.map((b) => `${b.textContent.trim()} ${b.getAttribute('aria-expanded')}`))
      expect(lines.length === 8 && lines[0] === '5 lessons with no rating yet false' && lines.every((l) => /^\d+ lessons? with no rating yet false$/.test(l)),
        `${label}: each area folds its unrated lessons into one line, closed`, JSON.stringify(lines))
      expect(!(await page.$$eval('main li[data-lesson]', (ls) => ls.some((l) => l.textContent.includes('No ratings yet.')))) && !/\ba\dl\d\d\b/.test(text),
        `${label}: no row of "No ratings yet.", and no lesson id in the words (it is in a row's title)`)
      const order = await page.$$eval('main section:first-of-type > div + div > ul > li[data-lesson]', (ls) => ls.map((l) => l.dataset.lesson))
      expect(order[0] === 'a1l01' && order.length === 3, `${label}: Introduction lists its 3 rated lessons, the newest rating first`, JSON.stringify(order))
      const welcome = await lessonRow('a1l01')
      expect(!!welcome && (await welcome.evaluate((r) => r.textContent.includes('4.0') && r.textContent.includes('7 ratings'))), `${label}: the welcome lesson: 4.0 from 7 ratings`)
      expect(JSON.stringify(await comments('a1l01')) === JSON.stringify(['I already knew all of this from Whop.', 'Fine.', 'Too long for a welcome. Cut it to 3 minutes.']),
        `${label}: its 3 newest comments, the edited one first`, JSON.stringify(await comments('a1l01')))
      expect((await lessonRow('a1l03')) === null, `${label}: a lesson with no rating is no row of its own`)
      if (w === 1440) {
        const height = await page.evaluate(() => document.scrollingElement.scrollHeight)
        expect(height < 3200, `${label}: the page is ${height}px tall (5,969px when it listed every unrated lesson)`)
      }
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
    const fold = await page.evaluateHandle(() => document.querySelector('main section [data-unrated] > button'))
    await press(fold)
    await sleep(150)
    const listed = await page.evaluate(() => {
      const box = document.querySelector('main section [data-unrated]')
      return { expanded: box.querySelector('button').getAttribute('aria-expanded'), items: [...box.querySelectorAll('li')].map((li) => ({ title: li.getAttribute('title'), text: li.textContent.trim() })) }
    })
    expect(listed.expanded === 'true' && listed.items.length === 5 && listed.items.some((i) => i.title === 'a1l03') && listed.items.every((i) => !/\ba\dl\d\d\b/.test(i.text)),
      'the line pressed lists the 5 lessons by title, each lesson\'s id in its title attribute only', JSON.stringify(listed).slice(0, 200))
    await check('lesson feedback, the unrated lessons listed, 1280x720', 'feedback-unrated-open-1280')

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

// ════════════════════════════════════════════════════════════════════════════
// Admin rebuild 2, WI-8 and WI-9 (the templates lane):
//   templates  /dev/admin/templates: full (the links and switches of 20
//              October: both warnings), fixed (none), a csm reading it,
//              empty, loading, error, nosettings, nocourse; then by clicks:
//              a built-in opened (no Delete) and saved with only its new
//              message, its preview with the live link and the empty Discord
//              link named, the Discord link saved (its warning goes), the
//              master switch's Turn on asking first, a custom template
//              deleted, a new template refused without a title then made
//   survey     /dev/admin/survey: full, empty, loading, error; the status
//              words of the 30% page (Applied, Code Applied), never Pending
//   team       /dev/admin/team: full for a founder (name@ecomuniversity.com),
//              an admin's one line, empty, loading, error; a removal asked
//              first, a role change
//   insights   /dev/admin/insights: full (new course and old), partial,
//              empty, loading, error; each range, the dates, axis labels
//              at 11px on a phone
// Every state is measured as above; every tap under the bar is 44px.
// ════════════════════════════════════════════════════════════════════════════
const LANE_PARTS = ['templates', 'survey', 'team', 'insights']
if (LANE_PARTS.some(wanted)) {
  const from = consoleErrors.length
  /** The calls the page made, by name, with their arguments. */
  const laneCalls = () => page.evaluate(() => (window.__adminCalls ?? []).map((c) => ({ name: c.name, args: c.args })))
  /** A row header (aria-expanded) whose words start with `title`. */
  const rowHeader = (title) => page.evaluateHandle((t) => [...document.querySelectorAll('button[aria-expanded]')]
    .find((b) => b.textContent.trim().startsWith(t)) || null, title)
  /** A button with exactly these words inside the open template row. Its header is in a .list-row: Show settings,
   *  which says open or closed too since the render review's fix round, is not. */
  const inOpenRow = (label) => page.evaluateHandle((l) => {
    const row = document.querySelector('.list-row button[aria-expanded="true"]')?.closest('.list-row')
    return (row && [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === l)) || null
  }, label)
  /** The control a label with these words points at (the first one). */
  const byLabel = (text, root = 'body') => page.evaluateHandle((t, r) => {
    const scope = document.querySelector(r) ?? document.body
    const label = [...scope.querySelectorAll('label')].find((l) => l.textContent.trim() === t)
    return (label && document.getElementById(label.htmlFor)) || null
  }, text, root)
  /** The button of a Message settings switch, found by the switch's title. */
  const switchButton = (title, label) => page.evaluateHandle((t, l) => {
    const name = [...document.querySelectorAll('p')].find((p) => p.textContent.trim() === t)
    const box = name?.parentElement?.parentElement?.parentElement
    return (box && [...box.querySelectorAll('button')].find((b) => b.textContent.trim() === l)) || null
  }, title, label)
  const ready = (text) => page.waitForFunction((t) => document.body.innerText.includes(t), { timeout: 15000 }, text)
  const tapsOk = async (label) => {
    const small = await smallTaps()
    expect(small.length === 0, `${label}: every button under the bar is 44px tall or more`, JSON.stringify(small.slice(0, 4)))
  }

  if (wanted('templates')) {
    const W_DISCORD = '4 messages send an empty Discord link.'
    const W_PROGRAM = 'The program link is not on sprint.ecomuniversity.com. 9 messages send it.'
    for (const size of SIZES) {
      const label = `templates, full, founder, ${size.join('x')}`
      console.log(`\n${label}`)
      await go('/dev/admin/templates', size)
      await ready('Message settings')
      const text = await bodyText()
      expect(text.includes(W_DISCORD) && text.includes(W_PROGRAM), `${label}: both warnings show`)
      // The review's fix round: the panel opens folded; opened here, so the links and the switches are measured too.
      await press(await button('Show settings'))
      await sleep(150)
      const opened = await bodyText()
      expect(opened.includes('Each switch below acts only while the master switch is on.') && opened.includes('Off: nothing posts'),
        `${label}: opened, the master switch is off and says nothing posts; the switches under it act only while it is on`)
      expect(!/subscription/i.test(opened), `${label}: no "subscription" on the page`)
      await check(label, `templates-full-${size[0]}`)
      await tapsOk(label)
    }
    for (const [state, wantText, size] of [
      ['fixed', 'Message settings', [1440, 900]], ['empty', 'No templates yet.', [390, 844]], ['error', "Couldn't load the templates.", [390, 844]],
      ['nosettings', "Couldn't load the message settings", [1440, 900]], ['nocourse', 'Templates', [1440, 900]],
    ]) {
      const label = `templates, ${state}, ${size.join('x')}`
      console.log(`\n${label}`)
      await go(`/dev/admin/templates?state=${state}`, size)
      await ready(wantText)
      if (state === 'fixed') {
        const text = await bodyText()
        expect(!text.includes(W_DISCORD) && !text.includes('is not on sprint.ecomuniversity.com'), `${label}: no warning once both links are right`)
        // The review's fix round: with nothing to fix, Message settings is one line, and the first template is on the first screen.
        const first = await page.evaluate(() => ({ open: document.querySelector('[data-settings-open]')?.dataset.settingsOpen, top: Math.round(document.querySelector('.list-row button[aria-expanded]').getBoundingClientRect().top) }))
        expect(first.open === 'no' && first.top < 900, `${label}: Message settings folded, the first template at ${first.top}px, on the first screen`, JSON.stringify(first))
      }
      await check(label, `templates-${state}-${size[0]}`)
    }
    {
      const label = 'templates, loading, 390x844'
      console.log(`\n${label}`)
      await go('/dev/admin/templates?state=loading', [390, 844])
      expect((await page.$('[role="status"]')) !== null, `${label}: the list shows its loading state`)
      await check(label, 'templates-loading-390')
    }
    for (const size of [[390, 844], [1440, 900]]) {
      const label = `templates, csm, ${size.join('x')}`
      console.log(`\n${label}`)
      await go('/dev/admin/templates?role=csm', size)
      await ready('Message settings')
      const folded = await page.evaluate(() => {
        const box = document.getElementById('message-settings-title')?.closest('section')
        return { open: box.dataset.settingsOpen, buttons: [...box.querySelectorAll('button')].map((b) => b.textContent.trim()), text: box.innerText }
      })
      expect(folded.open === 'no' && JSON.stringify(folded.buttons) === JSON.stringify(['Show settings']) && folded.text.includes(W_DISCORD) && folded.text.includes(W_PROGRAM),
        `${label}: for a csm, who cannot fix them, Message settings is folded: its warnings and one button, Show settings`, JSON.stringify(folded).slice(0, 200))
      await press(await button('Show settings'))
      await sleep(150)
      const panel = await page.evaluate(() => {
        const box = document.getElementById('message-settings-title')?.closest('section')
        return { inputs: box.querySelectorAll('input').length, buttons: [...box.querySelectorAll('button')].map((b) => b.textContent.trim()), text: box.innerText }
      })
      expect(panel.inputs === 0 && JSON.stringify(panel.buttons) === JSON.stringify(['Hide settings']) && panel.text.includes('Empty') && panel.text.includes('https://old-course-host.example.com/login'),
        `${label}: opened, a csm reads the links and the switches, with no field and no button but the fold`, JSON.stringify(panel).slice(0, 160))
      expect(((await bodyText()).match(/Only a founder or an admin can change them\./g) ?? []).length === 1 && (await isNull(await button('New template'))),
        `${label}: says once that only a founder or an admin can change them, and offers no New template`)
      await press(await rowHeader('Welcome (Day 1)'))
      await sleep(200)
      expect(await isNull(await inOpenRow('Save')) && await isNull(await inOpenRow('Delete template')), `${label}: an opened template has no Save and no Delete`)
      await check(`${label}, a template open`, `templates-csm-open-${size[0]}`)
    }

    console.log('\ntemplates: the header, the buttons, the conditions')
    {
      await go('/dev/admin/templates', [1440, 900])
      await ready('Message settings')
      const ink = await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'New template'); const cs = getComputedStyle(b); return { bg: cs.backgroundColor, color: cs.color } })
      expect(ink.bg === 'rgb(247, 246, 243)' && ink.color === 'rgb(24, 24, 26)', 'New template is the page\'s one ink button (Stalactite fill, Gunpowder words); Refresh stays raised', JSON.stringify(ink))
      const top = await page.evaluate(() => ({ open: document.querySelector('[data-settings-open]').dataset.settingsOpen, top: Math.round(document.querySelector('.list-row button[aria-expanded]').getBoundingClientRect().top) }))
      expect(top.open === 'no' && top.top < 900, `with both warnings standing, a founder finds Message settings folded and the first template at ${top.top}px, on the first screen`, JSON.stringify(top))
      await go('/dev/admin/templates', [390, 844])
      await ready('Message settings')
      const head = await page.evaluate(() => {
        const h = [...document.querySelectorAll('main header')].find((x) => x.querySelector('h1'))
        const acts = h.querySelector('[data-header-actions]').getBoundingClientRect()
        const desc = h.querySelector('p').getBoundingClientRect()
        const title = h.querySelector('h1').getBoundingClientRect()
        return { actsTop: Math.round(acts.top), descBottom: Math.round(desc.bottom), titleH: Math.round(title.height) }
      })
      expect(head.actsTop >= head.descBottom && head.titleH >= 44, 'on a phone Refresh and New template go under the description, the title alone on its 44px line', JSON.stringify(head))
      await go('/dev/admin/templates', [1440, 900])
      await ready('Message settings')
      await press(await rowHeader('Is cancelling'))
      await sleep(200)
      const ops = await page.evaluate(() => [...document.querySelector('.list-row button[aria-expanded="true"]').closest('.list-row').querySelectorAll('select')].map((sel) => [...sel.options].map((o) => o.textContent.trim()).join('|')))
      expect(ops.some((o) => o === 'is yes|is no'), 'a yes-or-no condition (Is canceling) is one select, "is yes" or "is no", never a lone "is"', JSON.stringify(ops))
      const del = await page.evaluate(() => {
        const row = document.querySelector('.list-row button[aria-expanded="true"]').closest('.list-row')
        const bs = [...row.querySelectorAll('button')].filter((b) => ['Delete template', 'Show preview', 'Save'].includes(b.textContent.trim()))
        return bs.map((b) => ({ t: b.textContent.trim(), left: Math.round(b.getBoundingClientRect().left), bg: getComputedStyle(b).backgroundColor, color: getComputedStyle(b).color }))
      })
      const d = del.find((x) => x.t === 'Delete template')
      const pv = del.find((x) => x.t === 'Show preview')
      expect(d && pv && d.bg === 'rgb(255, 69, 58)' && d.color === 'rgb(24, 24, 26)' && d.left < pv.left,
        'Delete template is the red danger button, Gunpowder words, at the start of the row, Show preview and Save at its end', JSON.stringify(del))
      await check('templates, a custom template open, 1440x900', 'templates-custom-open-1440')
    }

    console.log('\ntemplates: by clicks, as a founder')
    {
      await go('/dev/admin/templates', [1440, 900])
      await ready('Message settings')
      await press(await rowHeader('Stalled student (Whop, no Discord) - Day 3'))
      await sleep(200)
      expect(await isNull(await inOpenRow('Delete template')), 'a built-in opened: no Delete template')
      const body = await byLabel('Message', '.list-row:has(button[aria-expanded="true"])')
      // The caret at the end of the message, then typed as a person types.
      await body.evaluate((el) => { el.scrollIntoView({ block: 'center' }); el.focus(); el.setSelectionRange(el.value.length, el.value.length) })
      await page.keyboard.type(' See you there.')
      await sleep(150)
      const rowText = await page.evaluate(() => document.querySelector('.list-row button[aria-expanded="true"]').innerText)
      expect(rowText.includes('Unsaved'), 'a changed message shows Unsaved on its line')
      await press(await inOpenRow('Show preview'))
      await sleep(150)
      const preview = await page.evaluate(() => document.querySelector('.list-row button[aria-expanded="true"]').closest('.list-row').innerText)
      expect(preview.includes('The course: https://old-course-host.example.com/login') && preview.includes('Discord: {discordInvite}')
        && preview.includes('{discordInvite} stays as written: the Discord link is empty. Set it in Message settings.') && preview.includes('See you there.'),
        'the preview fills the live program link, names the empty Discord link, and shows the unsaved text')
      await check('templates, a built-in open with its preview, 1440x900', 'templates-open-preview-1440')
      await press(await inOpenRow('Save'))
      await page.waitForFunction(() => document.body.innerText.includes('Saved Stalled student (Whop, no Discord) - Day 3.'), { timeout: 5000 })
      const saved = (await laneCalls()).filter((c) => c.name === 'saveTemplate')
      expect(saved.length === 1 && JSON.stringify(Object.keys(saved[0].args[1])) === JSON.stringify(['body']) && saved[0].args[1].body.endsWith('See you there.'),
        'Save sends the new message and nothing else (no bucket, no conditions)', JSON.stringify(saved))

      await press(await button('Show settings'))
      await sleep(150)
      expect((await page.evaluate(() => document.querySelector('[data-settings-open]').dataset.settingsOpen)) === 'yes', 'Show settings opens the links and the switches')
      const discord = await byLabel('Discord invite link')
      await discord.evaluate((el) => el.scrollIntoView({ block: 'center' }))
      await discord.click()
      await page.keyboard.type('https://discord.gg/madeup123')
      const saveDiscord = await page.evaluateHandle(() => {
        const label = [...document.querySelectorAll('label')].find((l) => l.textContent.trim() === 'Discord invite link')
        return [...label.parentElement.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Save')
      })
      await press(saveDiscord)
      await page.waitForFunction(() => document.body.innerText.includes('Saved the Discord link.'), { timeout: 5000 })
      const afterLink = await bodyText()
      expect(!afterLink.includes('4 messages send an empty Discord link.') && afterLink.includes('9 messages send it.'),
        'the Discord link saved: its warning goes, the program link\'s stays')
      expect((await laneCalls()).some((c) => c.name === 'saveSetting' && c.args[0] === 'discord_invite_link' && c.args[1] === 'https://discord.gg/madeup123'),
        'through the settings call with the 1 key and its value')

      await press(await switchButton('Master switch', 'Turn on'))
      await sleep(150)
      expect((await bodyText()).includes('Turn on automated Discord posts? Nothing posts yet: every switch below is off.'),
        'Turn on for the master asks first, and says what starts posting')
      await check('templates, the master switch asking, 1440x900', 'templates-master-ask-1440')
      expect(!(await laneCalls()).some((c) => c.name === 'saveSetting' && c.args[0] === 'dms_master_enabled'), 'nothing is sent before Yes')
      await press(await button('Yes, turn on'))
      await page.waitForFunction(() => document.body.innerText.includes('Master switch is on.'), { timeout: 5000 })
      expect((await laneCalls()).some((c) => c.name === 'saveSetting' && c.args[0] === 'dms_master_enabled' && c.args[1] === 'true'), 'Yes sends the master switch as "true"')

      await press(await rowHeader('Is cancelling'))
      await sleep(200)
      const rowWords = await page.evaluate(() => document.querySelector('.list-row button[aria-expanded="true"]').closest('.list-row').innerText)
      expect(rowWords.includes('Membership status'), 'the custom template\'s conditions read "Membership status"')
      await press(await inOpenRow('Delete template'))
      await sleep(100)
      expect((await bodyText()).includes('Delete this template? Tasks it already made stay in Tasks, without it. This cannot be undone.'), 'Delete asks first')
      await press(await inOpenRow('Yes, delete it'))
      await page.waitForFunction(() => document.body.innerText.includes('Deleted Is cancelling.'), { timeout: 5000 })
      expect(await isNull(await rowHeader('Is cancelling')), 'the custom template is gone from the list')

      await press(await button('New template'))
      await page.waitForSelector('[role="dialog"]')
      await press(await page.evaluateHandle(() => [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === 'Create template')))
      await sleep(100)
      expect((await page.$eval('[role="dialog"]', (d) => d.innerText)).includes('Add a title first.'), 'a new template with no title is refused before anything is sent')
      await check('templates, the new template dialog, 1440x900', 'templates-new-1440')
      await (await byLabel('Title', '[role="dialog"]')).type('Quiet for a week')
      await (await byLabel('Message', '[role="dialog"]')).type('Hey {firstName}, all good?')
      await press(await page.evaluateHandle(() => [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === 'Add a condition')))
      await press(await page.evaluateHandle(() => [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === 'Create template')))
      await page.waitForFunction(() => document.body.innerText.includes('Created Quiet for a week. It is on.'), { timeout: 5000 })
      expect((await page.$('[role="dialog"]')) === null && !(await isNull(await rowHeader('Quiet for a week'))), 'the new template is made, on, and listed')
      await check('templates, after the clicks, 1440x900', 'templates-after-clicks-1440')
    }
    console.log('\ntemplates: Refresh keeps what is being edited, and shows what someone else saved')
    {
      await go('/dev/admin/templates?drift=1', [1440, 900])
      await ready('Message settings')
      const openMessage = () => page.evaluate(() => {
        const head = document.querySelector('.list-row button[aria-expanded="true"]')
        const area = head.closest('.list-row').querySelector('textarea[rows]:not([rows="2"])')
        return { unsaved: head.innerText.includes('Unsaved'), text: area?.value ?? '' }
      })
      await press(await rowHeader('Welcome (Day 1)'))
      await sleep(200)
      const before = await openMessage()
      expect(before.text.startsWith('Hey {firstName}! A made-up welcome.'), 'before: Welcome (Day 1) holds its first message', JSON.stringify(before))
      await press(await rowHeader('Stalled student (Discord) - Day 3'))
      await sleep(200)
      const msg = await byLabel('Message', '.list-row:has(button[aria-expanded="true"])')
      await msg.evaluate((el) => { el.focus(); el.setSelectionRange(el.value.length, el.value.length) })
      await page.keyboard.type(' Still here.')
      await press(await button('Refresh'))
      await page.waitForFunction(() => !document.body.innerText.includes('· Updating') && document.body.innerText.includes('templates'), { timeout: 10000 })
      await sleep(300)
      const kept = await page.evaluate(() => {
        const head = [...document.querySelectorAll('button[aria-expanded]')].find((b) => b.textContent.startsWith('Stalled student (Discord) - Day 3'))
        const area = head.closest('.list-row').querySelector('textarea[rows]:not([rows="2"])')
        return { unsaved: head.innerText.includes('Unsaved'), text: area?.value ?? '' }
      })
      expect(kept.unsaved && kept.text.endsWith('Still here.'), 'the row being edited keeps its unsaved message through Refresh', JSON.stringify(kept))
      await press(await rowHeader('Welcome (Day 1)'))
      await sleep(200)
      const welcome = await openMessage()
      expect(!welcome.unsaved && welcome.text.startsWith('Hey {firstName}! A welcome another team member saved.'),
        'a row nobody here touched shows the message someone else saved, not the old one as an unsaved change', JSON.stringify(welcome))
    }
    {
      const label = 'templates, a template open, 390x844'
      console.log(`\n${label}`)
      await go('/dev/admin/templates', [390, 844])
      await ready('Message settings')
      await press(await rowHeader('Is cancelling'))
      await sleep(200)
      await check(label, 'templates-open-390')
      await tapsOk(label)
    }
  }

  if (wanted('survey')) {
    for (const size of SIZES) {
      const label = `survey, full, ${size.join('x')}`
      console.log(`\n${label}`)
      await go('/dev/admin/survey', size)
      // innerText reads the eyebrows in capitals: wait for a name.
      await ready('Maya Lindqvist')
      const pills = await page.$$eval('.pill-tone', (ps) => ps.map((p) => p.textContent.trim()))
      expect(['Applied', 'Approved', 'Code Applied', 'Rejected'].every((w) => pills.includes(w)) && !pills.includes('Pending'),
        `${label}: the status words are the 30% page's: Applied, Approved, Code Applied, Rejected`, JSON.stringify([...new Set(pills)]))
      expect((await bodyText()).includes('Unknown student') && (await bodyText()).includes('No email on file'), `${label}: a student who is gone reads "Unknown student"`)
      await check(label, `survey-full-${size[0]}`)
      await tapsOk(label)
    }
    console.log('\nsurvey: from 1 October, the summary, the questions answered (the review\'s fix round)')
    {
      await go('/dev/admin/survey', [1440, 900])
      await ready('Maya Lindqvist')
      const text = await bodyText()
      const cards = () => page.$$eval('main article', (as) => as.length)
      expect(text.includes('2 applications from before Thu 1 Oct are not shown.') && !text.includes('Noah Brandt') && (await cards()) === 7,
        'the applications from 1 October, as the 30% page lists them; one line counts the 2 older ones', String(await cards()))
      const summary = await page.evaluate(() => ({ parts: [...document.querySelectorAll('[data-summary]')].map((x) => x.dataset.summary), text: document.querySelector('[data-summary="pace"]')?.innerText ?? '' }))
      expect(JSON.stringify(summary.parts) === JSON.stringify(['average', 'spread', 'pace']) && /Just right\s*3/.test(summary.text) && /Way too slow\s*0/.test(summary.text),
        'the summary on top: the average, the scores\' spread and how many picked each pace answer', JSON.stringify(summary).slice(0, 200))
      const jonah = await page.evaluate(() => [...document.querySelectorAll('main article')].find((a) => a.innerText.includes('Jonah Pereira')).innerText)
      expect(!jonah.includes('No answer') && !jonah.includes('biggest win'), 'a card names only the questions its student answered: no "No answer" lines', jonah.slice(0, 160))
      await press(await button('Show them'))
      await sleep(200)
      expect((await cards()) === 9 && (await bodyText()).includes('Noah Brandt') && (await bodyText()).includes('Showing every application, 2 of them from before Thu 1 Oct.'),
        'Show them: every application, the older 2 too, and the line says so', String(await cards()))
      await check('survey, every application shown, 1440x900', 'survey-all-1440')
    }
    for (const [state, want] of [['empty', 'No survey answers yet.'], ['error', "Couldn't load the survey."], ['loading', 'Survey']]) {
      for (const size of [[390, 844], [1440, 900]]) {
        const label = `survey, ${state}, ${size.join('x')}`
        console.log(`\n${label}`)
        await go(`/dev/admin/survey?state=${state}`, size)
        await ready(want)
        if (state === 'error') {
          // The review's fix round: in plain words; the database's own behind a closed Details.
          const t = await bodyText()
          expect(t.includes('The database took too long to answer.') && t.includes('Retry') && !t.includes('canceling statement'), `${label}: says why in plain words, with Retry`)
          await page.$eval('[role="alert"] details summary', (sm) => sm.click())
          await sleep(100)
          expect((await bodyText()).includes('The applications could not be read: canceling statement due to statement timeout'), `${label}: Details holds what could not be read, in the database's words`)
        }
        await check(label, `survey-${state}-${size[0]}`)
      }
    }
  }

  if (wanted('team')) {
    for (const size of SIZES) {
      const label = `team, full, founder, ${size.join('x')}`
      console.log(`\n${label}`)
      await go('/dev/admin/team', size)
      await ready('Maximilian Featherstonehaugh-Smythe')
      expect((await page.$eval('input[type="email"]', (i) => i.placeholder)) === 'name@ecomuniversity.com', `${label}: the email field's example is name@ecomuniversity.com`)
      const fields = await page.evaluate(() => {
        const send = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Send invite')
        return { size: getComputedStyle(document.querySelector('input[type="email"]')).fontSize, send: getComputedStyle(send).backgroundColor }
      })
      expect(fields.size === (size[0] >= 640 ? '14px' : '16px') && fields.send === 'rgb(247, 246, 243)',
        `${label}: the fields' words are ${size[0] >= 640 ? '14px with a mouse on a wide window' : '16px on a phone'}; Send invite is the ink button`, JSON.stringify(fields))
      await check(label, `team-full-${size[0]}`)
      await tapsOk(label)
    }
    console.log('\nteam: by clicks')
    {
      await go('/dev/admin/team', [390, 844])
      await ready('Sam Lee')
      await press(await page.evaluateHandle(() => {
        const row = [...document.querySelectorAll('.list-row')].find((r) => r.innerText.includes('sam.lee@example.com'))
        return [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Remove')
      }))
      await sleep(100)
      expect((await bodyText()).includes('Remove sam.lee@example.com? Their login is deleted too. This cannot be undone.'), 'Remove asks first')
      await check('team, a removal asking, 390x844', 'team-remove-ask-390')
      const yes = await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Yes, remove'); const cs = getComputedStyle(b); return { bg: cs.backgroundColor, color: cs.color, h: Math.round(b.getBoundingClientRect().height) } })
      expect(yes.bg === 'rgb(255, 69, 58)' && yes.color === 'rgb(24, 24, 26)' && yes.h >= 44, 'Yes, remove is the danger button: red, Gunpowder words (5.2:1), 44px', JSON.stringify(yes))
      await press(await button('Yes, remove'))
      await page.waitForFunction(() => document.body.innerText.includes('Removed sam.lee@example.com.'), { timeout: 5000 })
      expect(!(await bodyText()).includes('Sam Lee'), 'and the member is gone from the list')
      const select = await page.evaluateHandle(() => {
        const row = [...document.querySelectorAll('.list-row')].find((r) => r.innerText.includes('jamie.rowe@example.com'))
        return row.querySelector('select')
      })
      await select.select('csm')
      await page.waitForFunction(() => document.body.innerText.includes('Jamie Rowe is now CSM.'), { timeout: 5000 })
      expect((await laneCalls()).some((c) => c.name === 'changeRole' && c.args[0] === 'tm-jamie' && c.args[1] === 'csm'), 'a role change is sent and said')
      const self = await page.evaluate(() => { const r = [...document.querySelectorAll('.list-row')].find((x) => x.innerText.includes('robin.hale@example.com')); return { select: !!r.querySelector('select'), pill: r.querySelector('[data-role-locked]')?.textContent.trim() } })
      expect(!self.select && self.pill === 'Founder' && (await bodyText()).includes("You can't change your own founder role."),
        'the founder\'s own role is a "Founder" pill, not a select that looks live and does nothing, and says why', JSON.stringify(self))
    }
    for (const [state, role, want, size] of [
      ['full', 'admin', 'Only founders can manage the team.', [390, 844]], ['empty', 'founder', 'No team members to show.', [1440, 900]],
      ['error', 'founder', "Couldn't load the team.", [390, 844]], ['loading', 'founder', 'Invite a team member', [1440, 900]],
    ]) {
      const label = `team, ${state}, ${role}, ${size.join('x')}`
      console.log(`\n${label}`)
      await go(`/dev/admin/team?state=${state}&role=${role}`, size)
      await ready(want)
      await check(label, `team-${state}-${role}-${size[0]}`)
    }
  }

  if (wanted('insights')) {
    /** The "30% off applied" card: its note, its number, its change line, whether a chart is drawn, its bars, its empty line. Null when it is not there. */
    const thirtyCard = () => page.evaluate(() => {
      const h = [...document.querySelectorAll('h2')].find((x) => x.textContent === '30% off applied')
      if (!h) return null
      const card = h.parentElement.parentElement
      const row = card.children[1]
      const spans = row ? [...row.children] : []
      return {
        note: h.nextElementSibling?.textContent ?? null,
        number: spans[0]?.textContent ?? null,
        change: spans[1] ? spans[1].textContent.replace(/\s+/g, ' ').trim() : null,
        chart: !!card.querySelector('[aria-roledescription="chart"]'),
        // The chart's days, from its table for screen readers (beside the chart, as on the Dashboard's tiles).
        bars: card.querySelectorAll('tbody tr').length,
        empty: [...card.querySelectorAll('p')].map((p) => p.textContent).find((t) => t.startsWith('No 30%')) ?? null,
      }
    })
    for (const size of SIZES) {
      const label = `insights, full, ${size.join('x')}`
      console.log(`\n${label}`)
      await go('/dev/admin/insights', size)
      await ready('Avg progress')
      await page.waitForFunction(() => document.querySelectorAll('[aria-roledescription="chart"]').length >= 4, { timeout: 10000 })
      const axis = await page.$$eval('[data-guide] span', (ts) => ts.map((t) => parseFloat(getComputedStyle(t).fontSize)))
      expect(axis.length >= 12 && Math.min(...axis) >= 11, `${label}: the gridlines' labels draw at their size (${Math.min(...axis)}px at the smallest)`, JSON.stringify(axis.slice(0, 6)))
      // The review's fix round: Avg progress from the switch, in points; the Dashboard's chart, its days and its palette; Churned whole.
      const avg = await page.evaluate(() => {
        const card = document.querySelector('[data-metric="avg_progress"]')
        return {
          rows: [...card.querySelectorAll('tbody tr')].map((r) => r.innerText.replace(/\s+/g, ' ').trim()),
          delta: card.querySelector('[data-delta]')?.textContent.replace(/\s+/g, ' ').trim(),
          guides: [...card.querySelectorAll('[data-guide]')].map((g) => g.dataset.guide),
        }
      })
      expect(avg.rows.length === 3 && avg.rows.every((r) => /\b2\.\d+%$/.test(r)) && /^↑\s*Up 0\.1 pts since \w{3} \d{1,2} Oct$/.test(avg.delta ?? ''),
        `${label}: Avg progress starts on the switch's day (no 36% beside 3%), and its change is in points since then`, JSON.stringify(avg))
      const churned = await page.evaluate(() => {
        const card = document.querySelector('[data-metric="churned_count"]')
        const bars = [...card.querySelectorAll('[aria-roledescription="chart"] div[aria-hidden="true"] > div > div')].map((b) => getComputedStyle(b).backgroundColor)
        const box = card.getBoundingClientRect()
        const avgBox = document.querySelector('[data-metric="avg_progress"]').getBoundingClientRect()
        return { guides: [...card.querySelectorAll('[data-guide]')].map((g) => g.dataset.guide), bars: [...new Set(bars)], wide: Math.round(box.width), half: Math.round(avgBox.width) }
      })
      expect(JSON.stringify(churned.guides) === JSON.stringify(['0', '2', '4']) && churned.bars.length > 0 && churned.bars.every((c) => c === 'rgb(147, 183, 213)')
          && (size[0] < 1280 || churned.wide > churned.half * 1.8),
        `${label}: Churned's bars in Airy Blue (not red), its gridlines 0, 2 and 4 (a top of 3: a 1 under its own height), the card the whole width`, JSON.stringify(churned))
      const labels = await page.$$eval('[data-metric] figure > div[aria-hidden="true"] span', (ss) => ss.map((x) => x.textContent.trim()))
      expect(labels.length >= 6 && labels.every((l) => /^\w{3} \d{1,2} \w{3}$/.test(l)), `${label}: the axes' days read like "Wed 7 Oct"`, JSON.stringify(labels.slice(0, 4)))
      expect(/Updated \d\d:\d\d/.test(await bodyText()), `${label}: the header says when it was updated`)
      expect((await bodyText()).includes('Activity right now') && !(await bodyText()).includes('—'), `${label}: the activity card, no em dash`)
      // "30% off applied" (T-137, R5), drawn as the Bounty Program's card: the fixture's 51 codes over 25 days, 26 in the
      // 14 days shown against 25 in the 14 before, and bars per day.
      const thirty = await thirtyCard()
      expect(thirty && thirty.note === '51 in all time' && thirty.number === '26' && thirty.change === '↑1 more (+4%) than the period before' && thirty.chart && thirty.bars >= 10,
        `${label}: "30% off applied", drawn as the Bounty Program's card: its count in the range, the change against the 14 days before, the bars per day`, JSON.stringify(thirty))
      await check(label, `insights-full-${size[0]}`)
      await tapsOk(label)
    }
    console.log('\ninsights: by clicks')
    {
      await go('/dev/admin/insights', [1440, 900])
      await ready('Avg progress')
      for (const range of ['7 days', '30 days', '90 days', 'All']) {
        await press(await button(range))
        await sleep(450)
        const pressed = await page.$$eval('button[aria-pressed="true"]', (bs) => bs.map((b) => b.textContent.trim()))
        expect(JSON.stringify(pressed) === JSON.stringify([range]), `${range}: pressed, the charts drawn again`, JSON.stringify(pressed))
      }
      await press(await button('Dates'))
      await sleep(300)
      expect((await page.$$('input[type="date"]')).length === 2, 'Dates: the two date fields')
      await check('insights, dates, 1440x900', 'insights-dates-1440')
    }
    for (const [state, want, size] of [
      ['partial', 'Current sprinters: couldn\'t load.', [390, 844]], ['error', "Couldn't load the snapshots.", [1440, 900]],
      ['noreset', "Couldn't read the date of the course switch, so the line is not drawn.", [1440, 900]],
      ['empty', 'No snapshots in this range.', [390, 844]], ['loading', 'Loading the snapshots', [390, 844]],
    ]) {
      const label = `insights, ${state}, ${size.join('x')}`
      console.log(`\n${label}`)
      await go(`/dev/admin/insights?state=${state}`, size)
      await ready(want)
      if (state === 'partial') {
        const text = await bodyText()
        expect(text.includes('Onboarded to the Bounty Program: couldn\'t load.') && !/\b0%/.test(text.slice(text.indexOf('Current sprinters'), text.indexOf('Avg progress'))),
          `${label}: the two failed reads say so, with no 0 in their place`)
        expect(text.includes('The database took too long to answer.') && !text.includes('canceling statement'), `${label}: in plain words, the database's own behind Details`)
      }
      // The 30% card in each state (T-137, R5): a failed read is ReadFailed with its plain words, never 0.
      const thirty = await thirtyCard()
      const thirtyFailed = (await bodyText()).includes("30% off applied: couldn't load.")
      if (state === 'partial' || state === 'error') expect(thirtyFailed && thirty === null, `${label}: "30% off applied: couldn't load.", with Retry, and no count`, JSON.stringify(thirty))
      if (state === 'empty') expect(!thirtyFailed && thirty?.note === '0 in all time' && thirty.number === '0' && thirty.empty === 'No 30% code went on in this range.', `${label}: the 30% card at 0, "No 30% code went on in this range."`, JSON.stringify(thirty))
      if (state === 'loading') expect(!thirtyFailed && thirty?.note === 'Loading' && thirty.number === '…', `${label}: the 30% card loading: "…", never a 0`, JSON.stringify(thirty))
      if (state === 'noreset') expect(thirty?.note === '51 in all time', `${label}: the 30% card stands`, JSON.stringify(thirty))
      if (state === 'noreset') {
        const text = await bodyText()
        expect(text.includes('The database took too long to answer.') && (await page.$('[data-metric="avg_progress"]')) === null && (await page.$('[data-metric="churned_count"]')) !== null,
          `${label}: Avg progress, which needs the switch's date, says it could not draw its line; the other charts stand`)
      }
      await check(label, `insights-${state}-${size[0]}`)
    }
    {
      const label = 'insights, old course, 390x844'
      console.log(`\n${label}`)
      await go('/dev/admin/insights?course=old', [390, 844])
      await ready('Pace right now')
      await check(label, 'insights-old-390')
    }
  }

  const errs = newConsoleErrors(from)
  expect(errs.length === 0, 'templates lane: no error in the browser console', errs.slice(0, 3).join(' || '))
}

// ════════════════════════════════════════════════════════════════════════════
// review: admin rebuild 2's review fix round (WI-11), across the pages
// ════════════════════════════════════════════════════════════════════════════
if (wanted('review')) {
  const from = consoleErrors.length
  console.log('\nreview: a header keeps its height, its place and its action from loading to loaded, and on a failed read')
  /** The page's own header (the one with an h1): its title line's top and height, and its buttons. */
  const headerOf = () => page.evaluate(() => {
    const h = [...document.querySelectorAll('main header')].find((x) => x.querySelector('h1'))
    if (!h) return null
    const t = h.querySelector('h1').getBoundingClientRect()
    return { top: Math.round(t.top), height: Math.round(t.height), buttons: [...h.querySelectorAll('button')].map((b) => b.textContent.trim()).filter(Boolean) }
  })
  const PAGES = [
    ['/dev/admin/dashboard', 'state'], ['/dev/admin/discounts', 'state'], ['/dev/admin/tasks', 'state'], ['/dev/admin/students', 'state'],
    ['/dev/admin/journey', 'state'], ['/dev/admin/feedback/lessons', 'state'], ['/dev/admin/survey', 'state'], ['/dev/admin/templates', 'state'],
    ['/dev/admin/insights', 'state'],
  ]
  for (const size of [[390, 844], [1440, 900]]) {
    for (const [path] of PAGES) {
      const seen = {}
      for (const state of ['loading', 'error', 'full']) {
        await go(`${path}?state=${state}`, size)
        await sleep(state === 'loading' ? 400 : 900)
        seen[state] = await headerOf()
      }
      const ok3 = ['loading', 'error', 'full'].every((k) => seen[k] && seen[k].height >= 44)
      const sameTop = seen.loading && seen.full && seen.error && seen.loading.top === seen.full.top && seen.error.top === seen.full.top
      const sameButtons = seen.loading && seen.full && seen.error
        && JSON.stringify(seen.loading.buttons) === JSON.stringify(seen.full.buttons) && seen.full.buttons.every((b) => seen.error.buttons.includes(b) || b === 'Refresh')
      expect(ok3 && sameTop && sameButtons, `${path}, ${size.join('x')}: the title line 44px tall and in one place, loading, failed and loaded, its action there all along`, JSON.stringify(seen))
    }
  }
  {
    // Tasks keeps its tabs, with no counts, while the list loads. The 30% page is one list since the 30% applies itself
    // (T-137, R4): no tabs to keep.
    await go('/dev/admin/discounts?state=loading', [390, 844])
    expect((await page.$$('[role="tab"]')).length === 0 && (await page.$('.animate-pulse')) !== null, 'the 30% page, loading: its skeleton rows, and no tabs (one list)')
    await go('/dev/admin/tasks?state=loading', [390, 844])
    const taskTabs = await page.$$eval('[role="tab"]', (ts) => ts.map((t) => t.textContent.trim()))
    expect(JSON.stringify(taskTabs) === JSON.stringify(['To do', 'Sent', 'Dismissed']), 'Tasks, loading: its tabs, no counts', JSON.stringify(taskTabs))
  }
  console.log('\nreview: the 30% page\'s one list on a phone')
  for (const width of [390, 375, 360]) {
    await go('/dev/admin/discounts', [width, 844])
    await page.waitForFunction(() => /Updated \d\d:\d\d/.test(document.body.innerText), { timeout: 30000 })
    await sleep(300)
    // The tabs went with the 30% that applies itself (T-137, R4); the one list must still fit the narrowest phone.
    expect((await page.$$('[role="tab"]')).length === 0, `${width}px wide: one list, no tabs`)
    await check(`review, the 30% list at ${width}x844`, width === 390 ? 'review-thirty-list-390' : null)
  }
  const errs = newConsoleErrors(from)
  expect(errs.length === 0, 'review: no error in the browser console', errs.slice(0, 3).join(' || '))
}

// ════════════════════════════════════════════════════════════════════════════
// render: admin rebuild 2's render review fix round, across the pages
// ════════════════════════════════════════════════════════════════════════════
if (wanted('render')) {
  const from = consoleErrors.length
  const settle = () => sleep(900)
  /** The page's own header (the one with an h1): its meta line's words, and whether it carries FailedMeta. */
  const headerMeta = () => page.evaluate(() => {
    const h = [...document.querySelectorAll('main header')].find((x) => x.querySelector('h1'))
    return h ? { failed: !!h.querySelector('[data-meta-failed]'), text: h.innerText.replace(/\s+/g, ' ') } : null
  })

  console.log('\nrender: a failed read is said in the header too')
  for (const path of ['/dev/admin/tasks', '/dev/admin/students', '/dev/admin/journey', '/dev/admin/insights', '/dev/admin/tasks/insights', '/dev/admin/team',
    '/dev/admin/discounts', '/dev/admin/survey', '/dev/admin/feedback/lessons', '/dev/admin/templates']) {
    await go(`${path}?state=error`, [1280, 720])
    await settle()
    const m = await headerMeta()
    expect(m && m.failed && m.text.includes("Couldn't load") && !m.text.includes('Loading'), `${path}, failed: the header says "Couldn't load", never "Loading"`, JSON.stringify(m))
  }
  await go('/dev/admin/team?state=error', [390, 844])
  await settle()
  await check('render, Team failed, its header saying so, 390x844', 'render-team-error-390')

  // Since the owner's review (2026-10-21) the page, header and board, runs across the window with the pages' side
  // margins (48px from 1024px wide), where the fix round had put it in the 1084px column.
  console.log('\nrender: the journey\'s board across the window, with the pages\' side margins')
  for (const size of [[1280, 720], [1440, 900], [1100, 800]]) {
    await go('/dev/admin/journey', size)
    await settle()
    const b = await page.evaluate(() => {
      const h = [...document.querySelectorAll('main header')].find((x) => x.querySelector('h1')).getBoundingClientRect()
      const board = document.querySelector('[data-board]')
      const r = board.getBoundingClientRect()
      const cols = [...board.querySelectorAll('section[aria-label]')].map((x) => x.getBoundingClientRect())
      return { headerLeft: Math.round(h.left), headerRight: Math.round(h.right), left: Math.round(r.left), right: Math.round(r.right), scroll: board.scrollWidth - board.clientWidth, lastRight: Math.round(cols.at(-1).right), n: cols.length, win: innerWidth }
    })
    const fits = size[0] >= 1120
    expect(b.n === 6 && b.left === b.headerLeft && b.right === b.headerRight && b.left === 48 && b.right === b.win - 48
        && (fits ? b.scroll <= 0 && b.lastRight <= b.right : b.scroll > 0),
      `${size.join('x')}: the board's edges are the header's, 48px from each side of the window; ${fits ? 'all six columns in it' : 'it scrolls sideways inside itself'}`, JSON.stringify(b))
    await check(`render, the journey, ${size.join('x')}`, `render-journey-${size[0]}`)
  }
  await go('/dev/admin/journey', [390, 844])
  await settle()
  const phoneBoard = await page.evaluate(() => { const b = document.querySelector('[data-board]'); const r = b.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), scroll: b.scrollWidth > b.clientWidth, overflowX: getComputedStyle(b).overflowX } })
  expect(phoneBoard.left === 0 && phoneBoard.right === 390 && phoneBoard.scroll && phoneBoard.overflowX === 'auto', 'on a phone the board scrolls sideways inside itself, out to the window\'s edges', JSON.stringify(phoneBoard))
  await check('render, the journey, 390x844', 'render-journey-390')
  const card = await page.evaluate(() => {
    const c = document.querySelector('[data-journey-card="p-maya"]')
    const a = c.querySelector('a[data-student-name]')
    const btn = c.querySelector('button')
    return { href: a?.getAttribute('href'), weight: getComputedStyle(a).fontWeight, user: c.querySelector('[data-student-username]')?.textContent, btnH: Math.round(btn.getBoundingClientRect().height), cardH: Math.round(c.getBoundingClientRect().height) }
  })
  expect(card.href === '/admin/students/p-maya' && card.weight === '600' && card.user === undefined && card.btnH >= card.cardH - 2,
    'a card: the name links to the student\'s page (600, no @username since the owner\'s review); the button under it covers the card', JSON.stringify(card))
  // The render review's second round cut a long username with an ellipsis; since the owner's review (2026-10-21) a card
  // carries no username, and the day shares the name's line. A name too long to share it takes the card's width and the
  // day goes under it, at the right: the name breaks between its parts (after a space or a hyphen), never inside one
  // (at 1280px it broke "Featherstonehau" "gh-Smythe" with the day beside it).
  for (const size of [[1280, 720], [1440, 900], [390, 844]]) {
    await go('/dev/admin/journey', size)
    await settle()
    const u = await page.evaluate(() => {
      const lay = (id) => {
        const c = document.querySelector(`[data-journey-card="${id}"]`)
        const a = c.querySelector('[data-student-name]')
        const node = a.firstChild
        const text = node.textContent
        // The name's parts: each word, a hyphen kept with the part before it.
        const parts = []
        let start = 0
        for (let i = 0; i < text.length; i++) {
          if (text[i] === ' ') { parts.push([start, i]); start = i + 1 } else if (text[i] === '-' || i === text.length - 1) { parts.push([start, i + 1]); start = i + 1 }
        }
        const broken = parts.filter(([s, e]) => { const r = document.createRange(); r.setStart(node, s); r.setEnd(node, e); return r.getClientRects().length > 1 }).map(([s, e]) => text.slice(s, e))
        const box = c.getBoundingClientRect()
        const inner = c.lastElementChild
        const contentRight = inner.getBoundingClientRect().right - parseFloat(getComputedStyle(inner).paddingRight)
        const n = a.getBoundingClientRect()
        const d = c.querySelector('[data-card-day]').getBoundingClientRect()
        return {
          text, broken, user: !!c.querySelector('[data-student-username]'), inside: n.left >= box.left && n.right <= box.right && d.right <= box.right,
          dayAtRight: Math.abs(d.right - contentRight) <= 1, besideName: d.top < n.bottom && d.bottom > n.top, underName: d.top >= n.bottom - 2,
        }
      }
      return { long: lay('p-maximilian'), short: lay('p-maya') }
    })
    expect(u.long.text === 'Maximilian Featherstonehaugh-Smythe' && u.long.broken.length === 0 && !u.long.user && u.long.inside && u.long.dayAtRight && u.long.underName,
      `${size.join('x')}: the longest name breaks only between its parts, inside its card, the day under it at the right; no username`, JSON.stringify(u.long))
    expect(u.short.broken.length === 0 && u.short.dayAtRight && u.short.besideName, `${size.join('x')}: a short name keeps the day at the end of its line`, JSON.stringify(u.short))
    await check(`render, the journey, a long name, ${size.join('x')}`, `render-journey-longname-${size[0]}`)
  }

  console.log('\nrender: Outreach insights\' numbers in the primary ink (the render review\'s second round)')
  for (const size of [[1440, 900], [390, 844]]) {
    await go('/dev/admin/tasks/insights', size)
    await settle()
    const nums = await page.evaluate(() => [...document.querySelectorAll('main .stat-value')].map((v) => ({ label: v.previousElementSibling?.textContent ?? '', value: v.textContent, color: getComputedStyle(v).color })))
    expect(nums.length === 5 && nums.every((n) => n.color === 'rgba(247, 246, 243, 0.92)') && nums.some((n) => n.label === 'Saves' && /%$/.test(n.value)) && nums.some((n) => n.label === 'Success rate' && /%$/.test(n.value)),
      `${size.join('x')}: Outreach insights' 5 numbers, Saves and Success rate among them, in the primary ink, none in Airy Blue (they are not links)`, JSON.stringify(nums))
  }

  console.log('\nrender: the Dashboard\'s sections and Month 2\'s bar')
  for (const size of [[1440, 900], [390, 844]]) {
    await go('/dev/admin/dashboard?state=full', size)
    await page.waitForFunction(() => /Updated \d\d:\d\d/.test(document.body.innerText), { timeout: 30000 })
    const gaps = await page.evaluate(() => {
      const top = (id) => document.getElementById(id).getBoundingClientRect().top
      const bottom = (id) => document.getElementById(id).closest('section').getBoundingClientRect().bottom
      const titles = [...document.querySelectorAll('[data-section-title]')].map((t) => Math.round(t.getBoundingClientRect().height))
      return { a: Math.round(top('dash-program') - bottom('dash-today')), b: Math.round(top('dash-trends') - bottom('dash-program')), titles }
    })
    expect(gaps.a === gaps.b && gaps.titles.every((h) => h === gaps.titles[0]), `${size.join('x')}: the three sections the same distance apart (${gaps.a}px and ${gaps.b}px), every title row as tall`, JSON.stringify(gaps))
    const meter = await page.evaluate(() => { const m = document.querySelector('[data-tile="month2"] [role="meter"]'); return { kids: m.children.length, h: Math.round(m.getBoundingClientRect().height) } })
    expect(meter.kids === 1 && meter.h === 6, `${size.join('x')}: Month 2's countdown is a plain bar, no knob`, JSON.stringify(meter))
    const today = await page.evaluate(() => [...document.querySelectorAll('[data-tile="open-tasks"], [data-tile="needs-hand"]')].map((t) => t.innerText.replace(/\s+/g, ' ')))
    expect(today.every((t) => (t.match(/\bopen\b/gi) ?? []).length <= 1) && today[0].includes('Go to Tasks') && today[1].includes('Go to 30% off'),
      `${size.join('x')}: Today's tiles say "open" once at most, their links named after their pages`, JSON.stringify(today))
  }

  console.log('\nrender: the rows\' actions on the right, under the words on a phone')
  // The 30% page's one list (T-137, R4) holds pending and approved rows with actions, and a decided row with none.
  for (const [path, label] of [['/dev/admin/discounts', '30% off'], ['/dev/admin/discounts?state=reasons', '30% off, every reason'], ['/dev/admin/tasks', 'Tasks, To do']]) {
    for (const size of [[1440, 900], [390, 844]]) {
      await go(path, size)
      await settle()
      const rows = await page.evaluate(() => [...document.querySelectorAll('[data-row-split]')].filter((x) => x.querySelector('[data-row-actions]')).map((x) => {
        const words = x.firstElementChild.getBoundingClientRect()
        const acts = x.querySelector('[data-row-actions]').getBoundingClientRect()
        return { wordsRight: Math.round(words.right), wordsBottom: Math.round(words.bottom), actsLeft: Math.round(acts.left), actsTop: Math.round(acts.top), wordsTop: Math.round(words.top), actsRight: Math.round(acts.right), rowRight: Math.round(x.getBoundingClientRect().right) }
      }))
      const wide = size[0] >= 768
      const good = rows.length > 0 && rows.every((r) => (wide ? r.actsLeft >= r.wordsRight && r.actsTop === r.wordsTop && Math.abs(r.actsRight - r.rowRight) <= 1 : r.actsTop >= r.wordsBottom))
      expect(good, `${label}, ${size.join('x')}: ${wide ? 'the actions in a column on the right, level with the row\'s first line' : 'the actions under the words'} (${rows.length} rows)`, JSON.stringify(rows.slice(0, 2)))
    }
  }
  await go('/dev/admin/discounts', [1440, 900])
  await settle()
  await check('render, 30% off, the actions on the right, 1440x900', 'render-thirty-1440')
  await go('/dev/admin/tasks', [1440, 900])
  await settle()
  await check('render, Tasks, the actions on the right, 1440x900', 'render-tasks-1440')

  console.log('\nrender: the team\'s own 30% code is never warned about')
  for (const size of [[1440, 900], [390, 844]]) {
    await go('/dev/admin/discounts?state=owncode', size)
    await settle()
    const rows = await page.$$eval('.list-row[data-row-status="approved"]', (rs) => rs.map((r) => ({ name: r.querySelector('a')?.textContent, coupon: [...r.querySelectorAll('[data-coupon]')].map((x) => x.dataset.coupon), again: [...r.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Try again') })))
    expect(rows.length === 2 && rows.every((r) => r.coupon.length === 0 && r.again),
      `${size.join('x')}: approved, the team's own code already on both memberships in Whop (one by its name, one by the request's own promo id): no coupon line, Try again there (Mark code applied until T-137)`, JSON.stringify(rows))
    await check(`render, 30% off, approved, the team's own codes, ${size.join('x')}`, `render-thirty-owncode-${size[0]}`)
  }

  console.log('\nrender: every pill row on one line on a phone')
  for (const [path, sel, label] of [
    ['/dev/admin/tasks', '[role="tablist"][aria-label="Task lists"]', 'Tasks\' tabs'],
    ['/dev/admin/students', '[role="group"][aria-label="Membership"]', 'All students\' membership filter'],
    ['/dev/admin/students', '[role="group"][aria-label="Sort"]', 'All students\' sorts'],
    ['/dev/admin/insights', '[role="group"][aria-label="Range"]', 'Insights\' ranges'],
    ['/dev/admin/tasks/insights?reset=none', '[role="group"][aria-label="Range"]', 'Outreach insights\' ranges'],
  ]) {
    for (const width of [390, 360]) {
      await go(path, [width, 844])
      await settle()
      const r = await page.evaluate((s) => {
        const row = document.querySelector(s)
        const kids = [...row.children]
        // One line: every child's middle at the same height (the sorts' "Sort by" is shorter than a pill, centred on it).
        return { lines: new Set(kids.map((k) => { const b = k.getBoundingClientRect(); return Math.round((b.top + b.bottom) / 2) })).size, overflowX: getComputedStyle(row).overflowX, minH: Math.min(...kids.filter((k) => k.tagName === 'BUTTON').map((k) => k.getBoundingClientRect().height)), pageScroll: document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth }
      }, sel)
      expect(r.lines === 1 && r.overflowX === 'auto' && r.minH >= 44 && r.pageScroll <= 0, `${label}, ${width}px: one line that scrolls sideways inside itself, 44px pills, the page never scrolls`, JSON.stringify(r))
    }
  }
  await go('/dev/admin/students', [390, 844])
  await settle()
  await check('render, All students, the filters on one line, 390x844', 'render-students-390')

  console.log('\nrender: a student\'s numbers, a failed one, the Whop sync')
  for (const [route, label] of [['/dev/admin/students/p-jonah', 'Jonah'], ['/dev/admin/students/p-maya?state=partial', 'Maya, partial'], ['/dev/admin/journey?drawer=p-maya', 'the drawer']]) {
    await go(route, [390, 844])
    await settle()
    const facts = await page.evaluate(() => ({
      values: [...document.querySelectorAll('[data-fact-value]')].map((v) => ({ t: v.textContent, lines: Math.round(v.getBoundingClientRect().height / parseFloat(getComputedStyle(v).lineHeight)), clipped: v.scrollWidth > v.clientWidth + 1, color: getComputedStyle(v).color })),
      failed: [...document.querySelectorAll('[data-failed]')].filter((f) => f.closest('.surface-resting')).map((f) => ({ t: f.textContent, size: getComputedStyle(f).fontSize })),
    }))
    expect(facts.values.every((v) => v.lines === 1 && !v.clipped && v.color !== 'rgb(147, 183, 213)') && facts.failed.every((f) => f.t === "Couldn't load" && f.size === '13px'),
      `${label}, 390x844: every number on one line, none in Airy Blue; a failed one is a dot and "Couldn't load" at 13px`, JSON.stringify(facts))
    await check(`render, ${label}, 390x844`, `render-student-${label.replace(/[^a-z]+/gi, '-').toLowerCase()}-390`)
  }
  // The render review's second round: every block whose read failed starts with the warning dot a failed number has.
  for (const [route, label] of [['/dev/admin/students/p-maya?state=partial', 'A student, partial'], ['/dev/admin/journey?state=partial&drawer=p-maya', 'The drawer, partial']]) {
    for (const size of [[390, 844], [1440, 900]]) {
      await go(route, size)
      await settle()
      const f = await page.evaluate(() => {
        const tile = document.querySelector('[data-failed] > span[aria-hidden="true"]')
        return {
          tileDot: tile ? getComputedStyle(tile).backgroundColor : null,
          blocks: [...document.querySelectorAll('[data-section-failed]')].map((b) => {
            const dot = b.firstElementChild
            const r = dot.getBoundingClientRect()
            const words = b.querySelector('p')
            return { text: words?.textContent.slice(0, 42), bg: getComputedStyle(dot).backgroundColor, w: Math.round(r.width), h: Math.round(r.height), hidden: dot.getAttribute('aria-hidden'), beside: r.left < words.getBoundingClientRect().left }
          }),
        }
      })
      expect(f.tileDot !== null && f.blocks.length === 3 && f.blocks.every((b) => b.bg === f.tileDot && b.w === 8 && b.h === 8 && b.hidden === 'true' && b.beside && b.text.startsWith("Couldn't load the")),
        `${label}, ${size.join('x')}: each of its 3 blocks whose read failed starts with the warning dot a failed number has (its colour, 8px), then "Couldn't load the ..."`, JSON.stringify(f))
      await check(`render, ${label}, the failed blocks, ${size.join('x')}`, `render-${label.replace(/[^a-z]+/gi, '-').toLowerCase()}-blocks-${size[0]}`)
    }
  }
  {
    await go('/dev/admin/students/p-jonah', [1440, 900])
    await settle()
    const sync = await page.evaluate(() => ({ line: document.querySelector('[data-sync-line]')?.innerText.replace(/\s+/g, ' '), open: document.querySelector('details[data-sync-details]')?.open, shown: document.body.innerText.includes('FETCHED') || document.body.innerText.includes('Fetched') }))
    expect(sync.line === 'Not synced since the switch Last synced Sun 18 Oct, 12:00 · 5 lessons brought in' && sync.open === false && !sync.shown,
      'the Whop sync: one line (not synced since the switch, when, the lessons it brought in); the counts behind a closed Sync details', JSON.stringify(sync))
    await press(await page.evaluateHandle(() => document.querySelector('details[data-sync-details] summary')))
    await sleep(150)
    expect((await bodyText()).includes('FETCHED') || (await bodyText()).includes('Fetched'), 'pressed, Sync details shows the counts')
    await check('render, a student, Sync details open, 1440x900', 'render-student-sync-open-1440')
  }

  console.log('\nrender: one name part on every page')
  for (const [path, label, link] of [
    ['/dev/admin/discounts', '30% off', true], ['/dev/admin/tasks', 'Tasks', true], ['/dev/admin/journey', 'the journey', true],
    ['/dev/admin/survey', 'Survey', true], ['/dev/admin/feedback/lessons', 'Lesson feedback', true], ['/dev/admin/students', 'All students', false],
  ]) {
    await go(path, [1440, 900])
    await settle()
    const names = await page.evaluate(() => [...document.querySelectorAll('main [data-student-name]')].filter((n) => n.getBoundingClientRect().width > 0).map((n) => ({
      tag: n.tagName, text: n.textContent, href: n.getAttribute('href') ?? n.closest('a')?.getAttribute('href') ?? null, weight: getComputedStyle(n).fontWeight, line: getComputedStyle(n).textDecorationLine, color: getComputedStyle(n).color,
    })))
    // A name with no student behind it (a student gone, an application whose student was deleted) has nothing to link to,
    // and since the render review's second round no underline either: nothing opens from it.
    const NOBODY = ['Unknown student', 'A student no longer on file']
    const underline = (n) => (link && n.tag !== 'A' ? n.line === 'none' : n.line === 'underline')
    expect(names.length > 0 && names.every((n) => n.weight === '600' && underline(n) && n.color === 'rgba(247, 246, 243, 0.92)')
        && names.every((n) => (link ? (n.tag === 'A' ? n.href.startsWith('/admin/students/') : NOBODY.includes(n.text)) : n.tag === 'SPAN' && n.href?.startsWith('/admin/students/'))),
      `${label}: every name the same (600, the primary ink, a hairline underline where it opens the student's page), ${link ? 'each a link to the student\'s page, or no link and no underline with no student behind it' : 'inside the row that is the link'}`, JSON.stringify([names.length, names[0], names.filter((n) => n.tag !== 'A').map((n) => `${n.text}: ${n.line}`)]))
  }
  {
    await go('/dev/admin/students', [1440, 900])
    await settle()
    const theo = await page.evaluate(() => {
      const r = [...document.querySelectorAll('main a.list-row')].find((a) => a.textContent.includes('Theo Marsh'))
      const cell = r.querySelector('.lg\\:grid').children[1]
      // What shows: the cell's words outside the screen reader's span (innerText reads a clipped span too).
      const shown = [...cell.childNodes].map((n) => (n.nodeType === 1 && n.classList.contains('sr-only') ? '' : n.textContent)).join('').trim()
      return { shown, sr: cell.querySelector('.sr-only')?.textContent ?? null }
    })
    expect(theo.shown === '' && theo.sr === 'No username', 'All students: no username is an empty cell (a screen reader hears "No username"), never "None"', JSON.stringify(theo))
  }

  console.log('\nrender: the folds\' markers, Show settings, the dialog\'s primary button, the Survey\'s cards')
  for (const [path, words] of [['/dev/admin/insights', 'How these are worked out'], ['/dev/admin/tasks/insights', 'How these numbers work'], ['/dev/admin/templates', 'What the buckets mean']]) {
    await go(path, [1280, 720])
    await settle()
    const sm = await page.evaluate((w) => { const s = [...document.querySelectorAll('summary')].find((x) => x.textContent.trim() === w); return s ? { display: getComputedStyle(s).display, h: Math.round(s.getBoundingClientRect().height) } : null }, words)
    expect(sm && sm.display === 'list-item' && sm.h >= 44, `${path}: "${words}" has the browser's open/close triangle, 44px tall`, JSON.stringify(sm))
  }
  {
    await go('/dev/admin/templates', [1440, 900])
    await settle()
    const state = () => page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /^(Show|Hide) settings/.test(x.textContent.trim())); return { exp: b.getAttribute('aria-expanded'), controls: b.getAttribute('aria-controls'), panel: !!document.getElementById(b.getAttribute('aria-controls')) } })
    const closed = await state()
    await press(await button('Show settings'))
    await sleep(150)
    const opened = await state()
    expect(closed.exp === 'false' && opened.exp === 'true' && opened.panel && opened.controls === closed.controls, 'Show settings says closed, then open, and names the panel it opens', JSON.stringify({ closed, opened }))
    await press(await button('New template'))
    await page.waitForSelector('[role="dialog"]')
    const create = await page.evaluate(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => x.textContent.trim() === 'Create template'); return getComputedStyle(b).backgroundColor })
    expect(create === 'rgb(247, 246, 243)', 'the New template dialog\'s Create template is the ink (primary) button', create)
  }
  {
    await go('/dev/admin/survey', [1440, 900])
    await settle()
    const answers = await page.$$eval('[data-answers]', (as) => as.map((a) => getComputedStyle(a).backgroundColor))
    expect(answers.length > 0 && answers.every((c) => c === 'rgba(0, 0, 0, 0)'), 'the Survey\'s answers sit in their card, no card inside it', JSON.stringify(answers.slice(0, 3)))
    await check('render, the Survey, 1440x900', 'render-survey-1440')
  }

  console.log('\nrender: the course switch page and the not-found page, in the dark look')
  for (const size of SIZES) {
    for (const state of ['after', 'problems', 'before', 'error', 'loading']) {
      await go(`/dev/admin/cutover?state=${state}`, size)
      await settle()
      const bg = await page.$eval('main', (m) => getComputedStyle(m).backgroundColor)
      expect(bg === 'rgb(24, 24, 26)', `the course switch page, ${state}, ${size.join('x')}: the dark ground`, bg)
      await check(`render, the course switch page, ${state}, ${size.join('x')}`, `render-cutover-${state}-${size[0]}`)
    }
    await go('/dev/admin/missing', size)
    await settle()
    const nf = await page.evaluate(() => ({ title: document.querySelector('main h1')?.textContent, link: [...document.querySelectorAll('main a')].find((a) => a.textContent.trim() === 'Go to the Dashboard')?.getAttribute('href'), bg: getComputedStyle(document.querySelector('main')).backgroundColor }))
    expect(nf.title === 'Page not found' && nf.link === '/admin' && nf.bg === 'rgb(24, 24, 26)', `the not-found page, ${size.join('x')}: in the dark look, a link to the Dashboard`, JSON.stringify(nf))
    await check(`render, the not-found page, ${size.join('x')}`, `render-not-found-${size[0]}`)
  }
  {
    // The real addresses, as the server renders them (the page itself then waits for a sign-in this server has
    // none of): an address with no page is the admin's catch-all, whose notFound() the group's not-found
    // answers (Next's 404 fallback in the page's payload, the catch-all's param beside it); a page that exists
    // has neither. The development server streams, so its status line reads 200 either way.
    const seen = {}
    for (const path of ['/admin/today', '/admin/etfb', '/admin/stats', '/admin/settings', '/admin/discord', '/admin/no-such-page/deeper', '/admin/not-activated', '/admin/cutover']) {
      const html = await (await fetch(`${ORIGIN}${path}`, { redirect: 'manual' })).text()
      seen[path] = { notFound: html.includes('NEXT_HTTP_ERROR_FALLBACK;404') && html.includes('not-found.tsx@boundary'), missing: /\\"missing\\",\\"/.test(html) }
    }
    const old = ['/admin/today', '/admin/etfb', '/admin/stats', '/admin/settings', '/admin/discord', '/admin/no-such-page/deeper']
    expect(old.every((p) => seen[p].notFound && seen[p].missing) && ['/admin/not-activated', '/admin/cutover'].every((p) => !seen[p].notFound && !seen[p].missing),
      'the old admin addresses land on the admin\'s not-found (the catch-all\'s, inside the frame), and Not activated is a page again', JSON.stringify(seen))
  }
  const errs = newConsoleErrors(from)
  expect(errs.length === 0, 'render: no error in the browser console', errs.slice(0, 3).join(' || '))
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
