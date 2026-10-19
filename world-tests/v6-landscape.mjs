/**
 * A phone held sideways (bug hunt 2026-10-19, findings phones-1 and map-2):
 * walked in a real browser.
 *
 *   node world-tests/v6-landscape.mjs [--only 1,3]       the rows below
 *   node world-tests/v6-landscape.mjs --desk <label>       the desktop pictures
 *   node world-tests/v6-landscape.mjs --diff <a> <b>       two sets of them, pixel by pixel
 *
 * Runs against http://localhost:3111/dev/world-app?catalog=course (BASE_URL
 * overrides), which must already be up: this script never starts a server.
 * The pretend student of FixtureStudentProvider.tsx, no login, no server
 * call. Headless Chrome on the real GPU; a phone is emulated with touch and
 * a mobile viewport (isMobile, hasTouch).
 *
 * WHAT WAS WRONG. The map chose its phone list by width alone (WorldV6.tsx
 * NARROW_QUERY was "(width < 760px)"). A phone held sideways is 780 to 932 px
 * wide and 304 to 430 px tall, so it got the computer's 3D layout, which was
 * only ever measured from 700 px tall: the welcome's Continue sat where the
 * opening's pins and plaques are drawn (a tap on it opened Marketing
 * Fundamentals), the timeline covered the card's Watch at 780x304, a place's
 * panel was 163 px tall with no lesson above its fold, and turning the phone
 * with a lesson open built the whole 3D world behind the lesson. Since the fix
 * a screen under 760 px wide or under 500 px tall gets the list (the phone's
 * own layout, with no three.js). Where the 3D still draws, no pin or plaque
 * reaches Continue: measured before the fix from 760x500 to 3440x620 at three
 * progress presets, and from 844x460 tall the overlap was already gone. Row 5
 * keeps that true, with the welcome's title on one line and on two (a long
 * first name pushes Continue down by a line).
 *
 * The rows (one PASS or FAIL line each, with what was measured):
 *   1  844x390, 852x393 and 844x340, touch: the list, with no canvas and no
 *      3D scene; the welcome's two lines head it with no Continue, no
 *      timeline and no scroll cue; the Next block's Watch, scrolled to, is
 *      the top of the page at its centre, and a tap on it opens the lesson's
 *      page
 *   2  the same sizes: a tap on a place's row (Video Ads I) opens its sheet
 *      over the list, and its first lesson row is on the screen with no
 *      scrolling; the sheet scrolls to its last row
 *   3  the same sizes: a place's address (/dev/world-app/a3) opens its sheet
 *      at load, its first lesson row on the screen (finding phones-1 step 5)
 *   4  a lesson page open at 390x844, the phone turned to 844x390 and back:
 *      the list throughout, no canvas, no 3D scene built behind the lesson,
 *      and the lesson's page still up (finding map-2, the rotation)
 *   5  the 3D just above the line (760x500, 1024x500), a tablet upright
 *      (768x1024) and computers (1440x900, 1691x1278, 3428x1230), touch on
 *      the first three: the welcome's Continue is the top of the page at all
 *      33 points of a 3x11 grid over it, and no pin or plaque that takes a
 *      tap lies under any of them, with the title on one line and with a
 *      long first name on two; a tap at its centre makes the trip (the
 *      address stays the map's, the camera comes to rest at the student's
 *      place and the card shows there, no panel opens)
 * After the rows, one MEASURED line: requests to /api, requests to Supabase
 * and page errors over every page the run opened (all three must be 0).
 * Exit code 1 on any FAIL. Pictures for a person, of the list sideways and
 * of a place's sheet over it, go to world-tests/shots/v6/landscape/rows/
 * (git-ignored): list-<size>.png (row 1) and sheet-<size>.png (row 2).
 *
 * THE DESKTOP PICTURES (--desk <label>): the fix must not change the map on
 * a computer. At 1440x900 and 1691x1278 it takes the same four views every
 * run, each in its own page and context, the quality tier pinned to 0 and the
 * clocks frozen (the way v6-review-shots.mjs does it: the frame loop stopped,
 * the scene clock and the life clock set, two frames drawn by hand, the CSS
 * animations run to their end): the opening with the welcome (top), resting
 * at the student's place with the card (card), Video Ads I clicked in with
 * its panel (panel), and the opening as still views (?poster=on, posters).
 * Pictures go to world-tests/shots/v6/landscape/<label>/ (git-ignored).
 * --diff <a> <b> compares two labels in the browser (a canvas, no library):
 * per picture the pixels that differ at all and the largest channel
 * difference, then IDENTICAL or DIFFERENT; exit 1 on any difference.
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ORIGIN = process.env.BASE_URL || 'http://localhost:3111'
const APP = '/dev/world-app'
const ROOT = path.join(HERE, 'shots', 'v6', 'landscape')

const argv = process.argv.slice(2)
const flag = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] ?? null : null)
const onlyArg = flag('--only')
const ONLY = onlyArg ? new Set(onlyArg.split(',').map((x) => x.trim())) : null

/** Phones held sideways: an iPhone 15 with Safari's bars hidden and shown (852x393, 852x343 is the bug hunt's), a 6.1" Android, and 844x340. */
const SIDEWAYS = [
  { width: 844, height: 390 },
  { width: 852, height: 393 },
  { width: 844, height: 340 },
]
const PORTRAIT = { width: 390, height: 844 }
const DESKS = [
  { width: 1440, height: 900 },
  { width: 1691, height: 1278 },
]
/** The frozen clocks, in seconds (v6-review-shots.mjs). */
const SCENE_T = 40
const LIFE_T = 23
const READY_MS = 120000
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const vpName = (v) => `${v.width}x${v.height}`
const show = (v) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s === undefined ? 'undefined' : s.length > 400 ? `${s.slice(0, 400)}…` : s
}
const url = (params = {}, sub = '') => `${APP}${sub}?${new URLSearchParams({ catalog: 'course', arrive: '0', poster: 'off', ...params }).toString()}`

const tally = { pages: 0, api: [], supabase: [], pageErrors: [] }
const results = []

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

/** The page's state for a phone: its view, any canvas, the 3D scene's hooks, the welcome and the chrome of the 3D. */
const PHONE_STATE = () => {
  const main = document.querySelector('main[data-view]')
  const list = main?.querySelector(':scope > div ol')?.closest('div')
  return {
    view: main?.getAttribute('data-view') ?? null,
    canvases: document.querySelectorAll('canvas').length,
    sceneReady: window.__worldReady === true,
    scene: !!window.__worldV6Debug,
    listWelcome: !!document.querySelector('main h2#welcome-title') && !!list?.querySelector('h2#welcome-title'),
    welcomeTitle: document.querySelector('main h2#welcome-title')?.textContent ?? null,
    continue: !!document.querySelector('main section[aria-labelledby="welcome-title"] button'),
    timeline: !!document.querySelector('main nav[aria-label="Places"]'),
    cue: [...document.querySelectorAll('main div')].some((d) => d.textContent === 'Scroll'),
    lesson: [...document.querySelectorAll('h1')].some((h) => !h.closest('main')),
    path: location.pathname,
  }
}

/** The first lesson row of the open place's sheet: on the screen with no scrolling, and how far the sheet scrolls. */
const SHEET_STATE = () => {
  const sheet = document.querySelector('main section[role="dialog"][aria-labelledby="v4-panel-title"]')
  if (!sheet) return null
  const rows = [...sheet.querySelectorAll('ol > li')]
  const first = rows[0]?.getBoundingClientRect()
  const last = rows[rows.length - 1]?.getBoundingClientRect()
  return {
    title: sheet.querySelector('#v4-panel-title')?.textContent ?? null,
    rows: rows.length,
    scrollTop: Math.round(sheet.scrollTop),
    first: first ? { t: Math.round(first.top), b: Math.round(first.bottom) } : null,
    lastBottom: last ? Math.round(last.bottom) : null,
    sheet: { t: Math.round(sheet.getBoundingClientRect().top), b: Math.round(sheet.getBoundingClientRect().bottom), scrollH: sheet.scrollHeight, clientH: sheet.clientHeight },
    vh: window.innerHeight,
  }
}

async function openPage(ctx, row, urlPath, viewport, { touch = false } = {}) {
  const page = await ctx.newPage()
  tally.pages++
  page.setDefaultTimeout(90000)
  await page.setViewport({ ...viewport, deviceScaleFactor: 1, isMobile: touch, hasTouch: touch })
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
  await page.goto(ORIGIN + urlPath, { waitUntil: 'domcontentloaded', timeout: READY_MS })
  const lesson = /\/a\d\/a\dl\d\d/.test(urlPath)
  await waitFor(page, lesson
    ? () => [...document.querySelectorAll('h1')].some((h) => !h.closest('main'))
    : () => window.__worldReady === true || document.querySelector('main[data-view="list"]') !== null, {
    timeout: READY_MS,
    poll: 300,
    what: `${urlPath}: the page was not ready`,
  })
  await page.evaluate(() => document.fonts.ready.then(() => true))
  await sleep(900)
  return page
}

/** A picture for a person (world-tests/shots/v6/landscape/rows/, git-ignored). */
async function shot(page, file) {
  const dir = path.join(ROOT, 'rows')
  fs.mkdirSync(dir, { recursive: true })
  await page.evaluate(() => document.fonts.ready.then(() => true))
  // The list's still of the student's place fades in once it has loaded.
  await waitFor(page, () => {
    const hero = [...document.querySelectorAll('main div[aria-hidden="true"] > img')].find((i) => i.parentElement.style.height)
    return !hero || (hero.complete && hero.naturalWidth > 1 && hero.hasAttribute('data-on'))
  }, { timeout: 15000, what: 'the list\'s still did not load' }).catch(() => null)
  await sleep(700)
  await page.screenshot({ path: path.join(dir, file), captureBeyondViewport: false })
}

let browser = null

async function runRow(id, name, body) {
  if (ONLY && !ONLY.has(String(id))) return
  const row = { id, name, pass: true, checks: [], pageErrors: [], error: null }
  const ctx = await browser.createBrowserContext()
  const r = {
    row,
    ctx,
    open: (urlPath, viewport, o) => openPage(ctx, row, urlPath, viewport, o),
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

// ── The desktop pictures ────────────────────────────────────────────────────

/** Stop the page's frame loop, set both clocks, draw one frame with no time passing (v6-review-shots.mjs). */
const DRAW_FROZEN = ({ sceneT, lifeT }) => {
  const sc = window.__worldV6Debug
  if (!sc || !sc.renderer) return { ok: false, why: 'no scene' }
  const stopLoop = () => {
    if (sc.raf) {
      cancelAnimationFrame(sc.raf)
      sc.raf = 0
    }
    if (sc.animTimer !== null && sc.animTimer !== undefined) {
      clearTimeout(sc.animTimer)
      sc.animTimer = null
    }
  }
  sc.paused = true
  stopLoop()
  sc.sceneTime = sceneT
  window.__worldLife?.setTime?.(lifeT)
  sc.debugScene()?.traverse((o) => {
    if (!o.name.startsWith('Airship_Prop')) return
    o.rotation.x = o.name.endsWith('Port') ? -0.7 : 0.7
  })
  const info = sc.renderer.info.render
  const f0 = info.frame
  sc.paused = false
  sc.dirty = true
  sc.lastTime = performance.now()
  sc.tick(sc.lastTime)
  sc.paused = true
  stopLoop()
  sc.__landscapeFrozen = true
  return { ok: true, renders: info.frame - f0 }
}

/** The page's CSS animations in one state every run: a finite one at its end, a looping one held half way. */
const HOLD_CSS = () => {
  let n = 0
  for (const a of document.getAnimations()) {
    const t = a.effect?.getComputedTiming?.()
    if (!t) continue
    try {
      if (t.iterations === Infinity) {
        a.pause()
        a.currentTime = (Number(t.delay) || 0) + (Number(t.duration) || 0) / 2
      } else a.finish()
      n++
    } catch {
      // An animation that cannot be finished is left as it is.
    }
  }
  return n
}

async function freeze(page) {
  let renders = 0
  for (let i = 0; i < 40 && renders < 2; i++) {
    const r = await page.evaluate(DRAW_FROZEN, { sceneT: SCENE_T, lifeT: LIFE_T })
    if (!r.ok) throw new Error(`freeze: ${r.why}`)
    if (r.renders > 0) renders++
    else await sleep(60)
  }
  if (renders < 2) throw new Error(`freeze: the scene drew ${renders} of the 2 frozen frames`)
  await page.evaluate(HOLD_CSS)
  await sleep(300)
}

/** Seed the camera at a rail depth (scroll and camera together) and wait for it to rest there with the card's timers run. */
async function seed(page, depth) {
  await page.evaluate((d) => {
    const sc = window.__worldV6Debug
    window.scrollTo(0, Math.round(sc.scrollYForDepth(d)))
    sc.seedDepth(d)
  }, depth)
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
    if (Date.now() - t0 > 15000) throw new Error(`the camera did not settle at depth ${depth}`)
    await sleep(150)
  }
  await sleep(1400)
}

/**
 * The panel's view parks under reduced motion: the camera lands at once, so
 * the trees' detail does not follow the frames a flight happened to draw (with
 * the flight, two runs on an unchanged tree differed in up to 1,586 pixels).
 */
const DESK_VIEWS = [
  { name: 'top', query: {} },
  { name: 'card', query: {}, rest: 'a4' },
  { name: 'panel', query: {}, park: 'a3', reduced: true },
  { name: 'posters', query: { poster: 'on' } },
]

async function deskShots(label) {
  const out = path.join(ROOT, label)
  fs.mkdirSync(out, { recursive: true })
  const made = []
  const views = flag('--views') ? new Set(flag('--views').split(',')) : null
  for (const vp of DESKS) {
    for (const view of DESK_VIEWS) {
      if (views && !views.has(view.name)) continue
      const ctx = await browser.createBrowserContext()
      const page = await ctx.newPage()
      const errors = []
      page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)))
      try {
        await page.setViewport({ ...vp, deviceScaleFactor: 1 })
        if (view.reduced) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
        await page.bringToFront()
        await page.goto(ORIGIN + url({ p: 'mid', ...view.query }), { waitUntil: 'domcontentloaded', timeout: READY_MS })
        await waitFor(page, () => window.__worldReady === true, { timeout: READY_MS, poll: 300, what: 'the map was not ready' })
        await page.mouse.move(2, 2)
        const headless = view.query.poster === 'on'
        if (!headless) {
          await page.evaluate(() => window.__worldV6Debug?.setQualityTier?.(0))
          await waitFor(page, () => {
            const layer = document.querySelector('main picture')?.parentElement
            return !layer || getComputedStyle(layer).visibility === 'hidden'
          }, { timeout: 15000, poll: 150, what: 'the landing poster did not fade out' })
        } else {
          // Still views only: every poster loaded and the loading screen gone.
          await waitFor(page, () => [...document.querySelectorAll('main img')].every((i) => !i.getAttribute('src') || (i.complete && i.naturalWidth > 0)), { timeout: 15000, poll: 150, what: 'the posters did not load' })
        }
        await page.evaluate(() => document.fonts.ready.then(() => true))
        if (view.rest) await seed(page, await page.evaluate((id) => window.__worldDepthFor(id), view.rest))
        if (view.park) {
          await seed(page, await page.evaluate((id) => window.__worldDepthFor(id), view.park))
          await page.evaluate((id) => window.__worldPark(id), view.park)
          await waitFor(page, (id) => {
            const f = window.__worldFrame
            const panel = document.querySelector('main section[aria-labelledby="v4-panel-title"]')
            return f?.parkedId === id && f.parkProgress >= 0.999 && !!panel && Number(getComputedStyle(panel).opacity) > 0.99
          }, { arg: view.park, timeout: 30000, what: `no park at ${view.park}` })
          await page.mouse.move(2, 2)
          await sleep(1400)
        }
        await sleep(1200)
        if (headless) {
          await page.evaluate(HOLD_CSS)
          await sleep(400)
        } else await freeze(page)
        const file = `${view.name}-${vpName(vp)}.png`
        await page.screenshot({ path: path.join(out, file), captureBeyondViewport: false })
        made.push(file)
        console.log(`shot  ${file}${errors.length ? `  page errors: ${errors.join(' | ')}` : ''}`)
      } catch (e) {
        console.log(`FAIL  ${view.name}-${vpName(vp)}: ${String(e?.message ?? e).slice(0, 200)}`)
        process.exitCode = 1
      } finally {
        await ctx.close().catch(() => {})
      }
    }
  }
  console.log(`${made.length} pictures in ${path.relative(HERE, out)}`)
}

/** Two PNGs compared in a page: decoded by the browser, read back from a canvas. */
const COMPARE = async ([a, b]) => {
  const load = (src) => new Promise((res, rej) => {
    const img = new Image()
    img.onload = () => res(img)
    img.onerror = () => rej(new Error('a picture did not decode'))
    img.src = src
  })
  const [ia, ib] = await Promise.all([load(a), load(b)])
  if (ia.naturalWidth !== ib.naturalWidth || ia.naturalHeight !== ib.naturalHeight) return { size: `${ia.naturalWidth}x${ia.naturalHeight} vs ${ib.naturalWidth}x${ib.naturalHeight}` }
  const w = ia.naturalWidth
  const h = ia.naturalHeight
  const read = (img) => {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const g = c.getContext('2d', { willReadFrequently: true })
    g.drawImage(img, 0, 0)
    return g.getImageData(0, 0, w, h).data
  }
  const da = read(ia)
  const db = read(ib)
  let differ = 0
  let max = 0
  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  for (let i = 0; i < w * h; i++) {
    const o = i * 4
    const d = Math.max(Math.abs(da[o] - db[o]), Math.abs(da[o + 1] - db[o + 1]), Math.abs(da[o + 2] - db[o + 2]))
    if (d > 0) {
      differ++
      if (d > max) max = d
      const x = i % w
      const y = (i / w) | 0
      if (x < x0) x0 = x
      if (y < y0) y0 = y
      if (x > x1) x1 = x
      if (y > y1) y1 = y
    }
  }
  return { w, h, differ, max, box: differ ? { x0, y0, x1, y1 } : null }
}

async function diff(la, lb) {
  const A = path.join(ROOT, la)
  const B = path.join(ROOT, lb)
  const files = fs.readdirSync(A).filter((f) => f.endsWith('.png')).sort()
  const page = await browser.newPage()
  let bad = 0
  for (const f of files) {
    if (!fs.existsSync(path.join(B, f))) {
      console.log(`MISSING  ${f} in ${lb}`)
      bad++
      continue
    }
    const uri = (p) => `data:image/png;base64,${fs.readFileSync(p).toString('base64')}`
    const r = await page.evaluate(COMPARE, [uri(path.join(A, f)), uri(path.join(B, f))])
    const same = !r.size && r.differ === 0
    if (!same) bad++
    console.log(`${same ? 'IDENTICAL' : 'DIFFERENT'}  ${f}  ${r.size ? `sizes ${r.size}` : `${r.differ} of ${r.w * r.h} pixels differ, largest channel difference ${r.max}${r.box ? `, in x ${r.box.x0}..${r.box.x1}, y ${r.box.y0}..${r.box.y1}` : ''}`}`)
  }
  console.log(`${files.length - bad} of ${files.length} identical`)
  if (bad) process.exitCode = 1
}

// ── Run ─────────────────────────────────────────────────────────────────────

browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--no-sandbox', '--hide-scrollbars'],
  protocolTimeout: 180000,
})

try {
  if (argv.includes('--desk')) {
    const label = flag('--desk')
    if (!label || !/^[\w.-]+$/.test(label)) throw new Error('--desk <label>')
    await deskShots(label)
  } else if (argv.includes('--diff')) {
    const i = argv.indexOf('--diff')
    const [la, lb] = [argv[i + 1], argv[i + 2]]
    if (!la || !lb) throw new Error('--diff <a> <b>')
    await diff(la, lb)
  } else {
    await runRow(1, 'phones held sideways get the list: no 3D, the welcome\'s two lines, Watch on top and opening the lesson', async (r) => {
      for (const vp of SIDEWAYS) {
        const page = await r.open(url({ p: 'mid' }), vp, { touch: true })
        const s = await page.evaluate(PHONE_STATE)
        const at = vpName(vp)
        await shot(page, `list-${at}.png`)
        r.check(`${at}: the list view`, s.view === 'list', s.view)
        r.check(`${at}: no canvas and no 3D scene`, s.canvases === 0 && !s.sceneReady && !s.scene, { canvases: s.canvases, ready: s.sceneReady, scene: s.scene })
        r.check(`${at}: the welcome's two lines head the list, with no Continue`, s.listWelcome && s.welcomeTitle === 'Welcome, Maya' && !s.continue, { title: s.welcomeTitle, continue: s.continue })
        r.check(`${at}: no timeline and no scroll cue`, !s.timeline && !s.cue, { timeline: s.timeline, cue: s.cue })
        // The Next block's Watch, scrolled to: the top of the page at its centre, then tapped.
        const w = await page.evaluate(() => {
          const btn = document.querySelector('main section[aria-label="Next lesson"] button')
          if (!btn) return null
          btn.scrollIntoView({ block: 'center' })
          const b = btn.getBoundingClientRect()
          const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)
          return { x: b.left + b.width / 2, y: b.top + b.height / 2, label: btn.getAttribute('aria-label'), onTop: !!top && btn.contains(top) }
        })
        r.check(`${at}: the Next block's Watch is the top of the page at its centre`, w?.onTop === true, w)
        if (w?.onTop) {
          await sleep(300)
          await page.touchscreen.tap(Math.round(w.x), Math.round(w.y))
          // The page shows at the tap and its address follows (WorldStage's open()).
          const opened = await waitFor(page, () => [...document.querySelectorAll('h1')].some((h) => !h.closest('main')) && /^\/dev\/world-app\/a4\/a4l\d\d$/.test(location.pathname) && location.pathname, { timeout: 15000, what: `${at}: the tap on Watch opened no lesson page` }).catch(() => null)
          r.check(`${at}: a tap on Watch opens the lesson's page`, typeof opened === 'string', opened ?? (await page.evaluate(() => ({ path: location.pathname, lesson: [...document.querySelectorAll('h1')].some((h) => !h.closest('main')) }))))
        }
        await page.close()
      }
    })

    await runRow(2, 'phones held sideways: a place\'s row opens its sheet, its first lesson row on the screen', async (r) => {
      for (const vp of SIDEWAYS) {
        const page = await r.open(url({ p: 'mid' }), vp, { touch: true })
        const at = vpName(vp)
        const row = await page.evaluate(() => {
          const btn = [...document.querySelectorAll('main ol > li > button')].find((b) => /^Video Ads I,/.test(b.getAttribute('aria-label') ?? ''))
          if (!btn) return null
          btn.scrollIntoView({ block: 'center' })
          const b = btn.getBoundingClientRect()
          const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)
          return { x: b.left + b.width / 2, y: b.top + b.height / 2, onTop: !!top && btn.contains(top) }
        })
        r.check(`${at}: Video Ads I's row is on top where it is tapped`, row?.onTop === true, row)
        if (!row?.onTop) continue
        await sleep(300)
        await page.touchscreen.tap(Math.round(row.x), Math.round(row.y))
        await waitFor(page, () => !!document.querySelector('main section[role="dialog"][aria-labelledby="v4-panel-title"]'), { timeout: 8000, what: `${at}: no sheet` })
        await sleep(500)
        const s = await page.evaluate(SHEET_STATE)
        await shot(page, `sheet-${at}.png`)
        r.check(`${at}: the sheet is Video Ads I's, with its lessons`, s?.title === 'Video Ads I' && s.rows > 0, s && { title: s.title, rows: s.rows })
        r.check(`${at}: its first lesson row is on the screen with no scrolling`, !!s?.first && s.scrollTop === 0 && s.first.b <= s.vh, s && { first: s.first, vh: s.vh, scrollTop: s.scrollTop })
        const end = await page.evaluate(() => {
          const sheet = document.querySelector('main section[role="dialog"][aria-labelledby="v4-panel-title"]')
          sheet.scrollTop = sheet.scrollHeight
          const rows = sheet.querySelectorAll('ol > li')
          const last = rows[rows.length - 1].getBoundingClientRect()
          return { lastBottom: Math.round(last.bottom), vh: innerHeight }
        })
        r.check(`${at}: the sheet scrolls to its last row`, end.lastBottom <= end.vh, end)
        r.check(`${at}: the address is the place's`, (await page.evaluate(() => location.pathname)) === '/dev/world-app/a3', await page.evaluate(() => location.pathname))
        await page.close()
      }
    })

    await runRow(3, 'phones held sideways: a place\'s address opens its sheet at load, its first lesson row on the screen; at the student\'s place, the next lesson\'s Watch', async (r) => {
      for (const vp of SIDEWAYS) {
        const at = vpName(vp)
        const page = await r.open(url({ p: 'mid' }, '/a3'), vp, { touch: true })
        await waitFor(page, () => !!document.querySelector('main section[role="dialog"][aria-labelledby="v4-panel-title"]'), { timeout: 10000, what: `${at}: no sheet` }).catch(() => null)
        await sleep(400)
        const s = await page.evaluate(SHEET_STATE)
        const p = await page.evaluate(PHONE_STATE)
        r.check(`${at}: the list, no canvas`, p.view === 'list' && p.canvases === 0, { view: p.view, canvases: p.canvases })
        r.check(`${at}: Video Ads I's sheet with its first lesson row on the screen`, s?.title === 'Video Ads I' && !!s.first && s.first.b <= s.vh, s && { title: s.title, first: s.first, vh: s.vh })
        await page.close()
        // Video Ads II, the student's place (9 of 17 watched): the watched ones fold into one row, then lesson 10 with its Watch.
        const here = await r.open(url({ p: 'mid' }, '/a4'), vp, { touch: true })
        await waitFor(here, () => !!document.querySelector('main section[role="dialog"][aria-labelledby="v4-panel-title"]'), { timeout: 10000, what: `${at}: no sheet for a4` }).catch(() => null)
        await sleep(400)
        const w = await here.evaluate(() => {
          const sheet = document.querySelector('main section[role="dialog"][aria-labelledby="v4-panel-title"]')
          const btn = sheet?.querySelector('ol > li button[aria-label^="Watch lesson"]')
          if (!btn) return null
          const b = btn.getBoundingClientRect()
          const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)
          return { title: sheet.querySelector('#v4-panel-title')?.textContent, label: btn.getAttribute('aria-label'), b: Math.round(b.bottom), vh: innerHeight, scrollTop: sheet.scrollTop, onTop: !!top && btn.contains(top) }
        })
        r.check(`${at}: Video Ads II's sheet shows the next lesson's Watch with no scrolling, nothing over it`, w?.title === 'Video Ads II' && /^Watch lesson 10,/.test(w.label) && w.b <= w.vh && w.scrollTop === 0 && w.onTop, w)
        await shot(here, `sheet-a4-${at}.png`)
        await here.close()
      }
    })

    await runRow(4, 'a lesson page open on a phone turned sideways and back: the list throughout, no 3D built behind the lesson', async (r) => {
      const page = await r.open(url({ p: 'mid' }, '/a1/a1l02'), PORTRAIT, { touch: true })
      const before = await page.evaluate(PHONE_STATE)
      r.check('390x844: the lesson page over the list', before.lesson && before.view === 'list' && before.canvases === 0, before)
      for (const vp of [SIDEWAYS[0], SIDEWAYS[2], PORTRAIT]) {
        await page.setViewport({ ...vp, deviceScaleFactor: 1, isMobile: true, hasTouch: true })
        // Long enough for the scene to have started and built if it was going to (it built in about 4 s on this machine).
        await sleep(6000)
        const s = await page.evaluate(PHONE_STATE)
        r.check(`turned to ${vpName(vp)}: the list, no canvas, no 3D scene, the lesson page still up`, s.view === 'list' && s.canvases === 0 && !s.sceneReady && !s.scene && s.lesson && s.path === '/dev/world-app/a1/a1l02', s)
      }
      await page.close()
    })

    await runRow(5, 'the 3D just above the line, on a tablet and on computers: the welcome\'s Continue takes every tap on it and makes the trip', async (r) => {
      /** Over a 3x11 grid on Continue: the points where it is the top of the page, and those with a pin or plaque that takes a tap under it. */
      const GRID = () => {
        const go = document.querySelector('main section[aria-labelledby="welcome-title"] button')
        const b = go.getBoundingClientRect()
        let top = 0
        const under = []
        for (let iy = 0; iy < 3; iy++) {
          for (let ix = 0; ix < 11; ix++) {
            const x = b.left + ((ix + 0.5) / 11) * b.width
            const y = b.top + ((iy + 0.5) / 3) * b.height
            const el = document.elementFromPoint(x, y)
            if (el && go.contains(el)) top++
            const pin = document.elementsFromPoint(x, y).find((e) => {
              const m = e.closest('main button[data-mode]')
              return m && m.dataset.mode !== 'hidden' && getComputedStyle(e).pointerEvents !== 'none'
            })
            if (pin) under.push(`${pin.closest('button').getAttribute('aria-label').split(',')[0]} at ${Math.round(x)},${Math.round(y)}`)
          }
        }
        const h2 = document.querySelector('main h2#welcome-title')
        return { view: document.querySelector('main').dataset.view, top, under: under.slice(0, 4), lines: Math.round(h2.getBoundingClientRect().height / parseFloat(getComputedStyle(h2).lineHeight)), go: { t: Math.round(b.top), b: Math.round(b.bottom) } }
      }
      const sizes = [[{ width: 760, height: 500 }, true], [{ width: 1024, height: 500 }, true], [{ width: 768, height: 1024 }, true], [DESKS[0], false], [DESKS[1], false], [{ width: 3428, height: 1230 }, false]]
      for (const [vp, touch] of sizes) {
        const page = await r.open(url({ p: 'mid' }), vp, { touch })
        const at = vpName(vp)
        await waitFor(page, () => document.querySelector('main section[aria-labelledby="welcome-title"]')?.hasAttribute('data-on'), { timeout: 10000, what: `${at}: the welcome did not show` })
        const one = await page.evaluate(GRID)
        r.check(`${at}: the 3D; Continue the top of the page at all 33 points, no pin or plaque under them`, one.view === 'world' && one.lines === 1 && one.top === 33 && one.under.length === 0, one)
        // A long first name: the title on two lines, Continue a line lower. Put back after.
        const two = await page.evaluate((grid) => {
          const h2 = document.querySelector('main h2#welcome-title')
          const was = h2.textContent
          h2.textContent = 'Welcome, Konstantinos-Alexandros Papadopoulos'
          const g = new Function(`return (${grid})()`)()
          h2.textContent = was
          return g
        }, GRID.toString())
        r.check(`${at}: the title on two lines; Continue still clear at all 33 points`, two.lines === 2 && two.top === 33 && two.under.length === 0, two)
        const c = await page.evaluate(() => {
          const b = document.querySelector('main section[aria-labelledby="welcome-title"] button').getBoundingClientRect()
          return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }
        })
        if (touch) await page.touchscreen.tap(c.x, c.y)
        else await page.mouse.click(c.x, c.y)
        const want = await page.evaluate(() => window.__worldDepthFor('a4'))
        const rest = await waitFor(page, (d) => {
          const f = window.__worldFrame
          const card = document.querySelector('main section[data-side][data-show]:not([aria-label="Place done"])')
          return f && Math.abs(f.depth - d) < 0.003 && f.parkedId === null && card ? { depth: f.depth, card: card.textContent.slice(0, 60) } : null
        }, { arg: want, timeout: 20000, poll: 200, what: `${at}: the camera did not come to rest at the student's place with the card` }).catch((e) => ({ error: e.message }))
        const after = await page.evaluate(() => ({ path: location.pathname, open: document.querySelector('main')?.hasAttribute('data-open') ?? null }))
        r.check(`${at}: the tap made the trip (the student's place, its card), the address the map's, no panel`, !rest.error && /Video Ads II/.test(rest.card) && after.path === '/dev/world-app' && after.open === false, { rest, after })
        await page.close()
      }
    })
  }
} finally {
  await browser.close()
}

if (!argv.includes('--desk') && !argv.includes('--diff')) {
  console.log(`MEASURED  pages ${tally.pages}, requests to /api ${tally.api.length}, to Supabase ${tally.supabase.length}, page errors ${tally.pageErrors.length}`)
  if (tally.api.length || tally.supabase.length || tally.pageErrors.length) {
    console.log(`        ${show({ api: tally.api.slice(0, 3), supabase: tally.supabase.slice(0, 3), errors: tally.pageErrors.slice(0, 3) })}`)
    process.exitCode = 1
  }
  const failed = results.filter((x) => !x.pass)
  console.log(`\n${results.length - failed.length} of ${results.length} rows PASS`)
  if (failed.length) process.exitCode = 1
}
