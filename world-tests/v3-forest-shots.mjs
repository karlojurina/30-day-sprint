/**
 * Forest proof render for /dev/world-v3 (forest.ts): a handful of frames, small.
 *
 *   node world-tests/v3-forest-shots.mjs [--tag name] [--vp 960x600] [--stops a2,a3,a5] [--park a2]
 *
 * For each stop: settle the rail, screenshot, record calls/triangles and the
 * camera. Then __worldHide('Forest') and re-read calls/triangles at every stop,
 * so the difference is the forest module's own share of the frame. With
 * --park, also parks at that area (after the rail shots) and shoots it, to
 * see trees and cottages up close. PNGs land in world-tests/shots/v3/forest/.
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.BASE_URL || 'http://localhost:3111'
const OUT = path.join(HERE, 'shots', 'v3', 'forest')
fs.mkdirSync(OUT, { recursive: true })

const arg = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d)
const TAG = arg('--tag', 'run')
const [W, H] = arg('--vp', '960x600').split('x').map(Number)
const STOPS = arg('--stops', 'a2,a3,a5').split(',')
const PARK = arg('--park', '')
const QUERY = arg('--query', '')
const ROUTE = arg('--route', '/dev/world-v3')
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
    return f.parkProgress === 0 && Math.abs(f.depth - target) < 1e-9
  }, { polling: 200, timeout: 600000 })
  await sleep(500)
}

/** Luma percentiles and land hue spread, measured in a 2D canvas. */
async function measure(browser, file) {
  const page = await browser.newPage()
  try {
    const b64 = fs.readFileSync(file).toString('base64')
    return await page.evaluate(async (src) => {
      const img = new Image()
      img.src = src
      await img.decode()
      const c = document.createElement('canvas')
      c.width = img.width
      c.height = img.height
      const g = c.getContext('2d')
      g.drawImage(img, 0, 0)
      const d = g.getImageData(0, 0, c.width, c.height).data
      const lum = []
      const hues = []
      let violet = 0
      let n = 0
      const rows = []
      for (let y = 0; y < c.height; y += 2) {
        let rs = 0, gs = 0, bs = 0, k = 0
        for (let x = 0; x < c.width; x += 2) {
          const i = (y * c.width + x) * 4
          const r = d[i], gg = d[i + 1], b = d[i + 2]
          const L = 0.2126 * r + 0.7152 * gg + 0.0722 * b
          lum.push(L)
          rs += r; gs += gg; bs += b; k++
          n++
          const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b)
          if (mx - mn > 12) {
            let h
            if (mx === r) h = ((gg - b) / (mx - mn)) % 6
            else if (mx === gg) h = (b - r) / (mx - mn) + 2
            else h = (r - gg) / (mx - mn) + 4
            h = (h * 60 + 360) % 360
            if (y > c.height * 0.3) hues.push(h)
            if (h > 235 && h < 320) violet++
          }
        }
        rows.push([Math.round(rs / k), Math.round(gs / k), Math.round(bs / k)])
      }
      lum.sort((a, b) => a - b)
      const p = (q) => Math.round(lum[Math.floor(q * (lum.length - 1))])
      // Circular hue spread: IQR on the unwrapped hues around the mean.
      let sx = 0, sy = 0
      for (const h of hues) { sx += Math.cos((h * Math.PI) / 180); sy += Math.sin((h * Math.PI) / 180) }
      const mean = (Math.atan2(sy, sx) * 180) / Math.PI
      const dev = hues.map((h) => ((h - mean + 540) % 360) - 180).sort((a, b) => a - b)
      const iqr = dev.length ? dev[Math.floor(dev.length * 0.75)] - dev[Math.floor(dev.length * 0.25)] : 0
      const band = (f) => rows[Math.min(rows.length - 1, Math.floor(f * rows.length))]
      return {
        luma: { p5: p(0.05), p25: p(0.25), p50: p(0.5), p75: p(0.75), p95: p(0.95) },
        landHueMean: Math.round((mean + 360) % 360),
        landHueIQR: Math.round(iqr),
        violetShare: +(violet / n).toFixed(3),
        rows: { r02: band(0.02), r10: band(0.1), r20: band(0.2), r30: band(0.3), r50: band(0.5), r70: band(0.7), r90: band(0.9) },
      }
    }, `data:image/png;base64,${b64}`)
  } finally {
    await page.close()
  }
}


const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
})
const results = {}
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(900000)
  const errors = []
  page.on('console', async (m) => {
    let t = m.text()
    if (/GPU stall|GL Driver Message|WebGL-|swiftshader|Automatic fallback|Module not found|Import trace/i.test(t)) return
    if (/JSHandle/.test(t)) {
      try { t = (await Promise.all(m.args().map((a) => a.jsonValue()))).map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).join(' ') } catch {}
    }
    if (m.type() === 'error' || m.type() === 'warn' || /\[world-v3\]/.test(t)) errors.push(`${m.type()}: ${t.slice(0, 600)}`)
  })
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))
  await page.evaluateOnNewDocument(installGate)
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 })
  const t0 = Date.now()
  await page.goto(`${BASE}${ROUTE}${QUERY}`, { waitUntil: 'domcontentloaded', timeout: 300000 })
  await page.waitForFunction(() => (window.__worldReady === true && typeof window.__worldScrollFor === 'function') || typeof window.__worldError === 'string', { timeout: 600000, polling: 250 })
  log(`ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`, await page.evaluate(() => window.__worldError || 'ok'))
  await page.evaluate(() => document.fonts.ready)
  const frame = () => page.evaluate(() => { const f = window.__worldFrame; return f ? { calls: f.calls, triangles: f.triangles } : null })
  // Sibling modules are being edited while this runs; an HMR remount resets the
  // scene, so wait for the world to be ready AND drawing before every capture.
  const drawing = () => page.waitForFunction(() => window.__worldReady === true && window.__worldFrame && window.__worldFrame.calls > 0, { polling: 250, timeout: 600000 })
  for (const id of STOPS) {
    await page.waitForFunction(() => window.__worldReady === true && typeof window.__worldScrollFor === 'function', { polling: 250, timeout: 600000 })
    await settle(page, DEPTH[id])
    await drawing()
    if (id === STOPS[0]) await sleep(1500)
    const file = path.join(OUT, `${TAG}-${W}x${H}-${id}.png`)
    await page.screenshot({ path: file })
    const cam = await page.evaluate(() => window.__worldCamera?.())
    const fr = await frame()
    const m = await measure(browser, file)
    results[id] = { file, cam, frame: fr, luma: m.luma }
    log(`[${id}]`, path.relative(HERE, file), JSON.stringify({ cam: cam && [cam.x, cam.y, cam.z].map((v) => Math.round(v)), ...fr, ...m.luma }))
  }
  if (PARK) {
    await page.evaluate((id) => window.__worldPark(id), PARK)
    await page.waitForFunction(() => window.__worldFrame && window.__worldFrame.parkProgress >= 1, { polling: 200, timeout: 600000 })
    await sleep(800)
    const file = path.join(OUT, `${TAG}-${W}x${H}-park-${PARK}.png`)
    await page.screenshot({ path: file })
    const fr = await frame()
    results['park-' + PARK] = { file, frame: fr }
    log(`[park ${PARK}]`, path.relative(HERE, file), JSON.stringify(fr))
    await page.evaluate(() => window.__worldPark(null))
    await page.waitForFunction(() => window.__worldFrame && window.__worldFrame.parkProgress === 0, { polling: 200, timeout: 600000 })
  }
  const hidden = await page.evaluate(() => window.__worldHide('Forest'))
  log('hid', hidden, 'Forest objects')
  for (const id of STOPS) {
    await settle(page, DEPTH[id])
    await sleep(800)
    const fr = await frame()
    const w = results[id].frame
    results[id].withoutForest = fr
    results[id].forest = w && fr ? { calls: w.calls - fr.calls, triangles: w.triangles - fr.triangles } : null
    log(`[${id}] forest share`, JSON.stringify(results[id].forest), 'rest', JSON.stringify(fr))
  }
  if (errors.length) log('console:', errors.slice(0, 20).join('\n  '))
  fs.writeFileSync(path.join(OUT, `${TAG}-${W}x${H}.json`), JSON.stringify(results, null, 2))
} finally {
  await browser.close()
}
