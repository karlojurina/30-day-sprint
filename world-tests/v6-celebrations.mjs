/**
 * The old dashboard's two celebrations on the map (2026-10-14), walked in a
 * real browser: the streak one and the discount-approved one
 * (src/components/world/WorldCelebrations.tsx, the rules in
 * src/lib/world/celebrations.ts).
 *
 *   node world-tests/v6-celebrations.mjs [--only 1,3]
 *
 * Runs against http://localhost:3111/dev/world-app?catalog=course, which must
 * already be up (this script never starts a server). The harness of
 * v6-hud.mjs: a pretend student, no login, no server call. ?celebrate=1 lets
 * the triggers fire (the pretend student stands in for the signed-in one they
 * need); ?hud= sets the streak, ?discount=approved an approved application,
 * window.__fixture.setStreak(n) the streak going up as a refresh after a
 * finished video would. Headless Chrome on the real GPU, 1691x1278 unless a
 * row says otherwise. About a minute.
 *
 * One PASS or FAIL line per row, with what was measured. After the rows, one
 * MEASURED line: requests to /api, requests to Supabase and page errors over
 * every page the run opened (all three must be 0). Exit code 1 on any FAIL.
 *
 *   1  a 4-day streak never celebrated in this browser: the streak
 *      celebration over the map, "4 days in a row."; the browser key says 4;
 *      a click closes it; a reload does not bring it back
 *   2  the streak goes up while the map is open (4 to 5): it fires again for
 *      5, once; the same 5 again does not
 *   3  a streak already celebrated on the dashboard (its key already 4): no
 *      celebration on the map
 *   4  an approved application never celebrated here: the discount one, its
 *      key set to the request; a reload does not bring it back; one already
 *      celebrated on the dashboard (the key already set) does not show
 *   5  both at once: the streak first, the discount once it is closed
 *   6  without ?celebrate=1 (no signed-in student): neither fires, nothing
 *      is written
 *   7  the dashboard's test events fire them and record nothing
 *   8  on a lesson page: a streak that goes up there (a video just finished)
 *      celebrates over the lesson page
 *   9  phone (390x844): the streak celebration fits the screen
 *
 * Pictures for a person, in world-tests/shots/v6/celebrations/ (git-ignored):
 *   streak-map.png        the streak celebration over the map (row 1)
 *   discount-map.png      the discount celebration over the map (row 4)
 *   streak-lesson.png     the streak celebration over a lesson page (row 8)
 *   streak-phone.png      the streak celebration on a phone (row 9)
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ORIGIN = process.env.BASE_URL || 'http://localhost:3111'
const APP = '/dev/world-app'
const OUT = path.join(HERE, 'shots', 'v6', 'celebrations')
fs.mkdirSync(OUT, { recursive: true })

const argv = process.argv.slice(2)
const onlyArg = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null
const ONLY = onlyArg ? new Set(onlyArg.split(',').map((x) => x.trim())) : null

const DESKTOP = { width: 1691, height: 1278 }
const PHONE = { width: 390, height: 844 }
const READY_MS = 120000
const STREAK_KEY = 'et.streak.lastSeen.fixture-student'
const DISCOUNT_KEY = 'et.discountApproved.lastSeen'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const show = (v) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s === undefined ? 'undefined' : s.length > 360 ? `${s.slice(0, 360)}…` : s
}
const url = (params = {}, sub = '') => `${APP}${sub}?${new URLSearchParams({ catalog: 'course', arrive: '0', poster: 'off', ...params }).toString()}`

const tally = { pages: 0, api: [], supabase: [], pageErrors: [] }
const results = []

/** What is celebrating now, and what the browser has recorded. */
const SNAP = ([streakKey, discountKey]) => {
  const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim()
  const streak = document.querySelector('[role="dialog"][aria-label$="day streak"]')
  const discount = document.querySelector('[role="dialog"][aria-label="30% discount approved"]')
  const box = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }
  }
  let keys = null
  try {
    keys = { streak: localStorage.getItem(streakKey), discount: localStorage.getItem(discountKey) }
  } catch {
    keys = null
  }
  return {
    streak: streak ? { label: streak.getAttribute('aria-label'), text: norm(streak.textContent), box: box(streak), z: getComputedStyle(streak).zIndex } : null,
    discount: discount ? { text: norm(discount.textContent), box: box(discount), z: getComputedStyle(discount).zIndex } : null,
    keys,
    path: location.pathname,
  }
}
const snap = (page) => page.evaluate(SNAP, [STREAK_KEY, DISCOUNT_KEY])

async function waitFor(page, fn, { arg, timeout = 10000, poll = 120, what }) {
  const t0 = Date.now()
  for (;;) {
    try {
      const v = await page.evaluate(fn, arg)
      if (v) return v
    } catch {
      // A navigation in flight drops the context: look again.
    }
    if (Date.now() - t0 > timeout) throw new Error(`${what} (waited ${timeout} ms)`)
    await sleep(poll)
  }
}

const streakUp = () => !!document.querySelector('[role="dialog"][aria-label$="day streak"]')
const discountUp = () => !!document.querySelector('[role="dialog"][aria-label="30% discount approved"]')
const noneUp = () => !document.querySelector('[role="dialog"][aria-label$="day streak"]') && !document.querySelector('[role="dialog"][aria-label="30% discount approved"]')

async function openPage(ctx, row, urlPath, { viewport = DESKTOP, before = null } = {}) {
  const page = await ctx.newPage()
  tally.pages++
  page.setDefaultTimeout(90000)
  await page.setViewport({ ...viewport, deviceScaleFactor: 1 })
  page.on('pageerror', (e) => {
    const rec = { row: row.id, message: `${String(e.message).slice(0, 240)}` }
    row.pageErrors.push(rec)
    tally.pageErrors.push(rec)
  })
  page.on('request', (req) => {
    let u = null
    try {
      u = new URL(req.url())
    } catch {
      return
    }
    if (u.origin === ORIGIN && u.pathname.startsWith('/api')) tally.api.push({ row: row.id, path: u.pathname })
    if (/supabase/i.test(u.hostname)) tally.supabase.push({ row: row.id, host: u.hostname, path: u.pathname })
  })
  // What a browser already holds before the page loads (the dashboard's keys).
  if (before) await page.evaluateOnNewDocument((entries) => {
    try {
      for (const [k, v] of entries) localStorage.setItem(k, v)
    } catch {
      // A page whose storage is off: nothing to seed.
    }
  }, before)
  await page.goto(ORIGIN + urlPath, { waitUntil: 'domcontentloaded', timeout: READY_MS })
  const phone = viewport.width < 760
  const lesson = /\/a\d\/a\dl\d\d/.test(urlPath)
  await waitFor(page, lesson
    ? () => [...document.querySelectorAll('h1')].some((h) => !h.closest('main'))
    : phone
      ? () => document.querySelector('main[data-view="list"] header button[aria-expanded]') !== null
      : () => window.__worldReady === true, {
    timeout: READY_MS,
    poll: 400,
    what: `${urlPath}: the page was not ready`,
  })
  await sleep(900)
  return page
}

/** Close a celebration the way a person does: a click anywhere. */
async function dismiss(page, what) {
  await page.mouse.click(400, 400)
  await waitFor(page, noneUp, { timeout: 4000, what: `${what}: the celebration did not close on a click` })
  await sleep(300)
}

let browser = null

async function runRow(id, name, body) {
  if (ONLY && !ONLY.has(String(id))) return
  const row = { id, name, pass: true, checks: [], pageErrors: [], error: null }
  const ctx = await browser.createBrowserContext()
  const r = {
    row,
    open: (params, o = {}) => openPage(ctx, row, url(params, o.sub ?? ''), o),
    check: (what, ok, value) => {
      row.checks.push({ what, ok: !!ok, value })
      if (!ok) row.pass = false
    },
  }
  const t0 = Date.now()
  try {
    await body(r)
  } catch (e) {
    row.pass = false
    row.error = String(e?.message ?? e).slice(0, 300)
  } finally {
    await ctx.close().catch(() => {})
  }
  if (row.pageErrors.length) {
    row.pass = false
    row.checks.push({ what: 'no page error', ok: false, value: row.pageErrors.slice(0, 2) })
  }
  row.ms = Date.now() - t0
  results.push(row)
  console.log(`${row.pass ? 'PASS' : 'FAIL'}  ${id}. ${name}  (${(row.ms / 1000).toFixed(1)} s)`)
  for (const c of row.checks) if (!c.ok || process.env.VERBOSE) console.log(`        ${c.ok ? 'ok  ' : 'NOT '} ${c.what}: ${show(c.value)}`)
  if (row.error) console.log(`        error: ${row.error}`)
}

browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--no-sandbox', '--hide-scrollbars'],
  protocolTimeout: 120000,
})

try {
  await runRow(1, 'a 4-day streak never celebrated here: the celebration over the map, recorded, once', async (r) => {
    const page = await r.open({ hud: 'some', celebrate: '1' })
    await waitFor(page, streakUp, { timeout: 4000, what: 'row 1: no streak celebration' })
    await sleep(1600)
    let s = await snap(page)
    r.check('the streak celebration is up: "4 days in a row."', s.streak?.label === '4 day streak' && /4 days in a row\./.test(s.streak.text), s.streak)
    r.check('it covers the whole screen, over the map', s.streak?.box.w === DESKTOP.width && s.streak.box.h === DESKTOP.height && Number(s.streak.z) >= 200, s.streak?.box)
    r.check('the browser key (the dashboard\'s) says 4', s.keys?.streak === '4', s.keys)
    await page.screenshot({ path: path.join(OUT, 'streak-map.png') })
    await dismiss(page, 'row 1')
    await page.reload({ waitUntil: 'domcontentloaded' })
    await waitFor(page, () => window.__worldReady === true, { timeout: READY_MS, poll: 400, what: 'row 1: the map did not come back after the reload' })
    await sleep(2000)
    s = await snap(page)
    r.check('after a reload: no celebration, the key still 4', s.streak === null && s.keys?.streak === '4', s)
  })

  await runRow(2, 'the streak goes up while the map is open: once for 5, not again for the same 5', async (r) => {
    const page = await r.open({ hud: 'some', celebrate: '1' })
    await waitFor(page, streakUp, { timeout: 4000, what: 'row 2: no first celebration' })
    await dismiss(page, 'row 2')
    await page.evaluate(() => window.__fixture.setStreak(5))
    await waitFor(page, streakUp, { timeout: 4000, what: 'row 2: no celebration for 5' })
    let s = await snap(page)
    r.check('5: it fires, "5 days in a row.", the key says 5', s.streak?.label === '5 day streak' && /5 days in a row\./.test(s.streak.text) && s.keys?.streak === '5', { streak: s.streak?.label, keys: s.keys })
    await dismiss(page, 'row 2')
    await page.evaluate(() => window.__fixture.setStreak(5))
    await sleep(1500)
    s = await snap(page)
    r.check('the same 5 again: nothing', s.streak === null, s.streak)
  })

  await runRow(3, 'a streak already celebrated on the dashboard: nothing on the map', async (r) => {
    const page = await r.open({ hud: 'some', celebrate: '1' }, { before: [[STREAK_KEY, '4']] })
    await sleep(2000)
    const s = await snap(page)
    r.check('the key was 4 already: no celebration for 4', s.streak === null && s.keys?.streak === '4', s)
  })

  await runRow(4, 'an approved application: the discount celebration once; one the dashboard already showed does not', async (r) => {
    let page = await r.open({ discount: 'approved', celebrate: '1' })
    await waitFor(page, discountUp, { timeout: 4000, what: 'row 4: no discount celebration' })
    await sleep(1600)
    let s = await snap(page)
    r.check('the discount celebration is up: 30% OFF, Discount approved', /30% OFF/.test(s.discount?.text ?? '') && /Discount approved/i.test(s.discount?.text ?? ''), s.discount?.text)
    r.check('the key holds the request (the dashboard\'s key)', s.keys?.discount === 'fixture-request', s.keys)
    await page.screenshot({ path: path.join(OUT, 'discount-map.png') })
    await dismiss(page, 'row 4')
    await page.reload({ waitUntil: 'domcontentloaded' })
    await waitFor(page, () => window.__worldReady === true, { timeout: READY_MS, poll: 400, what: 'row 4: the map did not come back after the reload' })
    await sleep(2000)
    s = await snap(page)
    r.check('after a reload: no celebration', s.discount === null, s.discount)
    await page.close()
    const ctx2 = await browser.createBrowserContext()
    try {
      page = await openPage(ctx2, r.row, url({ discount: 'approved', celebrate: '1' }), { before: [[DISCOUNT_KEY, 'fixture-request']] })
      await sleep(2000)
      s = await snap(page)
      r.check('a browser that celebrated it on the dashboard: nothing', s.discount === null, s.discount)
    } finally {
      await ctx2.close().catch(() => {})
    }
  })

  await runRow(5, 'both at once: the streak first, the discount once the streak is closed', async (r) => {
    const page = await r.open({ hud: 'some', discount: 'approved', celebrate: '1' })
    await waitFor(page, streakUp, { timeout: 4000, what: 'row 5: no streak celebration' })
    let s = await snap(page)
    r.check('the streak alone first', s.streak !== null && s.discount === null, { streak: !!s.streak, discount: !!s.discount })
    await page.mouse.click(400, 400)
    await waitFor(page, discountUp, { timeout: 4000, what: 'row 5: the discount did not follow' })
    s = await snap(page)
    r.check('then the discount', s.streak === null && s.discount !== null, { streak: !!s.streak, discount: !!s.discount })
  })

  await runRow(6, 'without ?celebrate=1 (no signed-in student): neither fires, nothing written', async (r) => {
    const page = await r.open({ hud: 'some', discount: 'approved' })
    await sleep(2500)
    const s = await snap(page)
    r.check('no celebration', s.streak === null && s.discount === null, s)
    r.check('nothing written', s.keys?.streak === null && s.keys?.discount === null, s.keys)
  })

  await runRow(7, "the dashboard's test events fire them and record nothing", async (r) => {
    const page = await r.open({})
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('et:test:streak', { detail: 12 })))
    await waitFor(page, streakUp, { timeout: 3000, what: 'row 7: et:test:streak did nothing' })
    let s = await snap(page)
    r.check('et:test:streak 12: "12 days in a row."', s.streak?.label === '12 day streak', s.streak?.label)
    await dismiss(page, 'row 7')
    await page.evaluate(() => window.dispatchEvent(new Event('et:test:discount-approved')))
    await waitFor(page, discountUp, { timeout: 3000, what: 'row 7: et:test:discount-approved did nothing' })
    await dismiss(page, 'row 7 (discount)')
    s = await snap(page)
    r.check('nothing recorded by either', s.keys?.streak === null && s.keys?.discount === null, s.keys)
  })

  await runRow(8, 'on a lesson page: a streak that goes up there celebrates over the lesson page', async (r) => {
    const page = await r.open({ hud: 'some', celebrate: '1' }, { sub: '/a1/a1l01' })
    // The 4 this browser has never seen comes first; then the video "finishes".
    await waitFor(page, streakUp, { timeout: 4000, what: 'row 8: no first celebration' })
    await dismiss(page, 'row 8')
    await page.evaluate(() => window.__fixture.setStreak(5))
    await waitFor(page, streakUp, { timeout: 4000, what: 'row 8: no celebration for 5 on the lesson page' })
    await sleep(1600)
    const s = await snap(page)
    r.check('over the lesson page (still at its address), "5 days in a row."', /\/a1\/a1l01$/.test(s.path) && s.streak?.label === '5 day streak', { path: s.path, streak: s.streak?.label })
    const onTop = await page.evaluate(() => {
      const el = document.elementFromPoint(innerWidth / 2, innerHeight / 2)
      return !!el?.closest('[role="dialog"][aria-label$="day streak"]')
    })
    r.check('it is on top of the lesson page', onTop, onTop)
    await page.screenshot({ path: path.join(OUT, 'streak-lesson.png') })
  })

  await runRow(9, 'phone (390x844): the streak celebration fits the screen', async (r) => {
    const page = await r.open({ hud: 'long', celebrate: '1' }, { viewport: PHONE })
    await waitFor(page, streakUp, { timeout: 4000, what: 'row 9: no streak celebration' })
    await sleep(1600)
    const s = await snap(page)
    r.check('"128 days in a row.", the whole screen', s.streak?.label === '128 day streak' && s.streak.box.w === PHONE.width && s.streak.box.h === PHONE.height, s.streak)
    r.check('nothing runs off the screen sideways', (await page.evaluate(() => document.documentElement.scrollWidth)) <= PHONE.width)
    await page.screenshot({ path: path.join(OUT, 'streak-phone.png') })
  })
} finally {
  await browser.close()
}

const failed = results.filter((x) => !x.pass).length
console.log(`\nMEASURED  pages ${tally.pages} · requests to /api ${tally.api.length}${tally.api.length ? ` ${show(tally.api.slice(0, 4))}` : ''} · requests to Supabase ${tally.supabase.length}${tally.supabase.length ? ` ${show(tally.supabase.slice(0, 4))}` : ''} · page errors ${tally.pageErrors.length}${tally.pageErrors.length ? ` ${show(tally.pageErrors.slice(0, 2))}` : ''}`)
const measuredOk = tally.api.length === 0 && tally.supabase.length === 0 && tally.pageErrors.length === 0
console.log(`PASS ${results.length - failed}  FAIL ${failed}${measuredOk ? '' : '  (MEASURED fails)'}`)
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ results, tally }, null, 1))
process.exit(failed || !measuredOk ? 1 : 0)
