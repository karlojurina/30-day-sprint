/**
 * Render the real world scene in headless Chrome and LOOK at it.
 *
 * This exists because three confident visual diagnoses shipped wrong on this
 * project, all of them from reasoning about a render nobody had seen.
 *
 * Two traps the README records, both hit the hard way:
 *   1. --virtual-time-budget NEVER settles against a requestAnimationFrame
 *      loop; the run just hangs. Wait on an explicit ready flag instead.
 *   2. loop() re-reads scrollDepth() every frame, so setting a depth variable
 *      is pulled straight back. Drive it by actually scrolling the page.
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.BASE_URL || 'http://localhost:3111'
// Relative to THIS file, not cwd — running from inside world-tests was
// producing world-tests/world-tests/shots.
const OUT = process.env.OUT_DIR || path.join(path.dirname(new URL(import.meta.url).pathname), 'shots')

// The two aspect ratios that have already bitten once: Lovro's split screen
// and his ultrawide.
const VIEWPORTS = [
  { name: 'split-1691x1278', width: 1691, height: 1278 },
  { name: 'ultrawide-3428x1230', width: 3428, height: 1230 },
]
const DEPTHS = [0, 0.5, 0.95]

fs.mkdirSync(OUT, { recursive: true })

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: [
    // SwiftShader gives headless Chrome a real software GL stack. Without
    // these the canvas renders black and every check below is meaningless.
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
  ],
})

const results = []
try {
  for (const vp of VIEWPORTS) {
    const page = await browser.newPage()
    await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1 })
    page.on('console', (m) => { if (m.type() === 'error') console.log('  [page error]', m.text()) })

    console.log(`\n→ ${vp.name}`)
    await page.goto(`${BASE}/dev/world`, { waitUntil: 'domcontentloaded', timeout: 60000 })

    // Trap 1: wait on the explicit flag, never on a time budget.
    await page.waitForFunction(
      () => window.__worldReady === true || typeof window.__worldError === 'string',
      { timeout: 120000, polling: 250 },
    )
    const err = await page.evaluate(() => window.__worldError)
    if (err) { console.log('  LOAD FAILED:', err); results.push({ vp: vp.name, error: err }); await page.close(); continue }
    console.log('  world loaded')

    for (const d of DEPTHS) {
      // Trap 2: drive it by SCROLLING, not by setting a variable.
      await page.evaluate((depth) => {
        const max = document.body.scrollHeight - window.innerHeight
        window.scrollTo(0, depth * max)
      }, d)
      // Let the exponential smoothing settle (6.0/s => ~1s is plenty).
      await new Promise((r) => setTimeout(r, 1800))

      const file = path.join(OUT, `${vp.name}-depth${String(d).replace('.', '_')}.png`)
      await page.screenshot({ path: file })

      // Sample the render rather than trusting it. Corner samples at the
      // BOTTOM of the frame are the world-border check: at any depth past the
      // shore the bottom corners should be TERRAIN. If they read as sky, the
      // mesh is narrower than the frustum — the exact bug that shipped twice.
      const probe = await page.evaluate(() => {
        const c = document.querySelector('canvas')
        if (!c) return null
        const g = c.getContext('webgl2') || c.getContext('webgl')
        const w = c.width, h = c.height
        const px = new Uint8Array(4)
        const read = (x, y) => {
          // WebGL origin is bottom-left.
          g.readPixels(x, y, 1, 1, g.RGBA, g.UNSIGNED_BYTE, px)
          return [px[0], px[1], px[2]]
        }
        const mean = (() => {
          const n = 24, acc = [0, 0, 0]
          for (let i = 0; i < n; i++) {
            const [r, gg, b] = read(Math.floor((i + 0.5) / n * w), Math.floor(h * 0.5))
            acc[0] += r; acc[1] += gg; acc[2] += b
          }
          return acc.map((v) => Math.round(v / n))
        })()
        return {
          size: [w, h],
          bottomLeft: read(Math.floor(w * 0.02), Math.floor(h * 0.04)),
          bottomRight: read(Math.floor(w * 0.98), Math.floor(h * 0.04)),
          bottomCentre: read(Math.floor(w * 0.5), Math.floor(h * 0.04)),
          midRow: mean,
          topCentre: read(Math.floor(w * 0.5), Math.floor(h * 0.96)),
        }
      })
      const markers = await page.evaluate(() => (window.__worldMarkers || []).filter((m) => m.visible).length)
      const actualDepth = await page.evaluate(() => window.__worldDepth)
      results.push({ vp: vp.name, depth: d, actualDepth, markers, probe, file })
      console.log(`  depth ${d} -> settled ${Number(actualDepth).toFixed(3)}, ${markers} markers visible`)
      console.log(`     bottomL ${probe.bottomLeft}  bottomC ${probe.bottomCentre}  bottomR ${probe.bottomRight}`)
      console.log(`     midRow  ${probe.midRow}   topC ${probe.topCentre}`)
    }
    await page.close()
  }
} finally {
  await browser.close()
}

fs.writeFileSync(path.join(OUT, 'probe.json'), JSON.stringify(results, null, 2))
console.log(`\nwrote ${results.length} samples + screenshots to ${OUT}`)
