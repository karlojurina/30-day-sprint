// Close-ups aimed at an OBJECT (not a fixed world point), so they follow the
// asset when the generator moves it. Temporary camera, restored in the same
// task. Also prints each object's box and the lowest mesh ground under it.
//
//   node world-tests/v2-journey-closeups2.mjs
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = process.env.OUT_DIR || path.join(HERE, 'shots', 'v2-verify', 'reverify', 'journey')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.BASE_URL || 'http://localhost:3111'
fs.mkdirSync(OUT, { recursive: true })

// [file tag, object name, azimuth deg (0 = from +z, 90 = from +x), distance, camera height above the object's base, look height above base]
const VIEWS = [
  ['house5-az0', 'House4000005', 0, 45, 6, 6],
  ['house5-az90', 'House4000005', 90, 45, 6, 6],
  ['house5-az180', 'House4000005', 180, 45, 6, 6],
  ['house5-az270', 'House4000005', 270, 45, 6, 6],
  ['windmill-az0', 'LM_Windmill', 0, 70, 20, 25],
  ['windmill-az90', 'LM_Windmill', 90, 70, 20, 25],
  ['windmill-az270', 'LM_Windmill', 270, 70, 20, 25],
  ['bridge-az0', 'LM_Bridge', 0, 120, 10, 12],
  ['bridge-az180', 'LM_Bridge', 180, 120, 10, 12],
  ['bridge-az20low', 'LM_Bridge', 20, 90, 2, 10],
  ['viaduct-az0', 'LM_Viaduct', 0, 160, 10, 20],
  ['viaduct-az180', 'LM_Viaduct', 180, 160, 10, 20],
  ['jetty-az0', 'LM_Jetty', 0, 90, 8, 4],
  ['jetty-az90', 'LM_Jetty', 90, 90, 8, 4],
]

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  protocolTimeout: 900000,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
})
const info = {}
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(600000)
  await page.setViewport({ width: 1200, height: 800, deviceScaleFactor: 1 })
  await page.goto(`${BASE}/dev/world-v2`, { waitUntil: 'domcontentloaded', timeout: 180000 })
  await page.waitForFunction(() => window.__worldReady === true, { timeout: 300000, polling: 250 })
  await page.evaluate(() => {
    const main = document.querySelector('main')
    const key = Object.keys(main).find((k) => k.startsWith('__reactFiber$'))
    let f = main[key]
    let sc = null
    for (let n = 0; f && n < 60 && !sc; n++, f = f.return)
      for (let h = f.memoizedState; h && typeof h === 'object' && 'next' in h; h = h.next) {
        const v = h.memoizedState
        if (v && typeof v === 'object' && v.current && typeof v.current.debugScene === 'function') { sc = v.current; break }
      }
    window.__sc = sc
  })
  for (const [tag, name, az, dist, camUp, lookUp] of VIEWS) {
    const r = await page.evaluate((name, az, dist, camUp, lookUp) => {
      const sc = window.__sc
      const o = sc.scene.getObjectByName(name)
      if (!o) return { err: 'no ' + name }
      const Box3 = sc.landmarks.values().next().value.box.constructor
      const b = new Box3().setFromObject(o)
      const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2
      const hf = sc.heightfield
      // Lowest heightfield ground on a 9x9 grid over the footprint.
      let gMin = Infinity, gMax = -Infinity
      for (let i = 0; i <= 8; i++) for (let k = 0; k <= 8; k++) {
        const g = hf.heightAt(b.min.x + ((b.max.x - b.min.x) * i) / 8, b.min.z + ((b.max.z - b.min.z) * k) / 8)
        if (g < gMin) gMin = g
        if (g > gMax) gMax = g
      }
      const a = (az * Math.PI) / 180
      const px = cx + Math.sin(a) * dist, pz = cz + Math.cos(a) * dist
      const cam = sc.camera
      const pos0 = cam.position.clone(), q0 = cam.quaternion.clone()
      const near0 = sc.fog.near, far0 = sc.fog.far
      const base = b.min.y
      cam.position.set(px, Math.max(base + camUp, hf.heightAt(px, pz) + 2), pz)
      cam.lookAt(cx, base + lookUp, cz)
      cam.updateMatrixWorld()
      sc.fog.near = 4000
      sc.fog.far = 6000
      sc.sky.position.copy(cam.position)
      sc.renderer.render(sc.scene, cam)
      const gl = sc.renderer.getContext()
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight
      const buf = new Uint8Array(w * h * 4)
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf)
      cam.position.copy(pos0)
      cam.quaternion.copy(q0)
      cam.updateMatrixWorld()
      sc.fog.near = near0
      sc.fog.far = far0
      sc.sky.position.copy(cam.position)
      sc.renderer.render(sc.scene, cam)
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const g = c.getContext('2d')
      const img = g.createImageData(w, h)
      for (let row = 0; row < h; row++) img.data.set(buf.subarray(row * w * 4, (row + 1) * w * 4), (h - 1 - row) * w * 4)
      g.putImageData(img, 0, 0)
      return { url: c.toDataURL('image/png'), box: [b.min.toArray(), b.max.toArray()].map((v) => v.map((x) => +x.toFixed(2))), groundUnderMin: +gMin.toFixed(2), groundUnderMax: +gMax.toFixed(2), gapLow: +(b.min.y - gMin).toFixed(2) }
    }, name, az, dist, camUp, lookUp)
    if (r.err) { console.log(tag, r.err); continue }
    fs.writeFileSync(path.join(OUT, `closeup2-${tag}.png`), Buffer.from(r.url.split(',')[1], 'base64'))
    delete r.url
    info[name] = r
    console.log(tag, JSON.stringify(r))
  }
} finally {
  await browser.close()
}
fs.writeFileSync(path.join(OUT, 'closeups2.json'), JSON.stringify(info, null, 1))
