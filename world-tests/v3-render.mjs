/**
 * Render /dev/world-v3 for real in headless Chrome so somebody can LOOK at it.
 * A lean copy of v2-render.mjs for the V3 integration pass.
 *
 *   node world-tests/v3-render.mjs                     # split: default, a1 a3 a5 a8, parks a3 + a5
 *   node world-tests/v3-render.mjs --vp ultra          # 3428x1230 default only
 *   node world-tests/v3-render.mjs --vp small          # 960x600, everything (quick iteration)
 *   node world-tests/v3-render.mjs --no-parks          # stops only
 *   node world-tests/v3-render.mjs --stops a3,a5       # a subset of stops
 *   node world-tests/v3-render.mjs --tag x             # file prefix
 *
 * Needs the dev server on BASE_URL (default http://localhost:3111). Writes
 * PNGs and v3-render-<vp>.json into world-tests/shots/v3/integrate/.
 *
 * What it records: load-to-ready (navigation start to __worldReady, page
 * clock), the scene's module install report, long tasks on the main thread
 * during load, triangles and draw calls per stop, label overlaps, parks at a3
 * and a5 on arrival with the scrollY restore after unpark, console errors,
 * warnings and /api/ requests.
 *
 * V3 animates (water, sails, birds, smoke, sway), so the loop never sleeps at
 * most stops: SwiftShader keeps drawing and every wait below is a real wait.
 * Never --virtual-time-budget.
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.BASE_URL || 'http://localhost:3111'
const OUT = process.env.OUT_DIR || path.join(HERE, 'shots', 'v3', 'integrate')

const VIEWPORTS = {
  split: { name: 'split', width: 1691, height: 1278 },
  ultra: { name: 'ultra', width: 3428, height: 1230 },
  small: { name: 'small', width: 960, height: 600 },
}
const ALL_STOPS = [['a1', 0.0708], ['a3', 0.30], ['a5', 0.5236], ['a8', 0.8302]]
const STOP_DEPTH = { a1: 0.0708, a2: 0.1934, a3: 0.30, a4: 0.4151, a5: 0.5236, a6: 0.6321, a7: 0.6863, a8: 0.8302 }

const args = process.argv.slice(2)
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d)
const vp = VIEWPORTS[arg('--vp', 'split')]
if (!vp) throw new Error('unknown --vp')
const TAG = arg('--tag', 'v3')
const QUERY = arg('--query', '')
const ULTRA_ONLY_DEFAULT = vp.name === 'ultra' && !args.includes('--all')
const STOPS = arg('--stops', null) ? ALL_STOPS.filter(([id]) => arg('--stops').split(',').includes(id)) : ALL_STOPS
const PARKS = args.includes('--no-parks') || ULTRA_ONLY_DEFAULT ? [] : arg('--parks', 'a3,a5').split(',').filter(Boolean)

fs.mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

/** Injected before any page script: frame timestamps and long tasks. */
function installProbe() {
  const real = window.requestAnimationFrame.bind(window)
  const P = { times: [], longTasks: [] }
  window.__probe = P
  window.requestAnimationFrame = function (cb) {
    return real((t) => {
      if (P.times[P.times.length - 1] !== t) {
        P.times.push(t)
        if (P.times.length > 400) P.times.shift()
      }
      cb(t)
    })
  }
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) P.longTasks.push({ start: Math.round(e.startTime), ms: Math.round(e.duration) })
    }).observe({ type: 'longtask', buffered: true })
  } catch {}
  // Page-clock time of the first moment __worldReady is true.
  let ready = false
  Object.defineProperty(window, '__worldReady', {
    configurable: true,
    get: () => ready,
    set: (v) => {
      if (v && !ready) P.readyAt = performance.now()
      ready = v
    },
  })
}

function countWords() {
  const words = []
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
    words.push(...t.split(/\s+/).filter((x) => /[A-Za-z]/.test(x)))
    lines.push(t)
  }
  return { words: words.length, lines }
}

async function settle(page, depth) {
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
  // Two more drawn frames so the settled pose is what is on the canvas.
  const n0 = await page.evaluate(() => window.__worldFrameCount)
  await page.waitForFunction((n) => window.__worldFrameCount >= n + 1, { timeout: 60000, polling: 100 }, n0).catch(() => {})
  await sleep(250)
  return Date.now() - t
}

async function state(page) {
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
    const t = window.__probe.times.slice(-20)
    const d = []
    for (let i = 1; i < t.length; i++) d.push(t[i] - t[i - 1])
    d.sort((a, b) => a - b)
    return {
      depth: f.depth,
      parkProgress: f.parkProgress,
      triangles: f.triangles,
      calls: f.calls,
      markersVisible: f.markers.filter((m) => m.visible).map((m) => m.id),
      textLabels: boxes.map((b) => b.name),
      labelOverlaps: overlaps,
      scrollY: window.scrollY,
      camera: window.__worldCamera(),
      frameCount: window.__worldFrameCount,
      frameMedianMs: d.length ? Math.round(d[d.length >> 1]) : null,
      parkInfo: window.__worldParkInfo ? window.__worldParkInfo() : null,
    }
  })
}

async function shot(page, name) {
  const file = path.join(OUT, name)
  await page.screenshot({ path: file })
  return path.basename(file)
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  protocolTimeout: 900000,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
})
const R = { viewport: vp, base: BASE, query: QUERY, when: new Date().toISOString(), stops: [], parks: [] }
let failed = false
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(600000)
  const errors = []
  const warnings = []
  const infos = []
  const api = []
  let noise = 0
  page.on('console', (m) => {
    const t = m.text()
    if (/GPU stall|GL Driver Message|WebGL-|swiftshader|Automatic fallback to software WebGL/i.test(t)) return void noise++
    if (m.type() === 'error') errors.push(t)
    else if (m.type() === 'warning' || m.type() === 'warn') warnings.push(t)
    else if (/world-v3/.test(t)) infos.push(t)
  })
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))
  page.on('requestfailed', (r) => {
    const u = r.url()
    if (!/_next\/webpack-hmr|__nextjs/.test(u)) errors.push(`[requestfailed] ${u} ${r.failure()?.errorText ?? ''}`)
  })
  page.on('request', (r) => {
    if (/\/api\//.test(new URL(r.url()).pathname)) api.push(`${r.method()} ${r.url()}`)
  })
  Object.assign(R, { errors, warnings, infos, api })
  await page.evaluateOnNewDocument(installProbe)
  await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1 })
  log(`[${vp.name}] loading /dev/world-v3${QUERY}`)
  const tNav = Date.now()
  await page.goto(`${BASE}/dev/world-v3${QUERY}`, { waitUntil: 'domcontentloaded', timeout: 180000 })
  await page.waitForFunction(() => window.__worldReady === true || typeof window.__worldError === 'string' || window.__worldView === 'list', { timeout: 300000, polling: 100 })
  const boot = await page.evaluate(() => {
    const dbg = window.__worldV3Debug
    let mods = null
    try {
      mods = dbg && dbg.moduleStats ? dbg.moduleStats() : null
    } catch (e) {
      mods = String(e)
    }
    return {
      ready: window.__worldReady,
      error: window.__worldError ?? null,
      view: window.__worldView,
      pitch: window.__worldPitch,
      readyAtPageMs: Math.round(window.__probe.readyAt ?? -1),
      longTasks: window.__probe.longTasks.slice(),
      modules: mods,
    }
  })
  R.boot = { ...boot, wallMsFromGoto: Date.now() - tNav }
  const lt = boot.longTasks.filter((x) => x.start <= boot.readyAtPageMs + 50)
  R.boot.longTaskSumMs = lt.reduce((s, x) => s + x.ms, 0)
  R.boot.longTaskMaxMs = lt.reduce((s, x) => Math.max(s, x.ms), 0)
  log(`[${vp.name}] ready at page ${boot.readyAtPageMs} ms (wall ${R.boot.wallMsFromGoto} ms), long tasks before ready: ${lt.length}, sum ${R.boot.longTaskSumMs} ms, max ${R.boot.longTaskMaxMs} ms`)
  log(`[${vp.name}] modules`, JSON.stringify(boot.modules?.install ?? boot.modules))
  if (!boot.ready) throw new Error(`v3 did not load: ${boot.error ?? boot.view}`)

  await settle(page, 0)
  await page.evaluate(() => document.fonts.ready)
  await sleep(1500)
  R.words = await page.evaluate(countWords)
  R.default = await state(page)
  R.default.file = await shot(page, `${TAG}-${vp.name}-default.png`)
  log(`[${vp.name}] default: ${R.default.triangles} tris, ${R.default.calls} calls, ${R.words.words} words, overlaps ${R.default.labelOverlaps.length}, frame ${R.default.frameMedianMs} ms`)

  if (!ULTRA_ONLY_DEFAULT) {
    for (const [id, d] of STOPS) {
      const ms = await settle(page, d)
      const st = await state(page)
      st.file = await shot(page, `${TAG}-${vp.name}-${id}.png`)
      R.stops.push({ id, settleMs: ms, ...st })
      log(`[${vp.name}] ${id}: ${st.triangles} tris, ${st.calls} calls, labels [${st.textLabels.join(', ')}], overlaps ${st.labelOverlaps.length}, frame ${st.frameMedianMs} ms`)
    }
  }

  for (const id of PARKS) {
    await settle(page, STOP_DEPTH[id])
    const before = await state(page)
    const t0 = Date.now()
    await page.evaluate((pid) => window.__worldPark(pid), id)
    await page.waitForFunction(() => window.__worldFrame && window.__worldFrame.parkProgress === 1, { timeout: 900000, polling: 100 })
    const n0 = await page.evaluate(() => window.__worldFrameCount)
    await page.waitForFunction((n) => window.__worldFrameCount >= n + 1, { timeout: 60000, polling: 100 }, n0).catch(() => {})
    await sleep(600)
    const arrived = await state(page)
    arrived.file = await shot(page, `${TAG}-${vp.name}-park-${id}-arrived.png`)
    const flyMs = Date.now() - t0
    const panel = await page.evaluate(() => {
      const el = document.querySelector('section[aria-labelledby="v2-panel-title"]')
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { left: Math.round(r.left), right: Math.round(r.right), title: document.getElementById('v2-panel-title')?.textContent ?? null }
    })
    await page.evaluate(() => window.__worldPark(null))
    await page.waitForFunction(
      () => !document.querySelector('main[data-open]') && window.__worldFrame && window.__worldFrame.parkProgress === 0 && document.body.style.overflow !== 'hidden',
      { timeout: 900000, polling: 200 },
    )
    await sleep(400)
    const after = await state(page)
    R.parks.push({
      id,
      flyWallMs: flyMs,
      panel,
      arrived,
      scrollBefore: before.scrollY,
      scrollAfter: after.scrollY,
      scrollRestored: before.scrollY === after.scrollY,
      depthBefore: before.depth,
      depthAfter: after.depth,
    })
    log(`[${vp.name}] park ${id}: ${arrived.triangles} tris, ${arrived.calls} calls, panel ${panel?.title}, scrollY ${before.scrollY} -> ${after.scrollY}, info ${JSON.stringify(arrived.parkInfo)}`)
  }
  R.noise = noise
  await page.close()
} catch (e) {
  failed = true
  R.fatal = String(e && e.stack ? e.stack : e)
  log(`FAILED: ${R.fatal}`)
} finally {
  await browser.close()
}
fs.writeFileSync(path.join(OUT, `${TAG}-render-${vp.name}.json`), JSON.stringify(R, null, 2))
log(`[${vp.name}] console errors ${R.errors?.length}, warnings ${R.warnings?.length}, /api/ ${R.api?.length}`)
for (const e of R.errors ?? []) log('  ERROR', e.slice(0, 300))
for (const w of [...new Set(R.warnings ?? [])]) log('  WARN', w.slice(0, 200))
process.exit(failed ? 1 : 0)
