/**
 * The life module's proof harness (src/lib/world-v3/life.ts): birds, cloud
 * cards, chimney smoke and pond fireflies.
 *
 *   node world-tests/v3-life.mjs probe            # camera poses + life state at every stop
 *   node world-tests/v3-life.mjs probe --shots --only d0,a2   # ...and screenshots, some stops
 *   node world-tests/v3-life.mjs frames           # 3 frames 1 s apart (scene clock) at the default view
 *   node world-tests/v3-life.mjs frames --at a2   # the same at another stop
 *   node world-tests/v3-life.mjs cost [--at a7]   # draw calls + triangles with and without the Life* objects
 *   node world-tests/v3-life.mjs frames --reduced # the same 3 frames with prefers-reduced-motion: reduce
 *
 * 960x600 by default (VP=WxH overrides). Needs the dev server on BASE_URL
 * (default http://localhost:3111). PNGs + JSON go to world-tests/shots/v3/life/.
 *
 * THE CLOCK. Headless SwiftShader draws ~0.6 s per frame and the scene clamps
 * dt to 0.05 s, so "1 s apart" is measured on the SCENE clock (the sum of
 * clamped dt), which is also the clock life.ts animates on. The gate below is
 * the one from v2-render.mjs: it keeps that clock and HOLDS the rAF queue on
 * the frame that crosses the target, so the canvas stays on it for the shot.
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.BASE_URL || 'http://localhost:3111'
const ROUTE = process.env.ROUTE || '/dev/world-v3'
const OUT = process.env.OUT_DIR || path.join(HERE, 'shots', 'v3', 'life')
const [VW, VH] = (process.env.VP || '960x600').split('x').map(Number)
const STOPS = { d0: 0, a1: 0.0708, a2: 0.1934, a3: 0.3, a4: 0.4151, a5: 0.5236, a6: 0.6321, a7: 0.6863, a8: 0.8302 }

const args = process.argv.slice(2)
const MODE = args[0] || 'probe'
const AT = args.includes('--at') ? args[args.indexOf('--at') + 1] : 'd0'
const TAG = args.includes('--tag') ? args[args.indexOf('--tag') + 1] : ''

fs.mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

function installGate() {
  const real = window.requestAnimationFrame.bind(window)
  const cancelReal = window.cancelAnimationFrame.bind(window)
  const live = new Map()
  let nextId = 1
  const G = {
    held: false, queue: [], frameT: -1, frames: 0, clockOn: false, clock: 0, lastT: 0, holdAt: Infinity,
    start(t0) { this.lastT = t0; this.clock = 0; this.clockOn = true; this.holdAt = Infinity },
    stop() { this.clockOn = false; this.holdAt = Infinity },
    hold() { this.held = true },
    release() { this.held = false; const q = this.queue.splice(0); for (const [id, run] of q) if (live.has(id)) live.set(id, real(run)) },
  }
  window.__gate = G
  window.requestAnimationFrame = function (cb) {
    const id = nextId++
    const run = (t) => {
      if (!live.has(id)) return
      if (G.held) { G.queue.push([id, run]); return }
      live.delete(id)
      if (t !== G.frameT) {
        G.frameT = t
        G.frames++
        if (G.clockOn) { G.clock += Math.min(0.05, Math.max(0, (t - G.lastT) / 1000)); G.lastT = t }
      }
      cb(t)
      if (G.clockOn && G.clock >= G.holdAt - 1e-9) { G.held = true; G.holdAt = Infinity }
    }
    live.set(id, real(run))
    return id
  }
  window.cancelAnimationFrame = function (id) { const r = live.get(id); if (r !== undefined) { cancelReal(r); live.delete(id) } }
}

async function open(browser) {
  const page = await browser.newPage()
  page.setDefaultTimeout(900000)
  const errors = []
  const info = []
  page.on('console', (m) => {
    const t = m.text()
    if (/GPU stall|GL Driver Message|WebGL-|swiftshader|Automatic fallback/i.test(t)) return
    if (m.type() === 'error') errors.push(t)
    else if (/world-v3|life/i.test(t)) info.push(t)
  })
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))
  await page.evaluateOnNewDocument(installGate)
  // --reduced: the OS asks for reduced motion; life.ts must freeze and never ask for frames.
  if (args.includes('--reduced')) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
  await page.setViewport({ width: VW, height: VH, deviceScaleFactor: 1 })
  const t0 = Date.now()
  await page.goto(`${BASE}${ROUTE}`, { waitUntil: 'domcontentloaded', timeout: 180000 })
  await page.waitForFunction(() => window.__worldReady === true || typeof window.__worldError === 'string', { timeout: 600000, polling: 250 })
  const err = await page.evaluate(() => window.__worldError ?? null)
  if (err) throw new Error(`world did not load: ${err}\n${errors.join('\n')}`)
  log(`ready in ${Date.now() - t0} ms`)
  return { page, errors, info }
}

/**
 * Scroll to a rail depth and wait until the camera has arrived on it. Other
 * agents edit V3 while this runs, and each hot reload remounts the world, so
 * this first waits for the hooks to be back and retries once if they vanish.
 */
async function settle(page, depth, tries = 3) {
  try {
    await page.waitForFunction(() => window.__worldReady === true && typeof window.__worldScrollFor === 'function' && window.__worldFrame, { timeout: 600000, polling: 250 })
    await settleOnce(page, depth)
  } catch (e) {
    if (tries <= 1) throw e
    log(`settle(${depth}) failed (${String(e.message || e).slice(0, 80)}), retrying after a remount`)
    await sleep(3000)
    await settle(page, depth, tries - 1)
  }
}

async function settleOnce(page, depth) {
  await page.evaluate((d) => window.scrollTo(0, Math.round(window.__worldScrollFor(d))), depth)
  await page.waitForFunction(
    () => {
      const f = window.__worldFrame
      if (!f || typeof window.__worldScrollFor !== 'function') return false
      const max = window.__worldScrollFor(0.88)
      const target = max > 0 ? Math.min(1, window.scrollY / max) * 0.88 : 0
      return f.parkProgress === 0 && Math.abs(f.depth - target) < 1e-9
    },
    { timeout: 900000, polling: 200 },
  )
  await sleep(250)
}

const frameInfo = (page) =>
  page.evaluate(() => {
    const f = window.__worldFrame
    const life = typeof window.__worldLife === 'function' ? window.__worldLife() : null
    return { depth: f.depth, triangles: f.triangles, calls: f.calls, frames: window.__gate.frames, clock: window.__gate.clock, camera: window.__worldCamera(), life }
  })

/** Run the scene clock forward to `s` seconds and hold on that frame. */
async function holdAt(page, s) {
  await page.evaluate((v) => { window.__gate.holdAt = v; window.__gate.release() }, s)
  await page.waitForFunction(() => window.__gate.held, { polling: 50, timeout: 900000 })
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
  })
  const R = { mode: MODE, at: AT, viewport: `${VW}x${VH}` }
  try {
    const { page, errors, info } = await open(browser)
    await page.waitForFunction(() => typeof window.__worldNames === 'function', { timeout: 600000, polling: 250 })
    R.names = await page.evaluate(() => (typeof window.__worldNames === 'function' ? window.__worldNames().filter((n) => /^Life/.test(n)) : null))
    if (MODE === 'probe') {
      R.poses = {}
      const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null
      for (const [id, d] of Object.entries(STOPS)) {
        if (only && !only.includes(id)) continue
        await settle(page, d)
        const fi = await frameInfo(page)
        R.poses[id] = fi
        const c = fi.camera
        const pitch = (Math.asin(-c.dy) * 180) / Math.PI
        const yaw = (Math.atan2(c.dx, -c.dz) * 180) / Math.PI
        log(`${id} d=${d}: cam (${c.x.toFixed(0)}, ${c.y.toFixed(0)}, ${c.z.toFixed(0)}) pitch ${pitch.toFixed(1)} yaw ${yaw.toFixed(1)}  ${fi.triangles} tris ${fi.calls} calls`)
        if (fi.life) log('   life', JSON.stringify(fi.life))
        if (args.includes('--shots')) await page.screenshot({ path: path.join(OUT, `probe-${id}${TAG}.png`) })
      }
    } else if (MODE === 'frames') {
      await settle(page, STOPS[AT])
      // Let the loop run on the gate clock from here, holding at 1 s steps.
      await page.evaluate(() => { window.__gate.hold(); window.__gate.start(performance.now()) })
      R.shots = []
      for (const s of [0.05, 1.05, 2.05]) {
        const t = Date.now()
        await holdAt(page, s)
        await sleep(150)
        const fi = await frameInfo(page)
        const file = path.join(OUT, `frames-${AT}-${s.toFixed(2).replace('.', '_')}s${TAG}.png`)
        await page.screenshot({ path: file })
        R.shots.push({ sceneS: +fi.clock.toFixed(3), wallMs: Date.now() - t, triangles: fi.triangles, calls: fi.calls, file: path.basename(file) })
        log(`scene ${fi.clock.toFixed(2)} s: ${fi.triangles} tris ${fi.calls} calls -> ${path.basename(file)} (${Date.now() - t} ms)`)
        if (fi.life) log('   life', JSON.stringify(fi.life))
        R.shots[R.shots.length - 1].life = fi.life
      }
      // Does the loop keep running by itself (something animating on screen)?
      const n0 = await page.evaluate(() => { window.__gate.stop(); window.__gate.release(); return window.__gate.frames })
      await sleep(4000)
      const n1 = await page.evaluate(() => window.__gate.frames)
      R.framesIn4sAfterRelease = n1 - n0
      log(`frames drawn in 4 s of wall time after release: ${n1 - n0}`)
    } else if (MODE === 'cost') {
      // Same stop, same frame state: totals with the Life* objects, then hidden.
      // Life draws only what is on screen, so the delta is what life costs HERE.
      await settle(page, STOPS[AT])
      await sleep(1500)
      const withLife = await frameInfo(page)
      const hidden = await page.evaluate(() => window.__worldHide('Life'))
      await page.waitForFunction((n) => window.__gate.frames > n + 2, { polling: 100, timeout: 120000 }, withLife.frames)
      const without = await frameInfo(page)
      R.withLife = { triangles: withLife.triangles, calls: withLife.calls, life: withLife.life }
      R.hiddenObjects = hidden
      R.without = { triangles: without.triangles, calls: without.calls }
      R.lifeCost = { triangles: withLife.triangles - without.triangles, calls: withLife.calls - without.calls }
      log(`${AT}: with life ${withLife.triangles} tris ${withLife.calls} calls; hid ${hidden} Life objects: ${without.triangles} tris ${without.calls} calls; life costs ${R.lifeCost.triangles} tris ${R.lifeCost.calls} calls`)
    }
    R.errors = errors
    R.info = info
    if (errors.length) log('ERRORS', errors)
  } finally {
    await browser.close()
    fs.writeFileSync(path.join(OUT, `v3-life-${MODE}-${AT}${TAG}.json`), JSON.stringify(R, null, 2))
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
