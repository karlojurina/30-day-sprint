/**
 * Re-verify probe: parked a3 on split -> 740 wide (list view) -> back to 1691,
 * then Escape. Records every frame of the fly-home (depth, parkProgress,
 * camera) so a detour toward the shore shows up even when the landing is right.
 *
 *   node world-tests/v2-reverify-breakpoint.mjs
 *
 * Writes shots/v2-verify/reverify/interaction/breakpoint-probe.json and PNGs.
 * Reads the app only through its test hooks and real input.
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, 'shots', 'v2-verify', 'reverify', 'interaction')
fs.mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function installGate() {
  const real = window.requestAnimationFrame.bind(window)
  const G = { rows: [], on: false, frameT: -1, clock: 0, lastT: 0, holdAt: Infinity, held: false, queue: [] }
  window.__gate = G
  window.requestAnimationFrame = function (cb) {
    const run = (t) => {
      if (G.held) { G.queue.push(run); return }
      if (t !== G.frameT) {
        G.frameT = t
        if (G.on) { G.clock += Math.min(0.05, Math.max(0, (t - G.lastT) / 1000)); G.lastT = t }
      }
      cb(t)
      if (G.on) {
        const f = window.__worldFrame
        const cam = window.__worldCamera ? window.__worldCamera() : null
        const row = { t, clock: G.clock, depth: f ? f.depth : null, p: f ? f.parkProgress : null, parked: f ? f.parkedId : null, flight: f ? f.flight : null, cam, scrollY: window.scrollY, open: !!document.querySelector('main[data-open]') }
        const last = G.rows[G.rows.length - 1]
        if (last && last.t === t) Object.assign(last, row); else G.rows.push(row)
        if (G.clock >= G.holdAt - 1e-9) { G.held = true; G.holdAt = Infinity }
      }
    }
    return real(run)
  }
  G.release = () => { G.held = false; const q = G.queue.splice(0); for (const r of q) real(r) }
}

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  protocolTimeout: 900000,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
})
const out = {}
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(900000)
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error' && !/GPU stall|GL Driver|WebGL-|swiftshader/i.test(m.text())) errors.push(m.text().slice(0, 200)) })
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message))
  await page.evaluateOnNewDocument(installGate)
  await page.setViewport({ width: 1691, height: 1278, deviceScaleFactor: 1 })
  await page.goto('http://localhost:3111/dev/world-v2', { waitUntil: 'domcontentloaded', timeout: 180000 })
  await page.bringToFront()
  await page.waitForFunction(() => window.__worldReady === true, { timeout: 300000, polling: 200 })
  await page.evaluate(() => document.querySelectorAll('nextjs-portal').forEach((e) => e.style.setProperty('display', 'none', 'important')))
  await page.evaluate(() => window.scrollTo(0, Math.round(window.__worldScrollFor(0.3))))
  await page.waitForFunction(() => { const f = window.__worldFrame; return f && f.parkProgress === 0 && Math.abs(f.depth - 0.3) < 1e-4 }, { timeout: 600000, polling: 200 })
  await sleep(300)
  const railCam03 = await page.evaluate(() => window.__worldCamera())
  out.before = await page.evaluate(() => ({ scrollY: scrollY, depth: window.__worldFrame.depth }))
  // Rail camera at the shore depth the old build detoured to, for reference.
  await page.evaluate(() => window.scrollTo(0, Math.round(window.__worldScrollFor(0.0778))))
  await page.waitForFunction(() => { const f = window.__worldFrame; return f && Math.abs(f.depth - 0.0778) < 1e-3 }, { timeout: 600000, polling: 200 })
  await sleep(300)
  const railCamShore = await page.evaluate(() => window.__worldCamera())
  await page.evaluate(() => window.scrollTo(0, Math.round(window.__worldScrollFor(0.3))))
  await page.waitForFunction(() => { const f = window.__worldFrame; return f && f.parkProgress === 0 && Math.abs(f.depth - 0.3) < 1e-4 }, { timeout: 600000, polling: 200 })
  await sleep(300)
  // Park a3 through its marker.
  const mc = await page.evaluate(() => { const b = document.querySelectorAll('[class*="__markers"] > button')[2]; const el = b.dataset.mode === 'text' ? b.querySelector('[class*="__label"]') : b.querySelector('[class*="__pin"]'); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })
  await page.mouse.click(mc.x, mc.y)
  await page.waitForFunction(() => window.__worldFrame && window.__worldFrame.parkedId === 'a3' && window.__worldFrame.parkProgress === 1, { timeout: 900000, polling: 200 })
  await sleep(300)
  const parkCam = await page.evaluate(() => window.__worldCamera())
  // To the list view and back.
  await page.setViewport({ width: 740, height: 1000, deviceScaleFactor: 1 })
  await sleep(1500)
  out.narrow = await page.evaluate(() => ({ view: document.querySelector('main')?.dataset.view, scrollY }))
  // Record from the moment the world comes back, not only from Escape.
  await page.evaluate(() => { window.__gate.rows = []; window.__gate.clock = 0; window.__gate.lastT = performance.now(); window.__gate.on = true })
  await page.setViewport({ width: 1691, height: 1278, deviceScaleFactor: 1 })
  await page.waitForFunction(() => window.__worldReady === true, { timeout: 300000, polling: 200 })
  await page.waitForFunction(() => window.__worldFrame && window.__worldFrame.parkedId === 'a3' && window.__worldFrame.parkProgress === 1, { timeout: 900000, polling: 200 })
  await sleep(800)
  const rebuildRows = await page.evaluate(() => window.__gate.rows.splice(0))
  await page.screenshot({ path: path.join(OUT, 'breakpoint-probe-01-reparked.png') })
  const reparkCam = await page.evaluate(() => window.__worldCamera())
  // Escape: record the fly-home, hold at 0.25 s scene time for a mid-flight frame.
  await page.evaluate(() => { window.__gate.clock = 0; window.__gate.lastT = performance.now(); window.__gate.holdAt = 0.25 })
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => window.__gate.held || (window.__worldFrame && window.__worldFrame.parkProgress === 0), { timeout: 900000, polling: 50 })
  await sleep(300)
  await page.screenshot({ path: path.join(OUT, 'breakpoint-probe-02-flyhome-250ms.png') })
  await page.evaluate(() => window.__gate.release())
  await page.waitForFunction(() => !document.querySelector('main[data-open]') && window.__worldFrame.parkProgress === 0, { timeout: 900000, polling: 150 })
  await page.waitForFunction(() => { const f = window.__worldFrame; return Math.abs(f.depth - 0.3) < 1e-4 }, { timeout: 900000, polling: 200 }).catch(() => null)
  await sleep(500)
  await page.screenshot({ path: path.join(OUT, 'breakpoint-probe-03-home.png') })
  const flyRows = await page.evaluate(() => window.__gate.rows.splice(0))
  out.after = await page.evaluate(() => ({ scrollY: scrollY, depth: window.__worldFrame.depth }))
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
  const summarize = (rows) => rows.map((r) => ({ clock: +r.clock.toFixed(3), depth: r.depth == null ? null : +r.depth.toFixed(4), p: r.p == null ? null : +r.p.toFixed(3), parked: r.parked, open: r.open, scrollY: r.scrollY, cam: r.cam ? { x: +r.cam.x.toFixed(1), y: +r.cam.y.toFixed(1), z: +r.cam.z.toFixed(1) } : null, toRail03: r.cam ? +dist(r.cam, railCam03).toFixed(1) : null, toShore: r.cam ? +dist(r.cam, railCamShore).toFixed(1) : null }))
  out.railCam03 = railCam03
  out.railCamShore = railCamShore
  out.parkCam = parkCam
  out.reparkCam = reparkCam
  out.reparkVsPark = +dist(parkCam, reparkCam).toFixed(3)
  out.rebuildRows = summarize(rebuildRows)
  out.flyRows = summarize(flyRows)
  const depths = [...rebuildRows, ...flyRows].filter((r) => r.depth != null)
  out.minDepthRebuild = Math.min(...rebuildRows.filter((r) => r.depth != null).map((r) => r.depth))
  out.minDepthFly = Math.min(...flyRows.filter((r) => r.depth != null).map((r) => r.depth))
  // Did the camera ever get nearer the shore rail pose than the 0.30 rail pose during the fly-home?
  out.flyNearerShore = flyRows.filter((r) => r.cam && dist(r.cam, railCamShore) < dist(r.cam, railCam03)).length
  out.flyFrames = flyRows.length
  out.errors = errors
  console.log(JSON.stringify({ before: out.before, after: out.after, reparkVsPark: out.reparkVsPark, minDepthRebuild: out.minDepthRebuild, minDepthFly: out.minDepthFly, flyNearerShore: out.flyNearerShore, flyFrames: out.flyFrames, errors }, null, 1))
  console.log('rebuild rows (first 8):', JSON.stringify(out.rebuildRows.slice(0, 8)))
  console.log('fly rows:', JSON.stringify(out.flyRows.map((r) => [r.clock, r.depth, r.p, r.toRail03, r.toShore])))
} finally {
  fs.writeFileSync(path.join(OUT, 'breakpoint-probe.json'), JSON.stringify(out, null, 2))
  await browser.close()
}
