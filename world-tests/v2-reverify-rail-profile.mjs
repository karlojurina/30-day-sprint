/**
 * Rail height profile on the live /dev/world-v2 scene: camera y along the
 * rail with the stop drop (rail.dropAt) and without it, so the vertical
 * motion the drop adds while scrolling can be read directly.
 *
 *   node world-tests/v2-reverify-rail-profile.mjs
 *
 * Writes shots/v2-verify/reverify/rail-profile.json.
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, 'shots', 'v2-verify', 'reverify')
fs.mkdirSync(OUT, { recursive: true })
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, protocolTimeout: 600000,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
})
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1691, height: 1278 })
  await page.goto('http://localhost:3111/dev/world-v2', { waitUntil: 'domcontentloaded', timeout: 180000 })
  await page.waitForFunction(() => window.__worldReady === true, { timeout: 300000, polling: 250 })
  const res = await page.evaluate(() => {
    let inst = null
    for (let e = document.querySelector('canvas'); e && !inst; e = e.parentElement) {
      const k = Object.keys(e).find((x) => x.startsWith('__reactFiber$'))
      if (!k) continue
      for (let f = e[k]; f && !inst; f = f.return) {
        let h = f.memoizedState, g = 0
        while (h && typeof h === 'object' && 'next' in h && g++ < 300) {
          const v = h.memoizedState
          if (v && typeof v === 'object' && 'current' in v && v.current && typeof v.current.debugScene === 'function') { inst = v.current; break }
          h = h.next
        }
      }
    }
    if (!inst) return { error: 'no scene' }
    const rail = inst.rail
    const pose = inst.railPose
    const rows = []
    for (let i = 0; i <= 880; i++) {
      const d = i / 1000
      rail.sample(d, pose)
      const drop = rail.dropAt(d)
      const p = pose.position, t = pose.target
      const pitch = (Math.atan2(p.y - t.y, Math.hypot(t.x - p.x, t.z - p.z)) * 180) / Math.PI
      rows.push({ d, y: p.y, yNoDrop: p.y + drop, drop, pitch, ground: inst.heightfield ? inst.heightfield.heightAt(p.x, p.z) : null })
    }
    const stops = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'].map((id) => ({ id, depth: inst.depthFor(id) }))
    return { rows, stops }
  })
  if (res.error) throw new Error(res.error)
  // Vertical direction reversals and the descents (camera going DOWN while scrolling forward).
  const seg = (key) => {
    const r = res.rows
    const runs = []
    let dir = 0, start = 0
    for (let i = 1; i < r.length; i++) {
      const dy = r[i][key] - r[i - 1][key]
      const s = Math.abs(dy) < 1e-4 ? dir : Math.sign(dy)
      if (s !== dir) {
        if (dir !== 0) runs.push({ dir: dir > 0 ? 'up' : 'down', from: r[start].d, to: r[i - 1].d, dy: +(r[i - 1][key] - r[start][key]).toFixed(1) })
        dir = s; start = i - 1
      }
    }
    runs.push({ dir: dir > 0 ? 'up' : 'down', from: r[start].d, to: r[r.length - 1].d, dy: +(r[r.length - 1][key] - r[start][key]).toFixed(1) })
    return runs
  }
  const out = { stops: res.stops, withDrop: seg('y'), withoutDrop: seg('yNoDrop'), pitchRange: [Math.min(...res.rows.map((r) => r.pitch)), Math.max(...res.rows.map((r) => r.pitch))], rows: res.rows.filter((_, i) => i % 5 === 0) }
  fs.writeFileSync(path.join(OUT, 'rail-profile.json'), JSON.stringify(out, null, 2))
  console.log('stops', res.stops.map((s) => `${s.id} ${s.depth.toFixed(4)}`).join(', '))
  console.log('pitch range', out.pitchRange.map((x) => x.toFixed(2)).join('..'))
  console.log('WITH drop:', out.withDrop.map((s) => `${s.dir} ${s.from.toFixed(3)}-${s.to.toFixed(3)} (${s.dy})`).join(' | '))
  console.log('WITHOUT drop:', out.withoutDrop.map((s) => `${s.dir} ${s.from.toFixed(3)}-${s.to.toFixed(3)} (${s.dy})`).join(' | '))
} finally {
  await browser.close()
}
