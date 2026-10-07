// Where are the pure-black (clear colour) pixels, and what is at them?
// Also measures, at each area's own stop, the clear gap between the marker pin
// and the landmark silhouette IN THE PIN'S OWN COLUMN (the sweep's topY is the
// global top of the silhouette, which misleads for wide landmarks).
//
//   node world-tests/v2-journey-holes.mjs [--vp split] [--depths 0.193,0.301]
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = process.env.OUT_DIR || path.join(HERE, 'shots', 'v2-verify', 'journey')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.BASE_URL || 'http://localhost:3111'
const args = process.argv.slice(2)
const argv = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d)
const VP = { split: [1691, 1278], ultra: [3428, 1230], laptop: [1440, 900] }[argv('--vp', 'split')]
const DEPTHS = argv('--depths', '0.1926,0.3009').split(',').map(Number)
const STOPS = !args.includes('--no-stops')

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  protocolTimeout: 900000,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
})
const results = { vp: argv('--vp', 'split'), holes: [], stops: [] }
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(900000)
  await page.setViewport({ width: VP[0], height: VP[1], deviceScaleFactor: 1 })
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
    window.__render = () => {
      sc.renderer.render(sc.scene, sc.camera)
      const gl = sc.renderer.getContext()
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight
      const buf = new Uint8Array(w * h * 4)
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf)
      return { buf, w, h }
    }
  })
  const go = async (d) => {
    await page.evaluate((d) => window.scrollTo(0, Math.round(window.__worldScrollFor(d))), d)
    await page.evaluate(() => {
      const sc = window.__sc
      const t = sc.readScrollDepth(sc.targetDepth)
      sc.targetDepth = t
      sc.currentDepth = t
      sc.dirty = true
      sc.wake()
    })
    await page.waitForFunction(() => { const sc = window.__sc; return sc.raf === 0 && sc.currentDepth === sc.targetDepth && window.__worldFrame.parkProgress === 0 }, { polling: 100 })
    await new Promise((r) => setTimeout(r, 400))
  }
  for (const d of DEPTHS) {
    await go(d)
    const r = await page.evaluate(() => {
      const sc = window.__sc
      const { buf, w, h } = window.__render()
      const pts = []
      for (let row = 0; row < h; row++) for (let x = 0; x < w; x++) {
        const o = (row * w + x) * 4
        if (buf[o] === 0 && buf[o + 1] === 0 && buf[o + 2] === 0) pts.push([x, h - 1 - row])
      }
      // Which object owns each black pixel: hide candidates one group at a time and see if it stays black.
      const groups = { trees: (o) => o.name.startsWith('Trees:'), rocks: (o) => o.name.startsWith('Rocks:'), houses: (o) => /^House/.test(o.name), landmarks: (o) => /^LM_/.test(o.name), terrain: (o) => o.name === 'Terrain', path: (o) => o.name === 'Path', water: (o) => /^(Sea|Lake|Pond)$/.test(o.name), ridges: (o) => /^Ridge/.test(o.name), sky: (o) => o === sc.sky }
      const owner = {}
      for (const [g, test] of Object.entries(groups)) {
        const hidden = []
        sc.scene.traverse((o) => { if (o.visible && test(o)) { o.visible = false; hidden.push(o) } })
        const B = window.__render()
        for (const o of hidden) o.visible = true
        let changed = 0
        for (const [x, y] of pts) {
          const o = ((h - 1 - y) * w + x) * 4
          if (B.buf[o] || B.buf[o + 1] || B.buf[o + 2]) changed++
        }
        if (changed) owner[g] = changed
      }
      window.__render()
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1])
      return { depth: window.__worldFrame.depth, black: pts.length, bbox: pts.length ? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] : null, sample: pts.filter((_, i) => i % Math.max(1, Math.floor(pts.length / 12)) === 0).slice(0, 12), owner }
    })
    results.holes.push(r)
    console.log('holes', JSON.stringify(r))
    if (r.black) {
      // Crop around the first cluster, 4x, for a look.
      const [x, y] = r.sample[0]
      const clip = { x: Math.max(0, x - 60), y: Math.max(0, y - 40), width: 120, height: 80 }
      await page.screenshot({ path: path.join(OUT, `holes-${results.vp}-d${d.toFixed(4).replace('.', '_')}-crop.png`), clip: { ...clip, scale: 4 } })
    }
  }
  if (STOPS) {
    const ids = await page.evaluate(() => window.__sc.anchors.map((a) => [a.id, a.landmark, window.__sc.depthFor(a.id)]))
    for (const [id, lm, d] of ids) {
      await go(d)
      const r = await page.evaluate((id, lm) => {
        const sc = window.__sc
        const A = window.__render()
        const hidden = []
        sc.scene.traverse((o) => { if (o.visible && o.name.startsWith(lm)) { o.visible = false; hidden.push(o) } })
        const B = window.__render()
        for (const o of hidden) o.visible = true
        window.__render()
        const { w, h } = A
        const i = sc.anchors.findIndex((a) => a.id === id)
        const btn = document.querySelectorAll('button[data-mode]')[i]
        const pr = btn.querySelector('span').getBoundingClientRect()
        const px = Math.round((pr.left + pr.right) / 2), py = (pr.top + pr.bottom) / 2
        // Silhouette top in the pin's column band (+-3 px).
        let top = null
        for (let y = 0; y < h && top === null; y++) for (let x = px - 3; x <= px + 3; x++) {
          const o = ((h - 1 - y) * w + x) * 4
          if (Math.max(Math.abs(A.buf[o] - B.buf[o]), Math.abs(A.buf[o + 1] - B.buf[o + 1]), Math.abs(A.buf[o + 2] - B.buf[o + 2])) > 4) { top = y; break }
        }
        // Label box vs the silhouette: does the label or stem sit on the landmark?
        const lab = btn.querySelectorAll('span')[2].getBoundingClientRect()
        let labelOnLm = 0
        for (let y = Math.max(0, Math.floor(lab.top)); y < Math.min(h, Math.ceil(lab.bottom)); y++) for (let x = Math.max(0, Math.floor(lab.left)); x < Math.min(w, Math.ceil(lab.right)); x++) {
          const o = ((h - 1 - y) * w + x) * 4
          if (Math.max(Math.abs(A.buf[o] - B.buf[o]), Math.abs(A.buf[o + 1] - B.buf[o + 1]), Math.abs(A.buf[o + 2] - B.buf[o + 2])) > 4) labelOnLm++
        }
        return { id, mode: btn.dataset.mode, pin: [px, +py.toFixed(1)], silhouetteTopInPinColumn: top, gapPx: top === null ? null : +(top - py).toFixed(1), labelPixelsOverLandmark: btn.dataset.mode === 'text' ? labelOnLm : null }
      }, id, lm)
      results.stops.push(r)
      console.log('stop', JSON.stringify(r))
    }
  }
} finally {
  await browser.close()
}
fs.writeFileSync(path.join(OUT, `holes-and-pins-${results.vp}.json`), JSON.stringify(results, null, 1))
