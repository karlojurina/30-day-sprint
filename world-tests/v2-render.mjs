/**
 * Render /dev/world-v2 and /dev/world-codex for real in headless Chrome, so
 * somebody can LOOK at them side by side.
 *
 *   node world-tests/v2-render.mjs                  # both viewports, both builds
 *   node world-tests/v2-render.mjs --vp split       # 1691x1278 only
 *   node world-tests/v2-render.mjs --vp ultra       # 3428x1230 only
 *   node world-tests/v2-render.mjs --skip-codex     # v2 only
 *
 * Needs the dev server on BASE_URL (default http://localhost:3111). Writes
 * PNGs and v2-render-<vp>.json into world-tests/shots/v2/ (OUT_DIR overrides).
 *
 * WHAT IT DOES, per viewport:
 *   v2     default view (word count), 4 rail stops (triangles, draw calls,
 *          label overlaps), a park at a3 shot twice: once by WALL clock and
 *          once by SCENE clock, each followed by an unpark that must put
 *          scrollY back exactly.
 *   codex  default view (word count), the same 4 areas at Astra's own stops,
 *          and a park at area 3 on the scene clock.
 *   sheets side-by-side pairs of the two builds.
 *
 * THE FRAME GATE. Headless SwiftShader draws this scene at 1-3 fps, and both
 * scenes clamp dt to 0.05 s, so 300 ms of WALL time is a fraction of one
 * frame and says nothing about what a student sees 300 ms into a flight. A
 * wrapper around requestAnimationFrame keeps the same clock the scenes keep
 * (sum of per-frame dt, clamped to 0.05) and can HOLD frames: the canvas and
 * the DOM panel then stay on the exact frame that crossed the target time
 * while the screenshot is taken. Wall-clock shots are taken too, because
 * that is the literal ask; the JSON records the scene time each one landed on.
 *
 * The README's two traps apply: never --virtual-time-budget (a rAF loop never
 * settles), and drive depth by actually scrolling the page.
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.BASE_URL || 'http://localhost:3111'
const OUT = process.env.OUT_DIR || path.join(HERE, 'shots', 'v2')

const ALL_VIEWPORTS = [
  { name: 'split', width: 1691, height: 1278 },
  { name: 'ultra', width: 3428, height: 1230 },
]
// v2 rail stops (check_geom.py) for areas 1, 3, 5 and 8.
const V2_STOPS = [['a1', 0.0708], ['a3', 0.30], ['a5', 0.5236], ['a8', 0.8302]]
// Astra's own stops for the same areas: LANDMARKS[i].depth in src/lib/world-codex/terrain.ts,
// where depth IS the scroll fraction (its travel() scrolls to depth * (scrollHeight - innerHeight)).
const CODEX_STOPS = [['a1', 0.0, 0], ['a3', 0.27, 2], ['a5', 0.55, 4], ['a8', 1.0, 7]]
const PARK_ID = 'a3'
const PARK_CODEX_INDEX = 2
const SHOT_MS = [0, 300, 700, 1600]

const args = process.argv.slice(2)
const vpArg = args.includes('--vp') ? args[args.indexOf('--vp') + 1] : null
const VIEWPORTS = vpArg ? ALL_VIEWPORTS.filter((v) => v.name === vpArg) : ALL_VIEWPORTS
const SKIP_CODEX = args.includes('--skip-codex')
const SKIP_V2 = args.includes('--skip-v2')

fs.mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const fmtMs = (ms) => String(ms).padStart(4, '0') + 'ms'
const fmtD = (d) => d.toFixed(4).replace('.', '_')

/** Injected before any page script. See THE FRAME GATE above. */
function installGate() {
  const real = window.requestAnimationFrame.bind(window)
  const cancelReal = window.cancelAnimationFrame.bind(window)
  const live = new Map()
  let nextId = 1
  const G = {
    held: false,
    queue: [],
    frameT: -1,
    frames: 0,
    times: [],
    clockOn: false,
    clock: 0,
    t0: 0,
    lastT: 0,
    holdAt: Infinity,
    rows: [],
    start(t0) {
      this.t0 = t0
      this.lastT = t0
      this.clock = 0
      this.clockOn = true
      this.rows = []
      this.holdAt = Infinity
    },
    stop() {
      this.clockOn = false
      this.holdAt = Infinity
    },
    hold() {
      this.held = true
    },
    release() {
      this.held = false
      const q = this.queue.splice(0)
      for (const [id, run] of q) if (live.has(id)) live.set(id, real(run))
    },
  }
  window.__gate = G
  window.requestAnimationFrame = function (cb) {
    const id = nextId++
    const run = (t) => {
      if (!live.has(id)) return
      if (G.held) {
        G.queue.push([id, run])
        return
      }
      live.delete(id)
      const newFrame = t !== G.frameT
      if (newFrame) {
        G.frameT = t
        G.frames++
        G.times.push(t)
        if (G.times.length > 600) G.times.shift()
        if (G.clockOn) {
          // The same dt both scenes use: clamped to [0, 0.05] s.
          G.clock += Math.min(0.05, Math.max(0, (t - G.lastT) / 1000))
          G.lastT = t
        }
      }
      cb(t)
      if (G.clockOn) {
        const f = window.__worldFrame
        const p = f ? f.parkProgress : null
        const last = G.rows[G.rows.length - 1]
        if (last && last.at === t) last.p = p
        else G.rows.push({ at: t, t: t - G.t0, clock: G.clock, p })
        if (G.clock >= G.holdAt - 1e-9) {
          G.held = true
          G.holdAt = Infinity
        }
      }
    }
    live.set(id, real(run))
    return id
  }
  window.cancelAnimationFrame = function (id) {
    const r = live.get(id)
    if (r !== undefined) {
      cancelReal(r)
      live.delete(id)
    }
  }
}

/** Visible chrome words, the interface agent's method (scratchpad words.mjs), run on both builds. */
function countWords() {
  const words = []
  const tokens = []
  const lines = []
  const vis = (el) => {
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e)
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false
      if (e.tagName === 'NEXTJS-PORTAL') return false
    }
    return true
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.textContent.trim()
    if (!t) continue
    const el = n.parentElement
    if (!el || !vis(el)) continue
    const r = document.createRange()
    r.selectNodeContents(n)
    const b = r.getBoundingClientRect()
    if (b.width < 1 || b.height < 1 || b.right < 0 || b.bottom < 0 || b.left > innerWidth || b.top > innerHeight) continue
    const cs = getComputedStyle(el)
    if (cs.clipPath === 'inset(50%)' || (el.offsetWidth <= 1 && el.offsetHeight <= 1)) continue
    const toks = t.split(/\s+/).filter(Boolean)
    tokens.push(...toks)
    words.push(...toks.filter((x) => /[A-Za-z]/.test(x)))
    lines.push(t)
  }
  return { words: words.length, tokens: tokens.length, lines }
}

/** Inverse of smootherstep, by bisection. parkProgress = smoother(flightTime / T). */
function invSmoother(p) {
  let lo = 0
  let hi = 1
  for (let i = 0; i < 60; i++) {
    const m = (lo + hi) / 2
    const v = m * m * m * (m * (m * 6 - 15) + 10)
    if (v < p) lo = m
    else hi = m
  }
  return (lo + hi) / 2
}

function camDelta(a, b) {
  const dp = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
  const dot = Math.max(-1, Math.min(1, a.dx * b.dx + a.dy * b.dy + a.dz * b.dz))
  return { units: dp, deg: (Math.acos(dot) * 180) / Math.PI }
}

async function openPage(browser, vp, route) {
  const page = await browser.newPage()
  page.setDefaultTimeout(600000)
  const errors = []
  const warnings = []
  const noise = { count: 0, samples: [] }
  const api = []
  const assets = []
  page.on('console', (m) => {
    const t = m.text()
    if (/GPU stall|GL Driver Message|WebGL-|swiftshader|Automatic fallback to software WebGL/i.test(t)) {
      noise.count++
      if (noise.samples.length < 5) noise.samples.push(t.slice(0, 200))
      return
    }
    if (m.type() === 'error') errors.push(t)
    else if (m.type() === 'warning' || m.type() === 'warn') warnings.push(t)
  })
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))
  page.on('requestfailed', (r) => {
    const u = r.url()
    // Aborted HMR/ping requests on navigation are not failures of the page.
    if (!/_next\/webpack-hmr|__nextjs/.test(u)) errors.push(`[requestfailed] ${u} ${r.failure()?.errorText ?? ''}`)
  })
  page.on('request', (r) => {
    const u = r.url()
    if (/\/api\//.test(new URL(u).pathname)) api.push(`${r.method()} ${u}`)
  })
  page.on('response', (r) => {
    const u = r.url()
    if (/\.(glb|wasm)$|draco_/.test(u)) {
      const h = r.headers()
      assets.push({ url: u, status: r.status(), type: h['content-type'], encoding: h['content-encoding'] ?? null, length: h['content-length'] ?? null })
    }
  })
  await page.evaluateOnNewDocument(installGate)
  await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1 })
  await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 180000 })
  return { page, errors, warnings, noise, api, assets }
}

async function shot(page, name) {
  const file = path.join(OUT, name)
  await page.screenshot({ path: file })
  return file
}

/** Mean frame interval over the recent frames, from the gate's timestamps. */
async function frameStats(page) {
  return page.evaluate(() => {
    const t = window.__gate.times.slice(-40)
    if (t.length < 3) return null
    const d = []
    for (let i = 1; i < t.length; i++) d.push(t[i] - t[i - 1])
    d.sort((a, b) => a - b)
    return { frames: d.length, medianMs: Math.round(d[d.length >> 1]), maxMs: Math.round(d[d.length - 1]) }
  })
}

// ── v2 ───────────────────────────────────────────────────────────────────────

/** Scroll to a rail depth and wait for the scene to snap onto it (it snaps within 1e-5, then sleeps). */
async function v2Settle(page, depth) {
  const t = Date.now()
  await page.evaluate((d) => window.scrollTo(0, Math.round(window.__worldScrollFor(d))), depth)
  await page.waitForFunction(
    () => {
      const f = window.__worldFrame
      if (!f || !window.__worldScrollFor) return false
      const max = window.__worldScrollFor(0.88)
      const target = max > 0 ? Math.min(1, window.scrollY / max) * 0.88 : 0
      return f.parkProgress === 0 && Math.abs(f.depth - target) < 1e-9
    },
    { timeout: 900000, polling: 200 },
  )
  // Let the last frame present before capturing it.
  await sleep(250)
  return Date.now() - t
}

async function v2State(page) {
  return page.evaluate(() => {
    const f = window.__worldFrame
    const boxes = window.__worldLabelBoxes ? window.__worldLabelBoxes() : []
    const overlaps = []
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]
        const b = boxes[j]
        if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) overlaps.push(`${a.name} x ${b.name}`)
      }
    const offscreen = boxes.filter((b) => b.left < 0 || b.top < 0 || b.right > innerWidth || b.bottom > innerHeight).map((b) => b.name)
    return {
      depth: f.depth,
      parkProgress: f.parkProgress,
      triangles: f.triangles,
      calls: f.calls,
      markersVisible: f.markers.filter((m) => m.visible).map((m) => m.id),
      markers: f.markers.map((m) => ({ id: m.id, x: Math.round(m.x), y: Math.round(m.y), xPct: +((100 * m.x) / innerWidth).toFixed(1), visible: m.visible })),
      textLabels: boxes.map((b) => b.name),
      labelOverlaps: overlaps,
      labelsOffscreen: offscreen,
      scrollY: window.scrollY,
      camera: window.__worldCamera(),
      frameCount: window.__worldFrameCount,
    }
  })
}

async function waitClosed(page) {
  await page.waitForFunction(
    () => !document.querySelector('main[data-open]') && window.__worldFrame && window.__worldFrame.parkProgress === 0 && document.body.style.overflow !== 'hidden',
    { timeout: 900000, polling: 200 },
  )
  await sleep(300)
}

async function runV2(browser, vp, R) {
  const { page, errors, warnings, noise, api, assets } = await openPage(browser, vp, '/dev/world-v2')
  const V = (R.v2 = { errors, warnings, noise, api, assets, stops: [], park: {} })
  try {
    log(`[v2 ${vp.name}] loading`)
    const tLoad = Date.now()
    await page.waitForFunction(
      () => window.__worldReady === true || typeof window.__worldError === 'string' || window.__worldView === 'list',
      { timeout: 300000, polling: 250 },
    )
    const boot = await page.evaluate(() => ({ ready: window.__worldReady, error: window.__worldError ?? null, asset: window.__worldAsset, view: window.__worldView, landmarks: window.__worldLandmarks }))
    V.boot = { ...boot, loadMs: Date.now() - tLoad }
    log(`[v2 ${vp.name}] ready in ${V.boot.loadMs} ms, asset ${boot.asset}, view ${boot.view}`)
    if (!boot.ready) throw new Error(`v2 did not load: ${boot.error ?? boot.view}`)

    // Default view: the shore, as a student first sees it.
    await v2Settle(page, 0)
    await page.evaluate(() => document.fonts.ready)
    await sleep(3000)
    V.words = await page.evaluate(countWords)
    V.default = await v2State(page)
    await shot(page, `v2-${vp.name}-default.png`)
    log(`[v2 ${vp.name}] default: ${V.words.words} words, ${V.default.triangles} tris`)

    const doStop = async (id, d) => {
      const ms = await v2Settle(page, d)
      const st = await v2State(page)
      const fps = await frameStats(page)
      const file = await shot(page, `v2-${vp.name}-${id}-d${fmtD(d)}.png`)
      V.stops.push({ id, depth: d, settleMs: ms, frameInterval: fps, file: path.basename(file), ...st })
      log(`[v2 ${vp.name}] ${id} d=${d}: ${st.triangles} tris, ${st.calls} calls, labels [${st.textLabels.join(', ')}], overlaps ${st.labelOverlaps.length}, frame ${fps?.medianMs} ms`)
    }

    for (const [id, d] of V2_STOPS) {
      await doStop(id, d)
      if (id !== PARK_ID) continue

      // ── Park, cycle 1: WALL clock, frames run free.
      const before1 = await v2State(page)
      const tCall = await page.evaluate((pid) => {
        const t = performance.now()
        window.__gate.start(t)
        window.__worldPark(pid)
        return t
      }, PARK_ID)
      const wall0 = Date.now()
      const wallShots = []
      for (const ms of SHOT_MS) {
        const wait = wall0 + ms - Date.now()
        if (wait > 0) await sleep(wait)
        const pre = await page.evaluate(() => ({ p: window.__worldFrame.parkProgress, clock: window.__gate.clock, pageMs: performance.now() - window.__gate.t0, n: window.__worldFrameCount }))
        const file = await shot(page, `v2-${vp.name}-park-${PARK_ID}-wall-${fmtMs(ms)}.png`)
        const post = await page.evaluate(() => ({ p: window.__worldFrame.parkProgress, clock: window.__gate.clock, pageMs: performance.now() - window.__gate.t0, n: window.__worldFrameCount }))
        wallShots.push({ targetWallMs: ms, file: path.basename(file), before: pre, after: post })
        log(`[v2 ${vp.name}] wall ${ms} ms: p ${pre.p.toFixed(3)}..${post.p.toFixed(3)}, scene ${Math.round(pre.clock * 1000)}..${Math.round(post.clock * 1000)} ms`)
      }
      await page.waitForFunction(() => window.__worldFrame && window.__worldFrame.parkProgress === 1, { timeout: 900000, polling: 100 })
      await sleep(300)
      const rows1 = await page.evaluate(() => window.__gate.rows.slice())
      await page.evaluate(() => window.__gate.stop())
      const arrive = rows1.find((r) => r.p === 1)
      // Flight duration T from each mid-flight frame: parkProgress = smoother(sceneTime / T).
      const Ts = rows1.filter((r) => r.p > 0.02 && r.p < 0.98).map((r) => r.clock / invSmoother(r.p)).sort((a, b) => a - b)
      const parked1 = await v2State(page)
      const arrivedShot = await shot(page, `v2-${vp.name}-park-${PARK_ID}-arrived.png`)
      const panel = await page.evaluate(() => {
        const el = document.querySelector('section[aria-labelledby="v2-panel-title"]')
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { left: r.left, right: r.right, transform: el.style.transform, opacity: el.style.opacity }
      })
      const a3Marker = parked1.markersVisible.includes(PARK_ID)

      // Unpark, cycle 1.
      const tBack = Date.now()
      await page.evaluate(() => {
        window.__gate.start(performance.now())
        window.__worldPark(null)
      })
      await waitClosed(page)
      const rowsBack1 = await page.evaluate(() => window.__gate.rows.slice())
      await page.evaluate(() => window.__gate.stop())
      const after1 = await v2State(page)
      const home1 = rowsBack1.find((r) => r.p === 0)
      V.park.wall = {
        callPageMs: tCall,
        shots: wallShots,
        arrival: arrive ? { sceneMs: Math.round(arrive.clock * 1000), wallMs: Math.round(arrive.t), frames: rows1.indexOf(arrive) + 1 } : null,
        flightT: Ts.length ? { medianS: Ts[Ts.length >> 1], minS: Ts[0], maxS: Ts[Ts.length - 1], samples: Ts.length } : null,
        frameRows: rows1,
        parkedCamera: parked1.camera,
        cameraMoved: camDelta(before1.camera, parked1.camera),
        panel,
        a3MarkerInFrame: a3Marker,
        a3MarkerAt: parked1.markers.find((m) => m.id === PARK_ID) ?? null,
        arrivedFile: path.basename(arrivedShot),
        back: {
          wallMs: Date.now() - tBack,
          sceneMs: home1 ? Math.round(home1.clock * 1000) : null,
          frames: home1 ? rowsBack1.indexOf(home1) + 1 : null,
        },
        scrollBefore: before1.scrollY,
        scrollAfter: after1.scrollY,
        scrollRestored: before1.scrollY === after1.scrollY,
        cameraReturn: camDelta(before1.camera, after1.camera),
        depthBefore: before1.depth,
        depthAfter: after1.depth,
      }
      log(`[v2 ${vp.name}] park wall cycle: arrived at scene ${V.park.wall.arrival?.sceneMs} ms / wall ${V.park.wall.arrival?.wallMs} ms in ${V.park.wall.arrival?.frames} frames; T median ${V.park.wall.flightT?.medianS?.toFixed(3)} s; scrollY ${before1.scrollY} -> ${after1.scrollY}`)

      // ── Park, cycle 2: SCENE clock, frames held at each target.
      const before2 = await v2State(page)
      await page.evaluate(() => window.__gate.hold())
      await page.evaluate((pid) => {
        window.__gate.start(performance.now())
        window.__worldPark(pid)
      }, PARK_ID)
      await sleep(400) // React commits the panel; no frame runs while held.
      const sceneShots = []
      for (const ms of SHOT_MS) {
        if (ms > 0) {
          await page.evaluate((s) => {
            window.__gate.holdAt = s
            window.__gate.release()
          }, ms / 1000)
          // Past arrival the scene sleeps, so the clock can stop short of the target; arrival counts.
          await page.waitForFunction(() => window.__gate.held || (window.__worldFrame && window.__worldFrame.parkProgress === 1), { timeout: 900000, polling: 50 })
          await sleep(300)
          await page.evaluate(() => window.__gate.hold())
        }
        const st = await page.evaluate(() => ({ p: window.__worldFrame.parkProgress, sceneMs: Math.round(window.__gate.clock * 1000), camera: window.__worldCamera(), n: window.__worldFrameCount }))
        const file = await shot(page, `v2-${vp.name}-park-${PARK_ID}-scene-${fmtMs(ms)}.png`)
        sceneShots.push({ targetSceneMs: ms, file: path.basename(file), ...st })
        log(`[v2 ${vp.name}] scene ${ms} ms: landed at ${st.sceneMs} ms, p ${st.p.toFixed(4)}`)
      }
      await page.evaluate(() => {
        window.__gate.stop()
        window.__gate.release()
      })
      await page.waitForFunction(() => window.__worldFrame.parkProgress === 1, { timeout: 900000, polling: 100 })
      await page.evaluate(() => {
        window.__gate.start(performance.now())
        window.__worldPark(null)
      })
      await waitClosed(page)
      await page.evaluate(() => window.__gate.stop())
      const after2 = await v2State(page)
      await shot(page, `v2-${vp.name}-park-${PARK_ID}-returned.png`)
      V.park.scene = {
        shots: sceneShots,
        scrollBefore: before2.scrollY,
        scrollAfter: after2.scrollY,
        scrollRestored: before2.scrollY === after2.scrollY,
        cameraReturn: camDelta(before2.camera, after2.camera),
      }
      log(`[v2 ${vp.name}] park scene cycle: scrollY ${before2.scrollY} -> ${after2.scrollY}`)
    }
  } finally {
    await page.close()
  }
}

// ── codex (Astra) ───────────────────────────────────────────────────────────

async function codexSettle(page, frac) {
  const t = Date.now()
  await page.evaluate((f) => window.scrollTo(0, Math.round(f * (document.documentElement.scrollHeight - innerHeight))), frac)
  await page.waitForFunction(
    (f) => {
      const d = Number(document.documentElement.dataset.codexDepth)
      const max = document.documentElement.scrollHeight - innerHeight
      const target = Math.min(1, Math.max(0, window.scrollY / Math.max(1, max)))
      return Number.isFinite(d) && Math.abs(d - target) <= 0.0005 && Math.abs(target - f) < 0.01
    },
    { timeout: 900000, polling: 200 },
    frac,
  )
  // Its damping is exponential and never snaps: run 40 more frames (2 s of scene time, residual e^-12).
  const n0 = await page.evaluate(() => window.__gate.frames)
  await page.waitForFunction((n) => window.__gate.frames >= n + 40, { timeout: 900000, polling: 200 }, n0)
  await sleep(250)
  return Date.now() - t
}

async function codexState(page) {
  return page.evaluate(() => {
    const ds = document.documentElement.dataset
    const markers = [...document.querySelectorAll('[id^="codex-area-"]')].filter((b) => getComputedStyle(b).visibility !== 'hidden' && b.id !== 'codex-area-title')
    return {
      depth: Number(ds.codexDepth),
      triangles: Number(ds.codexTriangles),
      calls: Number(ds.codexDrawCalls),
      markersVisible: markers.map((b) => b.getAttribute('aria-label')?.split(',')[0]),
      scrollY: window.scrollY,
    }
  })
}

async function runCodex(browser, vp, R) {
  const { page, errors, warnings, noise, api } = await openPage(browser, vp, '/dev/world-codex')
  const C = (R.codex = { errors, warnings, noise, api, stops: [], park: null })
  try {
    log(`[codex ${vp.name}] loading`)
    const tLoad = Date.now()
    await page.waitForSelector('main[data-ready="true"]', { timeout: 300000 })
    C.loadMs = Date.now() - tLoad
    await codexSettle(page, 0)
    await page.evaluate(() => document.fonts.ready)
    await sleep(3000)
    C.words = await page.evaluate(countWords)
    await shot(page, `codex-${vp.name}-default.png`)
    log(`[codex ${vp.name}] ready in ${C.loadMs} ms, ${C.words.words} words`)

    for (const [id, frac, idx] of CODEX_STOPS) {
      const ms = await codexSettle(page, frac)
      const st = await codexState(page)
      const fps = await frameStats(page)
      const file = await shot(page, `codex-${vp.name}-${id}-d${fmtD(frac)}.png`)
      C.stops.push({ id, depth: frac, settleMs: ms, frameInterval: fps, file: path.basename(file), ...st })
      log(`[codex ${vp.name}] ${id} d=${frac}: ${st.triangles} tris, ${st.calls} calls, frame ${fps?.medianMs} ms`)

      if (idx !== PARK_CODEX_INDEX) continue
      // Park at area 3 on the scene clock. Its panel mounts at full size on click (no CSS entry
      // animation), and its camera eases in by exponential damping, so frame holds show it truly.
      const before = await codexState(page)
      await page.evaluate(() => window.__gate.hold())
      await page.evaluate((i) => {
        window.__gate.start(performance.now())
        document.getElementById(`codex-area-${i}`).click()
      }, PARK_CODEX_INDEX)
      await sleep(400)
      const shots = []
      for (const t of SHOT_MS) {
        if (t > 0) {
          await page.evaluate((s) => {
            window.__gate.holdAt = s
            window.__gate.release()
          }, t / 1000)
          await page.waitForFunction(() => window.__gate.held, { timeout: 900000, polling: 50 })
          await sleep(300)
        }
        const sceneMs = await page.evaluate(() => Math.round(window.__gate.clock * 1000))
        const file = await shot(page, `codex-${vp.name}-park-a3-scene-${fmtMs(t)}.png`)
        shots.push({ targetSceneMs: t, sceneMs, file: path.basename(file) })
        log(`[codex ${vp.name}] scene ${t} ms: landed at ${sceneMs} ms`)
      }
      await page.evaluate(() => {
        window.__gate.stop()
        window.__gate.release()
      })
      await page.keyboard.press('Escape')
      const n0 = await page.evaluate(() => window.__gate.frames)
      await page.waitForFunction((n) => window.__gate.frames >= n + 45, { timeout: 900000, polling: 200 }, n0)
      const after = await codexState(page)
      C.park = { shots, scrollBefore: before.scrollY, scrollAfter: after.scrollY }
    }
  } finally {
    await page.close()
  }
}

// ── Sheets ───────────────────────────────────────────────────────────────────

/** Compose screenshots into one grid PNG, in the browser (no image library needed). */
async function sheet(browser, items, cols, scale, outName) {
  const present = items.filter((it) => fs.existsSync(path.join(OUT, it.file)))
  if (!present.length) return null
  const page = await browser.newPage()
  try {
    const srcs = present.map((it) => 'data:image/png;base64,' + fs.readFileSync(path.join(OUT, it.file)).toString('base64'))
    await page.setContent('<html><body style="margin:0;background:#111"></body></html>')
    const dataUrl = await page.evaluate(
      async (srcs, captions, cols, scale) => {
        const imgs = await Promise.all(
          srcs.map((s) => new Promise((res, rej) => {
            const i = new Image()
            i.onload = () => res(i)
            i.onerror = rej
            i.src = s
          })),
        )
        const cw = Math.round(Math.max(...imgs.map((i) => i.width)) * scale)
        const ch = Math.round(Math.max(...imgs.map((i) => i.height)) * scale)
        const cap = 30
        const rows = Math.ceil(imgs.length / cols)
        const c = document.createElement('canvas')
        c.width = cw * cols
        c.height = (ch + cap) * rows
        const g = c.getContext('2d')
        g.fillStyle = '#111'
        g.fillRect(0, 0, c.width, c.height)
        imgs.forEach((img, k) => {
          const x = (k % cols) * cw
          const y = Math.floor(k / cols) * (ch + cap)
          g.fillStyle = '#eee'
          g.font = '18px monospace'
          g.fillText(captions[k], x + 10, y + 21)
          g.drawImage(img, x, y + cap, img.width * scale, img.height * scale)
        })
        return c.toDataURL('image/png')
      },
      srcs,
      present.map((it) => it.caption),
      cols,
      scale,
    )
    const out = path.join(OUT, outName)
    fs.writeFileSync(out, Buffer.from(dataUrl.split(',')[1], 'base64'))
    return out
  } finally {
    await page.close()
  }
}

async function sheets(browser, vp, R) {
  const cols = vp.name === 'ultra' ? 1 : 2
  const scale = vp.name === 'ultra' ? 0.4 : 0.5
  const made = []
  for (let k = 0; k < V2_STOPS.length; k++) {
    const [id, d] = V2_STOPS[k]
    const [, f] = CODEX_STOPS[k]
    const out = await sheet(
      browser,
      [
        { file: `v2-${vp.name}-${id}-d${fmtD(d)}.png`, caption: `v2 ${id} depth ${d}` },
        { file: `codex-${vp.name}-${id}-d${fmtD(f)}.png`, caption: `Astra ${id} depth ${f}` },
      ],
      cols,
      scale,
      `pair-${vp.name}-${id}.png`,
    )
    if (out) made.push(path.basename(out))
  }
  for (const who of ['v2', 'codex']) {
    const out = await sheet(
      browser,
      SHOT_MS.map((ms) => ({ file: `${who}-${vp.name}-park-a3-scene-${fmtMs(ms)}.png`, caption: `${who === 'v2' ? 'v2' : 'Astra'} park a3, scene ${ms} ms` })),
      2,
      vp.name === 'ultra' ? 0.3 : 0.4,
      `${who}-${vp.name}-park-a3-scene-sheet.png`,
    )
    if (out) made.push(path.basename(out))
  }
  const out = await sheet(
    browser,
    SHOT_MS.map((ms) => ({ file: `v2-${vp.name}-park-a3-wall-${fmtMs(ms)}.png`, caption: `v2 park a3, wall ${ms} ms` })),
    2,
    vp.name === 'ultra' ? 0.3 : 0.4,
    `v2-${vp.name}-park-a3-wall-sheet.png`,
  )
  if (out) made.push(path.basename(out))
  R.sheets = made
}

// ── Main ─────────────────────────────────────────────────────────────────────

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  protocolTimeout: 900000,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
})
let failed = false
try {
  for (const vp of VIEWPORTS) {
    const R = { viewport: vp, base: BASE, when: new Date().toISOString() }
    const glb = path.join(ROOT, 'public', 'world-v2', 'world.glb')
    R.glbBytes = fs.existsSync(glb) ? fs.statSync(glb).size : null
    try {
      if (!SKIP_V2) await runV2(browser, vp, R)
      if (!SKIP_CODEX) await runCodex(browser, vp, R)
      await sheets(browser, vp, R)
    } catch (e) {
      failed = true
      R.fatal = String(e && e.stack ? e.stack : e)
      log(`[${vp.name}] FAILED: ${R.fatal}`)
    }
    fs.writeFileSync(path.join(OUT, `v2-render-${vp.name}.json`), JSON.stringify(R, null, 2))
    log(`[${vp.name}] wrote v2-render-${vp.name}.json`)
    const v = R.v2
    if (v) {
      log(`[${vp.name}] v2 console errors ${v.errors.length}, warnings ${v.warnings.length}, /api/ requests ${v.api.length}`)
    }
    if (R.codex) log(`[${vp.name}] codex console errors ${R.codex.errors.length}, /api/ requests ${R.codex.api.length}`)
  }
} finally {
  await browser.close()
}
process.exit(failed ? 1 : 0)
