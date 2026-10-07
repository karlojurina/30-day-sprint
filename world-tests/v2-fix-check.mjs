/**
 * Fixer's check for /dev/world-v2: every area's rail stop and park, rendered.
 *
 *   node world-tests/v2-fix-check.mjs --vp split [--areas a1,a3] [--no-park] [--default]
 *
 * Writes world-tests/shots/v2-verify/fix/<vp>-<id>-{stop,fixture,arrived}.png and
 * fix-<vp>.json. Per area:
 *   stop     the depth the dock travels to (scene.depthFor): landmark box on
 *            screen vs the NEXT block and dock rects, the own marker's mode
 *   fixture  the study.ts depth the zoom verifier treats as the rail stop
 *   arrived  after park(): camera-to-landmark distance vs the fixture stop,
 *            the solver's own numbers (parkInfo), flight time on the scene clock
 *
 * The scene is reached through React's fiber (as v2-journey.mjs does) only to
 * read landmark boxes and to snap the rail glide after a scroll.
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.BASE_URL || 'http://localhost:3111'
const OUT = process.env.OUT_DIR || path.join(HERE, 'shots', 'v2-verify', 'fix')
const VPS = { split: [1691, 1278], ultra: [3428, 1230], laptop: [1440, 900] }
const AREAS = [
  ['a1', 0.0708, 'LM_Lighthouse'],
  ['a2', 0.1934, 'LM_Windmill'],
  ['a3', 0.3, 'LM_Bridge'],
  ['a4', 0.4151, 'LM_Viaduct'],
  ['a5', 0.5236, 'LM_Watchtower'],
  ['a6', 0.6321, 'LM_Cairn'],
  ['a7', 0.6863, 'LM_Jetty'],
  ['a8', 0.8302, 'LM_Obelisk'],
]
const args = process.argv.slice(2)
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d)
const vpName = arg('--vp', 'split')
const [W, H] = VPS[vpName]
const ONLY = arg('--areas', null)?.split(',')
const PARK = !args.includes('--no-park')
fs.mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), `[${vpName}]`, ...a)

/** Scene clock: the sum of per-frame dt clamped to 0.05 s, as the scene keeps it. */
function installClock() {
  const real = window.requestAnimationFrame.bind(window)
  const C = (window.__clk = { on: false, t: 0, last: 0, frameT: -1, rows: [] })
  window.requestAnimationFrame = (cb) =>
    real((t) => {
      if (t !== C.frameT) {
        C.frameT = t
        if (C.on) C.t += Math.min(0.05, Math.max(0, (t - C.last) / 1000))
        C.last = t
      }
      cb(t)
      if (C.on) {
        const f = window.__worldFrame
        const c = window.__worldCamera && window.__worldCamera()
        const last = C.rows[C.rows.length - 1]
        const row = { t: C.t, p: f ? f.parkProgress : null, q: f ? f.flight : null, cam: c }
        if (last && last.t === C.t) C.rows[C.rows.length - 1] = row
        else C.rows.push(row)
      }
    })
}

function acquire() {
  const main = document.querySelector('main')
  const key = Object.keys(main).find((k) => k.startsWith('__reactFiber$'))
  let f = main[key]
  for (let n = 0; f && n < 60; n++, f = f.return) {
    for (let h = f.memoizedState; h && typeof h === 'object' && 'next' in h; h = h.next) {
      const v = h.memoizedState
      if (v && typeof v === 'object' && v.current && typeof v.current.debugScene === 'function') return (window.__sc = v.current)
    }
  }
  return null
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  protocolTimeout: 900000,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
})
const R = { vp: vpName, when: new Date().toISOString(), errors: [], warnings: [], api: [], areas: [] }
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(900000)
  page.on('console', (m) => {
    const t = m.text()
    if (/GPU stall|GL Driver Message|WebGL-|swiftshader|Automatic fallback/i.test(t)) return
    if (m.type() === 'error') R.errors.push(t)
    else if (m.type() === 'warning' || m.type() === 'warn') R.warnings.push(t)
  })
  page.on('pageerror', (e) => R.errors.push(`[pageerror] ${e.message}`))
  page.on('request', (r) => {
    if (/\/api\//.test(new URL(r.url()).pathname)) R.api.push(r.url())
  })
  await page.evaluateOnNewDocument(installClock)
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 })
  const t0 = Date.now()
  await page.goto(`${BASE}/dev/world-v2`, { waitUntil: 'domcontentloaded', timeout: 180000 })
  await page.waitForFunction(() => window.__worldReady === true || typeof window.__worldError === 'string', { timeout: 600000, polling: 250 })
  R.readyMs = Date.now() - t0
  R.error = await page.evaluate(() => window.__worldError ?? null)
  if (R.error) throw new Error(R.error)
  await page.evaluate(acquire)
  await page.evaluate(() => document.fonts.ready)
  log(`ready in ${R.readyMs} ms`)

  const chrome = await page.evaluate(() => {
    const rect = (sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { l: r.left, t: r.top, r: r.right, b: r.bottom }
    }
    return { next: rect('section[aria-label="Next lesson"]'), dock: rect('nav[aria-label="Areas"]') }
  })
  R.chrome = chrome

  const settle = async (depth) => {
    await page.evaluate((d) => {
      window.scrollTo(0, Math.round(window.__worldScrollFor(d)))
    }, depth)
    await page.waitForFunction(
      () => {
        const sc = window.__sc
        const max = window.__worldScrollFor(0.88)
        const target = max > 0 ? Math.min(1, window.scrollY / max) * 0.88 : 0
        // Snap the glide: the camera pose is a pure function of depth.
        if (Math.abs(sc.targetDepth - target) < 1e-9) sc.currentDepth = sc.targetDepth
        const f = window.__worldFrame
        return f && f.parkProgress === 0 && Math.abs(f.depth - target) < 1e-9
      },
      { polling: 200, timeout: 900000 },
    )
    const n = await page.evaluate(() => window.__worldFrameCount)
    await page.waitForFunction((n0) => window.__worldFrameCount >= n0 + 2 || true, { polling: 200 }, n)
    await sleep(400)
  }

  const measure = (lmName, id) =>
    page.evaluate(
      (lmName, id, chrome) => {
        const sc = window.__sc
        const lm = sc.landmarks.get(lmName)
        const cam = sc.camera
        const V = cam.position.constructor
        const p = new V()
        const b = lm.vis
        let l = 1e9, t = 1e9, r = -1e9, bt = -1e9
        for (let i = 0; i < 8; i++) {
          p.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).project(cam)
          const x = (p.x * 0.5 + 0.5) * innerWidth
          const y = (-p.y * 0.5 + 0.5) * innerHeight
          l = Math.min(l, x); r = Math.max(r, x); t = Math.min(t, y); bt = Math.max(bt, y)
        }
        const hit = (c) => c && l < c.r && r > c.l && t < c.b && bt > c.t
        const k = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'].indexOf(id)
        const btn = document.querySelectorAll('div[class*="markers"] > button')[k]
        const m = window.__worldFrame.markers.find((mm) => mm.id === id)
        return {
          depth: window.__worldFrame.depth,
          dist: +cam.position.distanceTo(lm.center).toFixed(1),
          box: { l: Math.round(l), t: Math.round(t), r: Math.round(r), b: Math.round(bt) },
          boxFrac: { top: +(t / innerHeight).toFixed(3), bottom: +(bt / innerHeight).toFixed(3), l: +(l / innerWidth).toFixed(3), r: +(r / innerWidth).toFixed(3) },
          underNext: !!hit(chrome.next),
          underDock: !!hit(chrome.dock),
          marker: btn ? btn.dataset.mode : null,
          pin: m ? { x: Math.round(m.x), y: Math.round(m.y), gapToTop: Math.round(t - m.y) } : null,
          cam: window.__worldCamera(),
        }
      },
      lmName,
      id,
      chrome,
    )

  if (args.includes('--default')) {
    await settle(0)
    await sleep(1500)
    await page.screenshot({ path: path.join(OUT, `${vpName}-default.png`) })
    R.default = await page.evaluate(() => ({ labels: window.__worldLabelBoxes().map((b) => b.name), markers: window.__worldMarkers }))
    log('default shot')
  }

  for (const [id, fixture, lmName] of AREAS) {
    if (ONLY && !ONLY.includes(id)) continue
    const A = { id }
    const stop = await page.evaluate((i) => window.__sc.depthFor(i), id)
    await settle(stop)
    A.stop = await measure(lmName, id)
    await page.screenshot({ path: path.join(OUT, `${vpName}-${id}-stop.png`) })
    await settle(fixture)
    A.fixture = await measure(lmName, id)
    await page.screenshot({ path: path.join(OUT, `${vpName}-${id}-fixture.png`) })
    log(`${id} stop ${stop.toFixed(4)}: box ${A.stop.boxFrac.top}-${A.stop.boxFrac.bottom} x ${A.stop.boxFrac.l}-${A.stop.boxFrac.r} next ${A.stop.underNext} dock ${A.stop.underDock} marker ${A.stop.marker} pinGap ${A.stop.pin?.gapToTop}; fixture dist ${A.fixture.dist}`)
    if (PARK) {
      await page.evaluate((i) => {
        window.__clk.rows = []
        window.__clk.t = 0
        window.__clk.on = true
        window.__worldPark(i)
      }, id)
      await page.waitForFunction(() => window.__worldFrame.parkProgress === 1 && window.__worldFrame.flight === 1, { polling: 100 })
      await sleep(500)
      const rows = await page.evaluate(() => {
        window.__clk.on = false
        return window.__clk.rows
      })
      A.parked = await measure(lmName, id)
      A.parkInfo = await page.evaluate(() => window.__worldParkInfo())
      A.cut = +(100 * (1 - A.parked.dist / A.fixture.dist)).toFixed(1)
      A.cutFromStop = +(100 * (1 - A.parked.dist / A.stop.dist)).toFixed(1)
      const at = (ms) => rows.find((r) => r.t >= ms / 1000 - 1e-9)?.p ?? null
      A.flight = { frames: rows.length, arriveS: rows.find((r) => r.p === 1)?.t ?? null, p300: at(300), p700: at(700) }
      let vmax = 0
      for (let i = 1; i < rows.length; i++) {
        const a = rows[i - 1].cam, b = rows[i].cam, dt = rows[i].t - rows[i - 1].t
        if (a && b && dt > 0) vmax = Math.max(vmax, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) / dt)
      }
      A.flight.maxSpeed = Math.round(vmax)
      await page.screenshot({ path: path.join(OUT, `${vpName}-${id}-arrived.png`) })
      log(`${id} parked: dist ${A.parked.dist} (fixture ${A.fixture.dist}, cut ${A.cut}%), box ${A.parked.boxFrac.top}-${A.parked.boxFrac.bottom} x ${A.parked.boxFrac.l}-${A.parked.boxFrac.r}, info ${JSON.stringify(A.parkInfo)}, p@300 ${A.flight.p300?.toFixed(2)} p@700 ${A.flight.p700?.toFixed(2)}`)
      await page.evaluate(() => window.__worldPark(null))
      await page.waitForFunction(() => !document.querySelector('main[data-open]') && window.__worldFrame.parkProgress === 0 && document.body.style.overflow !== 'hidden', { polling: 200 })
    }
    R.areas.push(A)
  }
} catch (e) {
  R.fatal = String(e?.stack || e)
  log('FATAL', R.fatal)
} finally {
  fs.writeFileSync(path.join(OUT, `fix-${vpName}.json`), JSON.stringify(R, null, 2))
  log(`errors ${R.errors.length}, warnings ${R.warnings.length}, api ${R.api.length}`)
  if (R.errors.length) log(R.errors.slice(0, 5).join('\n'))
  if (R.warnings.length) log(R.warnings.slice(0, 5).join('\n'))
  await browser.close()
}
