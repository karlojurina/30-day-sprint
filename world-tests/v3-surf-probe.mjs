/**
 * Surfaces probe: camera poses at the default view, a3 and a5 on /dev/world-v3
 * (960x600), so the surfaces lab renders from the same places.
 *   node world-tests/v3-surf-probe.mjs
 */
import puppeteer from 'puppeteer-core'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.BASE_URL || 'http://localhost:3111'
const ARGS = ['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--no-sandbox','--disable-dev-shm-usage','--hide-scrollbars']
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ARGS })
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(600000)
  await page.setViewport({ width: 960, height: 600, deviceScaleFactor: 1 })
  const route = process.argv[2] || '/dev/world-v3'
  await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 180000 })
  await page.waitForFunction(() => window.__worldReady === true || typeof window.__worldError === 'string', { polling: 250 })
  const out = {}
  for (const [id, d] of [['default', 0], ['a3', 0.30], ['a5', 0.5236]]) {
    await page.evaluate((x) => window.scrollTo(0, Math.round(window.__worldScrollFor(x))), d)
    await page.waitForFunction((x) => Math.abs((window.__worldDepth ?? -1) - x) < 2e-4, { polling: 200 }, d)
    await sleep(300)
    out[id] = await page.evaluate(() => window.__worldCamera())
  }
  console.log(JSON.stringify(out))
} finally { await browser.close() }
