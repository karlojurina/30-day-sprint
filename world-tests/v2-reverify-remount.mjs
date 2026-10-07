/**
 * Re-verify probe: remount the world 8 times by crossing the list-view
 * breakpoint (1691 -> 740 -> 1691). Counts live WebGL contexts, console
 * warnings (Chrome's "Too many active WebGL contexts") and errors, and checks
 * the world still renders and parks after the last remount.
 *
 *   node world-tests/v2-reverify-remount.mjs
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, 'shots', 'v2-verify', 'reverify', 'interaction')
fs.mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function trackContexts() {
  const orig = HTMLCanvasElement.prototype.getContext
  window.__ctx = { created: 0, lost: 0 }
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const had = this.__hadCtx
    const c = orig.call(this, type, ...rest)
    if (c && /webgl/i.test(String(type)) && !had) {
      this.__hadCtx = true
      window.__ctx.created++
      this.addEventListener('webglcontextlost', () => { window.__ctx.lost++ })
    }
    return c
  }
}

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  protocolTimeout: 900000,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
})
const out = { cycles: [] }
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(900000)
  const logs = { errors: [], warnings: [], glWarnings: [] }
  page.on('console', (m) => {
    const t = m.text()
    if (/too many active webgl contexts|oldest context will be lost/i.test(t)) logs.glWarnings.push(t.slice(0, 200))
    if (/GPU stall|GL Driver Message|swiftshader|Automatic fallback/i.test(t)) return
    if (m.type() === 'error') logs.errors.push(t.slice(0, 200))
    else if (m.type() === 'warning' || m.type() === 'warn') logs.warnings.push(t.slice(0, 200))
  })
  page.on('pageerror', (e) => logs.errors.push('[pageerror] ' + e.message.slice(0, 200)))
  await page.evaluateOnNewDocument(trackContexts)
  await page.setViewport({ width: 1691, height: 1278, deviceScaleFactor: 1 })
  await page.goto('http://localhost:3111/dev/world-v2', { waitUntil: 'domcontentloaded', timeout: 180000 })
  await page.bringToFront()
  await page.waitForFunction(() => window.__worldReady === true, { timeout: 300000, polling: 200 })
  for (let i = 0; i < 8; i++) {
    const t = Date.now()
    await page.setViewport({ width: 740, height: 1000, deviceScaleFactor: 1 })
    await page.waitForFunction(() => document.querySelector('main')?.dataset.view === 'list' && document.querySelectorAll('canvas').length === 0, { timeout: 120000, polling: 100 })
    await sleep(300)
    // __worldReady is a window global that survives the unmount: clear it so the
    // NEW mount's ready is what we wait for.
    await page.evaluate(() => { window.__worldReady = false })
    const tBack = Date.now()
    await page.setViewport({ width: 1691, height: 1278, deviceScaleFactor: 1 })
    await page.waitForFunction(() => document.querySelector('main')?.dataset.view === 'world' && !!document.querySelector('[class*="__stage"]'), { timeout: 120000, polling: 20 })
    // The window between the world view coming back and the new scene being ready.
    const during = await page.evaluate(() => {
      const cover = document.querySelector('[class*="__loading"]')
      const cs = cover ? getComputedStyle(cover) : null
      return {
        ready: !!window.__worldReady,
        canvases: document.querySelectorAll('canvas').length,
        coverDone: cover ? cover.hasAttribute('data-done') : null,
        coverVisible: cs ? cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05 : null,
        coverOpacity: cs ? cs.opacity : null,
        nextInert: !!document.querySelector('section[aria-label="Next lesson"]')?.inert,
        dockInert: !!document.querySelector('nav[aria-label="Areas"]')?.inert,
        markersInert: !!document.querySelector('[class*="__markers"]')?.inert,
        nextOpacity: getComputedStyle(document.querySelector('section[aria-label="Next lesson"]')).opacity,
      }
    })
    if (i === 0 || i === 7) await page.screenshot({ path: path.join(OUT, `remount-00-during-reload-cycle${i + 1}.png`) })
    await page.waitForFunction(() => window.__worldReady === true && document.querySelectorAll('canvas').length === 1, { timeout: 300000, polling: 100 })
    const reloadMs = Date.now() - tBack
    await sleep(500)
    const s = await page.evaluate(() => ({ ctx: { ...window.__ctx }, canvases: document.querySelectorAll('canvas').length, err: window.__worldError ?? null, heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null }))
    out.cycles.push({ i: i + 1, ms: Date.now() - t, reloadMs, during, ...s })
    console.log(`  during reload: ${JSON.stringify(during)}; ready after ${reloadMs} ms`)
    console.log(`cycle ${i + 1}: ${JSON.stringify(s)} ${Date.now() - t} ms`)
  }
  // Still works after the last remount: park a3 and look.
  await page.evaluate(() => window.scrollTo(0, Math.round(window.__worldScrollFor(0.3))))
  await page.waitForFunction(() => { const f = window.__worldFrame; return f && f.parkProgress === 0 && Math.abs(f.depth - 0.3) < 1e-3 }, { timeout: 600000, polling: 200 })
  await sleep(300)
  await page.screenshot({ path: path.join(OUT, 'remount-01-rail-after-8.png') })
  await page.evaluate(() => window.__worldPark('a3'))
  const parked = await page.waitForFunction(() => window.__worldFrame && window.__worldFrame.parkedId === 'a3' && window.__worldFrame.parkProgress === 1, { timeout: 600000, polling: 200 }).then(() => true).catch(() => false)
  await sleep(300)
  await page.screenshot({ path: path.join(OUT, 'remount-02-parked-after-8.png') })
  out.parkedAfter = parked
  out.logs = logs
  console.log(JSON.stringify({ parkedAfter: parked, glWarnings: logs.glWarnings.length, errors: logs.errors, warnings: logs.warnings.slice(0, 5) }, null, 1))
} finally {
  fs.writeFileSync(path.join(OUT, 'remount-probe.json'), JSON.stringify(out, null, 2))
  await browser.close()
}
