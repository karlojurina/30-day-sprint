/**
 * Judge render: /dev/world (old), /dev/world-codex (Astra) and /dev/world-v2 at
 * the same moments, composed into side-by-side sheets.
 *
 *   node world-tests/v2-judge.mjs
 *
 * Moments, all at split 1691x1278 unless named:
 *   default view (depth 0)            split, ultra 3428x1230, laptop 1440x900
 *   4 area stops a1 a3 a5 a8          split
 *   park at a3, 0/300/700/1600 ms     split, SCENE clock (the v2-render frame gate)
 *
 * The old /dev/world page has no click-to-place: its markers are pointer-events
 * none and the dev page never calls setParked. In the app its AreaScreen parks
 * the camera at the area's own rail stop, which is no zoom. The park column for
 * the old build therefore repeats its a3 stop, captioned as such.
 *
 * Raw PNGs: world-tests/shots/v2-verify/judge/. Sheets: shots/v2-verify/judge-*.png.
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.BASE_URL || 'http://localhost:3111'
const SHEETS = path.join(HERE, 'shots', 'v2-verify')
const RAW = path.join(SHEETS, 'judge')
fs.mkdirSync(RAW, { recursive: true })

const VP = {
  split: { width: 1691, height: 1278 },
  ultra: { width: 3428, height: 1230 },
  laptop: { width: 1440, height: 900 },
}
const STUDY = { a1: 0.0708, a3: 0.30, a5: 0.5236, a8: 0.8302 }
// Astra's LANDMARKS[i].depth, which IS its scroll fraction.
const ASTRA = { a1: [0.0, 0], a3: [0.27, 2], a5: [0.55, 4], a8: [1.0, 7] }
const STOPS = ['a1', 'a3', 'a5', 'a8']
const SHOT_MS = [0, 300, 700, 1600]
const ONLY = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : null
const SHEETS_ONLY = process.argv.includes('--sheets-only')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const pad = (ms) => String(ms).padStart(4, '0')

/** Same gate as v2-render.mjs: a scene clock (dt clamped 0.05) and frame holds. */
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

async function openPage(browser, vp, route) {
  const page = await browser.newPage()
  page.setDefaultTimeout(900000)
  const errors = []
  page.on('console', (m) => {
    const t = m.text()
    if (/GPU stall|GL Driver Message|WebGL-|swiftshader|Automatic fallback/i.test(t)) return
    if (m.type() === 'error') errors.push(t)
  })
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))
  await page.evaluateOnNewDocument(installGate)
  await page.setViewport({ ...VP[vp], deviceScaleFactor: 1 })
  await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 180000 })
  return { page, errors }
}
const shot = (page, name) => page.screenshot({ path: path.join(RAW, name) })
const frames = (page) => page.evaluate(() => window.__gate.frames)
const waitFrames = async (page, n) => { const n0 = await frames(page); await page.waitForFunction((k) => window.__gate.frames >= k, { polling: 200 }, n0 + n) }

// ── old ──
async function oldSettle(page, d) {
  await page.evaluate((x) => window.scrollTo(0, Math.round(window.__worldScrollFor(x))), d)
  await page.waitForFunction((x) => Math.abs((window.__worldDepth ?? -1) - x) < 3e-4, { polling: 200 }, d)
  await waitFrames(page, 8)
  await sleep(300)
}
async function runOld(browser, vpName, withStops) {
  const { page, errors } = await openPage(browser, vpName, '/dev/world')
  try {
    await page.waitForFunction(() => window.__worldReady === true || typeof window.__worldError === 'string', { polling: 250 })
    await oldSettle(page, 0)
    await page.evaluate(() => document.fonts.ready)
    await sleep(1500)
    await shot(page, `old-${vpName}-default.png`)
    log(`[old ${vpName}] default`)
    if (withStops) for (const id of STOPS) { await oldSettle(page, STUDY[id]); await shot(page, `old-${vpName}-${id}.png`); log(`[old ${vpName}] ${id}`) }
  } finally { await page.close() }
  return errors
}

// ── Astra ──
async function astraSettle(page, frac) {
  await page.evaluate((f) => window.scrollTo(0, Math.round(f * (document.documentElement.scrollHeight - innerHeight))), frac)
  await page.waitForFunction((f) => {
    const d = Number(document.documentElement.dataset.codexDepth)
    return Number.isFinite(d) && Math.abs(d - f) <= 0.0015
  }, { polling: 200 }, frac)
  await waitFrames(page, 40)
  await sleep(300)
}
async function runAstra(browser, vpName, withStops) {
  const { page, errors } = await openPage(browser, vpName, '/dev/world-codex')
  try {
    await page.waitForSelector('main[data-ready="true"]', { timeout: 300000 })
    await astraSettle(page, 0)
    await page.evaluate(() => document.fonts.ready)
    await sleep(1500)
    await shot(page, `astra-${vpName}-default.png`)
    log(`[astra ${vpName}] default`)
    if (!withStops) return errors
    for (const id of STOPS) {
      const [frac, idx] = ASTRA[id]
      await astraSettle(page, frac)
      await shot(page, `astra-${vpName}-${id}.png`)
      log(`[astra ${vpName}] ${id}`)
      if (id !== 'a3') continue
      await page.evaluate(() => window.__gate.hold())
      await page.evaluate((i) => { window.__gate.start(performance.now()); document.getElementById(`codex-area-${i}`).click() }, idx)
      await sleep(500)
      for (const ms of SHOT_MS) {
        if (ms > 0) {
          await page.evaluate((s) => { window.__gate.holdAt = s; window.__gate.release() }, ms / 1000)
          await page.waitForFunction(() => window.__gate.held, { polling: 50 })
          await sleep(350)
        }
        const at = await page.evaluate(() => Math.round(window.__gate.clock * 1000))
        await shot(page, `astra-${vpName}-park-a3-${pad(ms)}.png`)
        log(`[astra ${vpName}] park ${ms} -> scene ${at} ms`)
      }
      await page.evaluate(() => { window.__gate.stop(); window.__gate.release() })
      await page.keyboard.press('Escape')
      await waitFrames(page, 50)
    }
  } finally { await page.close() }
  return errors
}

// ── v2 ──
async function v2Settle(page, d) {
  await page.evaluate((x) => window.scrollTo(0, Math.round(window.__worldScrollFor(x))), d)
  await page.waitForFunction(() => {
    const f = window.__worldFrame
    if (!f || !window.__worldScrollFor) return false
    const max = window.__worldScrollFor(0.88)
    const target = max > 0 ? Math.min(1, window.scrollY / max) * 0.88 : 0
    return f.parkProgress === 0 && Math.abs(f.depth - target) < 1e-9
  }, { polling: 200 })
  await sleep(400)
}
async function runV2(browser, vpName, withStops) {
  const { page, errors } = await openPage(browser, vpName, '/dev/world-v2')
  try {
    await page.waitForFunction(() => window.__worldReady === true || typeof window.__worldError === 'string', { timeout: 300000, polling: 250 })
    await v2Settle(page, 0)
    await page.evaluate(() => document.fonts.ready)
    await sleep(3000)
    await shot(page, `v2-${vpName}-default.png`)
    log(`[v2 ${vpName}] default`)
    if (!withStops) return errors
    for (const id of STOPS) {
      await v2Settle(page, STUDY[id])
      await shot(page, `v2-${vpName}-${id}.png`)
      log(`[v2 ${vpName}] ${id}`)
      if (id !== 'a3') continue
      await page.evaluate(() => window.__gate.hold())
      await page.evaluate(() => { window.__gate.start(performance.now()); window.__worldPark('a3') })
      await sleep(500)
      for (const ms of SHOT_MS) {
        if (ms > 0) {
          await page.evaluate((s) => { window.__gate.holdAt = s; window.__gate.release() }, ms / 1000)
          await page.waitForFunction(() => window.__gate.held || (window.__worldFrame && window.__worldFrame.parkProgress === 1), { polling: 50 })
          await sleep(350)
          await page.evaluate(() => window.__gate.hold())
        }
        const st = await page.evaluate(() => ({ at: Math.round(window.__gate.clock * 1000), p: window.__worldFrame.parkProgress }))
        await shot(page, `v2-${vpName}-park-a3-${pad(ms)}.png`)
        log(`[v2 ${vpName}] park ${ms} -> scene ${st.at} ms, p ${st.p.toFixed(3)}`)
      }
      await page.evaluate(() => { window.__gate.stop(); window.__gate.release() })
      await page.waitForFunction(() => window.__worldFrame.parkProgress === 1, { polling: 100 })
      await page.evaluate(() => window.__worldPark(null))
      await page.waitForFunction(() => !document.querySelector('main[data-open]') && window.__worldFrame.parkProgress === 0, { polling: 200 })
      await sleep(300)
    }
  } finally { await page.close() }
  return errors
}

// ── sheets ──
async function sheet(browser, cells, cols, scale, outName, title) {
  const present = cells.filter((c) => c && fs.existsSync(path.join(RAW, c.file)))
  const page = await browser.newPage()
  try {
    const srcs = present.map((c) => 'data:image/png;base64,' + fs.readFileSync(path.join(RAW, c.file)).toString('base64'))
    await page.setContent('<html><body style="margin:0;background:#111"></body></html>')
    const url = await page.evaluate(async (srcs, caps, cols, scale, title) => {
      const imgs = await Promise.all(srcs.map((s) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = s })))
      const cw = Math.round(Math.max(...imgs.map((i) => i.width)) * scale)
      const ch = Math.round(Math.max(...imgs.map((i) => i.height)) * scale)
      const cap = 34
      const head = 44
      const rows = Math.ceil(imgs.length / cols)
      const c = document.createElement('canvas')
      c.width = cw * cols + (cols - 1) * 6
      c.height = head + (ch + cap) * rows
      const g = c.getContext('2d')
      g.fillStyle = '#111'
      g.fillRect(0, 0, c.width, c.height)
      g.fillStyle = '#fff'
      g.font = 'bold 24px monospace'
      g.fillText(title, 12, 30)
      imgs.forEach((img, k) => {
        const x = (k % cols) * (cw + 6)
        const y = head + Math.floor(k / cols) * (ch + cap)
        g.fillStyle = '#ffd24a'
        g.font = 'bold 20px monospace'
        g.fillText(caps[k], x + 10, y + 24)
        g.drawImage(img, x, y + cap, img.width * scale, img.height * scale)
      })
      return c.toDataURL('image/png')
    }, srcs, present.map((c) => c.caption), cols, scale, title)
    fs.writeFileSync(path.join(SHEETS, outName), Buffer.from(url.split(',')[1], 'base64'))
    log(`sheet ${outName}`)
  } finally { await page.close() }
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  protocolTimeout: 900000,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
})
const errs = {}
try {
  if (!SHEETS_ONLY) {
    const jobs = [
      ['old', 'split', true], ['astra', 'split', true], ['v2', 'split', true],
      ['old', 'ultra', false], ['astra', 'ultra', false], ['v2', 'ultra', false],
      ['old', 'laptop', false], ['astra', 'laptop', false], ['v2', 'laptop', false],
    ].filter(([b]) => !ONLY || ONLY.includes(b))
      // Resume: skip a job whose last capture is already on disk.
      .filter(([b, vp, st]) => !fs.existsSync(path.join(RAW, st ? `${b}-${vp}-a8.png` : `${b}-${vp}-default.png`)))
    for (const [b, vp, st] of jobs) {
      const fn = b === 'old' ? runOld : b === 'astra' ? runAstra : runV2
      errs[`${b}-${vp}`] = await fn(browser, vp, st)
    }
    fs.writeFileSync(path.join(RAW, 'errors.json'), JSON.stringify(errs, null, 2))
  }
  const B = [['old', 'OLD /dev/world'], ['astra', 'ASTRA /dev/world-codex'], ['v2', 'V2 /dev/world-v2']]
  await sheet(browser, B.map(([b, n]) => ({ file: `${b}-split-default.png`, caption: `${n} - default` })), 3, 0.5, 'judge-default-split.png', 'Default view, split 1691x1278: old | Astra | v2')
  await sheet(browser, B.map(([b, n]) => ({ file: `${b}-ultra-default.png`, caption: `${n} - default, ultrawide` })), 1, 0.5, 'judge-default-ultra.png', 'Default view, ultrawide 3428x1230: old / Astra / v2')
  await sheet(browser, B.map(([b, n]) => ({ file: `${b}-laptop-default.png`, caption: `${n} - default, laptop` })), 3, 0.55, 'judge-default-laptop.png', 'Default view, laptop 1440x900: old | Astra | v2')
  const stopCells = []
  for (const id of STOPS) for (const [b, n] of B) stopCells.push({ file: `${b}-split-${id}.png`, caption: `${n} - ${id} stop` })
  await sheet(browser, stopCells, 3, 0.4, 'judge-stops-split.png', 'Area stops a1 / a3 / a5 / a8, split: old | Astra | v2')
  for (const id of STOPS) await sheet(browser, B.map(([b, n]) => ({ file: `${b}-split-${id}.png`, caption: `${n} - ${id} stop` })), 3, 0.5, `judge-stop-${id}-split.png`, `Area stop ${id}, split: old | Astra | v2`)
  const parkCells = []
  for (const ms of SHOT_MS) {
    parkCells.push({ file: 'old-split-a3.png', caption: `OLD - no click zoom (a3 stop)` })
    parkCells.push({ file: `astra-split-park-a3-${pad(ms)}.png`, caption: `ASTRA park a3 - ${ms} ms scene` })
    parkCells.push({ file: `v2-split-park-a3-${pad(ms)}.png`, caption: `V2 park a3 - ${ms} ms scene` })
  }
  await sheet(browser, parkCells, 3, 0.4, 'judge-park-a3-split.png', 'Park at a3 on the scene clock, split: old | Astra | v2')
  await sheet(browser, SHOT_MS.flatMap((ms) => [
    { file: `astra-split-park-a3-${pad(ms)}.png`, caption: `ASTRA ${ms} ms` },
    { file: `v2-split-park-a3-${pad(ms)}.png`, caption: `V2 ${ms} ms` },
  ]), 2, 0.5, 'judge-park-a3-astra-vs-v2.png', 'Park a3: Astra (left) vs v2 (right) at 0/300/700/1600 ms scene time')
} finally {
  await browser.close()
}
log('done', JSON.stringify(Object.fromEntries(Object.entries(errs).map(([k, v]) => [k, v.length]))))
