/**
 * The eight landmarks in the REAL /dev/world-v3 scene, each parked (the
 * "zoom into the place" framing), composed into one contact sheet.
 *
 *   node world-tests/v3-lm-parks.mjs [--vp small|split|ultra] [--parks a1,a3] [--tag name] [--rail] [--compose]
 *
 * --compose skips the scene and rebuilds the sheet from the PNGs already on disk.
 * --sails runs WITHOUT reduced motion and checks the windmill: at the a2 stop
 * the sails must turn (~0.3 rad/s of scene time) and the landmarks module must
 * report isAnimating; at a8 (windmill behind the camera) it must not.
 *
 * Runs with prefers-reduced-motion so the park flight lands in one frame (the
 * scene's own reduced-motion path). --rail shoots the rail stops instead.
 * Writes world-tests/shots/v3/landmarks/<tag>-<vp>-sheet.png, the single
 * frames, and a JSON with park solves, triangles, draw calls and the
 * landmarks module's stats.
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.BASE_URL || 'http://localhost:3111'
const OUT = path.join(HERE, 'shots', 'v3', 'landmarks')
fs.mkdirSync(OUT, { recursive: true })

const VPS = { small: [960, 600], split: [1691, 1278], ultra: [3428, 1230] }
const STOPS = { a1: 0.0708, a2: 0.1934, a3: 0.30, a4: 0.4151, a5: 0.5236, a6: 0.6321, a7: 0.6863, a8: 0.8302 }
const NAMES = { a1: 'Lighthouse', a2: 'Windmill', a3: 'Bridge', a4: 'Viaduct', a5: 'Watchtower', a6: 'Cairn', a7: 'Jetty', a8: 'Obelisk' }
const args = process.argv.slice(2)
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d)
const vpName = arg('--vp', 'small')
const [W, H] = VPS[vpName]
const tag = arg('--tag', 'lm')
const rail = args.includes('--rail')
const ids = arg('--parks', Object.keys(STOPS).join(',')).split(',').filter(Boolean)
const composeOnly = args.includes('--compose')
const sailsCheck = args.includes('--sails')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
})
const report = { vp: vpName, rail, shots: [], errors: [] }
const shots = []
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(600000)
  if (composeOnly) {
    for (const id of ids) {
      const f = path.join(OUT, `${tag}-${vpName}-${rail ? 'rail' : 'park'}-${id}.png`)
      if (fs.existsSync(f)) shots.push({ id, b64: fs.readFileSync(f).toString('base64') })
    }
  } else {
  page.on('console', (m) => {
    const t = m.text()
    if (/GPU stall|GL Driver Message|WebGL-|swiftshader|Automatic fallback/i.test(t)) return
    if (m.type() === 'error' || m.type() === 'warn' || /\[world-v3\]/.test(t)) report.errors.push(`${m.type()}: ${t}`.slice(0, 400))
  })
  page.on('pageerror', (e) => report.errors.push(`[pageerror] ${e.message}`))
  if (!sailsCheck) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 })
  const t0 = Date.now()
  await page.goto(`${BASE}/dev/world-v3`, { waitUntil: 'domcontentloaded', timeout: 300000 })
  await page.waitForFunction(() => window.__worldReady === true || typeof window.__worldError === 'string', { polling: 250 })
  const err = await page.evaluate(() => window.__worldError)
  if (err) throw new Error('world error: ' + err)
  log(`ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`)
  report.modules = await page.evaluate(() => window.__worldV3Debug?.moduleStats?.() ?? null)
  report.landmarkNames = await page.evaluate(() => window.__worldNames?.() ?? null)
  log('modules', JSON.stringify(report.modules))
  await page.evaluate(() => document.fonts.ready)

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

  if (sailsCheck) {
    const probe = () => page.evaluate(() => {
      const sc = window.__worldV3Debug
      const s = sc?.scene?.getObjectByName('LM_WindmillSails')
      const lm = (sc?.modules ?? []).find((r) => r.name === 'landmarks')?.module
      return { rot: s ? s.rotation.z : null, frames: window.__worldFrameCount, t: sc?.sceneTime ?? null, animating: lm?.isAnimating?.() ?? null }
    })
    for (const id of ['a2', 'a8']) {
      await settle(STOPS[id])
      await sleep(1500)
      const a = await probe()
      await sleep(5000)
      const b = await probe()
      const row = { id, dRot: b.rot - a.rot, dSceneT: b.t - a.t, frames: b.frames - a.frames, animating: b.animating, radPerSceneSec: (b.rot - a.rot) / Math.max(1e-6, b.t - a.t) }
      report.sails = report.sails || []
      report.sails.push(row)
      log('sails', JSON.stringify(row))
      const buf = await page.screenshot({ type: 'png' })
      fs.writeFileSync(path.join(OUT, `${tag}-${vpName}-sails-${id}.png`), buf)
    }
    ids.length = 0
  }
  for (const id of ids) {
    await settle(STOPS[id])
    let info = {}
    if (!rail) {
      await page.evaluate((x) => window.__worldPark(x), id)
      await page.waitForFunction(() => {
        const f = window.__worldFrame
        return f && f.parkProgress === 1 && f.flight === 1
      }, { polling: 200 })
      const n = await page.evaluate(() => window.__worldFrameCount)
      await page.waitForFunction((k) => window.__worldFrameCount >= k, { polling: 200 }, n + 1).catch(() => {})
      await sleep(400)
      info = await page.evaluate(() => window.__worldParkInfo?.() ?? null)
    }
    const frame = await page.evaluate(() => ({ triangles: window.__worldFrame.triangles, calls: window.__worldFrame.calls }))
    // Marker label boxes on screen; any two that intersect are an overlap.
    const boxes = await page.evaluate(() => window.__worldLabelBoxes?.() ?? null)
    if (Array.isArray(boxes)) {
      const r = (b) => b.rect ?? b
      let overlaps = 0
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const A = r(boxes[i]), B = r(boxes[j])
        const ax0 = A.left ?? A.x, ay0 = A.top ?? A.y, ax1 = A.right ?? ax0 + A.width, ay1 = A.bottom ?? ay0 + A.height
        const bx0 = B.left ?? B.x, by0 = B.top ?? B.y, bx1 = B.right ?? bx0 + B.width, by1 = B.bottom ?? by0 + B.height
        if (ax0 < bx1 && bx0 < ax1 && ay0 < by1 && by0 < ay1) overlaps++
      }
      frame.labels = boxes.length
      frame.labelOverlaps = overlaps
    }
    const buf = await page.screenshot({ type: 'png' })
    const name = `${tag}-${vpName}-${rail ? 'rail' : 'park'}-${id}.png`
    fs.writeFileSync(path.join(OUT, name), buf)
    shots.push({ id, b64: Buffer.from(buf).toString('base64') })
    report.shots.push({ id, name, ...frame, park: info })
    log(name, JSON.stringify(frame), info ? JSON.stringify(info).slice(0, 200) : '')
    if (!rail) {
      await page.evaluate(() => window.__worldPark(null))
      await page.waitForFunction(() => window.__worldFrame && window.__worldFrame.parkProgress === 0 && window.__worldFrame.parkedId === null, { polling: 200 })
    }
  }
  }

  // Contact sheet: 4 across, each frame at half size, labelled.
  if (!shots.length) throw new Error('no shots for a sheet (fine for --sails)')
  const sheetPage = await browser.newPage()
  const cw = Math.round(W / 2)
  const ch = Math.round(H / 2)
  const png = await sheetPage.evaluate(async (list, cw, ch, names) => {
    const cols = Math.min(4, list.length)
    const rows = Math.ceil(list.length / cols)
    const c = document.createElement('canvas')
    c.width = cw * cols
    c.height = ch * rows
    const g = c.getContext('2d')
    for (let i = 0; i < list.length; i++) {
      const img = new Image()
      img.src = 'data:image/png;base64,' + list[i].b64
      await img.decode()
      const x = (i % cols) * cw
      const y = Math.floor(i / cols) * ch
      g.drawImage(img, x, y, cw, ch)
      g.fillStyle = 'rgba(0,0,0,.6)'
      g.fillRect(x, y, 170, 22)
      g.fillStyle = '#fff'
      g.font = '14px monospace'
      g.fillText(list[i].id + ' ' + names[list[i].id], x + 6, y + 16)
    }
    return c.toDataURL('image/png')
  }, shots, cw, ch, NAMES)
  const sheet = path.join(OUT, `${tag}-${vpName}-${rail ? 'rail' : 'park'}-sheet.png`)
  fs.writeFileSync(sheet, Buffer.from(png.split(',')[1], 'base64'))
  log('wrote', sheet)
} catch (e) {
  report.fatal = String(e)
  console.error(e)
} finally {
  await browser.close()
  if (!composeOnly) fs.writeFileSync(path.join(OUT, `${tag}-${vpName}-${sailsCheck ? 'sails' : rail ? 'rail' : 'park'}.json`), JSON.stringify(report, null, 2))
  if (report.errors.length) console.log('console:', report.errors.slice(0, 20).join('\n  '))
}
