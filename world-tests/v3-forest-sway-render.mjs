/**
 * Wind sway proof for forest.ts: park at a2, hide everything else that moves
 * (Life*: birds, clouds, smoke, fireflies; River), take two frames ~2 s of
 * scene time apart and count changed pixels in a region that holds only trees
 * and grass. Then hide the forest's trees and repeat: the count should drop to ~0.
 *
 *   node world-tests/v3-forest-sway-render.mjs
 *
 * (The rest of this header is v3-forest-shots.mjs's.)
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


async function diff(browser, a, b, box) {
  const page = await browser.newPage()
  try {
    const A = 'data:image/png;base64,' + fs.readFileSync(a).toString('base64')
    const B = 'data:image/png;base64,' + fs.readFileSync(b).toString('base64')
    return await page.evaluate(async (A, B, box) => {
      const load = async (s) => { const i = new Image(); i.src = s; await i.decode(); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const g = c.getContext('2d'); g.drawImage(i, 0, 0); return g.getImageData(box.x, box.y, box.w, box.h).data }
      const da = await load(A), db = await load(B)
      let changed = 0, n = 0, max = 0
      for (let i = 0; i < da.length; i += 4) {
        const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]))
        if (d > 6) changed++
        if (d > max) max = d
        n++
      }
      return { changed, of: n, maxDelta: max }
    }, A, B, box)
  } finally { await page.close() }
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
})
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(900000)
  await page.evaluateOnNewDocument(installGate)
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 })
  await page.goto(`${BASE}${ROUTE}${QUERY}`, { waitUntil: 'domcontentloaded', timeout: 300000 })
  await page.waitForFunction(() => window.__worldReady === true && window.__worldFrame && window.__worldFrame.calls > 0, { timeout: 600000, polling: 250 })
  await settle(page, DEPTH.a2)
  await page.evaluate(() => window.__worldPark('a2'))
  await page.waitForFunction(() => window.__worldFrame && window.__worldFrame.parkProgress >= 1, { polling: 200, timeout: 600000 })
  const hid = await page.evaluate(() => ['Life', 'River'].map((p) => window.__worldHide(p)))
  log('hid Life*, River*:', hid)
  // Trees and grass only, below the river and right of the panel (see r3-960x600-park-a2.png).
  const box = { x: 440, y: 440, w: 200, h: 150 }
  const shotPair = async (tag) => {
    await sleep(1200)
    const f0 = await page.evaluate(() => window.__gate.frames)
    const a = path.join(OUT, `sway-${tag}-a.png`)
    await page.screenshot({ path: a })
    await page.waitForFunction((f) => window.__gate.frames >= f + 4, { polling: 100, timeout: 120000 }, f0 + 1)
    const b = path.join(OUT, `sway-${tag}-b.png`)
    await page.screenshot({ path: b })
    const frames = (await page.evaluate(() => window.__gate.frames)) - f0
    const d = await diff(browser, a, b, box)
    log(`[${tag}]`, JSON.stringify({ framesBetween: frames, ...d }))
    return d
  }
  await shotPair('trees')
  const hidTrees = await page.evaluate(() => window.__worldHide('Forest:conifer') + window.__worldHide('Forest:broadleaf'))
  log('hid tree meshes:', hidTrees)
  await shotPair('no-trees')
} finally {
  await browser.close()
}
