// Render the area screen at both ends of the real catalog spread, and at
// phone width, so "does 25 read as crammed / does 8 read as empty" is
// answered by looking rather than by guessing.
import puppeteer from 'puppeteer-core'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'shots')
fs.mkdirSync(OUT, { recursive: true })

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
})

const CASES = [
  { size: 25, vp: { width: 1691, height: 1278 }, name: '25-desktop' },
  { size: 8,  vp: { width: 1691, height: 1278 }, name: '08-desktop' },
  { size: 25, vp: { width: 390, height: 844 },   name: '25-phone' },
]

for (const c of CASES) {
  const page = await browser.newPage()
  await page.setViewport({ ...c.vp, deviceScaleFactor: 1 })
  await page.goto(`http://localhost:3111/dev/area?size=${c.size}`, { waitUntil: 'networkidle0', timeout: 60000 })
  await new Promise((r) => setTimeout(r, 900))
  const file = path.join(OUT, `area-${c.name}.png`)
  await page.screenshot({ path: file, fullPage: false })

  const m = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('li > a')]
    const panel = document.querySelector('h1')?.closest('div')?.parentElement
    const body = document.body
    return {
      rows: rows.length,
      rowHeight: rows[0] ? Math.round(rows[0].getBoundingClientRect().height) : 0,
      firstRowTop: rows[0] ? Math.round(rows[0].getBoundingClientRect().top) : 0,
      lastRowBottom: rows.length ? Math.round(rows[rows.length - 1].getBoundingClientRect().bottom) : 0,
      viewportH: window.innerHeight,
      // The page body must never scroll sideways.
      horizontalOverflow: body.scrollWidth > window.innerWidth + 1,
      panelWidth: panel ? Math.round(panel.getBoundingClientRect().width) : 0,
    }
  })
  console.log(`${c.name.padEnd(12)} rows=${String(m.rows).padStart(2)} rowH=${m.rowHeight}px  ` +
              `firstTop=${m.firstRowTop} lastBottom=${m.lastRowBottom} vh=${m.viewportH}  ` +
              `panelW=${m.panelWidth}  hOverflow=${m.horizontalOverflow}`)
  if (m.horizontalOverflow) console.log('   FAIL: the page scrolls sideways')
  await page.close()
}
await browser.close()
console.log('\nshots in', OUT)
