/**
 * Scene-role checks for /dev/world-v3: a handful of stills and the loop's
 * idle behaviour. Small by default (960x600): SwiftShader draws ~0.6 s a frame.
 *
 *   node world-tests/v3-scene-shots.mjs [--vp small|split|ultra|laptop] [--query pitch=low]
 *        [--stops 0,a1,a3] [--parks a3,a7] [--idle] [--tag name]
 *
 * Stills run with prefers-reduced-motion, so the rail glide and the park
 * flight land in one frame (the scene's own reduced-motion path) and each
 * still costs a couple of frames instead of ~30. --idle runs WITHOUT reduced
 * motion and counts frames drawn while nothing scrolls or flies.
 *
 * PNGs + a JSON of camera, park solve, triangles, draw calls and module
 * stats go to world-tests/shots/v3/scene/.
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.BASE_URL || 'http://localhost:3111'
const OUT = path.join(HERE, 'shots', 'v3', 'scene')
fs.mkdirSync(OUT, { recursive: true })

const VPS = { small: [960, 600], split: [1691, 1278], ultra: [3428, 1230], laptop: [1440, 900] }
const STOPS = { a1: 0.0708, a2: 0.1934, a3: 0.30, a4: 0.4151, a5: 0.5236, a6: 0.6321, a7: 0.6863, a8: 0.8302 }
const args = process.argv.slice(2)
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d)
const vpName = arg('--vp', 'small')
const [W, H] = VPS[vpName]
const query = arg('--query', '')
const tag = arg('--tag', query ? query.replace(/[^a-z0-9]+/gi, '-') : 'v3')
const stops = arg('--stops', '0,a1,a3,a8').split(',').filter(Boolean)
const parks = arg('--parks', '').split(',').filter(Boolean)
const idle = args.includes('--idle')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
})
const report = { vp: vpName, query, stills: [], parks: [], errors: [] }
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(600000)
  page.on('console', (m) => {
    const t = m.text()
    if (/GPU stall|GL Driver Message|WebGL-|swiftshader|Automatic fallback/i.test(t)) return
    if (m.type() === 'error' || m.type() === 'warn' || /\[world-v3\]/.test(t)) report.errors.push(`${m.type()}: ${t}`.slice(0, 400))
  })
  page.on('pageerror', (e) => report.errors.push(`[pageerror] ${e.message}`))
  if (!idle) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 })
  const t0 = Date.now()
  await page.goto(`${BASE}/dev/world-v3${query ? '?' + query : ''}`, { waitUntil: 'domcontentloaded', timeout: 300000 })
  await page.waitForFunction(() => window.__worldReady === true || typeof window.__worldError === 'string', { polling: 250 })
  const err = await page.evaluate(() => window.__worldError)
  if (err) throw new Error('world error: ' + err)
  log(`ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`)
  report.modules = await page.evaluate(() => window.__worldV3Debug?.moduleStats?.() ?? null)
  log('modules', JSON.stringify(report.modules?.install))

  const settle = async (d) => {
    await page.evaluate((x) => window.scrollTo(0, Math.round(window.__worldScrollFor(x))), d)
    await page.waitForFunction(() => {
      const f = window.__worldFrame
      if (!f || !window.__worldScrollFor) return false
      const max = window.__worldScrollFor(0.88)
      const target = max > 0 ? Math.min(1, window.scrollY / max) * 0.88 : 0
      return f.parkProgress === 0 && Math.abs(f.depth - target) < 1e-9
    }, { polling: 200 })
    const n = await page.evaluate(() => window.__worldFrameCount)
    await page.waitForFunction((k) => window.__worldFrameCount >= k, { polling: 200 }, n + 1).catch(() => {})
    await sleep(300)
  }

  if (idle) {
    await settle(0)
    await sleep(2000)
    // A remount (dev StrictMode) swaps the scene under the hooks: wait for a live one.
    const live = () => page.waitForFunction(() => window.__worldReady === true && typeof window.__worldFrameCount === 'number' && window.__worldV3Debug, { polling: 200 })
    await live()
    const f0 = await page.evaluate(() => window.__worldFrameCount)
    const s0 = await page.evaluate(() => window.__worldV3Debug.sceneTime)
    await sleep(6000)
    await live()
    const f1 = await page.evaluate(() => window.__worldFrameCount)
    const s1 = await page.evaluate(() => window.__worldV3Debug.sceneTime)
    log('scene clock advanced', (s1 - s0).toFixed(2), 's over 6 s wall')
    report.idle = {
      framesIn6s: f1 - f0,
      animating: await page.evaluate(() => (window.__worldV3Debug?.modules ?? []).map((r) => [r.name, !!r.module.isAnimating?.()])),
    }
    // Hidden tab: the loop must stop.
    const cdp = await page.createCDPSession()
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false }).catch(() => {})
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await sleep(1500)
    const h0 = await page.evaluate(() => window.__worldFrameCount)
    await sleep(5000)
    const h1 = await page.evaluate(() => window.__worldFrameCount)
    report.idle.hiddenFramesIn5s = h1 - h0
    await page.evaluate(() => {
      delete document.hidden
      delete document.visibilityState
      document.dispatchEvent(new Event('visibilitychange'))
    })
    log('idle frames in 6 s:', f1 - f0, JSON.stringify(report.idle.animating), 'hidden frames in 5 s:', report.idle.hiddenFramesIn5s)
    // The 30 fps cap: SwiftShader is too slow to reach it with the world drawn,
    // so hide the heavy meshes (the animated ones stay) and count frames.
    await sleep(1500)
    await page.evaluate(() => { for (const p of ['Forest', 'Terrain', 'Ridge', 'T', 'R']) window.__worldHide(p) })
    await sleep(2000)
    const c0 = await page.evaluate(() => window.__worldFrameCount)
    const w0 = Date.now()
    await sleep(4000)
    const c1 = await page.evaluate(() => window.__worldFrameCount)
    report.idle.capFps = +((c1 - c0) / ((Date.now() - w0) / 1000)).toFixed(1)
    log('frames per second while only modules animate (heavy meshes hidden):', report.idle.capFps)
  }

  await page.evaluate(() => document.fonts.ready)
  for (const s of stops) {
    const d = s in STOPS ? STOPS[s] : Number(s)
    await settle(d)
    const name = `${tag}-${vpName}-stop-${s}.png`
    await page.screenshot({ path: path.join(OUT, name) })
    const f = await page.evaluate(() => ({ frame: window.__worldFrame, cam: window.__worldCamera() }))
    const pitch = (-Math.asin(f.cam.dy) * 180) / Math.PI
    report.stills.push({ name, depth: f.frame.depth, triangles: f.frame.triangles, calls: f.frame.calls, pitch: +pitch.toFixed(2), cam: [f.cam.x, f.cam.y, f.cam.z].map((v) => +v.toFixed(1)) })
    log(name, `pitch ${pitch.toFixed(2)}  tris ${f.frame.triangles}  calls ${f.frame.calls}`)
  }
  for (const id of parks) {
    await settle(STOPS[id])
    await page.evaluate((x) => window.__worldPark(x), id)
    await page.waitForFunction(() => {
      const f = window.__worldFrame
      return f && f.parkProgress === 1 && f.flight === 1
    }, { polling: 200 })
    const n = await page.evaluate(() => window.__worldFrameCount)
    await page.waitForFunction((k) => window.__worldFrameCount >= k, { polling: 200 }, n + 1).catch(() => {})
    await sleep(500)
    const name = `${tag}-${vpName}-park-${id}.png`
    await page.screenshot({ path: path.join(OUT, name) })
    const info = await page.evaluate(() => ({ park: { ...window.__worldParkInfo(), live: window.__worldV3Debug?.debugLowerThird?.() }, frame: window.__worldFrame }))
    report.parks.push({ name, id, ...info.park, triangles: info.frame.triangles, calls: info.frame.calls })
    log(name, JSON.stringify(info.park))
    await page.evaluate(() => window.__worldPark(null))
    await page.waitForFunction(() => window.__worldFrame && window.__worldFrame.parkProgress === 0 && window.__worldFrame.parkedId === null, { polling: 200 })
  }
} catch (e) {
  report.fatal = String(e)
  console.error(e)
} finally {
  await browser.close()
  fs.writeFileSync(path.join(OUT, `${tag}-${vpName}.json`), JSON.stringify(report, null, 2))
  if (report.errors.length) console.log('console:', report.errors.slice(0, 20).join('\n  '))
}
