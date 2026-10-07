/**
 * Judge render, part 2: every place's ARRIVED frame, Astra vs v2, on split
 * 1691x1278. Clicking a place is what Lovro praised in Astra ("super smooth and
 * nice"), so all 8 arrivals are compared, not only a3.
 *
 *   node world-tests/v2-judge-arrivals.mjs
 *
 * Astra: click #codex-area-<i>, run 70 frames of its 6/s damping (3.5 s scene,
 * residual e^-21), shoot, Escape. v2: __worldPark(id), wait parkProgress 1, shoot,
 * __worldPark(null). Both are scrolled to the place's own stop first, the way a
 * student would arrive at it.
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
const VPW = { width: 1691, height: 1278 }
const IDS = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8']
const STUDY = [0.0708, 0.1934, 0.30, 0.4151, 0.5236, 0.6321, 0.6863, 0.8302]
const ASTRA = [0, 0.14, 0.27, 0.41, 0.55, 0.69, 0.83, 1]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

function installGate() {
  const real = window.requestAnimationFrame.bind(window)
  let frames = 0
  let last = -1
  window.__frames = () => frames
  window.requestAnimationFrame = (cb) => real((t) => { if (t !== last) { last = t; frames++ } cb(t) })
}
async function open(browser, route) {
  const page = await browser.newPage()
  page.setDefaultTimeout(900000)
  await page.evaluateOnNewDocument(installGate)
  await page.setViewport({ ...VPW, deviceScaleFactor: 1 })
  await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 180000 })
  return page
}
const waitFrames = async (page, n) => { const n0 = await page.evaluate(() => window.__frames()); await page.waitForFunction((k) => window.__frames() >= k, { polling: 200 }, n0 + n) }

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, protocolTimeout: 900000,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
})
try {
  if (!process.argv.includes('--sheets-only')) {
    // Astra (skipped when its 8 arrivals are already on disk)
    let page = null
    if (!IDS.every((id) => fs.existsSync(path.join(RAW, `astra-split-${id}-arrived.png`)))) {
    page = await open(browser, '/dev/world-codex')
    await page.waitForSelector('main[data-ready="true"]', { timeout: 300000 })
    for (let i = 0; i < 8; i++) {
      await page.evaluate((f) => window.scrollTo(0, Math.round(f * (document.documentElement.scrollHeight - innerHeight))), ASTRA[i])
      await waitFrames(page, 50)
      await page.evaluate((k) => document.getElementById(`codex-area-${k}`).click(), i)
      await waitFrames(page, 70)
      await sleep(300)
      await page.screenshot({ path: path.join(RAW, `astra-split-${IDS[i]}-arrived.png`) })
      log(`astra ${IDS[i]} arrived`)
      await page.keyboard.press('Escape')
      await waitFrames(page, 50)
    }
    await page.close()
    }
    // v2
    page = await open(browser, '/dev/world-v2')
    await page.waitForFunction(() => window.__worldReady === true, { timeout: 300000, polling: 250 })
    for (let i = 0; i < 8; i++) {
      await page.evaluate((d) => window.scrollTo(0, Math.round(window.__worldScrollFor(d))), STUDY[i])
      // v2 stops requesting frames once settled, so wait on the settle itself, not a frame count.
      await page.waitForFunction(() => {
        const f = window.__worldFrame
        if (!f) return false
        const max = window.__worldScrollFor(0.88)
        const target = max > 0 ? Math.min(1, window.scrollY / max) * 0.88 : 0
        return f.parkProgress === 0 && Math.abs(f.depth - target) < 1e-9
      }, { polling: 200 })
      await sleep(400)
      await page.evaluate((id) => window.__worldPark(id), IDS[i])
      await page.waitForFunction(() => window.__worldFrame.parkProgress === 1, { polling: 100 })
      await sleep(800)
      await page.screenshot({ path: path.join(RAW, `v2-split-${IDS[i]}-arrived.png`) })
      log(`v2 ${IDS[i]} arrived`)
      await page.evaluate(() => window.__worldPark(null))
      await page.waitForFunction(() => !document.querySelector('main[data-open]') && window.__worldFrame.parkProgress === 0, { polling: 200 })
      await sleep(300)
    }
    await page.close()
  }
  // sheet: 8 rows x (Astra | v2)
  const cells = IDS.flatMap((id) => [
    { f: `astra-split-${id}-arrived.png`, c: `ASTRA ${id} arrived` },
    { f: `v2-split-${id}-arrived.png`, c: `V2 ${id} arrived` },
  ])
  for (const [name, part] of [['judge-arrivals-a1-a4-split.png', cells.slice(0, 8)], ['judge-arrivals-a5-a8-split.png', cells.slice(8)]]) {
    const page = await browser.newPage()
    const srcs = part.map((x) => 'data:image/png;base64,' + fs.readFileSync(path.join(RAW, x.f)).toString('base64'))
    await page.setContent('<html><body style="margin:0"></body></html>')
    const url = await page.evaluate(async (srcs, caps) => {
      const imgs = await Promise.all(srcs.map((s) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = s })))
      const sc = 0.45
      const cw = Math.round(imgs[0].width * sc)
      const ch = Math.round(imgs[0].height * sc)
      const cap = 32
      const c = document.createElement('canvas')
      c.width = cw * 2 + 6
      c.height = (ch + cap) * Math.ceil(imgs.length / 2)
      const g = c.getContext('2d')
      g.fillStyle = '#111'
      g.fillRect(0, 0, c.width, c.height)
      imgs.forEach((img, k) => {
        const x = (k % 2) * (cw + 6)
        const y = Math.floor(k / 2) * (ch + cap)
        g.fillStyle = '#ffd24a'
        g.font = 'bold 20px monospace'
        g.fillText(caps[k], x + 10, y + 23)
        g.drawImage(img, x, y + cap, cw, ch)
      })
      return c.toDataURL('image/png')
    }, srcs, part.map((x) => x.c))
    fs.writeFileSync(path.join(SHEETS, name), Buffer.from(url.split(',')[1], 'base64'))
    await page.close()
    log(`sheet ${name}`)
  }
} finally {
  await browser.close()
}
