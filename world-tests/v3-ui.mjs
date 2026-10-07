/**
 * Interface check for /dev/world-v3: one screenshot plus the numbers the
 * chrome is judged on, at one moment.
 *
 *   node world-tests/v3-ui.mjs <name> [--vp 960x600] [--depth 0] [--pitch low]
 *        [--hover k] [--focus-here] [--park a3] [--route /dev/world-v2]
 *
 * Prints JSON: visible words (same rule as the judge's word count), marker
 * label boxes and any overlap between them, every dock text box and any
 * overlap between those, the pitch the scene was handed, console errors.
 * PNG: world-tests/shots/v3/ui/<name>.png
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.BASE_URL || 'http://localhost:3111'
const OUT = path.join(HERE, 'shots', 'v3', 'ui')
fs.mkdirSync(OUT, { recursive: true })

const argv = process.argv.slice(2)
const name = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'ui'
const opt = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d)
const [W, H] = opt('vp', '960x600').split('x').map(Number)
const depth = Number(opt('depth', '0'))
const pitch = opt('pitch', null)
const hover = opt('hover', null)
const park = opt('park', null)
const route = opt('route', '/dev/world-v3') + (pitch ? `?pitch=${pitch}` : '')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function count() {
  const words = []
  const lines = []
  const vis = (el) => {
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e)
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false
      if (e.tagName === 'NEXTJS-PORTAL') return false
    }
    return true
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.textContent.trim()
    if (!t) continue
    const el = n.parentElement
    if (!el || !vis(el)) continue
    const r = document.createRange()
    r.selectNodeContents(n)
    const b = r.getBoundingClientRect()
    if (b.width < 1 || b.height < 1 || b.right < 0 || b.bottom < 0 || b.left > innerWidth || b.top > innerHeight) continue
    const cs = getComputedStyle(el)
    if (cs.clipPath === 'inset(50%)' || (el.offsetWidth <= 1 && el.offsetHeight <= 1)) continue
    const toks = t.split(/\s+/).filter(Boolean)
    words.push(...toks.filter((x) => /[A-Za-z]/.test(x)))
    lines.push(t)
  }
  return { words: words.length, lines }
}

function dockBoxes() {
  const nav = document.querySelector('nav[aria-label="Areas"]')
  if (!nav) return null
  const seen = (el) => {
    for (let e = el; e && e !== nav.parentElement; e = e.parentElement) if (Number(getComputedStyle(e).opacity) < 0.05) return false
    return true
  }
  const out = []
  for (const el of nav.querySelectorAll('span, button')) {
    if (el.children.length && el.tagName === 'BUTTON') continue
    const t = el.textContent.trim()
    if (!t || [...el.children].some((c) => c.textContent.trim() === t)) continue
    if (!seen(el)) continue
    const r = el.getBoundingClientRect()
    out.push({ t, l: Math.round(r.left), t0: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) })
  }
  const hits = []
  for (let i = 0; i < out.length; i++)
    for (let j = i + 1; j < out.length; j++) {
      const a = out[i]
      const c = out[j]
      if (a.l < c.r && c.l < a.r && a.t0 < c.b && c.t0 < a.b) hits.push(`${a.t} x ${c.t}`)
    }
  const nr = nav.getBoundingClientRect()
  return { nav: [Math.round(nr.left), Math.round(nr.top), Math.round(nr.right), Math.round(nr.bottom)], boxes: out, overlaps: hits }
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
})
const errors = []
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(600000)
  page.on('console', (m) => {
    const t = m.text()
    if (/GPU stall|GL Driver Message|WebGL-|swiftshader|Automatic fallback/i.test(t)) return
    if (m.type() === 'error') errors.push(t.slice(0, 300))
  })
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message.slice(0, 200)} :: ${(e.stack || '').split('\n').slice(1, 6).join(' <- ').slice(0, 900)}`))
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 })
  const t0 = Date.now()
  await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 180000 })
  await page.waitForFunction(() => window.__worldReady === true || typeof window.__worldError === 'string' || window.__worldView === 'list', { polling: 250 })
  const ready = Date.now() - t0
  if (depth > 0) await page.evaluate((x) => window.scrollTo(0, Math.round(window.__worldScrollFor(x))), depth)
  await page.waitForFunction(() => {
    const f = window.__worldFrame
    if (!f || !window.__worldScrollFor) return window.__worldView === 'list'
    const max = window.__worldScrollFor(0.88)
    const target = max > 0 ? Math.min(1, window.scrollY / max) * 0.88 : 0
    return f.parkProgress === 0 && Math.abs(f.depth - target) < 1e-6
  }, { polling: 300 })
  await page.evaluate(() => document.fonts.ready)
  if (park) {
    await page.evaluate((id) => window.__worldPark(id), park)
    await page.waitForFunction(() => (window.__worldFrame?.parkProgress ?? 0) >= 0.999, { polling: 300 })
  }
  if (hover !== null) {
    const box = await page.evaluate((k) => {
      const r = document.querySelectorAll('nav[aria-label="Areas"] [aria-label^="Travel to"]')[k].getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + 10 }
    }, Number(hover))
    await page.mouse.move(box.x, box.y)
  }
  let toggled = null
  if (argv.includes('--toggle')) {
    // Click the other pitch in the dev footer: a full page load that must come back at the same depth.
    const before = await page.evaluate(() => ({ depth: window.__worldDepth, pitch: window.__worldPitch }))
    const target = before.pitch === 'low' ? 'Game' : 'Low'
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 180000 }),
      page.evaluate((t) => [...document.querySelectorAll('footer a')].find((a) => a.textContent.trim() === t).click(), target),
    ])
    await page.waitForFunction(() => window.__worldReady === true || typeof window.__worldError === 'string', { polling: 250 })
    await page.waitForFunction(() => {
      const f = window.__worldFrame
      if (!f) return false
      const max = window.__worldScrollFor(0.88)
      const t = max > 0 ? Math.min(1, window.scrollY / max) * 0.88 : 0
      return f.parkProgress === 0 && Math.abs(f.depth - t) < 1e-6
    }, { polling: 300 })
    const after = await page.evaluate(() => ({ depth: window.__worldDepth, pitch: window.__worldPitch, url: location.pathname + location.search }))
    toggled = { before, after, depthDelta: Math.abs(after.depth - before.depth) }
  }
  if (argv.includes('--focus-here')) {
    await page.focus('nav[aria-label="Areas"] button[aria-label^="Enter"]')
    await page.keyboard.press('Shift')
  }
  await sleep(1200)
  const file = path.join(OUT, `${name}.png`)
  await page.screenshot({ path: file })
  const info = await page.evaluate(() => ({
    pitch: window.__worldPitch ?? null,
    view: window.__worldView ?? null,
    depth: window.__worldDepth ?? null,
    error: window.__worldError ?? null,
    frame: window.__worldFrame ? { tri: window.__worldFrame.triangles, calls: window.__worldFrame.calls } : null,
    labels: window.__worldLabelBoxes ? window.__worldLabelBoxes().map((b) => `${b.name}@${Math.round(b.left)},${Math.round(b.top)}-${Math.round(b.right)},${Math.round(b.bottom)}`) : [],
  }))
  const words = await page.evaluate(count)
  const dock = await page.evaluate(dockBoxes)
  const report = { name, route, toggled, vp: `${W}x${H}`, readyMs: ready, ...info, words: words.words, lines: words.lines.join(' | '), dockOverlaps: dock?.overlaps, dockNav: dock?.nav, errors: [...new Set(errors)].slice(0, 8), file }
  fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify({ ...report, dockBoxes: dock?.boxes }, null, 1))
  console.log(JSON.stringify(report, null, 1))
} finally {
  await browser.close()
}
