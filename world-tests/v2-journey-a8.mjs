// a8 specifics: (1) do the rocks in view float, measured along the pixel ray
// just under each rock; (2) how hard is each ridge card's edge (luma step
// across its mask boundary). Read-only apart from temporary visibility toggles.
//
//   node world-tests/v2-journey-a8.mjs [--vp split|ultra] [--depth 0.8306]
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
const vpName = argv('--vp', 'split')
const VP = { split: [1691, 1278], ultra: [3428, 1230], laptop: [1440, 900] }[vpName]
const DEPTH = argv('--depth', null)

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  protocolTimeout: 900000,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
})
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(900000)
  await page.setViewport({ width: VP[0], height: VP[1], deviceScaleFactor: 1 })
  await page.goto(`${BASE}/dev/world-v2`, { waitUntil: 'domcontentloaded', timeout: 180000 })
  await page.waitForFunction(() => window.__worldReady === true, { timeout: 300000, polling: 250 })
  const d = await page.evaluate((D) => {
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
    return D === null ? sc.depthFor('a8') : Number(D)
  }, DEPTH)
  await page.evaluate((d) => window.scrollTo(0, Math.round(window.__worldScrollFor(d))), d)
  await page.evaluate(() => {
    const sc = window.__sc
    const t = sc.readScrollDepth(sc.targetDepth)
    sc.targetDepth = t
    sc.currentDepth = t
    sc.dirty = true
    sc.wake()
  })
  await page.waitForFunction(() => { const sc = window.__sc; return sc.raf === 0 && sc.currentDepth === sc.targetDepth }, { polling: 100 })
  await new Promise((r) => setTimeout(r, 400))
  const res = await page.evaluate(() => {
    const sc = window.__sc
    const cam = sc.camera
    const W = innerWidth, H = innerHeight
    const V = sc.camPos.constructor
    const M = cam.matrixWorld.constructor
    const hf = sc.heightfield
    const pos = sc.camPos.clone()
    const render = () => {
      sc.renderer.render(sc.scene, cam)
      const gl = sc.renderer.getContext()
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight
      const buf = new Uint8Array(w * h * 4)
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf)
      return { buf, w, h }
    }
    const march = (d) => {
      let t = 1, prev = 1
      while (t < 2500) {
        const x = pos.x + d.x * t, y = pos.y + d.y * t, z = pos.z + d.z * t
        if (y < hf.heightAt(x, z)) {
          let lo = prev, hi = t
          for (let k = 0; k < 20; k++) { const m = (lo + hi) / 2; if (pos.y + d.y * m < hf.heightAt(pos.x + d.x * m, pos.z + d.z * m)) hi = m; else lo = m }
          return hi
        }
        prev = t
        t += t < 200 ? 1 : 3
      }
      return Infinity
    }
    // (1) Rocks.
    const rocks = []
    const m = new M()
    const v = new V()
    sc.scene.traverse((o) => {
      if (!o.isInstancedMesh || !o.name.startsWith('Rocks:')) return
      const g = o.geometry
      const p = g.getAttribute('position')
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m)
        m.premultiply(o.matrixWorld)
        // Lowest vertex on screen (largest screen y) of this rock.
        let best = null
        let cx = 0, cy = 0, cz = 0
        for (let k = 0; k < p.count; k++) {
          v.fromBufferAttribute(p, k).applyMatrix4(m)
          cx += v.x; cy += v.y; cz += v.z
          const w = v.clone()
          const vv = w.clone().applyMatrix4(cam.matrixWorldInverse)
          if (vv.z > -cam.near) { best = null; break }
          w.project(cam)
          const sx = (w.x * 0.5 + 0.5) * W, sy = (-w.y * 0.5 + 0.5) * H
          if (!best || sy > best.sy) best = { sx, sy, dist: v.distanceTo(pos), wy: v.y, wx: v.x, wz: v.z }
        }
        if (!best || best.sx < 0 || best.sx > W || best.sy < 0 || best.sy > H - 3) continue
        if (best.dist > 1400) continue
        // Ray through the pixel 3 px under the rock's lowest point.
        const n = new V((best.sx / W) * 2 - 1, -((best.sy + 3) / H) * 2 + 1, 0.5).unproject(cam).sub(pos).normalize()
        const tg = march(n)
        const c = new V(cx / p.count, cy / p.count, cz / p.count)
        rocks.push({
          px: [Math.round(best.sx), Math.round(best.sy)], rockDist: +best.dist.toFixed(1), groundDistUnder: Number.isFinite(tg) ? +tg.toFixed(1) : null,
          behindBy: Number.isFinite(tg) ? +(tg - best.dist).toFixed(1) : null,
          lowestVertexAboveGround: +(best.wy - hf.heightAt(best.wx, best.wz)).toFixed(2),
          centreAboveGround: +(c.y - hf.heightAt(c.x, c.z)).toFixed(2),
        })
      }
    })
    rocks.sort((a, b) => a.rockDist - b.rockDist)
    // (2) Ridge card edges: luma step across each card's mask boundary.
    const base = render()
    const Y = (b, o) => 0.2126 * b[o] + 0.7152 * b[o + 1] + 0.0722 * b[o + 2]
    const ridges = []
    for (const name of ['Ridge0', 'Ridge1', 'Ridge2', 'Ridge3']) {
      const o = sc.scene.getObjectByName(name)
      if (!o) continue
      o.visible = false
      const B = render()
      o.visible = true
      const { w, h } = base
      let n = 0, edgeSum = 0, edgeN = 0, lum = 0
      const inM = (x, row) => { const i = (row * w + x) * 4; return Math.max(Math.abs(base.buf[i] - B.buf[i]), Math.abs(base.buf[i + 1] - B.buf[i + 1]), Math.abs(base.buf[i + 2] - B.buf[i + 2])) > 3 }
      for (let row = 1; row < h - 1; row++) for (let x = 1; x < w - 1; x++) {
        if (!inM(x, row)) continue
        n++
        lum += Y(base.buf, (row * w + x) * 4)
        // Upper boundary (row + 1 is one pixel UP on screen in a bottom-up buffer): card pixel whose upper neighbour is not card.
        if (!inM(x, row + 1)) {
          // Step: 2 px inside vs 2 px outside.
          const inside = row - 2 >= 0 ? Y(base.buf, ((row - 2) * w + x) * 4) : null
          const outside = row + 3 < h ? Y(base.buf, ((row + 3) * w + x) * 4) : null
          if (inside !== null && outside !== null) { edgeSum += Math.abs(inside - outside); edgeN++ }
        }
      }
      ridges.push({ name, share: +(n / (w * h)).toFixed(4), meanLuma: n ? +(lum / n).toFixed(1) : null, topEdgeStep: edgeN ? +(edgeSum / edgeN).toFixed(1) : null, topEdgePx: edgeN })
    }
    render()
    return { depth: window.__worldFrame.depth, cam: sc.cameraPose(), rocks, ridges }
  })
  const floating = res.rocks.filter((r) => r.behindBy !== null && r.behindBy > 8)
  res.summary = { rocksInView: res.rocks.length, rocksWithGroundFarBehind: floating.length }
  fs.writeFileSync(path.join(OUT, `a8-rocks-ridges-${vpName}.json`), JSON.stringify(res, null, 1))
  console.log(JSON.stringify({ depth: res.depth, summary: res.summary, ridges: res.ridges, nearest: res.rocks.slice(0, 12) }))
} finally {
  await browser.close()
}
