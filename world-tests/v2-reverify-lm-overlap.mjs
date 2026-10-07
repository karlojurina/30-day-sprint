/**
 * Other landmarks in the parked frame. For each area, park on /dev/world-v2
 * and measure whether a DIFFERENT landmark's visible silhouette touches or
 * sits inside the parked landmark's silhouette box (e.g. the a6 cairn
 * stacking on top of the a5 watchtower so the two read as one object).
 *
 *   node world-tests/v2-reverify-lm-overlap.mjs --vp split
 *
 * Reuses installZV() from v2-zoom-verify.mjs verbatim (read from its source).
 * Writes shots/v2-verify/reverify/overlap/overlap-<vp>.json and one composite
 * per area: target landmark magenta, other landmarks cyan, the rest dimmed.
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, 'shots', 'v2-verify', 'reverify', 'overlap')
fs.mkdirSync(OUT, { recursive: true })
const VPS = { split: [1691, 1278], ultra: [3428, 1230], laptop: [1440, 900] }
const vpName = process.argv.includes('--vp') ? process.argv[process.argv.indexOf('--vp') + 1] : 'split'
const [W, H] = VPS[vpName]
const AREAS = [['a1', 'LM_Lighthouse'], ['a2', 'LM_Windmill'], ['a3', 'LM_Bridge'], ['a4', 'LM_Viaduct'], ['a5', 'LM_Watchtower'], ['a6', 'LM_Cairn'], ['a7', 'LM_Jetty'], ['a8', 'LM_Obelisk']]
const src = fs.readFileSync(path.join(HERE, 'v2-zoom-verify.mjs'), 'utf8')
const m = src.match(/function installZV\(kind\) \{[\s\S]*?\n\}\n/)
if (!m) throw new Error('installZV not found')
const INSTALL = m[0]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), `[${vpName}]`, ...a)

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, protocolTimeout: 1800000,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
})
const out = { viewport: { name: vpName, width: W, height: H }, areas: [] }
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(900000)
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 })
  await page.goto('http://localhost:3111/dev/world-v2', { waitUntil: 'domcontentloaded', timeout: 180000 })
  await page.waitForFunction(() => window.__worldReady === true, { timeout: 300000, polling: 250 })
  const ok = await page.evaluate(`(${INSTALL})('v2')`)
  if (!ok.ok) throw new Error('scene not found')
  for (const [id, key] of AREAS) {
    await page.evaluate((id) => window.__worldPark(id), id)
    await page.waitForFunction((id) => window.__zv.inst.mode === 'parked' && window.__zv.inst.parkedId === id && window.__worldFrame.parkProgress === 1, { timeout: 900000, polling: 200 }, id)
    await sleep(600)
    const res = await page.evaluate((key, keys) => {
      const Z = window.__zv
      const t = Z.renderMask(key, 'vis', null)
      const M = window.__zvMask
      const tm = M.mask.slice()
      const { w, h, sx } = M
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (tm[y * w + x]) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y }
      // Dilate the target by 6 px for "touching".
      const R = Math.round(6 / sx)
      const near = new Uint8Array(w * h)
      for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
        if (!tm[y * w + x]) continue
        for (let dy = -R; dy <= R; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue; for (let dx = -R; dx <= R; dx++) { const xx = x + dx; if (xx >= 0 && xx < w) near[yy * w + xx] = 1 } }
      }
      const others = {}
      const om = new Uint8Array(w * h)
      for (const k of keys) {
        if (k === key) continue
        const r = Z.renderMask(k, 'vis', null)
        if (!r || !r.pixels) continue
        const mk = window.__zvMask.mask
        let inBox = 0, touch = 0, n = 0
        for (let i = 0; i < mk.length; i++) {
          if (!mk[i]) continue
          n++; om[i] = 1
          const x = i % w, y = (i / w) | 0
          if (x >= minX && x <= maxX && y >= minY && y <= maxY) inBox++
          if (near[i]) touch++
        }
        others[k] = { pixels: n, inTargetBox: inBox, touching: touch, inTargetBoxPctOfTarget: t.pixels ? (100 * inBox) / t.pixels : 0 }
      }
      // Composite: magenta target, cyan others, black elsewhere, downscaled 2x.
      const c = document.createElement('canvas'); c.width = Math.ceil(w / 2); c.height = Math.ceil(h / 2)
      const g = c.getContext('2d'); const img = g.createImageData(c.width, c.height)
      for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
        const i = (y * 2) * w + x * 2, o = (y * c.width + x) * 4
        const T = tm[i], O = om[i]
        img.data[o] = T ? 255 : 0; img.data[o + 1] = O ? 255 : T ? 0 : 0; img.data[o + 2] = T || O ? 255 : 0; img.data[o + 3] = 255
      }
      g.putImageData(img, 0, 0)
      g.strokeStyle = '#ffff00'; g.lineWidth = 1; g.strokeRect(minX / 2, minY / 2, (maxX - minX) / 2, (maxY - minY) / 2)
      Z.restore()
      return { target: { pixels: t.pixels, box: [minX * sx, minY * sx, maxX * sx, maxY * sx] }, others, png: c.toDataURL('image/png') }
    }, key, AREAS.map((a) => a[1]))
    fs.writeFileSync(path.join(OUT, `overlap-${vpName}-${id}.png`), Buffer.from(res.png.split(',')[1], 'base64'))
    await page.screenshot({ path: path.join(OUT, `parked-${vpName}-${id}.png`) })
    delete res.png
    const worst = Object.entries(res.others).sort((a, b) => b[1].touching - a[1].touching)[0]
    log(id, 'target px', res.target.pixels, 'others touching:', JSON.stringify(Object.fromEntries(Object.entries(res.others).filter(([, v]) => v.touching || v.inTargetBox).map(([k, v]) => [k, `${v.touching} touch / ${v.inTargetBox} in box (${v.inTargetBoxPctOfTarget.toFixed(1)}% of target)`]))))
    out.areas.push({ id, key, ...res, worst: worst ? worst[0] : null })
  }
} finally {
  fs.writeFileSync(path.join(OUT, `overlap-${vpName}.json`), JSON.stringify(out, null, 2))
  await browser.close()
}
