/**
 * Adversarial interaction / accessibility / robustness checks for /dev/world-v2.
 *
 *   node world-tests/v2-interaction.mjs                       # every scenario
 *   node world-tests/v2-interaction.mjs --only keyboard,dock  # a subset
 *   node world-tests/v2-interaction.mjs --only dock --vp split
 *
 * Scenarios: keyboard, dock, next, reduced, narrow, nowebgl, resize, rapid,
 * wheel, contextloss. Each writes shots/v2-verify/interaction/<scenario>*.png
 * and shots/v2-verify/interaction/<scenario>.json.
 *
 * Same Chrome flags and the same requestAnimationFrame gate as v2-render.mjs
 * (the scene clock is the sum of clamped per-frame dt, so SwiftShader's slow
 * frames do not distort scene-time measurements). The gate here also records
 * the camera pose on every frame while its clock runs.
 *
 * Nothing in here edits the app. It only drives it through real input
 * (keyboard, mouse, wheel, viewport) and the page's own test hooks.
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.BASE_URL || 'http://localhost:3111'
const ROUTE = '/dev/world-v2'
const OUT = process.env.OUT_DIR || path.join(HERE, 'shots', 'v2-verify', 'interaction')
fs.mkdirSync(OUT, { recursive: true })

const VPS = {
  split: { name: 'split', width: 1691, height: 1278 },
  ultra: { name: 'ultra', width: 3428, height: 1230 },
  laptop: { name: 'laptop', width: 1440, height: 900 },
  phone: { name: 'phone', width: 390, height: 844 },
  tablet: { name: 'tablet', width: 740, height: 1000 },
}
const AREAS = [
  ['a1', 'Introduction', 'LM_Lighthouse', 0.0708],
  ['a2', 'Fundamentals', 'LM_Windmill', 0.1934],
  ['a3', 'Video Ads I', 'LM_Bridge', 0.3],
  ['a4', 'Video Ads II', 'LM_Viaduct', 0.4151],
  ['a5', 'Static Ads', 'LM_Watchtower', 0.5236],
  ['a6', 'AI Ads & Content', 'LM_Cairn', 0.6321],
  ['a7', 'Creative Strategy', 'LM_Jetty', 0.6863],
  ['a8', 'Job Board', 'LM_Obelisk', 0.8302],
]

const args = process.argv.slice(2)
const ONLY = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null
const VP_ARG = args.includes('--vp') ? args[args.indexOf('--vp') + 1].split(',') : null
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

// ── Page setup ───────────────────────────────────────────────────────────────

/** v2-render.mjs's frame gate, plus per-frame camera poses while the clock runs. */
function installGate() {
  const real = window.requestAnimationFrame.bind(window)
  const cancelReal = window.cancelAnimationFrame.bind(window)
  const live = new Map()
  let nextId = 1
  const G = {
    held: false, queue: [], frameT: -1, frames: 0, times: [],
    clockOn: false, clock: 0, t0: 0, lastT: 0, holdAt: Infinity, rows: [],
    start(t0) { this.t0 = t0; this.lastT = t0; this.clock = 0; this.clockOn = true; this.rows = []; this.holdAt = Infinity },
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
        G.times.push(t)
        if (G.times.length > 600) G.times.shift()
        if (G.clockOn) { G.clock += Math.min(0.05, Math.max(0, (t - G.lastT) / 1000)); G.lastT = t }
      }
      cb(t)
      if (G.clockOn) {
        const f = window.__worldFrame
        const cam = window.__worldCamera ? window.__worldCamera() : null
        const row = { at: t, t: t - G.t0, clock: G.clock, p: f ? f.parkProgress : null, depth: f ? f.depth : null, parked: f ? f.parkedId : null, cam, n: window.__worldFrameCount, vw: innerWidth, vh: innerHeight }
        const last = G.rows[G.rows.length - 1]
        if (last && last.at === t) Object.assign(last, row)
        else G.rows.push(row)
        if (G.clock >= G.holdAt - 1e-9) { G.held = true; G.holdAt = Infinity }
      }
    }
    live.set(id, real(run))
    return id
  }
  window.cancelAnimationFrame = function (id) {
    const r = live.get(id)
    if (r !== undefined) { cancelReal(r); live.delete(id) }
  }
}

function killWebGL() {
  const orig = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    if (/webgl/i.test(String(type))) { window.__webglRefused = (window.__webglRefused || 0) + 1; return null }
    return orig.call(this, type, ...rest)
  }
}

let browser
async function openPage(vp, { reduced = false, noWebGL = false, tag = '' } = {}) {
  const page = await browser.newPage()
  page.setDefaultTimeout(600000)
  const L = { errors: [], warnings: [], api: [], requests: [], pageErrors: [], noise: 0, tag }
  page.on('console', (m) => {
    const t = m.text()
    if (/GPU stall|GL Driver Message|WebGL-|swiftshader|Automatic fallback to software WebGL/i.test(t)) { L.noise++; return }
    if (m.type() === 'error') L.errors.push(t.slice(0, 400))
    else if (m.type() === 'warning' || m.type() === 'warn') L.warnings.push(t.slice(0, 300))
  })
  page.on('pageerror', (e) => { L.pageErrors.push(e.message.slice(0, 400)); L.errors.push(`[pageerror] ${e.message.slice(0, 300)}`) })
  page.on('requestfailed', (r) => {
    const u = r.url()
    if (!/_next\/webpack-hmr|__nextjs|_next\/static\/.*hot-update/.test(u)) L.errors.push(`[requestfailed] ${u} ${r.failure()?.errorText ?? ''}`)
  })
  page.on('request', (r) => {
    const u = new URL(r.url())
    if (/\/api\//.test(u.pathname)) L.api.push(`${r.method()} ${r.url()}`)
    if (/\.glb$|draco|three|world-v2|scene/i.test(u.pathname)) L.requests.push(u.pathname)
  })
  await page.evaluateOnNewDocument(installGate)
  if (noWebGL) await page.evaluateOnNewDocument(killWebGL)
  if (reduced) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
  await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1 })
  const t0 = Date.now()
  await page.goto(`${BASE}${ROUTE}`, { waitUntil: 'domcontentloaded', timeout: 180000 })
  L.gotoMs = Date.now() - t0
  await page.bringToFront()
  return { page, L }
}

async function waitReady(page) {
  const t = Date.now()
  await page.waitForFunction(() => window.__worldReady === true || typeof window.__worldError === 'string' || window.__worldView === 'list', { timeout: 300000, polling: 200 })
  const s = await page.evaluate(() => ({ ready: !!window.__worldReady, error: window.__worldError ?? null, view: window.__worldView }))
  await hideDevPortal(page)
  return { ...s, ms: Date.now() - t }
}

/**
 * The Next.js dev-tools badge (<nextjs-portal>) is dev-only chrome: it takes a
 * Tab stop and covers the bottom-left corner. Hidden (display:none, so it
 * leaves the tab order) so the checks measure the page, not the dev server.
 */
async function hideDevPortal(page) {
  await page.evaluate(() => {
    const kill = () => document.querySelectorAll('nextjs-portal').forEach((e) => { e.style.setProperty('display', 'none', 'important') })
    kill()
    if (!window.__portalObs) { window.__portalObs = new MutationObserver(kill); window.__portalObs.observe(document.body, { childList: true }) }
  })
}

/** Target rail depth for the current scrollY, as the scene reads it. */
async function settleOnScroll(page, timeout = 900000) {
  await page.waitForFunction(() => {
    const f = window.__worldFrame
    if (!f || !window.__worldScrollFor) return false
    const max = window.__worldScrollFor(0.88)
    const target = max > 0 ? Math.min(1, window.scrollY / max) * 0.88 : 0
    return f.parkProgress === 0 && Math.abs(f.depth - target) < 1e-9
  }, { timeout, polling: 200 })
  await sleep(250)
}

/** Wait for a dock tween: up to startMs for scrollY to leave y0, then until it holds still for 2 s, then the camera settle. */
async function waitTravel(page, y0, startMs = 30000) {
  const t = Date.now()
  let y = y0
  while (Date.now() - t < startMs) { y = await page.evaluate(() => window.scrollY); if (y !== y0) break; await sleep(250) }
  let last = y, still = 0
  while (still < 8) { await sleep(250); const v = await page.evaluate(() => window.scrollY); if (v === last) still++; else { still = 0; last = v } }
  await settleOnScroll(page)
  return { started: y !== y0, ms: Date.now() - t }
}

async function settle(page, depth) {
  await page.evaluate((d) => window.scrollTo(0, Math.round(window.__worldScrollFor(d))), depth)
  await settleOnScroll(page)
}

async function waitParked(page, id) {
  await page.waitForFunction((i) => { const f = window.__worldFrame; return f && f.parkedId === i && f.parkProgress === 1 && document.querySelector('main[data-open]') }, { timeout: 900000, polling: 100 }, id)
  await sleep(300)
}

async function waitClosed(page) {
  await page.waitForFunction(() => !document.querySelector('main[data-open]') && window.__worldFrame && window.__worldFrame.parkProgress === 0 && document.body.style.overflow !== 'hidden', { timeout: 900000, polling: 150 })
  await sleep(300)
}

async function state(page) {
  return page.evaluate(() => {
    const f = window.__worldFrame
    const main = document.querySelector('main')
    const panel = document.querySelector('section[aria-labelledby="v2-panel-title"]')
    const title = document.getElementById('v2-panel-title')
    const markers = document.querySelector('[class*="__markers"]')
    const dock = document.querySelector('nav[aria-label="Areas"]')
    const cur = [...document.querySelectorAll('nav[aria-label="Areas"] button[aria-current]')].map((b) => b.getAttribute('aria-label'))
    return {
      depth: f ? f.depth : null,
      parkedId: f ? f.parkedId : null,
      parkProgress: f ? f.parkProgress : null,
      open: main?.hasAttribute('data-open') ?? false,
      view: main?.dataset.view,
      bodyOverflow: document.body.style.overflow,
      scrollY: window.scrollY,
      scrollMax: document.documentElement.scrollHeight - innerHeight,
      panelTitle: title?.textContent ?? null,
      panelOpacity: panel?.style.opacity ?? null,
      panelTransform: panel?.style.transform ?? null,
      panelInert: panel?.inert ?? null,
      markersOpacity: markers?.style.opacity ?? null,
      markersPointer: markers?.style.pointerEvents ?? null,
      dockOpacity: dock?.style.opacity ?? null,
      dockCurrent: cur,
      dockName: document.querySelector('[class*="__dockName"]')?.textContent ?? null,
      camera: window.__worldCamera ? window.__worldCamera() : null,
      frames: window.__worldFrameCount,
      markerModes: [...document.querySelectorAll('[class*="__marker"][data-mode]')].map((b) => b.dataset.mode),
    }
  })
}

/** What has keyboard focus, and whether a sighted user can see it. */
async function focusInfo(page) {
  return page.evaluate(() => {
    const a = document.activeElement
    if (!a || a === document.body) return { tag: 'BODY', label: null, cls: 'body', ring: { style: '-', width: '-', color: '-' }, rect: { l: 0, t: 0, w: 0, h: 0 }, focusVisible: false, inView: false, covered: false, opacity: 1, inPanel: false, inSheet: false }
    const isMarker = /__marker/.test(a.className)
    let ringEl = a
    if (isMarker) ringEl = a.dataset.mode === 'text' ? a.querySelector('[class*="__label"]') : a.querySelector('[class*="__pin"]')
    const r = (ringEl || a).getBoundingClientRect()
    const cs = getComputedStyle(ringEl || a)
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    const hit = document.elementFromPoint(Math.min(innerWidth - 1, Math.max(0, cx)), Math.min(innerHeight - 1, Math.max(0, cy)))
    // Visible means: on screen, not faded out, not covered by something else.
    let op = 1
    for (let e = a; e; e = e.parentElement) op *= Number(getComputedStyle(e).opacity)
    const inView = r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight && r.width > 0 && r.height > 0
    const covered = !!hit && !(a.contains(hit) || hit.contains(a) || (ringEl && ringEl.contains(hit)))
    return {
      tag: a.tagName,
      id: a.id || null,
      label: a.getAttribute('aria-label') || a.textContent.trim().replace(/\s+/g, ' ').slice(0, 60),
      mode: a.dataset.mode ?? null,
      cls: String(a.className).replace(/world-module__\w+__/g, '').split(' ')[0],
      inPanel: !!a.closest('section[aria-labelledby="v2-panel-title"]'),
      inSheet: !!a.closest('[role="dialog"]'),
      inert: !!a.closest('[inert]'),
      ariaHidden: !!a.closest('[aria-hidden="true"]'),
      focusVisible: a.matches(':focus-visible'),
      rect: { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
      ring: { style: cs.outlineStyle, width: cs.outlineWidth, color: cs.outlineColor, offset: cs.outlineOffset },
      opacity: +op.toFixed(3),
      inView,
      covered,
      coveredBy: covered && hit ? `${hit.tagName}.${String(hit.className).replace(/world-module__\w+__/g, '')}` : null,
    }
  })
}

async function shot(page, name, clip) {
  const file = path.join(OUT, name)
  // captureBeyondViewport:false. With the default (true) a clip screenshot transiently resizes the
  // viewport to the clip, which crosses the 760px list-view breakpoint and tears the whole scene down.
  await page.screenshot({ path: file, captureBeyondViewport: false, ...(clip ? { clip } : {}) })
  return path.relative(path.join(HERE, '..'), file)
}

// ── Pixel analysis, done in a blank page's canvas ─────────────────────────────

let lab
async function labPage() {
  if (lab) return lab
  lab = await browser.newPage()
  await lab.setContent('<html><body></body></html>')
  await lab.evaluate(() => {
    window.decode = async (b64) => {
      const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob())
      const c = new OffscreenCanvas(bmp.width, bmp.height)
      const g = c.getContext('2d')
      g.drawImage(bmp, 0, 0)
      return { w: bmp.width, h: bmp.height, d: g.getImageData(0, 0, bmp.width, bmp.height).data }
    }
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
    window.lum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
    window.cr = (a, b) => { const x = Math.max(a, b); const y = Math.min(a, b); return (x + 0.05) / (y + 0.05) }
  })
  return lab
}

/** Ring pixels = pixels that change when the outline is removed. Contrast of each ring pixel vs the same pixel without it. */
async function ringContrast(focusedB64, plainB64, box, offset, width) {
  const p = await labPage()
  return p.evaluate(async (A, B, box, offset, width) => {
    const a = await window.decode(A)
    const b = await window.decode(B)
    const crs = []
    let changed = 0, band = 0
    // The outline band: outside the element box by [offset, offset + width).
    const inBox = (x, y, grow) => x >= box.x - grow && x < box.x + box.w + grow && y >= box.y - grow && y < box.y + box.h + grow
    for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) {
      if (!(inBox(x, y, offset + width) && !inBox(x, y, offset))) continue
      band++
      const i = (y * a.w + x) * 4
      const d = Math.max(Math.abs(a.d[i] - b.d[i]), Math.abs(a.d[i + 1] - b.d[i + 1]), Math.abs(a.d[i + 2] - b.d[i + 2]))
      if (d < 3) continue
      changed++
      crs.push(window.cr(window.lum(a.d[i], a.d[i + 1], a.d[i + 2]), window.lum(b.d[i], b.d[i + 1], b.d[i + 2])))
    }
    crs.sort((x, y) => x - y)
    if (!crs.length) return { ringPixels: 0, bandPixels: band }
    const q = (f) => +crs[Math.min(crs.length - 1, Math.floor(f * crs.length))].toFixed(2)
    return { ringPixels: changed, bandPixels: band, min: q(0), p10: q(0.1), median: q(0.5), max: q(0.999) }
  }, focusedB64, plainB64, box, offset, width)
}

/** Landmark footprint = pixels that change when the landmark is hidden. */
async function diffBox(aB64, bB64, rects) {
  const p = await labPage()
  return p.evaluate(async (A, B, rects) => {
    const a = await window.decode(A)
    const b = await window.decode(B)
    let n = 0, l = 1e9, t = 1e9, r = -1, bt = -1
    const inRect = rects.map(() => 0)
    for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) {
      const i = (y * a.w + x) * 4
      if (Math.max(Math.abs(a.d[i] - b.d[i]), Math.abs(a.d[i + 1] - b.d[i + 1]), Math.abs(a.d[i + 2] - b.d[i + 2])) < 14) continue
      n++
      if (x < l) l = x; if (x > r) r = x; if (y < t) t = y; if (y > bt) bt = y
      rects.forEach((q, k) => { if (x >= q.l && x < q.r && y >= q.t && y < q.b) inRect[k]++ })
    }
    let covered = 0
    for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) {
      const i = (y * a.w + x) * 4
      if (Math.max(Math.abs(a.d[i] - b.d[i]), Math.abs(a.d[i + 1] - b.d[i + 1]), Math.abs(a.d[i + 2] - b.d[i + 2])) < 14) continue
      if (rects.some((q) => x >= q.l && x < q.r && y >= q.t && y < q.b)) covered++
    }
    return { pixels: n, box: n ? { l, t, r, b: bt, w: r - l + 1, h: bt - t + 1 } : null, coveredPixels: covered, coveredFrac: n ? +(covered / n).toFixed(3) : null, perRect: inRect, w: a.w, h: a.h }
  }, aB64, bB64, rects)
}

async function ringCheck(page, name) {
  // Shoot the focused element with and without its outline; the difference is the ring.
  const info = await focusInfo(page)
  if (!info || info.tag === 'BODY') return { info, ring: null }
  const pad = 10
  const clip = { x: Math.max(0, info.rect.l - pad), y: Math.max(0, info.rect.t - pad), width: info.rect.w + 2 * pad, height: info.rect.h + 2 * pad }
  const vp = page.viewport()
  clip.width = Math.min(clip.width, vp.width - clip.x)
  clip.height = Math.min(clip.height, vp.height - clip.y)
  const file = await shot(page, name, clip)
  const focused = await page.screenshot({ clip, encoding: 'base64', captureBeyondViewport: false })
  await page.evaluate(() => {
    const a = document.activeElement
    const isMarker = /__marker/.test(a.className)
    const el = isMarker ? (a.dataset.mode === 'text' ? a.querySelector('[class*="__label"]') : a.querySelector('[class*="__pin"]')) : a
    el.dataset.ringProbe = '1'
    el.style.setProperty('outline', 'none', 'important')
  })
  await sleep(120)
  const plain = await page.screenshot({ clip, encoding: 'base64', captureBeyondViewport: false })
  // Stricter: also strip the halo (box-shadow), so the ring is measured against the page
  // itself rather than against its own dark halo.
  await page.evaluate(() => { const el = document.querySelector('[data-ring-probe]'); if (el) el.style.setProperty('box-shadow', 'none', 'important') })
  await sleep(120)
  const bare = await page.screenshot({ clip, encoding: 'base64', captureBeyondViewport: false })
  await page.evaluate(() => { const el = document.querySelector('[data-ring-probe]'); if (el) { el.style.removeProperty('outline'); el.style.removeProperty('box-shadow'); delete el.dataset.ringProbe } })
  const off = parseFloat(info.ring.offset) || 0
  const wid = parseFloat(info.ring.width) || 0
  const box = { x: info.rect.l - clip.x, y: info.rect.t - clip.y, w: info.rect.w, h: info.rect.h }
  const ring = wid > 0 && info.ring.style !== 'none' ? await ringContrast(focused, plain, box, Math.round(off), Math.round(wid)) : { ringPixels: 0, bandPixels: 0, note: 'no outline' }
  const ringVsPage = wid > 0 && info.ring.style !== 'none' ? await ringContrast(focused, bare, box, Math.round(off), Math.round(wid)) : null
  if (ring) ring.vsPage = ringVsPage
  return { info, ring, file }
}

function camDelta(a, b) {
  if (!a || !b) return null
  const dp = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
  const dot = Math.max(-1, Math.min(1, a.dx * b.dx + a.dy * b.dy + a.dz * b.dz))
  return { units: +dp.toFixed(3), deg: +((Math.acos(dot) * 180) / Math.PI).toFixed(3) }
}

async function markerCenter(page, id) {
  return page.evaluate((id) => {
    const idx = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'].indexOf(id)
    const b = document.querySelectorAll('[class*="__markers"] > button')[idx]
    if (!b || b.dataset.mode === 'hidden') return null
    const el = b.dataset.mode === 'text' ? b.querySelector('[class*="__label"]') : b.querySelector('[class*="__pin"]')
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, mode: b.dataset.mode }
  }, id)
}

async function tabUntil(page, pred, max = 40) {
  const seq = []
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab')
    await sleep(60)
    const f = await focusInfo(page)
    seq.push(f)
    if (pred(f)) return { found: f, seq }
  }
  return { found: null, seq }
}

const R = {}
function result(name) {
  R[name] = R[name] || { checks: [], logs: [] }
  return R[name]
}
function check(name, id, ok, measured, extra = {}) {
  const r = result(name)
  const c = { id, result: ok === true ? 'pass' : ok === false ? 'fail' : typeof ok === 'string' ? ok : ok ? 'pass' : 'fail', measured, ...extra }
  r.checks.push(c)
  log(`[${name}] ${c.result.toUpperCase()} ${id}: ${typeof measured === 'string' ? measured : JSON.stringify(measured)}`)
  return c
}
function save(name) {
  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(R[name], null, 2))
}
function attachLogs(name, L) {
  result(name).logs.push(L)
}

// ── Scenarios ────────────────────────────────────────────────────────────────

const scenarios = {}

/** Tab order, activation keys, focus in/out of the panel, focus rings, Escape levels. */
scenarios.keyboard = async () => {
  const S = 'keyboard'
  const vp = VPS.laptop
  const { page, L } = await openPage(vp, { tag: S })
  attachLogs(S, L)
  try {
    const boot = await waitReady(page)
    result(S).boot = boot
    await settle(page, 0)
    await page.evaluate(() => document.fonts.ready)
    await sleep(800)
    await shot(page, `${S}-00-default.png`)

    // 1. Full tab cycle from the top of the page.
    const seq = []
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab')
      await sleep(80)
      const f = await focusInfo(page)
      if (seq.length && f.label === seq[0].label && f.cls === seq[0].cls) break
      seq.push(f)
    }
    result(S).tabCycle = seq.map((f) => ({ label: f.label, cls: f.cls, mode: f.mode, fv: f.focusVisible, covered: f.covered, coveredBy: f.coveredBy, inView: f.inView, opacity: f.opacity, ring: f.ring.style + ' ' + f.ring.width + ' ' + f.ring.color }))
    const labels = seq.map((f) => f.label)
    const has = (re) => labels.some((l) => re.test(l || ''))
    check(S, 'tab.reaches.next', has(/^Continue/), labels.slice(0, 3).join(' | '))
    check(S, 'tab.reaches.markers', seq.filter((f) => f.cls === 'marker').length > 0, `${seq.filter((f) => f.cls === 'marker').length} marker stops: ${seq.filter((f) => f.cls === 'marker').map((f) => `${f.label.split(',')[0]}(${f.mode})`).join(', ')}`)
    check(S, 'tab.reaches.enter', has(/^Enter /), labels.filter((l) => /^Enter /.test(l || '')).join(', ') || 'never')
    check(S, 'tab.reaches.dockStops', seq.filter((f) => /^Travel to/.test(f.label || '')).length === 8, `${seq.filter((f) => /^Travel to/.test(f.label || '')).length} of 8 dock stops`)
    const invisible = seq.filter((f) => f.tag !== 'BODY' && (!f.focusVisible || f.covered || !f.inView || f.opacity < 0.5 || f.inert || f.ariaHidden))
    check(S, 'tab.everyStopVisible', invisible.length === 0 ? true : 'fail', invisible.length ? invisible.map((f) => `${f.label} fv=${f.focusVisible} covered=${f.coveredBy} inView=${f.inView} op=${f.opacity} inert=${f.inert} ariaHidden=${f.ariaHidden}`).join(' ; ') : 'every focus stop focus-visible, on screen, uncovered')

    // 2. Focus ring contrast per control type (WCAG 1.4.11: 3:1 against adjacent colours).
    const rings = {}
    const want = [
      ['continue', (f) => /^Continue/.test(f.label)],
      ['markerText', (f) => f.cls === 'marker' && f.mode === 'text'],
      ['markerDot', (f) => f.cls === 'marker' && f.mode === 'dot'],
      ['enter', (f) => /^Enter /.test(f.label)],
      ['stop', (f) => /^Travel to Static/.test(f.label)],
      ['footerLink', (f) => f.tag === 'A'],
    ]
    for (const [key, pred] of want) {
      await page.evaluate(() => document.activeElement?.blur())
      await page.evaluate(() => window.scrollTo(0, window.scrollY)) // no-op, keeps the page where it is
      const got = await tabUntil(page, pred, 30)
      if (!got.found) { rings[key] = { missing: true }; continue }
      await sleep(300)
      rings[key] = await ringCheck(page, `${S}-ring-${key}.png`)
    }
    result(S).rings = rings
    for (const [key, v] of Object.entries(rings)) {
      if (v.missing) { check(S, `ring.${key}`, 'warn', 'control not reached by Tab in this state'); continue }
      const r = v.ring
      const ok = r && r.ringPixels > 20 && r.median >= 3
      check(S, `ring.${key}`, ok ? true : 'fail', r ? `${r.ringPixels} ring px, contrast vs background min ${r.min} p10 ${r.p10} median ${r.median} (need 3:1); vs page with halo stripped: ${r.vsPage ? `min ${r.vsPage.min} p10 ${r.vsPage.p10} median ${r.vsPage.median}` : 'n/a'}; outline ${v.info.ring.style} ${v.info.ring.width} ${v.info.ring.color}` : 'no ring', { evidence: v.file })
    }

    // 3. Enter on the text marker (Video Ads I at depth 0) opens it; focus moves into the panel.
    await page.evaluate(() => document.activeElement?.blur())
    const toMarker = await tabUntil(page, (f) => f.cls === 'marker' && /^Video Ads I,/.test(f.label), 30)
    const before = await state(page)
    await page.keyboard.press('Enter')
    await sleep(250)
    const fOpen = await focusInfo(page)
    const sOpen = await state(page)
    check(S, 'focus.intoPanelOnOpen', fOpen.inPanel && fOpen.id === 'v2-panel-title', `active=${fOpen.tag}#${fOpen.id} "${fOpen.label}" inPanel=${fOpen.inPanel} (at t+250ms, panel opacity ${sOpen.panelOpacity})`)
    await waitParked(page, 'a3')
    const sParked = await state(page)
    check(S, 'enter.opensMarker', sOpen.open && sParked.parkedId === 'a3' && sParked.panelTitle === 'Video Ads I', `t+250ms open=${sOpen.open} title=${sOpen.panelTitle}; parked ${sParked.parkedId} p=${sParked.parkProgress}`)
    await shot(page, `${S}-10-parked-a3-by-keyboard.png`)

    // 4. Tab order inside the open panel.
    const pseq = []
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab')
      await sleep(80)
      pseq.push(await focusInfo(page))
    }
    result(S).panelTabCycle = pseq.map((f) => ({ label: f.label, inPanel: f.inPanel, fv: f.focusVisible, covered: f.covered, coveredBy: f.coveredBy, inert: f.inert, ring: f.ring.style + ' ' + f.ring.color }))
    const rowsReached = pseq.filter((f) => /^Lesson \d/.test(f.label || '')).length
    check(S, 'panel.tabReachesRows', rowsReached >= 6, `${rowsReached} lesson rows reached in 12 Tabs; order: ${pseq.map((f) => (f.label || '').slice(0, 24)).join(' > ')}`)
    const escaped = pseq.filter((f) => f.tag !== 'BODY' && !f.inPanel)
    check(S, 'panel.focusStaysInPanel', escaped.length === 0 ? true : 'warn', escaped.length ? `Tab leaves the panel to: ${[...new Set(escaped.map((f) => `${f.label} (covered=${f.covered})`))].join(', ')}` : 'focus stays in panel')
    const rowRing = await (async () => {
      await page.evaluate(() => document.getElementById('v2-panel-title').focus())
      await tabUntil(page, (f) => /^Lesson 2,/.test(f.label || ''), 6)
      await sleep(200)
      return ringCheck(page, `${S}-ring-lessonRow.png`)
    })()
    result(S).rings.lessonRow = rowRing
    check(S, 'ring.lessonRow', rowRing.ring && rowRing.ring.median >= 3 ? true : 'fail', rowRing.ring ? `${rowRing.ring.ringPixels} ring px, contrast min ${rowRing.ring.min} p10 ${rowRing.ring.p10} median ${rowRing.ring.median}; vs page w/o halo median ${rowRing.ring.vsPage?.median} p10 ${rowRing.ring.vsPage?.p10}; ring box ${JSON.stringify(rowRing.info.rect)}` : 'no ring', { evidence: rowRing.file })

    // 5. Space on lesson 2 opens the lesson view; focus to the lesson heading.
    const preSpace = await focusInfo(page)
    result(S).preSpaceFocus = preSpace.label
    if (!/^Lesson 2,/.test(preSpace.label || '')) {
      await page.evaluate(() => document.getElementById('v2-panel-title').focus())
      await tabUntil(page, (f) => /^Lesson 2,/.test(f.label || ''), 6)
    }
    await page.keyboard.press('Space')
    await sleep(500)
    const fLesson = await focusInfo(page)
    const lessonTitle = await page.evaluate(() => document.getElementById('v2-panel-title')?.textContent)
    check(S, 'space.opensLesson', lessonTitle === 'Researching the product', `lesson view title "${lessonTitle}"`)
    check(S, 'focus.lessonHeading', fLesson.id === 'v2-panel-title' && fLesson.inPanel, `active=${fLesson.tag}#${fLesson.id} "${fLesson.label}"`)
    await shot(page, `${S}-11-lesson-view.png`)
    // Tab to "Next" (up next), Enter -> lesson 3.
    const toUp = await tabUntil(page, (f) => /^Next/.test(f.label || ''), 4)
    await page.keyboard.press('Enter')
    await sleep(500)
    const lesson3 = await page.evaluate(() => document.getElementById('v2-panel-title')?.textContent)
    const fL3 = await focusInfo(page)
    check(S, 'enter.upNext', lesson3 === 'Finding your angle' && fL3.id === 'v2-panel-title', `up-next reached=${!!toUp.found}; title "${lesson3}", focus ${fL3.tag}#${fL3.id}`)

    // 6. Escape: lesson -> area (focus back to the row), area -> map (focus back to the trigger).
    await page.keyboard.press('Escape')
    await sleep(500)
    const fBack = await focusInfo(page)
    const sBack = await state(page)
    check(S, 'escape.lessonToArea', sBack.open && sBack.panelTitle === 'Video Ads I' && /^Lesson 3,/.test(fBack.label || ''), `title "${sBack.panelTitle}", focus "${fBack.label}"`)
    await shot(page, `${S}-12-escape-back-to-area.png`)
    // Trace every programmatic focus() and every change of the a3 marker's mode through the close.
    await page.evaluate(() => {
      window.__ftrace = []
      const b = document.querySelectorAll('[class*="__markers"] > button')[2]
      const orig = HTMLElement.prototype.focus
      HTMLElement.prototype.focus = function (...a) {
        window.__ftrace.push(`focus() on ${this.tagName} "${(this.getAttribute('aria-label') || this.textContent || '').trim().slice(0, 28)}" a3mode=${b.dataset.mode} p=${window.__worldFrame?.parkProgress} open=${!!document.querySelector('main[data-open]')} stack=${(new Error().stack || '').split('\n').slice(2, 5).map((l) => l.trim().replace(/\(.*\//, '(')).join(' | ')}`)
        return orig.apply(this, a)
      }
      new MutationObserver(() => window.__ftrace.push(`a3 mode -> ${b.dataset.mode} p=${window.__worldFrame?.parkProgress} open=${!!document.querySelector('main[data-open]')}`)).observe(b, { attributes: true, attributeFilter: ['data-mode', 'aria-hidden'] })
      document.addEventListener('focusin', (e) => window.__ftrace.push(`focusin ${e.target.tagName} "${(e.target.getAttribute('aria-label') || '').slice(0, 28)}"`), true)
    })
    await page.keyboard.press('Escape')
    await sleep(200)
    const sClosing = await state(page)
    const fClosing = await focusInfo(page)
    await waitClosed(page)
    const fHome = await focusInfo(page)
    const sHome = await state(page)
    check(S, 'escape.areaToMap', !sHome.open && sHome.parkProgress === 0, `closing: open=${sClosing.open} panelInert=${sClosing.panelInert}, focus during fly-back: ${fClosing.tag} "${fClosing.label}"; home: open=${sHome.open}`)
    result(S).focusTrace = await page.evaluate(() => window.__ftrace)
    check(S, 'focus.returnsToTrigger', fHome.cls === 'marker' && /^Video Ads I,/.test(fHome.label || ''), `focus after close: ${fHome.tag}.${fHome.cls} "${fHome.label}" mode=${fHome.mode} fv=${fHome.focusVisible}`)
    check(S, 'scroll.restoredAfterKeyboardPark', sHome.scrollY === before.scrollY && Math.abs(sHome.depth - before.depth) < 1e-9, `scrollY ${before.scrollY} -> ${sHome.scrollY}, depth ${before.depth} -> ${sHome.depth}`)
    await shot(page, `${S}-13-closed-focus-returned.png`)
    if (process.env.KB_STOP === '6') return

    // 7. Dock by keyboard: Enter on stop 5, Space on stop 6.
    const toStop5 = await tabUntil(page, (f) => /^Travel to Static Ads/.test(f.label || ''), 30)
    const y5 = await page.evaluate(() => window.scrollY)
    await page.keyboard.press('Enter')
    await waitTravel(page, y5)
    const s5 = await state(page)
    const d5 = await page.evaluate(() => window.__worldScrollFor ? null : null)
    check(S, 'enter.dockStop', s5.dockCurrent.includes('Travel to Static Ads'), `after Enter on stop 5: depth ${s5.depth.toFixed(4)}, aria-current ${s5.dockCurrent.join(',')}, dock name "${s5.dockName}"`)
    await page.keyboard.press('Tab')
    await sleep(100)
    const y6 = await page.evaluate(() => window.scrollY)
    await page.keyboard.press('Space')
    await waitTravel(page, y6)
    const s6 = await state(page)
    check(S, 'space.dockStop', s6.dockCurrent.includes('Travel to AI Ads & Content'), `after Space on stop 6: depth ${s6.depth.toFixed(4)}, aria-current ${s6.dockCurrent.join(',')}`)
    await shot(page, `${S}-20-dock-keyboard-a6.png`)

    // 8. From the stop you just travelled to, can Shift+Tab reach "Enter <area>"?
    const back = []
    for (let i = 0; i < 12; i++) {
      await page.keyboard.down('Shift')
      await page.keyboard.press('Tab')
      await page.keyboard.up('Shift')
      await sleep(80)
      const f = await focusInfo(page)
      back.push(f.label)
      if (/^Enter /.test(f.label || '') || f.cls === 'marker') break
    }
    check(S, 'shiftTab.reachesEnterFromStop', back.some((l) => /^Enter /.test(l || '')) ? true : 'fail', `Shift+Tab from stop 6: ${back.join(' < ')}`)
    {
      await sleep(400) // Enter fades in over 180 ms once the stop blurs; read it after the fade.
      const fe = await focusInfo(page)
      const head = await page.evaluate(() => { const b = document.querySelector('[class*="__enter"]'); return { hidden: b.hasAttribute('data-hidden'), opacity: getComputedStyle(b).opacity, name: document.querySelector('[class*="__dockName"]')?.textContent, num: document.querySelector('[class*="__dockNum"]')?.textContent, label: b.getAttribute('aria-label') } })
      await sleep(300)
      const dockRect = await page.evaluate(() => { const r = document.querySelector('nav[aria-label="Areas"]').getBoundingClientRect(); return { l: r.left + scrollX, t: r.top + scrollY, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight + scrollY } })
      result(S).dockRectAtEnter = dockRect
      const dockBox = dockRect.w > 0 && dockRect.h > 0 ? { x: Math.max(0, Math.floor(dockRect.l - 12)), y: Math.max(0, Math.floor(dockRect.t - 12)), width: Math.min(dockRect.vw, Math.ceil(dockRect.w + 24)), height: Math.min(dockRect.vh - Math.max(0, Math.floor(dockRect.t - 12)), Math.ceil(dockRect.h + 24)) } : undefined
      const fileE = await shot(page, `${S}-21-enter-focused-from-stops.png`, dockBox && dockBox.height > 0 ? dockBox : undefined)
      result(S).enterFocusedFromStops = { focus: fe, head }
      check(S, 'shiftTab.enterVisibleWhenFocused', /^Enter /.test(fe.label || '') && fe.focusVisible && !fe.covered && Number(head.opacity) > 0.9 ? true : 'fail', `focused "${fe.label}" fv=${fe.focusVisible} opacity ${head.opacity} data-hidden=${head.hidden}; dock head reads "${head.num} ${head.name}" while Enter's label is "${head.label}"`, { evidence: fileE })
      // Mixed input: Enter focused by keyboard, then the pointer rests on another stop.
      const stop2 = await page.evaluate(() => { const b = document.querySelectorAll('nav[aria-label="Areas"] [class*="__track"] button')[1]; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })
      await page.mouse.move(stop2.x, stop2.y)
      await sleep(400)
      const head2 = await page.evaluate(() => { const b = document.querySelector('[class*="__enter"]'); return { hidden: b.hasAttribute('data-hidden'), opacity: getComputedStyle(b).opacity, name: document.querySelector('[class*="__dockName"]')?.textContent, num: document.querySelector('[class*="__dockNum"]')?.textContent, label: b.getAttribute('aria-label'), active: document.activeElement?.getAttribute('aria-label') } })
      const fileM = await shot(page, `${S}-22-enter-focused-pointer-on-stop2.png`, dockBox && dockBox.height > 0 ? dockBox : undefined)
      result(S).enterFocusedPointerOnStop = head2
      const mismatch = Number(head2.opacity) > 0.5 && !head2.label.endsWith(head2.name)
      check(S, 'enter.labelMatchesHead', mismatch ? 'warn' : true, `Enter focused + pointer on stop 2: head reads "${head2.num} ${head2.name}", Enter visible opacity ${head2.opacity}, Enter would open "${head2.label}" (active ${head2.active})`, { evidence: fileM })
      await page.mouse.move(vp.width / 2, 200)
      await sleep(200)
    }
    // And forward: stop 6 focused, Enter visible? Tab forward order after the stops.
    const enterState = await page.evaluate(() => { const b = document.querySelector('[class*="__enter"]'); return { hidden: b.hasAttribute('data-hidden'), tabIndex: b.tabIndex, label: b.getAttribute('aria-label') } })
    result(S).enterWhileStopFocused = enterState

    // 9. Continue with Space opens the current area with focus on the next lesson row.
    await settle(page, 0)
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /^Continue/.test(b.textContent.trim())).focus())
    await sleep(100)
    await page.keyboard.press('Space')
    await sleep(300)
    const fCont = await focusInfo(page)
    const sCont = await state(page)
    await waitParked(page, 'a3')
    const sCont2 = await state(page)
    check(S, 'space.continue', sCont.open && sCont2.parkedId === 'a3' && /^Lesson 5,/.test(fCont.label || ''), `open=${sCont.open} parked=${sCont2.parkedId} focus "${fCont.label}" inPanel=${fCont.inPanel}`)
    const fCont2 = await focusInfo(page)
    check(S, 'continue.rowFocusVisible', fCont2.focusVisible && !fCont2.covered && fCont2.inView, `row focus after arrival: fv=${fCont2.focusVisible} inView=${fCont2.inView} rect ${JSON.stringify(fCont2.rect)}`)
    await shot(page, `${S}-30-continue-parked.png`)
    // Map button by keyboard: Shift+Tab until "Map", Enter.
    let mapF = null
    for (let i = 0; i < 12; i++) {
      await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift')
      await sleep(60)
      const f = await focusInfo(page)
      if (/^Map$/.test(f.label || '')) { mapF = f; break }
    }
    const mapRing = mapF ? await ringCheck(page, `${S}-ring-mapBack.png`) : null
    if (mapRing) { result(S).rings.mapBack = mapRing; check(S, 'ring.mapBack', mapRing.ring && mapRing.ring.median >= 3 ? true : 'fail', mapRing.ring ? `${mapRing.ring.ringPixels} ring px, contrast min ${mapRing.ring.min} p10 ${mapRing.ring.p10} median ${mapRing.ring.median}; vs page w/o halo median ${mapRing.ring.vsPage?.median} p10 ${mapRing.ring.vsPage?.p10}` : 'no ring', { evidence: mapRing.file }) }
    await page.keyboard.press('Enter')
    await waitClosed(page)
    const fAfterMap = await focusInfo(page)
    check(S, 'mapButton.closesAndReturnsFocus', /^Continue/.test(fAfterMap.label || ''), `focus after Map: "${fAfterMap.label}" fv=${fAfterMap.focusVisible}`)
  } finally {
    await page.close()
  }
}

/** Dock travel: click each stop; measure where the landmark lands and what covers it. */
async function dockPass(vp, measure) {
  const S = 'dock'
  // Its own browser: two pages in one browser leave one of them document.hidden, and the scene pauses when hidden.
  const own = await launch()
  const saved = browser
  browser = own
  let opened
  try { opened = await openPage(vp, { tag: `${S}-${vp.name}-${measure ? 'measure' : 'evidence'}` }) } finally { browser = saved }
  const { page, L } = opened
  attachLogs(S, L)
  const rows = []
  try {
    const boot = await waitReady(page)
    await settle(page, 0)
    await page.evaluate(() => document.fonts.ready)
    await sleep(500)
    for (let k = 0; k < 8; k++) {
      const [id, name, mesh, studyDepth] = AREAS[k]
      const stop = await page.evaluate((k) => {
        const b = document.querySelectorAll('nav[aria-label="Areas"] [class*="__track"] button')[k]
        const r = b.getBoundingClientRect()
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      }, k)
      const n0 = await page.evaluate(() => window.__worldFrameCount)
      const t0 = Date.now()
      const yBefore = await page.evaluate(() => window.scrollY)
      await page.mouse.move(stop.x, stop.y)
      await page.mouse.click(stop.x, stop.y)
      const target = await page.evaluate((i) => {
        // What travel() aims at: scene.depthFor(id) -> scrollYForDepth.
        return null
      }, id)
      // Wait for the tween (its first step can be seconds late under SwiftShader), then the camera.
      const tr = await waitTravel(page, yBefore, k === 0 ? 8000 : 30000)
      // Move the pointer off the dock so the hover state does not change the dock head.
      await page.mouse.move(vp.width / 2, 200)
      await sleep(300)
      const st = await state(page)
      const wallMs = Date.now() - t0
      const frames = st.frames - n0
      const mk = await page.evaluate((k) => { const m = window.__worldMarkers[k]; const b = document.querySelectorAll('[class*="__markers"] > button')[k]; return { ...m, mode: b.dataset.mode } }, k)
      const chrome = await page.evaluate(() => {
        const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) } }
        return {
          next: box(document.querySelector('section[aria-label="Next lesson"]')),
          dock: box(document.querySelector('nav[aria-label="Areas"]')),
          footer: box(document.querySelector('footer')),
          brand: box(document.querySelector('[class*="__brand"]')),
          progress: box(document.querySelector('[class*="__progress"]')),
        }
      })
      const row = { k: k + 1, id, name, studyDepth, depth: st.depth, scrollY: st.scrollY, dockCurrent: st.dockCurrent, dockName: st.dockName, marker: { x: Math.round(mk.x), y: Math.round(mk.y), visible: mk.visible, mode: mk.mode, xPct: +((100 * mk.x) / vp.width).toFixed(1), yPct: +((100 * mk.y) / vp.height).toFixed(1) }, frames, wallMs, chrome }
      if (!measure) {
        row.file = await shot(page, `dock-${vp.name}-${k + 1}-${id}.png`)
      } else {
        // Landmark footprint by hide-and-diff, with the interface hidden so pixels under the chrome count too.
        const hideTag = await page.addStyleTag({ content: 'main > *:not([class*="__stage"]):not([class*="__spacer"]) { visibility: hidden !important }' })
        await sleep(200)
        const A = await page.screenshot({ encoding: 'base64', captureBeyondViewport: false })
        const f0 = await page.evaluate(() => window.__worldFrameCount)
        const hidden = await page.evaluate((m) => window.__worldHide(m), mesh)
        await page.waitForFunction((f) => window.__worldFrameCount > f, { timeout: 120000, polling: 100 }, f0)
        await sleep(300)
        const B = await page.screenshot({ encoding: 'base64', captureBeyondViewport: false })
        await hideTag.evaluate((el) => el.remove())
        const rects = ['next', 'dock', 'footer', 'brand', 'progress'].map((k) => chrome[k]).filter(Boolean)
        const d = await diffBox(A, B, rects)
        row.landmark = { mesh, hiddenObjects: hidden, ...d, heightPct: d.box ? +((100 * d.box.h) / vp.height).toFixed(1) : null, centerXPct: d.box ? +((100 * (d.box.l + d.box.w / 2)) / vp.width).toFixed(1) : null, centerYPct: d.box ? +((100 * (d.box.t + d.box.h / 2)) / vp.height).toFixed(1) : null, cutByEdge: d.box ? d.box.l <= 0 || d.box.t <= 0 || d.box.r >= vp.width - 1 || d.box.b >= vp.height - 1 : null }
      }
      rows.push(row)
      log(`[dock ${vp.name}${measure ? ' measure' : ''}] stop ${k + 1} ${id}: depth ${st.depth.toFixed(4)} (study ${studyDepth}), aria-current ${st.dockCurrent.join(',')}, marker ${row.marker.mode} at ${row.marker.xPct}%,${row.marker.yPct}% ${row.landmark ? `landmark box ${JSON.stringify(row.landmark.box)} covered ${row.landmark.coveredFrac}` : ''} (${frames} frames, ${wallMs} ms)`)
    }
  } finally {
    await page.close()
    await own.close()
  }
  return rows
}

scenarios.dock = async () => {
  const S = 'dock'
  const vps = (VP_ARG || ['split', 'ultra', 'laptop']).map((v) => VPS[v])
  result(S).viewports = {}
  for (const vp of vps) {
    const [evidence, measure] = await Promise.all([dockPass(vp, false), dockPass(vp, true)])
    result(S).viewports[vp.name] = { evidence, measure }
    for (let k = 0; k < 8; k++) {
      const e = evidence[k]
      const m = measure[k]
      const lm = m.landmark
      const landed = e.dockCurrent.length === 1 && e.dockCurrent[0] === `Travel to ${e.name}`
      const framed = lm && lm.pixels > 200 && !lm.cutByEdge && lm.coveredFrac <= 0.1
      check(S, `dock.${vp.name}.${e.id}`, landed && framed ? true : 'fail',
        `depth ${e.depth.toFixed(4)} (study ${e.studyDepth}); aria-current "${e.dockCurrent.join(',')}"; marker ${e.marker.mode} at ${e.marker.xPct}%/${e.marker.yPct}%; landmark ${lm && lm.box ? `${lm.pixels}px box x${lm.box.l}-${lm.box.r} y${lm.box.t}-${lm.box.b} (h ${lm.heightPct}% of screen, centre ${lm.centerXPct}%/${lm.centerYPct}%), ${Math.round(100 * lm.coveredFrac)}% under chrome [next ${lm.perRect[0]}, dock ${lm.perRect[1]}, footer ${lm.perRect[2]}, brand ${lm.perRect[3]}, progress ${lm.perRect[4]} px], cut by edge ${lm.cutByEdge}` : 'NOT FOUND'}`,
        { evidence: e.file })
    }
    save(S)
  }
}

/** NEXT block's Continue opens the current area; a lesson row opens the lesson; back works. */
scenarios.next = async () => {
  const S = 'next'
  const vp = VPS.split
  const { page, L } = await openPage(vp, { tag: S })
  attachLogs(S, L)
  try {
    await waitReady(page)
    await settle(page, 0.6321) // far from area 3 on purpose: Continue must still go to area 3
    const before = await state(page)
    const btn = await page.evaluate(() => { const r = [...document.querySelectorAll('button')].find((b) => /^Continue/.test(b.textContent.trim())).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })
    await page.evaluate(() => window.__gate.start(performance.now()))
    await page.mouse.click(btn.x, btn.y)
    await waitParked(page, 'a3')
    const rows = await page.evaluate(() => window.__gate.rows.slice())
    await page.evaluate(() => window.__gate.stop())
    const sp = await state(page)
    const fp = await focusInfo(page)
    const mk = await page.evaluate(() => window.__worldMarkers[2])
    const arrive = rows.find((r) => r.p === 1)
    check(S, 'continue.opensCurrentArea', sp.open && sp.parkedId === 'a3' && sp.panelTitle === 'Video Ads I', `from depth ${before.depth.toFixed(4)}: parked ${sp.parkedId}, panel "${sp.panelTitle}", arrived at scene ${arrive ? Math.round(arrive.clock * 1000) : '?'} ms; a3 anchor projected at ${(100 * mk.x / vp.width).toFixed(1)}%/${(100 * mk.y / vp.height).toFixed(1)}% visible=${mk.visible}`)
    check(S, 'continue.focusNextLesson', /^Lesson 5,.*next$/.test(fp.label || ''), `focus "${fp.label}"`)
    const f1 = await shot(page, `${S}-01-continue-parked-a3.png`)
    // Click lesson 5's row.
    const row = await page.evaluate(() => { const b = [...document.querySelectorAll('section[aria-labelledby] button')].find((b) => /^Lesson 5,/.test(b.getAttribute('aria-label') || '')); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })
    await page.mouse.click(row.x, row.y)
    await sleep(600)
    const lesson = await page.evaluate(() => ({ title: document.getElementById('v2-panel-title')?.textContent, video: !!document.querySelector('[aria-label="Lesson video placeholder"]'), back: [...document.querySelectorAll('section[aria-labelledby] button')].map((b) => b.textContent.trim()).slice(0, 3) }))
    check(S, 'row.opensLesson', lesson.title === 'Writing a hook that lands' && lesson.video, `lesson view "${lesson.title}", video placeholder ${lesson.video}, buttons ${lesson.back.join(' | ')}`)
    const f2 = await shot(page, `${S}-02-lesson-view.png`)
    // Back button (to area).
    const backBtn = await page.evaluate(() => { const b = document.querySelector('section[aria-labelledby] [class*="__back"]'); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: b.textContent.trim() } })
    await page.mouse.click(backBtn.x, backBtn.y)
    await sleep(600)
    const area = await state(page)
    const fArea = await focusInfo(page)
    check(S, 'lessonBack.returnsToArea', area.panelTitle === 'Video Ads I' && area.open, `back "${backBtn.text}" -> panel "${area.panelTitle}", focus "${fArea.label}"`)
    const f3 = await shot(page, `${S}-03-back-to-area.png`)
    // "Map" back to the rail.
    const mapBtn = await page.evaluate(() => { const b = document.querySelector('section[aria-labelledby] [class*="__back"]'); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: b.textContent.trim() } })
    await page.mouse.click(mapBtn.x, mapBtn.y)
    await waitClosed(page)
    const after = await state(page)
    check(S, 'mapBack.restoresRail', !after.open && after.scrollY === before.scrollY && Math.abs(after.depth - before.depth) < 1e-9 && camDelta(before.camera, after.camera).units < 0.01, `"${mapBtn.text}" -> closed; scrollY ${before.scrollY} -> ${after.scrollY}; depth ${before.depth.toFixed(5)} -> ${after.depth.toFixed(5)}; camera return ${JSON.stringify(camDelta(before.camera, after.camera))}`)
    await shot(page, `${S}-04-back-on-rail.png`)
  } finally {
    await page.close()
  }
}

/** prefers-reduced-motion: park, close, dock travel and view changes should be instant and still correct. */
scenarios.reduced = async () => {
  const S = 'reduced'
  const vp = VPS.laptop
  // Reference park pose with motion on, same viewport and depth.
  const ref = await openPage(vp, { tag: `${S}-reference` })
  attachLogs(S, ref.L)
  let refPose = null
  try {
    await waitReady(ref.page)
    await settle(ref.page, 0.3)
    await ref.page.evaluate(() => window.__worldPark('a3'))
    await waitParked(ref.page, 'a3')
    refPose = (await state(ref.page)).camera
  } finally {
    await ref.page.close()
  }
  const { page, L } = await openPage(vp, { reduced: true, tag: S })
  attachLogs(S, L)
  try {
    await waitReady(page)
    const mq = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
    check(S, 'emulation.active', mq, `matchMedia reduce = ${mq}`)
    await settle(page, 0.3)
    const before = await state(page)
    const mc = await markerCenter(page, 'a3')
    await page.evaluate(() => window.__gate.start(performance.now()))
    await page.mouse.click(mc.x, mc.y)
    await sleep(150)
    const immediate = await state(page)
    await waitParked(page, 'a3')
    const rows = await page.evaluate(() => window.__gate.rows.slice())
    await page.evaluate(() => window.__gate.stop())
    const arrive = rows.findIndex((r) => r.p === 1)
    const parked = await state(page)
    await shot(page, `${S}-01-parked.png`)
    check(S, 'park.instant', arrive >= 0 && arrive <= 1, `parkProgress hit 1 on frame ${arrive + 1} (scene ${arrive >= 0 ? Math.round(rows[arrive].clock * 1000) : '?'} ms); panel opacity 150 ms after click = ${immediate.panelOpacity}; progress trace ${rows.slice(0, 4).map((r) => r.p).join(',')}`)
    check(S, 'park.samePoseAsMotion', camDelta(refPose, parked.camera).units < 0.5, `reduced park pose vs normal park pose: ${JSON.stringify(camDelta(refPose, parked.camera))}`)
    // Close with Escape.
    await page.evaluate(() => window.__gate.start(performance.now()))
    await page.keyboard.press('Escape')
    await sleep(150)
    const closing = await state(page)
    await waitClosed(page)
    const rowsB = await page.evaluate(() => window.__gate.rows.slice())
    await page.evaluate(() => window.__gate.stop())
    const home = rowsB.findIndex((r) => r.p === 0)
    const after = await state(page)
    check(S, 'close.instant', !closing.open && home >= 0 && home <= 1, `150 ms after Escape: open=${closing.open}, overflow="${closing.bodyOverflow}"; parkProgress 0 on frame ${home + 1}`)
    check(S, 'close.restores', after.scrollY === before.scrollY && camDelta(before.camera, after.camera).units < 0.01, `scrollY ${before.scrollY} -> ${after.scrollY}; camera ${JSON.stringify(camDelta(before.camera, after.camera))}`)
    // Dock travel under reduced motion: scroll jumps, but does the camera jump too?
    const stop = await page.evaluate(() => { const b = document.querySelectorAll('nav[aria-label="Areas"] [class*="__track"] button')[7]; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })
    const y0 = await page.evaluate(() => window.scrollY)
    await page.evaluate(() => window.__gate.start(performance.now()))
    await page.mouse.click(stop.x, stop.y)
    await sleep(100)
    const y1 = await page.evaluate(() => window.scrollY)
    await settleOnScroll(page)
    const rowsT = await page.evaluate(() => window.__gate.rows.slice())
    await page.evaluate(() => window.__gate.stop())
    const target = rowsT.length ? rowsT[rowsT.length - 1].depth : null
    const half = rowsT.findIndex((r) => Math.abs(r.depth - target) < 0.5 * Math.abs(rowsT[0].depth - target) + 1e-9)
    const within1pct = rowsT.findIndex((r) => Math.abs(r.depth - target) < 0.01 * Math.abs((rowsT[0].depth ?? 0) - target) + 1e-6)
    check(S, 'dock.scrollInstant', y1 !== y0, `scrollY ${y0} -> ${y1} within 100 ms of the click`)
    check(S, 'dock.cameraInstant', rowsT.length <= 2 ? true : 'fail', `camera glided over ${rowsT.length} frames / ${Math.round((rowsT[rowsT.length - 1]?.clock ?? 0) * 1000)} ms scene time (half-way at frame ${half + 1}, within 1% at frame ${within1pct + 1}, scene ${within1pct >= 0 ? Math.round(rowsT[within1pct].clock * 1000) : '?'} ms); depth trace ${rowsT.slice(0, 6).map((r) => r.depth.toFixed(3)).join(' ')}`)
    await shot(page, `${S}-02-dock-a8.png`)
    // CSS: view transitions off?
    const css = await page.evaluate(() => {
      const probe = document.querySelector('[class*="__cueLine"]') || document.querySelector('[class*="__stop"]')
      return { anim: getComputedStyle(probe).animationName, transition: getComputedStyle(document.querySelector('[class*="__primary"]')).transitionDuration }
    })
    check(S, 'css.animationsOff', css.anim === 'none' && /^0s/.test(css.transition), `cueLine animation ${css.anim}; Continue transition ${css.transition}`)
  } finally {
    await page.close()
  }
}

/** Narrow viewports: list view, no canvas, no three.js, every area reachable. */
scenarios.narrow = async () => {
  const S = 'narrow'
  for (const vp of [VPS.phone, VPS.tablet]) {
    const { page, L } = await openPage(vp, { tag: `${S}-${vp.name}` })
    attachLogs(S, L)
    try {
      const boot = await waitReady(page)
      await sleep(1500)
      const info = await page.evaluate(() => ({
        view: document.querySelector('main')?.dataset.view,
        canvas: document.querySelectorAll('canvas').length,
        stage: !!document.querySelector('[class*="__stage"]'),
        rows: [...document.querySelectorAll('[class*="__areaRow"]')].map((b) => b.getAttribute('aria-label')),
        overflowX: document.documentElement.scrollWidth - innerWidth,
        three: performance.getEntriesByType('resource').filter((e) => /\.glb|draco|three/i.test(e.name)).map((e) => e.name),
        loading: !!document.querySelector('[class*="__loading"]'),
      }))
      check(S, `${vp.name}.listView`, info.view === 'list' && info.canvas === 0 && !info.stage, `view=${info.view}, canvases=${info.canvas}, stage=${info.stage}, boot ${JSON.stringify(boot)}`)
      check(S, `${vp.name}.noThreeLoaded`, info.three.length === 0 && L.requests.filter((u) => /\.glb|draco/.test(u)).length === 0, `glb/draco/three resources: ${JSON.stringify(info.three)} requests ${JSON.stringify(L.requests)}`)
      check(S, `${vp.name}.noHorizontalScroll`, info.overflowX <= 0, `scrollWidth - innerWidth = ${info.overflowX}`)
      const f1 = await shot(page, `${S}-${vp.name}-01-list.png`)
      await page.screenshot({ path: path.join(OUT, `${S}-${vp.name}-01-list-full.png`), fullPage: true })
      // Keyboard: Tab through every row.
      const seq = []
      for (let i = 0; i < 14; i++) { await page.keyboard.press('Tab'); await sleep(50); seq.push(await focusInfo(page)) }
      const rowsTabbed = seq.filter((f) => f.cls === 'areaRow').length
      // Re-verify: count DISTINCT rows reached, and whether each is reached once per cycle.
      const rowLabels = seq.filter((f) => f.cls === 'areaRow').map((f) => (f.label || '').split(',')[0])
      const distinctRows = new Set(rowLabels).size
      check(S, `${vp.name}.tabReachesRows`, distinctRows === 8, `${distinctRows} distinct of 8 rows in 14 Tabs (${rowsTabbed} row stops incl. repeats after wrap); sequence ${seq.map((f) => (f.label || '').split(',')[0] || f.tag).join(' > ')}`)
      result(S)[`${vp.name}TabSeq`] = seq.map((f) => ({ label: f.label, tag: f.tag, cls: f.cls, covered: f.covered, inView: f.inView }))
      // Open every area by click; check sheet, focus, Escape, focus return, scroll.
      const per = []
      for (let k = 0; k < 8; k++) {
        await page.evaluate((k) => document.querySelectorAll('[class*="__areaRow"]')[k].scrollIntoView({ block: 'center' }), k)
        await sleep(150)
        const y0 = await page.evaluate(() => window.scrollY)
        const r = await page.evaluate((k) => { const b = document.querySelectorAll('[class*="__areaRow"]')[k].getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 } }, k)
        await page.mouse.click(r.x, r.y)
        await sleep(500)
        const open = await page.evaluate(() => { const d = document.querySelector('[role="dialog"]'); return { dialog: !!d, modal: d?.getAttribute('aria-modal'), title: document.getElementById('v2-panel-title')?.textContent, bodyOverflow: document.body.style.overflow, rows: d ? d.querySelectorAll('ol button').length : 0 } })
        const fo = await focusInfo(page)
        if (k === 7) await shot(page, `${S}-${vp.name}-02-sheet-a8.png`)
        if (k === 2) await shot(page, `${S}-${vp.name}-02-sheet-a3.png`)
        // Tab past the end of the sheet: does focus reach something hidden behind it?
        let escaped = null
        if (k === 2) {
          for (let i = 0; i < 12; i++) { await page.keyboard.press('Tab'); await sleep(40); const f = await focusInfo(page); if (!f.inSheet && f.tag !== 'BODY') { escaped = f; break } }
          await page.evaluate(() => document.getElementById('v2-panel-title')?.focus())
        }
        await page.keyboard.press('Escape')
        await sleep(400)
        const fc = await focusInfo(page)
        const after = await page.evaluate(() => ({ dialog: !!document.querySelector('[role="dialog"]'), y: window.scrollY, overflow: document.body.style.overflow }))
        per.push({ k: k + 1, open, focusOnOpen: `${fo.tag}#${fo.id} ${fo.inSheet}`, focusAfter: fc.label, y0, yAfter: after.y, closed: !after.dialog, overflow: after.overflow, escaped: escaped ? { label: escaped.label, covered: escaped.covered, coveredBy: escaped.coveredBy } : null })
      }
      result(S)[vp.name] = per
      const bad = per.filter((p) => !p.open.dialog || p.open.title !== AREAS[p.k - 1][1] || !p.closed || p.overflow === 'hidden' || !/#v2-panel-title true/.test(p.focusOnOpen) || !(p.focusAfter || '').startsWith(AREAS[p.k - 1][1]) || p.y0 !== p.yAfter)
      check(S, `${vp.name}.everyAreaOpens`, bad.length === 0, bad.length ? JSON.stringify(bad) : `8/8 rows open a dialog sheet with the right title, focus to heading, Escape closes, focus back to the row, scrollY restored`)
      const esc = per.find((p) => p.escaped)
      check(S, `${vp.name}.sheetFocusContained`, esc ? 'warn' : true, esc ? `Tab from inside the aria-modal sheet reached "${esc.escaped.label}" covered=${esc.escaped.covered} by ${esc.escaped.coveredBy}` : 'focus stays inside the sheet')
      // Continue opens area 3 at lesson 5.
      await page.evaluate(() => window.scrollTo(0, 0))
      await sleep(200)
      await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /^Continue/.test(b.textContent.trim())).click())
      await sleep(500)
      const fc = await focusInfo(page)
      const t = await page.evaluate(() => document.getElementById('v2-panel-title')?.textContent)
      check(S, `${vp.name}.continue`, t === 'Video Ads I' && /^Lesson 5,/.test(fc.label || ''), `sheet "${t}", focus "${fc.label}"`)
      await page.keyboard.press('Escape')
      await sleep(300)
    } finally {
      await page.close()
    }
  }
}

/** WebGL unavailable: getContext returns null for webgl/webgl2 before load. */
scenarios.nowebgl = async () => {
  const S = 'nowebgl'
  const vp = VPS.split
  const { page, L } = await openPage(vp, { noWebGL: true, tag: S })
  attachLogs(S, L)
  try {
    const boot = await waitReady(page)
    await sleep(1500)
    const info = await page.evaluate(() => ({
      view: document.querySelector('main')?.dataset.view,
      refused: window.__webglRefused || 0,
      err: window.__worldError ?? null,
      note: document.querySelector('[class*="__note"]')?.textContent ?? null,
      rows: document.querySelectorAll('[class*="__areaRow"]').length,
      canvas: document.querySelectorAll('canvas').length,
      loadingVisible: (() => { const l = document.querySelector('[class*="__loading"]'); return l ? getComputedStyle(l).visibility : 'absent' })(),
      overflow: document.body.style.overflow,
    }))
    check(S, 'fallback.listView', info.view === 'list' && info.rows === 8 && info.canvas === 0, `view=${info.view}, rows=${info.rows}, canvases=${info.canvas}, getContext refused ${info.refused}x, __worldError="${(info.err || '').slice(0, 120)}", loading overlay ${info.loadingVisible}`)
    check(S, 'fallback.note', !!info.note, `note: "${info.note}"`)
    check(S, 'fallback.noCrash', L.pageErrors.length === 0, `pageerrors ${L.pageErrors.length}; console errors ${L.errors.length}: ${L.errors.map((e) => e.slice(0, 110)).join(' || ')}`)
    await shot(page, `${S}-01-list.png`)
    // Rows work in the fallback.
    await page.evaluate(() => document.querySelectorAll('[class*="__areaRow"]')[4].click())
    await sleep(500)
    const t = await page.evaluate(() => ({ title: document.getElementById('v2-panel-title')?.textContent, dialog: !!document.querySelector('[role="dialog"]') }))
    await shot(page, `${S}-02-sheet.png`)
    await page.keyboard.press('Escape')
    await sleep(400)
    const closed = await page.evaluate(() => ({ dialog: !!document.querySelector('[role="dialog"]'), overflow: document.body.style.overflow }))
    check(S, 'fallback.rowsWork', t.title === 'Static Ads' && t.dialog && !closed.dialog && closed.overflow !== 'hidden', `row 5 -> "${t.title}" dialog=${t.dialog}; Escape -> dialog=${closed.dialog} overflow="${closed.overflow}"`)
  } finally {
    await page.close()
  }
}

/** Resize while parked, while flying, and across the list-view breakpoint. */
scenarios.resize = async () => {
  const S = 'resize'
  // A: parked at a3 on split, resize to laptop (shorter), then close. Where does the camera come home to?
  if (!process.env.RESIZE_PARTS || process.env.RESIZE_PARTS.includes('A')) {
    const { page, L } = await openPage(VPS.split, { tag: `${S}-parked` })
    attachLogs(S, L)
    try {
      await waitReady(page)
      await settle(page, 0.3)
      const before = await state(page)
      const mc = await markerCenter(page, 'a3')
      await page.mouse.click(mc.x, mc.y)
      await waitParked(page, 'a3')
      await shot(page, `${S}-A1-parked-split.png`)
      await page.setViewport({ width: VPS.laptop.width, height: VPS.laptop.height, deviceScaleFactor: 1 })
      await sleep(2500)
      const mid = await state(page)
      const mk = await page.evaluate(() => window.__worldMarkers[2])
      await shot(page, `${S}-A2-parked-after-resize-laptop.png`)
      check(S, 'parked.resizeKeepsPark', mid.open && mid.parkedId === 'a3' && mid.parkProgress === 1 && mk.visible && mk.x > 0.36 * VPS.laptop.width, `after resize: open=${mid.open} parked=${mid.parkedId} p=${mid.parkProgress}; a3 anchor at ${(100 * mk.x / VPS.laptop.width).toFixed(1)}%/${(100 * mk.y / VPS.laptop.height).toFixed(1)}% visible=${mk.visible}; panel opacity ${mid.panelOpacity}`)
      await page.keyboard.press('Escape')
      await waitClosed(page)
      const after = await state(page)
      await shot(page, `${S}-A3-closed-laptop.png`)
      const drift = after.depth - before.depth
      check(S, 'parked.resizeThenCloseSamePlace', Math.abs(drift) < 0.005, `depth before park ${before.depth.toFixed(4)} (scrollY ${before.scrollY} of ${before.scrollMax}); after resize+close ${after.depth.toFixed(4)} (scrollY ${after.scrollY} of ${after.scrollMax}); drift ${drift.toFixed(4)} rail units; dock now "${after.dockName}" (${after.dockCurrent.join(',')})`)
    } finally {
      await page.close()
    }
  }
  // D: on the rail, no park: does a resize move you along the rail?
  if (!process.env.RESIZE_PARTS || process.env.RESIZE_PARTS.includes('D')) {
    const { page, L } = await openPage(VPS.split, { tag: `${S}-rail` })
    attachLogs(S, L)
    try {
      await waitReady(page)
      await settle(page, 0.3)
      const before = await state(page)
      for (const vp of [VPS.ultra, VPS.laptop]) {
        await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1 })
        await sleep(1500)
        await settleOnScroll(page)
        const st = await state(page)
        await shot(page, `${S}-D-rail-split-to-${vp.name}.png`)
        check(S, `rail.resizeTo${vp.name}KeepsPlace`, Math.abs(st.depth - before.depth) < 0.005 ? true : 'fail', `rail depth ${before.depth.toFixed(4)} at 1691x1278 (scrollY ${before.scrollY}) -> ${st.depth.toFixed(4)} at ${vp.width}x${vp.height} (scrollY ${st.scrollY} of ${st.scrollMax}); dock now "${st.dockCurrent.join(',')}"`)
      }
    } finally {
      await page.close()
    }
  }
  // E (re-verify extra): screen-hopping. Rail at a5, split <-> ultra 3 times; parked at a3, split -> laptop -> split, then close.
  if (process.env.RESIZE_PARTS && process.env.RESIZE_PARTS.includes('E')) {
    const { page, L } = await openPage(VPS.split, { tag: `${S}-hop` })
    attachLogs(S, L)
    try {
      await waitReady(page)
      await settle(page, 0.5236)
      const before = await state(page)
      const trace = [`split ${before.depth.toFixed(5)} y${before.scrollY}`]
      let st = before
      for (let i = 0; i < 3; i++) {
        for (const vp of [VPS.ultra, VPS.split]) {
          await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1 })
          await sleep(1200)
          await settleOnScroll(page)
          st = await state(page)
          trace.push(`${vp.name} ${st.depth.toFixed(5)} y${st.scrollY}`)
        }
      }
      await shot(page, `${S}-E1-rail-after-3-hops.png`)
      check(S, 'hop.railThreeRoundTrips', Math.abs(st.depth - before.depth) < 0.002 ? true : 'fail', `rail depth over 3 split<->ultra round trips: ${trace.join(' -> ')}; drift ${(st.depth - before.depth).toFixed(5)}; dock "${st.dockCurrent.join(',')}"`)
      // Parked round trip.
      await settle(page, 0.3)
      const b2 = await state(page)
      const mc = await markerCenter(page, 'a3')
      await page.mouse.click(mc.x, mc.y)
      await waitParked(page, 'a3')
      await page.setViewport({ width: VPS.laptop.width, height: VPS.laptop.height, deviceScaleFactor: 1 })
      await sleep(1500)
      await page.setViewport({ width: VPS.split.width, height: VPS.split.height, deviceScaleFactor: 1 })
      await sleep(1500)
      await page.keyboard.press('Escape')
      await waitClosed(page)
      await settleOnScroll(page)
      const a2 = await state(page)
      await shot(page, `${S}-E2-parked-roundtrip-closed.png`)
      check(S, 'hop.parkedRoundTripExact', a2.scrollY === b2.scrollY && Math.abs(a2.depth - b2.depth) < 1e-6 ? true : 'fail', `parked a3, split->laptop->split, close: scrollY ${b2.scrollY}->${a2.scrollY}, depth ${b2.depth.toFixed(5)}->${a2.depth.toFixed(5)}`)
      // Parked, resize to ultra (different max), close: same depth, and dock caret on the right area.
      const mc3 = await markerCenter(page, 'a3')
      await page.mouse.click(mc3.x, mc3.y)
      await waitParked(page, 'a3')
      await page.setViewport({ width: VPS.ultra.width, height: VPS.ultra.height, deviceScaleFactor: 1 })
      await sleep(1500)
      await page.keyboard.press('Escape')
      await waitClosed(page)
      await settleOnScroll(page)
      const a3 = await state(page)
      await shot(page, `${S}-E3-parked-to-ultra-closed.png`)
      check(S, 'hop.parkedToUltraClose', Math.abs(a3.depth - b2.depth) < 0.002 && a3.dockCurrent.includes('Travel to Video Ads I') ? true : 'fail', `parked a3 on split, resize to ultra, close: depth ${b2.depth.toFixed(5)}->${a3.depth.toFixed(5)} (scrollY ${a3.scrollY} of ${a3.scrollMax}); dock "${a3.dockCurrent.join(',')}"`)
    } finally {
      await page.close()
    }
  }
  // B: resize mid-flight (held at 0.4 s scene time), split -> ultrawide. Is the motion continuous?
  if (!process.env.RESIZE_PARTS || process.env.RESIZE_PARTS.includes('B')) {
    const { page, L } = await openPage(VPS.split, { tag: `${S}-flight` })
    attachLogs(S, L)
    try {
      await waitReady(page)
      await settle(page, 0.3)
      const mc = await markerCenter(page, 'a3')
      await page.evaluate(() => { window.__gate.hold(); window.__gate.start(performance.now()) })
      await page.mouse.click(mc.x, mc.y)
      await sleep(400)
      await page.evaluate(() => { window.__gate.holdAt = 0.4; window.__gate.release() })
      await page.waitForFunction(() => window.__gate.held, { timeout: 600000, polling: 50 })
      await sleep(300)
      await shot(page, `${S}-B1-flight-0400ms-split.png`)
      const nBefore = await page.evaluate(() => window.__gate.rows.length)
      await page.setViewport({ width: VPS.ultra.width, height: VPS.ultra.height, deviceScaleFactor: 1 })
      await sleep(800)
      await page.evaluate(() => { window.__gate.holdAt = 0.5; window.__gate.release() })
      await page.waitForFunction(() => window.__gate.held || (window.__worldFrame && window.__worldFrame.parkProgress === 1), { timeout: 600000, polling: 50 })
      await sleep(300)
      await shot(page, `${S}-B2-flight-0500ms-after-resize-ultra.png`)
      await page.evaluate(() => { window.__gate.release() })
      await waitParked(page, 'a3')
      const rows = await page.evaluate(() => window.__gate.rows.slice())
      await page.evaluate(() => window.__gate.stop())
      await shot(page, `${S}-B3-parked-ultra.png`)
      // Per-frame camera step, normalised by dt, around the resize frame.
      const steps = []
      for (let i = 1; i < rows.length; i++) {
        const a = rows[i - 1].cam, b = rows[i].cam
        if (!a || !b) continue
        const dt = rows[i].clock - rows[i - 1].clock
        const d = camDelta(a, b)
        steps.push({ i, clock: +rows[i].clock.toFixed(3), dt: +dt.toFixed(3), units: d.units, deg: d.deg, speed: dt > 0 ? +(d.units / dt).toFixed(1) : null, degPerS: dt > 0 ? +(d.deg / dt).toFixed(1) : null, vw: rows[i].vw, p: rows[i].p })
      }
      const resizeIdx = steps.findIndex((s) => s.vw === VPS.ultra.width)
      const around = steps.slice(Math.max(0, resizeIdx - 3), resizeIdx + 3)
      const others = steps.filter((s, j) => Math.abs(j - resizeIdx) > 1 && s.dt > 0)
      const maxOtherDeg = Math.max(...others.map((s) => s.degPerS))
      const maxOtherSpeed = Math.max(...others.map((s) => s.speed))
      const at = steps[resizeIdx]
      result(S).flightSteps = steps
      check(S, 'flight.resizeContinuous', at && at.degPerS <= 1.5 * maxOtherDeg && at.speed <= 1.5 * maxOtherSpeed ? true : 'fail', at ? `resize frame (scene ${at.clock}s): ${at.speed} u/s, ${at.degPerS} deg/s vs max elsewhere ${maxOtherSpeed} u/s, ${maxOtherDeg} deg/s; around: ${around.map((s) => `${s.clock}s ${s.speed}u/s ${s.degPerS}d/s vw${s.vw}`).join(' | ')}` : 'resize frame not found')
      const s2 = await state(page)
      const mk = await page.evaluate(() => window.__worldMarkers[2])
      check(S, 'flight.resizeLandsFramed', s2.parkProgress === 1 && mk.visible && mk.x > 0.36 * VPS.ultra.width, `parked p=${s2.parkProgress}; a3 anchor at ${(100 * mk.x / VPS.ultra.width).toFixed(1)}%/${(100 * mk.y / VPS.ultra.height).toFixed(1)}% on ultrawide`)
      await page.keyboard.press('Escape')
      await waitClosed(page)
    } finally {
      await page.close()
    }
  }
  // C: parked, resize to a phone-ish width (list view, sheet) and back to split.
  if (!process.env.RESIZE_PARTS || process.env.RESIZE_PARTS.includes('C')) {
    const { page, L } = await openPage(VPS.split, { tag: `${S}-breakpoint` })
    attachLogs(S, L)
    try {
      await waitReady(page)
      await settle(page, 0.3)
      const before = await state(page)
      const mc = await markerCenter(page, 'a3')
      await page.mouse.click(mc.x, mc.y)
      await waitParked(page, 'a3')
      await page.setViewport({ width: VPS.tablet.width, height: VPS.tablet.height, deviceScaleFactor: 1 })
      await sleep(1500)
      const narrow = await page.evaluate(() => ({ view: document.querySelector('main')?.dataset.view, dialog: !!document.querySelector('[role="dialog"]'), title: document.getElementById('v2-panel-title')?.textContent, overflow: document.body.style.overflow, canvas: document.querySelectorAll('canvas').length, active: document.activeElement?.tagName + '#' + document.activeElement?.id, y: window.scrollY }))
      await shot(page, `${S}-C1-parked-to-740.png`)
      check(S, 'breakpoint.parkedToList', narrow.view === 'list' && narrow.dialog && narrow.title === 'Video Ads I' && narrow.canvas === 0, JSON.stringify(narrow))
      await page.setViewport({ width: VPS.split.width, height: VPS.split.height, deviceScaleFactor: 1 })
      await page.waitForFunction(() => window.__worldReady === true, { timeout: 300000, polling: 200 })
      await page.waitForFunction(() => window.__worldFrame && window.__worldFrame.parkedId === 'a3' && window.__worldFrame.parkProgress === 1, { timeout: 600000, polling: 200 }).catch(() => null)
      await sleep(800)
      const back = await state(page)
      await shot(page, `${S}-C2-back-to-split.png`)
      check(S, 'breakpoint.listToWorldStillParked', back.open && back.parkedId === 'a3' && back.parkProgress === 1 && back.bodyOverflow === 'hidden', `open=${back.open} parked=${back.parkedId} p=${back.parkProgress} overflow="${back.bodyOverflow}" panel opacity ${back.panelOpacity}`)
      await page.evaluate(() => window.__gate.start(performance.now()))
      await page.keyboard.press('Escape')
      await waitClosed(page).catch(() => null)
      const atHome = await state(page)
      await settleOnScroll(page)
      const rowsC = await page.evaluate(() => window.__gate.rows.slice())
      await page.evaluate(() => window.__gate.stop())
      const after = await state(page)
      await shot(page, `${S}-C3-closed.png`)
      const minDepth = Math.min(...rowsC.map((r) => r.depth))
      check(S, 'breakpoint.closeRestoresPlace', !after.open && after.scrollY === before.scrollY && Math.abs(after.depth - before.depth) < 1e-6, `scrollY ${before.scrollY} -> ${after.scrollY}; final depth ${before.depth.toFixed(4)} -> ${after.depth?.toFixed(4)}; overflow "${after.bodyOverflow}"`)
      check(S, 'breakpoint.closeFlightTarget', Math.abs(atHome.depth - before.depth) < 0.005 ? true : 'fail', `the fly-back landed on the rail at depth ${atHome.depth.toFixed(4)} (lowest ${minDepth.toFixed(4)}), then glided ${(after.depth - atHome.depth).toFixed(4)} to ${after.depth.toFixed(4)} over ${rowsC.filter((r) => r.p === 0).length} more frames`)
    } finally {
      await page.close()
    }
  }
}

/** Rapid input: open/close the same area 5 times fast; two markers in quick succession. */
scenarios.rapid = async () => {
  const S = 'rapid'
  const vp = VPS.laptop
  const { page, L } = await openPage(vp, { tag: S })
  attachLogs(S, L)
  try {
    await waitReady(page)
    await settle(page, 0.3)
    const home = await state(page)
    const mc = await markerCenter(page, 'a3')
    // V1: click + Escape x5, no waits at all.
    const t0 = Date.now()
    for (let i = 0; i < 5; i++) {
      await page.mouse.click(mc.x, mc.y)
      await page.keyboard.press('Escape')
    }
    const v1Wall = Date.now() - t0
    await sleep(500)
    await waitClosed(page)
    await settleOnScroll(page)
    const s1 = await state(page)
    const f1 = await focusInfo(page)
    check(S, 'v1.fiveFastOpenClose', !s1.open && s1.bodyOverflow === '' && s1.scrollY === home.scrollY && Math.abs(s1.depth - home.depth) < 1e-9 && camDelta(home.camera, s1.camera).units < 0.01 && parseFloat(s1.markersOpacity) === 1 && s1.markersPointer === '' && parseFloat(s1.dockOpacity) === 1, `5x (click+Escape) in ${v1Wall} ms -> open=${s1.open} overflow="${s1.bodyOverflow}" scrollY ${home.scrollY}->${s1.scrollY} camera ${JSON.stringify(camDelta(home.camera, s1.camera))} markers ${s1.markersOpacity}/${s1.markersPointer || 'auto'} dock ${s1.dockOpacity}; focus "${f1.label}"`)
    await shot(page, `${S}-01-after-5-fast.png`)
    // V2: click, Escape mid-flight (p > 0.3), click again during the fly-back, x5.
    const cycles = []
    for (let i = 0; i < 5; i++) {
      await page.mouse.click(mc.x, mc.y)
      await page.waitForFunction(() => window.__worldFrame.parkProgress > 0.3, { timeout: 600000, polling: 30 })
      const pEsc = await page.evaluate(() => window.__worldFrame.parkProgress)
      await page.keyboard.press('Escape')
      // The frame object only updates on a rendered frame: wait for the scene to report the return flight.
      await page.waitForFunction((p0) => window.__worldFrame.parkedId === null && window.__worldFrame.parkProgress < p0, { timeout: 600000, polling: 30 }, pEsc)
      const pAtClick = await page.evaluate(() => window.__worldFrame.parkProgress)
      await page.mouse.click(mc.x, mc.y) // during the fly-back
      // Let two more frames run, then see whether the scene turned around again.
      const n0 = await page.evaluate(() => window.__worldFrameCount)
      await page.waitForFunction((n) => window.__worldFrameCount >= n + 2, { timeout: 600000, polling: 50 }, n0)
      const s = await state(page)
      cycles.push({ pEsc: +pEsc.toFixed(3), pAtClick: +pAtClick.toFixed(3), afterClick: { open: s.open, parked: s.parkedId, p: +s.parkProgress.toFixed(3), title: s.panelTitle } })
      await waitClosed(page)
    }
    await settleOnScroll(page)
    const s2 = await state(page)
    result(S).v2cycles = cycles
    const reopened = cycles.filter((c) => c.afterClick.parked === 'a3')
    check(S, 'v2.escapeMidFlight', !s2.open && s2.scrollY === home.scrollY && camDelta(home.camera, s2.camera).units < 0.01, `5 cycles; clicks during fly-back reopened ${reopened.length}/5 (ignored ${5 - reopened.length}); end: open=${s2.open} scrollY ${home.scrollY}->${s2.scrollY} camera ${JSON.stringify(camDelta(home.camera, s2.camera))}`)
    check(S, 'v2.clickDuringFlyBack', reopened.length === 0 ? 'warn' : true, reopened.length === 0 ? `a click on the marker while the camera flies home is swallowed (markers inert until home); clicks landed at parkProgress ${cycles.map((c) => c.pAtClick).join(', ')}` : `reopened ${reopened.length}/5`)
    // V3: two different markers in quick succession.
    await settle(page, 0)
    const ids = await page.evaluate(() => [...document.querySelectorAll('[class*="__markers"] > button')].map((b, k) => ({ k, mode: b.dataset.mode })).filter((m) => m.mode !== 'hidden'))
    const pair = ids.slice(0, 2).map((m) => ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'][m.k])
    const A = await markerCenter(page, pair[0])
    const B = await markerCenter(page, pair[1])
    await page.mouse.click(A.x, A.y)
    await page.mouse.click(B.x, B.y)
    await sleep(300)
    const s3a = await state(page)
    const settled = await page.waitForFunction(() => window.__worldFrame.parkProgress === 1, { timeout: 600000, polling: 100 }).then(() => true).catch(() => false)
    const s3 = await state(page)
    await shot(page, `${S}-03-two-markers.png`)
    const nameOf = (id) => AREAS.find((a) => a[0] === id)[1]
    const consistent = s3.parkedId && s3.panelTitle === nameOf(s3.parkedId)
    check(S, 'v3.twoMarkersQuick', consistent && s3.parkedId === pair[0], `clicked ${pair[0]} then ${pair[1]} back-to-back -> scene parked at ${s3.parkedId}, panel "${s3.panelTitle}" (consistent=${consistent})`)
    await page.keyboard.press('Escape')
    await waitClosed(page)
    // V4: marker click then a dock-stop click 1 frame later.
    const stop = await page.evaluate(() => { const b = document.querySelectorAll('nav[aria-label="Areas"] [class*="__track"] button')[6]; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })
    const y0 = await page.evaluate(() => window.scrollY)
    const A2 = await markerCenter(page, pair[0])
    await page.mouse.click(A2.x, A2.y)
    await page.mouse.click(stop.x, stop.y)
    await sleep(2500)
    const s4 = await state(page)
    check(S, 'v4.markerThenDock', s4.open && s4.parkedId === pair[0] && s4.scrollY === y0, `marker ${pair[0]} then dock stop 7 -> open=${s4.open} parked=${s4.parkedId} scrollY ${y0}->${s4.scrollY} (locked page must not move)`)
    await page.keyboard.press('Escape')
    await waitClosed(page)
    // V5: dock stop then marker click during the scroll tween.
    const stop2 = await page.evaluate(() => { const b = document.querySelectorAll('nav[aria-label="Areas"] [class*="__track"] button')[4]; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })
    await page.mouse.click(stop2.x, stop2.y)
    await sleep(120)
    const mid = await page.evaluate(() => window.scrollY)
    const vis = await page.evaluate(() => [...document.querySelectorAll('[class*="__markers"] > button')].map((b, k) => ({ k, mode: b.dataset.mode })).filter((m) => m.mode !== 'hidden'))
    const pick = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'][vis[0].k]
    const C = await markerCenter(page, pick)
    await page.mouse.click(C.x, C.y)
    await sleep(1500)
    const yLocked = await page.evaluate(() => window.scrollY)
    await sleep(1500)
    const yLocked2 = await page.evaluate(() => window.scrollY)
    await page.waitForFunction(() => window.__worldFrame.parkProgress === 1, { timeout: 600000, polling: 100 })
    const s5 = await state(page)
    check(S, 'v5.markerDuringDockTween', s5.open && s5.parkedId === pick && yLocked === yLocked2, `dock tween started (scrollY ${mid}), clicked marker ${pick} mid-tween -> parked ${s5.parkedId}; scrollY while parked ${yLocked} then ${yLocked2} (tween must stop)`)
    await page.keyboard.press('Escape')
    await waitClosed(page)
    const s5b = await state(page)
    check(S, 'v5.returnsToTweenPoint', s5b.scrollY === yLocked, `after close scrollY ${s5b.scrollY} (saved ${yLocked})`)
  } finally {
    await page.close()
  }
}

/** Scroll lock while parked: wheel, keys, and over the panel. */
scenarios.wheel = async () => {
  const S = 'wheel'
  const vp = VPS.laptop
  const { page, L } = await openPage(vp, { tag: S })
  attachLogs(S, L)
  try {
    await waitReady(page)
    await settle(page, 0.3)
    const mc = await markerCenter(page, 'a3')
    // During the fly-in.
    await page.mouse.click(mc.x, mc.y)
    await page.waitForFunction(() => window.__worldFrame.parkProgress > 0.2, { timeout: 600000, polling: 30 })
    const yIn = await page.evaluate(() => window.scrollY)
    await page.mouse.move(vp.width * 0.7, vp.height * 0.5)
    for (let i = 0; i < 4; i++) await page.mouse.wheel({ deltaY: 900 })
    await waitParked(page, 'a3')
    const parked = await state(page)
    check(S, 'flyIn.wheelIgnored', parked.scrollY === yIn && parked.parkProgress === 1, `scrollY ${yIn} -> ${parked.scrollY} after 4 wheel ticks during the fly-in`)
    // Parked: wheel over the world, over the panel, and keys.
    const before = await state(page)
    for (let i = 0; i < 6; i++) await page.mouse.wheel({ deltaY: 1200 })
    await sleep(1500)
    const w1 = await state(page)
    await page.mouse.move(200, vp.height * 0.6)
    for (let i = 0; i < 6; i++) await page.mouse.wheel({ deltaY: 1200 })
    await sleep(800)
    const w2 = await state(page)
    const panelScroll = await page.evaluate(() => { const p = document.querySelector('[class*="__panelInner"]'); return { top: p.scrollTop, max: p.scrollHeight - p.clientHeight } })
    await page.evaluate(() => document.getElementById('v2-panel-title').focus())
    for (const k of ['PageDown', 'End', 'ArrowDown', 'Space']) { await page.keyboard.press(k); await sleep(200) }
    await sleep(1000)
    const w3 = await state(page)
    const same = (s) => s.scrollY === before.scrollY && s.parkProgress === 1 && camDelta(before.camera, s.camera).units < 0.01 && s.depth === before.depth
    check(S, 'parked.wheelOverWorld', same(w1), `scrollY ${before.scrollY}->${w1.scrollY}, depth ${before.depth}->${w1.depth}, camera ${JSON.stringify(camDelta(before.camera, w1.camera))}`)
    check(S, 'parked.wheelOverPanel', same(w2), `scrollY ${before.scrollY}->${w2.scrollY}; panel inner scrollTop ${panelScroll.top} of ${panelScroll.max}`)
    check(S, 'parked.keysDontScroll', same(w3), `after PageDown/End/ArrowDown/Space: scrollY ${w3.scrollY}, camera ${JSON.stringify(camDelta(before.camera, w3.camera))}`)
    await shot(page, `${S}-01-parked-after-wheel.png`)
    // During the fly-back.
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => window.__worldFrame.parkProgress < 0.8, { timeout: 600000, polling: 30 })
    await page.mouse.move(vp.width * 0.7, vp.height * 0.5)
    for (let i = 0; i < 4; i++) await page.mouse.wheel({ deltaY: 900 })
    await waitClosed(page)
    await settleOnScroll(page)
    const after = await state(page)
    check(S, 'flyBack.wheelIgnored', after.scrollY === yIn, `scrollY after fly-back with wheel: ${after.scrollY} (saved ${yIn})`)
    // Unparked: the wheel works again.
    const diag = await page.evaluate(() => ({ bodyOverflow: document.body.style.overflow, htmlOverflow: getComputedStyle(document.documentElement).overflowY, max: document.documentElement.scrollHeight - innerHeight, open: !!document.querySelector('main[data-open]'), hit: (() => { const e = document.elementFromPoint(innerWidth * 0.7, innerHeight * 0.5); return e ? `${e.tagName}.${String(e.className).replace(/world-module__\w+__/g, '')}` : null })() }))
    await page.mouse.wheel({ deltaY: 600 })
    const tW = Date.now()
    await sleep(800)
    const moved = await page.evaluate(() => window.scrollY)
    // Patient re-check: poll for up to 10 s, then a second tick.
    let movedLate = moved, lateMs = null
    for (let i = 0; i < 40 && movedLate === after.scrollY; i++) { await sleep(250); movedLate = await page.evaluate(() => window.scrollY); if (movedLate !== after.scrollY) lateMs = Date.now() - tW }
    let second = null
    if (movedLate === after.scrollY) { await page.mouse.wheel({ deltaY: 600 }); await sleep(3000); second = await page.evaluate(() => window.scrollY) }
    result(S).wheelAfterClose = { diag, moved800: moved, movedLate, lateMs, second }
    check(S, 'rail.wheelWorksAgain', moved !== after.scrollY ? true : movedLate !== after.scrollY ? 'warn' : 'fail', `wheel on the rail after closing: scrollY ${after.scrollY} -> ${moved} at 800 ms; ${movedLate} by ${lateMs ?? '>10000'} ms${second !== null ? `; second tick -> ${second}` : ''}; diag ${JSON.stringify(diag)}`)
  } finally {
    await page.close()
  }
}

/** WebGL context lost while parked: can the user still get out? */
scenarios.contextloss = async () => {
  const S = 'contextloss'
  const vp = VPS.laptop
  const { page, L } = await openPage(vp, { tag: S })
  attachLogs(S, L)
  try {
    await waitReady(page)
    await settle(page, 0.3)
    const before = await state(page)
    const mc = await markerCenter(page, 'a3')
    await page.mouse.click(mc.x, mc.y)
    await waitParked(page, 'a3')
    const lost = await page.evaluate(() => { const c = document.querySelector('canvas'); const gl = c.getContext('webgl2') || c.getContext('webgl'); const ext = gl && gl.getExtension('WEBGL_lose_context'); if (!ext) return false; window.__loseExt = ext; ext.loseContext(); return true })
    await sleep(500)
    const t0 = Date.now()
    await page.keyboard.press('Escape')
    let closedAt = null
    for (let i = 0; i < 40; i++) {
      await sleep(500)
      const open = await page.evaluate(() => !!document.querySelector('main[data-open]'))
      if (!open) { closedAt = Date.now() - t0; break }
    }
    const s = await state(page)
    await shot(page, `${S}-01-after-escape-lost.png`)
    check(S, 'lost.escapeStillCloses', closedAt !== null && s.bodyOverflow === '', `context lost=${lost}; Escape closed the panel after ${closedAt} ms wall; overflow "${s.bodyOverflow}", scrollY ${before.scrollY}->${s.scrollY}`)
    const restored = await page.evaluate(() => { window.__loseExt?.restoreContext(); return !!window.__loseExt })
    await sleep(4000)
    await page.mouse.wheel({ deltaY: 300 })
    await sleep(3000)
    const s2 = await state(page)
    await shot(page, `${S}-02-after-restore.png`)
    check(S, 'restored.rendersAgain', s2.frames > s.frames, `frames ${s.frames} -> ${s2.frames} after restoreContext + wheel; depth ${s2.depth}`)
    // Re-verify extra: after the restore, a park still works end to end.
    await settle(page, 0.3)
    const mc2 = await markerCenter(page, 'a3')
    let parkAfterRestore = false
    if (mc2) {
      await page.mouse.click(mc2.x, mc2.y)
      parkAfterRestore = await page.waitForFunction(() => window.__worldFrame && window.__worldFrame.parkedId === 'a3' && window.__worldFrame.parkProgress === 1, { timeout: 300000, polling: 200 }).then(() => true).catch(() => false)
      await sleep(400)
      await shot(page, `${S}-03-park-after-restore.png`)
      const sp = await state(page)
      check(S, 'restored.parkWorks', parkAfterRestore && sp.open && parseFloat(sp.panelOpacity) === 1 ? true : 'fail', `marker ${mc2.mode} click after restore -> parked=${sp.parkedId} p=${sp.parkProgress} panel opacity ${sp.panelOpacity}`)
      await page.keyboard.press('Escape')
      await waitClosed(page).catch(() => null)
    } else {
      check(S, 'restored.parkWorks', 'warn', 'a3 marker hidden after restore at depth 0.3')
    }
    // Re-verify extra: context lost while on the rail, THEN the user opens a place.
    await settle(page, 0.3)
    const beforeB = await state(page)
    const lostB = await page.evaluate(() => { if (!window.__loseExt) return false; window.__loseExt.loseContext(); return true })
    await sleep(800)
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /^Continue/.test(b.textContent.trim()))?.focus())
    await page.keyboard.press('Enter')
    await sleep(2500)
    const sB = await state(page)
    const fB = await focusInfo(page)
    await shot(page, `${S}-04-open-while-lost.png`)
    const invisibleOpen = sB.open && !(parseFloat(sB.panelOpacity) > 0.5)
    check(S, 'lostOnRail.openIsVisibleOrRefused', invisibleOpen ? 'fail' : true, `context lost on rail=${lostB}; Continue+Enter -> open=${sB.open} panel opacity ${sB.panelOpacity} overflow="${sB.bodyOverflow}" focus ${fB.tag} "${fB.label}" covered=${fB.covered} op=${fB.opacity}`)
    const t1 = Date.now()
    await page.keyboard.press('Escape')
    let closedB = null
    for (let i = 0; i < 30; i++) { await sleep(300); if (!(await page.evaluate(() => !!document.querySelector('main[data-open]')))) { closedB = Date.now() - t1; break } }
    const sB2 = await state(page)
    check(S, 'lostOnRail.escapeCloses', (closedB !== null || !sB.open) && sB2.bodyOverflow === '' && sB2.scrollY === beforeB.scrollY ? true : 'fail', `Escape -> closed after ${closedB} ms; overflow "${sB2.bodyOverflow}" scrollY ${beforeB.scrollY}->${sB2.scrollY}`)
    await page.evaluate(() => window.__loseExt?.restoreContext())
    await sleep(2000)
  } finally {
    await page.close()
  }
}

/** Input during the load: the chrome is under the loading cover but not inert. */
scenarios.loading = async () => {
  const S = 'loading'
  const vp = VPS.laptop
  const page = await browser.newPage()
  const L = { errors: [], warnings: [], api: [], requests: [], pageErrors: [], tag: S }
  attachLogs(S, L)
  page.on('console', (m) => { const t = m.text(); if (/GPU stall|GL Driver|WebGL-|swiftshader|fallback to software/i.test(t)) return; if (m.type() === 'error') L.errors.push(t.slice(0, 300)) })
  page.on('pageerror', (e) => L.errors.push(`[pageerror] ${e.message}`))
  page.on('request', (r) => { if (/\/api\//.test(new URL(r.url()).pathname)) L.api.push(r.url()) })
  // Slow the glb so the load window is wide enough to act in.
  await page.setRequestInterception(true)
  page.on('request', (r) => { if (/world\.glb$/.test(r.url())) setTimeout(() => r.continue(), 6000); else r.continue() })
  await page.evaluateOnNewDocument(installGate)
  await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1 })
  try {
    await page.goto(`${BASE}${ROUTE}`, { waitUntil: 'domcontentloaded' })
    await page.bringToFront()
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /^Continue/.test(b.textContent.trim())), { timeout: 60000, polling: 50 })
    await hideDevPortal(page)
    const pre = await page.evaluate(() => ({ ready: !!window.__worldReady, loading: (() => { const l = document.querySelector('[class*="__loading"]'); return l ? getComputedStyle(l).visibility + '/' + getComputedStyle(l).opacity : 'absent' })() }))
    await page.keyboard.press('Tab')
    await sleep(100)
    const f = await focusInfo(page)
    check(S, 'load.focusUnderCover', f.covered ? 'warn' : true, `while loading (ready=${pre.ready}, cover ${pre.loading}): Tab focuses "${f.label}", covered=${f.covered} by ${f.coveredBy}`)
    // Several more Tabs during the load: nothing under the cover may ever take focus.
    const loadSeq = [f]
    for (let i = 0; i < 6; i++) { await page.keyboard.press('Tab'); await sleep(60); loadSeq.push(await focusInfo(page)) }
    const inertState = await page.evaluate(() => ({
      ready: !!window.__worldReady,
      next: !!document.querySelector('section[aria-label="Next lesson"]')?.inert,
      markers: !!document.querySelector('[class*="__markers"]')?.inert,
      dock: !!document.querySelector('nav[aria-label="Areas"]')?.inert,
      footer: !!document.querySelector('footer')?.inert,
    }))
    const underCover = loadSeq.filter((x) => x.tag !== 'BODY' && x.covered)
    check(S, 'load.noFocusUnderCoverMultiTab', underCover.length === 0 ? true : 'fail', `7 Tabs during load (ready=${inertState.ready}): ${loadSeq.map((x) => `${x.tag}${x.label ? ' "' + x.label.slice(0, 20) + '"' : ''}${x.covered ? '[covered]' : ''}`).join(' > ')}; inert next=${inertState.next} markers=${inertState.markers} dock=${inertState.dock} footer=${inertState.footer}`)
    // Direct attempt: focus Continue by script and press Enter. inert must block it.
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /^Continue/.test(b.textContent.trim()))?.focus())
    const fForced = await focusInfo(page)
    await page.keyboard.press('Enter')
    await sleep(300)
    const s0 = await state(page)
    await shot(page, `${S}-01-enter-during-load.png`)
    check(S, 'load.enterDuringLoadIgnored', !s0.open && s0.bodyOverflow !== 'hidden' ? true : 'fail', `script focus() on Continue during load landed on ${fForced.tag} "${fForced.label}"; Enter -> open=${s0.open} overflow="${s0.bodyOverflow}"`)
    await page.waitForFunction(() => window.__worldReady === true, { timeout: 300000, polling: 200 })
    await page.waitForFunction(() => { const l = document.querySelector('[class*="__loading"]'); return !l || getComputedStyle(l).visibility === 'hidden' || Number(getComputedStyle(l).opacity) === 0 }, { timeout: 120000, polling: 200 }).catch(() => null)
    await sleep(800)
    const s1 = await state(page)
    await shot(page, `${S}-02-after-ready.png`)
    const post = await page.evaluate(() => ({
      next: !!document.querySelector('section[aria-label="Next lesson"]')?.inert,
      markers: !!document.querySelector('[class*="__markers"]')?.inert,
      dock: !!document.querySelector('nav[aria-label="Areas"]')?.inert,
      footer: !!document.querySelector('footer')?.inert,
    }))
    check(S, 'load.nothingOpenedAfterReady', !s1.open && s1.bodyOverflow !== 'hidden' ? true : 'fail', `after ready: open=${s1.open} parked=${s1.parkedId} overflow="${s1.bodyOverflow}"`)
    check(S, 'load.chromeLiveAfterReady', !post.next && !post.markers && !post.dock && !post.footer ? true : 'fail', `inert after ready: next=${post.next} markers=${post.markers} dock=${post.dock} footer=${post.footer}`)
    // Keyboard works once ready: Tab to Continue, Enter parks a3.
    await page.evaluate(() => document.activeElement?.blur())
    const toCont = await tabUntil(page, (x) => /^Continue/.test(x.label || ''), 10)
    await page.keyboard.press('Enter')
    const parkedOk = await page.waitForFunction(() => window.__worldFrame && window.__worldFrame.parkedId === 'a3' && window.__worldFrame.parkProgress === 1, { timeout: 600000, polling: 200 }).then(() => true).catch(() => false)
    await sleep(500)
    const s1b = await state(page)
    await shot(page, `${S}-03-continue-after-ready.png`)
    check(S, 'load.continueAfterReady', !!toCont.found && parkedOk && s1b.open && parseFloat(s1b.panelOpacity) === 1 ? true : 'fail', `Tab reached Continue=${!!toCont.found} (${toCont.seq.length} Tabs: ${toCont.seq.map((x) => (x.label || x.tag).slice(0, 18)).join(' > ')}); Enter -> parked=${s1b.parkedId} p=${s1b.parkProgress} panel opacity ${s1b.panelOpacity}`)
    await page.keyboard.press('Escape')
    await waitClosed(page)
    const s2 = await state(page)
    check(S, 'load.closeAfter', !s2.open && s2.bodyOverflow === '' && s2.scrollY === 0, `closed: overflow "${s2.bodyOverflow}", scrollY ${s2.scrollY}, depth ${s2.depth}`)
  } finally {
    await page.close()
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

function launch() {
  return puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    protocolTimeout: 900000,
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
  })
}
browser = await launch()
await labPage()
const names = ONLY || Object.keys(scenarios)
let failed = false
try {
  for (const n of names) {
    if (!scenarios[n]) { log(`unknown scenario ${n}`); continue }
    log(`── ${n}`)
    const t = Date.now()
    try {
      await scenarios[n]()
    } catch (e) {
      failed = true
      result(n).fatal = String(e && e.stack ? e.stack : e)
      log(`[${n}] FATAL ${result(n).fatal}`)
    }
    const r = result(n)
    r.wallMs = Date.now() - t
    const errs = r.logs.flatMap((l) => l.errors.map((e) => `${l.tag}: ${e}`))
    const api = r.logs.flatMap((l) => l.api.map((e) => `${l.tag}: ${e}`))
    r.consoleErrors = errs
    r.apiRequests = api
    r.warnings = r.logs.flatMap((l) => l.warnings.map((e) => `${l.tag}: ${e}`))
    log(`[${n}] done in ${r.wallMs} ms; console errors ${errs.length}; /api requests ${api.length}`)
    save(n)
  }
} finally {
  await browser.close()
}
process.exit(failed ? 1 : 0)
