// Vertex-level footing check: for each object, its bottom vertices (within
// 0.6 u of the lowest vertex in their 2x2-unit column) against the live
// heightfield (and the sea plane at y 0 where the terrain dips under it).
// gap = vertex y - ground; > 0.3 means the footing hangs above the ground there.
// Read-only.
//
//   node world-tests/v2-journey-footings.mjs
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = process.env.OUT_DIR || path.join(HERE, 'shots', 'v2-verify', 'reverify', 'journey')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.BASE_URL || 'http://localhost:3111'

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  protocolTimeout: 900000,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
})
let res
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(600000)
  await page.setViewport({ width: 800, height: 600, deviceScaleFactor: 1 })
  await page.goto(`${BASE}/dev/world-v2`, { waitUntil: 'domcontentloaded', timeout: 180000 })
  await page.waitForFunction(() => window.__worldReady === true, { timeout: 300000, polling: 250 })
  res = await page.evaluate(() => {
    const main = document.querySelector('main')
    const key = Object.keys(main).find((k) => k.startsWith('__reactFiber$'))
    let f = main[key]
    let sc = null
    for (let n = 0; f && n < 60 && !sc; n++, f = f.return)
      for (let h = f.memoizedState; h && typeof h === 'object' && 'next' in h; h = h.next) {
        const v = h.memoizedState
        if (v && typeof v === 'object' && v.current && typeof v.current.debugScene === 'function') { sc = v.current; break }
      }
    const hf = sc.heightfield
    const b = hf.bounds
    const Box3 = sc.landmarks.values().next().value.box.constructor
    const waters = ['Lake', 'Pond'].map((n) => sc.scene.getObjectByName(n)).filter(Boolean).map((o) => new Box3().setFromObject(o))
    const ground = (x, z) => {
      let g = x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ ? hf.heightAt(x, z) : -Infinity
      g = Math.max(g, 0) // the sea plane sits at y 0
      for (const w of waters) if (x >= w.min.x && x <= w.max.x && z >= w.min.z && z <= w.max.z) g = Math.max(g, w.max.y)
      return g
    }
    const V = sc.camPos.constructor
    const names = []
    sc.scene.traverse((o) => {
      if (/^(House\d+|LM_[A-Za-z]+)$/.test(o.name) && !/Blades|Lamp/.test(o.name) && !/^(House|LM_)/.test(o.parent?.name || '')) names.push(o.name)
    })
    const out = {}
    for (const name of names) {
      const o = sc.scene.getObjectByName(name)
      const verts = []
      const v = new V()
      o.traverse((c) => {
        if (!c.isMesh) return
        const p = c.geometry.getAttribute('position')
        for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(c.matrixWorld); verts.push([v.x, v.y, v.z]) }
      })
      const cols = new Map()
      for (const [x, y, z] of verts) {
        const k = Math.round(x / 2) + ',' + Math.round(z / 2)
        const m = cols.get(k)
        if (m === undefined || y < m) cols.set(k, y)
      }
      const minY = Math.min(...verts.map((q) => q[1]))
      const colMins = [...cols.values()].sort((a, b) => a - b)
      const lim = Math.max(minY + 6, colMins[colMins.length >> 1] - 3)
      let worst = null, hanging = 0, bottom = 0
      const hangs = []
      for (const [x, y, z] of verts) {
        const k = Math.round(x / 2) + ',' + Math.round(z / 2)
        if (y > cols.get(k) + 0.6 || cols.get(k) > lim) continue
        bottom++
        const g = ground(x, z)
        const gap = y - g
        if (gap > 0.3) { hanging++; if (hangs.length < 400) hangs.push([+x.toFixed(1), +y.toFixed(2), +z.toFixed(1), +gap.toFixed(2)]) }
        if (!worst || gap > worst.gap) worst = { x: +x.toFixed(2), y: +y.toFixed(2), z: +z.toFixed(2), ground: +g.toFixed(2), gap: +gap.toFixed(2) }
      }
      hangs.sort((a, b) => b[3] - a[3])
      out[name] = { verts: verts.length, bottomVerts: bottom, hangingOver03: hanging, worst, top: hangs.slice(0, 12) }
    }
    return out
  })
} finally {
  await browser.close()
}
fs.writeFileSync(path.join(OUT, 'footings.json'), JSON.stringify(res, null, 1))
for (const [k, r] of Object.entries(res)) console.log(k.padEnd(16), `bottom verts ${r.bottomVerts}, hanging >0.3 u: ${r.hangingOver03}, worst gap ${r.worst?.gap} at (${r.worst?.x}, ${r.worst?.y}, ${r.worst?.z}) ground ${r.worst?.ground}`)
