/**
 * The discount checkpoint on the map (2026-10-14), walked in a real browser.
 *
 *   node world-tests/v6-discount.mjs [--only 1,3]
 *
 * Runs against http://localhost:3111/dev/world-app?catalog=course, which must
 * already be up (this script never starts a server). The harness of
 * v6-course.mjs: the real stage, map, place route and lesson page, a pretend
 * student, no login, no server call. The student's discount comes from
 * ?discount=<preset> (src/app/dev/world-app/fixtureDiscount.tsx): the
 * offer's states in memory, Apply resolving in memory. Headless Chrome on the
 * real GPU, 1691x1278. About 3 minutes.
 *
 * One PASS or FAIL line per row, with what was measured. Every row loads its
 * own page in its own browser context. After the rows, one MEASURED line:
 * requests to /api and page errors over every page the run opened (both must
 * be 0). Exit code 1 on any FAIL.
 *
 *   1  locked: the header's chip says 30% off and the days left (11: the
 *      preset's first payment is 3 days old), the course bar has its notch,
 *      the timeline has its tag between the 4th and 5th places' diamonds
 *   2  the checkpoint in the world: from the rail point that frames it the
 *      cache's marker is up as a plaque ("30% off", the days), on screen; the
 *      cache is closed (no video watched, not at Video Ads II)
 *   3  the marker opens the panel (a real mouse click on the plaque): the
 *      camera parks at the cache, the panel says the deadline, the videos
 *      watched and left, and offers the next one with Watch
 *   4  Esc comes home: the panel goes, the camera is back on the rail where it
 *      was, the page scrolls again
 *   5  the timeline's tag opens the panel (and names the offer on hover)
 *   6  the header's chip opens the panel from the opening frame, far from the
 *      cache: the scroll jumps to the rail point that frames it, the camera
 *      parks; Esc leaves it on the trail in front of the cache
 *   7  Watch in the panel opens the next video's lesson page
 *   8  ready: the chip says to apply, the cache is ready, Apply sends (in
 *      memory), the panel turns to "in review", the chip too, the cache is
 *      claimed
 *   9  pending and approved say so; a student in Video Ads II (locked, ?p=mid)
 *      sees the cache's lantern lit (near)
 *  10  closed for the student: expired, before the new course, and no first
 *      payment on record show no chip, no tag and no marker
 *
 * Pictures for a person, in world-tests/shots/v6/discount/ (git-ignored):
 *   world-passing.png     the cache from the passing camera (row 2)
 *   marker-label.png      the marker's plaque, cropped (row 2)
 *   panel-locked.png      the panel, locked, parked at the cache (row 3)
 *   timeline-tag.png      the timeline round the tag, its tip up (row 5)
 *   header-chip.png       the header's right end: the chip and the course bar (row 1)
 *   panel-ready.png       the panel, ready, before Apply (row 8)
 *   panel-pending.png     the panel after Apply (row 8)
 *   world-ready.png       the cache ready, from the passing camera (row 8)
 *
 * What a row reads:
 *   hooks      window.__worldReady, __worldFrame, __worldScrollFor(depth),
 *              __worldCheckpoint() (shown, look, open, mode, marker, panel,
 *              depth: the rail depth that frames the cache), __worldPark,
 *              window.__fixtureDiscount.requests()
 *   the chip   main header button[aria-label*="discount checkpoint"]
 *   the notch  main header [data-cp]
 *   the tag    main nav[aria-label="Places"] button[data-cp]; the places'
 *              diamonds: nav[aria-label="Places"] > div > button:not([data-cp])
 *   the marker main button[data-mode][data-cp], its plaque = last child
 *   the panel  main section[aria-labelledby="cp-panel-title"], #cp-panel-title
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ORIGIN = process.env.BASE_URL || 'http://localhost:3111'
const APP = '/dev/world-app'
const OUT = path.join(HERE, 'shots', 'v6', 'discount')
fs.mkdirSync(OUT, { recursive: true })

const argv = process.argv.slice(2)
const onlyArg = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null
const ONLY = onlyArg ? new Set(onlyArg.split(',').map((x) => x.trim())) : null

const DESKTOP = { width: 1691, height: 1278 }
const READY_MS = 120000
const PARK_MS = 30000
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const show = (v) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s === undefined ? 'undefined' : s.length > 360 ? `${s.slice(0, 360)}…` : s
}
const url = (params = {}, sub = '') => `${APP}${sub}?${new URLSearchParams({ catalog: 'course', arrive: '0', poster: 'off', ...params }).toString()}`

const tally = { pages: 0, api: [], pageErrors: [] }
const results = []

// ── In the page ─────────────────────────────────────────────────────────────

const FIND = {
  chip: () => document.querySelector('main header button[aria-label*="discount checkpoint"]'),
  notch: () => document.querySelector('main header [data-cp]'),
  tag: () => document.querySelector('main nav[aria-label="Places"] button[data-cp]'),
  marker: () => document.querySelector('main button[data-mode][data-cp]'),
  panel: () => document.querySelector('main section[aria-labelledby="cp-panel-title"]'),
  apply: () => [...(document.querySelector('main section[aria-labelledby="cp-panel-title"]')?.querySelectorAll('button') ?? [])].find((b) => /^(Apply for|Sending)/.test(b.textContent.trim())) ?? null,
  watch: () => document.querySelector('main section[aria-labelledby="cp-panel-title"] button[aria-label^="Watch "]'),
}

/** What the map shows of the discount right now. */
const SNAP = () => {
  const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim()
  const box = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) }
  }
  const chip = document.querySelector('main header button[aria-label*="discount checkpoint"]')
  const tag = document.querySelector('main nav[aria-label="Places"] button[data-cp]')
  const stops = [...document.querySelectorAll('main nav[aria-label="Places"] > div > button:not([data-cp])')]
  const marker = document.querySelector('main button[data-mode][data-cp]')
  const panel = document.querySelector('main section[aria-labelledby="cp-panel-title"]')
  const cp = window.__worldCheckpoint?.() ?? null
  const fr = window.__worldFrame ?? null
  return {
    path: location.pathname,
    y: Math.round(scrollY),
    locked: document.body.style.overflow === 'hidden',
    chip: chip ? { text: norm(chip.textContent), box: box(chip) } : null,
    notch: document.querySelector('main header [data-cp]')?.getAttribute('data-cp') ?? null,
    tag: tag ? { state: tag.dataset.cp, box: box(tag), label: tag.getAttribute('aria-label') } : null,
    stops: stops.map((b) => box(b)),
    marker: marker ? { mode: marker.dataset.mode, state: marker.dataset.cp, label: norm(marker.lastElementChild?.textContent), box: box(marker.lastElementChild) } : null,
    panel: panel ? { title: norm(panel.querySelector('#cp-panel-title')?.textContent), text: norm(panel.textContent), box: box(panel), opacity: Number(getComputedStyle(panel).opacity) } : null,
    cp,
    park: fr ? { id: fr.parkedId, p: fr.parkProgress, depth: fr.depth } : null,
    requests: window.__fixtureDiscount?.requests() ?? null,
  }
}

// ── Driving ─────────────────────────────────────────────────────────────────

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

async function openPage(ctx, row, urlPath) {
  const page = await ctx.newPage()
  tally.pages++
  page.setDefaultTimeout(90000)
  await page.setViewport({ ...DESKTOP, deviceScaleFactor: 1 })
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
    if (u.origin === ORIGIN && u.pathname.startsWith('/api')) {
      row.api.push(u.pathname)
      tally.api.push({ row: row.id, path: u.pathname })
    }
  })
  await page.goto(ORIGIN + urlPath, { waitUntil: 'domcontentloaded', timeout: READY_MS })
  await waitFor(page, () => window.__worldReady === true && !!window.__worldCheckpoint, { timeout: READY_MS, poll: 400, what: `${urlPath}: the map was not ready` })
  await sleep(900)
  return page
}

/** Put the camera on the rail at `depth` and wait until it rests there (the camera glides after the scroll). */
async function railTo(page, depth, what) {
  await page.evaluate((d) => window.scrollTo(0, Math.round(window.__worldScrollFor(d))), depth)
  let last = -1
  let still = 0
  const t0 = Date.now()
  for (;;) {
    const f = await page.evaluate(() => {
      const fr = window.__worldFrame
      return fr ? { d: fr.depth, p: fr.parkProgress, fl: fr.flight } : null
    })
    if (f && f.p === 0 && f.fl >= 0.999 && Math.abs(f.d - last) < 2e-6) {
      if (++still >= 3) break
    } else still = 0
    if (f) last = f.d
    if (Date.now() - t0 > 15000) throw new Error(`${what}: the camera did not settle at depth ${depth}`)
    await sleep(150)
  }
  // The labels are laid out once the scroll rests.
  await sleep(500)
}

async function parked(page, what) {
  await waitFor(page, () => window.__worldFrame?.parkedId === 'checkpoint' && window.__worldFrame.parkProgress >= 0.999 && !!document.querySelector('main section[aria-labelledby="cp-panel-title"]'), {
    timeout: PARK_MS,
    what: `${what}: the camera did not park at the cache with the panel open`,
  })
  await sleep(700)
}

async function home(page, what) {
  await waitFor(page, () => !document.querySelector('main section[aria-labelledby="cp-panel-title"]') && (window.__worldFrame?.parkProgress ?? 1) === 0 && document.body.style.overflow !== 'hidden', {
    timeout: PARK_MS,
    what: `${what}: the panel did not close and the camera did not come home`,
  })
  await sleep(300)
}

/** Click an element the way a person would when it is on top, else through the DOM. */
async function click(page, find, what) {
  const via = await page.evaluate((src) => {
    const el = new Function(`return (${src})()`)()
    if (!el) return null
    const r = el.getBoundingClientRect()
    const x = r.left + r.width / 2
    const y = r.top + r.height / 2
    const top = r.width > 0 ? document.elementFromPoint(x, y) : null
    if (top && (top === el || el.contains(top) || top.closest('button') === el.closest('button'))) return { mouse: true, x, y }
    el.click()
    return { mouse: false }
  }, find.toString())
  if (!via) throw new Error(`${what}: not on the page`)
  if (via.mouse) await page.mouse.click(via.x, via.y)
  return via.mouse ? 'mouse' : 'dom click'
}

async function crop(page, file, b, pad = 16) {
  if (!b) return
  const x = Math.max(0, b.l - pad)
  const y = Math.max(0, b.t - pad)
  await page.screenshot({ path: path.join(OUT, file), clip: { x, y, width: Math.min(DESKTOP.width - x, b.w + 2 * pad), height: Math.min(DESKTOP.height - y, b.h + 2 * pad) } })
}

// ── Rows ────────────────────────────────────────────────────────────────────

let browser = null

async function runRow(id, name, body) {
  if (ONLY && !ONLY.has(String(id))) return
  const row = { id, name, pass: true, checks: [], values: {}, api: [], pageErrors: [], error: null }
  const ctx = await browser.createBrowserContext()
  const r = {
    row,
    open: (params, sub) => openPage(ctx, row, url(params, sub)),
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
  await runRow(1, 'locked: the chip counts the days, the course bar has its notch, the timeline its tag between places 4 and 5', async (r) => {
    const page = await r.open({ discount: 'locked' })
    const s = await page.evaluate(SNAP)
    r.check('the chip says 30% off and 11 days left', s.chip && /30% off/i.test(s.chip.text) && /11 days left/i.test(s.chip.text), s.chip)
    r.check('the course bar has the notch at the gate (locked)', s.notch === 'locked', s.notch)
    const [a4, a5] = [s.stops[3], s.stops[4]]
    const mid = s.tag ? (s.tag.box.l + s.tag.box.r) / 2 : NaN
    r.check('the timeline has the tag, between the 4th and 5th diamonds', s.tag && a4 && a5 && mid > (a4.l + a4.r) / 2 + 8 && mid < (a5.l + a5.r) / 2 - 8, { tag: s.tag, a4, a5 })
    r.check('the tag is no ninth diamond: the places still have 8', s.stops.length === 8, s.stops.length)
    r.check('the cache is closed (no video watched yet, far from Video Ads II)', s.cp?.shown === true && s.cp?.look === 'closed', s.cp)
    const head = await page.evaluate(() => {
      const a = document.querySelector('main header button[aria-label*="discount checkpoint"]').getBoundingClientRect()
      const b = document.querySelector('main header [aria-label^="Place "]').getBoundingClientRect()
      return { l: Math.round(Math.min(a.left, b.left)), t: Math.round(Math.min(a.top, b.top)), r: Math.round(Math.max(a.right, b.right)), b: Math.round(Math.max(a.bottom, b.bottom)) }
    })
    await crop(page, 'header-chip.png', { ...head, w: head.r - head.l, h: head.b - head.t }, 20)
  })

  await runRow(2, 'the checkpoint in the world: its marker is up from the rail point that frames the cache', async (r) => {
    const page = await r.open({ discount: 'locked' })
    const depth = await page.evaluate(() => window.__worldCheckpoint().depth)
    await railTo(page, depth, 'row 2')
    await waitFor(page, () => document.querySelector('main button[data-mode][data-cp]')?.dataset.mode === 'text', { timeout: 8000, what: 'row 2: the marker did not become a plaque' })
    const s = await page.evaluate(SNAP)
    r.row.values.depth = depth
    r.check('the marker is a plaque, on screen', s.marker?.mode === 'text' && s.cp?.marker?.visible && s.marker.box.l > 0 && s.marker.box.r < DESKTOP.width, s.marker)
    r.check('the plaque says 30% off and the days (11d)', /30% off/i.test(s.marker?.label ?? '') && /11d/i.test(s.marker?.label ?? ''), s.marker?.label)
    r.check('the camera passes on the rail (not parked)', s.park?.id === null, s.park)
    await page.screenshot({ path: path.join(OUT, 'world-passing.png') })
    await crop(page, 'marker-label.png', s.marker?.box ? { ...s.marker.box, b: s.marker.box.b + 60, h: s.marker.box.h + 60 } : null, 40)
  })

  await runRow(3, 'the marker opens the panel and parks the camera at the cache (a real click)', async (r) => {
    const page = await r.open({ discount: 'locked' })
    const depth = await page.evaluate(() => window.__worldCheckpoint().depth)
    await railTo(page, depth, 'row 3')
    await waitFor(page, () => document.querySelector('main button[data-mode][data-cp]')?.dataset.mode === 'text', { timeout: 8000, what: 'row 3: no plaque to click' })
    const via = await click(page, () => document.querySelector('main button[data-mode][data-cp]')?.lastElementChild, 'row 3: the plaque')
    await parked(page, 'row 3')
    const s = await page.evaluate(SNAP)
    r.row.values.via = via
    r.check('clicked with the mouse', via === 'mouse', via)
    r.check('the panel is up, titled 30% off your next month', s.panel?.title === '30% off your next month' && s.panel.opacity > 0.99, s.panel?.title)
    r.check('it says the deadline and the days left', /Apply by \w{3} \d{1,2} \w{3}/i.test(s.panel?.text ?? '') && /11 days left/i.test(s.panel?.text ?? ''), s.panel?.text)
    r.check('it counts the videos watched and to go (0 of N, N to go)', /0 of (\d+) videos/.test(s.panel?.text ?? '') && /(\d+) to go/.test(s.panel?.text ?? ''), s.panel?.text)
    r.check('it offers the next video with Watch', /Watch/.test(s.panel?.text ?? '') && (await page.evaluate(FIND.watch)) !== null, s.panel?.text)
    r.check('the page scroll is locked while parked', s.locked === true, s.locked)
    r.check('the cache is in the frame, right of the panel', s.cp?.marker?.visible && s.cp.marker.x > (s.panel?.box.r ?? 0), { marker: s.cp?.marker, panel: s.panel?.box })
    await page.screenshot({ path: path.join(OUT, 'panel-locked.png') })
  })

  await runRow(4, 'Esc comes home: the panel goes, the camera is back where it was, the page scrolls', async (r) => {
    const page = await r.open({ discount: 'locked' })
    const depth = await page.evaluate(() => window.__worldCheckpoint().depth)
    await railTo(page, depth, 'row 4')
    const before = await page.evaluate(() => ({ y: Math.round(scrollY), d: window.__worldFrame.depth }))
    await page.evaluate(() => window.__worldPark('checkpoint'))
    await parked(page, 'row 4')
    await page.keyboard.press('Escape')
    await home(page, 'row 4')
    const after = await page.evaluate(() => ({ y: Math.round(scrollY), d: window.__worldFrame.depth }))
    r.check('back on the same scroll position and depth', Math.abs(after.y - before.y) <= 1 && Math.abs(after.d - before.d) < 2e-4, { before, after })
    const focus = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName)
    r.check('focus lands on the checkpoint again (its tag or marker)', /discount checkpoint/i.test(focus ?? ''), focus)
  })

  await runRow(5, "the timeline's tag opens the panel, and names the offer on hover", async (r) => {
    const page = await r.open({ discount: 'locked' })
    const box = (await page.evaluate(SNAP)).tag?.box
    if (!box) throw new Error('row 5: no tag')
    await page.mouse.move((box.l + box.r) / 2, (box.t + box.b) / 2)
    await sleep(350)
    const tip = await page.evaluate(() => document.querySelector('main nav[aria-label="Places"] button[data-cp]')?.textContent ?? '')
    r.check('hovered, the tag says 30% off and the days left', /30% off/i.test(tip) && /11 days left/i.test(tip), tip)
    const nav = await page.evaluate(() => {
      const b = document.querySelector('main nav[aria-label="Places"]').getBoundingClientRect()
      return { l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) }
    })
    await crop(page, 'timeline-tag.png', { ...nav, t: nav.t - 40, h: nav.h + 40 }, 24)
    await page.mouse.click((box.l + box.r) / 2, (box.t + box.b) / 2)
    await parked(page, 'row 5')
    const s = await page.evaluate(SNAP)
    r.check('the panel is up, the camera parked at the cache', s.panel?.title === '30% off your next month' && s.park?.id === 'checkpoint', { panel: s.panel?.title, park: s.park })
  })

  await runRow(6, "the header's chip opens the panel from the opening frame, far from the cache", async (r) => {
    const page = await r.open({ discount: 'locked' })
    const s0 = await page.evaluate(SNAP)
    r.check('the page is at the opening frame', s0.y < 2, s0.y)
    const via = await click(page, FIND.chip, 'row 6: the chip')
    await parked(page, 'row 6')
    const s = await page.evaluate(SNAP)
    r.check('the panel is up and the camera parked at the cache', s.panel?.title === '30% off your next month' && s.park?.id === 'checkpoint', { via, park: s.park })
    r.check('the cache is in the frame', s.cp?.marker?.visible === true, s.cp?.marker)
    await page.keyboard.press('Escape')
    await home(page, 'row 6')
    await sleep(600)
    const back = await page.evaluate(() => ({ d: window.__worldFrame.depth, want: window.__worldCheckpoint().depth, marker: window.__worldCheckpoint().marker }))
    r.check('opened from far, Esc leaves the camera on the trail in front of the cache (its marker up)', Math.abs(back.d - back.want) < 2e-3 && back.marker?.visible === true, back)
  })

  await runRow(7, 'Watch in the panel opens the next video’s lesson page', async (r) => {
    const page = await r.open({ discount: 'locked' })
    await page.evaluate(() => window.__worldPark('checkpoint'))
    await parked(page, 'row 7')
    const label = await page.evaluate(() => document.querySelector('main section[aria-labelledby="cp-panel-title"] button[aria-label^="Watch "]')?.getAttribute('aria-label') ?? null)
    await click(page, FIND.watch, 'row 7: Watch')
    await waitFor(page, () => /^\/dev\/world-app\/a\d\/a\dl\d\d$/.test(location.pathname), { timeout: 40000, what: 'row 7: no lesson page' })
    const at = await page.evaluate(() => location.pathname)
    r.check('the next video is the first of the course (nothing watched): a1l01', at === `${APP}/a1/a1l01`, { at, label })
    await waitFor(page, () => [...document.querySelectorAll('h1')].some((h) => !h.closest('main')), { timeout: 40000, what: 'row 7: the lesson page has no heading' })
    r.check("the checkpoint's panel gave way", !(await page.evaluate(FIND.panel)), 'closed')
  })

  await runRow(8, 'ready: Apply sends, the panel and the chip turn to in review, the cache is claimed', async (r) => {
    const page = await r.open({ discount: 'ready' })
    let s = await page.evaluate(SNAP)
    r.check('the chip says to apply, with the days left (9)', /Apply/.test(s.chip?.text ?? '') && /9 days left/i.test(s.chip?.text ?? ''), s.chip)
    r.check('the cache is ready', s.cp?.look === 'ready', s.cp?.look)
    r.check('the tag and the marker are ready', s.tag?.state === 'ready' && s.marker?.state === 'ready', { tag: s.tag?.state, marker: s.marker?.state })
    const depth = s.cp.depth
    await railTo(page, depth, 'row 8')
    await page.screenshot({ path: path.join(OUT, 'world-ready.png') })
    await page.evaluate(() => window.__worldPark('checkpoint'))
    await parked(page, 'row 8')
    s = await page.evaluate(SNAP)
    r.check('the panel says every video is watched, and offers Apply', /Every video through Video Ads II is watched/.test(s.panel?.text ?? '') && (await page.evaluate(FIND.apply)) !== null, s.panel?.text)
    await page.screenshot({ path: path.join(OUT, 'panel-ready.png') })
    await click(page, FIND.apply, 'row 8: Apply')
    await waitFor(page, () => /Sending/.test(document.querySelector('main section[aria-labelledby="cp-panel-title"]')?.textContent ?? ''), { timeout: 3000, what: 'row 8: Apply did not show it is sending' })
    await waitFor(page, () => /Your application is in/.test(document.querySelector('main section[aria-labelledby="cp-panel-title"]')?.textContent ?? ''), { timeout: 8000, what: 'row 8: the panel did not turn to in review' })
    await sleep(500)
    s = await page.evaluate(SNAP)
    r.check('the panel says it is in review', /In review/.test(s.panel?.text ?? '') && /Your application is in/.test(s.panel?.text ?? ''), s.panel?.text)
    r.check('one application, pending, in memory', s.requests?.length === 1 && s.requests[0].status === 'pending', s.requests)
    r.check('the chip says in review', /In review/.test(s.chip?.text ?? ''), s.chip)
    r.check('the cache is claimed', s.cp?.look === 'claimed', s.cp?.look)
    await page.screenshot({ path: path.join(OUT, 'panel-pending.png') })
  })

  await runRow(9, 'pending and approved say so; a student in Video Ads II sees the lantern lit', async (r) => {
    for (const [preset, words] of [
      ['pending', /Your application is in/],
      ['approved', /Approved\. The team is putting it on your Whop subscription/],
    ]) {
      const page = await r.open({ discount: preset })
      let s = await page.evaluate(SNAP)
      r.check(`${preset}: the chip says ${preset === 'pending' ? 'In review' : 'Approved'}`, new RegExp(preset === 'pending' ? 'In review' : 'Approved').test(s.chip?.text ?? ''), s.chip)
      r.check(`${preset}: the cache is claimed`, s.cp?.look === 'claimed', s.cp?.look)
      await page.evaluate(() => window.__worldPark('checkpoint'))
      await parked(page, `row 9 (${preset})`)
      s = await page.evaluate(SNAP)
      r.check(`${preset}: the panel says so`, words.test(s.panel?.text ?? ''), s.panel?.text)
      await page.close()
    }
    const page = await r.open({ discount: 'locked', p: 'mid' })
    const s = await page.evaluate(SNAP)
    r.check('locked at Video Ads II (?p=mid): the lantern is lit (near)', s.cp?.look === 'near', s.cp)
  })

  await runRow(10, 'closed for the student: expired, before the new course, no first payment: no chip, tag or marker', async (r) => {
    for (const params of [{ discount: 'expired' }, { discount: 'before-launch' }, {}]) {
      const page = await r.open(params)
      const s = await page.evaluate(SNAP)
      const name = params.discount ?? 'no ?discount'
      r.check(`${name}: no chip, no notch, no tag`, s.chip === null && s.notch === null && s.tag === null, { chip: s.chip, notch: s.notch, tag: s.tag })
      r.check(`${name}: the checkpoint does not show and the cache stands closed`, s.cp?.shown === false && s.cp?.look === 'closed' && (s.marker === null || s.marker.mode === 'hidden'), s.cp)
      await page.close()
    }
  })
} finally {
  await browser.close()
}

const failed = results.filter((x) => !x.pass).length
console.log(`\nMEASURED  pages ${tally.pages} · requests to /api ${tally.api.length}${tally.api.length ? ` ${show(tally.api.slice(0, 4))}` : ''} · page errors ${tally.pageErrors.length}${tally.pageErrors.length ? ` ${show(tally.pageErrors.slice(0, 2))}` : ''}`)
const measuredOk = tally.api.length === 0 && tally.pageErrors.length === 0
console.log(`PASS ${results.length - failed}  FAIL ${failed}${measuredOk ? '' : '  (MEASURED fails)'}`)
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ results, tally }, null, 1))
process.exit(failed || !measuredOk ? 1 : 0)
