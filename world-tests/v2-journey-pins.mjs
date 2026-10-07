// Every shown marker, at many depths, against the RENDERED silhouettes (hide-diff
// per landmark), not projected boxes. Replaces the old projectedAnchor check,
// which hard-codes the pre-fix anchor formula. For each shown pin:
//   ownGap   pin centre to its own silhouette top, in the pin's column (+-3 px);
//            negative = the pin sits ON or below its landmark's top.
//   ownXIn   pin x inside its own silhouette's x span.
//   onOther  the pin disc (r 5 px) touches another landmark's silhouette, and
//            that other landmark's marker state at that moment.
//   labelOnOther  text label body pixels covering another landmark's silhouette.
// Read-only apart from temporary visibility toggles, restored in the same task.
//
//   node world-tests/v2-journey-pins.mjs [--vp split] [--n 23] [--crops]
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = process.env.OUT_DIR || path.join(HERE, 'shots', 'v2-verify', 'reverify', 'journey')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.BASE_URL || 'http://localhost:3111'
const args = process.argv.slice(2)
const argv = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d)
const vpName = argv('--vp', 'split')
const VP = { split: [1691, 1278], ultra: [3428, 1230], laptop: [1440, 900] }[vpName]
const N = Number(argv('--n', 23))
const CROPS = args.includes('--crops')
fs.mkdirSync(OUT, { recursive: true })

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  protocolTimeout: 1800000,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
})
const out = { vp: vpName, frames: [] }
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(1200000)
  await page.setViewport({ width: VP[0], height: VP[1], deviceScaleFactor: 1 })
  await page.goto(`${BASE}/dev/world-v2`, { waitUntil: 'domcontentloaded', timeout: 180000 })
  await page.waitForFunction(() => window.__worldReady === true, { timeout: 300000, polling: 250 })
  const stops = await page.evaluate(() => {
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
    return sc.anchors.map((a) => [a.id, sc.depthFor(a.id)])
  })
  const depths = []
  for (let i = 0; i < N; i++) depths.push({ d: (0.88 * i) / (N - 1), tag: `d${String(i).padStart(2, '0')}` })
  for (const [id, d] of stops) depths.push({ d, tag: `stop-${id}` })
  depths.sort((a, b) => a.d - b.d)
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
  for (const it of depths) {
    await go(it.d)
    const fr = await page.evaluate(() => {
      const sc = window.__sc
      const A = window.__render()
      const { w, h } = A
      const buttons = [...document.querySelectorAll('button[data-mode]')]
      const masks = sc.anchors.map((a) => {
        if (!a.landmark) return null
        const hidden = []
        sc.scene.traverse((o) => { if (o.visible && o.name.startsWith(a.landmark)) { o.visible = false; hidden.push(o) } })
        const B = window.__render()
        for (const o of hidden) o.visible = true
        const m = new Uint8Array(w * h)
        let n = 0, minx = w, maxx = -1, miny = h, maxy = -1
        for (let row = 0; row < h; row++) {
          const y = h - 1 - row
          for (let x = 0; x < w; x++) {
            const o = (row * w + x) * 4
            if (Math.max(Math.abs(A.buf[o] - B.buf[o]), Math.abs(A.buf[o + 1] - B.buf[o + 1]), Math.abs(A.buf[o + 2] - B.buf[o + 2])) > 4) {
              m[y * w + x] = 1; n++
              if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y
            }
          }
        }
        return { m, n, bbox: n ? [minx, miny, maxx, maxy] : null }
      })
      window.__render()
      const rows = sc.anchors.map((a, i) => {
        const btn = buttons[i]
        const mode = btn?.dataset.mode
        const r = { id: a.id, mode, px: masks[i]?.n ?? 0, bbox: masks[i]?.bbox ?? null }
        if (!btn || mode === 'hidden') return r
        const pr = btn.querySelector('span').getBoundingClientRect()
        const px = Math.round((pr.left + pr.right) / 2), py = (pr.top + pr.bottom) / 2
        r.pin = [px, +py.toFixed(1)]
        const own = masks[i]
        if (own && own.n) {
          let top = null
          for (let y = 0; y < h && top === null; y++) for (let x = Math.max(0, px - 3); x <= Math.min(w - 1, px + 3); x++) if (own.m[y * w + x]) { top = y; break }
          r.ownGap = top === null ? null : +(top - py).toFixed(1)
          r.ownXIn = px >= own.bbox[0] - 2 && px <= own.bbox[2] + 2
          r.ownTopGlobal = own.bbox[1]
        }
        r.onOther = []
        const R = 5
        for (let k = 0; k < masks.length; k++) {
          if (k === i || !masks[k] || !masks[k].n) continue
          let hit = 0
          for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
            if (dx * dx + dy * dy > R * R) continue
            const x = px + dx, y = Math.round(py) + dy
            if (x >= 0 && x < w && y >= 0 && y < h && masks[k].m[y * w + x]) hit++
          }
          if (hit) r.onOther.push({ id: sc.anchors[k].id, hit, otherMode: buttons[k]?.dataset.mode })
        }
        if (mode === 'text') {
          const lab = btn.querySelectorAll('span')[2]?.getBoundingClientRect()
          if (lab) {
            r.label = [lab.left, lab.top, lab.right, lab.bottom].map(Math.round)
            r.labelOnOther = {}
            for (let k = 0; k < masks.length; k++) {
              if (k === i || !masks[k] || !masks[k].n) continue
              let c = 0
              for (let y = Math.max(0, Math.floor(lab.top)); y < Math.min(h, Math.ceil(lab.bottom)); y++) for (let x = Math.max(0, Math.floor(lab.left)); x < Math.min(w, Math.ceil(lab.right)); x++) if (masks[k].m[y * w + x]) c++
              if (c) r.labelOnOther[sc.anchors[k].id] = { px: c, ofLandmark: +(c / masks[k].n).toFixed(3) }
            }
          }
        }
        return r
      })
      return { depth: window.__worldFrame.depth, rows }
    })
    fr.tag = it.tag
    out.frames.push(fr)
    const bad = fr.rows.filter((r) => r.pin && ((r.ownGap ?? 99) < 3 || r.ownXIn === false || r.onOther.length))
    console.log(it.tag, fr.depth.toFixed(4), fr.rows.map((r) => `${r.id}:${(r.mode || '-')[0]}${r.pin ? ` g${r.ownGap}${r.ownXIn === false ? 'X' : ''}${r.onOther.length ? ' ON ' + r.onOther.map((o) => o.id + '(' + o.otherMode[0] + ')').join('+') : ''}` : ''}`).join(' | '))
    if (CROPS && bad.length) {
      // Full-viewport screenshot, cropped in the page. A puppeteer `clip` is in
      // DOCUMENT coordinates, so on a scrolled page it cropped the wrong place.
      const b64 = await page.screenshot({ encoding: 'base64' })
      for (const r of bad) {
        const box = { x: Math.max(0, r.pin[0] - 150), y: Math.max(0, Math.round(r.pin[1]) - 110), w: 300, h: 220 }
        box.w = Math.min(box.w, VP[0] - box.x); box.h = Math.min(box.h, VP[1] - box.y)
        const url = await page.evaluate(async (b64, box) => {
          const img = new Image()
          img.src = 'data:image/png;base64,' + b64
          await img.decode()
          const c = document.createElement('canvas')
          c.width = box.w * 2
          c.height = box.h * 2
          c.getContext('2d').drawImage(img, box.x, box.y, box.w, box.h, 0, 0, box.w * 2, box.h * 2)
          return c.toDataURL('image/png')
        }, b64, box)
        const f = `pins-${vpName}-${it.tag}-${r.id}.png`
        fs.writeFileSync(path.join(OUT, f), Buffer.from(url.split(',')[1], 'base64'))
        r.crop = f
      }
    }
  }
} finally {
  await browser.close()
}
fs.writeFileSync(path.join(OUT, `pins-${vpName}.json`), JSON.stringify(out, null, 1))
