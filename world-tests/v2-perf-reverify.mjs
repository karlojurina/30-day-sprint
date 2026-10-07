/**
 * Perf re-verification helpers for /dev/world-v2 after the fix pass (companion to v2-perf.mjs).
 *
 *   node world-tests/v2-perf-reverify.mjs --only trace --runs 2          # task wall vs CPU time
 *   node world-tests/v2-perf-reverify.mjs --only firstframe --runs 2
 *   node world-tests/v2-perf-reverify.mjs --only slices --slice-runs 3
 *   node world-tests/v2-perf-reverify.mjs --only remountlod
 *   node world-tests/v2-perf-reverify.mjs --only dprlist
 *   node world-tests/v2-perf-reverify.mjs --only parks --parks a5,a6,a7,a8   # tris/calls through each park flight (split)
 *
 * firstframe  v2-perf.mjs's load section takes the first burst of >= 10 draw calls as the first
 *             world frame. Since the fix, v2 bakes the sea's PMREM inside adopt() (13 draws) long
 *             before ready, so that metric fires early for v2. Here: the first burst of >= 30 draws
 *             (v2 187-188, Astra 49), and the 2nd rAF after it (when it reached the screen).
 * slices      CPU profile over a cold v2 load; each long task (PerformanceObserver) is mapped onto
 *             the profile (aligned on the WebGL context task) and its functions listed.
 * trace       Chrome trace over a cold load: every renderer-main task >= 50 ms with wall time (dur)
 *             AND thread CPU time (tdur). Under a contended machine (other headless Chromes) wall
 *             time includes descheduling and GPU-process waits; tdur is the page's own cost.
 * remountlod  cross the 760 px breakpoint 3x: tree LOD console line per mount, WebGL contexts
 *             created vs still alive (not lost), canvases.
 * dprlist     canvas backing ratio at DPR 2 (pixel-ratio cap), and the list view (phone, tablet)
 *             fetching no glb / Draco / three and holding no world preload links.
 *
 * Writes JSON to world-tests/shots/v2-verify/perf-reverify/.
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.BASE_URL || 'http://localhost:3111'
const OUT = path.join(HERE, 'shots', 'v2-verify', 'perf-reverify')
fs.mkdirSync(OUT, { recursive: true })
const argv = process.argv.slice(2)
const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d)
const ONLY = arg('--only', 'firstframe,slices,remountlod').split(',')
const RUNS = Number(arg('--runs', '3'))
const VPS = { split: { w: 1691, h: 1278 }, ultra: { w: 3428, h: 1230 }, laptop: { w: 1440, h: 900 } }
const ROUTE = { v2: '/dev/world-v2', codex: '/dev/world-codex' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const r1 = (x) => (x == null ? x : Math.round(x * 10) / 10)

function init() {
  const now = () => performance.now()
  const P = (window.__rv = { lt: [], loaf: [], bursts: [], raf: [], ready: null, contexts: [], draws: 0 })
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) P.lt.push({ s: +e.startTime.toFixed(1), d: +e.duration.toFixed(1) })
  }).observe({ type: 'longtask', buffered: true })
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries())
        P.loaf.push({
          s: +e.startTime.toFixed(1),
          d: +e.duration.toFixed(1),
          scripts: (e.scripts || []).map((sc) => ({ d: +sc.duration.toFixed(1), fn: sc.sourceFunctionName || '', src: (sc.sourceURL || '').split('/').pop().slice(0, 70), inv: String(sc.invoker || '').slice(0, 60) })).sort((a, b) => b.d - a.d).slice(0, 3),
        })
    }).observe({ type: 'long-animation-frame', buffered: true })
  } catch {}
  let ready
  Object.defineProperty(Object.getPrototypeOf(window), '__worldReady', {
    configurable: true,
    get: () => ready,
    set(v) {
      ready = v
      if (v === true && P.ready == null) P.ready = now()
    },
  })
  if (location.pathname.includes('codex')) {
    const mo = new MutationObserver(() => {
      if (P.ready == null && document.querySelector('main[data-ready="true"]')) {
        P.ready = now()
        mo.disconnect()
      }
    })
    mo.observe(document, { subtree: true, attributes: true, attributeFilter: ['data-ready'] })
  }
  const gc = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = function (a, b) {
    const c = gc.call(this, a, b)
    if (/webgl/.test(a) && c && !P.contexts.includes(c)) P.contexts.push(c)
    return c
  }
  let inBurst = false
  let cur = null
  const end = () => {
    P.bursts.push(cur)
    inBurst = false
  }
  const hit = () => {
    P.draws++
    if (!inBurst) {
      inBurst = true
      cur = { s: +now().toFixed(1), n: 0, e: 0 }
      queueMicrotask(() => {
        cur.e = +now().toFixed(1)
        end()
      })
    }
    cur.n++
  }
  for (const C of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
    if (!C) continue
    for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements']) {
      const o = C.prototype[name]
      if (o)
        C.prototype[name] = function (...a) {
          hit()
          return o.apply(this, a)
        }
    }
  }
  const rq = window.requestAnimationFrame.bind(window)
  const rec = (t) => {
    P.raf.push(+t.toFixed(1))
    if (t < 30000) rq(rec)
  }
  rq(rec)
}

async function launch() {
  return puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    protocolTimeout: 1800000,
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars', '--js-flags=--expose-gc', '--enable-precise-memory-info'],
  })
}

async function openPage(browser, vp, noCache = true) {
  const ctx = await browser.createBrowserContext()
  const page = await ctx.newPage()
  page.setDefaultTimeout(1800000)
  const cdp = await page.createCDPSession()
  await cdp.send('Network.enable')
  if (noCache) await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
  const reqs = []
  cdp.on('Network.requestWillBeSent', (e) => reqs.push({ url: e.request.url, t: e.timestamp }))
  const cons = []
  page.on('console', (m) => {
    const t = m.text()
    if (/GPU stall|GL Driver Message|WebGL-|swiftshader|Automatic fallback/i.test(t)) return
    cons.push({ type: m.type(), text: t.slice(0, 300) })
  })
  page.on('pageerror', (e) => cons.push({ type: 'pageerror', text: e.message }))
  await page.evaluateOnNewDocument(init)
  await page.setViewport({ width: VPS[vp].w, height: VPS[vp].h, deviceScaleFactor: 1 })
  return { ctx, page, cdp, cons, reqs }
}

async function waitReady(page, build) {
  if (build === 'v2') await page.waitForFunction(() => window.__worldReady === true || typeof window.__worldError === 'string', { polling: 100, timeout: 600000 })
  else await page.waitForSelector('main[data-ready="true"]', { timeout: 600000 })
}

async function firstFrame(browser, build, vp) {
  const P = await openPage(browser, vp)
  await P.page.goto(`${BASE}${ROUTE[build]}`, { waitUntil: 'domcontentloaded', timeout: 300000 })
  await waitReady(P.page, build)
  // The first real world frame: >= 30 draws, after ready; then two more rAFs.
  await P.page.waitForFunction(
    () => {
      const R = window.__rv
      const f = R.bursts.find((b) => b.n >= 30)
      return f && R.raf.filter((t) => t > f.e).length >= 2
    },
    { polling: 100, timeout: 600000 },
  )
  await sleep(3000)
  const d = await P.page.evaluate(() => {
    const R = window.__rv
    const fcp = performance.getEntriesByType('paint').find((e) => e.name === 'first-contentful-paint')?.startTime ?? 0
    const f = R.bursts.find((b) => b.n >= 30)
    const pre = R.bursts.filter((b) => b.s < R.ready - 1)
    const after = R.raf.filter((t) => t > f.e)
    const lost = R.contexts.filter((c) => c.isContextLost()).length
    return { fcp: +fcp.toFixed(1), ready: +R.ready.toFixed(1), first: f, presented: after[1], preReadyBursts: pre, lt: R.lt, loaf: R.loaf, contexts: R.contexts.length, lost }
  })
  const res = {
    build,
    vp,
    load: os.loadavg().map((x) => +x.toFixed(2)),
    fcpMs: d.fcp,
    readyMs: d.ready,
    firstWorldFrame: d.first,
    firstWorldFramePresentedMs: d.presented,
    preReadyBursts: d.preReadyBursts,
    longTasksAfterFcp: d.lt.filter((t) => t.s >= d.fcp),
    maxLongTaskAfterFcp: d.lt.filter((t) => t.s >= d.fcp).reduce((m, t) => Math.max(m, t.d), 0),
    loaf: d.loaf.filter((l) => l.d >= 100),
    treeLod: P.cons.filter((c) => /tree LOD/.test(c.text)).map((c) => c.text),
    errors: P.cons.filter((c) => c.type === 'error' || c.type === 'pageerror').map((c) => c.text),
    warnings: P.cons.filter((c) => /warn/.test(c.type)).map((c) => c.text),
    glbRequests: P.reqs.filter((r) => /\.glb|draco/.test(r.url)).map((r) => r.url.split('/').pop()),
    apiRequests: P.reqs.filter((r) => /\/api\//.test(r.url)).length,
    contexts: d.contexts,
  }
  log(
    `[firstframe ${vp} ${build}] FCP ${res.fcpMs} ready ${res.readyMs} first world frame ${res.firstWorldFrame.s}-${res.firstWorldFrame.e} (${res.firstWorldFrame.n} draws) presented ${res.firstWorldFramePresentedMs}; pre-ready bursts ${JSON.stringify(res.preReadyBursts)}; LT after FCP ${JSON.stringify(res.longTasksAfterFcp)}; ${res.treeLod.join(' ')}; errors ${res.errors.length}, api ${res.apiRequests}`,
  )
  await P.ctx.close()
  return res
}

// ── CPU profile task split ──
function tasksFromProfile(profile) {
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]))
  const parent = new Map()
  for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id)
  const name = (id) => nodes.get(id).callFrame.functionName
  const samples = profile.samples
  const deltas = profile.timeDeltas
  let t = profile.startTime / 1000
  const times = samples.map((_, i) => (t += deltas[i] / 1000))
  const dur = samples.map((_, i) => (i + 1 < deltas.length ? deltas[i + 1] / 1000 : 0))
  const idle = (id) => name(id) === '(idle)'
  const tasks = []
  let cur = null
  for (let i = 0; i < samples.length; i++) {
    if (idle(samples[i])) {
      if (cur && dur[i] > 1) {
        tasks.push(cur)
        cur = null
      }
      continue
    }
    if (!cur) cur = { s: times[i], e: times[i] + dur[i], fns: {}, dev: 0, n: 0 }
    cur.e = times[i] + dur[i]
    cur.n++
    const seen = new Set()
    let dev = false
    for (let x = samples[i]; x != null; x = parent.get(x)) {
      const nm = name(x)
      if (['wrapperMethod', 'createLogEntry', 'getErrorStack'].includes(nm)) dev = true
      if (['adopt', 'instanceRepeats', 'simplifyForDistance', 'buildHeightfield', 'giveSeaTheSky', 'indexLandmarks', 'parse', 'WebGLRenderer', 'render', 'getProgramParameter', 'compile', 'WorldScene', 'makeInstanced', 'shareGeometry', 'splitByDistance', 'patchFog'].includes(nm)) seen.add(nm)
    }
    for (const nm of seen) cur.fns[nm] = (cur.fns[nm] || 0) + dur[i]
    if (dev) cur.dev += dur[i]
  }
  if (cur) tasks.push(cur)
  const t0 = profile.startTime / 1000
  return tasks.map((k) => ({ startMs: r1(k.s - t0), durMs: r1(k.e - k.s), devConsoleMs: r1(k.dev), fns: Object.fromEntries(Object.entries(k.fns).map(([a, b]) => [a, r1(b)])) }))
}

/** Functions inside a window of the profile (ms from profile start). */
function windowComposition(profile, fromMs, toMs) {
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]))
  const parent = new Map()
  for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id)
  const label = (id) => {
    const cf = nodes.get(id).callFrame
    return `${cf.functionName || '(anon)'} ${(cf.url || '').split('/').pop().split('?')[0].slice(0, 28)}:${cf.lineNumber + 1}`
  }
  const deltas = profile.timeDeltas
  let t = 0
  const inc = {}
  let busy = 0
  let dev = 0
  for (let i = 0; i < profile.samples.length; i++) {
    t += deltas[i] / 1000
    if (t < fromMs || t >= toMs) continue
    const d = i + 1 < deltas.length ? deltas[i + 1] / 1000 : 0
    const id = profile.samples[i]
    if (nodes.get(id).callFrame.functionName === '(idle)') continue
    busy += d
    const seen = new Set()
    let isDev = false
    for (let x = id; x != null; x = parent.get(x)) {
      const k = label(x)
      if (/^(wrapperMethod|createLogEntry|getErrorStack) /.test(k)) isDev = true
      if (seen.has(k) || /^\((root|program)\)/.test(k)) continue
      seen.add(k)
      inc[k] = (inc[k] || 0) + d
    }
    if (isDev) dev += d
  }
  return {
    busyMs: r1(busy),
    devConsoleMs: r1(dev),
    top: Object.entries(inc)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 22)
      .map(([k, v]) => [r1(v), k]),
  }
}

async function slices(browser) {
  const out = []
  for (let i = 0; i < Number(arg('--slice-runs', '3')); i++) {
    const P = await openPage(browser, 'split')
    await P.page.goto(`${BASE}/world-v2/draco/draco_wasm_wrapper.js`, { waitUntil: 'load' })
    await P.cdp.send('Profiler.enable')
    await P.cdp.send('Profiler.setSamplingInterval', { interval: 100 })
    await P.cdp.send('Profiler.start')
    await P.page.goto(`${BASE}${ROUTE.v2}`, { waitUntil: 'domcontentloaded' })
    await waitReady(P.page, 'v2')
    await sleep(2500)
    const { profile } = await P.cdp.send('Profiler.stop')
    const lt = await P.page.evaluate(() => window.__rv.lt)
    fs.writeFileSync(path.join(OUT, `slices-v2-${i}.cpuprofile.gz`), zlib.gzipSync(JSON.stringify(profile)))
    // Align the page clock to the profile: the WebGL context creation (the task holding getContext).
    const tasks = tasksFromProfile(profile)
    const ctxTask = tasks.find((k) => k.fns.WebGLRenderer || k.fns.WorldScene)
    const ctxLt = [...lt].filter((x) => ctxTask && Math.abs(x.d - ctxTask.durMs) < Math.max(40, ctxTask.durMs * 0.2)).sort((a, b) => b.d - a.d)[0]
    const offset = ctxLt && ctxTask ? ctxLt.s - ctxTask.startMs : null
    const rows = lt.map((x) => ({ ...x, comp: offset == null ? null : windowComposition(profile, x.s - offset, x.s - offset + x.d) }))
    const row = { run: i, load: os.loadavg().map((x) => +x.toFixed(2)), offset, longTasks: rows, treeLod: P.cons.filter((c) => /tree LOD/.test(c.text)).map((c) => c.text) }
    log(`[slices #${i}] offset ${offset}; ${row.treeLod.join(' ')}`)
    for (const x of rows) log(`   LT ${x.d} ms @${x.s}: busy ${x.comp?.busyMs} (dev console ${x.comp?.devConsoleMs}) ${x.comp ? x.comp.top.slice(0, 12).map(([v, k]) => `${v} ${k}`).join(' | ') : ''}`)
    out.push(row)
    await P.ctx.close()
  }
  fs.writeFileSync(path.join(OUT, 'slices.json'), JSON.stringify(out, null, 1))
}

/**
 * Task cost that survives CPU contention: a Chrome trace over a cold load. Every renderer-main
 * RunTask of >= 50 ms wall is listed with its wall time (dur) and thread CPU time (tdur, which
 * leaves out time the thread was descheduled), and what ran inside it.
 */
async function traceLoad(browser, build, vp) {
  const P = await openPage(browser, vp)
  await P.page.tracing.start({ categories: ['toplevel', 'devtools.timeline', 'disabled-by-default-devtools.timeline', 'v8.execute', 'blink.user_timing'] })
  await P.page.goto(`${BASE}${ROUTE[build]}`, { waitUntil: 'domcontentloaded', timeout: 300000 })
  await waitReady(P.page, build)
  await P.page.waitForFunction(() => {
    const R = window.__rv
    const f = R.bursts.find((b) => b.n >= 30)
    return f && R.raf.filter((t) => t > f.e).length >= 2
  }, { polling: 100, timeout: 600000 })
  await sleep(1500)
  const buf = await P.page.tracing.stop()
  const ev = JSON.parse(Buffer.from(buf).toString('utf8')).traceEvents
  // The renderer main thread with the most FunctionCall events for this route.
  const threads = ev.filter((e) => e.ph === 'M' && e.name === 'thread_name' && e.args?.name === 'CrRendererMain')
  let best = null
  for (const t of threads) {
    const n = ev.filter((e) => e.pid === t.pid && e.tid === t.tid && e.name === 'FunctionCall').length
    if (!best || n > best.n) best = { pid: t.pid, tid: t.tid, n }
  }
  const main = ev.filter((e) => e.pid === best.pid && e.tid === best.tid && e.ph === 'X')
  const nav = main.find((e) => e.name === 'CommitLoad' || e.name === 'ResourceSendRequest') || main[0]
  const fcpEv = ev.find((e) => e.name === 'firstContentfulPaint' && e.pid === best.pid)
  const t0 = nav.ts
  const tasks = main.filter((e) => e.name === 'ThreadControllerImpl::RunTask').filter((e) => (e.dur || 0) >= 50000)
  const rows = tasks.map((t) => {
    const inner = main.filter((e) => e.ts >= t.ts && e.ts + (e.dur || 0) <= t.ts + t.dur && e !== t && ['FunctionCall', 'EventDispatch', 'EvaluateScript', 'FireAnimationFrame', 'TimerFire', 'v8.evaluateModule', 'RunMicrotasks', 'ParseHTML', 'v8.compileModule'].includes(e.name))
    const what = inner
      .sort((a, b) => (b.dur || 0) - (a.dur || 0))
      .slice(0, 4)
      .map((e) => {
        const d = e.args?.data || {}
        const tag = d.functionName || d.type || (d.url || '').split('/').pop().slice(0, 50) || ''
        return `${e.name}:${tag}:${((e.dur || 0) / 1000).toFixed(0)}`
      })
    return { atMs: +((t.ts - t0) / 1000).toFixed(1), wallMs: +(t.dur / 1000).toFixed(1), cpuMs: t.tdur != null ? +(t.tdur / 1000).toFixed(1) : null, what }
  })
  const d = await P.page.evaluate(() => ({ ready: window.__rv.ready, pmrem: window.__rv.bursts.filter((b) => b.n < 30 && b.n >= 10).map((b) => b.s) }))
  await P.ctx.close()
  return { build, vp, load: os.loadavg().map((x) => +x.toFixed(2)), fcpMs: fcpEv ? +((fcpEv.ts - t0) / 1000).toFixed(1) : null, readyMs: d.ready, tasks: rows }
}

async function traceSection(browser) {
  const rows = []
  for (const b of ['v2', 'codex']) {
    const P = await openPage(browser, 'split', false)
    await P.page.goto(`${BASE}${ROUTE[b]}`, { waitUntil: 'domcontentloaded' })
    await waitReady(P.page, b)
    await P.ctx.close()
  }
  for (const vp of arg('--vp', 'split,ultra,laptop').split(','))
    for (let i = 0; i < RUNS; i++)
      for (const b of i % 2 ? ['codex', 'v2'] : ['v2', 'codex']) {
        const r = await traceLoad(browser, b, vp)
        r.run = i
        rows.push(r)
        log(`[trace ${vp} ${b} #${i}] load ${r.load[0]} ready ${r.readyMs?.toFixed?.(0)}: ${r.tasks.map((t) => `${t.wallMs}/${t.cpuMs}cpu@${t.atMs} [${t.what.join(' ')}]`).join(' || ')}`)
        fs.writeFileSync(path.join(OUT, 'trace-tasks.json'), JSON.stringify(rows, null, 1))
      }
}

/** Pixel-ratio cap at DPR 2 (canvas backing size / CSS size), and the list view fetching no world bytes. */
async function dprAndList(browser) {
  const out = { dpr: {}, list: {} }
  for (const b of ['v2', 'codex']) {
    const ctx = await browser.createBrowserContext()
    const page = await ctx.newPage()
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 })
    await page.goto(`${BASE}${ROUTE[b]}`, { waitUntil: 'domcontentloaded' })
    await waitReady(page, b)
    await sleep(1000)
    out.dpr[b] = await page.evaluate(() => [...document.querySelectorAll('canvas')].map((c) => ({ w: c.width, cssW: c.clientWidth, ratio: +(c.width / c.clientWidth).toFixed(3) })))
    log(`[dpr ${b}] at DPR 2: ${JSON.stringify(out.dpr[b])}`)
    await ctx.close()
  }
  for (const [name, w, h] of [['phone', 390, 844], ['tablet', 700, 1000]]) {
    const ctx = await browser.createBrowserContext()
    const page = await ctx.newPage()
    const urls = []
    page.on('request', (r) => urls.push(r.url()))
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 })
    await page.goto(`${BASE}${ROUTE.v2}`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => window.__worldView === 'list', { polling: 100, timeout: 120000 })
    await sleep(4000)
    const links = await page.evaluate(() => [...document.querySelectorAll('link[rel=preload]')].map((l) => l.getAttribute('href')))
    out.list[name] = { worldBytes: urls.filter((u) => /\.glb|draco/.test(u)), threeChunks: urls.filter((u) => /three/.test(u)).map((u) => u.split('/').pop()), preloadLinks: links, canvases: await page.evaluate(() => document.querySelectorAll('canvas').length) }
    log(`[list ${name}] ${JSON.stringify(out.list[name])}`)
    await ctx.close()
  }
  fs.writeFileSync(path.join(OUT, 'dpr-list.json'), JSON.stringify(out, null, 1))
}

/** Triangles and draw calls through a park flight to each listed place and back (no rail pass). */
async function parksOnly(browser) {
  const DEPTH = { a1: 0.0708, a2: 0.1934, a3: 0.3, a4: 0.4151, a5: 0.5236, a6: 0.6321, a7: 0.6863, a8: 0.8302 }
  const ids = arg('--parks', 'a5,a6,a7,a8').split(',')
  const ctx = await browser.createBrowserContext()
  const page = await ctx.newPage()
  page.setDefaultTimeout(1800000)
  await page.setViewport({ width: VPS.split.w, height: VPS.split.h, deviceScaleFactor: 1 })
  await page.goto(`${BASE}${ROUTE.v2}`, { waitUntil: 'domcontentloaded' })
  await waitReady(page, 'v2')
  const out = []
  for (const id of ids) {
    await page.evaluate((d) => window.scrollTo(0, Math.round(window.__worldScrollFor(d))), DEPTH[id])
    await page.waitForFunction(() => {
      const f = window.__worldFrame
      const max = window.__worldScrollFor(0.88)
      const target = Math.min(1, window.scrollY / max) * 0.88
      return f && f.parkProgress === 0 && Math.abs(f.depth - target) < 1e-6
    }, { polling: 200, timeout: 1800000 })
    const stop = await page.evaluate(() => ({ triangles: window.__worldFrame.triangles, calls: window.__worldFrame.calls }))
    const rec = await page.evaluate(
      (id) =>
        new Promise((res) => {
          const rows = []
          let lastN = window.__worldFrameCount
          let phase = 'in'
          let quiet = 0
          window.__worldPark(id)
          const loop = () => {
            const n = window.__worldFrameCount
            const f = window.__worldFrame
            if (n !== lastN) {
              lastN = n
              quiet = performance.now()
              rows.push([phase, +f.parkProgress.toFixed(4), f.triangles, f.calls])
            }
            const now = performance.now()
            if (phase === 'in' && f.parkProgress === 1 && now - quiet > 1200) {
              phase = 'out'
              window.__worldPark(null)
            } else if (phase === 'out' && f.parkProgress === 0 && now - quiet > 1200) return res(rows)
            requestAnimationFrame(loop)
          }
          requestAnimationFrame(loop)
        }),
      id,
    )
    const landed = rec.filter((r) => r[0] === 'in' && r[1] === 1).pop()
    const row = { id, stop, maxTriangles: Math.max(...rec.map((r) => r[2])), maxCalls: Math.max(...rec.map((r) => r[3])), landed: landed ? { triangles: landed[2], calls: landed[3] } : null, frames: rec.length }
    out.push(row)
    log(`[parks] ${JSON.stringify(row)}`)
    fs.writeFileSync(path.join(OUT, `parks-${ids.join('')}.json`), JSON.stringify(out, null, 1))
  }
  await ctx.close()
}

async function remountLod(browser) {
  const out = {}
  for (const b of ['v2', 'codex']) {
    const P = await openPage(browser, 'laptop', false)
    await P.page.goto(`${BASE}${ROUTE[b]}`, { waitUntil: 'domcontentloaded' })
    await waitReady(P.page, b)
    await sleep(1500)
    const rows = []
    const snap = () => P.page.evaluate(() => ({ created: window.__rv.contexts.length, alive: window.__rv.contexts.filter((c) => !c.isContextLost()).length, canvases: document.querySelectorAll('canvas').length }))
    rows.push({ i: 0, ...(await snap()), lod: P.cons.filter((c) => /tree LOD/.test(c.text)).length })
    for (let i = 1; i <= 3; i++) {
      const loaf0 = await P.page.evaluate(() => window.__rv.loaf.length)
      await P.page.setViewport({ width: 700, height: 900, deviceScaleFactor: 1 })
      await P.page.waitForFunction((b) => (b === 'v2' ? window.__worldView === 'list' : document.querySelector('main[data-view="list"]')), { polling: 200 }, b)
      await sleep(800)
      const inList = await snap()
      const t0 = Date.now()
      await P.page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
      if (b === 'v2') await P.page.waitForFunction(() => window.__worldReady === true && window.__worldView === 'world' && window.__worldFrame, { polling: 100 })
      else await P.page.waitForSelector('main[data-view="world"][data-ready="true"]')
      const back = Date.now() - t0
      await sleep(1500)
      const loaf = await P.page.evaluate((n) => window.__rv.loaf.slice(n).filter((l) => l.d >= 150), loaf0)
      rows.push({ i, backMs: back, inList, ...(await snap()), lod: P.cons.filter((c) => /tree LOD/.test(c.text)).length, loaf })
      for (const l of loaf) log(`   loaf ${l.d} ms: ${l.scripts.map((sc) => `${sc.d} ${sc.fn}|${sc.src.slice(0, 40)}|${sc.inv}`).join(' ; ')}`)
      log(`[remountlod ${b}] #${i} back in ${back} ms, in list ${JSON.stringify(inList)}, now ${JSON.stringify(rows[rows.length - 1])}`)
    }
    out[b] = { rows, lodLines: P.cons.filter((c) => /tree LOD/.test(c.text)).map((c) => c.text), errors: P.cons.filter((c) => c.type === 'error' || c.type === 'pageerror').map((c) => c.text), warnings: P.cons.filter((c) => /warn/.test(c.type)).map((c) => c.text) }
    await P.ctx.close()
  }
  fs.writeFileSync(path.join(OUT, 'remountlod.json'), JSON.stringify(out, null, 1))
}

const browser = await launch()
try {
  log('load avg', os.loadavg().map((x) => x.toFixed(2)).join(' '))
  if (ONLY.includes('firstframe')) {
    const vps = arg('--vp', 'split,ultra,laptop').split(',')
    const rows = []
    // Warm compile.
    for (const b of ['v2', 'codex']) {
      const P = await openPage(browser, 'split', false)
      await P.page.goto(`${BASE}${ROUTE[b]}`, { waitUntil: 'domcontentloaded' })
      await waitReady(P.page, b)
      await P.ctx.close()
    }
    for (const vp of vps) for (let i = 0; i < RUNS; i++) for (const b of i % 2 ? ['codex', 'v2'] : ['v2', 'codex']) rows.push({ run: i, ...(await firstFrame(browser, b, vp)) })
    fs.writeFileSync(path.join(OUT, 'firstframe.json'), JSON.stringify(rows, null, 1))
  }
  if (ONLY.includes('slices')) await slices(browser)
  if (ONLY.includes('remountlod')) await remountLod(browser)
  if (ONLY.includes('trace')) await traceSection(browser)
  if (ONLY.includes('dprlist')) await dprAndList(browser)
  if (ONLY.includes('parks')) await parksOnly(browser)
} finally {
  await browser.close()
}
