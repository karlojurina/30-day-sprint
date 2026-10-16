/**
 * The student's group in the map's header (2026-10-14; at its right end since
 * 2026-10-15): the streak, the achievements and Sign out, walked in a real
 * browser.
 *
 *   node world-tests/v6-hud.mjs [--only 1,3]
 *
 * Runs against http://localhost:3111/dev/world-app?catalog=course, which must
 * already be up (this script never starts a server). The harness of
 * v6-discount.mjs: the real stage, map, place route and lesson page, a pretend
 * student, no login, no server call. The corner's data comes from ?hud=<preset>
 * (src/app/dev/world-app/fixtureHud.tsx): the streak on the pretend
 * StudentContext, the achievements and Sign out on HudStandInContext.
 * Headless Chrome on the real GPU, at 1691x1278 unless a row says otherwise
 * (3428x1230 wide, 390x844 phone). About 4 minutes.
 *
 * One PASS or FAIL line per row, with what was measured. Every row loads its
 * own pages in its own browser context. After the rows, one MEASURED line:
 * requests to /api, requests to Supabase and page errors over every page the
 * run opened (all three must be 0). Exit code 1 on any FAIL.
 *
 *   1  each ?hud= state in the header: the pill says the streak and the count
 *      (none, cold, some, long, all), the flame is lit only while a streak
 *      runs. Since 2026-10-15 (Lovro's review) the pill is the group at the
 *      header's right end, Sign out its last part, and the brand stands
 *      alone at the left
 *   2  the list: the pill opens it under itself on the right, the place
 *      panel's size; it says the streak, the best and the count, lists every
 *      achievement by tier with the share of students, hides the two secret
 *      ones until earned; Back to map closes it; a click outside closes it
 *   3  a fresh unlock (?hud=fresh): the toast slides out of the pill to its
 *      left with the name, the count turns sand, a status line reads it out;
 *      after 6.5 s it goes; the list marks it New. At 1024 and 800 px wide,
 *      with the widest group, it sits under the pill, whole, and the logo
 *      holds still
 *   4  with a place open the corner stays above its panel without touching
 *      it; the list opens on the right, clear of the panel, solid; Esc closes
 *      the list and leaves the place open; a second Esc closes the place;
 *      opening a place closes the list; the checkpoint's panel too, with the
 *      discount's segment inside the pill. With the list open, the discount's
 *      segment (a click at 1691 px, Shift+Tab back to it and Enter at 800 px,
 *      a click at 800 px from an open place) parks the camera at the cache
 *      and closes the list: one panel, focus in it, nothing over the cache
 *   5  the keyboard: Tab reaches the pill (focus ring), Enter opens the list
 *      with focus inside, Esc closes it and focus is back on the pill, Tab
 *      reaches Sign out and its word shows
 *   6  Sign out goes to the app's sign-out (the stand-in counts it), from the
 *      pill and from the list
 *   7  under a lesson page the corner is not visible; an unlock that lands
 *      there toasts once the student is back on the map
 *   8  through the telescope (Creative Strategy's click-in) the corner steps
 *      out of the sky caption's row
 *   9  wide (3428x1230): the pill at the right end, the list under it, the
 *      toast
 *  10  phone (390x844): the stats in the header's row at its right end,
 *      across from the brand, and the discount in the row under them,
 *      right-aligned; the list is a full sheet with Sign out; the toast sits
 *      at the bottom; the course's count (the header's 01/08 went) heads
 *      the list of places and adds up the places' counts
 *  11  the streak's moment in the pill (since 2026-10-15 the daily streak has
 *      no full-screen moment; ?celebrate=1 lets it fire, the streak set to 9
 *      then 10): while it plays the number stays inside the pill, the pill
 *      keeps its edge, and nothing around it moves; it is read out on a line
 *      of its own, the toast's left empty. At 1691 px and on a phone. When it
 *      fires, and the rest of it, is v6-celebrations.mjs
 *
 * Pictures for a person, in world-tests/shots/v6/hud/ (git-ignored):
 *   state-<preset>.png      the header's right end per state (row 1)
 *   map-some.png            the whole frame, some (row 1)
 *   list-<preset>.png       the list open, cold / some / all (row 2)
 *   fresh-toast.png         the toast up, the count sand (row 3)
 *   fresh-list.png          the list after it, the row marked New (row 3)
 *   place-corner.png        a place open, the corner above it (row 4)
 *   place-list.png          the list over the place's panel (row 4)
 *   checkpoint-corner.png   the checkpoint's panel open, the corner above it (row 4)
 *   checkpoint-from-list-*.png  the checkpoint opened from the segment with the list up: the list gone (row 4)
 *   focus-pill.png          the pill with the keyboard's ring (row 5)
 *   focus-list.png          the list from the keyboard, Back focused (row 5)
 *   focus-signout.png       Sign out focused, its word showing (row 5)
 *   back-from-lesson.png    the toast on the map after the lesson page (row 7)
 *   wide-*.png              row 9
 *   phone-*.png             row 10
 *
 * What a row reads:
 *   the pill     main header button[aria-expanded] (the stats), main header
 *                button[aria-label="Sign out"]
 *   the list     main header [role="dialog"], its h2
 *   the toast    main header button[aria-hidden="true"] (its words), and the
 *                status line main header [role="status"]
 *   the place    main section[aria-labelledby="v4-panel-title"]
 *   the stand-in window.__fixtureHud (preset, unlock(id), held(), signOuts())
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const ORIGIN = process.env.BASE_URL || 'http://localhost:3111'
const APP = '/dev/world-app'
const OUT = path.join(HERE, 'shots', 'v6', 'hud')
fs.mkdirSync(OUT, { recursive: true })

const argv = process.argv.slice(2)
const onlyArg = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null
const ONLY = onlyArg ? new Set(onlyArg.split(',').map((x) => x.trim())) : null

const DESKTOP = { width: 1691, height: 1278 }
const WIDE = { width: 3428, height: 1230 }
const PHONE = { width: 390, height: 844 }
const READY_MS = 120000
const PARK_MS = 30000
/** The toast's time on screen (WorldCorner.tsx TOAST_MS). */
const TOAST_MS = 6500
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const show = (v) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s === undefined ? 'undefined' : s.length > 360 ? `${s.slice(0, 360)}…` : s
}
const url = (params = {}, sub = '') => `${APP}${sub}?${new URLSearchParams({ catalog: 'course', arrive: '0', poster: 'off', ...params }).toString()}`

const tally = { pages: 0, api: [], supabase: [], pageErrors: [] }
const results = []

// ── In the page ─────────────────────────────────────────────────────────────

const FIND = {
  pill: () => document.querySelector('main header button[aria-expanded]'),
  out: () => document.querySelector('main header button[aria-label="Sign out"]'),
  list: () => document.querySelector('main header [role="dialog"]'),
  back: () => [...(document.querySelector('main header [role="dialog"]')?.querySelectorAll('button') ?? [])].find((b) => /^Back/.test(b.textContent.trim())) ?? null,
  listSignOut: () => [...(document.querySelector('main header [role="dialog"]')?.querySelectorAll('button') ?? [])].find((b) => /^Sign out$/.test(b.textContent.trim())) ?? null,
  toast: () => document.querySelector('main header button[aria-hidden="true"]'),
  place: () => document.querySelector('main section[aria-labelledby="v4-panel-title"]'),
  cpPanel: () => document.querySelector('main section[aria-labelledby="cp-panel-title"]'),
  cpChip: () => document.querySelector('main header button[aria-label*="discount checkpoint"]'),
}

/** What the corner shows right now. */
const SNAP = () => {
  const norm = (s) => (s ?? '').replace(/\s+/g, ' ').trim()
  const box = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) }
  }
  const seen = (el) => {
    if (!el) return false
    const cs = getComputedStyle(el)
    const r = el.getBoundingClientRect()
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05 && r.width > 0 && r.height > 0
  }
  const main = document.querySelector('main')
  const header = document.querySelector('main header')
  const pill = document.querySelector('main header button[aria-expanded]')
  const out = document.querySelector('main header button[aria-label="Sign out"]')
  // Since 2026-10-15 the header holds two things: the brand, then the group at the right end.
  const brand = header?.firstElementChild
  const end = header?.lastElementChild
  const chip = document.querySelector('main header button[aria-label*="discount checkpoint"]')
  const list = document.querySelector('main header [role="dialog"]')
  const toast = document.querySelector('main header button[aria-hidden="true"]')
  const status = document.querySelector('main header [role="status"]')
  const place = document.querySelector('main section[aria-labelledby="v4-panel-title"]')
  const cp = document.querySelector('main section[aria-labelledby="cp-panel-title"]')
  const flame = pill?.querySelector('svg')
  const count = pill?.querySelectorAll(':scope > span')[2]
  const rows = list ? [...list.querySelectorAll('ul > li')] : []
  const groups = list ? [...list.querySelectorAll('ul')].map((u) => norm(u.previousElementSibling?.innerText)) : []
  const listCs = list ? getComputedStyle(list) : null
  const at = document.activeElement
  return {
    path: location.pathname,
    view: main?.dataset.view ?? null,
    pill: pill ? { text: norm(pill.innerText), label: pill.getAttribute('aria-label'), expanded: pill.getAttribute('aria-expanded'), box: box(pill), seen: seen(pill) } : null,
    pillBox: box(pill?.parentElement),
    flameLit: flame ? flame.hasAttribute('data-lit') : null,
    countFresh: count ? count.hasAttribute('data-fresh') : null,
    countColor: count?.querySelector('b') ? getComputedStyle(count.querySelector('b')).color : null,
    out: out ? { box: box(out), seen: seen(out) } : null,
    brand: box(brand),
    end: box(end),
    headerKids: header?.childElementCount ?? 0,
    chip: box(chip),
    vw: innerWidth,
    list: list
      ? {
          box: box(list),
          seen: seen(list),
          modal: list.getAttribute('aria-modal'),
          sheet: list.hasAttribute('data-sheet'),
          text: norm(list.innerText),
          rows: rows.map((li) => ({ text: norm(li.innerText), held: li.hasAttribute('data-held'), fresh: li.hasAttribute('data-new') })),
          groups,
          backdrop: listCs.backdropFilter,
          bg: listCs.backgroundColor,
          scrollH: list.firstElementChild?.scrollHeight ?? 0,
          clientH: list.firstElementChild?.clientHeight ?? 0,
        }
      : null,
    toast: toast ? { text: norm(toast.innerText), box: box(toast), seen: seen(toast) } : null,
    status: status ? norm(status.textContent) : null,
    place: place ? { box: box(place), opacity: Number(getComputedStyle(place).opacity) } : null,
    cp: cp ? { box: box(cp), opacity: Number(getComputedStyle(cp).opacity) } : null,
    park: window.__worldFrame ? { id: window.__worldFrame.parkedId, p: window.__worldFrame.parkProgress, flight: window.__worldFrame.flight } : null,
    headerSeen: seen(header),
    focus: at ? { tag: at.tagName, label: at.getAttribute('aria-label'), text: norm(at.textContent).slice(0, 40), inList: !!list && list.contains(at) } : null,
    hud: window.__fixtureHud ? { preset: window.__fixtureHud.preset, held: window.__fixtureHud.held(), signOuts: window.__fixtureHud.signOuts() } : null,
  }
}

/** The streak's moment (row 11): whether it plays, the number and its box, the pill's, the brand's, the two status lines. */
const MOMENT_SNAP = () => {
  const box = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) }
  }
  const btn = document.querySelector('main header button[aria-expanded]')
  const seg = btn?.querySelector(':scope > span')
  const num = seg?.querySelector('b')
  const lines = [...document.querySelectorAll('main header [role="status"]')].map((s) => s.textContent)
  return {
    on: !!seg?.hasAttribute('data-tick'),
    n: num?.textContent ?? null,
    num: box(num),
    pill: box(btn?.parentElement),
    brand: box(document.querySelector('main header')?.firstElementChild),
    status: lines[0] ?? null,
    say: lines[1] ?? null,
  }
}

// ── Driving ─────────────────────────────────────────────────────────────────

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

/** Wait until a FIND function finds its element (page.evaluate cannot hand a node back, so it is tested in the page). */
const present = (page, find, opts) => waitFor(page, (src) => !!new Function(`return (${src})()`)(), { ...opts, arg: find.toString() })
/** Whether a FIND function finds its element now. */
const has = (page, find) => page.evaluate((src) => !!new Function(`return (${src})()`)(), find.toString())

async function openPage(ctx, row, urlPath, viewport = DESKTOP) {
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
    if (u.origin === ORIGIN && u.pathname.startsWith('/api')) {
      row.api.push(u.pathname)
      tally.api.push({ row: row.id, path: u.pathname })
    }
    if (/supabase/i.test(u.hostname)) {
      row.api.push(u.hostname)
      tally.supabase.push({ row: row.id, host: u.hostname, path: u.pathname })
    }
  })
  await page.goto(ORIGIN + urlPath, { waitUntil: 'domcontentloaded', timeout: READY_MS })
  const phone = viewport.width < 760
  await waitFor(page, phone ? () => document.querySelector('main[data-view="list"] header button[aria-expanded]') !== null : () => window.__worldReady === true, {
    timeout: READY_MS,
    poll: 400,
    what: `${urlPath}: the map was not ready`,
  })
  await sleep(900)
  return page
}

/** Click an element the way a person would when it is on top, else through the DOM. */
async function click(page, find, what) {
  const via = await page.evaluate((src) => {
    const el = new Function(`return (${src})()`)()
    if (!el) return null
    const r = el.getBoundingClientRect()
    const x = r.left + r.width / 2
    const y = r.top + r.height / 2
    const top = r.width > 0 ? document.elementFromPoint(x, y) : null
    if (top && (top === el || el.contains(top))) return { mouse: true, x, y }
    el.click()
    return { mouse: false }
  }, find.toString())
  if (!via) throw new Error(`${what}: not on the page`)
  if (via.mouse) await page.mouse.click(via.x, via.y)
  return via.mouse ? 'mouse' : 'dom click'
}

async function shot(page, file) {
  await page.screenshot({ path: path.join(OUT, file) })
}

async function crop(page, file, b, pad = 16, viewport = DESKTOP) {
  if (!b) return
  const x = Math.max(0, b.l - pad)
  const y = Math.max(0, b.t - pad)
  await page.screenshot({ path: path.join(OUT, file), clip: { x, y, width: Math.min(viewport.width - x, b.r - b.l + 2 * pad), height: Math.min(viewport.height - y, b.b - b.t + 2 * pad) } })
}

/** The header's right end: from before the pill (and the toast left of it) to the page's edge. */
const groupEnd = (s) => ({ l: Math.max(0, Math.min(s.pillBox?.l ?? s.vw, s.toast?.box.l ?? s.vw) - 40), t: 0, r: s.vw, b: 72 })

async function openList(page, what) {
  const via = await click(page, FIND.pill, `${what}: the pill`)
  await present(page, FIND.list, { timeout: 4000, what: `${what}: the list did not open` })
  await sleep(450)
  return via
}

async function parked(page, find, what) {
  await waitFor(page, (src) => {
    const el = new Function(`return (${src})()`)()
    return !!el && (window.__worldFrame?.parkProgress ?? 0) >= 0.999 && Number(getComputedStyle(el).opacity) > 0.99
  }, { arg: find.toString(), timeout: PARK_MS, what: `${what}: the panel did not open with the camera parked` })
  await sleep(600)
}

/** The camera parked at one place (its id), the flight over (a switch from a place starts at flight 0, progress 1), its panel up. */
async function parkedAt(page, id, find, what) {
  await waitFor(page, ([src, want]) => {
    const el = new Function(`return (${src})()`)()
    const f = window.__worldFrame
    return !!el && f?.parkedId === want && f.parkProgress >= 0.999 && f.flight >= 0.999 && Number(getComputedStyle(el).opacity) > 0.99
  }, { arg: [find.toString(), id], timeout: PARK_MS, what: `${what}: the camera did not park at ${id} with its panel up` })
  await sleep(600)
}

// ── Rows ────────────────────────────────────────────────────────────────────

let browser = null

async function runRow(id, name, body) {
  if (ONLY && !ONLY.has(String(id))) return
  const row = { id, name, pass: true, checks: [], values: {}, api: [], pageErrors: [], error: null }
  const ctx = await browser.createBrowserContext()
  const r = {
    row,
    open: (params, sub, viewport) => openPage(ctx, row, url(params, sub), viewport),
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

browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--no-sandbox', '--hide-scrollbars'],
  protocolTimeout: 120000,
})

const STATES = [
  { preset: null, file: 'none', text: /^0 days 0\/10$/i, lit: false },
  { preset: 'cold', file: 'cold', text: /^0 days 3\/10$/i, lit: false },
  { preset: 'some', file: 'some', text: /^4 days 4\/10$/i, lit: true },
  { preset: 'long', file: 'long', text: /^128 days 8\/10$/i, lit: true },
  { preset: 'all', file: 'all', text: /^30 days 10\/10$/i, lit: true },
]

try {
  await runRow(1, 'each ?hud= state: the pill at the header\'s right end says the streak and the count; the brand alone at the left', async (r) => {
    for (const st of STATES) {
      const page = await r.open(st.preset ? { hud: st.preset } : {})
      const s = await page.evaluate(SNAP)
      const name = st.preset ?? 'no ?hud'
      r.check(`${name}: the pill says ${st.text.source}`, s.pill && st.text.test(s.pill.text), s.pill?.text)
      r.check(`${name}: the flame is ${st.lit ? 'lit' : 'an outline'}`, s.flameLit === st.lit, s.flameLit)
      r.check(`${name}: the pill ends at the header's right edge (the 40 px gutter), on the brand's line`, s.pillBox && s.brand && s.pillBox.r === s.vw - 40 && Math.abs((s.pillBox.t + s.pillBox.b) / 2 - (s.brand.t + s.brand.b) / 2) <= 2, { pill: s.pillBox, brand: s.brand })
      r.check(`${name}: the brand stands alone at the left (the header holds it and the group), far from the pill`, s.brand && s.brand.l === 40 && s.headerKids === 2 && s.end && s.end.l > s.brand.r + 200 && s.pillBox.l >= s.end.l, { brand: s.brand, group: s.end, pill: s.pillBox, kids: s.headerKids })
      r.check(`${name}: Sign out is the pill's last part`, s.out?.seen && s.out.box.l >= s.pill.box.r - 1 && Math.abs(s.out.box.r - s.pillBox.r) <= 1, s.out)
      r.check(`${name}: the label reads it out`, /^Streak \d+ days?(, best \d+)?\. \d+ of 10 achievements\. Show them$/.test(s.pill?.label ?? ''), s.pill?.label)
      await crop(page, `state-${st.file}.png`, groupEnd(s), 0)
      if (st.preset === 'some') await shot(page, 'map-some.png')
      await page.close()
    }
  })

  await runRow(2, 'the list: under the pill on the right, the streak and the count, every achievement by tier; Back and a click outside close it', async (r) => {
    for (const preset of ['cold', 'some', 'all']) {
      const page = await r.open({ hud: preset })
      const via = await openList(page, `row 2 (${preset})`)
      const s = await page.evaluate(SNAP)
      r.check(`${preset}: opened with the mouse`, via === 'mouse', via)
      r.check(`${preset}: the pill says it is open`, s.pill?.expanded === 'true', s.pill?.expanded)
      r.check(`${preset}: under the pill on the right, the place panel's size (right edge 48 in, top 92, 404 wide)`, s.list && s.list.box.r === s.vw - 48 && s.list.box.t === 92 && s.list.box.w === 404 && s.list.box.t > s.pillBox.b, s.list?.box)
      r.check(`${preset}: translucent over the open map (backdrop blur)`, /blur/.test(s.list?.backdrop ?? ''), s.list?.backdrop)
      r.check(`${preset}: ten rows in four tiers`, s.list?.rows.length === 10 && s.list.groups.length === 4, { rows: s.list?.rows.length, groups: s.list?.groups })
      if (preset === 'cold') {
        r.check('cold: 0 days, best 12, start a new one', /Streak 0 days Best 12 days/i.test(s.list?.text ?? '') && /start a new one/.test(s.list?.text ?? ''), s.list?.text)
        r.check('cold: 3 of 10, three rows held', /Achievements 3 of 10/i.test(s.list?.text ?? '') && s.list.rows.filter((x) => x.held).length === 3, s.list?.rows.filter((x) => x.held).map((x) => x.text))
      }
      if (preset === 'some') {
        r.check('some: 4 days, best 9, keep it going', /Streak 4 days Best 9 days/i.test(s.list?.text ?? '') && /keep it going/.test(s.list?.text ?? ''), s.list?.text)
        r.check('some: the shares of students (98% on First Steps), the column head on the first tier only', /First Steps.*98%/.test(s.list?.rows[0]?.text ?? '') && /% of students/i.test(s.list?.groups[0] ?? '') && s.list.groups.slice(1).every((g) => !/% of students/i.test(g)), { row: s.list?.rows[0], groups: s.list?.groups })
        r.check('some: the two secret ones show as Hidden', s.list?.rows.filter((x) => /^Hidden/.test(x.text)).length === 2, s.list?.rows.slice(-2))
        r.check('some: the list scrolls inside itself', s.list && s.list.scrollH > s.list.clientH, { scrollH: s.list?.scrollH, clientH: s.list?.clientH })
      }
      if (preset === 'all') {
        r.check('all: 10 of 10, the secret ones by name', /10 of 10/.test(s.list?.text ?? '') && /Perfectionist/.test(s.list?.text ?? '') && /Unbroken/.test(s.list?.text ?? '') && !/Hidden/.test(s.list?.text ?? ''), s.list?.text)
      }
      await shot(page, `list-${preset}.png`)
      if (preset === 'some') {
        await click(page, FIND.back, 'row 2: Back to map')
        await waitFor(page, () => !document.querySelector('main header [role="dialog"]'), { timeout: 3000, what: 'row 2: Back did not close the list' })
        const focus = await page.evaluate(() => document.activeElement?.getAttribute('aria-expanded'))
        r.check('Back to map closes it and focus is on the pill', focus !== null, focus)
        await openList(page, 'row 2, again')
        await page.mouse.click(1200, 600)
        await waitFor(page, () => !document.querySelector('main header [role="dialog"]'), { timeout: 3000, what: 'row 2: a click outside did not close the list' })
        r.check('a click on the map outside closes it', true, 'closed')
      }
      await page.close()
    }
  })

  await runRow(3, 'a fresh unlock: the toast out of the pill, the count sand, read out, gone after 6.5 s, marked New', async (r) => {
    const page = await r.open({ hud: 'fresh' })
    const before = await page.evaluate(SNAP)
    r.check('before: 2 of 10, no toast', /2\/10$/.test(before.pill?.text ?? '') && before.toast === null, { pill: before.pill?.text, toast: before.toast })
    await present(page, FIND.toast, { timeout: 8000, what: 'row 3: no toast' })
    await sleep(600)
    const s = await page.evaluate(SNAP)
    r.check('the toast names it: Achievement earned, Habit Builder', /Achievement earned Habit Builder/i.test(s.toast?.text ?? ''), s.toast?.text)
    r.check('it sits in the header row, left of the pill, clear of the brand', s.toast && s.toast.box.r <= s.pillBox.l && s.toast.box.b <= 72 && s.toast.box.l > s.brand.r, { toast: s.toast?.box, pill: s.pillBox, brand: s.brand })
    r.check('the count says 3/10, in sand', /3\/10$/.test(s.pill?.text ?? '') && s.countFresh === true && /rgb\(240, 183, 126\)/.test(s.countColor ?? ''), { text: s.pill?.text, fresh: s.countFresh, color: s.countColor })
    r.check('the status line reads it out', s.status === 'Achievement earned: Habit Builder.', s.status)
    await crop(page, 'fresh-toast.png', groupEnd(s), 0)
    await waitFor(page, () => !document.querySelector('main header button[aria-hidden="true"]'), { timeout: TOAST_MS + 2000, what: 'row 3: the toast did not go' })
    const after = await page.evaluate(SNAP)
    r.check('it goes on its own; the count stays 3/10 in ink', after.toast === null && /3\/10$/.test(after.pill?.text ?? '') && after.countFresh === false && after.status === '', { toast: after.toast, text: after.pill?.text, status: after.status })
    await openList(page, 'row 3')
    const l = await page.evaluate(SNAP)
    const fresh = l.list?.rows.filter((x) => x.fresh) ?? []
    r.check('the list marks Habit Builder New, and only it', fresh.length === 1 && /^Habit Builder New/i.test(fresh[0].text) && fresh[0].held, fresh)
    await shot(page, 'fresh-list.png')
    // Under 1280 px the row between the logo and the group can be too short for it (the widest
    // group leaves it nothing at 800 px): it drops under the pill, right-aligned with it, its
    // words whole, and the logo does not move.
    for (const width of [1024, 800]) {
      const vp = { width, height: 900 }
      const narrow = await r.open({ hud: 'fresh', discount: 'ready', playbook: '1' }, '', vp)
      const b0 = await narrow.evaluate(SNAP)
      await present(narrow, FIND.toast, { timeout: 8000, what: `row 3 (${width}): no toast` })
      await sleep(600)
      const n = await narrow.evaluate(SNAP)
      const whole = await narrow.evaluate(() => {
        const t = document.querySelector('main header button[aria-hidden="true"]')
        return !!t && t.scrollWidth <= t.clientWidth + 1 && [...t.children].every((c) => c.scrollWidth <= c.clientWidth + 1)
      })
      r.check(`${width} px wide: the toast under the pill, right-aligned with it, its words whole; the logo holds still`, n.toast?.seen && n.toast.box.t >= n.pillBox.b + 4 && Math.abs(n.toast.box.r - n.pillBox.r) <= 1 && n.toast.box.l > n.brand.r && whole && /Habit Builder/.test(n.toast.text) && JSON.stringify(n.brand) === JSON.stringify(b0.brand), { toast: n.toast?.box, pill: n.pillBox, brand: [b0.brand, n.brand], whole })
      await crop(narrow, `fresh-toast-${width}.png`, { l: 0, t: 0, r: width, b: 100 }, 0, vp)
      await narrow.close()
    }
  })

  await runRow(4, 'a place open: the corner stays above its panel; the list on the right, clear of it, solid; Esc one level at a time', async (r) => {
    const page = await r.open({ hud: 'some' }, '/a5')
    await parked(page, FIND.place, 'row 4')
    let s = await page.evaluate(SNAP)
    r.check('the place panel is up and the corner too', s.place && s.pill?.seen && s.out?.seen, { place: s.place, pill: s.pill?.seen })
    r.check('the corner sits above the panel, clear of it', s.pillBox && s.place && s.pillBox.b + 12 <= s.place.box.t, { pill: s.pillBox, panel: s.place?.box })
    await shot(page, 'place-corner.png')
    await openList(page, 'row 4')
    s = await page.evaluate(SNAP)
    r.check("the list opens on the right under the pill, clear of the place's panel on the left", s.list && s.place && s.list.box.t === 92 && s.list.box.r === s.vw - 48 && s.list.box.l >= s.place.box.r + 16, { list: s.list?.box, place: s.place?.box })
    r.check('solid while a place is open (no blur, an opaque ground)', s.list?.backdrop === 'none' && /^rgb\(/.test(s.list?.bg ?? ''), { backdrop: s.list?.backdrop, bg: s.list?.bg })
    const top = await page.evaluate(() => {
      const list = document.querySelector('main header [role="dialog"]')
      const place = document.querySelector('main section[aria-labelledby="v4-panel-title"]')
      const r = list.getBoundingClientRect()
      const p = place.getBoundingClientRect()
      return {
        list: list.contains(document.elementFromPoint(r.left + 40, r.top + 200)),
        place: place.contains(document.elementFromPoint(p.left + p.width / 2, p.top + Math.min(200, p.height / 2))),
      }
    })
    r.check("it is on top where it is, and the place's panel stays in view beside it", top.list === true && top.place === true, top)
    const leader = await page.evaluate(() => getComputedStyle(document.querySelector('main > svg')).opacity)
    r.check("the place's line to its landmark (under the list, right of the frame's middle) goes while the list is up", leader === '0', leader)
    await shot(page, 'place-list.png')
    await page.keyboard.press('Escape')
    await sleep(500)
    s = await page.evaluate(SNAP)
    r.check('Esc closes the list and leaves the place open', s.list === null && s.place !== null && s.path === `${APP}/a5`, { list: s.list, place: !!s.place, path: s.path })
    const back = await page.evaluate(() => getComputedStyle(document.querySelector('main > svg')).opacity)
    r.check("the place's line is back", back === '1', back)
    await page.keyboard.press('Escape')
    await waitFor(page, () => !document.querySelector('main section[aria-labelledby="v4-panel-title"]'), { timeout: PARK_MS, what: 'row 4: the second Esc did not close the place' })
    r.check('a second Esc closes the place', true, 'closed')
    await sleep(1200)
    await openList(page, 'row 4, opening a place')
    await page.evaluate(() => window.__worldPark('a2'))
    await waitFor(page, () => location.pathname.endsWith('/a2'), { timeout: 8000, what: 'row 4: the place did not open' })
    await sleep(400)
    s = await page.evaluate(SNAP)
    r.check('opening a place closes the list', s.list === null, s.list?.box)
    await page.close()

    const cpPage = await r.open({ hud: 'some', discount: 'locked' })
    await cpPage.evaluate(() => window.__worldPark('checkpoint'))
    await parked(cpPage, FIND.cpPanel, 'row 4 (checkpoint)')
    s = await cpPage.evaluate(SNAP)
    r.check("the checkpoint's panel is up, the corner above it, the discount's segment inside the pill", s.cp && s.pill?.seen && s.pillBox.b + 12 <= s.cp.box.t && s.chip && s.chip.l >= s.pillBox.l && s.chip.r <= s.pillBox.r && s.chip.l >= s.pill.box.r - 1 && s.chip.r <= s.out.box.l + 1, { pill: s.pillBox, cp: s.cp?.box, chip: s.chip })
    await shot(cpPage, 'checkpoint-corner.png')
    await cpPage.close()

    // The list open, then the discount's segment in the same pill: the checkpoint opens, the
    // camera parks at the cache and the list gives way to it, as it does to a place. Inside the
    // pill a click on the segment is not a click outside the list (at HEAD the chip stood
    // outside the corner, and that click closed it). By the mouse and by the keyboard, at 800 px
    // too, where the list would cover the cache; and from an open place, whose address goes
    // only after the checkpoint has opened.
    const NARROW = { width: 800, height: 900 }
    const SEG = [
      { how: 'mouse', vp: DESKTOP, sub: '' },
      { how: 'keyboard', vp: NARROW, sub: '' },
      { how: 'mouse', vp: NARROW, sub: '/a5' },
    ]
    for (const t of SEG) {
      const name = `${t.vp.width} px, ${t.how === 'mouse' ? 'a click' : 'Shift+Tab back to it and Enter'}${t.sub ? ', from an open place' : ''}`
      const pg = await r.open({ hud: 'some', discount: 'locked' }, t.sub, t.vp)
      if (t.sub) await parked(pg, FIND.place, `row 4 (${name})`)
      await openList(pg, `row 4 (${name})`)
      let via = null
      if (t.how === 'keyboard') {
        // The list opens with focus on its heading; back through Sign out to the segment.
        for (let i = 0; i < 6 && via === null; i++) {
          await pg.keyboard.down('Shift')
          await pg.keyboard.press('Tab')
          await pg.keyboard.up('Shift')
          if (await pg.evaluate(() => /discount checkpoint/.test(document.activeElement?.getAttribute('aria-label') ?? ''))) via = `Enter, after ${i + 1} Shift+Tab`
        }
        if (via === null) throw new Error(`row 4 (${name}): Shift+Tab never reached the discount segment`)
        await pg.keyboard.press('Enter')
      } else {
        via = await click(pg, FIND.cpChip, `row 4 (${name}): the discount segment`)
      }
      await parkedAt(pg, 'checkpoint', FIND.cpPanel, `row 4 (${name})`)
      s = await pg.evaluate(SNAP)
      // The cache the camera parked on: the checkpoint's point on the screen, as the scene
      // projects it (its plaque fades out with the other markers while parked).
      const cache = await pg.evaluate(() => {
        const m = window.__worldFrame?.markers.find((x) => x.id === 'checkpoint')
        if (!m) return null
        const hit = document.elementFromPoint(m.x, m.y)
        return { x: Math.round(m.x), y: Math.round(m.y), onScreen: m.visible && m.x >= 0 && m.x <= innerWidth && m.y >= 0 && m.y <= innerHeight, underADialog: !!hit?.closest('[role="dialog"]') }
      })
      const focusIn = await pg.evaluate(() => !!document.activeElement?.closest('section[aria-labelledby="cp-panel-title"]'))
      r.check(`${name}: with the list open, the discount segment opens the checkpoint, the camera parks at the cache, and the list closes`, (t.how === 'keyboard' || via === 'mouse') && s.list === null && s.cp !== null && s.park?.id === 'checkpoint' && s.pill?.expanded === 'false', { via, list: s.list?.box ?? null, cp: s.cp?.box, park: s.park, expanded: s.pill?.expanded })
      r.check(`${name}: one panel on the screen, the checkpoint's, with the focus in it; the cache is in view and nothing of the list lies over it`, focusIn && cache?.onScreen && !cache.underADialog && (!t.sub || (s.place === null && s.path === APP)), { focusIn, cache, place: s.place?.box ?? null, path: s.path })
      await shot(pg, `checkpoint-from-list-${t.vp.width}-${t.how}${t.sub ? '-place' : ''}.png`)
      await pg.close()
    }
  })

  await runRow(5, 'the keyboard: Tab to the pill, Enter opens the list, Esc back to the pill, Tab to Sign out', async (r) => {
    const page = await r.open({ hud: 'some' })
    await page.evaluate(() => document.activeElement?.blur())
    let presses = 0
    let on = null
    for (; presses < 60; presses++) {
      await page.keyboard.press('Tab')
      on = await page.evaluate(() => document.activeElement?.getAttribute('aria-expanded'))
      if (on !== null) break
    }
    r.row.values.tabs = presses + 1
    r.check('Tab reaches the pill', on === 'false', { presses: presses + 1, on })
    const ring = await page.evaluate(() => {
      const el = document.activeElement
      const cs = getComputedStyle(el)
      return { outline: cs.outlineStyle, width: cs.outlineWidth, visible: el.matches(':focus-visible') }
    })
    r.check('with the focus ring (2px, focus-visible)', ring.visible && ring.outline === 'solid' && ring.width === '2px', ring)
    let s = await page.evaluate(SNAP)
    await crop(page, 'focus-pill.png', groupEnd(s), 0)
    await page.keyboard.press('Enter')
    await present(page, FIND.list, { timeout: 3000, what: 'row 5: Enter did not open the list' })
    await sleep(400)
    s = await page.evaluate(SNAP)
    r.check('Enter opens the list, focus on its heading', s.focus?.tag === 'H2' && s.focus.inList, s.focus)
    await page.keyboard.press('Tab')
    await sleep(200)
    s = await page.evaluate(SNAP)
    r.check('Tab goes to Back to map', /Back to map/.test(s.focus?.text ?? '') && s.focus.inList, s.focus)
    await shot(page, 'focus-list.png')
    await page.keyboard.press('Escape')
    await sleep(300)
    s = await page.evaluate(SNAP)
    r.check('Esc closes it and focus is back on the pill', s.list === null && s.focus?.label?.startsWith('Streak'), s.focus)
    await page.keyboard.press('Tab')
    await sleep(300)
    s = await page.evaluate(SNAP)
    const tip = await page.evaluate(() => {
      const t = document.activeElement?.querySelector('[aria-hidden="true"]:not(svg)')
      return t ? { text: t.textContent, opacity: Number(getComputedStyle(t).opacity) } : null
    })
    r.check('the next Tab is Sign out, and its word shows', s.focus?.label === 'Sign out' && tip?.text === 'Sign out' && tip.opacity > 0.9, { focus: s.focus, tip })
    const word = await page.evaluate(() => {
      const r = document.activeElement?.querySelector('[aria-hidden="true"]:not(svg)')?.getBoundingClientRect()
      return r ? { l: Math.round(r.left), r: Math.round(r.right) } : null
    })
    r.check('its word stays inside the screen at the right end', !!word && word.l >= 0 && word.r <= s.vw, word)
    await crop(page, 'focus-signout.png', { ...groupEnd(s), b: 110 }, 0)
  })

  await runRow(6, 'Sign out: the pill and the list both reach the app’s sign-out (counted by the stand-in)', async (r) => {
    const page = await r.open({ hud: 'some' })
    await click(page, FIND.out, 'row 6: Sign out in the pill')
    await sleep(300)
    let s = await page.evaluate(SNAP)
    r.check('the pill’s Sign out: 1', s.hud?.signOuts === 1, s.hud)
    await openList(page, 'row 6')
    await click(page, FIND.listSignOut, 'row 6: Sign out in the list')
    await sleep(300)
    s = await page.evaluate(SNAP)
    r.check('the list’s Sign out: 2', s.hud?.signOuts === 2, s.hud)
  })

  await runRow(7, 'under a lesson page the corner is hidden; an unlock there toasts back on the map', async (r) => {
    const page = await r.open({ hud: 'some' }, '/a1/a1l01')
    await waitFor(page, () => [...document.querySelectorAll('h1')].some((h) => !h.closest('main')), { timeout: 40000, what: 'row 7: no lesson page' })
    await sleep(800)
    let s = await page.evaluate(SNAP)
    r.check('the header (and the corner in it) is not visible under the lesson page', s.headerSeen === false && s.pill?.seen === false, { header: s.headerSeen, pill: s.pill?.seen })
    await page.evaluate(() => window.__fixtureHud.unlock('streak_7'))
    await sleep(1500)
    s = await page.evaluate(SNAP)
    r.check('an unlock under the lesson page does not toast there', s.toast === null && s.status === '', { toast: s.toast, status: s.status })
    await page.keyboard.press('Escape')
    await waitFor(page, () => location.pathname === '/dev/world-app/a1', { timeout: 10000, what: 'row 7: Esc did not go back to the place' })
    await present(page, FIND.toast, { timeout: 8000, what: 'row 7: no toast back on the map' })
    await sleep(600)
    s = await page.evaluate(SNAP)
    r.check('back on the map the toast plays: Habit Builder, 5/10', /Habit Builder/.test(s.toast?.text ?? '') && s.toast.seen && /5\/10$/.test(s.pill?.text ?? ''), { toast: s.toast, pill: s.pill?.text })
    await shot(page, 'back-from-lesson.png')
  })

  await runRow(8, 'through the telescope the corner steps out of the sky caption’s row', async (r) => {
    const page = await r.open({ hud: 'some' }, '/a7')
    await parked(page, FIND.place, 'row 8')
    const s = await page.evaluate(SNAP)
    const tel = await page.evaluate(() => document.querySelector('main section[aria-labelledby="v4-panel-title"]')?.hasAttribute('data-tel'))
    r.check('the panel is the telescope’s', tel === true, tel)
    r.check('the corner is not visible', s.pill?.seen === false, s.pill)
  })

  await runRow(9, 'wide (3428x1230): the pill at the right end, the list under it, the toast', async (r) => {
    let page = await r.open({ hud: 'long' }, '', WIDE)
    let s = await page.evaluate(SNAP)
    r.check('the pill ends at the right edge (the 56 px gutter), the brand alone at the left', s.pillBox && s.pillBox.r === WIDE.width - 56 && s.brand && s.brand.l === 56 && s.pillBox.l > s.brand.r + 200, { pill: s.pillBox, brand: s.brand })
    await page.screenshot({ path: path.join(OUT, 'wide-long.png') })
    await openList(page, 'row 9')
    s = await page.evaluate(SNAP)
    r.check('the list under the pill at this size (right edge 64 in, 432 wide)', s.list?.box.r === WIDE.width - 64 && s.list.box.w === 432, s.list?.box)
    await page.screenshot({ path: path.join(OUT, 'wide-list.png') })
    await page.close()
    page = await r.open({ hud: 'fresh' }, '', WIDE)
    await present(page, FIND.toast, { timeout: 8000, what: 'row 9: no toast' })
    await sleep(600)
    s = await page.evaluate(SNAP)
    r.check('the toast in the header row, left of the pill', s.toast?.seen && s.toast.box.b <= 72 && s.toast.box.r <= s.pillBox.l, s.toast)
    await crop(page, 'wide-toast.png', groupEnd(s), 0, WIDE)
  })

  await runRow(10, 'phone (390x844): the stats at the header row\'s right end, the discount in the row under them, the list a full sheet with Sign out, the toast at the bottom', async (r) => {
    for (const st of STATES) {
      const page = await r.open({ ...(st.preset ? { hud: st.preset } : {}), discount: 'locked' }, '', PHONE)
      const s = await page.evaluate(SNAP)
      const chip = await page.evaluate(() => {
        const b = document.querySelector('main header button[aria-label*="discount checkpoint"]')?.getBoundingClientRect()
        return b ? { l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom) } : null
      })
      const name = st.preset ?? 'no ?hud'
      const numbers = st.text.source.replace(/ days/, '').replace(/\\\//, '/').replace(/[\^$]/g, '').replace(/\/i$/, '')
      r.check(`${name}: the list view, the stats in the header's row at its right end (22 px gutter), across from the brand`, s.view === 'list' && s.pillBox && s.pillBox.r === PHONE.width - 22 && s.pillBox.t < 36 && s.pillBox.b > 36 && s.brand && s.brand.l === 22 && s.brand.r + 8 <= s.pillBox.l, { pill: s.pillBox, brand: s.brand })
      r.check(`${name}: numbers only, no Sign out in the pill`, s.pill?.text.toLowerCase() === numbers && s.out?.seen === false, { text: s.pill?.text, want: numbers, out: s.out?.seen })
      r.check(`${name}: the discount in the row under the stats, right-aligned with them, inside the screen`, chip && chip.t >= s.pillBox.b + 4 && Math.abs(chip.r - s.pillBox.r) <= 2 && chip.l >= 22, { pill: s.pillBox, chip })
      if (st.preset === 'some') {
        await shot(page, 'phone-some.png')
        await openList(page, 'row 10')
        const l = await page.evaluate(SNAP)
        r.check('the list is a full sheet (modal)', l.list?.sheet && l.list.modal === 'true' && l.list.box.l === 0 && l.list.box.t === 0 && l.list.box.w === PHONE.width && l.list.box.h === PHONE.height, l.list?.box)
        const covered = await page.evaluate(() => {
          const sheet = document.querySelector('main header [role="dialog"]')
          const chip = document.querySelector('main header button[aria-label*="discount checkpoint"]').getBoundingClientRect()
          const el = document.elementFromPoint(chip.left + chip.width / 2, chip.top + chip.height / 2)
          return sheet.contains(el)
        })
        r.check('the sheet covers the discount chip (nothing shows through)', covered === true, covered)
        r.check('it says Back and has Sign out', /^Back$/.test((await page.evaluate(() => [...document.querySelector('main header [role="dialog"]').querySelectorAll('button')][0].textContent.trim()))) && (await has(page, FIND.listSignOut)), 'Back + Sign out')
        await shot(page, 'phone-sheet.png')
        await page.evaluate(() => {
          const inner = document.querySelector('main header [role="dialog"]').firstElementChild
          inner.scrollTop = inner.scrollHeight
        })
        await sleep(300)
        await shot(page, 'phone-sheet-end.png')
      }
      if (st.preset === null) await shot(page, 'phone-none.png')
      await page.close()
    }
    const page = await r.open({ hud: 'fresh' }, '', PHONE)
    await present(page, FIND.toast, { timeout: 8000, what: 'row 10: no toast' })
    await sleep(600)
    const s = await page.evaluate(SNAP)
    r.check('the toast at the bottom, full width', s.toast?.seen && s.toast.box.l === 16 && s.toast.box.r === PHONE.width - 16 && s.toast.box.b === PHONE.height - 20, s.toast?.box)
    await shot(page, 'phone-toast.png')
    // The header's 01/08 went (2026-10-15) and a phone has no timeline: the course's count heads
    // the list of places, and it is the places' own counts added up. With every place done the
    // Next block carries it instead.
    for (const p of ['mid', 'all']) {
      const pg = await r.open({ p, discount: 'locked' }, '', PHONE)
      const c = await pg.evaluate(() => {
        const norm = (t) => (t ?? '').replace(/\s+/g, ' ').trim()
        const next = document.querySelector('main section[aria-label="Next lesson"]')
        const line = next?.nextElementSibling?.tagName === 'P' ? next.nextElementSibling : null
        const ol = document.querySelector('main ol')
        const rows = [...(ol?.querySelectorAll(':scope > li > button') ?? [])].map((b) => /, (\d+) of (\d+) lessons done$/.exec(b.getAttribute('aria-label') ?? ''))
        const watch = next?.querySelector('button')?.getBoundingClientRect()
        const lr = line?.getBoundingClientRect()
        return {
          line: line ? norm(line.innerText) : null,
          done: rows.reduce((n, m) => n + Number(m?.[1] ?? 0), 0),
          total: rows.reduce((n, m) => n + Number(m?.[2] ?? 0), 0),
          rows: rows.filter(Boolean).length,
          between: !!(lr && watch && ol && lr.top >= watch.bottom && lr.bottom <= ol.getBoundingClientRect().top),
          inNext: [...(next?.querySelectorAll('p') ?? [])].map((x) => norm(x.innerText)).filter((t) => / of \d+ lessons$/.test(t)),
        }
      })
      if (p === 'mid') r.check('?p=mid: the course\'s count heads the list, under Watch, and adds up the 8 places\' counts', c.rows === 8 && c.done > 0 && c.line === `${c.done} of ${c.total} lessons` && c.between && c.inNext.length === 0, c)
      else r.check('?p=all: nothing over the list, the Next block says every lesson is done', c.rows === 8 && c.line === null && c.inNext.length === 1 && c.inNext[0] === `${c.total} of ${c.total} lessons`, c)
      if (p === 'mid') await shot(pg, 'phone-course-count.png')
      await pg.close()
    }
  })

  await runRow(11, "the streak's moment in the pill: the number changes in place, inside the pill; nothing around it moves; its own status line", async (r) => {
    for (const vp of [DESKTOP, PHONE]) {
      const name = vp.width < 760 ? 'phone' : `${vp.width} px`
      const gutter = vp.width < 760 ? 22 : 40
      // A browser of its own per size: one context shares the browser key, and a key at 10
      // rightly gives the next page's 9 no moment.
      const own = await browser.createBrowserContext()
      try {
        const page = await openPage(own, r.row, url({ hud: 'some', celebrate: '1' }), vp)
        // The 4's own moment plays once the loading screen has faded (on a phone, which has none, at
        // once): it has played when its line is read out, and is over when the number lets go.
        await waitFor(page, () => [...document.querySelectorAll('main header [role="status"]')][1]?.textContent === 'Streak: 4 days.' && !document.querySelector('main header button[aria-expanded] > span')?.hasAttribute('data-tick'), { timeout: 8000, what: `row 11 (${name}): the 4's own moment did not play` })
        // 9, then 10: the pill grows by a digit, so the second moment comes with a wider number.
        for (const n of [9, 10]) {
          await page.evaluate((n) => window.__fixture.setStreak(n), n)
          const during = await waitFor(page, (src) => {
            const m = new Function(`return (${src})()`)()
            return m.on ? m : null
          }, { arg: MOMENT_SNAP.toString(), timeout: 3000, poll: 15, what: `row 11 (${name}): no moment for ${n}` })
          await waitFor(page, () => !document.querySelector('main header button[aria-expanded] > span')?.hasAttribute('data-tick'), { timeout: 3000, what: `row 11 (${name}): the moment for ${n} did not end` })
          const after = await page.evaluate(MOMENT_SNAP)
          r.check(`${name}, ${n}: during its moment the number stays inside the pill, which keeps its right edge (the ${gutter} px gutter)`, during.n === String(n) && !!during.num && !!during.pill && during.num.l >= during.pill.l && during.num.r <= during.pill.r && during.num.t >= during.pill.t && during.num.b <= during.pill.b && during.pill.r === vp.width - gutter, during)
          r.check(`${name}, ${n}: the moment moves nothing around it (the pill and the brand stand as they do after it)`, JSON.stringify(during.pill) === JSON.stringify(after.pill) && JSON.stringify(during.brand) === JSON.stringify(after.brand), { during: [during.pill, during.brand], after: [after.pill, after.brand] })
          r.check(`${name}, ${n}: read out on its own line ("Streak: ${n} days."), the toast's line left empty`, after.say === `Streak: ${n} days.` && after.status === '', { say: after.say, status: after.status })
        }
      } finally {
        await own.close().catch(() => {})
      }
    }
  })
} finally {
  await browser.close()
}

const failed = results.filter((x) => !x.pass).length
console.log(
  `\nMEASURED  pages ${tally.pages} · requests to /api ${tally.api.length}${tally.api.length ? ` ${show(tally.api.slice(0, 4))}` : ''} · requests to Supabase ${tally.supabase.length}${tally.supabase.length ? ` ${show(tally.supabase.slice(0, 4))}` : ''} · page errors ${tally.pageErrors.length}${tally.pageErrors.length ? ` ${show(tally.pageErrors.slice(0, 2))}` : ''}`,
)
const measuredOk = tally.api.length === 0 && tally.supabase.length === 0 && tally.pageErrors.length === 0
console.log(`PASS ${results.length - failed}  FAIL ${failed}${measuredOk ? '' : '  (MEASURED fails)'}`)
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ results, tally }, null, 1))
process.exit(failed || !measuredOk ? 1 : 0)
