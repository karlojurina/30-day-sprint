/**
 * Map review 2026-10-15, plan item 13: Creative Strategy's stars through the
 * telescope (src/lib/world-v6/nightsky.ts), on the dev page in a real browser.
 *
 *   node world-tests/v6-stars.mjs
 *
 * Runs against http://localhost:3111/dev/world-app (BASE_URL overrides), which
 * must already be up: this script never starts a server. The pretend student
 * of FixtureStudentProvider.tsx, no login, no server call. Headless Chrome on
 * the real GPU, pixel ratio 1. About 2 minutes.
 *
 * WHAT IS MEASURED IS WHAT IS DRAWN. With the camera parked at the telescope
 * (window.__worldPark('a7')), the page renders the two constellation meshes
 * alone on black (everything else hidden for that one render, then put back)
 * and reads the pixels. Each of Creative Strategy's stars is found where its
 * direction projects (the instances nightsky's stats() names: heroFirst on,
 * heroStars of them, in the order they light): lit when its brightest pixel
 * within 3 px reaches LIT, drawn dim when it reaches DIM, missing below. The
 * bright blobs (LIT and over) are also counted over the whole frame, so a lit
 * star anywhere else would show. A line counts as drawn when the middle of its
 * span between its two stars reaches LINE.
 *
 * Rows:
 *   1  The real course (?catalog=course), nothing watched: one star per
 *      Creative Strategy lesson that counts (18; the Ad Bounty row is a
 *      feature row, not a lesson), none lit, every one drawn, no line; every
 *      star inside the lens's clear circle, right of the panel and under the
 *      sky caption, and a gap of at least GAP_VH between any two.
 *   2  6 of its lessons watched, out of order (a7l03, a7l07, a7l08, a7l12,
 *      a7l15, a7l18, through window.__fixture.complete): exactly 6 lit, and
 *      they are the first 6 of the fixed order; the other 12 drawn dim; 5
 *      lines, each between two lit stars; 6 bright blobs on the screen.
 *   3  Every lesson watched: 18 lit, 17 lines, 18 bright blobs.
 *   4  The placeholder course (no ?catalog=): Creative Strategy has 22 rows
 *      there and the last (a7l22) is its Ad Bounty feature row, so 21
 *      lessons count and 21 stars show; 6 watched light 6.
 *   5  1366x768 and 1024x700 (the panel narrows there): every star still
 *      inside the lens, right of the panel, under the caption.
 * Then 0 requests to /api, 0 to Supabase and 0 page errors over every page.
 *
 * Pictures (git-ignored): world-tests/shots/v6/stars/<row>.png.
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ORIGIN = process.env.BASE_URL || 'http://localhost:3111'
const OUT = path.join(HERE, 'shots', 'v6', 'stars')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Thresholds on the isolated render's luminance (0..255): a lit star's core, an unlit star's, a lit line's middle. */
const LIT = 140
const DIM = 18
const LINE = 22
/** The smallest gap between two stars on the screen, in vh. */
const GAP_VH = 4
/** The lens's clear circle (world.module.css .lens): 46vh round (50% + 17vh, 48%); a star keeps this far inside it. */
const LENS_VH = 46
const LENS_MARGIN_VH = 2

const results = []
const pageErrors = []
const requests = []
const check = (row, name, ok, detail) => {
  results.push({ row, name, ok: !!ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${row}  ${name}${detail !== undefined ? `  (${typeof detail === 'string' ? detail : JSON.stringify(detail)})` : ''}`)
}

let browser = null

async function waitFor(page, fn, { arg, timeout = 10000, poll = 150, what }) {
  const t0 = Date.now()
  for (;;) {
    try {
      const v = await page.evaluate(fn, arg)
      if (v) return v
    } catch {
      // A navigation in flight drops the context: look again.
    }
    if (Date.now() - t0 > timeout) throw new Error(`${what} (waited ${timeout} ms)`)
    await sleep(poll)
  }
}

/** A fresh context and page, the map ready, the camera parked at the telescope with its panel open. */
async function openParked(query, viewport) {
  const ctx = await browser.createBrowserContext()
  const page = await ctx.newPage()
  page.setDefaultTimeout(90000)
  await page.setViewport({ ...viewport, deviceScaleFactor: 1 })
  page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 200)))
  page.on('request', (req) => {
    let u = null
    try {
      u = new URL(req.url())
    } catch {
      return
    }
    if ((u.origin === ORIGIN && u.pathname.startsWith('/api')) || /supabase/i.test(u.hostname)) requests.push(`${u.hostname}${u.pathname}`)
  })
  const q = new URLSearchParams({ arrive: '0', poster: 'off', ...query }).toString()
  await page.goto(`${ORIGIN}/dev/world-app?${q}`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await waitFor(page, () => window.__worldReady === true || typeof window.__worldError === 'string', { timeout: 120000, poll: 300, what: 'the map was not ready' })
  const err = await page.evaluate(() => window.__worldError ?? null)
  if (err) throw new Error(`the scene failed: ${err}`)
  await page.evaluate(() => window.__worldV6Debug?.setQualityTier?.(0))
  // From the a7 stop, as a student clicks in.
  await page.evaluate(() => {
    const sc = window.__worldV6Debug
    const d = sc.stopDepths()[6]
    window.scrollTo(0, Math.round(sc.scrollYForDepth(d)))
    sc.seedDepth(d)
  })
  await sleep(1500)
  await page.evaluate(() => window.__worldPark('a7'))
  await waitFor(page, () => {
    const f = window.__worldFrame
    const panel = document.querySelector('main section[aria-labelledby="v4-panel-title"]')
    return f?.parkedId === 'a7' && f.parkProgress >= 0.999 && !!panel && Number(getComputedStyle(panel).opacity) > 0.99
  }, { timeout: 30000, what: 'the camera did not park at the telescope with its panel open' })
  await page.mouse.move(2, 2)
  await sleep(1200)
  return { ctx, page }
}

/** Mark lessons watched through the harness and wait for the sky to light `lit` stars. */
async function watch(page, ids, lit) {
  await page.evaluate((list) => {
    for (const id of list) window.__fixture.complete(id)
  }, ids)
  await waitFor(page, (n) => window.__worldV6Debug.moduleStats().nightsky?.heroLit === n, { arg: lit, timeout: 15000, what: `the sky did not light ${lit} stars` })
  await sleep(600)
}

/**
 * In the page: render the constellation meshes alone on black, read the
 * pixels, and find each of Creative Strategy's stars and lines on them.
 */
const MEASURE = ({ LIT }) => {
  const sc = window.__worldV6Debug
  const scene = sc.debugScene()
  const r = sc.renderer
  const cam = sc.camera
  const gl = r.getContext()
  const st = sc.moduleStats().nightsky
  const wp = window.__worldProgress?.()
  const starsMesh = scene.getObjectByName('ConstellationStars')
  const linesMesh = scene.getObjectByName('ConstellationLines')
  if (!starsMesh || !linesMesh) return { error: 'no constellation meshes' }
  let ColorCtor = null
  scene.traverse((o) => {
    if (!ColorCtor && o.material && o.material.color && o.material.color.isColor) ColorCtor = o.material.color.constructor
  })
  const prevClear = ColorCtor ? r.getClearColor(new ColorCtor()) : null
  const prevAlpha = r.getClearAlpha()
  const vis = []
  scene.traverse((o) => {
    if (o.isMesh || o.isPoints || o.isLine || o.isSprite) {
      vis.push([o, o.visible])
      o.visible = o === starsMesh || o === linesMesh
    }
  })
  const bg = scene.background
  scene.background = null
  r.setRenderTarget(null)
  r.setClearColor(0x000000, 1)
  r.render(scene, cam)
  const W = gl.drawingBufferWidth
  const H = gl.drawingBufferHeight
  const px = new Uint8Array(W * H * 4)
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px)
  for (const [o, v] of vis) o.visible = v
  scene.background = bg
  if (prevClear) r.setClearColor(prevClear, prevAlpha)
  r.render(scene, cam)

  const dpr = r.getPixelRatio()
  // Luminance at (x, y), top-left origin, device pixels.
  const lum = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return 0
    const i = ((H - 1 - y) * W + x) * 4
    return 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]
  }
  const peak = (cx, cy, rad) => {
    let m = 0
    for (let y = Math.floor(cy - rad); y <= Math.ceil(cy + rad); y++) {
      for (let x = Math.floor(cx - rad); x <= Math.ceil(cx + rad); x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= rad * rad) m = Math.max(m, lum(x, y))
    }
    return Math.round(m)
  }
  const dirs = starsMesh.geometry.getAttribute('aDir').array
  const states = starsMesh.geometry.getAttribute('aState').array
  const V = cam.position.constructor
  const stars = []
  for (let k = 0; k < st.heroStars; k++) {
    const i = st.heroFirst + k
    const v = new V(dirs[i * 4], dirs[i * 4 + 1], dirs[i * 4 + 2]).multiplyScalar(1000).add(cam.position).project(cam)
    const x = ((v.x + 1) / 2) * W
    const y = ((1 - v.y) / 2) * H
    stars.push({ k, x: x / dpr, y: y / dpr, dx: x, dy: y, state: states[i], peak: peak(x, y, 3 * dpr) })
  }
  // The lines of the tree: line k - 1 joins star k to the star it grew from.
  // Read where they are from the line mesh (its first and last vertex pair).
  const lp = linesMesh.geometry.getAttribute('position').array
  const nLines = lp.length / 12
  const heroLines = Math.max(0, st.heroStars - 1)
  const lines = []
  for (let l = 0; l < heroLines; l++) {
    const base = (nLines - heroLines + l) * 12
    const a = new V(lp[base], lp[base + 1], lp[base + 2]).normalize().multiplyScalar(1000).add(cam.position).project(cam)
    const b = new V(lp[base + 6], lp[base + 7], lp[base + 8]).normalize().multiplyScalar(1000).add(cam.position).project(cam)
    const mx = (((a.x + b.x) / 2 + 1) / 2) * W
    const my = ((1 - (a.y + b.y) / 2) / 2) * H
    lines.push({ k: l + 1, mid: peak(mx, my, 2 * dpr), len: Math.round(Math.hypot((a.x - b.x) * W, (a.y - b.y) * H) / 2 / dpr) })
  }
  // Bright blobs over the whole frame (4-connected), so a lit star anywhere else shows.
  const seen = new Uint8Array(W * H)
  const blobs = []
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const j = y * W + x
      if (seen[j] || lum(x, y) < LIT) continue
      let n = 0
      let sx = 0
      let sy = 0
      const stack = [j]
      seen[j] = 1
      while (stack.length) {
        const q = stack.pop()
        const qx = q % W
        const qy = (q - qx) / W
        n++
        sx += qx
        sy += qy
        for (const [nx, ny] of [[qx + 1, qy], [qx - 1, qy], [qx, qy + 1], [qx, qy - 1]]) {
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
          const nj = ny * W + nx
          if (!seen[nj] && lum(nx, ny) >= LIT) {
            seen[nj] = 1
            stack.push(nj)
          }
        }
      }
      blobs.push({ x: Math.round(sx / n / dpr), y: Math.round(sy / n / dpr), n })
    }
  }
  const rect = (el) => {
    if (!el) return null
    const b = el.getBoundingClientRect()
    return { l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom) }
  }
  const cap = [...document.querySelectorAll('main p[aria-hidden="true"]')].find((p) => /your sky/i.test(p.textContent ?? ''))
  return {
    W: W / dpr,
    H: H / dpr,
    dpr,
    stats: st,
    lessons: wp?.lessons ?? null,
    done: wp?.done ?? null,
    stars,
    lines,
    blobs,
    panel: rect(document.querySelector('main section[aria-labelledby="v4-panel-title"]')),
    caption: rect(cap),
    captionText: cap?.textContent ?? null,
  }
}

async function measure(page, shot) {
  const m = await page.evaluate(MEASURE, { LIT })
  if (m.error) throw new Error(m.error)
  if (shot) await page.screenshot({ path: path.join(OUT, shot), captureBeyondViewport: false })
  return m
}

const litOf = (m) => m.stars.filter((s) => s.peak >= LIT)
const dimOf = (m) => m.stars.filter((s) => s.peak >= DIM && s.peak < LIT)
const missingOf = (m) => m.stars.filter((s) => s.peak < DIM)
const linesOn = (m) => m.lines.filter((l) => l.mid >= LINE)

/** Every star inside the lens's clear circle, right of the panel, under the caption, and apart. */
function placement(row, m, label) {
  const vh = m.H / 100
  const cx = m.W / 2 + 17 * vh
  const cy = m.H * 0.48
  const out = m.stars.filter((s) => Math.hypot(s.x - cx, s.y - cy) > (LENS_VH - LENS_MARGIN_VH) * vh)
  check(row, `${label}: every star inside the lens's clear circle (${LENS_VH - LENS_MARGIN_VH}vh of its centre)`, out.length === 0, out.length ? out.map((s) => `star ${s.k + 1} at ${Math.round(s.x)},${Math.round(s.y)}`).join('; ') : `farthest ${Math.max(...m.stars.map((s) => Math.hypot(s.x - cx, s.y - cy) / vh)).toFixed(1)}vh`)
  const panelR = m.panel ? m.panel.r : 0
  const under = m.stars.filter((s) => s.x < panelR + 16)
  check(row, `${label}: every star right of the panel (its right edge ${panelR}px, + 16)`, m.panel && under.length === 0, under.length ? under.map((s) => `star ${s.k + 1} x ${Math.round(s.x)}`).join('; ') : `leftmost x ${Math.round(Math.min(...m.stars.map((s) => s.x)))}`)
  const capB = m.caption ? m.caption.b : 0
  const over = m.stars.filter((s) => s.y < capB + 16)
  check(row, `${label}: every star under the sky caption (its bottom ${capB}px, + 16)`, m.caption && over.length === 0, over.length ? over.map((s) => `star ${s.k + 1} y ${Math.round(s.y)}`).join('; ') : `top y ${Math.round(Math.min(...m.stars.map((s) => s.y)))}`)
  let gap = Infinity
  for (let i = 0; i < m.stars.length; i++) for (let j = i + 1; j < m.stars.length; j++) gap = Math.min(gap, Math.hypot(m.stars[i].x - m.stars[j].x, m.stars[i].y - m.stars[j].y))
  check(row, `${label}: at least ${GAP_VH}vh between any two stars`, gap >= GAP_VH * vh, `closest ${Math.round(gap)}px = ${(gap / vh).toFixed(1)}vh`)
}

fs.mkdirSync(OUT, { recursive: true })
browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--no-sandbox', '--hide-scrollbars'],
  protocolTimeout: 120000,
})

const DESKTOP = { width: 1691, height: 1278 }
const counting = (n) => Array.from({ length: n }, (_, i) => `a7l${String(i + 1).padStart(2, '0')}`)

try {
  // ── Rows 1 to 3: the real course, one page ──
  {
    const { ctx, page } = await openParked({ catalog: 'course' }, DESKTOP)
    try {
      let m = await measure(page, '1-course-0.png')
      const n = m.lessons?.[6]
      check(1, 'the map is given 18 lessons for Creative Strategy (the Ad Bounty row is not one)', n === 18, { lessons: m.lessons })
      check(1, 'as many stars as lessons', m.stats.heroStars === n && m.stars.length === n, { heroStars: m.stats.heroStars, lessons: n })
      check(1, 'nothing watched: none lit, every star drawn dim, no line', litOf(m).length === 0 && dimOf(m).length === n && linesOn(m).length === 0 && m.blobs.length === 0, { lit: litOf(m).length, dim: dimOf(m).length, missing: missingOf(m).map((s) => s.k + 1), lines: linesOn(m).length, blobs: m.blobs.length, peaks: m.stars.map((s) => s.peak) })
      placement(1, m, '1691x1278')

      const six = ['a7l03', 'a7l07', 'a7l08', 'a7l12', 'a7l15', 'a7l18']
      await watch(page, six, 6)
      m = await measure(page, '2-course-6.png')
      const lit = litOf(m)
      check(2, '6 of its lessons watched (out of order): exactly 6 stars lit', lit.length === 6 && m.stats.heroLit === 6, { lit: lit.map((s) => s.k + 1), stats: m.stats.heroLit, peaks: m.stars.map((s) => s.peak) })
      check(2, 'the lit ones are the first 6 of the fixed order', lit.length === 6 && lit.every((s) => s.k < 6), lit.map((s) => s.k + 1))
      check(2, 'the other 12 still drawn, dim', dimOf(m).length === 12 && missingOf(m).length === 0, { dim: dimOf(m).length, missing: missingOf(m).map((s) => s.k + 1) })
      check(2, '6 bright blobs on the whole screen', m.blobs.length === 6, m.blobs)
      const on = linesOn(m)
      check(2, '5 lines, each to a lit star from an earlier one', on.length === 5 && on.every((l) => l.k < 6) && m.stats.heroLines === 5, { on: on.map((l) => l.k + 1), mids: m.lines.map((l) => l.mid) })

      const rest = counting(18).filter((id) => !six.includes(id))
      await watch(page, rest, 18)
      m = await measure(page, '3-course-all.png')
      check(3, 'every lesson watched: 18 stars lit, 18 bright blobs', litOf(m).length === 18 && m.blobs.length === 18, { lit: litOf(m).length, blobs: m.blobs.length })
      check(3, '17 lines', linesOn(m).length === 17 && m.stats.heroLines === 17, { on: linesOn(m).length, mids: m.lines.map((l) => l.mid) })
      check(3, 'the caption puts Creative Strategy in the sky', /1 of 8/i.test(m.captionText ?? ''), m.captionText)
    } finally {
      await ctx.close().catch(() => {})
    }
  }

  // ── Row 4: the placeholder course ──
  {
    const { ctx, page } = await openParked({}, DESKTOP)
    try {
      let m = await measure(page, null)
      const n = m.lessons?.[6]
      check(4, 'the placeholder course: 21 lessons that count (22 rows, one the Ad Bounty feature row), 21 stars', n === 21 && m.stats.heroStars === 21 && m.stars.length === 21, { lessons: n, heroStars: m.stats.heroStars })
      await watch(page, counting(6), 6)
      m = await measure(page, '4-placeholder-6.png')
      check(4, '6 watched light 6, the first 6', litOf(m).length === 6 && litOf(m).every((s) => s.k < 6) && m.blobs.length === 6, { lit: litOf(m).map((s) => s.k + 1), blobs: m.blobs.length })
      placement(4, m, '1691x1278, 21 stars')
    } finally {
      await ctx.close().catch(() => {})
    }
  }

  // ── Row 5: smaller screens, where the panel narrows ──
  for (const vp of [{ width: 1366, height: 768 }, { width: 1024, height: 700 }]) {
    const { ctx, page } = await openParked({ catalog: 'course', p: 'partial' }, vp)
    try {
      const m = await measure(page, `5-${vp.width}x${vp.height}.png`)
      check(5, `${vp.width}x${vp.height}: 18 stars, 6 lit`, m.stars.length === 18 && litOf(m).length === 6, { stars: m.stars.length, lit: litOf(m).length })
      placement(5, m, `${vp.width}x${vp.height}`)
    } finally {
      await ctx.close().catch(() => {})
    }
  }
} catch (e) {
  check('-', 'the run', false, String(e?.message ?? e).slice(0, 300))
} finally {
  await browser.close()
}

check('-', 'no request to /api or Supabase', requests.length === 0, requests.slice(0, 5))
check('-', 'no page error', pageErrors.length === 0, pageErrors.slice(0, 3))
const failed = results.filter((r) => !r.ok).length
console.log(`\nPASS ${results.length - failed}  FAIL ${failed}`)
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1))
process.exit(failed ? 1 : 0)
