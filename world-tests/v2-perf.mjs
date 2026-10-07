/**
 * Performance and load verification: /dev/world-v2 against /dev/world-codex.
 *
 *   node world-tests/v2-perf.mjs                               # every section
 *   node world-tests/v2-perf.mjs --only load --runs 3          # one section
 *   node world-tests/v2-perf.mjs --only sweep --vp split,ultra
 *
 * Sections (comma list for --only): load, profile, sweep, idle, scroll.
 * Writes JSON (and a few PNGs) to world-tests/shots/v2-verify/perf/.
 *
 * Headless Chrome draws with SwiftShader, so wall-clock frame rates here are
 * not GPU numbers. What this measures is RELATIVE to Astra's build on the same
 * machine in the same run, plus main-thread costs that do not depend on the
 * GPU (JS in the load callback, per-frame JS allocation, per-frame layout).
 *
 * load     cold loads (cache disabled, fresh browser context), interleaved
 *          v2/codex: navigation -> ready flag -> first world frame, FCP, every
 *          long task and long animation frame (with script attribution),
 *          WebGL program link + sync-wait time, network bytes per request.
 * profile  one CPU profile per build over the load (100 us sampling): the
 *          busy stretches of the main thread and what is inside them
 *          (adopt, instanceRepeats, simplifyForDistance, buildHeightfield...).
 * sweep    triangles and draw calls on every scene frame of a slow pass along
 *          the whole rail, at the 8 area stops, and through a park flight to
 *          each of the 8 places and back. Astra's rail for reference.
 * idle     after the scene settles: 3 s of nothing, counting WebGL draw calls,
 *          scene frames, rAF callbacks, and Paint/Layout/style events in a
 *          Chrome trace. Default view, a3, a8, parked, after unpark, after a
 *          resize, after hovering a marker.
 * scroll   a synthetic scroll gesture over ~0.4 of the rail: Chrome trace
 *          (Layout / UpdateLayoutTree / forced layouts per frame, JS ms per
 *          frame), then a sampling heap profile that keeps objects later
 *          collected by GC (bytes allocated per frame, by function), plus
 *          performance.memory deltas around a forced GC.
 *
 * Needs the dev server on BASE_URL (default http://localhost:3111).
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import zlib from 'node:zlib'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.BASE_URL || 'http://localhost:3111'
const OUT = process.env.OUT_DIR || path.join(HERE, 'shots', 'v2-verify', 'perf')
const RAW = path.join(OUT, 'raw')

const VPS = {
  split: { w: 1691, h: 1278 },
  ultra: { w: 3428, h: 1230 },
  laptop: { w: 1440, h: 900 },
}
const AREAS = [
  ['a1', 0.0708],
  ['a2', 0.1934],
  ['a3', 0.3],
  ['a4', 0.4151],
  ['a5', 0.5236],
  ['a6', 0.6321],
  ['a7', 0.6863],
  ['a8', 0.8302],
]
const MAX_DEPTH = 0.88
const ROUTE = { v2: '/dev/world-v2', codex: '/dev/world-codex' }
const V2_FILES = [
  'src/lib/world-v2/scene.ts',
  'src/lib/world-v2/rail.ts',
  'src/lib/world-v2/heightfield.ts',
  'src/lib/world-v2/trees.ts',
  'src/lib/world-v2/study.ts',
  'src/components/world-v2/WorldV2.tsx',
  'src/components/world-v2/labels.ts',
  'src/components/world-v2/world.module.css',
  'src/app/dev/world-v2/page.tsx',
  'public/world-v2/world.glb',
]

const argv = process.argv.slice(2)
const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d)
const ONLY = arg('--only', 'load,profile,sweep,idle,scroll').split(',')
const VP_LIST = arg('--vp', null)
const RUNS = Number(arg('--runs', '2'))
const SWEEP_TAG = arg('--tag', '') ? `-${arg('--tag', '')}` : ''

fs.mkdirSync(RAW, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const r1 = (x) => (x == null ? x : Math.round(x * 10) / 10)
const median = (a) => {
  const s = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y)
  if (!s.length) return null
  return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}
const save = (name, obj) => {
  const f = path.join(OUT, name)
  fs.writeFileSync(f, JSON.stringify(obj, null, 1))
  log('wrote', path.relative(ROOT, f))
  return f
}
function fileHashes() {
  const out = {}
  for (const f of V2_FILES) {
    const p = path.join(ROOT, f)
    try {
      const b = fs.readFileSync(p)
      out[f] = { sha: crypto.createHash('sha256').update(b).digest('hex').slice(0, 16), mtime: fs.statSync(p).mtime.toISOString(), bytes: b.length }
    } catch {
      out[f] = null
    }
  }
  return out
}
const env = () => ({ at: new Date().toISOString(), load: os.loadavg().map((x) => +x.toFixed(2)), files: fileHashes() })

// ── In-page instrumentation ──────────────────────────────────────────────────

/** Injected before any page script. opts: { gl, raf }. Fixed-arity wrappers so the draw hooks allocate nothing. */
function perfInit(opts) {
  const now = () => performance.now()
  const P = (window.__perf = {
    opts,
    lt: [],
    loaf: [],
    marks: {},
    bursts: [],
    draws: 0,
    contexts: 0,
    gl: { syncMs: 0, syncCalls: 0, linkMs: 0, programs: 0 },
    raf: { req: 0, run: 0 },
    ticks: 0,
  })
  if (opts.obs !== false) try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) P.lt.push({ s: +e.startTime.toFixed(1), d: +e.duration.toFixed(1) })
    }).observe({ type: 'longtask', buffered: true })
  } catch (e) {
    P.ltErr = String(e)
  }
  if (opts.obs !== false) try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        const end = e.startTime + e.duration
        P.loaf.push({
          s: +e.startTime.toFixed(1),
          d: +e.duration.toFixed(1),
          block: +(e.blockingDuration || 0).toFixed(1),
          renderMs: e.renderStart ? +(end - e.renderStart).toFixed(1) : 0,
          styleLayoutMs: e.styleAndLayoutStart ? +(end - e.styleAndLayoutStart).toFixed(1) : 0,
          scripts: (e.scripts || [])
            .map((sc) => ({
              d: +sc.duration.toFixed(1),
              fn: sc.sourceFunctionName || '',
              src: (sc.sourceURL || '').split('/').pop().slice(0, 90),
              inv: String(sc.invoker || '').slice(0, 80),
              forced: +(sc.forcedStyleAndLayoutDuration || 0).toFixed(1),
            }))
            .sort((a, b) => b.d - a.d)
            .slice(0, 5),
        })
      }
    }).observe({ type: 'long-animation-frame', buffered: true })
  } catch (e) {
    P.loafErr = String(e)
  }
  // v2's ready flag. On Window.prototype so the page's own `delete window.__worldReady`
  // (effect cleanup, run once by StrictMode in dev) cannot remove the hook.
  let ready
  try {
    Object.defineProperty(Object.getPrototypeOf(window), '__worldReady', {
      configurable: true,
      get() {
        return ready
      },
      set(v) {
        ready = v
        if (v === true && P.marks.ready == null) P.marks.ready = now()
      },
    })
  } catch (e) {
    P.readyErr = String(e)
  }
  // Astra's ready flag: main[data-ready="true"].
  if (location.pathname.includes('codex')) {
    const mo = new MutationObserver(() => {
      if (P.marks.ready == null && document.querySelector('main[data-ready="true"]')) {
        P.marks.ready = now()
        mo.disconnect()
      }
    })
    mo.observe(document, { subtree: true, attributes: true, attributeFilter: ['data-ready'] })
  }
  const gc = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = function (a, b) {
    if (/webgl/.test(a)) P.contexts++
    return gc.call(this, a, b)
  }
  if (opts.gl) {
    let inBurst = false
    let bStart = 0
    let bCount = 0
    const endBurst = () => {
      P.bursts.push({ s: +bStart.toFixed(1), e: +now().toFixed(1), n: bCount })
      if (P.bursts.length > 6000) P.bursts.splice(0, 1000)
      inBurst = false
    }
    const hit = () => {
      P.draws++
      if (!inBurst) {
        inBurst = true
        bStart = now()
        bCount = 0
        queueMicrotask(endBurst)
      }
      bCount++
    }
    for (const C of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
      if (!C) continue
      const p = C.prototype
      const w4 = (name) => {
        const o = p[name]
        if (o)
          p[name] = function (a, b, c, d) {
            hit()
            return o.call(this, a, b, c, d)
          }
      }
      const w5 = (name) => {
        const o = p[name]
        if (o)
          p[name] = function (a, b, c, d, e) {
            hit()
            return o.call(this, a, b, c, d, e)
          }
      }
      const w6 = (name) => {
        const o = p[name]
        if (o)
          p[name] = function (a, b, c, d, e, f) {
            hit()
            return o.call(this, a, b, c, d, e, f)
          }
      }
      w4('drawElements')
      w4('drawArrays')
      w5('drawElementsInstanced')
      w4('drawArraysInstanced')
      w6('drawRangeElements')
      const sync = (name) => {
        const o = p[name]
        if (o)
          p[name] = function (a, b) {
            const t = now()
            const r = o.call(this, a, b)
            P.gl.syncMs += now() - t
            P.gl.syncCalls++
            return r
          }
      }
      sync('getProgramParameter')
      sync('getShaderParameter')
      sync('getProgramInfoLog')
      sync('getShaderInfoLog')
      const lp = p.linkProgram
      if (lp)
        p.linkProgram = function (a) {
          const t = now()
          lp.call(this, a)
          P.gl.linkMs += now() - t
          P.gl.programs++
        }
    }
  }
  if (opts.raf) {
    const real = window.requestAnimationFrame.bind(window)
    window.requestAnimationFrame = function (cb) {
      P.raf.req++
      return real(function (t) {
        P.raf.run++
        cb(t)
      })
    }
  }
  // Load-time frame recorder: every rAF timestamp for the first 20 s (opts.rec). The frame after
  // the one that follows a render only starts once the GPU has drawn that render, so it marks
  // when the first world frame actually reached the screen.
  P.rafTimes = []
  if (opts.rec) {
    const rq = window.requestAnimationFrame.bind(window)
    const rec = (t) => {
      P.rafTimes.push(+t.toFixed(1))
      if (t < 20000) rq(rec)
    }
    rq(rec)
  }
  // A frame counter the harness can switch on (one rAF callback per frame, same function every time).
  let tickOn = false
  const tick = () => {
    P.ticks++
    if (tickOn) requestAnimationFrame(tick)
  }
  P.tickStart = () => {
    if (!tickOn) {
      tickOn = true
      requestAnimationFrame(tick)
    }
  }
  P.tickStop = () => {
    tickOn = false
  }
}

// ── Browser plumbing ─────────────────────────────────────────────────────────

async function launch() {
  return puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    protocolTimeout: 1800000,
    args: [
      '--enable-unsafe-swiftshader',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--hide-scrollbars',
      '--js-flags=--expose-gc',
      '--enable-precise-memory-info',
    ],
  })
}

async function openPage(browser, vpName, opts = {}) {
  const vp = VPS[vpName]
  const ctx = await browser.createBrowserContext()
  const page = await ctx.newPage()
  page.setDefaultTimeout(1800000)
  const cdp = await page.createCDPSession()
  const net = new Map()
  await cdp.send('Network.enable')
  if (opts.noCache) await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
  cdp.on('Network.requestWillBeSent', (e) => {
    net.set(e.requestId, { url: e.request.url, type: e.type, start: e.timestamp, decoded: 0, encoded: null, end: null })
  })
  cdp.on('Network.responseReceived', (e) => {
    const r = net.get(e.requestId)
    if (!r) return
    const h = e.response.headers || {}
    r.status = e.response.status
    r.mime = e.response.mimeType
    r.enc = h['content-encoding'] || h['Content-Encoding'] || null
    r.type = e.type || r.type
    r.cache = !!e.response.fromDiskCache
  })
  cdp.on('Network.dataReceived', (e) => {
    const r = net.get(e.requestId)
    if (r) r.decoded += e.dataLength
  })
  cdp.on('Network.loadingFinished', (e) => {
    const r = net.get(e.requestId)
    if (r) {
      r.encoded = e.encodedDataLength
      r.end = e.timestamp
    }
  })
  const cons = []
  page.on('console', (m) => {
    const t = m.text()
    if (/GPU stall|GL Driver Message|WebGL-|swiftshader|Automatic fallback to software WebGL/i.test(t)) return
    cons.push({ type: m.type(), text: t.slice(0, 300) })
  })
  page.on('pageerror', (e) => cons.push({ type: 'pageerror', text: e.message }))
  await page.evaluateOnNewDocument(perfInit, { gl: opts.gl !== false, raf: !!opts.raf, rec: !!opts.rec, obs: opts.obs !== false })
  await page.setViewport({ width: vp.w, height: vp.h, deviceScaleFactor: 1 })
  return { ctx, page, cdp, net, cons, vpName }
}

async function goto(P, build) {
  await P.page.goto(`${BASE}${ROUTE[build]}`, { waitUntil: 'domcontentloaded', timeout: 300000 })
}

async function waitReady(page, build) {
  if (build === 'v2') {
    await page.waitForFunction(
      () => window.__worldReady === true || typeof window.__worldError === 'string' || window.__worldView === 'list',
      { polling: 100, timeout: 600000 },
    )
    const st = await page.evaluate(() => ({ ready: window.__worldReady, err: window.__worldError ?? null, view: window.__worldView }))
    if (st.ready !== true) throw new Error(`v2 not ready: ${JSON.stringify(st)}`)
  } else {
    await page.waitForSelector('main[data-ready="true"]', { timeout: 600000 })
  }
}

/** First render that draws the world: a burst of >= 10 draw calls. */
async function waitFirstFrame(page) {
  await page.waitForFunction(() => window.__perf.bursts.some((b) => b.n >= 10), { polling: 100, timeout: 600000 })
}

/** v2 sleeps when idle: wait until the scene frame counter stops moving for `quietMs`. */
async function v2Quiet(page, quietMs = 1500) {
  let last = -1
  let since = Date.now()
  for (;;) {
    const n = await page.evaluate(() => window.__worldFrameCount)
    if (n !== last) {
      last = n
      since = Date.now()
    } else if (Date.now() - since >= quietMs) return n
    await sleep(150)
  }
}

async function v2Settle(page, depth) {
  await page.evaluate((d) => window.scrollTo(0, Math.round(window.__worldScrollFor(d))), depth)
  await page.waitForFunction(
    () => {
      const f = window.__worldFrame
      if (!f || !window.__worldScrollFor) return false
      const max = window.__worldScrollFor(0.88)
      const target = max > 0 ? Math.min(1, window.scrollY / max) * 0.88 : 0
      return f.parkProgress === 0 && Math.abs(f.depth - target) < 1e-9
    },
    { timeout: 1800000, polling: 200 },
  )
  await v2Quiet(page, 800)
}

async function codexSettle(page, frac) {
  await page.evaluate((f) => window.scrollTo(0, Math.round(f * (document.documentElement.scrollHeight - innerHeight))), frac)
  await page.waitForFunction(
    () => {
      const d = Number(document.documentElement.dataset.codexDepth)
      const max = document.documentElement.scrollHeight - innerHeight
      const target = Math.min(1, Math.max(0, window.scrollY / Math.max(1, max)))
      return Number.isFinite(d) && Math.abs(d - target) <= 0.0005
    },
    { timeout: 1800000, polling: 200 },
  )
  const t0 = await page.evaluate(() => {
    window.__perf.tickStart()
    return window.__perf.ticks
  })
  await page.waitForFunction((n) => window.__perf.ticks >= n + 40, { timeout: 1800000, polling: 200 }, t0)
  await page.evaluate(() => window.__perf.tickStop())
}

function netSummary(net) {
  const rows = [...net.values()].filter((r) => r.encoded != null && !/webpack-hmr|__nextjs|_next\/static\/webpack/.test(r.url))
  const doc = rows.find((r) => r.type === 'Document')
  const t0 = doc ? doc.start : Math.min(...rows.map((r) => r.start))
  const cat = (r) => {
    const u = r.url
    if (/\.glb(\?|$)/.test(u)) return 'glb'
    if (/draco/.test(u)) return 'draco'
    if (r.type === 'Script') return 'js'
    if (r.type === 'Stylesheet') return 'css'
    if (r.type === 'Font') return 'font'
    if (r.type === 'Document') return 'doc'
    return 'other'
  }
  const by = {}
  for (const r of rows) {
    const c = cat(r)
    by[c] = by[c] || { count: 0, encoded: 0, decoded: 0 }
    by[c].count++
    by[c].encoded += r.encoded
    by[c].decoded += r.decoded
  }
  const list = rows
    .map((r) => ({
      cat: cat(r),
      path: new URL(r.url).pathname.replace(/^\/_next\/static\/chunks\//, 'chunks/').slice(0, 140),
      encoded: r.encoded,
      decoded: r.decoded,
      enc: r.enc,
      status: r.status,
      startMs: Math.round((r.start - t0) * 1000),
      endMs: Math.round((r.end - t0) * 1000),
    }))
    .sort((a, b) => b.encoded - a.encoded)
  const total = rows.reduce((s, r) => s + r.encoded, 0)
  return { total, by, list }
}

// ── Section: load ────────────────────────────────────────────────────────────

async function loadOnce(browser, build, vpName, shotName) {
  const P = await openPage(browser, vpName, { noCache: true, gl: true, rec: true })
  const { page } = P
  const tWall = Date.now()
  await goto(P, build)
  await waitReady(page, build)
  const wallReady = Date.now() - tWall
  await waitFirstFrame(page)
  const wallFirst = Date.now() - tWall
  // Wait until the first world frame has been drawn (two rAF frames after it), then collect the
  // long tasks that follow it (the second frame, React, etc.).
  await page.waitForFunction(
    () => {
      const P = window.__perf
      const f = P.bursts.find((b) => b.n >= 10)
      return f && P.rafTimes.filter((t) => t > f.e).length >= 2
    },
    { polling: 100, timeout: 600000 },
  )
  await sleep(3000)
  const d = await page.evaluate(() => {
    const P = window.__perf
    const nav = performance.getEntriesByType('navigation')[0]
    const paint = Object.fromEntries(performance.getEntriesByType('paint').map((e) => [e.name, +e.startTime.toFixed(1)]))
    const first = P.bursts.find((b) => b.n >= 10)
    const f = window.__worldFrame
    const ds = document.documentElement.dataset
    const after = first ? P.rafTimes.filter((t) => t > first.e) : []
    return {
      presentedMs: after.length >= 2 ? after[1] : null,
      rafGapsAfterFirst: after.slice(0, 6),
      marks: P.marks,
      paint,
      nav: nav ? { responseEnd: +nav.responseEnd.toFixed(1), dcl: +nav.domContentLoadedEventEnd.toFixed(1), load: +nav.loadEventEnd.toFixed(1) } : null,
      firstFrame: first,
      burstsAfterFirst: P.bursts.filter((b) => first && b.s >= first.s).slice(0, 12),
      lt: P.lt,
      loaf: P.loaf,
      gl: { ...P.gl, syncMs: +P.gl.syncMs.toFixed(1), linkMs: +P.gl.linkMs.toFixed(1) },
      contexts: P.contexts,
      heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
      scene: f ? { triangles: f.triangles, calls: f.calls } : { triangles: Number(ds.codexTriangles), calls: Number(ds.codexDrawCalls) },
    }
  })
  if (shotName) await page.screenshot({ path: path.join(OUT, shotName) })
  const fcp = d.paint['first-contentful-paint'] ?? d.paint['first-paint'] ?? 0
  const afterFcp = d.lt.filter((t) => t.s >= fcp)
  const res = {
    build,
    vp: vpName,
    readyMs: r1(d.marks.ready),
    firstFrameStartMs: r1(d.firstFrame?.s),
    firstFrameEndMs: r1(d.firstFrame?.e),
    firstFrameDraws: d.firstFrame?.n,
    firstFramePresentedMs: d.presentedMs,
    rafAfterFirst: d.rafGapsAfterFirst,
    fcpMs: fcp,
    wallReadyMs: wallReady,
    wallFirstFrameMs: wallFirst,
    longTasks: d.lt,
    longTasksAfterFcp: afterFcp,
    maxLongTaskAfterFcp: afterFcp.reduce((m, t) => Math.max(m, t.d), 0),
    blockedMsAfterFcp: r1(afterFcp.reduce((s, t) => s + Math.max(0, t.d - 50), 0)),
    longTaskMsTotal: r1(d.lt.reduce((s, t) => s + t.d, 0)),
    loafTop: [...d.loaf].sort((a, b) => b.d - a.d).slice(0, 6),
    gl: d.gl,
    webglContexts: d.contexts,
    heapMB: d.heapMB,
    scene: d.scene,
    burstsAfterFirst: d.burstsAfterFirst,
    treeLod: P.cons.filter((c) => /tree LOD/.test(c.text)).map((c) => c.text),
    consoleErrors: P.cons.filter((c) => c.type === 'error' || c.type === 'pageerror').map((c) => c.text),
    consoleWarnings: P.cons.filter((c) => c.type === 'warn' || c.type === 'warning').map((c) => c.text),
    net: netSummary(P.net),
  }
  await P.ctx.close()
  return res
}

async function sectionLoad(browser) {
  const vps = VP_LIST ? VP_LIST.split(',') : ['split', 'ultra', 'laptop']
  const R = { env0: env(), runs: [], note: 'cold: cache disabled, fresh browser context per load; dev server (unminified, StrictMode)' }
  // Warm the dev server's compile of both routes so the first measured load is not a compile.
  for (const b of ['v2', 'codex']) {
    log(`[load] warm-up ${b}`)
    const P = await openPage(browser, 'split', { noCache: false })
    await goto(P, b)
    await waitReady(P.page, b)
    await waitFirstFrame(P.page)
    await P.ctx.close()
  }
  for (const vp of vps) {
    for (let i = 0; i < RUNS; i++) {
      const order = i % 2 ? ['codex', 'v2'] : ['v2', 'codex']
      for (const b of order) {
        const shotName = i === 0 ? `load-${vp}-${b}-ready+4s.png` : null
        const r = await loadOnce(browser, b, vp, shotName)
        r.run = i
        R.runs.push(r)
        log(
          `[load ${vp} ${b} #${i}] ready ${r.readyMs} ms, first frame ${r.firstFrameStartMs}-${r.firstFrameEndMs} ms (${r.firstFrameDraws} draws) on screen ~${r.firstFramePresentedMs} ms, FCP ${r.fcpMs}, max LT after FCP ${r.maxLongTaskAfterFcp} ms, blocked ${r.blockedMsAfterFcp} ms, gl sync ${r.gl.syncMs} ms / link ${r.gl.linkMs} ms (${r.gl.programs} programs), contexts ${r.webglContexts}, net ${(r.net.total / 1024).toFixed(0)} KB ${r.treeLod.join(' ')}`,
        )
      }
    }
  }
  const agg = {}
  for (const vp of vps) {
    agg[vp] = {}
    for (const b of ['v2', 'codex']) {
      const rs = R.runs.filter((r) => r.vp === vp && r.build === b)
      agg[vp][b] = {
        n: rs.length,
        readyMs: median(rs.map((r) => r.readyMs)),
        firstFrameEndMs: median(rs.map((r) => r.firstFrameEndMs)),
        firstFramePresentedMs: median(rs.map((r) => r.firstFramePresentedMs)),
        maxLongTaskAfterFcp: Math.max(...rs.map((r) => r.maxLongTaskAfterFcp)),
        blockedMsAfterFcp: median(rs.map((r) => r.blockedMsAfterFcp)),
        glSyncMs: median(rs.map((r) => r.gl.syncMs)),
        glLinkMs: median(rs.map((r) => r.gl.linkMs)),
        programs: median(rs.map((r) => r.gl.programs)),
        netKB: median(rs.map((r) => r.net.total / 1024)),
      }
    }
    const v = agg[vp].v2
    const c = agg[vp].codex
    agg[vp].ratioReady = v.readyMs && c.readyMs ? +(v.readyMs / c.readyMs).toFixed(2) : null
    agg[vp].ratioFirstFrame = v.firstFrameEndMs && c.firstFrameEndMs ? +(v.firstFrameEndMs / c.firstFrameEndMs).toFixed(2) : null
    agg[vp].ratioPresented = v.firstFramePresentedMs && c.firstFramePresentedMs ? +(v.firstFramePresentedMs / c.firstFramePresentedMs).toFixed(2) : null
  }
  R.agg = agg
  R.env1 = env()
  save('load.json', R)
  return R
}

// ── Section: profile ─────────────────────────────────────────────────────────

const TARGETS = [
  'adopt',
  'instanceRepeats',
  'simplifyForDistance',
  'simplifyRange',
  'weld',
  'pieces',
  'splitByDistance',
  'buildHeightfield',
  'indexLandmarks',
  'stripHazeEmissive',
  'patchFog',
  'resolveAnchors',
  'load',
  'parse',
  'tick',
  'render',
  'compile',
  'getProgramParameter',
  'linkProgram',
  'compileShader',
  'projectMarkers',
  'apply',
  'run',
  'CodexLandscape',
  'buildTerrain',
  'buildVegetation',
  'buildLandmarks',
  'buildWater',
  'buildPath',
  'buildSky',
  'performWorkOnRootViaSchedulerTask',
  'performWorkUntilDeadline',
]

function analyseCpu(profile) {
  const nodes = new Map()
  for (const n of profile.nodes) nodes.set(n.id, n)
  const parent = new Map()
  for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id)
  const label = (n) => {
    const cf = n.callFrame
    const file = (cf.url || '').split('/').pop().split('?')[0]
    return `${cf.functionName || '(anon)'} ${file}:${cf.lineNumber + 1}`
  }
  const samples = profile.samples
  const deltas = profile.timeDeltas
  const dur = samples.map((_, i) => (i + 1 < deltas.length ? deltas[i + 1] : 0) / 1000)
  let t = profile.startTime / 1000
  const times = samples.map((_, i) => (t += deltas[i] / 1000))
  const nameOf = (id) => nodes.get(id).callFrame.functionName
  const isIdle = (id) => nameOf(id) === '(idle)'
  const inclusive = {}
  // The same, leaving out samples inside Next's dev-only console wrapper (it captures a stack
  // on every console call, including three's SimplifyModifier console.assert per collapsed vertex).
  const inclusiveNoDevConsole = {}
  const DEV_CONSOLE = new Set(['wrapperMethod', 'createLogEntry', 'getErrorStack'])
  const self = {}
  let busyTotal = 0
  for (let i = 0; i < samples.length; i++) {
    const id = samples[i]
    const d = dur[i]
    if (isIdle(id)) continue
    busyTotal += d
    const leaf = nodes.get(id)
    const k = label(leaf)
    self[k] = (self[k] || 0) + d
    const seen = new Set()
    let devConsole = false
    for (let x = id; x != null; x = parent.get(x)) {
      const nm = nameOf(x)
      if (DEV_CONSOLE.has(nm)) devConsole = true
      if (TARGETS.includes(nm) && !seen.has(nm)) {
        seen.add(nm)
        inclusive[nm] = (inclusive[nm] || 0) + d
      }
    }
    if (devConsole) inclusive['(inside Next dev console wrapper)'] = (inclusive['(inside Next dev console wrapper)'] || 0) + d
    else for (const nm of seen) inclusiveNoDevConsole[nm] = (inclusiveNoDevConsole[nm] || 0) + d
  }
  // Busy stretches: runs of non-idle samples with no idle gap over 2 ms.
  const segs = []
  let cur = null
  for (let i = 0; i < samples.length; i++) {
    const idle = isIdle(samples[i])
    if (!idle) {
      if (!cur) cur = { s: times[i], e: times[i] + dur[i], idx: [i] }
      else {
        cur.e = times[i] + dur[i]
        cur.idx.push(i)
      }
    } else if (cur && times[i] - cur.e > 2) {
      segs.push(cur)
      cur = null
    } else if (cur && idle && dur[i] > 2) {
      segs.push(cur)
      cur = null
    }
  }
  if (cur) segs.push(cur)
  const t0 = profile.startTime / 1000
  const top = segs
    .map((sg) => {
      const inc = {}
      const slf = {}
      for (const i of sg.idx) {
        const d = dur[i]
        const seen = new Set()
        const leaf = nodes.get(samples[i])
        const lk = label(leaf)
        slf[lk] = (slf[lk] || 0) + d
        for (let x = samples[i]; x != null; x = parent.get(x)) {
          const k = label(nodes.get(x))
          if (seen.has(k)) continue
          seen.add(k)
          inc[k] = (inc[k] || 0) + d
        }
      }
      const pick = (o, n) =>
        Object.entries(o)
          .filter(([k]) => !/^\((root|program)\)/.test(k))
          .sort((a, b) => b[1] - a[1])
          .slice(0, n)
          .map(([k, v]) => [k, r1(v)])
      return { startMs: r1(sg.s - t0), durMs: r1(sg.e - sg.s), inclusive: pick(inc, 18), self: pick(slf, 8) }
    })
    .sort((a, b) => b.durMs - a.durMs)
    .slice(0, 8)
  const bySelf = Object.entries(self)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([k, v]) => [k, r1(v)])
  return {
    spanMs: r1((profile.endTime - profile.startTime) / 1000),
    busyMs: r1(busyTotal),
    inclusive: Object.fromEntries(Object.entries(inclusive).map(([k, v]) => [k, r1(v)]).sort((a, b) => b[1] - a[1])),
    inclusiveNoDevConsole: Object.fromEntries(Object.entries(inclusiveNoDevConsole).map(([k, v]) => [k, r1(v)]).sort((a, b) => b[1] - a[1])),
    topSelf: bySelf,
    longestBusy: top,
  }
}

async function sectionProfile(browser) {
  const R = { env0: env() }
  for (const b of ['v2', 'codex']) {
    const P = await openPage(browser, 'split', { noCache: true, gl: true })
    // A same-origin document first, so the profiler runs in the renderer the page will use.
    await P.page.goto(`${BASE}/world-v2/draco/draco_wasm_wrapper.js`, { waitUntil: 'load' })
    await P.cdp.send('Profiler.enable')
    await P.cdp.send('Profiler.setSamplingInterval', { interval: 100 })
    await P.cdp.send('Profiler.start')
    await goto(P, b)
    await waitReady(P.page, b)
    await waitFirstFrame(P.page)
    await sleep(3000)
    const { profile } = await P.cdp.send('Profiler.stop')
    const lt = await P.page.evaluate(() => window.__perf.lt)
    fs.writeFileSync(path.join(RAW, `load-${b}.cpuprofile.gz`), zlib.gzipSync(JSON.stringify(profile)))
    R[b] = { ...analyseCpu(profile), longTasks: lt, treeLod: P.cons.filter((c) => /tree LOD/.test(c.text)).map((c) => c.text) }
    log(`[profile ${b}] busy ${R[b].busyMs} ms of ${R[b].spanMs}; inclusive`, JSON.stringify(R[b].inclusive))
    log(`[profile ${b}] longest busy stretches`, R[b].longestBusy.slice(0, 3).map((s) => `${s.durMs} ms @${s.startMs}`).join(', '))
    await P.ctx.close()
  }
  R.env1 = env()
  save('profile.json', R)
  return R
}

// ── Section: sweep ───────────────────────────────────────────────────────────

async function sweepV2(browser, vpName, withParks) {
  const P = await openPage(browser, vpName, { gl: true })
  const { page } = P
  await goto(P, 'v2')
  await waitReady(page, 'v2')
  await waitFirstFrame(page)
  await v2Quiet(page)
  const out = { vp: vpName }
  // 1. Slow pass along the rail: advance the scroll 0.004 of depth per SCENE frame.
  log(`[sweep v2 ${vpName}] rail pass`)
  out.rail = await page.evaluate(
    (maxD, step) =>
      new Promise((res) => {
        const rows = []
        const sf = window.__worldScrollFor
        let d = 0
        let lastN = -1
        window.scrollTo(0, 0)
        const loop = () => {
          const n = window.__worldFrameCount
          if (n !== lastN) {
            lastN = n
            const f = window.__worldFrame
            if (f) rows.push([+f.depth.toFixed(4), f.triangles, f.calls])
            d += step
            window.scrollTo(0, Math.round(sf(Math.min(d, maxD))))
          }
          if (d > maxD + 0.06) return res(rows)
          requestAnimationFrame(loop)
        }
        requestAnimationFrame(loop)
      }),
    MAX_DEPTH,
    0.004,
  )
  const tri = out.rail.map((r) => r[1])
  const calls = out.rail.map((r) => r[2])
  out.railMax = { triangles: Math.max(...tri), calls: Math.max(...calls), atTri: out.rail[tri.indexOf(Math.max(...tri))][0], atCalls: out.rail[calls.indexOf(Math.max(...calls))][0], frames: out.rail.length }
  out.railMin = { triangles: Math.min(...tri), calls: Math.min(...calls) }
  log(`[sweep v2 ${vpName}] rail: ${out.rail.length} frames, max ${out.railMax.triangles} tris @${out.railMax.atTri}, max ${out.railMax.calls} calls @${out.railMax.atCalls}`)

  // 2. Exact settles at the 8 stops.
  out.stops = []
  for (const [id, d] of AREAS) {
    await v2Settle(page, d)
    const st = await page.evaluate(() => {
      const f = window.__worldFrame
      return { depth: f.depth, triangles: f.triangles, calls: f.calls, lastBurst: window.__perf.bursts[window.__perf.bursts.length - 1] }
    })
    out.stops.push({ id, ...st })
    if (['a1', 'a4', 'a8'].includes(id) && vpName !== 'laptop') await page.screenshot({ path: path.join(OUT, `sweep-${vpName}-${id}.png`) })
    log(`[sweep v2 ${vpName}] ${id} d=${d}: ${st.triangles} tris, ${st.calls} calls (wrapper counted ${st.lastBurst?.n})`)
  }

  // 3. Park at each place from its own stop, then back.
  if (withParks) {
    out.parks = []
    const only = arg('--parks', null)
    for (const [id, d] of AREAS.filter(([id]) => !only || only.split(',').includes(id))) {
      await v2Settle(page, d)
      const rec = await page.evaluate(
        (id) =>
          new Promise((res) => {
            const rows = []
            let lastN = window.__worldFrameCount
            const loaf0 = window.__perf.loaf.length
            const lt0 = window.__perf.lt.length
            let phase = 'in'
            let quietSince = 0
            window.__worldPark(id)
            const t0 = performance.now()
            const loop = () => {
              const n = window.__worldFrameCount
              const f = window.__worldFrame
              if (n !== lastN) {
                lastN = n
                quietSince = performance.now()
                rows.push([phase, +f.parkProgress.toFixed(4), f.triangles, f.calls])
              }
              const now = performance.now()
              if (phase === 'in' && f.parkProgress === 1 && now - quietSince > 1200) {
                phase = 'out'
                window.__worldPark(null)
              } else if (phase === 'out' && f.parkProgress === 0 && now - quietSince > 1200) {
                return res({
                  rows,
                  wallMs: Math.round(now - t0),
                  loaf: window.__perf.loaf.slice(loaf0).sort((a, b) => b.d - a.d).slice(0, 3),
                  lt: window.__perf.lt.slice(lt0),
                })
              }
              requestAnimationFrame(loop)
            }
            requestAnimationFrame(loop)
          }),
        id,
      )
      const inRows = rec.rows.filter((r) => r[0] === 'in')
      const outRows = rec.rows.filter((r) => r[0] === 'out')
      const landed = inRows.filter((r) => r[1] === 1).pop()
      const row = {
        id,
        framesIn: inRows.length,
        framesOut: outRows.length,
        maxTriangles: Math.max(...rec.rows.map((r) => r[2])),
        maxCalls: Math.max(...rec.rows.map((r) => r[3])),
        landed: landed ? { triangles: landed[2], calls: landed[3] } : null,
        maxLongTask: rec.lt.reduce((m, t) => Math.max(m, t.d), 0),
        longTasks: rec.lt,
        loafTop: rec.loaf,
      }
      out.parks.push(row)
      log(`[sweep v2 ${vpName}] park ${id}: max ${row.maxTriangles} tris, ${row.maxCalls} calls, landed ${JSON.stringify(row.landed)}, longest task ${row.maxLongTask} ms`)
    }
  }
  out.consoleErrors = P.cons.filter((c) => c.type === 'error' || c.type === 'pageerror').map((c) => c.text)
  await P.ctx.close()
  return out
}

async function sweepCodex(browser, vpName) {
  const P = await openPage(browser, vpName, { gl: true })
  const { page } = P
  await goto(P, 'codex')
  await waitReady(page, 'codex')
  await waitFirstFrame(page)
  await sleep(1000)
  const out = { vp: vpName }
  out.rail = await page.evaluate(
    (step) =>
      new Promise((res) => {
        const rows = []
        let f = 0
        const max = () => document.documentElement.scrollHeight - innerHeight
        window.scrollTo(0, 0)
        const loop = () => {
          const ds = document.documentElement.dataset
          rows.push([Number(ds.codexDepth), Number(ds.codexTriangles), Number(ds.codexDrawCalls)])
          f += step
          window.scrollTo(0, Math.round(Math.min(1, f) * max()))
          if (f > 1.08) return res(rows)
          requestAnimationFrame(loop)
        }
        requestAnimationFrame(loop)
      }),
    0.004,
  )
  const tri = out.rail.map((r) => r[1]).filter(Number.isFinite)
  const calls = out.rail.map((r) => r[2]).filter(Number.isFinite)
  out.railMax = { triangles: Math.max(...tri), calls: Math.max(...calls), frames: out.rail.length }
  out.railMin = { triangles: Math.min(...tri), calls: Math.min(...calls) }
  log(`[sweep codex ${vpName}] rail max ${out.railMax.triangles} tris, ${out.railMax.calls} calls; min ${out.railMin.calls} calls`)
  await P.ctx.close()
  return out
}

async function sectionSweep(browser) {
  const vps = VP_LIST ? VP_LIST.split(',') : ['split', 'ultra', 'laptop']
  const R = { env0: env(), v2: {}, codex: {} }
  const noParks = argv.includes('--no-parks')
  for (const vp of vps) {
    R.v2[vp] = await sweepV2(browser, vp, vp !== 'laptop' && !noParks)
    R.codex[vp] = await sweepCodex(browser, vp)
    save(`sweep${SWEEP_TAG}.json`, R)
  }
  R.env1 = env()
  save(`sweep${SWEEP_TAG}.json`, R)
  return R
}

// ── Trace helpers ────────────────────────────────────────────────────────────

const TRACE_CATS = [
  'devtools.timeline',
  'disabled-by-default-devtools.timeline',
  'disabled-by-default-devtools.timeline.frame',
  'disabled-by-default-devtools.timeline.stack',
  'v8.execute',
]
const JS_EVENTS = new Set(['FunctionCall', 'FireAnimationFrame', 'EventDispatch', 'TimerFire', 'EvaluateScript', 'v8.callFunction', 'RunMicrotasks', 'v8.run', 'FireIdleCallback'])

function analyseTrace(buf, pageUrlPart) {
  const tr = JSON.parse(Buffer.from(buf).toString('utf8'))
  const ev = tr.traceEvents || tr
  // The renderer main thread of the page: the CrRendererMain whose pid owns the page's frame.
  let pid = null
  for (const e of ev) {
    if (e.name === 'TracingStartedInBrowser' && e.args?.data?.frames) {
      const fr = e.args.data.frames.find((f) => (f.url || '').includes(pageUrlPart)) || e.args.data.frames[0]
      if (fr) pid = fr.processId
    }
  }
  const threads = ev.filter((e) => e.ph === 'M' && e.name === 'thread_name' && e.args?.name === 'CrRendererMain')
  let tid = null
  const cands = threads.filter((t) => pid == null || t.pid === pid)
  if (cands.length) {
    // Most events wins.
    let best = -1
    for (const t of cands) {
      const n = ev.reduce((s, e) => s + (e.pid === t.pid && e.tid === t.tid ? 1 : 0), 0)
      if (n > best) {
        best = n
        pid = t.pid
        tid = t.tid
      }
    }
  }
  const main = ev.filter((e) => e.pid === pid && e.tid === tid && (e.ph === 'X' || e.ph === 'I' || e.ph === 'i' || e.ph === 'B' || e.ph === 'E'))
  const xs = main.filter((e) => e.ph === 'X')
  const js = xs.filter((e) => JS_EVENTS.has(e.name)).map((e) => [e.ts, e.ts + (e.dur || 0), e.name])
  const inJs = (e) => js.some(([s, t]) => e.ts >= s && e.ts < t)
  const count = (n) => xs.filter((e) => e.name === n).length
  const layouts = xs.filter((e) => e.name === 'Layout')
  const styles = xs.filter((e) => e.name === 'UpdateLayoutTree')
  const forcedLayouts = layouts.filter(inJs)
  const forcedStyles = styles.filter(inJs)
  const stackTop = (e) => {
    const st = e.args?.beginData?.stackTrace || e.args?.data?.stackTrace
    if (!st || !st.length) return '(no stack)'
    const f = st[0]
    return `${f.functionName || '(anon)'} ${(f.url || '').split('/').pop().split('?')[0]}:${f.lineNumber}`
  }
  const tally = (arr, fn) => {
    const o = {}
    for (const e of arr) {
      const k = fn(e)
      o[k] = (o[k] || 0) + 1
    }
    return Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 10)
  }
  const invalidations = main.filter((e) => e.name === 'InvalidateLayout')
  const schedStyle = main.filter((e) => e.name === 'ScheduleStyleRecalculation')
  const raf = xs.filter((e) => e.name === 'FireAnimationFrame')
  const sum = (arr) => arr.reduce((s, e) => s + (e.dur || 0), 0) / 1000
  return {
    pid,
    tid,
    Layout: layouts.length,
    LayoutMs: +sum(layouts).toFixed(1),
    forcedLayout: forcedLayouts.length,
    forcedLayoutStacks: tally(forcedLayouts, stackTop),
    UpdateLayoutTree: styles.length,
    UpdateLayoutTreeMs: +sum(styles).toFixed(1),
    forcedStyle: forcedStyles.length,
    InvalidateLayout: invalidations.length,
    invalidateLayoutStacks: tally(invalidations, stackTop),
    ScheduleStyleRecalculation: schedStyle.length,
    Paint: count('Paint'),
    PaintMs: +sum(xs.filter((e) => e.name === 'Paint')).toFixed(1),
    PrePaint: count('PrePaint'),
    Layerize: count('Layerize'),
    FireAnimationFrame: raf.length,
    FireAnimationFrameMs: +sum(raf).toFixed(1),
    FunctionCall: count('FunctionCall'),
    BeginMainThreadFrame: main.filter((e) => e.name === 'BeginMainThreadFrame').length,
    TimerFire: count('TimerFire'),
    layoutElements: layouts.slice(0, 40).map((e) => e.args?.beginData?.dirtyObjects ?? null),
    jsMsByFn: (() => {
      const o = {}
      for (const e of xs) {
        if (e.name !== 'FunctionCall') continue
        const d = e.args?.data || {}
        const k = `${d.functionName || '(anon)'} ${(d.url || '').split('/').pop().split('?')[0]}:${d.lineNumber ?? ''}`
        o[k] = o[k] || { n: 0, ms: 0 }
        o[k].n++
        o[k].ms += (e.dur || 0) / 1000
      }
      return Object.entries(o)
        .sort((a, b) => b[1].ms - a[1].ms)
        .slice(0, 8)
        .map(([k, v]) => [k, v.n, +v.ms.toFixed(1), +(v.ms / v.n).toFixed(2)])
    })(),
    jsCalls: tally(
      xs.filter((e) => e.name === 'FunctionCall' || e.name === 'TimerFire' || e.name === 'EventDispatch'),
      (e) => {
        const d = e.args?.data || {}
        if (e.name === 'EventDispatch') return `event:${d.type}`
        if (e.name === 'TimerFire') return `timer:${d.timerId}`
        return `${d.functionName || '(anon)'} ${(d.url || '').split('/').pop().split('?')[0]}:${d.lineNumber ?? ''}`
      },
    ),
  }
}

// ── Section: idle ────────────────────────────────────────────────────────────

async function idleWindow(P, label, build, ms = 3000) {
  const { page } = P
  const before = await page.evaluate(() => ({
    draws: window.__perf.draws,
    frames: window.__worldFrameCount ?? null,
    rafRun: window.__perf.raf.run,
    rafReq: window.__perf.raf.req,
    anims: document.getAnimations().filter((a) => a.playState === 'running').map((a) => a.animationName || a.constructor.name),
  }))
  await page.tracing.start({ categories: TRACE_CATS })
  await sleep(ms)
  const buf = await page.tracing.stop()
  const after = await page.evaluate(() => ({
    draws: window.__perf.draws,
    frames: window.__worldFrameCount ?? null,
    rafRun: window.__perf.raf.run,
    rafReq: window.__perf.raf.req,
    anims: document.getAnimations().filter((a) => a.playState === 'running').map((a) => a.animationName || a.constructor.name),
  }))
  fs.writeFileSync(path.join(RAW, `idle-${build}-${P.vpName}-${label.replace(/[^a-z0-9]+/gi, '_').slice(0, 40)}.trace.json.gz`), zlib.gzipSync(buf))
  const t = analyseTrace(buf, ROUTE[build])
  const row = {
    label,
    build,
    windowMs: ms,
    webglDraws: after.draws - before.draws,
    sceneFrames: after.frames == null ? null : after.frames - before.frames,
    rafCallbacksRun: after.rafRun - before.rafRun,
    rafRequested: after.rafReq - before.rafReq,
    runningAnimations: [...new Set([...before.anims, ...after.anims])],
    trace: {
      Layout: t.Layout,
      UpdateLayoutTree: t.UpdateLayoutTree,
      Paint: t.Paint,
      FireAnimationFrame: t.FireAnimationFrame,
      BeginMainThreadFrame: t.BeginMainThreadFrame,
      FunctionCall: t.FunctionCall,
      TimerFire: t.TimerFire,
      jsCalls: t.jsCalls,
    },
  }
  log(`[idle ${build} ${P.vpName}] ${label}: draws ${row.webglDraws}, scene frames ${row.sceneFrames}, rAF run ${row.rafCallbacksRun}, trace ${JSON.stringify(row.trace)}, anims ${row.runningAnimations.join(',') || '-'}`)
  return row
}

async function sectionIdle(browser) {
  const R = { env0: env(), rows: [] }
  const vps = VP_LIST ? VP_LIST.split(',') : ['split', 'ultra', 'laptop']
  for (const vp of vps) {
    const P = await openPage(browser, vp, { gl: true, raf: true })
    const { page } = P
    await goto(P, 'v2')
    await waitReady(page, 'v2')
    await waitFirstFrame(page)
    await v2Quiet(page)
    // Right after load the cue and the current-place pulse run their finite CSS loops; measure that too.
    R.rows.push({ vp, ...(await idleWindow(P, 'default view, just loaded', 'v2')) })
    await sleep(11000)
    R.rows.push({ vp, ...(await idleWindow(P, 'default view, 11 s later', 'v2')) })
    await page.screenshot({ path: path.join(OUT, `idle-${vp}-default.png`) })
    if (vp === 'split') {
      await v2Settle(page, 0.3)
      R.rows.push({ vp, ...(await idleWindow(P, 'settled at a3', 'v2')) })
      await v2Settle(page, 0.8302)
      R.rows.push({ vp, ...(await idleWindow(P, 'settled at a8', 'v2')) })
      await v2Settle(page, 0.3)
      await page.evaluate(() => window.__worldPark('a3'))
      await page.waitForFunction(() => window.__worldFrame && window.__worldFrame.parkProgress === 1, { polling: 200, timeout: 1800000 })
      await v2Quiet(page)
      R.rows.push({ vp, ...(await idleWindow(P, 'parked at a3 (landed)', 'v2')) })
      await page.screenshot({ path: path.join(OUT, `idle-${vp}-parked-a3.png`) })
      await page.evaluate(() => window.__worldPark(null))
      await page.waitForFunction(() => window.__worldFrame && window.__worldFrame.parkProgress === 0 && !document.querySelector('main[data-open]'), { polling: 200, timeout: 1800000 })
      await v2Quiet(page)
      R.rows.push({ vp, ...(await idleWindow(P, 'after unpark', 'v2')) })
      await page.setViewport({ width: VPS[vp].w - 200, height: VPS[vp].h - 100, deviceScaleFactor: 1 })
      await v2Quiet(page)
      await page.setViewport({ width: VPS[vp].w, height: VPS[vp].h, deviceScaleFactor: 1 })
      await v2Quiet(page)
      R.rows.push({ vp, ...(await idleWindow(P, 'after a resize and back', 'v2')) })
      // Hover the first visible marker and hold still.
      // A place marker (data-mode text or dot). Its button can be zero-size; aim at its largest visible child.
      const box = await page.evaluate(() => {
        for (const e of document.querySelectorAll('main [data-mode="text"], main [data-mode="dot"]')) {
          let best = null
          for (const c of [e, ...e.querySelectorAll('*')]) {
            const r = c.getBoundingClientRect()
            if (r.width > 4 && r.height > 4 && r.top > 60 && r.bottom < innerHeight - 60 && (!best || r.width * r.height > best.width * best.height)) best = r
          }
          if (best) return { x: best.left + best.width / 2, y: best.top + best.height / 2, label: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 40) }
        }
        return null
      })
      R.hoverTarget = box
      if (box) {
        await page.mouse.move(box.x, box.y)
        await sleep(1500)
        await v2Quiet(page)
        R.rows.push({ vp, ...(await idleWindow(P, `hovering "${box.label}"`, 'v2')) })
        await page.mouse.move(5, 5)
      }
      await v2Quiet(page)
    }
    await P.ctx.close()
  }
  // Astra for contrast: its loop renders every frame by design.
  const C = await openPage(browser, 'split', { gl: true, raf: true })
  await goto(C, 'codex')
  await waitReady(C.page, 'codex')
  await waitFirstFrame(C.page)
  await sleep(12000)
  R.rows.push({ vp: 'split', ...(await idleWindow(C, 'default view, 12 s after load', 'codex')) })
  await C.ctx.close()
  R.env1 = env()
  save('idle.json', R)
  return R
}

// ── Section: scroll ──────────────────────────────────────────────────────────

async function gesture(page, cdp, fromY, toY, seconds) {
  const dist = toY - fromY
  const vp = page.viewport()
  await cdp.send('Input.synthesizeScrollGesture', {
    x: Math.round(vp.width / 2),
    y: Math.round(vp.height / 2),
    yDistance: -dist,
    speed: Math.max(50, Math.round(Math.abs(dist) / seconds)),
    gestureSourceType: 'mouse',
    preventFling: true,
  })
}

async function scrollBuild(browser, build, vpName) {
  const P = await openPage(browser, vpName, { gl: false, raf: false, obs: false })
  const { page, cdp } = P
  await goto(P, build)
  await waitReady(page, build)
  await sleep(1500)
  if (build === 'v2') await v2Quiet(page)
  else await sleep(1000)
  // Past the finite CSS loops so they do not count as scroll work.
  await sleep(11000)
  const yFor = async (d) =>
    build === 'v2'
      ? page.evaluate((d) => Math.round(window.__worldScrollFor(d)), d)
      : page.evaluate((f) => Math.round(f * (document.documentElement.scrollHeight - innerHeight)), d / 0.88)
  const start = 0.05
  const end = 0.45
  const settle = async (d) => (build === 'v2' ? v2Settle(page, d) : codexSettle(page, d / 0.88))
  const counters = () =>
    page.evaluate(() => ({ frames: window.__worldFrameCount ?? null, ticks: window.__perf.ticks, y: window.scrollY }))
  const out = { build, vp: vpName }

  // Pass A: trace.
  await settle(start)
  let y0 = await yFor(start)
  let y1 = await yFor(end)
  await page.evaluate(() => window.__perf.tickStart())
  let c0 = await counters()
  await page.tracing.start({ categories: TRACE_CATS })
  const tA = Date.now()
  await gesture(page, cdp, y0, y1, 16)
  const gestureMsA = Date.now() - tA
  let c1 = await counters()
  const buf = await page.tracing.stop()
  await page.evaluate(() => window.__perf.tickStop())
  fs.writeFileSync(path.join(RAW, `scroll-${build}-${vpName}.trace.json.gz`), zlib.gzipSync(buf))
  const t = analyseTrace(buf, ROUTE[build])
  const framesA = build === 'v2' ? c1.frames - c0.frames : c1.ticks - c0.ticks
  out.trace = {
    gestureMs: gestureMsA,
    scrolledPx: c1.y - c0.y,
    sceneFrames: framesA,
    rafTicks: c1.ticks - c0.ticks,
    ...t,
    perFrame: {
      Layout: +(t.Layout / Math.max(1, framesA)).toFixed(3),
      forcedLayout: +(t.forcedLayout / Math.max(1, framesA)).toFixed(3),
      UpdateLayoutTree: +(t.UpdateLayoutTree / Math.max(1, framesA)).toFixed(3),
      Paint: +(t.Paint / Math.max(1, framesA)).toFixed(3),
      rafJsMs: +(t.FireAnimationFrameMs / Math.max(1, t.FireAnimationFrame)).toFixed(2),
    },
  }
  log(`[scroll ${build} ${vpName}] trace: ${framesA} frames over ${gestureMsA} ms, scrolled ${out.trace.scrolledPx}px; Layout ${t.Layout} (forced ${t.forcedLayout}), UpdateLayoutTree ${t.UpdateLayoutTree} (forced ${t.forcedStyle}), Paint ${t.Paint}, rAF ${t.FireAnimationFrame} @ ${out.trace.perFrame.rafJsMs} ms`)

  // Pass B: allocation. Sampling heap profiler that keeps objects collected by GC, so the total is what was allocated.
  // First run WARM scene frames so V8 has optimised the frame code: under SwiftShader a gesture
  // only gets 10-30 frames, and unoptimised code boxes doubles (Matrix4.invert, lookAt) that an
  // optimised 60 fps loop never allocates.
  const WARM = Number(arg('--warm', '120'))
  if (WARM > 0) {
    const tW = Date.now()
    await page.evaluate(
      (build, n, a, b) =>
        new Promise((res) => {
          let k = 0
          let lastN = -1
          let lastTick = -1
          const maxY = document.documentElement.scrollHeight - innerHeight
          const yAt = (d) => (build === 'v2' ? window.__worldScrollFor(d) : (d / 0.88) * maxY)
          window.__perf.tickStart()
          const loop = () => {
            const cur = build === 'v2' ? window.__worldFrameCount : window.__perf.ticks
            if (cur !== lastN) {
              lastN = cur
              k++
              // Triangle wave between a and b, one step per rendered frame.
              const ph = (k % 40) / 40
              const d = a + (b - a) * (ph < 0.5 ? ph * 2 : 2 - ph * 2)
              window.scrollTo(0, Math.round(yAt(d)))
            }
            if (k >= n) {
              window.__perf.tickStop()
              return res(k)
            }
            requestAnimationFrame(loop)
          }
          requestAnimationFrame(loop)
        }),
      build,
      WARM,
      start,
      end,
    )
    out.warmFrames = WARM
    out.warmMs = Date.now() - tW
    log(`[scroll ${build} ${vpName}] warmed ${WARM} frames in ${out.warmMs} ms`)
  }
  await settle(start)
  await page.evaluate(() => window.__perf.tickStart())
  await page.evaluate(() => window.gc && window.gc())
  const m0 = await page.evaluate(() => performance.memory.usedJSHeapSize)
  c0 = await counters()
  await cdp.send('HeapProfiler.enable')
  await cdp.send('HeapProfiler.startSampling', { samplingInterval: 256, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true })
  const tB = Date.now()
  await gesture(page, cdp, y0, y1, 40)
  const gestureMsB = Date.now() - tB
  const { profile } = await cdp.send('HeapProfiler.stopSampling')
  c1 = await counters()
  const m1 = await page.evaluate(() => performance.memory.usedJSHeapSize)
  await page.evaluate(() => window.gc && window.gc())
  const m2 = await page.evaluate(() => performance.memory.usedJSHeapSize)
  await page.evaluate(() => window.__perf.tickStop())
  const framesB = build === 'v2' ? c1.frames - c0.frames : c1.ticks - c0.ticks
  // Tally sampled bytes by function.
  const byFn = {}
  const byFile = {}
  const buckets = {}
  const tickFns = {}
  let total = 0
  // Bucket every allocation by what it was done for: the scene's own frame (its rAF tick, which
  // renders and runs the DOM writes), a React render/commit (region change, hover), or other.
  const bucketOf = (chain) => {
    for (const [fn, file] of chain) {
      if ((fn === 'tick' && /world-v2/.test(file)) || fn === 'CodexLandscape.tick') return 'scene frame (rAF tick)'
    }
    for (const [fn] of chain) {
      if (/^(performWorkUntilDeadline|performWorkOnRoot|performWorkOnRootViaSchedulerTask|flushPassiveEffects|commitRoot|flushSyncWorkAcrossRoots.*)$/.test(fn)) return 'React render/commit'
    }
    for (const [fn] of chain) if (/^(dispatchEvent|dispatchContinuousEvent|dispatchDiscreteEvent)$/.test(fn)) return 'React event dispatch'
    for (const [, file] of chain) if (/next-devtools|next_dist_115|next_dist_client/.test(file)) return 'Next dev tooling'
    return 'other'
  }
  const walk = (n, chain) => {
    const cf = n.callFrame
    const file = (cf.url || '').split('/').pop().split('?')[0]
    const k = `${cf.functionName || '(anon)'} ${file}:${cf.lineNumber + 1}`
    const next = [...chain, [cf.functionName, file]]
    if (n.selfSize) {
      total += n.selfSize
      byFn[k] = (byFn[k] || 0) + n.selfSize
      let owner = file || '(native)'
      if (!file) for (let i = chain.length - 1; i >= 0; i--) if (chain[i][1]) { owner = chain[i][1]; break }
      byFile[owner] = (byFile[owner] || 0) + n.selfSize
      const b = bucketOf(next)
      buckets[b] = (buckets[b] || 0) + n.selfSize
      if (b === 'scene frame (rAF tick)') tickFns[k] = (tickFns[k] || 0) + n.selfSize
    }
    for (const c of n.children || []) walk(c, next)
  }
  walk(profile.head, [])
  fs.writeFileSync(path.join(RAW, `scroll-${build}-${vpName}.heapprofile.json.gz`), zlib.gzipSync(JSON.stringify(profile)))
  const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => [k, v])
  out.alloc = {
    gestureMs: gestureMsB,
    sceneFrames: framesB,
    rafTicks: c1.ticks - c0.ticks,
    sampledBytes: total,
    bytesPerSceneFrame: Math.round(total / Math.max(1, framesB)),
    heapBefore: m0,
    heapAfterNoGc: m1,
    heapAfterGc: m2,
    growthNoGcPerFrame: Math.round((m1 - m0) / Math.max(1, framesB)),
    retainedAfterGc: m2 - m0,
    topFunctions: top(byFn, 25),
    byFile: top(byFile, 15),
    buckets,
    sceneFrameBytesPerFrame: Math.round((buckets['scene frame (rAF tick)'] || 0) / Math.max(1, framesB)),
    sceneFrameTopFunctions: top(tickFns, 15),
  }
  log(`[scroll ${build} ${vpName}] alloc: ${framesB} frames, ${total} sampled bytes = ${out.alloc.bytesPerSceneFrame} B/frame (scene tick only: ${out.alloc.sceneFrameBytesPerFrame} B/frame; buckets ${JSON.stringify(buckets)}); heap ${m0} -> ${m1} (no GC) -> ${m2} (after GC)`)
  log(`[scroll ${build} ${vpName}] top allocators: ${out.alloc.topFunctions.slice(0, 6).map(([k, v]) => `${k}=${v}`).join(' | ')}`)
  await P.ctx.close()
  return out
}

async function sectionScroll(browser) {
  const vps = VP_LIST ? VP_LIST.split(',') : ['split']
  const R = { env0: env(), runs: [] }
  for (const vp of vps) {
    for (const b of ['v2', 'codex']) {
      R.runs.push(await scrollBuild(browser, b, vp))
      save('scroll.json', R)
    }
  }
  R.env1 = env()
  save('scroll.json', R)
  return R
}

// ── Section: remount ─────────────────────────────────────────────────────────

/**
 * Cross the 760 px list/world breakpoint N times. Each crossing unmounts the
 * scene (list view) and mounts a new one: new WebGL context, glb decode, tree
 * LOD. Counts contexts created, Chrome's context-limit warning, the cost of
 * each rebuild (long tasks, tree LOD log) and the heap after a forced GC.
 */
async function sectionRemount(browser) {
  const R = { env0: env(), builds: {} }
  const N = Number(arg('--toggles', '6'))
  for (const b of ['v2', 'codex']) {
    const P = await openPage(browser, 'laptop', { gl: true })
    const { page } = P
    await goto(P, b)
    await waitReady(page, b)
    await waitFirstFrame(page)
    await sleep(1500)
    const heap = async () =>
      page.evaluate(() => {
        window.gc && window.gc()
        return +(performance.memory.usedJSHeapSize / 1048576).toFixed(2)
      })
    const rows = [{ i: 0, contexts: await page.evaluate(() => window.__perf.contexts), heapMB: await heap() }]
    for (let i = 1; i <= N; i++) {
      const lt0 = await page.evaluate(() => window.__perf.lt.length)
      await page.setViewport({ width: 700, height: 900, deviceScaleFactor: 1 })
      await page.waitForFunction((b) => (b === 'v2' ? window.__worldView === 'list' : document.querySelector('main[data-view="list"]')), { polling: 200, timeout: 600000 }, b)
      await sleep(800)
      const d0 = await page.evaluate(() => window.__perf.draws)
      const t0 = Date.now()
      await page.setViewport({ width: VPS.laptop.w, height: VPS.laptop.h, deviceScaleFactor: 1 })
      if (b === 'v2') await page.waitForFunction(() => window.__worldReady === true && window.__worldView === 'world' && window.__worldFrame, { polling: 100, timeout: 600000 })
      else await page.waitForSelector('main[data-view="world"][data-ready="true"]', { timeout: 600000 })
      await page.waitForFunction((d0) => window.__perf.draws > d0 + 10, { polling: 100, timeout: 600000 }, d0)
      const back = Date.now() - t0
      await sleep(1500)
      const st = await page.evaluate((lt0) => ({ contexts: window.__perf.contexts, lt: window.__perf.lt.slice(lt0), canvases: document.querySelectorAll('canvas').length }), lt0)
      rows.push({ i, backToWorldMs: back, contexts: st.contexts, canvases: st.canvases, maxLongTask: st.lt.reduce((m, t) => Math.max(m, t.d), 0), heapMB: await heap() })
      log(`[remount ${b}] #${i}: world again in ${back} ms, contexts created ${st.contexts}, canvases ${st.canvases}, longest task ${rows[rows.length - 1].maxLongTask} ms, heap ${rows[rows.length - 1].heapMB} MB`)
    }
    R.builds[b] = {
      rows,
      contextWarnings: P.cons.filter((c) => /too many active webgl|context lost|CONTEXT_LOST/i.test(c.text)).map((c) => c.text),
      treeLod: P.cons.filter((c) => /tree LOD/.test(c.text)).map((c) => c.text),
      errors: P.cons.filter((c) => c.type === 'error' || c.type === 'pageerror').map((c) => c.text),
      glbFetches: [...P.net.values()].filter((r) => /\.glb/.test(r.url)).map((r) => ({ url: r.url, cache: r.cache, encoded: r.encoded })),
    }
    await P.ctx.close()
  }
  R.env1 = env()
  save('remount.json', R)
  return R
}

// ── Main ─────────────────────────────────────────────────────────────────────

const browser = await launch()
try {
  log(`sections: ${ONLY.join(',')}; load avg ${os.loadavg().map((x) => x.toFixed(2)).join(' ')}`)
  if (ONLY.includes('load')) await sectionLoad(browser)
  if (ONLY.includes('profile')) await sectionProfile(browser)
  if (ONLY.includes('idle')) await sectionIdle(browser)
  if (ONLY.includes('scroll')) await sectionScroll(browser)
  if (ONLY.includes('sweep')) await sectionSweep(browser)
  if (ONLY.includes('remount')) await sectionRemount(browser)
} finally {
  await browser.close()
}
