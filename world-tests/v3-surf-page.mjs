/**
 * Surfaces proof on the REAL page: /dev/world-v3 with every module installed.
 *
 *   node world-tests/v3-surf-page.mjs [--vp 960x600] [--stops default,a3,a5] [--tag name] [--hide-ui]
 *
 * Settles the rail on each stop, screenshots, measures (luma percentiles,
 * foreground p5, land hue IQR, violet share) and prints the camera, draw calls,
 * triangles and the module install report the scene keeps (moduleStats).
 * The console line "[world-v3] modules" is echoed so a surfaces install
 * failure cannot pass silently. PNGs land in world-tests/shots/v3/surfaces/.
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.BASE_URL || 'http://localhost:3111'
const OUT = path.join(HERE, 'shots', 'v3', 'surfaces')
fs.mkdirSync(OUT, { recursive: true })
const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d)
const TAG = arg('--tag', 'page')
const [W, H] = arg('--vp', '960x600').split('x').map(Number)
const STOPS = arg('--stops', 'default,a3,a5').split(',')
const HIDE_UI = process.argv.includes('--hide-ui')
const DEPTH = { default: 0, a1: 0.0708, a2: 0.1934, a3: 0.3, a4: 0.4151, a5: 0.5236, a6: 0.6321, a7: 0.6863, a8: 0.8302 }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

function installGate() {
  const real = window.requestAnimationFrame.bind(window)
  const cancelReal = window.cancelAnimationFrame.bind(window)
  const live = new Map()
  let nextId = 1
  const G = { frames: 0, frameT: -1 }
  window.__gate = G
  window.requestAnimationFrame = function (cb) {
    const id = nextId++
    const run = (t) => {
      if (!live.has(id)) return
      live.delete(id)
      if (t !== G.frameT) { G.frameT = t; G.frames++ }
      cb(t)
    }
    live.set(id, real(run))
    return id
  }
  window.cancelAnimationFrame = function (id) { const r = live.get(id); if (r !== undefined) { cancelReal(r); live.delete(id) } }
}

async function settle(page, d) {
  await page.evaluate((x) => window.scrollTo(0, Math.round(window.__worldScrollFor(x))), d)
  await page.waitForFunction(() => {
    const f = window.__worldFrame
    if (!f || !window.__worldScrollFor) return false
    const max = window.__worldScrollFor(0.88)
    const target = max > 0 ? Math.min(1, window.scrollY / max) * 0.88 : 0
    return f.parkProgress === 0 && Math.abs(f.depth - target) < 1e-6
  }, { polling: 200, timeout: 600000 })
  const n0 = await page.evaluate(() => window.__gate.frames)
  await page.waitForFunction((k) => window.__gate.frames >= k, { polling: 100, timeout: 600000 }, n0 + 3)
  await sleep(300)
}

/** Measured from the screenshot PNG: the WebGL canvas has no preserved buffer to read back. */
async function measure(page, file) {
  const b64 = fs.readFileSync(file).toString('base64')
  return page.evaluate(async (src) => {
    const img = new Image(); img.src = src; await img.decode()
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
    const g = c.getContext('2d'); g.drawImage(img, 0, 0)
    const d = g.getImageData(0, 0, c.width, c.height).data
    const lum = [], fg = [], hues = []; let violet = 0, n = 0
    for (let y = 0; y < c.height; y += 2) for (let x = 0; x < c.width; x += 2) {
      const i = (y * c.width + x) * 4, r = d[i], gg = d[i + 1], b = d[i + 2]
      const L = 0.2126 * r + 0.7152 * gg + 0.0722 * b; lum.push(L); n++
      if (y > c.height * 0.6) fg.push(L)
      const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b)
      if (mx - mn > 12) {
        let h; if (mx === r) h = ((gg - b) / (mx - mn)) % 6; else if (mx === gg) h = (b - r) / (mx - mn) + 2; else h = (r - gg) / (mx - mn) + 4
        h = (h * 60 + 360) % 360
        if (y > c.height * 0.3) hues.push(h)
        if (h > 235 && h < 320) violet++
      }
    }
    lum.sort((a, b) => a - b); fg.sort((a, b) => a - b)
    const p = (a, q) => Math.round(a[Math.floor(q * (a.length - 1))])
    let sx = 0, sy = 0; for (const h of hues) { sx += Math.cos(h * Math.PI / 180); sy += Math.sin(h * Math.PI / 180) }
    const mean = Math.atan2(sy, sx) * 180 / Math.PI
    const dev = hues.map((h) => ((h - mean + 540) % 360) - 180).sort((a, b) => a - b)
    const iqr = dev.length ? dev[Math.floor(dev.length * 0.75)] - dev[Math.floor(dev.length * 0.25)] : 0
    return { p5: p(lum, .05), p50: p(lum, .5), p95: p(lum, .95), fgP5: p(fg, .05), hueIQR: Math.round(iqr), hue: Math.round((mean + 360) % 360), violet: +(violet / n).toFixed(3) }
  }, `data:image/png;base64,${b64}`)
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
})
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(900000)
  const logs = []
  page.on('console', async (m) => {
    let t = m.text()
    if (/GPU stall|GL Driver Message|swiftshader|Automatic fallback/i.test(t)) return
    if (/JSHandle|Object/.test(t)) {
      try { t = (await Promise.all(m.args().map((a) => a.jsonValue()))).map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join(' ') } catch {}
    }
    if (m.type() === 'error' || m.type() === 'warn' || /\[world-v3\]|surfaces/.test(t)) logs.push(`${m.type()}: ${t.slice(0, 600)}`)
  })
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`))
  await page.evaluateOnNewDocument(installGate)
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 })
  const t0 = Date.now()
  await page.goto(`${BASE}/dev/world-v3`, { waitUntil: 'domcontentloaded', timeout: 300000 })
  await page.waitForFunction(() => (window.__worldReady === true && typeof window.__worldScrollFor === 'function') || typeof window.__worldError === 'string', { timeout: 600000, polling: 250 })
  log(`ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`, await page.evaluate(() => window.__worldError || 'ok'))
  await page.evaluate(() => document.fonts.ready)
  if (HIDE_UI) {
    await page.addStyleTag({ content: 'body *:not(canvas){visibility:hidden !important} canvas{visibility:visible !important}' })
  }
  for (const id of STOPS) {
    await settle(page, DEPTH[id])
    const file = path.join(OUT, `${TAG}-${id}-${W}x${H}.png`)
    await page.screenshot({ path: file })
    const cam = await page.evaluate(() => window.__worldCamera?.())
    const fr = await page.evaluate(() => { const f = window.__worldFrame; return f ? { calls: f.calls, tris: f.triangles } : null })
    const m = await measure(page, file)
    const pitch = cam ? (Math.asin(-cam.dy) * 180) / Math.PI : NaN
    log(`[${id}]`, path.relative(HERE, file), JSON.stringify({ pitch: +pitch.toFixed(2), ...fr, ...m }))
  }
  log('logs:\n  ' + logs.slice(0, 25).join('\n  '))
} finally {
  await browser.close()
}
