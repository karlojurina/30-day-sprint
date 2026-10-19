/**
 * The map after the browser takes its WebGL context away and never gives it
 * back (bug hunt 2026-10-19, map-3), walked in a real browser.
 *
 *   node world-tests/v6-context-lost.mjs [--only 1,2]
 *
 * Runs against http://localhost:3111/dev/world-app?catalog=course (BASE_URL
 * overrides), which must already be up: this script never starts a server.
 * The pretend student of FixtureStudentProvider.tsx (?p=mid), no login, no
 * server call. Headless Chrome on the real GPU. The context is taken away with
 * WEBGL_lose_context.loseContext() on the scene's own context, as Chrome does
 * after repeated GPU resets, and given back (restoreContext) only in row 2.
 *
 * WHAT WAS WRONG. scene.ts set contextLost and its frame loop stopped for
 * good: nothing switched to the still views, so the map froze on its last
 * labels over a blank canvas, and a place clicked afterwards opened a panel
 * that stayed invisible (only the frame loop raises its opacity) while the
 * page's scroll locked under it. Since the fix a loss that is not restored
 * within 3 s (scene.ts CONTEXT_LOST_POSTER_MS) puts the map on its still
 * views, as for a browser with no WebGL ("nowebgl": the notice says the
 * browser can't show the 3D map, no "Try 3D anyway"), and the frame loop runs
 * on without the renderer, so the labels, the panels and the trips work.
 *
 *   1  at 1691x1278 and 1440x900: the context lost and never given back. A
 *      second later the scene is still waiting (no still views yet, no
 *      frame); at 4 s the still views are up with the no-WebGL notice and
 *      no "Try 3D anyway", the canvas hidden. A scroll draws frames again
 *      (the frame count and the depth follow it). A click on the
 *      Introduction's plaque opens its panel, whose opacity reaches 1, the
 *      address the place's; Esc closes it and gives the page its scroll
 *      back. A click on the timeline's Video Ads II makes the trip there.
 *      Bringing the 3D back (the scene's setPoster(false), behind "Try the
 *      3D map" and the tuning panel) is refused while the context is lost,
 *      so the page reloads instead of freezing again, and a scroll still
 *      draws frames.
 *   2  control, 1440x900: the context lost and given back after 1 s. At 4.5 s
 *      no still views, the canvas shown, and a scroll draws 3D frames.
 * After the rows, one MEASURED line: requests to /api, requests to Supabase
 * and page errors over every page the run opened (all three must be 0).
 * Exit code 1 on any FAIL. Pictures for a person, in
 * world-tests/shots/v6/context-lost/ (git-ignored): lost-<size>.png (the still
 * views after the loss) and panel-<size>.png (the Introduction's panel over them).
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ORIGIN = process.env.BASE_URL || 'http://localhost:3111'
const APP = '/dev/world-app'
const OUT = path.join(HERE, 'shots', 'v6', 'context-lost')
fs.mkdirSync(OUT, { recursive: true })

const argv = process.argv.slice(2)
const onlyArg = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null
const ONLY = onlyArg ? new Set(onlyArg.split(',').map((x) => x.trim())) : null

const READY_MS = 120000
const NOTICE = "This browser can't show the 3D map. Here's the still version."
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const show = (v) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s === undefined ? 'undefined' : s.length > 400 ? `${s.slice(0, 400)}…` : s
}
const url = (params = {}) => `${APP}?${new URLSearchParams({ catalog: 'course', arrive: '0', poster: 'off', ...params }).toString()}`

const tally = { pages: 0, api: [], supabase: [], pageErrors: [] }
const results = []

async function waitFor(page, fn, { arg, timeout = 10000, poll = 120, what }) {
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

/** Take the scene's WebGL context away (and keep the extension, to give it back in row 2). */
const LOSE = () => {
  const gl = window.__worldV6Debug.renderer.getContext()
  const ext = gl.getExtension('WEBGL_lose_context')
  window.__loseExt = ext
  ext.loseContext()
  return { lost: gl.isContextLost(), frames: window.__worldFrameCount }
}

/** Where the map stands: its still views, the notice, the canvas, the frames, the scroll, the open panel. */
const STATE = (notice) => {
  const p = window.__worldPoster?.() ?? null
  const gl = document.querySelector('main div canvas')
  const note = [...document.querySelectorAll('main p[role="status"]')].find((e) => e.textContent.includes(notice)) ?? null
  const panel = document.querySelector('main section[aria-labelledby="v4-panel-title"]')
  return {
    poster: p ? { on: p.on, kind: p.kind, headless: p.headless, layerShown: p.layerShown, shown: p.shown.filter((s) => s.opacity > 0).map((s) => `${s.id}:${s.opacity.toFixed(2)}`) } : null,
    notice: !!note,
    tryButton: !!note?.querySelector('button'),
    canvas: gl ? getComputedStyle(gl).visibility : null,
    frames: window.__worldFrameCount,
    depth: window.__worldDepth,
    scrollY: Math.round(window.scrollY),
    overflow: document.body.style.overflow,
    open: document.querySelector('main')?.hasAttribute('data-open') ?? null,
    panel: panel ? { title: panel.querySelector('#v4-panel-title')?.textContent ?? null, opacity: Number(getComputedStyle(panel).opacity) } : null,
    path: location.pathname,
    error: window.__worldError ?? null,
  }
}

async function openPage(ctx, row, urlPath, viewport) {
  const page = await ctx.newPage()
  tally.pages++
  page.setDefaultTimeout(90000)
  await page.setViewport({ ...viewport, deviceScaleFactor: 1 })
  page.on('pageerror', (e) => {
    const rec = { row: row.id, message: `${String(e.message).slice(0, 240)}` }
    row.pageErrors.push(rec)
    tally.pageErrors.push(rec)
  })
  page.on('request', (req) => {
    let u = null
    try {
      u = new URL(req.url())
    } catch {
      return
    }
    if (u.origin === ORIGIN && u.pathname.startsWith('/api')) tally.api.push({ row: row.id, path: u.pathname })
    if (/supabase/i.test(u.hostname)) tally.supabase.push({ row: row.id, host: u.hostname, path: u.pathname })
  })
  await page.bringToFront()
  await page.goto(ORIGIN + urlPath, { waitUntil: 'domcontentloaded', timeout: READY_MS })
  await waitFor(page, () => window.__worldReady === true, { timeout: READY_MS, poll: 300, what: `${urlPath}: the map was not ready` })
  // The landing still fades out once the 3D has drawn: the scene is live before the loss.
  await waitFor(page, () => {
    const layer = document.querySelector('main picture')?.parentElement
    return !layer || getComputedStyle(layer).visibility === 'hidden'
  }, { timeout: 15000, poll: 150, what: 'the landing still did not fade out' })
  await page.mouse.move(2, 2)
  await sleep(1500)
  return page
}

let browser = null

async function runRow(id, name, body) {
  if (ONLY && !ONLY.has(String(id))) return
  const row = { id, name, pass: true, checks: [], pageErrors: [], error: null }
  const ctx = await browser.createBrowserContext()
  const r = {
    row,
    open: (urlPath, viewport) => openPage(ctx, row, urlPath, viewport),
    check: (what, ok, value) => {
      row.checks.push({ what, ok: !!ok, value })
      if (!ok) row.pass = false
    },
  }
  const t0 = Date.now()
  try {
    await body(r)
  } catch (e) {
    row.pass = false
    row.error = String(e?.message ?? e).slice(0, 300)
  } finally {
    await ctx.close().catch(() => {})
  }
  if (row.pageErrors.length) {
    row.pass = false
    row.checks.push({ what: 'no page error', ok: false, value: row.pageErrors.slice(0, 2) })
  }
  row.ms = Date.now() - t0
  results.push(row)
  console.log(`${row.pass ? 'PASS' : 'FAIL'}  ${id}. ${name}  (${(row.ms / 1000).toFixed(1)} s)`)
  for (const c of row.checks) if (!c.ok || process.env.VERBOSE) console.log(`        ${c.ok ? 'ok  ' : 'NOT '} ${c.what}: ${show(c.value)}`)
  if (row.error) console.log(`        error: ${row.error}`)
}

/** Scroll by `dy` and wait for the frame loop to follow: new frames and the depth where the scroll says. */
async function scrollAndFollow(page, dy) {
  const before = await page.evaluate(() => ({ frames: window.__worldFrameCount, depth: window.__worldDepth }))
  await page.evaluate((dy) => window.scrollBy(0, dy), dy)
  await sleep(1800)
  const after = await page.evaluate(() => ({ frames: window.__worldFrameCount, depth: window.__worldDepth, want: window.__worldV6Debug?.scrollDepth?.() ?? null }))
  return { before, after }
}

browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--no-sandbox', '--hide-scrollbars'],
  protocolTimeout: 180000,
})

try {
  await runRow(1, 'the context lost and never given back: the still views after 3 s, and the labels, a panel and a trip work over them', async (r) => {
    for (const vp of [{ width: 1691, height: 1278 }, { width: 1440, height: 900 }]) {
      const at = `${vp.width}x${vp.height}`
      const page = await r.open(url({ p: 'mid' }), vp)
      const lost = await page.evaluate(LOSE)
      r.check(`${at}: the context is lost`, lost.lost === true, lost)
      // The browser tells the page in a task of its own: a frame may still come before it.
      await sleep(200)
      const f0 = await page.evaluate(() => window.__worldFrameCount)
      await sleep(800)
      const early = await page.evaluate(STATE, NOTICE)
      r.check(`${at}: a second later the scene still waits for it (no still views yet, no new frame)`, early.poster?.on === false && early.frames === f0, { poster: early.poster, frames: early.frames, at: f0 })
      await sleep(3000)
      const s = await page.evaluate(STATE, NOTICE)
      r.check(`${at}: at 4 s the still views are up, as for no WebGL ("nowebgl")`, s.poster?.on === true && s.poster.kind === 'nowebgl' && s.poster.layerShown === true && s.poster.shown.length > 0, s.poster)
      r.check(`${at}: the student's notice says the browser can't show the 3D map, with no "Try 3D anyway"`, s.notice && !s.tryButton, { notice: s.notice, tryButton: s.tryButton })
      r.check(`${at}: the canvas is hidden`, s.canvas === 'hidden', s.canvas)
      await page.screenshot({ path: path.join(OUT, `lost-${at}.png`), captureBeyondViewport: false })
      // The frame loop runs on without the renderer: a scroll draws frames and the depth follows it.
      const sc = await scrollAndFollow(page, Math.round(vp.height * 0.15))
      r.check(`${at}: a scroll draws frames again and the depth follows it`, sc.after.frames > sc.before.frames && sc.after.depth > sc.before.depth && Math.abs(sc.after.depth - sc.after.want) < 1e-3, sc)
      await page.evaluate(() => window.scrollTo(0, 0))
      await sleep(1800)
      // A click on the Introduction's plaque: its panel shows (only the frame loop raises its opacity).
      const label = await page.evaluate(() => {
        const m = [...document.querySelectorAll('main button[data-mode="text"]')].find((b) => /^Introduction,/.test(b.getAttribute('aria-label') ?? ''))
        const l = m?.querySelector(':scope > span:last-child')
        if (!l) return null
        const b = l.getBoundingClientRect()
        const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)
        return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2), onTop: !!top && m.contains(top) }
      })
      r.check(`${at}: the Introduction's plaque is on the still view, on top`, label?.onTop === true, label)
      if (label?.onTop) {
        await page.mouse.click(label.x, label.y)
        await page.mouse.move(2, 2)
        const shown = await waitFor(page, () => {
          const panel = document.querySelector('main section[aria-labelledby="v4-panel-title"]')
          return panel && Number(getComputedStyle(panel).opacity) >= 0.999 ? Number(getComputedStyle(panel).opacity) : null
        }, { timeout: 8000, what: 'the panel did not show' }).catch(() => null)
        const open = await page.evaluate(STATE, NOTICE)
        r.check(`${at}: its panel shows (opacity 1), the address the place's, the page's scroll locked`, shown !== null && open.panel?.title === 'Introduction' && open.path === '/dev/world-app/a1' && open.overflow === 'hidden', { opacity: shown, panel: open.panel, path: open.path, overflow: open.overflow })
        await page.screenshot({ path: path.join(OUT, `panel-${at}.png`), captureBeyondViewport: false })
        await page.keyboard.press('Escape')
        const closed = await waitFor(page, () => !document.querySelector('main section[aria-labelledby="v4-panel-title"]') && location.pathname === '/dev/world-app' && document.body.style.overflow !== 'hidden', { timeout: 8000, what: 'Esc did not close the panel' }).catch(() => false)
        const after = await page.evaluate(STATE, NOTICE)
        r.check(`${at}: Esc closes it and gives the page its scroll back`, closed === true, { panel: after.panel, path: after.path, overflow: after.overflow })
      }
      // A trip on the timeline: the camera goes to Video Ads II's stop over the still views.
      const want = await page.evaluate(() => window.__worldDepthFor('a4'))
      const stop = await page.evaluate(() => {
        const b = document.querySelector('main nav[aria-label="Places"] button[aria-label="Travel to Video Ads II"]')
        if (!b) return null
        const rr = b.getBoundingClientRect()
        return { x: Math.round(rr.left + rr.width / 2), y: Math.round(rr.top + rr.height / 2) }
      })
      if (stop) await page.mouse.click(stop.x, stop.y)
      const arrived = await waitFor(page, (d) => Math.abs(window.__worldDepth - d) < 5e-4 && window.__worldDepth, { arg: want, timeout: 20000, poll: 200, what: 'the trip did not arrive' }).catch(() => null)
      const there = await page.evaluate(STATE, NOTICE)
      r.check(`${at}: the timeline's Video Ads II makes the trip, over the still views`, stop !== null && arrived !== null && there.poster?.on === true && there.poster.shown.some((x) => x.startsWith('a4:1')), { depth: there.depth, want, shown: there.poster?.shown })
      // The 3D cannot come back on a lost context: the scene refuses (the page's "Try the 3D map" then reloads).
      const tried = await page.evaluate(() => {
        const back = window.__worldV6Debug.setPoster(false)
        return { back, on: window.__worldPoster().on }
      })
      r.check(`${at}: bringing the 3D back is refused while the context is lost, the still views stay`, tried.back === false && tried.on === true, tried)
      const still = await scrollAndFollow(page, 120)
      r.check(`${at}: and the frame loop still runs (a scroll draws frames)`, still.after.frames > still.before.frames, still)
      await page.close()
    }
  })

  await runRow(2, 'control: the context lost and given back after 1 s: no still views, the 3D draws on', async (r) => {
    const vp = { width: 1440, height: 900 }
    const page = await r.open(url({ p: 'mid' }), vp)
    await page.evaluate(LOSE)
    await sleep(1000)
    await page.evaluate(() => window.__loseExt.restoreContext())
    await sleep(3500)
    const s = await page.evaluate(STATE, NOTICE)
    r.check('at 4.5 s: no still views, no notice, the canvas shown', s.poster?.on === false && !s.notice && s.canvas === 'visible', { poster: s.poster, notice: s.notice, canvas: s.canvas })
    const sc = await scrollAndFollow(page, 135)
    const gl = await page.evaluate(() => ({ lost: window.__worldV6Debug.renderer.getContext().isContextLost(), calls: window.__worldFrame?.calls ?? null }))
    r.check('a scroll draws 3D frames again (draw calls made), the context back', sc.after.frames > sc.before.frames && gl.lost === false && gl.calls > 0, { ...sc, ...gl })
    await page.close()
  })
} finally {
  await browser.close()
}

console.log(`MEASURED  pages ${tally.pages}, requests to /api ${tally.api.length}, to Supabase ${tally.supabase.length}, page errors ${tally.pageErrors.length}`)
if (tally.api.length || tally.supabase.length || tally.pageErrors.length) {
  console.log(`        ${show({ api: tally.api.slice(0, 3), supabase: tally.supabase.slice(0, 3), errors: tally.pageErrors.slice(0, 3) })}`)
  process.exitCode = 1
}
const failed = results.filter((x) => !x.pass)
console.log(`\n${results.length - failed.length} of ${results.length} rows PASS`)
if (failed.length) process.exitCode = 1
