// Close-up renders of suspect geometry, from a temporary camera that is put
// back in the same task (the page never presents the moved frame on its own).
// Also prints water boxes, so "posts end at y=21" can be checked against a lake.
//
//   node world-tests/v2-journey-closeups.mjs
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = process.env.OUT_DIR || path.join(HERE, 'shots', 'v2-verify', 'journey')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.BASE_URL || 'http://localhost:3111'
fs.mkdirSync(OUT, { recursive: true })

// [name, camera x, z, height above ground (or sea), look target]
const VIEWS = [
  ['bridge-side', [0, 330], 18, [0, 22, 245]],
  ['bridge-oblique', [95, 320], 22, [15, 18, 245]],
  ['viaduct-side', [30, 120], 30, [30, 20, 0]],
  ['viaduct-oblique', [140, 90], 30, [30, 15, 0]],
  ['windmill', [150, 505], 20, [105, 35, 470]],
  ['lighthouse-plinth', [-80, 790], 14, [-124, 14, 730]],
  ['obelisk-rocks', [150, -700], 40, [240, 145, -830]],
]

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  protocolTimeout: 900000,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
})
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(600000)
  await page.setViewport({ width: 1200, height: 800, deviceScaleFactor: 1 })
  await page.goto(`${BASE}/dev/world-v2`, { waitUntil: 'domcontentloaded', timeout: 180000 })
  await page.waitForFunction(() => window.__worldReady === true, { timeout: 300000, polling: 250 })
  const info = await page.evaluate(() => {
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
    const Box3 = sc.landmarks.values().next().value.box.constructor
    const boxes = {}
    for (const n of ['Lake', 'Pond', 'Sea', 'Path']) {
      const o = sc.scene.getObjectByName(n)
      if (o) { const b = new Box3().setFromObject(o); boxes[n] = { min: b.min.toArray().map((v) => +v.toFixed(2)), max: b.max.toArray().map((v) => +v.toFixed(2)) } }
    }
    // Ground under the bridge posts, and whether the Lake mesh covers (x, 245).
    const hf = sc.heightfield
    const under = [-48, -40, -18, -12, 12, 18, 40, 48].map((x) => [x, +hf.heightAt(x, 245).toFixed(2)])
    return { boxes, under }
  })
  console.log(JSON.stringify(info))
  for (const [name, xz, above, t] of VIEWS) {
    const url = await page.evaluate((xz, above, t) => {
      const sc = window.__sc
      const gy = Math.max(0, sc.heightfield.heightAt(xz[0], xz[1]))
      const p = [xz[0], gy + above, xz[1]]
      const cam = sc.camera
      const pos0 = cam.position.clone()
      const q0 = cam.quaternion.clone()
      const near0 = sc.fog.near, far0 = sc.fog.far
      cam.position.set(p[0], p[1], p[2])
      cam.lookAt(t[0], t[1], t[2])
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
      return c.toDataURL('image/png')
    }, xz, above, t)
    fs.writeFileSync(path.join(OUT, `closeup-${name}.png`), Buffer.from(url.split(',')[1], 'base64'))
    console.log('wrote', `closeup-${name}.png`)
  }
} finally {
  await browser.close()
}
