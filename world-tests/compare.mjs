// A/B the ported scene against the PUBLISHED prototype at the same viewport
// and depth. The prototype is what Lovro saw and approved, so it is the
// reference — any difference is a regression I introduced in the port.
import puppeteer from 'puppeteer-core'
import path from 'node:path'
import fs from 'node:fs'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const OUT = path.join(process.cwd(), 'shots')
fs.mkdirSync(OUT, { recursive: true })

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
         '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
})

const shoot = async (url, name, readyCheck) => {
  const page = await browser.newPage()
  await page.setViewport({ width: 1691, height: 1278, deviceScaleFactor: 1 })
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForFunction(readyCheck, { timeout: 180000, polling: 300 })
  await page.evaluate(() => {
    const max = document.body.scrollHeight - window.innerHeight
    window.scrollTo(0, 0.5 * max)
  })
  await new Promise((r) => setTimeout(r, 2500))
  const file = path.join(OUT, `AB-${name}.png`)
  await page.screenshot({ path: file })
  console.log('  shot', name)
  await page.close()
  return file
}

// The prototype signals readiness by hiding its poster card.
await shoot('http://localhost:3222/index.html', 'prototype',
  () => document.getElementById('poster')?.classList.contains('gone') === true)
await shoot('http://localhost:3111/dev/world', 'port',
  () => window.__worldReady === true)

await browser.close()
console.log('done')

// ── Turn "they look the same" into a number ──────────────────────────
// The prototype draws HUD text in the corners that the port does not, so a
// full-frame diff would be dominated by chrome. Compare the CENTRE crop,
// which is all world.
const browser2 = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const page = await browser2.newPage()
const toDataUrl = (p) => 'data:image/png;base64,' + fs.readFileSync(p).toString('base64')
const diff = await page.evaluate(async (a, b) => {
  const load = (src) => new Promise((res, rej) => {
    const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src
  })
  const [ia, ib] = await Promise.all([load(a), load(b)])
  if (ia.width !== ib.width || ia.height !== ib.height) return { error: 'size mismatch' }
  const W = ia.width, H = ia.height
  const x0 = Math.floor(W * 0.20), x1 = Math.floor(W * 0.80)
  const y0 = Math.floor(H * 0.15), y1 = Math.floor(H * 0.85)
  const cw = x1 - x0, ch = y1 - y0
  const grab = (img) => {
    const c = document.createElement('canvas'); c.width = cw; c.height = ch
    const g = c.getContext('2d', { willReadFrequently: true })
    g.drawImage(img, x0, y0, cw, ch, 0, 0, cw, ch)
    return g.getImageData(0, 0, cw, ch).data
  }
  const da = grab(ia), db = grab(ib)
  let sum = 0, n = 0, worst = 0
  for (let i = 0; i < da.length; i += 4) {
    const d = (Math.abs(da[i] - db[i]) + Math.abs(da[i+1] - db[i+1]) + Math.abs(da[i+2] - db[i+2])) / 3
    sum += d; n++; if (d > worst) worst = d
  }
  // Mean channel value, to catch the washed-out-emissive class of bug.
  let bright = 0
  for (let i = 0; i < db.length; i += 4) bright += (db[i] + db[i+1] + db[i+2]) / 3
  return { meanDiff: +(sum / n).toFixed(2), worstPixel: worst, portBrightness: +(bright / n).toFixed(1), crop: [cw, ch] }
}, toDataUrl(path.join(OUT, 'AB-prototype.png')), toDataUrl(path.join(OUT, 'AB-port.png')))
await browser2.close()

console.log('\ncentre-crop comparison, port vs published prototype:')
console.log(' ', JSON.stringify(diff))
if (diff.error) { console.log('  FAIL:', diff.error); process.exit(1) }
// The two settle at slightly different rail depths (the prototype's own HUD
// affects document height), so a small diff is expected. A washed-out or
// blank render would be enormous.
console.log(diff.meanDiff < 25
  ? `  PASS — the port matches the approved prototype (mean channel diff ${diff.meanDiff}/255)`
  : `  LOOK — mean diff ${diff.meanDiff} is high enough to eyeball the two shots`)
console.log(diff.portBrightness > 30 && diff.portBrightness < 160
  ? `  PASS — brightness ${diff.portBrightness} is in the sunset range (a washed-out emissive bug reads >200)`
  : `  FAIL — brightness ${diff.portBrightness} is outside the expected range`)
