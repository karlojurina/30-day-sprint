/**
 * Interface check for /dev/world-v4: screenshots plus the numbers the chrome
 * and the tuning panel are judged on.
 *
 *   node world-tests/v4-ui.mjs <name> [--vp 960x600] [--at a3] [--lock look]
 *        [--frontier 2] [--finished 2] [--park a3] [--tune [--tune-scroll px]]
 *        [--click-locked a6] [--hover k]
 *   node world-tests/v4-ui.mjs checks [--vp 960x600]
 *
 * One-shot mode prints JSON: visible words (same rule as v3-ui.mjs), marker
 * label boxes, dock text boxes and any overlap between them, the scroll
 * range, the rail position, console errors. PNG: world-tests/shots/v4-pass3/ui/<name>.png
 *
 * "checks" runs the behaviour checks the tuning panel promises and exits 1 on
 * any failure:
 *   - open and look: the page scrolls the whole route (spacer = budgets + tail)
 *   - locked: the scroll ends just past the frontier (the scene's LOCK_PEEK_UNITS);
 *     no stop past it is reachable
 *   - look: a place past the frontier will not open, and says why
 *   - pacing: changing a budget keeps the camera where it is (within one scroll pixel)
 *   - progress: the header count follows "places finished"
 *   - every harness hook V3 had, plus __worldRailU, answers
 *   - grey pass 2: the default chrome stays at pass 1's 20 words; a8 reads Job
 *     Board / Guild Hall in the dock, the marker and the panel, and "Sky Port"
 *     is gone from the page; the panel has no dead Low camera option, says
 *     your airship waits at the bounty isle
 *   - grey pass 3: the flight has its own slider; the scroll and the a8 stop
 *     include it; the 08 slider moves the bridge and leaves the flight alone,
 *     the flight slider moves the flight; a4 reads Video Ads II / Mine Lift in
 *     the panel and nothing on the page mentions the pulley basket or the Climb
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.env.BASE_URL || 'http://localhost:3111'
const OUT = path.join(HERE, 'shots', 'v4-pass3', 'ui')
fs.mkdirSync(OUT, { recursive: true })

const argv = process.argv.slice(2)
const name = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'ui'
const opt = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d)
const [W, H] = opt('vp', '960x600').split('x').map(Number)
const route = '/dev/world-v4'
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
  return { boxes: out, overlaps: hits }
}

/**
 * Wait until the camera has arrived where the page scroll says, and nothing is
 * mid-park. The scene maps scroll in absolute vh (depth = scrolled vh / whole
 * budget, capped by the lock), so the target is known here. "Depth steady
 * across two reads" is not enough: on SwiftShader the first frame after a
 * scroll can take over a second, and two reads at the OLD depth look settled.
 */
async function settle(page, ms = 500) {
  let f = null
  for (let i = 0; i < 240; i++) {
    f = await page.evaluate(() => {
      const f = window.__worldFrame
      const t = window.__worldTuning?.()
      if (!f || !t) return null
      const total = t.scrollVh.reduce((a, b) => a + b, 0) + t.tailVh + (t.flightVh ?? 0)
      const max = window.__worldLock?.().maxDepth ?? 1
      const target = Math.min(max, (scrollY / innerHeight) * 100 / total)
      return { d: f.depth, target, p: f.parkProgress, fl: f.flight }
    })
    // 2e-5 of the whole budget is about 0.2 px of scroll: tight enough to measure a one-pixel move.
    if (f && Math.abs(f.d - f.target) < 2e-5 && (f.p === 0 || f.p >= 0.999) && f.fl >= 0.999) return f
    await sleep(ms)
  }
  return f
}

async function scrollToPlace(page, id) {
  await page.evaluate((pid) => window.scrollTo(0, Math.round(window.__worldScrollFor(window.__worldDepthFor(pid)))), id)
  return settle(page)
}

async function open(browser, errors) {
  const page = await browser.newPage()
  page.setDefaultTimeout(600000)
  page.on('console', (m) => {
    const t = m.text()
    if (/GPU stall|GL Driver Message|WebGL-|swiftshader|Automatic fallback/i.test(t)) return
    if (m.type() === 'error') errors.push(t.slice(0, 300))
  })
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message.slice(0, 200)} :: ${(e.stack || '').split('\n').slice(1, 5).join(' <- ').slice(0, 700)}`))
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 })
  const t0 = Date.now()
  await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 180000 })
  await page.waitForFunction(() => window.__worldReady === true || typeof window.__worldError === 'string' || window.__worldView === 'list', { polling: 250 })
  const err = await page.evaluate(() => window.__worldError ?? null)
  if (err) throw new Error(`scene failed: ${err}`)
  await page.evaluate(() => document.fonts.ready)
  return { page, readyMs: Date.now() - t0 }
}

const scrollInfo = (page) =>
  page.evaluate(() => {
    const max = document.documentElement.scrollHeight - innerHeight
    return { max, maxVh: (max / innerHeight) * 100, y: scrollY, railU: window.__worldRailU?.() ?? null, depth: window.__worldDepth ?? null }
  })

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
})
const errors = []
let failed = false
try {
  if (name !== 'checks') {
    const { page, readyMs } = await open(browser, errors)
    const patch = {}
    if (opt('lock', null)) patch.lock = opt('lock')
    if (opt('frontier', null) !== null) patch.frontier = Number(opt('frontier'))
    if (opt('finished', null) !== null) patch.finished = Number(opt('finished'))
    if (Object.keys(patch).length) await page.evaluate((p) => window.__worldTune(p), patch)
    const at = opt('at', null)
    if (at) await scrollToPlace(page, at)
    else await settle(page)
    const park = opt('park', null)
    if (park) {
      await page.evaluate((id) => window.__worldPark(id), park)
      await page.waitForFunction(() => (window.__worldFrame?.parkProgress ?? 0) >= 0.999, { polling: 300 })
    }
    const clickLocked = opt('click-locked', null)
    if (clickLocked) {
      await page.evaluate((id) => window.__worldPark(id), clickLocked)
    }
    const hover = opt('hover', null)
    if (hover !== null) {
      const box = await page.evaluate((k) => {
        // The track is the dock's second child; its buttons are the eight stops.
        const r = document.querySelectorAll('nav[aria-label="Areas"] > div:nth-child(2) > button')[k]?.getBoundingClientRect()
        return r ? { x: r.left + r.width / 2, y: r.top + 10 } : null
      }, Number(hover))
      if (box) await page.mouse.move(box.x, box.y)
    }
    if (argv.includes('--tune')) {
      await page.evaluate(() => [...document.querySelectorAll('footer button')].find((b) => b.textContent.trim().startsWith('Tune')).click())
      // --tune-scroll <px>: scroll the open panel (it scrolls inside itself when taller than the screen).
      const ts = opt('tune-scroll', null)
      if (ts !== null) {
        await sleep(300)
        await page.evaluate((px) => {
          const sec = document.querySelector('section[aria-label="Tuning (dev only)"]')
          for (let e = sec; e && e !== document.body; e = e.parentElement) if (e.scrollHeight > e.clientHeight + 1) e.scrollTop = px
        }, Number(ts))
      }
    }
    await sleep(1400)
    const file = path.join(OUT, `${name}.png`)
    await page.screenshot({ path: file })
    const info = await page.evaluate(() => ({
      view: window.__worldView ?? null,
      tuning: window.__worldTuning?.() ?? null,
      frame: window.__worldFrame ? { tri: window.__worldFrame.triangles, calls: window.__worldFrame.calls, park: window.__worldFrame.parkProgress } : null,
      labels: window.__worldLabelBoxes ? window.__worldLabelBoxes().map((b) => `${b.name}${b.locked ? '(locked)' : ''}@${Math.round(b.left)},${Math.round(b.top)}-${Math.round(b.right)},${Math.round(b.bottom)}`) : [],
      hint: document.querySelector('nav[aria-label="Areas"] [role="status"]')?.textContent ?? null,
    }))
    const words = await page.evaluate(count)
    const dock = await page.evaluate(dockBoxes)
    const report = { name, route, vp: `${W}x${H}`, readyMs, ...info, scroll: await scrollInfo(page), words: words.words, lines: words.lines.join(' | '), dockOverlaps: dock?.overlaps, errors: [...new Set(errors)].slice(0, 8), file }
    fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify({ ...report, dockBoxes: dock?.boxes }, null, 1))
    console.log(JSON.stringify(report, null, 1))
  } else {
    const results = []
    const check = (label, pass, value) => {
      results.push({ label, pass, value })
      if (!pass) failed = true
      console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
    }
    const { page, readyMs } = await open(browser, errors)
    check('ready', true, `${readyMs} ms`)
    await page.evaluate(() => window.__worldTune('reset'))
    await settle(page)

    // Hooks.
    const hooks = await page.evaluate(() =>
      ['__worldReady', '__worldDepth', '__worldScrollFor', '__worldPark', '__worldCamera', '__worldFrame', '__worldLabelBoxes', '__worldRailU'].map((k) => [k, k in window]),
    )
    check('harness hooks present', hooks.every(([, v]) => v), hooks.filter(([, v]) => !v).map(([k]) => k).join(',') || 'all 8')
    const railU0 = await page.evaluate(() => window.__worldRailU())
    check('__worldRailU at the top', typeof railU0 === 'number' && railU0 >= 0 && railU0 < 0.02, railU0)
    // Pass 1's default chrome at 960x600 was 20 words (shots/v4/ui/real-default.json).
    const words0 = await page.evaluate(count)
    check('default chrome: no more words than pass 1 (20)', words0.words <= 20, `${words0.words} words: ${words0.lines.join(' | ')}`)

    // Open: the whole route scrolls.
    const t = await page.evaluate(() => window.__worldTuning())
    const routeVh = t.scrollVh.reduce((a, b) => a + b, 0) + t.tailVh + (t.flightVh ?? 0)
    let si = await scrollInfo(page)
    check('open: scroll length = sum of budgets + tail', Math.abs(si.maxVh - routeVh) < 1, `${si.maxVh.toFixed(1)} vh vs ${routeVh}`)
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await settle(page)
    si = await scrollInfo(page)
    check('open: bottom of the page = end of the rail', Math.abs(si.railU - 1) < 0.01, si.railU)

    // Stops: each place's depth maps to its scroll position and back.
    const stops = await page.evaluate(() => ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'].map((id) => ({ id, d: window.__worldDepthFor(id), y: window.__worldScrollFor(window.__worldDepthFor(id)) })))
    const stopVh = stops.map((s) => (s.y / H) * 100)
    let acc = 0
    const expectVh = t.scrollVh.map((v, k) => (acc += v + (k === 7 ? t.flightVh ?? 0 : 0)))
    const worst = Math.max(...stopVh.map((v, k) => Math.abs(v - expectVh[k])))
    check('each stop sits at the running sum of the budgets', worst < 2, `worst ${worst.toFixed(2)} vh; ${stopVh.map((v) => v.toFixed(0)).join(', ')}`)

    // Pacing keeps the camera in place: halfway along the a3 -> a4 stretch,
    // changing two budgets BEFORE it (so the scroll must move) and its own.
    await page.evaluate(() => {
      const a = window.__worldScrollFor(window.__worldDepthFor('a3'))
      const b = window.__worldScrollFor(window.__worldDepthFor('a4'))
      window.scrollTo(0, Math.round((a + b) / 2))
    })
    await settle(page)
    const before = await page.evaluate(() => ({ d: window.__worldDepth, cam: window.__worldCamera() }))
    await page.evaluate(() => {
      const t = window.__worldTuning()
      const vh = t.scrollVh.slice()
      vh[0] = 320
      vh[1] = 90
      vh[3] = 260
      window.__worldTune({ scrollVh: vh })
    })
    await settle(page)
    const after = await page.evaluate(() => ({ d: window.__worldDepth, cam: window.__worldCamera(), max: document.documentElement.scrollHeight - innerHeight }))
    const moved = Math.hypot(after.cam.x - before.cam.x, after.cam.y - before.cam.y, after.cam.z - before.cam.z)
    // The page scroll lands on whole pixels, so the camera can only come back to
    // within one scroll pixel of where it was. Measure what one pixel is worth here.
    await page.evaluate(() => window.scrollBy(0, 10))
    await settle(page)
    const nudged = await page.evaluate(() => window.__worldCamera())
    const onePx = Math.hypot(nudged.x - after.cam.x, nudged.y - after.cam.y, nudged.z - after.cam.z) / 10
    await page.evaluate(() => window.scrollBy(0, -10))
    await settle(page)
    check('pacing change keeps the camera where it is (within one scroll pixel)', moved <= onePx + 0.05, `camera moved ${moved.toFixed(2)} units; one scroll pixel here = ${onePx.toFixed(2)}`)
    const t2 = await page.evaluate(() => window.__worldTuning())
    const route2 = t2.scrollVh.reduce((a, b) => a + b, 0) + t2.tailVh + (t2.flightVh ?? 0)
    check('pacing change resizes the scroll', Math.abs((after.max / H) * 100 - route2) < 1, `${((after.max / H) * 100).toFixed(1)} vh vs ${route2}`)
    await page.evaluate(() => window.__worldTune('reset'))
    await settle(page)

    // Look: past the frontier nothing opens.
    await page.evaluate(() => window.__worldTune({ lock: 'look', frontier: 2, finished: 2 }))
    si = await scrollInfo(page)
    check('look: the whole route still scrolls', Math.abs(si.maxVh - routeVh) < 1, `${si.maxVh.toFixed(1)} vh`)
    await scrollToPlace(page, 'a5')
    await page.evaluate(() => window.__worldPark('a5'))
    await sleep(1500)
    const lookPark = await page.evaluate(() => ({ p: window.__worldFrame.parkProgress, id: window.__worldFrame.parkedId, hint: document.querySelector('nav[aria-label="Areas"] [role="status"]')?.textContent ?? null, panel: !!document.querySelector('section[aria-labelledby="v4-panel-title"]') }))
    check('look: a5 will not open with the student at a3', lookPark.p === 0 && lookPark.id === null && !lookPark.panel, lookPark)
    check('look: and says why', /Finish Video Ads I first/.test(lookPark.hint ?? ''), lookPark.hint)
    await page.screenshot({ path: path.join(OUT, 'check-look-hint.png') })
    await page.evaluate(() => window.__worldPark('a2'))
    await page.waitForFunction(() => (window.__worldFrame?.parkProgress ?? 0) >= 0.999, { polling: 300 })
    check('look: a2 (behind the frontier) opens', true, 'parked')
    await page.evaluate(() => window.__worldPark(null))
    await page.waitForFunction(() => document.body.style.overflow !== 'hidden' && (window.__worldFrame?.parkProgress ?? 1) === 0, { polling: 300 })

    // Locked: the scroll ends just past the frontier.
    await page.evaluate(() => window.__worldTune({ lock: 'locked', frontier: 2, finished: 2 }))
    await settle(page)
    si = await scrollInfo(page)
    // The scene's rule (scene.ts LOCK_PEEK_UNITS): a set distance past the frontier stop,
    // read back from the scene as depth; the spacer adds one screen for the last view.
    const lockVh = (await page.evaluate(() => window.__worldV4Debug.lockLimit())) * (t.scrollVh.reduce((a, b) => a + b, 0) + t.tailVh + (t.flightVh ?? 0))
    check('locked: scroll length = up to the frontier + a short look ahead', Math.abs(si.maxVh - lockVh) < 1, `${si.maxVh.toFixed(1)} vh vs ${lockVh.toFixed(1)}`)
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await settle(page)
    const endLocked = await page.evaluate(() => ({ d: window.__worldDepth, a3: window.__worldDepthFor('a3'), a4: window.__worldDepthFor('a4'), u: window.__worldRailU() }))
    check('locked: the bottom sits past a3 and short of a4', endLocked.d > endLocked.a3 && endLocked.d < endLocked.a4, endLocked)
    await page.screenshot({ path: path.join(OUT, 'check-locked-end.png') })
    const jumpDisabled = await page.evaluate(() => {
      document.querySelector('footer button[aria-expanded]').click()
      return new Promise((r) => requestAnimationFrame(() => r([...document.querySelectorAll('button[aria-label^="Jump to"]')].map((b) => b.disabled))))
    })
    check('locked: jump buttons past the frontier are disabled', jumpDisabled.join() === 'false,false,false,true,true,true,true,true', jumpDisabled.join())
    await sleep(600)
    await page.screenshot({ path: path.join(OUT, 'check-locked-panel.png') })

    // Progress drives the header count.
    const hdr = async () => page.evaluate(() => document.querySelector('header [aria-label$="lessons done"]').getAttribute('aria-label'))
    await page.evaluate(() => window.__worldTune({ lock: 'open', finished: 6, frontier: 6 }))
    await sleep(300)
    const h6 = await hdr()
    check('progress: 6 finished + 4 in Creative Strategy = 113 lessons', h6.startsWith('113 of'), h6)
    await page.evaluate(() => window.__worldTune('reset'))
    await settle(page)

    // Grey pass 2: the tuning panel.
    const panel = () =>
      page.evaluate(() => {
        let sec = document.querySelector('section[aria-label="Tuning (dev only)"]')
        if (!sec) {
          document.querySelector('footer button[aria-expanded]').click()
          return null
        }
        const ride = [...sec.querySelectorAll('p')].find((p) => p.textContent.startsWith('The flight to the Harbour Isle'))
        return {
          legends: [...sec.querySelectorAll('legend')].map((l) => l.textContent.trim()),
          low: [...sec.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Low'),
          progress: [...sec.querySelectorAll('p')].map((p) => p.textContent).find((t) => t.startsWith('A lantern')) ?? null,
          ride: ride ? ride.textContent.replace(/\s+/g, ' ') : null,
        }
      })
    let pn = await panel()
    if (!pn) {
      await sleep(400)
      pn = await panel()
    }
    check('panel: the dead Low camera option is gone', pn && !pn.low && !pn.legends.includes('Camera'), pn?.legends)
    check('panel: your airship waits at the bounty isle at 7', /At 7 your airship waits at the bounty isle/.test(pn?.progress ?? ''), pn?.progress)
    const rideOf = (t) => {
      const m = /rope bridge takes (\d+) vh of it; the flight, measured on the rail, (\d+) vh/.exec(t ?? '')
      return m ? { bridge: Number(m[1]), flight: Number(m[2]) } : null
    }
    const ride1 = rideOf(pn?.ride)
    const t0 = await page.evaluate(() => window.__worldTuning())
    check('panel: 08 line shows the bridge and the flight', !!ride1 && ride1.bridge > 0 && ride1.flight > 0, pn?.ride)
    check('pass 3: the flight takes its own budget on the rail', !!ride1 && Math.abs(ride1.flight - t0.flightVh) <= 3, { ride: ride1, flightVh: t0.flightVh })
    const flightSlider = await page.evaluate(() => {
      const sec = document.querySelector('section[aria-label="Tuning (dev only)"]')
      const row = [...(sec?.querySelectorAll('label') ?? [])].find((l) => /The flight/.test(l.textContent))
      return row ? { hasRange: !!row.querySelector('input[type="range"]'), value: row.querySelector('output')?.textContent ?? null } : null
    })
    check('pass 3: the panel has a flight slider', !!flightSlider && flightSlider.hasRange && Number(flightSlider.value) === t0.flightVh, flightSlider)
    await page.evaluate(() => {
      const vh = window.__worldTuning().scrollVh.slice()
      vh[7] *= 2
      window.__worldTune({ scrollVh: vh })
    })
    await sleep(300)
    const ride2 = rideOf((await panel())?.ride)
    check(
      'panel: doubling the 08 slider about doubles the bridge and leaves the flight alone',
      !!ride1 && !!ride2 && ride2.bridge > 1.8 * ride1.bridge && Math.abs(ride2.flight - ride1.flight) <= 3,
      { before: ride1, after: ride2 },
    )
    await page.evaluate(() => window.__worldTune('reset'))
    await settle(page)
    await page.evaluate(() => window.__worldTune({ flightVh: window.__worldTuning().flightVh * 2 }))
    await sleep(300)
    const ride3 = rideOf((await panel())?.ride)
    const t3 = await page.evaluate(() => window.__worldTuning())
    const si3 = await scrollInfo(page)
    const route3 = t3.scrollVh.reduce((a, b) => a + b, 0) + t3.tailVh + t3.flightVh
    check(
      'pass 3: doubling the flight slider doubles the flight and grows the scroll',
      !!ride1 && !!ride3 && ride3.flight > 1.8 * ride1.flight && Math.abs(ride3.bridge - ride1.bridge) <= 3 && Math.abs(si3.maxVh - route3) < 1,
      { before: ride1, after: ride3, scrollVh: si3.maxVh.toFixed(1), route3 },
    )
    const a8vh = await page.evaluate(() => (window.__worldScrollFor(window.__worldDepthFor('a8')) / innerHeight) * 100)
    const a8expect = t3.scrollVh.reduce((a, b) => a + b, 0) + t3.flightVh
    check('pass 3: the a8 stop moves with the flight slider', Math.abs(a8vh - a8expect) < 2, `${a8vh.toFixed(1)} vh vs ${a8expect}`)
    await page.evaluate(() => window.__worldTune('reset'))
    await settle(page)

    // Grey pass 3: a4 is Video Ads II / Mine Lift; the pulley basket and the Climb are gone.
    await scrollToPlace(page, 'a4')
    await page.evaluate(() => window.__worldPark('a4'))
    await page.waitForFunction(() => (window.__worldFrame?.parkProgress ?? 0) >= 0.999, { polling: 300 })
    await sleep(600)
    const a4Panel = await page.evaluate(() => {
      const sec = document.querySelector('section[aria-labelledby="v4-panel-title"]')
      return { eyebrow: sec?.querySelector('p')?.textContent ?? null, title: sec?.querySelector('h2')?.textContent ?? null }
    })
    check('a4: panel says 04 / Mine Lift, Video Ads II', a4Panel.eyebrow === '04/Mine Lift' && a4Panel.title === 'Video Ads II', a4Panel)
    await page.screenshot({ path: path.join(OUT, 'check-a4-panel.png') })
    const stale = await page.evaluate(() => {
      const labels = [...document.querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label'))
      return [document.body.textContent, ...labels].filter((t) => /pulley|basket|the climb/i.test(t ?? '')).length
    })
    check('a4: no pulley basket or Climb anywhere on the page', stale === 0, `${stale} hits`)
    await page.evaluate(() => window.__worldPark(null))
    await page.waitForFunction(() => document.body.style.overflow !== 'hidden' && (window.__worldFrame?.parkProgress ?? 1) === 0, { polling: 300 })

    // Grey pass 2: a8 is Job Board / Guild Hall everywhere, Sky Port nowhere.
    const a8Chrome = await page.evaluate(() => ({
      stop: document.querySelectorAll('nav[aria-label="Areas"] > div:nth-child(2) > button')[7]?.getAttribute('aria-label') ?? null,
      marker: [...document.querySelectorAll('button[data-mode]')][7]?.getAttribute('aria-label') ?? null,
      jump: document.querySelector('button[aria-label="Jump to Job Board"]') !== null,
    }))
    check('a8: dock stop, marker and jump say Job Board', a8Chrome.stop === 'Travel to Job Board' && /^Job Board,/.test(a8Chrome.marker ?? '') && a8Chrome.jump, a8Chrome)
    await scrollToPlace(page, 'a8')
    await page.evaluate(() => window.__worldPark('a8'))
    await page.waitForFunction(() => (window.__worldFrame?.parkProgress ?? 0) >= 0.999, { polling: 300 })
    await sleep(600)
    const a8Panel = await page.evaluate(() => {
      const sec = document.querySelector('section[aria-labelledby="v4-panel-title"]')
      return { eyebrow: sec?.querySelector('p')?.textContent ?? null, title: sec?.querySelector('h2')?.textContent ?? null }
    })
    check('a8: panel says 08 / Guild Hall, Job Board', a8Panel.eyebrow === '08/Guild Hall' && a8Panel.title === 'Job Board', a8Panel)
    await page.screenshot({ path: path.join(OUT, 'check-a8-panel.png') })
    const skyPort = await page.evaluate(() => {
      const labels = [...document.querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label'))
      return [document.body.textContent, ...labels].filter((t) => /sky ?port/i.test(t ?? '')).length
    })
    check('a8: "Sky Port" appears nowhere on the page', skyPort === 0, `${skyPort} hits`)
    await page.evaluate(() => window.__worldPark(null))
    await page.waitForFunction(() => document.body.style.overflow !== 'hidden' && (window.__worldFrame?.parkProgress ?? 1) === 0, { polling: 300 })

    const fatal = errors.filter((e) => !/Download the React DevTools/.test(e))
    check('no console errors', fatal.length === 0, fatal.slice(0, 4))
    fs.writeFileSync(path.join(OUT, 'checks.json'), JSON.stringify({ vp: `${W}x${H}`, results, errors }, null, 1))
  }
} finally {
  await browser.close()
}
process.exit(failed ? 1 : 0)
