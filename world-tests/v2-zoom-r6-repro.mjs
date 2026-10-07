/**
 * Repro for the zoom verifier's R6: unpark, then click the same area again
 * 0.4 s (scene clock) into the flight back. Prints the scene's own state
 * every poll so a stuck flight shows WHERE it is stuck.
 *   node world-tests/v2-zoom-r6-repro.mjs [--vp split] [--at 0.4] [--gate off]
 * --gate off repeats it without holding frames (wall clock), to rule the harness out.
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const HERE = path.dirname(fileURLToPath(import.meta.url))
const src = fs.readFileSync(path.join(HERE, 'v2-zoom-verify.mjs'), 'utf8')
// Reuse the verifier's in-page helpers verbatim.
const grab = (name) => { const i = src.indexOf(`function ${name}(`); let d = 0, j = src.indexOf('{', i); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break } return src.slice(i, j + 1) }
const installGate = new Function(`return (${grab('installGate')})`)()
const installZV = new Function(`return (${grab('installZV')})`)()
const args = process.argv.slice(2)
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d)
const VPS = { split: [1691, 1278], ultra: [3428, 1230], laptop: [1440, 900] }
const [W, H] = VPS[arg('--vp', 'split')]
const AT = Number(arg('--at', '0.4'))
const GATE = arg('--gate', 'on') !== 'off'
const OUT = path.join(HERE, 'shots', 'v2-verify', 'zoom')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, protocolTimeout: 1800000,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] })
const page = await browser.newPage()
const errors = []
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warn') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(String(e)))
await page.evaluateOnNewDocument(installGate)
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 })
await page.goto('http://localhost:3111/dev/world-v2', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.__worldReady === true, { timeout: 300000 })
await page.evaluate(installZV, 'v2')
const state = () => page.evaluate(() => {
  const s = window.__zv.inst
  const f = window.__worldFrame
  return { clock: +window.__gate.clock.toFixed(3), mode: s.mode, parkedId: s.parkedId, p: +s.parkProgress.toFixed(4), frameP: f && +f.parkProgress.toFixed(4), framePid: f && f.parkedId, el: +s.flightElapsed.toFixed(3), T: +s.flightDuration.toFixed(3), toRail: s.flightToRail, raf: s.raf, dirty: s.dirty, paused: s.paused, open: !!document.querySelector('main[data-open]'), overflow: document.body.style.overflow, held: window.__gate.held, frames: window.__worldFrameCount }
})
await page.evaluate(() => window.scrollTo(0, Math.round(window.__worldScrollFor(0.3))))
await page.waitForFunction(() => window.__worldFrame && Math.abs(window.__worldFrame.depth - window.scrollY / window.__worldScrollFor(0.88) * 0.88) < 1e-9, { timeout: 600000, polling: 200 })
await sleep(500)
console.log('settled', JSON.stringify(await state()))
await page.evaluate(() => { window.__gate.start(performance.now()); window.__worldPark('a3') })
await page.waitForFunction(() => window.__zv.inst.mode === 'parked', { timeout: 600000, polling: 100 })
await sleep(300)
console.log('parked', JSON.stringify(await state()))
if (GATE) {
  await page.evaluate(() => { window.__gate.hold(); window.__gate.start(performance.now()); window.__worldPark(null) })
  await page.evaluate((s) => { window.__gate.holdAt = s; window.__gate.release() }, AT)
  await page.waitForFunction(() => window.__gate.held, { timeout: 600000, polling: 50 })
  console.log('held at', JSON.stringify(await state()))
  await page.evaluate(() => window.__worldPark('a3'))
  console.log('after re-park call (held)', JSON.stringify(await state()))
  await page.evaluate(() => window.__gate.release())
} else {
  await page.evaluate(() => { window.__gate.start(performance.now()); window.__worldPark(null) })
  await page.waitForFunction((s) => window.__gate.clock >= s, { timeout: 600000, polling: 20 }, AT)
  await page.evaluate(() => window.__worldPark('a3'))
  console.log('after re-park call (free)', JSON.stringify(await state()))
}
const t0 = Date.now()
let last = ''
while (Date.now() - t0 < 90000) {
  const s = await state()
  const line = JSON.stringify(s)
  if (line !== last) console.log(((Date.now() - t0) / 1000).toFixed(1) + 's', line)
  last = line
  if (s.mode === 'parked' && s.frameP === 1) break
  await sleep(1000)
}
await page.screenshot({ path: path.join(OUT, `v2-${arg('--vp', 'split')}-r6-repro-${GATE ? 'gate' : 'free'}.png`) })
console.log('errors', JSON.stringify(errors.slice(0, 5)))
await browser.close()
