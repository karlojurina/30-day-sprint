/**
 * World v6 wiring, Work Item 4: the path table, walked in a real browser.
 * (_admin/prds/world-v6-wiring/world_v6_wiring_prd.md, section 12.)
 *
 *   node world-tests/v6-app.mjs [--only 3,5,18]
 *
 * Runs against the session-free harness http://localhost:3111/dev/world-app:
 * the real stage, host, map, place route and lesson page, with the pretend
 * student of src/app/dev/world-app/FixtureStudentProvider.tsx (no login, no
 * server call). Headless Chrome on the real GPU, 1691x1278 unless a row says
 * otherwise. Takes about 3 minutes (28 page loads): run it in the background.
 *
 * One PASS or FAIL line per row of the table, with what was measured after it.
 * Every row loads its own fresh page in its own browser context with its own
 * preset, so no row depends on another. The three gap rows (G1 to G3) are
 * printed as NOT COVERED with their reason and are never a pass. Row 20 is the
 * sum over every page the run opened: requests to /api/student/* and page
 * errors, both of which must be zero. Exit code 1 on any FAIL.
 *
 * Screenshots and results.json: world-tests/shots/v6/app/ (git-ignored).
 *
 * What a row reads, so a change in the markup is found fast:
 *   hooks      window.__worldReady, __worldError, __worldDepth, __worldDepthFor(id),
 *              __worldScrollFor(depth), __worldFrameCount, __worldFrame,
 *              __worldProgress(), __worldUi(), __worldPoster(), __worldCelebrations,
 *              and the harness's window.__fixture.completed()
 *   the map    `main` (data-view, data-open, inert)
 *   the card   main section[data-side][data-show], except [aria-label="Place done"]
 *   done card  main section[aria-label="Place done"][data-show]
 *   the chip   main section[data-dir][data-show]
 *   the panel  main section[aria-labelledby="v4-panel-title"], its #v4-panel-title,
 *              its ol > li rows (button aria-label "Lesson N, title[, watched|, action item]"
 *              and "Watch lesson N, title"), button[data-state="fold"], the count
 *              line (the element before the ol), a button whose text has "Ad Bounty"
 *   markers    main button[data-mode] (index = place), label = its last child
 *   timeline   main nav[aria-label="Places"] [aria-label$="lessons done"]; the
 *              student's place: its > div > button[aria-current="step"] (the
 *              header's "04/08" until 2026-10-15, when Lovro's review took it out)
 *   phone      main[data-view="list"], main ol > li > button (the eight rows),
 *              main section[aria-label="Next lesson"], main section[role="dialog"]
 *   lesson     the h1 outside `main`, a button "Mark watched (dev)", an `a` whose
 *              path is the place's (the one with an arrow when there are two)
 *   dev tools  a button starting "Tune", section[aria-label="Tuning (dev only)"],
 *              a[href="/dev/world-v3"], a[href="/dev/world-codex"],
 *              section[aria-label="Bench results"]
 *
 * Query added to the PRD's presets: arrive=1 on the rows that test the arrival
 * (the map skips it under automation otherwise), arrive=0 elsewhere, and
 * poster=off on the 3D rows so the scene's own speed probe cannot swap in the
 * still views halfway through a row (row 16 forces them with poster=on).
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ORIGIN = process.env.BASE_URL || 'http://localhost:3111'
const APP = '/dev/world-app'
const OUT = path.join(HERE, 'shots', 'v6', 'app')
fs.mkdirSync(OUT, { recursive: true })

const argv = process.argv.slice(2)
const onlyArg = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null
const ONLY = onlyArg ? new Set(onlyArg.split(',').map((x) => x.trim())) : null

const DESKTOP = { width: 1691, height: 1278 }
const PHONE = { width: 390, height: 844 }
/** How close (rail depth, 0..1) the camera must be to a place's stop to count as resting there. One scroll pixel is about 4e-5. */
const DEPTH_TOL = 6e-4
const LOAD_MS = 80000
const READY_MS = 70000
/** A first visit to a route compiles it on the dev server. */
const NAV_MS = 40000
const ROW_MS = 240000

// ── The fixture, as FixtureStudentProvider generates it ─────────────────────
const NAMES = ['Introduction', 'Fundamentals', 'Video Ads I', 'Video Ads II', 'Static Ads', 'AI Ads & Content', 'Creative Strategy', 'Job Board']
/** Lessons that count toward progress, per place (a7l22 is the Ad Bounty row and does not). */
const COUNTING = [8, 10, 22, 22, 25, 22, 21, 14]
const TOTAL = COUNTING.reduce((a, b) => a + b, 0)
const lessonTitle = (k, n) => `${NAMES[k - 1]} · lesson ${n}`
/** Area 1 is the only one with durations: 300 + 61 n seconds. */
const area1Minutes = (n) => Math.max(1, Math.round((300 + 61 * n) / 60))
const FEATURE_TEXT = 'Fixture setup step'
const briefStart = (id) => `Fixture milestone brief for ${id}`
/**
 * The mid student's place. The PRD's row 2 says "03/08"; the header showed the
 * student's place number, so three places done and the fourth under way read
 * "04/08". Lovro's review of 2026-10-15 took that counter out of the header,
 * and the same fact is now the timeline's: the 4th of its 8 diamonds is the
 * student's (aria-current="step"), Video Ads II.
 */
const CURRENT_MID = { place: 4, of: 8, label: 'Travel to Video Ads II' }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const f = (n, d = 4) => (typeof n === 'number' ? n.toFixed(d) : String(n))
const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i])
const show = (v) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s === undefined ? 'undefined' : s.length > 300 ? `${s.slice(0, 300)}…` : s
}
const url = (sub, params = {}) => {
  const q = new URLSearchParams(params).toString()
  return `${APP}${sub}${q ? `?${q}` : ''}`
}

/** Everything the run saw, over every page it opened (row 20). */
const tally = { pages: 0, apiStudent: [], api: [], pageErrors: [], consoleErrors: [] }
const results = []

// ── Functions that run in the page ──────────────────────────────────────────

/** What is on screen, read from the DOM and the map's hooks. */
const SNAP = () => {
  const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim()
  const shown = (el) => (el && el.dataset.show !== undefined ? el : null)
  const main = document.querySelector('main')
  const card = shown(document.querySelector('main section[data-side]:not([aria-label="Place done"])'))
  const done = shown(document.querySelector('main section[aria-label="Place done"]'))
  const chip = shown(document.querySelector('main section[data-dir]'))
  const panel = document.querySelector('main section[aria-labelledby="v4-panel-title"]')
  const stops = [...document.querySelectorAll('main nav[aria-label="Places"] > div > button:not([data-cp])')]
  const here = stops.findIndex((b) => b.getAttribute('aria-current') === 'step')
  const tl = document.querySelector('main nav[aria-label="Places"] [aria-label$="lessons done"]')
  const h1 = [...document.querySelectorAll('h1')].find((h) => !h.closest('main')) ?? null
  const rect = h1 ? h1.getBoundingClientRect() : null
  const frame = window.__worldFrame ?? null
  // The words on the page outside the map: the lesson page, a "not here" card, a catalog card.
  let outside = ''
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const p = n.parentElement
    if (!p || p.closest('main, script, style, noscript, template, nextjs-portal, next-route-announcer')) continue
    outside += ` ${n.textContent}`
  }
  return {
    path: location.pathname,
    y: Math.round(window.scrollY),
    view: main?.dataset.view ?? null,
    open: main ? main.dataset.open !== undefined : false,
    inert: main ? main.inert === true || main.hasAttribute('inert') : null,
    card: card ? { label: card.getAttribute('aria-label'), title: norm(card.querySelector('h2')?.textContent), text: norm(card.textContent) } : null,
    done: done ? { title: norm(done.querySelector('h2')?.textContent), button: norm(done.querySelector('button')?.textContent) } : null,
    chip: chip ? norm(chip.textContent) : null,
    panel: panel ? { title: norm(panel.querySelector('#v4-panel-title')?.textContent), role: panel.getAttribute('role') } : null,
    current: here >= 0 ? { place: here + 1, of: stops.length, label: stops[here].getAttribute('aria-label') } : null,
    count: tl?.getAttribute('aria-label') ?? null,
    lesson: h1
      ? {
          title: norm(h1.textContent),
          focused: document.activeElement === h1,
          visible: !!rect && rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.bottom <= window.innerHeight,
        }
      : null,
    outside: norm(outside),
    canvases: document.querySelectorAll('canvas').length,
    iframes: document.querySelectorAll('iframe').length,
    overflow: document.body.style.overflow,
    ready: window.__worldReady === true,
    depth: typeof window.__worldDepth === 'number' ? window.__worldDepth : null,
    frames: typeof window.__worldFrameCount === 'number' ? window.__worldFrameCount : null,
    parked: frame?.parkedId ?? null,
    park: frame ? frame.parkProgress : null,
    celebrations: typeof window.__worldCelebrations === 'number' ? window.__worldCelebrations : null,
    doneK: window.__worldUi?.()?.doneK ?? null,
    progress: window.__worldProgress?.() ?? null,
    poster: window.__worldPoster?.()?.on ?? null,
    watched: window.__fixture ? window.__fixture.completed() : null,
  }
}

/** The open place panel (or the phone's sheet): its count line and its rows. */
const READ_PANEL = () => {
  const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim()
  const panel = document.querySelector('main section[aria-labelledby="v4-panel-title"]')
  if (!panel) return null
  const ol = panel.querySelector('ol')
  const rows = []
  let fold = null
  for (const li of ol ? [...ol.children] : []) {
    const foldButton = li.querySelector('button[data-state="fold"]')
    if (foldButton) {
      fold = norm(foldButton.textContent)
      continue
    }
    const button = li.querySelector('button[aria-label]')
    const label = button?.getAttribute('aria-label') ?? ''
    let kind = 'unknown'
    let n = null
    let title = null
    let m = /^Watch lesson (\d+), (.*)$/.exec(label)
    if (m) {
      kind = 'next'
      n = Number(m[1])
      title = m[2]
    } else if ((m = /^Lesson (\d+), (.*?)(, watched|, action item)?$/.exec(label))) {
      n = Number(m[1])
      title = m[2]
      kind = m[3] === ', watched' ? 'done' : m[3] === ', action item' ? 'action' : 'todo'
    }
    // What is left of the row once its number, its title and the Watch button's word are taken out: the minutes, "Action", or nothing.
    let tail = norm(li.textContent)
    if (n !== null && tail.startsWith(String(n))) tail = tail.slice(String(n).length)
    if (title && tail.includes(title)) tail = tail.replace(title, '')
    tail = norm(norm(tail).replace(/Watch$/, ''))
    rows.push({ n, kind, title, tail })
  }
  const feature = [...panel.querySelectorAll('button')].find((b) => /Ad Bounty/.test(b.textContent))
  return {
    title: norm(panel.querySelector('#v4-panel-title')?.textContent),
    role: panel.getAttribute('role'),
    count: ol?.previousElementSibling ? norm(ol.previousElementSibling.textContent) : null,
    fold,
    rows,
    feature: feature ? norm(feature.textContent) : null,
    text: norm(panel.textContent),
  }
}

/**
 * Which layers of the map's interface can be seen (null: not in the DOM). A
 * layer is not seen when its computed visibility is hidden, or when it or
 * anything above it inside the map has opacity 0. Under a lesson page every
 * one of them must be false: only the picture stays.
 */
const LAYERS = () => {
  const main = document.querySelector('main')
  const seen = (el) => {
    if (!el || !main) return null
    if (getComputedStyle(el).visibility !== 'visible') return false
    for (let e = el; e && e !== main.parentElement; e = e.parentElement) if (Number(getComputedStyle(e).opacity) === 0) return false
    return true
  }
  const q = (s) => document.querySelector(s)
  return {
    card: seen(q('main section[data-side]:not([aria-label="Place done"])')),
    markers: seen(q('main button[data-mode]')?.parentElement ?? null),
    timeline: seen(q('main nav[aria-label="Places"]')),
    header: seen(q('main header')),
    panel: seen(q('main section[aria-labelledby="v4-panel-title"]')),
    list: seen(q('main ol')?.closest('main > div') ?? null),
    sheet: seen(q('main section[role="dialog"]')),
  }
}

/** Do the words on the page (scripts and styles left out) match the pattern? */
const SAYS = (source) => {
  let text = ''
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const p = n.parentElement
    if (!p || p.closest('script, style, noscript, template')) continue
    text += ` ${n.textContent}`
  }
  return new RegExp(source).test(text.replace(/\s+/g, ' '))
}

/** What a row clicks. Each returns one element or null. */
const FIND = {
  cardWatch: () => document.querySelector('main section[data-side][data-show]:not([aria-label="Place done"]) button'),
  doneButton: () => document.querySelector('main section[aria-label="Place done"][data-show] button'),
  marker: (k) => {
    const b = document.querySelectorAll('main button[data-mode]')[k]
    return b ? (b.dataset.mode === 'text' ? b.lastElementChild : b) : null
  },
  panelRow: (n) => document.querySelector(`main section[aria-labelledby="v4-panel-title"] button[aria-label^="Lesson ${n},"]`),
  panelWatch: () => document.querySelector('main section[aria-labelledby="v4-panel-title"] button[aria-label^="Watch lesson "]'),
  fold: () => document.querySelector('main section[aria-labelledby="v4-panel-title"] button[data-state="fold"]'),
  feature: () => [...document.querySelectorAll('main section[aria-labelledby="v4-panel-title"] button')].find((b) => /Ad Bounty/.test(b.textContent)) ?? null,
  listRow: (k) => document.querySelector('main ol')?.children[k]?.querySelector('button') ?? null,
  markWatched: () => [...document.querySelectorAll('button')].find((b) => !b.closest('main') && /Mark watched \(dev\)/.test(b.textContent)) ?? null,
  backLink: (pathname) => {
    const links = [...document.querySelectorAll('a')].filter((a) => !a.closest('main') && new URL(a.href, location.href).pathname === pathname)
    return links.find((a) => /←/.test(a.textContent)) ?? links[0] ?? null
  },
}

// ── Driving the page ────────────────────────────────────────────────────────

/** Poll `fn` in the page until it returns something truthy. Throws (or, with soft, returns null) after `timeout`. */
async function waitFor(page, fn, { arg, timeout = 10000, poll = 120, what, soft = false }) {
  const t0 = Date.now()
  for (;;) {
    try {
      const v = await page.evaluate(fn, arg)
      if (v) return v
    } catch {
      // A page load in flight drops the context: look again.
    }
    if (Date.now() - t0 > timeout) {
      if (soft) return null
      throw new Error(`${what} (waited ${timeout} ms)`)
    }
    await sleep(poll)
  }
}

async function openPage(ctx, row, urlPath, { viewport = DESKTOP, reducedMotion = false } = {}) {
  const page = await ctx.newPage()
  tally.pages++
  page.setDefaultTimeout(60000)
  await page.setViewport({ ...viewport, deviceScaleFactor: 1 })
  if (reducedMotion) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
  page.on('pageerror', (e) => {
    const rec = { row: row.id, message: `${String(e.message).slice(0, 240)} :: ${(e.stack || '').split('\n').slice(1, 4).join(' <- ').slice(0, 400)}` }
    row.pageErrors.push(rec)
    tally.pageErrors.push(rec)
  })
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    const t = m.text()
    if (/GPU stall|GL Driver Message|WebGL-|swiftshader|Automatic fallback|Download the React DevTools/i.test(t)) return
    tally.consoleErrors.push({ row: row.id, message: t.slice(0, 300) })
  })
  page.on('request', (req) => {
    const u = req.url()
    let pathname = ''
    try {
      pathname = new URL(u).pathname
    } catch {
      return
    }
    if (!pathname.startsWith('/api/')) return
    const rec = { row: row.id, method: req.method(), url: u }
    row.api.push(rec)
    tally.api.push(rec)
    if (u.includes('/api/student/')) {
      row.apiStudent.push(rec)
      tally.apiStudent.push(rec)
    }
  })
  await page.bringToFront()
  await page.goto(`${ORIGIN}${urlPath}`, { waitUntil: 'domcontentloaded', timeout: LOAD_MS })
  return page
}

async function ready(page, what) {
  await waitFor(page, () => window.__worldReady === true || typeof window.__worldError === 'string', {
    timeout: READY_MS,
    poll: 200,
    what: `${what}: the map never reported ready`,
  })
  const err = await page.evaluate(() => window.__worldError ?? null)
  if (err) throw new Error(`${what}: the scene failed: ${err}`)
  await page.evaluate(() => document.fonts.ready.then(() => true))
}

/** Wait until the camera has stopped at place k (0-based): its depth is the stop's and has not changed, nor has the scroll, for three reads. */
async function restAt(page, k, what, timeout = 25000) {
  const id = `a${k + 1}`
  const t0 = Date.now()
  let last = null
  let prev = null
  let steady = 0
  while (Date.now() - t0 < timeout) {
    try {
      last = await page.evaluate(
        (pid) => ({
          d: typeof window.__worldDepth === 'number' ? window.__worldDepth : null,
          t: window.__worldDepthFor ? window.__worldDepthFor(pid) : null,
          y: Math.round(window.scrollY),
        }),
        id,
      )
    } catch {
      last = null
    }
    const there = last && last.d !== null && last.t !== null && Math.abs(last.d - last.t) < DEPTH_TOL
    if (there && prev && prev.d !== null && Math.abs(prev.d - last.d) < 1e-6 && prev.y === last.y) steady++
    else steady = 0
    if (steady >= 3) return { ...last, ms: Date.now() - t0 }
    prev = last
    await sleep(120)
  }
  throw new Error(
    `${what}: the camera did not come to rest at place ${k + 1} within ${timeout} ms (depth ${f(last?.d)}, the place is at ${f(last?.t)}, scrollY ${last?.y})`,
  )
}

/** Put the page scroll on place k's stop, the way the timeline does, and wait for the camera. */
async function scrollToPlace(page, k, what) {
  await page.evaluate((pid) => window.scrollTo(0, Math.round(window.__worldScrollFor(window.__worldDepthFor(pid)))), `a${k + 1}`)
  return restAt(page, k, what)
}

async function waitCard(page, what, timeout = 15000) {
  await waitFor(page, () => !!document.querySelector('main section[data-side][data-show]:not([aria-label="Place done"])'), {
    timeout,
    what: `${what}: the card did not show`,
  })
  await sleep(400) // its 200 ms fade
  return (await page.evaluate(SNAP)).card
}

const waitPath = (page, pathname, what, timeout = NAV_MS) =>
  waitFor(page, (p) => location.pathname === p, { arg: pathname, timeout, what: `${what}: the address did not become ${pathname}` })

/** The panel (or the phone's sheet) of place k is open and the camera has arrived. */
async function waitPanel(page, k, what, timeout = 40000) {
  await waitFor(
    page,
    (name) => {
      const p = document.querySelector('main section[aria-labelledby="v4-panel-title"]')
      if (!p || (p.querySelector('#v4-panel-title')?.textContent ?? '').trim() !== name) return false
      const fr = window.__worldFrame
      return !fr || fr.parkProgress >= 0.999
    },
    { arg: NAMES[k], timeout, what: `${what}: the panel of place ${k + 1} (${NAMES[k]}) did not open` },
  )
  await sleep(300)
}

const waitNoPanel = (page, what, timeout = 25000) =>
  waitFor(page, () => !document.querySelector('main section[aria-labelledby="v4-panel-title"]') && document.body.style.overflow !== 'hidden', {
    timeout,
    what: `${what}: the place did not close`,
  })

const waitLesson = (page, title, what, timeout = NAV_MS) =>
  waitFor(
    page,
    (t) => {
      const h = [...document.querySelectorAll('h1')].find((x) => !x.closest('main'))
      return !!h && h.textContent.trim() === t
    },
    { arg: title, timeout, what: `${what}: the lesson page "${title}" did not show` },
  )

/**
 * Click what `find` returns. A real mouse click when the element is on screen
 * with nothing over it; a DOM click otherwise (a label the card has replaced).
 * Returns which it was.
 *
 * scroll 'box' first brings the element into view inside the nearest box that
 * scrolls by itself (the panel's list), the way a student scrolls the panel.
 * It never scrolls the page: on the map the page scroll is the camera.
 * scroll 'page' is for the phone's list, where the page is an ordinary page.
 */
async function click(page, find, arg, { what, scroll = 'none' }) {
  const handle = await page.evaluateHandle(find, arg)
  const el = handle.asElement()
  if (!el) {
    await handle.dispose()
    throw new Error(`${what}: not on the page`)
  }
  const hit = await page.evaluate(
    (node, scrollMode) => {
      if (scrollMode === 'page') node.scrollIntoView({ block: 'center', behavior: 'instant' })
      if (scrollMode === 'box') {
        for (let box = node.parentElement; box && box !== document.body; box = box.parentElement) {
          const overflowY = getComputedStyle(box).overflowY
          if ((overflowY === 'auto' || overflowY === 'scroll') && box.scrollHeight > box.clientHeight + 1) {
            const at = node.getBoundingClientRect()
            const frame = box.getBoundingClientRect()
            box.scrollTop += at.top + at.height / 2 - (frame.top + frame.height / 2)
            break
          }
        }
      }
      const r = node.getBoundingClientRect()
      const x = r.left + r.width / 2
      const y = r.top + r.height / 2
      const onScreen = r.width > 0 && r.height > 0 && x >= 0 && y >= 0 && x <= window.innerWidth && y <= window.innerHeight
      const top = onScreen ? document.elementFromPoint(x, y) : null
      const control = (e) => e.closest('button, a')
      if (top && (top === node || node.contains(top) || (control(top) !== null && control(top) === control(node)))) return { via: 'mouse', x, y }
      node.click()
      return { via: 'dom click' }
    },
    el,
    scroll,
  )
  await el.dispose()
  if (hit.via === 'mouse') await page.mouse.click(hit.x, hit.y)
  return hit.via
}

/** Travel to place k, click its label, wait for the address and the panel. */
async function openPlace(page, k, what) {
  await scrollToPlace(page, k, what)
  await sleep(450) // the labels are laid out once the scroll rests
  const via = await click(page, FIND.marker, k, { what: `${what}: the label of place ${k + 1}` })
  await waitPath(page, `${APP}/a${k + 1}`, what)
  await waitPanel(page, k, what)
  return via
}

async function closePlace(page, what) {
  await page.keyboard.press('Escape')
  await waitPath(page, APP, what)
  await waitNoPanel(page, what)
}

/** The panel's rows, with the folded "Lessons 1 to N watched" row opened first. */
async function readPanel(page, what) {
  let p = await page.evaluate(READ_PANEL)
  if (!p) throw new Error(`${what}: no panel to read`)
  const folded = p.fold
  if (folded) {
    await click(page, FIND.fold, null, { what: `${what}: the folded rows` })
    await waitFor(page, () => !document.querySelector('main section[aria-labelledby="v4-panel-title"] button[data-state="fold"]'), {
      timeout: 5000,
      what: `${what}: the watched rows did not unfold`,
    })
    p = await page.evaluate(READ_PANEL)
  }
  return { ...p, folded }
}

/** "The map is paused": the frame counter read twice 1.5 s apart, and the root's inert. */
async function pausedProbe(page) {
  const a = await page.evaluate(SNAP)
  await sleep(1500)
  const b = await page.evaluate(SNAP)
  return { inert: b.inert, f0: a.frames, f1: b.frames, y0: a.y, y1: b.y }
}

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`)
  await page.screenshot({ path: file })
  return path.relative(HERE, file)
}

// ── Rows ────────────────────────────────────────────────────────────────────

function printRow(rec) {
  const parts = rec.checks.map((c) => `${c.ok ? 'ok' : 'NOT OK'} ${c.label}: ${show(c.got)}`)
  if (rec.error) parts.push(`STOPPED: ${rec.error}`)
  if (Object.keys(rec.values).length) parts.push(`also: ${show(rec.values)}`)
  console.log(`${rec.pass ? 'PASS' : 'FAIL'}  ${String(rec.id).padStart(2)}  ${rec.name}: ${parts.join(' | ')}`)
}

let browser = null

async function runRow(id, name, fn) {
  if (ONLY && !ONLY.has(String(id))) return
  const rec = { id, name, pass: false, checks: [], values: {}, error: null, ms: 0 }
  const t0 = Date.now()
  const ctx = await browser.createBrowserContext()
  let page = null
  const row = {
    id,
    api: [],
    apiStudent: [],
    pageErrors: [],
    values: rec.values,
    check(label, ok, got) {
      rec.checks.push({ label, ok: !!ok, got })
      return !!ok
    },
    /** One page at a time: a page behind another is hidden, and a hidden map pauses itself. */
    async open(urlPath, opts) {
      if (page) await page.close().catch(() => {})
      page = await openPage(ctx, row, urlPath, opts)
      return page
    },
    shot: (label) => shot(page, `${String(id).padStart(2, '0')}-${label}`),
  }
  const work = fn(row)
  work.catch(() => {})
  let timer = null
  try {
    await Promise.race([
      work,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`row ${id}: gave up after ${ROW_MS / 1000} s`)), ROW_MS)
      }),
    ])
  } catch (e) {
    rec.error = String(e?.message ?? e)
    if (page) {
      try {
        rec.values.failedShot = await shot(page, `${String(id).padStart(2, '0')}-STOPPED`)
        rec.values.at = await page.evaluate(() => location.pathname + location.search)
      } catch {
        // the page is gone
      }
    }
  } finally {
    clearTimeout(timer)
    await ctx.close().catch(() => {})
  }
  rec.ms = Date.now() - t0
  rec.pass = !rec.error && rec.checks.length > 0 && rec.checks.every((c) => c.ok)
  results.push(rec)
  printRow(rec)
}

/**
 * Before the rows: load the three routes once with an empty catalog (no 3D),
 * so the dev server has compiled them and no row's first navigation waits on a
 * compile. Returns null when the harness renders, or why it does not.
 */
async function warmUp() {
  const ctx = await browser.createBrowserContext()
  const row = { id: 'warm-up', api: [], apiStudent: [], pageErrors: [] }
  const t0 = Date.now()
  let page = null
  try {
    for (const sub of ['', '/a1', '/a1/a1l01']) {
      if (page) await page.close().catch(() => {})
      page = await openPage(ctx, row, url(sub, { catalog: 'empty' }))
      await waitFor(page, SAYS, {
        arg: 'There are no lessons here yet\\.',
        timeout: LOAD_MS,
        poll: 250,
        what: `${APP}${sub}?catalog=empty did not show the empty-catalog card`,
      })
    }
    console.log(`warm-up: the three routes render (${Date.now() - t0} ms)`)
    return null
  } catch (e) {
    let seen = ''
    try {
      seen = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 400))
    } catch {
      // no page
    }
    const errs = row.pageErrors.map((x) => x.message).slice(0, 2).join(' || ')
    return `${String(e?.message ?? e)}${seen ? `; the page says: ${seen}` : ''}${errs ? `; page errors: ${errs}` : ''}`
  } finally {
    await ctx.close().catch(() => {})
  }
}

const ROWS = [
  [1, 'New student arrives'],
  [2, 'Mid student arrives'],
  [3, 'Watch from the card'],
  [4, 'Finish a lesson, go back'],
  [5, 'Finish a place'],
  [6, 'Open and close a place by hand'],
  [7, 'Deep link to a place'],
  [8, 'Deep link to a lesson'],
  [9, 'Unknown addresses'],
  [10, 'Out-of-order progress'],
  [11, 'Everything done'],
  [12, 'The feature row'],
  [13, 'An action item'],
  [14, 'Minutes shown and hidden'],
  [15, 'Phone'],
  [16, 'Poster mode'],
  [17, 'Reduced motion'],
  [18, 'Catalog not ready'],
  [19, 'No dev tools'],
  [20, 'Quiet network and console'],
]
const nameOf = (id) => ROWS.find((r) => r[0] === id)[1]

const GAPS = [
  [
    'G1',
    'A real login, a real video, a completion ratified by the server lighting a lantern',
    'nobody in the build can do it. It needs a deployed preview, a real login and a lesson with a video on the catalog the map reads; today no staging lesson can be completed (PRD 1 D2). Ship order steps 1 to 6 cover everything up to playback.',
  ],
  ['G2', 'Safari, Firefox, Windows, a real phone', 'no device here. Ship order step 7.'],
  ['G3', 'Lock modes look and locked with a source', 'gap by decision: the app ships open. Covered on the dev page by the existing checks only.'],
]

browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--no-sandbox', '--hide-scrollbars'],
  protocolTimeout: 85000,
})

let down = null
try {
  down = await warmUp()
  if (down) {
    console.log(`HARNESS DOWN: ${down}`)
    for (const [id, name] of ROWS) {
      // Row 20 is printed once, below.
      if (id === 20 || (ONLY && !ONLY.has(String(id)))) continue
      const rec = { id, name, pass: false, checks: [], values: {}, error: 'not run, the harness did not render', ms: 0 }
      results.push(rec)
      printRow(rec)
    }
  } else {
    // 1 ── New student arrives
    await runRow(1, nameOf(1), async (r) => {
      const page = await r.open(url('', { p: 'p0', arrive: 1, poster: 'off' }))
      await ready(page, 'row 1')
      const rest = await restAt(page, 0, 'row 1')
      const card = await waitCard(page, 'row 1')
      const s = await page.evaluate(SNAP)
      r.check('the camera rests at place 1', true, `depth ${f(rest.d)}, the stop is at ${f(rest.t)}, ${rest.ms} ms after ready`)
      r.check('the card says Introduction', card?.title === 'Introduction', card?.title ?? null)
      r.check('the card names the first lesson', !!card && card.text.includes(lessonTitle(1, 1)), card?.text ?? null)
      r.check('__worldProgress().done is all zeros', !!s.progress && s.progress.done.length === 8 && s.progress.done.every((d) => d === 0), s.progress?.done ?? null)
      r.check('__worldProgress().lessons is 8,10,22,22,25,22,21,14', same(s.progress?.lessons, COUNTING), s.progress?.lessons ?? null)
      r.values.shot = await r.shot('arrive-new')
    })

    // 2 ── Mid student arrives
    await runRow(2, nameOf(2), async (r) => {
      const page = await r.open(url('', { p: 'mid', arrive: 1, poster: 'off' }))
      await ready(page, 'row 2')
      const rest = await restAt(page, 3, 'row 2')
      const card = await waitCard(page, 'row 2')
      const s = await page.evaluate(SNAP)
      r.check('the camera rests at place 4', true, `depth ${f(rest.d)}, the stop is at ${f(rest.t)}, ${rest.ms} ms after ready`)
      r.check('the card says Video Ads II', card?.title === 'Video Ads II', card?.title ?? null)
      r.check('the card says 18 of 22', !!card && /(^|\D)18 of 22/.test(card.text), card?.text ?? null)
      r.check(`the timeline marks place ${CURRENT_MID.place} of ${CURRENT_MID.of} as the student's, Video Ads II (the header's old 04/08, see CURRENT_MID)`, s.current?.place === CURRENT_MID.place && s.current.of === CURRENT_MID.of && s.current.label === CURRENT_MID.label, s.current)
      r.values.timeline = s.count
      r.values.shot = await r.shot('arrive-mid')
    })

    // 3 ── Watch from the card
    await runRow(3, nameOf(3), async (r) => {
      const page = await r.open(url('', { p: 'mid', arrive: 0, poster: 'off' }))
      await ready(page, 'row 3')
      await scrollToPlace(page, 3, 'row 3')
      await waitCard(page, 'row 3')
      const before = await page.evaluate(SNAP)
      await sleep(600)
      const drew = ((await page.evaluate(SNAP)).frames ?? 0) - (before.frames ?? 0)
      r.values.click = await click(page, FIND.cardWatch, null, { what: 'row 3: Watch on the card' })
      await waitPath(page, `${APP}/a4/a4l19`, 'row 3')
      await waitLesson(page, lessonTitle(4, 19), 'row 3')
      await waitFor(page, () => document.activeElement?.tagName === 'H1', { timeout: 5000, soft: true, what: 'row 3: focus' })
      await sleep(500)
      const probe = await pausedProbe(page)
      const s = await page.evaluate(SNAP)
      r.check('the address ends /a4/a4l19', s.path === `${APP}/a4/a4l19`, s.path)
      r.check('the lesson heading is visible', s.lesson?.visible === true, s.lesson)
      r.check('the lesson heading has focus', s.lesson?.focused === true, s.lesson?.focused ?? null)
      r.check('scrollY is unchanged', Math.abs(s.y - before.y) <= 1, `${before.y} before, ${s.y} after`)
      r.check(
        'the frame counter stopped',
        typeof probe.f0 === 'number' && probe.f0 === probe.f1,
        `${probe.f0} then ${probe.f1} 1.5 s later (it drew ${drew} frames in the 0.6 s before the click)`,
      )
      r.check('the map root is inert', s.inert === true, s.inert)
      r.values.notRecordedShown = /Not recorded yet\./.test(s.outside)
      r.values.shot = await r.shot('lesson-over-map')
      // Only the picture stays under the lesson page; back on the map, the interface is there again.
      const under = await page.evaluate(LAYERS)
      await click(page, FIND.backLink, `${APP}/a4`, { what: 'row 3: the back link' })
      await waitPath(page, `${APP}/a4`, 'row 3, back')
      await waitPanel(page, 3, 'row 3, back')
      const atPlace = await page.evaluate(LAYERS)
      await closePlace(page, 'row 3, back')
      await restAt(page, 3, 'row 3, after closing')
      await waitCard(page, 'row 3, after closing')
      const onMap = await page.evaluate(LAYERS)
      r.check(
        'under the lesson page the card, the markers, the timeline and the header are not visible (nor the place panel)',
        under.card === false && under.markers === false && under.timeline === false && under.header === false && under.panel !== true,
        under,
      )
      r.check(
        'back on the map they are visible again (the panel and the header at the place, then the card, the markers, the timeline and the header)',
        atPlace.panel === true && atPlace.header === true && onMap.card === true && onMap.markers === true && onMap.timeline === true && onMap.header === true,
        { atThePlace: atPlace, onTheMap: onMap },
      )
    })

    // 4 ── Finish a lesson, go back
    await runRow(4, nameOf(4), async (r) => {
      const page = await r.open(url('', { p: 'mid', arrive: 0, poster: 'off' }))
      await ready(page, 'row 4')
      await scrollToPlace(page, 3, 'row 4')
      await waitCard(page, 'row 4')
      await click(page, FIND.cardWatch, null, { what: 'row 4: Watch on the card' })
      await waitPath(page, `${APP}/a4/a4l19`, 'row 4')
      await waitLesson(page, lessonTitle(4, 19), 'row 4')
      await click(page, FIND.markWatched, null, { what: 'row 4: the "Mark watched (dev)" button' })
      await waitFor(page, () => window.__fixture?.completed().includes('a4l19'), { timeout: 5000, what: 'row 4: a4l19 did not become watched' })
      await click(page, FIND.backLink, `${APP}/a4`, { what: 'row 4: the back link' })
      await waitPath(page, `${APP}/a4`, 'row 4')
      await waitPanel(page, 3, 'row 4')
      // Read before anything else is clicked: where the keyboard is once the lesson page has closed.
      const focus = await page.evaluate(() => {
        const panel = document.querySelector('main section[aria-labelledby="v4-panel-title"]')
        const at = document.activeElement
        return { inPanel: !!panel && !!at && panel.contains(at), on: at ? (at.getAttribute('aria-label') ?? at.id ?? at.tagName) : null }
      })
      await waitFor(page, () => window.__worldProgress?.()?.done[3] === 19, { timeout: 8000, soft: true, what: 'row 4: progress' })
      const s = await page.evaluate(SNAP)
      const panel = await readPanel(page, 'row 4')
      const r19 = panel.rows.find((x) => x.n === 19)
      const next = panel.rows.filter((x) => x.kind === 'next').map((x) => x.n)
      r.values.shot = await r.shot('back-at-place')
      await closePlace(page, 'row 4')
      await restAt(page, 3, 'row 4, after closing')
      const card = await waitCard(page, 'row 4, after closing')
      const after = await page.evaluate(SNAP)
      r.check('the address ends /a4', s.path === `${APP}/a4`, s.path)
      r.check('the panel shows lesson 19 done', r19?.kind === 'done', r19 ?? null)
      r.check('the panel shows lesson 20 next', same(next, [20]), next)
      r.check('__worldProgress().done[3] is 19', s.progress?.done[3] === 19, s.progress?.done ?? null)
      r.check(
        'no done card',
        s.done === null && s.doneK === -1 && s.celebrations === 0 && after.done === null,
        { withPanelOpen: s.done, doneK: s.doneK, celebrations: s.celebrations, afterClosing: after.done },
      )
      r.check('after the return, focus is inside the panel', focus.inPanel === true, focus)
      r.values.folded = panel.folded
      r.values.cardAfterClosing = card?.text ?? null
    })

    // 5 ── Finish a place
    await runRow(5, nameOf(5), async (r) => {
      const page = await r.open(url('', { p: 'last', arrive: 1, poster: 'off' }))
      await ready(page, 'row 5')
      await restAt(page, 3, 'row 5')
      const card = await waitCard(page, 'row 5')
      const before = await page.evaluate(SNAP)
      await click(page, FIND.cardWatch, null, { what: 'row 5: Watch on the card' })
      await waitPath(page, `${APP}/a4/a4l22`, 'row 5')
      await waitLesson(page, lessonTitle(4, 22), 'row 5')
      await click(page, FIND.markWatched, null, { what: 'row 5: the "Mark watched (dev)" button' })
      await waitFor(page, () => window.__fixture?.completed().includes('a4l22'), { timeout: 5000, what: 'row 5: a4l22 did not become watched' })
      const held = await page.evaluate(SNAP)
      await click(page, FIND.backLink, `${APP}/a4`, { what: 'row 5: the back link' })
      await waitPath(page, `${APP}/a4`, 'row 5')
      await waitPanel(page, 3, 'row 5')
      await waitFor(page, () => window.__worldCelebrations === 1, { timeout: 8000, soft: true, what: 'row 5: the done moment' })
      const back = await page.evaluate(SNAP)
      await closePlace(page, 'row 5')
      const done = await waitFor(
        page,
        () => {
          const el = document.querySelector('main section[aria-label="Place done"][data-show]')
          const title = el?.querySelector('h2')?.textContent.trim()
          return title ? { title, button: el.querySelector('button')?.textContent.trim() ?? '' } : null
        },
        { timeout: 20000, soft: true, what: 'row 5: the done card' },
      )
      await sleep(500)
      r.values.shot = await r.shot('done-card')
      r.check('the card said 21 of 22 on arrival', !!card && /(^|\D)21 of 22/.test(card.text), card?.text ?? null)
      r.check('the done card reads "Video Ads II done."', done?.title === 'Video Ads II done.', done)
      r.check('__worldCelebrations went from 0 to 1', before.celebrations === 0 && back.celebrations === 1, `${before.celebrations} then ${back.celebrations}`)
      r.values.placeFourDone = { arrival: before.progress?.done[3] ?? null, underTheLesson: held.progress?.done[3] ?? null, afterTheReturn: back.progress?.done[3] ?? null }
      const startOk = r.check('the done card offers "Start Static Ads"', done?.button === 'Start Static Ads', done?.button ?? null)
      if (startOk) {
        await click(page, FIND.doneButton, null, { what: 'row 5: Start Static Ads' })
        const rest = await restAt(page, 4, 'row 5, after Start Static Ads')
        r.check('"Start Static Ads" travels to place 5', true, `depth ${f(rest.d)}, the stop is at ${f(rest.t)}, after ${rest.ms} ms`)
        r.values.shotAfterStart = await r.shot('at-static-ads')
      }
    })

    // 6 ── Open and close a place by hand
    await runRow(6, nameOf(6), async (r) => {
      const page = await r.open(url('', { p: 'mid', arrive: 0, poster: 'off' }))
      await ready(page, 'row 6')
      await scrollToPlace(page, 4, 'row 6')
      await sleep(450)
      const y0 = await page.evaluate(() => Math.round(window.scrollY))
      r.values.click = await click(page, FIND.marker, 4, { what: 'row 6: the label of place 5' })
      await waitPath(page, `${APP}/a5`, 'row 6')
      await waitPanel(page, 4, 'row 6')
      const opened = await page.evaluate(SNAP)
      r.values.shot = await r.shot('place-open')
      await page.keyboard.press('Escape')
      await waitPath(page, APP, 'row 6, Escape')
      await waitNoPanel(page, 'row 6, Escape')
      const closed = await page.evaluate(SNAP)
      await page.evaluate(() => history.back())
      await waitPath(page, `${APP}/a5`, 'row 6, Back')
      await waitPanel(page, 4, 'row 6, Back')
      const back1 = await page.evaluate(SNAP)
      await page.evaluate(() => history.forward())
      await waitPath(page, APP, 'row 6, Forward')
      await waitNoPanel(page, 'row 6, Forward')
      const fwd = await page.evaluate(SNAP)
      await page.evaluate(() => history.back())
      await waitPath(page, `${APP}/a5`, 'row 6, Back again')
      await waitPanel(page, 4, 'row 6, Back again')
      const back2 = await page.evaluate(SNAP)
      const ys = [opened.y, closed.y, back1.y, fwd.y, back2.y]
      r.check('clicking the label makes the address /a5 with the panel open', opened.path === `${APP}/a5` && opened.panel?.title === 'Static Ads', { path: opened.path, panel: opened.panel?.title ?? null })
      r.check('Escape makes the address the base and closes the place', closed.path === APP && closed.panel === null && !closed.open, { path: closed.path, panel: closed.panel, open: closed.open })
      r.check('Back opens /a5 again', back1.path === `${APP}/a5` && back1.panel?.title === 'Static Ads', { path: back1.path, panel: back1.panel?.title ?? null })
      r.check('Forward closes it, Back opens it', fwd.path === APP && fwd.panel === null && back2.panel?.title === 'Static Ads', { forward: fwd.path, back: back2.path })
      r.check('scrollY is the same at every step', ys.every((y) => Math.abs(y - y0) <= 2), `${y0} before; then ${ys.join(', ')}`)
    })

    // 7 ── Deep link to a place
    await runRow(7, nameOf(7), async (r) => {
      const page = await r.open(url('/a6', { p: 'mid', arrive: 1, poster: 'off' }))
      // The map puts the page scroll on place 6's stop before it opens the place (the page loaded at
      // the top), so the place opens from its own stop and closes back to it. Watch the camera from
      // the moment the map is live until well after the arrival would have run (it starts 900 ms
      // after ready and lands within about 2 s): it must never be at place 4.
      const depths = []
      let maxY = 0
      let readyAt = null
      let last = null
      const t0 = Date.now()
      while (Date.now() - t0 < 75000) {
        try {
          last = await page.evaluate(() => {
            const fr = window.__worldFrame ?? null
            return {
              ready: window.__worldReady === true,
              error: window.__worldError ?? null,
              d: typeof window.__worldDepth === 'number' ? window.__worldDepth : null,
              a4: window.__worldDepthFor ? window.__worldDepthFor('a4') : null,
              y: Math.round(window.scrollY),
              panel: (document.querySelector('main section[aria-labelledby="v4-panel-title"] #v4-panel-title')?.textContent ?? '').trim(),
              park: fr ? fr.parkProgress : null,
              parked: fr ? fr.parkedId : null,
            }
          })
        } catch {
          last = null
        }
        if (last) {
          if (last.error) throw new Error(`row 7: the scene failed: ${last.error}`)
          if (last.ready && readyAt === null) readyAt = Date.now()
          if (last.ready && last.d !== null && last.a4 !== null) depths.push({ d: last.d, a4: last.a4 })
          if (last.ready) maxY = Math.max(maxY, last.y)
          if (readyAt !== null && Date.now() - readyAt > 5000 && last.panel === NAMES[5] && last.park !== null && last.park >= 0.999) break
        }
        await sleep(100)
      }
      if (readyAt === null) throw new Error('row 7: the map never reported ready')
      const s = await page.evaluate(SNAP)
      const a6Y = await page.evaluate(() => Math.round(window.__worldScrollFor(window.__worldDepthFor('a6'))))
      const nearA4 = depths.filter((x) => Math.abs(x.d - x.a4) < 0.01).length
      const range = depths.length ? `${f(Math.min(...depths.map((x) => x.d)))} to ${f(Math.max(...depths.map((x) => x.d)))}` : 'none'
      r.check('the place 6 panel opens after load', s.panel?.title === NAMES[5] && s.parked === 'a6' && s.park >= 0.999, { panel: s.panel?.title ?? null, parked: s.parked, park: s.park })
      r.check('the address is still /a6', s.path === `${APP}/a6`, s.path)
      r.check("the page scroll is on place 6's stop", Math.abs(s.y - a6Y) <= 2, `scrollY ${s.y} with the place open, the stop is at ${a6Y}; the most it read after ready was ${maxY}`)
      r.check(
        'no arrival travel ran: the camera never visits place 4',
        depths.length > 20 && nearA4 === 0,
        `${depths.length} reads over ${Math.round((Date.now() - readyAt) / 100) / 10} s after ready; rail depth ${range}; place 4 is at ${f(depths[0]?.a4)}; reads at place 4: ${nearA4}`,
      )
      r.values.shot = await r.shot('deep-link-place')
      // Closing it leaves the camera at place 6's stop, not back at the opening frame.
      await closePlace(page, 'row 7')
      const rest = await restAt(page, 5, 'row 7, after closing')
      await sleep(600) // the labels come back once the camera rests
      const closed = await page.evaluate(SNAP)
      r.check(
        "after Escape the address is the base and the camera rests at place 6's stop",
        closed.path === APP && closed.panel === null && Math.abs(closed.y - a6Y) <= 2,
        `path ${closed.path}; depth ${f(rest.d)}, the stop is at ${f(rest.t)}; scrollY ${closed.y}, the stop is at ${a6Y}`,
      )
      r.values.afterClosing = { card: closed.card?.title ?? null, chip: closed.chip }
      r.values.shotClosed = await r.shot('deep-link-place-closed')
    })

    // 8 ── Deep link to a lesson
    await runRow(8, nameOf(8), async (r) => {
      const page = await r.open(url('/a6/a6l03', { p: 'mid', arrive: 1, poster: 'off' }))
      await waitLesson(page, lessonTitle(6, 3), 'row 8', LOAD_MS)
      const lessonShown = await page.evaluate(SNAP)
      // The frame counter exists once the scene is live. Give it time to load under the lesson page.
      const liveUnder = await waitFor(page, () => window.__worldReady === true, { timeout: 30000, poll: 250, soft: true, what: 'row 8: ready under the lesson' })
      await sleep(1500) // past the arrival's 900 ms: it must not start under a lesson
      let probe = await pausedProbe(page)
      let probedOn = 'the direct load'
      r.values.shot = await r.shot('deep-link-lesson')
      await page.keyboard.press('Escape')
      await waitPath(page, `${APP}/a6`, 'row 8, Escape')
      await ready(page, 'row 8, after Escape')
      await waitPanel(page, 5, 'row 8, after Escape')
      const atPlace = await page.evaluate(SNAP)
      const a4Y = await page.evaluate(() => Math.round(window.__worldScrollFor(window.__worldDepthFor('a4'))))
      const a6Y = await page.evaluate(() => Math.round(window.__worldScrollFor(window.__worldDepthFor('a6'))))
      r.values.shotAfterEscape = await r.shot('deep-link-lesson-closed')
      const underLesson = probe
      if (typeof probe.f0 !== 'number') {
        // The scene was not live under the lesson page, so the counter could not be read then.
        // Go back to the lesson with the scene live and read it there.
        await page.evaluate(() => history.back())
        await waitPath(page, `${APP}/a6/a6l03`, 'row 8, back to the lesson')
        await waitLesson(page, lessonTitle(6, 3), 'row 8, back to the lesson')
        await sleep(600)
        probe = await pausedProbe(page)
        probedOn = 'a return to the lesson (the scene was not live under the direct load)'
      }
      r.check('the lesson page shows', lessonShown.lesson?.title === lessonTitle(6, 3) && lessonShown.path === `${APP}/a6/a6l03`, { title: lessonShown.lesson?.title ?? null, path: lessonShown.path })
      r.check(
        'the map is paused: the frame counter stands still and the root is inert',
        typeof probe.f0 === 'number' && probe.f0 === probe.f1 && probe.inert === true,
        `frames ${probe.f0} then ${probe.f1} 1.5 s later, inert ${probe.inert}, read on ${probedOn}`,
      )
      r.check(
        'no arrival travel started under the lesson page',
        underLesson.y0 === underLesson.y1 && Math.abs(underLesson.y1 - a4Y) > 2,
        `scrollY ${underLesson.y0} then ${underLesson.y1} 1.5 s later; an arrival would have put it on ${a4Y}`,
      )
      r.check('Escape makes the address /a6 with its panel', atPlace.path === `${APP}/a6` && atPlace.panel?.title === NAMES[5], { path: atPlace.path, panel: atPlace.panel?.title ?? null })
      // The scroll goes to the place's stop only once the lesson page has closed: nothing moves behind a lesson.
      r.check('the page stays at the top under the lesson page', underLesson.y0 < 2 && underLesson.y1 < 2, `scrollY ${underLesson.y0} then ${underLesson.y1}`)
      r.check("after Escape the page scroll is on place 6's stop", Math.abs(atPlace.y - a6Y) <= 2, `scrollY ${atPlace.y}, the stop is at ${a6Y}`)
      r.values.sceneLiveUnderTheLesson = !!liveUnder
    })

    // 9 ── Unknown addresses
    await runRow(9, nameOf(9), async (r) => {
      let page = await r.open(url('/zz', { p: 'mid', arrive: 0, poster: 'off' }))
      const place = await waitFor(page, SAYS, { arg: 'That place isn.t on the map\\.', timeout: LOAD_MS, soft: true, what: 'row 9: place' })
      await sleep(1500)
      const s1 = await page.evaluate(SNAP)
      r.values.shotPlace = await r.shot('unknown-place')
      page = await r.open(url('/a2/nope', { p: 'mid', arrive: 0, poster: 'off' }))
      const lesson = await waitFor(page, SAYS, { arg: 'That lesson isn.t here\\.', timeout: LOAD_MS, soft: true, what: 'row 9: lesson' })
      await sleep(1500)
      const s2 = await page.evaluate(SNAP)
      r.values.shotLesson = await r.shot('unknown-lesson')
      r.check('/zz says "That place isn\'t on the map."', !!place, s1.outside.slice(0, 120))
      r.check('/a2/nope says "That lesson isn\'t here."', !!lesson, s2.outside.slice(0, 120))
      r.check('no page error', r.pageErrors.length === 0, r.pageErrors.map((e) => e.message).slice(0, 2))
    })

    // 10 ── Out-of-order progress
    await runRow(10, nameOf(10), async (r) => {
      const page = await r.open(url('', { p: 'ooo', arrive: 0, poster: 'off' }))
      await ready(page, 'row 10')
      await scrollToPlace(page, 1, 'row 10')
      const card = await waitCard(page, 'row 10')
      r.values.click = await click(page, FIND.marker, 1, { what: 'row 10: the label of place 2' })
      await waitPath(page, `${APP}/a2`, 'row 10')
      await waitPanel(page, 1, 'row 10')
      const first = await page.evaluate(READ_PANEL)
      const panel = await readPanel(page, 'row 10')
      const s = await page.evaluate(SNAP)
      const done = panel.rows.filter((x) => x.kind === 'done').map((x) => x.n)
      const next = panel.rows.filter((x) => x.kind === 'next').map((x) => x.n)
      r.check('the card says 4 of 10', !!card && card.title === 'Fundamentals' && /(^|\D)4 of 10/.test(card.text), card?.text ?? null)
      r.check('the panel\'s count line says 4 of 10', /(^|\D)4 of 10/.test(first?.count ?? ''), first?.count ?? null)
      r.check('rows 1, 2, 3 and 7 are done', same(done, [1, 2, 3, 7]), done)
      r.check('the next row is lesson 4', same(next, [4]), next)
      r.check('__worldProgress().done[1] is 4', s.progress?.done[1] === 4, s.progress?.done ?? null)
      r.values.folded = panel.folded
      r.values.timeline = s.count
      r.values.shot = await r.shot('out-of-order')
    })

    // 11 ── Everything done
    await runRow(11, nameOf(11), async (r) => {
      const page = await r.open(url('', { p: 'all', arrive: 1, poster: 'off' }))
      await ready(page, 'row 11')
      const rest = await restAt(page, 7, 'row 11')
      const card = await waitCard(page, 'row 11')
      await sleep(600)
      const s = await page.evaluate(SNAP)
      r.check('the camera rests at place 8', true, `depth ${f(rest.d)}, the stop is at ${f(rest.t)}, ${rest.ms} ms after ready`)
      r.check('the card reads "Every place done."', card?.title === 'Every place done.', card?.title ?? null)
      r.check(`the card reads "${TOTAL} of ${TOTAL} lessons"`, !!card && card.text.includes(`${TOTAL} of ${TOTAL} lessons`), card?.text ?? null)
      r.check('no chip', s.chip === null, s.chip)
      r.values.current = s.current
      r.values.shot = await r.shot('everything-done')
    })

    // 12 ── The feature row
    await runRow(12, nameOf(12), async (r) => {
      const page = await r.open(url('', { p: 'mid', arrive: 0, poster: 'off' }))
      await ready(page, 'row 12')
      r.values.open = await openPlace(page, 6, 'row 12')
      const panel = await page.evaluate(READ_PANEL)
      r.values.shotPanel = await r.shot('place-7-panel')
      const yBefore = await page.evaluate(() => Math.round(window.scrollY))
      r.values.click = await click(page, FIND.feature, null, { what: 'row 12: the "Ad Bounty" row as a button', scroll: 'box' })
      await waitPath(page, `${APP}/a7/a7l22`, 'row 12')
      await waitFor(page, SAYS, { arg: FEATURE_TEXT, timeout: NAV_MS, soft: true, what: 'row 12: the setup text' })
      await sleep(1200)
      const s = await page.evaluate(SNAP)
      r.check('the panel has the Ad Bounty row', /Ad Bounty/.test(panel?.feature ?? ''), panel?.feature ?? null)
      r.check('the address ends /a7/a7l22', s.path === `${APP}/a7/a7l22`, s.path)
      r.check('the page shows the setup text', s.outside.includes(FEATURE_TEXT), s.outside.slice(0, 200))
      r.check('no player', s.iframes === 0 && !/Not recorded yet\.|Loading video…/.test(s.outside), { iframes: s.iframes })
      r.check('no request to /api', r.api.length === 0, r.api.map((x) => `${x.method} ${x.url}`).slice(0, 3))
      r.values.scrollY = `${yBefore} before the click, ${s.y} on the page`
      r.values.shot = await r.shot('feature-page')
    })

    // 13 ── An action item
    await runRow(13, nameOf(13), async (r) => {
      const page = await r.open(url('', { p: 'mid', arrive: 0, poster: 'off' }))
      await ready(page, 'row 13')
      r.values.open = await openPlace(page, 3, 'row 13')
      r.values.click = await click(page, FIND.panelRow, 21, { what: 'row 13: the row of lesson 21', scroll: 'box' })
      await waitPath(page, `${APP}/a4/a4l21`, 'row 13')
      await waitLesson(page, lessonTitle(4, 21), 'row 13')
      await sleep(500)
      const s = await page.evaluate(SNAP)
      r.check('the address ends /a4/a4l21', s.path === `${APP}/a4/a4l21`, s.path)
      r.check('the page shows the "Milestone" box', /Milestone/.test(s.outside), s.outside.slice(0, 220))
      r.check('with the brief', s.outside.includes(briefStart('a4l21')), s.outside.includes(briefStart('a4l21')))
      r.values.shot = await r.shot('action-item')
    })

    // 14 ── Minutes shown and hidden
    await runRow(14, nameOf(14), async (r) => {
      let page = await r.open(url('', { p: 'p0', arrive: 0, poster: 'off' }))
      await ready(page, 'row 14, place 1')
      await openPlace(page, 0, 'row 14, place 1')
      const p1 = await readPanel(page, 'row 14, place 1')
      r.values.shotPlace1 = await r.shot('minutes-shown')
      const want = Array.from({ length: 8 }, (_, i) => `${area1Minutes(i + 1)} min`)
      const got1 = p1.rows.map((x) => x.tail)
      r.check('place 1: every row shows its minutes', same(got1, want), got1)
      r.check('place 1: the count line shows minutes', /\d+ min\b/.test(p1.count ?? ''), p1.count)

      page = await r.open(url('', { p: 'mid', arrive: 0, poster: 'off' }))
      await ready(page, 'row 14, place 4')
      await openPlace(page, 3, 'row 14, place 4')
      const p4first = await page.evaluate(READ_PANEL)
      const p4 = await readPanel(page, 'row 14, place 4')
      r.values.shotPlace4 = await r.shot('minutes-hidden')
      // After the number, the title and "Watch" are taken out, a row may hold "Action" and nothing else.
      const stray = p4.rows.filter((x) => x.tail !== '' && x.tail !== 'Action').map((x) => `${x.n}: "${x.tail}"`)
      const count4 = p4first?.count ?? ''
      r.check('place 4: 22 rows, none shows minutes or a stray separator', p4.rows.length === 22 && stray.length === 0, stray.length ? stray : `${p4.rows.length} rows clean`)
      r.check('place 4: the count line shows no minutes and no stray separator', count4 !== '' && !/\bmin\b/.test(count4) && !/·\s*$|^\s*·|·\s*·/.test(count4), count4)
      r.check('place 4: no minutes anywhere in the panel', !/\d\s*min\b/.test(p4.text), /\d\s*min\b/.exec(p4.text)?.[0] ?? 'none')
      // Place 4 has lessons watched, so its count line never held minutes. Place 5 has none watched and no
      // durations: the count line there is the one that would have said "25 lessons · N min".
      await closePlace(page, 'row 14, closing place 4')
      await openPlace(page, 4, 'row 14, place 5')
      const p5 = await page.evaluate(READ_PANEL)
      r.check('place 5 (nothing watched, no durations): the count line is "25 lessons"', p5?.count === '25 lessons', p5?.count ?? null)
    })

    // 15 ── Phone
    await runRow(15, nameOf(15), async (r) => {
      const page = await r.open(url('', { p: 'mid' }), { viewport: PHONE })
      await waitFor(page, () => document.querySelector('main')?.dataset.view === 'list', { timeout: LOAD_MS, poll: 200, what: 'row 15: the list view did not show at 390x844' })
      await page.evaluate(() => document.fonts.ready.then(() => true))
      await sleep(800)
      const list = await page.evaluate(() => {
        const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim()
        const next = document.querySelector('main section[aria-label="Next lesson"]')
        return {
          rows: [...(document.querySelector('main ol')?.children ?? [])].map((li) => li.querySelector('button')?.getAttribute('aria-label') ?? null),
          nextTitle: norm(next?.querySelector('h2')?.textContent),
          nextText: norm(next?.textContent),
          canvases: document.querySelectorAll('canvas').length,
        }
      })
      r.values.shot = await r.shot('phone-list')
      const doneMid = [8, 10, 22, 18, 0, 0, 0, 0]
      const wantRows = NAMES.map((n, k) => `${n}, ${doneMid[k]} of ${COUNTING[k]} lessons done`)
      await click(page, FIND.listRow, 3, { what: 'row 15: the fourth row of the list', scroll: 'page' })
      await waitPath(page, `${APP}/a4`, 'row 15')
      await waitPanel(page, 3, 'row 15')
      const sheet = await page.evaluate(SNAP)
      r.values.shotSheet = await r.shot('phone-sheet')
      await click(page, FIND.panelWatch, null, { what: 'row 15: Watch in the sheet', scroll: 'page' })
      await waitPath(page, `${APP}/a4/a4l19`, 'row 15')
      await waitLesson(page, lessonTitle(4, 19), 'row 15')
      await sleep(500)
      const lesson = await page.evaluate(SNAP)
      const under = await page.evaluate(LAYERS)
      r.values.shotLesson = await r.shot('phone-lesson')
      await click(page, FIND.backLink, `${APP}/a4`, { what: 'row 15: the back link', scroll: 'page' })
      await waitPath(page, `${APP}/a4`, 'row 15, back')
      await waitPanel(page, 3, 'row 15, back')
      const back = await page.evaluate(SNAP)
      const backLayers = await page.evaluate(LAYERS)
      r.check('the list view, with the real names and counts', same(list.rows, wantRows), list.rows)
      r.check('the Next block says Video Ads II and 18 of 22', list.nextTitle === 'Video Ads II' && /(^|\D)18 of 22/.test(list.nextText), list.nextText)
      r.check('no canvas in the DOM', list.canvases === 0 && back.canvases === 0, `${list.canvases} at load, ${back.canvases} at the end`)
      r.check('a row opens the sheet and the address becomes /a4', sheet.path === `${APP}/a4` && sheet.panel?.role === 'dialog' && sheet.panel?.title === 'Video Ads II', { path: sheet.path, panel: sheet.panel })
      r.check('Watch opens the lesson page', lesson.path === `${APP}/a4/a4l19` && lesson.lesson?.title === lessonTitle(4, 19), { path: lesson.path, title: lesson.lesson?.title ?? null })
      r.check('back returns to the sheet', back.path === `${APP}/a4` && back.panel?.title === 'Video Ads II', { path: back.path, panel: back.panel })
      r.check('under the lesson page the list, the sheet and the header are not visible', under.list === false && under.sheet === false && under.header === false, under)
      r.check('after the return they are visible again', backLayers.list === true && backLayers.sheet === true && backLayers.header === true, backLayers)
    })

    // 16 ── Poster mode
    await runRow(16, nameOf(16), async (r) => {
      const page = await r.open(url('', { p: 'mid', poster: 'on', arrive: 0 }))
      await ready(page, 'row 16')
      await scrollToPlace(page, 3, 'row 16')
      const card = await waitCard(page, 'row 16')
      const atCard = await page.evaluate(SNAP)
      r.values.shot = await r.shot('poster-card')
      await click(page, FIND.cardWatch, null, { what: 'row 16: Watch on the card' })
      await waitPath(page, `${APP}/a4/a4l19`, 'row 16')
      await waitLesson(page, lessonTitle(4, 19), 'row 16')
      const lesson = await page.evaluate(SNAP)
      await click(page, FIND.backLink, `${APP}/a4`, { what: 'row 16: the back link' })
      await waitPath(page, `${APP}/a4`, 'row 16, back')
      await waitPanel(page, 3, 'row 16, back')
      const panel = await page.evaluate(READ_PANEL)
      r.values.shotPanel = await r.shot('poster-panel')
      await closePlace(page, 'row 16')
      const closed = await page.evaluate(SNAP)
      r.check('the still views are up', atCard.poster === true, atCard.poster)
      r.check('the card works', card?.title === 'Video Ads II' && /(^|\D)18 of 22/.test(card?.text ?? ''), card?.text ?? null)
      r.check('Watch reaches the lesson address', lesson.path === `${APP}/a4/a4l19` && lesson.lesson?.title === lessonTitle(4, 19), lesson.path)
      r.check('back returns, and the panel works', panel?.title === 'Video Ads II' && panel.rows.length > 0, { title: panel?.title ?? null, rows: panel?.rows.length ?? 0, fold: panel?.fold ?? null })
      r.check('Escape closes the place', closed.path === APP && closed.panel === null, closed.path)
    })

    // 17 ── Reduced motion
    await runRow(17, nameOf(17), async (r) => {
      const page = await r.open(url('', { p: 'mid', arrive: 1, poster: 'off' }), { reducedMotion: true })
      // Arrival: every depth read from ready on is the opening's or place 4's, with nothing between.
      const reads = []
      let readyAt = null
      let landedAt = null
      const t0 = Date.now()
      while (Date.now() - t0 < 75000) {
        let v = null
        try {
          v = await page.evaluate(() => ({
            ready: window.__worldReady === true,
            error: window.__worldError ?? null,
            d: typeof window.__worldDepth === 'number' ? window.__worldDepth : null,
            a4: window.__worldDepthFor ? window.__worldDepthFor('a4') : null,
          }))
        } catch {
          v = null
        }
        if (v) {
          if (v.error) throw new Error(`row 17: the scene failed: ${v.error}`)
          if (v.ready && readyAt === null) readyAt = Date.now()
          if (v.ready && v.d !== null && v.a4 !== null) {
            reads.push(v)
            if (landedAt === null && Math.abs(v.d - v.a4) < DEPTH_TOL) landedAt = Date.now()
          }
          if (landedAt !== null && Date.now() - landedAt > 700) break
          if (readyAt !== null && Date.now() - readyAt > 12000) break
        }
        await sleep(40)
      }
      if (readyAt === null) throw new Error('row 17: the map never reported ready')
      const between = reads.filter((v) => Math.abs(v.d - reads[0].d) > 1e-3 && Math.abs(v.d - v.a4) > DEPTH_TOL).map((v) => f(v.d))
      r.check(
        'arrival is instant',
        landedAt !== null && between.length === 0 && landedAt - readyAt < 3000,
        landedAt === null
          ? `never reached place 4 (last depth ${f(reads.at(-1)?.d)})`
          : `at place 4 ${landedAt - readyAt} ms after ready (the wait is 900 ms); ${reads.length} reads, ${between.length} between the opening and place 4`,
      )
      await waitCard(page, 'row 17')
      r.values.shot = await r.shot('reduced-motion')

      // Opening a place: the panel and the camera arrive with no frames in between.
      const watchPark = async (until, limit) => {
        const seen = []
        const start = Date.now()
        let doneAt = null
        while (Date.now() - start < limit) {
          const v = await page.evaluate(() => ({
            park: window.__worldFrame ? window.__worldFrame.parkProgress : null,
            panel: !!document.querySelector('main section[aria-labelledby="v4-panel-title"]'),
          }))
          seen.push(v.park)
          if (until(v)) {
            doneAt = Date.now() - start
            break
          }
          await sleep(30)
        }
        return { ms: doneAt, mid: seen.filter((p) => p !== null && p > 0.02 && p < 0.98).length }
      }
      r.values.click = await click(page, FIND.marker, 3, { what: 'row 17: the label of place 4' })
      const opening = await watchPark((v) => v.panel && v.park !== null && v.park >= 0.999, 6000)
      await waitPath(page, `${APP}/a4`, 'row 17, opening')
      const opened = await page.evaluate(SNAP)
      await page.keyboard.press('Escape')
      const closing = await watchPark((v) => !v.panel && (v.park === null || v.park <= 0.001), 6000)
      await waitPath(page, APP, 'row 17, closing')
      const closed = await page.evaluate(SNAP)
      r.check('opening a place is instant', opening.ms !== null && opening.ms < 1000 && opening.mid === 0, `${opening.ms} ms, ${opening.mid} reads part way in`)
      r.check('closing a place is instant', closing.ms !== null && closing.ms < 1000 && closing.mid === 0, `${closing.ms} ms, ${closing.mid} reads part way out`)
      r.check('the addresses still follow', opened.path === `${APP}/a4` && opened.panel?.title === 'Video Ads II' && closed.path === APP && closed.panel === null, { opened: opened.path, closed: closed.path })
    })

    // 18 ── Catalog not ready
    await runRow(18, nameOf(18), async (r) => {
      const cards = [
        ['loading', /Loading the world(…|\.\.\.)/],
        ['error', /Your course didn.t load\./],
        ['empty', /There are no lessons here yet\./],
        ['shape', /The new course isn.t switched on here yet\./],
      ]
      for (const [mode, wording] of cards) {
        const page = await r.open(url('', { p: 'mid', catalog: mode, arrive: 0 }))
        const said = await waitFor(page, SAYS, {
          arg: wording.source,
          timeout: LOAD_MS,
          poll: 200,
          soft: true,
          what: `row 18: ${mode}`,
        })
        await sleep(2500) // long enough for a map to have started building, had one been mounted
        const still = await page.evaluate(SAYS, wording.source)
        const s = await page.evaluate(() => {
          const norm = (t) => (t ?? '').replace(/\s+/g, ' ').trim()
          const live = (el) => !el.closest('nextjs-portal')
          return {
            canvases: document.querySelectorAll('canvas').length,
            map: !!document.querySelector('main'),
            ready: window.__worldReady === true,
            kind: document.querySelector('[data-world-card]')?.getAttribute('data-world-card') ?? null,
            buttons: [...document.querySelectorAll('button')].filter(live).map((b) => norm(b.textContent)),
            links: [...document.querySelectorAll('a')].filter(live).map((a) => `${norm(a.textContent)} -> ${a.getAttribute('href')}`),
          }
        })
        r.values[`shot-${mode}`] = await r.shot(`catalog-${mode}`)
        r.check(`${mode}: its card and wording`, !!said && still, s.kind)
        r.check(`${mode}: no canvas is created`, s.canvases === 0 && !s.map && !s.ready, { canvases: s.canvases, map: s.map, ready: s.ready })
        if (mode === 'error') r.check('error: it has the "Try again" button', s.buttons.includes('Try again'), s.buttons)
        if (mode === 'shape') r.values.shapeLinks = s.links
      }
    })

    // 19 ── No dev tools
    await runRow(19, nameOf(19), async (r) => {
      const tools = () => ({
        view: document.querySelector('main')?.dataset.view ?? null,
        tune: [...document.querySelectorAll('button')].filter((b) => /^Tune\b/i.test(b.textContent.trim())).length,
        tunePanel: document.querySelectorAll('section[aria-label="Tuning (dev only)"]').length,
        v3: document.querySelectorAll('a[href="/dev/world-v3"]').length,
        astra: document.querySelectorAll('a[href="/dev/world-codex"]').length,
        named: [...document.querySelectorAll('main a')].filter((a) => /^(V3|Astra)$/.test(a.textContent.trim())).length,
        bench: document.querySelectorAll('section[aria-label="Bench results"]').length,
      })
      let page = await r.open(url('', { p: 'mid', arrive: 0, poster: 'off' }))
      await ready(page, 'row 19')
      await sleep(800)
      const a = await page.evaluate(tools)
      r.values.shot = await r.shot('no-dev-tools')
      // Bench mode only ever draws its panel when asked with ?bench=1, so ask.
      page = await r.open(url('', { p: 'mid', arrive: 0, poster: 'off', bench: 1 }))
      await ready(page, 'row 19, ?bench=1')
      await sleep(3000)
      const b = await page.evaluate(tools)
      r.check('the world view is up', a.view === 'world' && b.view === 'world', `${a.view}, ${b.view}`)
      r.check('no TUNE button', a.tune === 0 && a.tunePanel === 0, { button: a.tune, panel: a.tunePanel })
      r.check('no V3 or Astra link', a.v3 === 0 && a.astra === 0 && a.named === 0, { v3: a.v3, astra: a.astra, byName: a.named })
      r.check('no bench panel, also with ?bench=1', a.bench === 0 && b.bench === 0, { plain: a.bench, asked: b.bench })
    })
  }

  // 20 ── Quiet network and console: every page above, the warm-up included.
  if (!ONLY || ONLY.has('20')) {
    const rec = { id: 20, name: nameOf(20), pass: false, checks: [], values: {}, error: down ? 'not run, the harness did not render' : null, ms: 0 }
    if (!down) {
      const ranRows = results.map((x) => x.id)
      rec.checks.push({
        label: 'requests to /api/student/*',
        ok: tally.apiStudent.length === 0,
        got: tally.apiStudent.length === 0 ? 0 : tally.apiStudent.slice(0, 5).map((x) => `row ${x.row}: ${x.method} ${x.url}`),
      })
      rec.checks.push({
        label: 'page errors',
        ok: tally.pageErrors.length === 0,
        got: tally.pageErrors.length === 0 ? 0 : tally.pageErrors.slice(0, 5).map((x) => `row ${x.row}: ${x.message}`),
      })
      rec.values.pagesOpened = tally.pages
      rec.values.rows = ONLY ? `only ${ranRows.join(', ')} (a partial run)` : 'every row above and the warm-up'
      rec.values.otherApiRequests = tally.api.length - tally.apiStudent.length
      // Not part of this row's test: what the console logged as an error, for whoever reads the run.
      rec.values.consoleErrors = tally.consoleErrors.length
      if (tally.consoleErrors.length) rec.values.firstConsoleErrors = [...new Set(tally.consoleErrors.map((x) => `row ${x.row}: ${x.message}`))].slice(0, 4)
      rec.pass = rec.checks.every((c) => c.ok)
    }
    results.push(rec)
    printRow(rec)
  }
} finally {
  await browser.close().catch(() => {})
}

for (const [id, name, why] of GAPS) console.log(`NOT COVERED  ${id}  ${name}: ${why}`)

const passed = results.filter((x) => x.pass).length
const failed = results.length - passed
fs.writeFileSync(
  path.join(OUT, 'results.json'),
  JSON.stringify({ at: new Date().toISOString(), base: `${ORIGIN}${APP}`, only: onlyArg, results, tally, notCovered: GAPS.map(([id, name, why]) => ({ id, name, why })) }, null, 1),
)
if (ONLY) console.log(`partial run: rows ${[...ONLY].join(', ')} only`)
console.log(`PASS ${passed}  FAIL ${failed}  NOT COVERED ${GAPS.length}`)
process.exit(failed > 0 ? 1 : 0)
