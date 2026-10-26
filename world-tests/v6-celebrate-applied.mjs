/**
 * The 30%'s full-screen moment for an application the team has already
 * applied (bug hunt 2026-10-19, streak-2), walked in a real browser.
 *
 *   node world-tests/v6-celebrate-applied.mjs [--only 1,3]
 *
 * Runs against http://localhost:3111/dev/world-app?catalog=course (BASE_URL
 * overrides), which must already be up: this script never starts a server.
 * The pretend student of FixtureStudentProvider.tsx, no login, no server
 * call; ?celebrate=1 lets the moments fire, ?discount=<preset> gives the
 * student an application (fixtureDiscount.tsx: approved and applied are the
 * request "fixture-request", made on the new course; october-old-course is
 * one made on the old dashboard before the launch, applied). Headless Chrome
 * on the real GPU.
 *
 * WHAT WAS WRONG. The map played the moment only while the application was
 * approved (WorldMap.tsx). The team presses Approve and Mark applied in one
 * sitting, so most students are next on the map once it is applied, and the
 * moment kept for an approved discount (Lovro, decision 11 B) never played.
 * Since the fix (celebrations.ts approvalOnMap) it plays for approved or
 * applied, once per request in the browser, with "Your 30% is on your next
 * payment." for an applied one.
 *
 * Since the 30% applies itself (T-137, R6, the owner's words of 2026-10-26) a
 * request usually comes back applied from Apply itself, the approved line is
 * "You'll see it on your map once it's on your Whop subscription.", and a
 * moment already due takes its line from the request as it is when it opens:
 * applied, "Your 30% is on your next payment." within 5 days of the
 * application and "The discount has been approved." after them. The
 * checkpoint's panel says "The discount has been approved." for an applied
 * request at any age.
 *
 * A recorder in every page from its first byte notes each dialog that opens:
 * its label, its words and the map's state then (its view, loading or not,
 * the loading screen's opacity, the tab).
 *
 *   1  applied, never celebrated here: the moment opens once, with the map
 *      up, says "Your 30% is on your next payment." (not the approved line),
 *      and the browser key is the request; a reload does not bring it back
 *   2  approved: the moment opens with the approved line, "You'll see it on
 *      your map once it's on your Whop subscription." (R6; "The team is
 *      putting it on your Whop subscription ..." until then), and the key is
 *      the request
 *   3  applied, already celebrated while approved (the key preset to the
 *      request): no moment in the 10 s after the map is ready
 *   4  applied on the old dashboard before the launch
 *      (?discount=october-old-course): no moment in 10 s, the key unset
 *   5  applied, on a phone upright (390x844) and held sideways (844x390):
 *      the moment over the list, with the applied line and the tap to close
 *   6  applied without ?celebrate=1 (no signed-in student): no moment,
 *      nothing written
 *   7  applied, with the student's clock past the renewal that used the 30%
 *      (?discount=applied-after-renewal: applied for on 15 October, the clock
 *      on 20 November) and no browser key, as on a second device: no moment
 *      in 10 s, nothing written (the 2026-10-20 review: an applied one plays
 *      only within 5 days of the application, celebrations.ts
 *      renewalStillAhead), and the checkpoint's panel says "The discount has
 *      been approved." (R6; "You got your 30%. The team put it on your Whop
 *      subscription." until then), with no "next renewal"
 *   8  sent from the map (?discount=ready&questions=none, the plain Apply):
 *      the stand-in answers the send with the request applied, as the
 *      request routes do once the app has put the 30% on; the moment opens
 *      once, with the map up, saying "Your 30% is on your next payment.",
 *      the key is the sent request, and the panel under it says "The
 *      discount has been approved." with no Apply
 *   9  a moment that fell due while the request was approved, behind a
 *      lesson page (the page opened on a1's first lesson), the request
 *      applied before it opens (window.__fixtureDiscount.setStatus, the app
 *      or the team meanwhile): back on the map it opens with the applied
 *      line, never the approved one. "Your 30% is on your next payment."
 *      within the 5 days (?discount=approved, applied for 2 hours ago); "The
 *      discount has been approved." after them (?discount=approved-6-days,
 *      applied for 6 days ago, which approvalOnMap no longer names once it
 *      is applied, so only the request itself can give the line)
 * After the rows, one MEASURED line: requests to /api, requests to Supabase
 * and page errors over every page the run opened (all three must be 0).
 * Exit code 1 on any FAIL. Pictures for a person, in
 * world-tests/shots/v6/celebrate-applied/ (git-ignored): applied-1440x900.png
 * (row 1), after-renewal-panel-1440x900.png (row 7), sent-applied-1440x900.png
 * (row 8), due-applied-6-days-1440x900.png (row 9).
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ORIGIN = process.env.BASE_URL || 'http://localhost:3111'
const APP = '/dev/world-app'
const OUT = path.join(HERE, 'shots', 'v6', 'celebrate-applied')
fs.mkdirSync(OUT, { recursive: true })

const argv = process.argv.slice(2)
const onlyArg = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null
const ONLY = onlyArg ? new Set(onlyArg.split(',').map((x) => x.trim())) : null

const DESKTOP = { width: 1440, height: 900 }
const READY_MS = 120000
const DISCOUNT_KEY = 'et.discountApproved.lastSeen'
const REQUEST = 'fixture-request'
const APPLIED_LINE = 'Your 30% is on your next payment.'
/**
 * "The discount has been approved." (R6): the moment's applied line once the renewal may have used the 30%, and the
 * checkpoint panel's applied line at any age (WorldV6.tsx; "You got your 30%. The team put it on your Whop
 * subscription." from day 5 until the 30% applied itself, the 2026-10-20 review).
 */
const PAST_LINE = 'The discount has been approved.'
/** The moment's approved line (R6), its apostrophes as the moment writes them (&rsquo;). */
const APPROVED_LINE = 'You’ll see it on your map once it’s on your Whop subscription.'
const LABEL = '30% discount approved'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const show = (v) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s === undefined ? 'undefined' : s.length > 400 ? `${s.slice(0, 400)}…` : s
}
/** `sub`: a place or a lesson under the page, "/a1/a1l01" (row 9). */
const url = (params = {}, sub = '') => `${APP}${sub}?${new URLSearchParams({ catalog: 'course', arrive: '0', poster: 'off', ...params }).toString()}`

const tally = { pages: 0, api: [], supabase: [], pageErrors: [] }
const results = []

/** Each dialog that opens, from the page's first byte: its label, its words, the map's state then. */
const RECORD = () => {
  const log = (window.__dialogs = [])
  const mapAt = () => {
    const main = document.querySelector('main[data-view]')
    const loader = main ? [...main.children].find((el) => el.getAttribute('role') === 'status') : null
    return { view: main?.getAttribute('data-view') ?? null, loading: !!main?.hasAttribute('data-loading'), loader: loader ? Number(getComputedStyle(loader).opacity) : null, tab: document.visibilityState }
  }
  const all = (node, sel) => (node instanceof Element ? [...(node.matches(sel) ? [node] : []), ...node.querySelectorAll(sel)] : [])
  new MutationObserver((muts) => {
    for (const m of muts) {
      for (const node of m.addedNodes) {
        for (const d of all(node, '[role="dialog"][aria-label]')) {
          log.push({ t: Math.round(performance.now()), label: d.getAttribute('aria-label'), map: mapAt(), d })
        }
      }
    }
  }).observe(document, { subtree: true, childList: true })
}
/** The record, with each dialog's words read now (its lines fade in after it opens). */
const DIALOGS = () => (window.__dialogs ?? []).map((e) => ({ t: e.t, label: e.label, map: e.map, text: (e.d.textContent ?? '').replace(/\s+/g, ' ').trim(), open: e.d.isConnected }))
const KEY = (k) => {
  try {
    return localStorage.getItem(k)
  } catch {
    return 'storage off'
  }
}
const mapWasUp = (e) => !!e?.map && e.map.view !== null && e.map.view !== 'unknown' && e.map.loading === false && (e.map.loader === null || e.map.loader < 0.05) && e.map.tab === 'visible'

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

async function openPage(ctx, row, urlPath, { viewport = DESKTOP, touch = false, before = null } = {}) {
  const page = await ctx.newPage()
  tally.pages++
  page.setDefaultTimeout(90000)
  await page.setViewport({ ...viewport, deviceScaleFactor: 1, isMobile: touch, hasTouch: touch })
  await page.evaluateOnNewDocument(RECORD)
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
  // What the browser holds before the page loads: once per tab, so a reload finds what the page left.
  if (before) await page.evaluateOnNewDocument((entries) => {
    try {
      if (sessionStorage.getItem('__seeded') === '1') return
      for (const [k, v] of entries) localStorage.setItem(k, v)
      sessionStorage.setItem('__seeded', '1')
    } catch {
      // Storage off: nothing to seed.
    }
  }, before)
  await page.goto(ORIGIN + urlPath, { waitUntil: 'domcontentloaded', timeout: READY_MS })
  // A lesson's address (row 9): its page is up, its heading outside the map's <main>, the map building under it.
  const lesson = /\/a\d\/a\dl\d\d\?/.test(urlPath)
  await waitFor(page, lesson
    ? () => [...document.querySelectorAll('h1')].some((h) => !h.closest('main'))
    : () => window.__worldReady === true || document.querySelector('main[data-view="list"]') !== null, { timeout: READY_MS, poll: 300, what: `${urlPath}: the page was not ready` })
  return page
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

/** The moment opened: wait for it, then for its lines (they fade in over 0.7 s) to be in the page. */
async function moment(page, what) {
  await waitFor(page, (label) => !!document.querySelector(`[role="dialog"][aria-label="${label}"]`), { arg: LABEL, timeout: 15000, what: `${what}: the moment did not open` })
  await sleep(900)
  return (await page.evaluate(DIALOGS)).filter((d) => d.label === LABEL)
}

/** No moment in the 10 s after the map is ready (the celebration waits for the map, then opens at once). */
async function none(page) {
  await sleep(10000)
  return (await page.evaluate(DIALOGS)).filter((d) => d.label === LABEL)
}

browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--no-sandbox', '--hide-scrollbars'],
  protocolTimeout: 180000,
})

try {
  await runRow(1, 'applied, never celebrated here: the moment once, with the map up, the applied line, the key the request; not after a reload', async (r) => {
    const page = await r.open({ discount: 'applied', celebrate: '1' })
    const ds = await moment(page, 'row 1')
    r.check('one moment, opened with the map up', ds.length === 1 && mapWasUp(ds[0]), ds.map((d) => ({ map: d.map })))
    r.check(`its line: "${APPLIED_LINE}", not the approved one`, ds[0]?.text.includes(APPLIED_LINE) && !ds[0].text.includes(APPROVED_LINE), ds[0]?.text)
    await page.screenshot({ path: path.join(OUT, 'applied-1440x900.png'), captureBeyondViewport: false })
    r.check('the browser key is the request', (await page.evaluate(KEY, DISCOUNT_KEY)) === REQUEST, await page.evaluate(KEY, DISCOUNT_KEY))
    await page.reload({ waitUntil: 'domcontentloaded' })
    await waitFor(page, () => window.__worldReady === true, { timeout: READY_MS, poll: 300, what: 'row 1: not ready after the reload' })
    const again = await none(page)
    r.check('after a reload: no moment', again.length === 0, again.map((d) => d.text.slice(0, 80)))
  })

  await runRow(2, 'approved: the moment with the approved line (R6), the key the request', async (r) => {
    const page = await r.open({ discount: 'approved', celebrate: '1' })
    const ds = await moment(page, 'row 2')
    r.check('one moment, opened with the map up', ds.length === 1 && mapWasUp(ds[0]), ds.map((d) => ({ map: d.map })))
    r.check(`its line: "${APPROVED_LINE}", not an applied one`, ds[0]?.text.includes(APPROVED_LINE) && !ds[0].text.includes(APPLIED_LINE) && !ds[0].text.includes(PAST_LINE), ds[0]?.text)
    r.check('the browser key is the request', (await page.evaluate(KEY, DISCOUNT_KEY)) === REQUEST, await page.evaluate(KEY, DISCOUNT_KEY))
  })

  await runRow(3, 'applied, already celebrated while approved: no moment', async (r) => {
    const page = await r.open({ discount: 'applied', celebrate: '1' }, { before: [[DISCOUNT_KEY, REQUEST]] })
    const ds = await none(page)
    r.check('no moment in the 10 s after the map is ready', ds.length === 0, ds.map((d) => d.text.slice(0, 80)))
    r.check('the key is still the request', (await page.evaluate(KEY, DISCOUNT_KEY)) === REQUEST, await page.evaluate(KEY, DISCOUNT_KEY))
  })

  await runRow(4, 'applied on the old dashboard before the launch: no moment, nothing written', async (r) => {
    const page = await r.open({ discount: 'october-old-course', celebrate: '1' })
    const ds = await none(page)
    r.check('no moment in the 10 s after the map is ready', ds.length === 0, ds.map((d) => d.text.slice(0, 80)))
    r.check('the key unset', (await page.evaluate(KEY, DISCOUNT_KEY)) === null, await page.evaluate(KEY, DISCOUNT_KEY))
  })

  await runRow(5, 'applied on a phone, upright and held sideways: the moment over the list, the applied line, tap to close', async (r) => {
    for (const vp of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
      const at = `${vp.width}x${vp.height}`
      const page = await r.open({ discount: 'applied', celebrate: '1' }, { viewport: vp, touch: true })
      const ds = await moment(page, `row 5, ${at}`)
      r.check(`${at}: one moment over the list, with the applied line and "Tap anywhere to close"`, ds.length === 1 && ds[0].map.view === 'list' && ds[0].text.includes(APPLIED_LINE) && ds[0].text.includes('Tap anywhere to close'), ds.map((d) => ({ view: d.map.view, text: d.text })))
      // The next size's page shares this browser's storage: forget the request, as a new phone would not know it.
      await page.evaluate((k) => localStorage.removeItem(k), DISCOUNT_KEY)
      await page.close()
    }
  })

  await runRow(6, 'applied without ?celebrate=1 (no signed-in student): no moment, nothing written', async (r) => {
    const page = await r.open({ discount: 'applied' })
    const ds = await none(page)
    r.check('no moment', ds.length === 0, ds.map((d) => d.text.slice(0, 80)))
    r.check('the key unset', (await page.evaluate(KEY, DISCOUNT_KEY)) === null, await page.evaluate(KEY, DISCOUNT_KEY))
  })

  await runRow(7, 'applied, the clock past the renewal that used the 30% (?discount=applied-after-renewal): no moment, nothing written; the panel says "The discount has been approved.", no "next renewal"', async (r) => {
    // A browser with no key, as a second device or a wiped one: only the time limit can keep the moment away.
    const page = await r.open({ discount: 'applied-after-renewal', celebrate: '1' })
    const ds = await none(page)
    r.check('no moment in the 10 s after the map is ready', ds.length === 0, ds.map((d) => d.text.slice(0, 80)))
    r.check('the key unset', (await page.evaluate(KEY, DISCOUNT_KEY)) === null, await page.evaluate(KEY, DISCOUNT_KEY))
    await page.evaluate(() => window.__worldPark('checkpoint'))
    const text = await waitFor(page, () => {
      const p = document.querySelector('main section[aria-labelledby="cp-panel-title"]')
      return window.__worldFrame?.parkProgress >= 0.999 && p && Number(getComputedStyle(p).opacity) > 0.99 ? p.textContent.replace(/\s+/g, ' ').trim() : null
    }, { timeout: 30000, what: 'row 7: the checkpoint\'s panel did not open' })
    r.check(`the panel: "${PAST_LINE}", no "next renewal"`, text.includes(PAST_LINE) && !/next renewal/.test(text), text)
    await page.screenshot({ path: path.join(OUT, 'after-renewal-panel-1440x900.png'), captureBeyondViewport: false })
  })

  await runRow(8, 'sent from the map (?discount=ready, no questions): the request comes back applied; the moment once with the applied line, the key the sent request; the panel under it says "The discount has been approved."', async (r) => {
    const page = await r.open({ discount: 'ready', questions: 'none', celebrate: '1' })
    await page.evaluate(() => window.__worldPark('checkpoint'))
    await waitFor(page, () => window.__worldFrame?.parkProgress >= 0.999 && !!document.querySelector('main section[aria-labelledby="cp-panel-title"]'), { timeout: 30000, what: 'row 8: the checkpoint\'s panel did not open' })
    const before = (await page.evaluate(DIALOGS)).filter((d) => d.label === LABEL)
    r.check('ready, nothing applied for yet: no moment', before.length === 0, before.map((d) => d.text.slice(0, 80)))
    // The plain Apply (no questions): the stand-in answers it after 600 ms with the request applied, as the routes now do.
    const pressed = await page.evaluate(() => {
      const b = [...(document.querySelector('main section[aria-labelledby="cp-panel-title"]')?.querySelectorAll('button') ?? [])].find((x) => /^Apply for/.test(x.textContent.trim()))
      b?.click()
      return !!b
    })
    r.check('Apply was there and pressed', pressed)
    const ds = await moment(page, 'row 8')
    r.check('one moment, opened with the map up', ds.length === 1 && mapWasUp(ds[0]), ds.map((d) => ({ map: d.map })))
    r.check(`its line: "${APPLIED_LINE}", not the approved one`, ds[0]?.text.includes(APPLIED_LINE) && !ds[0].text.includes(APPROVED_LINE) && !ds[0].text.includes(PAST_LINE), ds[0]?.text)
    const sent = await page.evaluate(() => ({ requests: window.__fixtureDiscount.requests(), plain: window.__fixtureDiscount.plain() }))
    r.check('one request, sent from the map as the plain request, applied', sent.plain === 1 && sent.requests.length === 1 && sent.requests[0].id === 'fixture-sent' && sent.requests[0].status === 'applied', sent)
    const panel = await page.evaluate(() => document.querySelector('main section[aria-labelledby="cp-panel-title"]')?.textContent.replace(/\s+/g, ' ').trim() ?? null)
    r.check(`the panel under it: "${PAST_LINE}", no Apply, no code`, (panel ?? '').includes(PAST_LINE) && !/Apply for|\bcode\b|ECOM30/i.test(panel ?? ''), panel)
    await page.screenshot({ path: path.join(OUT, 'sent-applied-1440x900.png'), captureBeyondViewport: false })
    r.check('the browser key is the sent request', (await page.evaluate(KEY, DISCOUNT_KEY)) === 'fixture-sent', await page.evaluate(KEY, DISCOUNT_KEY))
  })

  await runRow(9, 'a moment due while approved, behind a lesson page, applied before it opens: back on the map the applied line by the request\'s age, never the approved one', async (r) => {
    for (const [preset, line, notLine] of [
      ['approved', APPLIED_LINE, PAST_LINE],
      ['approved-6-days', PAST_LINE, APPLIED_LINE],
    ]) {
      const page = await r.open({ discount: preset, celebrate: '1' }, { sub: '/a1/a1l01' })
      // The map builds under the lesson page meanwhile, and the moment falls due for the request, approved.
      await sleep(2500)
      let ds = (await page.evaluate(DIALOGS)).filter((d) => d.label === LABEL)
      let fx = await page.evaluate(() => ({ preset: window.__fixtureDiscount?.preset ?? null, requests: window.__fixtureDiscount?.requests() ?? [] }))
      r.check(`${preset}: on the lesson page, the request approved: no moment over it, the key unset`, ds.length === 0 && fx.preset === preset && fx.requests.length === 1 && fx.requests[0].status === 'approved' && (await page.evaluate(KEY, DISCOUNT_KEY)) === null, { ds: ds.length, fx })
      // The app or the team puts the 30% on meanwhile.
      await page.evaluate(() => window.__fixtureDiscount.setStatus('applied'))
      await sleep(800)
      ds = (await page.evaluate(DIALOGS)).filter((d) => d.label === LABEL)
      fx = await page.evaluate(() => window.__fixtureDiscount.requests())
      r.check(`${preset}: applied now, still on the lesson page: no moment over it`, ds.length === 0 && fx.length === 1 && fx[0].status === 'applied' && /\/a1\/a1l01$/.test(await page.evaluate(() => location.pathname)), { ds: ds.length, fx })
      // No picture of the lesson page: the dev test video's first frame has people's names in it.
      await page.keyboard.press('Escape')
      await waitFor(page, () => location.pathname === '/dev/world-app/a1', { timeout: 10000, what: `row 9 (${preset}): Esc did not go back to the place` })
      ds = await moment(page, `row 9 (${preset})`)
      r.check(`${preset}: back on the map, one moment, opened with the map up`, ds.length === 1 && mapWasUp(ds[0]), ds.map((d) => ({ map: d.map })))
      r.check(`${preset}: its line "${line}", not "${notLine}", never the approved one`, ds[0]?.text.includes(line) && !ds[0].text.includes(notLine) && !ds[0].text.includes(APPROVED_LINE), ds[0]?.text)
      r.check(`${preset}: the key is the request`, (await page.evaluate(KEY, DISCOUNT_KEY)) === REQUEST, await page.evaluate(KEY, DISCOUNT_KEY))
      if (preset === 'approved-6-days') await page.screenshot({ path: path.join(OUT, 'due-applied-6-days-1440x900.png'), captureBeyondViewport: false })
      // The next preset's page shares this browser's storage: forget the request, as row 5 does.
      await page.evaluate((k) => localStorage.removeItem(k), DISCOUNT_KEY)
      await page.close()
    }
  })
} finally {
  await browser.close()
}

console.log(`MEASURED  pages ${tally.pages}, requests to /api ${tally.api.length}, to Supabase ${tally.supabase.length}, page errors ${tally.pageErrors.length}`)
if (tally.api.length || tally.supabase.length || tally.pageErrors.length) {
  console.log(`        ${show({ api: tally.api.slice(0, 3), supabase: tally.supabase.slice(0, 3), errors: tally.pageErrors.slice(0, 3) })}`)
  process.exitCode = 1
}
const failed = results.filter((x) => !x.pass)
console.log(`\n${results.length - failed.length} of ${results.length} rows PASS`)
if (failed.length) process.exitCode = 1
